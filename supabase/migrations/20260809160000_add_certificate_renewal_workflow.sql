create table if not exists public.certificate_renewal_requests (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id text not null references public.subs(id) on delete restrict,
  source_certificate_id uuid references public.insurance_certificates(id) on delete set null,
  received_certificate_id uuid references public.insurance_certificates(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'received', 'under_review', 'accepted')),
  recipient_email text not null,
  requested_by uuid not null default auth.uid(),
  requested_by_name text not null default '',
  requested_by_email text not null default '',
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'unconfigured')),
  requested_at timestamptz not null default now(),
  delivered_at timestamptz,
  received_at timestamptz,
  reviewed_at timestamptz,
  accepted_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists certificate_renewal_requests_subcontractor_idx
  on public.certificate_renewal_requests (subcontractor_id, requested_at desc);
create index if not exists certificate_renewal_requests_status_idx
  on public.certificate_renewal_requests (status, requested_at desc);

create or replace function public.set_certificate_renewal_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists certificate_renewal_metadata_trigger on public.certificate_renewal_requests;
create trigger certificate_renewal_metadata_trigger
before insert or update on public.certificate_renewal_requests
for each row execute function public.set_certificate_renewal_metadata();

alter table public.certificate_renewal_requests enable row level security;

drop policy if exists "Internal users can read certificate renewals" on public.certificate_renewal_requests;
create policy "Internal users can read certificate renewals"
  on public.certificate_renewal_requests for select to authenticated
  using (coalesce(public.current_app_user_role(), '') in ('Admin', 'Edit', 'View Only'));

revoke all on public.certificate_renewal_requests from anon;
revoke insert, update, delete on public.certificate_renewal_requests from authenticated;
grant select on public.certificate_renewal_requests to authenticated;

