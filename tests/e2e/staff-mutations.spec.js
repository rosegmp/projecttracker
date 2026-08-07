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

function blankPdfBuffer() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function mockStaffBackend(page, {
  role,
  email,
  appUserId,
  authUserId,
  projects = [],
  tasks = [],
  subs = [],
  certificateRows = [],
  coverageRows = [],
  warrantyRows = [],
  dailyLogRows = [],
  rfiRows = [],
  submittalRows = [],
  closeoutRows = [],
  phaseRows = [],
  stepRows = [],
  folderRows = [],
  fileRows = [],
  selectionRows = [],
  inspectionRows = [],
  visibleProjectTabs,
  runtimeStatus = { writesFrozen: false, message: '', changedAt: '' },
  handleRpc = async () => null,
  handleRest = async () => null,
}) {
  const settings = {
    users: [{ id: appUserId, name: `${role} Browser User`, email, role }],
    currentUserId: appUserId,
    ...(visibleProjectTabs ? { visibleProjectTabs } : {}),
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
          phases: phaseRows,
          steps: stepRows,
          folders: folderRows,
          files: fileRows,
          photos: [],
          selections: selectionRows,
          inspections: inspectionRows,
        }),
      });
      return;
    }

    if (url.pathname.endsWith('/rpc/get_app_runtime_status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(runtimeStatus),
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

    const restResponse = await handleRest({ request, url });
    if (restResponse) {
      await route.fulfill({
        contentType: 'application/json',
        ...restResponse,
        body: JSON.stringify(restResponse.body),
      });
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
    } else if (url.pathname.endsWith('/people')) {
      body = subs.map((subcontractor, position) => ({
        id: `people-${subcontractor.id}`,
        source_table: 'subs',
        legacy_id: subcontractor.id,
        people_type: 'sub',
        data: { ...subcontractor, peopleType: 'sub' },
        version: 1,
        created_at: `2026-07-24T12:00:0${position}.000Z`,
      }));
    } else if (url.pathname.endsWith('/insurance_certificates')) {
      body = certificateRows;
    } else if (url.pathname.endsWith('/insurance_certificate_coverages')) {
      body = coverageRows;
    } else if (url.pathname.endsWith('/project_warranty_items')) {
      body = warrantyRows;
    } else if (url.pathname.endsWith('/project_daily_logs')) {
      body = dailyLogRows;
    } else if (url.pathname.endsWith('/project_rfis')) {
      body = rfiRows;
    } else if (url.pathname.endsWith('/project_submittals')) {
      body = submittalRows;
    } else if (url.pathname.endsWith('/project_closeout_items')) {
      body = closeoutRows;
    } else if (url.pathname.endsWith('/project_file_folders')) {
      body = folderRows;
    } else if (url.pathname.endsWith('/project_files')) {
      body = fileRows;
    } else if (url.pathname.endsWith('/project_phases')) {
      body = phaseRows;
    } else if (url.pathname.endsWith('/project_steps')) {
      body = stepRows;
    } else if (url.pathname.endsWith('/project_selections')) {
      body = selectionRows;
    } else if (url.pathname.endsWith('/project_inspections')) {
      body = inspectionRows;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('task deep link opens the authorized project task and highlights it', async ({ page }) => {
  const appUserId = 'task-link-admin';
  const projectId = 'task-link-project';
  const taskId = 'task-link-task';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'task-link-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000009',
    projects: [projectRow(projectId, appUserId)],
    tasks: [taskRow(taskId, projectId)],
  });

  await page.goto(`/?tab=projects&project=${projectId}&projectTab=tasks&task=${taskId}`);

  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  const linkedTask = page.getByText('Existing staff task').locator('xpath=ancestor::article[1]');
  await expect(linkedTask).toHaveClass(/highlighted/);
});

test('projectless task deep link opens the top-level task and highlights it', async ({ page }) => {
  const appUserId = 'general-task-link-admin';
  const taskId = 'general-task-link-task';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'general-task-link-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000008',
    tasks: [taskRow(taskId, '')],
  });

  await page.goto(`/?tab=tasks&task=${taskId}`);

  await expect(page.getByRole('button', { name: /^Tasks:/ })).toHaveAttribute('aria-current', 'page');
  const linkedTask = page.getByText('Existing staff task').locator('xpath=ancestor::article[1]');
  await expect(linkedTask).toHaveClass(/highlighted/);
});

