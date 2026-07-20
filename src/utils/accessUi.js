export function normalizeProjectAccessUserIds(userIds) {
  return Array.isArray(userIds)
    ? Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
}

export function canUserViewProject(project, activeUser) {
  const role = ['Admin', 'Edit', 'View Only', 'Customer', 'Subcontractor'].includes(activeUser?.role)
    ? activeUser.role
    : 'View Only';
  if (role === 'Admin') return true;
  const accessUserIds = normalizeProjectAccessUserIds(project?.accessUserIds);
  if (accessUserIds.length > 0) return !!activeUser?.id && accessUserIds.includes(activeUser.id);
  return role === 'Edit';
}

export function getVisibleProjectsForUser(projects, settings, activeUser) {
  return (projects || []).filter((project) => canUserViewProject(project, activeUser));
}

export function getVisibleTasksForUser(tasks, settings, visibleProjects) {
  const visibleProjectIds = new Set((visibleProjects || []).map((project) => project.id));
  return (tasks || []).filter((task) => !task.projectId || visibleProjectIds.has(task.projectId));
}

export function personAssignmentLabel(person) {
  const name = `${person.first || ''} ${person.last || ''}`.trim();
  if (name && person.company) return `${name} (${person.company})`;
  return name || person.company || '';
}

export function buildTaskAssigneeOptions(subs = [], employees = []) {
  return [...subs, ...employees]
    .map((person) => personAssignmentLabel(person).trim())
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .sort((a, b) => a.localeCompare(b));
}

export function buildTaskAssigneeDirectory(subs = [], employees = []) {
  const directory = new Map();
  [
    ...subs.map((person) => ({ ...person, directoryType: 'sub' })),
    ...employees.map((person) => ({ ...person, directoryType: person.peopleType || 'emp' })),
  ].forEach((person) => {
    const label = personAssignmentLabel(person).trim();
    if (!label) return;
    const existing = directory.get(label);
    if (!existing || (!existing.email && person.email)) directory.set(label, person);
  });
  return directory;
}
