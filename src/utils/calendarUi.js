import { useRef } from 'react';

export function formatShortDate(iso) {
  if (!iso) return 'No date';
  const date = new Date(`${iso}T00:00:00`);
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
