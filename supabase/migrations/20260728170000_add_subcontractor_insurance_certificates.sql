create table if not exists public.insurance_certificates (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id text not null references public.subs(id) on delete restrict,
  holder text not null default '',
  insured text not null default '',
  insurer text not null default '',
  policy_number text not null default '',
  effective_date date,
  expiration_date date,
  additional_insured boolean not null default false,
  source_file_name text not null default '',
  source_bucket text not null default '',
  source_path text not null default '',
  extraction_confidence text not null default ''
    check (extraction_confidence in ('', 'High', 'Medium', 'Low')),
  extraction_notes text not null default '',
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.insurance_certificate_coverages (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.insurance_certificates(id) on delete cascade,
  coverage_type text not null,
  coverage_amount numeric(14, 2) not null default 0 check (coverage_amount >= 0),
  aggregate_amount numeric(14, 2) not null default 0 check (aggregate_amount >= 0),
  effective_date date,
  expiration_date date,
  position integer not null default 0 check (position >= 0),
  unique (certificate_id, id)
);

create index if not exists insurance_certificates_subcontractor_expiration_idx
  on public.insurance_certificates (subcontractor_id, expiration_date, updated_at desc);
create index if not exists insurance_certificates_expiration_idx
  on public.insurance_certificates (expiration_date, updated_at desc);
create index if not exists insurance_certificate_coverages_certificate_position_idx
  on public.insurance_certificate_coverages (certificate_id, position, id);

update public.settings
set data = jsonb_set(
  data,
  '{visibleTopLevelTabs}',
  (data->'visibleTopLevelTabs') || '"certificates"'::jsonb,
  true
)
where id = 'app_settings'
  and jsonb_typeof(data->'visibleTopLevelTabs') = 'array'
  and not (data->'visibleTopLevelTabs' @> '["certificates"]'::jsonb);

create or replace function public.set_insurance_certificate_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
  else
    new.version := old.version + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists insurance_certificates_metadata_trigger on public.insurance_certificates;
create trigger insurance_certificates_metadata_trigger
before insert or update on public.insurance_certificates
for each row execute function public.set_insurance_certificate_metadata();

alter table public.insurance_certificates enable row level security;
alter table public.insurance_certificate_coverages enable row level security;

drop policy if exists "Internal users can read insurance certificates" on public.insurance_certificates;
create policy "Internal users can read insurance certificates"
  on public.insurance_certificates for select to authenticated
  using (coalesce(public.current_app_user_role(), '') in ('Admin', 'Edit', 'View Only'));

drop policy if exists "Internal users can read insurance certificate coverages" on public.insurance_certificate_coverages;
create policy "Internal users can read insurance certificate coverages"
  on public.insurance_certificate_coverages for select to authenticated
  using (
    coalesce(public.current_app_user_role(), '') in ('Admin', 'Edit', 'View Only')
    and exists (
      select 1
      from public.insurance_certificates certificate
      where certificate.id = insurance_certificate_coverages.certificate_id
    )
  );

revoke all on public.insurance_certificates, public.insurance_certificate_coverages from anon;
revoke insert, update, delete on public.insurance_certificates, public.insurance_certificate_coverages from authenticated;
grant select on public.insurance_certificates, public.insurance_certificate_coverages to authenticated;

create or replace function public.save_insurance_certificate(
  p_certificate jsonb,
  p_coverages jsonb default '[]'::jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_certificate_id uuid;
  saved_certificate public.insurance_certificates%rowtype;
  coverage jsonb;
  coverage_position integer := 0;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit insurance certificates.' using errcode = '42501';
  end if;

  target_certificate_id := coalesce(nullif(p_certificate->>'id', '')::uuid, gen_random_uuid());

  if not exists (
    select 1 from public.subs where id = nullif(trim(p_certificate->>'subcontractorId'), '')
  ) then
    raise exception 'Select a valid subcontractor.' using errcode = '23503';
  end if;

  if p_expected_version is null then
    if exists (select 1 from public.insurance_certificates where id = target_certificate_id) then
      raise exception 'Insurance certificate already exists.' using errcode = '23505';
    end if;

    insert into public.insurance_certificates (
      id,
      subcontractor_id,
      holder,
      insured,
      insurer,
      policy_number,
      effective_date,
      expiration_date,
      additional_insured,
      source_file_name,
      source_bucket,
      source_path,
      extraction_confidence,
      extraction_notes
    )
    values (
      target_certificate_id,
      trim(p_certificate->>'subcontractorId'),
      trim(coalesce(p_certificate->>'holder', '')),
      trim(coalesce(p_certificate->>'insured', '')),
      trim(coalesce(p_certificate->>'insurer', '')),
      trim(coalesce(p_certificate->>'policyNumber', '')),
      nullif(p_certificate->>'effectiveDate', '')::date,
      nullif(p_certificate->>'expirationDate', '')::date,
      coalesce((p_certificate->>'additionalInsured')::boolean, false),
      trim(coalesce(p_certificate->>'sourceFileName', '')),
      trim(coalesce(p_certificate->>'sourceBucket', '')),
      trim(coalesce(p_certificate->>'sourcePath', '')),
      case
        when p_certificate->>'extractionConfidence' in ('High', 'Medium', 'Low')
          then p_certificate->>'extractionConfidence'
        else ''
      end,
      trim(coalesce(p_certificate->>'extractionNotes', ''))
    )
    returning * into saved_certificate;
  else
    update public.insurance_certificates
    set
      subcontractor_id = trim(p_certificate->>'subcontractorId'),
      holder = trim(coalesce(p_certificate->>'holder', '')),
      insured = trim(coalesce(p_certificate->>'insured', '')),
      insurer = trim(coalesce(p_certificate->>'insurer', '')),
      policy_number = trim(coalesce(p_certificate->>'policyNumber', '')),
      effective_date = nullif(p_certificate->>'effectiveDate', '')::date,
      expiration_date = nullif(p_certificate->>'expirationDate', '')::date,
      additional_insured = coalesce((p_certificate->>'additionalInsured')::boolean, false),
      source_file_name = trim(coalesce(p_certificate->>'sourceFileName', '')),
      source_bucket = trim(coalesce(p_certificate->>'sourceBucket', '')),
      source_path = trim(coalesce(p_certificate->>'sourcePath', '')),
      extraction_confidence = case
        when p_certificate->>'extractionConfidence' in ('High', 'Medium', 'Low')
          then p_certificate->>'extractionConfidence'
        else ''
      end,
      extraction_notes = trim(coalesce(p_certificate->>'extractionNotes', ''))
    where id = target_certificate_id
      and version = p_expected_version
    returning * into saved_certificate;

    if saved_certificate.id is null then
      raise exception 'VERSION_CONFLICT: This insurance certificate changed after it was opened.' using errcode = '40001';
    end if;

    delete from public.insurance_certificate_coverages
    where insurance_certificate_coverages.certificate_id = target_certificate_id;
  end if;

  if jsonb_typeof(coalesce(p_coverages, '[]'::jsonb)) <> 'array' then
    raise exception 'Certificate coverages must be an array.' using errcode = '22023';
  end if;

  for coverage in select value from jsonb_array_elements(coalesce(p_coverages, '[]'::jsonb))
  loop
    if nullif(trim(coverage->>'type'), '') is null then
      continue;
    end if;
    insert into public.insurance_certificate_coverages (
      id,
      certificate_id,
      coverage_type,
      coverage_amount,
      aggregate_amount,
      effective_date,
      expiration_date,
      position
    )
    values (
      coalesce(nullif(coverage->>'id', '')::uuid, gen_random_uuid()),
      target_certificate_id,
      trim(coverage->>'type'),
      greatest(coalesce(nullif(coverage->>'generalLimit', '')::numeric, nullif(coverage->>'amount', '')::numeric, 0), 0),
      greatest(coalesce(nullif(coverage->>'aggregateLimit', '')::numeric, 0), 0),
      nullif(coverage->>'effectiveDate', '')::date,
      nullif(coverage->>'expirationDate', '')::date,
      coverage_position
    );
    coverage_position := coverage_position + 1;
  end loop;

  return to_jsonb(saved_certificate) || jsonb_build_object(
    'coverages',
    coalesce(
      (
        select jsonb_agg(to_jsonb(item) order by item.position, item.id)
        from public.insurance_certificate_coverages item
        where item.certificate_id = saved_certificate.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.delete_insurance_certificate(
  p_certificate_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_certificate public.insurance_certificates%rowtype;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to delete insurance certificates.' using errcode = '42501';
  end if;

  delete from public.insurance_certificates
  where id = p_certificate_id
    and version = p_expected_version
  returning * into deleted_certificate;

  if deleted_certificate.id is null then
    raise exception 'VERSION_CONFLICT: This insurance certificate changed after it was opened.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'id', deleted_certificate.id,
    'sourceBucket', deleted_certificate.source_bucket,
    'sourcePath', deleted_certificate.source_path
  );
end;
$$;

revoke all on function public.save_insurance_certificate(jsonb, jsonb, bigint) from public, anon;
revoke all on function public.delete_insurance_certificate(uuid, bigint) from public, anon;
grant execute on function public.save_insurance_certificate(jsonb, jsonb, bigint) to authenticated;
grant execute on function public.delete_insurance_certificate(uuid, bigint) to authenticated;

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
  'insurance_certificate'
));

create or replace function public.record_insurance_certificate_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events (
    actor_user_id,
    actor_email,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data
  )
  values (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'insurance_certificate',
    source_row->>'id',
    lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('id', old.id, 'version', old.version) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('id', new.id, 'version', new.version) end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists insurance_certificates_audit_trigger on public.insurance_certificates;
create trigger insurance_certificates_audit_trigger
after insert or update or delete on public.insurance_certificates
for each row execute function public.record_insurance_certificate_audit_event();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificate-files',
  'certificate-files',
  false,
  15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Internal users can read certificate files" on storage.objects;
create policy "Internal users can read certificate files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'certificate-files'
    and coalesce(public.current_app_user_role(), '') in ('Admin', 'Edit', 'View Only')
  );

drop policy if exists "Certificate editors can upload files" on storage.objects;
create policy "Certificate editors can upload files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'certificate-files'
    and public.app_user_can_edit()
    and (storage.foldername(name))[1] = 'certificates'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Certificate editors can replace files" on storage.objects;
create policy "Certificate editors can replace files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'certificate-files'
    and public.app_user_can_edit()
  )
  with check (
    bucket_id = 'certificate-files'
    and public.app_user_can_edit()
  );

drop policy if exists "Certificate editors can delete files" on storage.objects;
create policy "Certificate editors can delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'certificate-files'
    and public.app_user_can_edit()
  );
