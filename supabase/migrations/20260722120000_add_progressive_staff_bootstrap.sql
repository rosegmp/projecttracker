-- Return the account, compact project/task records, settings, and only the
-- selected project's overview collections in one startup request. The client
-- can render immediately while its complete normalized read model loads.

create or replace function public.get_app_startup_bootstrap(p_project_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id text := public.current_app_user_id();
  actor_role text := public.current_app_user_role();
  actor_profile jsonb := public.get_current_app_user_profile();
  startup_project_id text;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'An application user account is required.' using errcode = '42501';
  end if;

  if actor_role in ('Customer', 'Subcontractor') then
    return jsonb_build_object(
      'mode', 'portal',
      'profile', actor_profile,
      'portal', public.get_project_portal_bootstrap()
    );
  end if;

  if nullif(trim(coalesce(p_project_id, '')), '') is not null
    and public.app_user_can_view_project(trim(p_project_id)) then
    startup_project_id := trim(p_project_id);
  end if;

  return jsonb_build_object(
    'mode', 'staff',
    'profile', actor_profile,
    'startupProjectId', coalesce(startup_project_id, ''),
    'projects', (
      select coalesce(jsonb_agg(to_jsonb(project_row) order by project_row.created_at, project_row.id), '[]'::jsonb)
      from public.project_core_records project_row
      where public.app_user_can_view_project(project_row.id)
    ),
    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(task_row) order by task_row.created_at, task_row.id), '[]'::jsonb)
      from public.task_core_records task_row
      where coalesce(task_row.data->>'projectId', '') = ''
        or public.app_user_can_view_project(task_row.data->>'projectId')
    ),
    'settings', (
      select to_jsonb(settings_row)
      from public.settings settings_row
      where settings_row.id = 'app_settings'
      limit 1
    ),
    'appUsers', (
      select coalesce(jsonb_agg(to_jsonb(app_user) order by app_user.position, app_user.id), '[]'::jsonb)
      from public.app_users app_user
    ),
    'projectAccess', (
      select coalesce(jsonb_agg(to_jsonb(access_row) order by access_row.project_id, access_row.position, access_row.user_id), '[]'::jsonb)
      from public.project_user_access access_row
      where public.app_user_can_view_project(access_row.project_id)
    ),
    'phases', (
      select coalesce(jsonb_agg(to_jsonb(phase_row) order by phase_row.position, phase_row.id), '[]'::jsonb)
      from public.project_phases phase_row
      where phase_row.project_id = startup_project_id
    ),
    'steps', (
      select coalesce(jsonb_agg(to_jsonb(step_row) order by step_row.phase_id, step_row.position, step_row.id), '[]'::jsonb)
      from public.project_steps step_row
      where step_row.project_id = startup_project_id
    ),
    'folders', (
      select coalesce(jsonb_agg(to_jsonb(folder_row) order by folder_row.position, folder_row.id), '[]'::jsonb)
      from public.project_file_folders folder_row
      where folder_row.project_id = startup_project_id
    ),
    'files', (
      select coalesce(jsonb_agg(to_jsonb(file_row) order by file_row.folder_id, file_row.position, file_row.id), '[]'::jsonb)
      from public.project_files file_row
      where file_row.project_id = startup_project_id
    ),
    'photos', (
      select coalesce(jsonb_agg(to_jsonb(photo_row) order by photo_row.position, photo_row.id), '[]'::jsonb)
      from public.project_photos photo_row
      where photo_row.project_id = startup_project_id
    ),
    'selections', (
      select coalesce(jsonb_agg(to_jsonb(selection_row) order by selection_row.position, selection_row.id), '[]'::jsonb)
      from public.project_selections selection_row
      where selection_row.project_id = startup_project_id
    ),
    'inspections', (
      select coalesce(jsonb_agg(to_jsonb(inspection_row) order by inspection_row.position, inspection_row.id), '[]'::jsonb)
      from public.project_inspections inspection_row
      where inspection_row.project_id = startup_project_id
    )
  );
end;
$$;

revoke all on function public.get_app_startup_bootstrap(text) from public, anon;
grant execute on function public.get_app_startup_bootstrap(text) to authenticated;
