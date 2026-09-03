create table if not exists public.management_reporting_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  active_subcontractors integer not null default 0 check (active_subcontractors >= 0),
  compliant_subcontractors integer not null default 0 check (compliant_subcontractors >= 0),
  missing_general_liability integer not null default 0 check (missing_general_liability >= 0),
  missing_agreement integer not null default 0 check (missing_agreement >= 0),
  missing_w9 integer not null default 0 check (missing_w9 >= 0),
  captured_by uuid,
  captured_at timestamptz not null default now()
);

create table if not exists public.management_reporting_subcontractor_snapshots (
  snapshot_id uuid not null references public.management_reporting_snapshots(id) on delete cascade,
  subcontractor_id text not null references public.subs(id) on delete restrict,
  subcontractor_name text not null default '',
  compliant boolean not null default false,
  commitment_count integer not null default 0 check (commitment_count >= 0),
  committed_amount numeric(14,2) not null default 0 check (committed_amount >= 0),
  past_due_commitments integer not null default 0 check (past_due_commitments >= 0),
  warranty_assigned integer not null default 0 check (warranty_assigned >= 0),
  warranty_completed integer not null default 0 check (warranty_completed >= 0),
  warranty_overdue integer not null default 0 check (warranty_overdue >= 0),
  primary key (snapshot_id, subcontractor_id)
);

create index if not exists management_reporting_snapshots_date_idx on public.management_reporting_snapshots(snapshot_date desc);
create index if not exists management_reporting_subcontractors_id_idx on public.management_reporting_subcontractor_snapshots(subcontractor_id, snapshot_id);

alter table public.management_reporting_snapshots enable row level security;
alter table public.management_reporting_subcontractor_snapshots enable row level security;
revoke all on public.management_reporting_snapshots, public.management_reporting_subcontractor_snapshots from public, anon, authenticated;
grant select on public.management_reporting_snapshots, public.management_reporting_subcontractor_snapshots to authenticated;
grant select on public.management_reporting_snapshots, public.management_reporting_subcontractor_snapshots to service_role;

create policy "Administrators can read management snapshots" on public.management_reporting_snapshots
  for select to authenticated using (public.current_app_user_role() = 'Admin');
create policy "Administrators can read subcontractor reporting snapshots" on public.management_reporting_subcontractor_snapshots
  for select to authenticated using (public.current_app_user_role() = 'Admin');

drop trigger if exists enforce_application_write_freeze on public.management_reporting_snapshots;
create trigger enforce_application_write_freeze before insert or update or delete on public.management_reporting_snapshots
for each statement execute function private.enforce_application_write_freeze();
drop trigger if exists enforce_application_write_freeze on public.management_reporting_subcontractor_snapshots;
create trigger enforce_application_write_freeze before insert or update or delete on public.management_reporting_subcontractor_snapshots
for each statement execute function private.enforce_application_write_freeze();

