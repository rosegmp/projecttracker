import React, { useEffect, useMemo, useState } from 'react';
import { buildCalendarItems, buildCalendarWeeks } from '../utils/scheduleView.js';
import { addDays, endOfWeek, formatHebrewCalendarLabel, formatShortDate, getProjectAccentColor, splitStepBarAroundBlockedDays, startOfMonth, startOfWeek, toIsoDate, useHorizontalSwipe } from '../utils/calendarUi.js';

const CALENDAR_VISIBLE_RANGE_LANES = 3;
const CALENDAR_COLLAPSED_WEEK_HEIGHT = 244;
const CALENDAR_COLLAPSED_BODY_MIN_HEIGHT = 32;

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

  const tasksByProject = useMemo(() => {
    const map = new Map();
    map.set(project.id, tasks || []);
    return map;
  }, [project.id, tasks]);

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
    () =>
      buildCalendarWeeks(
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
          <button
            className="button secondary"
            type="button"
            onClick={goToPreviousMonth}
          >
            Previous
          </button>
          <strong className="project-calendar-month">
            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </strong>
          <button
            className="button secondary"
            type="button"
            onClick={goToNextMonth}
          >
            Next
          </button>
          <button
            className="button secondary calendar-today-button"
            type="button"
            onClick={() => {
              const today = new Date();
              setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          >
            Today
          </button>
        </div>
      </div>

      <div className="calendar-grid-shell project-detail-calendar" {...calendarSwipeHandlers}>
        <div className="calendar-dow-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div className="calendar-dow" key={day}>
              {day}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {calendarWeeks.map((week) => {
            const allScheduleBars = week.scheduledBars || week.bars;
            const holidayBars = week.holidayBars || [];
            const collapsedLaneBudget = Math.max(
              0,
              Math.floor(
                (CALENDAR_COLLAPSED_WEEK_HEIGHT -
                  30 -
                  week.holidayLaneCount * 28 -
                  CALENDAR_COLLAPSED_BODY_MIN_HEIGHT -
                  (week.laneCount > 0 ? 20 : 0)) /
                  24,
              ),
            );
            const collapsedVisibleLaneCount = Math.min(
              week.laneCount,
              Math.max(CALENDAR_VISIBLE_RANGE_LANES, collapsedLaneBudget),
            );
            const scheduleBars = week.isExpanded
              ? allScheduleBars
              : allScheduleBars.filter((item) => item.lane < collapsedVisibleLaneCount);
            const hiddenScheduledBarCount = Math.max(0, allScheduleBars.length - scheduleBars.length);
            const renderableScheduleBars = scheduleBars.flatMap((item) => splitStepBarAroundBlockedDays(item, week.cells));
            const visibleLaneCount = week.isExpanded ? week.laneCount : collapsedVisibleLaneCount;
            const baseSpanOffset = 30 + visibleLaneCount * 24 + (!week.isExpanded && hiddenScheduledBarCount ? 20 : 0);
            const holidayTop = baseSpanOffset;
            const spanOffset = holidayTop + week.holidayLaneCount * 28;
            const provisionalAvailableBodyHeight = Math.max(0, CALENDAR_COLLAPSED_WEEK_HEIGHT - spanOffset - 10);
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

            return (
              <div key={week.key} className="calendar-week">
                {visibleLaneCount ? (
                  <div
                    className="calendar-span-layer"
                    style={{
                      gridTemplateRows: `repeat(${visibleLaneCount}, 20px)`,
                    }}
                  >
                    {renderableScheduleBars.map((item) => {
                      const spanColumns = item.endCol - item.startCol + 1;
                      const estimatedCharCapacity = spanColumns * 13;
                      const inlineProjectName =
                        item.projectName &&
                        spanColumns >= 2 &&
                        `${item.label} - ${item.projectName}`.length <= estimatedCharCapacity;
                      const isClickable = item.type === 'step';
                      const Tag = isClickable ? 'button' : 'div';
                      return (
                        <Tag
                          key={`${week.key}-${item.segmentKey || item.id}`}
                          type={isClickable ? 'button' : undefined}
                          className={`calendar-span-bar ${item.type} status-${item.status || 'planning'}${['phase', 'step'].includes(item.type) && item.continuesBefore ? ' continues-before' : ''}${['phase', 'step'].includes(item.type) && item.continuesAfter ? ' continues-after' : ''}`}
                          style={{
                            gridColumn: `${item.startCol + 1} / ${item.endCol + 2}`,
                            gridRow: `${item.lane + 1}`,
                            borderColor: item.color || getProjectAccentColor(item.projectId || item.projectName),
                            ...(item.color ? { backgroundColor: item.color, color: '#fff' } : {}),
                          }}
                          title={`${item.label}${item.projectName ? ` | ${item.projectName}` : ''}`}
                          onClick={
                            isClickable
                              ? (event) => {
                                  event.stopPropagation();
                                  onItemClick?.(item, event);
                                }
                              : undefined
                          }
                        >
                          <span>{inlineProjectName ? `${item.label} - ${item.projectName}` : item.label}</span>
                        </Tag>
                      );
                    })}
                  </div>
                ) : null}

                {holidayBars.length ? (
                  <div
                    className="calendar-holiday-layer"
                    style={{
                      top: `${holidayTop}px`,
                      gridTemplateRows: `repeat(${week.holidayLaneCount}, auto)`,
                    }}
                  >
                    {holidayBars.map((item) => (
                      <div
                        key={`${week.key}-${item.id}`}
                        className="calendar-chip holiday non-workday calendar-holiday-bar"
                        style={{
                          gridColumn: `${item.startCol + 1} / ${item.endCol + 2}`,
                          gridRow: `${item.lane + 1}`,
                        }}
                        title={item.label}
                      >
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {hiddenScheduledBarCount && !week.isExpanded ? (
                  <button
                    type="button"
                    className="calendar-span-overflow"
                    onClick={() => setExpandedCalendarWeeks((current) => ({ ...current, [week.key]: true }))}
                    title={`${hiddenScheduledBarCount} additional scheduled bar${hiddenScheduledBarCount === 1 ? '' : 's'} hidden for this week`}
                  >
                    +{hiddenScheduledBarCount} more scheduled
                  </button>
                ) : null}

                {week.isExpanded && week.laneCount > collapsedVisibleLaneCount ? (
                  <button
                    type="button"
                    className="calendar-span-overflow"
                    onClick={() => setExpandedCalendarWeeks((current) => ({ ...current, [week.key]: false }))}
                    title="Collapse this week"
                  >
                    Show fewer
                  </button>
                ) : null}

                <div className="calendar-week-grid">
                  {week.cells.map((cell) => {
                    const holidayChips = cell.holidays.filter((holiday) => !holiday.isRange);
                    const visibleItems = cell.items.slice(0, maxVisibleDayItems);
                    const hiddenCount = cell.items.length - visibleItems.length;
                    return (
                      <article
                        key={cell.key}
                        className={`calendar-cell${cell.isCurrentMonth ? '' : ' other-month'}${cell.isToday ? ' today' : ''}${cell.holidays.length ? ' holiday' : ''}${cell.isWeekend ? ' weekend' : ''}`}
                        style={{ height: `${cellHeight}px` }}
                      >
                        <button
                          type="button"
                          className="calendar-day-number"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDateClick?.(cell.key, event);
                          }}
                          title={`Add step on ${formatShortDate(cell.key)}`}
                        >
                          <span>{cell.date.getDate()}</span>
                          {showHebrewDates ? (
                            <small className="calendar-lunar-date">{formatHebrewCalendarLabel(cell.date)}</small>
                          ) : null}
                        </button>

                        {holidayChips.length ? (
                          <div className="calendar-cell-holiday-row" style={{ marginTop: `${holidayTop}px` }}>
                            {holidayChips.map((holiday) => (
                              <div
                                key={`${cell.key}-${holiday.id}`}
                                className={`calendar-chip holiday${holiday.nonWorkday ? ' non-workday' : ''}`}
                                title={holiday.name}
                              >
                                <span>{holiday.name}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div
                          className="calendar-cell-body"
                          style={{
                            marginTop: `${spanOffset}px`,
                            maxHeight: `${Math.max(0, cellHeight - spanOffset - 10)}px`,
                          }}
                        >
                          {visibleItems.map((item) => (
                            <div
                              key={`${cell.key}-${item.id}`}
                              className={`calendar-chip ${item.type} status-${item.status || 'planning'}`}
                              title={`${item.label}${item.projectName ? ` | ${item.projectName}` : ''}`}
                            >
                              <span>{item.label}</span>
                              {item.type === 'inspection' ? <small>{item.inspectionType || 'Inspection'}</small> : null}
                            </div>
                          ))}

                          {hiddenCount > 0 ? <div className="calendar-more">+{hiddenCount} more</div> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
