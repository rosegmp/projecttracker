create table if not exists public.vendor_1099_payer_profiles (
  id boolean primary key default true check (id),
  legal_name text not null default '' check (char_length(legal_name) <= 240),
  business_name text not null default '' check (char_length(business_name) <= 240),
  mailing_address text not null default '' check (char_length(mailing_address) <= 500),
  phone text not null default '' check (char_length(phone) <= 40),
  contact_email text not null default '' check (char_length(contact_email) <= 254),
  encrypted_tax_id text not null default '',
  encryption_iv text not null default '',
  encryption_key_version smallint not null default 1,
  tax_id_last_four text not null default '' check (tax_id_last_four = '' or tax_id_last_four ~ '^[0-9]{4}$'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_1099_filing_batches (
  id uuid primary key default gen_random_uuid(),
  tax_year smallint not null check (tax_year between 2000 and 2100),
  status text not null default 'draft' check (status in ('draft', 'ready', 'submitted', 'accepted', 'rejected', 'corrected')),
  federal_method text not null default 'iris_portal' check (federal_method in ('iris_portal', 'iris_a2a')),
  new_jersey_method text not null default 'nj_upload' check (new_jersey_method in ('nj_upload', 'combined_federal_state', 'nj_axway')),
  federal_confirmation text not null default '' check (char_length(federal_confirmation) <= 240),
  new_jersey_confirmation text not null default '' check (char_length(new_jersey_confirmation) <= 240),
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_1099_forms (
  id uuid primary key,
  batch_id uuid not null references public.vendor_1099_filing_batches(id) on delete cascade,
  subcontractor_id text not null references public.subs(id) on delete restrict,
  form_type text not null default '1099-NEC' check (form_type = '1099-NEC'),
  compensation numeric(14,2) not null check (compensation >= 0),
  vendor_name text not null check (char_length(vendor_name) between 1 and 240),
  vendor_address text not null check (char_length(vendor_address) between 1 and 500),
  recipient_email text not null default '' check (char_length(recipient_email) <= 254),
  encrypted_tax_id text not null,
  encryption_iv text not null,
  encryption_key_version smallint not null default 1,
  tax_id_last_four text not null check (tax_id_last_four ~ '^[0-9]{4}$'),
  federal_status text not null default 'not_submitted' check (federal_status in ('not_submitted', 'submitted', 'accepted', 'rejected', 'corrected')),
  new_jersey_status text not null default 'not_submitted' check (new_jersey_status in ('not_submitted', 'submitted', 'accepted', 'rejected', 'corrected', 'not_required')),
  delivery_status text not null default 'paper_required' check (delivery_status in ('paper_required', 'consent_requested', 'consented', 'available', 'delivered', 'withdrawn', 'failed')),
  created_at timestamptz not null default now(),
  unique (batch_id, subcontractor_id)
);

create index if not exists vendor_1099_batches_year_idx on public.vendor_1099_filing_batches(tax_year, created_at desc);
create index if not exists vendor_1099_forms_batch_idx on public.vendor_1099_forms(batch_id, vendor_name);

alter table public.vendor_1099_payer_profiles enable row level security;
alter table public.vendor_1099_filing_batches enable row level security;
alter table public.vendor_1099_forms enable row level security;

revoke all on public.vendor_1099_payer_profiles from public, anon, authenticated;
revoke all on public.vendor_1099_filing_batches from public, anon, authenticated;
revoke all on public.vendor_1099_forms from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_1099_payer_profiles to service_role;
grant select, insert, update, delete on public.vendor_1099_filing_batches to service_role;
grant select, insert, update, delete on public.vendor_1099_forms to service_role;

drop trigger if exists enforce_application_write_freeze on public.vendor_1099_payer_profiles;
create trigger enforce_application_write_freeze before insert or update or delete on public.vendor_1099_payer_profiles
for each statement execute function private.enforce_application_write_freeze();
drop trigger if exists enforce_application_write_freeze on public.vendor_1099_filing_batches;
create trigger enforce_application_write_freeze before insert or update or delete on public.vendor_1099_filing_batches
for each statement execute function private.enforce_application_write_freeze();
drop trigger if exists enforce_application_write_freeze on public.vendor_1099_forms;
create trigger enforce_application_write_freeze before insert or update or delete on public.vendor_1099_forms
for each statement execute function private.enforce_application_write_freeze();

comment on table public.vendor_1099_payer_profiles is 'Service-role-only payer identity; the complete EIN is encrypted and never exposed through PostgREST.';
comment on table public.vendor_1099_filing_batches is 'Administrator-created, year-specific 1099 filing batches with separate federal and New Jersey acknowledgement state.';
comment on table public.vendor_1099_forms is 'Immutable vendor identity and encrypted TIN snapshots used to prepare and deliver one batch of 1099-NEC forms.';
