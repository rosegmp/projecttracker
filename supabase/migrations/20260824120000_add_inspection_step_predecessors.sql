create table if not exists public.project_step_inspection_dependencies (
  project_id text not null,
  phase_id text not null,
  step_id text not null,
  predecessor_inspection_id text not null,
  position integer not null default 0,
  lag integer not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, step_id, predecessor_inspection_id),
  foreign key (project_id, phase_id, step_id)
    references public.project_steps(project_id, phase_id, id) on delete cascade,
  foreign key (project_id, predecessor_inspection_id)
    references public.project_inspections(project_id, id) on delete cascade
);

create index if not exists project_step_inspection_dependencies_predecessor_idx
  on public.project_step_inspection_dependencies (project_id, predecessor_inspection_id);

alter table public.project_step_inspection_dependencies enable row level security;
drop policy if exists "App users can read step inspection dependencies" on public.project_step_inspection_dependencies;
create policy "App users can read step inspection dependencies"
  on public.project_step_inspection_dependencies for select to authenticated
  using (public.app_user_can_view_project(project_id));

revoke all on public.project_step_inspection_dependencies from public, anon, authenticated;
grant select on public.project_step_inspection_dependencies to authenticated;

drop trigger if exists enforce_application_write_freeze on public.project_step_inspection_dependencies;
create trigger enforce_application_write_freeze
before insert or update or delete on public.project_step_inspection_dependencies
for each statement execute function private.enforce_application_write_freeze();

create or replace function public.sync_step_dependencies(
  p_project_id text, p_phase_id text, p_step_id text, p_step_data jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  predecessors jsonb := case
    when jsonb_typeof(p_step_data->'predecessors') = 'array' then p_step_data->'predecessors'
    when jsonb_typeof(p_step_data->'predecessors') in ('string', 'object') then jsonb_build_array(p_step_data->'predecessors')
    else '[]'::jsonb
  end;
begin
  delete from public.project_step_dependencies existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id and existing.step_id = p_step_id
    and not exists (
      select 1 from jsonb_array_elements(predecessors) source(item)
      where coalesce(item->>'type', 'step') <> 'inspection'
        and coalesce(case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end, '') = existing.predecessor_step_id
    );

  insert into public.project_step_dependencies (project_id, phase_id, step_id, predecessor_step_id, position, lag)
  select p_project_id, p_phase_id, p_step_id, source.predecessor_id, min(source.position)::integer - 1, max(source.lag)
  from (
    select
      case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end as predecessor_id,
      position,
      case when jsonb_typeof(item) = 'object' then coalesce((item->>'lag')::integer, 0) else 0 end as lag
    from jsonb_array_elements(predecessors) with ordinality source(item, position)
    where jsonb_typeof(item) = 'string' or coalesce(item->>'type', 'step') <> 'inspection'
  ) source
  join public.project_steps predecessor
    on predecessor.project_id = p_project_id and predecessor.phase_id = p_phase_id and predecessor.id = source.predecessor_id
  where coalesce(source.predecessor_id, '') <> '' and source.predecessor_id <> p_step_id
  group by source.predecessor_id
  on conflict (project_id, phase_id, step_id, predecessor_step_id) do update set
    position = excluded.position,
    lag = excluded.lag,
    version = case when public.project_step_dependencies.position is distinct from excluded.position
      or public.project_step_dependencies.lag is distinct from excluded.lag
      then public.project_step_dependencies.version + 1 else public.project_step_dependencies.version end,
    updated_at = case when public.project_step_dependencies.position is distinct from excluded.position
      or public.project_step_dependencies.lag is distinct from excluded.lag
      then now() else public.project_step_dependencies.updated_at end;

  delete from public.project_step_inspection_dependencies existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id and existing.step_id = p_step_id
    and not exists (
      select 1 from jsonb_array_elements(predecessors) source(item)
      where jsonb_typeof(item) = 'object' and item->>'type' = 'inspection'
        and coalesce(item->>'id', '') = existing.predecessor_inspection_id
    );

  insert into public.project_step_inspection_dependencies (
    project_id, phase_id, step_id, predecessor_inspection_id, position, lag
  )
  select p_project_id, p_phase_id, p_step_id, source.predecessor_id, min(source.position)::integer - 1, max(source.lag)
  from (
    select item->>'id' as predecessor_id, position, coalesce((item->>'lag')::integer, 0) as lag
    from jsonb_array_elements(predecessors) with ordinality source(item, position)
    where jsonb_typeof(item) = 'object' and item->>'type' = 'inspection'
  ) source
  join public.project_inspections predecessor
    on predecessor.project_id = p_project_id and predecessor.id = source.predecessor_id
  where coalesce(source.predecessor_id, '') <> ''
  group by source.predecessor_id
  on conflict (project_id, phase_id, step_id, predecessor_inspection_id) do update set
    position = excluded.position,
    lag = excluded.lag,
    version = case when public.project_step_inspection_dependencies.position is distinct from excluded.position
      or public.project_step_inspection_dependencies.lag is distinct from excluded.lag
      then public.project_step_inspection_dependencies.version + 1 else public.project_step_inspection_dependencies.version end,
    updated_at = case when public.project_step_inspection_dependencies.position is distinct from excluded.position
      or public.project_step_inspection_dependencies.lag is distinct from excluded.lag
      then now() else public.project_step_inspection_dependencies.updated_at end;
end;
$$;

revoke all on function public.sync_step_dependencies(text, text, text, jsonb) from public, anon, authenticated;

do $$
declare row_data record;
begin
  for row_data in select project_id, phase_id, id, data from public.project_steps loop
    perform public.sync_step_dependencies(row_data.project_id, row_data.phase_id, row_data.id, row_data.data);
  end loop;
end;
$$;

create or replace function public.get_workspace_cache_manifest()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  actor_id text := public.current_app_user_id();
  actor_role text := public.current_app_user_role();
  source_name text;
  source_hash text;
  source_parts text[] := array[]::text[];
  source_names constant text[] := array[
    'projects', 'tasks', 'settings', 'people', 'subs', 'employees', 'app_users',
    'project_user_access', 'project_phases', 'project_steps', 'project_file_folders',
    'project_files', 'project_photos', 'project_selections', 'project_selection_attachments',
    'project_selection_photos', 'project_inspections', 'project_inspection_files',
    'task_attachments', 'task_assignments', 'project_phase_assignments',
    'project_step_assignments', 'selection_task_links', 'project_phase_dependencies',
    'project_step_dependencies', 'project_step_inspection_dependencies', 'project_schedule_delays'
  ];
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'An application user account is required.' using errcode = '42501';
  end if;
  if actor_role in ('Customer', 'Subcontractor') then
    return jsonb_build_object(
      'schemaVersion', 1,
      'mode', 'portal',
      'token', md5(public.get_project_portal_bootstrap()::text)
    );
  end if;

  foreach source_name in array source_names loop
    execute format(
      'select md5(coalesce(string_agg(to_jsonb(source_row)::text, ''|'' order by to_jsonb(source_row)::text), '''')) from public.%I source_row',
      source_name
    ) into source_hash;
    source_parts := array_append(source_parts, source_name || ':' || coalesce(source_hash, md5('')));
  end loop;

  return jsonb_build_object(
    'schemaVersion', 1,
    'mode', 'staff',
    'token', md5(array_to_string(source_parts, '|'))
  );
end;
$$;

revoke all on function public.get_workspace_cache_manifest() from public, anon;
grant execute on function public.get_workspace_cache_manifest() to authenticated;