test('global search opens from the keyboard and navigates to an exact task', async ({ page }) => {
  const appUserId = 'global-search-admin';
  const projectId = 'global-search-project';
  const taskId = 'global-search-task';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'global-search-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000019',
    projects: [projectRow(projectId, appUserId)],
    tasks: [taskRow(taskId, projectId)],
  });

  await page.goto('/?tab=home');
  await expect(page.getByRole('button', { name: 'Search and quick actions' })).toBeVisible();
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await expect(palette).toBeVisible();
  const search = palette.getByRole('combobox', { name: 'Search projects, files, tasks, people, and field records' });
  await expect(search).toBeFocused();
  await search.fill('Existing staff task');
  await palette.getByRole('option', { name: /Existing staff task/ }).click();

  await expect(page.getByRole('button', { name: /^Tasks:/ })).toHaveAttribute('aria-current', 'page');
  const taskCard = page.getByText('Existing staff task').locator('xpath=ancestor::article[1]');
  await expect(taskCard).toHaveClass(/highlighted/);
  await page.keyboard.press('Control+K');
  const recentPalette = page.getByRole('dialog', { name: 'Go anywhere' });
  await expect(recentPalette.getByRole('option').first()).toHaveAccessibleName(/Existing staff task.*Recent/);
});

test('global search keeps keyboard focus contained and scrolls the active result into view', async ({ page }) => {
  const appUserId = 'global-search-keyboard-admin';
  const projectId = 'global-search-keyboard-project';
  const tasks = Array.from({ length: 15 }, (_, index) => ({
    ...taskRow(`global-search-keyboard-task-${index + 1}`, projectId),
    data: {
      ...taskRow(`global-search-keyboard-task-${index + 1}`, projectId).data,
      label: `Keyboard result ${String(index + 1).padStart(2, '0')}`,
    },
  }));
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'global-search-keyboard-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000025',
    projects: [projectRow(projectId, appUserId)],
    tasks,
  });

  await page.goto('/?tab=tasks');
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Go anywhere' });
  const search = palette.getByRole('combobox');
  await search.fill('Keyboard result');
  for (let index = 0; index < 10; index += 1) await page.keyboard.press('ArrowDown');

  const activeResult = palette.getByRole('option').nth(10);
  await expect(activeResult).toHaveAttribute('aria-selected', 'true');
  expect(await activeResult.evaluate((element) => {
    const resultBounds = element.getBoundingClientRect();
    const containerBounds = element.parentElement.getBoundingClientRect();
    return resultBounds.top >= containerBounds.top && resultBounds.bottom <= containerBounds.bottom;
  })).toBe(true);

  await palette.getByRole('button', { name: 'Close global search' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(palette.getByRole('option').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(palette.getByRole('button', { name: 'Close global search' })).toBeFocused();
});

test('global search opens schedule and inspection records in context', async ({ page }) => {
  const appUserId = 'global-record-search-admin';
  const projectId = 'global-record-project';
  const phaseId = 'global-record-phase';
  const stepId = 'global-record-step';
  const inspectionId = 'global-record-inspection';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'global-record-search-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000021',
    projects: [projectRow(projectId, appUserId)],
    phaseRows: [{ project_id: projectId, id: phaseId, position: 0, data: { name: 'Roughs', start: '2026-08-01', end: '2026-08-20' }, version: 1 }],
    stepRows: [{ project_id: projectId, phase_id: phaseId, id: stepId, position: 0, data: { name: 'Rough plumbing', start: '2026-08-02', end: '2026-08-08', assignees: ['Pipe It'] }, version: 1 }],
    inspectionRows: [{ project_id: projectId, id: inspectionId, position: 0, data: { subcode: 'PLUMB-101', inspectionType: 'Plumbing', status: 'scheduled', date: '2026-08-08', agency: 'Township' }, version: 1 }],
  });

  await page.goto('/?tab=home');
  await expect(page.getByRole('button', { name: 'Search and quick actions' })).toBeVisible();
  await page.keyboard.press('Control+K');
  let palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await palette.getByRole('combobox').fill('Rough plumbing');
  await palette.getByRole('option', { name: /Rough plumbing/ }).click();
  await expect(page.getByRole('button', { name: /^Schedule:/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('searchbox', { name: 'Search schedule' })).toHaveValue('Rough plumbing');

  await page.keyboard.press('Control+K');
  palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await palette.getByRole('combobox').fill('PLUMB-101');
  await palette.getByRole('option', { name: /PLUMB-101/ }).click();
  await expect(page.getByRole('tab', { name: 'Inspections' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('article.inspection-card').filter({ hasText: 'PLUMB-101' })).toHaveClass(/highlighted/);
});

test('global search loads files and daily logs on demand and opens exact records', async ({ page }) => {
  const appUserId = 'global-workflow-search-admin';
  const projectId = 'global-workflow-project';
  const folderId = 'global-workflow-folder';
  const fileId = 'global-workflow-file';
  const dailyLogId = 'global-workflow-log';
  const workflowSearchRequests = [];
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'global-workflow-search-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000022',
    projects: [projectRow(projectId, appUserId)],
    folderRows: [{ project_id: projectId, id: folderId, position: 0, data: { name: 'Permits' }, version: 1 }],
    fileRows: [{ project_id: projectId, folder_id: folderId, id: fileId, position: 0, data: { originalName: 'Building Permit.pdf', name: 'Building Permit.pdf', type: 'application/pdf' }, version: 1 }],
    dailyLogRows: [{ project_id: projectId, id: dailyLogId, log_date: '2026-08-03', title: 'Foundation pour log', data: { weather: 'Sunny', notes: 'Concrete delivery complete' }, version: 1 }],
    handleRest: async ({ url }) => {
      if (url.searchParams.has('limit') && /project_(daily_logs|rfis|submittals|warranty_items|closeout_items)$/.test(url.pathname)) {
        workflowSearchRequests.push(url.toString());
      }
      return null;
    },
  });

  await page.goto('/?tab=home');
  await expect(page.getByRole('button', { name: 'Search and quick actions' })).toBeVisible();
  await page.keyboard.press('Control+K');
  let palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await expect.poll(() => workflowSearchRequests.length).toBe(5);
  workflowSearchRequests.forEach((requestUrl) => {
    const url = new URL(requestUrl);
    expect(url.searchParams.get('limit')).toBe('250');
    expect(url.searchParams.get('select')).not.toBe('*');
  });
  await palette.getByRole('combobox').fill('Building Permit');
  await palette.getByRole('option', { name: /Building Permit\.pdf/ }).click();
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.files-hierarchy-file-row').filter({ hasText: 'Building Permit.pdf' })).toHaveClass(/highlighted/);

  await page.keyboard.press('Control+K');
  palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await page.waitForTimeout(100);
  expect(workflowSearchRequests).toHaveLength(5);
  const search = palette.getByRole('combobox');
  await search.fill('Concrete delivery complete');
  const dailyLogResult = palette.getByRole('option', { name: /Foundation pour log/ });
  await expect(dailyLogResult).toBeVisible();
  await dailyLogResult.click();
  await expect(page.getByRole('tab', { name: 'Daily Logs' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('article.project-workflow-card').filter({ hasText: 'Foundation pour log' })).toHaveClass(/highlighted/);
});

test('global search skips workflow reads and actions for hidden project tabs', async ({ page }) => {
  const appUserId = 'global-search-hidden-tabs-admin';
  const projectId = 'global-search-hidden-tabs-project';
  const workflowSearchRequests = [];
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'global-search-hidden-tabs-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000026',
    projects: [projectRow(projectId, appUserId)],
    visibleProjectTabs: ['overview', 'files'],
    dailyLogRows: [{ project_id: projectId, id: 'hidden-log', log_date: '2026-08-03', title: 'Hidden workflow record', data: {}, version: 1 }],
    handleRest: async ({ url }) => {
      if (url.searchParams.has('limit') && url.pathname.includes('/project_')) workflowSearchRequests.push(url.toString());
      return null;
    },
  });

  await page.goto('/?tab=tasks');
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await palette.getByRole('combobox').fill('Hidden workflow record');
  await expect(palette.getByText('No matching results')).toBeVisible();
  expect(workflowSearchRequests).toHaveLength(0);
  await palette.getByRole('combobox').fill('Add inspection');
  await expect(palette.getByRole('option', { name: /Add inspection/ })).toHaveCount(0);
});

test('mobile global search exposes quick task creation', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  const appUserId = 'mobile-global-search-admin';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'mobile-global-search-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000020',
    projects: [projectRow('mobile-global-search-project', appUserId)],
  });

  await page.goto('/?tab=home');
  await page.getByRole('button', { name: 'Search and quick actions' }).click();
  const palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await expect(palette).toBeVisible();
  await palette.getByRole('option', { name: /Create task/ }).click();

  const taskDialog = page.getByRole('dialog', { name: 'Add task' });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog.getByPlaceholder('Task name')).toBeFocused();
});