create or replace function public.capture_management_reporting_snapshot(p_snapshot_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_snapshot_id uuid;
  actor_id uuid := auth.uid();
  summary jsonb;
begin
  if public.current_app_user_role() <> 'Admin' and auth.role() <> 'service_role' then
    raise exception 'Only administrators can capture management reporting snapshots.' using errcode = '42501';
  end if;
  if p_snapshot_date is null or p_snapshot_date <> current_date then
    raise exception 'Snapshots can only be captured for today; historical dates cannot be reconstructed from current records.' using errcode = '22023';
  end if;

  insert into public.management_reporting_snapshots (snapshot_date, captured_by, captured_at)
  values (p_snapshot_date, actor_id, now())
  on conflict (snapshot_date) do update set captured_by = excluded.captured_by, captured_at = excluded.captured_at
  returning id into target_snapshot_id;

  delete from public.management_reporting_subcontractor_snapshots where snapshot_id = target_snapshot_id;

  with active_subs as (
    select sub.id, sub.data,
      coalesce(nullif(sub.data->>'company', ''), nullif(concat_ws(' ', sub.data->>'first', sub.data->>'last'), ''), 'Unnamed subcontractor') as name,
      lower(coalesce(sub.data->>'companyType', '')) as company_type
    from public.subs sub where coalesce(nullif(sub.data->>'inactive', '')::boolean, false) = false
  ), compliance as (
    select active_subs.*,
      exists (
        select 1 from public.insurance_certificates certificate
        join public.insurance_certificate_coverages coverage on coverage.certificate_id = certificate.id
        where certificate.subcontractor_id = active_subs.id
          and coverage.coverage_type = 'general_liability'
          and coalesce(coverage.expiration_date, certificate.expiration_date) >= p_snapshot_date
      ) as has_gl,
      exists (select 1 from public.subcontractor_compliance_documents document where document.subcontractor_id = active_subs.id and document.document_type = 'subcontractor_agreement' and document.source_path <> '') as has_agreement,
      case
        when active_subs.company_type <> '' and active_subs.company_type !~ '(individual|sole proprietor|single.member llc|^limited liability company|^llc)' then true
        when active_subs.company_type = '' and coalesce(nullif(active_subs.data->>'is1099Exempt', '')::boolean, false) then true
        else exists (select 1 from public.subcontractor_compliance_documents document where document.subcontractor_id = active_subs.id and document.document_type = 'w9' and document.source_path <> '')
      end as has_w9
    from active_subs
  )
  insert into public.management_reporting_subcontractor_snapshots (
    snapshot_id, subcontractor_id, subcontractor_name, compliant,
    commitment_count, committed_amount, past_due_commitments,
    warranty_assigned, warranty_completed, warranty_overdue
  )
  select target_snapshot_id, compliance.id, compliance.name,
    compliance.has_gl and compliance.has_agreement and compliance.has_w9,
    commitment_metrics.commitment_count,
    commitment_metrics.committed_amount,
    commitment_metrics.past_due_commitments,
    warranty_metrics.warranty_assigned,
    warranty_metrics.warranty_completed,
    warranty_metrics.warranty_overdue
  from compliance
  cross join lateral (
    select count(*)::integer commitment_count,
      coalesce(sum(coalesce((commitment.data->>'committedAmount')::numeric, 0)), 0) committed_amount,
      count(*) filter (where commitment.status in ('approved', 'issued') and nullif(commitment.data->>'endDate', '')::date < p_snapshot_date)::integer past_due_commitments
    from public.project_commitments commitment
    where commitment.data->>'vendorId' = compliance.id and commitment.status <> 'void'
  ) commitment_metrics
  cross join lateral (
    select count(*)::integer warranty_assigned,
      count(*) filter (where warranty.status = 'completed')::integer warranty_completed,
      count(*) filter (where warranty.status in ('open', 'scheduled', 'in_progress') and nullif(warranty.data->>'dueDate', '')::date < p_snapshot_date)::integer warranty_overdue
    from public.project_warranty_items warranty
    where warranty.data->>'responsibleId' = compliance.id
  ) warranty_metrics;

  update public.management_reporting_snapshots snapshot set
    active_subcontractors = totals.active_count,
    compliant_subcontractors = totals.compliant_count,
    missing_general_liability = totals.missing_gl,
    missing_agreement = totals.missing_agreement,
    missing_w9 = totals.missing_w9
  from (
    with active_subs as (
      select sub.id, sub.data, lower(coalesce(sub.data->>'companyType', '')) as company_type
      from public.subs sub where coalesce(nullif(sub.data->>'inactive', '')::boolean, false) = false
    ), status as (
      select active_subs.id,
        exists (select 1 from public.insurance_certificates certificate join public.insurance_certificate_coverages coverage on coverage.certificate_id = certificate.id where certificate.subcontractor_id = active_subs.id and coverage.coverage_type = 'general_liability' and coalesce(coverage.expiration_date, certificate.expiration_date) >= p_snapshot_date) as has_gl,
        exists (select 1 from public.subcontractor_compliance_documents document where document.subcontractor_id = active_subs.id and document.document_type = 'subcontractor_agreement' and document.source_path <> '') as has_agreement,
        case when active_subs.company_type <> '' and active_subs.company_type !~ '(individual|sole proprietor|single.member llc|^limited liability company|^llc)' then true when active_subs.company_type = '' and coalesce(nullif(active_subs.data->>'is1099Exempt', '')::boolean, false) then true else exists (select 1 from public.subcontractor_compliance_documents document where document.subcontractor_id = active_subs.id and document.document_type = 'w9' and document.source_path <> '') end as has_w9
      from active_subs
    ) select count(*)::integer active_count, count(*) filter (where has_gl and has_agreement and has_w9)::integer compliant_count, count(*) filter (where not has_gl)::integer missing_gl, count(*) filter (where not has_agreement)::integer missing_agreement, count(*) filter (where not has_w9)::integer missing_w9 from status
  ) totals where snapshot.id = target_snapshot_id;

  select jsonb_build_object('id', snapshot.id, 'snapshotDate', snapshot.snapshot_date, 'activeSubcontractors', snapshot.active_subcontractors, 'compliantSubcontractors', snapshot.compliant_subcontractors, 'capturedAt', snapshot.captured_at) into summary
  from public.management_reporting_snapshots snapshot where snapshot.id = target_snapshot_id;
  return summary;
end;
$$;

revoke all on function public.capture_management_reporting_snapshot(date) from public, anon;
grant execute on function public.capture_management_reporting_snapshot(date) to authenticated;
grant execute on function public.capture_management_reporting_snapshot(date) to service_role;

create table if not exists public.management_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null references public.management_reporting_snapshots(snapshot_date) on delete cascade,
  schedule text not null check (schedule in ('weekly', 'monthly')),
  recipient_email text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed', 'unconfigured')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, schedule, recipient_email)
);
alter table public.management_report_deliveries enable row level security;
revoke all on public.management_report_deliveries from public, anon, authenticated;
grant select, insert, update on public.management_report_deliveries to service_role;
drop trigger if exists enforce_application_write_freeze on public.management_report_deliveries;
create trigger enforce_application_write_freeze before insert or update or delete on public.management_report_deliveries
for each statement execute function private.enforce_application_write_freeze();

