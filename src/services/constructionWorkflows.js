import { fetchAuthorizedSupabase, getStoredAuthSession, getSupabaseDiagnosticsInfo } from './trackerData.js';
import {
  createOfflineOperationId,
  enqueueOfflineOperation,
  getOfflineOperations,
  isOfflineNetworkError,
  mergeQueuedDailyLogs,
  mergeQueuedWarrantyItems,
  removeOfflineOperationsForEntity,
} from './offlineOperations.js';
import {
  reconcileOfflineAttachments,
  removeOfflineAttachments,
} from './offlineAttachmentStore.js';
import {
  getOfflineProjectRecord,
  updateOfflineProjectWorkflowRecords,
} from './offlineProjectStore.js';

const CONFIG = {
  dailyLogs: { table: 'project_daily_logs', order: 'log_date.desc,updated_at.desc' },
  changeOrders: { table: 'project_change_orders', order: 'updated_at.desc', numberColumn: 'order_number' },
  rfis: { table: 'project_rfis', order: 'updated_at.desc', numberColumn: 'order_number' },
  submittals: { table: 'project_submittals', order: 'updated_at.desc', numberColumn: 'order_number' },
  budgetItems: { table: 'project_budget_items', order: 'item_code.asc,updated_at.desc', numberColumn: 'item_code' },
  commitments: { table: 'project_commitments', order: 'updated_at.desc', numberColumn: 'commitment_number' },
  portalItems: { table: 'project_portal_items', order: 'updated_at.desc', numberColumn: 'item_number' },
  warrantyItems: { table: 'project_warranty_items', order: 'updated_at.desc', numberColumn: 'item_number' },
  closeoutItems: { table: 'project_closeout_items', order: 'updated_at.desc', numberColumn: 'item_number' },
};

export const WORKFLOW_SEARCH_RESULT_LIMIT = 250;

export const OFFLINE_WORKFLOW_SECTION_TYPES = {
  portal: ['portalItems'],
  'daily-logs': ['dailyLogs'],
  'change-orders': ['changeOrders'],
  'rfis-submittals': ['rfis', 'submittals'],
  'budget-commitments': ['budgetItems', 'commitments'],
  'warranty-closeout': ['warrantyItems', 'closeoutItems'],
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

function contractorEntries(record) {
  return Array.isArray(record?.subcontractorWork) ? record.subcontractorWork : [];
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
      : type === 'portalItems'
        ? {
          number: String(row?.item_number || data.number || ''),
          title: String(row?.title || data.title || ''),
          itemType: String(row?.item_type || data.itemType || 'update'),
          audience: String(row?.audience || data.audience || 'all'),
          status: String(row?.status || data.status || 'published'),
          dueDate: String(row?.due_date || data.dueDate || ''),
        }
        : { number: String(row?.[config.numberColumn] || data.number || ''), title: String(row?.title || data.title || ''), status: String(row?.status || data.status || 'proposed') }),
  };
}

async function responseJson(response, fallback) {
  const text = await response.text();
  if (!response.ok) throw new Error(text || fallback);
  return text ? JSON.parse(text) : null;
}

function missingTable(error) {
  return /project_daily_logs|project_change_orders|project_rfis|project_submittals|project_budget_items|project_commitments|project_portal_items|project_warranty_items|project_closeout_items|respond_to_project_portal_item|list_customer_warranty_requests|submit_customer_warranty_request|PGRST205|42P01|schema cache|does not exist|404/i.test(String(error?.message || error || ''));
}

export async function loadWorkflowItemsForProjects(type, projectIds = []) {
  const config = CONFIG[type];
  if (!config) throw new Error('Unknown project workflow.');
  const ids = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length || !getSupabaseDiagnosticsInfo().configured) return [];
  const projectFilter = ids.map((id) => encodeURIComponent(id)).join(',');
  const response = await fetchAuthorizedSupabase(
    `/rest/v1/${config.table}?project_id=in.(${projectFilter})&select=*&order=${config.order}`,
    { method: 'GET' },
    'Workflow action center load',
  );
  const rows = await responseJson(response, 'Unable to load workflow action items.');
  return (Array.isArray(rows) ? rows : []).map((row) => normalize(type, row));
}