test('global inspection quick action chooses a project and opens the existing form', async ({ page }) => {
  const appUserId = 'inspection-command-admin';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'inspection-command-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000022',
    projects: [projectRow('inspection-command-project', appUserId)],
  });

  await page.goto('/?tab=home');
  await expect(page.getByRole('button', { name: 'Search and quick actions' })).toBeVisible();
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Go anywhere' });
  await palette.getByRole('combobox').fill('Add inspection');
  await palette.getByRole('option', { name: /Add inspection/ }).click();
  const projectPrompt = page.getByRole('dialog', { name: 'Add inspection' });
  await expect(projectPrompt.getByRole('combobox', { name: 'Project' })).toHaveValue('inspection-command-project');
  await projectPrompt.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog', { name: 'Add inspection' })).toBeVisible();
});

test('maintenance mode keeps staff workspace readable and disables project changes', async ({ page }) => {
  const appUserId = 'maintenance-admin';
  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'maintenance-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000010',
    projects: [projectRow('maintenance-project', appUserId)],
    runtimeStatus: {
      writesFrozen: true,
      message: 'Recovery validation is in progress.',
      changedAt: '2026-08-04T16:00:00Z',
    },
  });

  await page.goto('/?tab=projects');
  await expect(page.getByText('Maintenance mode — changes are paused')).toBeVisible();
  await expect(page.getByText(/Recovery validation is in progress/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Staff Test Project', exact: true })).toBeVisible();
});

