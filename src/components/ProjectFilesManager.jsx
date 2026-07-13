import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PROJECT_FILE_FOLDERS, deleteProjectFileFromStorage, downloadProjectFileFromStorage,
  isSupabaseStorageConfigured, updateProject, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import { dataUrlToBlob, downloadBlobForCurrentPlatform, formatFileSize, isShareDismissed } from '../utils/fileUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { MoveFileModal, TextEntryModal } from './FormDialogs.jsx';

export default function ProjectFilesManager({
  data,
  project,
  onStateChange,
  readOnly = false,
  forcedViewMode = '',
  hideViewToggle = false,
}) {
  const [viewMode, setViewMode] = useState(forcedViewMode || 'cards');
  const [saving, setSaving] = useState(false);
  const [fileNameDraft, setFileNameDraft] = useState(null);
  const [storageNotice, setStorageNotice] = useState('');
  const [moveFileDraft, setMoveFileDraft] = useState(null);
  const [folderNameDraft, setFolderNameDraft] = useState(null);
  const [dragItem, setDragItem] = useState(null);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState('');
  const [expandedFolders, setExpandedFolders] = useState({});
  const fileInputRefs = useRef({});
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const folders = project?.files?.folders || [];
  const flatFiles = useMemo(
    () =>
      folders.flatMap((folder) =>
        (folder.files || []).map((file) => ({
          ...file,
          folderId: folder.id,
          folderName: folder.name,
        })),
      ),
    [folders],
  );
  const allFoldersExpanded = folders.length > 0 && folders.every((folder) => expandedFolders[folder.id] !== false);
  const effectiveViewMode = forcedViewMode || viewMode;

  useEffect(() => {
    if (forcedViewMode && viewMode !== forcedViewMode) {
      setViewMode(forcedViewMode);
    }
  }, [forcedViewMode, viewMode]);

  async function runFilesMutation(buildNextProject) {
    if (!project?.id) return;
    setSaving(true);
    try {
      const currentState = dataRef.current;
      const currentProject = currentState.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = buildNextProject(currentProject);
      const nextState = await updateProject(currentState, project.id, nextProject);
      dataRef.current = nextState;
      onStateChange(nextState);
    } finally {
      setSaving(false);
    }
  }

  function openCreateFolderModal() {
    if (!project) return;
    setFolderNameDraft({
      mode: 'create',
      folderId: '',
      eyebrow: 'Folder',
      title: 'Add folder',
      description: 'Create a new project folder for organizing files.',
      label: 'Folder name',
      placeholder: 'Folder name',
      value: '',
      saveLabel: 'Add folder',
    });
  }

  async function saveFolderNameDraft() {
    if (!project || !folderNameDraft) return;
    const trimmed = folderNameDraft.value.trim();
    if (!trimmed) return;
    const duplicate = folders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      void showAppAlert('A folder with that name already exists for this project.', 'Folder already exists');
      return;
    }
    if (folderNameDraft.mode === 'create') {
      void runFilesMutation((currentProject) => ({
        ...currentProject,
        files: {
          folders: [
            ...(currentProject.files?.folders || []),
            {
              id: `folder-${Date.now()}`,
              name: trimmed,
              files: [],
            },
          ],
        },
      }));
      setFolderNameDraft(null);
      return;
    }
    const folderId = folderNameDraft.folderId;
    const duplicateRename = folders.some(
      (item) => item.id !== folderId && item.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicateRename) {
      void showAppAlert('A folder with that name already exists for this project.', 'Folder already exists');
      return;
    }
    await runFilesMutation((currentProject) => ({
      ...currentProject,
      files: {
        folders: (currentProject.files?.folders || []).map((item) =>
          item.id === folderId
            ? {
                ...item,
                name: trimmed,
              }
            : item,
        ),
      },
    }));
    setFolderNameDraft(null);
  }

  function openRenameFolderModal(folderId) {
    if (!project) return;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    setFolderNameDraft({
      mode: 'rename',
      folderId,
      eyebrow: 'Folder',
      title: 'Rename folder',
      description: `Update the folder name for ${folder.name}.`,
      label: 'Folder name',
      placeholder: 'Folder name',
      value: folder.name,
      saveLabel: 'Save name',
    });
  }

  async function deleteFolder(folderId) {
    if (!project) return;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const fileCountInFolder = folder.files?.length || 0;
    const confirmed = await showAppConfirm(
      fileCountInFolder
        ? `Delete folder "${folder.name}" and its ${fileCountInFolder} file(s)? This cannot be undone.`
        : `Delete folder "${folder.name}"?`,
      { title: 'Delete folder', confirmLabel: 'Delete', tone: 'danger' },
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      for (const file of folder.files || []) {
        if (file?.storagePath) {
          await deleteProjectFileFromStorage(file);
        }
      }
      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = {
        ...currentProject,
        files: {
          folders: (currentProject.files?.folders || []).filter((item) => item.id !== folderId),
        },
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to delete folder.', 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  function startFolderDrag(event, folderId) {
    if (saving) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', folderId);
    setDragItem({ type: 'folder', folderId });
  }

  function startFileDrag(event, folderId, fileId) {
    if (saving) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fileId);
    setDragItem({ type: 'file', folderId, fileId });
  }

  function finishDrag() {
    setDragItem(null);
  }

  function toggleFolderExpanded(folderId) {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !(current[folderId] !== false),
    }));
  }

  function toggleAllFoldersExpanded() {
    if (!folders.length) return;
    if (allFoldersExpanded) {
      setExpandedFolders(
        Object.fromEntries(folders.map((folder) => [folder.id, false])),
      );
      return;
    }
    setExpandedFolders({});
  }

  function isExternalFileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function handleFolderUploadDragOver(event, folderId) {
    if (readOnly) return;
    if (dragItem?.type === 'folder') {
      event.preventDefault();
      return;
    }
    if (isExternalFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setUploadTargetFolderId(folderId);
    }
  }

  function handleFolderUploadDragLeave(event, folderId) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setUploadTargetFolderId((current) => (current === folderId ? '' : current));
    }
  }

  function handleFolderUploadDrop(event, folderId) {
    if (readOnly) return;
    if (dragItem?.type === 'folder') {
      event.preventDefault();
      moveFolderByDrag(folderId);
      return;
    }
    if (!project || !isExternalFileDrag(event)) return;
    event.preventDefault();
    setUploadTargetFolderId('');
    void handleFolderUpload(folderId, event.dataTransfer.files);
  }

  function moveFolderByDrag(targetFolderId) {
    if (!project || !dragItem || dragItem.type !== 'folder' || dragItem.folderId === targetFolderId) return;
    void runFilesMutation((currentProject) => {
      const current = [...(currentProject.files?.folders || [])];
      const sourceIndex = current.findIndex((folder) => folder.id === dragItem.folderId);
      const targetIndex = current.findIndex((folder) => folder.id === targetFolderId);
      if (sourceIndex < 0 || targetIndex < 0) return currentProject;
      const [movedFolder] = current.splice(sourceIndex, 1);
      current.splice(targetIndex, 0, movedFolder);
      return {
        ...currentProject,
        files: {
          folders: current,
        },
      };
    });
    finishDrag();
  }

  function moveFileByDrag(targetFolderId, targetFileId) {
    if (
      !project ||
      !dragItem ||
      dragItem.type !== 'file' ||
      dragItem.folderId !== targetFolderId ||
      dragItem.fileId === targetFileId
    ) {
      return;
    }
    void runFilesMutation((currentProject) => {
      const foldersList = currentProject.files?.folders || [];
      return {
        ...currentProject,
        files: {
          folders: foldersList.map((folder) => {
            if (folder.id !== targetFolderId) return folder;
            const current = [...(folder.files || [])];
            const sourceIndex = current.findIndex((file) => file.id === dragItem.fileId);
            const targetIndex = current.findIndex((file) => file.id === targetFileId);
            if (sourceIndex < 0 || targetIndex < 0) return folder;
            const [movedFile] = current.splice(sourceIndex, 1);
            current.splice(targetIndex, 0, movedFile);
            return {
              ...folder,
              files: current,
            };
          }),
        },
      };
    });
    finishDrag();
  }

  function triggerFolderUpload(folderId) {
    fileInputRefs.current[folderId]?.click();
  }

  async function createProjectFileRecord(folderId, file) {
    if (!project?.id) throw new Error('Project not found.');
    if (!isSupabaseStorageConfigured()) {
      throw new Error('Supabase Storage is not configured for file uploads.');
    }
    const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      fileRecord: {
        id: fileId,
        name: file.name,
        originalName: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        ...(await uploadProjectFileToStorage(project.id, folderId, fileId, file)),
        dataUrl: '',
      },
    };
  }

  async function handleFolderUpload(folderId, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !project?.id) return;

    setSaving(true);
    try {
      const uploadResults = await Promise.all(files.map((file) => createProjectFileRecord(folderId, file)));
      const uploads = uploadResults.map((result) => result.fileRecord);
      setStorageNotice('');
      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = {
        ...currentProject,
        files: {
          folders: (currentProject.files?.folders || []).map((folder) =>
            folder.id === folderId
              ? {
                  ...folder,
                  files: [...(folder.files || []), ...uploads],
                }
              : folder,
          ),
        },
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to upload file.', 'Upload failed');
    } finally {
      const input = fileInputRefs.current[folderId];
      if (input) input.value = '';
      setSaving(false);
    }
  }

  function downloadProjectFile(file) {
    void (async () => {
      try {
        let blob = null;
        if (file?.storagePath && file?.storageBucket) {
          blob = await downloadProjectFileFromStorage(file);
        } else if (file?.dataUrl) {
          blob = await dataUrlToBlob(file.dataUrl);
        } else {
          return;
        }

        await downloadBlobForCurrentPlatform(blob, file.originalName || file.name || 'download');
      } catch (error) {
        if (isShareDismissed(error)) return;
        await showAppAlert(error instanceof Error ? error.message : 'Failed to open file.', 'Open failed');
      }
    })();
  }

  function getDisplayFileName(file) {
    return String(file.name || file.originalName || 'Untitled file');
  }

  function openRenameFileModal(folderId, file) {
    setFileNameDraft({
      folderId,
      fileId: file.id,
      eyebrow: 'File',
      title: 'Rename file',
      description: `Update the file name for ${getDisplayFileName(file)}.`,
      label: 'File name',
      placeholder: 'File name',
      value: getDisplayFileName(file),
      saveLabel: 'Save name',
    });
  }

  async function saveFileNameDraft() {
    if (!fileNameDraft) return;
    const draft = fileNameDraft;
    const nextName = String(draft.value || '').trim();
    if (!nextName) return;
    setFileNameDraft(null);
    await runFilesMutation((currentProject) => ({
      ...currentProject,
      files: {
        folders: (currentProject.files?.folders || []).map((folder) =>
          folder.id === draft.folderId
            ? {
                ...folder,
                files: (folder.files || []).map((file) =>
                  file.id === draft.fileId
                    ? {
                        ...file,
                        name: nextName,
                      }
                    : file,
                ),
              }
            : folder,
        ),
      },
    }));
  }

  async function deleteProjectFile(folderId, fileId) {
    if (!project?.id) return;
    const confirmed = await showAppConfirm('Delete this file?', {
      title: 'Delete file',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    void (async () => {
      setSaving(true);
      try {
        const currentProject = data.projects.find((item) => item.id === project.id);
        if (!currentProject) return;
        const targetFolder = (currentProject.files?.folders || []).find((folder) => folder.id === folderId);
        const targetFile = targetFolder?.files?.find((file) => file.id === fileId);
        if (targetFile?.storagePath) {
          await deleteProjectFileFromStorage(targetFile);
        }
        const nextProject = {
          ...currentProject,
          files: {
            folders: (currentProject.files?.folders || []).map((folder) =>
              folder.id === folderId
                ? {
                    ...folder,
                    files: (folder.files || []).filter((file) => file.id !== fileId),
                  }
                : folder,
            ),
          },
        };
        const nextState = await updateProject(data, project.id, nextProject);
        onStateChange(nextState);
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to delete file.', 'Delete failed');
      } finally {
        setSaving(false);
      }
    })();
  }

  function openMoveFile(file, sourceFolderId) {
    setMoveFileDraft({
      projectId: project?.id || '',
      sourceFolderId,
      targetFolderId: sourceFolderId,
      fileId: file.id,
      fileName: getDisplayFileName(file),
      originalName: file.originalName || '',
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    });
  }

  function updateMoveFileDraft(targetFolderId) {
    setMoveFileDraft((current) => (current ? { ...current, targetFolderId } : current));
  }

  function moveProjectFile(sourceFolderId, targetFolderId, fileId) {
    if (!targetFolderId || targetFolderId === sourceFolderId) return;
    void runFilesMutation((currentProject) => {
      const sourceFolder = (currentProject.files?.folders || []).find((folder) => folder.id === sourceFolderId);
      const targetFolder = (currentProject.files?.folders || []).find((folder) => folder.id === targetFolderId);
      const fileToMove = sourceFolder?.files?.find((file) => file.id === fileId);
      if (!sourceFolder || !targetFolder || !fileToMove) return currentProject;

      return {
        ...currentProject,
        files: {
          folders: (currentProject.files?.folders || []).map((folder) => {
            if (folder.id === sourceFolderId) {
              return {
                ...folder,
                files: (folder.files || []).filter((file) => file.id !== fileId),
              };
            }
            if (folder.id === targetFolderId) {
              return {
                ...folder,
                files: [...(folder.files || []), fileToMove],
              };
            }
            return folder;
          }),
        },
      };
    });
    setMoveFileDraft(null);
  }

  function saveMoveFile() {
    if (!moveFileDraft) return;
    moveProjectFile(moveFileDraft.sourceFolderId, moveFileDraft.targetFolderId, moveFileDraft.fileId);
  }

  function renderFolderDragHandle(folder) {
    return (
      <span
        className="files-drag-handle"
        draggable={!saving}
        onDragStart={(event) => startFolderDrag(event, folder.id)}
        onDragEnd={finishDrag}
        title={`Drag to reorder folder ${folder.name}`}
        aria-label={`Drag to reorder folder ${folder.name}`}
      >
        <FluentIcon name="drag" />
      </span>
    );
  }

  function renderFileDragHandle(file, folderId) {
    return (
      <span
        className="files-drag-handle"
        draggable={!saving}
        onDragStart={(event) => startFileDrag(event, folderId, file.id)}
        onDragEnd={finishDrag}
        title={`Drag to reorder ${getDisplayFileName(file)}`}
        aria-label={`Drag to reorder ${getDisplayFileName(file)}`}
      >
        <FluentIcon name="drag" />
      </span>
    );
  }

  function renderFolderActions(folder, includeUpload = false, includeDragHandle = true) {
    return (
      <div className="panel-actions">
        {includeUpload ? (
          <>
            <input
              ref={(node) => {
                if (node) fileInputRefs.current[folder.id] = node;
              }}
              className="visually-hidden"
              type="file"
              multiple
              onChange={(event) => handleFolderUpload(folder.id, event.target.files)}
            />
            <button
              className="button secondary gantt-icon-button"
              type="button"
              onClick={() => triggerFolderUpload(folder.id)}
              disabled={saving}
              title="Upload files"
              aria-label={`Upload files to folder ${folder.name}`}
            >
              <FluentIcon name="upload" />
            </button>
          </>
        ) : null}
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => openRenameFolderModal(folder.id)}
          disabled={saving}
          title="Rename folder"
          aria-label={`Rename folder ${folder.name}`}
        >
          <FluentIcon name="edit" />
        </button>
        <button
          className="button secondary gantt-icon-button gantt-trash-button"
          type="button"
          onClick={() => void deleteFolder(folder.id)}
          disabled={saving}
          title="Delete folder"
          aria-label={`Delete folder ${folder.name}`}
        >
          <FluentIcon name="delete" />
        </button>
        {includeDragHandle ? renderFolderDragHandle(folder) : null}
      </div>
    );
  }

  function renderFileActions(file, folderId, includeDragHandle = true) {
    return (
      <div className="files-list-actions">
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => openRenameFileModal(folderId, file)}
          disabled={saving}
          title="Rename file"
          aria-label={`Rename ${getDisplayFileName(file)}`}
        >
          <FluentIcon name="edit" />
        </button>
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => openMoveFile(file, folderId)}
          disabled={saving || folders.length < 2}
          title={folders.length < 2 ? 'Add another folder to move files' : 'Move file'}
          aria-label={`Move ${getDisplayFileName(file)}`}
        >
          <FluentIcon name="move" />
        </button>
        <button
          className="button secondary gantt-icon-button gantt-trash-button"
          type="button"
          onClick={() => deleteProjectFile(folderId, file.id)}
          disabled={saving}
          title="Delete file"
          aria-label={`Delete ${getDisplayFileName(file)}`}
        >
          <FluentIcon name="delete" />
        </button>
        {includeDragHandle ? renderFileDragHandle(file, folderId) : null}
      </div>
    );
  }

  return (
    <div className="project-files-manager">
      {storageNotice ? (
        <section className="storage-banner">
          <strong>Files storage notice.</strong>
          <span>
            {storageNotice}
          </span>
        </section>
      ) : null}

      <div className="files-toolbar project-files-toolbar">
        <div className="files-toolbar-actions">
          {!hideViewToggle ? (
            <div className="people-view-toggle" role="tablist" aria-label="Files view">
              <button
                className={`people-toggle-button${effectiveViewMode === 'cards' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('cards')}
              >
                Cards
              </button>
              <button
                className={`people-toggle-button${effectiveViewMode === 'list' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('list')}
              >
                List
              </button>
            </div>
          ) : null}
          {effectiveViewMode === 'list' && folders.length ? (
            <button className="button secondary" type="button" onClick={toggleAllFoldersExpanded} disabled={saving}>
              {allFoldersExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          ) : null}
        </div>
        <button className="button primary" type="button" onClick={openCreateFolderModal} disabled={saving || readOnly}>
          Add folder
        </button>
      </div>

      {effectiveViewMode === 'cards' ? (
        folders.length ? (
          <div className="files-folder-grid">
            {folders.map((folder) => {
              const isDefault = DEFAULT_PROJECT_FILE_FOLDERS.includes(folder.name);
              return (
                <article
                  key={folder.id}
                  className={`files-folder-card${dragItem?.type === 'folder' && dragItem.folderId === folder.id ? ' is-dragging' : ''}${uploadTargetFolderId === folder.id ? ' is-upload-target' : ''}`}
                  onDragOver={(event) => handleFolderUploadDragOver(event, folder.id)}
                  onDragLeave={(event) => handleFolderUploadDragLeave(event, folder.id)}
                  onDrop={(event) => handleFolderUploadDrop(event, folder.id)}
                >
                  <div className="files-folder-header">
                    <div className="files-card-title">
                      <div>
                        <h3>{folder.name}</h3>
                        <p>{folder.files?.length || 0} file(s){isDefault ? ' • Standard folder' : ''}</p>
                      </div>
                    </div>
                    {readOnly ? null : (
                      <div className="files-card-trailing">
                        {renderFolderActions(folder, true, false)}
                        {renderFolderDragHandle(folder)}
                      </div>
                    )}
                  </div>

                  {folder.files?.length ? (
                    <div className="files-list">
                      {folder.files.map((file) => (
                        <div
                          key={file.id}
                          className={`files-list-row${dragItem?.type === 'file' && dragItem.fileId === file.id ? ' is-dragging' : ''}`}
                          onDragOver={(event) => {
                            if (dragItem?.type === 'file' && dragItem.folderId === folder.id) {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            moveFileByDrag(folder.id, file.id);
                          }}
                        >
                          <div className="files-list-copy">
                            <div className="files-card-title">
                              <div className="files-card-title-copy">
                                <button
                                  className="files-name-button"
                                  type="button"
                                  onClick={() => downloadProjectFile(file)}
                                  disabled={saving}
                                >
                                  {getDisplayFileName(file)}
                                </button>
                              </div>
                            </div>
                            <small>
                              {file.size ? `${formatFileSize(file.size)}` : ''}
                              {file.uploadedAt ? ` • ${new Date(file.uploadedAt).toLocaleDateString('en-US')}` : ''}
                            </small>
                          </div>
                          {readOnly ? null : (
                            <div className="files-card-trailing">
                              {renderFileActions(file, folder.id, false)}
                              {renderFileDragHandle(file, folder.id)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      <h3>No files yet</h3>
                      <p>Upload project documents here for {folder.name.toLowerCase()}.</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <h3>No folders yet</h3>
            <p>Add folders and upload project documents here.</p>
          </div>
        )
      ) : flatFiles.length ? (
        <div className="files-hierarchy" role="tree" aria-label="Project files hierarchy">
          {folders.map((folder) => {
            const isExpanded = expandedFolders[folder.id] !== false;
            return (
            <div
              key={folder.id}
              className={`files-hierarchy-folder${dragItem?.type === 'folder' && dragItem.folderId === folder.id ? ' is-dragging' : ''}${uploadTargetFolderId === folder.id ? ' is-upload-target' : ''}`}
              role="treeitem"
              aria-expanded={isExpanded}
              onDragOver={(event) => handleFolderUploadDragOver(event, folder.id)}
              onDragLeave={(event) => handleFolderUploadDragLeave(event, folder.id)}
              onDrop={(event) => handleFolderUploadDrop(event, folder.id)}
            >
              <div className="files-hierarchy-folder-row">
                <button
                  className="files-tree-toggle"
                  type="button"
                  onClick={() => toggleFolderExpanded(folder.id)}
                  aria-label={isExpanded ? `Collapse folder ${folder.name}` : `Expand folder ${folder.name}`}
                >
                  <FluentIcon name="chevronRight" className={`files-tree-caret${isExpanded ? ' expanded' : ''}`} />
                </button>
                <div className="files-hierarchy-folder-copy">
                  <span className="files-tree-leading-icon" aria-hidden="true">
                    <FluentIcon name="folder" />
                  </span>
                  <strong>{folder.name}</strong>
                  <small>{folder.files?.length || 0} file(s)</small>
                </div>
                {readOnly ? null : renderFolderActions(folder, true)}
              </div>

              {isExpanded ? folder.files?.length ? (
                <div className="files-hierarchy-children" role="group">
                  {folder.files.map((file) => (
                    <div
                      key={file.id}
                      className={`files-hierarchy-file-row${dragItem?.type === 'file' && dragItem.fileId === file.id ? ' is-dragging' : ''}`}
                      role="treeitem"
                      onDragOver={(event) => {
                        if (dragItem?.type === 'file' && dragItem.folderId === folder.id) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        moveFileByDrag(folder.id, file.id);
                      }}
                    >
                      <div className="files-hierarchy-file-copy">
                        <span className="files-tree-leading-icon" aria-hidden="true">
                          <FluentIcon name="document" />
                        </span>
                        <button
                          className="files-name-button"
                          type="button"
                          onClick={() => downloadProjectFile(file)}
                          disabled={saving}
                        >
                          {getDisplayFileName(file)}
                        </button>
                        <small>
                          {file.size ? `${formatFileSize(file.size)}` : ''}
                          {file.uploadedAt ? ` • ${new Date(file.uploadedAt).toLocaleDateString('en-US')}` : ''}
                        </small>
                      </div>
                      {readOnly ? null : renderFileActions(file, folder.id)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="files-tree-empty" role="group">
                  <p>Empty folder</p>
                </div>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state compact">
          <h3>No files yet</h3>
          <p>Upload your first project document to populate the list view.</p>
        </div>
      )}

      {!readOnly ? (
        <MoveFileModal
          draft={moveFileDraft}
          saving={saving}
          onChange={updateMoveFileDraft}
          onClose={() => setMoveFileDraft(null)}
          onSave={saveMoveFile}
        />
      ) : null}
      {!readOnly ? (
        <TextEntryModal
          draft={fileNameDraft}
          saving={saving}
          onChange={(value) => setFileNameDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setFileNameDraft(null)}
          onSave={saveFileNameDraft}
        />
      ) : null}
      {!readOnly ? (
        <TextEntryModal
          draft={folderNameDraft}
          saving={saving}
          onChange={(value) => setFolderNameDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setFolderNameDraft(null)}
          onSave={saveFolderNameDraft}
        />
      ) : null}
    </div>
  );
}



