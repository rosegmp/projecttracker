create table if not exists public.vendor_1099_import_rows (
  id uuid primary key default gen_random_uuid(),
  tax_year smallint not null check (tax_year between 2000 and 2100),
  position integer not null check (position >= 0),
  vendor_name text not null check (char_length(vendor_name) between 1 and 240),
  tax_id_last_four text not null default '' check (tax_id_last_four = '' or tax_id_last_four ~ '^[0-9]{4}$'),
  reportable_total numeric(14, 2) not null check (reportable_total >= 0),
  subcontractor_id text references public.subs(id) on delete set null,
  source_file_name text not null default '' check (char_length(source_file_name) <= 240),
  imported_by uuid not null default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (tax_year, position)
);

create index if not exists vendor_1099_import_year_idx
  on public.vendor_1099_import_rows (tax_year, position);

alter table public.vendor_1099_import_rows enable row level security;

revoke all on public.vendor_1099_import_rows from public, anon, authenticated;
grant select on public.vendor_1099_import_rows to authenticated;
grant select, insert, update, delete on public.vendor_1099_import_rows to service_role;

drop policy if exists "Administrators can read 1099 imports" on public.vendor_1099_import_rows;
create policy "Administrators can read 1099 imports"
on public.vendor_1099_import_rows
for select to authenticated
using (public.current_app_user_role() = 'Admin');

drop trigger if exists enforce_application_write_freeze on public.vendor_1099_import_rows;
create trigger enforce_application_write_freeze
before insert or update or delete on public.vendor_1099_import_rows
for each statement execute function private.enforce_application_write_freeze();

create or replace function public.replace_vendor_1099_import(
  p_tax_year integer,
  p_source_file_name text,
  p_rows jsonb
)
returns setof public.vendor_1099_import_rows
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_file_name text := left(trim(coalesce(p_source_file_name, '')), 240);
  row_count integer;
begin
  if public.current_app_user_role() <> 'Admin' then
    raise exception 'Only administrators can import 1099 payments.' using errcode = '42501';
  end if;
  if p_tax_year < 2000 or p_tax_year > extract(year from current_date)::integer + 1 then
    raise exception 'Select a valid tax year.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The imported rows must be an array.' using errcode = '22023';
  end if;
  row_count := jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 500 then
    raise exception 'The spreadsheet must contain between 1 and 500 vendor rows.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where trim(coalesce(item->>'vendor_name', '')) = ''
      or char_length(trim(item->>'vendor_name')) > 240
      or coalesce(item->>'tax_id_last_four', '') !~ '^([0-9]{4})?$'
      or case
        when coalesce(item->>'reportable_total', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
          then (item->>'reportable_total')::numeric < 0
        else true
      end
  ) then
    raise exception 'One or more imported 1099 rows are invalid.' using errcode = '22023';
  end if;

  delete from public.vendor_1099_import_rows where tax_year = p_tax_year;
  insert into public.vendor_1099_import_rows (
    tax_year, position, vendor_name, tax_id_last_four, reportable_total,
    subcontractor_id, source_file_name, imported_by
  )
  select
    p_tax_year,
    item.ordinality - 1,
    left(trim(item.value->>'vendor_name'), 240),
    coalesce(item.value->>'tax_id_last_four', ''),
    round((item.value->>'reportable_total')::numeric, 2),
    case
      when coalesce(item.value->>'subcontractor_id', '') = '' then null
      when exists (select 1 from public.subs where id = item.value->>'subcontractor_id') then item.value->>'subcontractor_id'
      else null
    end,
    normalized_file_name,
    auth.uid()
  from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality);

  return query
  select imported.*
  from public.vendor_1099_import_rows imported
  where imported.tax_year = p_tax_year
  order by imported.position;
end
$$;

create or replace function public.set_vendor_1099_import_match(
  p_import_row_id uuid,
  p_subcontractor_id text
)
returns public.vendor_1099_import_rows
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_row public.vendor_1099_import_rows;
begin
  if public.current_app_user_role() <> 'Admin' then
    raise exception 'Only administrators can match imported 1099 vendors.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_subcontractor_id, '')), '') is not null
    and not exists (select 1 from public.subs where id = p_subcontractor_id) then
    raise exception 'Select a valid subcontractor.' using errcode = '22023';
  end if;
  update public.vendor_1099_import_rows
  set subcontractor_id = nullif(trim(coalesce(p_subcontractor_id, '')), '')
  where id = p_import_row_id
  returning * into updated_row;
  if updated_row.id is null then
    raise exception 'The imported 1099 row was not found.' using errcode = 'P0002';
  end if;
  return updated_row;
end
$$;

revoke all on function public.replace_vendor_1099_import(integer, text, jsonb) from public, anon;
revoke all on function public.set_vendor_1099_import_match(uuid, text) from public, anon;
grant execute on function public.replace_vendor_1099_import(integer, text, jsonb) to authenticated;
grant execute on function public.set_vendor_1099_import_match(uuid, text) to authenticated;

comment on table public.vendor_1099_import_rows is
  'Administrator-only normalized annual 1099 vendor totals imported from Excel. Only the tax ID last four digits are retained.';
comment on function public.replace_vendor_1099_import(integer, text, jsonb) is
  'Atomically replaces one tax year with a bounded, normalized Excel import after administrator authorization.';
