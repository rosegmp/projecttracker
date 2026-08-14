create table if not exists public.compliance_scheduled_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id text not null references public.subs(id) on delete restrict,
  source_certificate_id uuid not null references public.insurance_certificates(id) on delete cascade,
  source_coverage_id uuid not null references public.insurance_certificate_coverages(id) on delete cascade,
  expiration_date date not null,
  reminder_days integer not null check (reminder_days in (60, 30, 14, 7)),
  scheduled_for date not null,
  recipient_email text not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'unconfigured')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_coverage_id, expiration_date, reminder_days)
);

create index if not exists compliance_scheduled_reminders_subcontractor_idx
  on public.compliance_scheduled_reminder_deliveries (subcontractor_id, scheduled_for desc);
create index if not exists compliance_scheduled_reminders_status_idx
  on public.compliance_scheduled_reminder_deliveries (delivery_status, scheduled_for);

create or replace function public.claim_scheduled_compliance_reminder(
  p_subcontractor_id text,
  p_source_certificate_id uuid,
  p_source_coverage_id uuid,
  p_expiration_date date,
  p_reminder_days integer,
  p_scheduled_for date,
  p_recipient_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.compliance_scheduled_reminder_deliveries%rowtype;
begin
  if p_reminder_days not in (60, 30, 14, 7) then
    raise exception 'Invalid compliance reminder checkpoint.' using errcode = '22023';
  end if;

  insert into public.compliance_scheduled_reminder_deliveries (
    subcontractor_id,
    source_certificate_id,
    source_coverage_id,
    expiration_date,
    reminder_days,
    scheduled_for,
    recipient_email
  ) values (
    nullif(trim(p_subcontractor_id), ''),
    p_source_certificate_id,
    p_source_coverage_id,
    p_expiration_date,
    p_reminder_days,
    p_scheduled_for,
    lower(trim(p_recipient_email))
  )
  on conflict (source_coverage_id, expiration_date, reminder_days) do nothing;

  update public.compliance_scheduled_reminder_deliveries
  set
    delivery_status = 'pending',
    recipient_email = lower(trim(p_recipient_email)),
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    updated_at = now()
  where source_coverage_id = p_source_coverage_id
    and expiration_date = p_expiration_date
    and reminder_days = p_reminder_days
    and delivery_status <> 'sent'
    and (last_attempt_at is null or last_attempt_at < now() - interval '15 minutes')
  returning * into claimed;

  return case when claimed.id is null then null else to_jsonb(claimed) end;
end;
$$;

alter table public.compliance_scheduled_reminder_deliveries enable row level security;

revoke all on public.compliance_scheduled_reminder_deliveries from public, anon, authenticated;
revoke all on function public.claim_scheduled_compliance_reminder(text, uuid, uuid, date, integer, date, text) from public, anon, authenticated;
grant execute on function public.claim_scheduled_compliance_reminder(text, uuid, uuid, date, integer, date, text) to service_role;

drop trigger if exists enforce_application_write_freeze on public.compliance_scheduled_reminder_deliveries;
create trigger enforce_application_write_freeze
before insert or update or delete on public.compliance_scheduled_reminder_deliveries
for each statement execute function private.enforce_application_write_freeze();

create table if not exists public.compliance_scheduled_followup_deliveries (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id text not null references public.subs(id) on delete restrict,
  requested_at timestamptz not null,
  reminder_days integer not null check (reminder_days in (7, 14, 30)),
  scheduled_for date not null,
  missing_requirements text[] not null,
  recipient_email text not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'unconfigured')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subcontractor_id, requested_at, reminder_days)
);

create index if not exists compliance_scheduled_followups_status_idx
  on public.compliance_scheduled_followup_deliveries (delivery_status, scheduled_for);

create or replace function public.claim_scheduled_compliance_followup(
  p_subcontractor_id text,
  p_requested_at timestamptz,
  p_reminder_days integer,
  p_scheduled_for date,
  p_missing_requirements text[],
  p_recipient_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.compliance_scheduled_followup_deliveries%rowtype;
begin
  if p_reminder_days not in (7, 14, 30) then
    raise exception 'Invalid compliance follow-up checkpoint.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_missing_requirements, 1), 0) = 0
    or p_missing_requirements <@ array['general_liability', 'subcontractor_agreement', 'w9']::text[] is not true then
    raise exception 'Invalid compliance follow-up requirements.' using errcode = '22023';
  end if;

  insert into public.compliance_scheduled_followup_deliveries (
    subcontractor_id,
    requested_at,
    reminder_days,
    scheduled_for,
    missing_requirements,
    recipient_email
  ) values (
    nullif(trim(p_subcontractor_id), ''),
    p_requested_at,
    p_reminder_days,
    p_scheduled_for,
    p_missing_requirements,
    lower(trim(p_recipient_email))
  )
  on conflict (subcontractor_id, requested_at, reminder_days) do nothing;

  update public.compliance_scheduled_followup_deliveries
  set
    delivery_status = 'pending',
    missing_requirements = p_missing_requirements,
    recipient_email = lower(trim(p_recipient_email)),
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    updated_at = now()
  where subcontractor_id = p_subcontractor_id
    and requested_at = p_requested_at
    and reminder_days = p_reminder_days
    and delivery_status <> 'sent'
    and (last_attempt_at is null or last_attempt_at < now() - interval '15 minutes')
  returning * into claimed;

  return case when claimed.id is null then null else to_jsonb(claimed) end;
end;
$$;

alter table public.compliance_scheduled_followup_deliveries enable row level security;

revoke all on public.compliance_scheduled_followup_deliveries from public, anon, authenticated;
revoke all on function public.claim_scheduled_compliance_followup(text, timestamptz, integer, date, text[], text) from public, anon, authenticated;
grant execute on function public.claim_scheduled_compliance_followup(text, timestamptz, integer, date, text[], text) to service_role;

drop trigger if exists enforce_application_write_freeze on public.compliance_scheduled_followup_deliveries;
create trigger enforce_application_write_freeze
before insert or update or delete on public.compliance_scheduled_followup_deliveries
for each statement execute function private.enforce_application_write_freeze();
