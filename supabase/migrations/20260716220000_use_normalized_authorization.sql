create or replace function public.current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select app_user.id
  from public.app_users app_user
  where auth.uid() is not null
    and lower(coalesce(app_user.data->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    and coalesce(app_user.data->>'email', '') <> ''
  order by app_user.position, app_user.id
  limit 1
$$;

create or replace function public.current_app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select app_user.data->>'role'
  from public.app_users app_user
  where app_user.id = public.current_app_user_id()
  limit 1
$$;

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.current_app_user_id() is not null
$$;

create or replace function public.app_user_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_user_role() in ('Admin', 'Edit')
$$;

revoke all on function public.current_app_user_id() from public, anon;
revoke all on function public.current_app_user_role() from public, anon;
revoke all on function public.is_app_user() from public, anon;
revoke all on function public.app_user_can_edit() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.current_app_user_role() to authenticated;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.app_user_can_edit() to authenticated;

drop policy if exists "Authenticated users can read audit events" on public.audit_events;
create policy "Authenticated users can read audit events" on public.audit_events
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project phases" on public.project_phases;
create policy "App users can read project phases" on public.project_phases
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project steps" on public.project_steps;
create policy "App users can read project steps" on public.project_steps
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project file folders" on public.project_file_folders;
create policy "App users can read project file folders" on public.project_file_folders
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project files" on public.project_files;
create policy "App users can read project files" on public.project_files
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project photos" on public.project_photos;
create policy "App users can read project photos" on public.project_photos
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project selections" on public.project_selections;
create policy "App users can read project selections" on public.project_selections
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read selection attachments" on public.project_selection_attachments;
create policy "App users can read selection attachments" on public.project_selection_attachments
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read selection photos" on public.project_selection_photos;
create policy "App users can read selection photos" on public.project_selection_photos
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project inspections" on public.project_inspections;
create policy "App users can read project inspections" on public.project_inspections
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read inspection files" on public.project_inspection_files;
create policy "App users can read inspection files" on public.project_inspection_files
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read task attachments" on public.task_attachments;
create policy "App users can read task attachments" on public.task_attachments
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read task assignments" on public.task_assignments;
create policy "App users can read task assignments" on public.task_assignments
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read phase assignments" on public.project_phase_assignments;
create policy "App users can read phase assignments" on public.project_phase_assignments
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read step assignments" on public.project_step_assignments;
create policy "App users can read step assignments" on public.project_step_assignments
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read project access" on public.project_user_access;
create policy "App users can read project access" on public.project_user_access
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read selection task links" on public.selection_task_links;
create policy "App users can read selection task links" on public.selection_task_links
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read phase dependencies" on public.project_phase_dependencies;
create policy "App users can read phase dependencies" on public.project_phase_dependencies
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read step dependencies" on public.project_step_dependencies;
create policy "App users can read step dependencies" on public.project_step_dependencies
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read schedule delays" on public.project_schedule_delays;
create policy "App users can read schedule delays" on public.project_schedule_delays
  for select to authenticated using (public.is_app_user());

drop policy if exists "App users can read people" on public.people;
create policy "App users can read people" on public.people
  for select to authenticated using (public.is_app_user());

drop policy if exists "Authenticated users can read app users" on public.app_users;
create policy "Authenticated users can read app users" on public.app_users
  for select to authenticated using (public.is_app_user());
