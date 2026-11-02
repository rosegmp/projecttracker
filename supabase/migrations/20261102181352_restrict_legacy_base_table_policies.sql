-- The original public "allow all" policies let the anon role read and change
-- the five tracker base tables. Keep staff reads and editor writes while
-- relying on the existing restrictive project and portal SELECT policies.
drop policy if exists "allow all" on public.employees;
drop policy if exists "allow all" on public.projects;
drop policy if exists "allow all" on public.settings;
drop policy if exists "allow all" on public.subs;
drop policy if exists "allow all" on public.tasks;

create policy "App users can select employees" on public.employees
  for select to authenticated using (public.is_app_user());
create policy "App editors can insert employees" on public.employees
  for insert to authenticated with check (public.app_user_can_edit());
create policy "App editors can update employees" on public.employees
  for update to authenticated
  using (public.app_user_can_edit())
  with check (public.app_user_can_edit());
create policy "App editors can delete employees" on public.employees
  for delete to authenticated using (public.app_user_can_edit());

create policy "App editors can insert projects" on public.projects
  for insert to authenticated with check (
    public.app_user_can_edit() and public.app_user_can_view_project(id)
  );
create policy "App editors can update visible projects" on public.projects
  for update to authenticated
  using (public.app_user_can_edit() and public.app_user_can_view_project(id))
  with check (public.app_user_can_edit() and public.app_user_can_view_project(id));
create policy "App editors can delete visible projects" on public.projects
  for delete to authenticated
  using (public.app_user_can_edit() and public.app_user_can_view_project(id));

create policy "App users can select settings" on public.settings
  for select to authenticated using (public.is_app_user());
create policy "App editors can insert settings" on public.settings
  for insert to authenticated with check (public.app_user_can_edit());
create policy "App editors can update settings" on public.settings
  for update to authenticated
  using (public.app_user_can_edit())
  with check (public.app_user_can_edit());
create policy "App editors can delete settings" on public.settings
  for delete to authenticated using (public.app_user_can_edit());

create policy "App users can select subcontractors" on public.subs
  for select to authenticated using (public.is_app_user());
create policy "App editors can insert subcontractors" on public.subs
  for insert to authenticated with check (public.app_user_can_edit());
create policy "App editors can update subcontractors" on public.subs
  for update to authenticated
  using (public.app_user_can_edit())
  with check (public.app_user_can_edit());
create policy "App editors can delete subcontractors" on public.subs
  for delete to authenticated using (public.app_user_can_edit());

create policy "App editors can insert visible tasks" on public.tasks
  for insert to authenticated with check (
    public.app_user_can_edit()
    and (
      coalesce(data->>'projectId', '') = ''
      or public.app_user_can_view_project(data->>'projectId')
    )
  );
create policy "App editors can update visible tasks" on public.tasks
  for update to authenticated
  using (
    public.app_user_can_edit()
    and (
      coalesce(data->>'projectId', '') = ''
      or public.app_user_can_view_project(data->>'projectId')
    )
  )
  with check (
    public.app_user_can_edit()
    and (
      coalesce(data->>'projectId', '') = ''
      or public.app_user_can_view_project(data->>'projectId')
    )
  );
create policy "App editors can delete visible tasks" on public.tasks
  for delete to authenticated using (
    public.app_user_can_edit()
    and (
      coalesce(data->>'projectId', '') = ''
      or public.app_user_can_view_project(data->>'projectId')
    )
  );
