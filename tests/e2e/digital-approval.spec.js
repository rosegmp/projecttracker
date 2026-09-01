import { expect, test } from '@playwright/test';

const SUPABASE_ORIGIN = 'https://project-tracker.test';
const TOKEN = 'secureapprovaltoken_secureapprovaltoken_1234567890';

test('an email recipient can approve issued terms without signing in and download the final PDF', async ({ page }) => {
  const requests = [];
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/manage-digital-approval`, async (route) => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (payload.action === 'load') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ approval: {
          id: 'approval-1',
          title: 'CO-104 · Kitchen revision',
          status: 'pending',
          expiresAt: '2026-09-08T16:00:00.000Z',
          snapshot: {
            kind: 'change_order',
            changeOrderSnapshot: {
              number: 'CO-104', title: 'Kitchen revision', description: 'Relocate pantry wall.',
              reason: 'Customer request', costImpact: '2500', scheduleDays: '3', notes: 'Issued version 4',
            },
          },
          documentStatus: 'pending',
        } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ approval: {
        id: 'approval-1', title: 'CO-104 · Kitchen revision', status: 'approved',
        respondedAt: '2026-08-25T20:15:00.000Z', signerName: 'Test Customer',
        signerEmail: 'customer@test.local', comment: 'Approved as issued.',
        documentStatus: 'ready', signedPdfFileName: 'CO-104-approved-signed.pdf',
        signedUrl: 'https://project-tracker.test/storage/v1/object/sign/signed.pdf',
        snapshot: { kind: 'change_order' }, expiresAt: '2026-09-08T16:00:00.000Z',
      } }),
    });
  });

  await page.goto(`/#approval=${TOKEN}`);

  await expect(page.getByRole('heading', { name: 'CO-104 · Kitchen revision' })).toBeVisible();
  await expect(page.getByText('Relocate pantry wall.')).toBeVisible();
  await expect(page.getByText('Sign in', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');

  await page.getByLabel('Full name').fill('Test Customer');
  await page.getByLabel('Email that received this request').fill('customer@test.local');
  await page.getByLabel('Comments (optional)').fill('Approved as issued.');
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download signed PDF' })).toHaveAttribute('download', 'CO-104-approved-signed.pdf');
  expect(requests).toEqual([
    { action: 'load', token: TOKEN },
    {
      action: 'respond', token: TOKEN, decision: 'approved', signerName: 'Test Customer',
      signerEmail: 'customer@test.local', comment: 'Approved as issued.',
    },
  ]);
});

