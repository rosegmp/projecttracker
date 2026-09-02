export const PROJECT_FILE_ARCHIVE_FILTERS = ['active', 'archived', 'all'];

export function isProjectFileArchived(file) {
  return Boolean(file?.archivedAt || file?.archived === true);
}

export function projectFileMatchesArchiveFilter(file, filter = 'active') {
  if (filter === 'all') return true;
  return filter === 'archived' ? isProjectFileArchived(file) : !isProjectFileArchived(file);
}

export function filterProjectFileFolders(folders = [], filter = 'active') {
  const effectiveFilter = PROJECT_FILE_ARCHIVE_FILTERS.includes(filter) ? filter : 'active';
  return (Array.isArray(folders) ? folders : []).map((folder) => ({
    ...folder,
    files: (Array.isArray(folder?.files) ? folder.files : []).filter((file) =>
      projectFileMatchesArchiveFilter(file, effectiveFilter)),
  }));
}

export function archiveProjectFile(file, archivedAt = new Date().toISOString()) {
  return {
    ...file,
    archivedAt,
  };
}

export function restoreProjectFile(file) {
  const { archivedAt: _archivedAt, archived: _archived, ...restoredFile } = file || {};
  return restoredFile;
}
