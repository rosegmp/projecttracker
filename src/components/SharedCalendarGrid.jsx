import React from 'react';
import {
  formatHebrewCalendarLabel,
  formatShortDate,
  getCalendarWeekLayout,
  getProjectAccentColor,
} from '../utils/calendarUi.js';

export default function SharedCalendarGrid({
  calendarWeeks,
  expandedCalendarWeeks,
  setExpandedCalendarWeeks,
  showHebrewDates = false,
  onDateClick,
  onItemClick,
  isRangeItemClickable = () => true,
  isDayItemClickable = () => true,
  getDayItemSubtitle = (item) => item.projectName || '',
  shellClassName = '',
  swipeHandlers = {},
}) {
  return (
    <div className={`calendar-grid-shell${shellClassName ? ` ${shellClassName}` : ''}`} {...swipeHandlers}>
      <div className="calendar-dow-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="calendar-dow">{day}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {calendarWeeks.map((week) => {
          const {
            holidayBars,
            collapsedVisibleLaneCount,
            hiddenScheduledBarCount,
            renderableScheduleBars,
            visibleLaneCount,
            holidayTop,
            spanOffset,
            maxVisibleDayItems,
            cellHeight,
          } = getCalendarWeekLayout(week);

          return (
            <div key={week.key} className="calendar-week">
              {visibleLaneCount ? (
                <div className="calendar-span-layer" style={{ gridTemplateRows: `repeat(${visibleLaneCount}, 20px)` }}>
                  {renderableScheduleBars.map((item) => {
                    const spanColumns = item.endCol - item.startCol + 1;
                    const inlineProjectName = item.projectName && spanColumns >= 2 &&
                      `${item.label} - ${item.projectName}`.length <= spanColumns * 13;
                    const clickable = isRangeItemClickable(item);
                    const Tag = clickable ? 'button' : 'div';
                    return (
                      <Tag
                        key={`${week.key}-${item.segmentKey || item.id}`}
                        type={clickable ? 'button' : undefined}
                        className={`calendar-span-bar ${item.type} status-${item.status || 'planning'}${['phase', 'step'].includes(item.type) && item.continuesBefore ? ' continues-before' : ''}${['phase', 'step'].includes(item.type) && item.continuesAfter ? ' continues-after' : ''}`}
                        style={{
                          gridColumn: `${item.startCol + 1} / ${item.endCol + 2}`,
                          gridRow: `${item.lane + 1}`,
                          borderColor: item.color || getProjectAccentColor(item.projectId || item.projectName),
                          ...(item.color ? { backgroundColor: item.color, color: '#fff' } : {}),
                        }}
                        title={`${item.label}${item.projectName ? ` | ${item.projectName}` : ''}`}
                        onClick={clickable ? (event) => { event.stopPropagation(); onItemClick?.(item, event); } : undefined}
                      >
                        <span>{inlineProjectName ? `${item.label} - ${item.projectName}` : item.label}</span>
                      </Tag>
                    );
                  })}
                </div>
              ) : null}

              {holidayBars.length ? (
                <div className="calendar-holiday-layer" style={{ top: `${holidayTop}px`, gridTemplateRows: `repeat(${week.holidayLaneCount}, auto)` }}>
                  {holidayBars.map((item) => (
                    <div
                      key={`${week.key}-${item.id}`}
                      className="calendar-chip holiday non-workday calendar-holiday-bar"
                      style={{ gridColumn: `${item.startCol + 1} / ${item.endCol + 2}`, gridRow: `${item.lane + 1}` }}
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
                        onClick={(event) => { event.stopPropagation(); onDateClick?.(cell, event); }}
                        title={`Add step on ${formatShortDate(cell.key)}`}
                      >
                        <span>{cell.date.getDate()}</span>
                        {showHebrewDates ? <small className="calendar-lunar-date">{formatHebrewCalendarLabel(cell.date)}</small> : null}
                      </button>

                      {holidayChips.length ? (
                        <div className="calendar-cell-holiday-row" style={{ marginTop: `${holidayTop}px` }}>
                          {holidayChips.map((holiday) => (
                            <div key={`${cell.key}-${holiday.id}`} className={`calendar-chip holiday${holiday.nonWorkday ? ' non-workday' : ''}`} title={holiday.name}>
                              <span>{holiday.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="calendar-cell-body" style={{ marginTop: `${spanOffset}px`, maxHeight: `${Math.max(0, cellHeight - spanOffset - 10)}px` }}>
                        {visibleItems.map((item) => {
                          const clickable = isDayItemClickable(item);
                          const Tag = clickable ? 'button' : 'div';
                          const subtitle = getDayItemSubtitle(item);
                          return (
                            <Tag
                              key={`${cell.key}-${item.id}`}
                              type={clickable ? 'button' : undefined}
                              className={`calendar-chip ${item.type} status-${item.status || 'planning'}`}
                              title={`${item.label}${item.projectName ? ` | ${item.projectName}` : ''}`}
                              onClick={clickable ? (event) => { event.stopPropagation(); onItemClick?.(item, event); } : undefined}
                            >
                              <span>{item.label}</span>
                              {subtitle ? <small>{subtitle}</small> : null}
                            </Tag>
                          );
                        })}
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
  );
}
