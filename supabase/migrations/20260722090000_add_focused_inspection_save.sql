-- Save one inspection without requiring an Android client to hold current
-- versions for every other inspection and attachment in the project.

create or replace function public.save_project_inspection(
  p_project_id text,
  p_inspection jsonb,
  p_expected_version bigint default 0,
  p_expected_file_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_inspection_id text := nullif(p_inspection->>'id', '');
  current_version bigint;
  next_version bigint;
  next_position integer;
  file_kind text;
  file_data jsonb;
  current_file_version bigint;
  expected_file_version bigint;
  file_versions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
    raise exception 'You do not have access to edit this project.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_inspection, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_expected_file_versions, '{}'::jsonb)) <> 'object'
    or target_inspection_id is null then
    raise exception 'Inspection and version data have invalid shapes.' using errcode = '22023';
  end if;

  select version into current_version
  from public.project_inspections
  where project_id = p_project_id and id = target_inspection_id
  for update;

  if current_version is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', target_inspection_id using errcode = '40001';
    end if;
    select coalesce(max(position), -1) + 1 into next_position
    from public.project_inspections where project_id = p_project_id;
    insert into public.project_inspections (project_id, id, position, data)
    values (
      p_project_id,
      target_inspection_id,
      next_position,
      p_inspection - 'stickerFile' - 'reportFile'
    )
    returning version into next_version;
  else
    if current_version <> coalesce(p_expected_version, 0) then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', target_inspection_id using errcode = '40001';
    end if;
    update public.project_inspections
    set data = p_inspection - 'stickerFile' - 'reportFile',
        version = case
          when data is distinct from p_inspection - 'stickerFile' - 'reportFile' then version + 1
          else version
        end,
        updated_at = case
          when data is distinct from p_inspection - 'stickerFile' - 'reportFile' then now()
          else updated_at
        end
    where project_id = p_project_id and id = target_inspection_id
    returning version into next_version;
  end if;

  foreach file_kind in array array['sticker'::text, 'report'::text] loop
    file_data := case file_kind
      when 'sticker' then p_inspection->'stickerFile'
      else p_inspection->'reportFile'
    end;
    expected_file_version := coalesce((p_expected_file_versions->>file_kind)::bigint, 0);
    select version into current_file_version
    from public.project_inspection_files
    where project_id = p_project_id and inspection_id = target_inspection_id and kind = file_kind
    for update;

    if current_file_version is null then
      if expected_file_version <> 0 then
        raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%:%', target_inspection_id, file_kind using errcode = '40001';
      end if;
      if jsonb_typeof(file_data) = 'object' and nullif(file_data->>'id', '') is not null then
        insert into public.project_inspection_files (project_id, inspection_id, kind, id, data)
        values (p_project_id, target_inspection_id, file_kind, file_data->>'id', file_data);
      end if;
    else
      if current_file_version <> expected_file_version then
        raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%:%', target_inspection_id, file_kind using errcode = '40001';
      end if;
      if jsonb_typeof(file_data) = 'object' and nullif(file_data->>'id', '') is not null then
        update public.project_inspection_files
        set id = file_data->>'id',
            data = file_data,
            version = case
              when id is distinct from file_data->>'id' or data is distinct from file_data then version + 1
              else version
            end,
            updated_at = case
              when id is distinct from file_data->>'id' or data is distinct from file_data then now()
              else updated_at
            end
        where project_id = p_project_id and inspection_id = target_inspection_id and kind = file_kind;
      else
        delete from public.project_inspection_files
        where project_id = p_project_id and inspection_id = target_inspection_id and kind = file_kind;
      end if;
    end if;
    current_file_version := null;
  end loop;

  select coalesce(jsonb_object_agg(kind, version), '{}'::jsonb)
  into file_versions
  from public.project_inspection_files
  where project_id = p_project_id and inspection_id = target_inspection_id;

  return jsonb_build_object(
    'inspectionVersion', next_version,
    'fileVersions', file_versions
  );
end;
$$;

revoke all on function public.save_project_inspection(text, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.save_project_inspection(text, jsonb, bigint, jsonb) to authenticated;
