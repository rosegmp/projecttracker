import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';
const CUSTOMER_EMAIL = 'customer@example.test';
const CUSTOMER_ID = 'customer-user';
const PROJECT_ID = 'project-portal-1';

function storedSession() {
  return {
    accessToken: 'e2e-access-token',
    refreshToken: 'e2e-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      id: '10000000-0000-4000-8000-000000000001',
      email: CUSTOMER_EMAIL,
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
