-- Lock the subcontractor first, then compare its version. Keeping the version
-- predicate out of the locking lookup prevents a valid row from being reported
-- as missing while preserving the optimistic-concurrency boundary.
create or replace function public.create_digital_approval_request(
  p_source_type text,
  p_source_id text,
  p_source_version bigint,
  p_token text,
  p_expires_at timestamptz default now() + interval '14 days'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_source_type text := lower(trim(coalesce(p_source_type, '')));
  v_source_id text := trim(coalesce(p_source_id, ''));
  token_hash text;
  portal_row public.project_portal_items%rowtype;
  subcontractor_row public.subs%rowtype;
  selection_row public.project_selections%rowtype;
  recipient_emails text[] := '{}';
  recipient_names text[] := '{}';
  request_title text;
  request_snapshot jsonb;
  request_row public.digital_approval_requests%rowtype;
  linked_selection_id text;
begin
  if p_token !~ '^[A-Za-z0-9_-]{40,160}$' then
    raise exception 'The secure approval token is invalid.' using errcode = '22023';
  end if;
  if p_expires_at <= now() + interval '1 hour' or p_expires_at > now() + interval '30 days' then
    raise exception 'Approval links must expire between one hour and 30 days from now.' using errcode = '22023';
  end if;
  token_hash := encode(digest(p_token, 'sha256'), 'hex');

  if v_source_type = 'portal_item' then
    select * into portal_row
    from public.project_portal_items
    where id = v_source_id and version = p_source_version
    for update;
    if not found then
      raise exception 'This approval request changed elsewhere. Reopen it before sending.' using errcode = '40001';
    end if;
    if not public.app_user_can_edit_project(portal_row.project_id) then
      raise exception 'You do not have access to send approvals for this project.' using errcode = '42501';
    end if;
    if portal_row.item_type <> 'approval' or portal_row.status <> 'response_requested' then
      raise exception 'Only an approval request awaiting a response can receive a secure link.' using errcode = '22023';
    end if;

    select
      coalesce(array_agg(lower(trim(app_user.data->>'email')) order by app_user.id) filter (where nullif(trim(app_user.data->>'email'), '') is not null), '{}'),
      coalesce(array_agg(coalesce(nullif(trim(app_user.data->>'name'), ''), trim(app_user.data->>'email')) order by app_user.id) filter (where nullif(trim(app_user.data->>'email'), '') is not null), '{}')
    into recipient_emails, recipient_names
    from public.project_user_access access
    join public.app_users app_user on app_user.id = access.user_id
    where access.project_id = portal_row.project_id
      and (
        (portal_row.audience = 'customer' and app_user.data->>'role' = 'Customer')
        or (portal_row.audience = 'subcontractor' and app_user.data->>'role' = 'Subcontractor')
        or (portal_row.audience = 'all' and app_user.data->>'role' in ('Customer', 'Subcontractor'))
      );
    if cardinality(recipient_emails) = 0 then
      raise exception 'Assign an application user with an email address to this approval audience before sending.' using errcode = '22023';
    end if;

    linked_selection_id := nullif(trim(coalesce(portal_row.data->>'selectionId', '')), '');
    if linked_selection_id is not null then
      select * into selection_row
      from public.project_selections
      where project_id = portal_row.project_id and id = linked_selection_id;
      if not found then raise exception 'The linked selection was not found.' using errcode = '23503'; end if;
    end if;
    request_title := portal_row.title;
    request_snapshot := jsonb_build_object(
      'kind', case
        when nullif(portal_row.data->>'changeOrderId', '') is not null then 'change_order'
        when linked_selection_id is not null then 'selection'
        else 'portal_request'
      end,
      'number', portal_row.item_number,
      'title', portal_row.title,
      'message', coalesce(portal_row.data->>'message', ''),
      'dueDate', coalesce(portal_row.due_date::text, ''),
      'audience', portal_row.audience,
      'changeOrderId', coalesce(portal_row.data->>'changeOrderId', ''),
      'changeOrderVersion', coalesce(portal_row.data->>'changeOrderVersion', ''),
      'changeOrderSnapshot', coalesce(portal_row.data->'changeOrderSnapshot', 'null'::jsonb),
      'selectionId', coalesce(linked_selection_id, ''),
      'selectionVersion', case when linked_selection_id is null then null else selection_row.version end,
      'selectionSnapshot', coalesce(portal_row.data->'selectionSnapshot', 'null'::jsonb)
    );
  elsif v_source_type = 'subcontractor_agreement' then
    if not public.app_user_can_edit() then
      raise exception 'You do not have permission to request subcontractor signatures.' using errcode = '42501';
    end if;
    select * into subcontractor_row from public.subs where id = v_source_id for update;
    if not found then
      raise exception 'The subcontractor was not found.' using errcode = '23503';
    end if;
    if subcontractor_row.version is distinct from p_source_version then
      raise exception 'This subcontractor changed elsewhere. Refresh before sending.' using errcode = '40001';
    end if;
    recipient_emails := array[lower(trim(coalesce(subcontractor_row.data->>'email', '')))];
    if recipient_emails[1] = '' then
      raise exception 'Add an email address to the subcontractor before requesting a signature.' using errcode = '22023';
    end if;
    recipient_names := array[coalesce(
      nullif(trim(concat_ws(' ', subcontractor_row.data->>'first', subcontractor_row.data->>'last')), ''),
      nullif(trim(subcontractor_row.data->>'company'), ''),
      recipient_emails[1]
    )];
    request_title := 'Destiny Homes subcontractor agreement';
    request_snapshot := jsonb_build_object(
      'kind', 'subcontractor_agreement',
      'title', request_title,
      'company', coalesce(subcontractor_row.data->>'company', ''),
      'contactName', recipient_names[1],
      'message', 'Please review and sign the attached Destiny Homes subcontractor agreement.'
    );
  else
    raise exception 'Unsupported digital approval source.' using errcode = '22023';
  end if;

  update public.digital_approval_requests
  set status = 'superseded', version = version + 1, updated_at = now()
  where digital_approval_requests.source_type = v_source_type
    and digital_approval_requests.source_id = v_source_id
    and status = 'pending';

  insert into public.digital_approval_requests (
    source_type, source_id, source_version, project_id, subcontractor_id,
    title, recipient_emails, recipient_names, snapshot, token_hash, expires_at
  ) values (
    v_source_type, v_source_id, p_source_version,
    case when v_source_type = 'portal_item' then portal_row.project_id else null end,
    case when v_source_type = 'subcontractor_agreement' then subcontractor_row.id else null end,
    request_title, recipient_emails, recipient_names, request_snapshot, token_hash, p_expires_at
  ) returning * into request_row;

  return jsonb_build_object(
    'id', request_row.id,
    'sourceType', request_row.source_type,
    'sourceId', request_row.source_id,
    'title', request_row.title,
    'recipientEmails', request_row.recipient_emails,
    'recipientNames', request_row.recipient_names,
    'expiresAt', request_row.expires_at,
    'status', request_row.status,
    'version', request_row.version
  );
end;
$$;

revoke all on function public.create_digital_approval_request(text, text, bigint, text, timestamptz) from public, anon;
grant execute on function public.create_digital_approval_request(text, text, bigint, text, timestamptz) to authenticated;

-- Audit rows use an empty project id for portfolio-level entities. Agreement
-- approvals are attached to a subcontractor rather than a project.
create or replace function public.record_digital_approval_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (
    actor_user_id, actor_email, entity_type, entity_id, project_id, action, before_data, after_data
  ) values (
    auth.uid(), coalesce(auth.jwt()->>'email', ''), 'digital_approval', new.id::text,
    coalesce(new.project_id, ''), lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status, 'version', old.version) end,
    jsonb_build_object('status', new.status, 'sourceType', new.source_type, 'sourceId', new.source_id, 'version', new.version)
  );
  return new;
end;
$$;
