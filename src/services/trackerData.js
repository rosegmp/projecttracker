const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim();
const SUPABASE_FILES_BUCKET = (import.meta.env.VITE_SUPABASE_FILES_BUCKET || 'project-files').trim();
const AUTH_STORAGE_KEY = 'cx_auth_session';

let authSession = readAuthSessionFromStorage();

function readAuthSessionFromStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeAuthSession(session) {
  authSession = session || null;
  if (typeof window === 'undefined') return;
  if (authSession) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authSession));
  } else {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function getAuthAccessToken() {
  return authSession?.accessToken || '';
}

function buildHeaders(extraHeaders = {}) {
  const accessToken = getAuthAccessToken();
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extraHeaders,
  };
}

function getAuthEndpoint(path) {
  return `${SUPABASE_URL}/auth/v1${path}`;
}

const EMPTY_SETTINGS = {
  weekdaysOnly: false,
  holidays: [],
  showGanttTaskDueDates: true,
  showCalendarTaskDueDates: true,
  showCalendarPhases: true,
  showCalendarHebrewDates: false,
  showPageStats: true,
  inspectionSubcodes: ['FOOT-101', 'FRAME-220', 'ELEC-310'],
  peopleListColumns: ['company', 'name', 'role', 'phone', 'email', 'tags'],
  peopleListBoldColumns: ['name'],
  users: [
    {
      id: 'user-admin',
      name: 'Admin',
      email: '',
      role: 'Admin',
    },
  ],
  currentUserId: 'user-admin',
};

export const USER_ROLE_OPTIONS = ['Admin', 'Edit', 'Customer', 'Subcontractor', 'View Only'];
export const PEOPLE_TYPE_OPTIONS = ['sub', 'emp', 'supplier', 'consultant', 'customer'];

function normalizeAuthSession(payload) {
  if (!payload?.access_token || !payload?.user) return null;
  const expiresAt =
    payload.expires_at
      ? Number(payload.expires_at) * 1000
      : Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || '',
    expiresAt,
    user: {
      id: payload.user.id || '',
      email: String(payload.user.email || '').trim(),
    },
  };
}

function normalizeAuthSessionFromUrlParams(params) {
  const accessToken = params.get('access_token') || '';
  if (!accessToken) return null;
  const expiresIn = Number(params.get('expires_in')) || 0;
  return {
    accessToken,
    refreshToken: params.get('refresh_token') || '',
    expiresAt: Date.now() + Math.max(0, expiresIn) * 1000,
    user: {
      id: '',
      email: '',
    },
    type: params.get('type') || '',
  };
}

async function refreshAuthSession(session) {
  if (!isSupabaseConfigured() || !session?.refreshToken) return null;
  const response = await fetch(getAuthEndpoint('/token?grant_type=refresh_token'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) return null;
  const nextSession = normalizeAuthSession(await response.json());
  writeAuthSession(nextSession);
  return nextSession;
}

async function hydrateAuthSessionUser(session) {
  if (!isSupabaseConfigured() || !session?.accessToken) return session || null;
  const response = await fetch(getAuthEndpoint('/user'), {
    method: 'GET',
    headers: buildHeaders({
      Authorization: `Bearer ${session.accessToken}`,
    }),
  });

  if (!response.ok) return session;

  const payload = await response.json().catch(() => null);
  const email = String(payload?.email || payload?.user?.email || '').trim();
  const userId = String(payload?.id || payload?.user?.id || '').trim();
  const nextSession = {
    ...session,
    user: {
      id: userId || session?.user?.id || '',
      email: email || session?.user?.email || '',
    },
  };
  writeAuthSession(nextSession);
  return nextSession;
}

export function getStoredAuthSession() {
  return authSession;
}

export async function initializeAuthSession() {
  const session = readAuthSessionFromStorage();
  if (!session?.accessToken) {
    writeAuthSession(null);
    return null;
  }
  if (session.expiresAt && session.expiresAt - Date.now() < 60_000) {
    return refreshAuthSession(session);
  }
  writeAuthSession(session);
  if (!String(session?.user?.email || '').trim()) {
    return hydrateAuthSessionUser(session);
  }
  return session;
}

export async function signInWithPassword(email, password) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for sign-in.');
  }
  const response = await fetch(getAuthEndpoint('/token?grant_type=password'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      email: String(email || '').trim(),
      password,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || 'Sign-in failed.';
    try {
      const errorPayload = JSON.parse(text);
      message = errorPayload.error_description || errorPayload.msg || errorPayload.message || message;
    } catch {
      // Keep the raw response text.
    }
    throw new Error(message);
  }
  const session = normalizeAuthSession(text ? JSON.parse(text) : null);
  if (!session) throw new Error('Supabase returned an invalid sign-in session.');
  writeAuthSession(session);
  return session;
}

