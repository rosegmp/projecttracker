const DATABASE_NAME = 'project-tracker-offline-assets';
const DATABASE_VERSION = 1;
const STORE_NAME = 'assets';
const USER_INDEX = 'userId';
const PROJECT_INDEX = 'projectKey';

export const MAX_OFFLINE_ASSET_BYTES_PER_USER = 250 * 1024 * 1024;
export const MAX_OFFLINE_ASSET_BYTES_PER_ITEM = 50 * 1024 * 1024;
export const MAX_OFFLINE_ASSETS_PER_PROJECT_REFRESH = 200;

function cleanId(value) {
  return String(value || '').trim();
}

function projectKey(userId, projectId) {
  return `${cleanId(userId)}:${cleanId(projectId)}`;
}

function referenceKey(storageBucket, storagePath) {
  return `${cleanId(storageBucket)}:${cleanId(storagePath)}`;
}

function assetRecordId(userId, projectId, storageBucket, storagePath) {
  return `${projectKey(userId, projectId)}:${referenceKey(storageBucket, storagePath)}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline asset storage failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Offline asset transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Offline asset transaction was cancelled.'));
  });
}

async function openDatabase() {
  if (typeof indexedDB === 'undefined') throw new Error('This device cannot store files for offline use.');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.objectStoreNames.contains(STORE_NAME)
      ? request.transaction.objectStore(STORE_NAME)
      : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    if (!store.indexNames.contains(USER_INDEX)) store.createIndex(USER_INDEX, USER_INDEX, { unique: false });
    if (!store.indexNames.contains(PROJECT_INDEX)) store.createIndex(PROJECT_INDEX, PROJECT_INDEX, { unique: false });
  };
  return requestResult(request);
}

function isImageAsset(item) {
  const type = String(item?.type || item?.mimeType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(String(item?.originalName || item?.name || item?.storagePath || ''));
}

function normalizeCandidate(kinds, projectId, item, sourceName = '') {
  const storageBucket = cleanId(item?.storageBucket);
  const storagePath = cleanId(item?.storagePath);
  if (!storageBucket || !storagePath) return null;
  const categories = [...new Set(Array.isArray(kinds) ? kinds : [kinds])].filter((kind) => ['files', 'photos'].includes(kind));
  if (!categories.length) return null;
  return {
    kind: categories[0],
    kinds: categories,
    projectId: cleanId(projectId),
    assetId: cleanId(item?.id) || referenceKey(storageBucket, storagePath),
    name: String(item?.originalName || item?.name || (categories.includes('photos') ? 'Project photo' : 'Project file')),
    type: String(item?.type || item?.mimeType || 'application/octet-stream'),
    sourceName: String(sourceName || ''),
    folderName: String(sourceName || ''),
    storageBucket,
    storagePath,
    referenceKey: referenceKey(storageBucket, storagePath),
  };
}

export function getOfflineProjectAssetCandidates(project, selectedKinds = ['files', 'photos'], tasks = [], workflows = {}) {
  const selected = new Set(selectedKinds);
  const candidates = [];
  const append = (item, kinds, sourceName) => {
    const candidate = normalizeCandidate(kinds, project?.id, item, sourceName);
    if (candidate && candidate.kinds.some((kind) => selected.has(kind))) candidates.push(candidate);
  };
  (project?.files?.folders || []).forEach((folder) => {
    (folder?.files || []).forEach((file) => {
      append(file, isImageAsset(file) ? ['files', 'photos'] : ['files'], `Files · ${folder?.name || 'Folder'}`);
    });
  });
  (project?.photos || []).forEach((photo) => append(photo, ['photos'], 'Project Photos'));
  (project?.selections || []).forEach((selection) => {
    const source = `Selections · ${selection?.itemName || selection?.category || 'Selection'}`;
    (selection?.attachments || []).forEach((file) => {
      append(file, isImageAsset(file) ? ['files', 'photos'] : ['files'], source);
    });
    (selection?.photos || []).forEach((photo) => append(photo, ['photos'], source));
  });
  (project?.inspections || []).forEach((inspection) => {
    const source = `Inspections · ${inspection?.inspectionType || inspection?.subcode || 'Inspection'}`;
    [inspection?.stickerFile, inspection?.reportFile].forEach((file) => {
      if (file) append(file, isImageAsset(file) ? ['files', 'photos'] : ['files'], source);
    });
  });
  (tasks || []).filter((task) => cleanId(task?.projectId) === cleanId(project?.id)).forEach((task) => {
    const source = `Tasks · ${task?.label || 'Task'}`;
    (task?.attachments || []).forEach((file) => {
      append(file, isImageAsset(file) ? ['files', 'photos'] : ['files'], source);
    });
  });
  const workflowLabels = {
    portalItems: 'Portal',
    dailyLogs: 'Daily Logs',
    changeOrders: 'Change Orders',
    rfis: 'RFIs',
    submittals: 'Submittals',
    budgetItems: 'Budget',
    commitments: 'Commitments',
    warrantyItems: 'Warranty',
    closeoutItems: 'Closeout',
  };
  Object.entries(workflows || {}).forEach(([type, records]) => {
    (Array.isArray(records) ? records : []).forEach((record) => {
      const recordLabel = record?.number || record?.title || record?.date || 'Record';
      const source = `${workflowLabels[type] || 'Workflow'} Â· ${recordLabel}`;
      [...(record?.attachments || []), ...(record?.invoices || [])].forEach((file) => {
        append(file, isImageAsset(file) ? ['files', 'photos'] : ['files'], source);
      });
      (record?.photos || []).forEach((photo) => append(photo, ['files', 'photos'], source));
      (record?.subcontractorWork || []).forEach((entry) => {
        (entry?.photos || []).forEach((photo) => append(photo, ['files', 'photos'], source));
      });
    });
  });
  const deduplicated = new Map();
  candidates.forEach((candidate) => {
    const existing = deduplicated.get(candidate.referenceKey);
    if (!existing) {
      deduplicated.set(candidate.referenceKey, candidate);
      return;
    }
    existing.kinds = [...new Set([...existing.kinds, ...candidate.kinds])];
    existing.kind = existing.kinds[0];
  });
  return [...deduplicated.values()];
}

export function buildOfflineProjectAssetKindSignatures(project, tasks = [], workflows = {}) {
  return Object.fromEntries(['files', 'photos'].map((kind) => [
    kind,
    getOfflineProjectAssetCandidates(project, [kind], tasks, workflows)
      .map((candidate) => candidate.referenceKey)
      .sort()
      .join('|'),
  ]));
}

export function canStoreOfflineAsset({ itemBytes, currentUserBytes, replacingBytes = 0 } = {}) {
  const bytes = Math.max(0, Number(itemBytes) || 0);
  if (bytes > MAX_OFFLINE_ASSET_BYTES_PER_ITEM) return { allowed: false, reason: 'item-too-large' };
  if (Math.max(0, Number(currentUserBytes) || 0) - Math.max(0, Number(replacingBytes) || 0) + bytes
    > MAX_OFFLINE_ASSET_BYTES_PER_USER) {
    return { allowed: false, reason: 'user-limit' };
  }
  return { allowed: true, reason: '' };
}

async function listUserAssets(userId) {
  const scopedUserId = cleanId(userId);
  if (!scopedUserId) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(STORE_NAME).index(USER_INDEX).getAll(scopedUserId));
    await completed;
    return records || [];
  } finally {
    database.close();
  }
}

export async function listOfflineProjectAssets(userId, projectId) {
  const key = projectKey(userId, projectId);
  if (!cleanId(userId) || !cleanId(projectId)) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(STORE_NAME).index(PROJECT_INDEX).getAll(key));
    await completed;
    return records || [];
  } finally {
    database.close();
  }
}

async function putAsset(record) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await completed;
  } finally {
    database.close();
  }
}

async function deleteAssetIds(ids) {
  if (!ids.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionComplete(transaction);
    ids.forEach((id) => transaction.objectStore(STORE_NAME).delete(id));
    await completed;
  } finally {
    database.close();
  }
}

export function summarizeOfflineProjectAssets(records = [], selectedKinds = []) {
  const selected = new Set(selectedKinds);
  const recordKinds = (record) => record.kinds || [record.kind];
  const filesCount = records.filter((record) => recordKinds(record).includes('files')).length;
  const photosCount = records.filter((record) => recordKinds(record).includes('photos')).length;
  return {
    count: records.length,
    byteSize: records.reduce((total, record) => total + (Number(record.byteSize) || 0), 0),
    filesCount,
    photosCount,
    selectedKinds: [...selected],
  };
}

export async function cacheOfflineProjectAssets({
  userId,
  project,
  selectedKinds = [],
  tasks = [],
  workflows = {},
  downloadAsset,
  onProgress,
} = {}) {
  const scopedUserId = cleanId(userId);
  const scopedProjectId = cleanId(project?.id);
  const selected = [...new Set(selectedKinds)].filter((kind) => ['files', 'photos'].includes(kind));
  if (!scopedUserId || !scopedProjectId) throw new Error('Offline downloads require a signed-in user and project.');
  if (typeof downloadAsset !== 'function') throw new Error('Offline downloads require a file download service.');

  const allCandidates = getOfflineProjectAssetCandidates(project, selected, tasks, workflows);
  const candidates = allCandidates.slice(0, MAX_OFFLINE_ASSETS_PER_PROJECT_REFRESH);
  const allUserRecords = await listUserAssets(scopedUserId);
  const existingProjectRecords = allUserRecords.filter((record) => record.projectKey === projectKey(scopedUserId, scopedProjectId));
  const existingByReference = new Map(existingProjectRecords.map((record) => [record.referenceKey, record]));
  let currentUserBytes = allUserRecords.reduce((total, record) => total + (Number(record.byteSize) || 0), 0);
  let completed = 0;
  let downloaded = 0;
  const failures = [];

  for (const candidate of candidates) {
    const previous = existingByReference.get(candidate.referenceKey);
    try {
      const blob = await downloadAsset(candidate);
      const byteSize = Number(blob?.size) || 0;
      const policy = canStoreOfflineAsset({
        itemBytes: byteSize,
        currentUserBytes,
        replacingBytes: previous?.byteSize,
      });
      if (!policy.allowed) {
        failures.push({ candidate, reason: policy.reason });
      } else {
        const record = {
          id: assetRecordId(scopedUserId, scopedProjectId, candidate.storageBucket, candidate.storagePath),
          userId: scopedUserId,
          projectId: scopedProjectId,
          projectKey: projectKey(scopedUserId, scopedProjectId),
          ...candidate,
          byteSize,
          cachedAt: new Date().toISOString(),
          blob,
        };
        await putAsset(record);
        currentUserBytes = currentUserBytes - (Number(previous?.byteSize) || 0) + byteSize;
        existingByReference.set(candidate.referenceKey, record);
        downloaded += 1;
      }
    } catch (error) {
      failures.push({
        candidate,
        reason: error instanceof Error ? error.message : 'Download failed.',
      });
    }
    completed += 1;
    onProgress?.({ completed, total: candidates.length, currentName: candidate.name, downloaded, failed: failures.length });
  }

  const validReferences = new Set(allCandidates.map((candidate) => candidate.referenceKey));
  const staleIds = existingProjectRecords
    .filter((record) => !(record.kinds || [record.kind]).some((kind) => selected.includes(kind)) || !validReferences.has(record.referenceKey))
    .map((record) => record.id);
  const truncated = allCandidates.length > candidates.length;
  if (!failures.length && !truncated) await deleteAssetIds(staleIds);

  const finalRecords = await listOfflineProjectAssets(scopedUserId, scopedProjectId);
  const finalReferences = new Set(finalRecords.map((record) => record.referenceKey));
  const completeKinds = selected.filter((kind) => {
    const kindCandidates = allCandidates.filter((candidate) => candidate.kinds.includes(kind));
    return kindCandidates.length <= MAX_OFFLINE_ASSETS_PER_PROJECT_REFRESH
      && kindCandidates.every((candidate) => finalReferences.has(candidate.referenceKey));
  });
  const allKindSignatures = buildOfflineProjectAssetKindSignatures(project, tasks, workflows);
  return {
    ...summarizeOfflineProjectAssets(finalRecords, selected),
    completeKinds,
    attempted: candidates.length,
    downloaded,
    failed: failures.length,
    failures,
    truncated,
    kindSignatures: Object.fromEntries(selected.map((kind) => [kind, allKindSignatures[kind]])),
    staleKinds: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function getOfflineProjectAssetByReference(userId, storageBucket, storagePath) {
  const scopedUserId = cleanId(userId);
  const scopedReference = referenceKey(storageBucket, storagePath);
  if (!scopedUserId || !cleanId(storageBucket) || !cleanId(storagePath)) return null;
  const records = await listUserAssets(scopedUserId);
  return records.find((record) => record.referenceKey === scopedReference) || null;
}

export async function removeOfflineProjectAssets(userId, projectId) {
  const records = await listOfflineProjectAssets(userId, projectId);
  await deleteAssetIds(records.map((record) => record.id));
  return records.length;
}
