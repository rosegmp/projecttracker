const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value) {
  return String(value || '').trim();
}

function parseIsoDay(value) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateOffset(value, anchor) {
  const timestamp = parseIsoDay(value);
  const anchorTimestamp = parseIsoDay(anchor);
  if (timestamp === null || anchorTimestamp === null) return null;
  return Math.round((timestamp - anchorTimestamp) / DAY_MS);
}

function dateFromOffset(anchor, offset) {
  const anchorTimestamp = parseIsoDay(anchor);
  if (anchorTimestamp === null || !Number.isInteger(offset)) return '';
  return new Date(anchorTimestamp + (offset * DAY_MS)).toISOString().slice(0, 10);
}

function uniqueNames(values) {
  const names = new Map();
  (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value).replace(/\s+/g, ' '))
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLocaleLowerCase();
      if (!names.has(key)) names.set(key, value);
    });
  return Array.from(names.values());
}

function findScheduleAnchor(project, details = {}) {
  if (parseIsoDay(project?.start) !== null) return project.start;
  const dates = [];
  (project?.phases || []).forEach((phase) => {
    [phase?.start, phase?.end].forEach((value) => {
      if (parseIsoDay(value) !== null) dates.push(value);
    });
    (phase?.steps || []).forEach((step) => {
      [step?.start, step?.end].forEach((value) => {
        if (parseIsoDay(value) !== null) dates.push(value);
      });
    });
  });
  (project?.inspections || []).forEach((inspection) => {
    if (parseIsoDay(inspection?.date) !== null) dates.push(inspection.date);
  });
  (details.tasks || []).forEach((task) => {
    if (parseIsoDay(task?.due) !== null) dates.push(task.due);
  });
  (details.closeoutItems || []).forEach((item) => {
    if (parseIsoDay(item?.dueDate) !== null) dates.push(item.dueDate);
  });
  return dates.sort()[0] || '';
}

function normalizeTemplatePredecessors(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => typeof item === 'string' ? { id: item, lag: 0 } : item)
    .filter((item) => cleanText(item?.id))
    .map((item) => ({
      id: cleanText(item.id),
      lag: Number(item.lag) || 0,
      ...(item.type === 'inspection' ? { type: 'inspection' } : {}),
    }));
}

export function normalizeProjectTemplate(template, index = 0) {
  const phases = (Array.isArray(template?.phases) ? template.phases : []).map((phase, phaseIndex) => ({
    id: cleanText(phase?.id) || `template-phase-${phaseIndex + 1}`,
    name: cleanText(phase?.name),
    assignees: uniqueNames(phase?.assignees || (phase?.assign ? [phase.assign] : [])),
    startOffset: Number.isInteger(phase?.startOffset) ? phase.startOffset : null,
    endOffset: Number.isInteger(phase?.endOffset) ? phase.endOffset : null,
    predecessors: normalizeTemplatePredecessors(phase?.predecessors),
    steps: (Array.isArray(phase?.steps) ? phase.steps : []).map((step, stepIndex) => ({
      id: cleanText(step?.id) || `template-step-${phaseIndex + 1}-${stepIndex + 1}`,
      name: cleanText(step?.name),
      assignees: uniqueNames(step?.assignees || (step?.assign ? [step.assign] : [])),
      startOffset: Number.isInteger(step?.startOffset) ? step.startOffset : null,
      endOffset: Number.isInteger(step?.endOffset) ? step.endOffset : null,
      predecessors: normalizeTemplatePredecessors(step?.predecessors),
    })).filter((step) => step.name),
  })).filter((phase) => phase.name);
  return {
    id: cleanText(template?.id) || `project-template-${Date.now()}-${index}`,
    name: cleanText(template?.name) || `Project template ${index + 1}`,
    description: cleanText(template?.description),
    sourceProjectName: cleanText(template?.sourceProjectName),
    createdAt: cleanText(template?.createdAt),
    locations: uniqueNames(template?.locations),
    folders: (Array.isArray(template?.folders) ? template.folders : [])
      .map((folder) => ({
        name: cleanText(folder?.name),
        customerVisible: folder?.customerVisible !== false,
        subcontractorVisible: folder?.subcontractorVisible === true,
      }))
      .filter((folder) => folder.name),
    phases,
    inspections: (Array.isArray(template?.inspections) ? template.inspections : [])
      .map((inspection, inspectionIndex) => ({
        id: cleanText(inspection?.id) || `template-inspection-${inspectionIndex + 1}`,
        subcode: cleanText(inspection?.subcode),
        inspectionType: cleanText(inspection?.inspectionType),
        agency: cleanText(inspection?.agency),
        dateOffset: Number.isInteger(inspection?.dateOffset) ? inspection.dateOffset : null,
      }))
      .filter((inspection) => inspection.subcode || inspection.inspectionType),
    tasks: (Array.isArray(template?.tasks) ? template.tasks : [])
      .map((task, taskIndex) => ({
        id: cleanText(task?.id) || `template-task-${taskIndex + 1}`,
        label: cleanText(task?.label),
        location: cleanText(task?.location).replace(/\s+/g, ' '),
        assignees: uniqueNames(task?.assignees || (task?.assignee ? [task.assignee] : [])),
        dueOffset: Number.isInteger(task?.dueOffset) ? task.dueOffset : null,
      }))
      .filter((task) => task.label)
      .slice(0, 250),
    closeoutItems: (Array.isArray(template?.closeoutItems) ? template.closeoutItems : [])
      .map((item, itemIndex) => ({
        id: cleanText(item?.id) || `template-closeout-${itemIndex + 1}`,
        title: cleanText(item?.title),
        category: cleanText(item?.category) || 'Other',
        required: item?.required !== false,
        responsibleId: cleanText(item?.responsibleId),
        responsibleName: cleanText(item?.responsibleName),
        dueOffset: Number.isInteger(item?.dueOffset) ? item.dueOffset : null,
        description: cleanText(item?.description),
        notes: cleanText(item?.notes),
      }))
      .filter((item) => item.title)
      .slice(0, 250),
  };
}

