export const MAX_PINNED_PROJECT_SECTIONS = 10;
export const MAX_RECENT_PROJECT_SECTIONS = 3;

const INTERNAL_DEFAULTS = ['overview', 'tasks', 'calendar', 'daily-logs', 'files', 'photos'];
const CUSTOMER_DEFAULTS = ['overview', 'portal', 'calendar', 'selections'];
const SUBCONTRACTOR_DEFAULTS = ['portal', 'selections', 'files'];

function cleanId(value) {
  return String(value || '').trim();
}

function uniqueKnownIds(values, knownIds) {
  const ids = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const id = cleanId(value);
    if (!id || !knownIds.has(id) || ids.includes(id)) return;
    ids.push(id);
  });
  return ids;
}

function defaultPinnedIds(visibleTabs, role) {
  const visibleIds = new Set((visibleTabs || []).map((tab) => tab.id));
  const defaults = role === 'Customer'
    ? CUSTOMER_DEFAULTS
    : role === 'Subcontractor'
      ? SUBCONTRACTOR_DEFAULTS
      : INTERNAL_DEFAULTS;
  const defaultIds = new Set(defaults.filter((id) => visibleIds.has(id)));
  const pinnedIds = (visibleTabs || [])
    .map((tab) => tab.id)
    .filter((id) => defaultIds.has(id))
    .slice(0, MAX_PINNED_PROJECT_SECTIONS);
  if (!pinnedIds.length && visibleTabs?.[0]?.id) pinnedIds.push(visibleTabs[0].id);
  return pinnedIds;
}

export function projectNavigationStorageKey(userId) {
  return `project-tracker:project-navigation:${cleanId(userId) || 'anonymous'}`;
}

export function normalizeProjectNavigationPreferences(value, visibleTabs = [], role = '') {
  const knownIds = new Set(visibleTabs.map((tab) => tab.id));
  const hasSavedPins = Array.isArray(value?.pinnedIds);
  const pinnedIds = (hasSavedPins
    ? uniqueKnownIds(value.pinnedIds, knownIds)
    : defaultPinnedIds(visibleTabs, role)
  ).slice(0, MAX_PINNED_PROJECT_SECTIONS);
  const requiredPrimaryId = visibleTabs.find((tab) => tab.id === 'overview')?.id || visibleTabs[0]?.id || '';
  if (requiredPrimaryId) {
    const existingIndex = pinnedIds.indexOf(requiredPrimaryId);
    if (existingIndex >= 0) pinnedIds.splice(existingIndex, 1);
    pinnedIds.unshift(requiredPrimaryId);
    if (pinnedIds.length > MAX_PINNED_PROJECT_SECTIONS) pinnedIds.pop();
  }
  const recentIds = uniqueKnownIds(value?.recentIds, knownIds).slice(0, MAX_RECENT_PROJECT_SECTIONS);
  return { pinnedIds, recentIds, compactDesktop: value?.compactDesktop === true };
}

export function loadProjectNavigationPreferences(userId, visibleTabs = [], role = '', storage = globalThis?.localStorage) {
  let value = null;
  try {
    value = JSON.parse(storage?.getItem(projectNavigationStorageKey(userId)) || 'null');
  } catch {
    value = null;
  }
  return normalizeProjectNavigationPreferences(value, visibleTabs, role);
}

export function saveProjectNavigationPreferences(userId, value, visibleTabs = [], role = '', storage = globalThis?.localStorage) {
  const normalized = normalizeProjectNavigationPreferences(value, visibleTabs, role);
  try {
    storage?.setItem(projectNavigationStorageKey(userId), JSON.stringify(normalized));
  } catch {
    // Keep navigation available when device storage is unavailable.
  }
  return normalized;
}

export function recordRecentProjectSection(value, tabId, visibleTabs = [], role = '') {
  const normalized = normalizeProjectNavigationPreferences(value, visibleTabs, role);
  const id = cleanId(tabId);
  if (!visibleTabs.some((tab) => tab.id === id)) return normalized;
  return normalizeProjectNavigationPreferences({
    ...normalized,
    recentIds: [id, ...normalized.recentIds.filter((recentId) => recentId !== id)],
  }, visibleTabs, role);
}

export function togglePinnedProjectSection(value, tabId, visibleTabs = [], role = '') {
  const normalized = normalizeProjectNavigationPreferences(value, visibleTabs, role);
  const id = cleanId(tabId);
  const requiredPrimaryId = visibleTabs.find((tab) => tab.id === 'overview')?.id || visibleTabs[0]?.id || '';
  if (!visibleTabs.some((tab) => tab.id === id) || id === requiredPrimaryId) return normalized;
  const pinnedIds = normalized.pinnedIds.includes(id)
    ? normalized.pinnedIds.filter((pinnedId) => pinnedId !== id)
    : normalized.pinnedIds.length < MAX_PINNED_PROJECT_SECTIONS
      ? [...normalized.pinnedIds, id]
      : normalized.pinnedIds;
  return normalizeProjectNavigationPreferences({ ...normalized, pinnedIds }, visibleTabs, role);
}

export function setProjectNavigationCompactMode(value, compactDesktop, visibleTabs = [], role = '') {
  return normalizeProjectNavigationPreferences({ ...value, compactDesktop: compactDesktop === true }, visibleTabs, role);
}

export function buildProjectNavigationModel(visibleTabs = [], preferences = {}, activeTabId = '', role = '') {
  const normalized = normalizeProjectNavigationPreferences(preferences, visibleTabs, role);
  const tabById = new Map(visibleTabs.map((tab) => [tab.id, tab]));
  const primaryTabs = normalized.pinnedIds.map((id) => tabById.get(id)).filter(Boolean);
  const activeTab = tabById.get(cleanId(activeTabId));
  if (activeTab && !primaryTabs.some((tab) => tab.id === activeTab.id)) primaryTabs.push(activeTab);
  const pinnedIds = new Set(normalized.pinnedIds);
  const recentRank = new Map(normalized.recentIds.map((id, index) => [id, index]));
  const moreTabs = visibleTabs
    .filter((tab) => !pinnedIds.has(tab.id))
    .sort((left, right) => {
      const leftRank = recentRank.has(left.id) ? recentRank.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightRank = recentRank.has(right.id) ? recentRank.get(right.id) : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return visibleTabs.indexOf(left) - visibleTabs.indexOf(right);
    });
  return { ...normalized, primaryTabs, moreTabs };
}
