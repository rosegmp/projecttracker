begin;

select plan(135);

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

insert into public.project_file_folders (project_id, id, position, data) values
  ('auth-project-a', 'shared-files', 0, '{"name":"Shared files","customerVisible":true,"subcontractorVisible":true}');
insert into public.project_files (project_id, folder_id, id, position, data) values
  ('auth-project-a', 'shared-files', 'active-portal-file', 0, '{"name":"Current plan.pdf","storagePath":"projects/auth-project-a/files/current-plan.pdf"}'),
  ('auth-project-a', 'shared-files', 'archived-portal-file', 1, '{"name":"Old plan.pdf","storagePath":"projects/auth-project-a/files/old-plan.pdf","archivedAt":"2026-08-27T12:00:00.000Z"}');

insert into storage.objects (bucket_id, name) values
  ('project-files', 'projects/auth-project-a/photos/photo-editor-12345678-editor.jpg'),
  ('project-files', 'projects/auth-project-b/photos/photo-blocked-12345678-blocked.jpg'),
  ('project-files', 'projects/auth-project-a/photos/photo-customer-12345678-customer.jpg');

insert into public.tasks (id, data) values
  ('auth-task-a', '{"name":"Authorized task","projectId":"auth-project-a"}'),
  ('auth-task-b', '{"name":"Restricted task","projectId":"auth-project-b"}');

insert into public.project_inspections (project_id, id, position, data) values
  ('auth-project-a', 'auth-inspection-a', 0, '{"id":"auth-inspection-a","inspectionType":"Framing","status":"scheduled"}'),
  ('auth-project-b', 'auth-inspection-b', 0, '{"id":"auth-inspection-b","inspectionType":"Final","status":"scheduled"}');

insert into public.project_phases (project_id, id, position, data) values
  ('auth-project-a', 'auth-phase-a', 0, '{"name":"Authorized phase"}'),
  ('auth-project-b', 'auth-phase-b', 0, '{"name":"Restricted phase"}');
insert into public.project_steps (project_id, phase_id, id, position, data) values
  ('auth-project-a', 'auth-phase-a', 'auth-step-a', 0, '{"name":"Authorized step"}'),
  ('auth-project-b', 'auth-phase-b', 'auth-step-b', 0, '{"name":"Restricted step"}');
insert into public.project_step_inspection_dependencies (
  project_id, phase_id, step_id, predecessor_inspection_id, position, lag
) values
  ('auth-project-a', 'auth-phase-a', 'auth-step-a', 'auth-inspection-a', 0, 0),
  ('auth-project-b', 'auth-phase-b', 'auth-step-b', 'auth-inspection-b', 0, 0);

insert into public.project_change_orders (id, project_id, order_number, title, status, data) values
  ('auth-change-order-a', 'auth-project-a', 'CO-001', 'Authorized change order', 'proposed', '{"description":"Add pantry cabinets","costImpact":"1250","scheduleDays":"2","dueDate":"2026-08-25","attachments":[]}'),
  ('auth-change-order-stale', 'auth-project-a', 'CO-002', 'Approval will become stale', 'proposed', '{"description":"Original issued terms","costImpact":"500","attachments":[]}');

