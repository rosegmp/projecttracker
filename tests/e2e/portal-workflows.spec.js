import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';
const PROJECT_ID = 'portal-workflow-project';

test.describe.configure({ timeout: 90_000 });

function storedSession(role) {
  return {
    accessToken: `${role.toLowerCase()}-portal-token`,
    refreshToken: `${role.toLowerCase()}-portal-refresh`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      id: role === 'Customer'
        ? '50000000-0000-4000-8000-000000000001'
        : '50000000-0000-4000-8000-000000000002',
      email: `${role.toLowerCase()}-workflow@example.test`,
    },
  };
}

function portalProject(overrides = {}) {
  return {
    id: PROJECT_ID,
    name: 'Portal Workflow Project',
    address: '5 Portal Way',
    status: 'active',
    phases: [],
    inspections: [],
    selections: [],
    files: { folders: [] },
    photos: [],
    version: 1,
    ...overrides,
  };
}

async function mockPortalBackend(page, {
  role = 'Customer',
  project = portalProject(),
  handleRequest = async () => null,
}) {
  const appUserId = `${role.toLowerCase()}-workflow-user`;
  const email = `${role.toLowerCase()}-workflow@example.test`;

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession(role));

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { id: appUserId, name: `${role} Workflow User`, email, role },
          mode: 'portal',
          portal: {
            currentUser: { id: appUserId, name: `${role} Workflow User`, email, role },
            projects: [{ ...project, accessUserIds: [appUserId] }],
            calendarSettings: {},
          },
        }),
      });
      return;
    }

    const response = await handleRequest({ request, url });
    if (response) {
      await route.fulfill({
        contentType: 'application/json',
        ...response,
        body: JSON.stringify(response.body),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('customer approves a linked selection through the restricted response RPC', async ({ page }) => {
  const selectionId = 'customer-selection-1';
  const approvalId = 'selection-approval-1';
  let responsePayload = null;
  const selection = {
    id: selectionId,
    category: 'Kitchen',
    itemName: 'Countertop material',
    chosenOption: 'White quartz',
    status: 'needs decision',
    attachments: [],
    photos: [],
    taskIds: [],
  };
  const approvalRow = {
    id: approvalId,
    project_id: PROJECT_ID,
    item_number: 'PORTAL-SEL-001',
    item_type: 'approval',
    audience: 'customer',
    status: 'response_requested',
    title: 'Selection approval: Countertop material',
    data: {
      id: approvalId,
      projectId: PROJECT_ID,
      number: 'PORTAL-SEL-001',
      itemType: 'approval',
      audience: 'customer',
      status: 'response_requested',
      title: 'Selection approval: Countertop material',
      selectionId,
    },
    version: 1,
  };

  await mockPortalBackend(page, {
    project: portalProject({ selections: [selection] }),
    handleRequest: async ({ request, url }) => {
      if (url.pathname.endsWith('/project_portal_items')) {
        return { status: 200, body: [approvalRow] };
      }
      if (url.pathname.endsWith('/rpc/respond_to_project_portal_item')) {
        responsePayload = request.postDataJSON();
        return {
          status: 200,
          body: [{
            ...approvalRow,
            status: 'approved',
            data: {
              ...approvalRow.data,
              status: 'approved',
              response: 'Quartz is approved.',
            },
            version: 2,
          }],
        };
      }
      return null;
    },
  });

  await page.goto(`/?tab=projects&project=${PROJECT_ID}`);
  await page.getByRole('tab', { name: 'Selections' }).click();
  await expect(page.getByText('Countertop material')).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('Add a comment for the project team').fill('Quartz is approved.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect.poll(() => responsePayload, { timeout: 20_000 }).not.toBeNull();
  expect(responsePayload).toEqual({
    p_item_id: approvalId,
    p_version: 1,
    p_response: 'Quartz is approved.',
    p_decision: 'approved',
  });
  await expect(page.getByText('Customer response:')).toBeVisible();
  await expect(page.getByText('Quartz is approved.')).toBeVisible();
});

test('customer submits and then sees a warranty request through customer-only RPCs', async ({ page }) => {
  let submittedPayload = null;
  let listRequests = 0;
  const warrantyRow = {
    id: 'customer-warranty-1',
    project_id: PROJECT_ID,
    item_number: 'WAR-001',
    title: 'Leaking powder room faucet',
    status: 'open',
    data: {
      id: 'customer-warranty-1',
      projectId: PROJECT_ID,
      number: 'WAR-001',
      title: 'Leaking powder room faucet',
      status: 'open',
      category: 'Plumbing',
      priority: 'high',
      description: 'Water is collecting below the powder room faucet.',
      reportedDate: '2026-07-24',
    },
    version: 1,
  };

  await mockPortalBackend(page, {
    handleRequest: async ({ request, url }) => {
      if (url.pathname.endsWith('/rpc/list_customer_warranty_requests')) {
        listRequests += 1;
        return { status: 200, body: submittedPayload ? [warrantyRow] : [] };
      }
      if (url.pathname.endsWith('/rpc/submit_customer_warranty_request')) {
        submittedPayload = request.postDataJSON();
        return { status: 200, body: [warrantyRow] };
      }
      return null;
    },
  });

  await page.goto(`/?tab=projects&project=${PROJECT_ID}`);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByLabel('More project sections', { exact: true })
    .getByRole('button', { name: 'Warranty', exact: true }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();
  const editor = page.getByRole('heading', { name: 'Submit a warranty request' }).locator('xpath=ancestor::section[1]');
  await editor.getByLabel('Title').fill('Leaking powder room faucet');
  await editor.getByLabel('Category').selectOption('Plumbing');
  await editor.getByLabel('Priority').selectOption('high');
  await editor.getByLabel('Description').fill('Water is collecting below the powder room faucet.');
  await editor.getByRole('button', { name: 'Submit warranty request' }).click();

  await expect.poll(() => submittedPayload, { timeout: 20_000 }).not.toBeNull();
  expect(submittedPayload).toEqual({
    p_project_id: PROJECT_ID,
    p_title: 'Leaking powder room faucet',
    p_category: 'Plumbing',
    p_priority: 'high',
    p_description: 'Water is collecting below the powder room faucet.',
  });
  await expect(page.getByText('Warranty request WAR-001 was submitted.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /WAR-001.*Leaking powder room faucet/ })).toBeVisible();
  expect(listRequests).toBeGreaterThanOrEqual(2);
});

test('subcontractor stays inside shared portal, selection, and file boundaries', async ({ page }) => {
  const project = portalProject({
    selections: [{
      id: 'shared-selection',
      category: 'Exterior',
      itemName: 'Shared siding color',
      chosenOption: 'Slate',
      visibleToSubcontractors: true,
      attachments: [],
      photos: [],
      taskIds: [],
    }],
    files: {
      folders: [{
        id: 'shared-folder',
        name: 'Shared Plans',
        visibleToSubcontractors: true,
        files: [{
          id: 'shared-file',
          name: 'Shared elevation.pdf',
          originalName: 'Shared elevation.pdf',
          storagePath: `${PROJECT_ID}/shared-elevation.pdf`,
        }],
      }],
    },
  });
  const subcontractorPortalRow = {
    id: 'subcontractor-request-1',
    project_id: PROJECT_ID,
    item_number: 'PORTAL-SUB-001',
    item_type: 'request',
    audience: 'subcontractor',
    status: 'published',
    title: 'Confirm siding delivery',
    data: {
      id: 'subcontractor-request-1',
      projectId: PROJECT_ID,
      number: 'PORTAL-SUB-001',
      itemType: 'request',
      audience: 'subcontractor',
      status: 'published',
      title: 'Confirm siding delivery',
      message: 'Confirm the siding delivery date.',
    },
    version: 1,
  };

  await mockPortalBackend(page, {
    role: 'Subcontractor',
    project,
    handleRequest: async ({ url }) => (
      url.pathname.endsWith('/project_portal_items')
        ? { status: 200, body: [subcontractorPortalRow] }
        : null
    ),
  });

  await page.goto(`/?tab=projects&project=${PROJECT_ID}`);
  await expect(page.getByRole('tab', { name: 'Portal' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Selections' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Warranty' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Portal' }).click();
  await expect(page.getByText('Confirm siding delivery')).toBeVisible();
  await page.getByRole('tab', { name: 'Selections' }).click();
  await expect(page.getByText('Shared siding color')).toBeVisible();
  await expect(page.getByText('Private selection')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Files' }).click();
  await expect(page.getByText('Shared Plans')).toBeVisible();
  await expect(page.getByText('Shared elevation.pdf')).toBeVisible();
  await expect(page.getByText('Private Files')).toHaveCount(0);
});
