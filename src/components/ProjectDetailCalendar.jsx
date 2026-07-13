import React, { useEffect, useMemo, useState } from 'react';
import { buildCalendarItems, buildCalendarWeeks } from '../utils/scheduleView.js';
import { addDays, endOfWeek, startOfMonth, startOfWeek, toIsoDate, useHorizontalSwipe } from '../utils/calendarUi.js';
import SharedCalendarGrid from './SharedCalendarGrid.jsx';

const CALENDAR_VISIBLE_RANGE_LANES = 3;

export default function ProjectDetailCalendar({ project, tasks, settings, onDateClick, onItemClick }) {
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [expandedCalendarWeeks, setExpandedCalendarWeeks] = useState({});
  const showHebrewDates = settings?.showCalendarHebrewDates === true;
  const goToPreviousMonth = () =>
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  const calendarSwipeHandlers = useHorizontalSwipe(goToNextMonth, goToPreviousMonth);

  useEffect(() => {
    setCalendarMonth(startOfMonth(new Date()));
    setExpandedCalendarWeeks({});
  }, [project.id, tasks]);

  const tasksByProject = useMemo(() => new Map([[project.id, tasks || []]]), [project.id, tasks]);
  const calendarData = useMemo(
    () => buildCalendarItems([project], tasksByProject, settings),
    [project, settings, tasksByProject],
  );
  const calendarCells = useMemo(() => {
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    const cells = [];
    const todayKey = toIsoDate(new Date());
    for (let day = new Date(gridStart); day <= gridEnd; day = addDays(day, 1)) {
      const key = toIsoDate(day);
      cells.push({
        key,
        date: new Date(day),
        isCurrentMonth: day.getMonth() === calendarMonth.getMonth(),
        isToday: key === todayKey,
        isWeekend: day.getDay() === 0 || day.getDay() === 6,
        holidays: calendarData.holidayMap.get(key) || [],
        items: calendarData.itemsByDate.get(key) || [],
      });
    }
    return cells;
  }, [calendarData, calendarMonth]);
  const calendarWeeks = useMemo(
    () => buildCalendarWeeks(
      calendarCells,
      calendarData.rangeItems,
      CALENDAR_VISIBLE_RANGE_LANES,
      new Set(Object.entries(expandedCalendarWeeks).filter(([, expanded]) => expanded).map(([key]) => key)),
    ),
    [calendarCells, calendarData.rangeItems, expandedCalendarWeeks],
  );

  return (
    <section className="project-detail-section project-detail-calendar-card">
      <div className="panel-header">
        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={goToPreviousMonth}>Previous</button>
          <strong className="project-calendar-month">
            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </strong>
          <button className="button secondary" type="button" onClick={goToNextMonth}>Next</button>
          <button className="button secondary calendar-today-button" type="button" onClick={() => setCalendarMonth(startOfMonth(new Date()))}>
            Today
          </button>
        </div>
      </div>

      <SharedCalendarGrid
        calendarWeeks={calendarWeeks}
        expandedCalendarWeeks={expandedCalendarWeeks}
        setExpandedCalendarWeeks={setExpandedCalendarWeeks}
        showHebrewDates={showHebrewDates}
        onDateClick={(cell, event) => onDateClick?.(cell.key, event)}
        onItemClick={onItemClick}
        isRangeItemClickable={(item) => item.type === 'step'}
        isDayItemClickable={() => false}
        getDayItemSubtitle={(item) => item.type === 'inspection' ? item.inspectionType || 'Inspection' : ''}
        shellClassName="project-detail-calendar"
        swipeHandlers={calendarSwipeHandlers}
      />
    </section>
  );
}
