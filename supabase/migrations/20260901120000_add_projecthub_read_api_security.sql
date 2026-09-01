create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.projecthub_api_clients (
  id text primary key,
  label text not null,
  key_hash text check (key_hash is null or key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default array['projecthub.read'],
  allowed_project_ids text[] not null default '{}'::text[],
  enabled boolean not null default false,
  requests_per_minute integer not null default 60 check (requests_per_minute between 1 and 600),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create unique index if not exists projecthub_api_clients_key_hash_idx
  on private.projecthub_api_clients (key_hash)
  where key_hash is not null;
create table if not exists private.projecthub_api_rate_buckets (
  client_id text not null references private.projecthub_api_clients(id) on delete cascade,
  bucket_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (client_id, bucket_started_at)
);
create table if not exists private.projecthub_api_audit_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  client_id text references private.projecthub_api_clients(id) on delete set null,
  action text not null,
  resource text not null,
  status integer not null,
  outcome text not null,
  filter_names text[] not null default '{}'::text[],
  occurred_at timestamptz not null default now()
);
create index if not exists projecthub_api_audit_events_occurred_idx
  on private.projecthub_api_audit_events (occurred_at desc);
-- A disabled, secretless service-account record is safe to migrate. Provisioning
-- replaces key_hash and enables it; no credential or production data is committed.
insert into private.projecthub_api_clients (id, label, key_hash, enabled)
values ('chatgpt-daily-briefing', 'ChatGPT daily executive briefing', null, false)
on conflict (id) do nothing;
create or replace function public.projecthub_authorize_api_request(
  p_key_hash text,
  p_request_id text,
  p_action text,
  p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  api_client private.projecthub_api_clients%rowtype;
  bucket_start timestamptz := date_trunc('minute', clock_timestamp());
  next_count integer;
begin
  select * into api_client
  from private.projecthub_api_clients
  where key_hash = lower(coalesce(p_key_hash, ''))
  limit 1;

  if api_client.id is null
    or not api_client.enabled
    or api_client.revoked_at is not null
    or (api_client.expires_at is not null and api_client.expires_at <= clock_timestamp()) then
    insert into private.projecthub_api_audit_events
      (request_id, action, resource, status, outcome)
    values (left(coalesce(p_request_id, ''), 80), left(coalesce(p_action, ''), 80),
      left(coalesce(p_resource, ''), 240), 401, 'denied');
    return jsonb_build_object('authorized', false, 'code', 'invalid_api_key');
  end if;

  if not ('projecthub.read' = any(api_client.scopes) or p_action = any(api_client.scopes)) then
    insert into private.projecthub_api_audit_events
      (request_id, client_id, action, resource, status, outcome)
    values (left(p_request_id, 80), api_client.id, left(p_action, 80), left(p_resource, 240), 403, 'denied');
    return jsonb_build_object('authorized', false, 'code', 'insufficient_scope');
  end if;

  insert into private.projecthub_api_rate_buckets (client_id, bucket_started_at, request_count)
  values (api_client.id, bucket_start, 1)
  on conflict (client_id, bucket_started_at) do update
    set request_count = private.projecthub_api_rate_buckets.request_count + 1
  returning request_count into next_count;

  if next_count > api_client.requests_per_minute then
    insert into private.projecthub_api_audit_events
      (request_id, client_id, action, resource, status, outcome)
    values (left(p_request_id, 80), api_client.id, left(p_action, 80), left(p_resource, 240), 429, 'rate_limited');
    return jsonb_build_object(
      'authorized', false,
      'code', 'rate_limit_exceeded',
      'retry_after', greatest(1, 60 - extract(second from clock_timestamp())::integer)
    );
  end if;

  update private.projecthub_api_clients set last_used_at = clock_timestamp() where id = api_client.id;
  return jsonb_build_object(
    'authorized', true,
    'client_id', api_client.id,
    'scopes', to_jsonb(api_client.scopes),
    'allowed_project_ids', to_jsonb(api_client.allowed_project_ids),
    'rate_limit', api_client.requests_per_minute,
    'rate_remaining', greatest(0, api_client.requests_per_minute - next_count)
  );
end;
$$;
create or replace function public.projecthub_record_api_outcome(
  p_request_id text,
  p_client_id text,
  p_action text,
  p_resource text,
  p_status integer,
  p_outcome text,
  p_filter_names text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into private.projecthub_api_audit_events
    (request_id, client_id, action, resource, status, outcome, filter_names)
  values (
    left(coalesce(p_request_id, ''), 80),
    nullif(p_client_id, ''),
    left(coalesce(p_action, ''), 80),
    left(coalesce(p_resource, ''), 240),
    greatest(100, least(coalesce(p_status, 500), 599)),
    left(coalesce(p_outcome, ''), 80),
    coalesce(p_filter_names, '{}'::text[])
  );
end;
$$;
revoke all on function public.projecthub_authorize_api_request(text, text, text, text) from public, anon, authenticated;
revoke all on function public.projecthub_record_api_outcome(text, text, text, text, integer, text, text[]) from public, anon, authenticated;
grant execute on function public.projecthub_authorize_api_request(text, text, text, text) to service_role;
grant execute on function public.projecthub_record_api_outcome(text, text, text, text, integer, text, text[]) to service_role;
revoke all on all tables in schema private from public, anon, authenticated;
