import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';
const CUSTOMER_EMAIL = 'customer@example.test';
const CUSTOMER_ID = 'customer-user';
const PROJECT_ID = 'project-portal-1';

function storedSession({
  email = CUSTOMER_EMAIL,
  userId = '10000000-0000-4000-8000-000000000001',
} = {}) {
  return {
    accessToken: 'e2e-access-token',
    refreshToken: 'e2e-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      id: userId,
      email,
    },
  };
}

function portalBootstrap() {
  return {
    profile: {
      id: CUSTOMER_ID,
      name: 'Portal Customer',
      email: CUSTOMER_EMAIL,
      role: 'Customer',
    },
    mode: 'portal',
    portal: {
      currentUser: {
        id: CUSTOMER_ID,
        name: 'Portal Customer',
        email: CUSTOMER_EMAIL,
        role: 'Customer',
      },
      projects: [
        {
          id: PROJECT_ID,
          name: 'Portal Test Home',
          address: '1 Test Lane',
          status: 'active',
          customerName: 'Portal Customer',
          accessUserIds: [CUSTOMER_ID],
          phases: [],
          inspections: [],
          selections: [],
          files: { folders: [] },
          photos: [],
          version: 1,
        },
      ],
      calendarSettings: {},
    },
  };
}

test('shows a useful server error after a rejected sign-in', async ({ page }) => {
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error_description: 'Invalid login credentials' }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Email').fill('wrong@example.test');
  await page.getByLabel('Password').fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByText('Sign-in failed.')).toBeVisible();
  await expect(page.getByText('Invalid login credentials')).toBeVisible();
});

