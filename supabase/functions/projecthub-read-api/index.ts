import { createClient } from 'npm:@supabase/supabase-js@2';
import { getRequestId, REQUEST_ID_HEADER } from '../_shared/requestCorrelation.ts';
import {
  API_VERSION, MCP_TOOLS, assertReadOnlyMethod, auditFilterNames, compactCitationItem, filterItems,
  hashSafeError, isRisk, milestoneRecord, paginate, parseFilters, projectRecord, structuredError,
  taskRecord, validateTimezone, validateToolArguments, workflowRecord,
} from './core.js';

const FUNCTION_NAME = 'projecthub-read-api';
const BUSINESS_READ_LIMIT = 5000;
const BASE_SITE_URL = Deno.env.get('PROJECTHUB_SITE_URL') || 'https://projecthub.destinyhomesnj.com';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || requiredEnv('SUPABASE_SECRET_KEY');
}

function bearerToken(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1] || '';
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status: number, requestId: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', [REQUEST_ID_HEADER]: requestId, ...headers } });
}

function routePath(url: URL) {
  const marker = `/${FUNCTION_NAME}`;
  const index = url.pathname.indexOf(marker);
  const path = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
  return path.replace(/\/$/, '') || '/';
}

type AuthContext = { clientId: string; allowedProjectIds: string[]; rateRemaining: number; rateLimit: number };

async function authorize(admin: ReturnType<typeof createClient>, request: Request, requestId: string, action: string, resource: string): Promise<AuthContext> {
  const apiKey = bearerToken(request);
  if (apiKey.length > 240) throw structuredError('invalid_api_key', 'A valid ProjectHub service-account API key is required.', 401);
  const { data, error } = await admin.rpc('projecthub_authorize_api_request', { p_key_hash: await sha256(apiKey), p_request_id: requestId, p_action: action, p_resource: resource });
  if (error) throw error;
  if (!data?.authorized) {
    if (data?.code === 'rate_limit_exceeded') throw structuredError('rate_limit_exceeded', 'The service-account rate limit was exceeded.', 429, { retry_after: data.retry_after || 60 });
    if (data?.code === 'insufficient_scope') throw structuredError('insufficient_scope', 'The service account lacks the required read scope.', 403);
    throw structuredError('invalid_api_key', 'The API key is invalid, expired, disabled, or revoked.', 401);
  }
  return { clientId: String(data.client_id), allowedProjectIds: Array.isArray(data.allowed_project_ids) ? data.allowed_project_ids.map(String) : [], rateRemaining: Number(data.rate_remaining) || 0, rateLimit: Number(data.rate_limit) || 0 };
}

function scoped<T>(query: T, column: string, projectIds: string[]): T {
  return projectIds.length ? (query as any).in(column, projectIds) : query;
}

