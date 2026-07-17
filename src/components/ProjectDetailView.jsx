import React, { lazy, Suspense, useEffect, useState } from 'react';
import { downloadProjectFileFromStorage } from '../services/trackerData.js';
import { formatShortDate } from '../utils/calendarUi.js';
import FluentIcon from './FluentIcon.jsx';

const NativeInspectionsView = lazy(() => import('./NativeInspectionsView.jsx'));
const NativeTasksView = lazy(() => import('./NativeTasksView.jsx'));
const ProjectDetailCalendar = lazy(() => import('./ProjectDetailCalendar.jsx'));
const ProjectFilesManager = lazy(() => import('./ProjectFilesManager.jsx'));
const ProjectPhotosManager = lazy(() => import('./ProjectPhotosManager.jsx'));
const ProjectSelectionsManager = lazy(() => import('./ProjectSelectionsManager.jsx'));
const TakeoffWorkspace = lazy(() => import('../features/takeoff/TakeoffWorkspace.jsx'));

function ProjectOverviewMainPhoto({ project }) {
  const mainPhoto = (project?.photos || []).find((photo) => photo.id === project?.mainPhotoId) || null;
  const [previewUrl, setPreviewUrl] = useState(mainPhoto?.dataUrl || '');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setPreviewUrl(mainPhoto?.dataUrl || '');

    if (mainPhoto?.storagePath && mainPhoto?.storageBucket) {
      void downloadProjectFileFromStorage(mainPhoto)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        })
        .catch(() => {
          // Keep the rest of the overview available if the selected photo cannot be loaded.
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mainPhoto?.dataUrl, mainPhoto?.id, mainPhoto?.storageBucket, mainPhoto?.storagePath]);

  if (!mainPhoto) return null;
  const photoName = String(mainPhoto.name || mainPhoto.originalName || 'Main project photo');

  return (
    <figure className="project-overview-main-photo">
      {previewUrl ? (
        <img src={previewUrl} alt={`${project.name || 'Project'} main photo`} />
      ) : (
        <div className="project-overview-main-photo-placeholder">
          <FluentIcon name="camera" size={32} />
          <span>Photo preview unavailable</span>
        </div>
      )}
      <figcaption>
        <span className="main-photo-badge is-static">
          <FluentIcon name="check" size={14} />
          Main photo
        </span>
        <strong>{photoName}</strong>
      </figcaption>
    </figure>
  );
}

