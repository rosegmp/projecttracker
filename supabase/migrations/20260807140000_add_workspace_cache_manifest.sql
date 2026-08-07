-- Return one privacy-safe fingerprint for the workspace sources already loaded
-- by trackerData. Staff sources run with the caller's RLS visibility. Portal
-- sources hash the exact already-authorized portal bootstrap payload server-side.

create or replace function public.get_workspace_cache_manifest()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  actor_id text := public.current_app_user_id();
  actor_role text := public.current_app_user_role();
  source_name text;
  source_hash text;
  source_parts text[] := array[]::text[];
  source_names constant text[] := array[
    'projects',
    'tasks',
    'settings',
    'people',
    'subs',
    'employees',
    'app_users',
    'project_user_access',
    'project_phases',
    'project_steps',
    'project_file_folders',
    'project_files',
    'project_photos',
    'project_selections',
    'project_selection_attachments',
    'project_selection_photos',
    'project_inspections',
    'project_inspection_files',
    'task_attachments',
    'task_assignments',
    'project_phase_assignments',
    'project_step_assignments',
    'selection_task_links',
    'project_phase_dependencies',
    'project_step_dependencies',
    'project_schedule_delays'
  ];
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'An application user account is required.' using errcode = '42501';
  end if;
  if actor_role in ('Customer', 'Subcontractor') then
    return jsonb_build_object(
      'schemaVersion', 1,
      'mode', 'portal',
      'token', md5(public.get_project_portal_bootstrap()::text)
    );
  end if;

  foreach source_name in array source_names loop
    execute format(
      'select md5(coalesce(string_agg(to_jsonb(source_row)::text, ''|'' order by to_jsonb(source_row)::text), '''')) from public.%I source_row',
      source_name
    ) into source_hash;
    source_parts := array_append(source_parts, source_name || ':' || coalesce(source_hash, md5('')));
  end loop;

  return jsonb_build_object(
    'schemaVersion', 1,
    'mode', 'staff',
    'token', md5(array_to_string(source_parts, '|'))
  );
end;
$$;

revoke all on function public.get_workspace_cache_manifest() from public, anon;
grant execute on function public.get_workspace_cache_manifest() to authenticated;
