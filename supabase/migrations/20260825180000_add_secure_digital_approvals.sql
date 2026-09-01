-- Shared, version-bound digital approval ledger for portal approval requests and
-- subcontractor agreements. Raw bearer tokens are never stored.

create table public.digital_approval_requests (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('portal_item', 'subcontractor_agreement')),
  source_id text not null,
  source_version bigint not null check (source_version > 0),
  project_id text references public.projects(id) on delete restrict,
  subcontractor_id text references public.subs(id) on delete restrict,
  title text not null,
  recipient_emails text[] not null check (cardinality(recipient_emails) between 1 and 25),
  recipient_names text[] not null default '{}',
  snapshot jsonb not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'superseded', 'expired')),
  expires_at timestamptz not null,
  signer_name text not null default '',
  signer_email text not null default '',
  decision_comment text not null default '',
  responded_at timestamptz,
  signed_pdf_bucket text not null default '',
  signed_pdf_path text not null default '',
  signed_pdf_file_name text not null default '',
  document_status text not null default 'pending' check (document_status in ('pending', 'generating', 'ready', 'failed')),
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_approval_source_scope_check check (
    (source_type = 'portal_item' and project_id is not null and subcontractor_id is null)
    or (source_type = 'subcontractor_agreement' and project_id is null and subcontractor_id is not null)
  )
);
create index digital_approval_requests_project_idx
  on public.digital_approval_requests (project_id, created_at desc)
  where project_id is not null;
create index digital_approval_requests_subcontractor_idx
  on public.digital_approval_requests (subcontractor_id, created_at desc)
  where subcontractor_id is not null;
create index digital_approval_requests_pending_idx
  on public.digital_approval_requests (source_type, source_id, created_at desc)
  where status = 'pending';
alter table public.digital_approval_requests enable row level security;
revoke all on public.digital_approval_requests from public, anon, authenticated;
grant all on public.digital_approval_requests to service_role;
create trigger enforce_application_write_freeze
before insert or update or delete on public.digital_approval_requests
for each statement execute function private.enforce_application_write_freeze();
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
    select * into subcontractor_row from public.subs where id = v_source_id and version = p_source_version for update;
    if not found then
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
create or replace function public.respond_to_digital_approval(
  p_token_hash text,
  p_decision text,
  p_signer_name text,
  p_signer_email text,
  p_comment text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.digital_approval_requests%rowtype;
  portal_row public.project_portal_items%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_signer_name text := trim(coalesce(p_signer_name, ''));
  v_signer_email text := lower(trim(coalesce(p_signer_email, '')));
  v_comment text := trim(coalesce(p_comment, ''));
  linked_id text;
  linked_version bigint;
  linked_rows integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if;
  if v_decision not in ('approved', 'declined') then raise exception 'Choose approve or decline.' using errcode = '22023'; end if;
  if length(v_signer_name) < 2 or length(v_signer_name) > 120 then raise exception 'Enter your full name.' using errcode = '22023'; end if;
  if v_signer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(v_comment) > 2000 then raise exception 'Comments are limited to 2,000 characters.' using errcode = '22023'; end if;

  select * into request_row from public.digital_approval_requests
  where token_hash = lower(p_token_hash) for update;
  if not found then raise exception 'This approval link is invalid.' using errcode = '22023'; end if;
  if request_row.status <> 'pending' then raise exception 'This approval request is no longer awaiting a decision.' using errcode = '22023'; end if;
  if request_row.expires_at <= now() then
    update public.digital_approval_requests set status = 'expired', version = version + 1, updated_at = now() where id = request_row.id;
    raise exception 'This approval link has expired.' using errcode = '22023';
  end if;
  if not v_signer_email = any(request_row.recipient_emails) then
    raise exception 'Use the email address that received this approval request.' using errcode = '42501';
  end if;

  if request_row.source_type = 'portal_item' then
    select * into portal_row from public.project_portal_items
    where id = request_row.source_id and version = request_row.source_version for update;
    if not found then raise exception 'The issued request changed after it was sent. Ask the sender for a new link.' using errcode = '40001'; end if;
    if portal_row.status <> 'response_requested' then raise exception 'This request is no longer accepting responses.' using errcode = '22023'; end if;

    linked_id := nullif(request_row.snapshot->>'selectionId', '');
    if linked_id is not null then
      linked_version := (request_row.snapshot->>'selectionVersion')::bigint;
      update public.project_selections
      set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
            'status', case when v_decision = 'approved' then 'selected' else 'needs decision' end,
            'approvalStatus', v_decision, 'approvalRequestId', portal_row.id,
            'approvalResponse', v_comment, 'approvalSignerName', v_signer_name,
            'approvalSignerEmail', v_signer_email, 'approvalRespondedAt', now(),
            'approvalMethod', 'secure_link'
          ), version = version + 1, updated_at = now()
      where project_id = request_row.project_id and id = linked_id and version = linked_version;
      get diagnostics linked_rows = row_count;
      if linked_rows <> 1 then raise exception 'The selection changed after this request was sent. Ask the sender for a new link.' using errcode = '40001'; end if;
    end if;

    linked_id := nullif(request_row.snapshot->>'changeOrderId', '');
    if linked_id is not null then
      linked_version := (request_row.snapshot->>'changeOrderVersion')::bigint;
      update public.project_change_orders
      set status = case when v_decision = 'approved' then 'approved' else 'rejected' end,
          data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
            'status', case when v_decision = 'approved' then 'approved' else 'rejected' end,
            'approvalDate', case when v_decision = 'approved' then current_date::text else '' end,
            'decisionDate', current_date::text, 'approvalStatus', v_decision,
            'approvalRequestId', portal_row.id, 'approvalResponse', v_comment,
            'approvalSignerName', v_signer_name, 'approvalSignerEmail', v_signer_email,
            'approvalRespondedAt', now(), 'approvalMethod', 'secure_link'
          )
      where project_id = request_row.project_id and id = linked_id and version = linked_version;
      get diagnostics linked_rows = row_count;
      if linked_rows <> 1 then raise exception 'The change order changed after this request was sent. Ask the sender for a new link.' using errcode = '40001'; end if;
    end if;

    update public.project_portal_items
    set status = v_decision,
        data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
          'response', v_comment, 'responseByRole', 'Secure link recipient', 'respondedAt', now(),
          'signerName', v_signer_name, 'signerEmail', v_signer_email, 'approvalMethod', 'secure_link',
          'digitalApprovalRequestId', request_row.id
        )
    where id = portal_row.id;
  end if;

  update public.digital_approval_requests
  set status = v_decision, signer_name = v_signer_name, signer_email = v_signer_email,
      decision_comment = v_comment, responded_at = now(), document_status = 'generating',
      version = version + 1, updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return to_jsonb(request_row) - 'token_hash' - 'recipient_emails';
