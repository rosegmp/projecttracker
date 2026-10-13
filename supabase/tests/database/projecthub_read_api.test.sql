begin;

select plan(15);

select ok(
  exists (select 1 from private.projecthub_api_clients where id = 'chatgpt-daily-briefing' and not enabled and key_hash is null),
  'migration creates a disabled, secretless daily-briefing service account'
);

select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anonymous callers cannot use the private API security schema');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'signed-in website users cannot use the private API security schema');
select ok(not has_table_privilege('authenticated', 'private.projecthub_api_clients', 'SELECT'), 'website users cannot read API client hashes');
select ok(not has_table_privilege('authenticated', 'private.projecthub_api_audit_events', 'SELECT'), 'website users cannot read API audit events');
select ok(not has_function_privilege('authenticated', 'public.projecthub_authorize_api_request(text,text,text,text)', 'EXECUTE'), 'website users cannot invoke service-account authentication');
select ok(not has_function_privilege('authenticated', 'public.projecthub_record_api_outcome(text,text,text,text,integer,text,text[])', 'EXECUTE'), 'website users cannot forge API audit outcomes');

update private.projecthub_api_clients
set key_hash = repeat('a', 64), enabled = true, requests_per_minute = 2,
    scopes = array['projecthub.read', 'mcp.read'], allowed_project_ids = array['project-a']
where id = 'chatgpt-daily-briefing';

set local role service_role;
select is(
  public.projecthub_authorize_api_request(repeat('b', 64), 'REQ-TEST-INVALID', 'projecthub.read', '/api/v1/projects')->>'code',
  'invalid_api_key',
  'invalid service-account keys are rejected'
);
select is(
  public.projecthub_authorize_api_request(repeat('a', 64), 'REQ-TEST-ONE', 'projecthub.read', '/api/v1/projects')->>'authorized',
  'true',
  'valid scoped service-account key authenticates'
);
select is(
  public.projecthub_authorize_api_request(repeat('a', 64), 'REQ-TEST-TWO', 'mcp.read', '/mcp')->'allowed_project_ids'->>0,
  'project-a',
  'authentication returns server-side project scope'
);
select is(
  public.projecthub_authorize_api_request(repeat('a', 64), 'REQ-TEST-THREE', 'projecthub.read', '/api/v1/tasks')->>'code',
  'rate_limit_exceeded',
  'database-backed rate limiting rejects excess requests'
);
reset role;

select results_eq(
  $$select count(*)::bigint from information_schema.routines where routine_schema = 'public' and routine_name like 'projecthub_%' and routine_name ~ '(create|update|delete|upload|admin)'$$,
  array[0::bigint],
  'ProjectHub API publishes no write or admin routines'
);
select results_eq(
  $$select count(*)::bigint from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'private' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')$$,
  array[0::bigint],
  'API security tables grant no writes to client roles'
);
select results_eq(
  $$select count(*)::bigint from private.projecthub_api_audit_events where outcome = 'denied' and status = 401$$,
  array[1::bigint],
  'failed authentication is audit logged without storing the presented key'
);
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'projecthub_api_audit_events' and column_name in ('api_key','key_hash','authorization')),
  'audit log schema cannot store raw credentials or key hashes'
);

select * from finish();
rollback;
