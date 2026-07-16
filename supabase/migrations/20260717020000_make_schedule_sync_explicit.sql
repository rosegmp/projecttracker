drop trigger if exists projects_normalized_schedule_insert_trigger on public.projects;
drop trigger if exists projects_normalized_schedule_update_trigger on public.projects;

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

    if table_name = 'projects' and not delete_record and record_data ? 'phases' then
      perform public.sync_normalized_project_schedule(record_id, record_data);
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
