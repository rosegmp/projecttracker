create table if not exists public.project_phase_dependencies (
  project_id text not null,
  phase_id text not null,
  predecessor_phase_id text not null,
  position integer not null default 0,
  lag integer not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, predecessor_phase_id),
  check (phase_id <> predecessor_phase_id),
  foreign key (project_id, phase_id) references public.project_phases(project_id, id) on delete cascade,
  foreign key (project_id, predecessor_phase_id) references public.project_phases(project_id, id) on delete cascade
);

create table if not exists public.project_step_dependencies (
  project_id text not null,
  phase_id text not null,
  step_id text not null,
  predecessor_step_id text not null,
  position integer not null default 0,
  lag integer not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, step_id, predecessor_step_id),
  check (step_id <> predecessor_step_id),
  foreign key (project_id, phase_id, step_id)
    references public.project_steps(project_id, phase_id, id) on delete cascade,
  foreign key (project_id, phase_id, predecessor_step_id)
    references public.project_steps(project_id, phase_id, id) on delete cascade
);

create table if not exists public.project_schedule_delays (
  project_id text not null,
  phase_id text not null,
  id text not null,
  step_id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, id),
  foreign key (project_id, phase_id) references public.project_phases(project_id, id) on delete cascade,
  foreign key (project_id, phase_id, step_id)
    references public.project_steps(project_id, phase_id, id) on delete cascade
);

create index if not exists project_phase_dependencies_predecessor_idx
  on public.project_phase_dependencies (project_id, predecessor_phase_id);
create index if not exists project_step_dependencies_predecessor_idx
  on public.project_step_dependencies (project_id, phase_id, predecessor_step_id);
create index if not exists project_schedule_delays_step_idx
  on public.project_schedule_delays (project_id, phase_id, step_id, position);

alter table public.project_phase_dependencies enable row level security;
alter table public.project_step_dependencies enable row level security;
alter table public.project_schedule_delays enable row level security;

drop policy if exists "App users can read phase dependencies" on public.project_phase_dependencies;
create policy "App users can read phase dependencies" on public.project_phase_dependencies
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "App users can read step dependencies" on public.project_step_dependencies;
create policy "App users can read step dependencies" on public.project_step_dependencies
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "App users can read schedule delays" on public.project_schedule_delays;
create policy "App users can read schedule delays" on public.project_schedule_delays
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.project_phase_dependencies from anon, authenticated;
revoke insert, update, delete on public.project_step_dependencies from anon, authenticated;
revoke insert, update, delete on public.project_schedule_delays from anon, authenticated;
grant select on public.project_phase_dependencies to authenticated;
grant select on public.project_step_dependencies to authenticated;
grant select on public.project_schedule_delays to authenticated;

create or replace function public.reject_phase_dependency_cycle()
returns trigger language plpgsql set search_path = public as $$
declare creates_cycle boolean;
begin
  with recursive reachable(phase_id) as (
    select new.phase_id
    union
    select dependency.phase_id
    from public.project_phase_dependencies dependency
    join reachable current on dependency.predecessor_phase_id = current.phase_id
    where dependency.project_id = new.project_id
  )
  select exists(select 1 from reachable where phase_id = new.predecessor_phase_id) into creates_cycle;
  if creates_cycle then
    raise exception 'SCHEDULE_DEPENDENCY_CYCLE:phase:%', new.phase_id using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.reject_step_dependency_cycle()
returns trigger language plpgsql set search_path = public as $$
declare creates_cycle boolean;
begin
  with recursive reachable(step_id) as (
    select new.step_id
    union
    select dependency.step_id
    from public.project_step_dependencies dependency
    join reachable current on dependency.predecessor_step_id = current.step_id
    where dependency.project_id = new.project_id and dependency.phase_id = new.phase_id
  )
  select exists(select 1 from reachable where step_id = new.predecessor_step_id) into creates_cycle;
  if creates_cycle then
    raise exception 'SCHEDULE_DEPENDENCY_CYCLE:step:%', new.step_id using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists phase_dependency_cycle_trigger on public.project_phase_dependencies;
create constraint trigger phase_dependency_cycle_trigger
after insert or update on public.project_phase_dependencies
deferrable initially immediate for each row execute function public.reject_phase_dependency_cycle();
drop trigger if exists step_dependency_cycle_trigger on public.project_step_dependencies;
create constraint trigger step_dependency_cycle_trigger
after insert or update on public.project_step_dependencies
deferrable initially immediate for each row execute function public.reject_step_dependency_cycle();

