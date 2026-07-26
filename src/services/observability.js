const EXPECTED_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 422]);
const EXPECTED_ERROR_CODES = new Set([
  'aborterror',
  'concurrency-conflict',
  'normalized_version_conflict',
  'version_conflict',
]);
const OPERATION_TOKENS = new Set([
  'application',
  'approval',
  'attachment',
  'auth',
  'bootstrap',
  'calendar',
  'closeout',
  'create',
  'delete',
  'download',
  'file',
  'folder',
  'hydrate',
  'inspection',
  'load',
  'mutation',
  'notification',
  'people',
  'person',
  'photo',
  'portal',
  'project',
  'query',
  'registration',
  'restore',
  'save',
  'schedule',
  'selection',
  'settings',
  'startup',
  'sync',
  'takeoff',
  'task',
  'update',
  'upload',
  'user',
  'visibility',
  'warranty',
]);
const ALLOWED_TAGS = new Set(['operation', 'platform', 'support_id', 'workspace']);
const DEFAULT_ERROR_MESSAGE = 'Unexpected application error.';
const DUPLICATE_WINDOW_MS = 5000;

let sentryProvider = null;
let observabilityEnabled = false;
let testSink = null;
let recentReports = new Map();
let transportDiagnostic = null;
const observedErrors = new WeakSet();

function getBuildRelease() {
  return typeof __APP_RELEASE__ !== 'undefined' ? String(__APP_RELEASE__) : 'development';
}

function getRuntimeEnvironment() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
}