export default function ProjectDetailView({
  data,
  project,
  tasks,
  settings,
  canEdit = true,
  activeUser = null,
  selectionNavigationRequest = null,
  onEdit,
  onDateClick,
  onCalendarItemClick,
  onStateChange,
}) {
  const [activeDetailTab, setActiveDetailTab] = useState('overview');
  const [selectionHighlightRequest, setSelectionHighlightRequest] = useState(null);
  const [taskHighlightRequest, setTaskHighlightRequest] = useState(null);
  const blockLotLabel =
    project.block || project.lot
      ? [project.block ? `Block ${project.block}` : '', project.lot ? `Lot ${project.lot}` : ''].filter(Boolean).join(' • ')
      : 'Not set';

  useEffect(() => {
    setActiveDetailTab('overview');
  }, [project.id]);

  useEffect(() => {
    const requestedTab = selectionNavigationRequest?.detailTab;
    if (selectionNavigationRequest?.projectId !== project.id) return;
    if (!['overview', 'tasks', 'calendar', 'inspections', 'selections', 'takeoff', 'files', 'photos'].includes(requestedTab)) return;
    setActiveDetailTab(requestedTab);
    if (requestedTab === 'selections' && selectionNavigationRequest?.selectionId) {
      setSelectionHighlightRequest(selectionNavigationRequest);
    }
  }, [project.id, selectionNavigationRequest]);

  return (
    <div className="project-detail-page">
      <div
        className="project-detail-tabs"
        role="tablist"
        aria-label={`${project.name} sections`}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
          const currentIndex = tabs.indexOf(event.target);
          if (currentIndex < 0) return;
          event.preventDefault();
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        }}
      >
        <button
          id="project-tab-overview"
          className={`react-tab${activeDetailTab === 'overview' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'overview' ? 'true' : 'false'}
          aria-controls="project-panel-overview"
          tabIndex={activeDetailTab === 'overview' ? 0 : -1}
          onClick={() => setActiveDetailTab('overview')}
        >
          Overview
        </button>
        <button
          id="project-tab-tasks"
          className={`react-tab${activeDetailTab === 'tasks' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'tasks' ? 'true' : 'false'}
          aria-controls="project-panel-tasks"
          tabIndex={activeDetailTab === 'tasks' ? 0 : -1}
          onClick={() => setActiveDetailTab('tasks')}
        >
          Tasks
        </button>
        <button
          id="project-tab-calendar"
          className={`react-tab${activeDetailTab === 'calendar' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'calendar' ? 'true' : 'false'}
          aria-controls="project-panel-calendar"
          tabIndex={activeDetailTab === 'calendar' ? 0 : -1}
          onClick={() => setActiveDetailTab('calendar')}
        >
          Calendar
        </button>
        <button
          id="project-tab-inspections"
          className={`react-tab${activeDetailTab === 'inspections' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'inspections' ? 'true' : 'false'}
          aria-controls="project-panel-inspections"
          tabIndex={activeDetailTab === 'inspections' ? 0 : -1}
          onClick={() => setActiveDetailTab('inspections')}
        >
          Inspections
        </button>
        <button
          id="project-tab-selections"
          className={`react-tab${activeDetailTab === 'selections' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'selections' ? 'true' : 'false'}
          aria-controls="project-panel-selections"
          tabIndex={activeDetailTab === 'selections' ? 0 : -1}
          onClick={() => setActiveDetailTab('selections')}
        >
          Selections
        </button>
        <button
          id="project-tab-takeoff"
          className={`react-tab${activeDetailTab === 'takeoff' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'takeoff' ? 'true' : 'false'}
          aria-controls="project-panel-takeoff"
          tabIndex={activeDetailTab === 'takeoff' ? 0 : -1}
          onClick={() => setActiveDetailTab('takeoff')}
        >
          Takeoff
        </button>
        <button
          id="project-tab-files"
          className={`react-tab${activeDetailTab === 'files' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'files' ? 'true' : 'false'}
          aria-controls="project-panel-files"
          tabIndex={activeDetailTab === 'files' ? 0 : -1}
          onClick={() => setActiveDetailTab('files')}
        >
          Files
        </button>
        <button
          id="project-tab-photos"
          className={`react-tab${activeDetailTab === 'photos' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'photos' ? 'true' : 'false'}
          aria-controls="project-panel-photos"
          tabIndex={activeDetailTab === 'photos' ? 0 : -1}
          onClick={() => setActiveDetailTab('photos')}
        >
          Photos
        </button>
      </div>

      {activeDetailTab === 'overview' ? (
        <section id="project-panel-overview" className="project-detail-section project-detail-overview project-detail-overview-full" role="tabpanel" aria-labelledby="project-tab-overview">
          <div className="panel-header">
            <div>
              <h3>Project Details</h3>
            </div>
            {canEdit ? (
              <button className="button primary" type="button" onClick={() => onEdit(project)}>
                Edit project
              </button>
            ) : null}
          </div>
          <ProjectOverviewMainPhoto project={project} />
          <dl className="project-facts project-detail-facts">
            <div>
              <dt>Address</dt>
              <dd>{project.address || 'Not set'}</dd>
            </div>
            <div>
              <dt>Permit #</dt>
              <dd>{project.permitNumber || 'Not set'}</dd>
            </div>
            <div>
              <dt>Block / Lot</dt>
              <dd>{blockLotLabel}</dd>
            </div>
            <div>
              <dt>DR #</dt>
              <dd>{project.drNumber || 'Not set'}</dd>
            </div>
            <div>
              <dt>Start date</dt>
              <dd>{project.start ? formatShortDate(project.start) : 'Not set'}</dd>
            </div>
            <div>
              <dt>End date</dt>
              <dd>{project.end ? formatShortDate(project.end) : 'Not set'}</dd>
            </div>
            <div className="project-fact-compact">
              <dt>Customer</dt>
              <dd>{project.customerName || 'Not set'}</dd>
            </div>
            <div className="project-fact-compact">
              <dt>Customer phone</dt>
              <dd>{project.customerPhone || 'Not set'}</dd>
            </div>
            <div className="project-fact-compact">
              <dt>Customer email</dt>
              <dd>{project.customerEmail || 'Not set'}</dd>
            </div>
            <div className="project-fact-wide">
              <dt>Customer address</dt>
              <dd>{project.customerAddress || 'Not set'}</dd>
            </div>
          </dl>
          {project.desc ? (
            <div className="project-detail-note">
              <strong>Description</strong>
              <p>{project.desc}</p>
            </div>
          ) : null}
          {project.customerNotes ? (
            <div className="project-detail-note">
              <strong>Customer notes</strong>
              <p>{project.customerNotes}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <Suspense fallback={<div className="empty-state compact"><p>Loading project workspace...</p></div>}>
      {activeDetailTab === 'tasks' ? (
        <section id="project-panel-tasks" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-tasks">
          <NativeTasksView
            data={data}
            onStateChange={onStateChange}
            refresh={() => {}}
            loading={false}
            activeUser={activeUser}
            projectFilter={project.id}
            onProjectFilterChange={() => {}}
            embedded
            lockedProjectId={project.id}
            highlightTaskId={taskHighlightRequest?.taskId || ''}
            highlightToken={taskHighlightRequest?.token || ''}
            onOpenSelection={(selectionLink) => {
              setActiveDetailTab('selections');
              setSelectionHighlightRequest({
                ...selectionLink,
                token: `${selectionLink.selectionId}-${Date.now()}`,
              });
            }}
          />
        </section>
      ) : null}

      {activeDetailTab === 'calendar' ? (
        <section id="project-panel-calendar" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-calendar">
          <ProjectDetailCalendar
            project={project}
            tasks={tasks}
            settings={settings}
            onDateClick={onDateClick}
            onItemClick={onCalendarItemClick}
          />
        </section>
      ) : null}

      {activeDetailTab === 'inspections' ? (
        <section id="project-panel-inspections" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-inspections">
          <NativeInspectionsView
            data={data}
            refresh={() => {}}
            loading={false}
            onStateChange={onStateChange}
            readOnly={!canEdit}
            activeUser={activeUser}
            projectFilter={project.id}
            onProjectFilterChange={() => {}}
            embedded
          />
        </section>
      ) : null}

      {activeDetailTab === 'selections' ? (
        <section id="project-panel-selections" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-selections">
          <ProjectSelectionsManager
            data={data}
            project={project}
            onStateChange={onStateChange}
            readOnly={!canEdit}
            highlightSelectionId={selectionHighlightRequest?.selectionId || ''}
            highlightToken={selectionHighlightRequest?.token || ''}
            onOpenTask={(taskId) => {
              setActiveDetailTab('tasks');
              setTaskHighlightRequest({
                taskId,
                token: `${taskId}-${Date.now()}`,
              });
            }}
          />
        </section>
      ) : null}

      {activeDetailTab === 'files' ? (
        <section id="project-panel-files" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-files">
          <ProjectFilesManager
            data={data}
            project={project}
            onStateChange={onStateChange}
            readOnly={!canEdit}
            forcedViewMode="list"
            hideViewToggle
          />
        </section>
      ) : null}

      {activeDetailTab === 'takeoff' ? (
        <section id="project-panel-takeoff" className="project-detail-section project-detail-subtab-panel project-takeoff-panel" role="tabpanel" aria-labelledby="project-tab-takeoff">
          <TakeoffWorkspace projectId={project.id} canEdit={canEdit} />
        </section>
      ) : null}

      {activeDetailTab === 'photos' ? (
        <section id="project-panel-photos" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-photos">
          <ProjectPhotosManager data={data} project={project} onStateChange={onStateChange} readOnly={!canEdit} />
        </section>
      ) : null}
      </Suspense>

    </div>
  );
}