end;
$$;
revoke all on function public.respond_to_digital_approval(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_digital_approval(text, text, text, text, text) to service_role;
create or replace function public.complete_digital_approval_document(
  p_request_id uuid,
  p_bucket text,
  p_path text,
  p_file_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.digital_approval_requests%rowtype;
  portal_row public.project_portal_items%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if;
  if p_bucket <> 'certificate-files' or split_part(p_path, '/', 1) <> 'certificates' then
    raise exception 'Invalid signed document storage destination.' using errcode = '22023';
  end if;
  update public.digital_approval_requests
  set signed_pdf_bucket = p_bucket, signed_pdf_path = p_path,
      signed_pdf_file_name = trim(p_file_name), document_status = 'ready',
      version = version + 1, updated_at = now()
  where id = p_request_id and status in ('approved', 'declined')
  returning * into request_row;
  if not found then raise exception 'Completed approval request not found.' using errcode = '23503'; end if;

  if request_row.source_type = 'portal_item' then
    update public.project_portal_items
    set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
      'signedPdfBucket', p_bucket, 'signedPdfPath', p_path, 'signedPdfFileName', trim(p_file_name)
    ) where id = request_row.source_id;
    select * into portal_row from public.project_portal_items where id = request_row.source_id;
    if nullif(request_row.snapshot->>'changeOrderId', '') is not null then
      update public.project_change_orders
      set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'signedApprovalPdfBucket', p_bucket, 'signedApprovalPdfPath', p_path,
        'signedApprovalPdfFileName', trim(p_file_name)
      ) where project_id = request_row.project_id and id = request_row.snapshot->>'changeOrderId';
    end if;
    if nullif(request_row.snapshot->>'selectionId', '') is not null then
      update public.project_selections
      set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'signedApprovalPdfBucket', p_bucket, 'signedApprovalPdfPath', p_path,
        'signedApprovalPdfFileName', trim(p_file_name)
      ), version = version + 1, updated_at = now()
      where project_id = request_row.project_id and id = request_row.snapshot->>'selectionId';
    end if;
  elsif request_row.source_type = 'subcontractor_agreement' and request_row.status = 'approved' then
    insert into public.subcontractor_compliance_documents (
      subcontractor_id, document_type, signed_date, source_file_name, source_bucket, source_path
    ) values (
      request_row.subcontractor_id, 'subcontractor_agreement', current_date,
      trim(p_file_name), p_bucket, p_path
    )
    on conflict (subcontractor_id, document_type) do update
    set signed_date = excluded.signed_date, source_file_name = excluded.source_file_name,
        source_bucket = excluded.source_bucket, source_path = excluded.source_path;
  end if;
  return to_jsonb(request_row) - 'token_hash' - 'recipient_emails';
end;
$$;
revoke all on function public.complete_digital_approval_document(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_digital_approval_document(uuid, text, text, text) to service_role;
alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in (
  'project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal',
  'budget_item', 'commitment', 'portal_item', 'warranty_item', 'closeout_item',
  'insurance_certificate', 'certificate_renewal', 'subcontractor_compliance_document',
  'subcontractor_tax_identifier', 'digital_approval'
));
create or replace function public.record_digital_approval_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (
    actor_user_id, actor_email, entity_type, entity_id, project_id, action, before_data, after_data
  ) values (
    auth.uid(), coalesce(auth.jwt()->>'email', ''), 'digital_approval', new.id::text,
    new.project_id, lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status, 'version', old.version) end,
    jsonb_build_object('status', new.status, 'sourceType', new.source_type, 'sourceId', new.source_id, 'version', new.version)
  );
  return new;
end;
$$;
create trigger digital_approval_audit_trigger
after insert or update on public.digital_approval_requests
for each row execute function public.record_digital_approval_audit_event();
