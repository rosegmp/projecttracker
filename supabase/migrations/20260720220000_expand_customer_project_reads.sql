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
  calendar_settings jsonb := '{}'::jsonb;
begin
  if actor_role not in ('Customer', 'Subcontractor') or actor_id is null then
    raise exception 'A customer or subcontractor portal account is required';
  end if;

  if actor_role = 'Customer' then
    select jsonb_build_object(
      'holidays', coalesce(app_settings.data->'holidays', '[]'::jsonb),
      'showCalendarHebrewDates', coalesce(app_settings.data->'showCalendarHebrewDates', 'false'::jsonb),
      'showCalendarPhases', coalesce(app_settings.data->'showCalendarPhases', 'true'::jsonb)
    )
    into calendar_settings
    from public.settings app_settings
    where app_settings.id = 'app_settings';
    calendar_settings := coalesce(calendar_settings, '{}'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    case when actor_role = 'Customer' then
      jsonb_build_object(
        'id', project_row.id,
        'name', coalesce(project_row.data->>'name', 'Project'),
        'address', coalesce(project_row.data->>'address', ''),
        'status', coalesce(project_row.data->>'status', 'active'),
        'start', coalesce(project_row.data->>'start', ''),
        'end', coalesce(project_row.data->>'end', ''),
        'customerName', coalesce(project_row.data->>'customerName', ''),
        'customerPhone', coalesce(project_row.data->>'customerPhone', ''),
        'customerEmail', coalesce(project_row.data->>'customerEmail', ''),
        'customerAddress', coalesce(project_row.data->>'customerAddress', ''),
        'permitNumber', coalesce(project_row.data->>'permitNumber', ''),
        'block', coalesce(project_row.data->>'block', ''),
        'lot', coalesce(project_row.data->>'lot', ''),
        'drNumber', coalesce(project_row.data->>'drNumber', ''),
        'desc', coalesce(project_row.data->>'desc', ''),
        'manager', coalesce(project_row.data->>'manager', ''),
        'mainPhotoId', coalesce(project_row.data->>'mainPhotoId', ''),
        'mainPhotoCrop', coalesce(project_row.data->>'mainPhotoCrop', 'false') = 'true',
        'accessUserIds', jsonb_build_array(actor_id),
        'phases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', phase_row.id,
            'name', coalesce(phase_row.data->>'name', ''),
            'status', coalesce(phase_row.data->>'status', 'planning'),
            'start', coalesce(phase_row.data->>'start', ''),
            'end', coalesce(phase_row.data->>'end', ''),
            'steps', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', step_row.id,
                'name', coalesce(step_row.data->>'name', ''),
                'status', coalesce(step_row.data->>'status', ''),
                'start', coalesce(step_row.data->>'start', ''),
                'end', coalesce(step_row.data->>'end', ''),
                'done', coalesce(step_row.data->'done', 'false'::jsonb),
                'duration', coalesce(step_row.data->'duration', '1'::jsonb),
                'color', coalesce(step_row.data->>'color', '')
              ) order by step_row.position, step_row.id)
              from public.project_steps step_row
              where step_row.project_id = project_row.id
                and step_row.phase_id = phase_row.id
            ), '[]'::jsonb)
          ) order by phase_row.position, phase_row.id)
          from public.project_phases phase_row
          where phase_row.project_id = project_row.id
        ), '[]'::jsonb),
        'inspections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', inspection_row.id,
            'subcode', coalesce(inspection_row.data->>'subcode', ''),
            'inspectionType', coalesce(inspection_row.data->>'inspectionType', inspection_row.data->>'name', ''),
            'date', coalesce(inspection_row.data->>'date', inspection_row.data->>'scheduledDate', ''),
            'status', coalesce(inspection_row.data->>'status', 'scheduled'),
            'agency', coalesce(inspection_row.data->>'agency', '')
          ) order by inspection_row.position, inspection_row.id)
          from public.project_inspections inspection_row
          where inspection_row.project_id = project_row.id
        ), '[]'::jsonb),
        'files', jsonb_build_object('folders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', folder_row.id,
            'name', coalesce(folder_row.data->>'name', 'Files'),
            'files', coalesce((
              select jsonb_agg(file_row.data || jsonb_build_object('id', file_row.id) order by file_row.position, file_row.id)
              from public.project_files file_row
              where file_row.project_id = project_row.id
                and file_row.folder_id = folder_row.id
            ), '[]'::jsonb)
          ) order by folder_row.position, folder_row.id)
          from public.project_file_folders folder_row
          where folder_row.project_id = project_row.id
        ), '[]'::jsonb)),
        'photos', coalesce((
          select jsonb_agg(photo_row.data || jsonb_build_object('id', photo_row.id) order by photo_row.position, photo_row.id)
          from public.project_photos photo_row
          where photo_row.project_id = project_row.id
        ), '[]'::jsonb),
        'selections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', selection_row.id,
            'category', coalesce(selection_row.data->>'category', ''),
            'itemName', coalesce(selection_row.data->>'itemName', selection_row.data->>'name', ''),
            'chosenOption', coalesce(selection_row.data->>'chosenOption', ''),
            'status', coalesce(selection_row.data->>'status', 'needs decision'),
            'vendor', coalesce(selection_row.data->>'vendor', ''),
            'allowance', coalesce(selection_row.data->'allowance', '0'::jsonb),
            'actualCost', coalesce(selection_row.data->'actualCost', '0'::jsonb),
            'selectionDate', coalesce(selection_row.data->>'selectionDate', ''),
            'notes', coalesce(selection_row.data->>'notes', ''),
            'attachments', coalesce((
              select jsonb_agg(attachment_row.data || jsonb_build_object('id', attachment_row.id) order by attachment_row.position, attachment_row.id)
              from public.project_selection_attachments attachment_row
              where attachment_row.project_id = project_row.id
                and attachment_row.selection_id = selection_row.id
            ), '[]'::jsonb),
            'photos', coalesce((
              select jsonb_agg(selection_photo_row.data || jsonb_build_object('id', selection_photo_row.id) order by selection_photo_row.position, selection_photo_row.id)
              from public.project_selection_photos selection_photo_row
              where selection_photo_row.project_id = project_row.id
                and selection_photo_row.selection_id = selection_row.id
            ), '[]'::jsonb)
          ) order by selection_row.position, selection_row.id)
          from public.project_selections selection_row
          where selection_row.project_id = project_row.id
        ), '[]'::jsonb),
        'version', project_row.version
      )
    else
      jsonb_build_object(
        'id', project_row.id,
        'name', coalesce(project_row.data->>'name', 'Project'),
        'address', coalesce(project_row.data->>'address', ''),
        'status', coalesce(project_row.data->>'status', 'active'),
        'start', coalesce(project_row.data->>'start', ''),
        'end', coalesce(project_row.data->>'end', ''),
        'accessUserIds', jsonb_build_array(actor_id),
        'version', project_row.version
      )
    end
    order by project_row.created_at, project_row.id
  ), '[]'::jsonb)
  into project_rows
  from public.projects project_row
  join public.project_user_access access_row
    on access_row.project_id = project_row.id
   and access_row.user_id = actor_id;

  return jsonb_build_object(
    'currentUser', public.get_current_app_user_profile(),
    'projects', project_rows,
    'calendarSettings', calendar_settings
  );
end;
$$;

revoke all on function public.get_project_portal_bootstrap() from public, anon;
grant execute on function public.get_project_portal_bootstrap() to authenticated;

-- Keep every external portal account behind a restrictive storage boundary. Customers
-- may read only the project-files paths for projects assigned to them; subcontractors
-- remain unable to read storage objects.
drop policy if exists "Portal accounts cannot read internal storage" on storage.objects;
create policy "Portal accounts cannot read internal storage" on storage.objects
  as restrictive for select to authenticated
  using (
    coalesce(public.current_app_user_role(), '') not in ('Customer', 'Subcontractor')
    or (
      public.current_app_user_role() = 'Customer'
      and bucket_id = 'project-files'
      and (storage.foldername(name))[1] = 'projects'
      and public.app_user_can_view_project((storage.foldername(name))[2])
    )
  );

drop policy if exists "Customers can read assigned project files" on storage.objects;
create policy "Customers can read assigned project files" on storage.objects
  for select to authenticated
  using (
    public.current_app_user_role() = 'Customer'
    and bucket_id = 'project-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_view_project((storage.foldername(name))[2])
  );
