import { getCurrentUrl, updateCurrentUrl } from '../platform/platformAdapter.js';
import { trackerQueryClient } from './queryClient.js';

const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (import.meta.env?.VITE_SUPABASE_KEY || '').trim();
const SUPABASE_FILES_BUCKET = (import.meta.env?.VITE_SUPABASE_FILES_BUCKET || 'project-files').trim();
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

async function fetchAuthWithTimeout(url, options = {}, label = 'Sign-in service', timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timed out. Check your connection and try again.`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
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
  const response = await fetchAuthWithTimeout(getAuthEndpoint('/token?grant_type=refresh_token'), {
    method: 'POST',
    headers: buildHeaders({
      Authorization: `Bearer ${SUPABASE_KEY}`,
    }),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  }, 'Session refresh');
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (/refresh token not found|invalid refresh token|refresh token.*(?:expired|revoked|already used)/i.test(errorText)) {
      writeAuthSession(null);
    }
    return null;
  }
  const nextSession = normalizeAuthSession(await response.json());
  writeAuthSession(nextSession);
  return nextSession;
}

async function hydrateAuthSessionUser(session) {
  if (!isSupabaseConfigured() || !session?.accessToken) return session || null;
  const response = await fetchAuthWithTimeout(getAuthEndpoint('/user'), {
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
  if (!getAuthAccessToken()) {
    throw new Error('Your sign-in session is missing. Sign in again before sending an invite.');
  }
  let response;
  try {
    response = await fetchAuthorizedSupabase('/functions/v1/create-auth-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: trimmedEmail,
        name: String(name || '').trim(),
        redirectTo,
      }),
    }, 'Login invite', 20000);
  } catch (error) {
    if (/session expired|sign in again/i.test(String(error?.message || error || ''))) {
      throw new Error('Your login session expired. Sign out, then sign in again before sending the invite.');
    }
    if (/failed to fetch|network|connection|load failed/i.test(String(error?.message || error || ''))) {
      throw new Error('Unable to reach the login invite service. Check your connection, then sign out and back in before trying again.');
    }
    throw error;
  }
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
  const currentUrl = getCurrentUrl();
  if (!currentUrl) return null;
  const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
  const queryParams = currentUrl.searchParams;
  const callbackError = hashParams.get('error_description') || queryParams.get('error_description')
    || hashParams.get('error') || queryParams.get('error');
  if (callbackError) {
    updateCurrentUrl((url) => {
      ['error', 'error_code', 'error_description', 'type'].forEach((key) => url.searchParams.delete(key));
      url.hash = '';
    }, 'Authentication callback error');
    throw new Error(String(callbackError).replaceAll('+', ' '));
  }
  const session = normalizeAuthSessionFromUrlParams(hashParams) || normalizeAuthSessionFromUrlParams(queryParams);
  if (!session) return null;
  writeAuthSession(session);

  updateCurrentUrl((url) => {
    ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type'].forEach((key) =>
      url.searchParams.delete(key),
    );
    url.hash = '';
  }, 'Session verification');
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

function normalizeAssigneeList(value, legacyValue = '') {
  const source = Array.isArray(value) ? value : value ? [value] : legacyValue ? [legacyValue] : [];
  return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeProjectPhase(phase, index = 0) {
  const phaseAssignees = normalizeAssigneeList(phase?.assignees, phase?.assign);
  return {
    ...phase,
    id: phase?.id || `phase-${Date.now()}-${index}`,
    name: String(phase?.name || '').trim(),
    assignees: phaseAssignees,
    assign: phaseAssignees[0] || '',
    status: String(phase?.status || 'planning'),
    start: String(phase?.start || ''),
    end: String(phase?.end || ''),
    predecessors: normalizeDependencyList(phase?.predecessors),
    delays: Array.isArray(phase?.delays) ? phase.delays : [],
    steps: Array.isArray(phase?.steps)
      ? phase.steps.map((step, stepIndex) => {
          const assignees = normalizeAssigneeList(step?.assignees, step?.assign);
          return {
            ...step,
            id: step?.id || `step-${Date.now()}-${index}-${stepIndex}`,
            assignees,
            assign: assignees[0] || '',
            predecessors: normalizeDependencyList(step?.predecessors),
            successors: Array.isArray(step?.successors) ? step.successors.filter(Boolean) : [],
          };
        })
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
      customerVisible: true,
      subcontractorVisible: false,
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
      customerVisible: folder?.customerVisible !== false,
      subcontractorVisible: folder?.subcontractorVisible === true,
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
    selections: Array.isArray(project?.selections)
      ? project.selections.map((selection, index) => normalizeProjectSelection(selection, index))
      : [],
    inspections: Array.isArray(project?.inspections)
      ? project.inspections.map((inspection, index) => normalizeProjectInspection(inspection, index))
      : [],
  };
}

export function hydrateSettingsWithNormalizedUsers(settings, rows) {
  if (!Array.isArray(rows)) return normalizeSettings(settings);
  const users = rows
    .map((row) => ({
      ...(row.data || {}),
      id: String(row?.id || '').trim(),
      _position: Number(row.position) || 0,
    }))
    .filter((user) => user.id)
    .sort((left, right) => left._position - right._position)
    .map(({ _position, ...user }, index) => normalizeAppUser(user, index));
  return normalizeSettings({ ...settings, users });
}

export function hydratePeopleFromNormalizedRows(rows) {
  if (!Array.isArray(rows)) return null;
  const subs = [];
  const employees = [];
  rows.forEach((row) => {
    const legacyId = String(row?.legacy_id || '').trim();
    const sourceTable = String(row?.source_table || '').trim();
    if (!legacyId || !['subs', 'employees'].includes(sourceTable)) return;
    const type = sourceTable === 'subs' ? 'sub' : normalizePeopleType(row?.people_type || row?.data?.peopleType || 'emp');
    const person = normalizePerson(type, {
      ...(row.data || {}),
      id: legacyId,
      peopleType: type,
      _personKey: String(row?.id || '').trim(),
      _version: Number(row.version) || 0,
    });
    if (sourceTable === 'subs') subs.push(person);
    else employees.push(person);
  });
  return { subs, employees };
}

function buildNormalizedVersionMaps(rows, keyForRow) {
  const maps = new Map();
  (rows || []).forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const key = keyForRow(row);
    if (!projectId || !key) return;
    if (!maps.has(projectId)) maps.set(projectId, {});
    maps.get(projectId)[key] = Number(row.version) || 0;
  });
  return maps;
}

export function hydrateProjectsWithNormalizedSchedule(projects, phaseRows, stepRows) {
  if (!Array.isArray(phaseRows) || !Array.isArray(stepRows)) return projects;

  const stepsByPhase = new Map();
  stepRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const phaseId = String(row?.phase_id || '').trim();
    const stepId = String(row?.id || '').trim();
    if (!projectId || !phaseId || !stepId) return;
    const key = `${projectId}:${phaseId}`;
    if (!stepsByPhase.has(key)) stepsByPhase.set(key, []);
    stepsByPhase.get(key).push({
      ...(row.data || {}),
      id: stepId,
      _position: Number(row.position) || 0,
    });
  });
  stepsByPhase.forEach((steps) => steps.sort((left, right) => left._position - right._position));

  const phasesByProject = new Map();
  phaseRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const phaseId = String(row?.id || '').trim();
    if (!projectId || !phaseId) return;
    if (!phasesByProject.has(projectId)) phasesByProject.set(projectId, []);
    phasesByProject.get(projectId).push({
      ...(row.data || {}),
      id: phaseId,
      steps: (stepsByPhase.get(`${projectId}:${phaseId}`) || []).map(({ _position, ...step }) => step),
      _position: Number(row.position) || 0,
    });
  });
  phasesByProject.forEach((phases) => phases.sort((left, right) => left._position - right._position));

  const phaseVersions = buildNormalizedVersionMaps(phaseRows, (row) => String(row?.id || '').trim());
  const stepVersions = buildNormalizedVersionMaps(
    stepRows,
    (row) => `${String(row?.phase_id || '').trim()}:${String(row?.id || '').trim()}`,
  );

  return (projects || []).map((project) => normalizeProject({
    ...project,
    phases: (phasesByProject.get(project.id) || []).map(({ _position, ...phase }) => phase),
    _normalizedVersions: {
      ...(project._normalizedVersions || {}),
      phases: phaseVersions.get(project.id) || {},
      steps: stepVersions.get(project.id) || {},
    },
  }));
}

export function hydrateProjectsWithNormalizedAssets(projects, folderRows, fileRows, photoRows) {
  if (!Array.isArray(folderRows) || !Array.isArray(fileRows) || !Array.isArray(photoRows)) return projects;

  const filesByFolder = new Map();
  fileRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const folderId = String(row?.folder_id || '').trim();
    const fileId = String(row?.id || '').trim();
    if (!projectId || !folderId || !fileId) return;
    const key = `${projectId}:${folderId}`;
    if (!filesByFolder.has(key)) filesByFolder.set(key, []);
    filesByFolder.get(key).push({
      ...(row.data || {}),
      id: fileId,
      _position: Number(row.position) || 0,
    });
  });
  filesByFolder.forEach((files) => files.sort((left, right) => left._position - right._position));

  const foldersByProject = new Map();
  folderRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const folderId = String(row?.id || '').trim();
    if (!projectId || !folderId) return;
    if (!foldersByProject.has(projectId)) foldersByProject.set(projectId, []);
    foldersByProject.get(projectId).push({
      ...(row.data || {}),
      id: folderId,
      files: (filesByFolder.get(`${projectId}:${folderId}`) || []).map(({ _position, ...file }) => file),
      _position: Number(row.position) || 0,
    });
  });
  foldersByProject.forEach((folders) => folders.sort((left, right) => left._position - right._position));

  const photosByProject = new Map();
  photoRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const photoId = String(row?.id || '').trim();
    if (!projectId || !photoId) return;
    if (!photosByProject.has(projectId)) photosByProject.set(projectId, []);
    photosByProject.get(projectId).push({
      ...(row.data || {}),
      id: photoId,
      _position: Number(row.position) || 0,
    });
  });
  photosByProject.forEach((photos) => photos.sort((left, right) => left._position - right._position));

  const folderVersions = buildNormalizedVersionMaps(folderRows, (row) => String(row?.id || '').trim());
  const fileVersions = buildNormalizedVersionMaps(
    fileRows,
    (row) => `${String(row?.folder_id || '').trim()}:${String(row?.id || '').trim()}`,
  );
  const photoVersions = buildNormalizedVersionMaps(photoRows, (row) => String(row?.id || '').trim());

  return (projects || []).map((project) => normalizeProject({
    ...project,
    files: {
      folders: (foldersByProject.get(project.id) || []).map(({ _position, ...folder }) => folder),
    },
    photos: (photosByProject.get(project.id) || []).map(({ _position, ...photo }) => photo),
    _normalizedVersions: {
      ...(project._normalizedVersions || {}),
      folders: folderVersions.get(project.id) || {},
      files: fileVersions.get(project.id) || {},
      photos: photoVersions.get(project.id) || {},
    },
  }));
}

export function hydrateProjectsWithNormalizedSelections(projects, selectionRows, attachmentRows, photoRows) {
  if (!Array.isArray(selectionRows) || !Array.isArray(attachmentRows) || !Array.isArray(photoRows)) return projects;

  function groupSelectionFiles(rows) {
    const grouped = new Map();
    rows.forEach((row) => {
      const projectId = String(row?.project_id || '').trim();
      const selectionId = String(row?.selection_id || '').trim();
      const fileId = String(row?.id || '').trim();
      if (!projectId || !selectionId || !fileId) return;
      const key = `${projectId}:${selectionId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({
        ...(row.data || {}),
        id: fileId,
        _position: Number(row.position) || 0,
      });
    });
    grouped.forEach((files) => files.sort((left, right) => left._position - right._position));
    return grouped;
  }

  const attachmentsBySelection = groupSelectionFiles(attachmentRows);
  const photosBySelection = groupSelectionFiles(photoRows);
  const selectionsByProject = new Map();
  selectionRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const selectionId = String(row?.id || '').trim();
    if (!projectId || !selectionId) return;
    const key = `${projectId}:${selectionId}`;
    if (!selectionsByProject.has(projectId)) selectionsByProject.set(projectId, []);
    selectionsByProject.get(projectId).push({
      ...(row.data || {}),
      id: selectionId,
      attachments: (attachmentsBySelection.get(key) || []).map(({ _position, ...file }) => file),
      photos: (photosBySelection.get(key) || []).map(({ _position, ...file }) => file),
      _position: Number(row.position) || 0,
    });
  });
  selectionsByProject.forEach((selections) => selections.sort((left, right) => left._position - right._position));

  const selectionVersions = buildNormalizedVersionMaps(selectionRows, (row) => String(row?.id || '').trim());
  const attachmentVersions = buildNormalizedVersionMaps(
    attachmentRows,
    (row) => `${String(row?.selection_id || '').trim()}:${String(row?.id || '').trim()}`,
  );
  const photoVersions = buildNormalizedVersionMaps(
    photoRows,
    (row) => `${String(row?.selection_id || '').trim()}:${String(row?.id || '').trim()}`,
  );

  return (projects || []).map((project) => normalizeProject({
    ...project,
    selections: (selectionsByProject.get(project.id) || []).map(({ _position, ...selection }) => selection),
    _normalizedVersions: {
      ...(project._normalizedVersions || {}),
      selections: selectionVersions.get(project.id) || {},
      selectionAttachments: attachmentVersions.get(project.id) || {},
      selectionPhotos: photoVersions.get(project.id) || {},
    },
  }));
}

