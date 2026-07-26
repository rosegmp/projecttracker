const REQUEST_ID_PATTERN = /^REQ-[A-F0-9]{16}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function normalizeRequestId(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : '';
}

export function getRequestId(request: Request) {
  const supplied = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER));
  if (supplied) return supplied;
  return `REQ-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

function safeToken(value: unknown, fallback: string) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function safeCode(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(normalized) ? normalized : 'internal_error';
}

export function logEdgeFailure({
  code,
  functionName,
  operation,
  requestId,
  status,
}: {
  code: unknown;
  functionName: string;
  operation: string;
  requestId: string;
  status: number;
}) {
  console.error(JSON.stringify({
    code: safeCode(code),
    event: 'edge_function_failure',
    function: safeToken(functionName, 'unknown'),
    operation: safeToken(operation, 'unknown'),
    request_id: requestId,
    status: Number(status) || 500,
  }));
}
