import React, { useEffect, useRef, useState } from 'react';
import { deleteProjectFileFromStorage, downloadProjectFileFromStorage, isSupabaseStorageConfigured, updateProject, uploadProjectFileToStorage } from '../services/trackerData.js';
import { formatFileSize, isImageFile } from '../utils/fileUi.js';
import { openPreview } from '../platform/platformAdapter.js';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { showAppAlert, showAppConfirm, showUndoAction } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { useEntityMutations } from '../hooks/useEntityMutations.js';

export default function ProjectPhotosManager({ data, project, onStateChange, readOnly = false }) {
  const { beginMutation, endMutation, runMutation, isMutating } = useEntityMutations();
  const [photoNameDrafts, setPhotoNameDrafts] = useState({});
  const [editingPhotoNames, setEditingPhotoNames] = useState({});
  const [storageNotice, setStorageNotice] = useState('');
  const [previewUrls, setPreviewUrls] = useState({});
  const previewUrlsRef = useRef({});
  const dataRef = useRef(data);
  const uploadInputRef = useRef(null);
  const replacePhotoInputRefs = useRef({});

  const photos = project?.photos || [];

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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
      if (photo?.storagePath && isImageFile(photo)) {
        keepIds.add(photo.id);
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
        if (!photo?.storagePath || !isImageFile(photo) || previewUrls[photo.id]) continue;
        try {
          const blob = await downloadProjectFileFromStorage(photo);
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPreviewUrls((current) => {
            if (current[photo.id]) {
              URL.revokeObjectURL(url);
              return current;
            }
            return { ...current, [photo.id]: url };
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
    return runMutation(key, async () => {
      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = buildNextProject(currentProject);
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
      return nextState;
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
    uploadInputRef.current?.click();
  }

  function triggerReplacePhoto(photoId) {
    replacePhotoInputRefs.current[photoId]?.click();
  }

  async function handleUploadPhotos(fileList) {
    const files = Array.from(fileList || []).filter((file) => String(file.type || '').startsWith('image/'));
    if (!files.length || !project?.id) return;

    const mutationKey = ['project', project.id, 'photos-upload'];
    beginMutation(mutationKey);
    try {
      const uploadResults = await Promise.all(files.map((file) => createProjectPhotoRecord(file)));
      const uploads = uploadResults.map((result) => result.photoRecord);
      setStorageNotice('');

      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const nextProject = {
        ...currentProject,
        photos: [...(currentProject.photos || []), ...uploads],
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to upload photo.', 'Upload failed');
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      endMutation(mutationKey);
    }
  }

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
    return photo.dataUrl || previewUrls[photo.id] || '';
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
        const nextProject = {
          ...currentProject,
          photos: (currentProject.photos || []).filter((photo) => photo.id !== photoId),
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

  function openPhoto(photo) {
    void (async () => {
      try {
        let previewSource = '';
        if (photo?.storagePath && photo?.storageBucket) {
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
          <span className="project-photos-count">{photos.length} photo(s)</span>
        </div>
        <div className="panel-actions">
          <input
            ref={uploadInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => handleUploadPhotos(event.target.files)}
          />
          <button className="button primary" type="button" onClick={triggerPhotoUpload} disabled={isMutating(['project', project.id, 'photos-upload']) || readOnly}>
            {isMutating(['project', project.id, 'photos-upload']) ? 'Uploading...' : 'Add photos'}
          </button>
        </div>
      </div>

      {photos.length ? (
        <div className="photos-grid">
          {photos.map((photo) => (
            <article key={photo.id} className="photo-card">
              <button className="photo-thumb-button" type="button" onClick={() => void openPhoto(photo)}>
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
                <small className="photo-meta">
                  {photo.size ? `${formatFileSize(photo.size)}` : ''}
                  {photo.uploadedAt ? ` • ${new Date(photo.uploadedAt).toLocaleDateString('en-US')}` : ''}
                </small>
                {!readOnly ? <div className="files-list-actions photo-actions">
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
                </div> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <h3>No photos yet</h3>
          <p>Add progress photos, site photos, and finish photos for this project.</p>
        </div>
      )}
    </div>
  );
}
