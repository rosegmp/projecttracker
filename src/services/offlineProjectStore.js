import { buildOfflineProjectAssetKindSignatures } from './offlineProjectAssetStore.js';

const DATABASE_NAME = 'project-tracker-offline-projects';
const DATABASE_VERSION = 1;
const STORE_NAME = 'project-snapshots';
const USER_INDEX = 'userId';
const CHANGE_EVENT = 'project-tracker:offline-projects-change';

export const OFFLINE_STRUCTURED_PROJECT_SECTIONS = ['overview', 'tasks', 'calendar', 'inspections', 'selections'];

function cleanId(value) {
  return String(value || '').trim();
}

function snapshotId(userId, projectId) {
  return `${cleanId(userId)}:${cleanId(projectId)}`;
}

function notifyOfflineProjectsChanged(userId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId: cleanId(userId) } }));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline project storage failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Offline project transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Offline project transaction was cancelled.'));
  });
}

async function openDatabase() {
  if (typeof indexedDB === 'undefined') throw new Error('This device cannot store projects for offline use.');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.objectStoreNames.contains(STORE_NAME)
      ? request.transaction.objectStore(STORE_NAME)
      : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    if (!store.indexNames.contains(USER_INDEX)) store.createIndex(USER_INDEX, USER_INDEX, { unique: false });
  };
  return requestResult(request);
}

function structuredCloneForOffline(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'dataUrl' || key.startsWith('_offline')) return undefined;
    if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
    return item;
  }));
}

export function getOfflineStructuredSectionIds(visibleTabs = []) {
  const allowed = new Set(OFFLINE_STRUCTURED_PROJECT_SECTIONS);
  return (visibleTabs || []).map((tab) => tab.id).filter((id) => allowed.has(id));
}

export function buildOfflineProjectSnapshot({
  userId,
  project,
  tasks = [],
  settings = {},
  subs = [],
  employees = [],
  workflows = {},
  workflowSections = [],
  visibleTabs = [],
  savedAt = new Date().toISOString(),
} = {}) {
  const scopedUserId = cleanId(userId);
  const projectId = cleanId(project?.id);
  if (!scopedUserId || !projectId) throw new Error('Offline project storage requires a signed-in user and project.');
  const snapshot = structuredCloneForOffline({
    project,
    tasks: (tasks || []).filter((task) => cleanId(task.projectId) === projectId),
    settings,
    subs,
    employees,
    workflows,
  });
  const serialized = JSON.stringify(snapshot);
  const visibleSectionIds = new Set((visibleTabs || []).map((tab) => cleanId(tab?.id || tab)).filter(Boolean));
  const cachedWorkflowSections = (workflowSections || []).map(cleanId).filter((id) => visibleSectionIds.has(id));
  const locallyManagedSections = visibleSectionIds.has('takeoff') ? ['takeoff'] : [];
  return {
    id: snapshotId(scopedUserId, projectId),
    userId: scopedUserId,
    projectId,
    projectName: String(project?.name || 'Project'),
    cachedSections: [...new Set([
      ...getOfflineStructuredSectionIds(visibleTabs),
      ...cachedWorkflowSections,
      ...locallyManagedSections,
    ])],
    lastSyncedAt: savedAt,
    byteSize: new TextEncoder().encode(serialized).byteLength,
    snapshot,
  };
}

export function reconcileOfflineProjectAssetState(existing, project, tasks = [], workflows = {}) {
  const currentAssetSignatures = buildOfflineProjectAssetKindSignatures(project, tasks, workflows);
  const existingAssetSections = existing?.assetSections || [];
  const staleKinds = existingAssetSections.filter(
    (kind) => existing?.assetSummary?.kindSignatures?.[kind] !== currentAssetSignatures[kind],
  );
  return {
    assetSections: existingAssetSections.filter((kind) => !staleKinds.includes(kind)),
    assetSummary: existing?.assetSummary
      ? { ...existing.assetSummary, staleKinds }
      : null,
  };
}

export async function cacheProjectForOffline(input) {
  const record = buildOfflineProjectSnapshot(input);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(store.get(record.id));
    const { assetSections, assetSummary } = reconcileOfflineProjectAssetState(
      existing,
      input?.project,
      input?.tasks || [],
      input?.workflows || {},
    );
    const nextRecord = {
      ...record,
      assetSections,
      assetSummary,
      cachedSections: [...new Set([...record.cachedSections, ...assetSections])],
    };
    store.put(nextRecord);
    await completed;
    notifyOfflineProjectsChanged(record.userId);
    return nextRecord;
  } finally {
    database.close();
  }
}

export async function setOfflineProjectAssetSummary(userId, projectId, assetSummary) {
  const existing = await getOfflineProjectRecord(userId, projectId);
  if (!existing) throw new Error('Make the project available offline before downloading files or photos.');
  const assetSections = (assetSummary?.completeKinds || []).filter((kind) => ['files', 'photos'].includes(kind));
  const structuredSections = (existing.cachedSections || []).filter((section) => !['files', 'photos'].includes(section));
  const nextRecord = {
    ...existing,
    assetSections,
    assetSummary: assetSummary || null,
    cachedSections: [...new Set([...structuredSections, ...assetSections])],
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(nextRecord);
    await completed;
    notifyOfflineProjectsChanged(userId);
    return nextRecord;
  } finally {
    database.close();
  }
}

