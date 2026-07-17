import { fetchAuthorizedSupabase, getSupabaseDiagnosticsInfo } from '../../../services/trackerData.js';

const TAKEOFFS_TABLE = 'project_takeoffs';
const TAKEOFF_FILES_BUCKET = 'takeoff-files';

function encodePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function base64ToBlob(base64, type = 'application/pdf') {
  const binary = atob(base64);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let index = 0; index < slice.length; index += 1) bytes[index] = slice.charCodeAt(index);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type });
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `takeoff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanFileName(name) {
  return String(name || 'drawing.pdf')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
}

function localStorageKey(projectId) {
  return `project-takeoffs:${projectId}`;
}

function readLocalRecords(projectId) {
  try {
    const records = JSON.parse(window.localStorage.getItem(localStorageKey(projectId)) || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeLocalRecords(projectId, records) {
  try {
    window.localStorage.setItem(localStorageKey(projectId), JSON.stringify(records));
    return true;
  } catch (error) {
    console.warn('Unable to cache takeoffs in browser storage.', error);
    return false;
  }
}

function upsertLocalRecord(projectId, record) {
  const records = readLocalRecords(projectId);
  writeLocalRecords(projectId, [record, ...records.filter((item) => item.id !== record.id)]);
}

function removeLocalRecord(projectId, takeoffId) {
  writeLocalRecords(projectId, readLocalRecords(projectId).filter((item) => item.id !== takeoffId));
}

function normalizeRemoteRecord(record) {
  return {
    id: String(record?.id || ''),
    projectId: String(record?.project_id || ''),
    name: String(record?.name || record?.pdf_name || 'Untitled takeoff'),
    pdfName: String(record?.pdf_name || 'Drawing.pdf'),
    storageBucket: String(record?.storage_bucket || TAKEOFF_FILES_BUCKET),
    storagePath: String(record?.storage_path || ''),
    snapshot: record?.snapshot || null,
    version: Math.max(1, Number(record?.version) || 1),
    updatedAt: String(record?.updated_at || new Date().toISOString()),
  };
}

function createLocalRecord(projectId, id, snapshot, metadata = {}) {
  const updatedAt = metadata.updatedAt || new Date().toISOString();
  return {
    id,
    projectId,
    name: String(snapshot.projectName || snapshot.pdfName || 'Untitled takeoff').replace(/\.pdf$/i, ''),
    pdfName: snapshot.pdfName || 'Drawing.pdf',
    storageBucket: metadata.storageBucket || '',
    storagePath: metadata.storagePath || '',
    snapshot: { ...snapshot, id, savedAt: updatedAt },
    version: Math.max(1, Number(metadata.version) || 1),
    updatedAt,
  };
}

function listItem(record, source) {
  return {
    id: record.id,
    name: record.name,
    pdfName: record.pdfName,
    updatedAt: record.updatedAt,
    source,
    hasLocalData: source === 'browser',
  };
}

async function parseJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  if (!response.ok) throw new Error(text || fallbackMessage);
  return text ? JSON.parse(text) : null;
}

export function createProjectTakeoffDataService({ projectId, canEdit = true }) {
  const scopedProjectId = String(projectId || '').trim();
  const versions = new Map();
  const diagnostics = getSupabaseDiagnosticsInfo();

  if (!scopedProjectId) throw new Error('A Project Tracker project is required for Takeoff.');

  const assertCanEdit = () => {
    if (!canEdit) throw new Error('You do not have edit access to this project.');
  };

  const recordPath = (takeoffId, pdfName) =>
    ['projects', scopedProjectId, 'takeoffs', takeoffId, `source-${cleanFileName(pdfName)}`].join('/');

  async function getRemoteRecord(takeoffId) {
    const response = await fetchAuthorizedSupabase(
      `/rest/v1/${TAKEOFFS_TABLE}?project_id=eq.${encodeURIComponent(scopedProjectId)}`
        + `&id=eq.${encodeURIComponent(takeoffId)}&select=*`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      'Takeoff load',
    );
    const payload = await parseJsonResponse(response, 'Unable to load the saved takeoff.');
    const record = Array.isArray(payload) && payload[0] ? normalizeRemoteRecord(payload[0]) : null;
    if (record) versions.set(record.id, record.version);
    return record;
  }

  async function uploadPdf(takeoffId, pdfName, pdfDataBase64) {
    const storagePath = recordPath(takeoffId, pdfName);
    const response = await fetchAuthorizedSupabase(
      `/storage/v1/object/${encodeURIComponent(TAKEOFF_FILES_BUCKET)}/${encodePath(storagePath)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: base64ToBlob(pdfDataBase64),
      },
      'Takeoff PDF upload',
      60_000,
    );
    if (!response.ok) throw new Error(`Takeoff PDF upload failed: ${await response.text()}`);
    return storagePath;
  }

  async function downloadPdf(record) {
    const response = await fetchAuthorizedSupabase(
      `/storage/v1/object/authenticated/${encodeURIComponent(record.storageBucket)}/${encodePath(record.storagePath)}`,
      { method: 'GET' },
      'Takeoff PDF download',
      60_000,
    );
    if (!response.ok) throw new Error(`Takeoff PDF download failed: ${await response.text()}`);
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  }

  async function saveRemoteRecord(record, existingId) {
    const body = {
      id: record.id,
      project_id: scopedProjectId,
      name: record.name,
      pdf_name: record.pdfName,
      storage_bucket: record.storageBucket,
      storage_path: record.storagePath,
      snapshot: record.snapshot,
    };

    let currentVersion = versions.get(record.id);
    if (existingId && !currentVersion) currentVersion = (await getRemoteRecord(record.id))?.version;

    if (currentVersion) {
      body.version = currentVersion + 1;
      const response = await fetchAuthorizedSupabase(
        `/rest/v1/${TAKEOFFS_TABLE}?project_id=eq.${encodeURIComponent(scopedProjectId)}`
          + `&id=eq.${encodeURIComponent(record.id)}&version=eq.${currentVersion}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(body),
        },
        'Takeoff save',
      );
      const payload = await parseJsonResponse(response, 'Unable to save the takeoff.');
      if (!Array.isArray(payload) || !payload[0]) {
        throw new Error('This takeoff changed elsewhere. Reopen it before saving again.');
      }
      const saved = normalizeRemoteRecord(payload[0]);
      versions.set(saved.id, saved.version);
      return saved;
    }

    const response = await fetchAuthorizedSupabase(
      `/rest/v1/${TAKEOFFS_TABLE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(body),
      },
      'Takeoff save',
    );
    const payload = await parseJsonResponse(response, 'Unable to save the takeoff.');
    const saved = normalizeRemoteRecord(Array.isArray(payload) ? payload[0] : payload);
    versions.set(saved.id, saved.version);
    return saved;
  }

  return {
    sessionKey: `plan-takeoff:autosave:${scopedProjectId}`,
    readOnly: !canEdit,
    storageMode: diagnostics.configured ? 'supabase' : 'local-unconfigured',
    storageIssue: diagnostics.configured ? '' : 'Supabase is not configured for this build.',

    async saveProject(snapshot, existingId = '') {
      assertCanEdit();
      const takeoffId = existingId || snapshot.id || createId();
      const localRecord = createLocalRecord(scopedProjectId, takeoffId, snapshot, {
        version: versions.get(takeoffId) || 1,
      });
      upsertLocalRecord(scopedProjectId, localRecord);

      if (!diagnostics.configured) {
        return { id: takeoffId, storageMode: 'local-unconfigured', record: localRecord };
      }

      try {
        const storagePath = await uploadPdf(takeoffId, localRecord.pdfName, snapshot.pdfDataBase64);
        const { pdfDataBase64, ...remoteSnapshot } = localRecord.snapshot;
        const saved = await saveRemoteRecord({
          ...localRecord,
          storageBucket: TAKEOFF_FILES_BUCKET,
          storagePath,
          snapshot: remoteSnapshot,
        }, existingId);
        upsertLocalRecord(scopedProjectId, createLocalRecord(scopedProjectId, takeoffId, snapshot, saved));
        return { id: saved.id, storageMode: 'supabase', record: saved };
      } catch (error) {
        return {
          id: takeoffId,
          storageMode: 'local',
          storageIssue: error instanceof Error ? error.message : 'Remote save failed.',
          record: localRecord,
        };
      }
    },

    async listProjects() {
      const localRecords = readLocalRecords(scopedProjectId);
      const localItems = localRecords.map((record) => listItem(record, 'browser'));
      if (!diagnostics.configured) {
        return { projects: localItems, storageMode: 'local-unconfigured' };
      }

      try {
        const response = await fetchAuthorizedSupabase(
          `/rest/v1/${TAKEOFFS_TABLE}?project_id=eq.${encodeURIComponent(scopedProjectId)}`
            + '&select=id,project_id,name,pdf_name,storage_bucket,storage_path,version,updated_at&order=updated_at.desc',
          { method: 'GET', headers: { Accept: 'application/json' } },
          'Takeoff list',
        );
        const payload = await parseJsonResponse(response, 'Unable to list saved takeoffs.');
        const remoteRecords = (Array.isArray(payload) ? payload : []).map(normalizeRemoteRecord);
        remoteRecords.forEach((record) => versions.set(record.id, record.version));
        const remoteItems = remoteRecords.map((record) => ({
          ...listItem(record, 'supabase'),
          hasLocalData: localRecords.some((local) => local.id === record.id),
        }));
        const merged = [...remoteItems, ...localItems.filter((local) => !remoteItems.some((remote) => remote.id === local.id))];
        return { projects: merged, storageMode: 'supabase' };
      } catch (error) {
        return {
          projects: localItems,
          storageMode: 'local',
          storageIssue: error instanceof Error ? error.message : 'Remote list failed.',
        };
      }
    },

    async loadProject(takeoffId) {
      const localRecord = readLocalRecords(scopedProjectId).find((record) => record.id === takeoffId);
      if (diagnostics.configured) {
        try {
          const remoteRecord = await getRemoteRecord(takeoffId);
          if (remoteRecord?.snapshot && remoteRecord.storagePath) {
            const project = {
              ...remoteRecord.snapshot,
              id: remoteRecord.id,
              pdfName: remoteRecord.pdfName,
              pdfDataBase64: await downloadPdf(remoteRecord),
            };
            upsertLocalRecord(scopedProjectId, createLocalRecord(scopedProjectId, remoteRecord.id, project, remoteRecord));
            return { project, storageMode: 'supabase' };
          }
        } catch (error) {
          if (!localRecord?.snapshot?.pdfDataBase64) throw error;
        }
      }
      if (!localRecord?.snapshot?.pdfDataBase64) throw new Error('Saved takeoff not found.');
      versions.set(localRecord.id, localRecord.version || 1);
      return { project: localRecord.snapshot, storageMode: diagnostics.configured ? 'local' : 'local-unconfigured' };
    },

    async deleteProject(takeoffId) {
      assertCanEdit();
      const localRecord = readLocalRecords(scopedProjectId).find((record) => record.id === takeoffId);
      if (!diagnostics.configured) {
        removeLocalRecord(scopedProjectId, takeoffId);
        return { storageMode: 'local-unconfigured' };
      }

      try {
        const remoteRecord = (await getRemoteRecord(takeoffId)) || localRecord;
        const response = await fetchAuthorizedSupabase(
          `/rest/v1/${TAKEOFFS_TABLE}?project_id=eq.${encodeURIComponent(scopedProjectId)}&id=eq.${encodeURIComponent(takeoffId)}`,
          { method: 'DELETE', headers: { Prefer: 'return=representation' } },
          'Takeoff delete',
        );
        const payload = await parseJsonResponse(response, 'Unable to delete the takeoff.');
        if (!Array.isArray(payload) || !payload[0]) throw new Error('Saved takeoff was not deleted.');
        removeLocalRecord(scopedProjectId, takeoffId);
        versions.delete(takeoffId);

        let storageIssue = '';
        if (remoteRecord?.storagePath) {
          const storageResponse = await fetchAuthorizedSupabase(
            `/storage/v1/object/${encodeURIComponent(remoteRecord.storageBucket || TAKEOFF_FILES_BUCKET)}/${encodePath(remoteRecord.storagePath)}`,
            { method: 'DELETE' },
            'Takeoff PDF delete',
          );
          if (!storageResponse.ok && storageResponse.status !== 404) storageIssue = await storageResponse.text();
        }
        return { storageMode: 'supabase', storageIssue };
      } catch (error) {
        return { storageMode: 'local', storageIssue: error instanceof Error ? error.message : 'Remote delete failed.' };
      }
    },

    async renameProject(takeoffId, projectName) {
      assertCanEdit();
      const name = String(projectName || '').trim();
      if (!name) throw new Error('Project name is required.');
      const localRecords = readLocalRecords(scopedProjectId);
      const localRecord = localRecords.find((record) => record.id === takeoffId);
      if (localRecord) {
        localRecord.name = name;
        localRecord.snapshot = { ...localRecord.snapshot, projectName: name };
        localRecord.updatedAt = new Date().toISOString();
        writeLocalRecords(scopedProjectId, [localRecord, ...localRecords.filter((record) => record.id !== takeoffId)]);
      }
      if (!diagnostics.configured) return { storageMode: 'local-unconfigured', record: localRecord };

      try {
        const remoteRecord = await getRemoteRecord(takeoffId);
        if (!remoteRecord) throw new Error('Saved takeoff not found.');
        const expectedVersion = remoteRecord.version;
        const response = await fetchAuthorizedSupabase(
          `/rest/v1/${TAKEOFFS_TABLE}?project_id=eq.${encodeURIComponent(scopedProjectId)}`
            + `&id=eq.${encodeURIComponent(takeoffId)}&version=eq.${expectedVersion}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              name,
              snapshot: { ...remoteRecord.snapshot, projectName: name },
              version: expectedVersion + 1,
            }),
          },
          'Takeoff rename',
        );
        const payload = await parseJsonResponse(response, 'Unable to rename the takeoff.');
        if (!Array.isArray(payload) || !payload[0]) throw new Error('This takeoff changed elsewhere. Reopen it before renaming.');
        const saved = normalizeRemoteRecord(payload[0]);
        versions.set(saved.id, saved.version);
        return { storageMode: 'supabase', record: saved };
      } catch (error) {
        return {
          storageMode: 'local',
          storageIssue: error instanceof Error ? error.message : 'Remote rename failed.',
          record: localRecord,
        };
      }
    },
  };
}
