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
    inspectionSubcodes: ['FOOT-101'],
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
  let savedInspectionPayload = null;
  const savedProjectPhotos = [];
  const uploadedStoragePaths = [];

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
      if (request.method() === 'DELETE') {
        savedDailyLog = null;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
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
      if (url.pathname.endsWith('/rpc/add_project_photos')) {
        const photos = request.postDataJSON()?.p_photos || [];
        photos.forEach((photo) => {
          if (!savedProjectPhotos.some((existing) => existing.id === photo.id)) savedProjectPhotos.push(photo);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(photos) });
        return;
      }
      if (url.pathname.endsWith('/rpc/save_project_inspection')) {
        savedInspectionPayload = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ inspectionVersion: 1, fileVersions: { sticker: 1, report: 1 } }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    let body = [];
    if (url.pathname.endsWith('/settings')) body = [{ id: 'app_settings', data: settings, version: 1 }];
    else if (url.pathname.endsWith('/app_users')) body = [appUser];
    else if (url.pathname.endsWith('/project_user_access')) body = [access];
    else if (url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')) body = [project];
    else if (url.pathname.endsWith('/project_photos')) body = savedProjectPhotos.map((photo, position) => ({
      project_id: projectId, id: photo.id, position, data: photo, version: 1,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(`${SUPABASE_ORIGIN}/storage/v1/object/**`, async (route) => {
    if (route.request().method() === 'POST') {
      uploadedStoragePaths.push(new URL(route.request().url()).pathname);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/?tab=projects');
  await page.getByRole('button', { name: 'Offline Field Project', exact: true }).click();
  await page.getByRole('tab', { name: 'Daily logs' }).click();
  await expect(page.getByRole('button', { name: 'New daily log' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'New daily log' }).click();
  await page.getByLabel('Notes').fill('Framing continued while the field device was offline.');
  await page.getByRole('button', { name: 'Add subcontractor' }).click();
  await page.locator('.project-workflow-photo-picker input[type="file"]').setInputFiles({
    name: 'offline-framing.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('offline-photo-content'),
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Framing continued while the field device was offline.')).toBeVisible();
  await expect(page.getByText('offline-framing.jpg')).toBeVisible();
  await expect(page.getByText('Saved on device').first()).toBeVisible();
  expect(uploadedStoragePaths).toHaveLength(0);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.localStorage).some((key) => key.startsWith('project-tracker:offline-operations:v1:')))).toBe(true);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(1);

  await context.setOffline(false);
  await expect.poll(() => savedDailyLog?.data?.notes || '', { timeout: 20_000 })
    .toBe('Framing continued while the field device was offline.');
  await expect.poll(() => uploadedStoragePaths.length).toBe(1);
  expect(savedDailyLog?.data?.subcontractorWork?.[0]?.photos?.[0]?.storagePath)
    .toContain('daily-log-photos');
  await expect(page.getByText('Saved on device')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.localStorage).some((key) => key.startsWith('project-tracker:offline-operations:v1:')))).toBe(false);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(0);

  await context.setOffline(true);
  await page.locator('.project-workflow-card').getByRole('button', { name: /Edit daily log/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete record' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Delete saved on device').first()).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review device-saved changes' }).getByRole('heading', { name: /Delete/ })).toBeVisible();
  await page.getByRole('dialog', { name: 'Review device-saved changes' }).getByRole('button', { name: 'Close' }).click();
  await context.setOffline(false);
  await expect.poll(() => savedDailyLog).toBe(null);
  await expect(page.getByText('Delete saved on device')).toHaveCount(0);

  uploadedStoragePaths.length = 0;
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByLabel('More project sections', { exact: true })
    .getByRole('button', { name: 'Inspections', exact: true }).click();
  await page.getByRole('button', { name: 'Add inspection' }).click();
  await page.getByRole('dialog', { name: 'Add inspection' }).getByRole('button', { name: 'Cancel' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add inspection' }).click();
  const inspectionDialog = page.getByRole('dialog', { name: 'Add inspection' });
  await inspectionDialog.getByLabel('Subcode').selectOption('FOOT-101');
  await inspectionDialog.getByLabel('Inspection type').fill('Footing inspection');
  await inspectionDialog.getByLabel('Status').selectOption('failed');
  await inspectionDialog.getByLabel('Inspection sticker photo').setInputFiles({
    name: 'offline-sticker.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('offline-sticker-content'),
  });
  await inspectionDialog.getByLabel('Failed inspection report').setInputFiles({
    name: 'offline-report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('offline-report-content'),
  });
  await inspectionDialog.getByRole('button', { name: 'Save inspection' }).click();

  await expect(page.getByText('offline-sticker.jpg')).toBeVisible();
  await expect(page.getByText('offline-report.pdf')).toBeVisible();
  await expect(page.getByText('Saved on device').first()).toBeVisible();
  expect(uploadedStoragePaths).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(2);

  await context.setOffline(false);
  await expect.poll(() => savedInspectionPayload?.p_inspection?.inspectionType || '', { timeout: 20_000 })
    .toBe('Footing inspection');
  await expect.poll(() => uploadedStoragePaths.length).toBe(2);
  expect(savedInspectionPayload.p_inspection.stickerFile.storagePath).toContain('inspection-sticker');
  expect(savedInspectionPayload.p_inspection.reportFile.storagePath).toContain('inspection-report');
  await expect(page.getByText('Saved on device')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(0);

  uploadedStoragePaths.length = 0;
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByLabel('More project sections', { exact: true })
    .getByRole('button', { name: 'Photos', exact: true }).click();
  await context.setOffline(true);
  await page.locator('.project-photos-manager input[type="file"][multiple]').setInputFiles({
    name: 'offline-site-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('offline-project-photo-content'),
  });
  await expect(page.getByText('offline-site-photo.jpg')).toBeVisible();
  await expect(page.getByText('Saved on device').first()).toBeVisible();
  expect(uploadedStoragePaths).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(1);

  await context.setOffline(false);
  await expect.poll(() => savedProjectPhotos.length, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => uploadedStoragePaths.length).toBe(1);
  expect(savedProjectPhotos[0].storagePath).toContain('/photos/');
  await expect(page.getByText('Saved on device')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('project-tracker-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('attachments', 'readonly');
      const count = transaction.objectStore('attachments').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
  }))).toBe(0);
});