export async function sendPasswordRecoveryEmail(email, redirectTo = '') {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for password recovery.');
  }
  const trimmedEmail = String(email || '').trim();
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const response = await fetch(getAuthEndpoint(`/recover${query}`), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ email: trimmedEmail }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || 'Unable to send password email.';
    try {
      const errorPayload = JSON.parse(text);
      message = errorPayload.error_description || errorPayload.msg || errorPayload.message || message;
    } catch {
      // Keep the raw response text.
    }
    throw new Error(message);
  }
  return true;
}

export async function inviteAuthUser(email, name = '', redirectTo = '') {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for user invitations.');
  }
  const trimmedEmail = String(email || '').trim();
  if (!trimmedEmail) {
    throw new Error('Enter an email address before sending an invite.');
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-auth-user`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      email: trimmedEmail,
      name: String(name || '').trim(),
      redirectTo,
    }),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok || payload.error) {
    throw new Error(payload.error || text || 'Unable to send login invite.');
  }
  return payload;
}

export function consumeAuthSessionFromUrl() {
  if (typeof window === 'undefined') return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const session = normalizeAuthSessionFromUrlParams(hashParams) || normalizeAuthSessionFromUrlParams(queryParams);
  if (!session) return null;
  writeAuthSession(session);

  const url = new URL(window.location.href);
  ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type'].forEach((key) =>
    url.searchParams.delete(key),
  );
  url.hash = '';
  window.history.replaceState(null, '', url);
  return session;
}

export async function updateAuthPassword(password, session = authSession) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for password updates.');
  }
  if (!session?.accessToken) {
    throw new Error('Password reset session is missing or expired.');
  }
  const response = await fetch(getAuthEndpoint('/user'), {
    method: 'PUT',
    headers: buildHeaders({
      Authorization: `Bearer ${session.accessToken}`,
    }),
    body: JSON.stringify({ password }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || 'Unable to update password.';
    try {
      const errorPayload = JSON.parse(text);
      message = errorPayload.error_description || errorPayload.msg || errorPayload.message || message;
    } catch {
      // Keep the raw response text.
    }
    throw new Error(message);
  }
  const responsePayload = text ? JSON.parse(text) : null;
  const nextSession = await hydrateAuthSessionUser(session);
  if (!nextSession) return responsePayload || true;
  if (responsePayload?.email || responsePayload?.user?.email || responsePayload?.id || responsePayload?.user?.id) {
    const mergedSession = {
      ...nextSession,
      user: {
        id: String(responsePayload?.id || responsePayload?.user?.id || nextSession.user?.id || '').trim(),
        email: String(responsePayload?.email || responsePayload?.user?.email || nextSession.user?.email || '').trim(),
      },
    };
    writeAuthSession(mergedSession);
    return mergedSession;
  }
  return nextSession;
}

export async function signOutAuthSession() {
  const session = authSession;
  writeAuthSession(null);
  if (!isSupabaseConfigured() || !session?.accessToken) return;
  try {
    await fetch(getAuthEndpoint('/logout'), {
      method: 'POST',
      headers: buildHeaders({
        Authorization: `Bearer ${session.accessToken}`,
      }),
    });
  } catch {
    // Local sign-out already completed.
  }
}

const LEGACY_SAMPLE_IDS = {
  projects: ['react-sample-1', 'react-sample-2', 'p1', 'p2', 'p3'],
  tasks: ['react-task-1', 'react-task-2', 'react-task-3', 't1', 't2', 't3', 't4', 't5'],
  subs: ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6'],
  employees: ['emp1', 'emp2', 'emp3', 'emp4'],
};

export const DEFAULT_PROJECT_FILE_FOLDERS = ['Plans', 'Permits', 'Surveys', 'Selections'];

function folderIdFromName(name) {
  return `folder-${String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') || Date.now()}`;
}

function normalizeProjectFile(file, index = 0) {
  return {
    id: file?.id || `file-${Date.now()}-${index}`,
    name: String(file?.name || '').trim(),
    originalName: String(file?.originalName || file?.name || '').trim(),
    type: String(file?.type || ''),
    size: Number(file?.size) || 0,
    uploadedAt: file?.uploadedAt || new Date().toISOString(),
    storageProvider: String(file?.storageProvider || (file?.storagePath ? 'supabase' : file?.dataUrl ? 'inline' : '')),
    storageBucket: String(file?.storageBucket || SUPABASE_FILES_BUCKET || ''),
    storagePath: String(file?.storagePath || ''),
    dataUrl: String(file?.dataUrl || ''),
  };
}

function normalizeAppUser(user, index = 0) {
  const role = USER_ROLE_OPTIONS.includes(String(user?.role || '').trim())
    ? String(user.role).trim()
    : 'View Only';
  return {
    id: user?.id || `user-${Date.now()}-${index}`,
    name: String(user?.name || '').trim() || 'Unnamed user',
    email: String(user?.email || '').trim(),
    role,
  };
}

function normalizeSettings(settings) {
  const users = Array.isArray(settings?.users) && settings.users.length
    ? settings.users.map((user, index) => normalizeAppUser(user, index))
    : EMPTY_SETTINGS.users.map((user, index) => normalizeAppUser(user, index));
  const currentUserId = users.some((user) => user.id === settings?.currentUserId)
    ? settings.currentUserId
    : users[0]?.id || EMPTY_SETTINGS.currentUserId;

  return {
    ...EMPTY_SETTINGS,
    ...(settings || {}),
    holidays: Array.isArray(settings?.holidays) ? settings.holidays : EMPTY_SETTINGS.holidays,
    inspectionSubcodes: Array.isArray(settings?.inspectionSubcodes) ? settings.inspectionSubcodes : EMPTY_SETTINGS.inspectionSubcodes,
    peopleListColumns: Array.isArray(settings?.peopleListColumns) ? settings.peopleListColumns : EMPTY_SETTINGS.peopleListColumns,
    peopleListBoldColumns: Array.isArray(settings?.peopleListBoldColumns) ? settings.peopleListBoldColumns : EMPTY_SETTINGS.peopleListBoldColumns,
    users,
    currentUserId,
  };
}

function normalizePeopleType(type) {
  return PEOPLE_TYPE_OPTIONS.includes(String(type || '').trim()) ? String(type).trim() : 'emp';
}

function normalizePerson(type, person = {}) {
  return {
    ...person,
    first: String(person.first || '').trim(),
    last: String(person.last || '').trim(),
    company: String(person.company || '').trim(),
    role: String(person.role || '').trim(),
    phone: String(person.phone || '').trim(),
    email: String(person.email || '').trim(),
    license: String(person.license || '').trim(),
    notes: String(person.notes || '').trim(),
    tags: normalizeTags(person.tags),
    peopleType: type === 'sub' ? 'sub' : normalizePeopleType(person.peopleType || type),
  };
}

function stripLegacySampleData(data) {
  const projects = (data.projects || []).filter((project) => !LEGACY_SAMPLE_IDS.projects.includes(project.id));
  const visibleProjectIds = new Set(projects.map((project) => project.id));
  return {
    ...data,
    projects,
    tasks: (data.tasks || []).filter(
      (task) => !LEGACY_SAMPLE_IDS.tasks.includes(task.id) && (!task.projectId || visibleProjectIds.has(task.projectId)),
    ),
    subs: (data.subs || []).filter((person) => !LEGACY_SAMPLE_IDS.subs.includes(person.id)),
    employees: (data.employees || []).filter((person) => !LEGACY_SAMPLE_IDS.employees.includes(person.id)),
  };
}

function normalizeDependencyList(preds) {
  const source = Array.isArray(preds)
    ? preds
    : typeof preds === 'string'
      ? [{ id: preds, lag: 0 }]
      : preds && typeof preds === 'object'
        ? [preds]
        : [];

  return source
    .map((item) => (typeof item === 'string' ? { id: item, lag: 0 } : item))
    .filter((item) => item?.id)
    .map((item) => ({ id: String(item.id), lag: Number(item.lag) || 0 }));
}

function normalizeProjectInspection(inspection, index = 0) {
  return {
    id: inspection?.id || `inspection-${Date.now()}-${index}`,
    subcode: String(inspection?.subcode || '').trim(),
    inspectionType: String(inspection?.inspectionType || inspection?.name || '').trim(),
    date: String(inspection?.date || inspection?.scheduledDate || inspection?.completedDate || ''),
    status: String(inspection?.status || 'scheduled'),
    agency: String(inspection?.agency || '').trim(),
    notes: String(inspection?.notes || '').trim(),
    stickerFile: inspection?.stickerFile ? normalizeProjectFile(inspection.stickerFile, index) : null,
    reportFile: inspection?.reportFile ? normalizeProjectFile(inspection.reportFile, index + 1000) : null,
  };
}

function normalizeProjectPhase(phase, index = 0) {
  return {
    ...phase,
    id: phase?.id || `phase-${Date.now()}-${index}`,
    name: String(phase?.name || '').trim(),
    assign: String(phase?.assign || '').trim(),
    status: String(phase?.status || 'planning'),
    start: String(phase?.start || ''),
    end: String(phase?.end || ''),
    predecessors: normalizeDependencyList(phase?.predecessors),
    delays: Array.isArray(phase?.delays) ? phase.delays : [],
    steps: Array.isArray(phase?.steps)
      ? phase.steps.map((step, stepIndex) => ({
          ...step,
          id: step?.id || `step-${Date.now()}-${index}-${stepIndex}`,
          predecessors: normalizeDependencyList(step?.predecessors),
          successors: Array.isArray(step?.successors) ? step.successors.filter(Boolean) : [],
        }))
      : [],
  };
}

function normalizeProjectFolders(filesState) {
  const sourceFolders = Array.isArray(filesState?.folders)
    ? filesState.folders
    : Array.isArray(filesState)
      ? filesState
      : [];
  const folderMap = new Map();

  DEFAULT_PROJECT_FILE_FOLDERS.forEach((name) => {
    folderMap.set(name.toLowerCase(), {
      id: folderIdFromName(name),
      name,
      files: [],
    });
  });

  sourceFolders.forEach((folder, folderIndex) => {
    const name = String(folder?.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const existing = folderMap.get(key);
    folderMap.set(key, {
      id: folder?.id || existing?.id || `folder-${folderIndex}-${Date.now()}`,
      name,
      files: Array.isArray(folder?.files)
        ? folder.files.map((file, fileIndex) => normalizeProjectFile(file, fileIndex))
        : existing?.files || [],
    });
  });

  return {
    folders: Array.from(folderMap.values()),
  };
}

function normalizeProject(project) {
  return {
    ...project,
    accessUserIds: Array.isArray(project?.accessUserIds)
      ? Array.from(new Set(project.accessUserIds.map((value) => String(value || '').trim()).filter(Boolean)))
      : [],
    phases: Array.isArray(project?.phases) ? project.phases.map((phase, index) => normalizeProjectPhase(phase, index)) : [],
    files: normalizeProjectFolders(project?.files),
    photos: Array.isArray(project?.photos) ? project.photos.map((photo, index) => normalizeProjectFile(photo, index)) : [],
    inspections: Array.isArray(project?.inspections)
      ? project.inspections.map((inspection, index) => normalizeProjectInspection(inspection, index))
      : [],
  };
}

function normalizeTask(task = {}) {
  return {
    ...task,
    label: String(task?.label || '').trim(),
    projectId: String(task?.projectId || '').trim(),
    due: String(task?.due || '').trim(),
    assignee: String(task?.assignee || '').trim(),
    done: !!task?.done,
  };
}

function fromStorage(key, fallback) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isStorageQuotaError(error) {
  if (!error) return false;
  if (error?.name === 'QuotaExceededError') return true;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.code === 22 || error.code === 1014;
  }
  return String(error?.message || error).toLowerCase().includes('quota');
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (isStorageQuotaError(error)) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage cleanup failures and keep the app running.
      }
      console.warn(`Local storage quota exceeded while caching ${key}. Continuing without local cache.`, error);
      return false;
    }
    throw error;
  }
}