test('staff can review and discard one conflicted device copy', async ({ page }) => {
  const appUserId = 'offline-review-editor';
  const authUserId = '40000000-0000-4000-8000-000000000011';
  const projectId = 'offline-review-project';
  await page.addInitScript(({ userId, operation }) => {
    window.localStorage.setItem(
      `project-tracker:offline-operations:v1:${userId}`,
      JSON.stringify([operation]),
    );
  }, {
    userId: authUserId,
    operation: {
      id: 'offline-review-operation',
      userId: authUserId,
      kind: 'daily-log.save',
      action: 'save',
      projectId,
      entityId: 'daily-log-review',
      payload: { id: 'daily-log-review', date: '2026-08-04', title: 'Daily log', notes: 'Device framing notes', version: 2 },
      expected: { version: 2 },
      queuedAt: '2026-08-04T17:00:00.000Z',
      updatedAt: '2026-08-04T17:01:00.000Z',
      status: 'needs-attention',
      lastError: 'This record changed on the server. Reopen it and apply the device changes manually.',
    },
  });
  await mockStaffBackend(page, {
    role: 'Edit',
    email: 'offline-review@example.test',
    appUserId,
    authUserId,
    projects: [projectRow(projectId, appUserId)],
  });

  await page.goto('/?tab=projects');
  await expect(page.getByText('1 device-saved change need attention')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: 'Review device-saved changes' });
  await expect(reviewDialog.getByText('2026-08-04')).toBeVisible();
  await expect(reviewDialog.getByText('Staff Test Project')).toBeVisible();
  await expect(reviewDialog.getByText(/changed on the server/)).toBeVisible();
  await reviewDialog.getByRole('button', { name: 'Discard' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Discard device copy' });
  await confirmDialog.getByRole('button', { name: 'Discard' }).click();
  await expect(reviewDialog.getByText('No device-saved changes')).toBeVisible();
  await expect(page.getByText('device-saved change need attention')).toHaveCount(0);
});

test('staff task updates save on device offline and synchronize after reconnect', async ({ page, context }) => {
  const appUserId = 'offline-task-editor';
  const authUserId = '40000000-0000-4000-8000-000000000012';
  const projectId = 'offline-task-project';
  const taskId = 'offline-task-1';
  let syncedTask = null;
  await mockStaffBackend(page, {
    role: 'Edit',
    email: 'offline-task@example.test',
    appUserId,
    authUserId,
    projects: [projectRow(projectId, appUserId)],
    tasks: [taskRow(taskId, projectId)],
    handleRpc: async ({ request, url }) => {
      if (!url.pathname.endsWith('/rpc/save_task_with_attachments')) return null;
      syncedTask = request.postDataJSON();
      return {
        status: 200,
        body: { version: 2, normalizedVersions: { attachments: {} } },
      };
    },
  });

  await page.goto('/?tab=tasks');
  const taskCard = page.locator('article.task-row-card').filter({ hasText: 'Existing staff task' });
  await expect(taskCard).toBeVisible();
  await context.setOffline(true);
  await taskCard.locator('input[type="checkbox"]').check();
  await expect(taskCard.getByText('Saved on device')).toBeVisible();

  const queued = await page.evaluate((userId) => JSON.parse(
    window.localStorage.getItem(`project-tracker:offline-operations:v1:${userId}`) || '[]',
  ), authUserId);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    kind: 'task.save',
    projectId,
    entityId: taskId,
    status: 'pending',
    payload: { id: taskId, done: true },
    expected: { version: 1, attachmentVersions: {} },
  });

  await context.setOffline(false);
  await expect.poll(() => syncedTask).not.toBeNull();
  expect(syncedTask).toMatchObject({
    p_task_id: taskId,
    p_task_data: { id: taskId, done: true },
    p_expected_version: 1,
    p_expected_attachment_versions: {},
  });
  await expect.poll(() => page.evaluate((userId) => JSON.parse(
    window.localStorage.getItem(`project-tracker:offline-operations:v1:${userId}`) || '[]',
  ).length, authUserId)).toBe(0);
});

