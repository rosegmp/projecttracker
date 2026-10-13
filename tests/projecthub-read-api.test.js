import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MCP_TOOLS, assertReadOnlyMethod, auditFilterNames, filterItems, paginate, parseFilters,
  projectRecord, taskRecord, validateToolArguments,
} from '../supabase/functions/projecthub-read-api/core.js';

test('HTTP contract permits reads and rejects every write method', () => {
  assert.doesNotThrow(() => assertReadOnlyMethod('GET'));
  assert.doesNotThrow(() => assertReadOnlyMethod('HEAD'));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(() => assertReadOnlyMethod(method), (error) => error.status === 405 && error.body.error.code === 'method_not_allowed');
  }
  assert.doesNotThrow(() => assertReadOnlyMethod('POST', true));
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.throws(() => assertReadOnlyMethod(method, true));
});

test('MCP arguments are validated server-side', () => {
  assert.doesNotThrow(() => validateToolArguments('get_daily_briefing_items', { date: '2026-09-01', timezone: 'America/New_York', lookback_period: 7 }));
  assert.throws(() => validateToolArguments('get_daily_briefing_items', { date: '09/01/2026', timezone: 'America/New_York', lookback_period: 7 }));
  assert.throws(() => validateToolArguments('get_project_details', { project_id: 'p-1', write: true }));
  assert.throws(() => validateToolArguments('list_overdue_tasks', { date: '2026-09-01', limit: 101 }));
});

test('MCP surface contains only the six requested read-only tools', () => {
  assert.deepEqual(MCP_TOOLS.map((tool) => tool.name), [
    'get_daily_briefing_items', 'list_overdue_tasks', 'list_active_risks',
    'list_upcoming_milestones', 'search_project_updates', 'get_project_details',
  ]);
  for (const tool of MCP_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.doesNotMatch(tool.name, /^(create|update|delete|upload|admin)_/i);
  }
});

test('record projections omit customer contact data and secret-like fields', () => {
  const project = projectRecord({ id: 'p-1', created_at: '2026-09-01T12:00:00Z', data: { name: 'Safe project', manager: 'Project Manager', desc: 'Executive summary', customerEmail: 'private@example.com', customerPhone: '555-0100', address: 'Private address', apiKey: 'secret' } }, 'https://projecthub.destinyhomesnj.com');
  assert.equal(project.owner, 'Project Manager');
  assert.equal(project.summary, 'Executive summary');
  const serialized = JSON.stringify(project);
  assert.doesNotMatch(serialized, /private@example|555-0100|Private address|secret/);

  const task = taskRecord({ id: 't-1', created_at: '2026-09-01T12:00:00Z', data: { projectId: 'p-1', label: 'Safe task', due: '2026-09-02', assignees: ['Owner'], attachment: { dataUrl: 'secret' } } }, project, 'https://projecthub.destinyhomesnj.com');
  assert.equal(task.due_date, '2026-09-02');
  assert.doesNotMatch(JSON.stringify(task), /dataUrl|secret/);
});

test('filters validate input, filter exact fields, and paginate with opaque cursors', () => {
  const filters = parseFilters(new URLSearchParams('project=p-1&priority=high&limit=1'));
  const items = [
    { id: '1', project_id: 'p-1', project_name: 'One', priority: 'high' },
    { id: '2', project_id: 'p-2', project_name: 'Two', priority: 'high' },
  ];
  assert.deepEqual(filterItems(items, filters).map((item) => item.id), ['1']);
  const first = paginate(items, 1);
  assert.equal(first.page.has_more, true);
  assert.deepEqual(paginate(items, 1, first.page.next_cursor).items.map((item) => item.id), ['2']);
  assert.throws(() => parseFilters(new URLSearchParams('email=private@example.com')));
  assert.throws(() => parseFilters(new URLSearchParams('limit=1000')));
  assert.deepEqual(auditFilterNames({ q: 'sensitive phrase', cursor: 'opaque', project: 'p-1', status: 'open' }), ['project', 'status']);
});
