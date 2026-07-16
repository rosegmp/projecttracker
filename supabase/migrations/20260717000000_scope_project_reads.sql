create or replace function public.app_user_can_view_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_user_role() = 'Admin' then true
    when not public.is_app_user() then false
    when exists (
      select 1 from public.project_user_access access_row
      where access_row.project_id = p_project_id
    ) then exists (
      select 1 from public.project_user_access access_row
      where access_row.project_id = p_project_id
        and access_row.user_id = public.current_app_user_id()
    )
    else public.current_app_user_role() = 'Edit'
  end
$$;

create or replace function public.app_user_can_view_task(p_task_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when coalesce(task_row.data->>'projectId', '') = '' then public.is_app_user()
      else public.app_user_can_view_project(task_row.data->>'projectId')
    end
    from public.tasks task_row
    where task_row.id = p_task_id
  ), false)
$$;

revoke all on function public.app_user_can_view_project(text) from public, anon;
revoke all on function public.app_user_can_view_task(text) from public, anon;
grant execute on function public.app_user_can_view_project(text) to authenticated;
grant execute on function public.app_user_can_view_task(text) to authenticated;

alter table public.projects enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "App users can select projects" on public.projects;
create policy "App users can select projects" on public.projects
  as permissive for select to authenticated
  using (public.is_app_user());

drop policy if exists "App users can read visible projects" on public.projects;
create policy "App users can read visible projects" on public.projects
  as restrictive for select to authenticated
  using (public.app_user_can_view_project(id));

drop policy if exists "App users can select tasks" on public.tasks;
create policy "App users can select tasks" on public.tasks
  as permissive for select to authenticated
  using (public.is_app_user());

drop policy if exists "App users can read visible tasks" on public.tasks;
create policy "App users can read visible tasks" on public.tasks
  as restrictive for select to authenticated
  using (
    case
      when coalesce(data->>'projectId', '') = '' then public.is_app_user()
      else public.app_user_can_view_project(data->>'projectId')
    end
  );

drop policy if exists "App users can read project phases" on public.project_phases;
create policy "App users can read project phases" on public.project_phases
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project steps" on public.project_steps;
create policy "App users can read project steps" on public.project_steps
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project file folders" on public.project_file_folders;
create policy "App users can read project file folders" on public.project_file_folders
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project files" on public.project_files;
create policy "App users can read project files" on public.project_files
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project photos" on public.project_photos;
create policy "App users can read project photos" on public.project_photos
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project selections" on public.project_selections;
create policy "App users can read project selections" on public.project_selections
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read selection attachments" on public.project_selection_attachments;
create policy "App users can read selection attachments" on public.project_selection_attachments
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read selection photos" on public.project_selection_photos;
create policy "App users can read selection photos" on public.project_selection_photos
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project inspections" on public.project_inspections;
create policy "App users can read project inspections" on public.project_inspections
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read inspection files" on public.project_inspection_files;
create policy "App users can read inspection files" on public.project_inspection_files
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read task attachments" on public.task_attachments;
create policy "App users can read task attachments" on public.task_attachments
  for select to authenticated using (public.app_user_can_view_task(task_id));

drop policy if exists "App users can read task assignments" on public.task_assignments;
create policy "App users can read task assignments" on public.task_assignments
  for select to authenticated using (public.app_user_can_view_task(task_id));

drop policy if exists "App users can read phase assignments" on public.project_phase_assignments;
create policy "App users can read phase assignments" on public.project_phase_assignments
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read step assignments" on public.project_step_assignments;
create policy "App users can read step assignments" on public.project_step_assignments
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read project access" on public.project_user_access;
create policy "App users can read project access" on public.project_user_access
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read selection task links" on public.selection_task_links;
create policy "App users can read selection task links" on public.selection_task_links
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read phase dependencies" on public.project_phase_dependencies;
create policy "App users can read phase dependencies" on public.project_phase_dependencies
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read step dependencies" on public.project_step_dependencies;
create policy "App users can read step dependencies" on public.project_step_dependencies
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "App users can read schedule delays" on public.project_schedule_delays;
create policy "App users can read schedule delays" on public.project_schedule_delays
  for select to authenticated using (public.app_user_can_view_project(project_id));

drop policy if exists "Authenticated users can read audit events" on public.audit_events;
create policy "Authenticated users can read audit events" on public.audit_events
  for select to authenticated using (
    case
      when coalesce(project_id, '') = '' then public.is_app_user()
      else public.app_user_can_view_project(project_id)
    end
  );
