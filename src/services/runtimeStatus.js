export const DEFAULT_RUNTIME_STATUS = Object.freeze({
  writesFrozen: false,
  message: '',
  changedAt: '',
});

const DEFAULT_MAINTENANCE_MESSAGE = 'Project Tracker is temporarily read-only while maintenance is in progress.';

export function normalizeAppRuntimeStatus(payload) {
  return {
    writesFrozen: payload?.writesFrozen === true,
    message: String(payload?.message || '').trim().slice(0, 300),
    changedAt: String(payload?.changedAt || '').trim(),
  };
}

export function maintenanceDisplayMessage(status) {
  return String(status?.message || '').trim() || DEFAULT_MAINTENANCE_MESSAGE;
}

export function isAppWriteFreezeError(error) {
  return error?.code === 'APP_WRITES_FROZEN'
    || /APP_WRITES_FROZEN|temporarily read-only while maintenance/i.test(String(error?.message || error || ''));
}

export async function throwIfAppWriteFrozen(response) {
  if (response?.ok) return response;
  const text = await response?.clone?.().text().catch(() => '') || '';
  if (!/APP_WRITES_FROZEN|temporarily read-only while maintenance/i.test(text)) return response;
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const error = new Error(
    String(payload?.details || payload?.error || '').trim().slice(0, 300)
      || DEFAULT_MAINTENANCE_MESSAGE,
  );
  error.code = 'APP_WRITES_FROZEN';
  throw error;
}
