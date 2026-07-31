export const STEP_STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning', icon: 'clock' },
  { value: 'active', label: 'Active', icon: 'play' },
  { value: 'delayed', label: 'Delayed', icon: 'warning' },
  { value: 'done', label: 'Done', icon: 'checkCircle' },
];

export function normalizeStepStatus(status, done = false) {
  if (done) return 'done';
  return STEP_STATUS_OPTIONS.some((option) => option.value === status) ? status : 'planning';
}

export function getStepStatusOption(status, done = false) {
  const normalizedStatus = normalizeStepStatus(status, done);
  return STEP_STATUS_OPTIONS.find((option) => option.value === normalizedStatus) || STEP_STATUS_OPTIONS[0];
}