insert into public.project_portal_items (id, project_id, item_number, title, item_type, audience, status, data) values
  ('auth-secure-approval', 'auth-project-a', 'POR-SECURE', 'Secure portal approval', 'approval', 'customer', 'response_requested', '{"message":"Approve the issued portal terms."}');

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
select results_eq(
  'select predecessor_inspection_id from public.project_step_inspection_dependencies order by predecessor_inspection_id',
  array['auth-inspection-a'::text, 'auth-inspection-b'::text],
  'administrators can read inspection predecessors for every project'
);
select lives_ok(
  $$select public.replace_vendor_1099_import(
    2026,
    'admin-import.xlsx',
    '[{"vendor_name":"Authorized Subcontractor","tax_id_last_four":"6789","reportable_total":"2400.00","subcontractor_id":"auth-sub-a"}]'::jsonb
  )$$,
  'administrators can replace an annual 1099 spreadsheet import'
);
select results_eq(
  $$select vendor_name from public.vendor_1099_import_rows where tax_year = 2026 order by position$$,
  array['Authorized Subcontractor'::text],
  'administrators can read normalized imported 1099 rows'
);
select lives_ok(
  $$select public.create_project_from_template(
    '{"id":"template-project-admin","name":"Template Admin","accessUserIds":["test-admin"],"phases":[],"files":{"folders":[]},"inspections":[]}'::jsonb,
    '[{"id":"template-task-admin","label":"Template task","assignees":["Test Admin"],"done":true,"attachments":[{"id":"must-strip"}]}]'::jsonb,
    '[{"id":"template-closeout-admin","title":"Owner manuals","status":"complete","attachments":[{"id":"must-strip"}]}]'::jsonb
  )$$,
  'administrators can atomically create a project from template records'
);
select results_eq(
  $$select id from public.projects where id = 'template-project-admin'$$,
  array['template-project-admin'::text],
  'atomic template creation persists the project'
);
select results_eq(
  $$select (data->>'done')::boolean, data->'attachments'
      from public.tasks where id = 'template-task-admin'$$,
  $$values (false, '[]'::jsonb)$$,
  'atomic template creation resets task completion and strips attachments'
);
select results_eq(
  $$select item_number, status, data->'attachments'
      from public.project_closeout_items where id = 'template-closeout-admin'$$,
  $$values ('CLS-001'::text, 'not_started'::text, '[]'::jsonb)$$,
  'atomic template creation numbers and resets closeout items while stripping attachments'
);
select results_eq(
  $$select assignee from public.task_assignments where task_id = 'template-task-admin'$$,
  array['Test Admin'::text],
  'atomic template creation synchronizes standard task assignments'
);
delete from public.tasks where id = 'template-task-admin';
delete from public.projects where id = 'template-project-admin';

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select results_eq(
  $$select vendor_name from public.vendor_1099_import_rows where tax_year = 2026$$,
  array[]::text[],
  'non-admin staff cannot read imported 1099 financial rows'
);
select throws_ok(
  $$select public.replace_vendor_1099_import(2026, 'blocked.xlsx', '[{"vendor_name":"Blocked","tax_id_last_four":"","reportable_total":"10.00"}]'::jsonb)$$,
  '42501',
  'Only administrators can import 1099 payments.',
  'non-admin staff cannot replace a 1099 spreadsheet import'
);
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
select results_eq(
  'select predecessor_inspection_id from public.project_step_inspection_dependencies order by predecessor_inspection_id',
  array['auth-inspection-a'::text],
  'inspection predecessor visibility follows project authorization'
);
select ok(public.app_user_can_edit_project('auth-project-a'), 'editors can edit assigned projects');
select ok(not public.app_user_can_edit_project('auth-project-b'), 'editors cannot edit unassigned projects');
select lives_ok(
  $$select public.add_project_photos(
    'auth-project-a',
    '[{"id":"photo-editor-12345678","name":"Editor.jpg","originalName":"Editor.jpg","size":1024,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-a/photos/photo-editor-12345678-editor.jpg"}]'::jsonb
  )$$,
  'assigned editors can append a project photo through the focused RPC'
);
select lives_ok(
  $$select public.add_project_photos(
    'auth-project-a',
    '[{"id":"photo-editor-12345678","name":"Editor.jpg","originalName":"Editor.jpg","size":1024,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-a/photos/photo-editor-12345678-editor.jpg"}]'::jsonb
  )$$,
  'replaying an offline photo append is idempotent'
);
select results_eq(
  $$select count(*)::bigint from public.project_photos where project_id = 'auth-project-a' and id = 'photo-editor-12345678'$$,
  array[1::bigint],
  'an idempotent photo replay does not create a duplicate'
);
select throws_ok(
  $$select public.add_project_photos(
    'auth-project-b',
    '[{"id":"photo-blocked-12345678","name":"Blocked.jpg","originalName":"Blocked.jpg","size":1024,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-b/photos/photo-blocked-12345678-blocked.jpg"}]'::jsonb
  )$$,
  '42501',
  'You do not have permission to add photos to this project.',
  'editors cannot append photos to an unassigned project'
);
select lives_ok(
  $$select public.create_project_from_template(
    '{"id":"template-project-editor","name":"Template Editor","accessUserIds":["test-editor"],"phases":[],"files":{"folders":[]},"inspections":[]}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )$$,
  'editors can create a project when they retain access'
);
select results_eq(
  $$select user_id from public.project_user_access where project_id = 'template-project-editor'$$,
  array['test-editor'::text],
  'editor template creation synchronizes project access'
);
select throws_ok(
  $$select public.create_project_from_template(
    '{"id":"template-project-editor-blocked","name":"Template Editor Blocked","accessUserIds":["test-admin"]}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )$$,
  '42501',
  'Editors must retain access to projects they create.',
  'editors cannot create a template project that removes their own access'
);
delete from public.projects where id = 'template-project-editor';
select lives_ok(
  $$select public.create_change_order_approval_request('auth-change-order-a', 1, '2026-08-25'::date)$$,
  'assigned editors can issue a version-bound change order approval request'
);
select results_eq(
  $$select status from public.project_portal_items where data->>'changeOrderId' = 'auth-change-order-a'$$,
  array['response_requested'::text],
  'new change order approval requests await a customer response'
);
select throws_ok(
  $$update public.project_portal_items
    set data = jsonb_set(data, '{changeOrderSnapshot,title}', '"Altered after issue"'::jsonb)
    where data->>'changeOrderId' = 'auth-change-order-a'$$,
  '22023',
  'The issued change order approval snapshot cannot be changed.',
  'issued change order approval terms are immutable'
);
select lives_ok(
  $$select public.create_change_order_approval_request('auth-change-order-stale', 1, null)$$,
  'editors can issue a second approval request for stale-version protection'
);
update public.project_change_orders
set title = 'Changed after approval request'
where id = 'auth-change-order-stale';
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
select throws_ok(
  $$select public.add_project_photos(
    'auth-project-a',
    '[{"id":"photo-viewer-12345678","name":"Viewer.jpg","originalName":"Viewer.jpg","size":1024,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-a/photos/photo-viewer-12345678-viewer.jpg"}]'::jsonb
  )$$,
  '42501',
  'You do not have permission to add photos to this project.',
  'view-only users cannot append project photos'
);
select throws_ok(
  $$select public.create_project_from_template(
    '{"id":"template-project-viewer","name":"Template Viewer"}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )$$,
  '42501',
  'You do not have permission to create projects.',
  'view-only users cannot create projects from templates'
);
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
select throws_ok(
  $$select public.create_change_order_approval_request('auth-change-order-a', 1, '2026-08-25'::date)$$,
  '42501',
  'You do not have access to edit this project.',
  'view-only users cannot issue change order approval requests'
);

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000004","email":"customer@test.local","role":"authenticated"}';
select lives_ok(
  $$select public.add_project_photos(
    'auth-project-a',
    '[{"id":"photo-customer-12345678","name":"Customer.jpg","originalName":"Customer.jpg","size":2048,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-a/photos/photo-customer-12345678-customer.jpg"}]'::jsonb
  )$$,
  'assigned customers can append a project photo through the focused RPC'
);
select throws_ok(
  $$select public.add_project_photos(
    'auth-project-b',
    '[{"id":"photo-blocked-12345678","name":"Blocked.jpg","originalName":"Blocked.jpg","size":1024,"type":"image/jpeg","uploadedAt":"2026-09-02T12:00:00.000Z","storageProvider":"supabase","storageBucket":"project-files","storagePath":"projects/auth-project-b/photos/photo-blocked-12345678-blocked.jpg"}]'::jsonb
  )$$,
  '42501',
  'You do not have permission to add photos to this project.',
  'customers cannot append photos to an unassigned project'
);
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
  $$select file_value->>'id'
      from jsonb_array_elements(public.get_project_portal_bootstrap()->'projects'->0->'files'->'folders'->0->'files') file_row(file_value)$$,
  array['active-portal-file'::text],
  'portal bootstrap excludes archived project files'
);
select ok(
  public.portal_storage_object_is_visible('auth-project-a', 'projects/auth-project-a/files/current-plan.pdf'),
  'portal users can download an active file from a shared folder'
);
select ok(
  not public.portal_storage_object_is_visible('auth-project-a', 'projects/auth-project-a/files/old-plan.pdf'),
  'portal users cannot download an archived file'
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
select lives_ok(
  $$select public.respond_to_project_portal_item(
    (select id from public.project_portal_items where data->>'changeOrderId' = 'auth-change-order-a'),
    1,
    'Approved for construction.',
    'approved',
    'Test Customer'
  )$$,
  'the assigned customer can sign the issued change order version'
);
select throws_ok(
  $$select public.respond_to_project_portal_item(
    (select id from public.project_portal_items where data->>'changeOrderId' = 'auth-change-order-stale'),
    1,
    'Approved stale terms.',
    'approved',
    'Test Customer'
  )$$,
  '40001',
  'This change order changed after the request was sent. Ask the project team to issue a new approval request.',
  'customers cannot approve a change order that changed after it was issued'
);

reset role;
select results_eq(
  $$select status from public.project_change_orders where id = 'auth-change-order-a'$$,
  array['approved'::text],
  'a signed approval atomically approves the linked change order'
);
select results_eq(
  $$select data->>'signerName' from public.project_portal_items where data->>'changeOrderId' = 'auth-change-order-a'$$,
  array['Test Customer'::text],
  'the portal approval retains the signer name'
);

select ok(
  not has_table_privilege('authenticated', 'public.digital_approval_requests', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated clients cannot access the secure approval ledger directly'
);
select ok(
  not has_function_privilege('anon', 'public.create_digital_approval_request(text, text, bigint, text, timestamptz)', 'EXECUTE'),
  'anonymous clients cannot create secure approval links'
);
select ok(
  not has_function_privilege('authenticated', 'public.respond_to_digital_approval(text, text, text, text, text)', 'EXECUTE'),
  'authenticated clients cannot bypass the public approval Edge Function response boundary'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select is(
  public.create_digital_approval_request(
    'portal_item', 'auth-secure-approval', 1,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    now() + interval '14 days'
  )->>'sourceType',
  'portal_item',
  'project editors can issue version-bound portal approval links'
);

reset role;
select results_eq(
  $$select count(*)::bigint from public.digital_approval_requests
    where source_id = 'auth-secure-approval'
      and token_hash = encode(digest('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'sha256'), 'hex')$$,
  array[1::bigint],
  'secure approval links store only a one-way token hash'
);

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.respond_to_digital_approval(
    encode(digest('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'sha256'), 'hex'),
    'approved', 'Wrong Recipient', 'wrong@test.local', ''
  )$$,
  '42501',
  'Use the email address that received this approval request.',
  'a secure approval decision requires an issued recipient email address'
);
select lives_ok(
  $$select public.respond_to_digital_approval(
    encode(digest('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'sha256'), 'hex'),
    'approved', 'Test Customer', 'customer@test.local', 'Approved securely.'
  )$$,
  'the service-only response boundary records a recipient decision'
);
select lives_ok(
  $$select public.complete_digital_approval_document(
    (select id from public.digital_approval_requests where source_id = 'auth-secure-approval'),
    'certificate-files', 'certificates/digital-approvals/test/portal-signed.pdf', 'portal-signed.pdf'
  )$$,
  'the service-only completion boundary records the final signed PDF'
);

reset role;
select results_eq(
  $$select status from public.project_portal_items where id = 'auth-secure-approval'$$,
  array['approved'::text],
  'a secure decision atomically updates its portal approval'
);
select results_eq(
  $$select data->>'signerEmail' from public.project_portal_items where id = 'auth-secure-approval'$$,
  array['customer@test.local'::text],
  'the secure portal decision records the signer email'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@test.local","role":"authenticated"}';
select is(
  public.create_digital_approval_request(
    'subcontractor_agreement', 'auth-sub-a',
    1,
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    now() + interval '14 days'
  )->>'sourceType',
  'subcontractor_agreement',
  'project editors can request a version-bound subcontractor agreement signature'
);

reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$select public.respond_to_digital_approval(
    encode(digest('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'sha256'), 'hex'),
    'approved', 'Authorized Subcontractor', 'certs@sub.test', 'Signed agreement.'
  )$$,
  'a subcontractor can approve the issued agreement through the service boundary'
);
select lives_ok(
  $$select public.complete_digital_approval_document(
    (select id from public.digital_approval_requests where source_id = 'auth-sub-a'),
    'certificate-files', 'certificates/digital-approvals/test/agreement-signed.pdf', 'agreement-signed.pdf'
  )$$,
  'an approved agreement can finalize its signed PDF'
);

reset role;
select results_eq(
  $$select source_path from public.subcontractor_compliance_documents
    where subcontractor_id = 'auth-sub-a' and document_type = 'subcontractor_agreement'$$,
  array['certificates/digital-approvals/test/agreement-signed.pdf'::text],
  'an approved signed agreement automatically satisfies the compliance record'
);
select results_eq(
  $$select signed_pdf_path from public.digital_approval_requests
    where source_id = 'auth-secure-approval'$$,
  array['certificates/digital-approvals/test/portal-signed.pdf'::text],
  'the immutable approval ledger retains the final signed PDF location'
);
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

select ok(
  not has_table_privilege('anon', 'public.vendor_1099_import_rows', 'SELECT'),
  'anonymous clients cannot read imported 1099 financial rows'
);
select ok(
  not has_table_privilege('anon', 'public.vendor_1099_payer_profiles', 'SELECT')
    and not has_table_privilege('anon', 'public.vendor_1099_filing_batches', 'SELECT')
    and not has_table_privilege('anon', 'public.vendor_1099_forms', 'SELECT'),
  'anonymous clients cannot read 1099 payer, filing, or form records'
);
select ok(
  not has_table_privilege('authenticated', 'public.vendor_1099_payer_profiles', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.vendor_1099_filing_batches', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.vendor_1099_forms', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated clients cannot directly access server-only 1099 filing records'
);
select ok(
  not has_table_privilege('anon', 'public.project_step_inspection_dependencies', 'SELECT'),
  'anonymous clients cannot read inspection predecessors'
);
select ok(
  not has_table_privilege('authenticated', 'public.project_step_inspection_dependencies', 'INSERT, UPDATE, DELETE'),
  'authenticated clients cannot write inspection predecessors directly'
);
select ok(
  has_function_privilege('authenticated', 'public.create_project_from_template(jsonb,jsonb,jsonb)', 'EXECUTE'),
  'authenticated application users can invoke the role-guarded template creation RPC'
);
select ok(
  not has_function_privilege('anon', 'public.create_project_from_template(jsonb,jsonb,jsonb)', 'EXECUTE'),
  'anonymous clients cannot invoke project template creation'
);
select ok(
  has_function_privilege('authenticated', 'public.add_project_photos(text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.add_project_photos(text,jsonb)', 'EXECUTE'),
  'only authenticated application users can invoke the role-guarded project photo RPC'
);
select ok(
  has_table_privilege('authenticated', 'public.vendor_1099_import_rows', 'SELECT'),
  'authenticated administrators receive RLS-scoped read access to imported 1099 rows'
);
select ok(
  not has_table_privilege('authenticated', 'public.vendor_1099_import_rows', 'INSERT, UPDATE, DELETE'),
  'authenticated clients cannot write imported 1099 rows directly'
);
select ok(
  has_function_privilege('authenticated', 'public.replace_vendor_1099_import(integer,text,jsonb)', 'EXECUTE'),
  'authenticated administrators can invoke the guarded annual import RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.set_vendor_1099_import_match(uuid,text)', 'EXECUTE'),
  'authenticated administrators can invoke the guarded vendor-match RPC'
);
select ok(
  has_table_privilege('service_role', 'public.vendor_1099_import_rows', 'SELECT, INSERT, UPDATE, DELETE'),
  'the service role can manage imported 1099 rows'
);
select ok(
  has_table_privilege('service_role', 'public.vendor_1099_payer_profiles', 'SELECT, INSERT, UPDATE, DELETE')
    and has_table_privilege('service_role', 'public.vendor_1099_filing_batches', 'SELECT, INSERT, UPDATE, DELETE')
    and has_table_privilege('service_role', 'public.vendor_1099_forms', 'SELECT, INSERT, UPDATE, DELETE'),
  'only the service workflow can manage encrypted 1099 filing records'
);

select results_eq(
  $$select public from storage.buckets where id = 'vendor-tax-documents'$$,
  array[false],
  'vendor tax-document storage is private'
);

select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Application users cannot % vendor tax documents'),
  4,
  'vendor tax-document storage has restrictive authenticated policies for every write and read operation'
);

select ok(
  not has_table_privilege('anon', 'public.management_reporting_snapshots', 'SELECT')
    and not has_table_privilege('anon', 'public.management_reporting_subcontractor_snapshots', 'SELECT'),
  'anonymous users cannot read management reporting snapshots'
);
select ok(
  has_table_privilege('authenticated', 'public.management_reporting_snapshots', 'SELECT')
    and has_table_privilege('authenticated', 'public.management_reporting_subcontractor_snapshots', 'SELECT')
    and has_table_privilege('service_role', 'public.management_reporting_snapshots', 'SELECT')
    and has_table_privilege('service_role', 'public.management_reporting_subcontractor_snapshots', 'SELECT'),
  'administrator RLS reads and scheduled service reads have the required reporting snapshot grants'
);
select ok(
  not has_table_privilege('authenticated', 'public.management_reporting_snapshots', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.management_reporting_subcontractor_snapshots', 'INSERT, UPDATE, DELETE'),
  'authenticated clients cannot write reporting snapshot tables directly'
);
select ok(
  not has_function_privilege('anon', 'public.capture_management_reporting_snapshot(date)', 'EXECUTE'),
  'anonymous users cannot capture management reporting snapshots'
);
select ok(
  has_function_privilege('authenticated', 'public.capture_management_reporting_snapshot(date)', 'EXECUTE'),
  'authenticated administrators can invoke the guarded reporting snapshot RPC'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('management_reporting_snapshots', 'management_reporting_subcontractor_snapshots') and qual like '%current_app_user_role%Admin%'),
  2,
  'both reporting snapshot tables enforce administrator-only read policies'
);
select ok(
  not has_table_privilege('anon', 'public.management_report_deliveries', 'SELECT')
    and not has_table_privilege('authenticated', 'public.management_report_deliveries', 'SELECT'),
  'scheduled management-report delivery records are hidden from browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.management_report_deliveries', 'INSERT, UPDATE, DELETE'),
  'authenticated clients cannot alter scheduled management-report delivery records'
);
select ok(
  not has_function_privilege('anon', 'public.claim_management_report_delivery(date,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_management_report_delivery(date,text,text)', 'EXECUTE'),
  'browser clients cannot claim scheduled management-report deliveries'
);
select ok(
  has_table_privilege('service_role', 'public.management_report_deliveries', 'SELECT, INSERT, UPDATE')
    and has_function_privilege('service_role', 'public.claim_management_report_delivery(date,text,text)', 'EXECUTE'),
  'the service workflow alone can checkpoint scheduled management-report delivery'
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
