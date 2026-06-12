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

function getHolidayLookup(settings) {
  const lookup = new Set();
  (settings?.holidays || []).forEach((holiday) => {
    if (!holiday?.date || holiday.nonWorkday === false) return;
    const start = parseDateValue(holiday.date);
    const end = parseDateValue(
      holiday.endDate && holiday.endDate >= holiday.date ? holiday.endDate : holiday.date,
    );
    if (!start || !end) return;
    for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
      lookup.add(toIsoDate(day));
    }
  });
  return lookup;
}

function isWorkingDay(date, settings, holidayLookup) {
  const iso = toIsoDate(date);
  if (holidayLookup.has(iso)) return false;
  if (settings?.weekdaysOnly && (date.getDay() === 0 || date.getDay() === 6)) return false;
  return true;
}

export function isOverdue(due, done) {
  if (!due || done) return false;
  const today = new Date().toISOString().slice(0, 10);
  return due < today;
}

export function normalizeStartDate(iso, settings) {
  const parsed = parseDateValue(iso);
  if (!parsed) return '';
  const holidayLookup = getHolidayLookup(settings);
  const cursor = new Date(parsed);
  while (!isWorkingDay(cursor, settings, holidayLookup)) {
    cursor.setDate(cursor.getDate() + 1);
  }
  return toIsoDate(cursor);
}

