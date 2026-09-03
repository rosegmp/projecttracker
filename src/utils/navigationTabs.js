export const TOP_LEVEL_TAB_DEFS = [
  { id: 'home', label: 'Home', description: 'Portfolio priorities and upcoming work.' },
  { id: 'projects', label: 'Projects', description: 'Project overviews and project workspaces.', required: true },
  { id: 'schedule', label: 'Schedule', description: 'Company-wide project scheduling.' },
  { id: 'calendar', label: 'Calendar', description: 'Calendar events, milestones, and inspections.' },
  { id: 'tasks', label: 'Tasks', description: 'Tasks across visible projects.' },
  { id: 'people', label: 'People', description: 'Customers, subcontractors, employees, and contacts.' },
  { id: 'certificates', label: 'Compliance', description: 'Subcontractor insurance, agreements, and tax documentation.' },
  { id: 'reports', label: 'Reports', description: 'Portfolio schedule, financial, approval, and closeout reporting.', required: true },
  { id: 'settings', label: 'Settings', description: 'Administration and workspace configuration.', required: true },
];

export const DEFAULT_VISIBLE_TOP_LEVEL_TABS = TOP_LEVEL_TAB_DEFS.map((tab) => tab.id);

export function normalizeVisibleTopLevelTabs(value) {
  const requested = Array.isArray(value) ? new Set(value.map((tabId) => String(tabId || '').trim())) : null;
  return TOP_LEVEL_TAB_DEFS
    .filter((tab) => tab.required || !requested || requested.has(tab.id))
    .map((tab) => tab.id);
}
