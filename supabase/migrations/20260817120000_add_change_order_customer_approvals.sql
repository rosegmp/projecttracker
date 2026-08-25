-- Create server-authoritative, version-bound customer approval requests for
-- change orders and record the customer's named decision atomically.

create index if not exists project_portal_items_change_order_approval_idx
  on public.project_portal_items (project_id, (data->>'changeOrderId'), updated_at desc)
  where item_type = 'approval'
    and audience = 'customer'
    and nullif(data->>'changeOrderId', '') is not null;

create or replace function public.create_change_order_approval_request(
  p_change_order_id text,
  p_version bigint,
  p_due_date date default null
)
returns setof public.project_portal_items
language plpgsql
security definer
set search_path = public
as $$
declare
  change_order_row public.project_change_orders%rowtype;
  approval_row public.project_portal_items%rowtype;
  next_request_number integer;
  attachment_names jsonb := '[]'::jsonb;
begin
  select * into change_order_row
  from public.project_change_orders
  where id = trim(coalesce(p_change_order_id, ''))
    and version = p_version
  for update;

  if not found then
    raise exception 'This change order changed elsewhere. Reopen it before requesting approval.' using errcode = '40001';
  end if;
  if not public.app_user_can_edit_project(change_order_row.project_id) then
    raise exception 'You do not have access to edit this project.' using errcode = '42501';
  end if;
  if change_order_row.status in ('void', 'approved') then
    raise exception 'This change order is not available for a new approval request.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.project_user_access access
    join public.app_users app_user on app_user.id = access.user_id
    where access.project_id = change_order_row.project_id
      and app_user.data->>'role' = 'Customer'
  ) then
    raise exception 'Assign at least one Customer user to this project before requesting approval.' using errcode = '22023';
  end if;

  select * into approval_row
  from public.project_portal_items
  where project_id = change_order_row.project_id
    and item_type = 'approval'
    and audience = 'customer'
    and status = 'response_requested'
    and data->>'changeOrderId' = change_order_row.id
    and (data->>'changeOrderVersion')::bigint = change_order_row.version
  order by updated_at desc
  limit 1;
  if found then
    return next approval_row;
    return;
  end if;

  if jsonb_typeof(change_order_row.data->'attachments') = 'array' then
    select coalesce(jsonb_agg(coalesce(nullif(item->>'name', ''), nullif(item->>'originalName', '')) order by ordinal), '[]'::jsonb)
    into attachment_names
    from jsonb_array_elements(change_order_row.data->'attachments') with ordinality source(item, ordinal)
    where coalesce(nullif(item->>'name', ''), nullif(item->>'originalName', '')) is not null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('change-order-approval:' || change_order_row.project_id || ':' || change_order_row.id, 0));
  select coalesce(max(((regexp_match(item_number, '([0-9]+)$'))[1])::integer), 0) + 1
  into next_request_number
  from public.project_portal_items
  where project_id = change_order_row.project_id
    and data->>'changeOrderId' = change_order_row.id;

  insert into public.project_portal_items (
    id, project_id, item_number, title, item_type, audience, status, due_date, data
  ) values (
    'portal-' || gen_random_uuid()::text,
    change_order_row.project_id,
    format('APR-%s-%s', regexp_replace(change_order_row.order_number, '[^A-Za-z0-9]+', '-', 'g'), lpad(next_request_number::text, 2, '0')),
    'Change order approval: ' || change_order_row.order_number || ' - ' || change_order_row.title,
    'approval',
    'customer',
    'response_requested',
    coalesce(p_due_date, nullif(change_order_row.data->>'dueDate', '')::date),
    jsonb_build_object(
      'message', 'Please review the change order terms below and approve or decline them.',
      'changeOrderId', change_order_row.id,
      'changeOrderVersion', change_order_row.version,
      'changeOrderSnapshot', jsonb_build_object(
        'number', change_order_row.order_number,
        'title', change_order_row.title,
        'description', coalesce(change_order_row.data->>'description', ''),
        'reason', coalesce(change_order_row.data->>'reason', ''),
        'costImpact', coalesce(change_order_row.data->>'costImpact', ''),
        'scheduleDays', coalesce(change_order_row.data->>'scheduleDays', ''),
        'dueDate', coalesce(change_order_row.data->>'dueDate', ''),
        'notes', coalesce(change_order_row.data->>'notes', ''),
        'attachmentNames', attachment_names
      )
    )
  ) returning * into approval_row;

  return next approval_row;
