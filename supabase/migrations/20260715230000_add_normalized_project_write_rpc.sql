create or replace function public.get_normalized_project_versions(p_project_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'phases', coalesce((
      select jsonb_object_agg(id, version) from public.project_phases where project_id = p_project_id
    ), '{}'::jsonb),
    'steps', coalesce((
      select jsonb_object_agg(phase_id || ':' || id, version) from public.project_steps where project_id = p_project_id
    ), '{}'::jsonb),
    'folders', coalesce((
      select jsonb_object_agg(id, version) from public.project_file_folders where project_id = p_project_id
    ), '{}'::jsonb),
    'files', coalesce((
      select jsonb_object_agg(folder_id || ':' || id, version) from public.project_files where project_id = p_project_id
    ), '{}'::jsonb),
    'photos', coalesce((
      select jsonb_object_agg(id, version) from public.project_photos where project_id = p_project_id
    ), '{}'::jsonb),
    'selections', coalesce((
      select jsonb_object_agg(id, version) from public.project_selections where project_id = p_project_id
    ), '{}'::jsonb),
    'selectionAttachments', coalesce((
      select jsonb_object_agg(selection_id || ':' || id, version)
      from public.project_selection_attachments where project_id = p_project_id
    ), '{}'::jsonb),
    'selectionPhotos', coalesce((
      select jsonb_object_agg(selection_id || ':' || id, version)
      from public.project_selection_photos where project_id = p_project_id
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.get_normalized_project_versions(text) from public, anon, authenticated;

create or replace function public.save_normalized_project_sections(
  p_project_id text,
  p_sections jsonb,
  p_expected_versions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_app_user_id text;
  project_data jsonb;
  next_data jsonb;
  next_version bigint;
  version_row record;
  expected_map jsonb;
  expected_count integer;
  actual_count integer;
  section_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_sections, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_expected_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Normalized sections and versions must be objects.' using errcode = '22023';
  end if;
  if not (p_sections ?| array['phases', 'files', 'photos', 'selections']) then
    raise exception 'No supported normalized project section was supplied.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_sections) supplied_section
    where supplied_section not in ('phases', 'files', 'photos', 'selections')
  ) then
    raise exception 'Unsupported normalized project section.' using errcode = '22023';
  end if;

  select app_user->>'id', app_user->>'role'
    into actor_app_user_id, actor_role
    from public.settings app_settings,
      jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
    where app_settings.id = 'app_settings'
      and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    limit 1;
  if coalesce(actor_role, '') not in ('Admin', 'Edit') then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;

  select data into project_data
  from public.projects
  where id = p_project_id
  for update;
  if project_data is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  if actor_role = 'Edit'
    and jsonb_array_length(coalesce(project_data->'accessUserIds', '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(project_data->'accessUserIds', '[]'::jsonb)) access_id
      where access_id = actor_app_user_id
    ) then
    raise exception 'You do not have access to this project.' using errcode = '42501';
  end if;

  if p_sections ? 'phases' then
    foreach section_name in array array['phases', 'steps'] loop
      expected_map := coalesce(p_expected_versions->section_name, '{}'::jsonb);
      expected_count := (select count(*) from jsonb_object_keys(expected_map));
      if section_name = 'phases' then
        actual_count := (select count(*) from public.project_phases where project_id = p_project_id);
        if expected_count <> actual_count then
          raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, p_project_id using errcode = '40001';
        end if;
        for version_row in select id as key, version from public.project_phases where project_id = p_project_id loop
          if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
            raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, version_row.key using errcode = '40001';
          end if;
        end loop;
      else
        actual_count := (select count(*) from public.project_steps where project_id = p_project_id);
        if expected_count <> actual_count then
          raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, p_project_id using errcode = '40001';
        end if;
        for version_row in
          select phase_id || ':' || id as key, version from public.project_steps where project_id = p_project_id
        loop
          if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
            raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, version_row.key using errcode = '40001';
          end if;
        end loop;
      end if;
    end loop;
  end if;

  if p_sections ? 'files' then
    expected_map := coalesce(p_expected_versions->'folders', '{}'::jsonb);
    expected_count := (select count(*) from jsonb_object_keys(expected_map));
    actual_count := (select count(*) from public.project_file_folders where project_id = p_project_id);
    if expected_count <> actual_count then
      raise exception 'NORMALIZED_VERSION_CONFLICT:folders:%', p_project_id using errcode = '40001';
    end if;
    for version_row in select id as key, version from public.project_file_folders where project_id = p_project_id loop
      if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
        raise exception 'NORMALIZED_VERSION_CONFLICT:folders:%', version_row.key using errcode = '40001';
      end if;
    end loop;

    expected_map := coalesce(p_expected_versions->'files', '{}'::jsonb);
    expected_count := (select count(*) from jsonb_object_keys(expected_map));
    actual_count := (select count(*) from public.project_files where project_id = p_project_id);
    if expected_count <> actual_count then
      raise exception 'NORMALIZED_VERSION_CONFLICT:files:%', p_project_id using errcode = '40001';
    end if;
    for version_row in
      select folder_id || ':' || id as key, version from public.project_files where project_id = p_project_id
    loop
      if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
        raise exception 'NORMALIZED_VERSION_CONFLICT:files:%', version_row.key using errcode = '40001';
      end if;
    end loop;
  end if;

  if p_sections ? 'photos' then
    expected_map := coalesce(p_expected_versions->'photos', '{}'::jsonb);
    expected_count := (select count(*) from jsonb_object_keys(expected_map));
    actual_count := (select count(*) from public.project_photos where project_id = p_project_id);
    if expected_count <> actual_count then
      raise exception 'NORMALIZED_VERSION_CONFLICT:photos:%', p_project_id using errcode = '40001';
    end if;
    for version_row in select id as key, version from public.project_photos where project_id = p_project_id loop
      if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
        raise exception 'NORMALIZED_VERSION_CONFLICT:photos:%', version_row.key using errcode = '40001';
      end if;
    end loop;
  end if;

  if p_sections ? 'selections' then
    foreach section_name in array array['selections', 'selectionAttachments', 'selectionPhotos'] loop
      expected_map := coalesce(p_expected_versions->section_name, '{}'::jsonb);
      expected_count := (select count(*) from jsonb_object_keys(expected_map));
      if section_name = 'selections' then
        actual_count := (select count(*) from public.project_selections where project_id = p_project_id);
        if expected_count <> actual_count then
          raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, p_project_id using errcode = '40001';
        end if;
        for version_row in select id as key, version from public.project_selections where project_id = p_project_id loop
          if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
            raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, version_row.key using errcode = '40001';
          end if;
        end loop;
      elsif section_name = 'selectionAttachments' then
        actual_count := (select count(*) from public.project_selection_attachments where project_id = p_project_id);
        if expected_count <> actual_count then
          raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, p_project_id using errcode = '40001';
        end if;
        for version_row in
          select selection_id || ':' || id as key, version
          from public.project_selection_attachments where project_id = p_project_id
        loop
          if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
            raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, version_row.key using errcode = '40001';
          end if;
        end loop;
      else
        actual_count := (select count(*) from public.project_selection_photos where project_id = p_project_id);
        if expected_count <> actual_count then
          raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, p_project_id using errcode = '40001';
        end if;
        for version_row in
          select selection_id || ':' || id as key, version
          from public.project_selection_photos where project_id = p_project_id
        loop
          if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
            raise exception 'NORMALIZED_VERSION_CONFLICT:%:%', section_name, version_row.key using errcode = '40001';
          end if;
        end loop;
      end if;
    end loop;
  end if;

  next_data := project_data;
  if p_sections ? 'phases' then
    next_data := jsonb_set(next_data, '{phases}', coalesce(p_sections->'phases', '[]'::jsonb), true);
    perform public.sync_normalized_project_schedule(p_project_id, next_data);
  end if;
  if p_sections ? 'files' then
    next_data := jsonb_set(next_data, '{files}', coalesce(p_sections->'files', '{"folders":[]}'::jsonb), true);
  end if;
  if p_sections ? 'photos' then
    next_data := jsonb_set(next_data, '{photos}', coalesce(p_sections->'photos', '[]'::jsonb), true);
  end if;
  if p_sections ?| array['files', 'photos'] then
    perform public.sync_normalized_project_assets(p_project_id, next_data);
  end if;
  if p_sections ? 'selections' then
    next_data := jsonb_set(next_data, '{selections}', coalesce(p_sections->'selections', '[]'::jsonb), true);
    perform public.sync_normalized_project_selections(p_project_id, next_data);
  end if;

  update public.projects
  set data = next_data
  where id = p_project_id
  returning version into next_version;

  return jsonb_build_object(
    'version', next_version,
    'normalizedVersions', public.get_normalized_project_versions(p_project_id)
  );
end;
$$;

revoke all on function public.save_normalized_project_sections(text, jsonb, jsonb) from public, anon;
grant execute on function public.save_normalized_project_sections(text, jsonb, jsonb) to authenticated;
