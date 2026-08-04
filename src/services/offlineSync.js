import { createConstructionWorkflowService } from './constructionWorkflows.js';
import {
  deleteProjectFileFromStorage,
  syncQueuedProjectInspection,
  uploadProjectFileToStorage,
} from './trackerData.js';
import {
  getOfflineOperations,
  isOfflineNetworkError,
  removeOfflineOperation,
  updateOfflineOperation,
} from './offlineOperations.js';
import {
  getOfflineAttachments,
  removeOfflineAttachments,
} from './offlineAttachmentStore.js';
import { isAppWriteFreezeError } from './runtimeStatus.js';

const activeFlushes = new Map();

function attentionMessage(error) {
  const message = String(error?.message || error || '');
  if (/changed elsewhere|version conflict|NORMALIZED_VERSION_CONFLICT|40001/i.test(message)) {
    return 'This record changed on the server. Reopen it and apply the device changes manually.';
  }
  if (/permission|not authorized|row-level security|401|403/i.test(message)) {
    return 'Your access changed before this record could sync. Ask an administrator to review it.';
  }
  return 'This record could not sync automatically. Open it while online and review the saved device copy.';
}

function browserFile(record) {
  return new File([record.file], record.name || 'attachment', {
    type: record.type || record.file?.type || 'application/octet-stream',
  });
}

async function uploadStoredAttachment(operation, record, folderId, fileId) {
  const storage = await uploadProjectFileToStorage(
    operation.projectId,
    folderId,
    fileId,
    browserFile(record),
  );
  return {
    id: fileId,
    name: record.name || '',
    originalName: record.name || 'attachment',
    type: record.type || record.file?.type || 'application/octet-stream',
    size: Number(record.size || record.file?.size) || 0,
    uploadedAt: new Date().toISOString(),
    ...storage,
  };
}

async function materializeDailyLog(operation, storedAttachments) {
  const byId = new Map(storedAttachments.map((record) => [record.id, record]));
  const entries = [];
  for (const entry of operation.payload?.subcontractorWork || []) {
    const photos = [];
    for (const photo of entry.photos || []) {
      const record = byId.get(photo?._offlineAttachmentId);
      if (!record) {
        if (photo?._offlineAttachmentId) throw new Error('A queued daily-log photo is missing from device storage.');
        photos.push(photo);
        continue;
      }
      photos.push(await uploadStoredAttachment(operation, record, 'daily-log-photos', photo.id));
    }
    entries.push({ ...entry, photos });
  }
  return { ...operation.payload, subcontractorWork: entries };
}

async function materializeInspection(operation, storedAttachments) {
  const byId = new Map(storedAttachments.map((record) => [record.id, record]));
  const payload = { ...operation.payload };
  for (const [kind, field] of [['sticker', 'stickerFile'], ['report', 'reportFile']]) {
    const placeholder = payload[field];
    if (!placeholder?._offlineAttachmentId) continue;
    const record = byId.get(placeholder._offlineAttachmentId);
    if (!record) throw new Error(`A queued inspection ${kind} file is missing from device storage.`);
    payload[field] = await uploadStoredAttachment(operation, record, `inspection-${kind}`, placeholder.id);
  }
  return payload;
}

async function syncOperation(operation) {
  const storedAttachments = operation.attachmentIds?.length
    ? await getOfflineAttachments(operation.id)
    : [];
  if (operation.kind === 'daily-log.save') {
    const service = createConstructionWorkflowService({
      projectId: operation.projectId,
      canEdit: true,
      offlineQueueEnabled: false,
    });
    return service.save('dailyLogs', await materializeDailyLog(operation, storedAttachments));
  }
  if (operation.kind === 'inspection.save') {
    return syncQueuedProjectInspection({
      ...operation,
      payload: await materializeInspection(operation, storedAttachments),
    });
  }
  throw new Error(`Unsupported offline operation: ${operation.kind}`);
}

async function runFlush(userId) {
  const operations = getOfflineOperations(userId);
  const result = { synced: 0, needsAttention: 0, remaining: operations.length };
  for (const operation of operations) {
    if (operation.status === 'needs-attention') {
      result.needsAttention += 1;
      continue;
    }
    updateOfflineOperation(userId, operation.id, {
      status: 'syncing',
      attempts: (Number(operation.attempts) || 0) + 1,
    });
    try {
      await syncOperation(operation);
      await Promise.allSettled((operation.cleanupFiles || []).map((file) => deleteProjectFileFromStorage(file)));
      await removeOfflineAttachments(operation.id);
      removeOfflineOperation(userId, operation.id);
      result.synced += 1;
    } catch (error) {
      if (isAppWriteFreezeError(error)) {
        updateOfflineOperation(userId, operation.id, {
          status: 'pending',
          lastError: '',
        });
        break;
      }
      if (isOfflineNetworkError(error)) {
        updateOfflineOperation(userId, operation.id, { status: 'pending', lastError: '' });
        break;
      }
      updateOfflineOperation(userId, operation.id, {
        status: 'needs-attention',
        lastError: attentionMessage(error),
      });
      result.needsAttention += 1;
    }
  }
  result.remaining = getOfflineOperations(userId).length;
  return result;
}

export function flushOfflineOperations(userId) {
  const scopedUserId = String(userId || '').trim();
  if (!scopedUserId || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return Promise.resolve({ synced: 0, needsAttention: 0, remaining: getOfflineOperations(scopedUserId).length });
  }
  if (activeFlushes.has(scopedUserId)) return activeFlushes.get(scopedUserId);
  const promise = runFlush(scopedUserId).finally(() => activeFlushes.delete(scopedUserId));
  activeFlushes.set(scopedUserId, promise);
  return promise;
}
