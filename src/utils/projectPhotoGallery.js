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

export const PROJECT_PHOTO_WORKFLOW_TYPES = [
  'dailyLogs',
  'changeOrders',
  'rfis',
  'submittals',
  'commitments',
  'warrantyItems',
  'closeoutItems',
];
