create table public.project_time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  task_id text,
  user_id uuid not null default auth.uid(),
  user_email text not null default '',
  description text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_time_entries_valid_range check (ended_at is null or ended_at > started_at),
  constraint project_time_entries_description_length check (length(description) <= 1000)
);

create index project_time_entries_project_started_idx
  on public.project_time_entries (project_id, started_at desc);
create unique index project_time_entries_one_running_per_project_user_idx
  on public.project_time_entries (project_id, user_id) where ended_at is null;

create or replace function public.set_project_time_entry_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id or new.user_email is distinct from old.user_email then
    raise exception 'Time entry ownership and project cannot be changed.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_project_time_entry_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.user_email := coalesce(auth.jwt()->>'email', '');
  return new;
end;
$$;

create trigger project_time_entries_owner
before insert on public.project_time_entries
for each row execute function public.set_project_time_entry_owner();

create trigger project_time_entries_updated_at
before update on public.project_time_entries
for each row execute function public.set_project_time_entry_updated_at();

alter table public.project_time_entries enable row level security;

create policy "Project staff can read time entries"
on public.project_time_entries for select to authenticated
using (
  public.app_user_can_view_project(project_id)
  and public.current_app_user_role() in ('Admin', 'Edit')
);

create policy "Project staff can create own time entries"
on public.project_time_entries for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.app_user_can_edit_project(project_id)
);

create policy "Owners and admins can update time entries"
on public.project_time_entries for update to authenticated
using (
  public.app_user_can_edit_project(project_id)
  and (user_id = (select auth.uid()) or public.current_app_user_role() = 'Admin')
)
with check (
  public.app_user_can_edit_project(project_id)
  and (user_id = (select auth.uid()) or public.current_app_user_role() = 'Admin')
);

create policy "Owners and admins can delete time entries"
on public.project_time_entries for delete to authenticated
using (
  public.app_user_can_edit_project(project_id)
  and (user_id = (select auth.uid()) or public.current_app_user_role() = 'Admin')
);

revoke all on public.project_time_entries from anon, authenticated;
grant select, insert, update, delete on public.project_time_entries to authenticated;