export function hydrateProjectsWithNormalizedInspections(projects, inspectionRows, fileRows) {
  if (!Array.isArray(inspectionRows) || !Array.isArray(fileRows)) return projects;

  const filesByInspection = new Map();
  fileRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const inspectionId = String(row?.inspection_id || '').trim();
    const kind = String(row?.kind || '').trim();
    const fileId = String(row?.id || '').trim();
    if (!projectId || !inspectionId || !['sticker', 'report'].includes(kind) || !fileId) return;
    const key = `${projectId}:${inspectionId}`;
    if (!filesByInspection.has(key)) filesByInspection.set(key, {});
    filesByInspection.get(key)[kind] = { ...(row.data || {}), id: fileId };
  });

  const inspectionsByProject = new Map();
  inspectionRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const inspectionId = String(row?.id || '').trim();
    if (!projectId || !inspectionId) return;
    const files = filesByInspection.get(`${projectId}:${inspectionId}`) || {};
    if (!inspectionsByProject.has(projectId)) inspectionsByProject.set(projectId, []);
    inspectionsByProject.get(projectId).push({
      ...(row.data || {}),
      id: inspectionId,
      stickerFile: files.sticker || null,
      reportFile: files.report || null,
      _position: Number(row.position) || 0,
    });
  });
  inspectionsByProject.forEach((inspections) => inspections.sort((left, right) => left._position - right._position));

  const inspectionVersions = buildNormalizedVersionMaps(inspectionRows, (row) => String(row?.id || '').trim());
  const fileVersions = buildNormalizedVersionMaps(
    fileRows,
    (row) => `${String(row?.inspection_id || '').trim()}:${String(row?.kind || '').trim()}`,
  );

  return (projects || []).map((project) => normalizeProject({
    ...project,
    inspections: (inspectionsByProject.get(project.id) || []).map(({ _position, ...inspection }) => inspection),
    _normalizedVersions: {
      ...(project._normalizedVersions || {}),
      inspections: inspectionVersions.get(project.id) || {},
      inspectionFiles: fileVersions.get(project.id) || {},
    },
  }));
}

function normalizeProjectSelection(selection, index = 0) {
  const sourceTaskIds = Array.isArray(selection?.taskIds)
    ? selection.taskIds
    : Array.isArray(selection?.linkedTaskIds)
      ? selection.linkedTaskIds
      : [];
  return {
    id: selection?.id || `selection-${Date.now()}-${index}`,
    category: String(selection?.category || '').trim(),
    itemName: String(selection?.itemName || selection?.name || '').trim(),
    chosenOption: String(selection?.chosenOption || '').trim(),
    status: String(selection?.status || 'needs decision').trim() || 'needs decision',
    vendor: String(selection?.vendor || '').trim(),
    allowance: Number(selection?.allowance) || 0,
    actualCost: Number(selection?.actualCost) || 0,
    selectionDate: String(selection?.selectionDate || '').trim(),
    notes: String(selection?.notes || '').trim(),
    subcontractorVisible: selection?.subcontractorVisible === true,
    attachments: Array.isArray(selection?.attachments)
      ? selection.attachments.map((file, fileIndex) => normalizeProjectFile(file, index + fileIndex))
      : [],
    photos: Array.isArray(selection?.photos)
      ? selection.photos.map((file, fileIndex) => normalizeProjectFile(file, index + 500 + fileIndex))
      : [],
    taskIds: Array.from(new Set(sourceTaskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean))),
  };
}

function getTaskIdTimestamp(taskId) {
  const match = String(taskId || '').match(/^t(\d{13})$/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveTaskCreatedAt(task = {}) {
  const rawCreatedAt = String(task?.createdAt || '').trim();
  const idDate = getTaskIdTimestamp(task?.id);
  if (!rawCreatedAt) {
    return idDate ? idDate.toISOString() : '';
  }

  const createdAtDate = new Date(rawCreatedAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return idDate ? idDate.toISOString() : '';
  }

  if (!idDate) {
    return createdAtDate.toISOString();
  }

  const driftMs = Math.abs(createdAtDate.getTime() - idDate.getTime());
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return driftMs > sevenDaysMs ? idDate.toISOString() : createdAtDate.toISOString();
}

function normalizeTask(task = {}) {
  const assignees = normalizeAssigneeList(task?.assignees, task?.assignee);
  return {
    ...task,
    label: String(task?.label || '').trim(),
    projectId: String(task?.projectId || '').trim(),
    due: String(task?.due || '').trim(),
    assignees,
    assignee: assignees[0] || '',
    sourceSelectionId: String(task?.sourceSelectionId || '').trim(),
    sourceSelectionProjectId: String(task?.sourceSelectionProjectId || '').trim(),
    sourceSelectionLabel: String(task?.sourceSelectionLabel || '').trim(),
    done: !!task?.done,
    createdAt: resolveTaskCreatedAt(task),
    attachments: Array.isArray(task?.attachments)
      ? task.attachments.map((attachment, index) => normalizeProjectFile(attachment, index))
      : [],
  };
}

export function hydrateTasksWithNormalizedAttachments(tasks, attachmentRows) {
  if (!Array.isArray(attachmentRows)) return tasks;
  const attachmentsByTask = new Map();
  attachmentRows.forEach((row) => {
    const taskId = String(row?.task_id || '').trim();
    const attachmentId = String(row?.id || '').trim();
    if (!taskId || !attachmentId) return;
    if (!attachmentsByTask.has(taskId)) attachmentsByTask.set(taskId, []);
    attachmentsByTask.get(taskId).push({
      ...(row.data || {}),
      id: attachmentId,
      _position: Number(row.position) || 0,
    });
  });
  attachmentsByTask.forEach((attachments) => attachments.sort((left, right) => left._position - right._position));
  const attachmentVersions = new Map();
  attachmentRows.forEach((row) => {
    const taskId = String(row?.task_id || '').trim();
    const attachmentId = String(row?.id || '').trim();
    if (!taskId || !attachmentId) return;
    if (!attachmentVersions.has(taskId)) attachmentVersions.set(taskId, {});
    attachmentVersions.get(taskId)[attachmentId] = Number(row.version) || 0;
  });

  return (tasks || []).map((task) => normalizeTask({
    ...task,
    attachments: (attachmentsByTask.get(task.id) || []).map(({ _position, ...attachment }) => attachment),
    _normalizedVersions: {
      ...(task._normalizedVersions || {}),
      attachments: attachmentVersions.get(task.id) || {},
    },
  }));
}

function groupOrderedRelationshipValues(rows, groupKey, valueKey) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const key = groupKey(row);
    const value = valueKey(row);
    if (!key || !value) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ value, position: Number(row.position) || 0 });
  });
  grouped.forEach((values, key) => {
    grouped.set(key, values.sort((left, right) => left.position - right.position).map((item) => item.value));
  });
  return grouped;
}

