const REQUEST_ID_PATTERN = /^REQ-[A-F0-9]{16}$/;

export function normalizeRequestId(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : '';
}

export function createRequestId() {
  let randomPart = '';
  try {
    randomPart = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) || '';
  } catch {
    randomPart = '';
  }
  if (!randomPart) {
    randomPart = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
  return `REQ-${randomPart.toUpperCase()}`;
}

export function attachRequestId(error, requestId) {
  const normalized = normalizeRequestId(requestId);
  if (!normalized || !(error instanceof Error)) return error;
  try {
    error.requestId = normalized;
  } catch {
    // A frozen third-party error can still be reported without correlation.
  }
  return error;
}

export function getResponseRequestId(response, payload) {
  return normalizeRequestId(
    payload?.requestId
      || response?.headers?.get?.('x-request-id')
      || response?.headers?.get?.('X-Request-Id'),
  );
}
