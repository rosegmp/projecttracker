create table if not exists public.subcontractor_tax_identifiers (
  subcontractor_id text primary key references public.subs(id) on delete restrict,
  encrypted_tax_id text not null,
  encryption_iv text not null,
  encryption_key_version smallint not null default 1 check (encryption_key_version > 0),
  tax_id_last_four text not null check (tax_id_last_four ~ '^[0-9]{4}$'),
  tax_id_type text not null check (tax_id_type in ('ein', 'ssn', 'unknown')),
  legal_name text not null default '',
  business_name text not null default '',
  mailing_address text not null default '',
  source text not null check (source in ('w9_extraction', 'manual')),
  extraction_confidence text not null default '' check (extraction_confidence in ('', 'High', 'Medium', 'Low')),
  version bigint not null default 1 check (version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_subcontractor_tax_identifier_metadata()
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

drop trigger if exists subcontractor_tax_identifier_metadata_trigger on public.subcontractor_tax_identifiers;
create trigger subcontractor_tax_identifier_metadata_trigger
before insert or update on public.subcontractor_tax_identifiers
for each row execute function public.set_subcontractor_tax_identifier_metadata();

alter table public.subcontractor_tax_identifiers enable row level security;

revoke all on public.subcontractor_tax_identifiers from public, anon, authenticated;

create or replace function public.get_subcontractor_tax_id_statuses()
returns table (
  subcontractor_id text,
  tax_id_last_four text,
  tax_id_type text,
  legal_name text,
  business_name text,
  mailing_address text,
  source text,
  extraction_confidence text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if coalesce(public.current_app_user_role(), '') not in ('Admin', 'Edit', 'View Only') then
    raise exception 'You do not have permission to view subcontractor tax ID status.' using errcode = '42501';
  end if;
  return query
  select
    identifier.subcontractor_id,
    identifier.tax_id_last_four,
    identifier.tax_id_type,
    identifier.legal_name,
    identifier.business_name,
    identifier.mailing_address,
    identifier.source,
    identifier.extraction_confidence,
    identifier.updated_at
  from public.subcontractor_tax_identifiers identifier
  order by identifier.subcontractor_id;
end;
$$;

revoke all on function public.get_subcontractor_tax_id_statuses() from public, anon;
grant execute on function public.get_subcontractor_tax_id_statuses() to authenticated;

drop trigger if exists enforce_application_write_freeze on public.subcontractor_tax_identifiers;
create trigger enforce_application_write_freeze
before insert or update or delete on public.subcontractor_tax_identifiers
for each statement execute function private.enforce_application_write_freeze();

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in (
  'project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal',
  'budget_item', 'commitment', 'portal_item', 'warranty_item', 'closeout_item',
  'insurance_certificate', 'certificate_renewal', 'subcontractor_compliance_document',
  'subcontractor_tax_identifier'
));

create or replace function public.record_subcontractor_tax_identifier_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.subcontractor_tax_identifiers%rowtype := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.audit_events (
    actor_user_id, actor_email, entity_type, entity_id, action, before_data, after_data
  ) values (
    source_row.updated_by,
    '',
    'subcontractor_tax_identifier',
    source_row.subcontractor_id,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('source', old.source, 'version', old.version) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('source', new.source, 'version', new.version) end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists subcontractor_tax_identifier_audit_trigger on public.subcontractor_tax_identifiers;
create trigger subcontractor_tax_identifier_audit_trigger
after insert or update or delete on public.subcontractor_tax_identifiers
for each row execute function public.record_subcontractor_tax_identifier_audit_event();
