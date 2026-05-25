const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim();
const SUPABASE_FILES_BUCKET = (import.meta.env.VITE_SUPABASE_FILES_BUCKET || 'project-files').trim();
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const EMPTY_SETTINGS = {
  weekdaysOnly: false,
  holidays: [],
  showSampleData: true,
  showGanttTaskDueDates: true,
  showCalendarTaskDueDates: true,
  showCalendarPhases: true,
  showCalendarHebrewDates: false,
  inspectionSubcodes: ['FOOT-101', 'FRAME-220', 'ELEC-310'],
  peopleListColumns: ['company', 'name', 'role', 'phone', 'email', 'tags'],
  peopleListBoldColumns: ['name'],
};

export const SAMPLE_IDS = {
  projects: ['p1', 'p2', 'p3'],
  tasks: ['t1', 't2', 't3', 't4', 't5'],
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
    phases: Array.isArray(project?.phases) ? project.phases.map((phase, index) => normalizeProjectPhase(phase, index)) : [],
    files: normalizeProjectFolders(project?.files),
    inspections: Array.isArray(project?.inspections)
      ? project.inspections.map((inspection, index) => normalizeProjectInspection(inspection, index))
      : [],
  };
}

function sampleProjects() {
  return [
    {
      id: 'react-sample-1',
      name: 'Maple Grove Townhomes',
      manager: 'James Okafor',
      address: '412 Maple Grove Dr, Franklin',
      permitNumber: 'PRM-24-1187',
      drNumber: 'DR-4472',
      block: '12',
      lot: '7A',
      customerName: 'Destiny Development Group',
      customerPhone: '(555) 410-2200',
      customerEmail: 'owners@destinydev.com',
      customerAddress: '200 Commerce Plaza, Franklin',
      customerNotes: 'Primary owner rep prefers Friday updates.',
      budget: 1850000,
      status: 'active',
      progress: 62,
      end: '2026-08-15',
      phases: [
        {
          id: 'react-phase-1',
          name: 'Sitework and foundation',
          steps: [
            { id: 'react-step-1', name: 'Excavation', done: true },
            { id: 'react-step-2', name: 'Footings and slab', done: false },
          ],
        },
        {
          id: 'react-phase-2',
          name: 'Framing and dry-in',
          steps: [{ id: 'react-step-3', name: 'Roof framing', done: false }],
        },
      ],
      inspections: [
        {
          id: 'react-insp-1',
          subcode: 'FOOT-101',
          inspectionType: 'Footing inspection',
          date: '2026-05-10',
          status: 'passed',
          agency: 'Franklin Building Department',
          notes: 'Approved with no corrections.',
        },
        {
          id: 'react-insp-2',
          subcode: 'FRAME-220',
          inspectionType: 'Framing inspection',
          date: '2026-06-14',
          status: 'requested',
          agency: 'Franklin Building Department',
          notes: '',
        },
      ],
    },
    {
      id: 'react-sample-2',
      name: 'Cedar Ridge Renovation',
      manager: 'Ava Bennett',
      address: '89 Cedar Ridge Rd, Nashville',
      permitNumber: 'PRM-26-0049',
      drNumber: 'DR-1908',
      block: '3',
      lot: '22',
      customerName: 'Harper Family',
      customerPhone: '(555) 992-1440',
      customerEmail: 'harpers@example.com',
      customerAddress: '89 Cedar Ridge Rd, Nashville',
      customerNotes: 'Selections handled directly with owner.',
      budget: 420000,
      status: 'planning',
      progress: 18,
      end: '2026-06-30',
      phases: [
        {
          id: 'react-phase-3',
          name: 'Interior prep',
          steps: [{ id: 'react-step-4', name: 'Selective demolition', done: false }],
        },
      ],
      inspections: [
        {
          id: 'react-insp-3',
          subcode: 'ELEC-310',
          inspectionType: 'Electrical rough-in',
          date: '2026-05-21',
          status: 'requested',
          agency: 'Nashville Codes',
          notes: 'Coordinate with owner access window.',
        },
      ],
    },
  ];
}