create or replace function public.create_certificate_renewal_request(
  p_subcontractor_id text,
  p_source_certificate_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  subcontractor_row public.subs%rowtype;
  caller_row public.app_users%rowtype;
  target_certificate_id uuid := p_source_certificate_id;
  target_email text;
  saved_request public.certificate_renewal_requests%rowtype;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to request certificate renewals.' using errcode = '42501';
  end if;

  select * into subcontractor_row
  from public.subs
  where id = nullif(trim(p_subcontractor_id), '');
  if subcontractor_row.id is null then
    raise exception 'Select a valid subcontractor.' using errcode = '23503';
  end if;
  if coalesce(nullif(subcontractor_row.data->>'inactive', '')::boolean, false) then
    raise exception 'Certificate renewals cannot be requested from an inactive subcontractor.' using errcode = '22023';
  end if;
  if coalesce(subcontractor_row.data->>'certificateRequirement', 'required') = 'not_required' then
    raise exception 'This subcontractor does not require a certificate.' using errcode = '22023';
  end if;

  target_email := lower(trim(coalesce(subcontractor_row.data->>'email', '')));
  if target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Add a valid subcontractor email before requesting renewal.' using errcode = '22023';
  end if;

  if target_certificate_id is null then
    select certificate.id into target_certificate_id
    from public.insurance_certificates certificate
    where certificate.subcontractor_id = subcontractor_row.id
    order by certificate.expiration_date desc nulls last, certificate.updated_at desc
    limit 1;
  elsif not exists (
    select 1 from public.insurance_certificates certificate
    where certificate.id = target_certificate_id
      and certificate.subcontractor_id = subcontractor_row.id
  ) then
    raise exception 'The selected certificate does not belong to this subcontractor.' using errcode = '23503';
  end if;

  select * into caller_row
  from public.app_users app_user
  where lower(trim(app_user.data->>'email')) = lower(trim(coalesce(auth.jwt()->>'email', '')))
  limit 1;

  insert into public.certificate_renewal_requests (
    subcontractor_id,
    source_certificate_id,
    recipient_email,
    requested_by,
    requested_by_name,
    requested_by_email
  ) values (
    subcontractor_row.id,
    target_certificate_id,
    target_email,
    auth.uid(),
    trim(coalesce(caller_row.data->>'name', '')),
    lower(trim(coalesce(caller_row.data->>'email', auth.jwt()->>'email', '')))
  )
  returning * into saved_request;

  return to_jsonb(saved_request);
end;
$$;

create or replace function public.update_certificate_renewal_status(
  p_request_id uuid,
  p_status text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_request public.certificate_renewal_requests%rowtype;
  saved_request public.certificate_renewal_requests%rowtype;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to review certificate renewals.' using errcode = '42501';
  end if;
  if p_status not in ('received', 'under_review', 'accepted') then
    raise exception 'Select a valid certificate renewal status.' using errcode = '22023';
  end if;

  select * into current_request
  from public.certificate_renewal_requests
  where id = p_request_id;
  if current_request.id is null then
    raise exception 'Certificate renewal request not found.' using errcode = 'P0002';
  end if;
  if not (
    (current_request.status = 'requested' and p_status = 'received')
    or (current_request.status = 'received' and p_status = 'under_review')
    or (current_request.status = 'under_review' and p_status = 'accepted')
  ) then
    raise exception 'Certificate renewals must progress from Requested to Received, Under review, and Accepted.' using errcode = '22023';
  end if;

  update public.certificate_renewal_requests
  set
    status = p_status,
    received_at = case when p_status = 'received' then coalesce(received_at, now()) else received_at end,
    reviewed_at = case when p_status = 'under_review' then coalesce(reviewed_at, now()) else reviewed_at end,
    accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end
  where id = p_request_id
    and version = p_expected_version
  returning * into saved_request;

  if saved_request.id is null then
    raise exception 'VERSION_CONFLICT: This certificate renewal changed after it was opened.' using errcode = '40001';
  end if;
  return to_jsonb(saved_request);
end;
$$;

revoke all on function public.create_certificate_renewal_request(text, uuid) from public, anon;
revoke all on function public.update_certificate_renewal_status(uuid, text, bigint) from public, anon;
grant execute on function public.create_certificate_renewal_request(text, uuid) to authenticated;
grant execute on function public.update_certificate_renewal_status(uuid, text, bigint) to authenticated;

create or replace function public.mark_certificate_renewal_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.certificate_renewal_requests
  set
    status = 'received',
    received_certificate_id = new.id,
    received_at = coalesce(received_at, now())
  where subcontractor_id = new.subcontractor_id
    and status = 'requested'
    and requested_at <= new.created_at;
  return new;
end;
$$;

drop trigger if exists insurance_certificate_marks_renewal_received on public.insurance_certificates;
create trigger insurance_certificate_marks_renewal_received
after insert on public.insurance_certificates
for each row execute function public.mark_certificate_renewal_received();

drop trigger if exists enforce_application_write_freeze on public.certificate_renewal_requests;
create trigger enforce_application_write_freeze
before insert or update or delete on public.certificate_renewal_requests
for each statement execute function private.enforce_application_write_freeze();

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in (
  'project',
  'task',
  'takeoff',
  'daily_log',
  'change_order',
  'rfi',
  'submittal',
  'budget_item',
  'commitment',
  'portal_item',
  'warranty_item',
  'closeout_item',
  'insurance_certificate',
  'certificate_renewal'
));

create or replace function public.record_certificate_renewal_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (
    actor_user_id,
    actor_email,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data
  ) values (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'certificate_renewal',
    new.id::text,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status, 'deliveryStatus', old.delivery_status, 'version', old.version) end,
    jsonb_build_object('status', new.status, 'deliveryStatus', new.delivery_status, 'version', new.version)
  );
  return new;
end;
$$;

drop trigger if exists certificate_renewal_audit_trigger on public.certificate_renewal_requests;
create trigger certificate_renewal_audit_trigger
after insert or update on public.certificate_renewal_requests
for each row execute function public.record_certificate_renewal_audit_event();
