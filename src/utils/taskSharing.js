import { formatShortDate } from './calendarUi.js';
import { formatAssignees, getTaskAssignees } from './assignees.js';

function sortedAssigneeText(task) {
  return formatAssignees(
    [...getTaskAssignees(task)].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
  );
}

function assigneeLabel(value) {
  return `${value.includes(', ') ? 'Assignees' : 'Assignee'}: ${value}`;
}

function groupBy(entries, getKey) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = getKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.entries()];
}

export function buildTaskShareContent(tasks = [], projects = []) {
  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const selectedTasks = (tasks || []).filter(Boolean);
  const entries = selectedTasks.map((task) => ({
    task,
    projectName: projectById.get(task.projectId)?.name || 'No project assigned',
    assigneeText: sortedAssigneeText(task),
    statusText: task.done ? 'Completed' : 'Open',
  }));
  const projectNames = [...new Set(entries.map((entry) => entry.projectName))];
  const assigneeNames = [...new Set(entries.map((entry) => entry.assigneeText))];
  const statusNames = [...new Set(entries.map((entry) => entry.statusText))];
  const commonProject = projectNames.length === 1 ? projectNames[0] : '';
  const commonAssignee = assigneeNames.length === 1 ? assigneeNames[0] : '';
  const commonStatus = statusNames.length === 1 ? statusNames[0] : '';
  const title = selectedTasks.length === 1
    ? projectNames[0]
    : projectNames.length === 1
      ? `${projectNames[0]} tasks`
      : `${selectedTasks.length} Project Tracker tasks`;

  const lines = [
    ...(commonProject ? [`Project: ${commonProject}`] : []),
    ...(commonAssignee ? [assigneeLabel(commonAssignee)] : []),
    ...(commonStatus ? [`Status: ${commonStatus}`] : []),
    ...(commonProject || commonAssignee || commonStatus ? [''] : []),
    ...(selectedTasks.length > 1 ? ['Tasks:'] : []),
  ];
  let taskNumber = 0;
  groupBy(entries, (entry) => (commonProject ? '' : entry.projectName)).forEach(([projectName, projectEntries], projectIndex) => {
    if (!commonProject) {
      if (lines.length && lines[lines.length - 1] !== '' && lines[lines.length - 1] !== 'Tasks:') lines.push('');
      lines.push(`Project: ${projectName}`);
    }
    groupBy(projectEntries, (entry) => (commonAssignee ? '' : entry.assigneeText)).forEach(([assigneeText, assigneeEntries], assigneeIndex) => {
      if (!commonAssignee) {
        if (assigneeIndex > 0) lines.push('');
        lines.push(assigneeLabel(assigneeText));
      }
      groupBy(assigneeEntries, (entry) => (commonStatus ? '' : entry.statusText)).forEach(([statusText, statusEntries], statusIndex) => {
        if (!commonStatus) {
          if (statusIndex > 0) lines.push('');
          lines.push(`Status: ${statusText}`);
        }
        statusEntries.forEach(({ task }, taskIndex) => {
          if (taskIndex > 0) lines.push('');
          taskNumber += 1;
          const prefix = selectedTasks.length > 1 ? `${taskNumber}. ` : '';
          lines.push(`${prefix}${task.label}`);
          if (task.location) lines.push(`Location: ${task.location}`);
          if (task.due) lines.push(`Due date: ${formatShortDate(task.due)}`);
        });
      });
    });
    if (!commonProject && projectIndex < projectNames.length - 1) lines.push('');
  });
  const body = lines.join('\n');

  return { title, subject: title, body };
}
