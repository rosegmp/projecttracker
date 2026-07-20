import React from 'react';
import { getProjectOperationalHealth } from '../utils/homeView.js';
import { diffInDays, formatShortDate } from '../utils/calendarUi.js';
import FluentIcon from './FluentIcon.jsx';

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDaysRemaining(endDate) {
  if (!endDate) return null;
  const today = new Date();
  const end = new Date(`${endDate}T00:00:00`);
  return Math.ceil((end - today) / 86400000);
}

function getProjectTimelineCompletion(project) {
  if (!project?.start || !project?.end) return 0;
  const start = new Date(`${project.start}T00:00:00`);
  const end = new Date(`${project.end}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const today = new Date();
  const todayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (todayAtMidnight <= start) return 0;
  if (todayAtMidnight >= end) return 100;
  const totalDays = diffInDays(start, end);
  if (totalDays <= 0) return todayAtMidnight >= end ? 100 : 0;
  const elapsedDays = diffInDays(start, todayAtMidnight);
  return Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
}

function getProjectStepCount(project) {
  return (project?.phases || []).reduce((sum, phase) => sum + (phase.steps?.length || 0), 0);
}

function getUpcomingInspection(project) {
  const todayKey = toIsoDate(new Date());
  return [...(project?.inspections || [])]
    .filter((inspection) => inspection.date && inspection.date >= todayKey)
    .sort((left, right) => left.date.localeCompare(right.date))[0] || null;
}

function getProjectDashboardNextAction(project, taskCount) {
  const phaseCount = project?.phases?.length || 0;
  const stepCount = getProjectStepCount(project);
  const remaining = getDaysRemaining(project?.end);
  const nextInspection = getUpcomingInspection(project);
  if (!project?.start) return 'Set a project start date to anchor the schedule.';
  if (!phaseCount) return 'Add the first phase to start building the schedule.';
  if (!stepCount) return 'Add the first step so the project can appear on the schedule.';
  if ((taskCount || 0) > 0) return `${taskCount} open task${taskCount === 1 ? '' : 's'} to review.`;
  if (nextInspection) return `Upcoming inspection: ${nextInspection.subcode || nextInspection.inspectionType || 'Inspection'} on ${formatShortDate(nextInspection.date)}.`;
  if (remaining !== null && remaining < 0 && project.status !== 'done') return `Target end date has passed by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'}.`;
  if (!project?.end) return 'Set a target end date to make progress easier to track.';
  return 'Project is in a good spot. Review progress and upcoming milestones.';
}

export default function ProjectCard({ project, tasks = [], taskCount, onEdit, onOpen, expanded = false, onToggle }) {
  const health = getProjectOperationalHealth(project, tasks);
  const remaining = getDaysRemaining(project.end);
  const completion = getProjectTimelineCompletion(project);
  const metaParts = [project.customerName, project.address].filter(Boolean);
  const customerLabel = project.customerName || 'No customer';
  const permitLabel = project.permitNumber || 'Not set';
  const phaseCount = project.phases?.length || 0;
  const stepCount = getProjectStepCount(project);
  const inspectionCount = project.inspections?.length || 0;
  const nextAction = getProjectDashboardNextAction(project, taskCount);
  const blockLotLabel =
    project.block || project.lot
      ? [project.block ? `Block ${project.block}` : '', project.lot ? `Lot ${project.lot}` : ''].filter(Boolean).join(' | ')
      : 'Not set';
  const drLabel = project.drNumber || 'Not set';
  const startLabel = project.start ? formatShortDate(project.start) : 'No start date';
  const endLabel = project.end ? formatShortDate(project.end) : 'No end date';
  const dueLabel =
    remaining === null
      ? 'No deadline'
      : remaining >= 0
        ? `${remaining} day${remaining === 1 ? '' : 's'} left`
        : `${Math.abs(remaining)} day${remaining === -1 ? '' : 's'} overdue`;
  const detailId = `project-overview-details-${project.id}`;

  return (
    <article className={`project-card${expanded ? ' expanded' : ' collapsed'}`}>
      <div className="project-card-header">
        <div className="project-card-heading">
          <div className="project-card-status-row">
            <p className="project-status">{health.label}</p>
            <span className={`status-pill status-${project.status || 'planning'}`}>
              {project.status || 'planning'}
            </span>
          </div>
          <h3>
            <button className="project-title-button" type="button" onClick={() => onOpen(project)}>
              {project.name}
            </button>
          </h3>
          <p className="project-meta">{metaParts.length ? metaParts.join(' | ') : 'No project details yet'}</p>
        </div>
        <div className="project-card-header-actions">
          <div className="project-card-deadline">
            <span>Due</span>
            <strong>{dueLabel}</strong>
          </div>
          <button
            className="button secondary expand-collapse-button project-card-expand-button"
            type="button"
            onClick={() => onToggle?.(project.id)}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
            title={expanded ? 'Collapse project summary' : 'Expand project summary'}
          >
            <FluentIcon name="chevronRight" className="expand-collapse-icon" />
          </button>
        </div>
      </div>

      <div id={detailId} className="project-card-expanded-content" hidden={!expanded}>
      <div className="project-card-metrics">
        <div className="project-metric-tile">
          <span>Progress</span>
          <strong>{completion}%</strong>
        </div>
        <div className="project-metric-tile">
          <span>Standalone tasks</span>
          <strong>{taskCount}</strong>
        </div>
        <div className="project-metric-tile">
          <span>Inspections</span>
          <strong>{inspectionCount}</strong>
        </div>
        <div className="project-metric-tile">
          <span>Phases / steps</span>
          <strong>{phaseCount} / {stepCount}</strong>
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-row">
          <span>Start {startLabel}</span>
          <span>Finish {endLabel}</span>
        </div>
        <div className="progress-bar">
          <div style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
        </div>
      </div>

      <dl className="project-facts">
        <div>
          <dt>Permit #</dt>
          <dd>{permitLabel}</dd>
        </div>
        <div>
          <dt>Block / Lot</dt>
          <dd>{blockLotLabel}</dd>
        </div>
        <div>
          <dt>DR #</dt>
          <dd>{drLabel}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{customerLabel}</dd>
        </div>
      </dl>
      <div className="project-card-footer">
        <div className="project-next-action">
          <span>Next action</span>
          <p>{nextAction}</p>
        </div>
        <div className="project-card-actions">
          <button className="button primary" type="button" onClick={() => onOpen(project)}>
            Open project
          </button>
          {onEdit ? (
            <button className="button secondary" type="button" onClick={() => onEdit(project)}>
              Edit project
            </button>
          ) : null}
        </div>
      </div>
      </div>
    </article>
  );
}
