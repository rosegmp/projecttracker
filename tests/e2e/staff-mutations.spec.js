import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';

test.describe.configure({ timeout: 90_000 });

function storedSession(email, userId) {
  return {
    accessToken: 'staff-e2e-access-token',
    refreshToken: 'staff-e2e-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: userId, email },
  };
}

function projectRow(projectId, appUserId) {
  return {
    id: projectId,
    data: {
      id: projectId,
      name: 'Staff Test Project',
      status: 'active',
      accessUserIds: [appUserId],
      phases: [],
      inspections: [],
      selections: [],
      files: { folders: [] },
      photos: [],
    },
    version: 1,
  };
}

function taskRow(taskId, projectId) {
  return {
    id: taskId,
    data: {
      id: taskId,
      label: 'Existing staff task',
      projectId,
      due: '',
      done: false,
      assignees: [],
      attachments: [],
      createdAt: '2026-07-24T12:00:00.000Z',
    },
    version: 1,
  };
}

async function mockStaffBackend(page, {
  role,
  email,
  appUserId,
  authUserId,
  projects = [],
  tasks = [],
  handleRpc = async () => null,
}) {
  const settings = {
    users: [{ id: appUserId, name: `${role} Browser User`, email, role }],
    currentUserId: appUserId,
  };
  const appUserRow = {
    id: appUserId,
    position: 0,
    data: { name: `${role} Browser User`, email, role },
    version: 1,
  };
  const accessRows = projects.map((project, position) => ({
    project_id: project.id,
    user_id: appUserId,
    position,
    version: 1,
  }));

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession(email, authUserId));

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { id: appUserId, name: `${role} Browser User`, email, role },
          mode: 'staff',
          startupProjectId: '',
          settings: { data: settings, version: 1 },
          appUsers: [appUserRow],
          projectAccess: accessRows,
          projects,
          tasks,
          phases: [],
          steps: [],
          folders: [],
          files: [],
          photos: [],
          selections: [],
          inspections: [],
        }),
      });
      return;
    }

    if (url.pathname.includes('/rpc/')) {
      const rpcResponse = await handleRpc({ request, url });
      if (rpcResponse) {
        await route.fulfill({
          contentType: 'application/json',
          ...rpcResponse,
          body: JSON.stringify(rpcResponse.body),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    let body = [];
    if (url.pathname.endsWith('/settings')) {
      body = [{ id: 'app_settings', data: settings, version: 1 }];
    } else if (url.pathname.endsWith('/app_users')) {
      body = [appUserRow];
    } else if (url.pathname.endsWith('/project_user_access')) {
      body = accessRows;
    } else if (url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')) {
      body = projects;
    } else if (url.pathname.endsWith('/task_core_records') || url.pathname.endsWith('/tasks')) {
      body = tasks;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('administrator creates a project through the versioned mutation boundary', async ({ page }) => {
  const appUserId = 'mutation-admin';
  let projectOperation = null;

  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'mutation-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000001',
    projects: [projectRow('staff-admin-existing-project', appUserId)],
    handleRpc: async ({ request, url }) => {
      if (!url.pathname.endsWith('/rpc/apply_tracker_batch')) return null;
      const operations = request.postDataJSON()?.p_operations || [];
      projectOperation = operations.find((operation) => operation.table === 'projects');
      return {
        status: 200,
        body: projectOperation
          ? [{ table: 'projects', id: projectOperation.id, version: 1, deleted: false }]
          : [],
      };
    },
  });

  await page.goto('/?tab=projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name', { exact: true }).fill('Playwright Created Project');
  await dialog.getByLabel('Address', { exact: true }).fill('24 Browser Test Way');
  await dialog.getByRole('button', { name: 'Save project' }).click();

  await expect(page.getByRole('button', { name: 'Playwright Created Project', exact: true })).toBeVisible();
  expect(projectOperation).toMatchObject({
    table: 'projects',
    expectedVersion: 0,
    delete: false,
    data: {
      name: 'Playwright Created Project',
      address: '24 Browser Test Way',
      status: 'planning',
    },
  });
});

test('edit user creates a task and sees an actionable optimistic-conflict message', async ({ page }) => {
  const appUserId = 'mutation-editor';
  const projectId = 'staff-project-1';
  const existingTaskId = 'staff-task-1';
  const projects = [projectRow(projectId, appUserId)];
  const tasks = [taskRow(existingTaskId, projectId)];
  let createdTaskPayload = null;
  let existingTaskSaveAttempts = 0;

  await mockStaffBackend(page, {
    role: 'Edit',
    email: 'mutation-editor@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000002',
    projects,
    tasks,
    handleRpc: async ({ request, url }) => {
      if (url.pathname.endsWith('/rpc/save_task_with_attachments')) {
        const payload = request.postDataJSON();
        if (payload.p_task_id === existingTaskId) {
          existingTaskSaveAttempts += 1;
          return {
            status: 409,
            body: { code: '40001', message: `VERSION_CONFLICT:tasks:${existingTaskId}` },
          };
        }
        createdTaskPayload = payload;
        return {
          status: 200,
          body: { version: 1, normalizedVersions: { attachments: {} } },
        };
      }
      if (url.pathname.endsWith('/rpc/apply_tracker_batch')) {
        const operation = request.postDataJSON()?.p_operations?.[0];
        if (operation?.id === existingTaskId) {
          existingTaskSaveAttempts += 1;
          return {
            status: 409,
            body: { code: '40001', message: `VERSION_CONFLICT:tasks:${existingTaskId}` },
          };
        }
      }
      return null;
    },
  });

  await page.goto('/?tab=tasks');
  const createForm = page.locator('form.task-create-desktop');
  await createForm.getByPlaceholder('Task name').fill('Playwright created task');
  await createForm.locator('select').first().selectOption(projectId);
  await createForm.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(page.getByText('Task saved')).toBeVisible();
  await expect(page.getByText('Playwright created task')).toBeVisible();
  expect(createdTaskPayload).toMatchObject({
    p_task_data: {
      label: 'Playwright created task',
      projectId,
      done: false,
    },
    p_expected_version: 0,
  });

  await page.getByRole('button', { name: 'Edit Existing staff task' }).click();
  const editCard = page.locator('article.task-row-editing');
  await editCard.getByPlaceholder('Task name').fill('Conflicting task edit');
  await editCard.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => existingTaskSaveAttempts, { timeout: 20_000 }).toBe(1);
  const alert = page.getByRole('dialog', { name: 'Save failed' });
  await expect(alert).toContainText('This record was changed by someone else.', { timeout: 20_000 });
  await expect(alert).toContainText('Refresh data, review the latest changes, and try again.');
});
