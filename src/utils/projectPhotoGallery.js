import { isImageFile } from './fileUi.js';
import { isProjectFileArchived } from './projectFiles.js';

const WORKFLOW_LABELS = {
  dailyLogs: 'Daily Logs',
  changeOrders: 'Change Orders',
  rfis: 'RFIs',
  submittals: 'Submittals',
  commitments: 'Commitments',
  warrantyItems: 'Warranty',
  closeoutItems: 'Closeout',
};

const PHOTO_SOURCE_TAB_LABELS = {
  project: 'Project Photos',
  files: 'Files',
  selections: 'Selections',
  inspections: 'Inspections',
  tasks: 'Tasks',
  ...WORKFLOW_LABELS,
};

function appendImage(target, file, sourceType, sourceLabel, ownerId = '') {
  if (!isImageFile(file)) return;
  const galleryKey = [sourceType, ownerId, file.id || file.storagePath || file.name].filter(Boolean).join(':');
  if (target.some((item) => item.galleryKey === galleryKey)) return;
  target.push({
    ...file,
    galleryKey,
    gallerySourceType: sourceType,
    gallerySource: sourceLabel,
  });
}

export function buildProjectPhotoGallery({ project, tasks = [], workflowRecords = [] }) {
  const gallery = [];

  (project?.photos || []).forEach((photo) => appendImage(gallery, photo, 'project', 'Project Photos', project?.id));

  (project?.files?.folders || []).forEach((folder) => {
    (folder.files || [])
      .filter((file) => !isProjectFileArchived(file))
      .forEach((file) => appendImage(gallery, file, 'files', `Files · ${folder.name || 'Folder'}`, folder.id));
  });

  (project?.selections || []).forEach((selection) => {
    const source = `Selections · ${selection.itemName || selection.category || 'Selection'}`;
    (selection.photos || []).forEach((photo) => appendImage(gallery, photo, 'selections', source, selection.id));
    (selection.attachments || []).forEach((file) => appendImage(gallery, file, 'selections', source, selection.id));
  });

  (project?.inspections || []).forEach((inspection) => {
    const source = `Inspections · ${inspection.inspectionType || inspection.subcode || 'Inspection'}`;
    appendImage(gallery, inspection.stickerFile, 'inspections', source, `${inspection.id}:sticker`);
    appendImage(gallery, inspection.reportFile, 'inspections', source, `${inspection.id}:report`);
    (inspection.attemptHistory || []).forEach((attempt, index) => {
      const attemptSource = `${source} · Attempt ${index + 1}`;
      appendImage(gallery, attempt.stickerFile, 'inspections', attemptSource, `${inspection.id}:attempt-${index + 1}:sticker`);
      appendImage(gallery, attempt.reportFile, 'inspections', attemptSource, `${inspection.id}:attempt-${index + 1}:report`);
    });
  });

  (tasks || []).filter((task) => task.projectId === project?.id).forEach((task) => {
    (task.attachments || []).forEach((file) => appendImage(gallery, file, 'tasks', `Tasks · ${task.label || 'Task'}`, task.id));
  });

  (workflowRecords || []).forEach(({ type, records }) => {
    (records || []).forEach((record) => {
      const baseLabel = WORKFLOW_LABELS[type] || 'Project record';
      const recordLabel = record.number || record.title || record.date || 'Record';
      if (type === 'dailyLogs') {
        (record.subcontractorWork || []).forEach((entry) => {
          const source = `${baseLabel} · ${recordLabel}${entry.subcontractorCompany || entry.subcontractorName ? ` · ${entry.subcontractorCompany || entry.subcontractorName}` : ''}`;
          (entry.photos || []).forEach((photo) => appendImage(gallery, photo, type, source, `${record.id}:${entry.id}`));
        });
        return;
      }
      const source = `${baseLabel} · ${recordLabel}`;
      (record.attachments || []).forEach((file) => appendImage(gallery, file, type, source, record.id));
      (record.invoices || []).forEach((file) => appendImage(gallery, file, type, `${source} · Invoices`, record.id));
    });
  });

  return gallery;
}

export function groupProjectPhotosBySource(photos = []) {
  const groups = [];
  const groupsByKey = new Map();
  (photos || []).forEach((photo) => {
    const key = String(photo?.gallerySourceType || 'other');
    const label = PHOTO_SOURCE_TAB_LABELS[key] || 'Other Photos';
    const fullSource = String(photo?.gallerySource || label).trim() || label;
    const sourcePrefix = `${label} · `;
    const sourceItem = fullSource.startsWith(sourcePrefix) ? fullSource.slice(sourcePrefix.length) : fullSource;
    let group = groupsByKey.get(key);
    if (!group) {
      group = { key, label, photos: [] };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.photos.push({ ...photo, gallerySourceItem: sourceItem });
  });
  return groups;
}

export const PROJECT_PHOTO_WORKFLOW_TYPES = [
  'dailyLogs',
  'changeOrders',
  'rfis',
  'submittals',
  'commitments',
  'warrantyItems',
  'closeoutItems',
];

const SOURCE_FOLDER_NAMES = {
  files: 'Files', selections: 'Selections', inspections: 'Inspections', tasks: 'Tasks',
  ...WORKFLOW_LABELS,
};

function getPhotoSourceFolder(photo) {
  if (!photo?.gallerySourceType || photo.gallerySourceType === 'project') return null;
  const name = SOURCE_FOLDER_NAMES[photo.gallerySourceType] || String(photo.gallerySource || '').split(' · ')[0].trim();
  return name ? { id: `source:${photo.gallerySourceType}`, name, source: true } : null;
}

export function getProjectPhotoFolders(project, photos = []) {
  const seen = new Set();
  const folders = (Array.isArray(project?.photoFolders) ? project.photoFolders : []).filter((folder) => {
    const id = String(folder?.id || '').trim();
    const name = String(folder?.name || '').trim();
    if (!id || !name || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const names = new Set(folders.map((folder) => folder.name.trim().toLowerCase()));
  photos.forEach((photo) => {
    const folder = getPhotoSourceFolder(photo);
    if (!folder || names.has(folder.name.toLowerCase())) return;
    folders.push(folder);
    names.add(folder.name.toLowerCase());
  });
  return folders;
}

export function getPhotoFolderId(project, photo, folders = getProjectPhotoFolders(project, [photo])) {
  const assignedId = String(project?.photoFolderAssignments?.[photo.galleryKey] || '');
  if (assignedId === '__unfiled__') return '';
  if (folders.some((folder) => folder.id === assignedId)) return assignedId;
  const sourceFolder = getPhotoSourceFolder(photo);
  return folders.find((folder) => folder.name.trim().toLowerCase() === sourceFolder?.name.toLowerCase())?.id || '';
}
