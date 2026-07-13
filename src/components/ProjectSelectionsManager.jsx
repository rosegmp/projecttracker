import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildTaskAssigneeOptions, personAssignmentLabel } from '../utils/accessUi.js';
import {
  createPerson, createTask, deleteProjectFileFromStorage, downloadProjectFileFromStorage,
  isSupabaseStorageConfigured, updateProject, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import { formatTooltipDate } from '../utils/calendarUi.js';
import { dataUrlToBlob, downloadBlobForCurrentPlatform, isImageFile, isShareDismissed } from '../utils/fileUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import PersonModal from './PersonModal.jsx';
import SelectionModal from './SelectionModal.jsx';

const SELECTION_STATUS_OPTIONS = ['needs decision', 'selected', 'ordered', 'installed'];
const SELECTION_CATEGORY_OPTIONS = ['Exterior', 'Interior', 'Flooring', 'Cabinets', 'Countertops', 'Plumbing', 'Electrical', 'Paint', 'Appliances', 'Misc'];

export default function ProjectSelectionsManager({
  data,
  project,
  onStateChange,
  readOnly = false,
  highlightSelectionId = '',
  highlightToken = '',
  onOpenTask = () => {},
}) {
  const [selectionDraft, setSelectionDraft] = useState(null);
  const [personDraft, setPersonDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const [previewUrls, setPreviewUrls] = useState({});
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [activeHighlightSelectionId, setActiveHighlightSelectionId] = useState('');
  const previewUrlsRef = useRef({});
  const selectionCardRefs = useRef({});

  const selections = project?.selections || [];
  const taskMap = useMemo(
    () => new Map((data.tasks || []).map((task) => [task.id, task])),
    [data.tasks],
  );
  const vendorOptions = useMemo(
    () => buildTaskAssigneeOptions(data.subs || [], data.employees || []),
    [data.employees, data.subs],
  );
  const selectionFolderId = useMemo(() => {
    const folder =
      (project?.files?.folders || []).find((item) => String(item?.name || '').trim().toLowerCase() === 'selections') || null;
    return folder?.id || 'folder-selections';
  }, [project?.files?.folders]);

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
    selections.forEach((selection) => {
      (selection.photos || []).forEach((photo) => {
        if (photo?.storagePath && isImageFile(photo)) {
          keepIds.add(photo.id);
        }
      });
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
  }, [selections]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreviews() {
      for (const selection of selections) {
        for (const photo of selection.photos || []) {
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
            // Keep the page usable even if one preview cannot be loaded.
          }
        }
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [selections, previewUrls]);

  const filteredSelections = useMemo(() => {
    const query = searchFilter.trim().toLowerCase();
    return selections.filter((selection) => {
      if (categoryFilter !== 'all' && (selection.category || '') !== categoryFilter) return false;
      if (statusFilter !== 'all' && (selection.status || 'needs decision') !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        selection.itemName,
        selection.chosenOption,
        selection.vendor,
        selection.notes,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [categoryFilter, searchFilter, selections, statusFilter]);

  useEffect(() => {
    if (!highlightSelectionId) return;
    setCategoryFilter('all');
    setStatusFilter('all');
    setSearchFilter('');
    setActiveHighlightSelectionId(highlightSelectionId);
    const scrollTimer = window.setTimeout(() => {
      selectionCardRefs.current[highlightSelectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      setActiveHighlightSelectionId((current) => (current === highlightSelectionId ? '' : current));
    }, 2400);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightSelectionId, highlightToken]);

  async function createSelectionFileRecord(kind, file) {
    if (!project?.id) throw new Error('Project not found.');
    if (!isSupabaseStorageConfigured()) {
      throw new Error('Supabase Storage is not configured for selection uploads.');
    }
    const fileId = `selection-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folderCandidates =
      kind === 'photo'
        ? ['photos', selectionFolderId, 'folder-selections']
        : [selectionFolderId, 'folder-selections'];
    const attemptErrors = [];
    for (const folderId of folderCandidates) {
      try {
        const storageMeta = await uploadProjectFileToStorage(project.id, folderId, fileId, file);
        return {
          fileRecord: {
            id: fileId,
            name: file.name,
            originalName: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: new Date().toISOString(),
            ...storageMeta,
            dataUrl: '',
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Unknown storage upload failure.');
        attemptErrors.push(`${folderId}: ${message}`);
      }
    }
    throw new Error(
      attemptErrors.length
        ? `Supabase Storage upload failed. ${attemptErrors.join(' | ')}`
        : 'Supabase Storage upload failed for an unknown reason.',
    );
  }

  function startCreateSelection() {
    setSelectionDraft({
      mode: 'create',
      id: '',
      category: '',
      itemName: '',
      chosenOption: '',
      status: 'needs decision',
      vendor: '',
      allowance: '',
      actualCost: '',
      selectionDate: '',
      notes: '',
      attachments: [],
      photos: [],
      taskIds: [],
      pendingAttachments: [],
      pendingPhotos: [],
    });
  }

  function startEditSelection(selection) {
    setSelectionDraft({
      mode: 'edit',
      id: selection.id,
      category: selection.category || '',
      itemName: selection.itemName || '',
      chosenOption: selection.chosenOption || '',
      status: selection.status || 'needs decision',
      vendor: selection.vendor || '',
      allowance: selection.allowance ?? '',
      actualCost: selection.actualCost ?? '',
      selectionDate: selection.selectionDate || '',
      notes: selection.notes || '',
      attachments: Array.isArray(selection.attachments) ? selection.attachments : [],
      photos: Array.isArray(selection.photos) ? selection.photos : [],
      taskIds: Array.isArray(selection.taskIds) ? selection.taskIds : [],
      pendingAttachments: [],
      pendingPhotos: [],
    });
  }

  function updateSelectionDraft(field, value) {
    setSelectionDraft((current) => {
      if (!current) return current;
      if (field === 'pendingAttachments' || field === 'pendingPhotos') {
        return {
          ...current,
          [field]: [...(current[field] || []), ...value],
        };
      }
      return { ...current, [field]: value };
    });
  }

  function startCreateVendorPerson() {
    setPersonDraft({
      id: '',
      first: '',
      last: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      license: '',
      notes: '',
      tags: '',
      type: 'supplier',
    });
  }

  async function handleSaveVendorPerson() {
    if (!personDraft) return;
    if (!personDraft.first.trim() && !personDraft.last.trim() && !personDraft.company.trim()) return;
    setSaving(true);
    try {
      const nextState = await createPerson(data, personDraft.type, personDraft);
      const createdPerson = (personDraft.type === 'sub' ? nextState.subs : nextState.employees)?.at(-1);
      const nextVendor = createdPerson ? personAssignmentLabel(createdPerson) : '';
      onStateChange(nextState);
      if (nextVendor) {
        setSelectionDraft((current) => (current ? { ...current, vendor: nextVendor } : current));
      }
      setPersonDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function saveSelection() {
    if (!project?.id || !selectionDraft?.itemName.trim()) return;
    setSaving(true);
    try {
      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const existingSelection =
        selectionDraft.mode === 'edit'
          ? (currentProject.selections || []).find((item) => item.id === selectionDraft.id) || null
          : null;
      const attachmentUploads = await Promise.all(
        (selectionDraft.pendingAttachments || []).map((file) => createSelectionFileRecord('attachment', file)),
      );
      const photoUploads = await Promise.all(
        (selectionDraft.pendingPhotos || []).map((file) => createSelectionFileRecord('photo', file)),
      );
      setStorageNotice('');

      const nextSelection = {
        id: selectionDraft.id || `selection-${Date.now()}`,
        category: selectionDraft.category,
        itemName: selectionDraft.itemName.trim(),
        chosenOption: selectionDraft.chosenOption.trim(),
        status: selectionDraft.status,
        vendor: selectionDraft.vendor.trim(),
        selectionDate: selectionDraft.selectionDate,
        notes: selectionDraft.notes.trim(),
        attachments: [...(selectionDraft.attachments || []), ...attachmentUploads.map((result) => result.fileRecord)],
        photos: [...(selectionDraft.photos || []), ...photoUploads.map((result) => result.fileRecord)],
        taskIds: selectionDraft.taskIds || [],
      };

      const nextProject = {
        ...currentProject,
        selections:
          selectionDraft.mode === 'edit'
            ? (currentProject.selections || []).map((item) => (item.id === selectionDraft.id ? nextSelection : item))
            : [...(currentProject.selections || []), nextSelection],
      };
      const nextState = await updateProject(data, project.id, nextProject);
      if (existingSelection) {
        const removedFiles = [
          ...(existingSelection.attachments || []).filter(
            (file) => !(nextSelection.attachments || []).some((nextFile) => nextFile.id === file.id),
          ),
          ...(existingSelection.photos || []).filter(
            (file) => !(nextSelection.photos || []).some((nextFile) => nextFile.id === file.id),
          ),
        ];
        await Promise.allSettled(
          removedFiles
            .filter((file) => file?.storagePath)
            .map((file) => deleteProjectFileFromStorage(file)),
        );
      }
      onStateChange(nextState);
      setSelectionDraft(null);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save selection.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelection() {
    if (!project?.id || !selectionDraft?.id) return;
    const confirmed = await showAppConfirm('Delete this selection?', {
      title: 'Delete selection',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const currentProject = data.projects.find((item) => item.id === project.id);
      if (!currentProject) return;
      const existingSelection = (currentProject.selections || []).find((item) => item.id === selectionDraft.id);
      for (const file of [...(existingSelection?.attachments || []), ...(existingSelection?.photos || [])]) {
        if (file?.storagePath) {
          await deleteProjectFileFromStorage(file);
        }
      }
      const nextProject = {
        ...currentProject,
        selections: (currentProject.selections || []).filter((item) => item.id !== selectionDraft.id),
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
      setSelectionDraft(null);
    } finally {
      setSaving(false);
    }
  }

  function downloadSelectionFile(file) {
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
        await downloadBlobForCurrentPlatform(blob, file.originalName || file.name || 'selection-file');
      } catch (error) {
        if (isShareDismissed(error)) return;
        await showAppAlert(error instanceof Error ? error.message : 'Unable to download selection file.', 'Download failed');
      }
    })();
  }

  function getSelectionPhotoPreview(photo) {
    if (!photo) return '';
    return photo.dataUrl || previewUrls[photo.id] || '';
  }

  function openSelectionPhoto(photo) {
    void (async () => {
      try {
        let objectUrl = '';
        if (photo?.storagePath && photo?.storageBucket) {
          const blob = await downloadProjectFileFromStorage(photo);
          objectUrl = URL.createObjectURL(blob);
        } else if (photo?.dataUrl) {
          objectUrl = photo.dataUrl;
        } else {
          return;
        }
        window.open(objectUrl, '_blank', 'noopener');
        if (photo?.storagePath && objectUrl.startsWith('blob:')) {
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Unable to open selection photo.', 'Open failed');
      }
    })();
  }

  async function createTaskFromSelection(selection) {
    if (!project?.id || !selection?.itemName) return;
    setSaving(true);
    try {
      const taskId = `t${Date.now()}`;
      const label = selection.chosenOption
        ? `Selection follow-up: ${selection.itemName} - ${selection.chosenOption}`
        : `Selection follow-up: ${selection.itemName}`;
      const nextStateWithTask = await createTask(data, {
        id: taskId,
        label,
        projectId: project.id,
        due: '',
        assignee: selection.vendor || '',
        sourceSelectionId: selection.id || '',
        sourceSelectionProjectId: project.id,
        sourceSelectionLabel: selection.itemName || selection.chosenOption || 'Selection',
        attachments: [],
        createdAt: new Date().toISOString(),
      });
      const refreshedProject = nextStateWithTask.projects.find((item) => item.id === project.id);
      if (!refreshedProject) return;
      const nextProject = {
        ...refreshedProject,
        selections: (refreshedProject.selections || []).map((item) =>
          item.id === selection.id
            ? { ...item, taskIds: Array.from(new Set([...(item.taskIds || []), taskId])) }
            : item,
        ),
      };
      const finalState = await updateProject(nextStateWithTask, project.id, nextProject);
      onStateChange(finalState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Unable to create task from selection.', 'Task creation failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="project-selections-manager">
      {storageNotice ? (
        <section className="storage-banner">
          <strong>Selections storage notice.</strong>
          <span>
            {storageNotice}
          </span>
        </section>
      ) : null}

      <div className="files-toolbar project-files-toolbar">
        <div className="files-toolbar-actions">
          <span className="project-photos-count">
            {filteredSelections.length} of {selections.length} selection(s)
          </span>
        </div>
        {!readOnly ? (
          <div className="panel-actions">
            <button className="button primary" type="button" onClick={startCreateSelection} disabled={saving}>
              Add selection
            </button>
          </div>
        ) : null}
      </div>

      <div className="selection-filters">
        <label className="task-filter">
          <span>Category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {SELECTION_CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="task-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {SELECTION_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="task-filter selection-search">
          <span>Search</span>
          <input
            type="search"
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            placeholder="Item, option, vendor..."
          />
        </label>
      </div>

      {filteredSelections.length ? (
        <div className="selection-grid">
          {filteredSelections.map((selection) => (
            <article
              key={selection.id}
              ref={(node) => {
                if (node) {
                  selectionCardRefs.current[selection.id] = node;
                } else {
                  delete selectionCardRefs.current[selection.id];
                }
              }}
              className={`selection-card${activeHighlightSelectionId === selection.id ? ' highlighted' : ''}`}
            >
              <div className="selection-card-header">
                <div>
                  <p className="project-status">{selection.category || 'Selection'}</p>
                  <h3>{selection.itemName || 'Untitled selection'}</h3>
                  <p className="inspection-type">{selection.chosenOption || 'Option not chosen yet'}</p>
                </div>
                <span className={`status-pill status-${String(selection.status || 'needs decision').replace(/\s+/g, '-')}`}>
                  {selection.status || 'needs decision'}
                </span>
              </div>
              <div className="inspection-meta">
                <span>Vendor: {selection.vendor || 'Not set'}</span>
                <span>Date: {selection.selectionDate ? formatTooltipDate(selection.selectionDate) : 'Not set'}</span>
              </div>
              {selection.photos?.length ? (
                <div className="selection-photo-strip">
                  {selection.photos.map((photo) => (
                    <button
                      key={photo.id}
                      className="selection-photo-button"
                      type="button"
                      onClick={() => void openSelectionPhoto(photo)}
                      title={photo.originalName || photo.name || 'Selection photo'}
                    >
                      {getSelectionPhotoPreview(photo) ? (
                        <img
                          className="selection-photo-thumb"
                          src={getSelectionPhotoPreview(photo)}
                          alt={photo.originalName || photo.name || 'Selection photo'}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="selection-photo-placeholder">
                          <FluentIcon name="camera" size={18} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
              {selection.notes ? <p className="inspection-notes">{selection.notes}</p> : null}
              {(selection.attachments?.length || selection.photos?.length) ? (
                <div className="selection-file-list">
                  {(selection.attachments || []).map((file) => (
                    <button key={file.id} className="task-attachment-link-chip" type="button" onClick={() => downloadSelectionFile(file)}>
                      {file.name || file.originalName || 'Attachment'}
                    </button>
                  ))}
                  {(selection.photos || []).map((file) => (
                    <button key={file.id} className="task-attachment-link-chip" type="button" onClick={() => downloadSelectionFile(file)}>
                      {file.name || file.originalName || 'Photo'}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="selection-card-footer">
                <div className="selection-linked-tasks">
                  {selection.taskIds?.length ? (
                    (selection.taskIds || []).map((taskId, index) => {
                      const linkedTask = taskMap.get(taskId);
                      const label = linkedTask?.label || `Task ${index + 1}`;
                      return (
                        <button
                          key={taskId}
                          className="task-attachment-link-chip task-selection-link-chip"
                          type="button"
                          onClick={() => onOpenTask(taskId)}
                          disabled={saving}
                          title={label}
                        >
                          {label}
                        </button>
                      );
                    })
                  ) : (
                    <small>No tasks generated yet</small>
                  )}
                </div>
                <div className="task-row-actions">
                  {!readOnly ? (
                    <button className="button secondary" type="button" onClick={() => void createTaskFromSelection(selection)} disabled={saving}>
                      Create task
                    </button>
                  ) : null}
                  {!readOnly ? (
                    <button className="button secondary gantt-icon-button" type="button" onClick={() => startEditSelection(selection)} disabled={saving} title="Edit selection" aria-label={`Edit ${selection.itemName || 'selection'}`}>
                      <FluentIcon name="edit" />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <h3>{selections.length ? 'No selections match these filters' : 'No selections yet'}</h3>
          <p>
            {selections.length
              ? 'Try a different search or clear the category and status filters.'
              : 'Track finish choices, vendor decisions, allowances, and install follow-up for this project here.'}
          </p>
        </div>
      )}

      {!readOnly ? (
        <SelectionModal
          draft={selectionDraft}
          projectName={project?.name || ''}
          vendorOptions={vendorOptions}
          saving={saving}
          onChange={updateSelectionDraft}
          onAddPerson={startCreateVendorPerson}
          onClose={() => setSelectionDraft(null)}
          onSave={saveSelection}
          onDelete={deleteSelection}
          onDownloadFile={downloadSelectionFile}
          onRemoveAttachment={(attachmentId) =>
            setSelectionDraft((current) =>
              current
                ? {
                    ...current,
                    attachments: (current.attachments || []).filter((attachment) => attachment.id !== attachmentId),
                  }
                : current,
            )
          }
          onRemovePhoto={(photoId) =>
            setSelectionDraft((current) =>
              current
                ? {
                    ...current,
                    photos: (current.photos || []).filter((photo) => photo.id !== photoId),
                  }
                : current,
            )
          }
          onRemovePendingAttachment={(index) =>
            setSelectionDraft((current) =>
              current
                ? {
                    ...current,
                    pendingAttachments: (current.pendingAttachments || []).filter((_, fileIndex) => fileIndex !== index),
                  }
                : current,
            )
          }
          onRemovePendingPhoto={(index) =>
            setSelectionDraft((current) =>
              current
                ? {
                    ...current,
                    pendingPhotos: (current.pendingPhotos || []).filter((_, fileIndex) => fileIndex !== index),
                  }
                : current,
            )
          }
        />
      ) : null}
      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type={personDraft.type}
          isEditing={false}
          saving={saving}
          showTypeSelector
          onChange={(field, value) => setPersonDraft((current) => (current ? { ...current, [field]: value } : current))}
          onClose={() => setPersonDraft(null)}
          onSave={handleSaveVendorPerson}
          onDelete={() => {}}
        />
      ) : null}
    </div>
  );
}

