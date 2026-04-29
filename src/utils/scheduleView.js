import { isOverdue, normalizePreds } from './schedule.js';

function parseDateValue(iso) {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function diffInDays(start, end) {
  return Math.round((end - start) / 86400000);
}

export function collectProjectScheduleBounds(project) {
  const dates = [];
  if (project.start) dates.push(parseDateValue(project.start));
  if (project.end) dates.push(parseDateValue(project.end));
  (project.phases || []).forEach((phase) => {
    if (phase.start) dates.push(parseDateValue(phase.start));
    if (phase.end) dates.push(parseDateValue(phase.end));
    (phase.steps || []).forEach((step) => {
      if (step.start) dates.push(parseDateValue(step.start));
      if (step.end) dates.push(parseDateValue(step.end));
    });
  });
  return dates.filter(Boolean);
}

export function buildScheduleRows(projects, tasksByProject, showTasks, expandedProjects, expandedPhases) {
  const rows = [];
  projects.forEach((project) => {
    const projectDates = collectProjectScheduleBounds(project);
    const sortedProjectDates = [...projectDates].sort((a, b) => a - b);
    const projectExpanded = expandedProjects[project.id] ?? true;
    rows.push({
      id: `project-${project.id}`,
      type: 'project',
      depth: 0,
      entityId: project.id,
      label: project.name,
      subtitle: `${project.manager || 'No manager'} | ${project.status || 'planning'}`,
      start: project.start || (sortedProjectDates[0] ? toIsoDate(sortedProjectDates[0]) : ''),
      end:
        project.end ||
        (sortedProjectDates.length
          ? toIsoDate(sortedProjectDates[sortedProjectDates.length - 1])
          : ''),
      status: project.status || 'planning',
      expanded: projectExpanded,
    });

    if (!projectExpanded) return;

    (project.phases || []).forEach((phase) => {
      const phaseExpanded = expandedPhases[phase.id] ?? true;
      const sortedSteps = [...(phase.steps || [])].sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        const aEnd = a.end || a.start || '9999-12-31';
        const bEnd = b.end || b.start || '9999-12-31';
        if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      rows.push({
        id: `phase-${phase.id}`,
        type: 'phase',
        depth: 1,
        entityId: phase.id,
        parentProjectId: project.id,
        label: phase.name,
        subtitle: `${phase.steps?.length || 0} step${phase.steps?.length === 1 ? '' : 's'}`,
        start: phase.start || '',
        end: phase.end || '',
        status: phase.status || project.status || 'planning',
        assign: phase.assign || '',
        expanded: phaseExpanded,
      });

      if (!phaseExpanded) return;

      sortedSteps.forEach((step) => {
        rows.push({
          id: `step-${step.id}`,
          type: 'step',
          depth: 2,
          entityId: step.id,
          parentProjectId: project.id,
          parentPhaseId: phase.id,
          label: step.name,
          subtitle: '',
          start: step.start || '',
          end: step.end || '',
          duration: step.duration || 1,
          assign: step.assign || '',
          predecessors: normalizePreds(step.predecessors),
          status: step.done ? 'done' : phase.status || project.status || 'planning',
        });

        ((phase.delays || []).filter((delay) => delay.stepId === step.id)).forEach((delay) => {
          const delayEnd = step.start ? toIsoDate(addDays(parseDateValue(step.start), Number(delay.days) || 0)) : '';
          rows.push({
            id: `delay-${delay.id}`,
            type: 'delay',
            depth: 3,
            entityId: delay.id,
            parentProjectId: project.id,
            parentPhaseId: phase.id,
            parentStepId: step.id,
            label: `${delay.cause} delay - ${Number(delay.days) || 1}d`,
            subtitle: '',
            start: step.start || '',
            end: delayEnd,
            status: 'delayed',
            delayDays: Number(delay.days) || 1,
            delayCause: delay.cause || 'Other',
            description: delay.description || '',
            stepName: step.name,
          });
        });
      });

      if (showTasks) {
        (tasksByProject.get(project.id) || []).forEach((task) => {
          rows.push({
            id: `task-${task.id}`,
            type: 'task',
            depth: 1,
            entityId: task.id,
            parentProjectId: project.id,
            label: task.label,
            subtitle: task.done ? 'Completed task' : 'Task due date',
            start: task.due || '',
            end: task.due || '',
            done: !!task.done,
            status: task.done ? 'done' : isOverdue(task.due, task.done) ? 'delayed' : 'active',
            isMilestone: true,
          });
        });
      }
    });
  });
  return rows;
}

export function buildCalendarItems(projects, tasksByProject, settings) {
  const itemsByDate = new Map();
  const holidayMap = new Map();
  const rangeItems = [];
  const showCalendarPhases = settings?.showCalendarPhases !== false;

  function pushItem(dateKey, item) {
    if (!itemsByDate.has(dateKey)) itemsByDate.set(dateKey, []);
    itemsByDate.get(dateKey).push(item);
  }

  function pushHoliday(dateKey, holiday) {
    if (!holidayMap.has(dateKey)) holidayMap.set(dateKey, []);
    holidayMap.get(dateKey).push(holiday);
  }

  projects.forEach((project) => {
    (project.phases || []).forEach((phase) => {
      const phaseStart = parseDateValue(phase.start);
      const phaseEnd = parseDateValue(phase.end || phase.start);
      if (showCalendarPhases && phaseStart && phaseEnd) {
        rangeItems.push({
          id: `phase-${phase.id}`,
          type: 'phase',
          label: phase.name,
          projectName: project.name,
          status: phase.status || project.status || 'planning',
          projectId: project.id,
          phaseId: phase.id,
          assign: phase.assign || '',
          start: phase.start || '',
          end: phase.end || '',
        });
      }

      (phase.steps || []).forEach((step) => {
        const stepStart = parseDateValue(step.start);
        const stepEnd = parseDateValue(step.end || step.start);
        if (stepStart && stepEnd) {
          rangeItems.push({
            id: `step-${step.id}`,
            type: 'step',
            label: step.name,
            projectName: project.name,
            status: step.done ? 'done' : phase.status || project.status || 'planning',
            projectId: project.id,
            phaseId: phase.id,
            stepId: step.id,
            assign: step.assign || '',
            start: step.start || '',
            end: step.end || '',
            duration: step.duration || 1,
          });
        }

        ((phase.delays || []).filter((delay) => delay.stepId === step.id)).forEach((delay) => {
          const delayEnd = step.start ? toIsoDate(addDays(parseDateValue(step.start), Number(delay.days) || 0)) : '';
          if (!step.start || !delayEnd) return;
          rangeItems.push({
            id: `delay-${delay.id}`,
            type: 'delay',
            label: `${delay.cause} delay`,
            projectName: project.name,
            status: 'delayed',
            projectId: project.id,
            phaseId: phase.id,
            delayId: delay.id,
            stepId: delay.stepId,
            days: Number(delay.days) || 1,
            cause: delay.cause || 'Other',
            description: delay.description || '',
            start: step.start,
            end: delayEnd,
            stepName: step.name,
          });
        });
      });
    });

    (tasksByProject.get(project.id) || []).forEach((task) => {
      if (!task.due) return;
      pushItem(task.due, {
        id: `task-${task.id}`,
        taskId: task.id,
        type: 'task',
        label: task.label,
        projectName: project.name,
        projectId: project.id,
        due: task.due,
        done: !!task.done,
        status: task.done ? 'done' : isOverdue(task.due, task.done) ? 'delayed' : 'active',
      });
    });
  });

  (settings?.holidays || []).forEach((holiday) => {
    if (!holiday.date) return;
    const start = parseDateValue(holiday.date);
    const end = parseDateValue(
      holiday.endDate && holiday.endDate >= holiday.date ? holiday.endDate : holiday.date,
    );
    if (!start || !end) return;
    const isRangeHoliday = toIsoDate(start) !== toIsoDate(end);
    if (isRangeHoliday) {
      rangeItems.push({
        id: `holiday-${holiday.id || `${holiday.date}-${holiday.name || 'holiday'}`}`,
        type: 'holiday',
        label: holiday.name || 'Holiday',
        projectName: '',
        status: 'holiday',
        start: toIsoDate(start),
        end: toIsoDate(end),
        nonWorkday: holiday.nonWorkday !== false,
      });
    }
    for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
      pushHoliday(toIsoDate(day), {
        id: holiday.id || `${holiday.date}-${holiday.name || 'holiday'}`,
        name: holiday.name || 'Holiday',
        nonWorkday: holiday.nonWorkday !== false,
        isRange: isRangeHoliday,
      });
    }
  });

  itemsByDate.forEach((items) =>
    items.sort((a, b) => {
      const order = { phase: 0, step: 1, task: 2 };
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return a.label.localeCompare(b.label);
    }),
  );

  rangeItems.sort((a, b) => {
    const order = { holiday: 0, phase: 1, step: 2, delay: 3 };
    const aStart = a.start || '9999-12-31';
    const bStart = b.start || '9999-12-31';
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    if ((order[a.type] ?? 99) !== (order[b.type] ?? 99)) return (order[a.type] ?? 99) - (order[b.type] ?? 99);
    return a.label.localeCompare(b.label);
  });

  return { itemsByDate, holidayMap, rangeItems };
}

