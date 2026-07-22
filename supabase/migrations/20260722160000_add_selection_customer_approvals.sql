-- Link customer-only portal approval requests to project selections. Customer
-- responses remain constrained by project access and update only the linked
-- selection in the same transaction as the portal response.

create index if not exists project_portal_items_selection_approval_idx
  on public.project_portal_items (project_id, (data->>'selectionId'), updated_at desc)
  where item_type = 'approval' and audience = 'customer' and nullif(data->>'selectionId', '') is not null;

create or replace function public.respond_to_project_portal_item(
  p_item_id text,
  p_version bigint,
  p_response text,
  p_decision text default ''
)
returns setof public.project_portal_items
language plpgsql
security definer
set search_path = public
as $$
declare
  portal_row public.project_portal_items%rowtype;
  actor_role text := public.current_app_user_role();
  actor_user_id text := public.current_app_user_id();
  decision text := lower(coalesce(p_decision, ''));
  selection_id text;
  selection_rows_updated integer := 0;
begin
  if actor_role not in ('Customer', 'Subcontractor') then
    raise exception 'Only customer or subcontractor portal users can use this response action';
  end if;
  if decision not in ('', 'answered', 'approved', 'declined') then
    raise exception 'Unsupported portal response decision';
  end if;

  select * into portal_row
  from public.project_portal_items
  where id = p_item_id
    and version = p_version
  for update;

  if not found then
    raise exception 'This portal item changed elsewhere. Reopen it before responding.';
  end if;
  if not public.app_user_can_view_project(portal_row.project_id)
    or portal_row.audience not in ('all', lower(actor_role)) then
    raise exception 'You do not have access to this portal item';
  end if;
  if portal_row.status in ('draft', 'closed') then
    raise exception 'This portal item is not accepting responses';
  end if;

  selection_id := nullif(trim(coalesce(portal_row.data->>'selectionId', '')), '');
  if selection_id is not null then
    if portal_row.item_type <> 'approval' or portal_row.audience <> 'customer' or actor_role <> 'Customer' then
      raise exception 'Only the assigned customer can respond to a linked selection approval';
    end if;
    if decision not in ('approved', 'declined') then
      raise exception 'A linked selection approval must be approved or declined';
    end if;

    update public.project_selections
    set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
          'status', case when decision = 'approved' then 'selected' else 'needs decision' end,
          'approvalStatus', decision,
          'approvalRequestId', portal_row.id,
          'approvalResponse', trim(coalesce(p_response, '')),
          'approvalRespondedAt', now(),
          'approvalRespondedByUserId', actor_user_id
        ),
        version = version + 1,
        updated_at = now()
    where project_id = portal_row.project_id
      and id = selection_id;
    get diagnostics selection_rows_updated = row_count;
    if selection_rows_updated <> 1 then
      raise exception 'The selection linked to this approval request was not found';
    end if;
  end if;

  return query
  update public.project_portal_items
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'response', trim(coalesce(p_response, '')),
        'responseByUserId', actor_user_id,
        'responseByRole', actor_role,
        'respondedAt', now()
      ),
      status = case when decision in ('approved', 'declined') then decision else 'answered' end,
      updated_by = auth.uid()
  where id = portal_row.id
  returning *;
end;
$$;

revoke all on function public.respond_to_project_portal_item(text, bigint, text, text) from public, anon;
grant execute on function public.respond_to_project_portal_item(text, bigint, text, text) to authenticated;
