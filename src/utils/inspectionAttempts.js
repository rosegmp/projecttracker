export const REINSPECTION_SOURCE_STATUSES = new Set(['failed', 'follow-up', 'cancelled']);

export function normalizeInspectionAttemptHistory(value, normalizeFile = (file) => file) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attempt) => attempt && typeof attempt === 'object')
    .map((attempt, index) => ({
      id: String(attempt.id || `attempt-${index + 1}`),
      date: String(attempt.date || ''),
      status: String(attempt.status || 'requested'),
      agency: String(attempt.agency || '').trim(),
      notes: String(attempt.notes || '').trim(),
      stickerFile: attempt.stickerFile ? normalizeFile(attempt.stickerFile, index) : null,
      reportFile: attempt.reportFile ? normalizeFile(attempt.reportFile, index + 1000) : null,
    }));
}

export function canAddReinspection(inspection) {
  return REINSPECTION_SOURCE_STATUSES.has(String(inspection?.status || '').trim().toLowerCase());
}

export function beginReinspectionDraft(draft) {
  if (!draft || !canAddReinspection(draft)) return draft;
  const attemptHistory = normalizeInspectionAttemptHistory(draft.attemptHistory);
  const attemptNumber = attemptHistory.length + 1;
  return {
    ...draft,
    attemptHistory: [
      ...attemptHistory,
      {
        id: `${draft.id || 'inspection'}-attempt-${attemptNumber}-${Date.now()}`,
        date: String(draft.date || ''),
        status: String(draft.status || 'requested'),
        agency: String(draft.agency || '').trim(),
        notes: String(draft.notes || '').trim(),
        stickerFile: draft.stickerFile || null,
        reportFile: draft.reportFile || null,
      },
    ],
    status: 'requested',
    date: '',
    notes: '',
    stickerFile: null,
    reportFile: null,
    stickerPendingFile: null,
    reportPendingFile: null,
    isReinspection: true,
  };
}

export function inspectionAttemptAttachments(inspection) {
  const files = [inspection?.stickerFile, inspection?.reportFile];
  normalizeInspectionAttemptHistory(inspection?.attemptHistory).forEach((attempt) => {
    files.push(attempt.stickerFile, attempt.reportFile);
  });
  const seen = new Set();
  return files.filter((file) => {
    const key = String(file?.storagePath || file?._offlineAttachmentId || file?.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
