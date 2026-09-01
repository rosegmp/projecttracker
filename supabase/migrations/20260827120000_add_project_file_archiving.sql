-- Keep archived project files available to staff while removing them from
-- customer/subcontractor portal payloads and portal storage authorization.

alter function public.get_project_portal_bootstrap()
  rename to get_project_portal_bootstrap_unfiltered_20260827;
revoke all on function public.get_project_portal_bootstrap_unfiltered_20260827() from public, anon, authenticated;
create or replace function public.get_project_portal_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb := public.get_project_portal_bootstrap_unfiltered_20260827();
  filtered_projects jsonb;
begin
  select coalesce(jsonb_agg(
    project_value || jsonb_build_object(
      'files', jsonb_build_object(
        'folders', coalesce((
          select jsonb_agg(
            folder_value || jsonb_build_object(
              'files', coalesce((
                select jsonb_agg(file_value order by file_ordinality)
                from jsonb_array_elements(coalesce(folder_value->'files', '[]'::jsonb))
                  with ordinality file_row(file_value, file_ordinality)
                where coalesce(file_value->>'archivedAt', '') = ''
                  and coalesce(file_value->>'archived', 'false') <> 'true'
              ), '[]'::jsonb)
            )
            order by folder_ordinality
          )
          from jsonb_array_elements(coalesce(project_value->'files'->'folders', '[]'::jsonb))
            with ordinality folder_row(folder_value, folder_ordinality)
        ), '[]'::jsonb)
      )
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
      and coalesce(file_row.data->>'archivedAt', '') = ''
      and coalesce(file_row.data->>'archived', 'false') <> 'true'
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
