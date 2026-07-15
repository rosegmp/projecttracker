import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatHebrewCalendarLabel, formatShortDate } from '../utils/calendarUi.js';

function getInitialIndex(days) {
  const todayIndex = days.findIndex((cell) => cell.isToday);
  if (todayIndex >= 0) return todayIndex;
  const currentMonthIndex = days.findIndex((cell) => cell.isCurrentMonth);
  return Math.max(0, currentMonthIndex);
}

function MobileCalendarDayAgenda({
  cell,
  rangeItems,
  showHebrewDates,
  onDateClick,
  onItemClick,
  isRangeItemClickable,
  isDayItemClickable,
  getDayItemSubtitle,
  compactEmpty = false,
}) {
  const holidays = cell?.holidays || [];
  const dayItems = cell?.items || [];

  return (
    <section className={`mobile-calendar-agenda-day${cell.isToday ? ' today' : ''}`} data-date={cell.key}>
      <div className="mobile-calendar-day-heading">
        <div>
          <small>{cell.date.toLocaleDateString('en-US', { weekday: 'long' })}</small>
          <strong>{cell.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
          {showHebrewDates ? <small>{formatHebrewCalendarLabel(cell.date)}</small> : null}
        </div>
        <button className="button secondary" type="button" onClick={(event) => onDateClick?.(cell, event)}>Add</button>
      </div>

      <div className="mobile-calendar-items">
        {holidays.map((holiday) => (
          <div key={`${cell.key}-holiday-${holiday.id}`} className="mobile-calendar-item holiday">
            <strong>{holiday.name || holiday.label}</strong>
            <small>Non-workday</small>
          </div>
        ))}
        {rangeItems.map((item) => {
          const clickable = isRangeItemClickable(item);
          const Tag = clickable ? 'button' : 'div';
          return (
            <Tag
              key={`${cell.key}-range-${item.id}`}
              type={clickable ? 'button' : undefined}
              className={`mobile-calendar-item ${item.type}`}
              onClick={clickable ? (event) => onItemClick?.(item, event) : undefined}
            >
              <span className="mobile-calendar-item-color" style={{ backgroundColor: item.color || undefined }} aria-hidden="true" />
              <span><strong>{item.label}</strong><small>{item.projectName || `${formatShortDate(item.start)} - ${formatShortDate(item.end)}`}</small></span>
            </Tag>
          );
        })}
        {dayItems.map((item) => {
          const clickable = isDayItemClickable(item);
          const Tag = clickable ? 'button' : 'div';
          const subtitle = getDayItemSubtitle(item);
          return (
            <Tag
              key={`${cell.key}-day-${item.id}`}
              type={clickable ? 'button' : undefined}
              className={`mobile-calendar-item ${item.type}`}
              onClick={clickable ? (event) => onItemClick?.(item, event) : undefined}
            >
              <span className="mobile-calendar-item-color" style={{ backgroundColor: item.color || undefined }} aria-hidden="true" />
              <span><strong>{item.label}</strong>{subtitle ? <small>{subtitle}</small> : null}</span>
            </Tag>
          );
        })}
        {!holidays.length && !rangeItems.length && !dayItems.length ? (
          <div className={`mobile-calendar-empty${compactEmpty ? ' compact' : ''}`}>{compactEmpty ? 'No items' : 'Nothing scheduled for this day.'}</div>
        ) : null}
      </div>
    </section>
  );
}

export default function MobileCalendarView({
  calendarWeeks,
  showHebrewDates = false,
  onDateClick,
  onItemClick,
  isRangeItemClickable = () => true,
  isDayItemClickable = () => true,
  getDayItemSubtitle = (item) => item.projectName || '',
  onNavigatePrevious,
  onNavigateNext,
}) {
  const days = useMemo(() => calendarWeeks.flatMap((week) => week.cells), [calendarWeeks]);
  const [viewMode, setViewMode] = useState('week');
  const [selectedIndex, setSelectedIndex] = useState(() => getInitialIndex(days));
  const touchStartX = useRef(null);
  const pendingEdgeDirection = useRef(0);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (pendingEdgeDirection.current) {
        const direction = pendingEdgeDirection.current;
        pendingEdgeDirection.current = 0;
        if (direction < 0) {
          const lastCurrentMonthIndex = days.reduce((last, cell, index) => cell.isCurrentMonth ? index : last, 0);
          return lastCurrentMonthIndex;
        }
        return Math.max(0, days.findIndex((cell) => cell.isCurrentMonth));
      }
      const currentKey = days[current]?.key;
      const retainedIndex = days.findIndex((cell) => cell.key === currentKey);
      return retainedIndex >= 0 && days[retainedIndex]?.isCurrentMonth ? retainedIndex : getInitialIndex(days);
    });
  }, [days]);

  const selectedDay = days[selectedIndex] || days[0];
  const selectedWeekIndex = Math.max(0, Math.floor(selectedIndex / 7));
  const selectedWeek = calendarWeeks[selectedWeekIndex];
  const selectedColumn = selectedIndex % 7;
  const selectedRangeItems = (selectedWeek?.scheduledBars || []).filter(
    (item) => item.startCol <= selectedColumn && item.endCol >= selectedColumn,
  );

  function moveSelection(direction) {
    const amount = viewMode === 'week' ? 7 : 1;
    const target = selectedIndex + direction * amount;
    if (target < 0 && onNavigatePrevious) {
      pendingEdgeDirection.current = -1;
      onNavigatePrevious();
      return;
    }
    if (target >= days.length && onNavigateNext) {
      pendingEdgeDirection.current = 1;
      onNavigateNext();
      return;
    }
    setSelectedIndex(Math.min(days.length - 1, Math.max(0, target)));
  }

  function handleTouchStart(event) {
    event.stopPropagation();
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event) {
    event.stopPropagation();
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (startX == null || endX == null || Math.abs(endX - startX) < 45) return;
    moveSelection(endX < startX ? 1 : -1);
  }

  if (!selectedDay) return null;

  return (
    <section
      className="mobile-calendar-view"
      aria-label="Mobile calendar"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="mobile-calendar-view-toolbar">
        <div className="mobile-calendar-mode-toggle" role="group" aria-label="Calendar view">
          <button className={viewMode === 'day' ? 'active' : ''} type="button" onClick={() => setViewMode('day')} aria-pressed={viewMode === 'day'}>Day</button>
          <button className={viewMode === 'week' ? 'active' : ''} type="button" onClick={() => setViewMode('week')} aria-pressed={viewMode === 'week'}>Week</button>
        </div>
        <div className="mobile-calendar-step-buttons">
          <button type="button" onClick={() => moveSelection(-1)} aria-label={`Previous ${viewMode}`}>‹</button>
          <button type="button" onClick={() => moveSelection(1)} aria-label={`Next ${viewMode}`}>›</button>
        </div>
      </div>

      {viewMode === 'week' ? (
        <div className="mobile-calendar-week-strip" role="tablist" aria-label="Days in selected week">
          {(selectedWeek?.cells || []).map((cell, index) => {
            const active = cell.key === selectedDay.key;
            return (
              <button
                key={cell.key}
                type="button"
                role="tab"
                className={`${active ? 'active' : ''}${cell.isToday ? ' today' : ''}`}
                aria-selected={active}
                onClick={() => setSelectedIndex(selectedWeekIndex * 7 + index)}
              >
                <small>{cell.date.toLocaleDateString('en-US', { weekday: 'narrow' })}</small>
                <strong>{cell.date.getDate()}</strong>
              </button>
            );
          })}
        </div>
      ) : null}

      {viewMode === 'week' ? (
        <div className="mobile-calendar-week-agenda">
          {(selectedWeek?.cells || []).map((cell, index) => (
            <MobileCalendarDayAgenda
              key={cell.key}
              cell={cell}
              rangeItems={(selectedWeek?.scheduledBars || []).filter((item) => item.startCol <= index && item.endCol >= index)}
              showHebrewDates={showHebrewDates}
              onDateClick={onDateClick}
              onItemClick={onItemClick}
              isRangeItemClickable={isRangeItemClickable}
              isDayItemClickable={isDayItemClickable}
              getDayItemSubtitle={getDayItemSubtitle}
              compactEmpty
            />
          ))}
        </div>
      ) : (
        <MobileCalendarDayAgenda
          cell={selectedDay}
          rangeItems={selectedRangeItems}
          showHebrewDates={showHebrewDates}
          onDateClick={onDateClick}
          onItemClick={onItemClick}
          isRangeItemClickable={isRangeItemClickable}
          isDayItemClickable={isDayItemClickable}
          getDayItemSubtitle={getDayItemSubtitle}
        />
      )}
      <p className="mobile-calendar-swipe-hint">Swipe to move to the {viewMode === 'week' ? 'previous or next week' : 'previous or next day'}.</p>
    </section>
  );
}
