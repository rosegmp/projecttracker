import { fetchAuthorizedSupabase, getSupabaseDiagnosticsInfo } from './trackerData.js';

const CONFIG = {
  dailyLogs: { table: 'project_daily_logs', order: 'log_date.desc,updated_at.desc' },
  changeOrders: { table: 'project_change_orders', order: 'updated_at.desc', numberColumn: 'order_number' },
  rfis: { table: 'project_rfis', order: 'updated_at.desc', numberColumn: 'order_number' },
  submittals: { table: 'project_submittals', order: 'updated_at.desc', numberColumn: 'order_number' },
  budgetItems: { table: 'project_budget_items', order: 'item_code.asc,updated_at.desc', numberColumn: 'item_code' },
  commitments: { table: 'project_commitments', order: 'updated_at.desc', numberColumn: 'commitment_number' },
  portalItems: { table: 'project_portal_items', order: 'updated_at.desc', numberColumn: 'item_number' },
};

function createId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function localKey(type, projectId) { return `project-workflows:${type}:${projectId}`; }
function readLocal(type, projectId) {
  try {
    const rows = JSON.parse(window.localStorage.getItem(localKey(type, projectId)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
function writeLocal(type, projectId, rows) {
  window.localStorage.setItem(localKey(type, projectId), JSON.stringify(rows));
}

function normalize(type, row) {
  const data = row?.data || {};
  const config = CONFIG[type] || {};
  return {
    ...data,
    id: String(row?.id || data.id || ''),
    projectId: String(row?.project_id || data.projectId || ''),
    version: Math.max(1, Number(row?.version || data.version) || 1),
    createdAt: String(row?.created_at || data.createdAt || ''),
    updatedAt: String(row?.updated_at || data.updatedAt || ''),
    ...(type === 'dailyLogs'
      ? { date: String(row?.log_date || data.date || ''), title: String(row?.title || data.title || 'Daily log') }
      : { number: String(row?.[config.numberColumn] || data.number || ''), title: String(row?.title || data.title || ''), status: String(row?.status || data.status || 'proposed') }),
  };
}

async function responseJson(response, fallback) {
  const text = await response.text();
  if (!response.ok) throw new Error(text || fallback);
  return text ? JSON.parse(text) : null;
}

function missingTable(error) {
  return /project_daily_logs|project_change_orders|project_rfis|project_submittals|project_budget_items|project_commitments|project_portal_items|respond_to_project_portal_item|PGRST205|42P01|schema cache|does not exist|404/i.test(String(error?.message || error || ''));
}

function remoteBody(type, projectId, record) {
  const config = CONFIG[type];
  const serializableRecord = { ...record };
  delete serializableRecord.deletedPhotos;
  const shared = { id: record.id, project_id: projectId, title: record.title, data: { ...serializableRecord, projectId, id: record.id } };
  delete shared.data.version;
  if (type === 'dailyLogs') return { ...shared, log_date: record.date };
  if (type === 'portalItems') return {
    ...shared,
    item_number: record.number,
    item_type: record.itemType || 'update',
    audience: record.audience || 'all',
    status: record.status || 'published',
    due_date: record.dueDate || null,
  };
  return { ...shared, [config.numberColumn]: record.number, status: record.status || 'proposed' };
}

export function createConstructionWorkflowService({ projectId, canEdit = true }) {
  const scopedProjectId = String(projectId || '').trim();
  const configured = getSupabaseDiagnosticsInfo().configured;
  if (!scopedProjectId) throw new Error('A project is required.');
  const assertEdit = () => { if (!canEdit) throw new Error('You do not have edit access to this project.'); };

  function saveLocal(type, record) {
    const now = new Date().toISOString();
    const rows = readLocal(type, scopedProjectId);
    const previous = rows.find((item) => item.id === record.id);
    const saved = { ...record, projectId: scopedProjectId, version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now };
    writeLocal(type, scopedProjectId, [saved, ...rows.filter((item) => item.id !== saved.id)]);
    return saved;
  }

  return {
    async list(type) {
      const config = CONFIG[type];
      if (!config) throw new Error('Unknown project workflow.');
      if (!configured) return { records: readLocal(type, scopedProjectId), local: true };
      try {
        const response = await fetchAuthorizedSupabase(`/rest/v1/${config.table}?project_id=eq.${encodeURIComponent(scopedProjectId)}&select=*&order=${config.order}`, { method: 'GET' }, 'Project workflow load');
        return { records: (await responseJson(response, 'Unable to load project workflow.')).map((row) => normalize(type, row)), local: false };
      } catch (error) {
        if (missingTable(error)) return { records: readLocal(type, scopedProjectId), local: true, setupRequired: true };
        throw error;
      }
    },

    async save(type, draft) {
      assertEdit();
      const config = CONFIG[type];
      const idPrefix = { dailyLogs: 'log', changeOrders: 'co', rfis: 'rfi', submittals: 'submittal', budgetItems: 'budget', commitments: 'commitment', portalItems: 'portal' }[type] || 'workflow';
      const record = { ...draft, id: draft.id || createId(idPrefix) };
      if (!configured) return { record: saveLocal(type, record), local: true };
      try {
        const body = remoteBody(type, scopedProjectId, record);
        const existing = Number(draft.version) > 0;
        const path = existing
          ? `/rest/v1/${config.table}?project_id=eq.${encodeURIComponent(scopedProjectId)}&id=eq.${encodeURIComponent(record.id)}&version=eq.${draft.version}`
          : `/rest/v1/${config.table}`;
        const response = await fetchAuthorizedSupabase(path, {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(body),
        }, 'Project workflow save');
        const payload = await responseJson(response, 'Unable to save project workflow.');
        if (!Array.isArray(payload) || !payload[0]) throw new Error('This record changed elsewhere. Reopen it before saving.');
        return { record: normalize(type, payload[0]), local: false };
      } catch (error) {
        if (missingTable(error)) return { record: saveLocal(type, record), local: true, setupRequired: true };
        throw error;
      }
    },

    async remove(type, record) {
      assertEdit();
      const config = CONFIG[type];
      if (!configured) {
        writeLocal(type, scopedProjectId, readLocal(type, scopedProjectId).filter((item) => item.id !== record.id));
        return { local: true };
      }
      try {
        const response = await fetchAuthorizedSupabase(`/rest/v1/${config.table}?project_id=eq.${encodeURIComponent(scopedProjectId)}&id=eq.${encodeURIComponent(record.id)}&version=eq.${record.version}`, { method: 'DELETE' }, 'Project workflow delete');
        if (!response.ok) throw new Error(await response.text());
        return { local: false };
      } catch (error) {
        if (!missingTable(error)) throw error;
        writeLocal(type, scopedProjectId, readLocal(type, scopedProjectId).filter((item) => item.id !== record.id));
        return { local: true, setupRequired: true };
      }
    },

    async respondToPortalItem(record, response, decision = '') {
      const updated = {
        ...record,
        response: String(response || '').trim(),
        status: ['approved', 'declined'].includes(decision) ? decision : 'answered',
      };
      if (!configured) return { record: saveLocal('portalItems', updated), local: true };
      try {
        const remoteResponse = await fetchAuthorizedSupabase('/rest/v1/rpc/respond_to_project_portal_item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_item_id: record.id,
            p_version: record.version,
            p_response: updated.response,
            p_decision: decision,
          }),
        }, 'Portal response');
        const payload = await responseJson(remoteResponse, 'Unable to save portal response.');
        if (!Array.isArray(payload) || !payload[0]) throw new Error('This portal item changed elsewhere. Reopen it before responding.');
        return { record: normalize('portalItems', payload[0]), local: false };
      } catch (error) {
        if (missingTable(error)) return { record: saveLocal('portalItems', updated), local: true, setupRequired: true };
        throw error;
      }
    },
  };
}