function boundedText(value, fallback, maxLength = 80) {
  const normalized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

function safeTag(value, fallback) {
  return boundedText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function getErrorStatus(error) {
  return Number(error?.status || error?.cause?.status || error?.response?.status) || 0;
}

function getErrorCode(error) {
  return safeTag(error?.code || error?.name || '', '');
}

function getErrorType(error) {
  if (error instanceof Error && error.name) return boundedText(error.name, 'Error', 50);
  return 'Error';
}

function sanitizeFrameFilename(filename) {
  const value = String(filename || '').trim();
  if (!value) return value;
  try {
    const parsed = new URL(value);
    return parsed.pathname || '/application';
  } catch {
    return value
      .replace(/[?#].*$/, '')
      .replace(/^file:\/\/\/[a-z]:\/.*\/([^/]+)$/i, 'app:///$1')
      .slice(-240);
  }
}

function cleanStacktrace(stacktrace) {
  if (!stacktrace || !Array.isArray(stacktrace.frames)) return stacktrace;
  return {
    frames: stacktrace.frames.map((frame) => ({
      colno: frame?.colno,
      filename: sanitizeFrameFilename(frame?.filename),
      function: boundedText(frame?.function, '<anonymous>', 120),
      in_app: frame?.in_app,
      lineno: frame?.lineno,
    })),
  };
}

function createSupportId() {
  let randomPart = '';
  try {
    randomPart = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10) || '';
  } catch {
    randomPart = '';
  }
  if (!randomPart) randomPart = Math.random().toString(36).slice(2, 12);
  return `ERR-${randomPart.toUpperCase()}`;
}

function getRuntimePlatform() {
  try {
    if (globalThis.Capacitor?.isNativePlatform?.()) return 'android';
  } catch {
    // Fall through to the privacy-safe web label.
  }
  return 'web';
}

function pruneRecentReports(now) {
  recentReports.forEach((timestamp, key) => {
    if (now - timestamp > DUPLICATE_WINDOW_MS) recentReports.delete(key);
  });
}

async function waitForSentryClient(provider, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  do {
    const client = provider?.getClient?.();
    if (client) return client;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  return null;
}

function createTemporaryStagingTransport(environment, makeFetchTransport) {
  if (environment?.VITE_SENTRY_ENVIRONMENT !== 'staging' || typeof makeFetchTransport !== 'function') {
    return undefined;
  }
  return (options) =>
    makeFetchTransport(options, async (url, requestOptions) => {
      try {
        const response = await globalThis.fetch(url, requestOptions);
        const responseBody = await response.clone().text().catch(() => '');
        transportDiagnostic = {
          response: boundedText(responseBody, 'No response body.', 240),
          status: response.status,
        };
        return response;
      } catch {
        transportDiagnostic = { response: 'Network request failed.', status: 0 };
        throw new Error('Sentry transport request failed.');
      }
    });
}

export function normalizeObservabilityOperation(value, fallback = 'application.operation') {
  const parts = (Array.isArray(value) ? value : String(value || '').split(/[:./\s_-]+/))
    .flatMap((part) => String(part || '').toLowerCase().split(/[:./\s_-]+/))
    .filter((part) => OPERATION_TOKENS.has(part));
  const unique = parts.filter((part, index) => !index || part !== parts[index - 1]);
  return unique.slice(0, 3).join('.') || fallback;
}

export function isExpectedOperationalError(error) {
  if (!error) return true;
  if (EXPECTED_HTTP_STATUSES.has(getErrorStatus(error))) return true;
  if (EXPECTED_ERROR_CODES.has(getErrorCode(error))) return true;
  const message = String(error?.message || error || '').toLowerCase();
  return [
    /aborted/,
    /cancelled/,
    /changed elsewhere/,
    /check your connection/,
    /enter an? /,
    /is required/,
    /network connection was lost/,
    /not found/,
    /offline/,
    /permission/,
    /session expired/,
    /sign in again/,
    /timed out/,
    /version conflict/,
    /you do not have (edit )?access/,
  ].some((pattern) => pattern.test(message));
}

export function sanitizeSentryEvent(event = {}) {
  const incomingTags = event.tags || {};
  const tags = {};
  ALLOWED_TAGS.forEach((key) => {
    if (incomingTags[key]) tags[key] = safeTag(incomingTags[key], 'unknown');
  });
  tags.operation ||= 'application.unhandled';
  tags.platform ||= getRuntimePlatform();
  tags.support_id ||= createSupportId();

  const sanitized = {
    breadcrumbs: [],
    debug_meta: event.debug_meta,
    dist: event.dist,
    environment: event.environment,
    event_id: event.event_id,
    level: event.level,
    message: DEFAULT_ERROR_MESSAGE,
    platform: event.platform,
    release: event.release,
    sdk: event.sdk,
    tags,
    timestamp: event.timestamp,
  };

  if (Array.isArray(event.exception?.values)) {
    sanitized.exception = {
      values: event.exception.values.map((exception) => ({
        mechanism: exception?.mechanism
          ? {
              handled: exception.mechanism.handled,
              type: boundedText(exception.mechanism.type, 'generic', 40),
            }
          : undefined,
        stacktrace: cleanStacktrace(exception?.stacktrace),
        type: boundedText(exception?.type, 'Error', 50),
        value: DEFAULT_ERROR_MESSAGE,
      })),
    };
  }
  return sanitized;
}

export async function initializeObservability(environment = getRuntimeEnvironment()) {
  const dsn = String(environment?.VITE_SENTRY_DSN || '').trim();
  if (!/^https:\/\/[^@\s]+@[^/\s]+\/\d+$/i.test(dsn)) return false;

  try {
    const [capacitorSentry, reactSentry] = await Promise.all([
      import('@sentry/capacitor'),
      import('@sentry/react'),
    ]);
    capacitorSentry.init(
      {
        autoSessionTracking: false,
        beforeSend: sanitizeSentryEvent,
        dsn,
        enableNative: false,
        environment: safeTag(environment?.VITE_SENTRY_ENVIRONMENT, 'production'),
        integrations: (defaultIntegrations) =>
          defaultIntegrations.filter(
            (integration) => !['Breadcrumbs', 'BrowserTracing', 'ContextLines', 'Replay'].includes(integration?.name),
          ),
        maxBreadcrumbs: 0,
        normalizeDepth: 1,
        release: getBuildRelease(),
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,
        sendClientReports: false,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        transport: createTemporaryStagingTransport(environment, reactSentry.makeFetchTransport),
      },
      reactSentry.init,
    );
    const client = await waitForSentryClient(capacitorSentry);
    if (!client) return false;
    sentryProvider = capacitorSentry;
    observabilityEnabled = true;
    return true;
  } catch {
    sentryProvider = null;
    observabilityEnabled = false;
    return false;
  }
}

export function reportError(error, context = {}) {
  if (!context.force && isExpectedOperationalError(error)) return { reported: false, supportId: '' };

  const operation = normalizeObservabilityOperation(context.operation);
  const workspace = context.workspace ? safeTag(context.workspace, 'unknown') : '';
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const errorType = getErrorType(error);
  const duplicateKey = `${operation}:${errorType}:${status}:${code}`;
  const now = Date.now();

  if (error instanceof Error) {
    if (observedErrors.has(error)) return { reported: false, supportId: '' };
    observedErrors.add(error);
  }
  pruneRecentReports(now);
  if (recentReports.has(duplicateKey)) return { reported: false, supportId: '' };
  recentReports.set(duplicateKey, now);

  const supportId = createSupportId();
  const safeReport = {
    code: code || undefined,
    operation,
    platform: getRuntimePlatform(),
    status: status || undefined,
    supportId,
    type: errorType,
    workspace: workspace || undefined,
  };

  if (typeof testSink === 'function') testSink(safeReport);

  let eventId = '';
  if (observabilityEnabled && sentryProvider) {
    const capturedError = error instanceof Error ? error : new Error(DEFAULT_ERROR_MESSAGE);
    sentryProvider.withScope((scope) => {
      scope.setTag('operation', operation);
      scope.setTag('platform', safeReport.platform);
      scope.setTag('support_id', supportId);
      if (workspace) scope.setTag('workspace', workspace);
      eventId = sentryProvider.captureException(capturedError);
    });
  }
  return { eventId, reported: Boolean(eventId) || typeof testSink === 'function', supportId };
}

export async function flushObservability(timeoutMs = 5000) {
  if (!observabilityEnabled || !sentryProvider?.flush) return false;
  try {
    return await sentryProvider.flush(timeoutMs);
  } catch {
    return false;
  }
}

export function getObservabilityTransportDiagnostic() {
  return transportDiagnostic ? { ...transportDiagnostic } : null;
}

export function setObservabilityTestSink(sink) {
  testSink = typeof sink === 'function' ? sink : null;
  recentReports = new Map();
}

export function isObservabilityEnabled() {
  return observabilityEnabled;
}
