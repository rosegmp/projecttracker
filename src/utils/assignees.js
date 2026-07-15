export function normalizeAssignees(value, legacyValue = '') {
  const source = Array.isArray(value) ? value : value ? [value] : legacyValue ? [legacyValue] : [];
  return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function getTaskAssignees(task = {}) {
  return normalizeAssignees(task.assignees, task.assignee);
}

export function getScheduleAssignees(item = {}) {
  return normalizeAssignees(item.assignees, item.assign);
}

export function taskAssigneeFields(value) {
  const assignees = normalizeAssignees(value);
  return { assignees, assignee: assignees[0] || '' };
}

export function scheduleAssigneeFields(value) {
  const assignees = normalizeAssignees(value);
  return { assignees, assign: assignees[0] || '' };
}

export function formatAssignees(value, fallback = 'Unassigned') {
  const assignees = normalizeAssignees(value);
  return assignees.length ? assignees.join(', ') : fallback;
}