create or replace function public.sync_phase_dependencies(
  p_project_id text, p_phase_id text, p_phase_data jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  predecessors jsonb := case
    when jsonb_typeof(p_phase_data->'predecessors') = 'array' then p_phase_data->'predecessors'
    when jsonb_typeof(p_phase_data->'predecessors') in ('string', 'object') then jsonb_build_array(p_phase_data->'predecessors')
    else '[]'::jsonb
  end;
begin
  delete from public.project_phase_dependencies existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id
    and not exists (
      select 1 from jsonb_array_elements(predecessors) source(item)
      where coalesce(case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end, '') = existing.predecessor_phase_id
    );

  insert into public.project_phase_dependencies (project_id, phase_id, predecessor_phase_id, position, lag)
  select p_project_id, p_phase_id, source.predecessor_id, min(source.position)::integer - 1, max(source.lag)
  from (
    select
      case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end as predecessor_id,
      position,
      case when jsonb_typeof(item) = 'object' then coalesce((item->>'lag')::integer, 0) else 0 end as lag
    from jsonb_array_elements(predecessors) with ordinality source(item, position)
  ) source
  join public.project_phases predecessor
    on predecessor.project_id = p_project_id and predecessor.id = source.predecessor_id
  where coalesce(source.predecessor_id, '') <> '' and source.predecessor_id <> p_phase_id
  group by source.predecessor_id
  on conflict (project_id, phase_id, predecessor_phase_id) do update set
    position = excluded.position,
    lag = excluded.lag,
    version = case when public.project_phase_dependencies.position is distinct from excluded.position
      or public.project_phase_dependencies.lag is distinct from excluded.lag
      then public.project_phase_dependencies.version + 1 else public.project_phase_dependencies.version end,
    updated_at = case when public.project_phase_dependencies.position is distinct from excluded.position
      or public.project_phase_dependencies.lag is distinct from excluded.lag
      then now() else public.project_phase_dependencies.updated_at end;
end;
$$;

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
      where coalesce(case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end, '') = existing.predecessor_step_id
    );

  insert into public.project_step_dependencies (project_id, phase_id, step_id, predecessor_step_id, position, lag)
  select p_project_id, p_phase_id, p_step_id, source.predecessor_id, min(source.position)::integer - 1, max(source.lag)
  from (
    select
      case when jsonb_typeof(item) = 'string' then item #>> '{}' else item->>'id' end as predecessor_id,
      position,
      case when jsonb_typeof(item) = 'object' then coalesce((item->>'lag')::integer, 0) else 0 end as lag
    from jsonb_array_elements(predecessors) with ordinality source(item, position)
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
end;
$$;

create or replace function public.sync_phase_delays(
  p_project_id text, p_phase_id text, p_phase_data jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  delays jsonb := case when jsonb_typeof(p_phase_data->'delays') = 'array' then p_phase_data->'delays' else '[]'::jsonb end;
begin
  delete from public.project_schedule_delays existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id
    and not exists (
      select 1 from jsonb_array_elements(delays) source(item) where coalesce(item->>'id', '') = existing.id
    );

  insert into public.project_schedule_delays (project_id, phase_id, id, step_id, position, data)
  select p_project_id, p_phase_id, source.item->>'id', source.item->>'stepId', source.position::integer - 1, source.item - 'id' - 'stepId'
  from jsonb_array_elements(delays) with ordinality source(item, position)
  join public.project_steps step
    on step.project_id = p_project_id and step.phase_id = p_phase_id and step.id = source.item->>'stepId'
  where coalesce(source.item->>'id', '') <> '' and coalesce(source.item->>'stepId', '') <> ''
  on conflict (project_id, phase_id, id) do update set
    step_id = excluded.step_id,
    position = excluded.position,
    data = excluded.data,
    version = case when public.project_schedule_delays.step_id is distinct from excluded.step_id
      or public.project_schedule_delays.position is distinct from excluded.position
      or public.project_schedule_delays.data is distinct from excluded.data
      then public.project_schedule_delays.version + 1 else public.project_schedule_delays.version end,
    updated_at = case when public.project_schedule_delays.step_id is distinct from excluded.step_id
      or public.project_schedule_delays.position is distinct from excluded.position
      or public.project_schedule_delays.data is distinct from excluded.data
      then now() else public.project_schedule_delays.updated_at end;
end;
$$;

revoke all on function public.sync_phase_dependencies(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_step_dependencies(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_phase_delays(text, text, jsonb) from public, anon, authenticated;

create or replace function public.sync_phase_schedule_relationships_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_phase_dependencies(new.project_id, new.id, new.data);
  perform public.sync_phase_delays(new.project_id, new.id, new.data);
  return new;
end;
$$;
create or replace function public.sync_step_schedule_relationships_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_step_dependencies(new.project_id, new.phase_id, new.id, new.data); return new; end;
$$;

drop trigger if exists phases_normalized_schedule_relationships_trigger on public.project_phases;
create trigger phases_normalized_schedule_relationships_trigger
after insert or update of data on public.project_phases
for each row execute function public.sync_phase_schedule_relationships_trigger();
drop trigger if exists steps_normalized_schedule_relationships_trigger on public.project_steps;
create trigger steps_normalized_schedule_relationships_trigger
after insert or update of data on public.project_steps
for each row execute function public.sync_step_schedule_relationships_trigger();

do $$
declare row_data record;
begin
  for row_data in select project_id, id, data from public.project_phases loop
    perform public.sync_phase_dependencies(row_data.project_id, row_data.id, row_data.data);
    perform public.sync_phase_delays(row_data.project_id, row_data.id, row_data.data);
  end loop;
  for row_data in select project_id, phase_id, id, data from public.project_steps loop
    perform public.sync_step_dependencies(row_data.project_id, row_data.phase_id, row_data.id, row_data.data);
  end loop;
end;
$$;
