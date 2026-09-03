const STORAGE_PREFIX = 'project-tracker:offline-operations:v1';
const CHANGE_EVENT = 'project-tracker:offline-operations-change';

function storageKey(userId) {
  const scopedUserId = String(userId || '').trim();
  return scopedUserId ? `${STORAGE_PREFIX}:${scopedUserId}` : '';
}

function readStoredOperations(userId) {
  const key = storageKey(userId);
  if (!key || typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function notify(userId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId } }));
}

function writeStoredOperations(userId, operations) {
  const key = storageKey(userId);
  if (!key || typeof window === 'undefined') return;
  if (operations.length) window.localStorage.setItem(key, JSON.stringify(operations));
  else window.localStorage.removeItem(key);
  notify(userId);
}

export function createOfflineOperationId() {
  return globalThis.crypto?.randomUUID?.()
    || `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isOfflineNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return /offline|network connection was lost|network request failed|failed to fetch|load failed|timed out|unable to connect securely|unable to restore your session right now|trust anchor|certificate path/i
    .test(String(error?.message || error || ''));
}

export function getOfflineOperations(userId, filters = {}) {
  return readStoredOperations(userId)
    .filter((operation) => !filters.kind || operation.kind === filters.kind)
    .filter((operation) => !filters.projectId || operation.projectId === filters.projectId)
    .sort((left, right) => String(left.queuedAt).localeCompare(String(right.queuedAt)));
}

export function enqueueOfflineOperation(userId, operation) {
  const scopedUserId = String(userId || '').trim();
  const kind = String(operation?.kind || '').trim();
  const projectId = String(operation?.projectId || '').trim();
  const entityId = String(operation?.entityId || operation?.payload?.id || '').trim();
  if (!scopedUserId || !kind || !projectId || !entityId) {
    throw new Error('Offline operation is missing its user, project, kind, or record identifier.');
  }

  const operations = readStoredOperations(scopedUserId);
  const existingIndex = operations.findIndex((item) =>
    item.kind === kind && item.projectId === projectId && item.entityId === entityId);
  const existing = existingIndex >= 0 ? operations[existingIndex] : null;
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...operation,
    id: existing?.id || operation.id || createOfflineOperationId(),
    userId: scopedUserId,
    kind,
    projectId,
    entityId,
    queuedAt: existing?.queuedAt || now,
    updatedAt: now,
    status: 'pending',
    lastError: '',
    attempts: existing?.attempts || 0,
    expected: existing?.expected || operation.expected || {},
  };
  if (existingIndex >= 0) operations.splice(existingIndex, 1, next);
  else operations.push(next);
  writeStoredOperations(scopedUserId, operations);
  return next;
}

export function updateOfflineOperation(userId, operationId, updates) {
  const operations = readStoredOperations(userId);
  const index = operations.findIndex((operation) => operation.id === operationId);
  if (index < 0) return null;
  operations[index] = {
    ...operations[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeStoredOperations(userId, operations);
  return operations[index];
}

export function getOfflineOperation(userId, operationId) {
  return readStoredOperations(userId).find((operation) => operation.id === operationId) || null;
}

export function removeOfflineOperation(userId, operationId) {
  const operations = readStoredOperations(userId);
  const next = operations.filter((operation) => operation.id !== operationId);
  if (next.length === operations.length) return false;
  writeStoredOperations(userId, next);
  return true;
}

export function removeOfflineOperationsForEntity(userId, { kind, projectId, entityId }) {
  const operations = readStoredOperations(userId);
  const next = operations.filter((operation) => !(
    operation.kind === kind
    && operation.projectId === String(projectId || '')
    && operation.entityId === String(entityId || '')
  ));
  if (next.length === operations.length) return 0;
  writeStoredOperations(userId, next);
  return operations.length - next.length;
}

export function getOfflineOperationSummary(userId) {
  const operations = readStoredOperations(userId);
  return {
    total: operations.length,
    pending: operations.filter((operation) => operation.status === 'pending').length,
    syncing: operations.filter((operation) => operation.status === 'syncing').length,
    needsAttention: operations.filter((operation) => operation.status === 'needs-attention').length,
  };
}

export function subscribeToOfflineOperations(userId, listener) {
  if (typeof window === 'undefined') return () => {};
  const scopedUserId = String(userId || '').trim();
  const handleChange = (event) => {
    if (!event?.detail?.userId || event.detail.userId === scopedUserId) listener();
  };
  const handleStorage = (event) => {
    if (event.key === storageKey(scopedUserId)) listener();
  };
  window.addEventListener(CHANGE_EVENT, handleChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export function mergeQueuedDailyLogs(records, operations) {
  const byId = new Map((records || []).map((record) => [String(record.id), record]));
  (operations || [])
    .filter((operation) => operation.kind === 'daily-log.save')
    .forEach((operation) => {
      const serverRecord = byId.get(operation.entityId) || null;
      byId.set(operation.entityId, {
        ...(serverRecord || {}),
        ...operation.payload,
        _offlineAction: operation.action || 'save',
        _offlineDeleted: operation.action === 'delete',
        _offlineStatus: operation.status,
        _offlineQueuedAt: operation.queuedAt,
        _offlineServerRecord: serverRecord,
      });
    });
  return [...byId.values()].sort((left, right) =>
    String(right.date || '').localeCompare(String(left.date || ''))
    || String(right.updatedAt || right._offlineQueuedAt || '').localeCompare(String(left.updatedAt || left._offlineQueuedAt || '')));
}

export function applyQueuedInspectionOperations(state, operations) {
  if (!state?.projects || !Array.isArray(operations) || !operations.length) return state;
  const byProject = new Map();
  operations
    .filter((operation) => operation.kind === 'inspection.save')
    .forEach((operation) => {
      if (!byProject.has(operation.projectId)) byProject.set(operation.projectId, []);
      byProject.get(operation.projectId).push(operation);
    });
  if (!byProject.size) return state;
  return {
    ...state,
    projects: state.projects.map((project) => {
      const queued = byProject.get(String(project.id));
      if (!queued?.length) return project;
      const inspections = new Map((project.inspections || []).map((inspection) => [String(inspection.id), inspection]));
      queued.forEach((operation) => {
        const serverRecord = inspections.get(operation.entityId) || null;
        inspections.set(operation.entityId, {
          ...(serverRecord || {}),
          ...operation.payload,
          _offlineAction: operation.action || 'save',
          _offlineDeleted: operation.action === 'delete',
          _offlineStatus: operation.status,
          _offlineQueuedAt: operation.queuedAt,
          _offlineServerRecord: serverRecord,
        });
      });
      return { ...project, inspections: [...inspections.values()] };
    }),
  };
}

export function applyQueuedProjectPhotoOperations(state, operations) {
  if (!state?.projects || !Array.isArray(operations) || !operations.length) return state;
  const byProject = new Map();
  operations
    .filter((operation) => operation.kind === 'project-photo.upload')
    .forEach((operation) => {
      if (!byProject.has(operation.projectId)) byProject.set(operation.projectId, []);
      byProject.get(operation.projectId).push(operation);
    });
  if (!byProject.size) return state;
  return {
    ...state,
    projects: state.projects.map((project) => {
      const queued = byProject.get(String(project.id));
      if (!queued?.length) return project;
      const photos = new Map((project.photos || []).map((photo) => [String(photo.id), photo]));
      queued.forEach((operation) => {
        const currentRecord = photos.get(operation.entityId) || null;
        const serverRecord = currentRecord?._offlineServerRecord || currentRecord;
        photos.set(operation.entityId, {
          ...(serverRecord || {}),
          ...operation.payload,
          _offlineStatus: operation.status,
          _offlineQueuedAt: operation.queuedAt,
          _offlineOperationId: operation.id,
          _offlineServerRecord: serverRecord,
        });
      });
      return { ...project, photos: [...photos.values()] };
    }),
  };
}

export function mergeQueuedWarrantyItems(records, operations) {
  const byId = new Map((records || []).map((record) => [String(record.id), record]));
  (operations || [])
    .filter((operation) => operation.kind === 'warranty-item.save')
    .forEach((operation) => {
      const serverRecord = byId.get(operation.entityId) || null;
      byId.set(operation.entityId, {
        ...(serverRecord || {}),
        ...operation.payload,
        _offlineStatus: operation.status,
        _offlineQueuedAt: operation.queuedAt,
        _offlineServerRecord: serverRecord?._offlineServerRecord || serverRecord,
      });
    });
  return [...byId.values()].sort((left, right) =>
    String(right.updatedAt || right._offlineQueuedAt || '').localeCompare(String(left.updatedAt || left._offlineQueuedAt || '')));
}

export function applyQueuedTaskOperations(state, operations) {
  if (!state?.tasks || !Array.isArray(operations) || !operations.length) return state;
  const queued = operations.filter((operation) => operation.kind === 'task.save');
  if (!queued.length) return state;
  const tasks = new Map((state.tasks || []).map((task) => [String(task.id), task]));
  queued.forEach((operation) => {
    const serverRecord = tasks.get(operation.entityId) || null;
    tasks.set(operation.entityId, {
      ...(serverRecord || {}),
      ...operation.payload,
      _offlineAction: operation.action || 'save',
      _offlineStatus: operation.status,
      _offlineQueuedAt: operation.queuedAt,
      _offlineServerRecord: serverRecord?._offlineServerRecord || serverRecord,
    });
  });
  return { ...state, tasks: [...tasks.values()] };
}
