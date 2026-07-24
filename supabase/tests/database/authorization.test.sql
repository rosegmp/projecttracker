begin;

select plan(10);

insert into public.app_users (id, position, data) values
  ('test-admin', 0, '{"name":"Test Admin","email":"admin@test.local","role":"Admin"}'),
  ('test-editor', 1, '{"name":"Test Editor","email":"editor@test.local","role":"Edit"}'),
  ('test-viewer', 2, '{"name":"Test Viewer","email":"viewer@test.local","role":"View Only"}'),
  ('test-customer', 3, '{"name":"Test Customer","email":"customer@test.local","role":"Customer"}');

insert into public.projects (id, data) values
  ('auth-project-a', '{"name":"Authorized project","accessUserIds":["test-editor","test-viewer","test-customer"]}'),
  ('auth-project-b', '{"name":"Restricted project","accessUserIds":["test-admin"]}');

insert into public.tasks (id, data) values
  ('auth-task-a', '{"name":"Authorized task","projectId":"auth-project-a"}'),
  ('auth-task-b', '{"name":"Restricted task","projectId":"auth-project-b"}');

set local role authenticated;

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","email":"admin@test.local","role":"authenticated"}';
select results_eq(
  'select id from public.projects order by id',
  array['auth-project-a'::text, 'auth-project-b'::text],
  'administrators can read every project'
);

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select results_eq(
  'select id from public.projects order by id',
  array['auth-project-a'::text],
  'editors can read only assigned projects when access rows exist'
);
select results_eq(
  'select id from public.tasks order by id',
  array['auth-task-a'::text],
  'task visibility follows project authorization'
);
select ok(public.app_user_can_edit_project('auth-project-a'), 'editors can edit assigned projects');
select ok(not public.app_user_can_edit_project('auth-project-b'), 'editors cannot edit unassigned projects');
select lives_ok(
  $$select public.apply_tracker_batch(
    '[{"table":"tasks","id":"auth-task-a","expectedVersion":1,"data":{"name":"Updated by editor","projectId":"auth-project-a"}}]'::jsonb
  )$$,
  'assigned editors can update project tasks through the write RPC'
);
select throws_ok(
  $$select public.apply_tracker_batch(
    '[{"table":"tasks","id":"auth-task-b","expectedVersion":1,"data":{"name":"Unauthorized update","projectId":"auth-project-b"}}]'::jsonb
  )$$,
  '42501',
  'You do not have access to this project.',
  'assigned editors cannot update another project through the write RPC'
);

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000003","email":"viewer@test.local","role":"authenticated"}';
select ok(not public.app_user_can_edit(), 'view-only users do not receive edit capability');

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000004","email":"customer@test.local","role":"authenticated"}';
select results_eq(
  'select count(*)::bigint from public.projects',
  array[0::bigint],
  'portal users cannot query internal project tables directly'
);
select is(
  public.get_project_portal_bootstrap()->'projects'->0->>'id',
  'auth-project-a',
  'the portal bootstrap returns only an assigned project through its filtered security boundary'
);

select * from finish();
rollback;