export function hydrateTrackerWithNormalizedAssignments(
  projects,
  tasks,
  taskRows,
  phaseRows,
  stepRows,
  subs = [],
  employees = [],
) {
  if (!Array.isArray(taskRows) || !Array.isArray(phaseRows) || !Array.isArray(stepRows)) return { projects, tasks };
  const personLabels = new Map();
  [...(subs || []), ...(employees || [])].forEach((person) => {
    const key = String(person?._personKey || '').trim();
    const name = `${person?.first || ''} ${person?.last || ''}`.trim();
    const label = name && person?.company ? `${name} (${person.company})` : name || person?.company || '';
    if (key && label) personLabels.set(key, label);
  });
  const resolveAssignmentLabel = (row) =>
    personLabels.get(String(row?.person_key || '').trim()) || String(row?.assignee || '').trim();
  const taskAssignments = groupOrderedRelationshipValues(
    taskRows,
    (row) => String(row?.task_id || '').trim(),
    resolveAssignmentLabel,
  );
  const phaseAssignments = groupOrderedRelationshipValues(
    phaseRows,
    (row) => `${String(row?.project_id || '').trim()}:${String(row?.phase_id || '').trim()}`,
    resolveAssignmentLabel,
  );
  const stepAssignments = groupOrderedRelationshipValues(
    stepRows,
    (row) => `${String(row?.project_id || '').trim()}:${String(row?.phase_id || '').trim()}:${String(row?.step_id || '').trim()}`,
    resolveAssignmentLabel,
  );

  return {
    projects: (projects || []).map((project) => normalizeProject({
      ...project,
      phases: (project.phases || []).map((phase) => {
        const assignees = phaseAssignments.get(`${project.id}:${phase.id}`) || [];
        return {
          ...phase,
          assignees,
          assign: assignees[0] || '',
          steps: (phase.steps || []).map((step) => {
            const stepAssignees = stepAssignments.get(`${project.id}:${phase.id}:${step.id}`) || [];
            return { ...step, assignees: stepAssignees, assign: stepAssignees[0] || '' };
          }),
        };
      }),
    })),
    tasks: (tasks || []).map((task) => {
      const assignees = taskAssignments.get(task.id) || [];
      return normalizeTask({ ...task, assignees, assignee: assignees[0] || '' });
    }),
  };
}

export function hydrateProjectsWithNormalizedScheduleRelationships(projects, phaseRows, stepRows, delayRows) {
  if (!Array.isArray(phaseRows) || !Array.isArray(stepRows) || !Array.isArray(delayRows)) return projects;
  const phasePredecessors = new Map();
  phaseRows.forEach((row) => {
    const key = `${String(row?.project_id || '').trim()}:${String(row?.phase_id || '').trim()}`;
    const predecessorId = String(row?.predecessor_phase_id || '').trim();
    if (!predecessorId || key === ':') return;
    if (!phasePredecessors.has(key)) phasePredecessors.set(key, []);
    phasePredecessors.get(key).push({ id: predecessorId, lag: Number(row.lag) || 0, position: Number(row.position) || 0 });
  });
  phasePredecessors.forEach((values) => values.sort((left, right) => left.position - right.position));

  const stepPredecessors = new Map();
  stepRows.forEach((row) => {
    const key = `${String(row?.project_id || '').trim()}:${String(row?.phase_id || '').trim()}:${String(row?.step_id || '').trim()}`;
    const predecessorId = String(row?.predecessor_step_id || '').trim();
    if (!predecessorId || key === '::') return;
    if (!stepPredecessors.has(key)) stepPredecessors.set(key, []);
    stepPredecessors.get(key).push({ id: predecessorId, lag: Number(row.lag) || 0, position: Number(row.position) || 0 });
  });
  stepPredecessors.forEach((values) => values.sort((left, right) => left.position - right.position));

  const delaysByPhase = new Map();
  delayRows.forEach((row) => {
    const projectId = String(row?.project_id || '').trim();
    const phaseId = String(row?.phase_id || '').trim();
    const delayId = String(row?.id || '').trim();
    const stepId = String(row?.step_id || '').trim();
    if (!projectId || !phaseId || !delayId || !stepId) return;
    const key = `${projectId}:${phaseId}`;
    if (!delaysByPhase.has(key)) delaysByPhase.set(key, []);
    delaysByPhase.get(key).push({
      ...(row.data || {}),
      id: delayId,
      stepId,
      position: Number(row.position) || 0,
    });
  });
  delaysByPhase.forEach((values) => values.sort((left, right) => left.position - right.position));

  return (projects || []).map((project) => {
    const phaseSuccessors = new Map((project.phases || []).map((phase) => [phase.id, []]));
    const phasesWithRelationships = (project.phases || []).map((phase) => {
      const predecessors = (phasePredecessors.get(`${project.id}:${phase.id}`) || [])
        .map(({ position, ...predecessor }) => predecessor);
      predecessors.forEach((predecessor) => {
        if (!phaseSuccessors.has(predecessor.id)) phaseSuccessors.set(predecessor.id, []);
        phaseSuccessors.get(predecessor.id).push(phase.id);
      });
      const stepSuccessors = new Map((phase.steps || []).map((step) => [step.id, []]));
      const steps = (phase.steps || []).map((step) => {
        const stepPreds = (stepPredecessors.get(`${project.id}:${phase.id}:${step.id}`) || [])
          .map(({ position, ...predecessor }) => predecessor);
        stepPreds.forEach((predecessor) => {
          if (!stepSuccessors.has(predecessor.id)) stepSuccessors.set(predecessor.id, []);
          stepSuccessors.get(predecessor.id).push(step.id);
        });
        return { ...step, predecessors: stepPreds };
      }).map((step) => ({ ...step, successors: stepSuccessors.get(step.id) || [] }));
      return {
        ...phase,
        predecessors,
        delays: (delaysByPhase.get(`${project.id}:${phase.id}`) || []).map(({ position, ...delay }) => delay),
        steps,
      };
    }).map((phase) => ({ ...phase, successors: phaseSuccessors.get(phase.id) || [] }));
    return normalizeProject({ ...project, phases: phasesWithRelationships });
  });
}

export function hydrateProjectsWithNormalizedAccess(projects, accessRows) {
  if (!Array.isArray(accessRows)) return projects;
  const accessByProject = groupOrderedRelationshipValues(
    accessRows,
    (row) => String(row?.project_id || '').trim(),
    (row) => String(row?.user_id || '').trim(),
  );
  return (projects || []).map((project) => normalizeProject({
    ...project,
    accessUserIds: accessByProject.get(project.id) || [],
  }));
}

export function hydrateProjectsWithNormalizedSelectionTaskLinks(projects, linkRows) {
  if (!Array.isArray(linkRows)) return projects;
  const linksBySelection = groupOrderedRelationshipValues(
    linkRows,
    (row) => `${String(row?.project_id || '').trim()}:${String(row?.selection_id || '').trim()}`,
    (row) => String(row?.task_id || '').trim(),
  );
  return (projects || []).map((project) => normalizeProject({
    ...project,
    selections: (project.selections || []).map((selection) => ({
      ...selection,
      taskIds: linksBySelection.get(`${project.id}:${selection.id}`) || [],
    })),
  }));
}

export function hydrateTasksWithNormalizedSelectionLinks(tasks, projects, linkRows) {
  if (!Array.isArray(linkRows)) return tasks;
  const selections = new Map();
  (projects || []).forEach((project) => {
    (project.selections || []).forEach((selection) => {
      selections.set(`${project.id}:${selection.id}`, selection);
    });
  });
  const linksByTask = new Map();
  linkRows.forEach((row) => {
    const taskId = String(row?.task_id || '').trim();
    const projectId = String(row?.project_id || '').trim();
    const selectionId = String(row?.selection_id || '').trim();
    if (!taskId || !projectId || !selectionId) return;
    if (!linksByTask.has(taskId)) linksByTask.set(taskId, []);
    linksByTask.get(taskId).push({ projectId, selectionId, position: Number(row.position) || 0 });
  });
  linksByTask.forEach((links) => links.sort((left, right) => left.position - right.position));

  return (tasks || []).map((task) => {
    const link = linksByTask.get(task.id)?.[0] || null;
    if (!link) {
      return normalizeTask({
        ...task,
        sourceSelectionId: '',
        sourceSelectionProjectId: '',
        sourceSelectionLabel: '',
      });
    }
    const selection = selections.get(`${link.projectId}:${link.selectionId}`);
    return normalizeTask({
      ...task,
      sourceSelectionId: link.selectionId,
      sourceSelectionProjectId: link.projectId,
      sourceSelectionLabel: String(selection?.itemName || selection?.chosenOption || 'Selection').trim() || 'Selection',
    });
  });
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
    settingsVersion: 0,
    concurrencyEnabled: false,
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
  const accessToken = getAuthAccessToken();
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
    ...extraHeaders,
  };
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

function ensureNetworkAvailable(action = 'complete this request') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`You appear to be offline. Reconnect to the internet and try again to ${action}.`);
  }
}

async function ensureFreshAuthSession() {
  if (!authSession?.refreshToken) return authSession;
  if (!authSession?.expiresAt || authSession.expiresAt - Date.now() >= 60_000) {
    return authSession;
  }
  const nextSession = await refreshAuthSession(authSession);
  if (!nextSession?.accessToken) {
    throw new Error('Your Supabase session expired. Please sign in again.');
  }
  return nextSession;
}

function applyCurrentAuthHeader(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const nextHeaders = { ...headers };
  const currentToken = getAuthAccessToken();
  if (
    currentToken &&
    typeof nextHeaders.Authorization === 'string' &&
    nextHeaders.Authorization.startsWith('Bearer ') &&
    nextHeaders.Authorization !== `Bearer ${SUPABASE_KEY}`
  ) {
    nextHeaders.Authorization = `Bearer ${currentToken}`;
  }
  return nextHeaders;
}