test('successful internal sign-in starts at Home instead of a remembered or deep-linked tab', async ({ page }) => {
  const adminEmail = 'login-admin@example.test';
  const adminUserId = 'login-admin';

  await page.addInitScript(() => {
    window.localStorage.setItem('cx_last_active_tab', 'settings');
  });

  await page.route(`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'login-access-token',
        refresh_token: 'login-refresh-token',
        expires_in: 3600,
        user: {
          id: '30000000-0000-4000-8000-000000000001',
          email: adminEmail,
        },
      }),
    });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const settings = {
      users: [{ id: adminUserId, name: 'Login Administrator', email: adminEmail, role: 'Admin' }],
      currentUserId: adminUserId,
    };
    const appUser = {
      id: adminUserId,
      position: 0,
      data: { name: 'Login Administrator', email: adminEmail, role: 'Admin' },
      version: 1,
    };

    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { id: adminUserId, name: 'Login Administrator', email: adminEmail, role: 'Admin' },
          mode: 'staff',
          startupProjectId: '',
          settings: { data: settings, version: 1 },
          appUsers: [appUser],
          projectAccess: [],
          projects: [],
          tasks: [],
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

    const responseBody =
      url.pathname.endsWith('/settings')
        ? [{ id: 'app_settings', data: settings, version: 1 }]
        : url.pathname.endsWith('/app_users')
          ? [appUser]
          : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseBody) });
  });

  await page.goto('/?tab=settings&project=stale-project');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\?tab=home$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Home:/ })).toHaveAttribute('aria-current', 'page');
});

test('customer stays inside the allowlisted portal and can answer a published request', async ({ page }) => {
  let submittedResponse = null;
  let portalBootstrapCount = 0;
  let workspaceManifestCount = 0;
  let workspaceManifestToken = 'portal-workspace-manifest-1';

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession());

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/rpc/get_workspace_cache_manifest')) {
      workspaceManifestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 1, mode: 'portal', token: workspaceManifestToken }),
      });
      return;
    }

    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      portalBootstrapCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(portalBootstrap()) });
      return;
    }

    if (url.pathname.endsWith('/rpc/get_current_app_user_profile')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(portalBootstrap().profile),
      });
      return;
    }

    if (url.pathname.endsWith('/rpc/get_project_portal_bootstrap')) {
      portalBootstrapCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(portalBootstrap().portal),
      });
      return;
    }

    if (url.pathname.endsWith('/project_portal_items')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'portal-request-1',
            project_id: PROJECT_ID,
            item_number: 'PORTAL-001',
            item_type: 'request',
            audience: 'customer',
            status: 'published',
            title: 'Confirm delivery window',
            data: {
              id: 'portal-request-1',
              projectId: PROJECT_ID,
              number: 'PORTAL-001',
              itemType: 'request',
              audience: 'customer',
              status: 'published',
              title: 'Confirm delivery window',
              message: 'Can the appliance delivery arrive Friday morning?',
            },
            version: 1,
          },
        ]),
      });
      return;
    }

    if (url.pathname.endsWith('/rpc/respond_to_project_portal_item')) {
      submittedResponse = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'portal-request-1',
            project_id: PROJECT_ID,
            item_number: 'PORTAL-001',
            item_type: 'request',
            audience: 'customer',
            status: 'answered',
            title: 'Confirm delivery window',
            data: {
              id: 'portal-request-1',
              projectId: PROJECT_ID,
              number: 'PORTAL-001',
              itemType: 'request',
              audience: 'customer',
              status: 'answered',
              title: 'Confirm delivery window',
              message: 'Can the appliance delivery arrive Friday morning?',
              response: 'Friday morning works for us.',
            },
            version: 2,
          },
        ]),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/?tab=settings');

  await expect(page.getByLabel('Portal account')).toContainText('Portal Customer');
  await expect(page.getByRole('navigation', { name: 'Destiny Project Hub navigation' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveCount(0);
  await expect(page).toHaveURL(/\?tab=projects/);

  await expect.poll(() => workspaceManifestCount).toBeGreaterThan(0);
  const bootstrapBeforeQuickReload = portalBootstrapCount;
  const manifestsBeforeQuickReload = workspaceManifestCount;
  await page.reload();
  await expect.poll(() => workspaceManifestCount).toBeGreaterThan(manifestsBeforeQuickReload);
  expect(portalBootstrapCount).toBe(bootstrapBeforeQuickReload);
  await expect(page.getByLabel('Portal account')).toContainText('Portal Customer');

  workspaceManifestToken = 'portal-workspace-manifest-2';
  await page.reload();
  await expect.poll(() => portalBootstrapCount).toBeGreaterThan(bootstrapBeforeQuickReload);
  await expect(page.getByLabel('Portal account')).toContainText('Portal Customer');

  await page.getByRole('tab', { name: 'Portal' }).click();
  await expect(page.getByText('Confirm delivery window')).toBeVisible();
  await page.getByRole('button', { name: 'Respond' }).click();
  await page.getByLabel('Your response').fill('Friday morning works for us.');
  await page.getByRole('button', { name: 'Submit response' }).click();

  await expect(page.getByText('Friday morning works for us.')).toBeVisible();
  expect(submittedResponse).toEqual({
    p_item_id: 'portal-request-1',
    p_version: 1,
    p_response: 'Friday morning works for us.',
    p_decision: '',
    p_signer_name: '',
  });
});

test('administrator project-tab settings hide project sections and preserve required entries', async ({ page }) => {
  test.setTimeout(60_000);
  const adminEmail = 'admin@example.test';
  const adminUserId = 'admin-user';
  const adminProjectId = 'project-admin-1';
  const adminSettings = {
    visibleProjectTabs: ['tasks', 'calendar', 'files', 'inspections', 'daily-logs', 'selections'],
    users: [{ id: adminUserId, name: 'Test Administrator', email: adminEmail, role: 'Admin' }],
    currentUserId: adminUserId,
  };
  const adminUserRow = {
    id: adminUserId,
    position: 0,
    data: { name: 'Test Administrator', email: adminEmail, role: 'Admin' },
    version: 1,
  };
  const adminProjectRow = {
    id: adminProjectId,
    data: {
      id: adminProjectId,
      name: 'Admin Tab Test',
      status: 'active',
      accessUserIds: [adminUserId],
      phases: [],
      inspections: [],
      selections: [],
      files: { folders: [] },
      photos: [],
    },
    version: 1,
  };
  const adminAccessRow = { project_id: adminProjectId, user_id: adminUserId, position: 0, version: 1 };
  const adminFolderRow = {
    project_id: adminProjectId,
    id: 'admin-folder-1',
    position: 0,
    data: { name: 'Offline plans' },
    version: 1,
  };
  const calendarDate = new Date().toISOString().slice(0, 10);
  const adminPhaseRow = {
    project_id: adminProjectId,
    id: 'admin-phase-1',
    position: 0,
    data: { name: 'Rough work', status: 'active', start: calendarDate, end: calendarDate },
    version: 1,
  };
  const adminStepRow = {
    project_id: adminProjectId,
    phase_id: adminPhaseRow.id,
    id: 'admin-step-1',
    position: 0,
    data: { name: 'Close walls', status: 'scheduled', start: calendarDate, end: calendarDate, duration: 1 },
    version: 1,
  };
  const adminInspectionRow = {
    project_id: adminProjectId,
    id: 'admin-inspection-1',
    position: 0,
    data: { subcode: 'FRAME-220', inspectionType: 'Framing inspection', status: 'scheduled', date: calendarDate },
    version: 1,
  };
  const adminFileRow = {
    project_id: adminProjectId,
    folder_id: adminFolderRow.id,
    id: 'admin-file-1',
    position: 0,
    data: {
      originalName: 'Offline plan.txt',
      name: 'Offline plan.txt',
      type: 'text/plain',
      storageBucket: 'project-files',
      storagePath: `projects/${adminProjectId}/offline-plan.txt`,
    },
    version: 1,
  };
  const adminSelectionRow = {
    project_id: adminProjectId,
    id: 'admin-selection-1',
    position: 0,
    data: { itemName: 'Kitchen tile', category: 'Flooring', status: 'needs decision' },
    version: 1,
  };
  const adminSelectionAttachmentRow = {
    project_id: adminProjectId,
    selection_id: adminSelectionRow.id,
    id: 'admin-selection-attachment-1',
    position: 0,
    data: {
      originalName: 'Tile quote.txt',
      name: 'Tile quote.txt',
      type: 'text/plain',
      storageBucket: 'project-files',
      storagePath: `projects/${adminProjectId}/selections/tile-quote.txt`,
    },
    version: 1,
  };
  const adminDailyLogRow = {
    id: 'admin-daily-log-1',
    project_id: adminProjectId,
    log_date: '2026-08-07',
    title: 'Offline site log',
    data: {
      id: 'admin-daily-log-1',
      projectId: adminProjectId,
      date: '2026-08-07',
      title: 'Offline site log',
      weather: 'Clear',
      notes: 'Cached workflow record',
      subcontractorWork: [],
    },
    version: 1,
  };
  let simulateOffline = false;
  let storageDownloadCount = 0;
  let startupBootstrapCount = 0;
  let workspaceManifestCount = 0;
  let projectFilesReadCount = 0;
  let workspaceManifestToken = 'admin-workspace-manifest-1';

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession({
    email: adminEmail,
    userId: '20000000-0000-4000-8000-000000000001',
  }));

  await page.route(`${SUPABASE_ORIGIN}/storage/v1/object/authenticated/**`, async (route) => {
    storageDownloadCount += 1;
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'available offline' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    if (simulateOffline) {
      await route.abort('internetdisconnected');
      return;
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rpc/get_workspace_cache_manifest')) {
      workspaceManifestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 1, mode: 'staff', token: workspaceManifestToken }),
      });
      return;
    }
    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      startupBootstrapCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            id: adminUserId,
            name: 'Test Administrator',
            email: adminEmail,
            role: 'Admin',
          },
          mode: 'staff',
          startupProjectId: adminProjectId,
          settings: {
            data: adminSettings,
            version: 1,
          },
          appUsers: [adminUserRow],
          projectAccess: [adminAccessRow],
          projects: [adminProjectRow],
          tasks: [],
          phases: [adminPhaseRow],
          steps: [adminStepRow],
          folders: [adminFolderRow],
          files: [adminFileRow],
          photos: [],
          selections: [adminSelectionRow],
          inspections: [adminInspectionRow],
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/project_files')) projectFilesReadCount += 1;
    const responseBody =
      url.pathname.endsWith('/settings')
        ? [{ id: 'app_settings', data: adminSettings, version: 1 }]
        : url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')
          ? [adminProjectRow]
          : url.pathname.endsWith('/app_users')
            ? [adminUserRow]
            : url.pathname.endsWith('/project_user_access')
            ? [adminAccessRow]
            : url.pathname.endsWith('/project_phases')
              ? [adminPhaseRow]
              : url.pathname.endsWith('/project_steps')
                ? [adminStepRow]
            : url.pathname.endsWith('/project_file_folders')
                ? [adminFolderRow]
                : url.pathname.endsWith('/project_files')
                  ? [adminFileRow]
                  : url.pathname.endsWith('/project_selections')
                    ? [adminSelectionRow]
                    : url.pathname.endsWith('/project_inspections')
                      ? [adminInspectionRow]
                  : url.pathname.endsWith('/project_selection_attachments')
                    ? [adminSelectionAttachmentRow]
                    : url.pathname.endsWith('/project_daily_logs')
                      ? [adminDailyLogRow]
                      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseBody) });
  });

  await page.goto(`/?tab=projects&project=${adminProjectId}`);

  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Daily Logs' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Photos' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Project breadcrumb' })).toContainText('Admin Tab Test');

  await page.getByRole('button', { name: 'More', exact: true }).click();
  const moreSections = page.getByLabel('More project sections', { exact: true });
  await expect(moreSections.getByRole('button', { name: 'Portal', exact: true })).toBeVisible();
  await expect(moreSections.getByRole('button', { name: 'Inspections', exact: true })).toBeVisible();
  await expect(moreSections.getByRole('button', { name: 'Selections', exact: true })).toBeVisible();
  await expect(moreSections.getByRole('button', { name: 'Photos', exact: true })).toHaveCount(0);
  await moreSections.getByRole('button', { name: 'Make available offline', exact: true }).click();
  const offlineAccess = moreSections.getByLabel('Offline access', { exact: true });
  await expect(offlineAccess.getByText('Available on this device', { exact: true })).toBeVisible();
  await expect(offlineAccess.getByText('Overview', { exact: true })).toBeVisible();
  await expect(offlineAccess.getByText('Inspections', { exact: true })).toBeVisible();
  const offlineAssets = offlineAccess.getByLabel('Offline files and photos', { exact: true });
  await offlineAssets.getByRole('checkbox', { name: 'Files (2)', exact: true }).check();
  await offlineAssets.getByRole('button', { name: 'Download selected', exact: true }).click();
  await expect(offlineAssets.getByText('2 items downloaded for offline use.', { exact: true })).toBeVisible();
  await expect(offlineAccess.getByText('Files', { exact: true })).toBeVisible();
  expect(storageDownloadCount).toBe(2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.getByRole('tab', { name: 'Daily Logs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Offline site log' })).toBeVisible();
  await expect(page.getByText('Cached workflow record', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await expect(page.getByText('Offline plan.txt', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Offline plan.txt', exact: true }).click();
  await download;
  expect(storageDownloadCount).toBe(2);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await moreSections.getByRole('button', { name: 'Selections', exact: true }).click();
  await expect(page.getByText('Kitchen tile', { exact: true })).toBeVisible();
  const selectionDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tile quote.txt', exact: true }).click();
  await selectionDownload;
  expect(storageDownloadCount).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const offlineProjects = page.getByLabel('Offline projects', { exact: true });
  await expect(offlineProjects).toContainText('1 available');
  await expect(offlineProjects.getByRole('button', { name: /Admin Tab Test/ })).toBeVisible();
  await expect(page.locator('.project-offline-badge')).toContainText('Offline');
  await offlineProjects.getByRole('button', { name: 'Show offline only', exact: true }).click();
  await expect(offlineProjects.getByRole('button', { name: 'Show all projects', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await offlineProjects.getByRole('button', { name: 'Refresh copies', exact: true }).click();
  await offlineProjects.getByRole('button', { name: /Admin Tab Test/ }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await moreSections.getByRole('checkbox', { name: /Compact desktop navigation/ }).check();
  await expect(page.locator('.project-detail-navigation-shell')).toHaveClass(/is-compact-desktop/);
  await moreSections.getByRole('button', { name: 'Inspections', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Inspections' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/projectTab=inspections/);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await moreSections.getByRole('button', { name: 'Unpin Files', exact: true }).click();
  await moreSections.getByRole('button', { name: 'Pin Selections', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Selections' })).toBeVisible();
  await expect.poll(() => workspaceManifestCount).toBeGreaterThan(0);
  const readsBeforeQuickReload = {
    startup: startupBootstrapCount,
    files: projectFilesReadCount,
    manifests: workspaceManifestCount,
  };
  await page.reload();
  await expect.poll(() => workspaceManifestCount).toBeGreaterThan(readsBeforeQuickReload.manifests);
  expect(startupBootstrapCount).toBe(readsBeforeQuickReload.startup);
  expect(projectFilesReadCount).toBe(readsBeforeQuickReload.files);
  await expect(page.locator('.project-detail-navigation-shell')).toHaveClass(/is-compact-desktop/);
  await expect(page.getByRole('tab', { name: 'Selections' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveCount(0);

  const filesBeforeChangedReload = projectFilesReadCount;
  workspaceManifestToken = 'admin-workspace-manifest-2';
  await page.reload();
  await expect.poll(() => projectFilesReadCount).toBeGreaterThan(filesBeforeChangedReload);
  await expect(page.locator('.project-detail-navigation-shell')).toHaveClass(/is-compact-desktop/);

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: /FRAME-220.*Framing inspection/ }).click();
  await expect(page).toHaveURL(/projectTab=inspections/);
  await expect(page.getByRole('dialog', { name: 'Edit inspection' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Edit inspection' }).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Close walls' }).click();
  await page.getByRole('button', { name: 'Edit predecessors' }).click();
  const predecessorDialog = page.getByRole('dialog', { name: 'Schedule step Predecessors' });
  await expect(predecessorDialog.getByText('Inspection · Framing inspection')).toBeVisible();
  await predecessorDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'Edit schedule step' }).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /^Settings:/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Display preferences' }).click();
  const projectNavigation = page.getByRole('heading', { name: 'Project workspace navigation' }).locator('xpath=ancestor::section[1]');
  await expect(projectNavigation.getByRole('checkbox', { name: /Overview/ })).toBeDisabled();
  await expect(projectNavigation.getByRole('checkbox', { name: /Tasks/ })).toBeChecked();
  await expect(projectNavigation.getByRole('checkbox', { name: /Calendar/ })).toBeChecked();
  await expect(projectNavigation.getByRole('checkbox', { name: /Photos/ })).not.toBeChecked();

  await page.getByRole('tab', { name: 'Notifications' }).click();
  const assignmentEmails = page.getByRole('heading', { name: 'New task assignment emails' }).locator('xpath=ancestor::section[1]');
  const internalEmailToggle = assignmentEmails.getByRole('checkbox', { name: /Employees and administrators/ });
  const externalEmailToggle = assignmentEmails.getByRole('checkbox', { name: /Subcontractors and suppliers/ });
  await expect(internalEmailToggle).not.toBeChecked();
  await expect(externalEmailToggle).not.toBeChecked();
  await internalEmailToggle.check();
  await externalEmailToggle.check();
  await expect(internalEmailToggle).toBeChecked();
  await expect(externalEmailToggle).toBeChecked();

  const complianceEmailTests = page.getByRole('heading', { name: 'Compliance email test mode' }).locator('xpath=ancestor::section[1]');
  const complianceTestToggle = complianceEmailTests.getByRole('checkbox', { name: /Send compliance emails to me for testing/ });
  await expect(complianceTestToggle).not.toBeChecked();
  await complianceTestToggle.check();
  await expect(complianceTestToggle).toBeChecked();
  await expect(complianceEmailTests).toContainText(adminEmail);

  simulateOffline = true;
  await page.goto(`/?tab=projects&project=${adminProjectId}`);
  await expect(page.getByText('Working from the saved workspace.', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project breadcrumb' })).toContainText('Admin Tab Test');
});
