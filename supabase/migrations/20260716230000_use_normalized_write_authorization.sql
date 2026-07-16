create or replace function public.app_user_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_user_role() in ('Admin', 'Edit'), false)
$$;

revoke all on function public.app_user_can_edit() from public, anon;
grant execute on function public.app_user_can_edit() to authenticated;

create or replace function public.app_user_can_edit_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_user_role() = 'Admin' then true
    when coalesce(public.current_app_user_role(), '') <> 'Edit' then false
    when coalesce(p_project_id, '') = '' then true
    when not exists (
      select 1 from public.project_user_access access_row
      where access_row.project_id = p_project_id
    ) then true
    else exists (
      select 1 from public.project_user_access access_row
      where access_row.project_id = p_project_id
        and access_row.user_id = public.current_app_user_id()
    )
  end
$$;

revoke all on function public.app_user_can_edit_project(text) from public, anon;
grant execute on function public.app_user_can_edit_project(text) to authenticated;

create or replace function public.apply_tracker_batch(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation jsonb;
  table_name text;
  record_id text;
  expected_version bigint;
  current_version bigint;
  next_version bigint;
  delete_record boolean;
  actor_role text;
  target_project_id text;
  results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_operations, '[]'::jsonb)) <> 'array' then
    raise exception 'Operations must be an array.' using errcode = '22023';
  end if;

  actor_role := public.current_app_user_role();
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;

  for operation in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    table_name := operation->>'table';
    record_id := operation->>'id';
    expected_version := coalesce((operation->>'expectedVersion')::bigint, 0);
    delete_record := coalesce((operation->>'delete')::boolean, false);
    if table_name not in ('projects', 'tasks', 'subs', 'employees', 'settings') then
      raise exception 'Unsupported tracker table.' using errcode = '22023';
    end if;
    if delete_record and table_name = 'settings' then
      raise exception 'Settings cannot be deleted.' using errcode = '22023';
    end if;
    if table_name = 'settings' and actor_role <> 'Admin' then
      raise exception 'Only administrators can edit settings.' using errcode = '42501';
    end if;
    if actor_role = 'Edit' and table_name = 'projects'
      and not public.app_user_can_edit_project(record_id) then
      raise exception 'You do not have access to this project.' using errcode = '42501';
    end if;
    if actor_role = 'Edit' and table_name = 'tasks' then
      select data->>'projectId' into target_project_id from public.tasks where id = record_id;
      target_project_id := coalesce(operation->'data'->>'projectId', target_project_id, '');
      if not public.app_user_can_edit_project(target_project_id) then
        raise exception 'You do not have access to this project.' using errcode = '42501';
      end if;
    end if;

    execute format('select version from public.%I where id = $1', table_name)
      into current_version using record_id;
    if expected_version = 0 then
      if current_version is not null then
        raise exception 'VERSION_CONFLICT:%:%', table_name, record_id using errcode = '40001';
      end if;
    elsif current_version is distinct from expected_version then
      raise exception 'VERSION_CONFLICT:%:%', table_name, record_id using errcode = '40001';
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    table_name := operation->>'table';
    record_id := operation->>'id';
    expected_version := coalesce((operation->>'expectedVersion')::bigint, 0);
    delete_record := coalesce((operation->>'delete')::boolean, false);
    if delete_record then
      execute format('delete from public.%I where id = $1 and version = $2', table_name)
        using record_id, expected_version;
      next_version := null;
    elsif expected_version = 0 then
      execute format('insert into public.%I (id, data, version) values ($1, $2, 1) returning version', table_name)
        into next_version using record_id, operation->'data';
    else
      execute format('update public.%I set data = $2, version = version + 1 where id = $1 and version = $3 returning version', table_name)
        into next_version using record_id, operation->'data', expected_version;
    end if;
    results := results || jsonb_build_array(jsonb_build_object(
      'table', table_name,
      'id', record_id,
      'version', next_version,
      'deleted', delete_record
    ));
  end loop;
  return results;
end;
$$;

revoke all on function public.apply_tracker_batch(jsonb) from public, anon;
grant execute on function public.apply_tracker_batch(jsonb) to authenticated;

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
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;

  select data into project_data
  from public.projects
  where id = p_project_id
  for update;
  if project_data is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
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

