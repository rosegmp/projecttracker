create table if not exists public.project_phases (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.project_steps (
  project_id text not null,
  phase_id text not null,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, phase_id, id),
  foreign key (project_id, phase_id)
    references public.project_phases(project_id, id)
    on delete cascade
);

create index if not exists project_phases_project_position_idx
  on public.project_phases (project_id, position, id);
create index if not exists project_steps_phase_position_idx
  on public.project_steps (project_id, phase_id, position, id);

alter table public.project_phases enable row level security;
alter table public.project_steps enable row level security;

drop policy if exists "App users can read project phases" on public.project_phases;
create policy "App users can read project phases"
  on public.project_phases for select
  to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read project steps" on public.project_steps;
create policy "App users can read project steps"
  on public.project_steps for select
  to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

revoke insert, update, delete on public.project_phases from anon, authenticated;
revoke insert, update, delete on public.project_steps from anon, authenticated;
grant select on public.project_phases to authenticated;
grant select on public.project_steps to authenticated;

create or replace function public.sync_normalized_project_schedule(
  p_project_id text,
  p_project_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  phases jsonb := case
    when jsonb_typeof(coalesce(p_project_data->'phases', '[]'::jsonb)) = 'array'
      then coalesce(p_project_data->'phases', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  delete from public.project_steps schedule_step
  where schedule_step.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(phases) phase,
        jsonb_array_elements(
          case when jsonb_typeof(coalesce(phase->'steps', '[]'::jsonb)) = 'array'
            then coalesce(phase->'steps', '[]'::jsonb)
            else '[]'::jsonb
          end
        ) step
      where nullif(phase->>'id', '') = schedule_step.phase_id
        and nullif(step->>'id', '') = schedule_step.id
    );

  delete from public.project_phases project_phase
  where project_phase.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(phases) phase
      where nullif(phase->>'id', '') = project_phase.id
    );

  insert into public.project_phases (project_id, id, position, data)
  select
    p_project_id,
    phase->>'id',
    phase_ordinality::integer - 1,
    phase - 'steps'
  from jsonb_array_elements(phases) with ordinality phase_row(phase, phase_ordinality)
  where nullif(phase->>'id', '') is not null
  on conflict (project_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_phases.position is distinct from excluded.position
        or project_phases.data is distinct from excluded.data
      then project_phases.version + 1
      else project_phases.version
    end,
    updated_at = case
      when project_phases.position is distinct from excluded.position
        or project_phases.data is distinct from excluded.data
      then now()
      else project_phases.updated_at
    end;

  insert into public.project_steps (project_id, phase_id, id, position, data)
  select
    p_project_id,
    phase->>'id',
    step->>'id',
    step_ordinality::integer - 1,
    step
  from jsonb_array_elements(phases) phase,
    jsonb_array_elements(
      case when jsonb_typeof(coalesce(phase->'steps', '[]'::jsonb)) = 'array'
        then coalesce(phase->'steps', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality step_row(step, step_ordinality)
  where nullif(phase->>'id', '') is not null
    and nullif(step->>'id', '') is not null
  on conflict (project_id, phase_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_steps.position is distinct from excluded.position
        or project_steps.data is distinct from excluded.data
      then project_steps.version + 1
      else project_steps.version
    end,
    updated_at = case
      when project_steps.position is distinct from excluded.position
        or project_steps.data is distinct from excluded.data
      then now()
      else project_steps.updated_at
    end;
end;
$$;

revoke all on function public.sync_normalized_project_schedule(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_project_schedule_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_normalized_project_schedule(new.id, new.data);
  return new;
end;
$$;

drop trigger if exists projects_normalized_schedule_insert_trigger on public.projects;
create trigger projects_normalized_schedule_insert_trigger
after insert on public.projects
for each row
execute function public.sync_normalized_project_schedule_trigger();

drop trigger if exists projects_normalized_schedule_update_trigger on public.projects;
create trigger projects_normalized_schedule_update_trigger
after update of data on public.projects
for each row
when (old.data->'phases' is distinct from new.data->'phases')
execute function public.sync_normalized_project_schedule_trigger();

do $$
declare
  project_row record;
begin
  for project_row in select id, data from public.projects loop
    perform public.sync_normalized_project_schedule(project_row.id, project_row.data);
  end loop;
end;
$$;
