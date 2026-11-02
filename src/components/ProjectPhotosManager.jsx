import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addProjectPhotos, deleteProjectFileFromStorage, downloadProjectFileFromStorage, isSupabaseStorageConfigured, queueProjectPhotoUpload, updateProject, uploadProjectFileToStorage } from '../services/trackerData.js';
import { getOfflineAttachment } from '../services/offlineAttachmentStore.js';
import { isOfflineNetworkError } from '../services/offlineOperations.js';
import { formatFileSize, isImageFile } from '../utils/fileUi.js';
import { isNativeAndroidApp, openPreview } from '../platform/platformAdapter.js';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { showAppAlert, showAppConfirm, showUndoAction } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { buildProjectPhotoGallery, getPhotoFolderId, getProjectPhotoFolders, PROJECT_PHOTO_WORKFLOW_TYPES } from '../utils/projectPhotoGallery.js';

export default function ProjectPhotosManager({
  data,
  project,
  onStateChange,
  readOnly = false,
  canAddPhotos = !readOnly,
  incomingPhotoRequest = null,
}) {
  const { beginMutation, endMutation, runMutation, isMutating } = useEntityMutations();
  const [photoNameDrafts, setPhotoNameDrafts] = useState({});
  const [editingPhotoNames, setEditingPhotoNames] = useState({});
  const [storageNotice, setStorageNotice] = useState('');
  const [previewUrls, setPreviewUrls] = useState({});
  const [workflowRecords, setWorkflowRecords] = useState([]);
  const [workflowPhotosLoading, setWorkflowPhotosLoading] = useState(false);
  const [photoUploadDragActive, setPhotoUploadDragActive] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [editingFolderId, setEditingFolderId] = useState('');
  const previewUrlsRef = useRef({});
  const dataRef = useRef(data);
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const replacePhotoInputRefs = useRef({});
  const lastIncomingPhotoTokenRef = useRef('');
  const nativeAndroid = isNativeAndroidApp();

  const photos = useMemo(
    () => buildProjectPhotoGallery({
      project,
      tasks: data?.tasks || [],
      workflowRecords,
    }),
    [data?.tasks, project, workflowRecords],
  );
  const customPhotoFolders = useMemo(() => getProjectPhotoFolders(project), [project]);
  const photoFolders = useMemo(() => getProjectPhotoFolders(project, photos), [project, photos]);
  const filteredPhotos = useMemo(() => activeFolderId === 'all' ? photos : photos.filter((photo) => getPhotoFolderId(project, photo, photoFolders) === (activeFolderId === 'unfiled' ? '' : activeFolderId)), [activeFolderId, photoFolders, photos, project]);
  const photoGroups = useMemo(() => {
    if (activeFolderId !== 'all') return [{ id: activeFolderId, name: activeFolderId === 'unfiled' ? 'Unfiled' : photoFolders.find((folder) => folder.id === activeFolderId)?.name || 'Photos', photos: filteredPhotos }];
    const grouped = new Map(photoFolders.map((folder) => [folder.id, []]));
    grouped.set('', []);
    photos.forEach((photo) => grouped.get(getPhotoFolderId(project, photo, photoFolders) || '')?.push(photo));
    return [...photoFolders.map((folder) => ({ id: folder.id, name: folder.name, photos: grouped.get(folder.id) || [] })), { id: 'unfiled', name: 'Unfiled', photos: grouped.get('') || [] }].filter((group) => group.photos.length);
  }, [activeFolderId, filteredPhotos, photoFolders, photos, project]);
  const mainPhotoId = String(project?.mainPhotoId || '');

  useEffect(() => { setActiveFolderId('all'); setEditingFolderId(''); setFolderNameDraft(''); }, [project?.id]);
  useEffect(() => { if (activeFolderId !== 'all' && activeFolderId !== 'unfiled' && !photoFolders.some((folder) => folder.id === activeFolderId)) setActiveFolderId('all'); }, [activeFolderId, photoFolders]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowRecords([]);
    setWorkflowPhotosLoading(false);
    if (!project?.id || data?.portalMode) return () => { cancelled = true; };
    setWorkflowPhotosLoading(true);
    const service = createConstructionWorkflowService({ projectId: project.id, canEdit: false });
    void Promise.allSettled(PROJECT_PHOTO_WORKFLOW_TYPES.map(async (type) => ({
      type,
      records: (await service.list(type)).records || [],
    }))).then((results) => {
      if (cancelled) return;
      setWorkflowRecords(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
      setWorkflowPhotosLoading(false);
    });
    return () => { cancelled = true; };
  }, [data?.portalMode, project?.id]);

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const keepIds = new Set();
    photos.forEach((photo) => {
      if ((photo?.storagePath || photo?._offlineAttachmentId) && isImageFile(photo)) {
        keepIds.add(photo.galleryKey);
      }
    });
    setPreviewUrls((current) => {
      const next = {};
      Object.entries(current).forEach(([photoId, url]) => {
        if (keepIds.has(photoId)) {
          next[photoId] = url;
        } else {
          URL.revokeObjectURL(url);
        }
      });
      return next;
    });
  }, [photos]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreviews() {
      for (const photo of photos) {
        if ((!photo?.storagePath && !photo?._offlineAttachmentId) || !isImageFile(photo) || previewUrls[photo.galleryKey]) continue;
        try {
          const blob = photo._offlineAttachmentId
            ? (await getOfflineAttachment(photo._offlineAttachmentId))?.file
            : await downloadProjectFileFromStorage(photo);
          if (!(blob instanceof Blob)) continue;
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPreviewUrls((current) => {
            if (current[photo.galleryKey]) {
              URL.revokeObjectURL(url);
              return current;
            }
            return { ...current, [photo.galleryKey]: url };
          });
        } catch {
          // Leave the gallery usable even if one preview cannot be loaded.
        }
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [photos, previewUrls]);

  async function runPhotosMutation(key, buildNextProject) {
    if (!project?.id) return;
    try {
      return await runMutation(key, async () => {
        const currentState = dataRef.current;
        const currentProject = currentState.projects.find((item) => item.id === project.id);
        if (!currentProject) return;
        const nextProject = buildNextProject(currentProject);
        const nextState = await updateProject(currentState, project.id, nextProject);
        dataRef.current = nextState;
        onStateChange(nextState);
        return nextState;
      });
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save photo changes.', 'Save failed');
      return null;
    }
  }

  async function saveFolder(event) {
    event.preventDefault();
    if (readOnly || !project?.id) return;
    const name = folderNameDraft.trim();
    if (!name) return;
    if (photoFolders.some((folder) => folder.name.trim().toLowerCase() === name.toLowerCase() && folder.id !== editingFolderId)) {
      await showAppAlert('A photo folder with that name already exists.', 'Folder name in use');
      return;
    }
    const folderId = editingFolderId || `photo-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextState = await runPhotosMutation(['project', project.id, 'photo-folders'], (currentProject) => ({
      ...currentProject,
      photoFolders: editingFolderId
        ? getProjectPhotoFolders(currentProject).map((folder) => folder.id === folderId ? { ...folder, name } : folder)
        : [...getProjectPhotoFolders(currentProject), { id: folderId, name }],
    }));
    if (nextState) { setFolderNameDraft(''); setEditingFolderId(''); setActiveFolderId(folderId); }
  }

  async function deleteFolder() {
    if (readOnly || !project?.id || ['all', 'unfiled'].includes(activeFolderId)) return;
    const folder = customPhotoFolders.find((item) => item.id === activeFolderId);
    if (!folder) return;
    const confirmed = await showAppConfirm(`Delete the “${folder.name}” folder? Its photos will return to their source folders or Unfiled.`, { title: 'Delete photo folder', confirmLabel: 'Delete folder', tone: 'danger' });
    if (!confirmed) return;
    const nextState = await runPhotosMutation(['project', project.id, 'photo-folders'], (currentProject) => ({
      ...currentProject,
      photoFolders: getProjectPhotoFolders(currentProject).filter((item) => item.id !== folder.id),
      photoFolderAssignments: Object.fromEntries(Object.entries(currentProject.photoFolderAssignments || {}).filter(([, folderId]) => folderId !== folder.id)),
    }));
    if (nextState) { setActiveFolderId('all'); setEditingFolderId(''); setFolderNameDraft(''); }
  }

  async function assignPhotoToFolder(photo, folderId) {
    if (readOnly || !project?.id) return;
    await runPhotosMutation(['photo', photo.galleryKey, 'folder'], (currentProject) => {
      const assignments = { ...(currentProject.photoFolderAssignments || {}) };
      if (folderId) assignments[photo.galleryKey] = folderId;
      else if (photo.gallerySourceType !== 'project') assignments[photo.galleryKey] = '__unfiled__';
      else delete assignments[photo.galleryKey];
      return { ...currentProject, photoFolderAssignments: assignments };
    });
  }

  async function createProjectPhotoRecord(file) {
    if (!project?.id) throw new Error('Project not found.');
    if (!isSupabaseStorageConfigured()) {
      throw new Error('Supabase Storage is not configured for photo uploads.');
    }
    const photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      photoRecord: {
        id: photoId,
        name: file.name,
        originalName: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        ...(await uploadProjectFileToStorage(project.id, 'photos', photoId, file)),
        dataUrl: '',
      },
    };
  }

  function triggerPhotoUpload() {
    if (!canAddPhotos) return;
    uploadInputRef.current?.click();
  }

  function triggerReplacePhoto(photoId) {
    replacePhotoInputRefs.current[photoId]?.click();
  }

  async function handleUploadPhotos(fileList) {
    if (!canAddPhotos) return;
    const files = Array.from(fileList || []).filter((file) => String(file.type || '').startsWith('image/'));
    if (!files.length || !project?.id) return;

    const mutationKey = ['project', project.id, 'photos-upload'];
    beginMutation(mutationKey);
    try {
      const addedPhotos = [];
      for (const file of files) {
        let uploadedPhoto = null;
        try {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            addedPhotos.push(await queueProjectPhotoUpload(project.id, file));
            continue;
          }
          uploadedPhoto = (await createProjectPhotoRecord(file)).photoRecord;
          const savedPhotos = await addProjectPhotos(project.id, [uploadedPhoto]);
          addedPhotos.push(...savedPhotos);
        } catch (error) {
          if (!isOfflineNetworkError(error)) throw error;
          addedPhotos.push(await queueProjectPhotoUpload(project.id, file, uploadedPhoto));
        }
      }
      const queuedCount = addedPhotos.filter((photo) => photo._offlineStatus).length;
      setStorageNotice(queuedCount
        ? `${queuedCount} photo${queuedCount === 1 ? '' : 's'} saved on this device and will upload automatically after reconnecting.`
        : '');
      const currentState = dataRef.current;
      const nextState = {
        ...currentState,
        projects: currentState.projects.map((item) => item.id === project.id
          ? { ...item, photos: [...(item.photos || []), ...addedPhotos] }
          : item),
      };
      dataRef.current = nextState;
      onStateChange(nextState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to upload photo.', 'Upload failed');
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      endMutation(mutationKey);
    }
  }

  function isExternalFileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function handlePhotoUploadDragOver(event) {
    if (!canAddPhotos || !isExternalFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setPhotoUploadDragActive(true);
  }

  function handlePhotoUploadDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) setPhotoUploadDragActive(false);
  }

  function handlePhotoUploadDrop(event) {
    if (!canAddPhotos || !isExternalFileDrag(event)) return;
    event.preventDefault();
    setPhotoUploadDragActive(false);
    void handleUploadPhotos(event.dataTransfer.files);
  }

  useEffect(() => {
    const token = String(incomingPhotoRequest?.token || '');
    const file = incomingPhotoRequest?.sharedPhoto;
    if (!token || token === lastIncomingPhotoTokenRef.current || !(file instanceof Blob) || !canAddPhotos) return;
    lastIncomingPhotoTokenRef.current = token;
    void handleUploadPhotos([file]);
  }, [canAddPhotos, incomingPhotoRequest]);

  async function handleReplacePhoto(existingPhoto, fileList) {
    const replacement = Array.from(fileList || [])[0];
    if (!replacement || !project?.id || !existingPhoto) return;

    const mutationKey = ['photo', existingPhoto.id];
    beginMutation(mutationKey);
    try {
      const uploadResult = await createProjectPhotoRecord(replacement);
      const nextPhoto = {
        ...existingPhoto,
        ...uploadResult.photoRecord,
        id: existingPhoto.id,
        name: existingPhoto.name || uploadResult.photoRecord.name,
      };

      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = {
        ...currentProject,
        photos: (currentProject.photos || []).map((photo) => (photo.id === existingPhoto.id ? nextPhoto : photo)),
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
      if (existingPhoto?.storagePath) {
        try {
          await deleteProjectFileFromStorage(existingPhoto);
        } catch (error) {
          console.warn('Photo replacement was saved, but old storage cleanup failed.', error);
        }
      }
      setStorageNotice(
        '',
      );
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to replace photo.', 'Replace failed');
    } finally {
      const input = replacePhotoInputRefs.current[existingPhoto.id];
      if (input) input.value = '';
      endMutation(mutationKey);
    }
  }

  function getPhotoPreview(photo) {
    if (!photo) return '';
    return photo.dataUrl || previewUrls[photo.galleryKey] || '';
  }

  function updatePhotoNameDraft(photoId, value) {
    setPhotoNameDrafts((current) => ({
      ...current,
      [photoId]: value,
    }));
  }

  function getDisplayPhotoName(photo) {
    return String(photo.name || photo.originalName || 'Untitled photo');
  }

  function getPendingPhotoName(photo) {
    return String(photoNameDrafts[photo.id] ?? photo.name ?? photo.originalName ?? '');
  }

  function hasPendingPhotoName(photo) {
    return getPendingPhotoName(photo).trim() !== getDisplayPhotoName(photo).trim();
  }

  function isEditingPhotoName(photoId) {
    return editingPhotoNames[photoId] === true;
  }

  function beginPhotoRename(photo) {
    setEditingPhotoNames((current) => ({
      ...current,
      [photo.id]: true,
    }));
    setPhotoNameDrafts((current) => ({
      ...current,
      [photo.id]: current[photo.id] ?? getDisplayPhotoName(photo),
    }));
  }

  function cancelPhotoRename(photoId) {
    setEditingPhotoNames((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setPhotoNameDrafts((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
  }

  function persistPhotoName(photoId, fallbackValue = '') {
    const nextName = String(photoNameDrafts[photoId] ?? fallbackValue ?? '').trim();
    void runPhotosMutation(['photo', photoId], (currentProject) => ({
      ...currentProject,
      photos: (currentProject.photos || []).map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              name: nextName,
            }
          : photo,
      ),
    }));
    setPhotoNameDrafts((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setEditingPhotoNames((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
  }

  async function deletePhoto(photoId) {
    if (!project?.id) return;
    const confirmed = await showAppConfirm('Delete this photo?', {
      title: 'Delete photo',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    void (async () => {
      const mutationKey = ['photo', photoId];
      beginMutation(mutationKey);
      try {
        const currentState = dataRef.current;
        const currentProject = currentState.projects.find((item) => item.id === project.id);
        if (!currentProject) return;
        const photoIndex = (currentProject.photos || []).findIndex((photo) => photo.id === photoId);
        const existing = (currentProject.photos || [])[photoIndex];
        if (!existing) return;
        const wasMainPhoto = currentProject.mainPhotoId === photoId;
        const nextProject = {
          ...currentProject,
          photos: (currentProject.photos || []).filter((photo) => photo.id !== photoId),
          mainPhotoId: wasMainPhoto ? '' : currentProject.mainPhotoId,
        };
        const nextState = await updateProject(currentState, project.id, nextProject);
        dataRef.current = nextState;
        onStateChange(nextState);
        showUndoAction({
          message: `Deleted "${getDisplayPhotoName(existing)}".`,
          onUndo: async () => {
            const undoState = dataRef.current;
            const undoProject = undoState.projects.find((item) => item.id === project.id);
            if (!undoProject) return;
            const restoredPhotos = [...(undoProject.photos || [])];
            restoredPhotos.splice(Math.min(photoIndex, restoredPhotos.length), 0, existing);
            const restoredState = await updateProject(undoState, project.id, {
              ...undoProject,
              photos: restoredPhotos,
              mainPhotoId: wasMainPhoto && !undoProject.mainPhotoId ? existing.id : undoProject.mainPhotoId,
            });
            dataRef.current = restoredState;
            onStateChange(restoredState);
          },
          onCommit: () => existing.storagePath ? deleteProjectFileFromStorage(existing) : undefined,
        });
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to delete photo.', 'Delete failed');
      } finally {
        endMutation(mutationKey);
      }
    })();
  }

  function downloadPhoto(photo) {
    void downloadFileWithUi(photo, { failureMessage: 'Failed to download photo.' });
  }

  function sharePhoto(photo) {
    void downloadFileWithUi(photo, {
      action: 'share',
      failureMessage: 'Failed to share photo.',
      failureTitle: 'Share failed',
    });
  }

  function openPhoto(photo) {
    void (async () => {
      try {
        let previewSource = '';
        if (photo?._offlineAttachmentId) {
          previewSource = (await getOfflineAttachment(photo._offlineAttachmentId))?.file || '';
        } else if (photo?.storagePath && photo?.storageBucket) {
          previewSource = await downloadProjectFileFromStorage(photo);
        } else if (photo?.dataUrl) {
          previewSource = photo.dataUrl;
        } else {
          return;
        }
        openPreview(previewSource, { features: 'noopener' });
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to open photo.', 'Open failed');
      }
    })();
  }

  return (
    <div className="project-photos-manager">
      {storageNotice ? (
        <section className="storage-banner">
          <strong>Photos storage notice.</strong>
          <span>
            {storageNotice}
          </span>
        </section>
      ) : null}

      <div className="files-toolbar project-files-toolbar">
        <div className="files-toolbar-actions">
          <span className="project-photos-count">{photos.length} photo(s) from all project tabs{workflowPhotosLoading ? ' · Loading more…' : ''}</span>
        </div>
        {canAddPhotos ? <div className="panel-actions">
          <input
            ref={uploadInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => handleUploadPhotos(event.target.files)}
          />
          <button
            className={`project-upload-drop-zone project-photos-upload-drop-zone${photoUploadDragActive ? ' is-drag-over' : ''}`}
            type="button"
            onClick={triggerPhotoUpload}
            onDragOver={handlePhotoUploadDragOver}
            onDragLeave={handlePhotoUploadDragLeave}
            onDrop={handlePhotoUploadDrop}
            disabled={isMutating(['project', project.id, 'photos-upload'])}
          >
            <FluentIcon name="upload" />
            <span><strong>Drop photos here</strong><small>or choose images</small></span>
          </button>
          {nativeAndroid ? (
            <>
              <input
                ref={cameraInputRef}
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  void handleUploadPhotos(event.target.files);
                  event.target.value = '';
                }}
              />
              <button className="button secondary" type="button" onClick={() => cameraInputRef.current?.click()} disabled={isMutating(['project', project.id, 'photos-upload'])}>
                <FluentIcon name="camera" size={16} />
                Take photo
              </button>
            </>
          ) : null}
          <button className="button primary" type="button" onClick={triggerPhotoUpload} disabled={isMutating(['project', project.id, 'photos-upload'])}>
            {isMutating(['project', project.id, 'photos-upload']) ? 'Uploading...' : 'Add photos'}
          </button>
        </div> : null}
      </div>

      <div className="photo-folder-toolbar">
        <div className="photo-folder-list" role="group" aria-label="Photo folders">
          <button className={`photo-folder-button${activeFolderId === 'all' ? ' active' : ''}`} type="button" onClick={() => setActiveFolderId('all')} aria-pressed={activeFolderId === 'all'}>All photos <span>{photos.length}</span></button>
          <button className={`photo-folder-button${activeFolderId === 'unfiled' ? ' active' : ''}`} type="button" onClick={() => setActiveFolderId('unfiled')} aria-pressed={activeFolderId === 'unfiled'}>Unfiled <span>{photos.filter((photo) => !getPhotoFolderId(project, photo, photoFolders)).length}</span></button>
          {photoFolders.map((folder) => <button key={folder.id} className={`photo-folder-button${activeFolderId === folder.id ? ' active' : ''}`} type="button" onClick={() => setActiveFolderId(folder.id)} aria-pressed={activeFolderId === folder.id}><FluentIcon name="folder" size={16} />{folder.name}<span>{photos.filter((photo) => getPhotoFolderId(project, photo, photoFolders) === folder.id).length}</span></button>)}
        </div>
        {!readOnly ? <div className="photo-folder-actions">
          <form className="photo-folder-form" onSubmit={(event) => void saveFolder(event)}>
            <input type="text" aria-label={editingFolderId ? 'Rename photo folder' : 'New photo folder name'} placeholder={editingFolderId ? 'Rename folder' : 'New folder name'} value={folderNameDraft} onChange={(event) => setFolderNameDraft(event.target.value)} maxLength={80} />
            <button className="button secondary" type="submit" disabled={!folderNameDraft.trim() || isMutating(['project', project.id, 'photo-folders'])}>{editingFolderId ? 'Save name' : 'Add folder'}</button>
            {editingFolderId ? <button className="button secondary" type="button" onClick={() => { setEditingFolderId(''); setFolderNameDraft(''); }}>Cancel</button> : null}
          </form>
          {customPhotoFolders.some((folder) => folder.id === activeFolderId) ? <div className="photo-folder-manage">
            <button className="button secondary gantt-icon-button" type="button" title="Rename folder" aria-label="Rename folder" onClick={() => { setEditingFolderId(activeFolderId); setFolderNameDraft(photoFolders.find((folder) => folder.id === activeFolderId)?.name || ''); }}><FluentIcon name="edit" /></button>
            <button className="button secondary gantt-icon-button gantt-trash-button" type="button" title="Delete folder" aria-label="Delete folder" disabled={isMutating(['project', project.id, 'photo-folders'])} onClick={() => void deleteFolder()}><FluentIcon name="delete" /></button>
          </div> : null}
        </div> : null}
      </div>

      {filteredPhotos.length ? (
        <div className="photo-folder-groups">
          {photoGroups.map((group, groupIndex) => (
            <section key={group.id} className="photo-folder-group" aria-label={`${group.name} photos`}>
              <div className="photo-folder-group-header">
                <h3 id={`photo-source-heading-${groupIndex}`}>{group.name}</h3>
                <span>{group.photos.length} photo{group.photos.length === 1 ? '' : 's'}</span>
              </div>
              <div className="photos-grid">
          {group.photos.map((photo) => {
            const isProjectPhoto = photo.gallerySourceType === 'project';
            const isMainPhoto = isProjectPhoto && photo.id === mainPhotoId;
            const isQueuedPhoto = Boolean(photo._offlineStatus);
            return (
            <article key={photo.galleryKey} className={`photo-card${isMainPhoto ? ' is-main-photo' : ''}`}>
              <button className="photo-thumb-button" type="button" onClick={() => void openPhoto(photo)}>
                {isMainPhoto ? (
                  <span className="main-photo-badge">
                    <FluentIcon name="check" size={14} />
                    Main photo
                  </span>
                ) : null}
                {getPhotoPreview(photo) ? (
                  <img
                    className="photo-thumb"
                    src={getPhotoPreview(photo)}
                    alt={getDisplayPhotoName(photo)}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="photo-placeholder">
                    <FluentIcon name="camera" size={28} />
                    <small>Preview unavailable</small>
                  </div>
                )}
              </button>
              <div className="photo-card-body">
                {isEditingPhotoName(photo.id) ? (
                  <form
                    className="inline-save-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (isMutating(['photo', photo.id]) || !hasPendingPhotoName(photo)) return;
                      persistPhotoName(photo.id, getDisplayPhotoName(photo));
                    }}
                  >
                    <input
                      className="files-name-input"
                      type="text"
                      value={getPendingPhotoName(photo)}
                      placeholder="Photo name"
                      onChange={(event) => updatePhotoNameDraft(photo.id, event.target.value)}
                    />
                  </form>
                ) : (
                  <strong>{getDisplayPhotoName(photo)}</strong>
                )}
                <small className="photo-source-caption">{photo.gallerySourceItem || photo.gallerySource}</small>
                {!readOnly ? <label className="photo-folder-field"><span>Folder</span><select aria-label={`Folder for ${getDisplayPhotoName(photo)}`} value={getPhotoFolderId(project, photo, photoFolders)} onChange={(event) => void assignPhotoToFolder(photo, event.target.value)} disabled={isMutating(['photo', photo.galleryKey, 'folder'])}><option value="">Unfiled</option>{photoFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label> : getPhotoFolderId(project, photo, photoFolders) ? <small className="photo-folder-label">{photoFolders.find((folder) => folder.id === getPhotoFolderId(project, photo, photoFolders))?.name}</small> : null}
                <small className="photo-meta">
                  {photo.size ? `${formatFileSize(photo.size)}` : ''}
                  {photo.uploadedAt ? ` • ${new Date(photo.uploadedAt).toLocaleDateString('en-US')}` : ''}
                </small>
                {isQueuedPhoto ? <span className={`status-pill ${photo._offlineStatus === 'needs-attention' ? 'danger' : 'warning'}`}>
                  {photo._offlineStatus === 'syncing' ? 'Uploading…' : photo._offlineStatus === 'needs-attention' ? 'Needs attention' : 'Saved on device'}
                </span> : null}
                {isQueuedPhoto ? <div className="files-list-actions photo-actions">
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => void openPhoto(photo)} title="Open saved photo" aria-label={`Open ${getDisplayPhotoName(photo)}`}><FluentIcon name="eye" /></button>
                </div> : isProjectPhoto && !readOnly ? <div className="files-list-actions photo-actions">
                  <input
                    ref={(node) => {
                      if (node) replacePhotoInputRefs.current[photo.id] = node;
                    }}
                    className="visually-hidden"
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleReplacePhoto(photo, event.target.files)}
                  />
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => void openPhoto(photo)}
                    title="Open photo"
                    aria-label={`Open ${photo.name || photo.originalName || 'photo'}`}
                  >
                      <FluentIcon name="eye" />
                  </button>
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => downloadPhoto(photo)}
                    title="Download photo"
                    aria-label={`Download ${getDisplayPhotoName(photo)}`}
                  >
                    <FluentIcon name="download" />
                  </button>
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => sharePhoto(photo)}
                    title="Share photo"
                    aria-label={`Share ${getDisplayPhotoName(photo)}`}
                  >
                    <FluentIcon name="share" />
                  </button>
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => triggerReplacePhoto(photo.id)}
                    disabled={isMutating(['photo', photo.id])}
                    title="Replace photo"
                    aria-label={`Replace ${getDisplayPhotoName(photo)}`}
                  >
                    <FluentIcon name="replace" />
                  </button>
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => (isEditingPhotoName(photo.id) ? cancelPhotoRename(photo.id) : beginPhotoRename(photo))}
                    disabled={isMutating(['photo', photo.id])}
                    title={isEditingPhotoName(photo.id) ? 'Cancel rename' : 'Rename photo'}
                    aria-label={`${isEditingPhotoName(photo.id) ? 'Cancel rename for' : 'Rename'} ${getDisplayPhotoName(photo)}`}
                  >
                    <FluentIcon name="edit" />
                  </button>
                  <button
                    className="button secondary gantt-icon-button gantt-trash-button"
                    type="button"
                    onClick={() => deletePhoto(photo.id)}
                    disabled={isMutating(['photo', photo.id])}
                    title="Delete photo"
                    aria-label={`Delete ${getDisplayPhotoName(photo)}`}
                  >
                    <FluentIcon name="delete" />
                  </button>
                </div> : !isProjectPhoto ? <div className="files-list-actions photo-actions">
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => void openPhoto(photo)} title="Open photo" aria-label={`Open ${getDisplayPhotoName(photo)}`}><FluentIcon name="eye" /></button>
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => downloadPhoto(photo)} title="Download photo" aria-label={`Download ${getDisplayPhotoName(photo)}`}><FluentIcon name="download" /></button>
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => sharePhoto(photo)} title="Share photo" aria-label={`Share ${getDisplayPhotoName(photo)}`}><FluentIcon name="share" /></button>
                </div> : <div className="files-list-actions photo-actions">
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => void openPhoto(photo)} title="Open photo" aria-label={`Open ${getDisplayPhotoName(photo)}`}><FluentIcon name="eye" /></button>
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => downloadPhoto(photo)} title="Download photo" aria-label={`Download ${getDisplayPhotoName(photo)}`}><FluentIcon name="download" /></button>
                  <button className="button secondary gantt-icon-button" type="button" onClick={() => sharePhoto(photo)} title="Share photo" aria-label={`Share ${getDisplayPhotoName(photo)}`}><FluentIcon name="share" /></button>
                </div>}
              </div>
            </article>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <h3>{photos.length ? 'No photos in this folder' : 'No photos yet'}</h3>
          <p>{photos.length ? 'Choose another folder or assign photos here from All photos.' : canAddPhotos ? 'Add progress photos, site photos, and finish photos for this project.' : 'Photos uploaded by the project team will appear here.'}</p>
        </div>
      )}
    </div>
  );
}
