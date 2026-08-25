import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { downloadProjectFileFromStorage, loadAuditEvents } from '../services/trackerData.js';
import { buildAuditTrailEntries } from '../utils/auditTrail.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { getVisibleProjectTabs } from '../utils/projectTabs.js';
import {
  MAX_PINNED_PROJECT_SECTIONS,
  buildProjectNavigationModel,
  loadProjectNavigationPreferences,
  recordRecentProjectSection,
  saveProjectNavigationPreferences,
  setProjectNavigationCompactMode,
  togglePinnedProjectSection,
} from '../utils/projectNavigation.js';
import { getSearchParam, updateCurrentUrl } from '../platform/platformAdapter.js';
import {
  cacheProjectForOffline,
  formatOfflineProjectSize,
  getOfflineProjectRecord,
  getProjectOfflineOperationSummary,
  removeOfflineProject,
  setOfflineProjectAssetSummary,
  subscribeToOfflineProjects,
} from '../services/offlineProjectStore.js';
import {
  MAX_OFFLINE_ASSET_BYTES_PER_ITEM,
  MAX_OFFLINE_ASSET_BYTES_PER_USER,
  cacheOfflineProjectAssets,
  getOfflineProjectAssetCandidates,
  removeOfflineProjectAssets,
  summarizeOfflineProjectAssets,
} from '../services/offlineProjectAssetStore.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { loadOfflineProjectWorkflowSnapshot } from '../services/constructionWorkflows.js';

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
  calendarInspectionEditRequest = null,
  onBack = null,
  offlineUserId = '',
  offlineOperations = [],
  onEdit,
  onDateClick,
  onCalendarItemClick,
  onStateChange,
}) {
  const externalPortalUser = ['Customer', 'Subcontractor'].includes(activeUser?.role);
  const customerReadOnly = activeUser?.role === 'Customer';
  const subcontractorReadOnly = activeUser?.role === 'Subcontractor';
  const visibleProjectTabs = useMemo(
    () => getVisibleProjectTabs(settings?.visibleProjectTabs, activeUser?.role),
    [activeUser?.role, settings?.visibleProjectTabs],
  );
  const visibleProjectTabIds = useMemo(
    () => new Set(visibleProjectTabs.map((tab) => tab.id)),
    [visibleProjectTabs],
  );
  const defaultProjectTabId = visibleProjectTabs[0]?.id || (subcontractorReadOnly ? 'portal' : 'overview');
  const [activeDetailTab, setActiveDetailTab] = useState(() => {
    const requestedTab = String(getSearchParam('projectTab') || '').trim();
    return visibleProjectTabs.some((tab) => tab.id === requestedTab) ? requestedTab : defaultProjectTabId;
  });
  const visibleProjectTabScope = visibleProjectTabs.map((tab) => tab.id).join('|');
  const [navigationPreferences, setNavigationPreferences] = useState(() =>
    loadProjectNavigationPreferences(activeUser?.id, visibleProjectTabs, activeUser?.role),
  );
  const [showMoreSections, setShowMoreSections] = useState(false);
  const [offlineProjectRecord, setOfflineProjectRecord] = useState(null);
  const [offlineProjectBusy, setOfflineProjectBusy] = useState(false);
  const [offlineAssetBusy, setOfflineAssetBusy] = useState(false);
  const [offlineAssetSelection, setOfflineAssetSelection] = useState({ files: false, photos: false });
  const [offlineAssetProgress, setOfflineAssetProgress] = useState(null);
  const [offlineAssetMessage, setOfflineAssetMessage] = useState('');
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const moreSectionsRef = useRef(null);
  const moreSectionsButtonRef = useRef(null);
  const projectNavigation = useMemo(
    () => buildProjectNavigationModel(visibleProjectTabs, navigationPreferences, activeDetailTab, activeUser?.role),
    [activeDetailTab, activeUser?.role, navigationPreferences, visibleProjectTabs],
  );
  const projectOfflineSummary = useMemo(
    () => getProjectOfflineOperationSummary(offlineOperations, project.id),
    [offlineOperations, project.id],
  );
  const offlineWorkflows = offlineProjectRecord?.snapshot?.workflows || {};
  const offlineAssetCounts = useMemo(() => ({
    files: getOfflineProjectAssetCandidates(project, ['files'], tasks, offlineWorkflows).length,
    photos: getOfflineProjectAssetCandidates(project, ['photos'], tasks, offlineWorkflows).length,
  }), [offlineWorkflows, project, tasks]);
  const [selectionHighlightRequest, setSelectionHighlightRequest] = useState(null);
  const [taskHighlightRequest, setTaskHighlightRequest] = useState(null);
  const [lastActivity, setLastActivity] = useState(null);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const blockLotLabel =
    project.block || project.lot
      ? [project.block ? `Block ${project.block}` : '', project.lot ? `Lot ${project.lot}` : ''].filter(Boolean).join(' • ')
      : 'Not set';

  useEffect(() => {
    setNavigationPreferences(loadProjectNavigationPreferences(activeUser?.id, visibleProjectTabs, activeUser?.role));
  }, [activeUser?.id, activeUser?.role, visibleProjectTabScope]);

  useEffect(() => {
    let cancelled = false;
    if (!offlineUserId || !project.id) {
      setOfflineProjectRecord(null);
      return undefined;
    }
    const refreshOfflineRecord = () => {
      void getOfflineProjectRecord(offlineUserId, project.id)
        .then((record) => {
          if (!cancelled) setOfflineProjectRecord(record);
        })
        .catch(() => {
          if (!cancelled) setOfflineProjectRecord(null);
        });
    };
    refreshOfflineRecord();
    const unsubscribe = subscribeToOfflineProjects(offlineUserId, refreshOfflineRecord);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [offlineUserId, project.id]);

  useEffect(() => {
    const selectedKinds = offlineProjectRecord?.assetSummary?.selectedKinds || offlineProjectRecord?.assetSections || [];
    setOfflineAssetSelection({
      files: selectedKinds.includes('files'),
      photos: selectedKinds.includes('photos'),
    });
    setOfflineAssetMessage('');
    setOfflineAssetProgress(null);
  }, [offlineProjectRecord?.id]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!visibleProjectTabIds.has(activeDetailTab)) return;
    setNavigationPreferences((current) => {
      const next = recordRecentProjectSection(current, activeDetailTab, visibleProjectTabs, activeUser?.role);
      saveProjectNavigationPreferences(activeUser?.id, next, visibleProjectTabs, activeUser?.role);
      return next;
    });
  }, [activeDetailTab, activeUser?.id, activeUser?.role, visibleProjectTabScope]);

  useEffect(() => {
    if (!showMoreSections) return undefined;
    function handlePointerDown(event) {
      if (!moreSectionsRef.current?.contains(event.target)) setShowMoreSections(false);
    }
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      setShowMoreSections(false);
      moreSectionsButtonRef.current?.focus();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMoreSections]);

  useEffect(() => {
    const requestedTab = String(getSearchParam('projectTab') || '').trim();
    const fallbackTab = subcontractorReadOnly && visibleProjectTabIds.has('portal')
      ? 'portal'
      : visibleProjectTabIds.has('overview')
        ? 'overview'
        : defaultProjectTabId;
    setActiveDetailTab(visibleProjectTabIds.has(requestedTab) ? requestedTab : fallbackTab);
  }, [defaultProjectTabId, project.id, subcontractorReadOnly, visibleProjectTabIds]);

  useEffect(() => {
    if (!visibleProjectTabIds.has(activeDetailTab)) setActiveDetailTab(defaultProjectTabId);
  }, [activeDetailTab, defaultProjectTabId, visibleProjectTabIds]);

  useEffect(() => {
    if (!calendarInspectionEditRequest?.inspectionId || !visibleProjectTabIds.has('inspections')) return;
    setActiveDetailTab('inspections');
  }, [calendarInspectionEditRequest?.inspectionId, calendarInspectionEditRequest?.token, visibleProjectTabIds]);

  useEffect(() => {
    if (!visibleProjectTabIds.has(activeDetailTab)) return;
    updateCurrentUrl((url) => {
      if (String(url.searchParams.get('project') || '').trim() !== String(project.id || '').trim()) return;
      url.searchParams.set('projectTab', activeDetailTab);
      if (activeDetailTab !== 'tasks') url.searchParams.delete('task');
    });
  }, [activeDetailTab, project.id, visibleProjectTabIds]);

  useEffect(() => {
    if (activeDetailTab !== 'tasks') return;
    const taskId = String(getSearchParam('task') || '').trim();
    if (!taskId || !(tasks || []).some((task) => task.id === taskId && task.projectId === project.id)) return;
    setTaskHighlightRequest({ taskId, token: `deep-link-${project.id}-${taskId}` });
  }, [activeDetailTab, project.id, tasks]);

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
    if (!visibleProjectTabIds.has(requestedTab)) return;
    setActiveDetailTab(requestedTab);
    if (requestedTab === 'selections' && selectionNavigationRequest?.selectionId) {
      setSelectionHighlightRequest(selectionNavigationRequest);
    }
  }, [project.id, selectionNavigationRequest, visibleProjectTabIds]);

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
  ].filter((row) => visibleProjectTabIds.has(row.tab));
  const missingInformation = [
    !project.customerPhone && 'customer phone',
    !project.customerEmail && 'customer email',
    !project.address && 'project address',
    !project.start && 'start date',
    !project.end && 'target date',
  ].filter(Boolean);
  const projectUsers = (data?.settings?.users || []).filter((user) => (project.accessUserIds || []).includes(user.id));

  async function openOverviewTarget(row) {
    if (!visibleProjectTabIds.has(row.tab)) return;
    const opened = await selectProjectSection(row.tab);
    if (!opened) return;
    if (row.taskId) setTaskHighlightRequest({ taskId: row.taskId, token: `${row.taskId}-${Date.now()}` });
  }

  async function selectProjectSection(tabId) {
    if (!visibleProjectTabIds.has(tabId)) return false;
    if (!isOnline && !offlineProjectRecord?.cachedSections?.includes(tabId)) {
      await showAppAlert(
        offlineProjectRecord
          ? `${visibleProjectTabs.find((tab) => tab.id === tabId)?.label || 'This section'} is not included in this project's offline copy. Reconnect before opening it.`
          : 'This project was not made available offline. Reconnect before opening another section.',
        'Section unavailable offline',
      );
      return false;
    }
    setActiveDetailTab(tabId);
    setShowMoreSections(false);
    return true;
  }

  function toggleProjectSectionPin(tabId) {
    setNavigationPreferences((current) => {
      const next = togglePinnedProjectSection(current, tabId, visibleProjectTabs, activeUser?.role);
      saveProjectNavigationPreferences(activeUser?.id, next, visibleProjectTabs, activeUser?.role);
      return next;
    });
  }

  function toggleCompactDesktopNavigation(compactDesktop) {
    setNavigationPreferences((current) => {
      const next = setProjectNavigationCompactMode(current, compactDesktop, visibleProjectTabs, activeUser?.role);
      saveProjectNavigationPreferences(activeUser?.id, next, visibleProjectTabs, activeUser?.role);
      return next;
    });
  }

  async function saveProjectOfflineCopy() {
    if (!offlineUserId || !isOnline || deferredDataLoading) return;
    setOfflineProjectBusy(true);
    try {
      const workflowSnapshot = await loadOfflineProjectWorkflowSnapshot({
        projectId: project.id,
        visibleTabs: visibleProjectTabs,
        role: activeUser?.role,
      });
      const record = await cacheProjectForOffline({
        userId: offlineUserId,
        project,
        tasks,
        settings,
        subs: data?.subs || [],
        employees: data?.employees || [],
        workflows: workflowSnapshot.workflows,
        workflowSections: workflowSnapshot.cachedSections,
        visibleTabs: visibleProjectTabs,
      });
      setOfflineProjectRecord(record);
      if (workflowSnapshot.failures.length) {
        await showAppAlert(
          `The project copy was updated, but ${workflowSnapshot.failures.length} workflow section${workflowSnapshot.failures.length === 1 ? '' : 's'} could not be saved. Reconnect and update the copy again before relying on those sections offline.`,
          'Offline copy partially updated',
        );
      }
    } catch (error) {
      await showAppAlert(
        error instanceof Error ? error.message : 'The project could not be stored on this device.',
        'Offline copy failed',
      );
    } finally {
      setOfflineProjectBusy(false);
    }
  }

  async function removeProjectOfflineCopy() {
    if (!offlineProjectRecord || offlineProjectBusy) return;
    const confirmed = await showAppConfirm(
      `Remove the offline copy of ${project.name || 'this project'} from this device? Device-saved changes in the synchronization queue will not be removed.`,
      { title: 'Remove offline copy?', confirmLabel: 'Remove copy', tone: 'danger' },
    );
    if (!confirmed) return;
    setOfflineProjectBusy(true);
    try {
      await removeOfflineProjectAssets(offlineUserId, project.id);
      await removeOfflineProject(offlineUserId, project.id);
      setOfflineProjectRecord(null);
    } catch (error) {
      await showAppAlert(
        error instanceof Error ? error.message : 'The offline project copy could not be removed.',
        'Remove failed',
      );
    } finally {
      setOfflineProjectBusy(false);
    }
  }

  async function updateOfflineAssetDownloads() {
    const selectedKinds = Object.entries(offlineAssetSelection)
      .filter(([, selected]) => selected)
      .map(([kind]) => kind);
    if (!offlineProjectRecord || !isOnline || !selectedKinds.length || offlineAssetBusy) return;
    setOfflineAssetBusy(true);
    setOfflineAssetMessage('');
    setOfflineAssetProgress({ completed: 0, total: offlineAssetCounts.files + offlineAssetCounts.photos });
    try {
      const summary = await cacheOfflineProjectAssets({
        userId: offlineUserId,
        project,
        tasks,
        workflows: offlineWorkflows,
        selectedKinds,
        downloadAsset: (asset) => downloadProjectFileFromStorage(asset),
        onProgress: setOfflineAssetProgress,
      });
      const record = await setOfflineProjectAssetSummary(offlineUserId, project.id, summary);
      setOfflineProjectRecord(record);
      const incomplete = selectedKinds.filter((kind) => !summary.completeKinds.includes(kind));
      setOfflineAssetMessage(
        incomplete.length
          ? `${summary.count} downloaded. ${summary.failed || summary.truncated ? 'Some items could not be saved; the previous cached copy was kept where available.' : 'The selected section is not yet complete.'}`
          : `${summary.count} item${summary.count === 1 ? '' : 's'} downloaded for offline use.`,
      );
    } catch (error) {
      setOfflineAssetMessage(error instanceof Error ? error.message : 'Files and photos could not be downloaded.');
    } finally {
      setOfflineAssetBusy(false);
    }
  }

  async function removeOfflineAssetDownloads() {
    if (!offlineProjectRecord || offlineAssetBusy) return;
    const confirmed = await showAppConfirm(
      'Remove downloaded files and photos for this project? The structured project copy and synchronization queue will remain.',
      { title: 'Remove offline downloads?', confirmLabel: 'Remove downloads', tone: 'danger' },
    );
    if (!confirmed) return;
    setOfflineAssetBusy(true);
    try {
      await removeOfflineProjectAssets(offlineUserId, project.id);
      const summary = { ...summarizeOfflineProjectAssets([], []), completeKinds: [], updatedAt: new Date().toISOString() };
      const record = await setOfflineProjectAssetSummary(offlineUserId, project.id, summary);
      setOfflineProjectRecord(record);
      setOfflineAssetSelection({ files: false, photos: false });
      setOfflineAssetMessage('Downloaded files and photos were removed.');
    } catch (error) {
      setOfflineAssetMessage(error instanceof Error ? error.message : 'Offline downloads could not be removed.');
    } finally {
      setOfflineAssetBusy(false);
    }
  }

  return (
    <div className={`project-detail-page${subcontractorReadOnly ? ' portal-user-view' : ''}${customerReadOnly ? ' customer-project-view' : ''}`}>
      <div className={`project-detail-navigation-shell${projectNavigation.compactDesktop ? ' is-compact-desktop' : ''}`}>
        <header className="project-detail-context">
          <nav className="project-detail-breadcrumbs" aria-label="Project breadcrumb">
            {onBack ? <button type="button" onClick={onBack}>Projects</button> : <span>Projects</span>}
            <FluentIcon name="chevronRight" size={14} />
            <strong>{project.name || 'Project'}</strong>
          </nav>
          <div className="project-detail-context-meta">
            <span className={`status-pill status-${project.status || 'planning'}`}>{project.status || 'planning'}</span>
            <span>{project.address || 'Address not set'}</span>
          </div>
        </header>

        <div className="project-detail-navigation">
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
          {projectNavigation.primaryTabs.map((tab) => {
            const label = tab.id === 'warranty-closeout' && customerReadOnly ? 'Warranty' : tab.label;
            return (
              <button
                key={tab.id}
                id={`project-tab-${tab.id}`}
                className={`react-tab${activeDetailTab === tab.id ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={activeDetailTab === tab.id ? 'true' : 'false'}
                aria-controls={`project-panel-${tab.id}`}
                tabIndex={activeDetailTab === tab.id ? 0 : -1}
                onClick={() => selectProjectSection(tab.id)}
              >
                {label}
              </button>
            );
          })}
          </div>

          {projectNavigation.moreTabs.length ? (
            <div className="project-detail-more" ref={moreSectionsRef}>
            <button
              ref={moreSectionsButtonRef}
              className={`react-tab project-detail-more-button${showMoreSections ? ' active' : ''}`}
              type="button"
              aria-expanded={showMoreSections ? 'true' : 'false'}
              onClick={() => setShowMoreSections((current) => !current)}
            >
              More <FluentIcon name="chevronDown" size={14} />
            </button>
            {showMoreSections ? (
              <section className="project-detail-more-menu" aria-label="More project sections">
                <div className="project-detail-more-heading">
                  <strong>Project sections</strong>
                  <small>Pin up to {MAX_PINNED_PROJECT_SECTIONS}</small>
                </div>
                <label className="project-detail-density-toggle">
                  <input
                    type="checkbox"
                    checked={projectNavigation.compactDesktop}
                    onChange={(event) => toggleCompactDesktopNavigation(event.target.checked)}
                  />
                  <span>
                    <strong>Compact desktop navigation</strong>
                    <small>Use one tighter navigation row on wider screens.</small>
                  </span>
                </label>
                <section className="project-detail-offline-card" aria-label="Offline access">
                  <div className="project-detail-offline-heading">
                    <span>
                      <strong>Offline access</strong>
                      <small>{offlineProjectRecord ? 'Available on this device' : 'Online only'}</small>
                    </span>
                    <span className={`status-pill${offlineProjectRecord ? ' success' : ''}`}>
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  {offlineProjectRecord ? (
                    <dl className="project-detail-offline-facts">
                      <div><dt>Last synchronized</dt><dd>{formatActivityTime(offlineProjectRecord.lastSyncedAt)}</dd></div>
                      <div><dt>Cached sections</dt><dd>{offlineProjectRecord.cachedSections.length}</dd></div>
                      <div><dt>Storage</dt><dd>{formatOfflineProjectSize((offlineProjectRecord.byteSize || 0) + (offlineProjectRecord.assetSummary?.byteSize || 0))}</dd></div>
                      <div><dt>Queued</dt><dd>{projectOfflineSummary.total}</dd></div>
                      {projectOfflineSummary.needsAttention ? <div className="error"><dt>Needs attention</dt><dd>{projectOfflineSummary.needsAttention}</dd></div> : null}
                    </dl>
                  ) : (
                    <p>Store core project details and every visible workflow section for field access without a connection. Takeoff opens projects already saved on this device.</p>
                  )}
                  <div className="project-detail-offline-sections">
                    {(offlineProjectRecord?.cachedSections || []).map((sectionId) => (
                      <span key={sectionId}>{visibleProjectTabs.find((tab) => tab.id === sectionId)?.label || sectionId}</span>
                    ))}
                  </div>
                  <div className="project-detail-offline-actions">
                    <button
                      className={`button primary${offlineProjectBusy ? ' is-loading' : ''}`}
                      type="button"
                      onClick={() => void saveProjectOfflineCopy()}
                      disabled={offlineProjectBusy || !isOnline || deferredDataLoading}
                    >
                      {offlineProjectRecord ? 'Update offline copy' : 'Make available offline'}
                    </button>
                    {offlineProjectRecord ? (
                      <button className="button secondary" type="button" onClick={() => void removeProjectOfflineCopy()} disabled={offlineProjectBusy}>
                        Remove copy
                      </button>
                    ) : null}
                  </div>
                  {!isOnline ? <small>Reconnect to update this offline copy.</small> : deferredDataLoading ? <small>Wait for project details to finish loading before saving.</small> : null}
                  {offlineProjectRecord && (visibleProjectTabIds.has('files') || visibleProjectTabIds.has('photos')) ? (
                    <section className="project-detail-offline-assets" aria-label="Offline files and photos">
                      <div>
                        <strong>Offline files &amp; photos</strong>
                        <small>Choose what to keep on this device, including task, inspection, selection, workflow, warranty, closeout, and invoice attachments. The selection replaces the categories kept after a successful refresh.</small>
                      </div>
                      <div className="project-detail-offline-asset-options">
                        {visibleProjectTabIds.has('files') ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={offlineAssetSelection.files}
                              onChange={(event) => setOfflineAssetSelection((current) => ({ ...current, files: event.target.checked }))}
                              disabled={offlineAssetBusy}
                            />
                            Files ({offlineAssetCounts.files})
                          </label>
                        ) : null}
                        {visibleProjectTabIds.has('photos') ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={offlineAssetSelection.photos}
                              onChange={(event) => setOfflineAssetSelection((current) => ({ ...current, photos: event.target.checked }))}
                              disabled={offlineAssetBusy}
                            />
                            Photos ({offlineAssetCounts.photos})
                          </label>
                        ) : null}
                      </div>
                      <small>
                        Up to {formatOfflineProjectSize(MAX_OFFLINE_ASSET_BYTES_PER_ITEM)} per item and {formatOfflineProjectSize(MAX_OFFLINE_ASSET_BYTES_PER_USER)} total per signed-in user.
                      </small>
                      {offlineProjectRecord.assetSummary?.count ? (
                        <p>{offlineProjectRecord.assetSummary.count} downloaded · {formatOfflineProjectSize(offlineProjectRecord.assetSummary.byteSize)}</p>
                      ) : null}
                      {offlineProjectRecord.assetSummary?.staleKinds?.length ? (
                        <p className="error" role="status">
                          {offlineProjectRecord.assetSummary.staleKinds.map((kind) => kind === 'photos' ? 'Photos' : 'Files').join(' and ')} changed online. Update downloads before using that section offline.
                        </p>
                      ) : null}
                      {offlineAssetProgress && offlineAssetBusy ? (
                        <p role="status" aria-live="polite">
                          Downloading {offlineAssetProgress.completed} of {offlineAssetProgress.total}{offlineAssetProgress.currentName ? ` · ${offlineAssetProgress.currentName}` : ''}
                        </p>
                      ) : null}
                      {offlineAssetMessage ? <p role="status" aria-live="polite">{offlineAssetMessage}</p> : null}
                      <div className="project-detail-offline-actions">
                        <button
                          className={`button secondary${offlineAssetBusy ? ' is-loading' : ''}`}
                          type="button"
                          onClick={() => void updateOfflineAssetDownloads()}
                          disabled={offlineAssetBusy || !isOnline || (!offlineAssetSelection.files && !offlineAssetSelection.photos)}
                        >
                          {offlineProjectRecord.assetSummary?.count ? 'Update downloads' : 'Download selected'}
                        </button>
                        {offlineProjectRecord.assetSummary?.count ? (
                          <button className="button secondary" type="button" onClick={() => void removeOfflineAssetDownloads()} disabled={offlineAssetBusy}>
                            Remove downloads
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </section>
                <p className="project-detail-more-group-label">Pinned</p>
                {projectNavigation.primaryTabs.filter((tab) => projectNavigation.pinnedIds.includes(tab.id)).map((tab, index) => {
                  const label = tab.id === 'warranty-closeout' && customerReadOnly ? 'Warranty' : tab.label;
                  return (
                    <div className="project-detail-more-row" key={`pinned-${tab.id}`}>
                      <button type="button" className="project-detail-more-link" onClick={() => selectProjectSection(tab.id)}>
                        <span>{label}</span>
                        {activeDetailTab === tab.id ? <small>Current</small> : null}
                      </button>
                      <button
                        type="button"
                        className="project-detail-pin-button is-pinned"
                        aria-label={`Unpin ${label}`}
                        title={index === 0 ? `${label} stays pinned` : `Unpin ${label}`}
                        disabled={index === 0}
                        onClick={() => toggleProjectSectionPin(tab.id)}
                      >
                        <FluentIcon name="pin" size={16} />
                      </button>
                    </div>
                  );
                })}
                <p className="project-detail-more-group-label">More</p>
                {projectNavigation.moreTabs.map((tab) => {
                  const label = tab.id === 'warranty-closeout' && customerReadOnly ? 'Warranty' : tab.label;
                  const isRecent = projectNavigation.recentIds.includes(tab.id);
                  const atPinLimit = projectNavigation.pinnedIds.length >= MAX_PINNED_PROJECT_SECTIONS;
                  return (
                    <div className="project-detail-more-row" key={tab.id}>
                      <button type="button" className="project-detail-more-link" onClick={() => selectProjectSection(tab.id)}>
                        <span>{label}</span>
                        {activeDetailTab === tab.id ? <small>Current</small> : isRecent ? <small>Recent</small> : null}
                      </button>
                      <button
                        type="button"
                        className="project-detail-pin-button"
                        aria-label={`Pin ${label}`}
                        title={atPinLimit ? `Unpin another section before pinning ${label}` : `Pin ${label}`}
                        disabled={atPinLimit}
                        onClick={() => toggleProjectSectionPin(tab.id)}
                      >
                        <FluentIcon name="pin" size={16} />
                      </button>
                    </div>
                  );
                })}
              </section>
            ) : null}
            </div>
          ) : null}
        </div>
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
              {visibleProjectTabIds.has('calendar') ? <section className="project-overview-rail-section">
                <h3>Schedule focus</h3>
                <button type="button" onClick={() => setActiveDetailTab('calendar')}>
                  <small>Next milestone</small>
                  <strong>{nextMilestone?.name || 'No remaining milestone'}</strong>
                  {nextMilestone ? <span>{nextMilestone.phaseName}{nextMilestone.end || nextMilestone.start ? ` · ${formatShortDate(nextMilestone.end || nextMilestone.start)}` : ''}</span> : null}
                </button>
                {criticalItem && visibleProjectTabIds.has(criticalItem.tab) ? (
                  <button className="is-critical" type="button" onClick={() => openOverviewTarget(criticalItem)}>
                    <small>Needs attention</small><strong>{criticalItem.label}</strong>
                    {criticalItem.date ? <span>{formatShortDate(criticalItem.date)}</span> : null}
                  </button>
                ) : <p className="project-overview-empty-copy">No overdue or delayed items.</p>}
              </section> : null}
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
              {visibleProjectTabIds.has('photos') ? <section className="project-overview-rail-section">
                <div className="project-overview-section-heading"><h3>Recent photos</h3><button type="button" onClick={() => setActiveDetailTab('photos')}>View all</button></div>
                <ProjectOverviewRecentPhotos photos={project.photos} onOpenPhotos={() => setActiveDetailTab('photos')} />
              </section> : null}
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
              if (!visibleProjectTabIds.has('selections')) return;
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
            createRequest={selectionNavigationRequest?.detailAction === 'create-inspection' ? selectionNavigationRequest : null}
            editRequest={calendarInspectionEditRequest}
            highlightInspectionId={selectionNavigationRequest?.inspectionId || ''}
            highlightToken={selectionNavigationRequest?.token || ''}
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
              if (!visibleProjectTabIds.has('tasks')) return;
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
             navigationTarget={selectionNavigationRequest}
          />
        </section>
      ) : null}

      {activeDetailTab === 'daily-logs' ? (
        <section id="project-panel-daily-logs" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-daily-logs">
          <ProjectWorkflowManager
            data={data}
            project={project}
            canEdit={canEdit}
            workflowType="dailyLogs"
            subcontractors={data?.subs || []}
             onStateChange={onStateChange}
             createRequest={selectionNavigationRequest?.detailAction === 'create-daily-log' ? selectionNavigationRequest : null}
             navigationTarget={selectionNavigationRequest}
          />
        </section>
      ) : null}

      {activeDetailTab === 'change-orders' ? (
        <section id="project-panel-change-orders" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-change-orders">
          <ProjectWorkflowManager
            data={data}
            project={project}
            canEdit={canEdit}
            workflowType="changeOrders"
            navigationTarget={selectionNavigationRequest}
          />
        </section>
      ) : null}

      {activeDetailTab === 'rfis-submittals' ? (
        <section id="project-panel-rfis-submittals" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-rfis-submittals">
          <ProjectRfiSubmittalsManager
            project={project}
            data={data}
            canEdit={canEdit}
            navigationTarget={selectionNavigationRequest}
          />
        </section>
      ) : null}

      {activeDetailTab === 'budget-commitments' ? (
        <section id="project-panel-budget-commitments" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-budget-commitments">
          <ProjectBudgetCommitmentsManager
            project={project}
            data={data}
            canEdit={canEdit}
            navigationTarget={selectionNavigationRequest}
          />
        </section>
      ) : null}

      {activeDetailTab === 'warranty-closeout' ? (
        <section id="project-panel-warranty-closeout" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-warranty-closeout">
          <ProjectWarrantyCloseoutManager project={project} data={data} canEdit={canEdit} customerMode={customerReadOnly} activeUser={activeUser} navigationTarget={selectionNavigationRequest} />
        </section>
      ) : null}

      {activeDetailTab === 'takeoff' ? (
        <section id="project-panel-takeoff" className="project-detail-section project-detail-subtab-panel project-takeoff-panel" role="tabpanel" aria-labelledby="project-tab-takeoff">
          <TakeoffWorkspace project={project} projectId={project.id} canEdit={canEdit} />
        </section>
      ) : null}

      {activeDetailTab === 'photos' ? (
        <section id="project-panel-photos" className="project-detail-section project-detail-subtab-panel" role="tabpanel" aria-labelledby="project-tab-photos">
          <ProjectPhotosManager
            data={data}
            project={project}
            onStateChange={onStateChange}
            readOnly={!canEdit}
            canAddPhotos={canEdit || customerReadOnly}
            incomingPhotoRequest={selectionNavigationRequest?.detailAction === 'share-photo' ? selectionNavigationRequest : null}
          />
        </section>
      ) : null}
      </Suspense>
      )}

    </div>
  );
}
