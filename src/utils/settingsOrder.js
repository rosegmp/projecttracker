export function reorderSettingIds(values, sourceId, targetId, position = 'before', options = {}) {
  const current = Array.isArray(values) ? [...values] : [];
  const pinnedFirstId = String(options.pinnedFirstId || '');
  if (!sourceId || !targetId || sourceId === targetId || sourceId === pinnedFirstId) return current;
  if (!current.includes(sourceId) || !current.includes(targetId)) return current;

  const next = current.filter((id) => id !== sourceId);
  let targetIndex = next.indexOf(targetId);
  if (position === 'after') targetIndex += 1;
  if (pinnedFirstId && next[0] === pinnedFirstId) targetIndex = Math.max(1, targetIndex);
  next.splice(Math.min(Math.max(targetIndex, 0), next.length), 0, sourceId);
  return next;
}