test('staff warranty updates save on device offline and synchronize after reconnect', async ({ page, context }) => {
  const appUserId = 'offline-warranty-editor';
  const authUserId = '40000000-0000-4000-8000-000000000013';
  const projectId = 'offline-warranty-project';
  const warrantyId = 'offline-warranty-1';
  const warrantyRow = {
    id: warrantyId,
    project_id: projectId,
    item_number: 'WAR-001',
    title: 'Original punch item',
    status: 'open',
    data: {
      id: warrantyId,
      projectId,
      number: 'WAR-001',
      title: 'Original punch item',
      status: 'open',
      category: 'Interior',
      priority: 'normal',
      attachments: [],
    },
    version: 1,
    created_at: '2026-08-04T12:00:00.000Z',
    updated_at: '2026-08-04T12:00:00.000Z',
  };
  let syncedWarranty = null;
  await mockStaffBackend(page, {
    role: 'Edit',
    email: 'offline-warranty@example.test',
    appUserId,
    authUserId,
    projects: [projectRow(projectId, appUserId)],
    warrantyRows: [warrantyRow],
    handleRest: async ({ request, url }) => {
      if (!url.pathname.endsWith('/project_warranty_items') || request.method() !== 'PATCH') return null;
      syncedWarranty = request.postDataJSON();
      return {
        status: 200,
        body: [{
          ...warrantyRow,
          title: syncedWarranty.title,
          status: syncedWarranty.status,
          data: syncedWarranty.data,
          version: 2,
          updated_at: '2026-08-04T13:00:00.000Z',
        }],
      };
    },
  });

  await page.goto('/?tab=projects');
  await page.getByRole('button', { name: 'Staff Test Project', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByLabel('More project sections', { exact: true })
    .getByRole('button', { name: 'Warranty & Closeout', exact: true }).click();
  await expect(page.getByText('WAR-001 · Original punch item')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Edit WAR-001' }).click();
  const editor = page.getByRole('heading', { name: 'Edit warranty item' }).locator('xpath=ancestor::section[1]');
  await editor.getByLabel('Title').fill('Updated device punch item');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved on device')).toBeVisible();

  const queued = await page.evaluate((userId) => JSON.parse(
    window.localStorage.getItem(`project-tracker:offline-operations:v1:${userId}`) || '[]',
  ), authUserId);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    kind: 'warranty-item.save',
    projectId,
    entityId: warrantyId,
    status: 'pending',
    payload: { id: warrantyId, title: 'Updated device punch item', version: 1 },
    expected: { version: 1 },
  });

  await context.setOffline(false);
  await expect.poll(() => syncedWarranty).not.toBeNull();
  expect(syncedWarranty).toMatchObject({
    id: warrantyId,
    project_id: projectId,
    title: 'Updated device punch item',
    data: { id: warrantyId, title: 'Updated device punch item' },
  });
  await expect.poll(() => page.evaluate((userId) => JSON.parse(
    window.localStorage.getItem(`project-tracker:offline-operations:v1:${userId}`) || '[]',
  ).length, authUserId)).toBe(0);
});

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

  await page.getByRole('button', { name: 'Select all visible' }).click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  const bulkEmailDialog = page.getByRole('dialog', { name: 'Email 2 selected tasks' });
  await expect(bulkEmailDialog).toBeVisible();
  await expect(bulkEmailDialog.getByLabel('Email address')).toHaveAttribute('multiple', '');
  await expect(bulkEmailDialog).toContainText('No assignee email is saved for these tasks.');
  await bulkEmailDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Existing staff task' }).click();
  const editCard = page.locator('article.task-row-editing');
  await editCard.getByPlaceholder('Task name').fill('Conflicting task edit');
  await editCard.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => existingTaskSaveAttempts, { timeout: 20_000 }).toBe(1);
  const alert = page.getByRole('dialog', { name: 'Save failed' });
  await expect(alert).toContainText('This record was changed by someone else.', { timeout: 20_000 });
  await expect(alert).toContainText('Refresh data, review the latest changes, and try again.');
});