export async function updateOfflineProjectWorkflowRecords(userId, projectId, type, records = []) {
  const existing = await getOfflineProjectRecord(userId, projectId);
  if (!existing || !cleanId(type)) return null;
  const workflows = structuredCloneForOffline({
    ...(existing.snapshot?.workflows || {}),
    [type]: Array.isArray(records) ? records : [],
  });
  const snapshot = { ...existing.snapshot, workflows };
  const serialized = JSON.stringify(snapshot);
  const { assetSections, assetSummary } = reconcileOfflineProjectAssetState(
    existing,
    snapshot.project,
    snapshot.tasks || [],
    workflows,
  );
  const structuredSections = (existing.cachedSections || []).filter((section) => !['files', 'photos'].includes(section));
  const nextRecord = {
    ...existing,
    snapshot,
    byteSize: new TextEncoder().encode(serialized).byteLength,
    assetSections,
    assetSummary,
    cachedSections: [...new Set([...structuredSections, ...assetSections])],
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(nextRecord);
    await completed;
    notifyOfflineProjectsChanged(userId);
    return nextRecord;
  } finally {
    database.close();
  }
}

export async function getOfflineProjectRecord(userId, projectId) {
  const id = snapshotId(userId, projectId);
  if (!cleanId(userId) || !cleanId(projectId)) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = transactionComplete(transaction);
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(id));
    await completed;
    return record || null;
  } finally {
    database.close();
  }
}

export async function listOfflineProjectRecords(userId) {
  const scopedUserId = cleanId(userId);
  if (!scopedUserId) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(STORE_NAME).index(USER_INDEX).getAll(scopedUserId));
    await completed;
    return (records || []).sort((left, right) => String(right.lastSyncedAt).localeCompare(String(left.lastSyncedAt)));
  } finally {
    database.close();
  }
}

export async function removeOfflineProject(userId, projectId) {
  const existing = await getOfflineProjectRecord(userId, projectId);
  if (!existing) return false;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).delete(existing.id);
    await completed;
    notifyOfflineProjectsChanged(userId);
    return true;
  } finally {
    database.close();
  }
}

export function subscribeToOfflineProjects(userId, listener) {
  if (typeof window === 'undefined') return () => {};
  const scopedUserId = cleanId(userId);
  const handleChange = (event) => {
    if (!event?.detail?.userId || event.detail.userId === scopedUserId) listener();
  };
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => window.removeEventListener(CHANGE_EVENT, handleChange);
}

export function getProjectOfflineOperationSummary(operations = [], projectId = '') {
  const projectOperations = (operations || []).filter((operation) => cleanId(operation.projectId) === cleanId(projectId));
  return {
    total: projectOperations.length,
    pending: projectOperations.filter((operation) => operation.status === 'pending').length,
    syncing: projectOperations.filter((operation) => operation.status === 'syncing').length,
    needsAttention: projectOperations.filter((operation) => operation.status === 'needs-attention').length,
  };
}

export function planOfflineProjectRefresh(records = [], visibleProjects = []) {
  const visibleIds = new Set((visibleProjects || []).map((project) => cleanId(project.id)).filter(Boolean));
  const recordIds = (records || []).map((record) => cleanId(record.projectId)).filter(Boolean);
  return {
    refreshProjectIds: recordIds.filter((projectId) => visibleIds.has(projectId)),
    removeProjectIds: recordIds.filter((projectId) => !visibleIds.has(projectId)),
  };
}

export function formatOfflineProjectSize(byteSize) {
  const bytes = Math.max(0, Number(byteSize) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function loadOfflineTrackerData(userId, projectId = '') {
  const records = await listOfflineProjectRecords(userId);
  const selected = cleanId(projectId)
    ? records.filter((record) => record.projectId === cleanId(projectId))
    : records;
  if (!selected.length) return null;
  const newest = selected[0];
  const tasks = new Map();
  selected.forEach((record) => (record.snapshot?.tasks || []).forEach((task) => tasks.set(cleanId(task.id), task)));
  return {
    projects: selected.map((record) => record.snapshot.project).filter(Boolean),
    tasks: [...tasks.values()],
    subs: newest.snapshot?.subs || [],
    employees: newest.snapshot?.employees || [],
    settings: newest.snapshot?.settings || {},
    settingsVersion: 0,
    concurrencyEnabled: true,
    settingsLoadedFromSupabase: false,
    storageMode: 'offline-cache',
    storageIssue: 'No connection. Showing the last project copies saved on this device.',
    deferredDataStatus: 'ready',
    offlineCache: {
      projectIds: selected.map((record) => record.projectId),
      lastSyncedAt: newest.lastSyncedAt,
    },
  };
}
