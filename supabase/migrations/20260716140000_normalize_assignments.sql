create table if not exists public.task_assignments (
  task_id text not null references public.tasks(id) on delete cascade,
  assignee text not null,
  position integer not null default 0,
  person_key text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, assignee)
);

create table if not exists public.project_phase_assignments (
  project_id text not null,
  phase_id text not null,
  assignee text not null,
  position integer not null default 0,
  person_key text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, assignee),
  foreign key (project_id, phase_id)
    references public.project_phases(project_id, id) on delete cascade
);

create table if not exists public.project_step_assignments (
  project_id text not null,
  phase_id text not null,
  step_id text not null,
  assignee text not null,
  position integer not null default 0,
  person_key text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, step_id, assignee),
  foreign key (project_id, phase_id, step_id)
    references public.project_steps(project_id, phase_id, id) on delete cascade
);

create index if not exists task_assignments_person_idx on public.task_assignments (person_key);
create index if not exists project_phase_assignments_person_idx on public.project_phase_assignments (person_key);
create index if not exists project_step_assignments_person_idx on public.project_step_assignments (person_key);

alter table public.task_assignments enable row level security;
alter table public.project_phase_assignments enable row level security;
alter table public.project_step_assignments enable row level security;

drop policy if exists "App users can read task assignments" on public.task_assignments;
create policy "App users can read task assignments" on public.task_assignments
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "App users can read phase assignments" on public.project_phase_assignments;
create policy "App users can read phase assignments" on public.project_phase_assignments
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "App users can read step assignments" on public.project_step_assignments;
create policy "App users can read step assignments" on public.project_step_assignments
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.task_assignments from anon, authenticated;
revoke insert, update, delete on public.project_phase_assignments from anon, authenticated;
revoke insert, update, delete on public.project_step_assignments from anon, authenticated;
grant select on public.task_assignments to authenticated;
grant select on public.project_phase_assignments to authenticated;
grant select on public.project_step_assignments to authenticated;