async function fetchWithTimeout(url, options = {}, label = 'Request', timeoutMs = 12000) {
  ensureNetworkAvailable(label.toLowerCase());
  await ensureFreshAuthSession();
  const requestMethod = String(options?.method || 'GET').toUpperCase();
  const runFetch = async (requestOptions) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...requestOptions,
        headers: applyCurrentAuthHeader(requestOptions?.headers),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${label} timed out. Check your internet connection and try again.`);
      }
      if (error instanceof TypeError) {
        throw new Error(`${label} failed because the network connection was lost.`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const shouldRetryRead = requestMethod === 'GET' || requestMethod === 'HEAD';

  try {
    let response = await runFetch(options);
    if (response.status === 401 && authSession?.refreshToken) {
      const responseText = await response.clone().text().catch(() => '');
      if (/jwt expired|invalid jwt|expired/i.test(responseText)) {
        const nextSession = await refreshAuthSession(authSession);
        if (!nextSession?.accessToken) {
          throw new Error('Your Supabase session expired. Please sign in again.');
        }
        response = await runFetch(options);
      }
    }
    return response;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (shouldRetryRead && /timed out|network connection was lost|offline/i.test(message)) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      return runFetch(options);
    }
    throw error;
  }
}

export async function fetchAuthorizedSupabase(path, options = {}, label = 'Supabase request', timeoutMs = 12000) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }
  const url = /^https?:\/\//i.test(String(path || '')) ? path : `${SUPABASE_URL}${path}`;
  return fetchWithTimeout(url, {
    ...options,
    headers: storageAuthHeaders(options.headers || {}),
  }, label, timeoutMs);
}

function buildProjectStoragePath(projectId, folderId, fileId, originalName) {
  const cleanName = String(originalName || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
  return ['projects', projectId, folderId, `${fileId}-${cleanName}`].join('/');
}

export async function uploadProjectFileToStorage(projectId, folderId, fileId, file, options = {}) {
  if (!isSupabaseStorageConfigured()) {
    throw new Error('Supabase Storage is not configured.');
  }
  ensureNetworkAvailable('upload this file');
  const storagePath = buildProjectStoragePath(projectId, folderId, fileId, file.name);
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_FILES_BUCKET)}/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: storageAuthHeaders({
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': options.upsert === false ? 'false' : 'true',
      }),
      body: file,
    },
    'File upload',
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

async function readDownloadResponse(response, onProgress) {
  if (typeof onProgress !== 'function' || !response.body?.getReader) return response.blob();
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  onProgress(loaded, total);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}

export async function downloadProjectFileFromStorage(file, options = {}) {
  if (!file?.storageBucket || !file?.storagePath || !isSupabaseConfigured()) {
    throw new Error('Storage file is missing its bucket or path.');
  }
  ensureNetworkAvailable('download this file');
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
      const response = await fetchWithTimeout(downloadUrl, {
        ...requestOptions,
        headers,
      }, 'File download');
      if (response.ok) {
        return readDownloadResponse(response, options.onProgress);
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
  ensureNetworkAvailable('delete this file');
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(file.storageBucket)}/${encodeStoragePath(file.storagePath)}`,
    {
      method: 'DELETE',
      headers: storageAuthHeaders(),
    },
    'File delete',
  );

  if (!response.ok) {
    throw new Error(`File delete failed: ${await response.text()}`);
  }
}

async function upsertCollection(table, items) {
  return runTrackerMutation([table, 'upsert'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: buildHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(items.map((item) => ({ id: item.id, data: stripRecordMetadata(item) }))),
    }, `${table} save`);
    if (!response.ok) throw new Error(`${table} upsert failed: ${await response.text()}`);
  });
}

async function removeRemoteRow(table, id) {
  return runTrackerMutation([table, id, 'delete'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    }, `${table} delete`);
    if (!response.ok) throw new Error(`${table} delete failed: ${await response.text()}`);
  });
}

async function fetchSupabaseJson(path, label, { timeoutMs = 12000 } = {}) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}${path}`, {
    headers: buildHeaders(),
  }, label, timeoutMs);
  const text = await response.text();

  if (!response.ok) {
    const error = new Error(
      `${label} request failed (${response.status} ${response.statusText}): ${text || 'No response body.'}`,
    );
    error.status = response.status;
    throw error;
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function querySupabaseJson(key, path, label, options = {}) {
  const timeouts = options.timeouts || [12000, 18000, 22000];
  return trackerQueryClient.query({
    key: ['supabase', ...key],
    staleTime: options.staleTime ?? 15000,
    retry: options.retry ?? 2,
    retryDelay: options.retryDelay || ((attempt) => [500, 1200, 2000][attempt] || 2000),
    force: options.force === true,
    queryFn: ({ attempt }) => fetchSupabaseJson(path, label, {
      timeoutMs: timeouts[Math.min(attempt, timeouts.length - 1)],
    }),
  });
}

export function invalidateTrackerQueries() {
  trackerQueryClient.invalidateQueries(['tracker']);
  trackerQueryClient.invalidateQueries(['supabase']);
  trackerQueryClient.invalidateQueries(['audit']);
}

function runTrackerMutation(key, mutationFn, invalidate = [['tracker'], ['supabase'], ['audit']]) {
  return trackerQueryClient.mutate({ key: ['tracker', ...key], mutationFn, invalidate });
}

function stripRecordMetadata(item) {
  if (!item || typeof item !== 'object') return item;
  const { _version, _normalizedVersions, _personKey, ...data } = item;
  return data;
}

function recordsMatch(left, right) {
  return JSON.stringify(stripRecordMetadata(left)) === JSON.stringify(stripRecordMetadata(right));
}

function concurrencyConflictError() {
  const error = new Error('This record was changed by someone else. Refresh data, review the latest changes, and try again.');
  error.code = 'concurrency-conflict';
  return error;
}

const NORMALIZED_PROJECT_SECTION_KEYS = ['phases', 'files', 'photos', 'selections', 'inspections'];

export function getNormalizedProjectSectionChanges(previousProject, nextProject) {
  const sections = {};
  NORMALIZED_PROJECT_SECTION_KEYS.forEach((key) => {
    if (JSON.stringify(previousProject?.[key]) !== JSON.stringify(nextProject?.[key])) {
      sections[key] = nextProject?.[key];
    }
  });
  return sections;
}

function hasOnlyNormalizedProjectChanges(previousProject, nextProject) {
  const stripSections = (project) => {
    const {
      phases,
      files,
      photos,
      selections,
      inspections,
      _version,
      _normalizedVersions,
      ...projectFields
    } = project || {};
    return projectFields;
  };
  return JSON.stringify(stripSections(previousProject)) === JSON.stringify(stripSections(nextProject));
}

async function persistNormalizedProjectSections(previousProject, nextProject) {
  const sections = getNormalizedProjectSectionChanges(previousProject, nextProject);
  const sectionKeys = Object.keys(sections);
  if (!sectionKeys.length || !previousProject?._normalizedVersions) return null;
  const inspectionsOnly = sectionKeys.length === 1 && sectionKeys[0] === 'inspections';
  if (sectionKeys.includes('inspections') && !inspectionsOnly) return null;

  return runTrackerMutation(['project', previousProject.id, 'normalized-sections'], async () => {
    const rpcName = inspectionsOnly ? 'save_normalized_project_inspections' : 'save_normalized_project_sections';
    const body = inspectionsOnly
      ? {
          p_project_id: previousProject.id,
          p_inspections: sections.inspections,
          p_expected_versions: previousProject._normalizedVersions,
        }
      : {
          p_project_id: previousProject.id,
          p_sections: sections,
          p_expected_versions: previousProject._normalizedVersions,
        };
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    }, 'Normalized project save', 30000);
    const text = await response.text();
    if (!response.ok) {
      if (/NORMALIZED_VERSION_CONFLICT|40001/i.test(text)) throw concurrencyConflictError();
      if (response.status === 404 || /PGRST202/i.test(text)) return null;
      throw new Error(`Normalized project save failed: ${text || response.statusText}`);
    }
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('Normalized project save returned invalid JSON.');
    }
    return {
      ...nextProject,
      _version: Number(result?.version) || Number(previousProject._version) || 0,
      _normalizedVersions: {
        ...previousProject._normalizedVersions,
        ...(result?.normalizedVersions || {}),
      },
    };
  });
}

async function persistTaskWithNormalizedAttachments(previousTask, nextTask) {
  if (!nextTask) return null;
  const expectedAttachmentVersions = previousTask?._normalizedVersions?.attachments;
  if (previousTask && !expectedAttachmentVersions) return null;

  return runTrackerMutation(['task', nextTask.id, 'normalized-attachments'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/save_task_with_attachments`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        p_task_id: nextTask.id,
        p_task_data: stripRecordMetadata(nextTask),
        p_expected_version: Number(previousTask?._version) || 0,
        p_expected_attachment_versions: expectedAttachmentVersions || {},
      }),
    }, 'Task save');
    const text = await response.text();
    if (!response.ok) {
      if (/NORMALIZED_VERSION_CONFLICT|VERSION_CONFLICT|40001/i.test(text)) throw concurrencyConflictError();
      if (response.status === 404 || /PGRST202/i.test(text)) return null;
      throw new Error(`Task save failed: ${text || response.statusText}`);
    }
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('Task save returned invalid JSON.');
    }
    return normalizeTask({
      ...nextTask,
      _version: Number(result?.version) || Number(previousTask?._version) || 1,
      _normalizedVersions: {
        ...(previousTask?._normalizedVersions || {}),
        ...(result?.normalizedVersions || {}),
      },
    });
  });
}

async function applyVersionedOperations(operations) {
  if (!operations.length) return [];
  return runTrackerMutation(['batch'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/apply_tracker_batch`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ p_operations: operations }),
    }, 'Concurrent save');
    const text = await response.text();
    if (!response.ok) {
      if (/VERSION_CONFLICT|40001/i.test(text)) throw concurrencyConflictError();
      throw new Error(`Versioned save failed: ${text || response.statusText}`);
    }
    try {
      const result = text ? JSON.parse(text) : [];
      return Array.isArray(result) ? result : [];
    } catch {
      throw new Error('Versioned save returned invalid JSON.');
    }
  });
}

async function applyNormalizedProjectTaskBatch(projectUpdates, taskOperations) {
  return runTrackerMutation(['normalized-project-task-batch'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/save_normalized_project_task_batch`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        p_project_updates: projectUpdates,
        p_task_operations: taskOperations,
      }),
    }, 'Normalized project and task save');
    const text = await response.text();
    if (!response.ok) {
      if (/NORMALIZED_VERSION_CONFLICT|VERSION_CONFLICT|40001/i.test(text)) throw concurrencyConflictError();
      if (response.status === 404 || /PGRST202/i.test(text)) return null;
      throw new Error(`Normalized project and task save failed: ${text || response.statusText}`);
    }
    try {
      const result = text ? JSON.parse(text) : null;
      return result && Array.isArray(result.projectResults) && Array.isArray(result.taskResults) ? result : null;
    } catch {
      throw new Error('Normalized project and task save returned invalid JSON.');
    }
  });
}

function buildVersionedCollectionOperations(table, nextItems, previousItems) {
  const previousMap = new Map((previousItems || []).map((item) => [item.id, item]));
  const nextMap = new Map((nextItems || []).map((item) => [item.id, item]));
  const operations = [];
  (nextItems || []).forEach((item) => {
    const previous = previousMap.get(item.id);
    if (previous && recordsMatch(previous, item)) return;
    operations.push({
      table,
      id: item.id,
      data: stripRecordMetadata(item),
      expectedVersion: Number(previous?._version) || 0,
      delete: false,
    });
  });
  (previousItems || []).forEach((item) => {
    if (nextMap.has(item.id)) return;
    operations.push({ table, id: item.id, expectedVersion: Number(item?._version) || 0, delete: true });
  });
  return operations;
}

function applyReturnedVersions(table, items, results) {
  const versions = new Map(
    results.filter((result) => !result.deleted).map((result) => [`${result.table}:${result.id}`, Number(result.version) || 0]),
  );
  return (items || []).map((item) => {
    const version = versions.get(`${table}:${item.id}`);
    return version ? { ...item, _version: version } : item;
  });
}