export async function loadWorkflowSearchItemsForProjects(type, projectIds = [], limit = WORKFLOW_SEARCH_RESULT_LIMIT) {
  const config = CONFIG[type];
  if (!config) throw new Error('Unknown project workflow.');
  const ids = Array.from(new Set((projectIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length || !getSupabaseDiagnosticsInfo().configured) return [];
  const boundedLimit = Math.max(1, Math.min(WORKFLOW_SEARCH_RESULT_LIMIT, Number(limit) || WORKFLOW_SEARCH_RESULT_LIMIT));
  const projectFilter = ids.map((id) => encodeURIComponent(id)).join(',');
  const select = type === 'dailyLogs'
    ? 'id,project_id,version,created_at,updated_at,log_date,title,data'
    : `id,project_id,version,created_at,updated_at,${config.numberColumn},title,status,data`;
  const response = await fetchAuthorizedSupabase(
    `/rest/v1/${config.table}?project_id=in.(${projectFilter})&select=${select}&order=${config.order}&limit=${boundedLimit}`,
    { method: 'GET' },
    'Global search workflow load',
  );
  const rows = await responseJson(response, 'Unable to load workflow search items.');
  return (Array.isArray(rows) ? rows : []).map((row) => normalize(type, row));
}

export async function loadPortalItemsForProjects(projectIds = []) {
  return loadWorkflowItemsForProjects('portalItems', projectIds);
}

async function readOfflineWorkflowRecords(userId, projectId, type) {
  if (!userId || !projectId) return null;
  const record = await getOfflineProjectRecord(userId, projectId).catch(() => null);
  const records = record?.snapshot?.workflows?.[type];
  return Array.isArray(records) ? records : null;
}

async function refreshOfflineWorkflowCache(userId, projectId, type, records) {
  if (!userId || !projectId) return;
  await updateOfflineProjectWorkflowRecords(userId, projectId, type, records).catch(() => null);
}

export async function loadOfflineProjectWorkflowSnapshot({ projectId, visibleTabs = [], role = '' } = {}) {
  const scopedProjectId = String(projectId || '').trim();
  if (!scopedProjectId) throw new Error('A project is required for offline workflow storage.');
  const visibleIds = new Set((visibleTabs || []).map((tab) => String(tab?.id || tab || '').trim()).filter(Boolean));
  const sections = Object.entries(OFFLINE_WORKFLOW_SECTION_TYPES)
    .filter(([sectionId]) => visibleIds.has(sectionId))
    .map(([sectionId, configuredTypes]) => ({
      sectionId,
      types: sectionId === 'warranty-closeout' && role === 'Customer'
        ? ['warrantyItems']
        : configuredTypes,
    }));
  const workflows = {};
  const cachedSections = [];
  const failures = [];

  await Promise.all(sections.map(async ({ sectionId, types }) => {
    const results = await Promise.allSettled(types.map(async (type) => {
      if (type === 'warrantyItems' && role === 'Customer') {
        const service = createConstructionWorkflowService({ projectId: scopedProjectId, canEdit: false });
        const result = await service.listCustomerWarrantyRequests();
        return result.records || [];
      }
      return loadWorkflowItemsForProjects(type, [scopedProjectId]);
    }));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      failures.push({
        sectionId,
        reason: failed.reason instanceof Error ? failed.reason.message : 'Workflow download failed.',
      });
      return;
    }
    types.forEach((type, index) => {
      workflows[type] = results[index].value;
    });
    cachedSections.push(sectionId);
  }));

  return { workflows, cachedSections, failures };
}

function remoteBody(type, projectId, record) {
  const config = CONFIG[type];
  const serializableRecord = { ...record };
  delete serializableRecord.deletedPhotos;
  Object.keys(serializableRecord)
    .filter((key) => key.startsWith('_offline'))
    .forEach((key) => delete serializableRecord[key]);
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

export function createConstructionWorkflowService({ projectId, canEdit = true, offlineQueueEnabled = true }) {
  const scopedProjectId = String(projectId || '').trim();
  const configured = getSupabaseDiagnosticsInfo().configured;
  const userId = String(getStoredAuthSession()?.user?.id || '').trim();
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

  async function queueDailyLogRecord(draft) {
    assertEdit();
    if (!configured || !userId) {
      throw new Error('Sign in to the configured project before saving offline attachments.');
    }
    const record = { ...draft, id: draft.id || createId('log') };
    const existingOperation = getOfflineOperations(userId, {
      kind: 'daily-log.save',
      projectId: scopedProjectId,
    }).find((operation) => operation.entityId === record.id);
    const operationId = existingOperation?.id || createOfflineOperationId();
    const attachments = [];
    const keepAttachmentIds = [];
    const entries = contractorEntries(record).map((entry) => ({
      ...entry,
      photos: (entry.photos || []).map((photo) => {
        if (photo?.file instanceof Blob) {
          const photoId = photo.id || createId('work-photo');
          const offlineAttachmentId = `${operationId}:daily-log-photo:${photoId}`;
          attachments.push({
            id: offlineAttachmentId,
            slot: `contractor:${entry.id}:photo:${photoId}`,
            file: photo.file,
            name: photo.name || photo.file.name,
            type: photo.type || photo.file.type,
            size: Number(photo.size || photo.file.size) || 0,
            metadata: { photoId, contractorEntryId: entry.id },
          });
          return {
            id: photoId,
            name: photo.name || photo.file.name,
            originalName: photo.originalName || photo.file.name,
            type: photo.type || photo.file.type,
            size: Number(photo.size || photo.file.size) || 0,
            _offlineAttachmentId: offlineAttachmentId,
          };
        }
        if (photo?._offlineAttachmentId) keepAttachmentIds.push(photo._offlineAttachmentId);
        return photo;
      }),
    }));
    const prepared = { ...record, subcontractorWork: entries };
    delete prepared.deletedPhotos;
    delete prepared.workPerformed;
    delete prepared.labor;
    const cleanupFiles = [
      ...(existingOperation?.cleanupFiles || []),
      ...(record.deletedPhotos || []),
    ].filter((file, index, files) =>
      file?.storagePath && files.findIndex((item) => item?.storagePath === file.storagePath) === index);
    const operation = {
      id: operationId,
      userId,
      kind: 'daily-log.save',
      action: 'save',
      projectId: scopedProjectId,
      entityId: record.id,
      payload: prepared,
      expected: existingOperation?.expected || { version: Number(record.version) || 0 },
      cleanupFiles,
    };
    const attachmentIds = await reconcileOfflineAttachments(operation, attachments, keepAttachmentIds);
    const queued = enqueueOfflineOperation(userId, { ...operation, attachmentIds });
    const queuedRecord = {
      ...prepared,
      projectId: scopedProjectId,
      _offlineStatus: queued.status,
      _offlineQueuedAt: queued.queuedAt,
    };
    writeLocal('dailyLogs', scopedProjectId, [
      queuedRecord,
      ...readLocal('dailyLogs', scopedProjectId).filter((item) => item.id !== record.id),
    ]);
    return { record: queuedRecord, local: true, offline: true, queued: true };
  }

  async function queueDailyLogDelete(record) {
    assertEdit();
    if (!configured || !userId) throw new Error('Sign in before deleting a daily log offline.');
    const existingOperation = getOfflineOperations(userId, {
      kind: 'daily-log.save',
      projectId: scopedProjectId,
    }).find((operation) => operation.entityId === record.id);
    if (Number(record.version) <= 0 && existingOperation) {
      await removeOfflineAttachments(existingOperation.id);
      removeOfflineOperationsForEntity(userId, {
        kind: 'daily-log.save', projectId: scopedProjectId, entityId: record.id,
      });
      writeLocal('dailyLogs', scopedProjectId, readLocal('dailyLogs', scopedProjectId).filter((item) => item.id !== record.id));
      return { local: true, offline: true, discarded: true };
    }
    const operation = {
      id: existingOperation?.id || createOfflineOperationId(),
      userId,
      kind: 'daily-log.save',
      action: 'delete',
      projectId: scopedProjectId,
      entityId: record.id,
      payload: { ...remoteBody('dailyLogs', scopedProjectId, record).data, version: Number(record.version) || 0 },
      expected: existingOperation?.expected || { version: Number(record.version) || 0 },
      cleanupFiles: contractorEntries(record).flatMap((entry) => entry.photos || []).filter((file) => file?.storagePath),
      attachmentIds: [],
    };
    if (existingOperation) await removeOfflineAttachments(existingOperation.id);
    const queued = enqueueOfflineOperation(userId, operation);
    const tombstone = {
      ...record,
      _offlineAction: 'delete',
      _offlineDeleted: true,
      _offlineStatus: queued.status,
      _offlineQueuedAt: queued.queuedAt,
    };
    writeLocal('dailyLogs', scopedProjectId, [
      tombstone,
      ...readLocal('dailyLogs', scopedProjectId).filter((item) => item.id !== record.id),
    ]);
    return { record: tombstone, local: true, offline: true, queued: true };
  }

  function queueWarrantyItemRecord(draft, cleanupFiles = []) {
    assertEdit();
    if (!configured || !userId) throw new Error('Sign in before saving a warranty item on this device.');
    const record = { ...draft, id: draft.id || createId('warranty') };
    const existingOperation = getOfflineOperations(userId, {
      kind: 'warranty-item.save', projectId: scopedProjectId,
    }).find((operation) => operation.entityId === record.id);
    const queued = enqueueOfflineOperation(userId, {
      id: existingOperation?.id || createOfflineOperationId(),
      kind: 'warranty-item.save',
      action: 'save',
      projectId: scopedProjectId,
      entityId: record.id,
      payload: { ...remoteBody('warrantyItems', scopedProjectId, record).data, version: Number(record.version) || 0 },
      expected: existingOperation?.expected || { version: Number(record.version) || 0 },
      cleanupFiles: [
        ...(existingOperation?.cleanupFiles || []),
        ...(cleanupFiles || []),
      ].filter((file, index, files) =>
        file?.storagePath && files.findIndex((item) => item?.storagePath === file.storagePath) === index),
      attachmentIds: [],
    });
    const queuedRecord = {
      ...record,
      projectId: scopedProjectId,
      version: Number(record.version) || 0,
      _offlineStatus: queued.status,
      _offlineQueuedAt: queued.queuedAt,
    };
    writeLocal('warrantyItems', scopedProjectId, [
      queuedRecord,
      ...readLocal('warrantyItems', scopedProjectId).filter((item) => item.id !== queuedRecord.id),
    ]);
    return { record: queuedRecord, local: true, offline: true, queued: true };
  }

  return {
    queueDailyLog: queueDailyLogRecord,
    queueDailyLogDelete,
    async list(type) {
      const config = CONFIG[type];
      if (!config) throw new Error('Unknown project workflow.');
      if (!configured) return { records: readLocal(type, scopedProjectId), local: true };
      try {
        const response = await fetchAuthorizedSupabase(`/rest/v1/${config.table}?project_id=eq.${encodeURIComponent(scopedProjectId)}&select=*&order=${config.order}`, { method: 'GET' }, 'Project workflow load');
        const remoteRecords = (await responseJson(response, 'Unable to load project workflow.')).map((row) => normalize(type, row));
        writeLocal(type, scopedProjectId, remoteRecords);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, type, remoteRecords);
        const records = type === 'dailyLogs'
          ? mergeQueuedDailyLogs(remoteRecords, getOfflineOperations(userId, { kind: 'daily-log.save', projectId: scopedProjectId }))
          : type === 'warrantyItems'
            ? mergeQueuedWarrantyItems(remoteRecords, getOfflineOperations(userId, { kind: 'warranty-item.save', projectId: scopedProjectId }))
            : remoteRecords;
        return { records, local: false };
      } catch (error) {
        if (missingTable(error)) return { records: readLocal(type, scopedProjectId), local: true, setupRequired: true };
        if (isOfflineNetworkError(error)) {
          const offlineRecords = await readOfflineWorkflowRecords(userId, scopedProjectId, type);
          if (offlineRecords) {
            const records = type === 'dailyLogs'
              ? mergeQueuedDailyLogs(offlineRecords, getOfflineOperations(userId, { kind: 'daily-log.save', projectId: scopedProjectId }))
              : type === 'warrantyItems'
                ? mergeQueuedWarrantyItems(offlineRecords, getOfflineOperations(userId, { kind: 'warranty-item.save', projectId: scopedProjectId }))
                : offlineRecords;
            return { records, local: true, offline: true };
          }
        }
        if (type === 'dailyLogs' && isOfflineNetworkError(error)) {
          return {
            records: mergeQueuedDailyLogs(
              readLocal(type, scopedProjectId),
              getOfflineOperations(userId, { kind: 'daily-log.save', projectId: scopedProjectId }),
            ),
            local: true,
            offline: true,
          };
        }
        if (type === 'warrantyItems' && isOfflineNetworkError(error)) {
          return {
            records: mergeQueuedWarrantyItems(
              readLocal(type, scopedProjectId),
              getOfflineOperations(userId, { kind: 'warranty-item.save', projectId: scopedProjectId }),
            ),
            local: true,
            offline: true,
          };
        }
        if (type === 'closeoutItems' && isOfflineNetworkError(error)) {
          return { records: readLocal(type, scopedProjectId), local: true, offline: true };
        }
        throw error;
      }
    },

    async save(type, draft, options = {}) {
      assertEdit();
      const config = CONFIG[type];
      const idPrefix = { dailyLogs: 'log', changeOrders: 'co', rfis: 'rfi', submittals: 'submittal', budgetItems: 'budget', commitments: 'commitment', portalItems: 'portal', warrantyItems: 'warranty', closeoutItems: 'closeout' }[type] || 'workflow';
      const record = { ...draft, id: draft.id || createId(idPrefix) };
      if (!configured) return { record: saveLocal(type, record), local: true };
      const queuedWarranty = type === 'warrantyItems' && getOfflineOperations(userId, {
        kind: 'warranty-item.save', projectId: scopedProjectId,
      }).some((operation) => operation.entityId === record.id);
      if (type === 'warrantyItems' && offlineQueueEnabled && (
        queuedWarranty || (typeof navigator !== 'undefined' && navigator.onLine === false)
      )) {
        return queueWarrantyItemRecord(record, options.cleanupFiles);
      }
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
        const savedRecord = normalize(type, payload[0]);
        if (type === 'dailyLogs') {
          const queuedOperations = getOfflineOperations(userId, {
            kind: 'daily-log.save',
            projectId: scopedProjectId,
          }).filter((operation) => operation.entityId === savedRecord.id);
          await Promise.all(queuedOperations.map((operation) => removeOfflineAttachments(operation.id)));
          removeOfflineOperationsForEntity(userId, {
            kind: 'daily-log.save',
            projectId: scopedProjectId,
            entityId: savedRecord.id,
          });
        }
        const nextLocalRecords = [
          savedRecord,
          ...readLocal(type, scopedProjectId).filter((item) => item.id !== savedRecord.id),
        ];
        writeLocal(type, scopedProjectId, nextLocalRecords);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, type, nextLocalRecords);
        return { record: savedRecord, local: false };
      } catch (error) {
        if (missingTable(error)) return { record: saveLocal(type, record), local: true, setupRequired: true };
        if (type === 'dailyLogs' && offlineQueueEnabled && isOfflineNetworkError(error)) {
          return queueDailyLogRecord(record);
        }
        if (type === 'warrantyItems' && offlineQueueEnabled && isOfflineNetworkError(error)) {
          return queueWarrantyItemRecord(record, options.cleanupFiles);
        }
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
        const nextLocalRecords = readLocal(type, scopedProjectId).filter((item) => item.id !== record.id);
        writeLocal(type, scopedProjectId, nextLocalRecords);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, type, nextLocalRecords);
        return { local: false };
      } catch (error) {
        if (type === 'dailyLogs' && offlineQueueEnabled && isOfflineNetworkError(error)) {
          return queueDailyLogDelete(record);
        }
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
        const savedRecord = normalize('portalItems', payload[0]);
        const nextLocalRecords = [
          savedRecord,
          ...readLocal('portalItems', scopedProjectId).filter((item) => item.id !== savedRecord.id),
        ];
        writeLocal('portalItems', scopedProjectId, nextLocalRecords);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, 'portalItems', nextLocalRecords);
        return { record: savedRecord, local: false };
      } catch (error) {
        if (missingTable(error)) return { record: saveLocal('portalItems', updated), local: true, setupRequired: true };
        throw error;
      }
    },

    async listCustomerWarrantyRequests() {
      if (!configured) return { records: readLocal('warrantyItems', scopedProjectId), local: true };
      try {
        const response = await fetchAuthorizedSupabase('/rest/v1/rpc/list_customer_warranty_requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_project_id: scopedProjectId }),
        }, 'Customer warranty request load');
        const payload = await responseJson(response, 'Unable to load warranty requests.');
        const records = (Array.isArray(payload) ? payload : []).map((row) => normalize('warrantyItems', row));
        writeLocal('warrantyItems', scopedProjectId, records);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, 'warrantyItems', records);
        return { records, local: false };
      } catch (error) {
        if (missingTable(error)) return { records: readLocal('warrantyItems', scopedProjectId), local: true, setupRequired: true };
        if (isOfflineNetworkError(error)) {
          const offlineRecords = await readOfflineWorkflowRecords(userId, scopedProjectId, 'warrantyItems');
          if (offlineRecords) return { records: offlineRecords, local: true, offline: true };
        }
        throw error;
      }
    },

    async submitCustomerWarrantyRequest(draft) {
      const localRecord = {
        ...draft,
        id: draft.id || createId('warranty'),
        number: draft.number || 'Pending',
        title: String(draft.title || '').trim(),
        status: 'open',
        reportedDate: new Date().toISOString().slice(0, 10),
      };
      if (!configured) return { record: saveLocal('warrantyItems', localRecord), local: true };
      try {
        const response = await fetchAuthorizedSupabase('/rest/v1/rpc/submit_customer_warranty_request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_project_id: scopedProjectId,
            p_title: localRecord.title,
            p_category: localRecord.category || 'General',
            p_priority: localRecord.priority || 'normal',
            p_description: String(localRecord.description || '').trim(),
          }),
        }, 'Customer warranty request submission');
        const payload = await responseJson(response, 'Unable to submit warranty request.');
        if (!Array.isArray(payload) || !payload[0]) throw new Error('Warranty request submission returned no record.');
        const savedRecord = normalize('warrantyItems', payload[0]);
        const nextLocalRecords = [
          savedRecord,
          ...readLocal('warrantyItems', scopedProjectId).filter((item) => item.id !== savedRecord.id),
        ];
        writeLocal('warrantyItems', scopedProjectId, nextLocalRecords);
        await refreshOfflineWorkflowCache(userId, scopedProjectId, 'warrantyItems', nextLocalRecords);
        return { record: savedRecord, local: false };
      } catch (error) {
        if (missingTable(error)) return { record: saveLocal('warrantyItems', localRecord), local: true, setupRequired: true };
        throw error;
      }
    },
  };
}
