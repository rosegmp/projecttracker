create or replace function public.get_current_app_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when app_user.id is null then null else jsonb_build_object(
    'id', app_user.id,
    'name', coalesce(app_user.data->>'name', ''),
    'email', coalesce(app_user.data->>'email', ''),
    'role', coalesce(app_user.data->>'role', 'View Only')
  ) end
  from (select public.current_app_user_id() as id) current_user_row
  left join public.app_users app_user on app_user.id = current_user_row.id
$$;

create or replace function public.get_project_portal_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_app_user_role();
  actor_id text := public.current_app_user_id();
  project_rows jsonb;
begin
  if actor_role not in ('Customer', 'Subcontractor') or actor_id is null then
    raise exception 'A customer or subcontractor portal account is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', project_row.id,
    'name', coalesce(project_row.data->>'name', 'Project'),
    'address', coalesce(project_row.data->>'address', ''),
    'status', coalesce(project_row.data->>'status', 'active'),
    'start', coalesce(project_row.data->>'start', ''),
    'end', coalesce(project_row.data->>'end', ''),
    'accessUserIds', jsonb_build_array(actor_id),
    'version', project_row.version
  ) order by project_row.created_at, project_row.id), '[]'::jsonb)
  into project_rows
  from public.projects project_row
  join public.project_user_access access_row
    on access_row.project_id = project_row.id
   and access_row.user_id = actor_id;

  return jsonb_build_object(
    'currentUser', public.get_current_app_user_profile(),
    'projects', project_rows
  );
end;
$$;

revoke all on function public.get_current_app_user_profile() from public, anon;
revoke all on function public.get_project_portal_bootstrap() from public, anon;
grant execute on function public.get_current_app_user_profile() to authenticated;
grant execute on function public.get_project_portal_bootstrap() to authenticated;

-- Portal accounts use the security-definer bootstrap above. Their authenticated token
-- cannot select internal tracker tables directly, even for an assigned project.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects', 'tasks', 'settings', 'subs', 'employees', 'app_users', 'people', 'audit_events',
    'project_user_access', 'project_phases', 'project_steps', 'project_phase_assignments',
    'project_step_assignments', 'project_phase_dependencies', 'project_step_dependencies',
    'project_schedule_delays', 'project_file_folders', 'project_files', 'project_photos',
    'project_selections', 'project_selection_attachments', 'project_selection_photos',
    'project_inspections', 'project_inspection_files', 'task_attachments', 'task_assignments',
    'selection_task_links', 'project_takeoffs', 'project_daily_logs', 'project_change_orders',
    'project_rfis', 'project_submittals', 'project_budget_items', 'project_commitments'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists "Portal accounts cannot read internal data" on public.%I', table_name);
      execute format(
        'create policy "Portal accounts cannot read internal data" on public.%I as restrictive for select to authenticated using (coalesce(public.current_app_user_role(), '''') not in (''Customer'', ''Subcontractor''))',
        table_name
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "Portal accounts cannot read internal storage" on storage.objects;
    create policy "Portal accounts cannot read internal storage" on storage.objects
      as restrictive for select to authenticated
      using (coalesce(public.current_app_user_role(), '') not in ('Customer', 'Subcontractor'));
  end if;
end;
$$;