async function persistVersionedCollection({
  table,
  nextItems,
  previousItems,
  storageMode,
  concurrencyEnabled,
  deletedId = null,
}) {
  const remoteSaveError = getRemoteSaveError(storageMode, 'save');
  if (remoteSaveError) throw remoteSaveError;
  if (!concurrencyEnabled) {
    const nextStorageMode = await persistCollection(nextItems, '', table, storageMode, deletedId);
    return { items: nextItems, storageMode: nextStorageMode };
  }

  const operations = buildVersionedCollectionOperations(table, nextItems, previousItems);
  const results = await applyVersionedOperations(operations);
  return {
    items: applyReturnedVersions(table, nextItems, results),
    storageMode: 'supabase',
  };
}

export async function addCustomerProjectPhotos(projectId, photos) {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/add_customer_project_photos`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ p_project_id: projectId, p_photos: photos }),
  }, 'Customer photo save');
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Customer photo save failed with status ${response.status}.`);
  }
  try {
    const payload = text ? JSON.parse(text) : [];
    return Array.isArray(payload) ? payload : [];
  } catch {
    throw new Error('Customer photo save returned invalid JSON.');
  }
}

async function persistVersionedProjectAndTasks(currentState, projects, tasks) {
  const remoteSaveError = getRemoteSaveError(currentState.storageMode, 'save project changes');
  if (remoteSaveError) throw remoteSaveError;
  if (!currentState.concurrencyEnabled) {
    const storageMode = await persistProjects(projects, currentState.storageMode);
    await upsertCollection('tasks', tasks);
    return { projects, tasks, storageMode };
  }
  const projectOperations = buildVersionedCollectionOperations('projects', projects, currentState.projects);
  const taskOperations = buildVersionedCollectionOperations('tasks', tasks, currentState.tasks);
  const previousProjectMap = new Map((currentState.projects || []).map((project) => [project.id, project]));
  const nextProjectMap = new Map((projects || []).map((project) => [project.id, project]));
  const normalizedProjectUpdates = [];
  let canUseNormalizedBatch = projectOperations.length > 0;
  for (const operation of projectOperations) {
    const previousProject = previousProjectMap.get(operation.id);
    const nextProject = nextProjectMap.get(operation.id);
    const sections = getNormalizedProjectSectionChanges(previousProject, nextProject);
    if (
      operation.delete
      || !previousProject
      || !nextProject
      || !previousProject._normalizedVersions
      || !hasOnlyNormalizedProjectChanges(previousProject, nextProject)
      || Object.keys(sections).length === 0
    ) {
      canUseNormalizedBatch = false;
      break;
    }
    normalizedProjectUpdates.push({
      id: operation.id,
      sections,
      expectedVersions: previousProject._normalizedVersions,
    });
  }

  if (canUseNormalizedBatch) {
    const normalizedResult = await applyNormalizedProjectTaskBatch(normalizedProjectUpdates, taskOperations);
    if (normalizedResult) {
      const projectResults = new Map(normalizedResult.projectResults.map((result) => [result.id, result]));
      return {
        projects: projects.map((project) => {
          const result = projectResults.get(project.id);
          const previousProject = previousProjectMap.get(project.id);
          if (!result) return project;
          return {
            ...project,
            _version: Number(result.version) || Number(previousProject?._version) || 0,
            _normalizedVersions: {
              ...(previousProject?._normalizedVersions || {}),
              ...(result.normalizedVersions || {}),
            },
          };
        }),
        tasks: applyReturnedVersions('tasks', tasks, normalizedResult.taskResults),
        storageMode: 'supabase',
      };
    }
  }

  const operations = [...projectOperations, ...taskOperations];
  const results = await applyVersionedOperations(operations);
  return {
    projects: applyReturnedVersions('projects', projects, results),
    tasks: applyReturnedVersions('tasks', tasks, results),
    storageMode: 'supabase',
  };
}

async function loadSupabaseSettingsWithRetry() {
  const response = await querySupabaseJson(
    ['settings'],
    '/rest/v1/settings?id=eq.app_settings&select=*',
    'Settings',
    { retryDelay: (attempt) => [900, 1800, 2500][attempt] || 2500 },
  );
  return Array.isArray(response) ? response : null;
}

async function loadNormalizedAppUsers() {
  try {
    const rows = await querySupabaseJson(
      ['app-users'],
      '/rest/v1/app_users?select=id,position,data,version&order=position.asc',
      'Application users',
      { retry: 0 },
    );
    return Array.isArray(rows) ? rows : null;
  } catch (error) {
    console.warn('Normalized application users are not available yet; using settings JSON users.', error);
    return null;
  }
}