export function computeStepEndDate(startIso, duration, settings) {
  const start = parseDateValue(startIso);
  if (!start) return '';
  const totalDays = Math.max(1, Number(duration) || 1);
  const holidayLookup = getHolidayLookup(settings);
  let cursor = new Date(start);
  let countedDays = 0;

  while (countedDays < totalDays) {
    if (isWorkingDay(cursor, settings, holidayLookup)) {
      countedDays += 1;
      if (countedDays === totalDays) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return toIsoDate(cursor);
}

function summarizePhaseStatus(phase, fallbackStatus = 'planning') {
  const statuses = (phase.steps || []).map((step) => step.status || (step.done ? 'done' : 'planning'));
  if (!statuses.length) return phase.status || fallbackStatus;
  if (statuses.every((status) => status === 'done')) return 'done';
  if (statuses.some((status) => status === 'delayed')) return 'delayed';
  if (statuses.some((status) => status === 'active')) return 'active';
  return phase.status || fallbackStatus;
}

function syncSinglePhaseDates(phase, projectStatus = 'planning') {
  const datedSteps = (phase.steps || []).filter((step) => step.start || step.end);
  const starts = datedSteps.map((step) => parseDateValue(step.start)).filter(Boolean).sort((a, b) => a - b);
  const ends = datedSteps
    .map((step) => parseDateValue(step.end || step.start))
    .filter(Boolean)
    .sort((a, b) => a - b);

  return {
    ...phase,
    start: starts.length ? toIsoDate(starts[0]) : phase.start || '',
    end: ends.length ? toIsoDate(ends[ends.length - 1]) : phase.end || '',
    status: summarizePhaseStatus(phase, projectStatus || 'planning'),
  };
}

export function syncProjectPhaseDates(project) {
  const phases = (project.phases || []).map((phase) => syncSinglePhaseDates(phase, project.status || 'planning'));

  return {
    ...project,
    phases,
  };
}

export function applyDelayToStep(step, days, settings) {
  const nextDuration = Math.max(1, (Number(step.duration) || 1) + Number(days || 0));
  const nextStep = {
    ...step,
    duration: nextDuration,
  };
  if (nextStep.start) {
    nextStep.end = computeStepEndDate(nextStep.start, nextDuration, settings);
  }
  return nextStep;
}

export function normalizePreds(preds) {
  const source = Array.isArray(preds)
    ? preds
    : typeof preds === 'string'
      ? [{ id: preds, lag: 0 }]
      : preds && typeof preds === 'object'
        ? [preds]
        : [];

  return source
    .map((item) => (typeof item === 'string' ? { id: item, lag: 0 } : item))
    .filter((item) => item?.id);
}

export function addWorkdaysFromSettings(dateStr, count, settings) {
  if (!dateStr) return '';
  let cursor = parseDateValue(dateStr);
  if (!cursor) return '';
  const holidayLookup = getHolidayLookup(settings);
  if (!count) {
    while (!isWorkingDay(cursor, settings, holidayLookup)) {
      cursor = addDays(cursor, 1);
    }
    return toIsoDate(cursor);
  }
  const dir = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  while (remaining > 0) {
    cursor = addDays(cursor, dir);
    if (isWorkingDay(cursor, settings, holidayLookup)) remaining -= 1;
  }
  return toIsoDate(cursor);
}

export function calcStepFirstAvailable(phase, predecessors, settings) {
  const steps = phase.steps || [];
  let latestStart = '';

  normalizePreds(predecessors).forEach(({ id, lag }) => {
    const predecessor = steps.find((step) => step.id === id);
    const predecessorEnd = predecessor?.end || predecessor?.start || '';
    if (!predecessorEnd) return;
    const candidate = addWorkdaysFromSettings(predecessorEnd, 1 + (parseInt(lag, 10) || 0), settings);
    const normalized = normalizeStartDate(candidate, settings);
    if (!latestStart || normalized > latestStart) latestStart = normalized;
  });

  return latestStart || normalizeStartDate(phase.start || toIsoDate(new Date()), settings);
}

export function calcPhaseFirstAvailable(project, predecessors, settings) {
  const phases = project.phases || [];
  let latestStart = '';

  normalizePreds(predecessors).forEach(({ id, lag }) => {
    const predecessor = phases.find((phase) => phase.id === id);
    const predecessorEnd = predecessor?.end || predecessor?.start || '';
    if (!predecessorEnd) return;
    const candidate = addWorkdaysFromSettings(predecessorEnd, 1 + (parseInt(lag, 10) || 0), settings);
    const normalized = normalizeStartDate(candidate, settings);
    if (!latestStart || normalized > latestStart) latestStart = normalized;
  });

  return latestStart;
}

export function syncStepLinks(phase) {
  const validIds = new Set((phase.steps || []).map((step) => step.id));
  const successorMap = new Map();
  (phase.steps || []).forEach((step) => successorMap.set(step.id, []));
  (phase.steps || []).forEach((step) => {
    step.predecessors = normalizePreds(step.predecessors).filter((pred) => validIds.has(pred.id));
    step.predecessors.forEach((pred) => {
      if (!successorMap.has(pred.id)) successorMap.set(pred.id, []);
      successorMap.get(pred.id).push(step.id);
    });
  });
  (phase.steps || []).forEach((step) => {
    step.successors = successorMap.get(step.id) || [];
  });
}

export function wouldCreateCycleFromPreds(phase, fromStepId, toStepId) {
  const successorMap = new Map();
  (phase.steps || []).forEach((step) => successorMap.set(step.id, []));
  (phase.steps || []).forEach((step) => {
    normalizePreds(step.predecessors).forEach((pred) => {
      if (!successorMap.has(pred.id)) successorMap.set(pred.id, []);
      successorMap.get(pred.id).push(step.id);
    });
  });

  const visited = new Set();
  function dfs(stepId) {
    if (stepId === fromStepId) return true;
    if (visited.has(stepId)) return false;
    visited.add(stepId);
    return (successorMap.get(stepId) || []).some((nextId) => dfs(nextId));
  }
  return dfs(toStepId);
}

export function wouldCreatePhaseCycleFromPreds(project, fromPhaseId, toPhaseId) {
  const successorMap = new Map();
  (project.phases || []).forEach((phase) => successorMap.set(phase.id, []));
  (project.phases || []).forEach((phase) => {
    normalizePreds(phase.predecessors).forEach((pred) => {
      if (!successorMap.has(pred.id)) successorMap.set(pred.id, []);
      successorMap.get(pred.id).push(phase.id);
    });
  });

  const visited = new Set();
  function dfs(phaseId) {
    if (phaseId === fromPhaseId) return true;
    if (visited.has(phaseId)) return false;
    visited.add(phaseId);
    return (successorMap.get(phaseId) || []).some((nextId) => dfs(nextId));
  }

  return dfs(toPhaseId);
}

function diffWorkdaysFromSettings(fromIso, toIso, settings) {
  if (!fromIso || !toIso || fromIso === toIso) return 0;
  const start = parseDateValue(fromIso);
  const end = parseDateValue(toIso);
  if (!start || !end) return 0;
  const holidayLookup = getHolidayLookup(settings);
  const dir = start < end ? 1 : -1;
  let cursor = new Date(start);
  let diff = 0;
  while (toIsoDate(cursor) !== toIsoDate(end)) {
    cursor = addDays(cursor, dir);
    if (isWorkingDay(cursor, settings, holidayLookup)) diff += dir;
  }
  return diff;
}

function shiftPhaseByWorkdays(phase, offset, settings) {
  if (!offset) return { ...phase };

  const nextPhase = {
    ...phase,
    steps: (phase.steps || []).map((step) => {
      const nextStart = step.start ? addWorkdaysFromSettings(step.start, offset, settings) : '';
      return {
        ...step,
        start: nextStart,
        end: nextStart ? computeStepEndDate(nextStart, step.duration || 1, settings) : step.end || '',
      };
    }),
  };

  if (!(nextPhase.steps || []).length) {
    nextPhase.start = phase.start ? addWorkdaysFromSettings(phase.start, offset, settings) : phase.start || '';
    nextPhase.end = phase.end ? addWorkdaysFromSettings(phase.end, offset, settings) : nextPhase.start || phase.end || '';
  }

  return nextPhase;
}

export function cascadePhaseDates(project, settings, skipId = null) {
  const phases = project.phases || [];
  if (!phases.length) return project;

  phases.forEach((phase) => {
    phase.predecessors = normalizePreds(phase.predecessors);
  });

  const inDegree = {};
  const adjacency = {};
  phases.forEach((phase) => {
    inDegree[phase.id] = 0;
    adjacency[phase.id] = [];
  });
  phases.forEach((phase) => {
    phase.predecessors.forEach(({ id }) => {
      if (adjacency[id]) adjacency[id].push(phase.id);
      if (inDegree[phase.id] !== undefined) inDegree[phase.id] += 1;
    });
  });

  const queue = phases.filter((phase) => inDegree[phase.id] === 0).map((phase) => phase.id);
  const order = [];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    (adjacency[current] || []).forEach((dependentId) => {
      inDegree[dependentId] -= 1;
      if (inDegree[dependentId] === 0) queue.push(dependentId);
    });
  }

  order.forEach((phaseId) => {
    if (skipId && phaseId === skipId) return;
    const phaseIndex = phases.findIndex((item) => item.id === phaseId);
    const phase = phaseIndex >= 0 ? phases[phaseIndex] : null;
    if (!phase) return;

    const predecessors = normalizePreds(phase.predecessors);
    if (!predecessors.length) {
      phases[phaseIndex] = syncSinglePhaseDates(phase, project.status || 'planning');
      return;
    }

    const requiredStart = calcPhaseFirstAvailable({ ...project, phases }, predecessors, settings);
    const currentStart = phase.start || phase.end || '';
    if (!requiredStart || (currentStart && currentStart >= requiredStart)) {
      phases[phaseIndex] = syncSinglePhaseDates(phase, project.status || 'planning');
      return;
    }

    if (!currentStart) {
      const nextPhase = {
        ...phase,
        start: requiredStart,
        end: phase.end || requiredStart,
      };
      phases[phaseIndex] = syncSinglePhaseDates(nextPhase, project.status || 'planning');
      return;
    }

    const offset = diffWorkdaysFromSettings(currentStart, requiredStart, settings);
    const shiftedPhase = shiftPhaseByWorkdays(phase, offset, settings);
    syncStepLinks(shiftedPhase);
    cascadeStepDates(shiftedPhase, settings);
    phases[phaseIndex] = syncSinglePhaseDates(shiftedPhase, project.status || 'planning');
  });

  return {
    ...project,
    phases,
  };
}

export function cascadeStepDates(phase, settings, skipId = null) {
  const steps = phase.steps || [];
  if (!steps.length) return;
  steps.forEach((step) => {
    step.predecessors = normalizePreds(step.predecessors);
  });

  const inDegree = {};
  const adjacency = {};
  steps.forEach((step) => {
    inDegree[step.id] = 0;
    adjacency[step.id] = [];
  });
  steps.forEach((step) => {
    step.predecessors.forEach(({ id }) => {
      if (adjacency[id]) adjacency[id].push(step.id);
      if (inDegree[step.id] !== undefined) inDegree[step.id] += 1;
    });
  });

  const queue = steps.filter((step) => inDegree[step.id] === 0).map((step) => step.id);
  const order = [];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    (adjacency[current] || []).forEach((dependentId) => {
      inDegree[dependentId] -= 1;
      if (inDegree[dependentId] === 0) queue.push(dependentId);
    });
  }

  order.forEach((stepId) => {
    if (skipId && stepId === skipId) return;
    const step = steps.find((item) => item.id === stepId);
    if (!step) return;
    const predecessors = normalizePreds(step.predecessors);
    if (!predecessors.length) return;
    const requiredStart = calcStepFirstAvailable(phase, predecessors, settings);
    step.start = requiredStart;
    step.end = computeStepEndDate(requiredStart, step.duration || 1, settings);
  });
}

export function syncProjectTasks(projectId, project, tasks) {
  const dueByName = new Map();
  (project.phases || []).forEach((phase) => {
    (phase.steps || []).forEach((step) => {
      const stepName = String(step?.name || '').trim().toLowerCase();
      if (step.end && stepName) dueByName.set(stepName, step.end);
    });
  });
  return tasks.map((task) => {
    if (task.projectId !== projectId) return task;
    const nextDue = dueByName.get(String(task?.label || '').trim().toLowerCase());
    return nextDue ? { ...task, due: nextDue } : task;
  });
}
