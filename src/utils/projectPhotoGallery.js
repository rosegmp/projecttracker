import { isImageFile } from './fileUi.js';

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
    (folder.files || []).forEach((file) => appendImage(gallery, file, 'files', `Files · ${folder.name || 'Folder'}`, folder.id));
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