async function loadNormalizedProjectSchedule() {
  try {
    const [phases, steps] = await Promise.all([
      querySupabaseJson(
        ['project-phases'],
        '/rest/v1/project_phases?select=project_id,id,position,data,version&order=project_id.asc,position.asc',
        'Project phases',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-steps'],
        '/rest/v1/project_steps?select=project_id,phase_id,id,position,data,version&order=project_id.asc,phase_id.asc,position.asc',
        'Project steps',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(phases) || !Array.isArray(steps)) return null;
    return { phases, steps };
  } catch (error) {
    console.warn('Normalized schedule tables are not available yet; using project JSON schedule data.', error);
    return null;
  }
}

async function loadNormalizedProjectAssets() {
  try {
    const [folders, files, photos] = await Promise.all([
      querySupabaseJson(
        ['project-file-folders'],
        '/rest/v1/project_file_folders?select=project_id,id,position,data,version&order=project_id.asc,position.asc',
        'Project file folders',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-files'],
        '/rest/v1/project_files?select=project_id,folder_id,id,position,data,version&order=project_id.asc,folder_id.asc,position.asc',
        'Project files',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-photos'],
        '/rest/v1/project_photos?select=project_id,id,position,data,version&order=project_id.asc,position.asc',
        'Project photos',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(folders) || !Array.isArray(files) || !Array.isArray(photos)) return null;
    return { folders, files, photos };
  } catch (error) {
    console.warn('Normalized project asset tables are not available yet; using project JSON file and photo data.', error);
    return null;
  }
}

async function loadNormalizedProjectSelections() {
  try {
    const [selections, attachments, photos] = await Promise.all([
      querySupabaseJson(
        ['project-selections'],
        '/rest/v1/project_selections?select=project_id,id,position,data,version&order=project_id.asc,position.asc',
        'Project selections',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-selection-attachments'],
        '/rest/v1/project_selection_attachments?select=project_id,selection_id,id,position,data,version&order=project_id.asc,selection_id.asc,position.asc',
        'Selection attachments',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-selection-photos'],
        '/rest/v1/project_selection_photos?select=project_id,selection_id,id,position,data,version&order=project_id.asc,selection_id.asc,position.asc',
        'Selection photos',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(selections) || !Array.isArray(attachments) || !Array.isArray(photos)) return null;
    return { selections, attachments, photos };
  } catch (error) {
    console.warn('Normalized selection tables are not available yet; using project JSON selection data.', error);
    return null;
  }
}

async function loadNormalizedProjectInspections() {
  try {
    const [inspections, files] = await Promise.all([
      querySupabaseJson(
        ['project-inspections'],
        '/rest/v1/project_inspections?select=project_id,id,position,data,version&order=project_id.asc,position.asc',
        'Project inspections',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-inspection-files'],
        '/rest/v1/project_inspection_files?select=project_id,inspection_id,kind,id,data,version&order=project_id.asc,inspection_id.asc,kind.asc',
        'Inspection files',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(inspections) || !Array.isArray(files)) return null;
    return { inspections, files };
  } catch (error) {
    console.warn('Normalized inspection tables are not available yet; using project JSON inspection data.', error);
    return null;
  }
}

async function loadNormalizedTaskAttachments() {
  try {
    const attachments = await querySupabaseJson(
      ['task-attachments'],
      '/rest/v1/task_attachments?select=task_id,id,position,data,version&order=task_id.asc,position.asc',
      'Task attachments',
      { retry: 0 },
    );
    return Array.isArray(attachments) ? attachments : null;
  } catch (error) {
    console.warn('Normalized task attachment table is not available yet; using task JSON attachment data.', error);
    return null;
  }
}

async function loadNormalizedAssignments() {
  try {
    const [tasks, phases, steps] = await Promise.all([
      querySupabaseJson(
        ['task-assignments'],
        '/rest/v1/task_assignments?select=task_id,assignee,position,person_key&order=task_id.asc,position.asc',
        'Task assignments',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-phase-assignments'],
        '/rest/v1/project_phase_assignments?select=project_id,phase_id,assignee,position,person_key&order=project_id.asc,phase_id.asc,position.asc',
        'Phase assignments',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-step-assignments'],
        '/rest/v1/project_step_assignments?select=project_id,phase_id,step_id,assignee,position,person_key&order=project_id.asc,phase_id.asc,step_id.asc,position.asc',
        'Step assignments',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(tasks) || !Array.isArray(phases) || !Array.isArray(steps)) return null;
    return { tasks, phases, steps };
  } catch (error) {
    console.warn('Normalized assignment tables are not available yet; using embedded assignee data.', error);
    return null;
  }
}

async function loadNormalizedScheduleRelationships() {
  try {
    const [phases, steps, delays] = await Promise.all([
      querySupabaseJson(
        ['project-phase-dependencies'],
        '/rest/v1/project_phase_dependencies?select=project_id,phase_id,predecessor_phase_id,position,lag&order=project_id.asc,phase_id.asc,position.asc',
        'Phase dependencies',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-step-dependencies'],
        '/rest/v1/project_step_dependencies?select=project_id,phase_id,step_id,predecessor_step_id,position,lag&order=project_id.asc,phase_id.asc,step_id.asc,position.asc',
        'Step dependencies',
        { retry: 0 },
      ),
      querySupabaseJson(
        ['project-schedule-delays'],
        '/rest/v1/project_schedule_delays?select=project_id,phase_id,id,step_id,position,data,version&order=project_id.asc,phase_id.asc,position.asc',
        'Schedule delays',
        { retry: 0 },
      ),
    ]);
    if (!Array.isArray(phases) || !Array.isArray(steps) || !Array.isArray(delays)) return null;
    return { phases, steps, delays };
  } catch (error) {
    console.warn('Normalized schedule relationship tables are not available yet; using embedded dependency and delay data.', error);
    return null;
  }
}

async function loadPeopleReadModel() {
  try {
    const rows = await querySupabaseJson(
      ['people'],
      '/rest/v1/people?select=id,source_table,legacy_id,people_type,data,version,created_at&order=source_table.asc,created_at.asc',
      'People',
      { retry: 0 },
    );
    if (Array.isArray(rows)) {
      const collections = hydratePeopleFromNormalizedRows(rows);
      if (collections) return { ...collections, versionRows: rows, normalized: true };
    }
  } catch (error) {
    console.warn('Unified People table is not available yet; using legacy People tables.', error);
  }
  const [subsRows, employeeRows] = await Promise.all([
    querySupabaseJson(['subs'], '/rest/v1/subs?select=*&order=created_at.asc', 'Subcontractors'),
    querySupabaseJson(['employees'], '/rest/v1/employees?select=*&order=created_at.asc', 'Employees'),
  ]);
  if (!Array.isArray(subsRows) || !Array.isArray(employeeRows)) {
    throw new Error('Supabase returned an unexpected People response.');
  }
  return {
    subs: subsRows.map((row) => normalizePerson('sub', { ...(row.data || row), _version: Number(row.version) || 0 })),
    employees: employeeRows.map((row) => normalizePerson('emp', { ...(row.data || row), _version: Number(row.version) || 0 })),
    versionRows: [...subsRows, ...employeeRows],
    normalized: false,
  };
}

async function loadProjectReadModel() {
  try {
    const rows = await querySupabaseJson(
      ['project-core-records'],
      '/rest/v1/project_core_records?select=*&order=created_at.asc',
      'Project core records',
      { retry: 0 },
    );
    if (Array.isArray(rows)) return { rows, core: true };
  } catch (error) {
    console.warn('Project core view is not available; using full project records.', error);
  }
  const rows = await querySupabaseJson(
    ['projects'],
    '/rest/v1/projects?select=*&order=created_at.asc',
    'Projects',
  );
  return { rows, core: false };
}

async function loadTaskReadModel() {
  try {
    const rows = await querySupabaseJson(
      ['task-core-records'],
      '/rest/v1/task_core_records?select=*&order=created_at.asc',
      'Task core records',
      { retry: 0 },
    );
    if (Array.isArray(rows)) return { rows, core: true };
  } catch (error) {
    console.warn('Task core view is not available; using full task records.', error);
  }
  const rows = await querySupabaseJson(
    ['tasks'],
    '/rest/v1/tasks?select=*&order=created_at.asc',
    'Tasks',
  );
  return { rows, core: false };
}

async function loadNormalizedProjectAccess() {
  try {
    const rows = await querySupabaseJson(
      ['project-user-access'],
      '/rest/v1/project_user_access?select=project_id,user_id,position&order=project_id.asc,position.asc',
      'Project access',
      { retry: 0 },
    );
    return Array.isArray(rows) ? rows : null;
  } catch (error) {
    console.warn('Normalized project access table is not available yet; using project JSON access data.', error);
    return null;
  }
}

async function loadNormalizedSelectionTaskLinks() {
  try {
    const rows = await querySupabaseJson(
      ['selection-task-links'],
      '/rest/v1/selection_task_links?select=project_id,selection_id,task_id,position&order=project_id.asc,selection_id.asc,position.asc',
      'Selection task links',
      { retry: 0 },
    );
    return Array.isArray(rows) ? rows : null;
  } catch (error) {
    console.warn('Normalized selection task link table is not available yet; using selection JSON task links.', error);
    return null;
  }
}

function getRemoteSaveError(storageMode, context = 'save') {
  if (!isSupabaseConfigured()) {
    return new Error('Supabase is not configured for saving in this build.');
  }
  if (storageMode === 'loading') {
    return new Error(`Supabase data is still loading. Wait for the current refresh to finish before you ${context}.`);
  }
  if (storageMode !== 'supabase') {
    return new Error(`Supabase is unavailable right now. Restore the connection and refresh before you ${context}.`);
  }
  return null;
}

async function persistCollection(items, storageKey, table, storageMode, deletedId = null) {
  const remoteSaveError = getRemoteSaveError(storageMode, 'save');
  if (remoteSaveError) {
    throw remoteSaveError;
  }
  if (deletedId) {
    await removeRemoteRow(table, deletedId);
  }
  await upsertCollection(table, items);
  return 'supabase';
}

async function persistTasks(tasks, storageMode, deletedTaskId = null) {
  return persistCollection(tasks, 'cx_t', 'tasks', storageMode, deletedTaskId);
}

async function persistProjects(projects, storageMode, deletedProjectId = null) {
  return persistCollection(projects, 'cx_p', 'projects', storageMode, deletedProjectId);
}

async function persistSettings(settings, storageMode, canWriteRemote = false) {
  const remoteSaveError = getRemoteSaveError(storageMode, 'save settings');
  if (remoteSaveError) {
    throw remoteSaveError;
  }
  if (!canWriteRemote) {
    throw new Error('Settings are not ready to save yet. Refresh the app after Supabase finishes loading and try again.');
  }
  await runTrackerMutation(['settings', 'upsert'], async () => {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/settings`, {
      method: 'POST',
      headers: buildHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ id: 'app_settings', data: settings }]),
    }, 'Settings save');
    if (!response.ok) throw new Error(`settings upsert failed: ${await response.text()}`);
  });

  return 'supabase';
}

async function fetchTrackerData() {
  if (!isSupabaseConfigured()) {
    return getFallbackData({
      storageMode: 'local-unconfigured',
      storageIssue: 'Supabase URL or key is not configured in this build.',
    });
  }

  try {
    const [
      projectReadModel,
      taskReadModel,
      peopleReadModel,
      normalizedSchedule,
      normalizedAssets,
      normalizedSelections,
      normalizedInspections,
      normalizedTaskAttachments,
      normalizedAssignments,
      normalizedProjectAccess,
      normalizedSelectionTaskLinks,
      normalizedScheduleRelationships,
      normalizedAppUsers,
    ] =
      await Promise.all([
        loadProjectReadModel(),
        loadTaskReadModel(),
        loadPeopleReadModel(),
        loadNormalizedProjectSchedule(),
        loadNormalizedProjectAssets(),
        loadNormalizedProjectSelections(),
        loadNormalizedProjectInspections(),
        loadNormalizedTaskAttachments(),
        loadNormalizedAssignments(),
        loadNormalizedProjectAccess(),
        loadNormalizedSelectionTaskLinks(),
        loadNormalizedScheduleRelationships(),
        loadNormalizedAppUsers(),
      ]);

    let projectsResponse = projectReadModel?.rows;
    let tasksResponse = taskReadModel?.rows;
    if (
      !Array.isArray(projectsResponse) ||
      !Array.isArray(tasksResponse) ||
      !Array.isArray(peopleReadModel?.subs) ||
      !Array.isArray(peopleReadModel?.employees)
    ) {
      throw new Error('Supabase returned an unexpected response.');
    }

    const projectNormalizedSourcesReady = [
      normalizedSchedule,
      normalizedAssets,
      normalizedSelections,
      normalizedInspections,
      normalizedAssignments,
      normalizedProjectAccess,
      normalizedSelectionTaskLinks,
      normalizedScheduleRelationships,
    ].every(Boolean);
    const taskNormalizedSourcesReady = [
      normalizedTaskAttachments,
      normalizedAssignments,
      normalizedSelectionTaskLinks,
    ].every(Boolean);
    if (projectReadModel?.core && !projectNormalizedSourcesReady) {
      projectsResponse = await querySupabaseJson(
        ['projects-core-fallback'],
        '/rest/v1/projects?select=*&order=created_at.asc',
        'Project fallback records',
        { retry: 0, force: true },
      );
    }
    if (taskReadModel?.core && !taskNormalizedSourcesReady) {
      tasksResponse = await querySupabaseJson(
        ['tasks-core-fallback'],
        '/rest/v1/tasks?select=*&order=created_at.asc',
        'Task fallback records',
        { retry: 0, force: true },
      );
    }

    let settingsResponse = null;
    let settingsIssue = '';
    try {
      settingsResponse = await loadSupabaseSettingsWithRetry();
    } catch (error) {
      settingsIssue = error instanceof Error ? error.message : 'Unknown settings load error.';
      console.warn('Settings load failed; using cached/default settings for this session.', error);
    }

    const subs = peopleReadModel.subs;
    const employees = peopleReadModel.employees;

    const projectRecords = projectsResponse.map((row) => normalizeProject({
      ...(row.data || row),
      _version: Number(row.version) || 0,
    }));
    const projectsWithAccess = normalizedProjectAccess
      ? hydrateProjectsWithNormalizedAccess(projectRecords, normalizedProjectAccess)
      : projectRecords;
    const projectsWithSchedule = normalizedSchedule
      ? hydrateProjectsWithNormalizedSchedule(projectsWithAccess, normalizedSchedule.phases, normalizedSchedule.steps)
      : projectsWithAccess;
    const projectsWithScheduleRelationships = normalizedScheduleRelationships
      ? hydrateProjectsWithNormalizedScheduleRelationships(
          projectsWithSchedule,
          normalizedScheduleRelationships.phases,
          normalizedScheduleRelationships.steps,
          normalizedScheduleRelationships.delays,
        )
      : projectsWithSchedule;
    const projectsWithAssets = normalizedAssets
      ? hydrateProjectsWithNormalizedAssets(
          projectsWithScheduleRelationships,
          normalizedAssets.folders,
          normalizedAssets.files,
          normalizedAssets.photos,
        )
      : projectsWithScheduleRelationships;
    const projectsWithSelections = normalizedSelections
      ? hydrateProjectsWithNormalizedSelections(
          projectsWithAssets,
          normalizedSelections.selections,
          normalizedSelections.attachments,
          normalizedSelections.photos,
        )
      : projectsWithAssets;
    const projectsWithSelectionLinks = normalizedSelectionTaskLinks
      ? hydrateProjectsWithNormalizedSelectionTaskLinks(projectsWithSelections, normalizedSelectionTaskLinks)
      : projectsWithSelections;
    const projectsBeforeAssignments = normalizedInspections
      ? hydrateProjectsWithNormalizedInspections(
          projectsWithSelectionLinks,
          normalizedInspections.inspections,
          normalizedInspections.files,
        )
      : projectsWithSelectionLinks;
    const taskRecords = tasksResponse.map((row) => normalizeTask({ ...(row.data || row), _version: Number(row.version) || 0 }));
    const tasksWithAttachments = normalizedTaskAttachments
      ? hydrateTasksWithNormalizedAttachments(taskRecords, normalizedTaskAttachments)
      : taskRecords;
    const tasksBeforeAssignments = normalizedSelectionTaskLinks
      ? hydrateTasksWithNormalizedSelectionLinks(tasksWithAttachments, projectsBeforeAssignments, normalizedSelectionTaskLinks)
      : tasksWithAttachments;
    const assignedTracker = normalizedAssignments
      ? hydrateTrackerWithNormalizedAssignments(
          projectsBeforeAssignments,
          tasksBeforeAssignments,
          normalizedAssignments.tasks,
          normalizedAssignments.phases,
          normalizedAssignments.steps,
          subs,
          employees,
        )
      : { projects: projectsBeforeAssignments, tasks: tasksBeforeAssignments };
    const { projects, tasks } = assignedTracker;
    const baseSettings =
      Array.isArray(settingsResponse) && settingsResponse.length
        ? normalizeSettings(settingsResponse[0].data || EMPTY_SETTINGS)
        : normalizeSettings(fromStorage('cx_settings', EMPTY_SETTINGS));
    const settings = normalizedAppUsers
      ? hydrateSettingsWithNormalizedUsers(baseSettings, normalizedAppUsers)
      : baseSettings;
    const settingsLoadedFromSupabase = Array.isArray(settingsResponse) && settingsResponse.length > 0;
    const settingsVersion = Number(settingsResponse?.[0]?.version) || 0;
    const concurrencyEnabled = [
      ...projectsResponse,
      ...tasksResponse,
      ...(peopleReadModel.versionRows || []),
      ...(Array.isArray(settingsResponse) ? settingsResponse : []),
    ].some((row) => Number(row?.version) > 0);
    if (settingsLoadedFromSupabase) {
      writeStorage('cx_settings', settings);
    }

    return stripLegacySampleData({
      projects,
      tasks,
      subs,
      employees,
      settings,
      settingsVersion,
      concurrencyEnabled,
      settingsLoadedFromSupabase,
      storageMode: 'supabase',
      storageIssue: settingsIssue,
    });
  } catch (error) {
    const storageIssue = error instanceof Error ? error.message : 'Unknown Supabase load error.';
    console.error('Supabase load failed.', error);
    const loadError = new Error(storageIssue);
    loadError.status = Number(error?.status) || 0;
    loadError.cause = error;
    throw loadError;
  }
}

export async function loadTrackerData({ force = false } = {}) {
  if (force) invalidateTrackerQueries();
  return trackerQueryClient.query({
    key: ['tracker', 'data'],
    staleTime: 15000,
    retry: 2,
    force,
    queryFn: fetchTrackerData,
  });
}

async function callPortalBootstrapRpc(functionName, label) {
  const response = await fetchAuthorizedSupabase(`/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }, label);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${label} failed (${response.status}): ${text || 'No response body.'}`);
    error.status = response.status;
    throw error;
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function loadCurrentAppUserProfile() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await trackerQueryClient.query({
      key: ['portal', 'current-user'],
      staleTime: 15000,
      retry: 0,
      queryFn: () => callPortalBootstrapRpc('get_current_app_user_profile', 'Account profile'),
    });
  } catch (error) {
    if (/PGRST202|PGRST205|schema cache|does not exist|404/i.test(String(error?.message || error || ''))) return null;
    throw error;
  }
}

export async function loadPortalTrackerData({ profile, force = false } = {}) {
  if (!['Customer', 'Subcontractor'].includes(profile?.role)) {
    throw new Error('A customer or subcontractor portal account is required.');
  }
  if (force) trackerQueryClient.invalidateQueries(['portal']);
  return trackerQueryClient.query({
    key: ['portal', 'workspace', profile.id],
    staleTime: 15000,
    retry: 1,
    force,
    queryFn: async () => {
      const payload = await callPortalBootstrapRpc('get_project_portal_bootstrap', 'Portal workspace');
      const currentUser = payload?.currentUser;
      if (!currentUser?.id || !['Customer', 'Subcontractor'].includes(currentUser.role)) {
        throw new Error('The portal workspace returned an invalid account profile.');
      }
      const projects = Array.isArray(payload?.projects)
        ? payload.projects.map((project) => {
            const normalized = normalizeProject({ ...project, _version: Number(project.version) || 0 });
            const sharedFolderIds = new Set(
              (project?.files?.folders || []).map((folder) => String(folder?.id || '').trim()).filter(Boolean),
            );
            return {
              ...normalized,
              files: {
                folders: (normalized.files?.folders || []).filter((folder) => sharedFolderIds.has(folder.id)),
              },
            };
          })
        : [];
      return {
        projects,
        tasks: [],
        subs: [],
        employees: [],
        settings: normalizeSettings({
          ...EMPTY_SETTINGS,
          ...(payload?.calendarSettings || {}),
          users: [normalizeAppUser(currentUser, 0)],
          currentUserId: currentUser.id,
        }),
        settingsLoadedFromSupabase: true,
        settingsVersion: 0,
        concurrencyEnabled: true,
        storageMode: 'supabase',
        storageIssue: '',
        portalMode: true,
      };
    },
  });
}

export async function loadAuditEvents({ limit = 50, beforeId = null, projectId = '', entityType = '', since = '' } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured for audit history in this build.');
  }
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safeBeforeId = Number(beforeId) > 0 ? Number(beforeId) : null;
  const safeSince = String(since || '').trim();
  const rows = await trackerQueryClient.query({
    key: ['audit', projectId || 'all', entityType || 'all', safeLimit, safeBeforeId || 'latest', safeSince || 'any-time'],
    staleTime: 10000,
    retry: 2,
    queryFn: async () => {
      const response = await fetchAuthorizedSupabase('/rest/v1/rpc/get_audit_events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_limit: safeLimit,
          p_before_id: safeBeforeId,
          p_project_id: String(projectId || '').trim(),
          p_entity_type: String(entityType || '').trim(),
          p_since: safeSince || null,
        }),
      }, 'Audit trail', 20000);
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(
          `Audit trail request failed (${response.status} ${response.statusText}): ${text || 'No response body.'}`,
        );
        error.status = response.status;
        throw error;
      }
      try {
        return text ? JSON.parse(text) : [];
      } catch {
        throw new Error('Audit trail returned invalid JSON.');
      }
    },
  });
  return Array.isArray(rows) ? rows : [];
}

function queueProjectPushNotification(currentState, event) {
  if (currentState?.storageMode !== 'supabase' || !event?.projectId || typeof window === 'undefined') return;
  void import('../utils/androidPushNotifications.js')
    .then(({ sendProjectPushNotification }) => sendProjectPushNotification(event))
    .catch((error) => console.warn('The project change was saved, but live notification delivery failed.', error));
}

function assignedAppUserIds(settings, task) {
  const assignees = new Set(
    (Array.isArray(task?.assignees) ? task.assignees : [task?.assignee])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!assignees.size) return [];
  return (settings?.users || [])
    .filter((user) => {
      const name = String(user?.name || '').trim().toLowerCase();
      const email = String(user?.email || '').trim().toLowerCase();
      return assignees.has(name) || assignees.has(email);
    })
    .map((user) => user.id)
    .filter(Boolean);
}

function taskNotificationEvent(currentState, previousTask, nextTask, kind) {
  const project = currentState.projects?.find((item) => item.id === nextTask?.projectId);
  if (!nextTask?.projectId || !project) return null;
  const projectName = project.name || 'Project';
  const assigneesChanged = JSON.stringify(previousTask?.assignees || []) !== JSON.stringify(nextTask.assignees || []);
  const eventKind = kind === 'task-created' ? kind : assigneesChanged ? 'task-assigned' : 'task-updated';
  return {
    projectId: nextTask.projectId,
    kind: eventKind,
    entityId: nextTask.id,
    title: eventKind === 'task-created' ? `New task · ${projectName}` : eventKind === 'task-assigned' ? `Task assignment · ${projectName}` : `Task updated · ${projectName}`,
    body: nextTask.done ? `${nextTask.label} was marked complete.` : `${nextTask.label}${nextTask.due ? ` · Due ${nextTask.due}` : ''}`,
    tab: 'tasks',
    recipientAppUserIds: eventKind === 'task-assigned' ? assignedAppUserIds(currentState.settings, nextTask) : [],
  };
}

export async function createTask(currentState, payload) {
  const task = normalizeTask({
    id: payload.id || `t${Date.now()}`,
    label: payload.label.trim(),
    projectId: payload.projectId || '',
    done: !!payload.done,
    due: payload.due || '',
    assignees: payload.assignees,
    assignee: payload.assignee || '',
    sourceSelectionId: payload.sourceSelectionId || '',
    sourceSelectionProjectId: payload.sourceSelectionProjectId || '',
    sourceSelectionLabel: payload.sourceSelectionLabel || '',
    createdAt: payload.createdAt || new Date().toISOString(),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  });
  const tasks = [...currentState.tasks, task];
  if (currentState.storageMode === 'supabase' && currentState.concurrencyEnabled) {
    const normalizedTask = await persistTaskWithNormalizedAttachments(null, task);
    if (normalizedTask) {
      queueProjectPushNotification(currentState, taskNotificationEvent(currentState, null, normalizedTask, 'task-created'));
      return { ...currentState, tasks: [...currentState.tasks, normalizedTask], storageMode: 'supabase' };
    }
  }
  const persisted = await persistVersionedCollection({
    table: 'tasks', nextItems: tasks, previousItems: currentState.tasks,
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  queueProjectPushNotification(currentState, taskNotificationEvent(currentState, null, task, 'task-created'));
  return { ...currentState, tasks: persisted.items, storageMode: persisted.storageMode };
}

export async function updateTask(currentState, taskId, updates) {
  const existingTask = currentState.tasks.find((task) => task.id === taskId) || null;
  const tasks = currentState.tasks.map((task) =>
    task.id === taskId ? normalizeTask({ ...task, ...updates }) : normalizeTask(task),
  );
  const nextTask = tasks.find((task) => task.id === taskId) || null;
  const nextAttachmentIds = new Set((nextTask?.attachments || []).map((attachment) => attachment.id));
  const removedAttachments = (existingTask?.attachments || []).filter(
    (attachment) => attachment?.storagePath && !nextAttachmentIds.has(attachment.id),
  );

  let persisted;
  if (currentState.storageMode === 'supabase' && currentState.concurrencyEnabled && existingTask && nextTask) {
    const normalizedTask = await persistTaskWithNormalizedAttachments(existingTask, nextTask);
    persisted = normalizedTask
      ? { items: tasks.map((task) => (task.id === taskId ? normalizedTask : task)), storageMode: 'supabase' }
      : null;
  }
  if (!persisted) {
    persisted = await persistVersionedCollection({
      table: 'tasks', nextItems: tasks, previousItems: currentState.tasks,
      storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
    });
  }
  for (const attachment of removedAttachments) {
    try {
      await deleteProjectFileFromStorage(attachment);
    } catch (error) {
      console.warn('Task attachment metadata was saved, but storage cleanup failed.', error);
    }
  }
  queueProjectPushNotification(currentState, taskNotificationEvent(currentState, existingTask, nextTask, 'task-updated'));
  return { ...currentState, tasks: persisted.items, storageMode: persisted.storageMode };
}

export async function deleteTask(currentState, taskId, options = {}) {
  const existingTask = currentState.tasks.find((task) => task.id === taskId) || null;
  const tasks = currentState.tasks.filter((task) => task.id !== taskId);
  const persisted = await persistVersionedCollection({
    table: 'tasks', nextItems: tasks, previousItems: currentState.tasks,
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled, deletedId: taskId,
  });
  if (!options.preserveAttachments && existingTask?.attachments?.length) {
    for (const attachment of existingTask.attachments) {
      try {
        await deleteProjectFileFromStorage(attachment);
      } catch (error) {
        console.warn('Task deletion was saved, but attachment storage cleanup failed.', error);
      }
    }
  }
  return { ...currentState, tasks: persisted.items, storageMode: persisted.storageMode };
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
    mainPhotoId: payload.mainPhotoId || '',
    mainPhotoCrop: payload.mainPhotoCrop === true,
    selections: payload.selections || [],
  });
  const projects = [...currentState.projects, project];
  const persisted = await persistVersionedCollection({
    table: 'projects', nextItems: projects, previousItems: currentState.projects,
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  return { ...currentState, projects: persisted.items, storageMode: persisted.storageMode };
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
  const previousProject = currentState.projects.find((project) => project.id === projectId);
  const nextProject = projects.find((project) => project.id === projectId);
  const inspectionsChanged = JSON.stringify(previousProject?.inspections || []) !== JSON.stringify(nextProject?.inspections || []);
  const notifyInspectionChange = () => {
    if (!inspectionsChanged || !nextProject) return;
    queueProjectPushNotification(currentState, {
      projectId,
      kind: 'inspection-updated',
      entityId: '',
      title: `Inspection updated · ${nextProject.name || 'Project'}`,
      body: 'The inspection schedule or status changed.',
      tab: 'calendar',
    });
  };
  if (
    currentState.storageMode === 'supabase'
    && currentState.concurrencyEnabled
    && previousProject
    && nextProject
    && hasOnlyNormalizedProjectChanges(previousProject, nextProject)
  ) {
    const normalizedProject = await persistNormalizedProjectSections(previousProject, nextProject);
    if (normalizedProject) {
      notifyInspectionChange();
      return {
        ...currentState,
        projects: projects.map((project) => (project.id === projectId ? normalizedProject : project)),
        storageMode: 'supabase',
      };
    }
  }
  const persisted = await persistVersionedCollection({
    table: 'projects', nextItems: projects, previousItems: currentState.projects,
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  notifyInspectionChange();
  return { ...currentState, projects: persisted.items, storageMode: persisted.storageMode };
}

async function callPortalVisibilityRpc(functionName, body, label) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  }, label, 20000);
  const text = await response.text();
  if (!response.ok) {
    if (/NORMALIZED_VERSION_CONFLICT|40001/i.test(text)) throw concurrencyConflictError();
    throw new Error(`${label} failed: ${text || response.statusText}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function updateProjectFolderVisibility(currentState, projectId, folderId, updates) {
  const project = currentState.projects.find((item) => item.id === projectId);
  const folder = project?.files?.folders?.find((item) => item.id === folderId);
  const expectedVersion = Number(project?._normalizedVersions?.folders?.[folderId]) || 0;
  if (!project || !folder) throw new Error('Project folder was not found.');

  if (currentState.storageMode !== 'supabase' || !currentState.concurrencyEnabled || !expectedVersion) {
    return updateProject(currentState, projectId, {
      ...project,
      files: {
        folders: (project.files?.folders || []).map((item) =>
          item.id === folderId ? { ...item, ...updates } : item,
        ),
      },
    });
  }

  const result = await callPortalVisibilityRpc('update_project_folder_visibility', {
    p_project_id: projectId,
    p_folder_id: folderId,
    p_customer_visible: updates.customerVisible ?? (folder.customerVisible !== false),
    p_subcontractor_visible: updates.subcontractorVisible ?? (folder.subcontractorVisible === true),
    p_expected_version: expectedVersion,
  }, 'Folder visibility update');
  const nextVersion = Number(result?.version) || expectedVersion + 1;
  const nextProject = {
    ...project,
    files: {
      folders: (project.files?.folders || []).map((item) =>
        item.id === folderId ? { ...item, ...updates } : item,
      ),
    },
    _normalizedVersions: {
      ...project._normalizedVersions,
      folders: { ...project._normalizedVersions.folders, [folderId]: nextVersion },
    },
  };
  invalidateTrackerQueries();
  return {
    ...currentState,
    projects: currentState.projects.map((item) => (item.id === projectId ? nextProject : item)),
  };
}

export async function updateProjectSelectionVisibility(currentState, projectId, selectionId, enabled) {
  const project = currentState.projects.find((item) => item.id === projectId);
  const selection = project?.selections?.find((item) => item.id === selectionId);
  const expectedVersion = Number(project?._normalizedVersions?.selections?.[selectionId]) || 0;
  if (!project || !selection) throw new Error('Project selection was not found.');

  if (currentState.storageMode !== 'supabase' || !currentState.concurrencyEnabled || !expectedVersion) {
    return updateProject(currentState, projectId, {
      ...project,
      selections: (project.selections || []).map((item) =>
        item.id === selectionId ? { ...item, subcontractorVisible: enabled === true } : item,
      ),
    });
  }

  const result = await callPortalVisibilityRpc('update_project_selection_visibility', {
    p_project_id: projectId,
    p_selection_id: selectionId,
    p_subcontractor_visible: enabled === true,
    p_expected_version: expectedVersion,
  }, 'Selection visibility update');
  const nextVersion = Number(result?.version) || expectedVersion + 1;
  const nextProject = {
    ...project,
    selections: (project.selections || []).map((item) =>
      item.id === selectionId ? { ...item, subcontractorVisible: enabled === true } : item,
    ),
    _normalizedVersions: {
      ...project._normalizedVersions,
      selections: { ...project._normalizedVersions.selections, [selectionId]: nextVersion },
    },
  };
  invalidateTrackerQueries();
  return {
    ...currentState,
    projects: currentState.projects.map((item) => (item.id === projectId ? nextProject : item)),
  };
}

export async function updateProjects(currentState, projectUpdates) {
  const updatesById = new Map((projectUpdates || []).filter((project) => project?.id).map((project) => [project.id, project]));
  const projects = currentState.projects.map((project) => {
    const updates = updatesById.get(project.id);
    return updates ? normalizeProject({ ...project, ...updates }) : project;
  });
  const persisted = await persistVersionedCollection({
    table: 'projects', nextItems: projects, previousItems: currentState.projects,
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  return { ...currentState, projects: persisted.items, storageMode: persisted.storageMode };
}

export async function updateProjectAndTasks(currentState, projectId, projectUpdates, nextTasks) {
  return updateProjectsAndTasks(currentState, [{ ...projectUpdates, id: projectId }], nextTasks);
}

export async function updateProjectsAndTasks(currentState, projectUpdates, nextTasks) {
  const updatesById = new Map((projectUpdates || []).filter((project) => project?.id).map((project) => [project.id, project]));
  const projects = currentState.projects.map((project) => {
    const updates = updatesById.get(project.id);
    return updates ? normalizeProject({ ...project, ...updates }) : project;
  });
  const persisted = await persistVersionedProjectAndTasks(currentState, projects, nextTasks);
  return { ...currentState, ...persisted };
}

export async function deleteProject(currentState, projectId) {
  const projects = currentState.projects.filter((project) => project.id !== projectId);
  const tasks = currentState.tasks.filter((task) => task.projectId !== projectId);
  if (currentState.concurrencyEnabled) {
    const persisted = await persistVersionedProjectAndTasks(currentState, projects, tasks);
    return { ...currentState, ...persisted };
  }
  const remoteSaveError = getRemoteSaveError(currentState.storageMode, 'delete this project');
  if (remoteSaveError) throw remoteSaveError;
  const storageMode = await persistProjects(projects, currentState.storageMode, projectId);
  await upsertCollection('tasks', tasks);
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
  const persisted = await persistVersionedCollection({
    table: config.table, nextItems: people, previousItems: currentState[config.key],
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  return { ...currentState, [config.key]: persisted.items, storageMode: persisted.storageMode };
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
  const persisted = await persistVersionedCollection({
    table: config.table, nextItems: people, previousItems: currentState[config.key],
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  return { ...currentState, [config.key]: persisted.items, storageMode: persisted.storageMode };
}

export async function deletePerson(currentState, type, personId) {
  const config = getPeopleConfig(type);
  const people = currentState[config.key].filter((person) => person.id !== personId);
  const persisted = await persistVersionedCollection({
    table: config.table, nextItems: people, previousItems: currentState[config.key],
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled, deletedId: personId,
  });
  return { ...currentState, [config.key]: persisted.items, storageMode: persisted.storageMode };
}

export async function importPeople(currentState, type, payloads) {
  const config = getPeopleConfig(type);
  const imported = (payloads || []).map((payload, index) => ({
    ...buildPerson(type, payload),
    id: `${type === 'sub' ? 'sub' : normalizePeopleType(type)}${Date.now()}${index}`,
  }));
  const people = [...currentState[config.key], ...imported];
  const persisted = await persistVersionedCollection({
    table: config.table, nextItems: people, previousItems: currentState[config.key],
    storageMode: currentState.storageMode, concurrencyEnabled: currentState.concurrencyEnabled,
  });
  return { ...currentState, [config.key]: persisted.items, storageMode: persisted.storageMode };
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
  let storageMode = currentState.storageMode;
  let settingsVersion = Number(currentState.settingsVersion) || 0;
  if (currentState.concurrencyEnabled) {
    const remoteSaveError = getRemoteSaveError(currentState.storageMode, 'save settings');
    if (remoteSaveError) throw remoteSaveError;
    const results = await applyVersionedOperations([{
      table: 'settings',
      id: 'app_settings',
      data: settings,
      expectedVersion: settingsVersion,
      delete: false,
    }]);
    settingsVersion = Number(results[0]?.version) || settingsVersion;
    storageMode = 'supabase';
  } else {
    storageMode = await persistSettings(
      settings,
      currentState.storageMode,
      currentState.settingsLoadedFromSupabase === true,
    );
  }
  writeStorage('cx_settings', settings);
  return {
    ...currentState,
    settings,
    settingsLoadedFromSupabase: currentState.settingsLoadedFromSupabase === true,
    settingsVersion,
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
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/settings?select=id&limit=1`, {
      headers: buildHeaders(),
    }, 'Supabase connection test');
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