create or replace function public.resolve_assignee_person_key(p_label text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with people as (
    select
      'sub:' || id as person_key,
      case
        when trim(concat_ws(' ', data->>'first', data->>'last')) <> '' and coalesce(data->>'company', '') <> ''
          then trim(concat_ws(' ', data->>'first', data->>'last')) || ' (' || (data->>'company') || ')'
        else coalesce(nullif(trim(concat_ws(' ', data->>'first', data->>'last')), ''), data->>'company', '')
      end as label
    from public.subs
    union all
    select
      coalesce(nullif(data->>'peopleType', ''), 'emp') || ':' || id as person_key,
      case
        when trim(concat_ws(' ', data->>'first', data->>'last')) <> '' and coalesce(data->>'company', '') <> ''
          then trim(concat_ws(' ', data->>'first', data->>'last')) || ' (' || (data->>'company') || ')'
        else coalesce(nullif(trim(concat_ws(' ', data->>'first', data->>'last')), ''), data->>'company', '')
      end as label
    from public.employees
  )
  select person_key from people where label = p_label order by person_key limit 1;
$$;

revoke all on function public.resolve_assignee_person_key(text) from public, anon, authenticated;

create or replace function public.sync_task_assignments(p_task_id text, p_task_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  values_json jsonb := case
    when jsonb_typeof(p_task_data->'assignees') = 'array' then p_task_data->'assignees'
    when coalesce(p_task_data->>'assignee', '') <> '' then jsonb_build_array(p_task_data->>'assignee')
    else '[]'::jsonb
  end;
begin
  delete from public.task_assignments existing
  where existing.task_id = p_task_id
    and not exists (
      select 1 from jsonb_array_elements_text(values_json) value where trim(value) = existing.assignee
    );
  insert into public.task_assignments (task_id, assignee, position, person_key)
  select p_task_id, trim(value), min(position)::integer - 1, public.resolve_assignee_person_key(trim(value))
  from jsonb_array_elements_text(values_json) with ordinality source(value, position)
  where trim(value) <> '' group by trim(value)
  on conflict (task_id, assignee) do update set
    position = excluded.position,
    person_key = excluded.person_key,
    version = case when public.task_assignments.position is distinct from excluded.position
      or public.task_assignments.person_key is distinct from excluded.person_key
      then public.task_assignments.version + 1 else public.task_assignments.version end,
    updated_at = case when public.task_assignments.position is distinct from excluded.position
      or public.task_assignments.person_key is distinct from excluded.person_key
      then now() else public.task_assignments.updated_at end;
end;
$$;

create or replace function public.sync_phase_assignments(p_project_id text, p_phase_id text, p_phase_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  values_json jsonb := case
    when jsonb_typeof(p_phase_data->'assignees') = 'array' then p_phase_data->'assignees'
    when coalesce(p_phase_data->>'assign', '') <> '' then jsonb_build_array(p_phase_data->>'assign')
    else '[]'::jsonb
  end;
begin
  delete from public.project_phase_assignments existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id
    and not exists (
      select 1 from jsonb_array_elements_text(values_json) value where trim(value) = existing.assignee
    );
  insert into public.project_phase_assignments (project_id, phase_id, assignee, position, person_key)
  select p_project_id, p_phase_id, trim(value), min(position)::integer - 1, public.resolve_assignee_person_key(trim(value))
  from jsonb_array_elements_text(values_json) with ordinality source(value, position)
  where trim(value) <> '' group by trim(value)
  on conflict (project_id, phase_id, assignee) do update set
    position = excluded.position,
    person_key = excluded.person_key,
    version = case when public.project_phase_assignments.position is distinct from excluded.position
      or public.project_phase_assignments.person_key is distinct from excluded.person_key
      then public.project_phase_assignments.version + 1 else public.project_phase_assignments.version end,
    updated_at = case when public.project_phase_assignments.position is distinct from excluded.position
      or public.project_phase_assignments.person_key is distinct from excluded.person_key
      then now() else public.project_phase_assignments.updated_at end;
end;
$$;

create or replace function public.sync_step_assignments(p_project_id text, p_phase_id text, p_step_id text, p_step_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  values_json jsonb := case
    when jsonb_typeof(p_step_data->'assignees') = 'array' then p_step_data->'assignees'
    when coalesce(p_step_data->>'assign', '') <> '' then jsonb_build_array(p_step_data->>'assign')
    else '[]'::jsonb
  end;
begin
  delete from public.project_step_assignments existing
  where existing.project_id = p_project_id and existing.phase_id = p_phase_id and existing.step_id = p_step_id
    and not exists (
      select 1 from jsonb_array_elements_text(values_json) value where trim(value) = existing.assignee
    );
  insert into public.project_step_assignments (project_id, phase_id, step_id, assignee, position, person_key)
  select p_project_id, p_phase_id, p_step_id, trim(value), min(position)::integer - 1, public.resolve_assignee_person_key(trim(value))
  from jsonb_array_elements_text(values_json) with ordinality source(value, position)
  where trim(value) <> '' group by trim(value)
  on conflict (project_id, phase_id, step_id, assignee) do update set
    position = excluded.position,
    person_key = excluded.person_key,
    version = case when public.project_step_assignments.position is distinct from excluded.position
      or public.project_step_assignments.person_key is distinct from excluded.person_key
      then public.project_step_assignments.version + 1 else public.project_step_assignments.version end,
    updated_at = case when public.project_step_assignments.position is distinct from excluded.position
      or public.project_step_assignments.person_key is distinct from excluded.person_key
      then now() else public.project_step_assignments.updated_at end;
end;
$$;

revoke all on function public.sync_task_assignments(text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_phase_assignments(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_step_assignments(text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.sync_task_assignments_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_task_assignments(new.id, new.data); return new; end;
$$;
create or replace function public.sync_phase_assignments_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_phase_assignments(new.project_id, new.id, new.data); return new; end;
$$;
create or replace function public.sync_step_assignments_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_step_assignments(new.project_id, new.phase_id, new.id, new.data); return new; end;
$$;

drop trigger if exists tasks_normalized_assignments_trigger on public.tasks;
create trigger tasks_normalized_assignments_trigger after insert or update of data on public.tasks
for each row execute function public.sync_task_assignments_trigger();
drop trigger if exists phases_normalized_assignments_trigger on public.project_phases;
create trigger phases_normalized_assignments_trigger after insert or update of data on public.project_phases
for each row execute function public.sync_phase_assignments_trigger();
drop trigger if exists steps_normalized_assignments_trigger on public.project_steps;
create trigger steps_normalized_assignments_trigger after insert or update of data on public.project_steps
for each row execute function public.sync_step_assignments_trigger();

do $$
declare row_data record;
begin
  for row_data in select id, data from public.tasks loop
    perform public.sync_task_assignments(row_data.id, row_data.data);
  end loop;
  for row_data in select project_id, id, data from public.project_phases loop
    perform public.sync_phase_assignments(row_data.project_id, row_data.id, row_data.data);
  end loop;
  for row_data in select project_id, phase_id, id, data from public.project_steps loop
    perform public.sync_step_assignments(row_data.project_id, row_data.phase_id, row_data.id, row_data.data);
  end loop;
end;
$$;