create or replace function public.claim_management_report_delivery(p_snapshot_date date, p_schedule text, p_recipient_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed public.management_report_deliveries%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if;
  if p_schedule not in ('weekly', 'monthly') or lower(trim(p_recipient_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Invalid scheduled report delivery.' using errcode = '22023'; end if;
  insert into public.management_report_deliveries (snapshot_date, schedule, recipient_email)
  values (p_snapshot_date, p_schedule, lower(trim(p_recipient_email))) on conflict do nothing;
  update public.management_report_deliveries set attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now(), delivery_status = 'pending'
  where snapshot_date = p_snapshot_date and schedule = p_schedule and recipient_email = lower(trim(p_recipient_email))
    and delivery_status <> 'sent' and (last_attempt_at is null or last_attempt_at < now() - interval '15 minutes') returning * into claimed;
  return case when claimed.id is null then null else to_jsonb(claimed) end;
end; $$;
revoke all on function public.claim_management_report_delivery(date,text,text) from public, anon, authenticated;
grant execute on function public.claim_management_report_delivery(date,text,text) to service_role;

comment on table public.management_reporting_snapshots is 'Admin-only dated compliance totals used for accurate portfolio trend reporting.';
comment on table public.management_reporting_subcontractor_snapshots is 'Admin-only dated subcontractor workload and outcome measures; no composite score is inferred.';
comment on table public.management_report_deliveries is 'Service-only idempotency and retry ledger for scheduled administrator report email delivery.';