export function buildCalendarWeeks(calendarCells, rangeItems, maxVisibleLanes = 3, expandedWeekKeys = new Set()) {
  const weeks = [];

  for (let index = 0; index < calendarCells.length; index += 7) {
    const cells = calendarCells.slice(index, index + 7);
    const weekStart = cells[0]?.key;
    const weekEnd = cells[6]?.key;
    const scheduledBars = [];
    const holidayBars = [];
    const scheduledLaneEnds = [];
    const holidayLaneEnds = [];
    const weekKey = weekStart || `week-${index}`;
    const isExpanded = expandedWeekKeys instanceof Set ? expandedWeekKeys.has(weekKey) : false;

    (rangeItems || []).forEach((item) => {
      if (!weekStart || !weekEnd || !item.start || !item.end) return;
      if (item.end < weekStart || item.start > weekEnd) return;

      const startCol = Math.max(0, diffInDays(parseDateValue(weekStart), parseDateValue(item.start)));
      const endCol = Math.min(6, diffInDays(parseDateValue(weekStart), parseDateValue(item.end)));
      const targetBars = item.type === 'holiday' ? holidayBars : scheduledBars;
      const laneEnds = item.type === 'holiday' ? holidayLaneEnds : scheduledLaneEnds;
      let lane = 0;
      while (laneEnds[lane] !== undefined && laneEnds[lane] >= startCol) lane += 1;
      laneEnds[lane] = endCol;
      targetBars.push({ ...item, startCol, endCol, lane });
    });

    const laneCount = Math.max(scheduledBars.length ? Math.max(...scheduledBars.map((bar) => bar.lane)) + 1 : 0, 0);
    const visibleLaneCount = isExpanded ? laneCount : Math.min(laneCount, maxVisibleLanes);
    const visibleBars = isExpanded
      ? scheduledBars
      : scheduledBars.filter((bar) => bar.lane < maxVisibleLanes);
    const hiddenBarCount = Math.max(0, scheduledBars.length - visibleBars.length);
    const holidayLaneCount = Math.max(holidayBars.length ? Math.max(...holidayBars.map((bar) => bar.lane)) + 1 : 0, 0);

    weeks.push({
      key: weekKey,
      cells,
      scheduledBars,
      bars: visibleBars,
      holidayBars,
      laneCount,
      visibleLaneCount,
      holidayLaneCount,
      hiddenBarCount,
      isExpanded,
    });
  }

  return weeks;
}
