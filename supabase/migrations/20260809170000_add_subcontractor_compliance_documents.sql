create table if not exists public.subcontractor_compliance_documents (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id text not null references public.subs(id) on delete restrict,
  document_type text not null check (document_type in ('subcontractor_agreement', 'w9')),
  signed_date date not null,
  source_file_name text not null,
  source_bucket text not null default 'certificate-files',
  source_path text not null,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subcontractor_id, document_type)
);

create index if not exists subcontractor_compliance_documents_subcontractor_idx
  on public.subcontractor_compliance_documents (subcontractor_id, document_type);

create or replace function public.set_subcontractor_compliance_document_metadata()
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

drop trigger if exists subcontractor_compliance_document_metadata_trigger on public.subcontractor_compliance_documents;
create trigger subcontractor_compliance_document_metadata_trigger
before insert or update on public.subcontractor_compliance_documents
for each row execute function public.set_subcontractor_compliance_document_metadata();

alter table public.subcontractor_compliance_documents enable row level security;

drop policy if exists "Internal users can read subcontractor compliance documents" on public.subcontractor_compliance_documents;
create policy "Internal users can read subcontractor compliance documents"
  on public.subcontractor_compliance_documents for select to authenticated
  using (coalesce(public.current_app_user_role(), '') in ('Admin', 'Edit', 'View Only'));

revoke all on public.subcontractor_compliance_documents from anon;
revoke insert, update, delete on public.subcontractor_compliance_documents from authenticated;
grant select on public.subcontractor_compliance_documents to authenticated;

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
  if nullif(p_document->>'signedDate', '') is null then
    raise exception 'Enter the document signed date.' using errcode = '22023';
  end if;
  if nullif(trim(p_document->>'sourcePath'), '') is null
    or coalesce(p_document->>'sourceBucket', '') <> 'certificate-files'
    or split_part(p_document->>'sourcePath', '/', 1) <> 'certificates'
  then
    raise exception 'Upload a valid compliance document file.' using errcode = '22023';
  end if;

  if p_expected_version is null then
    insert into public.subcontractor_compliance_documents (
      id,
      subcontractor_id,
      document_type,
      signed_date,
      source_file_name,
      source_bucket,
      source_path
    ) values (
      target_id,
      target_subcontractor_id,
      target_type,
      (p_document->>'signedDate')::date,
      trim(coalesce(p_document->>'sourceFileName', '')),
      p_document->>'sourceBucket',
      p_document->>'sourcePath'
    )
    returning * into saved_document;
  else
    update public.subcontractor_compliance_documents
    set
      signed_date = (p_document->>'signedDate')::date,
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

create or replace function public.delete_subcontractor_compliance_document(
  p_document_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_document public.subcontractor_compliance_documents%rowtype;
begin
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to delete subcontractor compliance documents.' using errcode = '42501';
  end if;
  delete from public.subcontractor_compliance_documents
  where id = p_document_id
    and version = p_expected_version
  returning * into deleted_document;
  if deleted_document.id is null then
    raise exception 'VERSION_CONFLICT: This compliance document changed after it was opened.' using errcode = '40001';
  end if;
  return to_jsonb(deleted_document);
end;
$$;

revoke all on function public.save_subcontractor_compliance_document(jsonb, bigint) from public, anon;
revoke all on function public.delete_subcontractor_compliance_document(uuid, bigint) from public, anon;
grant execute on function public.save_subcontractor_compliance_document(jsonb, bigint) to authenticated;
grant execute on function public.delete_subcontractor_compliance_document(uuid, bigint) to authenticated;

drop trigger if exists enforce_application_write_freeze on public.subcontractor_compliance_documents;
create trigger enforce_application_write_freeze
before insert or update or delete on public.subcontractor_compliance_documents
for each statement execute function private.enforce_application_write_freeze();

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in (
  'project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal',
  'budget_item', 'commitment', 'portal_item', 'warranty_item', 'closeout_item',
  'insurance_certificate', 'certificate_renewal', 'subcontractor_compliance_document'
));

create or replace function public.record_subcontractor_compliance_document_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events (
    actor_user_id, actor_email, entity_type, entity_id, action, before_data, after_data
  ) values (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'subcontractor_compliance_document',
    source_row->>'id',
    lower(tg_op),
    case when tg_op = 'INSERT' then null else jsonb_build_object('documentType', old.document_type, 'version', old.version) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('documentType', new.document_type, 'version', new.version) end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists subcontractor_compliance_document_audit_trigger on public.subcontractor_compliance_documents;
create trigger subcontractor_compliance_document_audit_trigger
after insert or update or delete on public.subcontractor_compliance_documents
for each row execute function public.record_subcontractor_compliance_document_audit_event();
