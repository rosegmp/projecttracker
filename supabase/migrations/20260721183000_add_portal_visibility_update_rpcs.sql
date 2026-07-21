-- Persist portal visibility without rewriting every normalized file or selection
-- record. These focused writes keep the UI responsive for projects with larger
-- file collections while retaining optimistic concurrency and project access.

create or replace function public.update_project_folder_visibility(
  p_project_id text,
  p_folder_id text,
  p_customer_visible boolean,
  p_subcontractor_visible boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_data jsonb;
  next_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
    raise exception 'You do not have access to edit this project.' using errcode = '42501';
  end if;

  update public.project_file_folders
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'customerVisible', coalesce(p_customer_visible, false),
        'subcontractorVisible', coalesce(p_subcontractor_visible, false)
      ),
      version = version + 1,
      updated_at = now()
  where project_id = p_project_id
    and id = p_folder_id
    and version = p_expected_version
  returning data, version into next_data, next_version;

  if next_version is null then
    if exists (
      select 1 from public.project_file_folders
      where project_id = p_project_id and id = p_folder_id
    ) then
      raise exception 'NORMALIZED_VERSION_CONFLICT:folders:%', p_folder_id using errcode = '40001';
    end if;
    raise exception 'Project folder was not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'folder', next_data || jsonb_build_object('id', p_folder_id),
    'version', next_version
  );
end;
$$;

revoke all on function public.update_project_folder_visibility(text, text, boolean, boolean, bigint) from public, anon;
grant execute on function public.update_project_folder_visibility(text, text, boolean, boolean, bigint) to authenticated;

create or replace function public.update_project_selection_visibility(
  p_project_id text,
  p_selection_id text,
  p_subcontractor_visible boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_data jsonb;
  next_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit_project(p_project_id) then
    raise exception 'You do not have access to edit this project.' using errcode = '42501';
  end if;

  update public.project_selections
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'subcontractorVisible', coalesce(p_subcontractor_visible, false)
      ),
      version = version + 1,
      updated_at = now()
  where project_id = p_project_id
    and id = p_selection_id
    and version = p_expected_version
  returning data, version into next_data, next_version;

  if next_version is null then
    if exists (
      select 1 from public.project_selections
      where project_id = p_project_id and id = p_selection_id
    ) then
      raise exception 'NORMALIZED_VERSION_CONFLICT:selections:%', p_selection_id using errcode = '40001';
    end if;
    raise exception 'Project selection was not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'selection', next_data || jsonb_build_object('id', p_selection_id),
    'version', next_version
  );
end;
$$;

revoke all on function public.update_project_selection_visibility(text, text, boolean, bigint) from public, anon;
grant execute on function public.update_project_selection_visibility(text, text, boolean, bigint) to authenticated;
