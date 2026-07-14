import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser, personAssignmentLabel } from '../utils/accessUi.js';
import {
  createPerson, createTask, deleteProjectFileFromStorage, deleteTask, isSupabaseStorageConfigured,
  updateProject, updateProjectAndTasks, updateProjects, updateProjectsAndTasks, updateSettings, updateTask, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import {
  applyDelayToStep, cascadePhaseDates, cascadeStepDates, computeStepEndDate, normalizePreds,
  normalizeStartDate, syncProjectPhaseDates, syncProjectTasks, syncStepLinks,
  wouldCreateCycleFromPreds, wouldCreatePhaseCycleFromPreds,
} from '../utils/schedule.js';
import { buildCalendarItems as buildCalendarItemsView, buildCalendarWeeks as buildCalendarWeeksView, buildScheduleRows as buildScheduleRowsView, filterScheduleRows, getDefaultPhaseExpansion } from '../utils/scheduleView.js';
import {
  addDays, diffInDays, endOfMonth, endOfWeek, enumerateMonths,
  formatShortDate, formatTooltipDate,
  startOfMonth, startOfWeek, toIsoDate, useHorizontalSwipe,
} from '../utils/calendarUi.js';
import { showAppAlert, showAppConfirm, showUndoAction } from './AppDialogs.jsx';
import { DashboardStat, PageStats } from './SharedUI.jsx';
import SavedFiltersControls from './SavedFiltersControls.jsx';
import FluentIcon from './FluentIcon.jsx';
import SharedCalendarGrid from './SharedCalendarGrid.jsx';
import MobileScheduleAgenda from './MobileScheduleAgenda.jsx';
import {
  timelineItemIntersectsWindow,
  useHorizontalVirtualWindow,
  useVirtualRange,
} from '../utils/virtualization.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';

const ScheduleItemModal = lazy(() => import('./ScheduleDialogs.jsx').then((module) => ({ default: module.ScheduleItemModal })));
const DelayModal = lazy(() => import('./ScheduleDialogs.jsx').then((module) => ({ default: module.DelayModal })));
const DependencyModal = lazy(() => import('./ScheduleDialogs.jsx').then((module) => ({ default: module.DependencyModal })));
const InspectionModal = lazy(() => import('./TaskInspectionDialogs.jsx').then((module) => ({ default: module.InspectionModal })));
const TaskModal = lazy(() => import('./TaskInspectionDialogs.jsx').then((module) => ({ default: module.TaskModal })));
const StepPredecessorModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.StepPredecessorModal })));
const TextEntryModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.TextEntryModal })));
const PersonModal = lazy(() => import('./PersonModal.jsx'));

const GANTT_ROW_MIN_HEIGHT = 38;
const CALENDAR_VISIBLE_RANGE_LANES = 3;
const CALENDAR_COLLAPSED_WEEK_HEIGHT = 244;
const CALENDAR_COLLAPSED_BODY_MIN_HEIGHT = 32;
const GANTT_ZOOM_OPTIONS = [
  { label: '2 weeks', visibleDays: 14 }, { label: '1 month', visibleDays: 30 },
  { label: '2 months', visibleDays: 60 }, { label: '3 months', visibleDays: 90 },
];
const GANTT_ZOOM_REFERENCE_WIDTH = 760;
const SCHEDULE_VIEW_STORAGE_KEY = 'project-tracker:schedule-view';
const SCHEDULE_ZOOM_STORAGE_KEY = 'project-tracker:schedule-zoom';
const SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY = 'project-tracker:schedule-project-expansion';
const SCHEDULE_PHASE_EXPANSION_STORAGE_KEY = 'project-tracker:schedule-phase-expansion';
const SCHEDULE_HIDE_PAST_STORAGE_KEY = 'project-tracker:schedule-hide-past';
const TASK_COLOR_PALETTE = ['#2f6f8f', '#c54f7c', '#5f8f3d', '#b86a2f', '#6c5aa7', '#2f8c83', '#9a554f', '#4f6fb2'];

function getStoredScheduleView() {
  try {
    const stored = window.localStorage.getItem(SCHEDULE_VIEW_STORAGE_KEY);
    return stored === 'agenda' ? 'agenda' : 'gantt';
  } catch {
    return 'gantt';
  }
}

function getStoredScheduleZoom() {
  try {
    const stored = Number.parseInt(window.localStorage.getItem(SCHEDULE_ZOOM_STORAGE_KEY), 10);
    return Number.isInteger(stored) && stored >= 0 && stored < GANTT_ZOOM_OPTIONS.length ? stored : 1;
  } catch {
    return 1;
  }
}

function getStoredExpansion(storageKey) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, expanded]) => typeof expanded === 'boolean'));
  } catch {
    return {};
  }
}

function getStoredBoolean(storageKey, fallback = false) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Use the fallback when browser storage is unavailable.
  }
  return fallback;
}

