alter table public.vendor_1099_forms
  add column if not exists consent_token_hash text,
  add column if not exists consent_expires_at timestamptz,
  add column if not exists consent_requested_at timestamptz,
  add column if not exists consent_sample_accessed_at timestamptz,
  add column if not exists consented_at timestamptz,
  add column if not exists consent_name text not null default '' check (char_length(consent_name) <= 120),
  add column if not exists consent_email text not null default '' check (char_length(consent_email) <= 254),
  add column if not exists consent_scope text not null default '' check (consent_scope in ('', 'single_tax_year_pdf')),
  add column if not exists consent_disclosures jsonb not null default '{}'::jsonb,
  add column if not exists recipient_pdf_bucket text not null default '',
  add column if not exists recipient_pdf_path text not null default '',
  add column if not exists recipient_pdf_file_name text not null default '' check (char_length(recipient_pdf_file_name) <= 240),
  add column if not exists recipient_pdf_sha256 text not null default '' check (recipient_pdf_sha256 = '' or recipient_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists recipient_available_at timestamptz,
  add column if not exists recipient_notice_sent_at timestamptz,
  add column if not exists recipient_access_token_hash text,
  add column if not exists recipient_access_expires_at timestamptz,
  add column if not exists recipient_downloaded_at timestamptz,
  add column if not exists consent_withdrawn_at timestamptz,
  add column if not exists paper_copy_requested_at timestamptz,
  add column if not exists delivery_updated_by uuid;

create unique index if not exists vendor_1099_forms_consent_token_idx
  on public.vendor_1099_forms (consent_token_hash)
  where consent_token_hash is not null;
create unique index if not exists vendor_1099_forms_access_token_idx
  on public.vendor_1099_forms (recipient_access_token_hash)
  where recipient_access_token_hash is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-tax-documents', 'vendor-tax-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

drop policy if exists "Application users cannot read vendor tax documents" on storage.objects;
create policy "Application users cannot read vendor tax documents"
  on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'vendor-tax-documents');
drop policy if exists "Application users cannot insert vendor tax documents" on storage.objects;
create policy "Application users cannot insert vendor tax documents"
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'vendor-tax-documents');
drop policy if exists "Application users cannot update vendor tax documents" on storage.objects;
create policy "Application users cannot update vendor tax documents"
  on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'vendor-tax-documents')
  with check (bucket_id <> 'vendor-tax-documents');
drop policy if exists "Application users cannot delete vendor tax documents" on storage.objects;
create policy "Application users cannot delete vendor tax documents"
  on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'vendor-tax-documents');

comment on column public.vendor_1099_forms.consent_sample_accessed_at is
  'Records that the recipient accessed a PDF through the same secure delivery channel before affirmative electronic-delivery consent.';
comment on column public.vendor_1099_forms.consent_disclosures is
  'Immutable tax-year-specific Publication 1179 electronic-delivery disclosures shown before consent.';
comment on column public.vendor_1099_forms.recipient_pdf_path is
  'Service-only private Storage path for the official recipient copy downloaded from IRIS or supplied by the tax preparer.';
comment on column public.vendor_1099_forms.recipient_access_expires_at is
  'Secure recipient availability deadline, no earlier than October 15 following the tax year or 90 days after posting.';
