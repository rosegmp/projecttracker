import React, { lazy, Suspense, useEffect, useState } from 'react';
import { downloadProjectFileFromStorage, loadAuditEvents } from '../services/trackerData.js';
import { buildAuditTrailEntries } from '../utils/auditTrail.js';
import { formatShortDate } from '../utils/calendarUi.js';
import FluentIcon from './FluentIcon.jsx';

const NativeInspectionsView = lazy(() => import('./NativeInspectionsView.jsx'));
const NativeTasksView = lazy(() => import('./NativeTasksView.jsx'));
const ProjectDetailCalendar = lazy(() => import('./ProjectDetailCalendar.jsx'));
const ProjectFilesManager = lazy(() => import('./ProjectFilesManager.jsx'));
const ProjectBudgetCommitmentsManager = lazy(() => import('./ProjectBudgetCommitmentsManager.jsx'));
const ProjectPhotosManager = lazy(() => import('./ProjectPhotosManager.jsx'));
const ProjectPortalManager = lazy(() => import('./ProjectPortalManager.jsx'));
const ProjectRfiSubmittalsManager = lazy(() => import('./ProjectRfiSubmittalsManager.jsx'));
const ProjectSelectionsManager = lazy(() => import('./ProjectSelectionsManager.jsx'));
const ProjectWarrantyCloseoutManager = lazy(() => import('./ProjectWarrantyCloseoutManager.jsx'));
const ProjectWorkflowManager = lazy(() => import('./ProjectWorkflowManager.jsx'));
const TakeoffWorkspace = lazy(() => import('../features/takeoff/TakeoffWorkspace.jsx'));

const CUSTOMER_READ_ONLY_TABS = new Set(['overview', 'portal', 'calendar', 'selections', 'warranty-closeout', 'files', 'photos']);
const SUBCONTRACTOR_READ_ONLY_TABS = new Set(['portal', 'selections', 'files']);

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

  return (
    <figure className={`home-project-photo project-overview-hero-photo${project.mainPhotoCrop ? ' is-cropped' : ''}`}>
      {previewUrl ? (
        <img src={previewUrl} alt={`${project.name || 'Project'} main photo`} />
      ) : (
        <div className="home-project-photo-placeholder">
          <FluentIcon name="camera" size={32} />
          <strong>{mainPhoto ? 'Photo preview unavailable' : 'Select a main project photo'}</strong>
          <span>Choose the main image from Edit Project.</span>
        </div>
      )}
    </figure>
  );
}

function ProjectOverviewRecentPhotos({ photos, onOpenPhotos }) {
  const recentPhotos = [...(photos || [])].slice(-3).reverse();
  const [previewUrls, setPreviewUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    const objectUrls = [];
    setPreviewUrls(Object.fromEntries(recentPhotos.filter((photo) => photo.dataUrl).map((photo) => [photo.id, photo.dataUrl])));

    void Promise.all(recentPhotos.map(async (photo) => {
      if (!photo.storagePath || !photo.storageBucket) return;
      try {
        const blob = await downloadProjectFileFromStorage(photo);
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        setPreviewUrls((current) => ({ ...current, [photo.id]: objectUrl }));
      } catch {
        // Keep the strip available when an individual preview cannot be loaded.
      }
    }));

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photos]);

  if (!recentPhotos.length) return <p className="project-overview-empty-copy">No project photos yet.</p>;
  return (
    <div className="project-overview-recent-photos">
      {recentPhotos.map((photo) => (
        <button key={photo.id} type="button" onClick={onOpenPhotos} aria-label={`Open project photos: ${photo.name || photo.originalName || 'photo'}`}>
          {previewUrls[photo.id] ? <img src={previewUrls[photo.id]} alt="" /> : <FluentIcon name="camera" size={20} />}
        </button>
      ))}
    </div>
  );
}

function isInspectionComplete(inspection) {
  return ['passed', 'complete', 'completed', 'done'].includes(String(inspection?.status || '').trim().toLowerCase());
}

function formatActivityTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function ProjectDetailView({
  data,
  project,
  tasks,
  settings,
  canEdit = true,
  activeUser = null,
  deferredDataLoading = false,
  selectionNavigationRequest = null,
  onEdit,
  onDateClick,
  onCalendarItemClick,
  onStateChange,
}) {
  const externalPortalUser = ['Customer', 'Subcontractor'].includes(activeUser?.role);
  const customerReadOnly = activeUser?.role === 'Customer';
  const subcontractorReadOnly = activeUser?.role === 'Subcontractor';
  const [activeDetailTab, setActiveDetailTab] = useState(() => (subcontractorReadOnly ? 'portal' : 'overview'));
  const [selectionHighlightRequest, setSelectionHighlightRequest] = useState(null);
  const [taskHighlightRequest, setTaskHighlightRequest] = useState(null);
  const [lastActivity, setLastActivity] = useState(null);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const blockLotLabel =
    project.block || project.lot
      ? [project.block ? `Block ${project.block}` : '', project.lot ? `Lot ${project.lot}` : ''].filter(Boolean).join(' • ')
      : 'Not set';

  useEffect(() => {
    setActiveDetailTab(subcontractorReadOnly ? 'portal' : 'overview');
  }, [subcontractorReadOnly, project.id]);

  useEffect(() => {
    let cancelled = false;
    setLastActivity(null);
    setActivityUnavailable(false);
    if (externalPortalUser) return () => { cancelled = true; };
    void loadAuditEvents({ projectId: project.id, limit: 1 })
      .then((rows) => {
        if (!cancelled) setLastActivity(buildAuditTrailEntries(rows)[0] || null);
      })
      .catch(() => {
        if (!cancelled) setActivityUnavailable(true);
      });
    return () => { cancelled = true; };
  }, [externalPortalUser, project.id]);

  useEffect(() => {
    const requestedTab = selectionNavigationRequest?.detailTab;
    if (selectionNavigationRequest?.projectId !== project.id) return;
    if (subcontractorReadOnly && !SUBCONTRACTOR_READ_ONLY_TABS.has(requestedTab)) return;
    if (customerReadOnly && !CUSTOMER_READ_ONLY_TABS.has(requestedTab)) return;
    if (!['overview', 'portal', 'tasks', 'calendar', 'inspections', 'selections', 'daily-logs', 'change-orders', 'rfis-submittals', 'budget-commitments', 'warranty-closeout', 'takeoff', 'files', 'photos'].includes(requestedTab)) return;
    setActiveDetailTab(requestedTab);
    if (requestedTab === 'selections' && selectionNavigationRequest?.selectionId) {
      setSelectionHighlightRequest(selectionNavigationRequest);
    }
  }, [customerReadOnly, subcontractorReadOnly, project.id, selectionNavigationRequest]);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const openProjectTasks = (tasks || []).filter((task) => !task.done);
  const overdueProjectTasks = openProjectTasks.filter((task) => task.due && task.due < todayKey);
  const openInspections = (project.inspections || []).filter((inspection) => !isInspectionComplete(inspection));
  const upcomingInspections = openInspections.filter((inspection) => inspection.date && inspection.date >= todayKey);
  const overdueInspections = openInspections.filter((inspection) => inspection.date && inspection.date < todayKey);
  const totalSteps = (project.phases || []).reduce((total, phase) => total + (phase.steps || []).length, 0);
  const completedSteps = (project.phases || []).reduce(
    (total, phase) => total + (phase.steps || []).filter((step) => step.done).length,
    0,
  );
  const scheduleCompletion = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const projectFileCount = (project.files?.folders || []).reduce((total, folder) => total + (folder.files || []).length, 0);
  const scheduleItems = (project.phases || []).flatMap((phase) => (phase.steps || []).map((step) => ({ ...step, phaseName: phase.name || 'Schedule' })));
  const unfinishedScheduleItems = scheduleItems.filter((step) => !step.done);
  const upcomingScheduleItems = unfinishedScheduleItems.filter((step) => (step.end || step.start || '') >= todayKey);
  const nextMilestone = [...(upcomingScheduleItems.length ? upcomingScheduleItems : unfinishedScheduleItems)].sort((left, right) => {
    const leftDate = left.end || left.start || '9999-12-31';
    const rightDate = right.end || right.start || '9999-12-31';
    return leftDate.localeCompare(rightDate);
  })[0] || null;
  const delayedScheduleItem = unfinishedScheduleItems.find((step) => String(step.status || '').toLowerCase() === 'delayed') || null;
  const criticalItem = customerReadOnly
    ? delayedScheduleItem
      ? { label: delayedScheduleItem.name || 'Delayed schedule item', date: delayedScheduleItem.end || delayedScheduleItem.start, tab: 'calendar' }
      : null
    : overdueProjectTasks[0]
    ? { label: overdueProjectTasks[0].label || 'Overdue task', date: overdueProjectTasks[0].due, tab: 'tasks', taskId: overdueProjectTasks[0].id }
    : overdueInspections[0]
      ? { label: overdueInspections[0].inspectionType || overdueInspections[0].name || 'Overdue inspection', date: overdueInspections[0].date, tab: 'inspections' }
      : delayedScheduleItem
        ? { label: delayedScheduleItem.name || 'Delayed schedule item', date: delayedScheduleItem.end || delayedScheduleItem.start, tab: 'calendar' }
        : null;
  const happeningRows = [
    { label: 'Open tasks', count: openProjectTasks.length, tab: 'tasks' },
    { label: 'Overdue tasks', count: overdueProjectTasks.length, tab: 'tasks', taskId: overdueProjectTasks[0]?.id },
    { label: 'Upcoming inspections', count: upcomingInspections.length, tab: 'inspections' },
    { label: 'Selections', count: (project.selections || []).length, tab: 'selections' },
    { label: 'Files', count: projectFileCount, tab: 'files' },
    { label: 'Photos', count: (project.photos || []).length, tab: 'photos' },
    { label: 'Schedule remaining', count: Math.max(0, totalSteps - completedSteps), tab: 'calendar' },
  ].filter((row) => !customerReadOnly || CUSTOMER_READ_ONLY_TABS.has(row.tab));
  const missingInformation = [
    !project.customerPhone && 'customer phone',
    !project.customerEmail && 'customer email',
    !project.address && 'project address',
    !project.start && 'start date',
    !project.end && 'target date',
  ].filter(Boolean);
  const projectUsers = (data?.settings?.users || []).filter((user) => (project.accessUserIds || []).includes(user.id));

  function openOverviewTarget(row) {
    setActiveDetailTab(row.tab);
    if (row.taskId) setTaskHighlightRequest({ taskId: row.taskId, token: `${row.taskId}-${Date.now()}` });
  }

  return (
    <div className={`project-detail-page${subcontractorReadOnly ? ' portal-user-view' : ''}${customerReadOnly ? ' customer-project-view' : ''}`}>
      <div
        className="project-detail-tabs"
        role="tablist"
        aria-label={`${project.name} sections`}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'))
            .filter((tab) => !tab.hidden && tab.offsetParent !== null);
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
          id="project-tab-portal"
          className={`react-tab${activeDetailTab === 'portal' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'portal' ? 'true' : 'false'}
          aria-controls="project-panel-portal"
          tabIndex={activeDetailTab === 'portal' ? 0 : -1}
          onClick={() => setActiveDetailTab('portal')}
        >
          Portal
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
          id="project-tab-daily-logs"
          className={`react-tab${activeDetailTab === 'daily-logs' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'daily-logs' ? 'true' : 'false'}
          aria-controls="project-panel-daily-logs"
          tabIndex={activeDetailTab === 'daily-logs' ? 0 : -1}
          onClick={() => setActiveDetailTab('daily-logs')}
        >
          Daily Logs
        </button>
        <button
          id="project-tab-change-orders"
          className={`react-tab${activeDetailTab === 'change-orders' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'change-orders' ? 'true' : 'false'}
          aria-controls="project-panel-change-orders"
          tabIndex={activeDetailTab === 'change-orders' ? 0 : -1}
          onClick={() => setActiveDetailTab('change-orders')}
        >
          Change Orders
        </button>
        <button
          id="project-tab-rfis-submittals"
          className={`react-tab${activeDetailTab === 'rfis-submittals' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'rfis-submittals' ? 'true' : 'false'}
          aria-controls="project-panel-rfis-submittals"
          tabIndex={activeDetailTab === 'rfis-submittals' ? 0 : -1}
          onClick={() => setActiveDetailTab('rfis-submittals')}
        >
          RFIs &amp; Submittals
        </button>
        <button
          id="project-tab-budget-commitments"
          className={`react-tab${activeDetailTab === 'budget-commitments' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'budget-commitments' ? 'true' : 'false'}
          aria-controls="project-panel-budget-commitments"
          tabIndex={activeDetailTab === 'budget-commitments' ? 0 : -1}
          onClick={() => setActiveDetailTab('budget-commitments')}
        >
          Budget &amp; Commitments
        </button>
        <button
          id="project-tab-warranty-closeout"
          className={`react-tab${activeDetailTab === 'warranty-closeout' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeDetailTab === 'warranty-closeout' ? 'true' : 'false'}
          aria-controls="project-panel-warranty-closeout"
          tabIndex={activeDetailTab === 'warranty-closeout' ? 0 : -1}
          onClick={() => setActiveDetailTab('warranty-closeout')}
        >
          {customerReadOnly ? 'Warranty' : <>Warranty &amp; Closeout</>}
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
          <div className="home-overview-shell project-overview-shell">
            <aside className="home-project-summary project-overview-summary">
              <p className="eyebrow">Project overview</p>
              <span className={`status-pill status-${project.status || 'planning'}`}>{project.status || 'planning'}</span>
              <h2>{project.name || 'Project'}</h2>
              <p className="home-project-address">{project.address || 'Address not set'}</p>
              {project.customerPhone || project.customerEmail ? (
                <div className="project-overview-contact-actions" aria-label="Customer contact actions">
                  {project.customerPhone ? <a className="button secondary" href={`tel:${project.customerPhone}`}>Call</a> : null}
                  {project.customerEmail ? <a className="button secondary" href={`mailto:${project.customerEmail}`}>Email <FluentIcon name="mail" size={15} /></a> : null}
                </div>
              ) : null}
              <dl className="home-project-facts">
                <div><dt>Customer</dt><dd>{project.customerName || 'Not set'}</dd></div>
                <div><dt>Phone</dt><dd>{project.customerPhone || 'Not set'}</dd></div>
                <div><dt>Email</dt><dd>{project.customerEmail || 'Not set'}</dd></div>
                <div><dt>Customer address</dt><dd>{project.customerAddress || 'Not set'}</dd></div>
                <div><dt>Permit #</dt><dd>{project.permitNumber || 'Not set'}</dd></div>
                <div><dt>Block / Lot</dt><dd>{blockLotLabel}</dd></div>
                <div><dt>DR #</dt><dd>{project.drNumber || 'Not set'}</dd></div>
                <div><dt>Start</dt><dd>{project.start ? formatShortDate(project.start) : 'Not set'}</dd></div>
                <div><dt>Target</dt><dd>{project.end ? formatShortDate(project.end) : 'Not set'}</dd></div>
                <div><dt>Schedule</dt><dd>{completedSteps} of {totalSteps} steps</dd></div>
              </dl>
              {missingInformation.length ? (
                <button className="project-overview-warning" type="button" onClick={() => canEdit && onEdit(project)} disabled={!canEdit}>
                  <FluentIcon name="warning" size={18} />
                  <span><strong>Missing information</strong><small>{missingInformation.join(', ')}</small></span>
                </button>
              ) : null}
              {project.desc || project.customerNotes ? (
                <div className="project-overview-summary-notes">
                  {project.desc ? <p><strong>Description</strong><span>{project.desc}</span></p> : null}
                  {project.customerNotes ? <p><strong>Customer notes</strong><span>{project.customerNotes}</span></p> : null}
                </div>
              ) : null}
              <div className="home-project-progress">
                <span><strong>Progress</strong><small>{scheduleCompletion}%</small></span>
                <div className="progress-bar" aria-label={`${scheduleCompletion}% complete`}><span style={{ width: `${scheduleCompletion}%` }} /></div>
              </div>
              {canEdit ? (
                <button className="button primary" type="button" onClick={() => onEdit(project)}>
                  Edit project
                  <FluentIcon name="edit" size={16} />
                </button>
              ) : null}
            </aside>
            <ProjectOverviewMainPhoto project={project} />
            <aside className="home-overview-rail project-overview-rail">
              <section className="home-happening-section">
                <header><p className="eyebrow">Live project view</p><h2>What&apos;s happening</h2></header>
                <div className="home-happening-list">
                  {happeningRows.map((row) => (
                    <button key={row.label} type="button" onClick={() => openOverviewTarget(row)}>
                      <span>{row.label}</span><strong>{row.count}</strong><FluentIcon name="chevronRight" size={15} />
                    </button>
                  ))}
                </div>
              </section>
              <section className="project-overview-rail-section">
                <h3>Schedule focus</h3>
                <button type="button" onClick={() => setActiveDetailTab('calendar')}>
                  <small>Next milestone</small>
                  <strong>{nextMilestone?.name || 'No remaining milestone'}</strong>
                  {nextMilestone ? <span>{nextMilestone.phaseName}{nextMilestone.end || nextMilestone.start ? ` · ${formatShortDate(nextMilestone.end || nextMilestone.start)}` : ''}</span> : null}
                </button>
                {criticalItem ? (
                  <button className="is-critical" type="button" onClick={() => openOverviewTarget(criticalItem)}>
                    <small>Needs attention</small><strong>{criticalItem.label}</strong>
                    {criticalItem.date ? <span>{formatShortDate(criticalItem.date)}</span> : null}
                  </button>
                ) : <p className="project-overview-empty-copy">No overdue or delayed items.</p>}
              </section>
              {!customerReadOnly ? <section className="project-overview-rail-section">
                <h3>Last activity</h3>
                {lastActivity ? (
                  <div className="project-overview-activity">
                    <strong>{lastActivity.entityName || 'Project'} · {lastActivity.label}</strong>
                    <span>{lastActivity.actorEmail || 'Project user'}{lastActivity.createdAt ? ` · ${formatActivityTime(lastActivity.createdAt)}` : ''}</span>
                  </div>
                ) : <p className="project-overview-empty-copy">{activityUnavailable ? 'Activity is unavailable.' : 'No recorded activity yet.'}</p>}
              </section> : null}
              <section className="project-overview-rail-section">
                <h3>Project team</h3>
                {project.manager ? <div className="project-overview-team-member"><strong>{project.manager}</strong><span>Project manager</span></div> : null}
                {projectUsers.map((user) => <div className="project-overview-team-member" key={user.id}><strong>{user.name || user.email || 'Project user'}</strong><span>{user.role || 'Assigned user'}</span></div>)}
                {!project.manager && !projectUsers.length ? <p className="project-overview-empty-copy">No project team assigned.</p> : null}
              </section>
              <section className="project-overview-rail-section">
                <div className="project-overview-section-heading"><h3>Recent photos</h3><button type="button" onClick={() => setActiveDetailTab('photos')}>View all</button></div>
                <ProjectOverviewRecentPhotos photos={project.photos} onOpenPhotos={() => setActiveDetailTab('photos')} />
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      {activeDetailTab !== 'overview' && deferredDataLoading ? (
        <section
          id={`project-panel-${activeDetailTab}`}
          className="project-detail-section project-detail-subtab-panel"
          role="tabpanel"
          aria-labelledby={`project-tab-${activeDetailTab}`}
        >
          <div className="empty-state compact" role="status" aria-live="polite">
            <h3>Loading project details</h3>
            <p>The overview is ready. This section will appear as soon as the remaining project records finish loading.</p>
          </div>
        </section>
      ) : (
      <Suspense fallback={<div className="empty-state compact"><p>Loading project workspace...</p></div>}>
      {activeDetailTab === 'portal' ? (
        <section id="project-panel-portal" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-portal">
          <ProjectPortalManager project={project} activeUser={activeUser} canEdit={canEdit} />
        </section>
      ) : null}
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
            activeUser={activeUser}
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

      {activeDetailTab === 'daily-logs' ? (
        <section id="project-panel-daily-logs" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-daily-logs">
          <ProjectWorkflowManager data={data} project={project} canEdit={canEdit} workflowType="dailyLogs" subcontractors={data?.subs || []} onStateChange={onStateChange} />
        </section>
      ) : null}

      {activeDetailTab === 'change-orders' ? (
        <section id="project-panel-change-orders" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-change-orders">
          <ProjectWorkflowManager project={project} canEdit={canEdit} workflowType="changeOrders" />
        </section>
      ) : null}

      {activeDetailTab === 'rfis-submittals' ? (
        <section id="project-panel-rfis-submittals" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-rfis-submittals">
          <ProjectRfiSubmittalsManager project={project} data={data} canEdit={canEdit} />
        </section>
      ) : null}

      {activeDetailTab === 'budget-commitments' ? (
        <section id="project-panel-budget-commitments" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-budget-commitments">
          <ProjectBudgetCommitmentsManager project={project} data={data} canEdit={canEdit} />
        </section>
      ) : null}

      {activeDetailTab === 'warranty-closeout' ? (
        <section id="project-panel-warranty-closeout" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-warranty-closeout">
          <ProjectWarrantyCloseoutManager project={project} data={data} canEdit={canEdit} customerMode={customerReadOnly} activeUser={activeUser} />
        </section>
      ) : null}

      {activeDetailTab === 'takeoff' ? (
        <section id="project-panel-takeoff" className="project-detail-section project-detail-subtab-panel project-takeoff-panel" role="tabpanel" aria-labelledby="project-tab-takeoff">
          <TakeoffWorkspace project={project} projectId={project.id} canEdit={canEdit} />
        </section>
      ) : null}

      {activeDetailTab === 'photos' ? (
        <section id="project-panel-photos" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-photos">
          <ProjectPhotosManager data={data} project={project} onStateChange={onStateChange} readOnly={!canEdit} canAddPhotos={canEdit || customerReadOnly} />
        </section>
      ) : null}
      </Suspense>
      )}

    </div>
  );
}
