import { createConstructionWorkflowService } from './constructionWorkflows.js';
import { syncQueuedProjectInspection } from './trackerData.js';
import {
  getOfflineOperations,
  isOfflineNetworkError,
  removeOfflineOperation,
  updateOfflineOperation,
} from './offlineOperations.js';

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

async function syncOperation(operation) {
  if (operation.kind === 'daily-log.save') {
    const service = createConstructionWorkflowService({
      projectId: operation.projectId,
      canEdit: true,
      offlineQueueEnabled: false,
    });
    return service.save('dailyLogs', operation.payload);
  }
  if (operation.kind === 'inspection.save') {
    return syncQueuedProjectInspection(operation);
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
      removeOfflineOperation(userId, operation.id);
      result.synced += 1;
    } catch (error) {
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
