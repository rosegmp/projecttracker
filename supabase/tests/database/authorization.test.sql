begin;

select plan(60);

insert into public.app_users (id, position, data) values
  ('test-admin', 0, '{"name":"Test Admin","email":"admin@test.local","role":"Admin"}'),
  ('test-editor', 1, '{"name":"Test Editor","email":"editor@test.local","role":"Edit"}'),
  ('test-viewer', 2, '{"name":"Test Viewer","email":"viewer@test.local","role":"View Only"}'),
  ('test-customer', 3, '{"name":"Test Customer","email":"customer@test.local","role":"Customer"}');

insert into public.projects (id, data) values
  ('auth-project-a', '{"name":"Authorized project","accessUserIds":["test-editor","test-viewer","test-customer"]}'),
  ('auth-project-b', '{"name":"Restricted project","accessUserIds":["test-admin"]}');

insert into public.project_user_access (project_id, user_id, position) values
  ('auth-project-a', 'test-editor', 0),
  ('auth-project-a', 'test-viewer', 1),
  ('auth-project-a', 'test-customer', 2),
  ('auth-project-b', 'test-admin', 0);

insert into public.tasks (id, data) values
  ('auth-task-a', '{"name":"Authorized task","projectId":"auth-project-a"}'),
  ('auth-task-b', '{"name":"Restricted task","projectId":"auth-project-b"}');

insert into public.project_inspections (project_id, id, position, data) values
  ('auth-project-a', 'auth-inspection-a', 0, '{"id":"auth-inspection-a","inspectionType":"Framing","status":"scheduled"}');

insert into public.subs (id, data) values
  ('auth-sub-a', '{"company":"Authorized Subcontractor","email":"certs@sub.test","peopleType":"sub"}');