function sampleTasks() {
  return [
    {
      id: 'react-task-1',
      projectId: 'react-sample-1',
      label: 'Confirm framing delivery',
      done: false,
      due: '',
    },
    {
      id: 'react-task-2',
      projectId: 'react-sample-1',
      label: 'Schedule inspection',
      done: false,
      due: '',
    },
    {
      id: 'react-task-3',
      projectId: 'react-sample-2',
      label: 'Finalize owner selections',
      done: true,
      due: '',
    },
  ];
}

function sampleSubs() {
  return [
    {
      id: 'sub1',
      first: 'Carlos',
      last: 'Rivera',
      company: 'Groundworks Co.',
      role: 'Site Manager',
      phone: '(555) 201-3344',
      email: 'carlos@groundworks.co',
      license: 'LIC-77821',
      notes: 'Preferred partner for excavation',
      tags: ['Excavation', 'Grading', 'Site Prep'],
    },
    {
      id: 'sub2',
      first: 'Maria',
      last: 'Santos',
      company: 'Concrete Bros',
      role: 'Lead Foreman',
      phone: '(555) 309-5512',
      email: 'maria@concretebros.com',
      license: 'LIC-44093',
      notes: '',
      tags: ['Concrete', 'Foundations', 'Flatwork'],
    },
    {
      id: 'sub3',
      first: 'David',
      last: 'Park',
      company: 'Steel Crew',
      role: 'Structural Lead',
      phone: '(555) 412-8820',
      email: 'dpark@steelcrew.net',
      license: 'LIC-55610',
      notes: 'Available Mon-Fri only',
      tags: ['Steel Erection', 'Framing', 'Metal Decking'],
    },
    {
      id: 'sub4',
      first: 'Angela',
      last: 'Torres',
      company: 'Unified MEP',
      role: 'MEP Superintendent',
      phone: '(555) 518-2277',
      email: 'atorres@unifiedmep.com',
      license: 'LIC-66341',
      notes: '',
      tags: ['Plumbing', 'Electrical', 'HVAC'],
    },
    {
      id: 'sub5',
      first: 'Brian',
      last: 'Chen',
      company: 'Interior Pros',
      role: 'Finish Foreman',
      phone: '(555) 623-9901',
      email: 'bchen@interiorpros.com',
      license: '',
      notes: '',
      tags: ['Drywall', 'Flooring', 'Cabinetry'],
    },
    {
      id: 'sub6',
      first: 'Nadia',
      last: 'Hoffman',
      company: 'Facade Systems',
      role: 'Curtain Wall Specialist',
      phone: '(555) 731-4466',
      email: 'nhoffman@facade.sys',
      license: 'LIC-88002',
      notes: '',
      tags: ['Curtain Wall', 'Glazing', 'Roofing'],
    },
  ];
}

function sampleEmployees() {
  return [
    {
      id: 'emp1',
      first: 'James',
      last: 'Okafor',
      company: 'Destiny Homes',
      role: 'Project Manager',
      phone: '(555) 100-2233',
      email: 'jokafor@destinyhomes.com',
      license: '',
      notes: 'Lead PM for Tech Campus',
      tags: ['Project Management', 'Estimating'],
    },
    {
      id: 'emp2',
      first: 'Sarah',
      last: 'Chen',
      company: 'Destiny Homes',
      role: 'Site Supervisor',
      phone: '(555) 100-4455',
      email: 'schen@destinyhomes.com',
      license: '',
      notes: 'Harbor Bridge lead',
      tags: ['Site Supervision', 'Safety'],
    },
    {
      id: 'emp3',
      first: 'Tom',
      last: 'Bauer',
      company: 'Destiny Homes',
      role: 'Estimator',
      phone: '(555) 100-6677',
      email: 'tbauer@destinyhomes.com',
      license: '',
      notes: '',
      tags: ['Estimating', 'Procurement'],
    },
    {
      id: 'emp4',
      first: 'Lisa',
      last: 'Nguyen',
      company: 'Destiny Homes',
      role: 'Safety Officer',
      phone: '(555) 100-8899',
      email: 'lnguyen@destinyhomes.com',
      license: 'OSHA-30',
      notes: '',
      tags: ['Safety', 'Compliance'],
    },
  ];
}

