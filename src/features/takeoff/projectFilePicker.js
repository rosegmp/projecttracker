import { downloadProjectFileFromStorage } from '../../services/trackerData.js';
import { dataUrlToBlob } from '../../utils/fileUi.js';

export function projectFileDisplayName(file) {
  return String(file?.originalName || file?.name || 'Project drawing.pdf');
}

export function isProjectPdf(file) {
  if (!file) return false;
  if (String(file.type || '').toLowerCase() === 'application/pdf') return true;
  return /\.pdf$/i.test(projectFileDisplayName(file));
}

export function listProjectPdfFiles(project) {
  const folders = Array.isArray(project?.files?.folders) ? project.files.folders : [];
  return folders.flatMap((folder) => (
    Array.isArray(folder?.files) ? folder.files : []
  ).filter(isProjectPdf).map((file) => ({
    ...file,
    folderId: folder.id,
    folderName: folder.name || 'Project Files',
  })));
}

export async function projectFileToBrowserFile(file) {
  let blob;
  if (file?.storageBucket && file?.storagePath) {
    blob = await downloadProjectFileFromStorage(file);
  } else if (file?.dataUrl) {
    blob = await dataUrlToBlob(file.dataUrl);
  } else {
    throw new Error('This project file is not available for download.');
  }

  return new File([blob], projectFileDisplayName(file), {
    type: blob.type || 'application/pdf',
    lastModified: file?.uploadedAt ? new Date(file.uploadedAt).getTime() : Date.now(),
  });
}
