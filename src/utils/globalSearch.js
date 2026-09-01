import { personAssignmentLabel } from './accessUi.js';

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase();
}

function personType(person, fallback = 'emp') {
  const type = clean(person?.peopleType || fallback);
  return ['sub', 'emp', 'supplier', 'consultant', 'customer'].includes(type) ? type : fallback;
}

function personTypeLabel(type) {
  return {
    sub: 'Subcontractor',
    emp: 'Employee',
    supplier: 'Supplier',
    consultant: 'Consultant',
    customer: 'Customer',
  }[type] || 'Person';
}

function certificateKeywords(person) {
  return (Array.isArray(person?.certificates) ? person.certificates : [])
    .flatMap((certificate) => [
      certificate?.insurer,
      certificate?.insuranceCompany,
      certificate?.policyNumber,
      certificate?.policy,
      certificate?.coverageType,
    ])
    .map(clean)
    .filter(Boolean);
}

const RECENT_LIMIT = 8;

function recentStorageKey(userId) {
  return `project-tracker:global-search-recents:${clean(userId) || 'anonymous'}`;
}

export function loadGlobalSearchRecentIds(userId, storage = globalThis?.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(recentStorageKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordGlobalSearchRecentId(userId, itemId, storage = globalThis?.localStorage) {
  const normalizedId = clean(itemId);
  if (!storage || !normalizedId) return [];
  const next = [normalizedId, ...loadGlobalSearchRecentIds(userId, storage).filter((id) => id !== normalizedId)].slice(0, RECENT_LIMIT);
  try {
    storage.setItem(recentStorageKey(userId), JSON.stringify(next));
  } catch {
    // Recent destinations are a device convenience; navigation remains authoritative.
  }
  return next;
}

export function buildGlobalSearchItems({
  projects = [],
  tasks = [],
  subs = [],
  employees = [],
  includeTasks = false,
  includePeople = false,
  includeCertificates = false,
  includeSchedule = false,
  includeInspections = false,
  includeSelections = false,
  includeFiles = false,
  dailyLogs = [],
  rfis = [],
  submittals = [],
  warrantyItems = [],
  closeoutItems = [],
} = {}) {
  const projectNames = new Map(projects.map((project) => [project.id, clean(project.name) || 'Project']));
  const visibleProjectIds = new Set(projectNames.keys());
  const items = projects.map((project) => ({
    id: `project:${project.id}`,
    type: 'project',
    label: clean(project.name) || 'Unnamed project',
    meta: [clean(project.address), clean(project.status)].filter(Boolean).join(' · ') || 'Project',
    keywords: [project.name, project.address, project.status, project.projectManager],
    projectId: project.id,
  }));

  projects.forEach((project) => {
    const projectName = projectNames.get(project.id) || 'Project';
    if (includeSchedule) {
      (project.phases || []).forEach((phase) => {
        (phase.steps || []).forEach((step) => {
          items.push({
            id: `schedule-step:${project.id}:${step.id}`,
            type: 'schedule-step',
            label: clean(step.name) || 'Unnamed schedule step',
            meta: [projectName, clean(phase.name), [step.start, step.end].filter(Boolean).join('–'), clean(step.status)].filter(Boolean).join(' · '),
            keywords: [step.name, phase.name, projectName, step.start, step.end, step.status, ...(Array.isArray(step.assignees) ? step.assignees : [])],
            projectId: project.id,
            phaseId: phase.id,
            stepId: step.id,
            query: clean(step.name),
          });
        });
      });
    }
    if (includeInspections) {
      (project.inspections || []).forEach((inspection) => {
        const label = clean(inspection.subcode || inspection.inspectionType) || 'Inspection';
        items.push({
          id: `inspection:${project.id}:${inspection.id}`,
          type: 'inspection',
          label,
          meta: [projectName, clean(inspection.inspectionType), clean(inspection.date), clean(inspection.status)].filter(Boolean).join(' · '),
          keywords: [label, inspection.inspectionType, inspection.subcode, inspection.agency, inspection.date, inspection.status, projectName],
          projectId: project.id,
          inspectionId: inspection.id,
        });
      });
    }
    if (includeSelections) {
      (project.selections || []).forEach((selection) => {
        const label = clean(selection.itemName || selection.name || selection.category) || 'Selection';
        items.push({
          id: `selection:${project.id}:${selection.id}`,
          type: 'selection',
          label,
          meta: [projectName, clean(selection.category), clean(selection.status)].filter(Boolean).join(' · '),
          keywords: [label, selection.itemName, selection.name, selection.category, selection.status, selection.vendor, selection.selectedOption, projectName],
          projectId: project.id,
          selectionId: selection.id,
        });
      });
    }
    if (includeFiles) {
      (project.files?.folders || []).forEach((folder) => {
        (folder.files || []).filter((file) => !file?.archivedAt && file?.archived !== true).forEach((file) => {
          const fileId = clean(file.id);
          if (!fileId) return;
          const label = clean(file.originalName || file.name) || 'Untitled file';
          items.push({
            id: `file:${project.id}:${fileId}`,
            type: 'file',
            label,
            meta: [projectName, clean(folder.name), clean(file.type)].filter(Boolean).join(' · '),
            keywords: [label, file.name, file.originalName, file.type, folder.name, projectName, file.uploadedBy, file.uploadedAt],
            projectId: project.id,
            folderId: folder.id,
            fileId,
          });
        });
      });
    }
  });

  const appendWorkflowItems = (records, type, detailLabel) => {
    (records || []).forEach((record) => {
      const workflowItemId = clean(record.id);
      if (!workflowItemId || !visibleProjectIds.has(record.projectId)) return;
      const projectName = projectNames.get(record.projectId) || 'Project';
      const number = clean(record.number);
      const date = clean(record.date || record.dueDate);
      const label = clean(record.title) || (type === 'daily-log' && date ? `Daily log · ${date}` : detailLabel);
      items.push({
        id: `${type}:${record.projectId}:${workflowItemId}`,
        type,
        label,
        meta: [projectName, number, date, clean(record.status)].filter(Boolean).join(' · '),
        keywords: [
          label, number, projectName, record.status, record.date, record.dueDate, record.category, record.priority,
          record.responsibleName, record.subcontractorName, record.reviewer, record.weather, record.notes,
          record.description, record.question, record.response, record.specSection, record.delays, record.issues,
          ...(Array.isArray(record.subcontractorWork)
            ? record.subcontractorWork.flatMap((entry) => [entry?.subcontractorName, entry?.company, entry?.workPerformed])
            : []),
        ],
        projectId: record.projectId,
        workflowItemId,
      });
    });
  };
  appendWorkflowItems(dailyLogs, 'daily-log', 'Daily log');
  appendWorkflowItems(rfis, 'rfi', 'RFI');
  appendWorkflowItems(submittals, 'submittal', 'Submittal');
  appendWorkflowItems(warrantyItems, 'warranty', 'Warranty item');
  appendWorkflowItems(closeoutItems, 'closeout', 'Closeout item');

  if (includeTasks) {
    tasks.forEach((task) => {
      if (task.projectId && !visibleProjectIds.has(task.projectId)) return;
      const projectName = task.projectId ? projectNames.get(task.projectId) : 'General tasks';
      items.push({
        id: `task:${task.id}`,
        type: 'task',
        label: clean(task.label) || 'Untitled task',
        meta: [projectName, task.due ? `Due ${task.due}` : '', task.done ? 'Complete' : 'Open'].filter(Boolean).join(' · '),
        keywords: [task.label, projectName, task.due, ...(Array.isArray(task.assignees) ? task.assignees : [])],
        taskId: task.id,
        projectId: clean(task.projectId),
      });
    });
  }

  if (includePeople) {
    [
      ...subs.map((person) => ({ person, type: 'sub' })),
      ...employees.map((person) => ({ person, type: personType(person) })),
    ].forEach(({ person, type }) => {
      const label = personAssignmentLabel(person) || clean(person.company) || 'Unnamed person';
      items.push({
        id: `person:${type}:${person.id}`,
        type: 'person',
        label,
        meta: [personTypeLabel(type), clean(person.role), clean(person.email)].filter(Boolean).join(' · '),
        keywords: [label, person.first, person.last, person.company, person.legalName, person.companyType, person.role, person.email, person.phone, person.tags],
        personId: person.id,
        personType: type,
        query: clean(person.company) || clean(`${person.first || ''} ${person.last || ''}`) || label,
      });
    });
  }

  if (includeCertificates) {
    subs.forEach((person) => {
      const label = personAssignmentLabel(person) || clean(person.company) || 'Unnamed subcontractor';
      const certificateTerms = certificateKeywords(person);
      items.push({
        id: `certificate:${person.id}`,
        type: 'certificate',
        label,
        meta: certificateTerms.length ? 'Compliance record' : 'Compliance status',
        keywords: [label, person.company, person.legalName, person.companyType, person.first, person.last, ...certificateTerms],
        subcontractorId: person.id,
      });
    });
  }

  return items;
}

function itemScore(item, normalizedQuery, tokens) {
  const label = normalize(item.label);
  const haystack = [item.label, item.meta, ...(item.keywords || [])].map(normalize).filter(Boolean).join('\n');
  if (!tokens.every((token) => haystack.includes(token))) return Number.POSITIVE_INFINITY;
  if (label === normalizedQuery) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 2;
  return 3;
}

export function searchGlobalItems(items = [], query = '', limit = 12) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return items
    .map((item, index) => ({ item, index, score: itemScore(item, normalizedQuery, tokens) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score
      || left.item.label.localeCompare(right.item.label)
      || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}
