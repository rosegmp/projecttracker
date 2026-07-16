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
