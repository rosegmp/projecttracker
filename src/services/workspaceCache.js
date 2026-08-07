const DATABASE_NAME = 'project-tracker-workspace-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'workspaces';

export const MAX_WORKSPACE_CACHE_BYTES = 25 * 1024 * 1024;

function cleanId(value) {
  return String(value || '').trim();
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Workspace cache storage failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Workspace cache transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Workspace cache transaction was cancelled.'));
  });
}

async function openDatabase() {
  if (typeof indexedDB === 'undefined') throw new Error('This device cannot cache the workspace.');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  return requestResult(request);
}

function cloneWorkspaceState(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'dataUrl' || key.startsWith('_offline') || key === 'workspaceCache') return undefined;
    if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
    return item;
  }));
}

export function buildWorkspaceCacheRecord({
  userId,
  state,
  manifestToken,
  savedAt = new Date().toISOString(),
} = {}) {
  const id = cleanId(userId);
  const token = cleanId(manifestToken);
  if (!id || !token || !state) {
    throw new Error('A signed-in workspace and manifest are required for caching.');
  }
  const cachedState = cloneWorkspaceState({
    ...state,
    storageMode: 'supabase',
    storageIssue: '',
    deferredDataStatus: 'ready',
  });
  const serialized = JSON.stringify(cachedState);
  const byteSize = new TextEncoder().encode(serialized).byteLength;
  if (byteSize > MAX_WORKSPACE_CACHE_BYTES) {
    throw new Error('The workspace is too large to keep in the quick-load cache.');
  }
  return {
    id,
    mode: state.portalMode ? 'portal' : 'staff',
    manifestToken: token,
    savedAt,
    byteSize,
    state: cachedState,
  };
}

export function workspaceCacheMatches(record, manifest) {
  return !!record?.manifestToken
    && Number(manifest?.schemaVersion) === 1
    && record.mode === cleanId(manifest?.mode)
    && record.manifestToken === cleanId(manifest?.token);
}

export async function readWorkspaceCache(userId) {
  const id = cleanId(userId);
  if (!id) return null;
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

export async function writeWorkspaceCache(input) {
  const record = buildWorkspaceCacheRecord(input);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await completed;
    return record;
  } finally {
    database.close();
  }
}

export async function removeWorkspaceCache(userId) {
  const id = cleanId(userId);
  if (!id) return false;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await completed;
    return true;
  } finally {
    database.close();
  }
}
