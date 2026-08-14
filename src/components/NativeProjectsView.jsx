import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser, normalizeProjectAccessUserIds } from '../utils/accessUi.js';
import { createProject, deleteProject, updateProject, updateProjectAndTasks, updateProjectsAndTasks } from '../services/trackerData.js';
import {
  cascadePhaseDates, cascadeStepDates, computeStepEndDate, normalizePreds, normalizeStartDate,
  syncProjectPhaseDates, syncProjectTasks, syncStepLinks, wouldCreateCycleFromPreds,
} from '../utils/schedule.js';
import { addDays, formatShortDate, toIsoDate } from '../utils/calendarUi.js';
import { showAppAlert, showAppConfirm, showUndoAction } from './AppDialogs.jsx';
import ProjectCard from './ProjectCard.jsx';
import { DashboardStat, PageStats } from './SharedUI.jsx';
import SavedFiltersControls from './SavedFiltersControls.jsx';
import FluentIcon from './FluentIcon.jsx';
import ResponsiveFilterMenu from './ResponsiveFilterMenu.jsx';
import { getSearchParam, updateCurrentUrl } from '../platform/platformAdapter.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
import useSubcontractorComplianceWarnings from '../hooks/useSubcontractorComplianceWarnings.js';
import { getScheduleAssignees, scheduleAssigneeFields } from '../utils/assignees.js';
import { getVisibleProjectTabs } from '../utils/projectTabs.js';
import {
  cacheProjectForOffline,
  formatOfflineProjectSize,
  listOfflineProjectRecords,
  planOfflineProjectRefresh,
  removeOfflineProject,
  subscribeToOfflineProjects,
} from '../services/offlineProjectStore.js';
import { removeOfflineProjectAssets } from '../services/offlineProjectAssetStore.js';
import {
  OFFLINE_WORKFLOW_SECTION_TYPES,
  loadOfflineProjectWorkflowSnapshot,
} from '../services/constructionWorkflows.js';

const ProjectDetailView = lazy(() => import('./ProjectDetailView.jsx'));
const ProjectModal = lazy(() => import('./ProjectModal.jsx'));
const ScheduleItemModal = lazy(() => import('./ScheduleDialogs.jsx').then((module) => ({ default: module.ScheduleItemModal })));
const StepPredecessorModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.StepPredecessorModal })));
const TextEntryModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.TextEntryModal })));