function fromStorage(key, fallback) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getFallbackData(overrides = {}) {
  return {
    projects: fromStorage('cx_p', sampleProjects()).map(normalizeProject),
    tasks: fromStorage('cx_t', sampleTasks()),
    subs: fromStorage('cx_s', sampleSubs()),
    employees: fromStorage('cx_e', sampleEmployees()),
    settings: fromStorage('cx_settings', EMPTY_SETTINGS),
    storageMode: 'local',
    storageIssue: '',
    ...overrides,
  };
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
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${encodeURIComponent(file.storageBucket)}/${encodeStoragePath(file.storagePath)}`,
    {
      method: 'GET',
      headers: storageAuthHeaders(),
    },
  );

  if (!response.ok) {
    throw new Error(`File download failed: ${await response.text()}`);
  }

  return response.blob();
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
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(items.map((item) => ({ id: item.id, data: item }))),
  });

  if (!response.ok) {
    throw new Error(`${table} upsert failed: ${await response.text()}`);
  }
}

async function removeRemoteRow(table, id) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });

  if (!response.ok) {
    throw new Error(`${table} delete failed: ${await response.text()}`);
  }
}

async function fetchSupabaseJson(path, label) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: HEADERS,
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

async function persistSettings(settings, storageMode) {
  writeStorage('cx_settings', settings);

  if (!isSupabaseConfigured()) {
    return 'local-unconfigured';
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
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
    const tasks = tasksResponse.map((row) => row.data || row);
    const subs = Array.isArray(subsResponse)
      ? subsResponse.map((row) => row.data || row)
      : sampleSubs();
    const employees = Array.isArray(employeesResponse)
      ? employeesResponse.map((row) => row.data || row)
      : sampleEmployees();
    const settings =
      Array.isArray(settingsResponse) && settingsResponse.length
        ? settingsResponse[0].data || EMPTY_SETTINGS
        : fromStorage('cx_settings', EMPTY_SETTINGS);

    return {
      projects: projects.length ? projects : sampleProjects().map(normalizeProject),
      tasks: tasks.length ? tasks : sampleTasks(),
      subs: subs.length ? subs : sampleSubs(),
      employees: employees.length ? employees : sampleEmployees(),
      settings,
      storageMode: 'supabase',
      storageIssue: '',
    };
  } catch (error) {
    const storageIssue =
      error instanceof Error ? error.message : 'Unknown Supabase load error.';
    console.error('Supabase load failed; falling back to local storage.', error);
    return getFallbackData({ storageIssue });
  }
}

export async function createTask(currentState, payload) {
  const task = {
    id: `t${Date.now()}`,
    label: payload.label.trim(),
    projectId: payload.projectId || '',
    done: false,
    due: payload.due || '',
  };
  const tasks = [...currentState.tasks, task];
  const storageMode = await persistTasks(tasks, currentState.storageMode);
  return { ...currentState, tasks, storageMode };
}

export async function updateTask(currentState, taskId, updates) {
  const tasks = currentState.tasks.map((task) =>
    task.id === taskId ? { ...task, ...updates } : task,
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
    phases: payload.phases || [],
    files: payload.files,
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
  return {
    id: `${type === 'sub' ? 'sub' : 'emp'}${Date.now()}`,
    first: payload.first?.trim() || '',
    last: payload.last?.trim() || '',
    company: payload.company?.trim() || '',
    role: payload.role?.trim() || '',
    phone: payload.phone?.trim() || '',
    email: payload.email?.trim() || '',
    license: payload.license?.trim() || '',
    notes: payload.notes?.trim() || '',
    tags: normalizeTags(payload.tags),
  };
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
    id: `${type === 'sub' ? 'sub' : 'emp'}${Date.now()}${index}`,
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
  const settings = {
    ...EMPTY_SETTINGS,
    ...(currentState.settings || {}),
    ...updates,
    holidays: Array.isArray(updates.holidays)
      ? updates.holidays
      : Array.isArray(currentState.settings?.holidays)
        ? currentState.settings.holidays
        : [],
  };
  const storageMode = await persistSettings(settings, currentState.storageMode);
  return { ...currentState, settings, storageMode };
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
      headers: HEADERS,
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