async function loadRecords(admin: ReturnType<typeof createClient>, allowedProjectIds: string[]) {
  const projectsQuery = allowedProjectIds.length
    ? admin.from('projects').select('id,data,created_at').in('id', allowedProjectIds).limit(BUSINESS_READ_LIMIT)
    : admin.from('projects').select('id,data,created_at').limit(BUSINESS_READ_LIMIT);
  const tasksQuery = allowedProjectIds.length
    ? admin.from('tasks').select('id,data,created_at').in('data->>projectId', allowedProjectIds).limit(BUSINESS_READ_LIMIT)
    : admin.from('tasks').select('id,data,created_at').limit(BUSINESS_READ_LIMIT);
  const queries = [
    projectsQuery,
    tasksQuery,
    scoped(admin.from('project_phases').select('id,project_id,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_steps').select('id,project_id,phase_id,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_schedule_delays').select('id,project_id,phase_id,step_id,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_daily_logs').select('id,project_id,log_date,title,data,created_at,updated_at').order('updated_at', { ascending: false }).limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_rfis').select('id,project_id,title,status,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_submittals').select('id,project_id,title,status,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
    scoped(admin.from('project_selections').select('id,project_id,data,created_at,updated_at').limit(BUSINESS_READ_LIMIT), 'project_id', allowedProjectIds),
  ];
  const results = await Promise.all(queries);
  const failure = results.find((result) => result.error)?.error;
  if (failure) throw failure;
  const [projectRows, taskRows, phaseRows, stepRows, delayRows, logRows, rfiRows, submittalRows, selectionRows] = results.map((result) => result.data || []);
  const projectItems = projectRows.map((row) => projectRecord(row, BASE_SITE_URL));
  const projectMap = new Map(projectItems.map((item) => [item.id, item]));
  const projectAllowed = (projectId: string) => !allowedProjectIds.length || allowedProjectIds.includes(projectId);
  const tasks = taskRows.map((row) => taskRecord(row, projectMap.get(String(row.data?.projectId || '')), BASE_SITE_URL)).filter((item) => projectAllowed(item.project_id));
  const milestones = [
    ...phaseRows.map((row) => milestoneRecord(row, projectMap.get(row.project_id), 'phase', BASE_SITE_URL)),
    ...stepRows.map((row) => milestoneRecord(row, projectMap.get(row.project_id), 'step', BASE_SITE_URL)),
  ];
  const updates = [
    ...logRows.map((row) => workflowRecord({ ...row, status: 'published', due_date: row.log_date }, projectMap.get(row.project_id), 'daily_log', BASE_SITE_URL)),
    ...rfiRows.map((row) => workflowRecord(row, projectMap.get(row.project_id), 'rfi', BASE_SITE_URL)),
    ...submittalRows.map((row) => workflowRecord(row, projectMap.get(row.project_id), 'submittal', BASE_SITE_URL)),
  ];
  const delays = delayRows.map((row) => workflowRecord({ ...row, status: 'delayed', title: row.data?.reason || row.data?.notes || 'Schedule delay' }, projectMap.get(row.project_id), 'schedule_delay', BASE_SITE_URL));
  const selections = selectionRows.map((row) => workflowRecord({ ...row, title: row.data?.itemName || row.data?.name, status: row.data?.status }, projectMap.get(row.project_id), 'selection', BASE_SITE_URL));
  return { projects: projectItems, tasks, milestones, updates, risks: [...tasks, ...delays, ...updates].filter(isRisk), selections };
}

function sortItems(items: any[]) {
  return [...items].sort((a, b) => String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31')) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || String(a.id).localeCompare(String(b.id)));
}

function dateRange(date: string, days: number) {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + days);
  return { start: date, end: end.toISOString().slice(0, 10) };
}

function briefing(records: any, date: string, timezone: string, lookbackDays: number, projects: string[] = []) {
  validateTimezone(timezone);
  const wanted = (item: any) => !projects.length || projects.includes(item.project_id) || projects.includes(item.project_name);
  const dueSoonEnd = dateRange(date, 14).end;
  const lookback = new Date(`${date}T00:00:00Z`); lookback.setUTCDate(lookback.getUTCDate() - lookbackDays);
  const overdue = records.tasks.filter((item: any) => wanted(item) && !item.completed && item.due_date && item.due_date < date);
  const dueToday = records.tasks.filter((item: any) => wanted(item) && !item.completed && item.due_date === date);
  const dueSoon = records.tasks.filter((item: any) => wanted(item) && !item.completed && item.due_date > date && item.due_date <= dueSoonEnd);
  const recentUpdates = records.updates.filter((item: any) => wanted(item) && item.updated_at && Date.parse(item.updated_at) >= lookback.getTime());
  const risks = records.risks.filter(wanted);
  const milestones = records.milestones.filter((item: any) => wanted(item) && item.due_date >= date && item.due_date <= dueSoonEnd && !/complete|closed/i.test(item.status));
  const attention = [...overdue, ...risks, ...records.selections.filter((item: any) => wanted(item) && /needs decision|pending|rejected/i.test(item.status))];
  const unique = (items: any[]) => Array.from(new Map(sortItems(items).map((item) => [`${item.type}:${item.id}`, compactCitationItem(item)])).values());
  return { as_of: { date, timezone, lookback_days: lookbackDays }, counts: { overdue: overdue.length, due_today: dueToday.length, due_soon: dueSoon.length, recent_updates: recentUpdates.length, active_risks: risks.length, upcoming_milestones: milestones.length, executive_attention: unique(attention).length }, overdue: unique(overdue), due_today: unique(dueToday), due_soon: unique(dueSoon), recent_updates: unique(recentUpdates), active_risks: unique(risks), upcoming_milestones: unique(milestones), executive_attention: unique(attention) };
}

async function apiPayload(path: string, filters: any, records: any) {
  let items: any[];
  if (path === '/api/v1/projects') items = records.projects;
  else if (path === '/api/v1/tasks') {
    const classification = filters.status;
    items = records.tasks.filter((item: any) => {
      if (filters.status === 'overdue') return !item.completed && item.due_date && item.due_date < (filters.date || new Date().toISOString().slice(0, 10));
      if (filters.status === 'due_today') return !item.completed && item.due_date === (filters.date || new Date().toISOString().slice(0, 10));
      if (filters.status === 'due_soon') { const start = filters.date || new Date().toISOString().slice(0, 10); return !item.completed && item.due_date > start && item.due_date <= dateRange(start, Number(filters.due_soon_days || 14)).end; }
      return true;
    });
    if (['overdue', 'due_today', 'due_soon'].includes(classification)) filters = { ...filters, status: '' };
  } else if (path === '/api/v1/updates') items = records.updates;
  else if (path === '/api/v1/risks') items = records.risks;
  else if (path === '/api/v1/milestones') items = records.milestones;
  else if (path === '/api/v1/attention') {
    const date = filters.date || new Date().toISOString().slice(0, 10);
    const attention = [
      ...records.tasks.filter((item: any) => !item.completed && item.due_date && item.due_date < date),
      ...records.risks,
      ...records.selections.filter((item: any) => /needs decision|pending|rejected/i.test(item.status)),
    ];
    items = Array.from(new Map(attention.map((item: any) => [`${item.type}:${item.id}`, item])).values());
  }
  else if (path === '/api/v1/search') {
    const q = String(filters.q || '').toLowerCase();
    if (!q) throw structuredError('invalid_filter', 'q is required.', 400);
    items = [...records.projects, ...records.tasks, ...records.updates, ...records.risks, ...records.milestones].filter((item: any) => `${item.project_name} ${item.summary} ${item.next_action} ${item.owner} ${item.status}`.toLowerCase().includes(q));
  } else if (path === '/api/v1/briefing') return { data: briefing(records, filters.date || new Date().toISOString().slice(0, 10), filters.timezone || 'UTC', Number(filters.lookback_days || 7), filters.project ? [filters.project] : []) };
  else {
    const match = path.match(/^\/api\/v1\/records\/(project|task|daily_log|rfi|submittal|selection|phase|step|schedule_delay)\/([^/]+)$/);
    if (!match) throw structuredError('not_found', 'Read-only API route not found.', 404);
    const [, type, encodedId] = match;
    const id = decodeURIComponent(encodedId);
    const record = [...records.projects, ...records.tasks, ...records.updates, ...records.risks, ...records.milestones, ...records.selections].find((item: any) => item.type === type && item.id === id);
    if (!record) throw structuredError('not_found', 'ProjectHub record not found.', 404);
    return { data: record };
  }
  return { data: paginate(sortItems(filterItems(items, filters)), filters.limit, filters.cursor) };
}

async function callTool(name: string, args: any, records: any) {
  validateToolArguments(name, args);
  const limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
  if (name === 'get_daily_briefing_items') return briefing(records, args.date, args.timezone, Number(args.lookback_period), Array.isArray(args.project_filters) ? args.project_filters : []);
  if (name === 'list_overdue_tasks') return sortItems(filterItems(records.tasks, args)).filter((item: any) => !item.completed && item.due_date && item.due_date < args.date).slice(0, limit).map(compactCitationItem);
  if (name === 'list_active_risks') return sortItems(filterItems(records.risks, args)).slice(0, limit).map(compactCitationItem);
  if (name === 'list_upcoming_milestones') { const end = dateRange(args.date, Number(args.days || 30)).end; return sortItems(filterItems(records.milestones, args)).filter((item: any) => item.due_date >= args.date && item.due_date <= end).slice(0, limit).map(compactCitationItem); }
  if (name === 'search_project_updates') { const q = String(args.query || '').trim().toLowerCase(); if (q.length < 2 || q.length > 200) throw structuredError('invalid_arguments', 'query must contain 2 to 200 characters.', 400); return sortItems(filterItems(records.updates, { project: args.project, updated_since: args.updated_since })).filter((item: any) => `${item.summary} ${item.next_action} ${item.status}`.toLowerCase().includes(q)).slice(0, limit).map(compactCitationItem); }
  if (name === 'get_project_details') { const project = records.projects.find((item: any) => item.id === args.project_id); if (!project) throw structuredError('not_found', 'Project not found.', 404); return { ...compactCitationItem(project), overdue_task_count: records.tasks.filter((item: any) => item.project_id === project.id && !item.completed && item.due_date && item.due_date < new Date().toISOString().slice(0, 10)).length, active_risk_count: records.risks.filter((item: any) => item.project_id === project.id).length, upcoming_milestones: sortItems(records.milestones.filter((item: any) => item.project_id === project.id)).slice(0, 10).map(compactCitationItem) }; }
  throw structuredError('tool_not_found', 'Unknown read-only MCP tool.', 404);
}

async function mcpResponse(payload: any, records: any) {
  const id = payload?.id ?? null;
  if (payload?.jsonrpc !== '2.0' || typeof payload?.method !== 'string') return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC request.' } };
  if (payload.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'projecthub-read-api', version: '1.0.0' } } };
  if (payload.method === 'notifications/initialized') return null;
  if (payload.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (payload.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  if (payload.method === 'tools/call') {
    try {
      const result = await callTool(String(payload.params?.name || ''), payload.params?.arguments || {}, records);
      const structuredContent = Array.isArray(result) ? { items: result } : result;
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent, isError: false } };
    } catch (error) {
      const safe = hashSafeError(error);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: safe.body.error.message }], structuredContent: safe.body, isError: true } };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found.' } };
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  const path = routePath(url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Allow': 'GET, HEAD, POST, OPTIONS', [REQUEST_ID_HEADER]: requestId } });
  if (path === '/health' && ['GET', 'HEAD'].includes(request.method)) return json({ ok: true, service: FUNCTION_NAME, version: API_VERSION }, 200, requestId);
  const admin = createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
  const mcp = path === '/mcp';
  let auth: AuthContext | null = null;
  let filters: any = {};
  let status = 500;
  try {
    assertReadOnlyMethod(request.method, mcp);
    auth = await authorize(admin, request, requestId, mcp ? 'mcp.read' : 'projecthub.read', path);
    const records = await loadRecords(admin, auth.allowedProjectIds);
    let body;
    if (mcp) {
      const payload = await request.json().catch(() => { throw structuredError('invalid_json', 'MCP request body must be valid JSON.', 400); });
      body = await mcpResponse(payload, records);
      if (body === null) return new Response(null, { status: 202, headers: { [REQUEST_ID_HEADER]: requestId } });
    } else {
      filters = parseFilters(url.searchParams);
      body = await apiPayload(path, filters, records);
    }
    status = 200;
    await admin.rpc('projecthub_record_api_outcome', { p_request_id: requestId, p_client_id: auth.clientId, p_action: mcp ? 'mcp.read' : 'projecthub.read', p_resource: path, p_status: status, p_outcome: 'success', p_filter_names: auditFilterNames(filters) });
    return json(body, status, requestId, { 'X-RateLimit-Limit': String(auth.rateLimit), 'X-RateLimit-Remaining': String(auth.rateRemaining) });
  } catch (error) {
    const safe = hashSafeError(error);
    status = safe.status;
    if (auth) {
      try {
        await admin.rpc('projecthub_record_api_outcome', { p_request_id: requestId, p_client_id: auth.clientId, p_action: mcp ? 'mcp.read' : 'projecthub.read', p_resource: path, p_status: status, p_outcome: safe.body.error.code, p_filter_names: auditFilterNames(filters) });
      } catch {
        // Preserve the original error response if audit logging is unavailable.
      }
    }
    const retryAfter = safe.body.error.details?.retry_after;
    return json({ ...safe.body, request_id: requestId }, status, requestId, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
  }
});
