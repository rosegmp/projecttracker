-- Allow assigned portal users to read only explicitly shared file folders and
-- selections. Existing folders remain customer-visible; subcontractor access
-- is opt-in for both folders and selections.

alter function public.get_project_portal_bootstrap()
  rename to get_project_portal_bootstrap_unfiltered_20260721;

revoke all on function public.get_project_portal_bootstrap_unfiltered_20260721() from public, anon, authenticated;

create or replace function public.get_project_portal_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_app_user_role();
  payload jsonb;
  filtered_projects jsonb;
begin
  if actor_role not in ('Customer', 'Subcontractor') then
    raise exception 'A customer or subcontractor portal account is required';
  end if;

  payload := public.get_project_portal_bootstrap_unfiltered_20260721();

  select coalesce(jsonb_agg(
    project_value || jsonb_build_object(
      'files', jsonb_build_object('folders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', folder_row.id,
          'name', coalesce(folder_row.data->>'name', 'Files'),
          'customerVisible', coalesce(folder_row.data->>'customerVisible', 'true') = 'true',
          'subcontractorVisible', coalesce(folder_row.data->>'subcontractorVisible', 'false') = 'true',
          'files', coalesce((
            select jsonb_agg(file_row.data || jsonb_build_object('id', file_row.id) order by file_row.position, file_row.id)
            from public.project_files file_row
            where file_row.project_id = project_value->>'id'
              and file_row.folder_id = folder_row.id
          ), '[]'::jsonb)
        ) order by folder_row.position, folder_row.id)
        from public.project_file_folders folder_row
        where folder_row.project_id = project_value->>'id'
          and (
            (actor_role = 'Customer' and coalesce(folder_row.data->>'customerVisible', 'true') = 'true')
            or (actor_role = 'Subcontractor' and coalesce(folder_row.data->>'subcontractorVisible', 'false') = 'true')
          )
      ), '[]'::jsonb)),
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
          'subcontractorVisible', coalesce(selection_row.data->>'subcontractorVisible', 'false') = 'true',
          'attachments', coalesce((
            select jsonb_agg(attachment_row.data || jsonb_build_object('id', attachment_row.id) order by attachment_row.position, attachment_row.id)
            from public.project_selection_attachments attachment_row
            where attachment_row.project_id = project_value->>'id'
              and attachment_row.selection_id = selection_row.id
          ), '[]'::jsonb),
          'photos', coalesce((
            select jsonb_agg(photo_row.data || jsonb_build_object('id', photo_row.id) order by photo_row.position, photo_row.id)
            from public.project_selection_photos photo_row
            where photo_row.project_id = project_value->>'id'
              and photo_row.selection_id = selection_row.id
          ), '[]'::jsonb)
        ) order by selection_row.position, selection_row.id)
        from public.project_selections selection_row
        where selection_row.project_id = project_value->>'id'
          and (
            actor_role = 'Customer'
            or coalesce(selection_row.data->>'subcontractorVisible', 'false') = 'true'
          )
      ), '[]'::jsonb)
    )
    order by project_ordinality
  ), '[]'::jsonb)
  into filtered_projects
  from jsonb_array_elements(coalesce(payload->'projects', '[]'::jsonb))
    with ordinality project_row(project_value, project_ordinality);

  return jsonb_set(payload, '{projects}', filtered_projects, true);
end;
$$;

revoke all on function public.get_project_portal_bootstrap() from public, anon;
grant execute on function public.get_project_portal_bootstrap() to authenticated;

create or replace function public.portal_storage_object_is_visible(
  p_project_id text,
  p_object_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role text := public.current_app_user_role();
begin
  if actor_role not in ('Customer', 'Subcontractor')
    or not public.app_user_can_view_project(p_project_id) then
    return false;
  end if;

  if actor_role = 'Customer' and (storage.foldername(p_object_path))[3] = 'photos' then
    return true;
  end if;

  if exists (
    select 1
    from public.project_files file_row
    join public.project_file_folders folder_row
      on folder_row.project_id = file_row.project_id
     and folder_row.id = file_row.folder_id
    where file_row.project_id = p_project_id
      and file_row.data->>'storagePath' = p_object_path
      and (
        (actor_role = 'Customer' and coalesce(folder_row.data->>'customerVisible', 'true') = 'true')
        or (actor_role = 'Subcontractor' and coalesce(folder_row.data->>'subcontractorVisible', 'false') = 'true')
      )
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.project_selections selection_row
    where selection_row.project_id = p_project_id
      and (
        actor_role = 'Customer'
        or coalesce(selection_row.data->>'subcontractorVisible', 'false') = 'true'
      )
      and (
        exists (
          select 1 from public.project_selection_attachments attachment_row
          where attachment_row.project_id = selection_row.project_id
            and attachment_row.selection_id = selection_row.id
            and attachment_row.data->>'storagePath' = p_object_path
        )
        or exists (
          select 1 from public.project_selection_photos photo_row
          where photo_row.project_id = selection_row.project_id
            and photo_row.selection_id = selection_row.id
            and photo_row.data->>'storagePath' = p_object_path
        )
      )
  );
end;
$$;

revoke all on function public.portal_storage_object_is_visible(text, text) from public, anon;
grant execute on function public.portal_storage_object_is_visible(text, text) to authenticated;

drop policy if exists "Portal accounts cannot read internal storage" on storage.objects;
create policy "Portal accounts cannot read internal storage" on storage.objects
  as restrictive for select to authenticated
  using (
    coalesce(public.current_app_user_role(), '') not in ('Customer', 'Subcontractor')
    or (
      bucket_id = 'project-files'
      and (storage.foldername(name))[1] = 'projects'
      and public.portal_storage_object_is_visible((storage.foldername(name))[2], name)
    )
  );

drop policy if exists "Customers can read assigned project files" on storage.objects;
drop policy if exists "Portal users can read shared project files" on storage.objects;
create policy "Portal users can read shared project files" on storage.objects
  for select to authenticated
  using (
    public.current_app_user_role() in ('Customer', 'Subcontractor')
    and bucket_id = 'project-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.portal_storage_object_is_visible((storage.foldername(name))[2], name)
  );
