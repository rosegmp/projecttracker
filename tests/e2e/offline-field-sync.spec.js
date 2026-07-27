import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';

test.describe.configure({ timeout: 90_000 });

test('daily log stays visible offline and synchronizes after reconnect', async ({ context, page }) => {
  const authUserId = '40000000-0000-4000-8000-000000000041';
  const appUserId = 'offline-editor';
  const projectId = 'offline-project';
  const email = 'offline-editor@example.test';
  const settings = {
    users: [{ id: appUserId, name: 'Offline Editor', email, role: 'Edit' }],
    currentUserId: appUserId,
  };
  const project = {
    id: projectId,
    data: {
      id: projectId,
      name: 'Offline Field Project',
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
  const appUser = {
    id: appUserId,
    position: 0,
    data: { name: 'Offline Editor', email, role: 'Edit' },
    version: 1,
  };
  const access = { project_id: projectId, user_id: appUserId, position: 0, version: 1 };
  let savedDailyLog = null;

  await page.addInitScript((session) => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify(session));
  }, {
    accessToken: 'offline-e2e-access-token',
    refreshToken: 'offline-e2e-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: authUserId, email },
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { id: appUserId, name: 'Offline Editor', email, role: 'Edit' },
          mode: 'staff',
          startupProjectId: '',
          settings: { data: settings, version: 1 },
          appUsers: [appUser],
          projectAccess: [access],
          projects: [project],
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
    if (url.pathname.endsWith('/project_daily_logs')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        savedDailyLog = {
          ...body,
          version: 1,
          created_at: '2026-07-27T12:00:00.000Z',
          updated_at: '2026-07-27T12:00:00.000Z',
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify([savedDailyLog]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedDailyLog ? [savedDailyLog] : []),
      });
      return;
    }
    if (url.pathname.includes('/rpc/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    let body = [];
    if (url.pathname.endsWith('/settings')) body = [{ id: 'app_settings', data: settings, version: 1 }];
    else if (url.pathname.endsWith('/app_users')) body = [appUser];
    else if (url.pathname.endsWith('/project_user_access')) body = [access];
    else if (url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')) body = [project];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?tab=projects');
  await page.getByRole('button', { name: 'Offline Field Project', exact: true }).click();
  await page.getByRole('tab', { name: 'Daily logs' }).click();
  await expect(page.getByRole('button', { name: 'New daily log' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'New daily log' }).click();
  await page.getByLabel('Notes').fill('Framing continued while the field device was offline.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Framing continued while the field device was offline.')).toBeVisible();
  await expect(page.getByText('Saved on device').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.localStorage).some((key) => key.startsWith('project-tracker:offline-operations:v1:')))).toBe(true);

  await context.setOffline(false);
  await expect.poll(() => savedDailyLog?.data?.notes || '', { timeout: 20_000 })
    .toBe('Framing continued while the field device was offline.');
  await expect(page.getByText('Saved on device')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.localStorage).some((key) => key.startsWith('project-tracker:offline-operations:v1:')))).toBe(false);
});