function getFallbackData(overrides = {}) {
  const nextData = stripLegacySampleData({
    projects: fromStorage('cx_p', []).map(normalizeProject),
    tasks: fromStorage('cx_t', []).map(normalizeTask),
    subs: fromStorage('cx_s', []).map((person) => normalizePerson('sub', person)),
    employees: fromStorage('cx_e', []).map((person) => normalizePerson('emp', person)),
    settings: normalizeSettings(fromStorage('cx_settings', EMPTY_SETTINGS)),
    settingsLoadedFromSupabase: false,
    storageMode: 'local',
    storageIssue: '',
    ...overrides,
  });
  writeStorage('cx_p', nextData.projects);
  writeStorage('cx_t', nextData.tasks);
  writeStorage('cx_s', nextData.subs);
  writeStorage('cx_e', nextData.employees);
  return nextData;
}

function isSupabaseConfigured() {
  return SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL';
}

export function isSupabaseStorageConfigured() {
  return !!(isSupabaseConfigured() && SUPABASE_FILES_BUCKET);
}

export function getSupabaseDiagnosticsInfo() {
  return {
    url: SUPABASE_URL,
    configured: isSupabaseConfigured(),
  };
}

function storageAuthHeaders(extraHeaders = {}) {
  return buildHeaders(extraHeaders);
}

