function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => ({ ...result, [key]: stableValue(value[key]) }), {});
  }
  return value ?? null;
}

function valuesMatch(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function dependencyValue(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source
    .map((item) => (typeof item === 'string' ? { id: item, lag: 0 } : { id: item?.id || '', lag: Number(item?.lag) || 0 }))
    .filter((item) => item.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function entityLabel(entity, fallback) {
  return String(entity?.name || entity?.label || entity?.itemName || entity?.inspectionType || entity?.subcode || fallback || '').trim();
}

function mapById(items) {
  return new Map((items || []).filter((item) => item?.id).map((item) => [String(item.id), item]));
}

function pushChange(changes, { category, entityType, entityId, entityName, field, label, before, after }) {
  if (valuesMatch(before, after)) return;
  changes.push({ category, entityType, entityId, entityName, field, label, before, after });
}

function compareFields(changes, before, after, context, fields) {
  fields.forEach(({ field, label, category = 'details', value = (item) => item?.[field] ?? '' }) => {
    pushChange(changes, {
      ...context,
      category,
      field,
      label,
      before: value(before),
      after: value(after),
    });
  });
}

function collectProjectFiles(project) {
  const files = [];
  (project?.files?.folders || []).forEach((folder) => {
    (folder.files || []).forEach((file) => files.push({ ...file, location: folder.name || 'Files' }));
  });
  (project?.photos || []).forEach((file) => files.push({ ...file, location: 'Photos' }));
  (project?.selections || []).forEach((selection) => {
    (selection.attachments || []).forEach((file) => files.push({ ...file, location: `Selection: ${entityLabel(selection, 'Selection')}` }));
    (selection.photos || []).forEach((file) => files.push({ ...file, location: `Selection photos: ${entityLabel(selection, 'Selection')}` }));
  });
  (project?.inspections || []).forEach((inspection) => {
    if (inspection.stickerFile) files.push({ ...inspection.stickerFile, location: `Inspection: ${entityLabel(inspection, 'Inspection')}` });
    if (inspection.reportFile) files.push({ ...inspection.reportFile, location: `Inspection: ${entityLabel(inspection, 'Inspection')}` });
  });
  return files;
}

function compareFileLists(changes, beforeFiles, afterFiles, context) {
  const beforeMap = mapById(beforeFiles);
  const afterMap = mapById(afterFiles);
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  ids.forEach((id) => {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);
    const beforeValue = before ? { name: before.name || before.originalName || 'File', location: before.location || 'Attachments' } : null;
    const afterValue = after ? { name: after.name || after.originalName || 'File', location: after.location || 'Attachments' } : null;
    pushChange(changes, {
      ...context,
      category: 'files',
      entityType: 'file',
      entityId: id,
      entityName: afterValue?.name || beforeValue?.name || 'File',
      field: 'file',
      label: !before ? 'File added' : !after ? 'File removed' : 'File updated',
      before: beforeValue,
      after: afterValue,
    });
  });
}

function compareNestedEntities(changes, beforeItems, afterItems, config) {
  const beforeMap = mapById(beforeItems);
  const afterMap = mapById(afterItems);
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  ids.forEach((id) => {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);
    if (!before || !after) return;
    const name = entityLabel(after, entityLabel(before, config.fallback));
    compareFields(changes, before, after, {
      entityType: config.entityType,
      entityId: id,
      entityName: name,
    }, config.fields);
    if (config.children) config.children(changes, before, after);
  });
}

function compareProjectSnapshots(before, after) {
  const changes = [];
  const projectContext = {
    entityType: 'project',
    entityId: after?.id || before?.id || '',
    entityName: entityLabel(after, entityLabel(before, 'Project')),
  };
  compareFields(changes, before, after, projectContext, [
    { field: 'start', label: 'Project start', category: 'dates' },
    { field: 'end', label: 'Project end', category: 'dates' },
    { field: 'status', label: 'Project status', category: 'statuses' },
  ]);

  compareNestedEntities(changes, before?.phases, after?.phases, {
    entityType: 'phase',
    fallback: 'Phase',
    fields: [
      { field: 'start', label: 'Phase start', category: 'dates' },
      { field: 'end', label: 'Phase end', category: 'dates' },
      { field: 'status', label: 'Phase status', category: 'statuses' },
      { field: 'predecessors', label: 'Phase dependencies', category: 'dependencies', value: (item) => dependencyValue(item?.predecessors) },
    ],
    children: (target, beforePhase, afterPhase) => compareNestedEntities(target, beforePhase.steps, afterPhase.steps, {
      entityType: 'step',
      fallback: 'Step',
      fields: [
        { field: 'start', label: 'Step start', category: 'dates' },
        { field: 'end', label: 'Step end', category: 'dates' },
        { field: 'status', label: 'Step status', category: 'statuses', value: (item) => item?.status || (item?.done ? 'done' : 'planning') },
        { field: 'predecessors', label: 'Step dependencies', category: 'dependencies', value: (item) => dependencyValue(item?.predecessors) },
      ],
    }),
  });

  compareNestedEntities(changes, before?.inspections, after?.inspections, {
    entityType: 'inspection',
    fallback: 'Inspection',
    fields: [
      { field: 'date', label: 'Inspection date', category: 'dates' },
      { field: 'status', label: 'Inspection status', category: 'statuses' },
    ],
  });
  compareNestedEntities(changes, before?.selections, after?.selections, {
    entityType: 'selection',
    fallback: 'Selection',
    fields: [
      { field: 'selectionDate', label: 'Selection date', category: 'dates' },
      { field: 'status', label: 'Selection status', category: 'statuses' },
    ],
  });
  compareFileLists(changes, collectProjectFiles(before), collectProjectFiles(after), projectContext);
  return changes;
}

function compareTaskSnapshots(before, after) {
  const changes = [];
  const context = {
    entityType: 'task',
    entityId: after?.id || before?.id || '',
    entityName: entityLabel(after, entityLabel(before, 'Task')),
  };
  compareFields(changes, before, after, context, [
    { field: 'due', label: 'Task due date', category: 'dates' },
    { field: 'done', label: 'Task status', category: 'statuses', value: (item) => (item?.done ? 'complete' : 'open') },
  ]);
  compareFileLists(changes, before?.attachments, after?.attachments, context);
  return changes;
}

export function expandAuditEvent(row) {
  const before = row?.before_data || null;
  const after = row?.after_data || null;
  let changes = [];
  if (row?.action === 'update') {
    changes = row.entity_type === 'project'
      ? compareProjectSnapshots(before, after)
      : row.entity_type === 'task'
        ? compareTaskSnapshots(before, after)
        : [];
  }
  if (!changes.length) {
    const name = entityLabel(after, entityLabel(before, row?.entity_type || 'Item'));
    changes = [{
      category: 'activity',
      entityType: row?.entity_type || 'item',
      entityId: row?.entity_id || after?.id || before?.id || '',
      entityName: name,
      field: '',
      label: row?.action === 'insert' ? 'Created' : row?.action === 'delete' ? 'Deleted' : 'Updated',
      before: row?.action === 'delete' ? name : null,
      after: row?.action === 'insert' ? name : null,
    }];
  }
  return changes.map((change, index) => ({
    ...change,
    id: `${row.id}-${index}`,
    eventId: row.id,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id || '',
    actorEmail: row.actor_email || '',
    projectId: row.project_id || after?.projectId || before?.projectId || after?.id || before?.id || '',
    action: row.action || 'update',
  }));
}

export function buildAuditTrailEntries(rows) {
  return (rows || []).flatMap(expandAuditEvent);
}

export function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    return value.map((item) => typeof item === 'object' ? `${item.id}${item.lag ? ` (+${item.lag}d)` : ''}` : String(item)).join(', ');
  }
  if (typeof value === 'object') return value.name ? `${value.name}${value.location ? ` (${value.location})` : ''}` : JSON.stringify(value);
  return String(value);
}
