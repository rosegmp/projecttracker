import { useRef } from 'react';

export function formatShortDate(iso) {
  if (!iso) return 'No date';
  const value = String(iso).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatTooltipDate(iso) {
  if (!iso) return 'No date';
  const date = new Date(`${iso}T00:00:00`);
  const month = new Intl.DateTimeFormat('en-US', { month: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(date);
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(date);
  return `${month}/${day}/${year}`;
}

export function formatHebrewCalendarLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-hebrew', { month: 'short', day: 'numeric' });
  const parts = formatter.formatToParts(date);
  const dayPart = parts.find((part) => part.type === 'day')?.value || '';
  const monthPart = parts.find((part) => part.type === 'month')?.value || '';
  return dayPart && monthPart ? `${dayPart} ${monthPart}` : formatter.format(date);
}

export function getProjectAccentColor(seed) {
  const text = String(seed || 'project');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360;
  return `hsl(${hash} 60% 42%)`;
}

export function splitStepBarAroundBlockedDays(item, weekCells) {
  if (!['step', 'phase'].includes(item.type)) return [{ ...item, segmentKey: `${item.id}-${item.startCol}-${item.endCol}` }];
  const segments = [];
  let currentStart = null;
  for (let column = item.startCol; column <= item.endCol; column += 1) {
    const cell = weekCells[column];
    const blocked = !cell || cell.isWeekend || cell.holidays.length > 0;
    if (!blocked) {
      if (currentStart === null) currentStart = column;
      continue;
    }
    if (currentStart !== null) {
      segments.push({ ...item, startCol: currentStart, endCol: column - 1, segmentKey: `${item.id}-${currentStart}-${column - 1}`, continuesBefore: (item.continuesBefore && currentStart === item.startCol) || currentStart > item.startCol, continuesAfter: true });
      currentStart = null;
    }
  }
  if (currentStart !== null) {
    segments.push({ ...item, startCol: currentStart, endCol: item.endCol, segmentKey: `${item.id}-${currentStart}-${item.endCol}`, continuesBefore: (item.continuesBefore && currentStart === item.startCol) || currentStart > item.startCol, continuesAfter: item.continuesAfter });
  }
  return segments;
}

export function getCalendarWeekLayout(
  week,
  {
    visibleRangeLanes = 3,
    collapsedWeekHeight = 244,
    collapsedBodyMinHeight = 32,
  } = {},
) {
  const allScheduleBars = week.scheduledBars || week.bars;
  const holidayBars = week.holidayBars || [];
  const collapsedLaneBudget = Math.max(
    0,
    Math.floor(
      (collapsedWeekHeight -
        30 -
        week.holidayLaneCount * 28 -
        collapsedBodyMinHeight -
        (week.laneCount > 0 ? 20 : 0)) /
        24,
    ),
  );
  const collapsedVisibleLaneCount = Math.min(
    week.laneCount,
    Math.max(visibleRangeLanes, collapsedLaneBudget),
  );
  const scheduleBars = week.isExpanded
    ? allScheduleBars
    : allScheduleBars.filter((item) => item.lane < collapsedVisibleLaneCount);
  const hiddenScheduledBarCount = Math.max(0, allScheduleBars.length - scheduleBars.length);
  const renderableScheduleBars = scheduleBars.flatMap((item) =>
    splitStepBarAroundBlockedDays(item, week.cells),
  );
  const visibleLaneCount = week.isExpanded ? week.laneCount : collapsedVisibleLaneCount;
  const baseSpanOffset = 30 + visibleLaneCount * 24 + (!week.isExpanded && hiddenScheduledBarCount ? 20 : 0);
  const holidayTop = baseSpanOffset;
  const spanOffset = holidayTop + week.holidayLaneCount * 28;
  const provisionalAvailableBodyHeight = Math.max(0, collapsedWeekHeight - spanOffset - 10);
  const maxVisibleDayItems = Math.max(0, Math.floor((provisionalAvailableBodyHeight + 6) / 42));
  const weekBodyContentHeight = week.cells.reduce((maxHeight, cell) => {
    const visibleCount = Math.min(cell.items.length, maxVisibleDayItems);
    const hiddenCount = Math.max(0, cell.items.length - visibleCount);
    const visibleHeight = visibleCount > 0 ? visibleCount * 36 + Math.max(0, visibleCount - 1) * 6 : 0;
    const overflowHeight = hiddenCount > 0 ? 18 : 0;
    const gapHeight = visibleHeight > 0 && overflowHeight > 0 ? 6 : 0;
    return Math.max(maxHeight, visibleHeight + gapHeight + overflowHeight);
  }, 0);
  const cellHeight = week.isExpanded
    ? Math.max(168, spanOffset + weekBodyContentHeight + 10)
    : Math.max(spanOffset + 10, spanOffset + weekBodyContentHeight + 10);

  return {
    holidayBars,
    collapsedVisibleLaneCount,
    hiddenScheduledBarCount,
    renderableScheduleBars,
    visibleLaneCount,
    holidayTop,
    spanOffset,
    maxVisibleDayItems,
    cellHeight,
  };
}

export function toIsoDate(date) { return date.toISOString().slice(0, 10); }
export function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
export function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }
export function diffInDays(start, end) { return Math.round((end - start) / 86400000); }
export function startOfWeek(date) { const result = new Date(date); result.setDate(result.getDate() - result.getDay()); return result; }
export function endOfWeek(date) { const result = startOfWeek(date); result.setDate(result.getDate() + 6); return result; }
export function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }

export function enumerateMonths(start, end) {
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) { months.push(new Date(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
  return months;
}

export function useHorizontalSwipe(onSwipeLeft, onSwipeRight, { minDistance = 56, maxOffAxis = 72 } = {}) {
  const touchStateRef = useRef(null);
  return {
    onTouchStart(event) {
      const touch = event.touches?.[0];
      if (touch) touchStateRef.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd(event) {
      const start = touchStateRef.current;
      touchStateRef.current = null;
      const touch = event.changedTouches?.[0];
      if (!start || !touch) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX < minDistance || absY > maxOffAxis || absX <= absY) return;
      if (deltaX < 0) onSwipeLeft?.(); else onSwipeRight?.();
    },
  };
}
