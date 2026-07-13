import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getVisibleProjectsForUser, getVisibleTasksForUser, normalizeProjectAccessUserIds } from '../utils/accessUi.js';
import { createProject, deleteProject, updateProject, updateProjectAndTasks } from '../services/trackerData.js';
import {
  cascadePhaseDates, cascadeStepDates, computeStepEndDate, normalizePreds, normalizeStartDate,
  syncProjectPhaseDates, syncProjectTasks, syncStepLinks, wouldCreateCycleFromPreds,
} from '../utils/schedule.js';
import { addDays, formatShortDate, toIsoDate } from '../utils/calendarUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import { StepPredecessorModal, TextEntryModal } from './FormDialogs.jsx';
import ProjectCard from './ProjectCard.jsx';
import ProjectDetailView from './ProjectDetailView.jsx';
import ProjectModal from './ProjectModal.jsx';
import { ScheduleItemModal } from './ScheduleDialogs.jsx';
import { DashboardStat, PageStats } from './SharedUI.jsx';

const TASK_COLOR_PALETTE = ['#2f6f8f', '#c54f7c', '#5f8f3d', '#b86a2f', '#6c5aa7', '#2f8c83', '#9a554f', '#4f6fb2'];
function parseDateValue(iso) { if (!iso) return null; const date = new Date(`${iso}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function getNextTaskColor(projects = []) { const count = projects.reduce((total, project) => total + (project.phases || []).reduce((sum, phase) => sum + (phase.steps || []).length, 0), 0); return TASK_COLOR_PALETTE[count % TASK_COLOR_PALETTE.length]; }
function getProjectIdFromLocation() { if (typeof window === 'undefined') return ''; return String(new URLSearchParams(window.location.search).get('project') || '').trim(); }
function syncProjectToLocation(projectId, { push = false } = {}) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (String(projectId || '').trim()) url.searchParams.set('project', String(projectId).trim()); else url.searchParams.delete('project');
  if (push) window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
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
}) {
  const [projectDraft, setProjectDraft] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(getProjectIdFromLocation);
  const [stepDraft, setStepDraft] = useState(null);
  const [stepPredecessorDraft, setStepPredecessorDraft] = useState(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const previousSelectedProjectIdRef = useRef(getProjectIdFromLocation());
  const nextProjectHistoryModeRef = useRef('none');
  const initializedHomeSignalRef = useRef(false);
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );

  const visibleTasks = useMemo(
    () => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects),
    [data.tasks, data.settings, visibleProjects],
  );

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
    const phases = visibleProjects.reduce(
      (sum, project) => sum + (project.phases?.length || 0),
      0,
    );
    const steps = visibleProjects.reduce(
      (sum, project) =>
        sum +
        (project.phases || []).reduce(
          (phaseSum, phase) => phaseSum + (phase.steps?.length || 0),
          0,
        ),
      0,
    );
    const tasks = [...taskCountByProject.values()].reduce((sum, count) => sum + count, 0);
    const inspections = visibleProjects.reduce(
      (sum, project) => sum + (project.inspections?.length || 0),
      0,
    );
    return { phases, steps, tasks, inspections };
  }, [taskCountByProject, visibleProjects]);

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
    if (!initializedHomeSignalRef.current) {
      initializedHomeSignalRef.current = true;
      return;
    }
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

  function startCreate() {
    setProjectDraft({
      id: '',
      name: '',
      desc: '',
      start: '',
      end: '',
      status: 'planning',
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

  async function runProjectMutation(mutation) {
    setSaving(true);
    try {
      const nextState = await mutation();
      onStateChange(nextState);
      setProjectDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProject() {
    if (!projectDraft?.name.trim()) return;
    if (projectDraft.id) {
      await runProjectMutation(() => updateProject(data, projectDraft.id, projectDraft));
      return;
    }
    await runProjectMutation(() => createProject(data, projectDraft));
  }

  async function handleDeleteProject() {
    if (!projectDraft?.id) return;
    const confirmed = await showAppConfirm(`Delete "${projectDraft.name}" and its tasks?`, {
      title: 'Delete project',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runProjectMutation(() => deleteProject(data, projectDraft.id));
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
      assign: '',
      status: 'planning',
      color: getNextTaskColor(state.projects),
      start,
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
      assign: step.assign || '',
      status: step.status || (step.done ? 'done' : 'planning'),
      color: step.color || TASK_COLOR_PALETTE[0],
      start: step.start || '',
      duration,
      endPreview: step.start ? computeStepEndDate(step.start, duration, state.settings) : '',
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
      name: stepDraft.name || 'New step',
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
      description: 'Create a new phase without leaving the step flow.',
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

    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === phaseNameDraft.projectId);
      if (!project) return;
      const newPhase = {
        id: `ph${Date.now()}`,
        name: trimmed,
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
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProjectDetailStep(nextAction = 'close') {
    if (!stepDraft?.name.trim()) return;
    if (!stepDraft.projectId || !stepDraft.phaseId) {
      await showAppAlert('Choose a project and phase before saving the step.', 'Missing project or phase');
      return;
    }

    setSaving(true);
    setStepPredecessorDraft(null);
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
      const nextStep = {
        ...(existingStep || {}),
        id: stepDraft.mode === 'create' ? `s${Date.now()}` : stepDraft.stepId,
        name: stepDraft.name.trim(),
        assign: stepDraft.assign.trim(),
        status: stepDraft.status,
        color: stepDraft.color || TASK_COLOR_PALETTE[0],
        done: stepDraft.status === 'done',
        start: stepDraft.start || '',
        duration: Math.max(1, Number(stepDraft.duration) || 1),
        end: stepDraft.start ? stepDraft.endPreview || '' : '',
        predecessors: (stepDraft.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 })),
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
      const sourceState = await updateProject(data, sourceProject.id, nextSourceProject);
      const nextState = await updateProjectAndTasks(sourceState, project.id, nextTargetProject, nextTasks);
      onStateChange(nextState);
      if (nextAction === 'new') {
        setStepDraft(buildProjectStepDraft(nextState, stepDraft.projectId, stepDraft.phaseId));
      } else {
        setStepDraft(null);
      }
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save the step.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProjectDetailStep() {
    if (!stepDraft || stepDraft.mode === 'create') return;
    const confirmed = await showAppConfirm(`Delete "${stepDraft.name}"?`, {
      title: 'Delete step',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const projectId = stepDraft.sourceProjectId || stepDraft.projectId;
      const phaseId = stepDraft.sourcePhaseId || stepDraft.phaseId;
      const stepId = stepDraft.stepId;
      const project = data.projects.find((item) => item.id === projectId);
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
          cascadeStepDates(nextPhase, data.settings);
          return nextPhase;
        }),
      });

      const nextTasks = syncProjectTasks(projectId, nextProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, projectId, nextProject, nextTasks);
      onStateChange(nextState);
      setStepDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel native-panel workspace-page">
      {selectedProject ? (
        <ProjectDetailView
          data={data}
          project={selectedProject}
          tasks={selectedProjectTasks}
          settings={data.settings}
          canEdit={!readOnly}
          activeUser={activeUser}
          selectionNavigationRequest={navigationTarget}
          onEdit={startEdit}
          onDateClick={readOnly ? () => {} : handleProjectDetailCalendarDateClick}
          onCalendarItemClick={readOnly ? () => {} : handleProjectDetailCalendarItemClick}
          onStateChange={onStateChange}
        />
      ) : (
        <>
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
                        <strong>{visibleProjects.length}</strong>
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
                  <div className="project-grid">
                    {visibleProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        taskCount={taskCountByProject.get(project.id) || 0}
                        onEdit={readOnly ? undefined : startEdit}
                        onOpen={() => setSelectedProject(project.id, 'push')}
                      />
                    ))}
                  </div>
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
            <DashboardStat label="Projects" value={visibleProjects.length} tone="brand" />
            <DashboardStat label="Phases" value={totals.phases} />
            <DashboardStat label="Steps" value={totals.steps} />
            <DashboardStat label="Tasks" value={totals.tasks} />
          </PageStats>
          <div className="page-refresh-footer">
            <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
              {loading ? 'Refreshing...' : 'Refresh data'}
            </button>
          </div>
        </>
      ) : null}
      {projectDraft ? (
        <ProjectModal
          draft={projectDraft}
          users={users}
          onChange={(field, value) => setProjectDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setProjectDraft(null)}
          onSave={readOnly ? () => {} : handleSaveProject}
          onDelete={readOnly ? () => {} : handleDeleteProject}
          saving={saving}
          isEditing={!!projectDraft.id}
        />
      ) : null}
      {!readOnly && stepDraft ? (
        <ScheduleItemModal
          draft={stepDraft}
          type="step"
          projects={visibleProjects}
          saving={saving}
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
      <StepPredecessorModal
        draft={stepPredecessorDraft}
        saving={saving}
        onTogglePred={toggleProjectStepPred}
        onLagChange={changeProjectStepPredLag}
        onClose={() => setStepPredecessorDraft(null)}
        onSave={saveProjectStepPredecessors}
      />
      {!readOnly ? (
        <TextEntryModal
          draft={phaseNameDraft}
          saving={saving}
          onChange={(value) => setPhaseNameDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setPhaseNameDraft(null)}
          onSave={saveProjectDetailPhaseNameDraft}
        />
      ) : null}
    </section>
  );
}

