create or replace function public.compact_audit_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  compacted jsonb;
begin
  if p_value is null then
    return null;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(entry.key, public.compact_audit_json(entry.value)),
        '{}'::jsonb
      )
      into compacted
      from jsonb_each(p_value) entry
      where lower(entry.key) not in (
        'dataurl',
        'pdfdatabase64',
        'base64',
        'thumbnaildataurl',
        'previewdataurl',
        'objecturl',
        'bloburl',
        'bytes'
      );
      return compacted;
    when 'array' then
      select coalesce(
        jsonb_agg(public.compact_audit_json(entry.value) order by entry.ordinality),
        '[]'::jsonb
      )
      into compacted
      from jsonb_array_elements(p_value) with ordinality entry(value, ordinality);
      return compacted;
    else
      return p_value;
  end case;
end;
$$;

create or replace function public.takeoff_audit_summary(
  p_id text,
  p_name text,
  p_pdf_name text,
  p_snapshot jsonb,
  p_version bigint
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_id,
    'name', nullif(p_name, ''),
    'pdfName', nullif(p_pdf_name, ''),
    'version', p_version,
    'measurementCount', jsonb_array_length(coalesce(p_snapshot->'measurements', '[]'::jsonb)),
    'markupCount', jsonb_array_length(coalesce(p_snapshot->'markups', '[]'::jsonb))
  ))
$$;

create or replace function public.record_takeoff_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.snapshot is not distinct from new.snapshot and old.name is not distinct from new.name then
    return new;
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_email,
    entity_type,
    entity_id,
    project_id,
    action,
    before_data,
    after_data
  ) values (
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'takeoff',
    coalesce(new.id, old.id),
    coalesce(new.project_id, old.project_id),
    lower(tg_op),
    case when tg_op = 'INSERT' then null else public.takeoff_audit_summary(old.id, old.name, old.pdf_name, old.snapshot, old.version) end,
    case when tg_op = 'DELETE' then null else public.takeoff_audit_summary(new.id, new.name, new.pdf_name, new.snapshot, new.version) end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

update public.audit_events
set
  before_data = case
    when entity_type = 'takeoff' and before_data ? 'snapshot' then public.takeoff_audit_summary(
      entity_id,
      coalesce(before_data->>'name', ''),
      coalesce(before_data#>>'{snapshot,pdfName}', ''),
      coalesce(before_data->'snapshot', '{}'::jsonb),
      coalesce(nullif(before_data->>'version', '')::bigint, 0)
    )
    else public.compact_audit_json(before_data)
  end,
  after_data = case
    when entity_type = 'takeoff' and after_data ? 'snapshot' then public.takeoff_audit_summary(
      entity_id,
      coalesce(after_data->>'name', ''),
      coalesce(after_data#>>'{snapshot,pdfName}', ''),
      coalesce(after_data->'snapshot', '{}'::jsonb),
      coalesce(nullif(after_data->>'version', '')::bigint, 0)
    )
    else public.compact_audit_json(after_data)
  end
where
  entity_type = 'takeoff'
  or before_data is not null
  or after_data is not null;

create index if not exists audit_events_project_cursor_idx
  on public.audit_events (project_id, id desc);

create index if not exists audit_events_entity_type_cursor_idx
  on public.audit_events (entity_type, id desc);

create or replace function public.get_audit_events(
  p_limit integer default 50,
  p_before_id bigint default null,
  p_project_id text default '',
  p_entity_type text default '',
  p_since timestamptz default null
)
returns table (
  id bigint,
  created_at timestamptz,
  actor_user_id uuid,
  actor_email text,
  entity_type text,
  entity_id text,
  project_id text,
  action text,
  before_data jsonb,
  after_data jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    event.id,
    event.created_at,
    event.actor_user_id,
    event.actor_email,
    event.entity_type,
    event.entity_id,
    event.project_id,
    event.action,
    public.compact_audit_json(event.before_data),
    public.compact_audit_json(event.after_data)
  from public.audit_events event
  where public.is_app_user()
    and (
      coalesce(event.project_id, '') = ''
      or public.app_user_can_view_project(event.project_id)
    )
    and (p_before_id is null or event.id < p_before_id)
    and (coalesce(p_project_id, '') = '' or event.project_id = p_project_id)
    and (coalesce(p_entity_type, '') = '' or event.entity_type = p_entity_type)
    and (p_since is null or event.created_at >= p_since)
  order by event.id desc
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

revoke all on function public.compact_audit_json(jsonb) from public, anon, authenticated;
revoke all on function public.takeoff_audit_summary(text, text, text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.get_audit_events(integer, bigint, text, text, timestamptz) from public, anon;
grant execute on function public.get_audit_events(integer, bigint, text, text, timestamptz) to authenticated;