export function normalizeProjectTemplates(value) {
  return (Array.isArray(value) ? value : []).map(normalizeProjectTemplate).slice(0, 50);
}

export function buildProjectTemplate(project, details = {}) {
  const anchor = findScheduleAnchor(project, details);
  return normalizeProjectTemplate({
    id: details.id || `project-template-${Date.now()}`,
    name: details.name,
    description: details.description,
    sourceProjectName: project?.name,
    createdAt: new Date().toISOString(),
    locations: project?.locations,
    folders: (project?.files?.folders || []).map((folder) => ({
      name: folder.name,
      customerVisible: folder.customerVisible !== false,
      subcontractorVisible: folder.subcontractorVisible === true,
    })),
    phases: (project?.phases || []).map((phase) => ({
      id: phase.id,
      name: phase.name,
      assignees: phase.assignees || (phase.assign ? [phase.assign] : []),
      startOffset: dateOffset(phase.start, anchor),
      endOffset: dateOffset(phase.end, anchor),
      predecessors: phase.predecessors,
      steps: (phase.steps || []).map((step) => ({
        id: step.id,
        name: step.name,
        assignees: step.assignees || (step.assign ? [step.assign] : []),
        startOffset: dateOffset(step.start, anchor),
        endOffset: dateOffset(step.end, anchor),
        predecessors: step.predecessors,
      })),
    })),
    inspections: (project?.inspections || []).map((inspection) => ({
      id: inspection.id,
      subcode: inspection.subcode,
      inspectionType: inspection.inspectionType,
      agency: inspection.agency,
      dateOffset: dateOffset(inspection.date, anchor),
    })),
    tasks: (details.tasks || [])
      .filter((task) => task?.done !== true)
      .map((task) => ({
        id: task.id,
        label: task.label,
        location: task.location,
        assignees: task.assignees || (task.assignee ? [task.assignee] : []),
        dueOffset: dateOffset(task.due, anchor),
      })),
    closeoutItems: (details.closeoutItems || [])
      .filter((item) => item?.status !== 'not_applicable')
      .map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        required: item.required !== false,
        responsibleId: item.responsibleId,
        responsibleName: item.responsibleName,
        dueOffset: dateOffset(item.dueDate, anchor),
        description: item.description,
        notes: item.notes,
      })),
  });
}

