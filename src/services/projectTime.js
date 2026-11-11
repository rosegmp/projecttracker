import { fetchAuthorizedSupabase, getSupabaseDiagnosticsInfo } from './trackerData.js';

const TABLE = '/rest/v1/project_time_entries';
const localKey = (projectId) => `project-time:${projectId}`;

function localRows(projectId) {
  try {
    const rows = JSON.parse(localStorage.getItem(localKey(projectId)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveLocalRows(projectId, rows) {
  localStorage.setItem(localKey(projectId), JSON.stringify(rows));
}

async function readResponse(response, fallback) {
  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try { message = JSON.parse(body)?.message || body; } catch { /* Use raw response. */ }
    if (/project_time_entries_one_running_per_project_user_idx|23505/i.test(message)) {
      throw new Error('You already have a running timer on this project. Stop it before starting another.');
    }
    if (/PGRST205|42P01|schema cache|relation.*project_time_entries.*does not exist/i.test(message)) {
      throw new Error('Time tracking needs its database migration applied.');
    }
    throw new Error(message || fallback);
  }
  return body ? JSON.parse(body) : null;
}

export function timeEntryMinutes(entry, now = Date.now()) {
  const start = Date.parse(entry?.started_at || '');
  const end = entry?.ended_at ? Date.parse(entry.ended_at) : now;
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : 0;
}

export function formatTrackedDuration(minutes) {
  const rounded = Math.max(0, Math.round(minutes));
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, '0')}m`;
}

export function createProjectTimeService(projectId) {
  const id = String(projectId || '');
  const configured = getSupabaseDiagnosticsInfo().configured;
  const scopedPath = `${TABLE}?project_id=eq.${encodeURIComponent(id)}`;

  return {
    async list() {
      if (!configured) return localRows(id).sort((a, b) => b.started_at.localeCompare(a.started_at));
      const rows = [];
      let page = [];
      do {
        const response = await fetchAuthorizedSupabase(`${scopedPath}&select=*&order=started_at.desc&limit=1000&offset=${rows.length}`, {}, 'Load project time');
        page = await readResponse(response, 'Unable to load project time.');
        rows.push(...page);
      } while (page.length === 1000);
      return rows;
    },
    async create(entry) {
      const row = { project_id: id, task_id: entry.task_id || null, description: entry.description.trim(), started_at: entry.started_at, ended_at: entry.ended_at || null };
      if (!configured) {
        const saved = { ...row, id: globalThis.crypto?.randomUUID?.() || `time-${Date.now()}-${Math.random().toString(36).slice(2)}`, user_id: entry.user_id, user_email: entry.user_email || '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        saveLocalRows(id, [saved, ...localRows(id)]);
        return saved;
      }
      const response = await fetchAuthorizedSupabase(TABLE, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row),
      }, 'Save project time');
      return (await readResponse(response, 'Unable to save project time.'))?.[0];
    },
    async update(entryId, changes) {
      const row = { task_id: changes.task_id || null, description: changes.description.trim(), started_at: changes.started_at, ended_at: changes.ended_at || null };
      if (!configured) {
        const rows = localRows(id);
        const existing = rows.find((entry) => entry.id === entryId);
        if (!existing) throw new Error('Time entry no longer exists.');
        const saved = { ...existing, ...row, updated_at: new Date().toISOString() };
        saveLocalRows(id, rows.map((entry) => entry.id === entryId ? saved : entry));
        return saved;
      }
      const response = await fetchAuthorizedSupabase(`${scopedPath}&id=eq.${encodeURIComponent(entryId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row),
      }, 'Update project time');
      const saved = (await readResponse(response, 'Unable to update project time.'))?.[0];
      if (!saved) throw new Error('Time entry could not be updated. Refresh and try again.');
      return saved;
    },
    async remove(entryId) {
      if (!configured) {
        saveLocalRows(id, localRows(id).filter((entry) => entry.id !== entryId));
        return;
      }
      const response = await fetchAuthorizedSupabase(`${scopedPath}&id=eq.${encodeURIComponent(entryId)}`, {
        method: 'DELETE', headers: { Prefer: 'return=representation' },
      }, 'Delete project time');
      const deleted = await readResponse(response, 'Unable to delete project time.');
      if (!deleted?.length) throw new Error('Time entry could not be deleted. Refresh and try again.');
    },
  };
}
