import React from 'react';
import { formatShortDate } from '../utils/calendarUi.js';
import FluentIcon from './FluentIcon.jsx';

function rowDateLabel(row) {
  if (!row.start && !row.end) return 'Date not set';
  if (!row.start) return `Ends ${formatShortDate(row.end)}`;
  if (!row.end || row.end === row.start) return formatShortDate(row.start);
  return `${formatShortDate(row.start)} - ${formatShortDate(row.end)}`;
}

export default function MobileScheduleAgenda({
  rows,
  className = '',
  agendaRef = null,
  expansionLocked = false,
  onToggle,
  onAddPhase,
  onAddStep,
  onAddDelay,
  onEdit,
  onDependencies,
}) {
  return (
    <div ref={agendaRef} className={`mobile-schedule-agenda${className ? ` ${className}` : ''}`} aria-label="Schedule agenda">
      <div className="mobile-agenda-column-header" aria-hidden="true">
        <span>Item</span>
        <span>Dates</span>
        <span>Actions</span>
      </div>
      {rows.map((row) => {
        if (row.type === 'project') {
          return (
            <section className="mobile-agenda-project" key={row.id}>
              <div className="mobile-agenda-heading">
                <button type="button" className="mobile-agenda-toggle" onClick={() => onToggle(row)} aria-expanded={row.expanded} disabled={expansionLocked}>
                  <span className="expand-collapse-button mobile-agenda-expand-indicator" aria-hidden="true">
                    <FluentIcon name="chevronRight" className="expand-collapse-icon" />
                  </span>
                  <strong>{row.label}</strong>
                </button>
                <button type="button" className="button secondary" onClick={() => onAddPhase(row)}>Add phase</button>
              </div>
            </section>
          );
        }

        if (row.type === 'phase') {
          return (
            <section className="mobile-agenda-phase" key={row.id}>
              <div className="mobile-agenda-heading">
                <button type="button" className="mobile-agenda-toggle" onClick={() => onToggle(row)} aria-expanded={row.expanded} disabled={expansionLocked}>
                  <span className="expand-collapse-button mobile-agenda-expand-indicator" aria-hidden="true">
                    <FluentIcon name="chevronRight" className="expand-collapse-icon" />
                  </span>
                  <span><strong>{row.label}</strong>{row.subtitle ? <small>{row.subtitle}</small> : null}</span>
                </button>
                <button type="button" className="button secondary" onClick={() => onEdit(row)}>Edit</button>
              </div>
              <div className="mobile-agenda-phase-actions">
                <button type="button" className="button secondary" onClick={() => onAddStep(row)}>Add schedule step</button>
                <button type="button" className="button secondary" onClick={() => onAddDelay(row)}>Add delay</button>
              </div>
            </section>
          );
        }

        return (
          <article
            className={`mobile-agenda-item ${row.type}`}
            key={row.id}
            data-start-date={row.type === 'step' && row.start ? row.start : undefined}
            tabIndex={row.type === 'step' ? -1 : undefined}
          >
            <div className="mobile-agenda-item-copy">
              <strong>{row.label}</strong>
              <span>{rowDateLabel(row)}</span>
              {row.subtitle ? <small>{row.subtitle}</small> : null}
              {row.assignees?.length ? <small>Assigned to {row.assignees.join(', ')}</small> : null}
            </div>
            <div className="mobile-agenda-item-actions">
              {row.type === 'step' ? (
                <button type="button" className="button secondary" onClick={() => onDependencies(row)}>Dependencies</button>
              ) : null}
              <button type="button" className="button secondary" onClick={() => onEdit(row)}>Edit</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
