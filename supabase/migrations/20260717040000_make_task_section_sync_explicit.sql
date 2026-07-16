drop trigger if exists tasks_normalized_attachments_insert_trigger on public.tasks;
drop trigger if exists tasks_normalized_attachments_update_trigger on public.tasks;
drop trigger if exists tasks_normalized_assignments_trigger on public.tasks;

create or replace function public.sync_explicit_task_sections(
  p_task_id text,
  p_task_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_task_data ? 'attachments' then
    perform public.sync_normalized_task_attachments(p_task_id, p_task_data);
  end if;
  if p_task_data ?| array['assignees', 'assignee'] then
    perform public.sync_task_assignments(p_task_id, p_task_data);
  end if;
end;
$$;

revoke all on function public.sync_explicit_task_sections(text, jsonb) from public, anon, authenticated;

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
  record_data jsonb;
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
    record_data := operation->'data';
    expected_version := coalesce((operation->>'expectedVersion')::bigint, 0);
    delete_record := coalesce((operation->>'delete')::boolean, false);
    if delete_record then
      execute format('delete from public.%I where id = $1 and version = $2', table_name)
        using record_id, expected_version;
      next_version := null;
    elsif expected_version = 0 then
      execute format('insert into public.%I (id, data, version) values ($1, $2, 1) returning version', table_name)
        into next_version using record_id, record_data;
    else
      execute format('update public.%I set data = $2, version = version + 1 where id = $1 and version = $3 returning version', table_name)
        into next_version using record_id, record_data, expected_version;
    end if;

    if table_name = 'projects' and not delete_record then
      perform public.sync_explicit_project_sections(record_id, record_data);
    elsif table_name = 'tasks' and not delete_record then
      perform public.sync_explicit_task_sections(record_id, record_data);
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

  perform public.sync_explicit_task_sections(p_task_id, p_task_data);

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