test('Takeoff drawing shapes support constrained geometry and editable styles', async ({ page }) => {
  const appUserId = 'takeoff-drawing-editor';
  const projectId = 'takeoff-drawing-project';
  await mockStaffBackend(page, {
    role: 'Edit',
    email: 'takeoff-drawing@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000012',
    projects: [projectRow(projectId, appUserId)],
  });

  await page.goto(`/?tab=projects&project=${projectId}`);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByLabel('More project sections', { exact: true })
    .getByRole('button', { name: 'Takeoff', exact: true }).click();
  await page.locator('#pdfInput').setInputFiles({
    name: 'blank-plan.pdf',
    mimeType: 'application/pdf',
    buffer: blankPdfBuffer(),
  });
  await expect(page.locator('#pageLabel')).toHaveText('Page 1 / 1');

  await page.locator('[data-tool="rectangle"]').click();
  const overlay = page.locator('#measureOverlay');
  let box = await overlay.boundingBox();
  expect(box).toBeTruthy();
  const start = { x: box.x + 120, y: box.y + 120 };
  const end = { x: box.x + 230, y: box.y + 180 };
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const rectangle = page.locator('.markup-shape');
  await expect(rectangle).toHaveCount(1);
  const width = Number(await rectangle.getAttribute('width'));
  const height = Number(await rectangle.getAttribute('height'));
  expect(Math.abs(width - height)).toBeLessThan(0.1);

  await page.locator('[data-tool="select"]').click();
  await page.locator('.markup-shape-hit').click();
  await expect(page.locator('.drawing-edit-handle')).toHaveCount(2);
  const resizeHandle = page.getByRole('button', { name: 'Resize Rectangle point 2' });
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).toBeTruthy();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 25, handleBox.y + handleBox.height / 2 + 15, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await rectangle.getAttribute('width'))).toBeGreaterThan(width);
  await page.locator('#markupThickness').fill('7');
  await page.locator('#markupThickness').press('Tab');
  await expect(rectangle).toHaveAttribute('stroke-width', '7');
  box = await overlay.boundingBox();
  expect(box).toBeTruthy();

  await page.locator('[data-tool="oval"]').click();
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 280, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 170, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const oval = page.locator('ellipse.markup-shape');
  await expect(oval).toHaveCount(1);
  expect(Math.abs(Number(await oval.getAttribute('rx')) - Number(await oval.getAttribute('ry')))).toBeLessThan(0.1);

  await page.locator('[data-tool="line"]').click();
  await page.mouse.move(box.x + 280, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 290, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('polyline.markup-path')).toHaveCount(1);

  await page.locator('[data-tool="multiline"]').click();
  await page.mouse.click(box.x + 300, box.y + 160);
  await page.mouse.click(box.x + 360, box.y + 210);
  await page.mouse.click(box.x + 420, box.y + 170);
  await page.locator('#finishMeasure').click();
  await expect(page.locator('polyline.markup-path')).toHaveCount(2);
  await expect(page.locator('#statusText')).toHaveText('Connected lines added.');
});

