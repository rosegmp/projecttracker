create table if not exists public.people (
  id text primary key,
  source_table text not null check (source_table in ('subs', 'employees')),
  legacy_id text not null,
  people_type text not null check (people_type in ('sub', 'emp', 'supplier', 'consultant', 'customer')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, legacy_id)
);

create index if not exists people_type_name_idx
  on public.people (people_type, lower(coalesce(data->>'company', '')), lower(coalesce(data->>'last', '')));

alter table public.people enable row level security;
drop policy if exists "App users can read people" on public.people;
create policy "App users can read people" on public.people
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.people from anon, authenticated;
grant select on public.people to authenticated;

create or replace function public.sync_unified_person(
  p_source_table text,
  p_legacy_id text,
  p_data jsonb,
  p_version bigint
)
returns void language plpgsql security definer set search_path = public as $$
declare
  stable_id text;
  resolved_type text;
begin
  if p_source_table not in ('subs', 'employees') then
    raise exception 'Unsupported People source table.' using errcode = '22023';
  end if;
  stable_id := case when p_source_table = 'subs' then 'sub:' else 'employee:' end || p_legacy_id;
  resolved_type := case
    when p_source_table = 'subs' then 'sub'
    when coalesce(p_data->>'peopleType', '') in ('emp', 'supplier', 'consultant', 'customer') then p_data->>'peopleType'
    else 'emp'
  end;

  insert into public.people (id, source_table, legacy_id, people_type, data, version)
  values (stable_id, p_source_table, p_legacy_id, resolved_type, p_data, greatest(coalesce(p_version, 1), 1))
  on conflict (source_table, legacy_id) do update set
    id = excluded.id,
    people_type = excluded.people_type,
    data = excluded.data,
    version = excluded.version,
    updated_at = now();
end;
$$;

revoke all on function public.sync_unified_person(text, text, jsonb, bigint) from public, anon, authenticated;

create or replace function public.sync_unified_sub_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_unified_person('subs', new.id, new.data, new.version); return new; end;
$$;
create or replace function public.sync_unified_employee_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_unified_person('employees', new.id, new.data, new.version); return new; end;
$$;
create or replace function public.delete_unified_person_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin delete from public.people where source_table = tg_table_name and legacy_id = old.id; return old; end;
$$;

drop trigger if exists subs_unified_people_trigger on public.subs;
create trigger subs_unified_people_trigger after insert or update of data, version on public.subs
for each row execute function public.sync_unified_sub_trigger();
drop trigger if exists employees_unified_people_trigger on public.employees;
create trigger employees_unified_people_trigger after insert or update of data, version on public.employees
for each row execute function public.sync_unified_employee_trigger();
drop trigger if exists subs_delete_unified_people_trigger on public.subs;
create trigger subs_delete_unified_people_trigger after delete on public.subs
for each row execute function public.delete_unified_person_trigger();
drop trigger if exists employees_delete_unified_people_trigger on public.employees;
create trigger employees_delete_unified_people_trigger after delete on public.employees
for each row execute function public.delete_unified_person_trigger();

do $$
declare person_row record;
begin
  for person_row in select id, data, version from public.subs loop
    perform public.sync_unified_person('subs', person_row.id, person_row.data, person_row.version);
  end loop;
  for person_row in select id, data, version from public.employees loop
    perform public.sync_unified_person('employees', person_row.id, person_row.data, person_row.version);
  end loop;
end;
$$;

create or replace function public.resolve_assignee_person_key(p_label text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.people
  where case
    when trim(concat_ws(' ', data->>'first', data->>'last')) <> '' and coalesce(data->>'company', '') <> ''
      then trim(concat_ws(' ', data->>'first', data->>'last')) || ' (' || (data->>'company') || ')'
    else coalesce(nullif(trim(concat_ws(' ', data->>'first', data->>'last')), ''), data->>'company', '')
  end = p_label
  order by id
  limit 1;
$$;

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

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_assignments_person_fk') then
    alter table public.task_assignments
      add constraint task_assignments_person_fk foreign key (person_key) references public.people(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase_assignments_person_fk') then
    alter table public.project_phase_assignments
      add constraint phase_assignments_person_fk foreign key (person_key) references public.people(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'step_assignments_person_fk') then
    alter table public.project_step_assignments
      add constraint step_assignments_person_fk foreign key (person_key) references public.people(id) on delete set null;
  end if;
end;
$$;
