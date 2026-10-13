export const API_VERSION = 'v1';
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

const FILTER_KEYS = new Set([
  'project', 'owner', 'status', 'priority', 'due_date', 'updated_since',
  'date', 'timezone', 'lookback_days', 'due_soon_days', 'q', 'type', 'limit', 'cursor',
]);

export const MCP_TOOLS = [
  {
    name: 'get_daily_briefing_items',
    description: 'Return compact, citation-ready ProjectHub items for an executive daily briefing.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        date: { type: 'string', format: 'date' },
        timezone: { type: 'string', description: 'IANA timezone, for example America/New_York.' },
        lookback_period: { type: 'integer', minimum: 0, maximum: 90, default: 7 },
        project_filters: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 160 } },
      },
      required: ['date', 'timezone', 'lookback_period'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_overdue_tasks', description: 'List incomplete tasks due before a supplied date.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { date: { type: 'string', format: 'date' }, project: { type: 'string' }, owner: { type: 'string' }, priority: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['date'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_active_risks', description: 'List active blockers, delays, and high-priority risk items.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { project: { type: 'string' }, owner: { type: 'string' }, priority: { type: 'string' }, updated_since: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_upcoming_milestones', description: 'List upcoming project phases and schedule steps.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { date: { type: 'string', format: 'date' }, days: { type: 'integer', minimum: 1, maximum: 180 }, project: { type: 'string' }, owner: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['date'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'search_project_updates', description: 'Search recent project updates and daily logs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', minLength: 2, maxLength: 200 }, project: { type: 'string' }, updated_since: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_project_details', description: 'Get a single project and its current executive summary by stable ProjectHub ID.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { project_id: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['project_id'] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export function structuredError(code, message, status = 400, details = undefined) {
  return { status, body: { error: { code, message, ...(details ? { details } : {}) } } };
}

export function assertReadOnlyMethod(method, mcp = false) {
  const allowed = mcp ? ['POST'] : ['GET', 'HEAD'];
  if (!allowed.includes(String(method || '').toUpperCase())) {
    throw structuredError('method_not_allowed', 'This service exposes read-only operations only.', 405);
  }
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function validateTimezone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value; }
  catch { throw structuredError('invalid_filter', 'timezone must be a valid IANA timezone.', 400); }
}

export function validateToolArguments(name, input) {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw structuredError('tool_not_found', 'Unknown read-only MCP tool.', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw structuredError('invalid_arguments', 'Tool arguments must be an object.', 400);
  const schema = tool.inputSchema;
  for (const required of schema.required || []) {
    if (input[required] === undefined || input[required] === null || input[required] === '') throw structuredError('invalid_arguments', `${required} is required.`, 400);
  }
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key];
    if (!property) throw structuredError('invalid_arguments', `Unsupported tool argument: ${key}.`, 400);
    if (property.type === 'string' && typeof value !== 'string') throw structuredError('invalid_arguments', `${key} must be a string.`, 400);
    if (property.type === 'integer' && !Number.isInteger(value)) throw structuredError('invalid_arguments', `${key} must be an integer.`, 400);
    if (property.type === 'array' && !Array.isArray(value)) throw structuredError('invalid_arguments', `${key} must be an array.`, 400);
    if (property.minimum !== undefined && value < property.minimum) throw structuredError('invalid_arguments', `${key} is below its minimum.`, 400);
    if (property.maximum !== undefined && value > property.maximum) throw structuredError('invalid_arguments', `${key} exceeds its maximum.`, 400);
    if (property.minLength !== undefined && value.length < property.minLength) throw structuredError('invalid_arguments', `${key} is too short.`, 400);
    if (property.maxLength !== undefined && value.length > property.maxLength) throw structuredError('invalid_arguments', `${key} is too long.`, 400);
    if (property.maxItems !== undefined && value.length > property.maxItems) throw structuredError('invalid_arguments', `${key} contains too many items.`, 400);
    if (property.format === 'date' && !validDate(value)) throw structuredError('invalid_arguments', `${key} must use YYYY-MM-DD.`, 400);
    if (property.format === 'date-time' && !validTimestamp(value)) throw structuredError('invalid_arguments', `${key} must be an ISO-8601 timestamp.`, 400);
    if (key === 'timezone') validateTimezone(value);
    if (property.type === 'array' && property.items?.type === 'string' && value.some((item) => typeof item !== 'string' || item.length < (property.items.minLength || 0) || item.length > (property.items.maxLength || Infinity))) throw structuredError('invalid_arguments', `${key} contains an invalid value.`, 400);
  }
  return input;
}

export function parseFilters(searchParams) {
  for (const key of searchParams.keys()) {
    if (!FILTER_KEYS.has(key)) throw structuredError('invalid_filter', `Unsupported filter: ${key}.`, 400);
  }
  const filters = Object.fromEntries(Array.from(searchParams.entries()).map(([key, value]) => [key, value.trim()]));
  if (filters.date && !validDate(filters.date)) throw structuredError('invalid_filter', 'date must use YYYY-MM-DD.', 400);
  if (filters.due_date && !validDate(filters.due_date)) throw structuredError('invalid_filter', 'due_date must use YYYY-MM-DD.', 400);
  if (filters.updated_since && !validTimestamp(filters.updated_since)) throw structuredError('invalid_filter', 'updated_since must be an ISO-8601 timestamp.', 400);
  if (filters.timezone) validateTimezone(filters.timezone);
  for (const key of ['lookback_days', 'due_soon_days', 'limit']) {
    if (filters[key] && !/^\d+$/.test(filters[key])) throw structuredError('invalid_filter', `${key} must be an integer.`, 400);
  }
  const limit = filters.limit ? Number(filters.limit) : DEFAULT_PAGE_SIZE;
  if (limit < 1 || limit > MAX_PAGE_SIZE) throw structuredError('invalid_filter', `limit must be between 1 and ${MAX_PAGE_SIZE}.`, 400);
  if (filters.q && (filters.q.length < 2 || filters.q.length > 200)) throw structuredError('invalid_filter', 'q must contain 2 to 200 characters.', 400);
  return { ...filters, limit };
}

export function encodeCursor(offset) {
  return btoa(JSON.stringify({ offset })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const normalized = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const parsed = JSON.parse(atob(normalized));
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > 1_000_000) throw new Error();
    return parsed.offset;
  } catch { throw structuredError('invalid_cursor', 'cursor is invalid or expired.', 400); }
}

export function paginate(items, limit, cursor = '') {
  const offset = decodeCursor(cursor);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return { items: pageItems, page: { limit, next_cursor: nextOffset < items.length ? encodeCursor(nextOffset) : null, has_more: nextOffset < items.length } };
}

export function filterItems(items, filters = {}) {
  const exact = (value, expected) => !expected || String(value || '').toLowerCase() === String(expected).toLowerCase();
  return items.filter((item) => {
    if (filters.project && ![item.project_id, item.project_name].some((value) => exact(value, filters.project))) return false;
    if (!exact(item.owner, filters.owner) || !exact(item.status, filters.status) || !exact(item.priority, filters.priority)) return false;
    if (filters.due_date && item.due_date !== filters.due_date) return false;
    if (filters.updated_since && (!item.updated_at || Date.parse(item.updated_at) < Date.parse(filters.updated_since))) return false;
    return true;
  });
}

export function publicSourceUrl(baseUrl, kind, id, projectId = '') {
  const base = String(baseUrl || 'https://projecthub.destinyhomesnj.com').replace(/\/$/, '');
  if (kind === 'project') return `${base}/?project=${encodeURIComponent(id)}`;
  return `${base}/?project=${encodeURIComponent(projectId)}&${encodeURIComponent(kind)}=${encodeURIComponent(id)}`;
}

function clean(value, max = 500) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function iso(value, fallback = '') { const date = new Date(value || fallback); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function dateOnly(value) { const match = clean(value, 40).match(/^\d{4}-\d{2}-\d{2}/); return match?.[0] || null; }

export function projectRecord(row, baseUrl) {
  const data = row?.data || {};
  const owner = clean(data.manager || data.owner);
  return {
    id: clean(row.id, 160), type: 'project', project_id: clean(row.id, 160), project_name: clean(data.name, 200),
    updated_at: iso(data.updatedAt, row.created_at), owner, status: clean(data.status || 'planning', 80),
    priority: clean(data.priority || 'normal', 40), due_date: dateOnly(data.dueDate || data.targetCompletion || data.endDate),
    summary: clean(data.summary || data.desc || data.description, 600), next_action: clean(data.nextAction, 400),
    source_url: publicSourceUrl(baseUrl, 'project', row.id),
  };
}

export function taskRecord(row, project, baseUrl) {
  const data = row?.data || {};
  const assignees = Array.isArray(data.assignees) ? data.assignees : [data.assignee];
  const done = Boolean(data.done) || /^(done|complete|completed|closed)$/i.test(clean(data.status));
  return {
    id: clean(row.id, 160), type: 'task', project_id: clean(data.projectId, 160), project_name: clean(project?.project_name, 200),
    updated_at: iso(data.updatedAt, row.created_at), owner: clean(assignees.filter(Boolean).join(', '), 240),
    status: done ? 'completed' : clean(data.status || 'open', 80), priority: clean(data.priority || 'normal', 40),
    due_date: dateOnly(data.due || data.dueDate), summary: clean(data.summary || data.label || data.name, 600),
    next_action: clean(data.nextAction || (done ? '' : data.label || data.name), 400),
    source_url: publicSourceUrl(baseUrl, 'task', row.id, data.projectId), completed: done,
  };
}

export function workflowRecord(row, project, type, baseUrl) {
  const data = row?.data || {};
  return {
    id: clean(row.id, 160), type, project_id: clean(row.project_id, 160), project_name: clean(project?.project_name, 200),
    updated_at: iso(row.updated_at, row.created_at), owner: clean(data.owner || data.responsibleName || data.assignee, 240),
    status: clean(row.status || data.status || 'open', 80), priority: clean(data.priority || 'normal', 40),
    due_date: dateOnly(row.due_date || data.dueDate || data.due), summary: clean(row.title || data.summary || data.notes, 600),
    next_action: clean(data.nextAction || data.requiredAction, 400), source_url: publicSourceUrl(baseUrl, type, row.id, row.project_id),
  };
}

export function milestoneRecord(row, project, type, baseUrl) {
  const data = row?.data || {};
  return {
    id: clean(row.id, 160), type, project_id: clean(row.project_id, 160), project_name: clean(project?.project_name, 200),
    updated_at: iso(data.updatedAt || row.updated_at, row.created_at), owner: clean(data.assign || (data.assignees || []).join?.(', '), 240),
    status: clean(data.status || 'planning', 80), priority: clean(data.priority || 'normal', 40),
    due_date: dateOnly(data.end || data.due || data.dueDate), summary: clean(data.name || data.label || 'Project milestone', 600),
    next_action: clean(data.nextAction, 400), source_url: publicSourceUrl(baseUrl, type, row.id, row.project_id),
  };
}

export function isRisk(item) {
  const text = `${item.status} ${item.summary} ${item.next_action}`.toLowerCase();
  return !item.completed && (['high', 'critical', 'urgent'].includes(String(item.priority).toLowerCase()) || /\b(blocked|blocker|risk|delayed|at risk|revise|rejected)\b/.test(text));
}

export function compactCitationItem(item) {
  return {
    id: item.id, type: item.type, project_id: item.project_id, project: item.project_name,
    status: item.status, priority: item.priority, due_date: item.due_date, owner: item.owner,
    summary: item.summary, next_action: item.next_action, updated_at: item.updated_at,
    source_url: item.source_url,
    citation: { title: `${item.project_name || 'ProjectHub'} — ${item.summary || item.type}`, url: item.source_url },
  };
}

export function auditFilterNames(filters) {
  return Object.keys(filters || {}).filter((key) => FILTER_KEYS.has(key) && !['q', 'cursor'].includes(key)).sort();
}

export function hashSafeError(error) {
  const candidate = error?.body?.error ? error : structuredError('internal_error', 'The read-only service could not complete the request.', 500);
  return candidate;
}