insert into public.subcontractor_tax_identifiers (
  subcontractor_id, encrypted_tax_id, encryption_iv, tax_id_last_four, tax_id_type,
  legal_name, business_name, mailing_address, source, extraction_confidence
) values (
  'auth-sub-a', 'ciphertext-without-plaintext', 'test-iv', '6789', 'ein',
  'Authorized Subcontractor LLC', '', '123 Test Street, Trenton, NJ 08608', 'w9_extraction', 'High'
);

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
select lives_ok(
  $$select public.save_insurance_certificate(
    '{"id":"20000000-0000-4000-8000-000000000001","subcontractorId":"auth-sub-a","insured":"Authorized Subcontractor","policyNumber":"TEST-001","effectiveDate":"2026-01-01","expirationDate":"2027-01-01"}'::jsonb,
    '[{"id":"30000000-0000-4000-8000-000000000001","type":"General Liability","amount":1000000}]'::jsonb,
    null
  )$$,
  'editors can create subcontractor insurance certificates'
);
select lives_ok(
  $$select public.create_certificate_renewal_request(
    'auth-sub-a',
    '20000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'editors can create a server-authoritative certificate renewal request'
);
select results_eq(
  $$select status from public.certificate_renewal_requests where subcontractor_id = 'auth-sub-a'$$,
  array['requested'::text],
  'new certificate renewal requests begin in requested status'
);
select lives_ok(
  $$select public.save_insurance_certificate(
    '{"id":"20000000-0000-4000-8000-000000000003","subcontractorId":"auth-sub-a","insured":"Authorized Subcontractor","policyNumber":"TEST-RENEWED","effectiveDate":"2027-01-01","expirationDate":"2028-01-01"}'::jsonb,
    '[{"id":"30000000-0000-4000-8000-000000000003","type":"General Liability","amount":1000000}]'::jsonb,
    null
  )$$,
  'editors can save the replacement certificate'
);
select results_eq(
  $$select status from public.certificate_renewal_requests where subcontractor_id = 'auth-sub-a'$$,
  array['received'::text],
  'a replacement certificate automatically advances an open renewal to received'
);
select lives_ok(
  $$select public.update_certificate_renewal_status(
    (select id from public.certificate_renewal_requests where subcontractor_id = 'auth-sub-a'),
    'under_review',
    2
  )$$,
  'editors can advance a received renewal to under review'
);
select lives_ok(
  $$select public.update_certificate_renewal_status(
    (select id from public.certificate_renewal_requests where subcontractor_id = 'auth-sub-a'),
    'accepted',
    3
  )$$,
  'editors can accept a reviewed certificate renewal'
);
select lives_ok(
  $$select public.save_subcontractor_compliance_document(
    '{"id":"70000000-0000-4000-8000-000000000001","subcontractorId":"auth-sub-a","documentType":"subcontractor_agreement","sourceFileName":"agreement.pdf","sourceBucket":"certificate-files","sourcePath":"certificates/test/compliance/agreement.pdf"}'::jsonb,
    null
  )$$,
  'editors can save a signed subcontractor agreement'
);
select lives_ok(
  $$select public.save_subcontractor_compliance_document(
    '{"id":"70000000-0000-4000-8000-000000000002","subcontractorId":"auth-sub-a","documentType":"w9","sourceFileName":"undated-w9.pdf","sourceBucket":"certificate-files","sourcePath":"certificates/test/compliance/undated-w9.pdf"}'::jsonb,
    null
  )$$,
  'editors can save a Form W-9 without a date'
);
select results_eq(
  $$select document_type from public.subcontractor_compliance_documents order by document_type$$,
  array['subcontractor_agreement'::text, 'w9'::text],
  'editors can read the subcontractor compliance documents they saved'
);
select results_eq(
  $$select tax_id_last_four from public.get_subcontractor_tax_id_statuses()$$,
  array['6789'::text],
  'editors can read only masked subcontractor tax ID status'
);
select throws_ok(
  $$select encrypted_tax_id from public.subcontractor_tax_identifiers$$,
  '42501',
  'permission denied for table subcontractor_tax_identifiers',
  'editors cannot read encrypted subcontractor tax ID records directly'
);
select throws_ok(
  $$select public.delete_project_inspection('auth-project-a', 'auth-inspection-a', 99, '{}'::jsonb)$$,
  '40001',
  'NORMALIZED_VERSION_CONFLICT:inspections:auth-inspection-a',
  'focused inspection delete rejects a stale device version'
);
select lives_ok(
  $$select public.delete_project_inspection('auth-project-a', 'auth-inspection-a', 1, '{}'::jsonb)$$,
  'assigned editors can delete one current inspection through the focused RPC'
);
select results_eq(
  'select distinct subcontractor_id from public.insurance_certificates',
  array['auth-sub-a'::text],
  'editors can read subcontractor insurance certificates without project scope'
);

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000003","email":"viewer@test.local","role":"authenticated"}';
select ok(not public.app_user_can_edit(), 'view-only users do not receive edit capability');
select results_eq(
  'select distinct subcontractor_id from public.insurance_certificates',
  array['auth-sub-a'::text],
  'view-only users can read subcontractor insurance certificates'
);
select throws_ok(
  $$select public.save_insurance_certificate(
    '{"id":"20000000-0000-4000-8000-000000000002","subcontractorId":"auth-sub-a"}'::jsonb,
    '[]'::jsonb,
    null
  )$$,
  '42501',
  'You do not have permission to edit insurance certificates.',
  'view-only users cannot edit subcontractor insurance certificates'
);
select results_eq(
  $$select status from public.certificate_renewal_requests where subcontractor_id = 'auth-sub-a'$$,
  array['accepted'::text],
  'view-only users can read certificate renewal history'
);
select throws_ok(
  $$select public.create_certificate_renewal_request('auth-sub-a', null)$$,
  '42501',
  'You do not have permission to request certificate renewals.',
  'view-only users cannot create certificate renewal requests'
);
select results_eq(
  $$select document_type from public.subcontractor_compliance_documents order by document_type$$,
  array['subcontractor_agreement'::text, 'w9'::text],
  'view-only users can read subcontractor compliance documents'
);
select results_eq(
  $$select tax_id_last_four from public.get_subcontractor_tax_id_statuses()$$,
  array['6789'::text],
  'view-only users can read only masked subcontractor tax ID status'
);
select throws_ok(
  $$select public.save_subcontractor_compliance_document(
    '{"subcontractorId":"auth-sub-a","documentType":"w9","signedDate":"2026-02-01","sourceFileName":"replacement.pdf","sourceBucket":"certificate-files","sourcePath":"certificates/test/compliance/replacement.pdf"}'::jsonb,
    null
  )$$,
  '42501',
  'You do not have permission to edit subcontractor compliance documents.',
  'view-only users cannot edit subcontractor compliance documents'
);
select throws_ok(
  $$select public.delete_project_inspection('auth-project-a', 'auth-inspection-a', 1, '{}'::jsonb)$$,
  '42501',
  'You do not have access to edit this project.',
  'view-only users cannot delete inspections through the focused RPC'
);

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
select results_eq(
  'select count(*)::bigint from public.insurance_certificates',
  array[0::bigint],
  'portal users cannot read internal insurance certificates'
);
select results_eq(
  'select count(*)::bigint from public.certificate_renewal_requests',
  array[0::bigint],
  'portal users cannot read internal certificate renewal history'
);
select results_eq(
  'select count(*)::bigint from public.subcontractor_compliance_documents',
  array[0::bigint],
  'portal users cannot read internal subcontractor compliance documents'
);
select throws_ok(
  $$select * from public.get_subcontractor_tax_id_statuses()$$,
  '42501',
  'You do not have permission to view subcontractor tax ID status.',
  'portal users cannot read subcontractor tax ID status'
);

reset role;
select results_eq(
  $$select count(*)::bigint
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('insurance_certificates', 'insurance_certificate_coverages')
      and column_name = 'project_id'$$,
  array[0::bigint],
  'insurance certificate schema has no project relationship'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.compliance_scheduled_reminder_deliveries',
    'SELECT, INSERT, UPDATE, DELETE'
  ),
  'authenticated application users cannot access scheduled compliance reminder deliveries'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.compliance_scheduled_followup_deliveries',
    'SELECT, INSERT, UPDATE, DELETE'
  ),
  'authenticated application users cannot access scheduled compliance follow-up deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_scheduled_compliance_reminder(text, uuid, uuid, date, integer, date, text)',
    'EXECUTE'
  ),
  'authenticated application users cannot claim scheduled compliance reminders'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_scheduled_compliance_followup(text, timestamptz, integer, date, text[], text)',
    'EXECUTE'
  ),
  'authenticated application users cannot claim scheduled compliance follow-ups'
);

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(
  public.claim_scheduled_compliance_reminder(
    'auth-sub-a',
    '20000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000001'::uuid,
    '2027-01-01'::date,
    30,
    '2026-12-02'::date,
    'CERTS@SUB.TEST'
  )->>'subcontractor_id',
  'auth-sub-a',
  'the service role can claim a scheduled compliance reminder'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select results_eq(
  $$select recipient_email
      from public.compliance_scheduled_reminder_deliveries
     where subcontractor_id = 'auth-sub-a'$$,
  array['certs@sub.test'::text],
  'a service-role reminder claim persists a normalized delivery record'
);

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(
  public.claim_scheduled_compliance_followup(
    'auth-sub-a',
    '2026-08-01 12:00:00+00'::timestamptz,
    14,
    '2026-08-15'::date,
    array['general_liability', 'w9']::text[],
    'CERTS@SUB.TEST'
  )->>'subcontractor_id',
  'auth-sub-a',
  'the service role can claim a scheduled compliance follow-up'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select is(
  (
    select missing_requirements::text
    from public.compliance_scheduled_followup_deliveries
    where subcontractor_id = 'auth-sub-a'
  ),
  '{general_liability,w9}',
  'a service-role follow-up claim persists its unresolved requirements'
);

select is(
  public.get_app_runtime_status()->>'writesFrozen',
  'false',
  'application writes are available by default'
);

select ok(
  not has_function_privilege('authenticated', 'public.set_app_write_freeze(boolean, text, text)', 'EXECUTE'),
  'authenticated application users cannot operate the write freeze'
);

select set_config('request.jwt.claims', '{}', true);
select is(
  public.set_app_write_freeze(true, 'Authorization test maintenance.', 'TEST-INCIDENT')->>'writesFrozen',
  'true',
  'a recovery operator can enable the write freeze'
);

select results_eq(
  $$select count(*)::bigint from public.app_runtime_control_events where incident_reference = 'TEST-INCIDENT'$$,
  array[1::bigint],
  'write-freeze activation is recorded'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select lives_ok(
  $$select id from public.projects where id = 'auth-project-a'$$,
  'application reads remain available during the write freeze'
);
select throws_ok(
  $$update public.tasks set data = data || '{"name":"Blocked direct update"}'::jsonb where id = 'auth-task-a'$$,
  '55000',
  'APP_WRITES_FROZEN',
  'direct authenticated writes are blocked during maintenance'
);
select throws_ok(
  $$select public.apply_tracker_batch(
    '[{"table":"tasks","id":"auth-task-a","expectedVersion":2,"data":{"name":"Blocked RPC update","projectId":"auth-project-a"}}]'::jsonb
  )$$,
  '55000',
  'APP_WRITES_FROZEN',
  'security-definer RPC writes are blocked during maintenance'
);
select is(
  public.get_app_runtime_status()->>'message',
  'Authorization test maintenance.',
  'authenticated clients can read the maintenance message'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
select results_eq(
  $$select count(*)::bigint
    from information_schema.tables source_table
    where source_table.table_schema = 'public'
      and source_table.table_type = 'BASE TABLE'
      and source_table.table_name <> 'app_runtime_controls'
      and not exists (
        select 1
        from pg_trigger trigger_row
        join pg_class target_class on target_class.oid = trigger_row.tgrelid
        join pg_namespace target_schema on target_schema.oid = target_class.relnamespace
        where target_schema.nspname = source_table.table_schema
          and target_class.relname = source_table.table_name
          and trigger_row.tgname = 'enforce_application_write_freeze'
          and not trigger_row.tgisinternal
      )$$,
  array[0::bigint],
  'every public application data table is covered by the write-freeze trigger'
);
select results_eq(
  $$select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'Application maintenance permits storage %'$$,
  array[3::bigint],
  'storage insert, update, and delete paths have restrictive maintenance policies'
);

-- The baseline app schema intentionally grants clients directly and uses
-- security-definer RPCs; grant this transaction-scoped probe only so the test
-- isolates the maintenance trigger's service-role bypass from table grants.
grant select, update on public.tasks to service_role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$update public.tasks set data = data || '{"recoveryChecked":true}'::jsonb where id = 'auth-task-a'$$,
  'an otherwise-authorized service-role recovery path bypasses the freeze guard'
);

reset role;
select is(
  public.set_app_write_freeze(false, '', 'TEST-INCIDENT')->>'writesFrozen',
  'false',
  'a recovery operator can disable the write freeze'
);
select results_eq(
  $$select count(*)::bigint from public.app_runtime_control_events where incident_reference = 'TEST-INCIDENT'$$,
  array[2::bigint],
  'write-freeze activation and release are both recorded'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select lives_ok(
  $$update public.tasks set data = data || '{"name":"Writes resumed"}'::jsonb where id = 'auth-task-a'$$,
  'authenticated writes resume after maintenance is released'
);

reset role;
select set_config('request.jwt.claims', '{}', true);

select * from finish();
rollback;
