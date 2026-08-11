create or replace function public.save_subcontractor_compliance_document(
  p_document jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid := coalesce(nullif(p_document->>'id', '')::uuid, gen_random_uuid());
  target_subcontractor_id text := nullif(trim(p_document->>'subcontractorId'), '');
  target_type text := trim(coalesce(p_document->>'documentType', ''));
  target_signed_date date := nullif(trim(p_document->>'signedDate'), '')::date;
  saved_document public.subcontractor_compliance_documents%rowtype;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit subcontractor compliance documents.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subs where id = target_subcontractor_id) then
    raise exception 'Select a valid subcontractor.' using errcode = '23503';
  end if;
  if target_type not in ('subcontractor_agreement', 'w9') then
    raise exception 'Select a valid compliance document type.' using errcode = '22023';
  end if;
  if nullif(trim(p_document->>'sourcePath'), '') is null
    or coalesce(p_document->>'sourceBucket', '') <> 'certificate-files'
    or split_part(p_document->>'sourcePath', '/', 1) <> 'certificates'
  then
    raise exception 'Upload a valid compliance document file.' using errcode = '22023';
  end if;

  if p_expected_version is null then
    insert into public.subcontractor_compliance_documents (
      id, subcontractor_id, document_type, signed_date, source_file_name, source_bucket, source_path
    ) values (
      target_id,
      target_subcontractor_id,
      target_type,
      target_signed_date,
      trim(coalesce(p_document->>'sourceFileName', '')),
      p_document->>'sourceBucket',
      p_document->>'sourcePath'
    )
    returning * into saved_document;
  else
    update public.subcontractor_compliance_documents
    set
      signed_date = target_signed_date,
      source_file_name = trim(coalesce(p_document->>'sourceFileName', '')),
      source_bucket = p_document->>'sourceBucket',
      source_path = p_document->>'sourcePath'
    where id = target_id
      and subcontractor_id = target_subcontractor_id
      and document_type = target_type
      and version = p_expected_version
    returning * into saved_document;

    if saved_document.id is null then
      raise exception 'VERSION_CONFLICT: This compliance document changed after it was opened.' using errcode = '40001';
    end if;
  end if;

  return to_jsonb(saved_document);
exception
  when unique_violation then
    raise exception 'A document of this type already exists for the subcontractor. Refresh before replacing it.' using errcode = '23505';
end;
$$;

revoke all on function public.save_subcontractor_compliance_document(jsonb, bigint) from public, anon;
grant execute on function public.save_subcontractor_compliance_document(jsonb, bigint) to authenticated;