function storageAnonHeaders(extraHeaders = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extraHeaders,
  };
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildProjectStoragePath(projectId, folderId, fileId, originalName) {
  const cleanName = String(originalName || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
  return ['projects', projectId, folderId, `${fileId}-${cleanName}`].join('/');
}

export async function uploadProjectFileToStorage(projectId, folderId, fileId, file) {
  if (!isSupabaseStorageConfigured()) {
    throw new Error('Supabase Storage is not configured.');
  }
  const storagePath = buildProjectStoragePath(projectId, folderId, fileId, file.name);
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_FILES_BUCKET)}/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: storageAuthHeaders({
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      }),
      body: file,
    },
  );

  if (!response.ok) {
    throw new Error(`File upload failed: ${await response.text()}`);
  }

  return {
    storageProvider: 'supabase',
    storageBucket: SUPABASE_FILES_BUCKET,
    storagePath,
  };
}

export async function downloadProjectFileFromStorage(file) {
  if (!file?.storageBucket || !file?.storagePath || !isSupabaseConfigured()) {
    throw new Error('Storage file is missing its bucket or path.');
  }
  const downloadUrl =
    `${SUPABASE_URL}/storage/v1/object/authenticated/${encodeURIComponent(file.storageBucket)}/${encodeStoragePath(file.storagePath)}`;
  const requestOptions = { method: 'GET' };
  const headerCandidates = [storageAuthHeaders()];
  if (getAuthAccessToken()) {
    headerCandidates.push(storageAnonHeaders());
  }

  let lastError = 'File download failed.';
  for (const headers of headerCandidates) {
    try {
      const response = await fetch(downloadUrl, {
        ...requestOptions,
        headers,
      });
      if (response.ok) {
        return response.blob();
      }
      lastError = `File download failed: ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'File download failed.';
    }
  }

  throw new Error(lastError);
}

export async function deleteProjectFileFromStorage(file) {
  if (!file?.storageBucket || !file?.storagePath || !isSupabaseConfigured()) return;
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(file.storageBucket)}/${encodeStoragePath(file.storagePath)}`,
    {
      method: 'DELETE',
      headers: storageAuthHeaders(),
    },
  );

  if (!response.ok) {
    throw new Error(`File delete failed: ${await response.text()}`);
  }
}

async function upsertCollection(table, items) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: buildHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(items.map((item) => ({ id: item.id, data: item }))),
  });

  if (!response.ok) {
    throw new Error(`${table} upsert failed: ${await response.text()}`);
  }
}

