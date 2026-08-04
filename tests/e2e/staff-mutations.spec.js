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
  subs = [],
  certificateRows = [],
  coverageRows = [],
  runtimeStatus = { writesFrozen: false, message: '', changedAt: '' },
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
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

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
