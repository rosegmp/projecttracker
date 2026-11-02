-- Inactive projects stay available to staff in the archive but disappear from
-- customer/subcontractor reads, including project-scoped records and storage.
create or replace function public.app_user_can_view_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_user_role() in ('Customer', 'Subcontractor')
      and exists (
        select 1 from public.projects project_row
        where project_row.id = p_project_id
          and coalesce(project_row.data->>'inactive', 'false') = 'true'
      ) then false
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
revoke all on function public.app_user_can_view_project(text) from public, anon;
grant execute on function public.app_user_can_view_project(text) to authenticated;

-- The portal bootstrap uses security-definer functions and must filter its
-- project payload explicitly, even though normal table reads are covered by RLS.
alter function public.get_project_portal_bootstrap()
  rename to get_project_portal_bootstrap_unfiltered_20261021;
revoke all on function public.get_project_portal_bootstrap_unfiltered_20261021() from public, anon, authenticated;

create or replace function public.get_project_portal_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  visible_projects jsonb;
begin
  if auth.uid() is null or public.current_app_user_role() not in ('Customer', 'Subcontractor') then
    raise exception 'A customer or subcontractor portal account is required.' using errcode = '42501';
  end if;

  payload := public.get_project_portal_bootstrap_unfiltered_20261021();
  select coalesce(jsonb_agg(project_value order by project_ordinality), '[]'::jsonb)
    into visible_projects
  from jsonb_array_elements(coalesce(payload->'projects', '[]'::jsonb))
    with ordinality project_row(project_value, project_ordinality)
  where exists (
    select 1 from public.projects project_record
    where project_record.id = project_value->>'id'
      and coalesce(project_record.data->>'inactive', 'false') <> 'true'
  );

  return jsonb_set(payload, '{projects}', visible_projects, true);
end;
$$;
revoke all on function public.get_project_portal_bootstrap() from public, anon;
grant execute on function public.get_project_portal_bootstrap() to authenticated;