function parseDateValue(iso) { if (!iso) return null; const date = new Date(`${iso}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function getTimelineStyle(row, minDate, maxDate) {
  const start = parseDateValue(row.start); const end = parseDateValue(row.end || row.start);
  if (!start || !end || maxDate <= minDate) return null;
  const totalDays = Math.max(1, diffInDays(minDate, maxDate) + 1); const safeEnd = end < start ? start : end;
  const offset = diffInDays(minDate, start); const duration = Math.max(1, diffInDays(start, safeEnd) + 1);
  return { left: `${(offset / totalDays) * 100}%`, width: row.isMilestone ? '16px' : `${(duration / totalDays) * 100}%`, ...(row.type === 'step' && row.color ? { backgroundColor: row.color } : {}) };
}
function getNextTaskColor(projects = []) {
  const taskCount = projects.reduce((total, project) => total + (project.phases || []).reduce((sum, phase) => sum + (phase.steps || []).length, 0), 0);
  return TASK_COLOR_PALETTE[taskCount % TASK_COLOR_PALETTE.length];
}
function getTimelineMetrics(row, minDate, maxDate) {
  const start = parseDateValue(row.start); const end = parseDateValue(row.end || row.start);
  if (!start || !end || maxDate <= minDate) return null;
  const totalDays = Math.max(1, diffInDays(minDate, maxDate) + 1); const safeEnd = end < start ? start : end;
  return { leftPct: (diffInDays(minDate, start) / totalDays) * 100, widthPct: (Math.max(1, diffInDays(start, safeEnd) + 1) / totalDays) * 100 };
}
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

export default function NativeScheduleView({
  data,
  refresh,
  loading,
  onStateChange,
  view = 'schedule',
  activeUser = null,
  projectFilter = 'all',
  onProjectFilterChange = () => {},
}) {
  const dataRef = useRef(data);
  const ganttGridRef = useRef(null);
  const ganttShellRef = useRef(null);
  const ganttTableRef = useRef(null);
  const ganttTimelineWrapRef = useRef(null);
  const mobileAgendaRef = useRef(null);
  const ganttLabelRowRefs = useRef([]);
  const ganttTimelineRowRefs = useRef([]);
  const lastAutoScrollKeyRef = useRef('');
  const [ganttZoomValue, setGanttZoomValue] = useState(getStoredScheduleZoom);
  const [expandedProjects, setExpandedProjects] = useState(() => getStoredExpansion(SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY));
  const [expandedPhases, setExpandedPhases] = useState(() => ({
    ...getDefaultPhaseExpansion(data.projects),
    ...getStoredExpansion(SCHEDULE_PHASE_EXPANSION_STORAGE_KEY),
  }));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const goToPreviousCalendarMonth = () =>
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  const goToNextCalendarMonth = () =>
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  const calendarSwipeHandlers = useHorizontalSwipe(goToNextCalendarMonth, goToPreviousCalendarMonth);
  const [editorDraft, setEditorDraft] = useState(null);
  const [delayDraft, setDelayDraft] = useState(null);
  const [dependencyDraft, setDependencyDraft] = useState(null);
  const [inspectionDraft, setInspectionDraft] = useState(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState(null);
  const [subcodeDraft, setSubcodeDraft] = useState(null);
  const [editorPredecessorDraft, setEditorPredecessorDraft] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [taskPersonDraft, setTaskPersonDraft] = useState(null);
  const [personAssignmentTarget, setPersonAssignmentTarget] = useState('task');
  const [dragDependency, setDragDependency] = useState(null);
  const [rowHeights, setRowHeights] = useState([]);
  const [expandedCalendarWeeks, setExpandedCalendarWeeks] = useState({});
  const { beginMutation, endMutation, isMutating } = useEntityMutations();
  const [activeGanttRowId, setActiveGanttRowId] = useState(null);
  const [hidePastScheduleItems, setHidePastScheduleItems] = useState(() => getStoredBoolean(SCHEDULE_HIDE_PAST_STORAGE_KEY));
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('');
  const [calendarItemFilter, setCalendarItemFilter] = useState('all');
  const isCalendarView = view === 'calendar';
  const isScheduleView = view === 'schedule';
  const [scheduleDisplayMode, setScheduleDisplayMode] = useState(getStoredScheduleView);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  function commitScheduleState(nextState) {
    dataRef.current = nextState;
    onStateChange(nextState);
  }

  async function restoreScheduleSnapshot(projectId, projectSnapshot, tasksSnapshot) {
    const dueByTaskId = new Map(
      tasksSnapshot
        .filter((task) => task.projectId === projectId)
        .map((task) => [task.id, task.due || '']),
    );
    const restoredTasks = dataRef.current.tasks.map((task) =>
      dueByTaskId.has(task.id) ? { ...task, due: dueByTaskId.get(task.id) } : task,
    );
    const restoredState = await updateProjectAndTasks(
      dataRef.current,
      projectId,
      projectSnapshot,
      restoredTasks,
    );
    commitScheduleState(restoredState);
  }

  useEffect(() => {
    if (!isScheduleView) return;
    try {
      window.localStorage.setItem(SCHEDULE_VIEW_STORAGE_KEY, scheduleDisplayMode);
      window.localStorage.setItem(SCHEDULE_ZOOM_STORAGE_KEY, String(ganttZoomValue));
      window.localStorage.setItem(SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY, JSON.stringify(expandedProjects));
      window.localStorage.setItem(SCHEDULE_PHASE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedPhases));
      window.localStorage.setItem(SCHEDULE_HIDE_PAST_STORAGE_KEY, String(hidePastScheduleItems));
    } catch {
      // Storage can be unavailable in privacy-restricted browsers; the in-memory preferences still work.
    }
  }, [expandedPhases, expandedProjects, ganttZoomValue, hidePastScheduleItems, isScheduleView, scheduleDisplayMode]);

  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );

  const visibleTasks = useMemo(
    () => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects),
    [data.tasks, data.settings, visibleProjects],
  );

  useEffect(() => {
    const defaults = getDefaultPhaseExpansion(visibleProjects);
    setExpandedPhases((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(defaults).forEach(([phaseId, expanded]) => {
        if (next[phaseId] !== undefined) return;
        next[phaseId] = expanded;
        changed = true;
      });
      return changed ? next : current;
    });
  }, [visibleProjects]);

  useEffect(() => {
    if (!visibleProjects.length) {
      onProjectFilterChange('all');
      return;
    }
    if (projectFilter !== 'all' && !visibleProjects.some((project) => project.id === projectFilter)) {
      onProjectFilterChange('all');
    }
  }, [onProjectFilterChange, projectFilter, visibleProjects]);

  const filteredProjects = useMemo(
    () => (projectFilter === 'all' ? visibleProjects : visibleProjects.filter((project) => project.id === projectFilter)),
    [projectFilter, visibleProjects],
  );
  const legacyShowTaskDueDates = data.settings?.showTaskDueDates;
  const showGanttTasks =
    data.settings?.showGanttTaskDueDates ?? (legacyShowTaskDueDates !== false);
  const showCalendarHebrewDates = data.settings?.showCalendarHebrewDates === true;
  const showCalendarTasks =
    data.settings?.showCalendarTaskDueDates ?? (legacyShowTaskDueDates !== false);
  const inspectionSubcodes = useMemo(
    () =>
      Array.isArray(data.settings?.inspectionSubcodes)
        ? data.settings.inspectionSubcodes.filter(Boolean)
        : ['FOOT-101', 'FRAME-220', 'ELEC-310'],
    [data.settings],
  );
  const taskAssigneeOptions = useMemo(
    () => buildTaskAssigneeOptions(data.subs || [], data.employees || []),
    [data.employees, data.subs],
  );

  const tasksByProject = useMemo(() => {
    const map = new Map();
    visibleTasks.forEach((task) => {
      if (!map.has(task.projectId)) map.set(task.projectId, []);
      map.get(task.projectId).push(task);
    });
    map.forEach((tasks) =>
      tasks.sort((a, b) => {
        const aKey = a.due || '9999-12-31';
        const bKey = b.due || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return a.label.localeCompare(b.label);
      }),
    );
    return map;
  }, [visibleTasks]);
  const allExpanded = useMemo(() => {
    if (!filteredProjects.length) return true;
    return filteredProjects.every((project) => {
      const projectExpanded = expandedProjects[project.id] ?? true;
      if (!projectExpanded) return false;
      return (project.phases || []).every((phase) => expandedPhases[phase.id] ?? true);
    });
  }, [expandedPhases, expandedProjects, filteredProjects]);

  const scheduleSearchActive = scheduleSearchQuery.trim().length > 0;
  const scheduleRows = useMemo(() => {
    const searchExpandedProjects = scheduleSearchActive
      ? Object.fromEntries(filteredProjects.map((project) => [project.id, true]))
      : expandedProjects;
    const searchExpandedPhases = scheduleSearchActive
      ? Object.fromEntries(filteredProjects.flatMap((project) => (project.phases || []).map((phase) => [phase.id, true])))
      : expandedPhases;
    return buildScheduleRowsView(
        filteredProjects,
        tasksByProject,
        showGanttTasks,
        searchExpandedProjects,
        searchExpandedPhases,
        { showCurrentAndFutureOnly: hidePastScheduleItems },
      );
  }, [expandedPhases, expandedProjects, filteredProjects, hidePastScheduleItems, scheduleSearchActive, showGanttTasks, tasksByProject]);
  const rows = useMemo(
    () => filterScheduleRows(scheduleRows, scheduleSearchQuery),
    [scheduleRows, scheduleSearchQuery],
  );

  const datedRows = useMemo(
    () => rows.filter((row) => parseDateValue(row.start) && parseDateValue(row.end || row.start)),
    [rows],
  );
  const hasScheduledRows = datedRows.length > 0;

  const timeline = useMemo(() => {
    if (datedRows.length) {
      const allDates = datedRows.flatMap((row) => [parseDateValue(row.start), parseDateValue(row.end || row.start)]);
      const validDates = allDates.filter(Boolean).sort((a, b) => a - b);
      if (validDates.length) {
        const minDate = startOfMonth(validDates[0]);
        const maxDate = endOfMonth(validDates[validDates.length - 1]);
        return {
          minDate,
          maxDate,
          months: enumerateMonths(minDate, maxDate),
        };
      }
    }

    const minDate = startOfMonth(calendarMonth);
    const maxDate = endOfMonth(calendarMonth);
    return {
      minDate,
      maxDate,
      months: enumerateMonths(minDate, maxDate),
    };
  }, [calendarMonth, datedRows]);
  const timelineTotalDays = useMemo(
    () => Math.max(1, diffInDays(timeline.minDate, timeline.maxDate) + 1),
    [timeline],
  );
  const ganttZoomOption = GANTT_ZOOM_OPTIONS[ganttZoomValue] || GANTT_ZOOM_OPTIONS[1];
  const ganttPixelsPerDay = GANTT_ZOOM_REFERENCE_WIDTH / ganttZoomOption.visibleDays;
  const ganttZoomLabel = ganttZoomOption.label;
  const timelineCanvasWidth = useMemo(
    () => Math.max(760, timelineTotalDays * ganttPixelsPerDay),
    [ganttPixelsPerDay, timelineTotalDays],
  );
  const timelineWeeks = useMemo(() => {
    const weeks = [];
    for (let weekStart = startOfWeek(timeline.minDate); weekStart <= timeline.maxDate; weekStart = addDays(weekStart, 7)) {
      const weekEnd = endOfWeek(weekStart);
      const visibleStart = weekStart < timeline.minDate ? timeline.minDate : weekStart;
      const visibleEnd = weekEnd > timeline.maxDate ? timeline.maxDate : weekEnd;
      const offset = diffInDays(timeline.minDate, visibleStart);
      const widthDays = diffInDays(visibleStart, visibleEnd) + 1;
      const startLabel = weekStart.toLocaleString('default', { month: 'short', day: 'numeric' });
      const endLabel = weekEnd.toLocaleString('default', {
        month: weekStart.getMonth() === weekEnd.getMonth() ? undefined : 'short',
        day: 'numeric',
      });
      weeks.push({
        key: toIsoDate(weekStart),
        label: `${startLabel} - ${endLabel}`,
        left: (offset / timelineTotalDays) * 100,
        width: (widthDays / timelineTotalDays) * 100,
      });
    }
    return weeks;
  }, [timeline.maxDate, timeline.minDate, timelineTotalDays]);
  const timelineDays = useMemo(() => {
    const days = [];
    for (let date = new Date(timeline.minDate); date <= timeline.maxDate; date = addDays(date, 1)) {
      const offset = diffInDays(timeline.minDate, date);
      const dateKey = toIsoDate(date);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isNonWorkdayHoliday = (data.settings?.holidays || []).some((holiday) => {
        if (holiday.nonWorkday === false || !holiday.date) return false;
        const holidayEnd = holiday.endDate || holiday.date;
        return dateKey >= holiday.date && dateKey <= holidayEnd;
      });
      days.push({
        key: dateKey,
        label:
          ganttZoomOption.visibleDays > 30
            ? `${date.getDate()}`
            : `${date.toLocaleString('default', { weekday: 'narrow' })} ${date.getDate()}`,
        left: (offset / timelineTotalDays) * 100,
        width: 100 / timelineTotalDays,
        isNonWorkday: (data.settings?.weekdaysOnly && isWeekend) || isNonWorkdayHoliday,
      });
    }
    return days;
  }, [data.settings?.holidays, data.settings?.weekdaysOnly, ganttZoomOption.visibleDays, timeline.maxDate, timeline.minDate, timelineTotalDays]);
  const ganttHorizontalWindow = useHorizontalVirtualWindow({
    contentSize: timelineCanvasWidth,
    scrollRef: ganttShellRef,
    reservedWidthRef: ganttTableRef,
    revision: `${scheduleDisplayMode}:${ganttZoomValue}:${projectFilter}`,
  });
  const visibleTimelineWeeks = useMemo(
    () => timelineWeeks.filter((week) => timelineItemIntersectsWindow(week, ganttHorizontalWindow, timelineCanvasWidth)),
    [ganttHorizontalWindow, timelineCanvasWidth, timelineWeeks],
  );
  const visibleTimelineDays = useMemo(
    () => timelineDays.filter((day) => timelineItemIntersectsWindow(day, ganttHorizontalWindow, timelineCanvasWidth)),
    [ganttHorizontalWindow, timelineCanvasWidth, timelineDays],
  );
  const ganttTodayPosition = useMemo(() => {
    const today = new Date();
    if (today < timeline.minDate || today > timeline.maxDate) return null;
    return ((diffInDays(timeline.minDate, today) + 0.5) / timelineTotalDays) * 100;
  }, [timeline.maxDate, timeline.minDate, timelineTotalDays]);

  const resolvedRowHeights = useMemo(
    () => rows.map((_, index) => Math.max(GANTT_ROW_MIN_HEIGHT, rowHeights[index] || GANTT_ROW_MIN_HEIGHT)),
    [rowHeights, rows],
  );
  const getGanttRowHeight = useCallback(
    (index) => resolvedRowHeights[index] || GANTT_ROW_MIN_HEIGHT,
    [resolvedRowHeights],
  );
  const ganttVirtualRange = useVirtualRange({
    count: rows.length,
    getSize: getGanttRowHeight,
    scrollRef: ganttShellRef,
    headerOffset: 56,
    threshold: 40,
    revision: scheduleDisplayMode,
  });
  const visibleGanttRows = rows.slice(ganttVirtualRange.startIndex, ganttVirtualRange.endIndex);

  const rowTopOffsets = useMemo(() => {
    const offsets = [];
    let currentTop = 0;
    resolvedRowHeights.forEach((height) => {
      offsets.push(currentTop);
      currentTop += height;
    });
    return offsets;
  }, [resolvedRowHeights]);

  const timelineViewHeight = useMemo(
    () => resolvedRowHeights.reduce((sum, height) => sum + height, 0),
    [resolvedRowHeights],
  );

  const dependencyArrows = useMemo(() => {
    if (!hasScheduledRows) return [];
    try {
      const stepRows = datedRows.filter((row) => row.type === 'step' && row.entityId);
      const rowIndexByStepId = new Map(
        rows
          .map((row, index) => [row, index])
          .filter(
            ([row]) =>
              row.type === 'step' &&
              row.entityId &&
              parseDateValue(row.start) &&
              parseDateValue(row.end || row.start),
          )
          .map(([row, index]) => [row.entityId, index]),
      );
      const rowByStepId = new Map(stepRows.map((row) => [row.entityId, row]));
      const arrows = [];

      stepRows.forEach((row) => {
        normalizePreds(row.predecessors).forEach((pred) => {
          const fromRow = rowByStepId.get(pred.id);
          const toRow = rowByStepId.get(row.entityId);
          const fromIndex = rowIndexByStepId.get(pred.id);
          const toIndex = rowIndexByStepId.get(row.entityId);
          if (!fromRow || !toRow || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;

          const fromMetrics = getTimelineMetrics(fromRow, timeline.minDate, timeline.maxDate);
          const toMetrics = getTimelineMetrics(toRow, timeline.minDate, timeline.maxDate);
          if (!fromMetrics || !toMetrics) return;

          const fromX = fromMetrics.leftPct + fromMetrics.widthPct;
          const toX = toMetrics.leftPct;
          const fromY = (rowTopOffsets[fromIndex] || 0) + (resolvedRowHeights[fromIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
          const toY = (rowTopOffsets[toIndex] || 0) + (resolvedRowHeights[toIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
          const connectorClearance = (10 / timelineCanvasWidth) * 100;
          const hasForwardGap = toX > fromX + connectorClearance * 2;
          const rightX = Math.min(99.5, hasForwardGap ? fromX + connectorClearance : Math.max(fromX, toX) + connectorClearance);
          const leftX = Math.max(0, toX - connectorClearance);
          const midY = (fromY + toY) / 2;
          const coords = [fromX, toX, fromY, toY, rightX, leftX, midY];
          if (!coords.every((value) => Number.isFinite(value))) return;

          arrows.push({
            key: `${pred.id}-${row.entityId}`,
            d: hasForwardGap
              ? `M ${fromX} ${fromY} H ${rightX} V ${toY} H ${toX}`
              : `M ${fromX} ${fromY} H ${rightX} V ${midY} H ${leftX} V ${toY} H ${toX}`,
            endX: toX,
            endY: toY,
            direction: 'right',
          });
        });
      });

      return arrows;
    } catch {
      return [];
    }
  }, [datedRows, hasScheduledRows, resolvedRowHeights, rowTopOffsets, rows, timeline, timelineCanvasWidth]);

  const stepRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.type === 'step' &&
          row.entityId &&
          parseDateValue(row.start) &&
          parseDateValue(row.end || row.start),
      ),
    [rows],
  );

  const stepRowIndexById = useMemo(
    () => new Map(stepRows.map((row, index) => [row.entityId, index])),
    [stepRows],
  );

  const stepRowById = useMemo(
    () => new Map(stepRows.map((row) => [row.entityId, row])),
    [stepRows],
  );

  const dragPreview = useMemo(() => {
    if (!dragDependency || !hasScheduledRows) return null;
    const fromRow = stepRowById.get(dragDependency.fromStepId);
    const fromIndex = stepRowIndexById.get(dragDependency.fromStepId);
    if (!fromRow || !Number.isInteger(fromIndex)) return null;
    const fromMetrics = getTimelineMetrics(fromRow, timeline.minDate, timeline.maxDate);
    if (!fromMetrics) return null;

    const gridRect = ganttGridRef.current?.getBoundingClientRect();
    if (!gridRect || !gridRect.width || !gridRect.height) return null;

    const startX = fromMetrics.leftPct + fromMetrics.widthPct;
    const startY = (rowTopOffsets[fromIndex] || 0) + (resolvedRowHeights[fromIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
    const endX = clamp(((dragDependency.currentClientX - gridRect.left) / gridRect.width) * 100, 0, 100);
    const viewHeight = timelineViewHeight || GANTT_ROW_MIN_HEIGHT;
    const endY = clamp(((dragDependency.currentClientY - gridRect.top) / gridRect.height) * viewHeight, 0, viewHeight);
    const connectorClearance = (10 / timelineCanvasWidth) * 100;
    const hasForwardGap = endX > startX + connectorClearance * 2;
    const rightX = Math.min(99.5, hasForwardGap ? startX + connectorClearance : Math.max(startX, endX) + connectorClearance);
    const leftX = Math.max(0, endX - connectorClearance);
    const midY = (startY + endY) / 2;
    const coords = [startX, startY, endX, endY, rightX, leftX, midY];
    if (!coords.every((value) => Number.isFinite(value))) return null;

    return {
      d: hasForwardGap
        ? `M ${startX} ${startY} H ${rightX} V ${endY} H ${endX}`
        : `M ${startX} ${startY} H ${rightX} V ${midY} H ${leftX} V ${endY} H ${endX}`,
    };
  }, [dragDependency, hasScheduledRows, resolvedRowHeights, rowTopOffsets, stepRowById, stepRowIndexById, timeline, timelineCanvasWidth, timelineViewHeight]);

  const stats = useMemo(() => {
    const phases = filteredProjects.reduce((sum, project) => sum + (project.phases?.length || 0), 0);
    const steps = filteredProjects.reduce(
      (sum, project) =>
        sum +
        (project.phases || []).reduce((phaseTotal, phase) => phaseTotal + (phase.steps?.length || 0), 0),
      0,
    );
    const scheduledRows = datedRows.length;
    const visibleTaskCount = filteredProjects.reduce(
      (sum, project) => sum + (tasksByProject.get(project.id)?.length || 0),
      0,
    );
    return { phases, steps, scheduledRows, visibleTaskCount };
  }, [datedRows.length, filteredProjects, tasksByProject]);

  const unfilteredCalendarData = useMemo(
    () => buildCalendarItemsView(filteredProjects, showCalendarTasks ? tasksByProject : new Map(), data.settings),
    [data.settings, filteredProjects, showCalendarTasks, tasksByProject],
  );
  const calendarData = useMemo(() => {
    if (calendarItemFilter === 'all') return unfilteredCalendarData;
    const includeItem = (item) => {
      if (item.type === 'holiday') return true;
      if (calendarItemFilter === 'schedule') return ['phase', 'step', 'delay'].includes(item.type);
      if (calendarItemFilter === 'tasks') return item.type === 'task';
      if (calendarItemFilter === 'inspections') return item.type === 'inspection';
      return true;
    };
    return {
      holidayMap: unfilteredCalendarData.holidayMap,
      itemsByDate: new Map(
        [...unfilteredCalendarData.itemsByDate.entries()]
          .map(([dateKey, items]) => [dateKey, items.filter(includeItem)]),
      ),
      rangeItems: unfilteredCalendarData.rangeItems.filter(includeItem),
    };
  }, [calendarItemFilter, unfilteredCalendarData]);
  const emptyScheduleTarget = useMemo(() => getFallbackStepTarget(), [data.projects, filteredProjects]);

  const calendarCells = useMemo(() => {
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    const cells = [];
    const todayKey = toIsoDate(new Date());

    for (let day = new Date(gridStart); day <= gridEnd; day = addDays(day, 1)) {
      const key = toIsoDate(day);
      cells.push({
        key,
        date: new Date(day),
        isCurrentMonth: day.getMonth() === calendarMonth.getMonth(),
        isToday: key === todayKey,
        isWeekend: day.getDay() === 0 || day.getDay() === 6,
        holidays: calendarData.holidayMap.get(key) || [],
        items: calendarData.itemsByDate.get(key) || [],
      });
    }
    return cells;
  }, [calendarData, calendarMonth]);

  const calendarWeeks = useMemo(
    () =>
      buildCalendarWeeksView(
        calendarCells,
        calendarData.rangeItems,
        CALENDAR_VISIBLE_RANGE_LANES,
        new Set(Object.entries(expandedCalendarWeeks).filter(([, expanded]) => expanded).map(([key]) => key)),
      ),
    [calendarCells, calendarData.rangeItems, expandedCalendarWeeks],
  );

  useEffect(() => {
    function measureRowHeights() {
      const nextHeights = rows.map((_, index) => {
        const labelHeight = ganttLabelRowRefs.current[index]?.offsetHeight || 0;
        const timelineHeight = ganttTimelineRowRefs.current[index]?.offsetHeight || 0;
        return Math.max(GANTT_ROW_MIN_HEIGHT, labelHeight, timelineHeight);
      });

      setRowHeights((current) => {
        if (
          current.length === nextHeights.length &&
          current.every((value, index) => value === nextHeights[index])
        ) {
          return current;
        }
        return nextHeights;
      });
    }

    measureRowHeights();
    window.addEventListener('resize', measureRowHeights);
    return () => window.removeEventListener('resize', measureRowHeights);
  }, [rows, projectFilter, showGanttTasks, expandedProjects, expandedPhases, dragDependency]);

  useEffect(() => {
    if (!isScheduleView) return;
    const shell = ganttShellRef.current;
    if (!shell) return;

    const today = new Date();
    const todayKey = toIsoDate(today);
    if (todayKey < toIsoDate(timeline.minDate) || todayKey > toIsoDate(timeline.maxDate)) return;

    const scrollKey = [
      view,
      projectFilter,
      timeline.minDate.toISOString(),
      timeline.maxDate.toISOString(),
      timelineCanvasWidth,
    ].join('|');

    if (lastAutoScrollKeyRef.current === scrollKey) return;
    lastAutoScrollKeyRef.current = scrollKey;

    const offsetDays = diffInDays(timeline.minDate, today);
    const todayCenterX = (offsetDays + 0.5) * ganttPixelsPerDay;
    const tableWidth = ganttTableRef.current?.offsetWidth || 0;
    const visibleTimelineWidth = Math.max(1, shell.clientWidth - tableWidth);
    const targetScrollLeft = Math.max(
      0,
      Math.min(
        todayCenterX - visibleTimelineWidth / 2,
        Math.max(0, shell.scrollWidth - shell.clientWidth),
      ),
    );

    shell.scrollLeft = targetScrollLeft;
  }, [
    projectFilter,
    ganttPixelsPerDay,
    isScheduleView,
    timeline.maxDate,
    timeline.minDate,
    timelineCanvasWidth,
    view,
  ]);

  function toggleProject(projectId) {
    setExpandedProjects((current) => ({ ...current, [projectId]: !(current[projectId] ?? true) }));
  }

  function togglePhase(phaseId) {
    setExpandedPhases((current) => ({ ...current, [phaseId]: !(current[phaseId] ?? true) }));
  }

  function toggleAllExpanded() {
    const nextExpanded = !allExpanded;
    const nextProjects = {};
    const nextPhases = {};
    filteredProjects.forEach((project) => {
      nextProjects[project.id] = nextExpanded;
      (project.phases || []).forEach((phase) => {
        nextPhases[phase.id] = nextExpanded;
      });
    });
    setExpandedProjects((current) => ({ ...current, ...nextProjects }));
    setExpandedPhases((current) => ({ ...current, ...nextPhases }));
  }

  function openPhaseEditor(row, event = null) {
    setEditorPredecessorDraft(null);
    const project = data.projects.find((item) => item.id === row.parentProjectId);
    const phase = project?.phases?.find((item) => item.id === row.entityId);
    setEditorDraft({
      mode: 'edit',
      type: 'phase',
      projectId: row.parentProjectId,
      phaseId: row.entityId,
      name: row.label,
      assign: row.assign || '',
      status: row.status || 'planning',
      color: step?.color || TASK_COLOR_PALETTE[0],
      start: row.start || '',
      end: row.end || '',
      predecessorOptions: buildPhaseDependencyOptions(row.parentProjectId, row.entityId, phase?.predecessors || []),
    });
  }

  function openStepEditor(row, event = null) {
    setEditorPredecessorDraft(null);
    const project = data.projects.find((item) => item.id === row.parentProjectId);
    const phase = project?.phases?.find((item) => item.id === row.parentPhaseId);
    const step = phase?.steps?.find((item) => item.id === row.entityId);
    setEditorDraft({
      mode: 'edit',
      type: 'step',
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      sourceProjectId: row.parentProjectId,
      sourcePhaseId: row.parentPhaseId,
      stepId: row.entityId,
      name: row.label,
      assign: row.assign || '',
      status: row.status || 'planning',
      start: row.start || '',
      duration: row.duration || 1,
      endPreview: row.start
        ? computeStepEndDate(row.start, row.duration || 1, data.settings)
        : row.end || '',
      predecessorOptions: buildStepDependencyOptions(
        row.parentProjectId,
        row.parentPhaseId,
        row.entityId,
        step?.predecessors || [],
      ),
      autoStart: false,
    });
  }

  function buildStepDependencyOptions(projectId, phaseId, stepId = '', selectedPreds = [], projectsSource = data.projects) {
    const project = (projectsSource || []).find((item) => item.id === projectId);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    const selectedMap = new Map(normalizePreds(selectedPreds).map((pred) => [pred.id, pred.lag || 0]));
    return (phase?.steps || [])
      .filter((item) => item.id !== stepId)
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

  function buildPhaseDependencyOptions(projectId, phaseId = '', selectedPreds = [], projectsSource = data.projects) {
    const project = (projectsSource || []).find((item) => item.id === projectId);
    const selectedMap = new Map(normalizePreds(selectedPreds).map((pred) => [pred.id, pred.lag || 0]));
    return (project?.phases || [])
      .filter((item) => item.id !== phaseId)
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        const aEnd = a.end || a.start || '9999-12-31';
        const bEnd = b.end || b.start || '9999-12-31';
        if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
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

  function buildStepDraftFromState(state, projectId, phaseId, mode = 'create', startOverride = '') {
    const selectedStateProject = state.projects.find((item) => item.id === projectId);
    const start = startOverride
      ? normalizeStartDate(startOverride, state.settings)
      : getDefaultNewStepStartFromProject(selectedStateProject, phaseId, state.settings);
    return {
      mode,
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
      predecessorOptions: buildStepDependencyOptions(projectId, phaseId, '', [], state.projects),
      autoStart: !startOverride,
    };
  }

  function openDependencyEditor(row) {
    const project = data.projects.find((item) => item.id === row.parentProjectId);
    const phase = project?.phases?.find((item) => item.id === row.parentPhaseId);
    const step = phase?.steps?.find((item) => item.id === row.entityId);
    if (!phase || !step) return;
    const selectedMap = new Map(normalizePreds(step.predecessors).map((pred) => [pred.id, pred.lag || 0]));
    const options = (phase.steps || [])
      .filter((item) => item.id !== row.entityId)
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

    setDependencyDraft({
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      stepId: row.entityId,
      name: row.label,
      options,
    });
  }

  function startCreatePhase(projectId) {
    setEditorPredecessorDraft(null);
    setExpandedProjects((current) => ({ ...current, [projectId]: true }));
    setEditorDraft({
      mode: 'create',
      type: 'phase',
      projectId,
      phaseId: '',
      name: '',
      assign: '',
      status: 'planning',
      start: '',
      end: '',
      predecessorOptions: buildPhaseDependencyOptions(projectId),
    });
  }

  async function handleQuickAddPhase(projectId) {
    if (!projectId) return;
    setPhaseNameDraft({
      projectId,
      eyebrow: 'Phase',
      title: 'Add phase',
      description: 'Create a new phase without leaving the scheduling workspace.',
      label: 'Phase name',
      placeholder: 'Phase name',
      value: '',
      saveLabel: 'Add phase',
    });
  }

  async function savePhaseNameDraft() {
    if (!phaseNameDraft?.projectId) return;
    const trimmed = phaseNameDraft.value.trim();
    if (!trimmed) return;

    const mutationKey = ['project', phaseNameDraft.projectId, 'phase-create'];
    beginMutation(mutationKey);
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
      setExpandedProjects((current) => ({ ...current, [phaseNameDraft.projectId]: true }));
      setExpandedPhases((current) => ({ ...current, [newPhase.id]: true }));
      setEditorDraft((current) => {
        if (!current || current.type !== 'step') return current;
        const nextDraft = {
          ...current,
          projectId: phaseNameDraft.projectId,
          phaseId: newPhase.id,
          predecessorOptions: buildStepDependencyOptions(phaseNameDraft.projectId, newPhase.id),
        };
        if (nextDraft.mode === 'create' && nextDraft.autoStart) {
          nextDraft.start = '';
          nextDraft.endPreview = '';
        }
        return nextDraft;
      });
      setEditorPredecessorDraft(null);
      setPhaseNameDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  function getDefaultNewStepStartFromProject(project, phaseId, settings) {
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

  function getDefaultNewStepStart(projectId, phaseId) {
    const project = data.projects.find((item) => item.id === projectId);
    return getDefaultNewStepStartFromProject(project, phaseId, data.settings);
  }

  function resyncProjectSchedule(project) {
    return syncProjectPhaseDates(cascadePhaseDates(syncProjectPhaseDates(project), data.settings));
  }

  function startCreateStep(projectId, phaseId, startOverride = '') {
    setEditorPredecessorDraft(null);
    if (projectId) {
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
    }
    if (phaseId) {
      setExpandedPhases((current) => ({ ...current, [phaseId]: true }));
    }
    setEditorDraft(buildStepDraftFromState(data, projectId, phaseId, 'create', startOverride));
  }

  function resolveCalendarPhaseForDate(dateKey) {
    if (filteredProjects.length !== 1) return null;
    const project = filteredProjects[0];
    const phases = project.phases || [];
    if (!phases.length) return null;

    const containingPhase = phases.find((phase) => {
      const start = phase.start || '';
      const end = phase.end || phase.start || '';
      return start && end && dateKey >= start && dateKey <= end;
    });
    if (containingPhase) return { projectId: project.id, phaseId: containingPhase.id };

    const phasesBefore = phases
      .filter((phase) => (phase.end || phase.start || '') && (phase.end || phase.start || '') <= dateKey)
      .sort((a, b) => (a.end || a.start || '').localeCompare(b.end || b.start || ''));
    if (phasesBefore.length) {
      return { projectId: project.id, phaseId: phasesBefore[phasesBefore.length - 1].id };
    }

    const phasesAfter = phases
      .filter((phase) => (phase.start || phase.end || '') && (phase.start || phase.end || '') >= dateKey)
      .sort((a, b) => (a.start || a.end || '').localeCompare(b.start || b.end || ''));
    if (phasesAfter.length) {
      return { projectId: project.id, phaseId: phasesAfter[0].id };
    }

    return { projectId: project.id, phaseId: phases[0].id };
  }

  function getFallbackStepTarget(dateKey = '') {
    const resolved = resolveCalendarPhaseForDate(dateKey);
    if (resolved) return resolved;

    const project = filteredProjects[0] || data.projects[0];
    const phase = project?.phases?.[0];
    return {
      projectId: project?.id || '',
      phaseId: phase?.id || '',
    };
  }

  function handleCalendarDateClick(cell, event) {
    event.stopPropagation();
    const target = getFallbackStepTarget(cell.key);
    startCreateStep(target.projectId, target.phaseId, cell.key);
  }

  function openCalendarItem(item, event = null) {
    if (item.type === 'phase') {
      openPhaseEditor({
        entityId: item.phaseId,
        parentProjectId: item.projectId,
        label: item.label,
        assign: item.assign,
        status: item.status,
        start: item.start,
        end: item.end,
      }, event);
      return;
    }
    if (item.type === 'step') {
      openStepEditor({
        entityId: item.stepId,
        parentProjectId: item.projectId,
        parentPhaseId: item.phaseId,
        label: item.label,
        assign: item.assign,
        status: item.status,
        start: item.start,
        end: item.end,
        duration: item.duration,
      }, event);
      return;
    }
    if (item.type === 'delay') {
      openDelayEditor({
        entityId: item.delayId,
        parentProjectId: item.projectId,
        parentPhaseId: item.phaseId,
        parentStepId: item.stepId,
        delayDays: item.days,
        delayCause: item.cause,
        description: item.description,
      }, event);
      return;
    }
    if (item.type === 'task') {
      openTaskEditor(item);
      return;
    }
    if (item.type === 'inspection') {
      openInspectionEditor(item);
    }
  }

  function openInspectionEditor(inspectionLike) {
    setInspectionDraft({
      mode: 'edit',
      id: inspectionLike.inspectionId || inspectionLike.entityId,
      projectId: inspectionLike.projectId || inspectionLike.parentProjectId || '',
      originalProjectId: inspectionLike.projectId || inspectionLike.parentProjectId || '',
      subcode: inspectionLike.subcode || '',
      inspectionType: inspectionLike.inspectionType || inspectionLike.label || '',
      status: inspectionLike.status || 'requested',
      date: inspectionLike.date || inspectionLike.start || '',
      agency: inspectionLike.agency || '',
      notes: inspectionLike.notes || '',
      stickerFile: inspectionLike.stickerFile || null,
      reportFile: inspectionLike.reportFile || null,
      stickerPendingFile: null,
      reportPendingFile: null,
    });
  }

  function updateInspectionDraft(field, value) {
    setInspectionDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleAddInspectionSubcodeFromSchedule() {
    setSubcodeDraft({
      eyebrow: 'Inspection',
      title: 'Add subcode',
      description: 'Create a new inspection subcode without leaving the scheduling workspace.',
      label: 'Subcode',
      placeholder: 'Inspection subcode',
      value: '',
      saveLabel: 'Add subcode',
    });
  }

  async function saveScheduleInspectionSubcodeDraft() {
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

  function scrollGanttToToday() {
    const shell = ganttShellRef.current;
    if (!shell) return;
    const today = new Date();
    const todayKey = toIsoDate(today);
    if (todayKey < toIsoDate(timeline.minDate) || todayKey > toIsoDate(timeline.maxDate)) return;
    const offsetDays = diffInDays(timeline.minDate, today);
    const todayCenterX = (offsetDays + 0.5) * ganttPixelsPerDay;
    const tableWidth = ganttTableRef.current?.offsetWidth || 0;
    const visibleTimelineWidth = Math.max(1, shell.clientWidth - tableWidth);
    shell.scrollTo({
      left: Math.max(0, Math.min(todayCenterX - visibleTimelineWidth / 2, shell.scrollWidth - shell.clientWidth)),
      behavior: 'smooth',
    });
  }

  function scrollAgendaToToday() {
    const agenda = mobileAgendaRef.current;
    if (!agenda) return;
    const todayKey = toIsoDate(new Date());
    const upcomingSteps = Array.from(agenda.querySelectorAll('.mobile-agenda-item.step[data-start-date]'))
      .filter((element) => element.dataset.startDate >= todayKey)
      .sort((first, second) => first.dataset.startDate.localeCompare(second.dataset.startDate));
    const target = upcomingSteps[0];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }

  function handleScheduleToday() {
    const mobileAgendaActive = window.matchMedia?.('(max-width: 720px)').matches;
    if (scheduleDisplayMode === 'agenda' || mobileAgendaActive) scrollAgendaToToday();
    else scrollGanttToToday();
  }

  async function handleSaveInspectionDraft() {
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
        stickerFile = await createInspectionAttachmentRecord(project.id, 'sticker', inspectionDraft.stickerPendingFile);
      }
      if (inspectionDraft.reportPendingFile) {
        if (reportFile?.storagePath) filesToDeleteAfterSave.push(reportFile);
        reportFile = await createInspectionAttachmentRecord(project.id, 'report', inspectionDraft.reportPendingFile);
      }
      if (!['failed', 'follow-up'].includes(inspectionDraft.status) && reportFile?.storagePath) {
        filesToDeleteAfterSave.push(reportFile);
        reportFile = null;
      } else if (!['failed', 'follow-up'].includes(inspectionDraft.status)) {
        reportFile = null;
      }
      const nextInspection = {
        id: inspectionDraft.id,
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
      if (sourceProject && sourceProject.id !== project.id) {
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
        nextState = await updateProject(nextState, project.id, {
          ...project,
          inspections: (project.inspections || []).map((inspection) =>
            inspection.id === inspectionDraft.id ? nextInspection : inspection,
          ),
        });
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

  async function handleDeleteInspectionDraft() {
    if (!inspectionDraft?.projectId || !inspectionDraft?.id) return;
    const confirmed = await showAppConfirm(`Delete inspection "${inspectionDraft.subcode || inspectionDraft.inspectionType}"?`, {
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
      const nextState = await updateProject(data, project.id, {
        ...project,
        inspections: (project.inspections || []).filter((inspection) => inspection.id !== inspectionDraft.id),
      });
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

  function openTaskEditor(taskLike) {
    setTaskDraft({
      id: taskLike.taskId || taskLike.entityId,
      label: taskLike.label || '',
      projectId: taskLike.projectId || taskLike.parentProjectId || '',
      due: taskLike.due || taskLike.start || '',
      assignee: taskLike.assignee || '',
      done: !!taskLike.done,
    });
  }

  function updateTaskDraft(field, value) {
    setTaskDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function startCreateTaskAssignee(target = 'task') {
    setPersonAssignmentTarget(target);
    setTaskPersonDraft({
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
      type: 'emp',
    });
  }

  async function handleSaveTaskDraft() {
    if (!taskDraft?.id || !taskDraft.label.trim()) return;
    const mutationKey = ['task', taskDraft.id];
    beginMutation(mutationKey);
    try {
      const nextState = await updateTask(data, taskDraft.id, {
        label: taskDraft.label.trim(),
        projectId: taskDraft.projectId || '',
        due: taskDraft.due || '',
        assignee: taskDraft.assignee || '',
        done: !!taskDraft.done,
      });
      onStateChange(nextState);
      setTaskDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function handleDeleteTaskDraft() {
    if (!taskDraft?.id) return;
    const confirmed = await showAppConfirm(`Delete "${taskDraft.label}"?`, {
      title: 'Delete task',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    const mutationKey = ['task', taskDraft.id];
    beginMutation(mutationKey);
    try {
      const currentState = dataRef.current;
      const deletedTask = currentState.tasks.find((task) => task.id === taskDraft.id);
      if (!deletedTask) return;
      const taskSnapshot = { ...deletedTask, attachments: [...(deletedTask.attachments || [])] };
      const nextState = await deleteTask(currentState, taskDraft.id, { preserveAttachments: true });
      commitScheduleState(nextState);
      showUndoAction({
        message: `Deleted "${taskSnapshot.label}".`,
        onUndo: async () => {
          const restoredState = await createTask(dataRef.current, taskSnapshot);
          commitScheduleState(restoredState);
        },
        onCommit: async () => {
          for (const attachment of taskSnapshot.attachments) {
            if (attachment?.storagePath) await deleteProjectFileFromStorage(attachment);
          }
        },
      });
      setTaskDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function handleSaveTaskPersonDraft() {
    if (!taskPersonDraft) return;
    if (!taskPersonDraft.first.trim() && !taskPersonDraft.last.trim() && !taskPersonDraft.company.trim()) return;
    const mutationKey = ['person', 'create-for-schedule'];
    beginMutation(mutationKey);
    try {
      const nextState = await createPerson(data, taskPersonDraft.type, taskPersonDraft);
      const createdPerson = (taskPersonDraft.type === 'sub' ? nextState.subs : nextState.employees)?.at(-1);
      const nextAssignee = createdPerson ? personAssignmentLabel(createdPerson) : '';
      onStateChange(nextState);
      if (nextAssignee) {
        if (personAssignmentTarget === 'schedule') {
          setEditorDraft((current) => (current ? { ...current, assign: nextAssignee } : current));
        } else {
          setTaskDraft((current) => (current ? { ...current, assignee: nextAssignee } : current));
        }
      }
      setTaskPersonDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  function buildDelayStepOptions(projectId, phaseId) {
    const project = data.projects.find((item) => item.id === projectId);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    return [...(phase?.steps || [])]
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((step) => ({
        value: step.id,
        label: `${step.name} (${step.start ? formatShortDate(step.start) : step.end ? `Ends ${formatShortDate(step.end)}` : 'Date not set'})`,
      }));
  }

  function startCreateDelay(projectId, phaseId) {
    const stepOptions = buildDelayStepOptions(projectId, phaseId);
    setDelayDraft({
      mode: 'create',
      projectId,
      phaseId,
      delayId: '',
      stepId: stepOptions[0]?.value || '',
      days: 1,
      cause: 'Inspector',
      description: '',
      stepOptions,
    });
  }

  function openDelayEditor(row, event = null) {
    const stepOptions = buildDelayStepOptions(row.parentProjectId, row.parentPhaseId);
    setDelayDraft({
      mode: 'edit',
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      delayId: row.entityId,
      stepId: row.parentStepId,
      days: row.delayDays || 1,
      cause: row.delayCause || 'Inspector',
      description: row.description || '',
      stepOptions,
    });
  }

  function updateDelayDraft(field, value) {
    setDelayDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function toggleDependencyPred(stepId, checked) {
    setDependencyDraft((current) =>
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

  function changeDependencyLag(stepId, value) {
    setDependencyDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, lag: parseInt(value, 10) || 0 } : option,
            ),
          }
        : current,
    );
  }

  function updateEditorDraft(field, value) {
    setEditorDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      const shouldRefreshPreds = next.type === 'step' && (field === 'projectId' || field === 'phaseId');
      if (next.type === 'step' && field === 'projectId') {
        const nextProject = data.projects.find((project) => project.id === value);
        const phaseExists = (nextProject?.phases || []).some((phase) => phase.id === next.phaseId);
        next.phaseId = phaseExists ? next.phaseId : nextProject?.phases?.[0]?.id || '';
        if (value) {
          setExpandedProjects((expanded) => ({ ...expanded, [value]: true }));
        }
        if (next.phaseId) {
          setExpandedPhases((expanded) => ({ ...expanded, [next.phaseId]: true }));
        }
      }
      if (next.type === 'step' && field === 'phaseId' && value) {
        setExpandedPhases((expanded) => ({ ...expanded, [value]: true }));
      }
      if (shouldRefreshPreds) {
        const selectedPreds = (next.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 }));
        next.predecessorOptions = buildStepDependencyOptions(
          next.projectId,
          next.phaseId,
          next.stepId,
          selectedPreds,
        );
      }
      if (next.type === 'step' && next.mode === 'create' && next.autoStart && (field === 'projectId' || field === 'phaseId')) {
        const defaultStart = next.projectId && next.phaseId ? getDefaultNewStepStart(next.projectId, next.phaseId) : '';
        next.start = defaultStart;
      }
      if (next.type === 'step' && (field === 'start' || field === 'duration')) {
        next.autoStart = false;
      }
      if (
        next.type === 'step' &&
        ((field === 'start' || field === 'duration') || (next.mode === 'create' && next.autoStart && (field === 'projectId' || field === 'phaseId')))
      ) {
        const normalizedStart = normalizeStartDate(next.start, data.settings);
        next.start = normalizedStart;
        next.endPreview = normalizedStart
          ? computeStepEndDate(normalizedStart, next.duration, data.settings)
          : '';
      }
      return next;
    });
  }

  function openEditorPredecessors() {
    if (!editorDraft || (editorDraft.type !== 'step' && editorDraft.type !== 'phase')) return;
    setEditorPredecessorDraft({
      entityType: editorDraft.type,
      name: editorDraft.name || (editorDraft.type === 'phase' ? 'New phase' : 'New step'),
      options: (editorDraft.predecessorOptions || []).map((option) => ({ ...option })),
    });
  }

  function toggleEditorPred(stepId, checked) {
    setEditorPredecessorDraft((current) =>
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

  function changeEditorPredLag(stepId, value) {
    setEditorPredecessorDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, lag: parseInt(value, 10) || 0 } : option,
            ),
          }
        : current,
    );
  }

  function saveEditorPredecessors() {
    if (!editorPredecessorDraft) return;
    setEditorDraft((current) =>
      current && (current.type === 'step' || current.type === 'phase')
        ? {
            ...current,
            predecessorOptions: editorPredecessorDraft.options.map((option) => ({ ...option })),
          }
        : current,
    );
    setEditorPredecessorDraft(null);
  }

  async function saveDependencyConnection(source, target, lag = 0) {
    if (!source || !target) return;
    if (source.projectId !== target.projectId || source.phaseId !== target.phaseId) {
      await showAppAlert('Dependencies can only connect steps within the same phase.', 'Dependency unavailable');
      return;
    }
    if (source.fromStepId === target.stepId) return;

    const mutationKey = ['project', source.projectId, 'dependency', target.stepId];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === source.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== source.phaseId) return phase;

          const targetStep = (phase.steps || []).find((step) => step.id === target.stepId);
          if (!targetStep) return phase;

          const existingPreds = normalizePreds(targetStep.predecessors);
          const nextPreds = existingPreds.some((pred) => pred.id === source.fromStepId)
            ? existingPreds.map((pred) => (pred.id === source.fromStepId ? { ...pred, lag } : pred))
            : [...existingPreds, { id: source.fromStepId, lag }];

          if (wouldCreateCycleFromPreds(phase, source.fromStepId, target.stepId)) {
            throw new Error('Cannot create a circular dependency.');
          }

          const nextPhase = {
            ...phase,
            steps: (phase.steps || []).map((step) =>
              step.id === target.stepId
                ? {
                    ...step,
                    predecessors: nextPreds,
                  }
                : step,
            ),
          };

          syncStepLinks(nextPhase);
          cascadeStepDates(nextPhase, data.settings);
          return nextPhase;
        }),
      };

      const syncedProject = resyncProjectSchedule(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to create dependency.', 'Dependency failed');
    } finally {
      endMutation(mutationKey);
    }
  }

  function beginDependencyDrag(event, row) {
    if (!timeline) return;
    event.preventDefault();
    event.stopPropagation();
    setDragDependency({
      fromStepId: row.entityId,
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
    });
  }

  useEffect(() => {
    if (!dragDependency) return undefined;

    function handlePointerMove(event) {
      setDragDependency((current) =>
        current
          ? {
              ...current,
              currentClientX: event.clientX,
              currentClientY: event.clientY,
            }
          : current,
      );
    }

    function handlePointerUp(event) {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-connect-target]');
      const source = dragDependency;
      setDragDependency(null);
      if (!targetElement || !source) return;

      const target = {
        projectId: targetElement.getAttribute('data-project-id') || '',
        phaseId: targetElement.getAttribute('data-phase-id') || '',
        stepId: targetElement.getAttribute('data-step-id') || '',
      };

      if (!target.stepId || target.stepId === source.fromStepId) return;
      void saveDependencyConnection(source, target, 0);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [data, dragDependency]);

  async function handleSaveEditor(nextAction = 'close') {
    if (!editorDraft?.name.trim()) return;
    if (editorDraft.type === 'step' && (!editorDraft.projectId || !editorDraft.phaseId)) {
      await showAppAlert('Choose a project and phase before saving the step.', 'Missing project or phase');
      return;
    }

    const mutationKey = ['project', editorDraft.projectId, editorDraft.type, editorDraft.stepId || editorDraft.phaseId || 'create'];
    beginMutation(mutationKey);
    setEditorPredecessorDraft(null);
    try {
      if (editorDraft.type === 'phase') {
        const project = data.projects.find((item) => item.id === editorDraft.projectId);
        if (!project) return;
        const phaseId = editorDraft.mode === 'create' ? `ph${Date.now()}` : editorDraft.phaseId;
        const nextPreds = (editorDraft.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 }));

        for (const pred of nextPreds) {
          if (wouldCreatePhaseCycleFromPreds(project, pred.id, phaseId)) {
            throw new Error('Cannot create a circular phase dependency.');
          }
        }

        const nextProject = cascadePhaseDates({
          ...project,
          phases:
            editorDraft.mode === 'create'
              ? [
                  ...(project.phases || []),
                  {
                    id: phaseId,
                    name: editorDraft.name.trim(),
                    assign: editorDraft.assign.trim(),
                    status: editorDraft.status,
                    start: '',
                    end: '',
                    predecessors: nextPreds,
                    steps: [],
                  },
                ]
              : (project.phases || []).map((phase) =>
                  phase.id === phaseId
                    ? {
                        ...phase,
                        name: editorDraft.name.trim(),
                        assign: editorDraft.assign.trim(),
                        status: editorDraft.status,
                        predecessors: nextPreds,
                      }
                    : phase,
                ),
        }, data.settings);

        const syncedProject = resyncProjectSchedule(nextProject);
        const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
        const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
        onStateChange(nextState);
        setEditorDraft(null);
        return;
      }

      const targetProjectId = editorDraft.projectId;
      const targetPhaseId = editorDraft.phaseId;
      const sourceProjectId = editorDraft.sourceProjectId || editorDraft.projectId;
      const sourcePhaseId = editorDraft.sourcePhaseId || editorDraft.phaseId;
      const sourceProject = data.projects.find((item) => item.id === sourceProjectId);
      const targetProject = data.projects.find((item) => item.id === targetProjectId);
      if (!targetProject) return;
      const targetPhase = targetProject.phases?.find((phase) => phase.id === targetPhaseId);
      if (!targetPhase) {
        await showAppAlert('The selected phase no longer exists.', 'Phase unavailable');
        return;
      }

      const existingStep =
        editorDraft.mode === 'edit'
          ? sourceProject?.phases
              ?.find((phase) => phase.id === sourcePhaseId)
              ?.steps?.find((step) => step.id === editorDraft.stepId)
          : null;
      const isMovingStep =
        editorDraft.mode === 'edit' && (targetProjectId !== sourceProjectId || targetPhaseId !== sourcePhaseId);
      const nextStep = {
        ...(existingStep || {}),
        id: editorDraft.mode === 'create' ? `s${Date.now()}` : editorDraft.stepId,
        name: editorDraft.name.trim(),
        assign: editorDraft.assign.trim(),
        status: editorDraft.status,
        color: editorDraft.color || TASK_COLOR_PALETTE[0],
        done: editorDraft.status === 'done',
        start: editorDraft.start || '',
        duration: Math.max(1, Number(editorDraft.duration) || 1),
        end: editorDraft.start ? editorDraft.endPreview || '' : '',
        predecessors: (editorDraft.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 })),
      };
      if (isMovingStep) {
        nextStep.successors = [];
      }

      for (const pred of nextStep.predecessors || []) {
        if (wouldCreateCycleFromPreds(targetPhase, pred.id, nextStep.id)) {
          throw new Error('Cannot create a circular dependency.');
        }
      }

      const finalizePhase = (phase) => {
        const nextPhase = {
          ...phase,
          steps: [...(phase.steps || [])],
        };
        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      };

      const removeStepFromPhase = (phase) => {
        const filteredSteps = (phase.steps || []).map((step) => ({
          ...step,
          predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== editorDraft.stepId),
          successors: Array.isArray(step.successors)
            ? step.successors.filter((successorId) => successorId !== editorDraft.stepId)
            : step.successors,
        }));
        return finalizePhase({
          ...phase,
          steps: filteredSteps.filter((step) => step.id !== editorDraft.stepId),
          delays: (phase.delays || []).filter((delay) => delay.stepId !== editorDraft.stepId),
        });
      };

      const upsertStepInPhase = (phase, preserveExistingLinks) => {
        const existingSteps = [...(phase.steps || [])];
        const nextSteps =
          editorDraft.mode === 'create'
            ? [...existingSteps, nextStep]
            : existingSteps.some((step) => step.id === editorDraft.stepId)
              ? existingSteps.map((step) =>
                  step.id === editorDraft.stepId
                    ? {
                        ...nextStep,
                        predecessors: nextStep.predecessors || [],
                        successors:
                          preserveExistingLinks && !isMovingStep
                            ? step.successors
                            : nextStep.successors || [],
                      }
                    : step,
                )
              : [...existingSteps, nextStep];
        return finalizePhase({
          ...phase,
          steps: nextSteps,
        });
      };

      if (targetProjectId === sourceProjectId) {
        const project = sourceProject;
        if (!project) return;
        const nextProject = {
          ...project,
          phases: (project.phases || []).map((phase) => {
            if (editorDraft.mode === 'create') {
              if (phase.id !== targetPhaseId) return phase;
              return upsertStepInPhase(phase, false);
            }
            if (isMovingStep) {
              if (phase.id === sourcePhaseId) return removeStepFromPhase(phase);
              if (phase.id === targetPhaseId) return upsertStepInPhase(phase, false);
              return phase;
            }
            if (phase.id !== targetPhaseId) return phase;
            return upsertStepInPhase(phase, true);
          }),
        };

        const syncedProject = resyncProjectSchedule(nextProject);
        const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
        const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
        onStateChange(nextState);
        if (nextAction === 'new') {
          setEditorDraft(buildStepDraftFromState(nextState, targetProjectId, targetPhaseId));
        } else {
          setEditorDraft(null);
        }
        return;
      }

      if (!sourceProject) return;
      const nextSourceProject = resyncProjectSchedule({
        ...sourceProject,
        phases: (sourceProject.phases || []).map((phase) =>
          phase.id === sourcePhaseId ? removeStepFromPhase(phase) : phase,
        ),
      });
      const nextTargetProject = resyncProjectSchedule({
        ...targetProject,
        phases: (targetProject.phases || []).map((phase) =>
          phase.id === targetPhaseId ? upsertStepInPhase(phase, false) : phase,
        ),
      });

      let nextTasks = syncProjectTasks(sourceProject.id, nextSourceProject, data.tasks);
      nextTasks = syncProjectTasks(targetProject.id, nextTargetProject, nextTasks);
      const nextState = await updateProjectsAndTasks(data, [nextSourceProject, nextTargetProject], nextTasks);
      onStateChange(nextState);
      if (nextAction === 'new') {
        setEditorDraft(buildStepDraftFromState(nextState, targetProjectId, targetPhaseId));
      } else {
        setEditorDraft(null);
      }
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save schedule item.', 'Save failed');
    } finally {
      endMutation(mutationKey);
    }
  }

  function buildProjectAfterStepDelete(project, phaseId, stepId) {
    return {
      ...project,
      phases: (project.phases || []).map((phase) => {
        if (phase.id !== phaseId) return phase;

        const nextPhase = {
          ...phase,
          steps: (phase.steps || [])
            .filter((step) => step.id !== stepId)
            .map((step) => ({
              ...step,
              predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== stepId),
              successors: Array.isArray(step.successors)
                ? step.successors.filter((successorId) => successorId !== stepId)
                : step.successors,
            })),
          delays: (phase.delays || []).filter((delay) => delay.stepId !== stepId),
        };

        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      }),
    };
  }

  async function deleteStepFromRow(row) {
    const confirmed = await showAppConfirm(`Delete "${row.label}"?`, {
      title: 'Delete item',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    const projectId = row.sourceProjectId || row.parentProjectId || row.projectId;
    const phaseId = row.sourcePhaseId || row.parentPhaseId || row.phaseId;
    const stepId = row.stepId || row.entityId;
    const mutationKey = ['project', projectId, 'step', stepId];
    beginMutation(mutationKey);
    try {
      const currentState = dataRef.current;
      const project = currentState.projects.find((item) => item.id === projectId);
      if (!project || !phaseId || !stepId) return;

      const nextProject = resyncProjectSchedule(buildProjectAfterStepDelete(project, phaseId, stepId));
      const taskSnapshot = [...currentState.tasks];
      const nextTasks = syncProjectTasks(projectId, nextProject, currentState.tasks);
      const nextState = await updateProjectAndTasks(currentState, projectId, nextProject, nextTasks);
      commitScheduleState(nextState);
      showUndoAction({
        message: `Deleted "${row.label}".`,
        onUndo: () => restoreScheduleSnapshot(projectId, project, taskSnapshot),
      });
      setEditorDraft((current) => (current?.stepId === stepId ? null : current));
    } finally {
      endMutation(mutationKey);
    }
  }

  async function deleteDelayFromRow(row) {
    const confirmed = await showAppConfirm('Remove this delay and reverse its effect on the step?', {
      title: 'Remove delay',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) return;

    const projectId = row.parentProjectId || row.projectId;
    const phaseId = row.parentPhaseId || row.phaseId;
    const delayId = row.entityId || row.delayId;
    const mutationKey = ['project', projectId, 'delay', delayId];
    beginMutation(mutationKey);
    try {
      const currentState = dataRef.current;
      const project = currentState.projects.find((item) => item.id === projectId);
      if (!project || !phaseId || !delayId) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== phaseId) return phase;

          const existing = (phase.delays || []).find((delay) => delay.id === delayId);
          let steps = [...(phase.steps || [])];
          if (existing) {
            steps = steps.map((step) =>
              step.id === existing.stepId ? applyDelayToStep(step, -Number(existing.days || 0), currentState.settings) : step,
            );
          }

          return {
            ...phase,
            steps,
            delays: (phase.delays || []).filter((delay) => delay.id !== delayId),
          };
        }),
      };

      const syncedProject = resyncProjectSchedule(nextProject);
      const taskSnapshot = [...currentState.tasks];
      const nextTasks = syncProjectTasks(projectId, syncedProject, currentState.tasks);
      const nextState = await updateProjectAndTasks(currentState, projectId, syncedProject, nextTasks);
      commitScheduleState(nextState);
      showUndoAction({
        message: 'Delay removed.',
        onUndo: () => restoreScheduleSnapshot(projectId, project, taskSnapshot),
      });
      setDelayDraft((current) => (current?.delayId === delayId ? null : current));
    } finally {
      endMutation(mutationKey);
    }
  }

  async function handleDeleteEditor() {
    if (!editorDraft || editorDraft.mode === 'create') return;
    if (editorDraft.type === 'step') {
      await deleteStepFromRow(editorDraft);
      return;
    }
    const confirmed = await showAppConfirm(
      `Delete "${editorDraft.name}"${editorDraft.type === 'phase' ? ' and its steps' : ''}?`,
      { title: `Delete ${editorDraft.type}`, confirmLabel: 'Delete', tone: 'danger' },
    );
    if (!confirmed) return;

    const mutationKey = ['project', editorDraft.projectId, editorDraft.type, editorDraft.phaseId];
    beginMutation(mutationKey);
    try {
      const projectId = editorDraft.projectId;
      const phaseId = editorDraft.phaseId;
      const currentState = dataRef.current;
      const project = currentState.projects.find((item) => item.id === projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases:
          editorDraft.type === 'phase'
            ? (project.phases || [])
                .filter((phase) => phase.id !== phaseId)
                .map((phase) => ({
                  ...phase,
                  predecessors: normalizePreds(phase.predecessors).filter((pred) => pred.id !== phaseId),
                }))
            : (project.phases || []).map((phase) =>
                phase.id === phaseId
                  ? {
                      ...phase,
                      steps: (phase.steps || []).filter((step) => step.id !== editorDraft.stepId),
                    }
                  : phase,
              ),
      };

      const syncedProject = resyncProjectSchedule(nextProject);
      const taskSnapshot = [...currentState.tasks];
      const nextTasks = syncProjectTasks(projectId, syncedProject, currentState.tasks);
      const nextState = await updateProjectAndTasks(currentState, projectId, syncedProject, nextTasks);
      commitScheduleState(nextState);
      showUndoAction({
        message: `Deleted "${editorDraft.name}".`,
        onUndo: () => restoreScheduleSnapshot(projectId, project, taskSnapshot),
      });
      setEditorDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function handleSaveDelay() {
    if (!delayDraft?.stepId) return;

    const mutationKey = ['project', delayDraft.projectId, 'delay', delayDraft.delayId || 'create'];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === delayDraft.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== delayDraft.phaseId) return phase;

          const existingDelays = [...(phase.delays || [])];
          let steps = [...(phase.steps || [])];

          if (delayDraft.mode === 'edit') {
            const existing = existingDelays.find((delay) => delay.id === delayDraft.delayId);
            if (existing) {
              steps = steps.map((step) =>
                step.id === existing.stepId ? applyDelayToStep(step, -Number(existing.days || 0), data.settings) : step,
              );
            }
          }

          const nextDelay =
            delayDraft.mode === 'edit'
              ? {
                  id: delayDraft.delayId,
                  stepId: delayDraft.stepId,
                  days: Math.max(1, Number(delayDraft.days) || 1),
                  cause: delayDraft.cause,
                  description: delayDraft.description.trim(),
                }
              : {
                  id: `dl${Date.now()}`,
                  stepId: delayDraft.stepId,
                  days: Math.max(1, Number(delayDraft.days) || 1),
                  cause: delayDraft.cause,
                  description: delayDraft.description.trim(),
                };

          steps = steps.map((step) =>
            step.id === nextDelay.stepId ? applyDelayToStep(step, nextDelay.days, data.settings) : step,
          );

          const delays =
            delayDraft.mode === 'edit'
              ? existingDelays.map((delay) => (delay.id === delayDraft.delayId ? nextDelay : delay))
              : [...existingDelays, nextDelay];

          return {
            ...phase,
            status: phase.status === 'done' ? 'done' : 'delayed',
            steps: steps.map((step) => {
              if (step.id !== nextDelay.stepId) return step;
              return step.status === 'done' ? step : { ...step, status: 'delayed' };
            }),
            delays,
          };
        }),
      };

      const syncedProject = resyncProjectSchedule(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setDelayDraft(null);
    } finally {
      endMutation(mutationKey);
    }
  }

  async function handleDeleteDelay() {
    if (!delayDraft || delayDraft.mode === 'create') return;
    await deleteDelayFromRow(delayDraft);
  }

  async function handleSaveDependencies() {
    if (!dependencyDraft) return;

    const mutationKey = ['project', dependencyDraft.projectId, 'dependency', dependencyDraft.stepId];
    beginMutation(mutationKey);
    try {
      const project = data.projects.find((item) => item.id === dependencyDraft.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== dependencyDraft.phaseId) return phase;

          const nextPhase = {
            ...phase,
            steps: (phase.steps || []).map((step) => {
              if (step.id !== dependencyDraft.stepId) return step;
              const nextPreds = dependencyDraft.options
                .filter((option) => option.selected)
                .map((option) => ({ id: option.id, lag: option.lag || 0 }));

              for (const pred of nextPreds) {
                if (wouldCreateCycleFromPreds(phase, pred.id, step.id)) {
                  throw new Error('Cannot create a circular dependency.');
                }
              }

              return {
                ...step,
                predecessors: nextPreds,
              };
            }),
          };

          syncStepLinks(nextPhase);
          cascadeStepDates(nextPhase, data.settings);
          return nextPhase;
        }),
      };

      const syncedProject = resyncProjectSchedule(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setDependencyDraft(null);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save dependencies.', 'Save failed');
    } finally {
      endMutation(mutationKey);
    }
  }

  const editorSaving = editorDraft
    ? isMutating(['project', editorDraft.projectId, editorDraft.type, editorDraft.stepId || editorDraft.phaseId || 'create']) ||
      isMutating(['project', editorDraft.projectId, editorDraft.type, editorDraft.phaseId])
    : false;
  const delaySaving = delayDraft
    ? isMutating(['project', delayDraft.projectId, 'delay', delayDraft.delayId || 'create'])
    : false;
  const dependencySaving = dependencyDraft
    ? isMutating(['project', dependencyDraft.projectId, 'dependency', dependencyDraft.stepId])
    : false;
  const taskSaving = taskDraft ? isMutating(['task', taskDraft.id]) : false;
  const taskPersonSaving = isMutating(['person', 'create-for-schedule']);
  const inspectionSaving = inspectionDraft
    ? isMutating(['inspection', inspectionDraft.id || 'create'])
    : false;
  const phaseSaving = phaseNameDraft
    ? isMutating(['project', phaseNameDraft.projectId, 'phase-create'])
    : false;
  const subcodeSaving = isMutating(['settings', 'inspection-subcodes']);

  return (
    <section className={`panel native-panel workspace-page ${isScheduleView ? 'top-level-schedule-page' : 'top-level-calendar-page'}`}>
      <div className="panel-actions header-scope-actions">
        <div className="schedule-toolbar header-scope-toolbar">
          {isScheduleView ? (
            <div className="schedule-toolbar-summary">
              <strong>Schedule</strong>
              <span>{rows.length} {scheduleSearchActive ? 'matching' : 'visible'} items</span>
            </div>
          ) : null}
          {isScheduleView ? (
            <div className="schedule-toolbar-actions">
              <input
                className="schedule-search-input"
                type="search"
                value={scheduleSearchQuery}
                onChange={(event) => setScheduleSearchQuery(event.target.value)}
                aria-label="Search schedule"
                placeholder="Search schedule"
              />
              <label className="schedule-history-filter">
                <input
                  type="checkbox"
                  checked={hidePastScheduleItems}
                  onChange={(event) => setHidePastScheduleItems(event.target.checked)}
                />
                <span>Hide past</span>
              </label>
              <SavedFiltersControls
                storageKey={`project-tracker:saved-filters:schedule:${activeUser?.id || 'default'}`}
                currentValue={{
                  projectId: projectFilter,
                  query: scheduleSearchQuery,
                  hidePast: hidePastScheduleItems,
                  displayMode: scheduleDisplayMode,
                  zoom: ganttZoomValue,
                }}
                onApply={(filter) => {
                  onProjectFilterChange(
                    filter.projectId === 'all' || visibleProjects.some((project) => project.id === filter.projectId)
                      ? filter.projectId
                      : 'all',
                  );
                  setScheduleSearchQuery(String(filter.query || ''));
                  setHidePastScheduleItems(filter.hidePast === true);
                  setScheduleDisplayMode(filter.displayMode === 'agenda' ? 'agenda' : 'gantt');
                  setGanttZoomValue(Math.min(GANTT_ZOOM_OPTIONS.length - 1, Math.max(0, Number(filter.zoom) || 0)));
                }}
                disabled={false}
              />
              <button className="button secondary schedule-today-button" type="button" onClick={handleScheduleToday}>
                Today
              </button>
              <div className="schedule-view-toggle" role="group" aria-label="Schedule view">
                <button
                  className={`button secondary${scheduleDisplayMode === 'gantt' ? ' active' : ''}`}
                  type="button"
                  aria-pressed={scheduleDisplayMode === 'gantt'}
                  onClick={() => setScheduleDisplayMode('gantt')}
                >
                  Gantt
                </button>
                <button
                  className={`button secondary${scheduleDisplayMode === 'agenda' ? ' active' : ''}`}
                  type="button"
                  aria-pressed={scheduleDisplayMode === 'agenda'}
                  onClick={() => setScheduleDisplayMode('agenda')}
                >
                  Agenda
                </button>
              </div>
              <div className="gantt-zoom-controls" aria-label="Gantt zoom controls">
                <span>Zoom</span>
                <input
                  className="gantt-zoom-slider"
                  type="range"
                  min="0"
                  max={GANTT_ZOOM_OPTIONS.length - 1}
                  step="1"
                  value={ganttZoomValue}
                  onChange={(event) => setGanttZoomValue(Number(event.target.value))}
                  aria-valuetext={ganttZoomLabel}
                />
                <strong>{ganttZoomLabel}</strong>
              </div>
              <button className="button secondary" type="button" onClick={toggleAllExpanded}>
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isScheduleView ? (
        <section className="workspace-section">
        {rows.length ? (
        <>
        <MobileScheduleAgenda
          rows={rows}
          className={scheduleDisplayMode === 'agenda' ? 'desktop-visible' : ''}
          agendaRef={mobileAgendaRef}
          expansionLocked={scheduleSearchActive}
          onToggle={(row) => row.type === 'project' ? toggleProject(row.entityId) : togglePhase(row.entityId)}
          onAddPhase={(row) => startCreatePhase(row.entityId)}
          onAddStep={(row) => startCreateStep(row.parentProjectId, row.entityId)}
          onAddDelay={(row) => startCreateDelay(row.parentProjectId, row.entityId)}
          onEdit={(row) => {
            if (row.type === 'phase') openPhaseEditor(row);
            else if (row.type === 'step') openStepEditor(row);
            else if (row.type === 'delay') openDelayEditor(row);
            else if (row.type === 'task') openTaskEditor(row);
          }}
          onDependencies={openDependencyEditor}
        />
        <div ref={ganttShellRef} className={`gantt-shell desktop-schedule-gantt${scheduleDisplayMode === 'agenda' ? ' desktop-hidden' : ''}`}>
          <div ref={ganttTableRef} className="gantt-table">
            <div className="gantt-header gantt-label-header">
              <span>#</span>
              <span>Item</span>
              <span>Dates</span>
            </div>

            {ganttVirtualRange.beforeSize ? (
              <div className="gantt-virtual-spacer" style={{ height: `${ganttVirtualRange.beforeSize}px` }} aria-hidden="true" />
            ) : null}
            {visibleGanttRows.map((row, visibleIndex) => {
              const index = ganttVirtualRange.startIndex + visibleIndex;
              return (
              <div
                key={row.id}
                ref={(element) => {
                  ganttLabelRowRefs.current[index] = element;
                }}
                className={`gantt-row-label gantt-row-label-${row.type}${activeGanttRowId === row.id ? ' is-active' : ''}`}
                data-row-id={row.id}
                style={rowHeights[index] ? { minHeight: `${rowHeights[index]}px` } : undefined}
                onMouseEnter={() => setActiveGanttRowId(row.id)}
                onMouseLeave={() => setActiveGanttRowId((current) => current === row.id ? null : current)}
                onFocusCapture={() => setActiveGanttRowId(row.id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setActiveGanttRowId((current) => current === row.id ? null : current);
                  }
                }}
              >
                <span className="gantt-row-index">{index + 1}</span>
                <div className="gantt-row-title" style={{ paddingLeft: `${16 + row.depth * 18}px` }}>
                  <div className="gantt-row-title-line">
                    {row.type === 'project' ? (
                      <button
                        className="gantt-expand-button"
                        type="button"
                        disabled={scheduleSearchActive}
                        onClick={() => toggleProject(row.entityId)}
                        aria-label={row.expanded ? 'Collapse project' : 'Expand project'}
                      >
                        {row.expanded ? '-' : '+'}
                      </button>
                    ) : row.type === 'phase' ? (
                      <button
                        className="gantt-expand-button"
                        type="button"
                        disabled={scheduleSearchActive}
                        onClick={() => togglePhase(row.entityId)}
                        aria-label={row.expanded ? 'Collapse phase' : 'Expand phase'}
                      >
                        {row.expanded ? '-' : '+'}
                      </button>
                    ) : (
                      <span className="gantt-expand-spacer" />
                    )}
                    <strong title={row.type === 'delay' && row.description ? row.description : undefined}>
                      {row.label}
                    </strong>
                  </div>
                  {row.type !== 'project' && row.subtitle ? <small>{row.subtitle}</small> : null}
                </div>
                <div className="gantt-row-meta">
                  {row.type === 'task' ? (
                    <span className="gantt-row-dates">
                      {formatShortDate(row.start)}
                      {row.end && row.end !== row.start ? ` - ${formatShortDate(row.end)}` : ''}
                    </span>
                  ) : null}
                  {row.type === 'project' ? (
                    <button
                      className="button secondary gantt-edit-button"
                      type="button"
                      onClick={() => startCreatePhase(row.entityId)}
                    >
                      Add phase
                    </button>
                  ) : null}
                  {row.type === 'phase' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => startCreateDelay(row.parentProjectId, row.entityId)}
                        aria-label={`Add delay to ${row.label}`}
                        title="Add delay"
                      >
                        <FluentIcon name="warning" />
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => startCreateStep(row.parentProjectId, row.entityId)}
                        aria-label={`Add step to ${row.label}`}
                        title="Add step"
                      >
                        <FluentIcon name="add" />
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openPhaseEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit phase"
                      >
                        <FluentIcon name="edit" />
                      </button>
                    </>
                  ) : null}
                  {row.type === 'step' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => openDependencyEditor(row)}
                        aria-label={`Edit dependencies for ${row.label}`}
                        title="Dependencies"
                      >
                        <FluentIcon name="dependency" />
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button gantt-trash-button"
                        type="button"
                        onClick={() => deleteStepFromRow(row)}
                        aria-label={`Delete ${row.label}`}
                        title="Delete step"
                      >
                        <FluentIcon name="delete" />
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openStepEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit step"
                      >
                        <FluentIcon name="edit" />
                      </button>
                    </>
                  ) : null}
                  {row.type === 'delay' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button gantt-trash-button"
                        type="button"
                        onClick={() => deleteDelayFromRow(row)}
                        aria-label={`Delete ${row.label}`}
                        title="Delete delay"
                      >
                        <FluentIcon name="delete" />
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openDelayEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit delay"
                      >
                        <FluentIcon name="edit" />
                      </button>
                    </>
                  ) : null}
                  {row.type === 'task' ? (
                    <button
                      className="button secondary gantt-edit-button gantt-icon-button"
                      type="button"
                      onClick={() => openTaskEditor(row)}
                      aria-label={`Edit ${row.label}`}
                      title="Edit task"
                    >
                      <FluentIcon name="edit" />
                    </button>
                  ) : null}
                </div>
              </div>
              );
            })}
            {ganttVirtualRange.afterSize ? (
              <div className="gantt-virtual-spacer" style={{ height: `${ganttVirtualRange.afterSize}px` }} aria-hidden="true" />
            ) : null}
          </div>

          <div ref={ganttTimelineWrapRef} className="gantt-timeline-wrap">
            <div
              className={`gantt-timeline-header${ganttZoomOption.visibleDays === 90 ? ' gantt-weekly-grid' : ''}`}
              style={{ width: `${timelineCanvasWidth}px` }}
            >
              <div className="gantt-weeks">
                {visibleTimelineWeeks.map((week) => (
                  <div
                    key={week.key}
                    className="gantt-week"
                    style={{ left: `${week.left}%`, width: `${week.width}%` }}
                  >
                    {week.label}
                  </div>
                ))}
              </div>
              <div className="gantt-ticks">
                {visibleTimelineDays.map((tick) => (
                  <div
                    key={tick.key}
                    className={`gantt-tick${tick.isNonWorkday ? ' non-workday' : ''}`}
                    style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>

            <div
              ref={ganttGridRef}
              className={`gantt-grid${dragDependency ? ' connecting' : ''}${ganttZoomOption.visibleDays === 90 ? ' gantt-weekly-grid' : ''}`}
              style={{ width: `${timelineCanvasWidth}px` }}
            >
              <div className="gantt-non-workdays" aria-hidden="true">
                {visibleTimelineDays
                  .filter((day) => day.isNonWorkday)
                  .map((day) => (
                    <span
                      key={day.key}
                      style={{ left: `${day.left}%`, width: `${day.width}%` }}
                    />
                  ))}
              </div>
              <div className="gantt-grid-dividers" aria-hidden="true">
                {(ganttZoomOption.visibleDays === 90 ? visibleTimelineWeeks : visibleTimelineDays)
                  .filter((divider) => divider.left > 0)
                  .map((divider) => (
                    <span key={divider.key} style={{ left: `${divider.left}%` }} />
                  ))}
              </div>
              {ganttTodayPosition !== null ? (
                <div className="gantt-today-line" style={{ left: `${ganttTodayPosition}%` }} aria-hidden="true">
                  <span>Today</span>
                </div>
              ) : null}
              {dependencyArrows.length || dragPreview ? (
                <svg
                  className="gantt-arrows"
                  viewBox={`0 0 100 ${timelineViewHeight || GANTT_ROW_MIN_HEIGHT}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="gantt-arrowhead"
                      viewBox="0 0 6 6"
                      refX="5.5"
                      refY="3"
                      markerWidth="4"
                      markerHeight="4"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M0 0L6 3L0 6Z"
                        fill="#767b80"
                      />
                    </marker>
                  </defs>
                  {dependencyArrows.map((arrow) => (
                    <path
                      key={arrow.key}
                      d={arrow.d}
                      fill="none"
                      stroke="#767b80"
                      strokeWidth="1.25"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="miter"
                      opacity="0.9"
                    />
                  ))}
                  {dragPreview ? (
                    <path
                      d={dragPreview.d}
                      fill="none"
                      stroke="#4d58b7"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray="6 4"
                      opacity="0.95"
                      markerEnd="url(#gantt-arrowhead)"
                    />
                  ) : null}
                </svg>
              ) : null}
              {dependencyArrows.length ? (
                <div className="gantt-dependency-arrowheads" aria-hidden="true">
                  {dependencyArrows.map((arrow) => (
                    <span
                      key={arrow.key}
                      className={arrow.direction}
                      style={{ left: `${arrow.endX}%`, top: `${arrow.endY}px` }}
                    />
                  ))}
                </div>
              ) : null}
              {ganttVirtualRange.beforeSize ? (
                <div className="gantt-grid-virtual-spacer" style={{ height: `${ganttVirtualRange.beforeSize}px` }} aria-hidden="true" />
              ) : null}
              {visibleGanttRows.map((row, visibleIndex) => {
                const index = ganttVirtualRange.startIndex + visibleIndex;
                const style = getTimelineStyle(row, timeline.minDate, timeline.maxDate);
                const canConnectHere =
                  dragDependency &&
                  row.type === 'step' &&
                  row.entityId !== dragDependency.fromStepId &&
                  row.parentProjectId === dragDependency.projectId &&
                  row.parentPhaseId === dragDependency.phaseId;
                const barTitle =
                  row.type === 'delay'
                    ? `${row.label}: ${formatTooltipDate(row.start)}${row.end && row.end !== row.start ? ` to ${formatTooltipDate(row.end)}` : ''}`
                    : `${row.label}: ${formatTooltipDate(row.start)}${row.end && row.end !== row.start ? ` to ${formatTooltipDate(row.end)}` : ''}${row.assign ? ` | Assignee: ${row.assign}` : ''}`;
                return (
                  <div
                    key={row.id}
                    ref={(element) => {
                      ganttTimelineRowRefs.current[index] = element;
                    }}
                    className={`gantt-grid-row${activeGanttRowId === row.id ? ' is-active' : ''}`}
                    data-row-id={row.id}
                    style={rowHeights[index] ? { minHeight: `${rowHeights[index]}px` } : undefined}
                    onMouseEnter={() => setActiveGanttRowId(row.id)}
                    onMouseLeave={() => setActiveGanttRowId((current) => current === row.id ? null : current)}
                    onFocusCapture={() => setActiveGanttRowId(row.id)}
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setActiveGanttRowId((current) => current === row.id ? null : current);
                      }
                    }}
                  >
                    {style ? (
                      <div
                        className={`gantt-bar gantt-bar-${row.type} status-${row.status || 'planning'}${row.isMilestone ? ' milestone' : ''}${canConnectHere ? ' connect-target' : ''}${dragDependency?.fromStepId === row.entityId ? ' connect-source' : ''}`}
                        style={style}
                        title={barTitle}
                        data-connect-target={row.type === 'step' ? 'true' : undefined}
                        data-project-id={row.type === 'step' ? row.parentProjectId : undefined}
                        data-phase-id={row.type === 'step' ? row.parentPhaseId : undefined}
                        data-step-id={row.type === 'step' ? row.entityId : undefined}
                        onClick={row.type === 'task' ? () => openTaskEditor(row) : undefined}
                      />
                    ) : null}
                    {row.type === 'step' && style ? (
                      <>
                        <button
                          type="button"
                          className={`gantt-connect-handle output${dragDependency?.fromStepId === row.entityId ? ' active' : ''}`}
                          style={{
                            left: row.isMilestone
                              ? `calc(${style.left} + 16px)`
                              : `calc(${style.left} + ${style.width})`,
                          }}
                          title={`Drag from "${row.label}" to connect it as a predecessor`}
                          onPointerDown={(event) => beginDependencyDrag(event, row)}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
              {ganttVirtualRange.afterSize ? (
                <div className="gantt-grid-virtual-spacer" style={{ height: `${ganttVirtualRange.afterSize}px` }} aria-hidden="true" />
              ) : null}
            </div>
          </div>
        </div>
        </>
      ) : (
        <div className="empty-state">
          <h3>No scheduled items to show</h3>
          <p>
            Add phase, step, delay, or task dates to see them in the Gantt timeline.
          </p>
          <button
            className="button primary"
            type="button"
            onClick={() => startCreateStep(emptyScheduleTarget.projectId, emptyScheduleTarget.phaseId)}
            disabled={!emptyScheduleTarget.projectId}
          >
            Add step
          </button>
        </div>
      )}
        </section>
      ) : null}

      {isScheduleView ? (
        <div className="schedule-footer-note">
          <strong>Tip:</strong> drag from the small handle at the end of a step bar onto another step in the same phase to create a dependency instantly.
        </div>
      ) : null}

      {isCalendarView ? (
      <section className="schedule-calendar-card workspace-section">
        <div className="schedule-calendar-header">
          <div className="calendar-nav">
            <button
              className="button secondary"
              type="button"
              onClick={goToPreviousCalendarMonth}
            >
              Previous
            </button>
            <div className="calendar-month-label">
              {calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={goToNextCalendarMonth}
            >
              Next
            </button>
            <button
              className="button secondary calendar-today-button"
              type="button"
              onClick={() => {
                const today = new Date();
                setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              }}
            >
              Today
            </button>
          </div>
          <div className="calendar-filter-actions">
            <label className="task-filter calendar-item-filter">
              <span>Show</span>
              <select value={calendarItemFilter} onChange={(event) => setCalendarItemFilter(event.target.value)}>
                <option value="all">All items</option>
                <option value="schedule">Schedule</option>
                <option value="tasks">Tasks</option>
                <option value="inspections">Inspections</option>
              </select>
            </label>
            <SavedFiltersControls
              storageKey={`project-tracker:saved-filters:calendar:${activeUser?.id || 'default'}`}
              currentValue={{ projectId: projectFilter, itemType: calendarItemFilter }}
              onApply={(filter) => {
                onProjectFilterChange(
                  filter.projectId === 'all' || visibleProjects.some((project) => project.id === filter.projectId)
                    ? filter.projectId
                    : 'all',
                );
                setCalendarItemFilter(['schedule', 'tasks', 'inspections'].includes(filter.itemType) ? filter.itemType : 'all');
              }}
              disabled={false}
            />
          </div>
        </div>

        <SharedCalendarGrid
          calendarWeeks={calendarWeeks}
          expandedCalendarWeeks={expandedCalendarWeeks}
          setExpandedCalendarWeeks={setExpandedCalendarWeeks}
          showHebrewDates={showCalendarHebrewDates}
          onDateClick={handleCalendarDateClick}
          onItemClick={openCalendarItem}
          getDayItemSubtitle={(item) => item.projectName || ''}
          shellClassName="calendar-swipe-shell"
          swipeHandlers={calendarSwipeHandlers}
          onNavigatePrevious={goToPreviousCalendarMonth}
          onNavigateNext={goToNextCalendarMonth}
        />
      </section>
      ) : null}

      <Suspense fallback={null}>
      {editorDraft ? <ScheduleItemModal
        draft={editorDraft}
        type={editorDraft?.type}
        projects={visibleProjects}
        assigneeOptions={taskAssigneeOptions}
        saving={editorSaving}
        onChange={updateEditorDraft}
        onOpenPreds={openEditorPredecessors}
        onAddPhase={handleQuickAddPhase}
        onAddPerson={() => startCreateTaskAssignee('schedule')}
        onClose={() => {
          setEditorPredecessorDraft(null);
          setEditorDraft(null);
        }}
        onSave={() => handleSaveEditor('close')}
        onSaveAndNew={() => handleSaveEditor('new')}
        onDelete={handleDeleteEditor}
      /> : null}
      {editorPredecessorDraft ? <StepPredecessorModal
        draft={editorPredecessorDraft}
        saving={editorSaving}
        onTogglePred={toggleEditorPred}
        onLagChange={changeEditorPredLag}
        onClose={() => setEditorPredecessorDraft(null)}
        onSave={saveEditorPredecessors}
      /> : null}
      {delayDraft ? <DelayModal
        draft={delayDraft}
        saving={delaySaving}
        onChange={updateDelayDraft}
        onClose={() => setDelayDraft(null)}
        onSave={handleSaveDelay}
        onDelete={handleDeleteDelay}
      /> : null}
      {dependencyDraft ? <DependencyModal
        draft={dependencyDraft}
        saving={dependencySaving}
        onTogglePred={toggleDependencyPred}
        onLagChange={changeDependencyLag}
        onClose={() => setDependencyDraft(null)}
        onSave={handleSaveDependencies}
      /> : null}
      {taskDraft ? <TaskModal
        draft={taskDraft}
        projects={visibleProjects}
        assigneeOptions={taskAssigneeOptions}
        saving={taskSaving}
        onChange={updateTaskDraft}
        onAddPerson={startCreateTaskAssignee}
        onClose={() => setTaskDraft(null)}
        onSave={handleSaveTaskDraft}
        onDelete={handleDeleteTaskDraft}
      /> : null}
      {taskPersonDraft ? (
        <PersonModal
          draft={taskPersonDraft}
          type={taskPersonDraft.type}
          isEditing={false}
          saving={taskPersonSaving}
          showTypeSelector
          onChange={(field, value) =>
            setTaskPersonDraft((current) => (current ? { ...current, [field]: value } : current))
          }
          onClose={() => setTaskPersonDraft(null)}
          onSave={handleSaveTaskPersonDraft}
          onDelete={() => {}}
        />
      ) : null}
      {inspectionDraft ? <InspectionModal
        draft={inspectionDraft}
        project={visibleProjects.find((project) => project.id === inspectionDraft?.projectId) || null}
        projects={visibleProjects}
        subcodes={inspectionSubcodes}
        saving={inspectionSaving}
        onChange={updateInspectionDraft}
        onAddSubcode={handleAddInspectionSubcodeFromSchedule}
        onClose={() => setInspectionDraft(null)}
        onSave={handleSaveInspectionDraft}
        onDelete={handleDeleteInspectionDraft}
      /> : null}
      {phaseNameDraft ? <TextEntryModal
        draft={phaseNameDraft}
        saving={phaseSaving}
        onChange={(value) => setPhaseNameDraft((current) => (current ? { ...current, value } : current))}
        onClose={() => setPhaseNameDraft(null)}
        onSave={savePhaseNameDraft}
      /> : null}
      {subcodeDraft ? <TextEntryModal
        draft={subcodeDraft}
        saving={subcodeSaving}
        onChange={(value) => setSubcodeDraft((current) => (current ? { ...current, value } : current))}
        onClose={() => setSubcodeDraft(null)}
        onSave={saveScheduleInspectionSubcodeDraft}
      /> : null}
      </Suspense>
      <PageStats settings={data.settings}>
        <DashboardStat label="Projects" value={filteredProjects.length} tone="brand" />
        <DashboardStat label="Phases" value={stats.phases} />
        <DashboardStat label="Steps" value={stats.steps} />
        <DashboardStat
          label="Visible tasks"
          value={(isCalendarView ? showCalendarTasks : showGanttTasks) ? stats.visibleTaskCount : 0}
        />
      </PageStats>
      <div className="page-refresh-footer">
        <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </div>
    </section>
  );
}
