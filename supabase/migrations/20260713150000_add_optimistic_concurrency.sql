alter table public.projects add column if not exists version bigint not null default 1;
alter table public.tasks add column if not exists version bigint not null default 1;
alter table public.subs add column if not exists version bigint not null default 1;
alter table public.employees add column if not exists version bigint not null default 1;
alter table public.settings add column if not exists version bigint not null default 1;

create or replace function public.bump_tracker_record_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.data is distinct from old.data and new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_version_trigger on public.projects;
create trigger projects_version_trigger before update on public.projects
for each row execute function public.bump_tracker_record_version();
drop trigger if exists tasks_version_trigger on public.tasks;
create trigger tasks_version_trigger before update on public.tasks
for each row execute function public.bump_tracker_record_version();
drop trigger if exists subs_version_trigger on public.subs;
create trigger subs_version_trigger before update on public.subs
for each row execute function public.bump_tracker_record_version();
drop trigger if exists employees_version_trigger on public.employees;
create trigger employees_version_trigger before update on public.employees
for each row execute function public.bump_tracker_record_version();
drop trigger if exists settings_version_trigger on public.settings;
create trigger settings_version_trigger before update on public.settings
for each row execute function public.bump_tracker_record_version();

create or replace function public.save_tracker_record(
  p_table text,
  p_id text,
  p_data jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_table not in ('projects', 'tasks', 'subs', 'employees', 'settings') then
    raise exception 'Unsupported tracker table.' using errcode = '22023';
  end if;

  if coalesce(p_expected_version, 0) = 0 then
    execute format(
      'insert into public.%I (id, data, version) values ($1, $2, 1) on conflict (id) do nothing returning version',
      p_table
    ) into next_version using p_id, p_data;
  else
    execute format(
      'update public.%I set data = $2, version = version + 1 where id = $1 and version = $3 returning version',
      p_table
    ) into next_version using p_id, p_data, p_expected_version;
  end if;

  if next_version is null then
    raise exception 'VERSION_CONFLICT:%:%', p_table, p_id using errcode = '40001';
  end if;
  return next_version;
end;
$$;

create or replace function public.delete_tracker_record(
  p_table text,
  p_id text,
  p_expected_version bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_table not in ('projects', 'tasks', 'subs', 'employees') then
    raise exception 'Unsupported tracker table.' using errcode = '22023';
  end if;

  execute format(
    'delete from public.%I where id = $1 and version = $2',
    p_table
  ) using p_id, p_expected_version;
  get diagnostics deleted_count = row_count;

  if deleted_count = 0 then
    raise exception 'VERSION_CONFLICT:%:%', p_table, p_id using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke all on function public.save_tracker_record(text, text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.delete_tracker_record(text, text, bigint) from public, anon, authenticated;

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
  actor_app_user_id text;
  project_data jsonb;
  target_project_id text;
  results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_operations, '[]'::jsonb)) <> 'array' then
    raise exception 'Operations must be an array.' using errcode = '22023';
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
    if actor_role = 'Edit' and table_name = 'projects' then
      select data into project_data from public.projects where id = record_id;
      project_data := coalesce(operation->'data', project_data, '{}'::jsonb);
      if jsonb_array_length(coalesce(project_data->'accessUserIds', '[]'::jsonb)) > 0
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(project_data->'accessUserIds', '[]'::jsonb)) access_id
          where access_id = actor_app_user_id
        ) then
        raise exception 'You do not have access to this project.' using errcode = '42501';
      end if;
    end if;
    if actor_role = 'Edit' and table_name = 'tasks' then
      select data->>'projectId' into target_project_id from public.tasks where id = record_id;
      target_project_id := coalesce(operation->'data'->>'projectId', target_project_id, '');
      if target_project_id <> '' then
        select data into project_data from public.projects where id = target_project_id;
        if jsonb_array_length(coalesce(project_data->'accessUserIds', '[]'::jsonb)) > 0
          and not exists (
            select 1 from jsonb_array_elements_text(coalesce(project_data->'accessUserIds', '[]'::jsonb)) access_id
            where access_id = actor_app_user_id
          ) then
          raise exception 'You do not have access to this project.' using errcode = '42501';
        end if;
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
