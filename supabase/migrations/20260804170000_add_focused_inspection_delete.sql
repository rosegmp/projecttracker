create or replace function public.delete_project_inspection(
  p_project_id text,
  p_inspection_id text,
  p_expected_version bigint default 0,
  p_expected_file_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_version bigint;
  current_file_version bigint;
  expected_file_version bigint;
  file_kind text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
    raise exception 'You do not have access to edit this project.' using errcode = '42501';
  end if;
  if nullif(btrim(p_inspection_id), '') is null
    or jsonb_typeof(coalesce(p_expected_file_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Inspection and version data have invalid shapes.' using errcode = '22023';
  end if;

  select version into current_version
  from public.project_inspections
  where project_id = p_project_id and id = p_inspection_id
  for update;

  if current_version is null or current_version <> coalesce(p_expected_version, 0) then
    raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', p_inspection_id using errcode = '40001';
  end if;

  foreach file_kind in array array['sticker'::text, 'report'::text] loop
    expected_file_version := coalesce((p_expected_file_versions->>file_kind)::bigint, 0);
    select version into current_file_version
    from public.project_inspection_files
    where project_id = p_project_id and inspection_id = p_inspection_id and kind = file_kind
    for update;
    if coalesce(current_file_version, 0) <> expected_file_version then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%:%', p_inspection_id, file_kind using errcode = '40001';
    end if;
    current_file_version := null;
  end loop;

  delete from public.project_inspection_files
  where project_id = p_project_id and inspection_id = p_inspection_id;
  delete from public.project_inspections
  where project_id = p_project_id and id = p_inspection_id;

  return jsonb_build_object('deleted', true, 'inspectionId', p_inspection_id);
end;
$$;

revoke all on function public.delete_project_inspection(text, text, bigint, jsonb) from public, anon;
grant execute on function public.delete_project_inspection(text, text, bigint, jsonb) to authenticated;
