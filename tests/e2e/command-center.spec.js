import { expect, test } from '@playwright/test';

const origin = 'https://project-tracker.test';
const appUserId = 'hub-admin';
const settings = { users: [{ id: appUserId, name: 'Hub Admin', email: 'hub@example.test', role: 'Admin' }], currentUserId: appUserId };
const samplePhoto = (id, width, height) => ({ id, name: `${id}.svg`, type: 'image/svg+xml', size: 100, uploadedAt: '2026-10-21T12:00:00.000Z', dataUrl: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'%3E%3Crect width='100%25' height='100%25' fill='%23159ded'/%3E%3C/svg%3E` });
const active = { id: 'active-project', data: { id: 'active-project', name: 'Visible Project', address: '100 Main St', permitNumber: 'P-123', status: 'planning', photos: [samplePhoto('wide', 800, 200), samplePhoto('tall', 200, 800)], phases: [], inspections: [
  { id: 'inspection-upcoming', subcode: 'ELEC-101', inspectionType: 'Electrical rough inspection', date: '2026-10-27', status: 'scheduled', agency: 'Building Department', stickerFile: samplePhoto('inspection-sticker', 300, 300) },
  { id: 'inspection-passed', subcode: 'FOOT-101', inspectionType: 'Footing inspection', date: '2026-10-15', status: 'passed', agency: 'Building Department' },
], files: { folders: [] }, accessUserIds: [appUserId] }, version: 1 };
const archived = { id: 'archived-project', data: { id: 'archived-project', name: 'Archived Project', inactive: true, status: 'done', photos: [], phases: [], inspections: [
  { id: 'inspection-archived', subcode: 'ARCH-101', inspectionType: 'Archived inspection', date: '2026-10-28', status: 'scheduled' },
], files: { folders: [] }, accessUserIds: [appUserId] }, version: 1 };
const tasks = [
  { id: 'task-open', data: { id: 'task-open', label: 'Confirm electrical rough inspection', projectId: active.id, due: '2026-10-26', done: false, assignees: ['Hub Admin'], attachments: [], createdAt: '2026-10-18T12:00:00.000Z' }, version: 1 },
  { id: 'task-done', data: { id: 'task-done', label: 'Review footing report', projectId: active.id, due: '2026-10-18', done: true, assignees: [], attachments: [], createdAt: '2026-10-16T12:00:00.000Z' }, version: 1 },
  { id: 'task-archived', data: { id: 'task-archived', label: 'Archived punch list task', projectId: archived.id, due: '2026-10-29', done: false, assignees: [], attachments: [], createdAt: '2026-10-17T12:00:00.000Z' }, version: 1 },
];
const inspections = [active, archived].flatMap((project) => project.data.inspections.map((data, position) => ({
  project_id: project.id, id: data.id, position, data, version: 1,
})));
const photoRows = active.data.photos.map((data, position) => ({ project_id: active.id, id: data.id, position, data, version: 1 }));
const selectionRows = [
  { id: 'stone-selection', category: 'Exterior', itemName: 'Stone', chosenOption: 'Sanibel Plymbrick', status: 'ordered', vendor: 'Perfect Stucco Exteriors', notes: '', taskIds: ['task-open'] },
  { id: 'doors-selection', category: 'Interior', itemName: 'Interior Doors', chosenOption: '', status: 'selected', vendor: 'Door Emporium', notes: '', taskIds: [] },
  { id: 'moldings-selection', category: 'Interior', itemName: 'Moldings', chosenOption: '', status: 'selected', vendor: 'Door Emporium', notes: 'Base and casing details', taskIds: [] },
].map((data, position) => ({ project_id: active.id, id: data.id, position, data, version: 1 }));
const selectionPhotoRows = selectionRows.map((row) => ({
  project_id: active.id, selection_id: row.id, id: `${row.id}-photo`, kind: 'photo', position: 0,
  data: samplePhoto(`${row.id}-photo`, 240, 180), version: 1,
}));
const portalItemRows = [{
  id: 'portal-approval-1', project_id: active.id, item_number: 'POR-001', title: 'Approve stone selection',
  item_type: 'approval', audience: 'customer', status: 'response_requested', due_date: null, version: 1,
  data: { id: 'portal-approval-1', number: 'POR-001', title: 'Approve stone selection', message: 'Please review the stone selection.' },
}];
const inspectionFileRows = [
  { project_id: active.id, inspection_id: 'inspection-upcoming', kind: 'sticker', id: 'inspection-sticker', data: samplePhoto('inspection-sticker', 300, 300), version: 1 },
  { project_id: active.id, inspection_id: 'inspection-upcoming', kind: 'report', id: 'inspection-report', data: { name: 'inspection-report.pdf', originalName: 'inspection-report.pdf', type: 'application/pdf', size: 200 }, version: 1 },
];

test('Project Hub theme, active dashboard, project picker, and staff archive', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00'));
  let archivedRow = structuredClone(archived);
  let timelineProject = null;
  let timelinePhaseRows = [];
  let timelineStepRows = [];
  let geocodeRequests = 0;
  const mapStyleUrls = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tiles.openfreemap.org/styles/')) mapStyleUrls.push(request.url());
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify({
      accessToken: 'hub-test-token', refreshToken: 'hub-test-refresh', expiresAt: Date.now() + 3_600_000,
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'hub@example.test' },
    }));
  });
  await page.route('https://nominatim.openstreetmap.org/search?**', async (route) => {
    geocodeRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { lon: '-74.19', lat: '40.08', address: { house_number: '100' } },
    ]) });
  });
  await page.route(`${origin}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const appUserRow = { id: appUserId, position: 0, data: settings.users[0], version: 1 };
    let body = [];
    if (url.pathname.endsWith('/rpc/apply_tracker_batch')) {
      body = (route.request().postDataJSON()?.p_operations || []).map((operation) => {
        if (operation.table === 'projects' && operation.id === archived.id) {
          archivedRow = { id: archived.id, data: operation.data, version: archivedRow.version + 1 };
        }
        return { table: operation.table, id: operation.id, version: archivedRow.version, deleted: false };
      });
    } else if (url.pathname.endsWith('/rpc/get_app_startup_bootstrap')) {
      body = {
        profile: settings.users[0], mode: 'staff', startupProjectId: '',
        settings: { data: settings, version: 1 }, appUsers: [appUserRow],
        projectAccess: [active, ...(timelineProject ? [timelineProject] : []), archivedRow].map((project, position) => ({ project_id: project.id, user_id: appUserId, position, version: 1 })),
        projects: [active, ...(timelineProject ? [timelineProject] : []), archivedRow], tasks, phases: timelinePhaseRows, steps: timelineStepRows, folders: [], files: [], photos: photoRows, selections: selectionRows, inspections,
      };
    } else if (url.pathname.endsWith('/rpc/get_app_runtime_status')) {
      body = { writesFrozen: false, message: '', changedAt: '' };
    } else if (url.pathname.endsWith('/settings')) {
      body = [{ id: 'app_settings', data: settings, version: 1 }];
    } else if (url.pathname.endsWith('/app_users')) {
      body = [appUserRow];
    } else if (url.pathname.endsWith('/project_user_access')) {
      body = [active, ...(timelineProject ? [timelineProject] : []), archivedRow].map((project, position) => ({ project_id: project.id, user_id: appUserId, position, version: 1 }));
    } else if (url.pathname.endsWith('/project_core_records') || url.pathname.endsWith('/projects')) {
      body = [active, ...(timelineProject ? [timelineProject] : []), archivedRow];
    } else if (url.pathname.endsWith('/project_phases')) {
      body = timelinePhaseRows;
    } else if (url.pathname.endsWith('/project_steps')) {
      body = timelineStepRows;
    } else if (url.pathname.endsWith('/task_core_records') || url.pathname.endsWith('/tasks')) {
      body = tasks;
    } else if (url.pathname.endsWith('/task_assignments')) {
      body = [{ task_id: 'task-open', assignee: 'Hub Admin', position: 0, person_key: null }];
    } else if (url.pathname.endsWith('/project_inspections')) {
      body = inspections;
    } else if (url.pathname.endsWith('/project_inspection_files')) {
      body = inspectionFileRows;
    } else if (url.pathname.endsWith('/project_photos')) {
      body = photoRows;
    } else if (url.pathname.endsWith('/project_selections')) {
      body = selectionRows;
    } else if (url.pathname.endsWith('/project_selection_photos')) {
      body = selectionPhotoRows;
    } else if (url.pathname.endsWith('/project_portal_items')) {
      body = portalItemRows;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.browser-desktop-shell .home-page-header')).toBeVisible();
  await expect(page.locator('.home-page > .home-page-header')).toHaveCount(0);
  await expect(page.locator('.hub-stat').first()).toContainText('1');
  await expect(page.locator('.hub-stat').nth(1)).toContainText('1');
  await expect(page.locator('.hub-stat').nth(2)).toContainText('1');
  await expect(page.getByRole('navigation', { name: 'Project Hub navigation' }).getByRole('button', { name: 'Reports', exact: true })).toHaveCount(0);
  await expect(page.locator('.hub-location-map')).toBeVisible();
  await expect(page.locator('.hub-location-map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.hub-location-map .leaflet-overlay-pane path')).toHaveCount(1);
  expect(geocodeRequests).toBe(1);
  const locationView = page.getByRole('group', { name: 'Project locations view' });
  await locationView.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('.hub-location-map')).toHaveCount(0);
  await expect(page.locator('.hub-location-list')).toContainText('Visible Project');
  expect(await page.evaluate(() => window.localStorage.getItem('project-hub:location-view'))).toBe('list');
  await locationView.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.hub-location-map .leaflet-overlay-pane path')).toHaveCount(1);
  expect(geocodeRequests).toBe(1);
  await expect(page.locator('.hub-portfolio')).toContainText('Visible Project');
  await expect(page.locator('.hub-portfolio')).not.toContainText('Archived Project');
  await expect(page.locator('.hub-dashboard')).not.toContainText('Archived punch list task');
  await page.getByRole('button', { name: 'Search and quick actions' }).click();
  await expect(page.getByRole('dialog', { name: 'Go anywhere' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Search projects, files, tasks, people, and field records' }).fill('Visible Project');
  await expect(page.getByRole('dialog', { name: 'Go anywhere' })).toContainText('Visible Project');
  await page.getByRole('button', { name: 'Close global search' }).click();
  await expect(page.getByRole('combobox', { name: 'Task location' })).toBeDisabled();
  await page.getByRole('button', { name: 'Daily log', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add daily log' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Add daily log' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('navigation', { name: 'Project Hub navigation' }).getByRole('button', { name: 'Settings' }).click();
  await page.locator('#settings-tab-reporting').click();
  await expect(page.getByRole('heading', { name: 'Management reporting', exact: true })).toBeVisible();
  await expect(page.locator('.management-report-header')).toBeVisible();
  await page.getByRole('navigation', { name: 'Project Hub navigation' }).getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('#project-tab-files')).toHaveText('Files');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByText('Projects Overview')).toHaveCount(0);
  await expect(page.locator('.projects-overview-section .metrics-grid, .projects-overview-stats')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  if (process.env.CAPTURE_HUB_SCREENSHOT) {
    await page.screenshot({ path: 'test-results/command-center-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Tasks', exact: true }).first().click();
    await expect(page.locator('.task-list')).toContainText('Confirm electrical rough inspection');
    await page.screenshot({ path: 'test-results/command-center-tasks-light.png' });
    await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
    await page.getByRole('button', { name: 'Visible Project', exact: true }).click();
    await page.locator('#project-tab-inspections').click();
    await expect(page.getByRole('region', { name: 'Inspections' })).toContainText('Electrical rough inspection');
    await page.screenshot({ path: 'test-results/command-center-project-inspections-light.png' });
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  }

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.hub-location-map .maplibregl-canvas')).toBeVisible();
  expect(mapStyleUrls.some((url) => url.includes('/styles/liberty'))).toBe(true);
  expect(mapStyleUrls.some((url) => url.includes('/styles/dark'))).toBe(false);
  await expect(page.locator('.hub-portfolio')).toContainText('Visible Project');
  await page.locator('.hub-portfolio-row').filter({ hasText: 'Visible Project' }).click();
  await page.getByRole('button', { name: 'Edit project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'Edit project' });
  const dialogColors = await projectDialog.evaluate((dialog) => {
    const controls = [...dialog.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, textarea')];
    return controls.map((control) => {
      const style = getComputedStyle(control);
      return { color: style.color, background: style.backgroundColor };
    });
  });
  expect(dialogColors.length).toBeGreaterThan(5);
  expect(dialogColors.every(({ color, background }) => color === 'rgb(242, 247, 255)' && background === 'rgb(16, 42, 61)')).toBe(true);
  await expect(projectDialog.locator('.project-access-option').first()).toHaveCSS('background-color', 'rgb(16, 42, 61)');
  await projectDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Delete project' });
  await expect(confirmDialog).toHaveCSS('background-color', 'rgb(10, 32, 49)');
  await expect(confirmDialog).toHaveCSS('color', 'rgb(242, 247, 255)');
  await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
  await projectDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#project-tab-portal').click();
  await expect(page.getByRole('region', { name: 'Portal' })).toContainText('Approve stone selection');
  await expect(page.getByRole('region', { name: 'Portal' })).toContainText('Approval request · Customers');
  await expect(page.getByText('Screen render failed.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  if (process.env.CAPTURE_PLANNING) {
    for (const tab of ['Schedule', 'Calendar']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await expect(page.locator(`.top-level-${tab.toLowerCase()}-page`)).toBeVisible();
      await page.screenshot({ path: `test-results/command-center-${tab.toLowerCase()}.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.browser-mobile-app-bar')).toBeVisible();
      await page.screenshot({ path: `test-results/command-center-${tab.toLowerCase()}-mobile.png` });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
    await page.getByRole('button', { name: 'Visible Project', exact: true }).click();
    await page.locator('#project-tab-inspections').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.browser-mobile-app-bar')).toBeVisible();
    await page.screenshot({ path: 'test-results/command-center-project-inspections-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  }
  if (process.env.CAPTURE_HUB_SCREENSHOT) {
    await page.screenshot({ path: 'test-results/command-center-home.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.browser-mobile-app-bar .home-page-header')).toBeVisible();
    await page.screenshot({ path: 'test-results/command-center-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation menu' }).last().click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
    await expect(page.locator('.hub-page-header h1')).toHaveText('Projects');
    await expect(page.getByText('Projects Overview')).toHaveCount(0);
    await expect(page.locator('.projects-overview-section .metrics-grid, .projects-overview-stats')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/command-center-projects.png', fullPage: true });
    await page.getByRole('button', { name: 'Visible Project', exact: true }).click();
    await expect(page.locator('#project-tab-overview')).toBeVisible();
    await expect(page.locator('.hub-current-project')).toContainText('Visible Project');
    await page.screenshot({ path: 'test-results/command-center-project-detail.png' });
    await page.getByRole('button', { name: 'Switch project' }).click();
    await expect(page.getByRole('dialog', { name: 'Select a project for Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    for (const [tabName, fileName] of [['Portal', 'portal'], ['Tasks', 'tasks'], ['Calendar', 'calendar'], ['Inspections', 'inspections'], ['Selections', 'selections'], ['Daily Logs', 'daily-logs'], ['Change Orders', 'change-orders'], ['RFIs & Submittals', 'rfis'], ['Budget & Commitments', 'budget'], ['Warranty & Closeout', 'warranty'], ['Takeoff', 'takeoff'], ['Files', 'files'], ['Photos', 'photos']]) {
      const sectionId = { 'RFIs & Submittals': 'rfis-submittals', 'Budget & Commitments': 'budget-commitments', 'Warranty & Closeout': 'warranty-closeout', 'Daily Logs': 'daily-logs', 'Change Orders': 'change-orders' }[tabName] || tabName.toLowerCase();
      await page.locator(`#project-tab-${sectionId}`).click();
      await page.waitForTimeout(450);
      if (fileName === 'inspections') await expect(page.getByRole('region', { name: 'Inspections' })).toContainText('Electrical rough inspection');
      await page.screenshot({ path: `test-results/command-center-project-${fileName}.png` });
      if (fileName === 'takeoff') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: 'test-results/command-center-project-takeoff-mobile.png' });
        await page.setViewportSize({ width: 1280, height: 720 });
      }
    }
    for (const tab of ['Tasks', 'Schedule', 'Calendar', 'People', 'Compliance', 'Settings']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await expect(page.getByText('Preparing this page...')).toHaveCount(0);
      await page.waitForTimeout(500);
      if (tab === 'Tasks') await expect(page.locator('.task-list')).toContainText('Confirm electrical rough inspection');
      await page.screenshot({ path: `test-results/command-center-${tab.toLowerCase()}.png` });
      if (['Tasks', 'Schedule', 'Calendar'].includes(tab)) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `test-results/command-center-${tab.toLowerCase()}-mobile.png` });
        await page.setViewportSize({ width: 1280, height: 720 });
      }
    }
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  }

  await page.getByRole('button', { name: 'RFIs', exact: true }).click();
  if (!process.env.CAPTURE_HUB_SCREENSHOT && !process.env.CAPTURE_PLANNING && await page.getByRole('dialog', { name: 'Select a project for RFIs' }).count()) {
    await expect(page.getByRole('dialog', { name: 'Select a project for RFIs' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Select a project for RFIs' })).not.toContainText('Archived Project');
    await page.getByRole('dialog', { name: 'Select a project for RFIs' }).getByRole('button', { name: 'Visible Project' }).click();
  }
  await expect(page.locator('#project-tab-rfis-submittals')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.hub-page-header h1')).toHaveText('RFIs');
  await expect(page.locator('.hub-current-project')).toContainText('Visible Project');
  await expect(page.locator('#project-tab-permits')).toHaveCount(0);
  await page.locator('#project-tab-overview').click();
  await expect(page.locator('.hub-page-header h1')).toHaveText('Overview');
  await expect(page.getByRole('region', { name: 'Overview' })).toContainText('P-123');
  await expect(page.locator('#project-tab-reports')).toHaveCount(0);

  await page.locator('#project-tab-takeoff').click();
  await expect(page.locator('#project-panel-takeoff .takeoff-feature')).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 900 });
  const takeoffBounds = await page.locator('#project-panel-takeoff .takeoff-feature').boundingBox();
  const takeoffShellBounds = await page.locator('#project-panel-takeoff .takeoff-feature .app-shell').boundingBox();
  expect(takeoffBounds.width).toBeGreaterThan(1700);
  expect(takeoffShellBounds.width).toBeCloseTo(takeoffBounds.width, 0);
  expect(takeoffShellBounds.x).toBeCloseTo(takeoffBounds.x, 0);
  expect(takeoffBounds.height).toBeGreaterThan(800);
  expect(takeoffBounds.y + takeoffBounds.height).toBeGreaterThanOrEqual(899);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator('#project-tab-files').click();
  await expect(page.locator('#project-tab-files')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Files' })).toBeVisible();

  await page.locator('#project-tab-photos').click();
  await expect(page.locator('.photo-thumb')).toHaveCount(6);
  await expect(page.getByRole('region', { name: 'Inspections photos' })).toContainText('inspection-sticker.svg');
  await expect(page.getByRole('region', { name: 'Unfiled photos' })).toContainText('wide.svg');
  await expect(page.getByRole('button', { name: /Inspections 1/ })).toBeVisible();
  await page.getByRole('button', { name: /Inspections 1/ }).click();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.photo-card')).toContainText('inspection-sticker.svg');
  await page.getByRole('combobox', { name: 'Folder for inspection-sticker.svg' }).selectOption({ label: 'Unfiled' });
  await page.getByRole('button', { name: /Unfiled 3/ }).click();
  await expect(page.locator('.photo-card')).toHaveCount(3);
  await page.getByRole('button', { name: /All photos/ }).click();
  const thumbSizes = await page.locator('.photo-thumb-button').evaluateAll((buttons) => buttons.map((button) => {
    const { width, height } = button.getBoundingClientRect();
    return { width, height };
  }));
  expect(thumbSizes[0].width).toBeCloseTo(thumbSizes[1].width, 0);
  expect(thumbSizes[0].height).toBeCloseTo(thumbSizes[1].height, 0);
  await page.getByRole('textbox', { name: 'New photo folder name' }).fill('Site progress');
  await page.getByRole('button', { name: 'Add folder' }).click();
  await expect(page.getByRole('button', { name: /Site progress/ })).toBeVisible();
  await page.getByRole('button', { name: /All photos/ }).click();
  await page.getByRole('combobox', { name: 'Folder for wide.svg' }).selectOption({ label: 'Site progress' });
  await page.getByRole('button', { name: /Site progress/ }).click();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.photo-card')).toContainText('wide.svg');

  await page.locator('#project-tab-inspections').click();
  await expect(page.getByRole('region', { name: 'Inspections' })).toContainText('Electrical rough inspection');
  const inspectionCard = page.locator('.inspection-card').filter({ hasText: 'Electrical rough inspection' });
  await expect(inspectionCard.getByRole('heading', { name: 'Electrical rough inspection' })).toBeVisible();
  await expect(inspectionCard).toContainText('ELEC-101');
  await expect(inspectionCard.locator('img')).toHaveCount(0);
  await expect(inspectionCard).not.toContainText('inspection-report.pdf');
  await expect(inspectionCard.getByRole('button', { name: 'Open Electrical rough inspection sticker' })).toBeVisible();
  await expect(inspectionCard.getByRole('button', { name: 'Download Electrical rough inspection report' })).toBeVisible();
  await expect(inspectionCard.getByRole('button', { name: 'Electrical rough inspection', exact: true })).toBeVisible();
  await expect(inspectionCard.getByTitle('Edit inspection')).toHaveCount(1);
  await inspectionCard.getByRole('button', { name: 'Electrical rough inspection', exact: true }).click();
  const inspectionTypeField = page.getByRole('dialog', { name: 'Edit inspection' }).getByLabel('Inspection type');
  await expect(inspectionTypeField).toHaveValue('Electrical rough inspection');
  const fieldColors = await inspectionTypeField.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(fieldColors.color).toBe('rgb(242, 247, 255)');
  expect(fieldColors.background).toBe('rgb(16, 42, 61)');
  await page.getByRole('dialog', { name: 'Edit inspection' }).getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#project-tab-selections').click();
  await expect(page.locator('.selection-card')).toHaveCount(3);
  const selectionLayout = await page.locator('.selection-card').first().evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const detailsRect = card.querySelector('.inspection-meta').getBoundingClientRect();
    return { card: { left: cardRect.left, right: cardRect.right }, details: { left: detailsRect.left, right: detailsRect.right } };
  });
  expect(selectionLayout.details.left).toBeGreaterThanOrEqual(selectionLayout.card.left);
  expect(selectionLayout.details.right).toBeLessThanOrEqual(selectionLayout.card.right);
  await page.screenshot({ path: 'test-results/command-center-selections-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.selection-card')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/command-center-selections-mobile-dark.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Tasks', exact: true }).first().click();
  await expect(page.locator('.task-list')).toContainText('Confirm electrical rough inspection');
  await expect(page.locator('.task-list')).toContainText('Hub Admin');
  await expect(page.locator('.task-list')).not.toContainText('Archived punch list task');

  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.hub-page-header h1')).toHaveText('Archive');
  await expect(page.locator('.project-archive-list')).toContainText('Archived Project');
  await expect(page.locator('.project-archive-list')).not.toContainText('Visible Project');
  await page.locator('.project-archive-list').getByRole('button', { name: /Archived Project/ }).click();
  await page.locator('#project-tab-tasks').click();
  await expect(page.getByRole('region', { name: 'Tasks' })).toContainText('Archived punch list task');
  await expect(page.getByRole('region', { name: 'Tasks' }).getByRole('button', { name: /Edit|Delete|Add task/ })).toHaveCount(0);
  await page.locator('#project-tab-inspections').click();
  await expect(page.getByRole('region', { name: 'Inspections' })).toContainText('Archived inspection');
  await expect(page.getByRole('region', { name: 'Inspections' }).getByRole('button', { name: 'Archived inspection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to archive' }).click();
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText('No inactive projects')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-section-tabs')).toHaveCount(0);
  await page.locator('#settings-tab-display').click();
  await expect(page.locator('.hub-page-header h1')).toHaveText('Display preferences');
  await expect(page.getByRole('heading', { name: 'Display preferences' }).first()).toBeVisible();
  const showWeather = page.locator('.settings-toggle').filter({ hasText: 'Show weather' }).locator('input[type="checkbox"]');
  await expect(showWeather).toBeChecked();
  await showWeather.uncheck();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Hide weather' })).toHaveCount(0);
  await expect(page.locator('.home-weather-section')).toHaveCount(0);
  await expect(page.locator('.hub-stat').first()).toContainText('2');

  timelineProject = { id: 'timeline-project', data: { id: 'timeline-project', name: 'Second Project', status: 'active', photos: [], phases: [], inspections: [], files: { folders: [] }, accessUserIds: [appUserId] }, version: 1 };
  timelinePhaseRows = [active.id, timelineProject.id].map((projectId) => ({ project_id: projectId, id: `phase-${projectId}`, position: 0, data: { name: 'Construction' }, version: 1 }));
  timelineStepRows = [
    ...Array.from({ length: 16 }, (_, index) => ({ project_id: active.id, phase_id: `phase-${active.id}`, id: `step-${index}`, position: index, data: { name: `Step ${index + 1}`, status: index < 10 ? 'done' : index === 10 ? 'active' : 'planning', done: index < 10 }, version: 1 })),
    { project_id: timelineProject.id, phase_id: `phase-${timelineProject.id}`, id: 'second-step', position: 0, data: { name: 'Second project step', status: 'active', done: false }, version: 1 },
  ];
  await page.reload();
  await expect(page.locator('.hub-portfolio')).toContainText('In planning');
  await page.locator('.hub-portfolio-row').filter({ hasText: 'Visible Project' }).click();
  await page.locator('#project-tab-photos').click();
  await expect(page.locator('#project-tab-photos')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Switch project' }).click();
  await page.getByRole('dialog', { name: 'Select a project for Projects' }).getByRole('button', { name: 'Second Project' }).click();
  await expect(page.locator('.hub-current-project')).toContainText('Second Project');
  await expect(page.locator('#project-tab-photos')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/project=timeline-project&projectTab=photos/);
  await page.getByRole('button', { name: 'Switch project' }).click();
  await page.getByRole('dialog', { name: 'Select a project for Projects' }).getByRole('button', { name: 'Visible Project' }).click();
  await expect(page.locator('.hub-current-project')).toContainText('Visible Project');
  await expect(page.locator('#project-tab-photos')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(page.locator('.home-health-section')).toHaveCount(0);
  await expect(page.locator('.hub-milestones button')).toHaveCount(16);
  await expect.poll(() => page.locator('.hub-milestones').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const centered = await page.locator('.hub-milestones').evaluate((element) => {
    const activeStep = element.querySelector('button.current');
    return Math.abs((activeStep.getBoundingClientRect().left + activeStep.getBoundingClientRect().right) / 2 - (element.getBoundingClientRect().left + element.getBoundingClientRect().right) / 2);
  });
  expect(centered).toBeLessThan(90);
  if (process.env.CAPTURE_HUB_SCREENSHOT) await page.screenshot({ path: 'test-results/command-center-long-timeline.png', fullPage: true });
  const farRight = await page.locator('.hub-milestones').evaluate((element) => { element.scrollLeft = element.scrollWidth; return element.scrollLeft; });
  expect(farRight).toBeGreaterThan(0);
  await page.locator('.hub-timeline').getByLabel('Project', { exact: true }).selectOption(timelineProject.id);
  await expect(page.locator('.hub-milestones button')).toHaveCount(1);
  await expect(page.locator('.hub-timeline')).toContainText('Second project step');
});

test('read-only staff can change their own home weather preference', async ({ page }) => {
  const viewer = { id: 'hub-viewer', name: 'Hub Viewer', email: 'viewer@example.test', role: 'View Only' };
  await page.addInitScript(() => {
    window.localStorage.setItem('cx_auth_session', JSON.stringify({
      accessToken: 'viewer-test-token', refreshToken: 'viewer-test-refresh', expiresAt: Date.now() + 3_600_000,
      user: { id: '00000000-0000-4000-8000-000000000002', email: 'viewer@example.test' },
    }));
  });
  await page.route(`${origin}/rest/v1/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith('/rpc/get_app_startup_bootstrap')) {
      body = { profile: viewer, mode: 'staff', startupProjectId: '', settings: { data: { users: [viewer], currentUserId: viewer.id }, version: 1 }, appUsers: [{ id: viewer.id, position: 0, data: viewer, version: 1 }], projectAccess: [], projects: [], tasks: [], phases: [], steps: [], folders: [], files: [], photos: [], selections: [], inspections: [] };
    } else if (path.endsWith('/rpc/get_app_runtime_status')) {
      body = { writesFrozen: false, message: '', changedAt: '' };
    } else if (path.endsWith('/settings')) {
      body = [{ id: 'app_settings', data: { users: [viewer], currentUserId: viewer.id }, version: 1 }];
    } else if (path.endsWith('/app_users')) {
      body = [{ id: viewer.id, position: 0, data: viewer, version: 1 }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settings-tab-display')).toBeVisible();
  await expect(page.locator('#settings-tab-users')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show weather' }).uncheck();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(page.locator('.home-weather-section')).toHaveCount(0);
});