create or replace function public.save_normalized_project_inspections(
  p_project_id text,
  p_inspections jsonb,
  p_expected_versions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_data jsonb;
  next_data jsonb;
  next_version bigint;
  version_row record;
  expected_map jsonb;
  expected_count integer;
  actual_count integer;
  inspection_versions jsonb;
  inspection_file_versions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_inspections, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_expected_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Inspections and versions have invalid shapes.' using errcode = '22023';
  end if;
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;

  select data into project_data
  from public.projects
  where id = p_project_id
  for update;
  if project_data is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
    raise exception 'You do not have access to this project.' using errcode = '42501';
  end if;

  expected_map := coalesce(p_expected_versions->'inspections', '{}'::jsonb);
  expected_count := (select count(*) from jsonb_object_keys(expected_map));
  actual_count := (select count(*) from public.project_inspections where project_id = p_project_id);
  if expected_count <> actual_count then
    raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', p_project_id using errcode = '40001';
  end if;
  for version_row in select id as key, version from public.project_inspections where project_id = p_project_id loop
    if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', version_row.key using errcode = '40001';
    end if;
  end loop;

  expected_map := coalesce(p_expected_versions->'inspectionFiles', '{}'::jsonb);
  expected_count := (select count(*) from jsonb_object_keys(expected_map));
  actual_count := (select count(*) from public.project_inspection_files where project_id = p_project_id);
  if expected_count <> actual_count then
    raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%', p_project_id using errcode = '40001';
  end if;
  for version_row in
    select inspection_id || ':' || kind as key, version
    from public.project_inspection_files where project_id = p_project_id
  loop
    if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%', version_row.key using errcode = '40001';
    end if;
  end loop;

  next_data := jsonb_set(project_data, '{inspections}', p_inspections, true);
  perform public.sync_normalized_project_inspections(p_project_id, next_data);
  update public.projects set data = next_data where id = p_project_id returning version into next_version;

  select coalesce(jsonb_object_agg(id, version), '{}'::jsonb)
    into inspection_versions
    from public.project_inspections where project_id = p_project_id;
  select coalesce(jsonb_object_agg(inspection_id || ':' || kind, version), '{}'::jsonb)
    into inspection_file_versions
    from public.project_inspection_files where project_id = p_project_id;

  return jsonb_build_object(
    'version', next_version,
    'normalizedVersions', jsonb_build_object(
      'inspections', inspection_versions,
      'inspectionFiles', inspection_file_versions
    )
  );
end;
$$;

revoke all on function public.save_normalized_project_inspections(text, jsonb, jsonb) from public, anon;
grant execute on function public.save_normalized_project_inspections(text, jsonb, jsonb) to authenticated;

create or replace function public.save_task_with_attachments(
  p_task_id text,
  p_task_data jsonb,
  p_expected_version bigint,
  p_expected_attachment_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project_id text;
  current_version bigint;
  next_version bigint;
  expected_count integer;
  current_count integer;
  attachment_versions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if coalesce(p_task_id, '') = '' or jsonb_typeof(coalesce(p_task_data, '{}'::jsonb)) <> 'object' then
    raise exception 'Task id and data are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_expected_attachment_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Expected attachment versions must be an object.' using errcode = '22023';
  end if;
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit tasks.' using errcode = '42501';
  end if;

  target_project_id := coalesce(p_task_data->>'projectId', '');
  if not public.app_user_can_edit_project(target_project_id) then
    raise exception 'You do not have access to this project.' using errcode = '42501';
  end if;

  select version into current_version
  from public.tasks
  where id = p_task_id
  for update;

  if coalesce(p_expected_version, 0) = 0 then
    if current_version is not null then
      raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
    end if;
  elsif current_version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
  end if;

  select count(*) into expected_count from jsonb_object_keys(coalesce(p_expected_attachment_versions, '{}'::jsonb));
  select count(*) into current_count from public.task_attachments where task_id = p_task_id;
  if expected_count <> current_count or exists (
    select 1
    from public.task_attachments attachment
    where attachment.task_id = p_task_id
      and coalesce((p_expected_attachment_versions->>attachment.id)::bigint, -1) <> attachment.version
  ) then
    raise exception 'NORMALIZED_VERSION_CONFLICT:task_attachments:%', p_task_id using errcode = '40001';
  end if;

  if coalesce(p_expected_version, 0) = 0 then
    insert into public.tasks (id, data, version)
    values (p_task_id, p_task_data, 1)
    returning version into next_version;
  else
    update public.tasks
    set data = p_task_data, version = version + 1
    where id = p_task_id and version = p_expected_version
    returning version into next_version;
  end if;

  if next_version is null then
    raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
  end if;

  select coalesce(jsonb_object_agg(id, version), '{}'::jsonb)
    into attachment_versions
    from public.task_attachments
    where task_id = p_task_id;

  return jsonb_build_object(
    'version', next_version,
    'normalizedVersions', jsonb_build_object('attachments', coalesce(attachment_versions, '{}'::jsonb))
  );
end;
$$;

revoke all on function public.save_task_with_attachments(text, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.save_task_with_attachments(text, jsonb, bigint, jsonb) to authenticated;