async function removeRemoteRow(table, id) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    throw new Error(`${table} delete failed: ${await response.text()}`);
  }
}

async function fetchSupabaseJson(path, label) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: buildHeaders(),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${label} request failed (${response.status} ${response.statusText}): ${text || 'No response body.'}`,
    );
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function persistCollection(items, storageKey, table, storageMode, deletedId = null) {
  writeStorage(storageKey, items);

  if (!isSupabaseConfigured()) {
    return 'local-unconfigured';
  }

  // If the app fell back to local mode because a remote read failed, keep writes
  // local-only until a fresh Supabase load succeeds again. This avoids overwriting
  // good remote data with stale fallback snapshots.
  if (storageMode !== 'supabase') {
    return storageMode;
  }

  try {
    if (deletedId) {
      await removeRemoteRow(table, deletedId);
    }
    await upsertCollection(table, items);
    return 'supabase';
  } catch {
    return storageMode === 'supabase' ? 'local' : storageMode;
  }
}

async function persistTasks(tasks, storageMode, deletedTaskId = null) {
  return persistCollection(tasks, 'cx_t', 'tasks', storageMode, deletedTaskId);
}

async function persistProjects(projects, storageMode, deletedProjectId = null) {
  return persistCollection(projects, 'cx_p', 'projects', storageMode, deletedProjectId);
}

async function persistSettings(settings, storageMode, canWriteRemote = false) {
  writeStorage('cx_settings', settings);

  if (!isSupabaseConfigured()) {
    return 'local-unconfigured';
  }

  // Only push settings remotely after the current session has successfully loaded
  // from Supabase. This prevents fallback/default settings from clobbering the
  // remote app_settings row after a transient read/auth failure.
  if (storageMode !== 'supabase' || !canWriteRemote) {
    return storageMode;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: 'POST',
      headers: buildHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ id: 'app_settings', data: settings }]),
    });

    if (!response.ok) {
      throw new Error(`settings upsert failed: ${await response.text()}`);
    }

    return 'supabase';
  } catch {
    return storageMode === 'supabase' ? 'local' : storageMode;
  }
}

export async function loadTrackerData() {
  if (!isSupabaseConfigured()) {
    return getFallbackData({
      storageMode: 'local-unconfigured',
      storageIssue: 'Supabase URL or key is not configured in this build.',
    });
  }

  try {
    const [projectsResponse, tasksResponse, subsResponse, employeesResponse, settingsResponse] =
      await Promise.all([
        fetchSupabaseJson('/rest/v1/projects?select=*&order=created_at.asc', 'Projects'),
        fetchSupabaseJson('/rest/v1/tasks?select=*&order=created_at.asc', 'Tasks'),
        fetchSupabaseJson('/rest/v1/subs?select=*&order=created_at.asc', 'Subcontractors'),
        fetchSupabaseJson('/rest/v1/employees?select=*&order=created_at.asc', 'Employees'),
        fetchSupabaseJson('/rest/v1/settings?id=eq.app_settings&select=*', 'Settings'),
      ]);

    if (
      !Array.isArray(projectsResponse) ||
      !Array.isArray(tasksResponse) ||
      !Array.isArray(subsResponse) ||
      !Array.isArray(employeesResponse) ||
      !Array.isArray(settingsResponse)
    ) {
      throw new Error('Supabase returned an unexpected response.');
    }

    const projects = projectsResponse.map((row) => normalizeProject(row.data || row));
    const tasks = tasksResponse.map((row) => normalizeTask(row.data || row));
    const subs = Array.isArray(subsResponse)
      ? subsResponse.map((row) => normalizePerson('sub', row.data || row))
      : [];
    const employees = Array.isArray(employeesResponse)
      ? employeesResponse.map((row) => normalizePerson('emp', row.data || row))
      : [];
    const settings =
      Array.isArray(settingsResponse) && settingsResponse.length
        ? normalizeSettings(settingsResponse[0].data || EMPTY_SETTINGS)
        : normalizeSettings(fromStorage('cx_settings', EMPTY_SETTINGS));
    const settingsLoadedFromSupabase = Array.isArray(settingsResponse) && settingsResponse.length > 0;

    return stripLegacySampleData({
      projects,
      tasks,
      subs,
      employees,
      settings,
      settingsLoadedFromSupabase,
      storageMode: 'supabase',
      storageIssue: '',
    });
  } catch (error) {
    const storageIssue =
      error instanceof Error ? error.message : 'Unknown Supabase load error.';
    console.error('Supabase load failed; falling back to local storage.', error);
    return getFallbackData({ storageIssue });
  }
}

export async function createTask(currentState, payload) {
  const task = normalizeTask({
    id: `t${Date.now()}`,
    label: payload.label.trim(),
    projectId: payload.projectId || '',
    done: false,
    due: payload.due || '',
    assignee: payload.assignee || '',
  });
  const tasks = [...currentState.tasks, task];
  const storageMode = await persistTasks(tasks, currentState.storageMode);
  return { ...currentState, tasks, storageMode };
}

export async function updateTask(currentState, taskId, updates) {
  const tasks = currentState.tasks.map((task) =>
    task.id === taskId ? normalizeTask({ ...task, ...updates }) : normalizeTask(task),
  );
  const storageMode = await persistTasks(tasks, currentState.storageMode);
  return { ...currentState, tasks, storageMode };
}

export async function deleteTask(currentState, taskId) {
  const tasks = currentState.tasks.filter((task) => task.id !== taskId);
  const storageMode = await persistTasks(tasks, currentState.storageMode, taskId);
  return { ...currentState, tasks, storageMode };
}

export async function createProject(currentState, payload) {
  const project = normalizeProject({
    id: `p${Date.now()}`,
    name: payload.name.trim(),
    desc: payload.desc?.trim() || '',
    start: payload.start || '',
    end: payload.end || '',
    budget: Number(payload.budget) || 0,
    status: payload.status || 'planning',
    manager: payload.manager?.trim() || '',
    address: payload.address?.trim() || '',
    permitNumber: payload.permitNumber?.trim() || '',
    drNumber: payload.drNumber?.trim() || '',
    block: payload.block?.trim() || '',
    lot: payload.lot?.trim() || '',
    customerName: payload.customerName?.trim() || '',
    customerPhone: payload.customerPhone?.trim() || '',
    customerEmail: payload.customerEmail?.trim() || '',
    customerAddress: payload.customerAddress?.trim() || '',
    customerNotes: payload.customerNotes?.trim() || '',
    progress: Number(payload.progress) || 0,
    accessUserIds: Array.isArray(payload.accessUserIds) ? payload.accessUserIds : [],
    phases: payload.phases || [],
    files: payload.files,
    photos: payload.photos || [],
  });
  const projects = [...currentState.projects, project];
  const storageMode = await persistProjects(projects, currentState.storageMode);
  return { ...currentState, projects, storageMode };
}

export async function updateProject(currentState, projectId, updates) {
  const projects = currentState.projects.map((project) =>
    project.id === projectId
      ? normalizeProject({
          ...project,
          ...updates,
          name: updates.name?.trim() || project.name,
          desc: updates.desc?.trim() || '',
          manager: updates.manager?.trim() || '',
          address: updates.address?.trim() || '',
          permitNumber: updates.permitNumber?.trim() || '',
          drNumber: updates.drNumber?.trim() || '',
          block: updates.block?.trim() || '',
          lot: updates.lot?.trim() || '',
          customerName: updates.customerName?.trim() || '',
          customerPhone: updates.customerPhone?.trim() || '',
          customerEmail: updates.customerEmail?.trim() || '',
          customerAddress: updates.customerAddress?.trim() || '',
          customerNotes: updates.customerNotes?.trim() || '',
          budget: Number(updates.budget) || 0,
          progress: Number(updates.progress) || 0,
        })
      : project,
  );
  const storageMode = await persistProjects(projects, currentState.storageMode);
  return { ...currentState, projects, storageMode };
}

export async function updateProjectAndTasks(currentState, projectId, projectUpdates, nextTasks) {
  const projects = currentState.projects.map((project) =>
    project.id === projectId ? normalizeProject({ ...project, ...projectUpdates }) : project,
  );
  writeStorage('cx_t', nextTasks);

  let storageMode = await persistProjects(projects, currentState.storageMode);
  if (isSupabaseConfigured()) {
    try {
      await upsertCollection('tasks', nextTasks);
    } catch {
      storageMode = storageMode === 'supabase' ? 'local' : storageMode;
    }
  }

  return { ...currentState, projects, tasks: nextTasks, storageMode };
}

export async function deleteProject(currentState, projectId) {
  const projects = currentState.projects.filter((project) => project.id !== projectId);
  const tasks = currentState.tasks.filter((task) => task.projectId !== projectId);
  writeStorage('cx_t', tasks);

  let storageMode = await persistProjects(projects, currentState.storageMode, projectId);
  if (isSupabaseConfigured()) {
    try {
      await upsertCollection('tasks', tasks);
    } catch {
      storageMode = storageMode === 'supabase' ? 'local' : storageMode;
    }
  }
  return { ...currentState, projects, tasks, storageMode };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildPerson(type, payload) {
  return normalizePerson(type, {
    id: `${type === 'sub' ? 'sub' : normalizePeopleType(type)}${Date.now()}`,
    first: payload.first?.trim() || '',
    last: payload.last?.trim() || '',
    company: payload.company?.trim() || '',
    role: payload.role?.trim() || '',
    phone: payload.phone?.trim() || '',
    email: payload.email?.trim() || '',
    license: payload.license?.trim() || '',
    notes: payload.notes?.trim() || '',
    tags: normalizeTags(payload.tags),
    peopleType: type,
  });
}

function getPeopleConfig(type) {
  return type === 'sub'
    ? { key: 'subs', table: 'subs', storageKey: 'cx_s' }
    : { key: 'employees', table: 'employees', storageKey: 'cx_e' };
}

export async function createPerson(currentState, type, payload) {
  const config = getPeopleConfig(type);
  const person = buildPerson(type, payload);
  const people = [...currentState[config.key], person];
  const storageMode = await persistCollection(
    people,
    config.storageKey,
    config.table,
    currentState.storageMode,
  );
  return { ...currentState, [config.key]: people, storageMode };
}

export async function updatePerson(currentState, type, personId, updates) {
  const config = getPeopleConfig(type);
  const people = currentState[config.key].map((person) =>
    person.id === personId
      ? {
          ...person,
          ...buildPerson(type, { ...person, ...updates }),
          id: person.id,
        }
      : person,
  );
  const storageMode = await persistCollection(
    people,
    config.storageKey,
    config.table,
    currentState.storageMode,
  );
  return { ...currentState, [config.key]: people, storageMode };
}

export async function deletePerson(currentState, type, personId) {
  const config = getPeopleConfig(type);
  const people = currentState[config.key].filter((person) => person.id !== personId);
  const storageMode = await persistCollection(
    people,
    config.storageKey,
    config.table,
    currentState.storageMode,
    personId,
  );
  return { ...currentState, [config.key]: people, storageMode };
}

export async function importPeople(currentState, type, payloads) {
  const config = getPeopleConfig(type);
  const imported = (payloads || []).map((payload, index) => ({
    ...buildPerson(type, payload),
    id: `${type === 'sub' ? 'sub' : normalizePeopleType(type)}${Date.now()}${index}`,
  }));
  const people = [...currentState[config.key], ...imported];
  const storageMode = await persistCollection(
    people,
    config.storageKey,
    config.table,
    currentState.storageMode,
  );
  return { ...currentState, [config.key]: people, storageMode };
}

export async function updateSettings(currentState, updates) {
  const persistedSettings = normalizeSettings(fromStorage('cx_settings', EMPTY_SETTINGS));
  const currentSettings = normalizeSettings(currentState.settings || EMPTY_SETTINGS);
  const baselineSettings = normalizeSettings({
    ...persistedSettings,
    ...currentSettings,
    holidays:
      Array.isArray(currentSettings.holidays) && currentSettings.holidays.length
        ? currentSettings.holidays
        : persistedSettings.holidays,
    inspectionSubcodes:
      Array.isArray(currentSettings.inspectionSubcodes) && currentSettings.inspectionSubcodes.length
        ? currentSettings.inspectionSubcodes
        : persistedSettings.inspectionSubcodes,
    peopleListColumns:
      Array.isArray(currentSettings.peopleListColumns) && currentSettings.peopleListColumns.length
        ? currentSettings.peopleListColumns
        : persistedSettings.peopleListColumns,
    peopleListBoldColumns:
      Array.isArray(currentSettings.peopleListBoldColumns) && currentSettings.peopleListBoldColumns.length
        ? currentSettings.peopleListBoldColumns
        : persistedSettings.peopleListBoldColumns,
    users:
      Array.isArray(currentSettings.users) && currentSettings.users.length
        ? currentSettings.users
        : persistedSettings.users,
    currentUserId: currentSettings.currentUserId || persistedSettings.currentUserId,
  });
  const settings = normalizeSettings({
    ...EMPTY_SETTINGS,
    ...baselineSettings,
    ...updates,
    holidays: Array.isArray(updates.holidays)
      ? updates.holidays
      : baselineSettings.holidays,
  });
  const storageMode = await persistSettings(
    settings,
    currentState.storageMode,
    currentState.settingsLoadedFromSupabase === true,
  );
  return {
    ...currentState,
    settings,
    settingsLoadedFromSupabase: currentState.settingsLoadedFromSupabase === true,
    storageMode,
  };
}

export function getStorageBannerMessage(storageMode, storageIssue = '') {
  if (storageMode === 'supabase' || storageMode === 'loading') return null;
  if (storageMode === 'local-unconfigured') {
    return {
      title: 'Supabase not configured.',
      message: storageIssue || 'The React app is currently reading browser local storage only.',
    };
  }
  return {
    title: 'Using local storage.',
    message: storageIssue
      ? `Supabase is unavailable right now. ${storageIssue}`
      : 'Supabase is unavailable right now, so this React slice is reading browser-stored data on this device.',
  };
}

export async function testSupabaseConnection() {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      message: 'Supabase URL or key is not configured in this build.',
    };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=id&limit=1`, {
      headers: buildHeaders(),
    });
    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        message: `Supabase responded with ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`,
      };
    }

    return {
      ok: true,
      message: 'Supabase responded successfully from this device.',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to fetch.',
    };
  }
}

export async function runSupabaseStartupCheck() {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      message: 'Supabase URL or key is not configured in this build.',
    };
  }

  const checks = [
    { label: 'Projects', path: '/rest/v1/projects?select=id&limit=1' },
    { label: 'Tasks', path: '/rest/v1/tasks?select=id&limit=1' },
    { label: 'Subcontractors', path: '/rest/v1/subs?select=id&limit=1' },
    { label: 'Employees', path: '/rest/v1/employees?select=id&limit=1' },
    { label: 'Settings', path: '/rest/v1/settings?id=eq.app_settings&select=id' },
  ];

  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        const data = await fetchSupabaseJson(check.path, check.label);
        if (!Array.isArray(data)) {
          return `${check.label}: invalid response`;
        }
        return `${check.label}: ok`;
      } catch (error) {
        return `${check.label}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }),
  );

  const failures = results.filter((line) => !line.endsWith(': ok'));
  return {
    ok: failures.length === 0,
    message: results.join(' | '),
  };
}

export function getProjectHealth(project) {
  const status = project.status || 'planning';
  const labels = {
    active: 'On track',
    planning: 'In planning',
    delayed: 'Needs attention',
    done: 'Completed',
  };

  return {
    label: labels[status] || 'Project',
  };
}
