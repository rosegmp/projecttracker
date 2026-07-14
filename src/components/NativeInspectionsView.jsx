import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { getVisibleProjectsForUser } from '../utils/accessUi.js';
import {
  deleteProjectFileFromStorage, downloadProjectFileFromStorage, isSupabaseStorageConfigured,
  updateProject, updateProjects, updateSettings, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import { formatTooltipDate } from '../utils/calendarUi.js';
import { isImageFile } from '../utils/fileUi.js';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { openPreview } from '../platform/platformAdapter.js';
import { DashboardStat, PageStats } from './SharedUI.jsx';
import { useEntityMutations } from '../hooks/useEntityMutations.js';

const TextEntryModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.TextEntryModal })));
const InspectionImageEditorModal = lazy(() => import('./InspectionImageEditorModal.jsx'));
const InspectionModal = lazy(() => import('./TaskInspectionDialogs.jsx').then((module) => ({ default: module.InspectionModal })));

export default function NativeInspectionsView({
  data,
  refresh,
  loading,
  onStateChange,
  readOnly = false,
  activeUser = null,
  projectFilter = 'all',
  onProjectFilterChange = () => {},
  embedded = false,
}) {
  const [inspectionDraft, setInspectionDraft] = useState(null);
  const [imageEditorDraft, setImageEditorDraft] = useState(null);
  const [subcodeDraft, setSubcodeDraft] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});
  const previewUrlsRef = useRef({});
  const { beginMutation, endMutation, isMutating } = useEntityMutations();

  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );

  useEffect(() => {
    if (!visibleProjects.length) {
      onProjectFilterChange('all');
      return;
    }
    if (projectFilter !== 'all' && !visibleProjects.some((project) => project.id === projectFilter)) {
      onProjectFilterChange('all');
    }
  }, [onProjectFilterChange, projectFilter, visibleProjects]);

  const selectedProject =
    projectFilter === 'all'
      ? null
      : visibleProjects.find((project) => project.id === projectFilter) || null;
  const inspectionSubcodes = useMemo(
    () =>
      Array.isArray(data.settings?.inspectionSubcodes)
        ? data.settings.inspectionSubcodes.filter(Boolean)
        : [],
    [data.settings],
  );
  const inspections = useMemo(() => {
    const source = selectedProject
      ? selectedProject.inspections || []
      : visibleProjects.flatMap((project) =>
          (project.inspections || []).map((inspection) => ({
            ...inspection,
            projectId: project.id,
            projectName: project.name,
          })),
        );
    return [...source].sort((left, right) => {
      const leftDate = left.date || '';
      const rightDate = right.date || '';
      const leftLabel = `${left.subcode || ''} ${left.inspectionType || ''}`.trim();
      const rightLabel = `${right.subcode || ''} ${right.inspectionType || ''}`.trim();
      return leftDate.localeCompare(rightDate) || leftLabel.localeCompare(rightLabel);
    });
  }, [selectedProject, visibleProjects]);

  const statusCounts = useMemo(() => {
    return inspections.reduce(
      (counts, inspection) => {
        counts[inspection.status] = (counts[inspection.status] || 0) + 1;
        return counts;
      },
      { requested: 0, scheduled: 0, passed: 0, failed: 0, 'follow-up': 0 },
    );
  }, [inspections]);

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
    inspections.forEach((inspection) => {
      [inspection.stickerFile, inspection.reportFile].forEach((file) => {
        if (file?.storagePath && isImageFile(file)) {
          keepIds.add(file.id);
        }
      });
    });
    setPreviewUrls((current) => {
      const next = {};
      Object.entries(current).forEach(([fileId, url]) => {
        if (keepIds.has(fileId)) {
          next[fileId] = url;
        } else {
          URL.revokeObjectURL(url);
        }
      });
      return next;
    });
  }, [inspections]);

  useEffect(() => {
    let cancelled = false;
    const imageFiles = inspections.flatMap((inspection) =>
      [inspection.stickerFile, inspection.reportFile].filter((file) => file?.storagePath && isImageFile(file)),
    );

    async function loadPreviews() {
      for (const file of imageFiles) {
        if (previewUrls[file.id]) continue;
        try {
          const blob = await downloadProjectFileFromStorage(file);
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPreviewUrls((current) => {
            if (current[file.id]) {
              URL.revokeObjectURL(url);
              return current;
            }
            return { ...current, [file.id]: url };
          });
        } catch {
          // Keep the card usable even if an image preview cannot be loaded.
        }
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [inspections, previewUrls]);

  function getInspectionAttachmentPreview(file) {
    if (!file || !isImageFile(file)) return '';
    return file.dataUrl || previewUrls[file.id] || '';
  }

  async function createInspectionAttachmentRecord(projectId, kind, file) {
    if (!isSupabaseStorageConfigured()) {
      throw new Error('Supabase Storage is not configured for inspection attachments.');
    }
    const attachmentId = `inspection-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storageMeta = await uploadProjectFileToStorage(projectId, `inspection-${kind}`, attachmentId, file);
    return {
      id: attachmentId,
      name: '',
      originalName: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString(),
      ...storageMeta,
      dataUrl: '',
    };
  }

  function startCreate() {
    const targetProject = selectedProject || visibleProjects[0] || null;
    if (!targetProject) return;
    setInspectionDraft({
      mode: 'create',
      id: '',
      projectId: targetProject.id,
      originalProjectId: targetProject.id,
      subcode: '',
      inspectionType: '',
      status: 'requested',
      date: '',
      agency: '',
      notes: '',
      stickerFile: null,
      reportFile: null,
      stickerPendingFile: null,
      reportPendingFile: null,
    });
  }

  function startEdit(inspection) {
    setInspectionDraft({
      mode: 'edit',
      id: inspection.id,
      projectId: selectedProject?.id || '',
      originalProjectId: selectedProject?.id || '',
      subcode: inspection.subcode || '',
      inspectionType: inspection.inspectionType || '',
      status: inspection.status || 'requested',
      date: inspection.date || '',
      agency: inspection.agency || '',
      notes: inspection.notes || '',
      stickerFile: inspection.stickerFile || null,
      reportFile: inspection.reportFile || null,
      stickerPendingFile: null,
      reportPendingFile: null,
    });
  }

  function updateDraft(field, value) {
    setInspectionDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleAddInspectionSubcode() {
    setSubcodeDraft({
      eyebrow: 'Inspection',
      title: 'Add subcode',
      description: 'Create a new inspection subcode for inspection entry.',
      label: 'Subcode',
      placeholder: 'Inspection subcode',
      value: '',
      saveLabel: 'Add subcode',
    });
  }

  async function saveInspectionSubcodeDraft() {
    if (!subcodeDraft) return;
    const trimmed = subcodeDraft.value.trim();
    if (!trimmed) return;
    const mutationKey = ['settings', 'inspection-subcodes'];
    beginMutation(mutationKey);
    try {
      const existing = inspectionSubcodes.some((item) => item.toLowerCase() === trimmed.toLowerCase());
      const nextSubcodes = existing ? inspectionSubcodes : [...inspectionSubcodes, trimmed];
      const nextState = await updateSettings(data, { inspectionSubcodes: nextSubcodes });
      onStateChange(nextState);
      setInspectionDraft((current) => (current ? { ...current, subcode: trimmed } : current));
      setSubcodeDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function openInspectionImageEditor(inspection, field) {
    const attachment = inspection?.[field];
    if (!attachment || !isImageFile(attachment)) return;
    try {
      let src = attachment.dataUrl || previewUrls[attachment.id] || '';
      let revokeOnClose = false;
      if (!src && attachment.storagePath) {
        const blob = await downloadProjectFileFromStorage(attachment);
        src = URL.createObjectURL(blob);
        revokeOnClose = true;
      }
      if (!src) return;
      setImageEditorDraft({
        projectId: inspection.projectId || selectedProject?.id || '',
        inspectionId: inspection.id,
        field,
        kind: field === 'reportFile' ? 'report' : 'sticker',
        title: field === 'reportFile' ? 'Failed inspection report' : 'Inspection sticker photo',
        attachment,
        src,
        revokeOnClose,
      });
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Unable to open image.', 'Open failed');
    }
  }

  function openInspectionImage(inspection, field) {
    void (async () => {
      const attachment = inspection?.[field];
      if (!attachment || !isImageFile(attachment)) return;
      try {
        let previewSource = attachment.dataUrl || previewUrls[attachment.id] || '';
        if (!previewSource && attachment.storagePath) {
          previewSource = await downloadProjectFileFromStorage(attachment);
        }
        if (!previewSource) return;
        openPreview(previewSource);
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Unable to open image.', 'Open failed');
      }
    })();
  }

  function downloadInspectionAttachment(inspection, field) {
    const attachment = inspection?.[field];
    if (!attachment) return;
    void downloadFileWithUi(attachment, { failureMessage: 'Unable to download attachment.' });
  }

  function closeInspectionImageEditor() {
    setImageEditorDraft((current) => {
      if (current?.revokeOnClose && current.src) {
        URL.revokeObjectURL(current.src);
      }
      return null;
    });
  }

  async function saveInspectionImageEdits(blob) {
    if (!imageEditorDraft?.projectId || !imageEditorDraft?.inspectionId) return;
    const mutationKey = ['inspection', imageEditorDraft.inspectionId];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === imageEditorDraft.projectId);
      if (!project) return;
      const existingInspection = (project.inspections || []).find((inspection) => inspection.id === imageEditorDraft.inspectionId);
      if (!existingInspection) return;
      const existingAttachment = existingInspection[imageEditorDraft.field];
      const fileName = existingAttachment?.originalName || `${imageEditorDraft.kind}.png`;
      const fileType = blob.type || existingAttachment?.type || 'image/png';
      const editedFile = new File([blob], fileName, { type: fileType });
      const nextAttachment = await createInspectionAttachmentRecord(project.id, imageEditorDraft.kind, editedFile);
      const nextProject = {
        ...project,
        inspections: (project.inspections || []).map((inspection) =>
          inspection.id === imageEditorDraft.inspectionId
            ? {
                ...inspection,
                [imageEditorDraft.field]: nextAttachment,
              }
            : inspection,
        ),
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
      if (existingAttachment?.storagePath) {
        try {
          await deleteProjectFileFromStorage(existingAttachment);
        } catch (error) {
          console.warn('Inspection image was saved, but old storage cleanup failed.', error);
        }
      }
      closeInspectionImageEditor();
    } finally {
      endMutation(mutationKey);
    }
  }

  async function saveInspection() {
    if (!inspectionDraft?.projectId) return;
    const mutationKey = ['inspection', inspectionDraft.id || 'create'];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === inspectionDraft.projectId);
      if (!project) return;
      const sourceProjectId = inspectionDraft.originalProjectId || inspectionDraft.projectId;
      const sourceProject = data.projects.find((item) => item.id === sourceProjectId) || null;
      const filesToDeleteAfterSave = [];
      let stickerFile = inspectionDraft.stickerFile || null;
      let reportFile = inspectionDraft.reportFile || null;
      if (inspectionDraft.stickerPendingFile) {
        if (stickerFile?.storagePath) filesToDeleteAfterSave.push(stickerFile);
        stickerFile = await createInspectionAttachmentRecord(
          project.id,
          'sticker',
          inspectionDraft.stickerPendingFile,
        );
      }
      if (inspectionDraft.reportPendingFile) {
        if (reportFile?.storagePath) filesToDeleteAfterSave.push(reportFile);
        reportFile = await createInspectionAttachmentRecord(
          project.id,
          'report',
          inspectionDraft.reportPendingFile,
        );
      }
      if (!['failed', 'follow-up'].includes(inspectionDraft.status) && reportFile?.storagePath) {
        filesToDeleteAfterSave.push(reportFile);
        reportFile = null;
      } else if (!['failed', 'follow-up'].includes(inspectionDraft.status)) {
        reportFile = null;
      }
      const nextInspection = {
        id: inspectionDraft.id || `inspection-${Date.now()}`,
        subcode: inspectionDraft.subcode.trim(),
        inspectionType: inspectionDraft.inspectionType.trim(),
        status: inspectionDraft.status,
        date: inspectionDraft.date,
        agency: inspectionDraft.agency.trim(),
        notes: inspectionDraft.notes.trim(),
        stickerFile,
        reportFile: ['failed', 'follow-up'].includes(inspectionDraft.status) ? reportFile : null,
      };
      let nextState = data;
      if (inspectionDraft.mode === 'edit' && sourceProject && sourceProject.id !== project.id) {
        const nextSourceProject = {
          ...sourceProject,
          inspections: (sourceProject.inspections || []).filter((inspection) => inspection.id !== inspectionDraft.id),
        };
        const nextTargetProject = {
          ...project,
          inspections: [...(project.inspections || []), nextInspection],
        };
        nextState = await updateProjects(nextState, [nextSourceProject, nextTargetProject]);
      } else {
        const nextProject = {
          ...project,
          inspections:
            inspectionDraft.mode === 'edit'
              ? (project.inspections || []).map((inspection) =>
                  inspection.id === inspectionDraft.id ? nextInspection : inspection,
                )
              : [...(project.inspections || []), nextInspection],
        };
        nextState = await updateProject(nextState, project.id, nextProject);
      }
      onStateChange(nextState);
      await Promise.allSettled(
        filesToDeleteAfterSave.map((file) => deleteProjectFileFromStorage(file)),
      );
      setInspectionDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function deleteInspection() {
    if (!inspectionDraft?.projectId || !inspectionDraft?.id) return;
    const confirmed = await showAppConfirm('Delete this inspection?', {
      title: 'Delete inspection',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    const mutationKey = ['inspection', inspectionDraft.id];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === (inspectionDraft.originalProjectId || inspectionDraft.projectId));
      if (!project) return;
      const existing = (project.inspections || []).find((inspection) => inspection.id === inspectionDraft.id);
      const nextProject = {
        ...project,
        inspections: (project.inspections || []).filter((inspection) => inspection.id !== inspectionDraft.id),
      };
      const nextState = await updateProject(data, project.id, nextProject);
      onStateChange(nextState);
      await Promise.allSettled(
        [existing?.stickerFile, existing?.reportFile]
          .filter((file) => file?.storagePath)
          .map((file) => deleteProjectFileFromStorage(file)),
      );
      setInspectionDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  const inspectionContent = (
    <>
      {!readOnly ? (
        <div className={`panel-actions header-scope-actions${embedded ? ' embedded-inspection-actions' : ''}`}>
          <button className="button primary" type="button" onClick={startCreate} disabled={!visibleProjects.length}>
            Add inspection
          </button>
        </div>
      ) : null}

      {visibleProjects.length ? (
        <>
          <section className={embedded ? 'project-inspection-list' : 'workspace-section'}>
            {inspections.length ? (
                <div className="inspection-grid">
                  {inspections.map((inspection) => (
                    <article key={inspection.id} className={`inspection-card inspection-${inspection.status}`}>
                      <div className="inspection-card-header">
                        <div>
                          <p className="project-status">{inspection.status}</p>
                          <h3>{inspection.subcode || 'No subcode'}</h3>
                          <p className="inspection-type">{inspection.inspectionType || 'No inspection type'}</p>
                        </div>
                        <button
                          className="button secondary gantt-icon-button"
                          type="button"
                          onClick={() => startEdit(inspection)}
                          disabled={isMutating(['inspection', inspection.id]) || readOnly}
                          title="Edit inspection"
                          aria-label={`Edit ${inspection.subcode || inspection.inspectionType || 'inspection'}`}
                        >
                          <FluentIcon name="edit" />
                        </button>
                      </div>
                      <div className="inspection-meta">
                        {!selectedProject ? <span>Project: {inspection.projectName || 'Not set'}</span> : null}
                        <span>Date: {inspection.date ? formatTooltipDate(inspection.date) : 'Not set'}</span>
                        <span>Agency: {inspection.agency || 'Not set'}</span>
                        <span>Sticker: {inspection.stickerFile?.originalName || 'Not uploaded'}</span>
                        {['failed', 'follow-up'].includes(inspection.status) ? (
                          <span>Report: {inspection.reportFile?.originalName || 'Not uploaded'}</span>
                        ) : null}
                      </div>
                      {(
                        (inspection.stickerFile && isImageFile(inspection.stickerFile)) ||
                        (inspection.reportFile && isImageFile(inspection.reportFile))
                      ) ? (
                        <div className="inspection-thumbnail-row">
                          {inspection.stickerFile && isImageFile(inspection.stickerFile) ? (
                            <div className="inspection-thumbnail-card">
                              <button
                                type="button"
                                className="inspection-thumbnail-button"
                                onClick={() => openInspectionImage(inspection, 'stickerFile')}
                                title="Open sticker image"
                              >
                                <img
                                  className="inspection-thumbnail-image"
                                  src={getInspectionAttachmentPreview(inspection.stickerFile)}
                                  alt={`${inspection.subcode || inspection.inspectionType || 'Inspection'} sticker`}
                                  loading="lazy"
                                  decoding="async"
                                />
                                <span>Sticker</span>
                              </button>
                              <div className="inspection-thumbnail-actions">
                                <button
                                  className="button secondary gantt-icon-button"
                                  type="button"
                                  onClick={() => downloadInspectionAttachment(inspection, 'stickerFile')}
                                  title="Download sticker image"
                                  aria-label={`Download ${inspection.subcode || inspection.inspectionType || 'inspection'} sticker image`}
                                >
                                  <FluentIcon name="download" />
                                </button>
                                <button
                                  className="button secondary gantt-icon-button"
                                  type="button"
                                  onClick={() => void openInspectionImageEditor(inspection, 'stickerFile')}
                                  disabled={isMutating(['inspection', inspection.id]) || readOnly}
                                  title="Edit sticker image"
                                  aria-label={`Edit ${inspection.subcode || inspection.inspectionType || 'inspection'} sticker image`}
                                >
                                  <FluentIcon name="edit" />
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {inspection.reportFile && isImageFile(inspection.reportFile) ? (
                            <div className="inspection-thumbnail-card">
                              <button
                                type="button"
                                className="inspection-thumbnail-button"
                                onClick={() => openInspectionImage(inspection, 'reportFile')}
                                title="Open report image"
                              >
                                <img
                                  className="inspection-thumbnail-image"
                                  src={getInspectionAttachmentPreview(inspection.reportFile)}
                                  alt={`${inspection.subcode || inspection.inspectionType || 'Inspection'} report`}
                                  loading="lazy"
                                  decoding="async"
                                />
                                <span>Report</span>
                              </button>
                              <div className="inspection-thumbnail-actions">
                                <button
                                  className="button secondary gantt-icon-button"
                                  type="button"
                                  onClick={() => downloadInspectionAttachment(inspection, 'reportFile')}
                                  title="Download report image"
                                  aria-label={`Download ${inspection.subcode || inspection.inspectionType || 'inspection'} report image`}
                                >
                                  <FluentIcon name="download" />
                                </button>
                                <button
                                  className="button secondary gantt-icon-button"
                                  type="button"
                                  onClick={() => void openInspectionImageEditor(inspection, 'reportFile')}
                                  disabled={isMutating(['inspection', inspection.id]) || readOnly}
                                  title="Edit report image"
                                  aria-label={`Edit ${inspection.subcode || inspection.inspectionType || 'inspection'} report image`}
                                >
                                  <FluentIcon name="edit" />
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {inspection.notes ? <p className="inspection-notes">{inspection.notes}</p> : null}
                    </article>
                  ))}
                </div>
            ) : (
                <div className="empty-state compact">
                  <h3>No inspections yet</h3>
                  <p>
                    {selectedProject
                      ? 'Add inspections for this project to track upcoming and completed approvals.'
                      : 'Choose a project and add inspections to start tracking approvals here.'}
                  </p>
                </div>
            )}
          </section>
        </>
      ) : (
        <div className="empty-state">
          <h3>No projects loaded</h3>
          <p>Create a project first, then add inspections for permits, framing, finals, and any other required reviews.</p>
        </div>
      )}

      {!embedded ? (
        <>
          <PageStats settings={data.settings}>
            <DashboardStat label="Projects" value={visibleProjects.length} tone="brand" />
            <DashboardStat label="Inspections" value={inspections.length} />
            <DashboardStat label="Requested" value={statusCounts.requested} />
            <DashboardStat label="Scheduled" value={statusCounts.scheduled} />
            <DashboardStat label="Passed" value={statusCounts.passed} />
            <DashboardStat label="Needs follow-up" value={statusCounts['follow-up'] + statusCounts.failed} />
          </PageStats>
          <div className="page-refresh-footer">
          </div>
        </>
      ) : null}

      <Suspense fallback={null}>
      {!readOnly && inspectionDraft ? (
        <InspectionModal
          draft={inspectionDraft}
          project={visibleProjects.find((project) => project.id === inspectionDraft?.projectId) || selectedProject}
          projects={visibleProjects}
          subcodes={inspectionSubcodes}
          saving={isMutating(['inspection', inspectionDraft.id || 'create'])}
          onChange={updateDraft}
          onAddSubcode={handleAddInspectionSubcode}
          onClose={() => setInspectionDraft(null)}
          onSave={saveInspection}
          onDelete={deleteInspection}
        />
      ) : null}
      {!readOnly && subcodeDraft ? (
        <TextEntryModal
          draft={subcodeDraft}
          saving={isMutating(['settings', 'inspection-subcodes'])}
          onChange={(value) => setSubcodeDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setSubcodeDraft(null)}
          onSave={saveInspectionSubcodeDraft}
        />
      ) : null}
      {imageEditorDraft ? <InspectionImageEditorModal
        draft={imageEditorDraft}
        saving={isMutating(['inspection', imageEditorDraft.inspectionId])}
        onClose={closeInspectionImageEditor}
        onSave={saveInspectionImageEdits}
      /> : null}
      </Suspense>
    </>
  );

  if (embedded) {
    return <div className="project-inspections-embedded">{inspectionContent}</div>;
  }

  return (
    <section className="panel native-panel workspace-page">
      {inspectionContent}
    </section>
  );
}
