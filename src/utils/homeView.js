import { buildAuditTrailEntries } from './auditTrail.js';
import { getTaskAssignees } from './assignees.js';
import { personAssignmentLabel } from './accessUi.js';

export function getLocalIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + amount);
  return date;
}

function intersectsDate(start, end, dateIso) {
  const first = start || end || '';
  const last = end || start || '';
  return !!first && first <= dateIso && last >= dateIso;
}

function intersectsRange(start, end, rangeStart, rangeEnd) {
  const first = start || end || '';
  const last = end || start || '';
  return !!first && first <= rangeEnd && last >= rangeStart;
}

function isCompleteStatus(value) {
  return ['done', 'complete', 'completed', 'passed', 'approved'].includes(String(value || '').trim().toLowerCase());
}

function isStepComplete(step) {
  return !!step?.done || isCompleteStatus(step?.status);
}

function predecessorIds(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source.map((item) => String(typeof item === 'string' ? item : item?.id || '').trim()).filter(Boolean);
}

function buildProjectBlockedSteps(project, todayIso) {
  const blocked = [];
  (project?.phases || []).forEach((phase) => {
    const stepMap = new Map((phase.steps || []).filter((step) => step?.id).map((step) => [String(step.id), step]));
    (phase.steps || []).forEach((step) => {
      if (isStepComplete(step)) return;
      const delayed = String(step.status || '').toLowerCase() === 'delayed';
      const waitingOnPredecessor = predecessorIds(step.predecessors).some((id) => {
        const predecessor = stepMap.get(id);
        return predecessor && !isStepComplete(predecessor);
      });
      const shouldHaveStarted = !!step.start && step.start <= todayIso;
      if (!delayed && !(waitingOnPredecessor && shouldHaveStarted)) return;
      blocked.push({
        ...step,
        type: 'step',
        label: step.name || 'Schedule step',
        projectId: project.id,
        projectName: project.name || 'Project',
        phaseId: phase.id,
        phaseName: phase.name || 'Phase',
        attentionKind: delayed ? 'Delayed' : 'Blocked',
      });
    });
  });
  return blocked;
}

function compareItems(left, right) {
  return `${left.projectName || ''}\u0000${left.label || ''}`.localeCompare(
    `${right.projectName || ''}\u0000${right.label || ''}`,
  );
}

export function buildHomeDaySummary(projects = [], tasks = [], dateIso = '') {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const inspections = [];
  const scheduleItems = [];

  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (inspection.date !== dateIso) return;
      inspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
      });
    });

    (project.phases || []).forEach((phase) => {
      if (intersectsDate(phase.start, phase.end, dateIso)) {
        scheduleItems.push({
          ...phase,
          type: 'phase',
          label: phase.name || 'Phase',
          projectId: project.id,
          projectName: project.name || 'Project',
        });
      }
      (phase.steps || []).forEach((step) => {
        if (!intersectsDate(step.start, step.end, dateIso)) return;
        scheduleItems.push({
          ...step,
          type: 'step',
          label: step.name || 'Schedule step',
          projectId: project.id,
          projectName: project.name || 'Project',
          phaseId: phase.id,
          phaseName: phase.name || 'Phase',
        });
      });
    });
  });

  const openTasks = (tasks || [])
    .filter((task) => !task.done && task.due === dateIso)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }));

  return {
    inspections: inspections.sort(compareItems),
    openTasks: openTasks.sort(compareItems),
    scheduleItems: scheduleItems.sort(compareItems),
  };
}