const TASK_COLOR_PALETTE = ['#2f6f8f', '#c54f7c', '#5f8f3d', '#b86a2f', '#6c5aa7', '#2f8c83', '#9a554f', '#4f6fb2'];
function parseDateValue(iso) { if (!iso) return null; const date = new Date(`${iso}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function getNextTaskColor(projects = []) { const count = projects.reduce((total, project) => total + (project.phases || []).reduce((sum, phase) => sum + (phase.steps || []).length, 0), 0); return TASK_COLOR_PALETTE[count % TASK_COLOR_PALETTE.length]; }
function getProjectIdFromLocation() { return String(getSearchParam('project') || '').trim(); }
function syncProjectToLocation(projectId, { push = false } = {}) {
  updateCurrentUrl((url) => {
    const normalizedProjectId = String(projectId || '').trim();
    const currentProjectId = String(url.searchParams.get('project') || '').trim();
    if (normalizedProjectId) url.searchParams.set('project', normalizedProjectId);
    else url.searchParams.delete('project');
    if (!normalizedProjectId || normalizedProjectId !== currentProjectId) {
      url.searchParams.delete('projectTab');
    }
  }, { push });
}
function formatOfflineSyncTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not synchronized';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export default function NativeProjectsView({
  data,
  refresh,
  loading,
  onStateChange,
  readOnly = false,
  activeUser = null,
  users = [],
  homeSignal = 0,
  navigationTarget = null,
  deferredDataLoading = false,
  offlineUserId = '',
  offlineOperations = [],
}) {
  const [projectDraft, setProjectDraft] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(getProjectIdFromLocation);
  const [stepDraft, setStepDraft] = useState(null);
  const [stepPredecessorDraft, setStepPredecessorDraft] = useState(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState(null);
  const { runMutation, isMutating } = useEntityMutations();
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('all');
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [offlineProjectRecords, setOfflineProjectRecords] = useState([]);
  const [offlineCopiesBusy, setOfflineCopiesBusy] = useState(false);
  const [expandedOverviewProjectIds, setExpandedOverviewProjectIds] = useState(() => new Set());
  const dataRef = useRef(data);
  const previousSelectedProjectIdRef = useRef(getProjectIdFromLocation());
  const nextProjectHistoryModeRef = useRef('none');
  const previousHomeSignalRef = useRef(homeSignal);
  const lastOfflineRefreshDataRef = useRef(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );
  const visibleProjectTabs = useMemo(
    () => getVisibleProjectTabs(data.settings?.visibleProjectTabs, activeUser?.role),
    [activeUser?.role, data.settings?.visibleProjectTabs],
  );
  const visibleOfflineProjectRecords = useMemo(() => {
    const visibleIds = new Set(visibleProjects.map((project) => project.id));
    return offlineProjectRecords.filter((record) => visibleIds.has(record.projectId));
  }, [offlineProjectRecords, visibleProjects]);
  const offlineProjectIds = useMemo(
    () => new Set(visibleOfflineProjectRecords.map((record) => record.projectId)),
    [visibleOfflineProjectRecords],
  );
  const offlineStorageBytes = visibleOfflineProjectRecords.reduce(
    (total, record) => total + (Number(record.byteSize) || 0) + (Number(record.assetSummary?.byteSize) || 0),
    0,
  );
  const offlineRecordScope = offlineProjectRecords.map((record) => record.projectId).sort().join('|');

  useEffect(() => {
    let cancelled = false;
    if (!offlineUserId) {
      setOfflineProjectRecords([]);
      return undefined;
    }
    const refreshOfflineRecords = () => {
      void listOfflineProjectRecords(offlineUserId)
        .then((records) => {
          if (!cancelled) setOfflineProjectRecords(records);
        })
        .catch(() => {
          if (!cancelled) setOfflineProjectRecords([]);
        });
    };
    refreshOfflineRecords();
    const unsubscribe = subscribeToOfflineProjects(offlineUserId, refreshOfflineRecords);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [offlineUserId]);

  useEffect(() => {
    if (visibleOfflineProjectRecords.length || !offlineOnly) return;
    setOfflineOnly(false);
  }, [offlineOnly, visibleOfflineProjectRecords.length]);

  const visibleTasks = useMemo(
    () => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects),
    [data.tasks, data.settings, visibleProjects],
  );
  const scheduleAssigneeOptions = useMemo(
    () => buildTaskAssigneeOptions(data.subs || [], data.employees || []),
    [data.employees, data.subs],
  );
  const complianceWarnings = useSubcontractorComplianceWarnings(data.subs || [], !readOnly);

  const overviewProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    return visibleProjects.filter((project) => {
      if (offlineOnly && !offlineProjectIds.has(project.id)) return false;
      if (projectStatusFilter !== 'all' && project.status !== projectStatusFilter) return false;
      if (!query) return true;
      return [project.name, project.address, project.customerName, project.desc, project.status]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [offlineOnly, offlineProjectIds, projectSearchQuery, projectStatusFilter, visibleProjects]);

  const taskCountByProject = useMemo(() => {
    const counts = new Map();
    visibleTasks.forEach((task) => {
      counts.set(task.projectId, (counts.get(task.projectId) || 0) + 1);
    });
    return counts;
  }, [visibleTasks]);

  const selectedProject = useMemo(
    () => visibleProjects.find((project) => project.id === selectedProjectId) || null,
    [selectedProjectId, visibleProjects],
  );
  const selectedProjectTasks = useMemo(
    () => visibleTasks.filter((task) => task.projectId === selectedProjectId),
    [selectedProjectId, visibleTasks],
  );

  const totals = useMemo(() => {
    const phases = overviewProjects.reduce(
      (sum, project) => sum + (project.phases?.length || 0),
      0,
    );
    const steps = overviewProjects.reduce(
      (sum, project) =>
        sum +
        (project.phases || []).reduce(
          (phaseSum, phase) => phaseSum + (phase.steps?.length || 0),
          0,
        ),
      0,
    );
    const tasks = overviewProjects.reduce((sum, project) => sum + (taskCountByProject.get(project.id) || 0), 0);
    const inspections = overviewProjects.reduce(
      (sum, project) => sum + (project.inspections?.length || 0),
      0,
    );
    return { phases, steps, tasks, inspections };
  }, [overviewProjects, taskCountByProject]);
  const allOverviewProjectsExpanded =
    overviewProjects.length > 0 && overviewProjects.every((project) => expandedOverviewProjectIds.has(project.id));

  function toggleOverviewProject(projectId) {
    setExpandedOverviewProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleAllOverviewProjects() {
    if (allOverviewProjectsExpanded) {
      setExpandedOverviewProjectIds(new Set());
      return;
    }
    setExpandedOverviewProjectIds((current) => {
      const next = new Set(current);
      overviewProjects.forEach((project) => next.add(project.id));
      return next;
    });
  }

  function setSelectedProject(projectId, history = 'push') {
    nextProjectHistoryModeRef.current = history;
    setSelectedProjectId(String(projectId || '').trim());
  }

  useEffect(() => {
    if (selectedProjectId && !visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProject('', 'replace');
    }
  }, [selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (activeUser?.role !== 'Customer' || selectedProjectId || visibleProjects.length !== 1) return;
    setSelectedProject(visibleProjects[0].id, 'replace');
  }, [activeUser?.role, selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (previousHomeSignalRef.current === homeSignal) return;
    previousHomeSignalRef.current = homeSignal;
    setSelectedProject('', 'none');
  }, [homeSignal]);

  useEffect(() => {
    if (!navigationTarget?.projectId) return;
    if (!visibleProjects.some((project) => project.id === navigationTarget.projectId)) return;
    setSelectedProject(navigationTarget.projectId, 'push');
  }, [navigationTarget, visibleProjects]);

  useEffect(() => {
    if (navigationTarget?.action !== 'create' || readOnly) return;
    startCreate();
  }, [navigationTarget, readOnly]);

  useEffect(() => {
    const previousProjectId = previousSelectedProjectIdRef.current;
    const historyMode = nextProjectHistoryModeRef.current;
    nextProjectHistoryModeRef.current = 'none';

    if (previousProjectId === selectedProjectId) return;

    if (historyMode === 'replace') {
      syncProjectToLocation(selectedProjectId, { push: false });
    } else if (historyMode === 'push') {
      syncProjectToLocation(selectedProjectId, { push: true });
    }

    previousSelectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    function handleProjectPopState() {
      nextProjectHistoryModeRef.current = 'none';
      setSelectedProjectId(getProjectIdFromLocation());
    }

    window.addEventListener('popstate', handleProjectPopState);
    return () => window.removeEventListener('popstate', handleProjectPopState);
  }, []);

  async function refreshOfflineProjectCopies({ quiet = false } = {}) {
    if (!offlineUserId || !offlineProjectRecords.length || deferredDataLoading || data.storageMode !== 'supabase') return;
    if (!quiet) setOfflineCopiesBusy(true);
    try {
      let workflowFailureCount = 0;
      const currentProjects = new Map(visibleProjects.map((project) => [project.id, project]));
      const refreshPlan = planOfflineProjectRefresh(offlineProjectRecords, visibleProjects);
      await Promise.all(refreshPlan.removeProjectIds.map(async (projectId) => {
        await removeOfflineProjectAssets(offlineUserId, projectId);
        await removeOfflineProject(offlineUserId, projectId);
      }));
      await Promise.all(refreshPlan.refreshProjectIds.map(async (projectId) => {
        const currentProject = currentProjects.get(projectId);
        const existingRecord = offlineProjectRecords.find((record) => record.projectId === projectId);
        const workflowSnapshot = quiet
          ? {
            workflows: existingRecord?.snapshot?.workflows || {},
            cachedSections: (existingRecord?.cachedSections || []).filter((sectionId) =>
              Object.prototype.hasOwnProperty.call(OFFLINE_WORKFLOW_SECTION_TYPES, sectionId)),
          }
          : await loadOfflineProjectWorkflowSnapshot({
            projectId,
            visibleTabs: visibleProjectTabs,
            role: activeUser?.role,
          });
        workflowFailureCount += workflowSnapshot.failures?.length || 0;
        await cacheProjectForOffline({
          userId: offlineUserId,
          project: currentProject,
          tasks: data.tasks,
          settings: data.settings,
          subs: data.subs || [],
          employees: data.employees || [],
          workflows: workflowSnapshot.workflows,
          workflowSections: workflowSnapshot.cachedSections,
          visibleTabs: visibleProjectTabs,
        });
      }));
      if (!quiet && workflowFailureCount) {
        await showAppAlert(
          `${workflowFailureCount} workflow section${workflowFailureCount === 1 ? '' : 's'} could not be refreshed. Their prior records are no longer marked available offline; reconnect and refresh copies again.`,
          'Offline copies partially updated',
        );
      }
    } catch (error) {
      if (!quiet) {
        await showAppAlert(
          error instanceof Error ? error.message : 'Offline project copies could not be refreshed.',
          'Offline refresh failed',
        );
      }
    } finally {
      if (!quiet) setOfflineCopiesBusy(false);
    }
  }

  useEffect(() => {
    if (
      !offlineUserId
      || !offlineProjectRecords.length
      || deferredDataLoading
      || data.storageMode !== 'supabase'
      || navigator.onLine === false
      || lastOfflineRefreshDataRef.current === data
    ) return;
    lastOfflineRefreshDataRef.current = data;
    void refreshOfflineProjectCopies({ quiet: true });
  }, [data, deferredDataLoading, offlineRecordScope, offlineUserId]);

  function startCreate() {
    setProjectDraft({
      id: '',
      name: '',
      desc: '',
      start: '',
      end: '',
      status: 'planning',
      manager: '',
      address: '',
      permitNumber: '',
      drNumber: '',
      block: '',
      lot: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerAddress: '',
      customerNotes: '',
      progress: 0,
      mainPhotoId: '',
      mainPhotoCrop: false,
      photos: [],
      accessUserIds: [],
      phases: [],
    });
  }

  function startEdit(project) {
    setProjectDraft({
      id: project.id,
      name: project.name || '',
      desc: project.desc || '',
      start: project.start || '',
      end: project.end || '',
      status: project.status || 'planning',
      manager: project.manager || '',
      address: project.address || '',
      permitNumber: project.permitNumber || '',
      drNumber: project.drNumber || '',
      block: project.block || '',
      lot: project.lot || '',
      customerName: project.customerName || '',
      customerPhone: project.customerPhone || '',
      customerEmail: project.customerEmail || '',
      customerAddress: project.customerAddress || '',
      customerNotes: project.customerNotes || '',
      progress: project.progress ?? 0,
      mainPhotoId: project.mainPhotoId || '',
      mainPhotoCrop: project.mainPhotoCrop === true,
      photos: project.photos || [],
      accessUserIds: normalizeProjectAccessUserIds(project.accessUserIds),
      phases: project.phases || [],
    });
  }

  function handleProjectDetailCalendarDateClick(dateKey) {
    if (!selectedProject) return;
    const targetPhaseId = resolveProjectDetailPhaseForDate(selectedProject, dateKey);
    setStepPredecessorDraft(null);
    setStepDraft(buildProjectStepDraft(data, selectedProject.id, targetPhaseId, dateKey));
  }

  function handleProjectDetailCalendarItemClick(item) {
    if (!selectedProject || item?.type !== 'step') return;
    const phase = (selectedProject.phases || []).find(
      (entry) => entry.id === (item.phaseId || item.parentPhaseId),
    );
    const step = phase?.steps?.find((entry) => entry.id === (item.stepId || item.entityId));
    if (!phase || !step) return;
    setStepPredecessorDraft(null);
    setStepDraft(buildProjectStepEditDraft(data, selectedProject.id, phase.id, step));
  }

  async function runProjectMutation(key, mutation) {
    return runMutation(key, async () => {
      const nextState = await mutation();
      onStateChange(nextState);
      setProjectDraft(null);
      return nextState;
    });
  }

  async function handleSaveProject() {
    if (!projectDraft?.name.trim()) return;
    if (projectDraft.id) {
      await runProjectMutation(['project', projectDraft.id], () => updateProject(data, projectDraft.id, projectDraft));
      return;
    }
    await runProjectMutation('project:create', () => createProject(data, projectDraft));
  }

  async function handleDeleteProject() {
    if (!projectDraft?.id) return;
    const confirmed = await showAppConfirm(`Delete "${projectDraft.name}" with its schedule data and standalone tasks?`, {
      title: 'Delete project',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runProjectMutation(['project', projectDraft.id], () => deleteProject(data, projectDraft.id));
  }

  function buildProjectStepDependencyOptions(projectId, phaseId, selectedPreds = [], projectsSource = data.projects) {
    const project = (projectsSource || []).find((item) => item.id === projectId);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    const selectedMap = new Map(normalizePreds(selectedPreds).map((pred) => [pred.id, pred.lag || 0]));
    return (phase?.steps || [])
      .slice()
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        dateLabel: item.start
          ? `${formatShortDate(item.start)} - ${item.end ? formatShortDate(item.end) : 'No end'}`
          : item.end
            ? `Ends ${formatShortDate(item.end)}`
            : 'Date not set',
        selected: selectedMap.has(item.id),
        lag: selectedMap.get(item.id) || 0,
      }));
  }

  function getProjectDetailDefaultStepStart(project, phaseId, settings, startOverride = '') {
    if (startOverride) return normalizeStartDate(startOverride, settings);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    if (!phase) return '';
    const latestDate = (phase.steps || []).reduce((latest, step) => {
      const candidate = step.end || step.start || '';
      if (!candidate) return latest;
      return !latest || candidate > latest ? candidate : latest;
    }, phase.end || '');
    if (!latestDate) return '';
    const latest = parseDateValue(latestDate);
    if (!latest) return '';
    return normalizeStartDate(toIsoDate(addDays(latest, 1)), settings);
  }

  function buildProjectStepDraft(state, projectId, phaseId, startOverride = '') {
    const project = state.projects.find((item) => item.id === projectId);
    const start = getProjectDetailDefaultStepStart(project, phaseId, state.settings, startOverride);
    return {
      mode: 'create',
      type: 'step',
      projectId,
      phaseId,
      sourceProjectId: projectId,
      sourcePhaseId: phaseId,
      stepId: '',
      name: '',
      assignees: [],
      status: 'planning',
      color: getNextTaskColor(state.projects),
      start,
      notBefore: '',
      startEdited: Boolean(startOverride),
      duration: 1,
      endPreview: start ? computeStepEndDate(start, 1, state.settings) : '',
      predecessorOptions: buildProjectStepDependencyOptions(projectId, phaseId, [], state.projects),
      autoStart: !startOverride,
    };
  }

  function buildProjectStepEditDraft(state, projectId, phaseId, step) {
    const duration = Math.max(1, Number(step.duration) || 1);
    return {
      mode: 'edit',
      type: 'step',
      projectId,
      phaseId,
      sourceProjectId: projectId,
      sourcePhaseId: phaseId,
      stepId: step.id,
      name: step.name || '',
      assignees: getScheduleAssignees(step),
      status: step.status || (step.done ? 'done' : 'planning'),
      color: step.color || TASK_COLOR_PALETTE[0],
      start: step.notBefore || step.start || '',
      notBefore: step.notBefore || '',
      startEdited: false,
      duration,
      endPreview: (step.notBefore || step.start)
        ? computeStepEndDate(step.notBefore || step.start, duration, state.settings)
        : '',
      predecessorOptions: buildProjectStepDependencyOptions(projectId, phaseId, step.predecessors, state.projects),
      autoStart: false,
    };
  }

  function resolveProjectDetailPhaseForDate(project, dateKey) {
    const phases = project?.phases || [];
    if (!phases.length) return '';

    const containingPhase = phases.find((phase) => {
      const start = phase.start || '';
      const end = phase.end || phase.start || '';
      return start && end && dateKey >= start && dateKey <= end;
    });
    if (containingPhase) return containingPhase.id;

    const phasesBefore = phases
      .filter((phase) => (phase.end || phase.start || '') && (phase.end || phase.start || '') <= dateKey)
      .sort((a, b) => (a.end || a.start || '').localeCompare(b.end || b.start || ''));
    if (phasesBefore.length) return phasesBefore[phasesBefore.length - 1].id;

    const phasesAfter = phases
      .filter((phase) => (phase.start || phase.end || '') && (phase.start || phase.end || '') >= dateKey)
      .sort((a, b) => (a.start || a.end || '').localeCompare(b.start || b.end || ''));
    if (phasesAfter.length) return phasesAfter[0].id;

    return phases[0]?.id || '';
  }

  function resyncProjectSchedule(project) {
    return syncProjectPhaseDates(cascadePhaseDates(syncProjectPhaseDates(project), data.settings));
  }

  function updateProjectStepDraft(field, value) {
    setStepDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === 'projectId') {
        const nextProject = data.projects.find((project) => project.id === value);
        const phaseExists = (nextProject?.phases || []).some((phase) => phase.id === next.phaseId);
        if (!phaseExists) {
          next.phaseId = nextProject?.phases?.[0]?.id || '';
        }
      }
      if (field === 'phaseId' && next.autoStart) {
        next.start = getProjectDetailDefaultStepStart(
          data.projects.find((project) => project.id === next.projectId),
          value,
          data.settings,
        );
      }
      if (field === 'start') {
        next.autoStart = false;
        next.startEdited = true;
      }
      if (field === 'duration') {
        next.duration = Math.max(1, Number(value) || 1);
      }
      next.endPreview = next.start ? computeStepEndDate(next.start, next.duration, data.settings) : '';
      next.predecessorOptions = buildProjectStepDependencyOptions(
        next.projectId,
        next.phaseId,
        (next.predecessorOptions || []).filter((option) => option.selected).map((option) => ({
          id: option.id,
          lag: option.lag || 0,
        })),
      );
      return next;
    });
  }

  function openProjectStepPredecessors() {
    if (!stepDraft) return;
    setStepPredecessorDraft({
      entityType: 'step',
      name: stepDraft.name || 'New schedule step',
      options: (stepDraft.predecessorOptions || []).map((option) => ({ ...option })),
    });
  }

  function toggleProjectStepPred(stepId, checked) {
    setStepPredecessorDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, selected: checked, lag: checked ? option.lag : 0 } : option,
            ),
          }
        : current,
    );
  }

  function changeProjectStepPredLag(stepId, value) {
    setStepPredecessorDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, lag: Number(value) || 0 } : option,
            ),
          }
        : current,
    );
  }

  function saveProjectStepPredecessors() {
    if (!stepPredecessorDraft) return;
    setStepDraft((current) =>
      current
        ? {
            ...current,
            predecessorOptions: stepPredecessorDraft.options.map((option) => ({ ...option })),
          }
        : current,
    );
    setStepPredecessorDraft(null);
  }

  async function handleQuickAddProjectDetailPhase(projectId) {
    if (!projectId) return;
    setPhaseNameDraft({
      projectId,
      eyebrow: 'Phase',
      title: 'Add phase',
      description: 'Create a new phase without leaving the schedule step workflow.',
      label: 'Phase name',
      placeholder: 'Phase name',
      value: '',
      saveLabel: 'Add phase',
    });
  }

  async function saveProjectDetailPhaseNameDraft() {
    if (!phaseNameDraft?.projectId) return;
    const trimmed = phaseNameDraft.value.trim();
    if (!trimmed) return;

    await runMutation(['project', phaseNameDraft.projectId, 'phase-create'], async () => {
      const project = data.projects.find((item) => item.id === phaseNameDraft.projectId);
      if (!project) return;
      const newPhase = {
        id: `ph${Date.now()}`,
        name: trimmed,
        assignees: [],
        assign: '',
        status: 'planning',
        start: '',
        end: '',
        predecessors: [],
        steps: [],
      };
      const nextProject = {
        ...project,
        phases: [...(project.phases || []), newPhase],
      };
      const syncedProject = resyncProjectSchedule(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setStepDraft((current) => {
        if (!current) return current;
        const nextDraft = {
          ...current,
          projectId: phaseNameDraft.projectId,
          phaseId: newPhase.id,
          predecessorOptions: buildProjectStepDependencyOptions(phaseNameDraft.projectId, newPhase.id, [], nextState.projects),
        };
        if (nextDraft.autoStart) {
          nextDraft.start = '';
          nextDraft.endPreview = '';
        }
        return nextDraft;
      });
      setPhaseNameDraft(null);
    });
  }

  async function handleSaveProjectDetailStep(nextAction = 'close') {
    if (!stepDraft?.name.trim()) return;
    if (!stepDraft.projectId || !stepDraft.phaseId) {
      await showAppAlert('Choose a project and phase before saving the schedule step.', 'Missing project or phase');
      return;
    }

    setStepPredecessorDraft(null);
    const stepMutationKey = ['project', stepDraft.projectId, 'step', stepDraft.stepId || 'create'];
    await runMutation(stepMutationKey, async () => {
      try {
      const project = data.projects.find((item) => item.id === stepDraft.projectId);
      if (!project) return;
      const targetPhase = project.phases?.find((phase) => phase.id === stepDraft.phaseId);
      if (!targetPhase) {
        await showAppAlert('The selected phase no longer exists.', 'Phase unavailable');
        return;
      }
      const existingStep =
        stepDraft.mode === 'edit'
          ? data.projects
              .find((item) => item.id === (stepDraft.sourceProjectId || stepDraft.projectId))
              ?.phases?.find((phase) => phase.id === (stepDraft.sourcePhaseId || stepDraft.phaseId))
              ?.steps?.find((step) => step.id === stepDraft.stepId)
          : null;
      const sourceProjectId = stepDraft.sourceProjectId || stepDraft.projectId;
      const sourcePhaseId = stepDraft.sourcePhaseId || stepDraft.phaseId;
      const sourceProject = data.projects.find((item) => item.id === sourceProjectId) || null;
      const isMovingStep =
        stepDraft.mode === 'edit' && (stepDraft.projectId !== sourceProjectId || stepDraft.phaseId !== sourcePhaseId);
      const nextPredecessors = (stepDraft.predecessorOptions || [])
        .filter((option) => option.selected)
        .map((option) => ({ id: option.id, lag: option.lag || 0 }));
      const noSoonerThan = nextPredecessors.length
        ? normalizeStartDate(
            stepDraft.startEdited ? stepDraft.start : stepDraft.notBefore || '',
            data.settings,
          )
        : '';
      const nextStep = {
        ...(existingStep || {}),
        id: stepDraft.mode === 'create' ? `s${Date.now()}` : stepDraft.stepId,
        name: stepDraft.name.trim(),
        ...scheduleAssigneeFields(stepDraft.assignees),
        status: stepDraft.status,
        color: stepDraft.color || TASK_COLOR_PALETTE[0],
        done: stepDraft.status === 'done',
        start: stepDraft.start || '',
        notBefore: noSoonerThan,
        duration: Math.max(1, Number(stepDraft.duration) || 1),
        end: stepDraft.start ? stepDraft.endPreview || '' : '',
        predecessors: nextPredecessors,
      };
      if (isMovingStep) {
        nextStep.successors = [];
      }
      nextStep.predecessors.forEach((pred) => {
        if (wouldCreateCycleFromPreds(targetPhase, pred.id, nextStep.id)) {
          throw new Error('Cannot create a circular dependency.');
        }
      });

      const removeStepFromPhase = (phase) => {
        const filteredSteps = (phase.steps || []).map((step) => ({
          ...step,
          predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== stepDraft.stepId),
          successors: Array.isArray(step.successors)
            ? step.successors.filter((successorId) => successorId !== stepDraft.stepId)
            : step.successors,
        }));
        const nextPhase = {
          ...phase,
          steps: filteredSteps.filter((step) => step.id !== stepDraft.stepId),
          delays: (phase.delays || []).filter((delay) => delay.stepId !== stepDraft.stepId),
        };
        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      };

      const upsertStepInPhase = (phase, preserveExistingLinks) => {
        const existingSteps = [...(phase.steps || [])];
        const nextSteps =
          stepDraft.mode === 'create'
            ? [...existingSteps, nextStep]
            : existingSteps.some((step) => step.id === stepDraft.stepId)
              ? existingSteps.map((step) =>
                  step.id === stepDraft.stepId
                    ? {
                        ...nextStep,
                        predecessors: nextStep.predecessors || [],
                        successors: preserveExistingLinks && !isMovingStep ? step.successors : nextStep.successors,
                      }
                    : step,
                )
              : [...existingSteps, nextStep];
        const nextPhase = {
          ...phase,
          steps: nextSteps,
        };
        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      };

      if (!isMovingStep || !sourceProject || sourceProject.id === project.id) {
        const nextProject = {
          ...project,
          phases: (project.phases || []).map((phase) => {
            if (stepDraft.mode === 'create') {
              if (phase.id !== stepDraft.phaseId) return phase;
              return upsertStepInPhase(phase, false);
            }
            if (isMovingStep) {
              if (phase.id === sourcePhaseId) return removeStepFromPhase(phase);
              if (phase.id === stepDraft.phaseId) return upsertStepInPhase(phase, false);
              return phase;
            }
            if (phase.id !== stepDraft.phaseId) return phase;
            return upsertStepInPhase(phase, true);
          }),
        };
        const syncedProject = resyncProjectSchedule(nextProject);
        const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
        const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
        onStateChange(nextState);
        if (nextAction === 'new') {
          setStepDraft(buildProjectStepDraft(nextState, stepDraft.projectId, stepDraft.phaseId));
        } else {
          setStepDraft(null);
        }
        return;
      }

      const nextSourceProject = resyncProjectSchedule({
        ...sourceProject,
        phases: (sourceProject.phases || []).map((phase) =>
          phase.id === sourcePhaseId ? removeStepFromPhase(phase) : phase,
        ),
      });

      const nextTargetProject = resyncProjectSchedule({
        ...project,
        phases: (project.phases || []).map((phase) =>
          phase.id === stepDraft.phaseId ? upsertStepInPhase(phase, false) : phase,
        ),
      });

      let nextTasks = syncProjectTasks(sourceProject.id, nextSourceProject, data.tasks);
      nextTasks = syncProjectTasks(project.id, nextTargetProject, nextTasks);
      const nextState = await updateProjectsAndTasks(data, [nextSourceProject, nextTargetProject], nextTasks);
      onStateChange(nextState);
      if (nextAction === 'new') {
        setStepDraft(buildProjectStepDraft(nextState, stepDraft.projectId, stepDraft.phaseId));
      } else {
        setStepDraft(null);
      }
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to save the step.', 'Save failed');
      }
    });
  }

  async function handleDeleteProjectDetailStep() {
    if (!stepDraft || stepDraft.mode === 'create') return;
    const confirmed = await showAppConfirm(`Delete "${stepDraft.name}"?`, {
      title: 'Delete schedule step',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    const projectId = stepDraft.sourceProjectId || stepDraft.projectId;
    const phaseId = stepDraft.sourcePhaseId || stepDraft.phaseId;
    const stepId = stepDraft.stepId;
    await runMutation(['project', projectId, 'step', stepId], async () => {
      const currentState = dataRef.current;
      const project = currentState.projects.find((item) => item.id === projectId);
      if (!project || !phaseId || !stepId) return;

      const nextProject = resyncProjectSchedule({
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== phaseId) return phase;
          const nextPhase = {
            ...phase,
            steps: (phase.steps || [])
              .map((step) => ({
                ...step,
                predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== stepId),
                successors: Array.isArray(step.successors)
                  ? step.successors.filter((successorId) => successorId !== stepId)
                  : step.successors,
              }))
              .filter((step) => step.id !== stepId),
            delays: (phase.delays || []).filter((delay) => delay.stepId !== stepId),
          };
          syncStepLinks(nextPhase);
          cascadeStepDates(nextPhase, currentState.settings);
          return nextPhase;
        }),
      });

      const dueSnapshot = new Map(
        currentState.tasks
          .filter((task) => task.projectId === projectId)
          .map((task) => [task.id, task.due || '']),
      );
      const nextTasks = syncProjectTasks(projectId, nextProject, currentState.tasks);
      const nextState = await updateProjectAndTasks(currentState, projectId, nextProject, nextTasks);
      dataRef.current = nextState;
      onStateChange(nextState);
      showUndoAction({
        message: `Deleted "${stepDraft.name}".`,
        onUndo: async () => {
          const undoState = dataRef.current;
          const restoredTasks = undoState.tasks.map((task) =>
            dueSnapshot.has(task.id) ? { ...task, due: dueSnapshot.get(task.id) } : task,
          );
          const restoredState = await updateProjectAndTasks(undoState, projectId, project, restoredTasks);
          dataRef.current = restoredState;
          onStateChange(restoredState);
        },
      });
      setStepDraft(null);
    });
  }

  const projectSaving = projectDraft?.id
    ? isMutating(['project', projectDraft.id])
    : isMutating('project:create');
  const stepSaving = stepDraft
    ? isMutating(['project', stepDraft.projectId, 'step', stepDraft.stepId || 'create']) ||
      isMutating(['project', stepDraft.sourceProjectId || stepDraft.projectId, 'step', stepDraft.stepId || 'create'])
    : false;
  const phaseSaving = phaseNameDraft
    ? isMutating(['project', phaseNameDraft.projectId, 'phase-create'])
    : false;

  return (
    <section className="panel native-panel workspace-page">
      {selectedProject ? (
        <Suspense fallback={<div className="empty-state compact"><p>Loading project details...</p></div>}>
        <ProjectDetailView
          data={data}
          project={selectedProject}
          tasks={selectedProjectTasks}
          settings={data.settings}
          canEdit={!readOnly && !deferredDataLoading}
          activeUser={activeUser}
          deferredDataLoading={deferredDataLoading}
          offlineUserId={offlineUserId}
          offlineOperations={offlineOperations}
          selectionNavigationRequest={navigationTarget}
          onBack={activeUser?.role === 'Customer' ? null : () => setSelectedProject('', 'push')}
          onEdit={startEdit}
          onDateClick={readOnly ? () => {} : handleProjectDetailCalendarDateClick}
          onCalendarItemClick={readOnly ? () => {} : handleProjectDetailCalendarItemClick}
          onStateChange={onStateChange}
        />
        </Suspense>
      ) : (
        <>
          {deferredDataLoading ? (
            <div className="empty-state compact" role="status" aria-live="polite">
              <p>Project summaries are ready. Loading portfolio schedules, inspections, and files...</p>
            </div>
          ) : null}
          {visibleProjects.length ? (
            <section className="workspace-section projects-overview-section">
              <div className="projects-overview-main">
                  <div className="projects-overview-header">
                    <div className="projects-overview-copy">
                      <h2>Projects Overview</h2>
                      <p>Live portfolio snapshot for the jobs that need attention today.</p>
                    </div>
                    <div className="projects-overview-stats">
                      <div className="overview-stat-tile">
                        <span>Projects</span>
                        <strong>{overviewProjects.length}</strong>
                      </div>
                      <div className="overview-stat-tile">
                        <span>Open tasks</span>
                        <strong>{totals.tasks}</strong>
                      </div>
                      <div className="overview-stat-tile">
                        <span>Inspections</span>
                        <strong>{totals.inspections}</strong>
                      </div>
                      <div className="overview-stat-tile">
                        <span>Phases / steps</span>
                        <strong>{totals.phases} / {totals.steps}</strong>
                      </div>
                    </div>
                  </div>
                  <section className="offline-projects-overview" aria-label="Offline projects">
                    <div className="offline-projects-overview-heading">
                      <div>
                        <span className="offline-projects-overview-icon"><FluentIcon name="checkCircle" size={18} /></span>
                        <span>
                          <strong>Offline projects</strong>
                          <small>
                            {visibleOfflineProjectRecords.length
                              ? `${visibleOfflineProjectRecords.length} available · ${formatOfflineProjectSize(offlineStorageBytes)} · Updated ${formatOfflineSyncTime(visibleOfflineProjectRecords[0]?.lastSyncedAt)}`
                              : 'No projects are saved for offline use on this device.'}
                          </small>
                        </span>
                      </div>
                      <div className="offline-projects-overview-actions">
                        {visibleOfflineProjectRecords.length ? (
                          <button
                            className={`button secondary${offlineCopiesBusy ? ' is-loading' : ''}`}
                            type="button"
                            onClick={() => void refreshOfflineProjectCopies()}
                            disabled={offlineCopiesBusy || deferredDataLoading || data.storageMode !== 'supabase' || navigator.onLine === false}
                          >
                            Refresh copies
                          </button>
                        ) : null}
                        <button
                          className={`button secondary${offlineOnly ? ' active' : ''}`}
                          type="button"
                          aria-pressed={offlineOnly}
                          onClick={() => setOfflineOnly((current) => !current)}
                          disabled={!visibleOfflineProjectRecords.length}
                        >
                          {offlineOnly ? 'Show all projects' : 'Show offline only'}
                        </button>
                      </div>
                    </div>
                    {visibleOfflineProjectRecords.length ? (
                      <div className="offline-projects-overview-list">
                        {visibleOfflineProjectRecords.map((record) => (
                          <button key={record.id} type="button" onClick={() => setSelectedProject(record.projectId, 'push')}>
                            <strong>{record.projectName}</strong>
                            <small>
                              {formatOfflineProjectSize((record.byteSize || 0) + (record.assetSummary?.byteSize || 0))} · {record.cachedSections.length} sections
                              {record.assetSummary?.count ? ` · ${record.assetSummary.count} downloads` : ''}
                            </small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p>Open a project and use More → Make available offline.</p>
                    )}
                  </section>
                  <div className="projects-filter-toolbar">
                    <ResponsiveFilterMenu label="Project filters">
                    <input
                      className="schedule-search-input projects-search-input"
                      type="search"
                      value={projectSearchQuery}
                      onChange={(event) => setProjectSearchQuery(event.target.value)}
                      placeholder="Search projects"
                      aria-label="Search projects"
                    />
                    <label className="task-filter projects-status-filter">
                      <span>Status</span>
                      <select value={projectStatusFilter} onChange={(event) => setProjectStatusFilter(event.target.value)}>
                        <option value="all">All statuses</option>
                        <option value="planning">Planning</option>
                        <option value="active">Active</option>
                        <option value="delayed">Delayed</option>
                        <option value="done">Done</option>
                      </select>
                    </label>
                    <SavedFiltersControls
                      storageKey={`project-tracker:saved-filters:projects:${activeUser?.id || 'default'}`}
                      currentValue={{ query: projectSearchQuery, status: projectStatusFilter }}
                      onApply={(filter) => {
                        setProjectSearchQuery(String(filter.query || ''));
                        setProjectStatusFilter(['planning', 'active', 'delayed', 'done'].includes(filter.status) ? filter.status : 'all');
                      }}
                    />
                    </ResponsiveFilterMenu>
                    <button className="button secondary expand-collapse-all-button projects-expand-all-button" type="button" onClick={toggleAllOverviewProjects} aria-expanded={allOverviewProjectsExpanded}>
                      <FluentIcon name={allOverviewProjectsExpanded ? 'collapseAll' : 'expandAll'} />
                      {allOverviewProjectsExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  </div>
                  <div className="project-grid">
                    {overviewProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        tasks={visibleTasks.filter((task) => task.projectId === project.id)}
                        taskCount={taskCountByProject.get(project.id) || 0}
                        expanded={expandedOverviewProjectIds.has(project.id)}
                        onToggle={toggleOverviewProject}
                        onEdit={readOnly ? undefined : startEdit}
                        onOpen={() => setSelectedProject(project.id, 'push')}
                        offlineAvailable={offlineProjectIds.has(project.id)}
                      />
                    ))}
                  </div>
                  {!overviewProjects.length ? (
                    <div className="empty-state compact-empty-state">
                      <h3>No matching projects</h3>
                      <p>Adjust the current search or status filter.</p>
                    </div>
                  ) : null}
              </div>
            </section>
          ) : (
            <div className="empty-state">
              <h3>No projects loaded</h3>
              <p>Connect Supabase or create your first project to populate this view.</p>
            </div>
          )}
        </>
      )}
      {!selectedProjectId ? (
        <>
          <PageStats settings={data.settings}>
            <DashboardStat label="Projects" value={overviewProjects.length} tone="brand" />
            <DashboardStat label="Phases" value={totals.phases} />
            <DashboardStat label="Schedule steps" value={totals.steps} />
            <DashboardStat label="Standalone tasks" value={totals.tasks} />
          </PageStats>
          <div className="page-refresh-footer">
            <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh data'}
            </button>
          </div>
        </>
      ) : null}
      <Suspense fallback={null}>
      {projectDraft ? (
        <ProjectModal
          draft={projectDraft}
          users={users}
          onChange={(field, value) => setProjectDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setProjectDraft(null)}
          onSave={readOnly ? () => {} : handleSaveProject}
          onDelete={readOnly ? () => {} : handleDeleteProject}
          saving={projectSaving}
          isEditing={!!projectDraft.id}
        />
      ) : null}
      {!readOnly && stepDraft ? (
        <ScheduleItemModal
          draft={stepDraft}
          type="step"
          projects={visibleProjects}
          assigneeOptions={scheduleAssigneeOptions}
          complianceWarnings={complianceWarnings}
          saving={stepSaving}
          onChange={updateProjectStepDraft}
          onOpenPreds={openProjectStepPredecessors}
          onAddPhase={handleQuickAddProjectDetailPhase}
          onClose={() => {
            setStepPredecessorDraft(null);
            setStepDraft(null);
          }}
          onSave={() => handleSaveProjectDetailStep('close')}
          onSaveAndNew={() => handleSaveProjectDetailStep('new')}
          onDelete={handleDeleteProjectDetailStep}
        />
      ) : null}
      {stepPredecessorDraft ? <StepPredecessorModal
        draft={stepPredecessorDraft}
        saving={stepSaving}
        onTogglePred={toggleProjectStepPred}
        onLagChange={changeProjectStepPredLag}
        onClose={() => setStepPredecessorDraft(null)}
        onSave={saveProjectStepPredecessors}
      /> : null}
      {!readOnly && phaseNameDraft ? (
        <TextEntryModal
          draft={phaseNameDraft}
          saving={phaseSaving}
          onChange={(value) => setPhaseNameDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setPhaseNameDraft(null)}
          onSave={saveProjectDetailPhaseNameDraft}
        />
      ) : null}
      </Suspense>
    </section>
  );
}
