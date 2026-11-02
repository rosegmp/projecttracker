-- Recovered from the applied production migration history.
create or replace function private.normalize_insurance_coverage_type()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  compact_type text := regexp_replace(lower(trim(new.coverage_type)), '[^a-z0-9]+', '', 'g');
begin
  if compact_type in ('cgl', 'generalliability', 'commercialgeneralliability') then
    new.coverage_type := 'general_liability';
  elsif compact_type in (
    'workerscomp',
    'workerscompensation',
    'workmanscomp',
    'workmanscompensation',
    'workmenscomp',
    'workmenscompensation'
  ) then
    new.coverage_type := 'workers_compensation';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_insurance_coverage_type() from public, anon, authenticated;

drop trigger if exists normalize_insurance_coverage_type on public.insurance_certificate_coverages;

create trigger normalize_insurance_coverage_type
before insert or update of coverage_type on public.insurance_certificate_coverages
for each row execute function private.normalize_insurance_coverage_type();

update public.insurance_certificate_coverages
set coverage_type = case
  when regexp_replace(lower(trim(coverage_type)), '[^a-z0-9]+', '', 'g') in (
    'cgl',
    'generalliability',
    'commercialgeneralliability'
  ) then 'general_liability'
  else 'workers_compensation'
end
where regexp_replace(lower(trim(coverage_type)), '[^a-z0-9]+', '', 'g') in (
  'cgl',
  'generalliability',
  'commercialgeneralliability',
  'workerscomp',
  'workerscompensation',
  'workmanscomp',
  'workmanscompensation',
  'workmenscomp',
  'workmenscompensation'
);

comment on function private.normalize_insurance_coverage_type() is
  'Canonicalizes recognized liability and workers compensation coverage labels at the database boundary.';
