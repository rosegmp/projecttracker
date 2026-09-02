const STATUS_ORDER = ['requested', 'scheduled', 'failed', 'follow-up', 'passed', 'cancelled'];

export const INSPECTION_GROUP_OPTIONS = ['none', 'project', 'status', 'type', 'agency'];
export const INSPECTION_SORT_OPTIONS = ['date-asc', 'date-desc', 'type', 'status', 'project', 'agency'];

function clean(value) {
  return String(value || '').trim();
}

function inspectionLabel(inspection) {
  return clean(inspection?.inspectionType || inspection?.subcode) || 'Inspection';
}

function compareText(left, right) {
  return clean(left).localeCompare(clean(right), undefined, { numeric: true, sensitivity: 'base' });
}

function compareOptionalText(left, right) {
  const leftValue = clean(left);
  const rightValue = clean(right);
  if (!leftValue && rightValue) return 1;
  if (leftValue && !rightValue) return -1;
  return compareText(leftValue, rightValue);
}

function compareDates(left, right, descending = false) {
  const leftDate = clean(left);
  const rightDate = clean(right);
  if (!leftDate && rightDate) return 1;
  if (leftDate && !rightDate) return -1;
  const comparison = leftDate.localeCompare(rightDate);
  return descending ? -comparison : comparison;
}

function statusRank(status) {
  const index = STATUS_ORDER.indexOf(clean(status).toLowerCase());
  return index === -1 ? STATUS_ORDER.length : index;
}

function compareByDateThenLabel(left, right, descending = false) {
  return compareDates(left?.date, right?.date, descending)
    || compareText(inspectionLabel(left), inspectionLabel(right));
}

export function sortInspections(inspections = [], sortBy = 'date-desc') {
  const effectiveSort = INSPECTION_SORT_OPTIONS.includes(sortBy) ? sortBy : 'date-desc';
  return [...(Array.isArray(inspections) ? inspections : [])].sort((left, right) => {
    if (effectiveSort === 'date-desc') return compareByDateThenLabel(left, right, true);
    if (effectiveSort === 'type') {
      return compareText(inspectionLabel(left), inspectionLabel(right)) || compareDates(left?.date, right?.date);
    }
    if (effectiveSort === 'status') {
      return statusRank(left?.status) - statusRank(right?.status) || compareByDateThenLabel(left, right);
    }
    if (effectiveSort === 'project') {
      return compareOptionalText(left?.projectName, right?.projectName) || compareByDateThenLabel(left, right);
    }
    if (effectiveSort === 'agency') {
      return compareOptionalText(left?.agency, right?.agency) || compareByDateThenLabel(left, right);
    }
    return compareByDateThenLabel(left, right);
  });
}

function groupValue(inspection, groupBy) {
  if (groupBy === 'project') return clean(inspection?.projectName) || 'No project';
  if (groupBy === 'status') {
    const status = clean(inspection?.status).toLowerCase();
    return status ? status.replace(/(^|[-\s])\S/g, (letter) => letter.toUpperCase()) : 'No status';
  }
  if (groupBy === 'type') return inspectionLabel(inspection);
  if (groupBy === 'agency') return clean(inspection?.agency) || 'No agency';
  return '';
}

export function groupInspections(inspections = [], groupBy = 'none') {
  const source = Array.isArray(inspections) ? inspections : [];
  if (!INSPECTION_GROUP_OPTIONS.includes(groupBy) || groupBy === 'none') {
    return [{ key: 'all', label: '', inspections: source }];
  }

  const groups = [];
  const groupsByLabel = new Map();
  source.forEach((inspection) => {
    const label = groupValue(inspection, groupBy);
    const key = label.toLocaleLowerCase();
    let group = groupsByLabel.get(key);
    if (!group) {
      group = { key: `${groupBy}:${key}`, label, inspections: [] };
      groupsByLabel.set(key, group);
      groups.push(group);
    }
    group.inspections.push(inspection);
  });
  groups.sort((left, right) => {
    if (groupBy === 'status') return statusRank(left.label) - statusRank(right.label);
    const leftMissing = left.label.startsWith('No ');
    const rightMissing = right.label.startsWith('No ');
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    return compareText(left.label, right.label);
  });
  return groups;
}
