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

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession());

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(portalBootstrap()) });
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
  });
});

test('administrator project-tab settings hide project sections and preserve required entries', async ({ page }) => {
  test.setTimeout(60_000);
  const adminEmail = 'admin@example.test';
  const adminUserId = 'admin-user';
  const adminProjectId = 'project-admin-1';
  const adminSettings = {
    visibleProjectTabs: ['tasks', 'files'],
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

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, storedSession({
    email: adminEmail,
    userId: '20000000-0000-4000-8000-000000000001',
  }));

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
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
        ? [{ id: 'app_settings', data: adminSettings, version: 1 }]
        : url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')
          ? [adminProjectRow]
          : url.pathname.endsWith('/app_users')
            ? [adminUserRow]
            : url.pathname.endsWith('/project_user_access')
              ? [adminAccessRow]
              : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseBody) });
  });

  await page.goto(`/?tab=projects&project=${adminProjectId}`);

  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Portal' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Photos' })).toHaveCount(0);

  await page.getByRole('button', { name: /^Settings:/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Display preferences' }).click();
  const projectNavigation = page.getByRole('heading', { name: 'Project workspace navigation' }).locator('xpath=ancestor::section[1]');
  await expect(projectNavigation.getByRole('checkbox', { name: /Overview/ })).toBeDisabled();
  await expect(projectNavigation.getByRole('checkbox', { name: /Tasks/ })).toBeChecked();
  await expect(projectNavigation.getByRole('checkbox', { name: /Calendar/ })).not.toBeChecked();

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
});
