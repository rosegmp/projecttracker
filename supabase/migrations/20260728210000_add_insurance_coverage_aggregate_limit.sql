alter table public.insurance_certificate_coverages
  add column if not exists aggregate_amount numeric(14, 2) not null default 0
  check (aggregate_amount >= 0);

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

revoke all on function public.save_insurance_certificate(jsonb, jsonb, bigint) from public, anon;
grant execute on function public.save_insurance_certificate(jsonb, jsonb, bigint) to authenticated;
