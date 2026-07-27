const DATABASE_NAME = 'project-tracker-offline';
const DATABASE_VERSION = 1;
const STORE_NAME = 'attachments';
const OPERATION_INDEX = 'operationId';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline attachment storage failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Offline attachment transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Offline attachment transaction was cancelled.'));
  });
}

async function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('This browser cannot store offline attachments.');
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.objectStoreNames.contains(STORE_NAME)
      ? request.transaction.objectStore(STORE_NAME)
      : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    if (!store.indexNames.contains(OPERATION_INDEX)) {
      store.createIndex(OPERATION_INDEX, OPERATION_INDEX, { unique: false });
    }
  };
  return requestResult(request);
}

function offlineFileRecord(operation, attachment) {
  const file = attachment?.file;
  if (!(file instanceof Blob)) throw new Error('An offline attachment is missing its file data.');
  return {
    id: String(attachment.id || '').trim(),
    operationId: String(operation.id || '').trim(),
    userId: String(operation.userId || '').trim(),
    kind: String(operation.kind || '').trim(),
    projectId: String(operation.projectId || '').trim(),
    entityId: String(operation.entityId || '').trim(),
    slot: String(attachment.slot || '').trim(),
    file,
    name: String(attachment.name || file.name || 'attachment'),
    type: String(attachment.type || file.type || 'application/octet-stream'),
    size: Number(attachment.size || file.size) || 0,
    metadata: attachment.metadata || {},
    storedAt: new Date().toISOString(),
  };
}

export async function reconcileOfflineAttachments(operation, attachments = [], keepIds = []) {
  if (!operation?.id) throw new Error('Offline attachment storage requires an operation identifier.');
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(store.index(OPERATION_INDEX).getAll(operation.id));
    const keep = new Set((keepIds || []).map(String));
    existing.forEach((record) => {
      if (!keep.has(String(record.id))) store.delete(record.id);
    });
    attachments.forEach((attachment) => {
      const record = offlineFileRecord(operation, attachment);
      if (!record.id) throw new Error('Offline attachment is missing its identifier.');
      store.put(record);
      keep.add(record.id);
    });
    await transactionComplete(transaction);
    return [...keep];
  } finally {
    database.close();
  }
}

export async function getOfflineAttachments(operationId) {
  if (!operationId) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).index(OPERATION_INDEX).getAll(operationId));
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

export async function getOfflineAttachment(attachmentId) {
  if (!attachmentId) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(attachmentId));
    await transactionComplete(transaction);
    return record || null;
  } finally {
    database.close();
  }
}

export async function removeOfflineAttachments(operationId) {
  if (!operationId || typeof indexedDB === 'undefined') return 0;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const records = await requestResult(store.index(OPERATION_INDEX).getAll(operationId));
    records.forEach((record) => store.delete(record.id));
    await transactionComplete(transaction);
    return records.length;
  } finally {
    database.close();
  }
}
