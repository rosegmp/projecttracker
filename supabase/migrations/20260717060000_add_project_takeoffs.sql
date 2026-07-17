create table if not exists public.project_takeoffs (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  pdf_name text not null,
  storage_bucket text not null default 'takeoff-files',
  storage_path text not null,
  snapshot jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_takeoffs_project_updated_idx
  on public.project_takeoffs (project_id, updated_at desc);

create or replace function public.set_project_takeoff_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists project_takeoffs_metadata_trigger on public.project_takeoffs;
create trigger project_takeoffs_metadata_trigger
before insert or update on public.project_takeoffs
for each row execute function public.set_project_takeoff_metadata();

alter table public.project_takeoffs enable row level security;

drop policy if exists "Project users can read takeoffs" on public.project_takeoffs;
create policy "Project users can read takeoffs" on public.project_takeoffs
  for select to authenticated
  using (public.app_user_can_view_project(project_id));

drop policy if exists "Project editors can create takeoffs" on public.project_takeoffs;
create policy "Project editors can create takeoffs" on public.project_takeoffs
  for insert to authenticated
  with check (public.app_user_can_edit_project(project_id));

drop policy if exists "Project editors can update takeoffs" on public.project_takeoffs;
create policy "Project editors can update takeoffs" on public.project_takeoffs
  for update to authenticated
  using (public.app_user_can_edit_project(project_id))
  with check (public.app_user_can_edit_project(project_id));

drop policy if exists "Project editors can delete takeoffs" on public.project_takeoffs;
create policy "Project editors can delete takeoffs" on public.project_takeoffs
  for delete to authenticated
  using (public.app_user_can_edit_project(project_id));

revoke all on public.project_takeoffs from anon;
grant select, insert, update, delete on public.project_takeoffs to authenticated;

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events
  add constraint audit_events_entity_type_check
  check (entity_type in ('project', 'task', 'takeoff'));

create or replace function public.record_takeoff_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.snapshot is not distinct from new.snapshot and old.name is not distinct from new.name then
    return new;
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_email,
    entity_type,
    entity_id,
    project_id,
    action,
    before_data,
    after_data
  ) values (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'takeoff',
    coalesce(new.id, old.id),
    coalesce(new.project_id, old.project_id),
    lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('name', old.name, 'snapshot', old.snapshot, 'version', old.version) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('name', new.name, 'snapshot', new.snapshot, 'version', new.version) end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists project_takeoffs_audit_trigger on public.project_takeoffs;
create trigger project_takeoffs_audit_trigger
after insert or update or delete on public.project_takeoffs
for each row execute function public.record_takeoff_audit_event();

insert into storage.buckets (id, name, public)
values ('takeoff-files', 'takeoff-files', false)
on conflict (id) do update set public = false;

drop policy if exists "Project users can read takeoff files" on storage.objects;
create policy "Project users can read takeoff files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'takeoff-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_view_project((storage.foldername(name))[2])
  );

drop policy if exists "Project editors can create takeoff files" on storage.objects;
create policy "Project editors can create takeoff files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'takeoff-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_edit_project((storage.foldername(name))[2])
  );

drop policy if exists "Project editors can update takeoff files" on storage.objects;
create policy "Project editors can update takeoff files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'takeoff-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_edit_project((storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'takeoff-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_edit_project((storage.foldername(name))[2])
  );

drop policy if exists "Project editors can delete takeoff files" on storage.objects;
create policy "Project editors can delete takeoff files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'takeoff-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_edit_project((storage.foldername(name))[2])
  );