function defaultIdFactory(kind, sourceId, index) {
  if (globalThis.crypto?.randomUUID) return `${kind}-${globalThis.crypto.randomUUID()}`;
  return `${kind}-${Date.now()}-${index}-${cleanText(sourceId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

export function applyProjectTemplate(templateValue, projectStart = '', idFactory = defaultIdFactory) {
  const template = normalizeProjectTemplate(templateValue);
  const phaseIdMap = new Map();
  const stepIdMap = new Map();
  const inspectionIdMap = new Map();
  template.phases.forEach((phase, phaseIndex) => {
    phaseIdMap.set(phase.id, idFactory('phase', phase.id, phaseIndex));
    phase.steps.forEach((step, stepIndex) => {
      stepIdMap.set(step.id, idFactory('step', step.id, (phaseIndex * 1000) + stepIndex));
    });
  });
  template.inspections.forEach((inspection, inspectionIndex) => {
    inspectionIdMap.set(inspection.id, idFactory('inspection', inspection.id, inspectionIndex));
  });
  const mapPhasePreds = (items) => items
    .map((pred) => ({ id: phaseIdMap.get(pred.id) || '', lag: pred.lag || 0 }))
    .filter((pred) => pred.id);
  const mapStepPreds = (items) => items
    .map((pred) => pred.type === 'inspection'
      ? { id: inspectionIdMap.get(pred.id) || '', lag: pred.lag || 0, type: 'inspection' }
      : { id: stepIdMap.get(pred.id) || '', lag: pred.lag || 0 })
    .filter((pred) => pred.id);
  const phases = template.phases.map((phase) => {
    const steps = phase.steps.map((step) => ({
      id: stepIdMap.get(step.id),
      name: step.name,
      assignees: step.assignees,
      assign: step.assignees[0] || '',
      status: 'scheduled',
      start: dateFromOffset(projectStart, step.startOffset),
      end: dateFromOffset(projectStart, step.endOffset),
      predecessors: mapStepPreds(step.predecessors),
      successors: [],
      delays: [],
    }));
    const successorMap = new Map(steps.map((step) => [step.id, []]));
    steps.forEach((step) => step.predecessors.forEach((pred) => successorMap.get(pred.id)?.push(step.id)));
    return {
      id: phaseIdMap.get(phase.id),
      name: phase.name,
      assignees: phase.assignees,
      assign: phase.assignees[0] || '',
      status: 'planning',
      start: dateFromOffset(projectStart, phase.startOffset),
      end: dateFromOffset(projectStart, phase.endOffset),
      predecessors: mapPhasePreds(phase.predecessors),
      delays: [],
      steps: steps.map((step) => ({ ...step, successors: successorMap.get(step.id) || [] })),
    };
  });
  const maximumOffset = [
    ...template.phases.flatMap((phase) => [phase.endOffset, ...phase.steps.map((step) => step.endOffset)]),
    ...template.inspections.map((inspection) => inspection.dateOffset),
    ...template.tasks.map((task) => task.dueOffset),
    ...template.closeoutItems.map((item) => item.dueOffset),
  ].filter(Number.isInteger).reduce((maximum, value) => Math.max(maximum, value), 0);
  return {
    phases,
    locations: template.locations,
    files: {
      folders: template.folders.map((folder, index) => ({
        id: idFactory('folder', folder.name, index),
        ...folder,
        files: [],
      })),
    },
    inspections: template.inspections.map((inspection) => ({
      id: inspectionIdMap.get(inspection.id),
      subcode: inspection.subcode,
      inspectionType: inspection.inspectionType,
      agency: inspection.agency,
      date: dateFromOffset(projectStart, inspection.dateOffset),
      status: 'requested',
      notes: '',
      stickerFile: null,
      reportFile: null,
    })),
    tasks: template.tasks.map((task, index) => ({
      id: idFactory('task', task.id, index),
      label: task.label,
      projectId: '',
      location: task.location,
      done: false,
      due: dateFromOffset(projectStart, task.dueOffset),
      assignees: task.assignees,
      assignee: task.assignees[0] || '',
      sourceSelectionId: '',
      sourceSelectionProjectId: '',
      sourceSelectionLabel: '',
      attachments: [],
    })),
    closeoutItems: template.closeoutItems.map((item, index) => ({
      id: idFactory('closeout', item.id, index),
      number: `CLS-${String(index + 1).padStart(3, '0')}`,
      title: item.title,
      status: 'not_started',
      category: item.category,
      required: item.required,
      responsibleId: item.responsibleId,
      responsibleName: item.responsibleName,
      dueDate: dateFromOffset(projectStart, item.dueOffset),
      completedDate: '',
      description: item.description,
      notes: item.notes,
      attachments: [],
      deletedAttachments: [],
    })),
    suggestedEnd: dateFromOffset(projectStart, maximumOffset),
  };
}
