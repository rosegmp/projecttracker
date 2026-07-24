import assert from 'node:assert/strict';

const PRODUCTION_PROJECT_REF = 'oxojlwhmarafxuqvqgqg';
const stagingUrl = String(process.env.STAGING_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const anonKey = String(process.env.STAGING_SUPABASE_ANON_KEY || '').trim();
const serviceRoleKey = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!stagingUrl || !anonKey || !serviceRoleKey) {
  throw new Error(
    'STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, and STAGING_SUPABASE_SERVICE_ROLE_KEY are required.',
  );
}

const stagingHost = new URL(stagingUrl).hostname;
const stagingProjectRef = stagingHost.split('.')[0];
if (!stagingProjectRef || stagingProjectRef === PRODUCTION_PROJECT_REF) {
  throw new Error('Refusing to run staging writes against the production Supabase project.');
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const password = `Staging-${runId}-aA1!`;
const fixture = {
  projectId: `staging-project-${runId}`,
  restrictedProjectId: `staging-restricted-${runId}`,
  taskId: `staging-task-${runId}`,
  portalCustomerId: `staging-portal-customer-${runId}`,
  portalSubcontractorId: `staging-portal-sub-${runId}`,
  appUsers: [
    { id: `staging-admin-${runId}`, role: 'Admin' },
    { id: `staging-editor-${runId}`, role: 'Edit' },
    { id: `staging-customer-${runId}`, role: 'Customer' },
    { id: `staging-subcontractor-${runId}`, role: 'Subcontractor' },
  ],
};
fixture.appUsers.forEach((user) => {
  user.email = `project-tracker-${user.role.toLowerCase()}-${runId}@example.test`;
});

const authUserIds = [];

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function userHeaders(accessToken, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(path, {
  method = 'GET',
  headers = serviceHeaders(),
  body,
  expected = [200],
  label = path,
} = {}) {
  const response = await fetch(`${stagingUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${label} failed (${response.status}): ${text || 'No response body.'}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createAuthUser(user) {
  const payload = await request('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { staging_test_run: runId, application_role: user.role },
    },
    expected: [200, 201],
    label: `Create ${user.role} auth user`,
  });
  const authUserId = String(payload?.id || payload?.user?.id || '');
  assert.ok(authUserId, `Create ${user.role} auth user returned no id`);
  authUserIds.push(authUserId);
  return authUserId;
}

async function signIn(user) {
  const payload = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: { email: user.email, password },
    label: `${user.role} sign-in`,
  });
  assert.ok(payload?.access_token, `${user.role} sign-in returned no access token`);
  return payload.access_token;
}

async function cleanup() {
  const cleanupRequests = [
    `/rest/v1/project_portal_items?project_id=eq.${encodeURIComponent(fixture.projectId)}`,
    `/rest/v1/project_warranty_items?project_id=eq.${encodeURIComponent(fixture.projectId)}`,
    `/rest/v1/tasks?id=eq.${encodeURIComponent(fixture.taskId)}`,
    `/rest/v1/project_user_access?project_id=in.(${encodeURIComponent(fixture.projectId)},${encodeURIComponent(fixture.restrictedProjectId)})`,
    `/rest/v1/projects?id=in.(${encodeURIComponent(fixture.projectId)},${encodeURIComponent(fixture.restrictedProjectId)})`,
    `/rest/v1/app_users?id=in.(${fixture.appUsers.map((user) => encodeURIComponent(user.id)).join(',')})`,
  ];
  for (const path of cleanupRequests) {
    try {
      await request(path, { method: 'DELETE', expected: [200, 204], label: `Cleanup ${path}` });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
  for (const authUserId of authUserIds.reverse()) {
    try {
      await request(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
        method: 'DELETE',
        expected: [200, 204],
        label: `Cleanup auth user ${authUserId}`,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

async function provision() {
  for (const [position, user] of fixture.appUsers.entries()) {
    await createAuthUser(user);
    await request('/rest/v1/app_users', {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: {
        id: user.id,
        position,
        data: { name: `Staging ${user.role}`, email: user.email, role: user.role },
      },
      expected: [201],
      label: `Create ${user.role} app user`,
    });
  }

  const [admin, editor, customer, subcontractor] = fixture.appUsers;
  await request('/rest/v1/projects', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: [
      {
        id: fixture.projectId,
        data: {
          id: fixture.projectId,
          name: `Staging Application Test ${runId}`,
          status: 'active',
          accessUserIds: fixture.appUsers.map((user) => user.id),
        },
      },
      {
        id: fixture.restrictedProjectId,
        data: {
          id: fixture.restrictedProjectId,
          name: `Staging Restricted Test ${runId}`,
          status: 'active',
          accessUserIds: [admin.id],
        },
      },
    ],
    expected: [201],
    label: 'Create staging projects',
  });
  await request('/rest/v1/project_user_access?on_conflict=project_id,user_id', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: [
      ...fixture.appUsers.map((user, position) => ({
        project_id: fixture.projectId,
        user_id: user.id,
        position,
      })),
      { project_id: fixture.restrictedProjectId, user_id: admin.id, position: 0 },
    ],
    expected: [201],
    label: 'Create normalized staging project access',
  });
  await request('/rest/v1/tasks', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: {
      id: fixture.taskId,
      data: {
        id: fixture.taskId,
        label: 'Staging authorized task',
        projectId: fixture.projectId,
        done: false,
        due: '',
        assignees: [],
        attachments: [],
      },
    },
    expected: [201],
    label: 'Create staging task',
  });
  await request('/rest/v1/project_portal_items', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: [
      {
        id: fixture.portalCustomerId,
        project_id: fixture.projectId,
        item_number: 'STAGE-CUSTOMER-001',
        item_type: 'request',
        audience: 'customer',
        status: 'published',
        title: 'Staging customer request',
        data: {
          id: fixture.portalCustomerId,
          projectId: fixture.projectId,
          number: 'STAGE-CUSTOMER-001',
          itemType: 'request',
          audience: 'customer',
          status: 'published',
          title: 'Staging customer request',
        },
      },
      {
        id: fixture.portalSubcontractorId,
        project_id: fixture.projectId,
        item_number: 'STAGE-SUB-001',
        item_type: 'request',
        audience: 'subcontractor',
        status: 'published',
        title: 'Staging subcontractor request',
        data: {
          id: fixture.portalSubcontractorId,
          projectId: fixture.projectId,
          number: 'STAGE-SUB-001',
          itemType: 'request',
          audience: 'subcontractor',
          status: 'published',
          title: 'Staging subcontractor request',
        },
      },
    ],
    expected: [201],
    label: 'Create staging portal items',
  });

  return { admin, editor, customer, subcontractor };
}

async function runAssertions(users) {
  const tokens = Object.fromEntries(
    await Promise.all(
      Object.entries(users).map(async ([key, user]) => [key, await signIn(user)]),
    ),
  );

  const adminProjects = await request('/rest/v1/projects?select=id&order=id.asc', {
    headers: userHeaders(tokens.admin),
    label: 'Admin project visibility',
  });
  assert.ok(adminProjects.some((row) => row.id === fixture.projectId));
  assert.ok(adminProjects.some((row) => row.id === fixture.restrictedProjectId));

  const editorProjects = await request('/rest/v1/projects?select=id&order=id.asc', {
    headers: userHeaders(tokens.editor),
    label: 'Editor project visibility',
  });
  assert.deepEqual(editorProjects.map((row) => row.id), [fixture.projectId]);

  for (const role of ['customer', 'subcontractor']) {
    const directProjects = await request('/rest/v1/projects?select=id', {
      headers: userHeaders(tokens[role]),
      label: `${role} direct project boundary`,
    });
    assert.deepEqual(directProjects, [], `${role} must not directly query internal projects`);
    const bootstrap = await request('/rest/v1/rpc/get_app_startup_bootstrap', {
      method: 'POST',
      headers: userHeaders(tokens[role]),
      body: {},
      label: `${role} startup bootstrap`,
    });
    const portalProjects = bootstrap?.portal?.projects || [];
    assert.deepEqual(portalProjects.map((project) => project.id), [fixture.projectId]);
  }

  const editorSave = await request('/rest/v1/rpc/apply_tracker_batch', {
    method: 'POST',
    headers: userHeaders(tokens.editor),
    body: {
      p_operations: [{
        table: 'tasks',
        id: fixture.taskId,
        expectedVersion: 1,
        delete: false,
        data: {
          id: fixture.taskId,
          label: 'Updated through staging application test',
          projectId: fixture.projectId,
          done: false,
          due: '',
          assignees: [],
          attachments: [],
        },
      }],
    },
    label: 'Editor task mutation',
  });
  assert.equal(editorSave?.[0]?.version, 2);

  const customerPortalItems = await request(
    `/rest/v1/project_portal_items?select=id,audience&project_id=eq.${encodeURIComponent(fixture.projectId)}&order=id.asc`,
    { headers: userHeaders(tokens.customer), label: 'Customer portal audience boundary' },
  );
  assert.deepEqual(customerPortalItems.map((row) => row.id), [fixture.portalCustomerId]);

  const subcontractorPortalItems = await request(
    `/rest/v1/project_portal_items?select=id,audience&project_id=eq.${encodeURIComponent(fixture.projectId)}&order=id.asc`,
    { headers: userHeaders(tokens.subcontractor), label: 'Subcontractor portal audience boundary' },
  );
  assert.deepEqual(subcontractorPortalItems.map((row) => row.id), [fixture.portalSubcontractorId]);

  const warrantyRows = await request('/rest/v1/rpc/submit_customer_warranty_request', {
    method: 'POST',
    headers: userHeaders(tokens.customer),
    body: {
      p_project_id: fixture.projectId,
      p_title: 'Staging warranty request',
      p_category: 'General',
      p_priority: 'normal',
      p_description: 'Disposable staging authorization verification.',
    },
    label: 'Customer warranty submission',
  });
  assert.equal(warrantyRows?.length, 1);
  assert.equal(warrantyRows[0]?.project_id, fixture.projectId);
}

let passed = false;
try {
  const users = await provision();
  await runAssertions(users);
  passed = true;
} finally {
  await cleanup();
}

if (!passed) process.exitCode = 1;
else console.log(`Staging application authorization tests passed and cleaned up (${runId}).`);
