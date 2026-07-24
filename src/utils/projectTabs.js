export const PROJECT_TAB_DEFS = [
  { id: 'overview', label: 'Overview', description: 'Project summary, progress, contacts, and recent activity.', required: true },
  { id: 'portal', label: 'Portal', description: 'Customer and subcontractor updates and responses.', required: true },
  { id: 'tasks', label: 'Tasks', description: 'Tasks assigned within this project.' },
  { id: 'calendar', label: 'Calendar', description: 'Project schedule, milestones, and inspections.' },
  { id: 'inspections', label: 'Inspections', description: 'Inspection scheduling, results, stickers, and reports.' },
  { id: 'selections', label: 'Selections', description: 'Customer selections, approvals, photos, and attachments.' },
  { id: 'daily-logs', label: 'Daily Logs', description: 'Jobsite conditions, subcontractor work, deliveries, and notes.' },
  { id: 'change-orders', label: 'Change Orders', description: 'Scope, cost, schedule, and approval changes.' },
  { id: 'rfis-submittals', label: 'RFIs & Submittals', description: 'Requests for information and submittal reviews.' },
  { id: 'budget-commitments', label: 'Budget & Commitments', description: 'Budget items, commitments, and invoices.' },
  { id: 'warranty-closeout', label: 'Warranty & Closeout', description: 'Warranty requests and project closeout requirements.' },
  { id: 'takeoff', label: 'Takeoff', description: 'Project PDF measurements, markups, and quantities.' },
  { id: 'files', label: 'Files', description: 'Project folders and shared documents.' },
  { id: 'photos', label: 'Photos', description: 'Unified project and workflow photo gallery.' },
];

export const DEFAULT_VISIBLE_PROJECT_TABS = PROJECT_TAB_DEFS.map((tab) => tab.id);

const CUSTOMER_PROJECT_TABS = new Set([
  'overview',
  'portal',
  'calendar',
  'selections',
  'warranty-closeout',
  'files',
  'photos',
]);
const SUBCONTRACTOR_PROJECT_TABS = new Set(['portal', 'selections', 'files']);

export function normalizeVisibleProjectTabs(value) {
  const requested = Array.isArray(value) ? new Set(value.map((tabId) => String(tabId || '').trim())) : null;
  return PROJECT_TAB_DEFS
    .filter((tab) => tab.required || !requested || requested.has(tab.id))
    .map((tab) => tab.id);
}

export function getVisibleProjectTabs(value, role = '') {
  const configured = new Set(normalizeVisibleProjectTabs(value));
  const roleAllowlist =
    role === 'Customer'
      ? CUSTOMER_PROJECT_TABS
      : role === 'Subcontractor'
        ? SUBCONTRACTOR_PROJECT_TABS
        : null;
  return PROJECT_TAB_DEFS.filter((tab) => configured.has(tab.id) && (!roleAllowlist || roleAllowlist.has(tab.id)));
}
