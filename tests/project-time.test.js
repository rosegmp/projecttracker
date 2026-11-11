import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectTimeService, formatTrackedDuration, timeEntryMinutes } from '../src/services/projectTime.js';
import { DEFAULT_VISIBLE_PROJECT_TABS, getVisibleProjectTabs, normalizeVisibleProjectTabs } from '../src/utils/projectTabs.js';

test('time duration uses exact timestamps and displays rounded minutes', () => {
  const entry = { started_at: '2026-11-11T13:00:00Z', ended_at: '2026-11-11T14:31:30Z' };
  assert.equal(timeEntryMinutes(entry), 91.5);
  assert.equal(formatTrackedDuration(timeEntryMinutes(entry)), '1h 32m');
  assert.equal(timeEntryMinutes({ ...entry, ended_at: null }, Date.parse('2026-11-11T13:15:00Z')), 15);
});

test('time tab appears for previous defaults but stays hidden for customized sections and portal users', () => {
  const oldDefaults = DEFAULT_VISIBLE_PROJECT_TABS.filter((id) => id !== 'time');
  assert.ok(normalizeVisibleProjectTabs(oldDefaults).includes('time'));
  assert.ok(!normalizeVisibleProjectTabs(['overview', 'tasks']).includes('time'));
  assert.ok(!getVisibleProjectTabs(DEFAULT_VISIBLE_PROJECT_TABS, 'Customer').some((tab) => tab.id === 'time'));
});

test('local time entries persist across service instances and edits', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const service = createProjectTimeService('time-test-project');
  const started_at = '2026-11-11T13:00:00Z';
  const entry = await service.create({ user_id: 'test-user', task_id: '', description: 'Framing', started_at, ended_at: null });
  assert.equal((await createProjectTimeService('time-test-project').list()).length, 1);
  const saved = await service.update(entry.id, { ...entry, ended_at: '2026-11-11T14:00:00Z' });
  assert.equal(timeEntryMinutes(saved), 60);
  const moved = await service.update(entry.id, { ...saved, project_id: 'time-test-destination', task_id: null });
  assert.equal(moved.project_id, 'time-test-destination');
  assert.equal(moved.task_id, null);
  assert.deepEqual(await service.list(), []);
  const destination = createProjectTimeService('time-test-destination');
  assert.deepEqual((await destination.list()).map((item) => item.id), [entry.id]);
  await destination.remove(entry.id);
  assert.deepEqual(await destination.list(), []);
  delete globalThis.localStorage;
});