end;
$$;

revoke all on function public.create_change_order_approval_request(text, bigint, date) from public, anon;
grant execute on function public.create_change_order_approval_request(text, bigint, date) to authenticated;

create or replace function public.protect_change_order_approval_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(old.data->>'changeOrderId', '') is null then return new; end if;
  if new.project_id is distinct from old.project_id
    or new.item_type is distinct from old.item_type
    or new.audience is distinct from old.audience
    or (new.data->'changeOrderId') is distinct from (old.data->'changeOrderId')
    or (new.data->'changeOrderVersion') is distinct from (old.data->'changeOrderVersion')
    or (new.data->'changeOrderSnapshot') is distinct from (old.data->'changeOrderSnapshot') then
    raise exception 'The issued change order approval snapshot cannot be changed.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists project_portal_items_change_order_snapshot_trigger on public.project_portal_items;
create trigger project_portal_items_change_order_snapshot_trigger
before update on public.project_portal_items
for each row execute function public.protect_change_order_approval_snapshot();

drop function if exists public.respond_to_project_portal_item(text, bigint, text, text);
create function public.respond_to_project_portal_item(
  p_item_id text,
  p_version bigint,
  p_response text,
  p_decision text default '',
  p_signer_name text default ''
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
  signer_name text := trim(coalesce(p_signer_name, ''));
  selection_id text;
  change_order_id text;
  expected_change_order_version bigint;
  linked_rows_updated integer := 0;
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
  if portal_row.status in ('draft', 'closed', 'approved', 'declined') then
    raise exception 'This portal item is not accepting responses';
  end if;

  selection_id := nullif(trim(coalesce(portal_row.data->>'selectionId', '')), '');
  change_order_id := nullif(trim(coalesce(portal_row.data->>'changeOrderId', '')), '');

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
    get diagnostics linked_rows_updated = row_count;
    if linked_rows_updated <> 1 then
      raise exception 'The selection linked to this approval request was not found';
    end if;
  end if;

  if change_order_id is not null then
    if portal_row.item_type <> 'approval' or portal_row.audience <> 'customer' or actor_role <> 'Customer' then
      raise exception 'Only the assigned customer can respond to a linked change order approval';
    end if;
    if decision not in ('approved', 'declined') then
      raise exception 'A linked change order approval must be approved or declined';
    end if;
    if length(signer_name) < 2 or length(signer_name) > 120 then
      raise exception 'Enter the full name of the person approving or declining this change order.' using errcode = '22023';
    end if;
    expected_change_order_version := (portal_row.data->>'changeOrderVersion')::bigint;

    update public.project_change_orders
    set status = case when decision = 'approved' then 'approved' else 'rejected' end,
        data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
          'status', case when decision = 'approved' then 'approved' else 'rejected' end,
          'approvalDate', case when decision = 'approved' then to_char(current_date, 'YYYY-MM-DD') else '' end,
          'decisionDate', to_char(current_date, 'YYYY-MM-DD'),
          'approvalStatus', decision,
          'approvalRequestId', portal_row.id,
          'approvalResponse', trim(coalesce(p_response, '')),
          'approvalSignerName', signer_name,
          'approvalRespondedAt', now(),
          'approvalRespondedByUserId', actor_user_id
        )
    where project_id = portal_row.project_id
      and id = change_order_id
      and version = expected_change_order_version;
    get diagnostics linked_rows_updated = row_count;
    if linked_rows_updated <> 1 then
      raise exception 'This change order changed after the request was sent. Ask the project team to issue a new approval request.' using errcode = '40001';
    end if;
  end if;

  return query
  update public.project_portal_items
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'response', trim(coalesce(p_response, '')),
        'responseByUserId', actor_user_id,
        'responseByRole', actor_role,
        'respondedAt', now(),
        'signerName', case when change_order_id is null then '' else signer_name end
      ),
      status = case when decision in ('approved', 'declined') then decision else 'answered' end,
      updated_by = auth.uid()
  where id = portal_row.id
  returning *;
end;
$$;

revoke all on function public.respond_to_project_portal_item(text, bigint, text, text, text) from public, anon;
grant execute on function public.respond_to_project_portal_item(text, bigint, text, text, text) to authenticated;