export function buildHomeRangeSummary(projects = [], tasks = [], rangeStart = '', rangeEnd = rangeStart) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const inspections = [];
  const scheduleItems = [];

  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (!inspection.date || inspection.date < rangeStart || inspection.date > rangeEnd || isCompleteStatus(inspection.status)) return;
      inspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
      });
    });
    (project.phases || []).forEach((phase) => {
      if (intersectsRange(phase.start, phase.end, rangeStart, rangeEnd) && !isCompleteStatus(phase.status)) {
        scheduleItems.push({
          ...phase,
          type: 'phase',
          label: phase.name || 'Phase',
          projectId: project.id,
          projectName: project.name || 'Project',
        });
      }
      (phase.steps || []).forEach((step) => {
        if (!intersectsRange(step.start, step.end, rangeStart, rangeEnd) || isStepComplete(step)) return;
        scheduleItems.push({
          ...step,
          type: 'step',
          label: step.name || 'Schedule step',
          projectId: project.id,
          projectName: project.name || 'Project',
          phaseId: phase.id,
          phaseName: phase.name || 'Phase',
        });
      });
    });
  });

  const openTasks = (tasks || [])
    .filter((task) => !task.done && task.due && task.due >= rangeStart && task.due <= rangeEnd)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }));

  const byDateThenName = (left, right) => {
    const leftDate = left.due || left.date || left.start || '';
    const rightDate = right.due || right.date || right.start || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return compareItems(left, right);
  };
  return {
    inspections: inspections.sort(byDateThenName),
    openTasks: openTasks.sort(byDateThenName),
    scheduleItems: scheduleItems.sort(byDateThenName),
  };
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildHomeOpenTasks(tasks = [], projects = [], activeUser = null, people = []) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const isAdmin = activeUser?.role === 'Admin';
  const userName = normalizeIdentity(activeUser?.name);
  const userEmail = normalizeIdentity(activeUser?.email);
  const assignmentLabels = new Set(
    (people || [])
      .filter((person) => userEmail && normalizeIdentity(person?.email) === userEmail)
      .map((person) => normalizeIdentity(personAssignmentLabel(person)))
      .filter(Boolean),
  );
  if (userName) assignmentLabels.add(userName);
  if (userEmail) assignmentLabels.add(userEmail);

  function belongsToActiveUser(task) {
    if (isAdmin) return true;
    return getTaskAssignees(task).some((assignee) => {
      const normalized = normalizeIdentity(assignee);
      if (assignmentLabels.has(normalized)) return true;
      return userName && (normalized === userName || normalized.startsWith(`${userName} (`));
    });
  }

  return (tasks || [])
    .filter((task) => !task.done && belongsToActiveUser(task))
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }))
    .sort((left, right) => {
      const leftDue = left.due || '9999-12-31';
      const rightDue = right.due || '9999-12-31';
      if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
      return compareItems(left, right);
    });
}

export function buildHomeAttentionSummary(projects = [], scopedTasks = [], todayIso = '', allVisibleTasks = scopedTasks) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const overdueTasks = (scopedTasks || [])
    .filter((task) => !task.done && task.due && task.due < todayIso)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
      attentionKind: 'Overdue',
    }));
  const unassignedTasks = (allVisibleTasks || [])
    .filter((task) => !task.done && getTaskAssignees(task).length === 0)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
      attentionKind: 'Unassigned',
    }));
  const overdueInspections = [];
  const blockedSteps = [];
  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (!inspection.date || inspection.date >= todayIso || isCompleteStatus(inspection.status)) return;
      overdueInspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
        attentionKind: 'Overdue',
      });
    });
    blockedSteps.push(...buildProjectBlockedSteps(project, todayIso));
  });

  const byDueDate = (left, right) => {
    const leftDate = left.due || left.date || left.start || '';
    const rightDate = right.due || right.date || right.start || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return compareItems(left, right);
  };
  return {
    overdueTasks: overdueTasks.sort(byDueDate),
    overdueInspections: overdueInspections.sort(byDueDate),
    blockedSteps: blockedSteps.sort(byDueDate),
    unassignedTasks: unassignedTasks.sort(byDueDate),
  };
}

export function getProjectOperationalHealth(project, tasks = [], todayIso = getLocalIsoDate()) {
  if (String(project?.status || '').toLowerCase() === 'done') {
    return { label: 'Completed', tone: 'done', issueCount: 0 };
  }
  const projectTasks = (tasks || []).filter((task) => task.projectId === project?.id && !task.done);
  const overdueTaskCount = projectTasks.filter((task) => task.due && task.due < todayIso).length;
  const overdueInspectionCount = (project?.inspections || []).filter(
    (inspection) => inspection.date && inspection.date < todayIso && !isCompleteStatus(inspection.status),
  ).length;
  const blockedStepCount = buildProjectBlockedSteps(project, todayIso).length;
  const issueCount = overdueTaskCount + overdueInspectionCount + blockedStepCount;
  if (issueCount) return { label: `Needs attention · ${issueCount}`, tone: 'attention', issueCount };
  if (project?.end && project.end < todayIso) return { label: 'Past target date', tone: 'attention', issueCount: 1 };
  if (String(project?.status || '').toLowerCase() === 'planning') return { label: 'In planning', tone: 'planning', issueCount: 0 };
  return { label: 'On track', tone: 'good', issueCount: 0 };
}

export function groupRecentAuditChanges(rows = [], now = new Date()) {
  const today = getLocalIsoDate(now);
  const yesterday = getLocalIsoDate(addLocalDays(now, -1));
  const groups = { today: [], yesterday: [] };
  buildAuditTrailEntries(rows).forEach((entry) => {
    const entryDate = getLocalIsoDate(entry.createdAt);
    if (entryDate === today) groups.today.push(entry);
    else if (entryDate === yesterday) groups.yesterday.push(entry);
  });
  const newestFirst = (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  groups.today.sort(newestFirst);
  groups.yesterday.sort(newestFirst);
  return groups;
}