test('administrator creates a subcontractor insurance certificate without project scope', async ({ page }) => {
  const appUserId = 'certificate-admin';
  const subcontractorId = 'certificate-sub-1';
  const excludedSubcontractorId = 'certificate-sub-2';
  const certificateId = '50000000-0000-4000-8000-000000000001';
  let certificateSave = null;
  const certificateSaves = [];
  const subcontractorOperations = [];

  await mockStaffBackend(page, {
    role: 'Admin',
    email: 'certificate-admin@example.test',
    appUserId,
    authUserId: '40000000-0000-4000-8000-000000000003',
    subs: [
      {
        id: subcontractorId,
        company: 'Bright Electric LLC',
        first: 'Bea',
        last: 'Tester',
      },
      {
        id: excludedSubcontractorId,
        company: 'No Certificate Roofing',
        first: 'Nora',
        last: 'Tester',
      },
    ],
    handleRpc: async ({ request, url }) => {
      if (url.pathname.endsWith('/rpc/apply_tracker_batch')) {
        const operations = request.postDataJSON()?.p_operations || [];
        subcontractorOperations.push(...operations.filter((operation) => operation.table === 'subs'));
        return {
          status: 200,
          body: operations.map((operation) => ({
            table: operation.table,
            id: operation.id,
            version: Number(operation.expectedVersion) + 1,
            deleted: false,
          })),
        };
      }
      if (!url.pathname.endsWith('/rpc/save_insurance_certificate')) return null;
      certificateSave = request.postDataJSON();
      certificateSaves.push(certificateSave);
      return {
        status: 200,
        body: {
          id: `${certificateId.slice(0, -1)}${certificateSaves.length}`,
          subcontractor_id: certificateSave.p_certificate.subcontractorId,
          holder: certificateSave.p_certificate.holder,
          insured: certificateSave.p_certificate.insured,
          insurer: certificateSave.p_certificate.insurer,
          policy_number: certificateSave.p_certificate.policyNumber,
          effective_date: certificateSave.p_certificate.effectiveDate,
          expiration_date: certificateSave.p_certificate.expirationDate,
          additional_insured: certificateSave.p_certificate.additionalInsured,
          source_file_name: '',
          source_bucket: '',
          source_path: '',
          extraction_confidence: '',
          extraction_notes: '',
          version: 1,
          coverages: certificateSave.p_coverages.map((coverage, index) => ({
            id: coverage.id,
            certificate_id: certificateId,
            coverage_type: coverage.type,
            coverage_amount: coverage.generalLimit,
            aggregate_amount: coverage.aggregateLimit,
            effective_date: coverage.effectiveDate,
            expiration_date: coverage.expirationDate,
            position: index,
          })),
        },
      };
    },
  });

  await page.route(`${SUPABASE_ORIGIN}/storage/v1/object/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/extract-insurance-certificate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subcontractorName: 'Bright Electric, L.L.C.',
        insured: 'Bright Electric LLC',
        holder: 'Destiny Homes',
        insurer: 'Bulk Test Mutual',
        policyNumber: 'BULK-GL-100',
        effectiveDate: '2026-03-01',
        expirationDate: '2027-03-01',
        additionalInsured: true,
        confidence: 'High',
        extractionNotes: 'Bulk browser fixture.',
        coverages: [{
          type: 'Commercial General Liability',
          generalLimit: 1000000,
          aggregateLimit: 2000000,
          effectiveDate: '2026-03-01',
          expirationDate: '2027-03-01',
        }],
      }),
    });
  });

  await page.goto('/?tab=certificates');
  await expect(page.getByRole('heading', { name: 'Bright Electric LLC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No Certificate Roofing' })).toBeVisible();

  const brightElectricCard = page.locator('article.certificate-roster-card').filter({
    has: page.getByRole('heading', { name: 'Bright Electric LLC' }),
  });
  const excludedCard = page.locator('article.certificate-roster-card').filter({
    has: page.getByRole('heading', { name: 'No Certificate Roofing' }),
  });
  await excludedCard.getByRole('button', { name: 'No cert needed' }).click();
  await expect(excludedCard.locator('.certificate-status-badge')).toHaveText('No cert needed');
  expect(subcontractorOperations.at(-1)).toMatchObject({
    table: 'subs',
    id: excludedSubcontractorId,
    data: { certificateRequirement: 'not_required', inactive: false },
  });

  await excludedCard.getByRole('button', { name: 'Mark inactive' }).click();
  await expect(excludedCard.locator('.certificate-status-badge')).toHaveText('Inactive');
  expect(subcontractorOperations.at(-1)).toMatchObject({
    table: 'subs',
    id: excludedSubcontractorId,
    data: { certificateRequirement: 'not_required', inactive: true },
  });

  await brightElectricCard.getByRole('button', { name: 'Add certificate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add insurance certificate' });
  await dialog.getByLabel('Subcontractor *').selectOption(subcontractorId);
  await dialog.getByLabel('Insurance company').fill('Test Mutual');
  await dialog.getByLabel('Policy number').fill('GL-TEST-100');
  await dialog.getByLabel('Certificate effective date').fill('2026-01-01');
  await dialog.getByLabel('Certificate expiration date').fill('2027-01-01');
  await dialog.getByLabel('General limit').fill('1000000');
  await dialog.getByLabel('Aggregate limit').fill('2000000');
  await dialog.getByLabel('Coverage effective date').fill('2026-01-01');
  await dialog.getByLabel('Coverage expiration date').fill('2027-01-01');
  await dialog.getByRole('button', { name: 'Add coverage' }).click();
  const workersCompCoverage = dialog.locator('.certificate-coverage-row').nth(1);
  await workersCompCoverage.getByLabel('Coverage type').fill("Workers' Compensation & Employers' Liability");
  await workersCompCoverage.getByLabel('General limit').fill('500000');
  await workersCompCoverage.getByLabel('Aggregate limit').fill('1000000');
  await workersCompCoverage.getByLabel('Coverage effective date').fill('2026-02-01');
  await workersCompCoverage.getByLabel('Coverage expiration date').fill('2027-02-01');
  await dialog.getByRole('button', { name: 'Save certificate' }).click();

  await expect(page.getByRole('heading', { name: 'Bright Electric LLC' })).toBeVisible();
  await expect(page.getByText('Test Mutual')).toBeVisible();
  await expect(page.getByText('GL-TEST-100')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Insurance coverage details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show coverage details (2)' }).click();
  const coverageTable = page.getByRole('table', { name: 'Insurance coverage details' });
  await expect(coverageTable).toBeVisible();
  await expect(coverageTable.getByRole('row', { name: /General Liability/ })).toContainText('$1,000,000');
  await expect(coverageTable.getByRole('row', { name: /General Liability/ })).toContainText('$2,000,000');
  await expect(coverageTable.getByRole('row', { name: /General Liability/ })).toContainText('01/01/2026');
  await expect(page.getByText('Liability dates').locator('..')).toContainText('01/01/2026 – 01/01/2027');
  await expect(page.getByText('Workers comp dates').locator('..')).toContainText('02/01/2026 – 02/01/2027');
  await expect(page.locator('.certificate-record.additional-insured-missing')).toBeVisible();
  await page.getByRole('button', { name: 'Hide coverage details' }).click();
  await expect(coverageTable).toHaveCount(0);
  expect(certificateSave.p_certificate).toMatchObject({
    subcontractorId,
    insured: 'Bright Electric LLC',
    policyNumber: 'GL-TEST-100',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
  });
  expect(certificateSave.p_certificate).not.toHaveProperty('projectId');
  expect(certificateSave.p_coverages).toEqual([
    expect.objectContaining({
      type: 'General Liability',
      generalLimit: 1000000,
      aggregateLimit: 2000000,
      effectiveDate: '2026-01-01',
      expirationDate: '2027-01-01',
    }),
    expect.objectContaining({
      type: 'Workers Compensation',
      generalLimit: 500000,
      aggregateLimit: 1000000,
      effectiveDate: '2026-02-01',
      expirationDate: '2027-02-01',
    }),
  ]);

  await page.locator('.certificate-bulk-upload-button input').setInputFiles([
    {
      name: 'bright-electric-one.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 bulk certificate one'),
    },
    {
      name: 'bright-electric-two.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 bulk certificate two'),
    },
  ]);
  const bulkDialog = page.getByRole('dialog', { name: 'Bulk upload and extract' });
  await expect(bulkDialog).toBeVisible();
  await expect(bulkDialog.getByText('2 of 2 certificates are ready to save.')).toBeVisible({ timeout: 30_000 });
  await expect(bulkDialog.getByLabel('Matched subcontractor *')).toHaveCount(2);
  await expect(bulkDialog.getByLabel('Matched subcontractor *').first()).toHaveValue(subcontractorId);
  await bulkDialog.getByRole('button', { name: 'Save 2 certificates' }).click();
  await expect(bulkDialog).toHaveCount(0);
  await expect.poll(() => certificateSaves.length).toBe(3);
});
