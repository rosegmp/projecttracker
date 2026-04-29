import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_PROJECT_FILE_FOLDERS,
  SAMPLE_IDS,
  createPerson,
  createProject,
  createTask,
  deleteProjectFileFromStorage,
  deletePerson,
  deleteProject,
  deleteTask,
  downloadProjectFileFromStorage,
  getProjectHealth,
  getStorageBannerMessage,
  importPeople,
  isSupabaseStorageConfigured,
  loadTrackerData,
  uploadProjectFileToStorage,
  updatePerson,
  updateProject,
  updateProjectAndTasks,
  updateSettings,
  updateTask,
} from './services/trackerData.js';
import {
  addWorkdaysFromSettings,
  applyDelayToStep,
  calcStepFirstAvailable,
  cascadeStepDates,
  computeStepEndDate,
  isOverdue,
  normalizePreds,
  normalizeStartDate,
  syncProjectPhaseDates,
  syncProjectTasks,
  syncStepLinks,
  wouldCreateCycleFromPreds,
} from './utils/schedule.js';
import {
  buildCalendarItems as buildCalendarItemsView,
  buildCalendarWeeks as buildCalendarWeeksView,
  buildScheduleRows as buildScheduleRowsView,
} from './utils/scheduleView.js';

const tabs = [
  { id: 'projects', label: 'Projects' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'files', label: 'Files' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'people', label: 'People' },
  { id: 'settings', label: 'Settings' },
];

const GANTT_ROW_MIN_HEIGHT = 48;
const CALENDAR_VISIBLE_RANGE_LANES = 3;
const CALENDAR_COLLAPSED_WEEK_HEIGHT = 244;
const CALENDAR_COLLAPSED_BODY_MIN_HEIGHT = 32;
const GANTT_ZOOM_MIN = 0;
const GANTT_ZOOM_MAX = 100;
const GANTT_ZOOM_MIN_PIXELS_PER_DAY = 2;
const GANTT_ZOOM_MAX_PIXELS_PER_DAY = 48;
const DEFAULT_PEOPLE_LIST_COLUMNS = ['company', 'name', 'role', 'phone', 'email', 'tags'];
const PEOPLE_LIST_ACTIONS_WIDTH = 92;
const DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS = {
  company: 220,
  name: 220,
  role: 180,
  phone: 170,
  email: 240,
  tags: 200,
};
const PEOPLE_LIST_COLUMN_DEFS = [
  { id: 'name', label: 'Name', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.name },
  { id: 'company', label: 'Company', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.company },
  { id: 'role', label: 'Role', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.role },
  { id: 'phone', label: 'Phone', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.phone },
  { id: 'email', label: 'Email', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.email },
  { id: 'tags', label: 'Tags', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.tags },
];
const validTabIds = new Set(tabs.map((tab) => tab.id));

function getTabFromLocation() {
  if (typeof window === 'undefined') return 'projects';
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return validTabIds.has(tab) ? tab : 'projects';
}

function syncTabToLocation(tab) {
  if (typeof window === 'undefined' || !validTabIds.has(tab)) return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  window.history.replaceState(null, '', url);
}

function renderModalPortal(content) {
  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatShortDate(iso) {
  if (!iso) return 'No date';
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTooltipDate(iso) {
  if (!iso) return 'No date';
  const date = new Date(`${iso}T00:00:00`);
  const month = new Intl.DateTimeFormat('en-US', { month: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(date);
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(date);
  return `${month}/${day}/${year}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getProjectAccentColor(seed) {
  const text = String(seed || 'project');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 360;
  }
  return `hsl(${hash} 60% 42%)`;
}

function splitStepBarAroundBlockedDays(item, weekCells) {
  if (!['step', 'phase'].includes(item.type)) {
    return [{ ...item, segmentKey: `${item.id}-${item.startCol}-${item.endCol}` }];
  }

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
      segments.push({
        ...item,
        startCol: currentStart,
        endCol: column - 1,
        segmentKey: `${item.id}-${currentStart}-${column - 1}`,
      });
      currentStart = null;
    }
  }

  if (currentStart !== null) {
    segments.push({
      ...item,
      startCol: currentStart,
      endCol: item.endCol,
      segmentKey: `${item.id}-${currentStart}-${item.endCol}`,
    });
  }

  return segments;
}

function getDaysRemaining(endDate) {
  if (!endDate) return null;
  const today = new Date();
  const end = new Date(`${endDate}T00:00:00`);
  return Math.ceil((end - today) / 86400000);
}

function splitTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => String(value).trim()));
}

function personDisplayName(person) {
  return `${person.first || ''} ${person.last || ''}`.trim() || 'Unnamed';
}

function personNameOnly(person) {
  return `${person.first || ''} ${person.last || ''}`.trim();
}

function personInitials(person) {
  const initials = `${person.first?.[0] || ''}${person.last?.[0] || ''}`.toUpperCase();
  return initials || person.company?.[0]?.toUpperCase() || '?';
}

function hasVisibleSampleData(data) {
  return (
    (data.projects || []).some((item) => SAMPLE_IDS.projects.includes(item.id)) ||
    (data.tasks || []).some((item) => SAMPLE_IDS.tasks.includes(item.id)) ||
    (data.subs || []).some((item) => SAMPLE_IDS.subs.includes(item.id)) ||
    (data.employees || []).some((item) => SAMPLE_IDS.employees.includes(item.id))
  );
}

function parseDateValue(iso) {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function diffInDays(start, end) {
  return Math.round((end - start) / 86400000);
}

function enumerateMonths(start, end) {
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function endOfWeek(date) {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 6);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getTimelineStyle(row, minDate, maxDate) {
  const start = parseDateValue(row.start);
  const end = parseDateValue(row.end || row.start);
  if (!start || !end || maxDate <= minDate) return null;
  const totalDays = Math.max(1, diffInDays(minDate, maxDate) + 1);
  const safeEnd = end < start ? start : end;
  const offset = diffInDays(minDate, start);
  const duration = Math.max(1, diffInDays(start, safeEnd) + 1);
  return {
    left: `${(offset / totalDays) * 100}%`,
    width: row.isMilestone ? '16px' : `${Math.max((duration / totalDays) * 100, 1.2)}%`,
  };
}

function getTimelineMetrics(row, minDate, maxDate) {
  const start = parseDateValue(row.start);
  const end = parseDateValue(row.end || row.start);
  if (!start || !end || maxDate <= minDate) return null;
  const totalDays = Math.max(1, diffInDays(minDate, maxDate) + 1);
  const safeEnd = end < start ? start : end;
  const offset = diffInDays(minDate, start);
  const duration = Math.max(1, diffInDays(start, safeEnd) + 1);
  return {
    leftPct: (offset / totalDays) * 100,
    widthPct: Math.max((duration / totalDays) * 100, 1.2),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function DashboardStat({ label, value, tone = 'default' }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'A screen failed to render.',
    };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="error-banner">
          <strong>Screen render failed.</strong>
          <span>{this.state.message}</span>
        </section>
      );
    }

    return this.props.children;
  }
}

function ProjectCard({ project, taskCount, onEdit }) {
  const health = getProjectHealth(project);
  const remaining = getDaysRemaining(project.end);
  const budget = formatCurrency(project.budget);
  const completion = project.progress ?? 0;
  const metaParts = [project.manager, project.customerName, project.address].filter(Boolean);
  const customerLabel = project.customerName || 'No customer';
  const permitLabel = project.permitNumber || 'Not set';
  const blockLotLabel =
    project.block || project.lot
      ? [project.block ? `Block ${project.block}` : '', project.lot ? `Lot ${project.lot}` : ''].filter(Boolean).join(' • ')
      : 'Not set';
  const drLabel = project.drNumber || 'Not set';

  return (
    <article className="project-card">
      <div className="project-card-header">
        <div>
          <p className="project-status">{health.label}</p>
          <h3>{project.name}</h3>
          <p className="project-meta">{metaParts.length ? metaParts.join(' • ') : 'No project details yet'}</p>
        </div>
        <span className={`status-pill status-${project.status || 'planning'}`}>
          {project.status || 'planning'}
        </span>
      </div>

      <div className="progress-block">
        <div className="progress-row">
          <span>{completion}% complete</span>
          <span>
            {remaining === null
              ? 'No deadline'
              : remaining >= 0
                ? `${remaining} day${remaining === 1 ? '' : 's'} left`
                : `${Math.abs(remaining)} day${remaining === -1 ? '' : 's'} overdue`}
          </span>
        </div>
        <div className="progress-bar">
          <div style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
        </div>
      </div>

      <dl className="project-facts">
        <div>
          <dt>Budget</dt>
          <dd>{budget}</dd>
        </div>
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
        <div>
          <dt>Phases</dt>
          <dd>{project.phases?.length || 0}</dd>
        </div>
        <div>
          <dt>Tasks</dt>
          <dd>{taskCount}</dd>
        </div>
        <div>
          <dt>Target end</dt>
          <dd>{project.end ? formatShortDate(project.end) : 'No date'}</dd>
        </div>
      </dl>
      <div className="project-card-actions">
        <button className="button secondary" type="button" onClick={() => onEdit(project)}>
          Edit project
        </button>
      </div>
    </article>
  );
}

function ProjectModal({ draft, onChange, onClose, onSave, onDelete, saving, isEditing }) {
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2>{isEditing ? 'Edit project' : 'New project'}</h2>
          </div>
        </div>
        <div className="project-form-grid">
          <div className="project-form-section full">Project details</div>
          <label>
            <span>Name</span>
            <input value={draft.name} onChange={(event) => onChange('name', event.target.value)} />
          </label>
          <label>
            <span>Manager</span>
            <input value={draft.manager} onChange={(event) => onChange('manager', event.target.value)} />
          </label>
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="delayed">Delayed</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label>
            <span>Progress</span>
            <input
              type="number"
              min="0"
              max="100"
              value={draft.progress}
              onChange={(event) => onChange('progress', event.target.value)}
            />
          </label>
          <label>
            <span>Start date</span>
            <input type="date" value={draft.start} onChange={(event) => onChange('start', event.target.value)} />
          </label>
          <label>
            <span>End date</span>
            <input type="date" value={draft.end} onChange={(event) => onChange('end', event.target.value)} />
          </label>
          <label>
            <span>Budget</span>
            <input value={draft.budget} onChange={(event) => onChange('budget', event.target.value)} />
          </label>
          <label>
            <span>Address</span>
            <input value={draft.address} onChange={(event) => onChange('address', event.target.value)} />
          </label>
          <label>
            <span>Permit #</span>
            <input value={draft.permitNumber} onChange={(event) => onChange('permitNumber', event.target.value)} />
          </label>
          <label>
            <span>DR #</span>
            <input value={draft.drNumber} onChange={(event) => onChange('drNumber', event.target.value)} />
          </label>
          <label>
            <span>Block</span>
            <input value={draft.block} onChange={(event) => onChange('block', event.target.value)} />
          </label>
          <label>
            <span>Lot</span>
            <input value={draft.lot} onChange={(event) => onChange('lot', event.target.value)} />
          </label>
          <div className="project-form-section full">Customer info</div>
          <label>
            <span>Customer name</span>
            <input value={draft.customerName} onChange={(event) => onChange('customerName', event.target.value)} />
          </label>
          <label>
            <span>Customer phone</span>
            <input value={draft.customerPhone} onChange={(event) => onChange('customerPhone', event.target.value)} />
          </label>
          <label>
            <span>Customer email</span>
            <input value={draft.customerEmail} onChange={(event) => onChange('customerEmail', event.target.value)} />
          </label>
          <label>
            <span>Customer address</span>
            <input
              value={draft.customerAddress}
              onChange={(event) => onChange('customerAddress', event.target.value)}
            />
          </label>
          <label className="full">
            <span>Customer notes</span>
            <textarea
              value={draft.customerNotes}
              onChange={(event) => onChange('customerNotes', event.target.value)}
            />
          </label>
          <label className="full">
            <span>Description</span>
            <textarea value={draft.desc} onChange={(event) => onChange('desc', event.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          {isEditing ? (
            <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save project'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function TaskModal({ draft, projects, saving, onChange, onClose, onSave, onDelete }) {
  if (!draft) return null;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Task</p>
            <h2>Edit task</h2>
          </div>
        </div>

        <div className="project-form-grid">
          <label className="full">
            <span>Task name</span>
            <input value={draft.label} onChange={(event) => onChange('label', event.target.value)} />
          </label>
          <label>
            <span>Project</span>
            <select value={draft.projectId} onChange={(event) => onChange('projectId', event.target.value)}>
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Due date</span>
            <input type="date" value={draft.due} onChange={(event) => onChange('due', event.target.value)} />
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={!!draft.done}
              onChange={(event) => onChange('done', event.target.checked)}
            />
            <span>
              <strong>Completed</strong>
              <small>Mark this task as done.</small>
            </span>
          </label>
        </div>

        <div className="modal-actions">
          <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
            Delete
          </button>
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save task'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function ScheduleItemModal({
  draft,
  type,
  projects,
  saving,
  onChange,
  onOpenPreds,
  onAddPhase,
  onClose,
  onSave,
  onSaveAndNew,
  onDelete,
}) {
  if (!draft) return null;
  const isEditing = draft.mode !== 'create';
  const selectedProject = type === 'step' ? projects.find((project) => project.id === draft.projectId) : null;
  const phaseOptions = selectedProject?.phases || [];
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card schedule-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>
              {isEditing
                ? type === 'phase'
                  ? 'Edit phase'
                  : 'Edit step'
                : type === 'phase'
                  ? 'Add phase'
                  : 'Add step'}
            </h2>
          </div>
        </div>

        <div className="project-form-grid">
          {type === 'step' ? (
            <>
              <label>
                <span>Project</span>
                <select value={draft.projectId} onChange={(event) => onChange('projectId', event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Phase</span>
                <div className="inline-field-action">
                  <select value={draft.phaseId} onChange={(event) => onChange('phaseId', event.target.value)}>
                    {phaseOptions.length ? (
                      phaseOptions.map((phase) => (
                        <option key={phase.id} value={phase.id}>
                          {phase.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No phases available</option>
                    )}
                  </select>
                  <button
                    className="button secondary inline-field-button"
                    type="button"
                    onClick={() => onAddPhase?.(draft.projectId)}
                    disabled={saving || !draft.projectId}
                    title="Add phase"
                  >
                    +
                  </button>
                </div>
              </label>
            </>
          ) : null}

          <label>
            <span>{type === 'phase' ? 'Phase name' : 'Step name'}</span>
            <input value={draft.name} onChange={(event) => onChange('name', event.target.value)} />
          </label>

          <label>
            <span>Assignee</span>
            <input value={draft.assign} onChange={(event) => onChange('assign', event.target.value)} />
          </label>

          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="delayed">Delayed</option>
              <option value="done">Done</option>
            </select>
          </label>

          {type === 'step' ? (
            <>
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  value={draft.start}
                  onChange={(event) => onChange('start', event.target.value)}
                />
              </label>

              <label>
                <span>Duration (days)</span>
                <input
                  type="number"
                  min="1"
                  value={draft.duration}
                  onChange={(event) => onChange('duration', event.target.value)}
                />
              </label>

              <label>
                <span>End date</span>
                <input type="text" value={draft.endPreview ? formatTooltipDate(draft.endPreview) : 'Not set'} readOnly />
              </label>

              <div className="project-form-field full">
                <span>Predecessors</span>
                <div className="dependency-help inline">
                  {(draft.predecessorOptions || []).filter((option) => option.selected).length
                    ? `${(draft.predecessorOptions || []).filter((option) => option.selected).length} predecessor(s) selected.`
                    : 'No predecessors selected.'}
                </div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={onOpenPreds}
                  disabled={saving}
                >
                  Edit predecessors
                </button>
              </div>
            </>
          ) : (
            <label className="full">
              <span>Dates</span>
              <input
                type="text"
                value={
                  draft.start || draft.end
                    ? `${draft.start ? formatShortDate(draft.start) : 'No start'} - ${draft.end ? formatShortDate(draft.end) : 'No end'}`
                    : 'Dates are driven by scheduled steps'
                }
                readOnly
              />
            </label>
          )}
        </div>

        <div className="modal-actions">
          {isEditing ? (
            <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {type === 'step' ? (
            <button className="button secondary" type="button" onClick={onSaveAndNew} disabled={saving}>
              {saving ? 'Saving...' : 'Save and new'}
            </button>
          ) : null}
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : type === 'phase' ? 'Save phase' : 'Save step'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function DelayModal({ draft, saving, onChange, onClose, onSave, onDelete }) {
  if (!draft) return null;
  const isEditing = draft.mode !== 'create';
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card schedule-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Delay</p>
            <h2>{isEditing ? 'Edit delay' : 'Add delay'}</h2>
          </div>
        </div>

        <div className="project-form-grid">
          <label className="full">
            <span>Affected step</span>
            <select value={draft.stepId} onChange={(event) => onChange('stepId', event.target.value)}>
              {draft.stepOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Delay (days)</span>
            <input
              type="number"
              min="1"
              value={draft.days}
              onChange={(event) => onChange('days', event.target.value)}
            />
          </label>

          <label>
            <span>Cause</span>
            <select value={draft.cause} onChange={(event) => onChange('cause', event.target.value)}>
              <option value="Inspector">Inspector</option>
              <option value="Subcontractor">Subcontractor</option>
              <option value="Customer">Customer</option>
              <option value="Weather">Weather</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label className="full">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => onChange('description', event.target.value)}
            />
          </label>
        </div>

        <div className="modal-actions">
          {isEditing ? (
            <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Save delay' : 'Apply delay'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function DependencyModal({ draft, saving, onTogglePred, onLagChange, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card dependency-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Dependencies</p>
            <h2>Step Dependencies</h2>
            <p className="panel-copy">
              Editing: <strong>{draft.name}</strong>
            </p>
          </div>
        </div>

        <div className="dependency-help">
          <strong>Lag days</strong> offset the successor start after a predecessor finishes.
          Positive values wait extra days. Negative values allow overlap.
        </div>

        <div className="dependency-list">
          {draft.options.length ? (
            draft.options.map((option) => (
              <label key={option.id} className="dependency-option">
                <div className="dependency-option-main">
                  <input
                    type="checkbox"
                    checked={option.selected}
                    onChange={(event) => onTogglePred(option.id, event.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.dateLabel}</small>
                  </span>
                </div>
                <input
                  className="dependency-lag-input"
                  type="number"
                  value={option.lag}
                  disabled={!option.selected || saving}
                  onChange={(event) => onLagChange(option.id, event.target.value)}
                />
              </label>
            ))
          ) : (
            <div className="empty-state compact">
              <h3>No other steps in this phase</h3>
              <p>Add more steps to create dependencies in this phase.</p>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save and recalculate'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function NativeProjectsView({ data, refresh, loading, onStateChange }) {
  const [projectDraft, setProjectDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const visibleProjects = useMemo(
    () =>
      (data.projects || []).filter(
        (project) =>
          data.settings?.showSampleData !== false || !SAMPLE_IDS.projects.includes(project.id),
      ),
    [data.projects, data.settings],
  );

  const taskCountByProject = useMemo(() => {
    const counts = new Map();
    (data.tasks || []).forEach((task) => {
      counts.set(task.projectId, (counts.get(task.projectId) || 0) + 1);
    });
    return counts;
  }, [data.tasks]);

  const totals = useMemo(() => {
    const phases = visibleProjects.reduce(
      (sum, project) => sum + (project.phases?.length || 0),
      0,
    );
    const steps = visibleProjects.reduce(
      (sum, project) =>
        sum +
        (project.phases || []).reduce(
          (phaseSum, phase) => phaseSum + (phase.steps?.length || 0),
          0,
        ),
      0,
    );
    const tasks = [...taskCountByProject.values()].reduce((sum, count) => sum + count, 0);
    return { phases, steps, tasks };
  }, [taskCountByProject, visibleProjects]);

  function startCreate() {
    setProjectDraft({
      id: '',
      name: '',
      desc: '',
      start: '',
      end: '',
      budget: '',
      status: 'planning',
      manager: '',
      address: '',
      permitNumber: '',
      drNumber: '',
      block: '',
      lot: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerAddress: '',
      customerNotes: '',
      progress: 0,
      phases: [],
    });
  }

  function startEdit(project) {
    setProjectDraft({
      id: project.id,
      name: project.name || '',
      desc: project.desc || '',
      start: project.start || '',
      end: project.end || '',
      budget: project.budget || 0,
      status: project.status || 'planning',
      manager: project.manager || '',
      address: project.address || '',
      permitNumber: project.permitNumber || '',
      drNumber: project.drNumber || '',
      block: project.block || '',
      lot: project.lot || '',
      customerName: project.customerName || '',
      customerPhone: project.customerPhone || '',
      customerEmail: project.customerEmail || '',
      customerAddress: project.customerAddress || '',
      customerNotes: project.customerNotes || '',
      progress: project.progress ?? 0,
      phases: project.phases || [],
    });
  }

  async function runProjectMutation(mutation) {
    setSaving(true);
    try {
      const nextState = await mutation();
      onStateChange(nextState);
      setProjectDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProject() {
    if (!projectDraft?.name.trim()) return;
    if (projectDraft.id) {
      await runProjectMutation(() => updateProject(data, projectDraft.id, projectDraft));
      return;
    }
    await runProjectMutation(() => createProject(data, projectDraft));
  }

  async function handleDeleteProject() {
    if (!projectDraft?.id) return;
    const confirmed = window.confirm(`Delete "${projectDraft.name}" and its tasks?`);
    if (!confirmed) return;
    await runProjectMutation(() => deleteProject(data, projectDraft.id));
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>Projects Dashboard</h2>
        </div>
        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
            {loading ? 'Refreshing...' : 'Refresh data'}
          </button>
          <button className="button primary" type="button" onClick={startCreate}>
            New project
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <DashboardStat label="Projects" value={visibleProjects.length} tone="brand" />
        <DashboardStat label="Phases" value={totals.phases} />
        <DashboardStat label="Steps" value={totals.steps} />
        <DashboardStat label="Tasks" value={totals.tasks} />
      </div>

      {visibleProjects.length ? (
        <div className="project-grid">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              taskCount={taskCountByProject.get(project.id) || 0}
              onEdit={startEdit}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No projects loaded</h3>
          <p>Connect Supabase or create your first project to populate this view.</p>
        </div>
      )}
      {projectDraft ? (
        <ProjectModal
          draft={projectDraft}
          onChange={(field, value) => setProjectDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setProjectDraft(null)}
          onSave={handleSaveProject}
          onDelete={handleDeleteProject}
          saving={saving}
          isEditing={!!projectDraft.id}
        />
      ) : null}
    </section>
  );
}

function TaskRow({
  projectName,
  task,
  editingTaskId,
  editDraft,
  onEditStart,
  onEditCancel,
  onEditDraftChange,
  onEditSave,
  onToggle,
  onDelete,
  saving,
}) {
  const overdue = isOverdue(task.due, task.done);
  const isEditing = editingTaskId === task.id;

  if (isEditing) {
    return (
      <article className="task-row-card task-row-editing">
        <div className="task-edit-grid">
          <input
            className="task-input"
            value={editDraft.label}
            onChange={(event) => onEditDraftChange('label', event.target.value)}
            placeholder="Task name"
          />
          <input
            className="task-input"
            type="date"
            value={editDraft.due}
            onChange={(event) => onEditDraftChange('due', event.target.value)}
          />
          <div className="task-row-actions">
            <button className="button primary" type="button" onClick={() => onEditSave(task)} disabled={saving}>
              Save
            </button>
            <button className="button secondary" type="button" onClick={onEditCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={`task-row-card${task.done ? ' done' : ''}${overdue ? ' overdue' : ''}`}>
      <label className="task-main">
        <input
          type="checkbox"
          checked={!!task.done}
          onChange={(event) => onToggle(task, event.target.checked)}
          disabled={saving}
        />
        <span className="task-main-copy">
          <strong>{task.label}</strong>
          <small>{projectName || 'No project assigned'}</small>
        </span>
      </label>

      <div className="task-meta">
        {task.due ? (
          <span className={`task-due-chip${overdue ? ' overdue' : ''}`}>
            {overdue ? 'Overdue | ' : ''}
            {formatShortDate(task.due)}
          </span>
        ) : (
          <span className="task-due-chip">No due date</span>
        )}
      </div>

      <div className="task-row-actions">
        <button className="button secondary" type="button" onClick={() => onEditStart(task)} disabled={saving}>
          Edit
        </button>
        <button className="button secondary danger" type="button" onClick={() => onDelete(task)} disabled={saving}>
          Delete
        </button>
      </div>
    </article>
  );
}

function NativeFilesView({ data, refresh, loading, onStateChange }) {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [saving, setSaving] = useState(false);
  const [fileNameDrafts, setFileNameDrafts] = useState({});
  const [storageNotice, setStorageNotice] = useState('');
  const [moveFileDraft, setMoveFileDraft] = useState(null);
  const fileInputRefs = useRef({});
  const replaceFileInputRefs = useRef({});

  const visibleProjects = useMemo(
    () =>
      (data.projects || []).filter(
        (project) => data.settings?.showSampleData !== false || !SAMPLE_IDS.projects.includes(project.id),
      ),
    [data.projects, data.settings],
  );

  useEffect(() => {
    if (!visibleProjects.length) {
      setSelectedProjectId('');
      return;
    }
    if (!visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0].id);
    }
  }, [selectedProjectId, visibleProjects]);

  const selectedProject = visibleProjects.find((project) => project.id === selectedProjectId) || null;
  const folders = selectedProject?.files?.folders || [];
  const fileCount = folders.reduce((sum, folder) => sum + (folder.files?.length || 0), 0);
  const flatFiles = useMemo(
    () =>
      folders.flatMap((folder) =>
        (folder.files || []).map((file) => ({
          ...file,
          folderId: folder.id,
          folderName: folder.name,
        })),
      ),
    [folders],
  );

  async function runFilesMutation(projectId, buildNextProject) {
    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === projectId);
      if (!project) return;
      const nextProject = buildNextProject(project);
      const nextState = await updateProject(data, projectId, nextProject);
      onStateChange(nextState);
    } finally {
      setSaving(false);
    }
  }

  function promptForFolder() {
    if (!selectedProject) return;
    const name = window.prompt('Folder name');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const duplicate = folders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      window.alert('A folder with that name already exists for this project.');
      return;
    }
    void runFilesMutation(selectedProject.id, (project) => ({
      ...project,
      files: {
        folders: [
          ...(project.files?.folders || []),
          {
            id: `folder-${Date.now()}`,
            name: trimmed,
            files: [],
          },
        ],
      },
    }));
  }

  async function renameFolder(folderId) {
    if (!selectedProject) return;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const name = window.prompt('Folder name', folder.name);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const duplicate = folders.some(
      (item) => item.id !== folderId && item.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      window.alert('A folder with that name already exists for this project.');
      return;
    }
    await runFilesMutation(selectedProject.id, (project) => ({
      ...project,
      files: {
        folders: (project.files?.folders || []).map((item) =>
          item.id === folderId
            ? {
                ...item,
                name: trimmed,
              }
            : item,
        ),
      },
    }));
  }

  async function deleteFolder(folderId) {
    if (!selectedProject) return;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const fileCountInFolder = folder.files?.length || 0;
    const confirmed = window.confirm(
      fileCountInFolder
        ? `Delete folder "${folder.name}" and its ${fileCountInFolder} file(s)? This cannot be undone.`
        : `Delete folder "${folder.name}"?`,
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      for (const file of folder.files || []) {
        if (file?.storagePath) {
          await deleteProjectFileFromStorage(file);
        }
      }
      const project = data.projects.find((item) => item.id === selectedProject.id);
      if (!project) return;
      const nextProject = {
        ...project,
        files: {
          folders: (project.files?.folders || []).filter((item) => item.id !== folderId),
        },
      };
      const nextState = await updateProject(data, selectedProject.id, nextProject);
      onStateChange(nextState);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete folder.');
    } finally {
      setSaving(false);
    }
  }

  function triggerFolderUpload(folderId) {
    fileInputRefs.current[folderId]?.click();
  }

  function triggerReplaceFile(fileId) {
    replaceFileInputRefs.current[fileId]?.click();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: '',
          originalName: file.name,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toISOString(),
          dataUrl: String(reader.result || ''),
        });
      reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function createProjectFileRecord(projectId, folderId, file) {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (isSupabaseStorageConfigured()) {
      try {
        const storageMeta = await uploadProjectFileToStorage(projectId, folderId, fileId, file);
        return {
          fileRecord: {
            id: fileId,
            name: '',
            originalName: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: new Date().toISOString(),
            ...storageMeta,
            dataUrl: '',
          },
          usedFallback: false,
        };
      } catch {
        // Fall back to inline storage so uploads still work if the bucket/policies are not ready.
      }
    }

    const inlineFile = await readFileAsDataUrl(file);
    return {
      fileRecord: {
        ...inlineFile,
        id: fileId,
        storageProvider: 'inline',
        storageBucket: '',
        storagePath: '',
      },
      usedFallback: true,
    };
  }

  async function handleFolderUpload(projectId, folderId, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setSaving(true);
    try {
      const uploadResults = await Promise.all(files.map((file) => createProjectFileRecord(projectId, folderId, file)));
      const uploads = uploadResults.map((result) => result.fileRecord);
      const usedFallback = uploadResults.some((result) => result.usedFallback);
      if (usedFallback) {
        setStorageNotice(
          isSupabaseStorageConfigured()
            ? 'Supabase Storage is not fully ready, so one or more files were saved locally in project data instead.'
            : 'Supabase Storage is not configured, so files are being saved locally in project data.',
        );
      } else {
        setStorageNotice('');
      }
      const project = data.projects.find((item) => item.id === projectId);
      if (!project) return;
      const nextProject = {
        ...project,
        files: {
          folders: (project.files?.folders || []).map((folder) =>
            folder.id === folderId
              ? {
                  ...folder,
                  files: [...(folder.files || []), ...uploads],
                }
              : folder,
          ),
        },
      };
      const nextState = await updateProject(data, projectId, nextProject);
      onStateChange(nextState);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to upload file.');
    } finally {
      const input = fileInputRefs.current[folderId];
      if (input) input.value = '';
      setSaving(false);
    }
  }

  async function handleReplaceFile(projectId, folderId, existingFile, fileList) {
    const replacement = Array.from(fileList || [])[0];
    if (!replacement || !existingFile) return;

    setSaving(true);
    try {
      const uploadResult = await createProjectFileRecord(projectId, folderId, replacement);
      const nextFile = {
        ...existingFile,
        ...uploadResult.fileRecord,
        id: existingFile.id,
        name: existingFile.name || uploadResult.fileRecord.name,
      };

      if (existingFile?.storagePath) {
        await deleteProjectFileFromStorage(existingFile);
      }

      const project = data.projects.find((item) => item.id === projectId);
      if (!project) return;
      const nextProject = {
        ...project,
        files: {
          folders: (project.files?.folders || []).map((folder) =>
            folder.id === folderId
              ? {
                  ...folder,
                  files: (folder.files || []).map((file) => (file.id === existingFile.id ? nextFile : file)),
                }
              : folder,
          ),
        },
      };
      const nextState = await updateProject(data, projectId, nextProject);
      onStateChange(nextState);
      if (uploadResult.usedFallback) {
        setStorageNotice(
          isSupabaseStorageConfigured()
            ? 'Supabase Storage is not fully ready, so one or more files were saved locally in project data instead.'
            : 'Supabase Storage is not configured, so files are being saved locally in project data.',
        );
      } else {
        setStorageNotice('');
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to replace file.');
    } finally {
      const input = replaceFileInputRefs.current[existingFile.id];
      if (input) input.value = '';
      setSaving(false);
    }
  }

  function downloadProjectFile(file) {
    void (async () => {
      try {
        let objectUrl = '';
        if (file?.storagePath && file?.storageBucket) {
          const blob = await downloadProjectFileFromStorage(file);
          objectUrl = URL.createObjectURL(blob);
        } else if (file?.dataUrl) {
          objectUrl = file.dataUrl;
        } else {
          return;
        }

        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = file.originalName || file.name || 'download';
        anchor.click();

        if (file?.storagePath && objectUrl.startsWith('blob:')) {
          setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Failed to open file.');
      }
    })();
  }

  function updateFileNameDraft(fileId, value) {
    setFileNameDrafts((current) => ({
      ...current,
      [fileId]: value,
    }));
  }

  function persistFileName(projectId, folderId, fileId, fallbackValue = '') {
    const nextName = String(fileNameDrafts[fileId] ?? fallbackValue ?? '').trim();
    void runFilesMutation(projectId, (project) => ({
      ...project,
      files: {
        folders: (project.files?.folders || []).map((folder) =>
          folder.id === folderId
            ? {
                ...folder,
                files: (folder.files || []).map((file) =>
                  file.id === fileId
                    ? {
                        ...file,
                        name: nextName,
                      }
                    : file,
                ),
              }
            : folder,
        ),
      },
    }));
    setFileNameDrafts((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
  }

  function deleteProjectFile(projectId, folderId, fileId) {
    const confirmed = window.confirm('Delete this file?');
    if (!confirmed) return;
    void (async () => {
      setSaving(true);
      try {
        const project = data.projects.find((item) => item.id === projectId);
        if (!project) return;
        const targetFolder = (project.files?.folders || []).find((folder) => folder.id === folderId);
        const targetFile = targetFolder?.files?.find((file) => file.id === fileId);
        if (targetFile?.storagePath) {
          await deleteProjectFileFromStorage(targetFile);
        }
        const nextProject = {
          ...project,
          files: {
            folders: (project.files?.folders || []).map((folder) =>
              folder.id === folderId
                ? {
                    ...folder,
                    files: (folder.files || []).filter((file) => file.id !== fileId),
                  }
                : folder,
            ),
          },
        };
        const nextState = await updateProject(data, projectId, nextProject);
        onStateChange(nextState);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Failed to delete file.');
      } finally {
        setSaving(false);
      }
    })();
  }

  function openMoveFile(file, sourceFolderId) {
    setMoveFileDraft({
      projectId: selectedProject?.id || '',
      sourceFolderId,
      targetFolderId: sourceFolderId,
      fileId: file.id,
      fileName: file.name || '',
      originalName: file.originalName || '',
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    });
  }

  function updateMoveFileDraft(targetFolderId) {
    setMoveFileDraft((current) => (current ? { ...current, targetFolderId } : current));
  }

  function moveProjectFile(projectId, sourceFolderId, targetFolderId, fileId) {
    if (!targetFolderId || targetFolderId === sourceFolderId) return;
    void runFilesMutation(projectId, (project) => {
      const sourceFolder = (project.files?.folders || []).find((folder) => folder.id === sourceFolderId);
      const targetFolder = (project.files?.folders || []).find((folder) => folder.id === targetFolderId);
      const fileToMove = sourceFolder?.files?.find((file) => file.id === fileId);
      if (!sourceFolder || !targetFolder || !fileToMove) return project;

      return {
        ...project,
        files: {
          folders: (project.files?.folders || []).map((folder) => {
            if (folder.id === sourceFolderId) {
              return {
                ...folder,
                files: (folder.files || []).filter((file) => file.id !== fileId),
              };
            }
            if (folder.id === targetFolderId) {
              return {
                ...folder,
                files: [...(folder.files || []), fileToMove],
              };
            }
            return folder;
          }),
        },
      };
    });
    setMoveFileDraft(null);
  }

  function saveMoveFile() {
    if (!moveFileDraft) return;
    moveProjectFile(
      moveFileDraft.projectId,
      moveFileDraft.sourceFolderId,
      moveFileDraft.targetFolderId,
      moveFileDraft.fileId,
    );
  }

  function renderFolderActions(folder, includeUpload = false) {
    return (
      <div className="panel-actions">
        {includeUpload ? (
          <>
            <input
              ref={(node) => {
                if (node) fileInputRefs.current[folder.id] = node;
              }}
              className="visually-hidden"
              type="file"
              multiple
              onChange={(event) => handleFolderUpload(selectedProject.id, folder.id, event.target.files)}
            />
            <button
              className="button secondary gantt-icon-button"
              type="button"
              onClick={() => triggerFolderUpload(folder.id)}
              disabled={saving}
              title="Upload files"
              aria-label={`Upload files to folder ${folder.name}`}
            >
              <img
                className="icon-image"
                src="/file-upload-icon.png"
                alt=""
                aria-hidden="true"
              />
            </button>
          </>
        ) : null}
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => void renameFolder(folder.id)}
          disabled={saving}
          title="Rename folder"
          aria-label={`Rename folder ${folder.name}`}
        >
          <span aria-hidden="true">&#9998;</span>
        </button>
        <button
          className="button secondary gantt-icon-button gantt-trash-button"
          type="button"
          onClick={() => void deleteFolder(folder.id)}
          disabled={saving}
          title="Delete folder"
          aria-label={`Delete folder ${folder.name}`}
        >
          <span aria-hidden="true">&#128465;</span>
        </button>
      </div>
    );
  }

  function renderFileActions(file, folderId) {
    return (
      <div className="files-list-actions">
        <input
          ref={(node) => {
            if (node) replaceFileInputRefs.current[file.id] = node;
          }}
          className="visually-hidden"
          type="file"
          onChange={(event) =>
            handleReplaceFile(selectedProject.id, folderId, file, event.target.files)
          }
        />
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => downloadProjectFile(file)}
          title="Download file"
          aria-label={`Download ${file.name || file.originalName || 'file'}`}
        >
          <img
            className="icon-image"
            src="/file-download-icon.png"
            alt=""
            aria-hidden="true"
          />
        </button>
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => triggerReplaceFile(file.id)}
          disabled={saving}
          title="Replace file"
          aria-label={`Replace ${file.name || file.originalName || 'file'}`}
        >
          <span aria-hidden="true">&#9998;</span>
        </button>
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => openMoveFile(file, folderId)}
          disabled={saving || folders.length < 2}
          title={folders.length < 2 ? 'Add another folder to move files' : 'Move file'}
          aria-label={`Move ${file.name || file.originalName || 'file'}`}
        >
          <img
            className="icon-image"
            src="/file-move-icon.png"
            alt=""
            aria-hidden="true"
          />
        </button>
        <button
          className="button secondary gantt-icon-button gantt-trash-button"
          type="button"
          onClick={() => deleteProjectFile(selectedProject.id, folderId, file.id)}
          disabled={saving}
          title="Delete file"
          aria-label={`Delete ${file.name || file.originalName || 'file'}`}
        >
          <span aria-hidden="true">&#128465;</span>
        </button>
      </div>
    );
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>Files</h2>
        </div>
        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
            {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
          </button>
          <button
            className="button primary"
            type="button"
            onClick={promptForFolder}
            disabled={saving || !selectedProject}
          >
            Add folder
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <DashboardStat label="Projects" value={visibleProjects.length} tone="brand" />
        <DashboardStat label="Folders" value={folders.length} />
        <DashboardStat label="Files" value={fileCount} />
      </div>

      {storageNotice || !isSupabaseStorageConfigured() ? (
        <section className="storage-banner">
          <strong>Files storage notice.</strong>
          <span>
            {storageNotice ||
              'Supabase Storage is not configured yet, so uploaded files are being stored locally in project data.'}
          </span>
        </section>
      ) : null}

      {visibleProjects.length ? (
        <>
          <div className="files-toolbar">
            <label className="task-filter">
              <span>Project</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                {visibleProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="people-view-toggle" role="tablist" aria-label="Files view">
              <button
                className={`people-toggle-button${viewMode === 'cards' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('cards')}
              >
                Cards
              </button>
              <button
                className={`people-toggle-button${viewMode === 'list' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('list')}
              >
                List
              </button>
            </div>
          </div>

          {selectedProject ? (
            viewMode === 'cards' ? (
            <div className="files-folder-grid">
              {folders.map((folder) => {
                const isDefault = DEFAULT_PROJECT_FILE_FOLDERS.includes(folder.name);
                return (
                  <article key={folder.id} className="files-folder-card">
                    <div className="files-folder-header">
                      <div>
                        <h3>{folder.name}</h3>
                        <p>{folder.files?.length || 0} file(s){isDefault ? ' • Standard folder' : ''}</p>
                      </div>
                      {renderFolderActions(folder, true)}
                    </div>

                    {folder.files?.length ? (
                      <div className="files-list">
                        {folder.files.map((file) => (
                          <div key={file.id} className="files-list-row">
                            <div className="files-list-copy">
                              <input
                                className="files-name-input"
                                type="text"
                                value={fileNameDrafts[file.id] ?? file.name ?? ''}
                                placeholder="Enter file name"
                                onChange={(event) => updateFileNameDraft(file.id, event.target.value)}
                                onBlur={() => persistFileName(selectedProject.id, folder.id, file.id, file.name)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              <small>
                                {file.originalName || 'No uploaded filename'}
                                {file.size ? ` • ${formatFileSize(file.size)}` : ''}
                                {file.uploadedAt ? ` • ${new Date(file.uploadedAt).toLocaleDateString('en-US')}` : ''}
                              </small>
                            </div>
                            {renderFileActions(file, folder.id)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state compact">
                        <h3>No files yet</h3>
                        <p>Upload project documents here for {folder.name.toLowerCase()}.</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            ) : flatFiles.length ? (
              <div className="files-hierarchy" role="tree" aria-label="Project files hierarchy">
                {folders.map((folder) => (
                  <div key={folder.id} className="files-hierarchy-folder" role="treeitem" aria-expanded="true">
                    <div className="files-hierarchy-folder-row">
                      <div className="files-hierarchy-folder-copy">
                        <strong>{folder.name}</strong>
                        <small>{folder.files?.length || 0} file(s)</small>
                      </div>
                      {renderFolderActions(folder, true)}
                    </div>

                    {folder.files?.length ? (
                      <div className="files-hierarchy-children" role="group">
                        {folder.files.map((file) => (
                          <div key={file.id} className="files-hierarchy-file-row" role="treeitem">
                            <div className="files-hierarchy-file-copy">
                              <strong>{file.name || 'Untitled file'}</strong>
                              <small>
                                {file.originalName || 'No uploaded filename'}
                                {file.size ? ` • ${formatFileSize(file.size)}` : ''}
                                {file.uploadedAt ? ` • ${new Date(file.uploadedAt).toLocaleDateString('en-US')}` : ''}
                              </small>
                            </div>
                            {renderFileActions(file, folder.id)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state compact">
                        <h3>No files in this folder</h3>
                        <p>Upload a file to populate this folder.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <h3>No files yet</h3>
                <p>Upload your first project document to populate the list view.</p>
              </div>
            )
          ) : (
            <div className="empty-state compact">
              <h3>No project selected</h3>
              <p>Choose a project to manage its files.</p>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h3>No projects loaded</h3>
          <p>Create a project first, then upload files into Plans, Permits, Surveys, Selections, or your own folders.</p>
        </div>
      )}
      <MoveFileModal
        draft={moveFileDraft}
        saving={saving}
        onChange={updateMoveFileDraft}
        onClose={() => setMoveFileDraft(null)}
        onSave={saveMoveFile}
      />
    </section>
  );
}

function NativeTasksView({ data, onStateChange, refresh, loading }) {
  const [filter, setFilter] = useState('all');
  const [newTask, setNewTask] = useState({ label: '', projectId: '', due: '' });
  const [editingTaskId, setEditingTaskId] = useState('');
  const [editDraft, setEditDraft] = useState({ label: '', due: '' });
  const [saving, setSaving] = useState(false);

  const visibleProjects = useMemo(
    () =>
      (data.projects || []).filter(
        (project) =>
          data.settings?.showSampleData !== false || !SAMPLE_IDS.projects.includes(project.id),
      ),
    [data.projects, data.settings],
  );

  const visibleTasks = useMemo(
    () =>
      (data.tasks || []).filter(
        (task) => data.settings?.showSampleData !== false || !SAMPLE_IDS.tasks.includes(task.id),
      ),
    [data.tasks, data.settings],
  );

  const projectMap = useMemo(
    () => new Map(visibleProjects.map((project) => [project.id, project])),
    [visibleProjects],
  );

  const filteredTasks = useMemo(() => {
    const tasks = filter === 'all' ? visibleTasks : visibleTasks.filter((task) => task.projectId === filter);
    return [...tasks].sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      const aKey = a.due || '9999-12-31';
      const bKey = b.due || '9999-12-31';
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [filter, visibleTasks]);

  const totals = useMemo(
    () => ({
      total: visibleTasks.length,
      open: visibleTasks.filter((task) => !task.done).length,
      overdue: visibleTasks.filter((task) => isOverdue(task.due, task.done)).length,
    }),
    [visibleTasks],
  );

  async function runTaskMutation(mutation) {
    setSaving(true);
    try {
      const nextState = await mutation();
      onStateChange(nextState);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (!newTask.label.trim()) return;

    await runTaskMutation(() => createTask(data, newTask));
    setNewTask({ label: '', projectId: '', due: '' });
  }

  async function handleToggle(task, done) {
    await runTaskMutation(() => updateTask(data, task.id, { done }));
  }

  function handleEditStart(task) {
    setEditingTaskId(task.id);
    setEditDraft({ label: task.label, due: task.due || '' });
  }

  function handleEditCancel() {
    setEditingTaskId('');
    setEditDraft({ label: '', due: '' });
  }

  async function handleEditSave(task) {
    if (!editDraft.label.trim()) return;
    await runTaskMutation(() =>
      updateTask(data, task.id, {
        label: editDraft.label.trim(),
        due: editDraft.due,
      }),
    );
    handleEditCancel();
  }

  async function handleDelete(task) {
    const confirmed = window.confirm(`Delete "${task.label}"?`);
    if (!confirmed) return;
    await runTaskMutation(() => deleteTask(data, task.id));
    if (editingTaskId === task.id) handleEditCancel();
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>Tasks</h2>
        </div>
        <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
          {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
        </button>
      </div>

      <div className="metrics-grid">
        <DashboardStat label="All tasks" value={totals.total} tone="brand" />
        <DashboardStat label="Open" value={totals.open} />
        <DashboardStat label="Overdue" value={totals.overdue} />
        <DashboardStat label="Projects" value={visibleProjects.length} />
      </div>

      <form className="task-create-panel" onSubmit={handleCreateTask}>
        <div className="task-create-grid">
          <input
            className="task-input"
            placeholder="Task name"
            value={newTask.label}
            onChange={(event) => setNewTask((current) => ({ ...current, label: event.target.value }))}
          />
          <select
            className="task-input"
            value={newTask.projectId}
            onChange={(event) => setNewTask((current) => ({ ...current, projectId: event.target.value }))}
          >
            <option value="">Project...</option>
            {visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <input
            className="task-input"
            type="date"
            value={newTask.due}
            onChange={(event) => setNewTask((current) => ({ ...current, due: event.target.value }))}
          />
          <button className="button primary" type="submit" disabled={saving}>
            Add task
          </button>
        </div>
      </form>

      <div className="task-toolbar">
        <label className="task-filter">
          <span>Filter by project</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All projects</option>
            {visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="task-list">
        {filteredTasks.length ? (
          filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={projectMap.get(task.projectId)?.name}
              editingTaskId={editingTaskId}
              editDraft={editDraft}
              onEditStart={handleEditStart}
              onEditCancel={handleEditCancel}
              onEditDraftChange={(field, value) =>
                setEditDraft((current) => ({ ...current, [field]: value }))
              }
              onEditSave={handleEditSave}
              onToggle={handleToggle}
              onDelete={handleDelete}
              saving={saving}
            />
          ))
        ) : (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p>Create a task above or switch the project filter to see more items.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function PersonCard({ person, type, onEdit, onDelete, saving }) {
  const tags = splitTags(person.tags);
  const name = personNameOnly(person);
  const header = person.company || name || 'Unnamed';
  const secondary = person.company
    ? name || person.role || (type === 'sub' ? 'Subcontractor' : 'Employee')
    : person.role || (type === 'sub' ? 'Subcontractor' : 'Employee');

  return (
    <article className="person-card">
      <div className="person-card-top">
        <div className="person-card-header">
          <div className="person-avatar">{personInitials(person)}</div>
          <div>
            <h3>{header}</h3>
            <p className="person-subtitle">{secondary}</p>
          </div>
        </div>
        <div className="task-row-actions person-card-actions">
          <button
            className="button secondary gantt-icon-button"
            type="button"
            onClick={() => onEdit(person)}
            disabled={saving}
            aria-label={`Edit ${personDisplayName(person)}`}
            title="Edit"
          >
            <span aria-hidden="true">&#9998;</span>
          </button>
          <button
            className="button secondary gantt-icon-button person-delete-button"
            type="button"
            onClick={() => onDelete(person)}
            disabled={saving}
            aria-label={`Delete ${personDisplayName(person)}`}
            title="Delete"
          >
            <span aria-hidden="true">&#128465;</span>
          </button>
        </div>
      </div>

      <dl className="person-details">
        {type === 'sub' && person.company && (person.first || person.last) ? (
          <div>
            <dt>Company</dt>
            <dd>{person.company}</dd>
          </div>
        ) : null}
        <div className="person-detail-full">
          <dt>Phone</dt>
          <dd>
            {person.phone ? (
              <a href={`tel:${person.phone}`}>{person.phone}</a>
            ) : (
              <span className="person-empty-value">Not provided</span>
            )}
          </dd>
        </div>
        <div className="person-detail-full">
          <dt>Email</dt>
          <dd>
            {person.email ? (
              <a href={`mailto:${person.email}`}>{person.email}</a>
            ) : (
              <span className="person-empty-value">Not provided</span>
            )}
          </dd>
        </div>
        {person.license ? (
          <div>
            <dt>{type === 'sub' ? 'License' : 'Credential'}</dt>
            <dd>{person.license}</dd>
          </div>
        ) : null}
        {person.notes ? (
          <div className="person-detail-full">
            <dt>Notes</dt>
            <dd>{person.notes}</dd>
          </div>
        ) : null}
      </dl>

      {tags.length ? (
        <div className="person-tags">
          {tags.map((tag) => (
            <span key={tag} className="person-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PersonModal({ draft, type, isEditing, saving, onChange, onClose, onSave, onDelete }) {
  const title = isEditing
    ? type === 'sub'
      ? 'Edit subcontractor'
      : 'Edit employee'
    : type === 'sub'
      ? 'Add subcontractor'
      : 'Add employee';

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Person</p>
            <h2>{title}</h2>
          </div>
        </div>

        <div className="project-form-grid">
          <label>
            <span>First name</span>
            <input value={draft.first} onChange={(event) => onChange('first', event.target.value)} />
          </label>
          <label>
            <span>Last name</span>
            <input value={draft.last} onChange={(event) => onChange('last', event.target.value)} />
          </label>
          <label>
            <span>Company</span>
            <input value={draft.company} onChange={(event) => onChange('company', event.target.value)} />
          </label>
          <label>
            <span>Role</span>
            <input value={draft.role} onChange={(event) => onChange('role', event.target.value)} />
          </label>
          <label>
            <span>Phone</span>
            <input value={draft.phone} onChange={(event) => onChange('phone', event.target.value)} />
          </label>
          <label>
            <span>Email</span>
            <input value={draft.email} onChange={(event) => onChange('email', event.target.value)} />
          </label>
          <label>
            <span>{type === 'sub' ? 'License' : 'Credential'}</span>
            <input value={draft.license} onChange={(event) => onChange('license', event.target.value)} />
          </label>
          <label>
            <span>Tags</span>
            <input
              value={draft.tags}
              onChange={(event) => onChange('tags', event.target.value)}
              placeholder="Safety, HVAC, Estimating"
            />
          </label>
          <label className="full">
            <span>Notes</span>
            <textarea value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} />
          </label>
        </div>

        <div className="modal-actions">
          {isEditing ? (
            <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : type === 'sub' ? 'Save subcontractor' : 'Save employee'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function PeopleListTable({ people, type, columns, boldColumns, onEdit, onDelete, saving }) {
  const activeColumnIds = Array.isArray(columns) && columns.length
    ? columns
    : DEFAULT_PEOPLE_LIST_COLUMNS;
  const activeColumns = activeColumnIds
    .map((columnId) => PEOPLE_LIST_COLUMN_DEFS.find((column) => column.id === columnId))
    .filter(Boolean);
  const [columnWidths, setColumnWidths] = useState(() =>
    Object.fromEntries(PEOPLE_LIST_COLUMN_DEFS.map((column) => [column.id, column.width])),
  );
  const resizeStateRef = useRef(null);
  const gridTemplateColumns = `${activeColumns
    .map((column) => `${Math.max(140, columnWidths[column.id] || column.width)}px`)
    .join(' ')} ${PEOPLE_LIST_ACTIONS_WIDTH}px`;
  const boldColumnSet = new Set(Array.isArray(boldColumns) ? boldColumns : ['name']);

  useEffect(() => {
    setColumnWidths((current) => {
      const next = { ...current };
      PEOPLE_LIST_COLUMN_DEFS.forEach((column) => {
        if (!Number.isFinite(next[column.id])) next[column.id] = column.width;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    function handlePointerMove(event) {
      if (!resizeStateRef.current) return;
      const { columnId, startX, startWidth } = resizeStateRef.current;
      const delta = event.clientX - startX;
      setColumnWidths((current) => ({
        ...current,
        [columnId]: Math.max(140, Math.round(startWidth + delta)),
      }));
    }

    function handlePointerUp() {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  function beginColumnResize(event, columnId) {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId] || DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS[columnId] || 180,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function getValue(person, columnId) {
    if (columnId === 'name') return `${person.first || ''} ${person.last || ''}`.trim() || 'Not provided';
    if (columnId === 'company') return person.company || 'Not provided';
    if (columnId === 'role') return person.role || 'Not provided';
    if (columnId === 'phone') return person.phone || 'Not provided';
    if (columnId === 'email') return person.email || 'Not provided';
    if (columnId === 'tags') {
      const tags = splitTags(person.tags);
      return tags.length ? tags.join(', ') : 'Not provided';
    }
    return 'Not provided';
  }

  return (
    <div className="people-list" role="table" aria-label={type === 'sub' ? 'Subcontractors list' : 'Employees list'}>
      <div className="people-list-header" role="row" style={{ gridTemplateColumns }}>
        {activeColumns.map((column) => (
          <span key={column.id} className="people-list-header-cell">
            <span>{column.label}</span>
            <button
              className="people-column-resizer"
              type="button"
              onPointerDown={(event) => beginColumnResize(event, column.id)}
              aria-label={`Resize ${column.label} column`}
              title={`Resize ${column.label}`}
            />
          </span>
        ))}
        <span>Actions</span>
      </div>
      {people.map((person) => (
        <div key={person.id} className="people-list-row" role="row" style={{ gridTemplateColumns }}>
          {activeColumns.map((column) => (
            <span key={column.id}>
              {column.id === 'email' && person.email ? (
                <a href={`mailto:${person.email}`}>{person.email}</a>
              ) : boldColumnSet.has(column.id) ? (
                <strong>{getValue(person, column.id)}</strong>
              ) : (
                getValue(person, column.id)
              )}
            </span>
          ))}
          <span className="people-list-actions people-list-actions-cell">
            <button
              className="button secondary gantt-icon-button"
              type="button"
              onClick={() => onEdit(person)}
              disabled={saving}
              aria-label={`Edit ${personDisplayName(person)}`}
              title="Edit"
            >
              <span aria-hidden="true">&#9998;</span>
            </button>
            <button
              className="button secondary gantt-icon-button person-delete-button"
              type="button"
              onClick={() => onDelete(person)}
              disabled={saving}
              aria-label={`Delete ${personDisplayName(person)}`}
              title="Delete"
            >
              <span aria-hidden="true">&#128465;</span>
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function NativePeopleView({ data, onStateChange, refresh, loading }) {
  const [personType, setPersonType] = useState('sub');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [personDraft, setPersonDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const importInputRef = useRef(null);

  const visibleSubs = useMemo(
    () =>
      (data.subs || []).filter(
        (person) => data.settings?.showSampleData !== false || !SAMPLE_IDS.subs.includes(person.id),
      ),
    [data.subs, data.settings],
  );

  const visibleEmployees = useMemo(
    () =>
      (data.employees || []).filter(
        (person) =>
          data.settings?.showSampleData !== false || !SAMPLE_IDS.employees.includes(person.id),
      ),
    [data.employees, data.settings],
  );

  const visiblePeople = personType === 'sub' ? visibleSubs : visibleEmployees;
  const peopleListColumns = useMemo(() => {
    const configured = Array.isArray(data.settings?.peopleListColumns) ? data.settings.peopleListColumns : [];
    const validConfigured = configured.filter((columnId) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId),
    );
    const missing = DEFAULT_PEOPLE_LIST_COLUMNS.filter((columnId) => !validConfigured.includes(columnId));
    return [...validConfigured, ...missing];
  }, [data.settings]);
  const peopleListBoldColumns = useMemo(() => {
    const configured = Array.isArray(data.settings?.peopleListBoldColumns) ? data.settings.peopleListBoldColumns : ['name'];
    return configured.filter((columnId) => PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId));
  }, [data.settings]);

  const filteredPeople = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return [...visiblePeople]
      .filter((person) => {
        if (!lowered) return true;
        return [personDisplayName(person), person.company, person.role, ...splitTags(person.tags)]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(lowered));
      })
      .sort((a, b) => {
        const aKey = personType === 'sub' ? a.company || personDisplayName(a) : personDisplayName(a);
        const bKey = personType === 'sub' ? b.company || personDisplayName(b) : personDisplayName(b);
        return aKey.localeCompare(bKey);
      });
  }, [personType, query, visiblePeople]);

  const totals = useMemo(
    () => ({
      subs: visibleSubs.length,
      employees: visibleEmployees.length,
      withEmail: [...visibleSubs, ...visibleEmployees].filter((person) => person.email).length,
      tagged: [...visibleSubs, ...visibleEmployees].filter((person) => splitTags(person.tags).length).length,
    }),
    [visibleEmployees, visibleSubs],
  );

  function startCreate(nextType = personType) {
    setPersonType(nextType);
    setPersonDraft({
      id: '',
      first: '',
      last: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      license: '',
      notes: '',
      tags: '',
      type: nextType,
    });
  }

  function startEdit(person) {
    setPersonDraft({
      id: person.id,
      first: person.first || '',
      last: person.last || '',
      company: person.company || '',
      role: person.role || '',
      phone: person.phone || '',
      email: person.email || '',
      license: person.license || '',
      notes: person.notes || '',
      tags: splitTags(person.tags).join(', '),
      type: personType,
    });
  }

  async function runPeopleMutation(mutation) {
    setSaving(true);
    try {
      const nextState = await mutation();
      onStateChange(nextState);
      setPersonDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePerson() {
    if (!personDraft) return;
    if (!personDraft.first.trim() && !personDraft.last.trim() && !personDraft.company.trim()) return;

    if (personDraft.id) {
      await runPeopleMutation(() => updatePerson(data, personDraft.type, personDraft.id, personDraft));
      return;
    }

    await runPeopleMutation(() => createPerson(data, personDraft.type, personDraft));
  }

  async function handleDeletePerson(person) {
    const label = personDisplayName(person);
    const confirmed = window.confirm(`Delete "${label}"?`);
    if (!confirmed) return;
    await runPeopleMutation(() => deletePerson(data, personType, person.id));
  }

  async function handleDeleteDraft() {
    if (!personDraft?.id) return;
    const label = personDisplayName(personDraft);
    const confirmed = window.confirm(`Delete "${label}"?`);
    if (!confirmed) return;
    await runPeopleMutation(() => deletePerson(data, personDraft.type, personDraft.id));
  }

  function handleExportPeople() {
    const headers = ['first', 'last', 'company', 'role', 'phone', 'email', 'license', 'notes', 'tags'];
    const csv = [
      headers.join(','),
      ...filteredPeople.map((person) =>
        headers
          .map((key) => escapeCsvCell(key === 'tags' ? splitTags(person[key]).join(', ') : person[key] || ''))
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${personType === 'sub' ? 'subcontractors' : 'employees'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    importInputRef.current?.click();
  }

  async function handleImportPeople(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        window.alert('The selected file is empty.');
        return;
      }

      const [headerRow, ...dataRows] = rows;
      const headers = headerRow.map((value) => String(value || '').trim().toLowerCase());
      const imported = dataRows
        .map((cells) => {
          const record = {};
          headers.forEach((header, index) => {
            record[header] = String(cells[index] || '').trim();
          });
          return {
            first: record.first || '',
            last: record.last || '',
            company: record.company || '',
            role: record.role || '',
            phone: record.phone || '',
            email: record.email || '',
            license: record.license || record.credential || '',
            notes: record.notes || '',
            tags: record.tags || '',
          };
        })
        .filter((person) => person.first || person.last || person.company);

      if (!imported.length) {
        window.alert('No valid people rows were found in that file.');
        return;
      }

      await runPeopleMutation(() => importPeople(data, personType, imported));
    } finally {
      event.target.value = '';
    }
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>People</h2>
        </div>
        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
            {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
          </button>
          <button className="button secondary" type="button" onClick={triggerImport} disabled={saving}>
            Import CSV
          </button>
          <button className="button secondary" type="button" onClick={handleExportPeople} disabled={!filteredPeople.length}>
            Export CSV
          </button>
          <button className="button primary" type="button" onClick={() => startCreate(personType)}>
            {personType === 'sub' ? 'Add subcontractor' : 'Add employee'}
          </button>
        </div>
      </div>
      <input
        ref={importInputRef}
        className="sr-only"
        type="file"
        accept=".csv,text/csv"
        onChange={handleImportPeople}
      />

      <div className="metrics-grid">
        <DashboardStat label="Subcontractors" value={totals.subs} tone="brand" />
        <DashboardStat label="Employees" value={totals.employees} />
        <DashboardStat label="With email" value={totals.withEmail} />
        <DashboardStat label="Tagged contacts" value={totals.tagged} />
      </div>

      <div className="people-toolbar">
        <div className="people-toggle" role="tablist" aria-label="People types">
          <button
            className={`people-toggle-button${personType === 'sub' ? ' active' : ''}`}
            type="button"
            onClick={() => setPersonType('sub')}
          >
            Subcontractors
          </button>
          <button
            className={`people-toggle-button${personType === 'emp' ? ' active' : ''}`}
            type="button"
            onClick={() => setPersonType('emp')}
          >
            Employees
          </button>
        </div>

        <label className="task-filter people-search">
          <span>Search {personType === 'sub' ? 'subcontractors' : 'employees'}</span>
          <input
            className="task-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              personType === 'sub'
                ? 'Name, company, role, or tag'
                : 'Name, role, company, or tag'
            }
          />
        </label>

        <div className="people-view-toggle" role="tablist" aria-label="People view">
          <button
            className={`people-toggle-button${viewMode === 'cards' ? ' active' : ''}`}
            type="button"
            onClick={() => setViewMode('cards')}
          >
            Cards
          </button>
          <button
            className={`people-toggle-button${viewMode === 'list' ? ' active' : ''}`}
            type="button"
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
      </div>

      {filteredPeople.length ? (
        viewMode === 'cards' ? (
          <div className="people-grid">
            {filteredPeople.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                type={personType}
                onEdit={startEdit}
                onDelete={handleDeletePerson}
                saving={saving}
              />
            ))}
          </div>
        ) : (
          <PeopleListTable
            people={filteredPeople}
            type={personType}
            columns={peopleListColumns}
            boldColumns={peopleListBoldColumns}
            onEdit={startEdit}
            onDelete={handleDeletePerson}
            saving={saving}
          />
        )
      ) : (
        <div className="empty-state">
          <h3>No {personType === 'sub' ? 'subcontractors' : 'employees'} found</h3>
          <p>
            {query
              ? 'Try a different search term or clear the search field.'
              : `Add your first ${personType === 'sub' ? 'subcontractor' : 'employee'} to get started.`}
          </p>
        </div>
      )}

      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type={personDraft.type}
          isEditing={!!personDraft.id}
          saving={saving}
          onChange={(field, value) => setPersonDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setPersonDraft(null)}
          onSave={handleSavePerson}
          onDelete={handleDeleteDraft}
        />
      ) : null}
    </section>
  );
}

function NativeScheduleView({ data, refresh, loading, onStateChange, view = 'schedule' }) {
  const ganttGridRef = useRef(null);
  const ganttLabelRowRefs = useRef([]);
  const ganttTimelineRowRefs = useRef([]);
  const [filter, setFilter] = useState('all');
  const [ganttZoomValue, setGanttZoomValue] = useState(28);
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedPhases, setExpandedPhases] = useState({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [editorDraft, setEditorDraft] = useState(null);
  const [delayDraft, setDelayDraft] = useState(null);
  const [dependencyDraft, setDependencyDraft] = useState(null);
  const [editorPredecessorDraft, setEditorPredecessorDraft] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [dragDependency, setDragDependency] = useState(null);
  const [rowHeights, setRowHeights] = useState([]);
  const [expandedCalendarWeeks, setExpandedCalendarWeeks] = useState({});
  const [saving, setSaving] = useState(false);
  const isCalendarView = view === 'calendar';
  const isScheduleView = view === 'schedule';

  const visibleProjects = useMemo(
    () =>
      (data.projects || []).filter(
        (project) =>
          data.settings?.showSampleData !== false || !SAMPLE_IDS.projects.includes(project.id),
      ),
    [data.projects, data.settings],
  );

  const visibleTasks = useMemo(
    () =>
      (data.tasks || []).filter(
        (task) => data.settings?.showSampleData !== false || !SAMPLE_IDS.tasks.includes(task.id),
      ),
    [data.tasks, data.settings],
  );

  const filteredProjects = useMemo(
    () => (filter === 'all' ? visibleProjects : visibleProjects.filter((project) => project.id === filter)),
    [filter, visibleProjects],
  );
  const legacyShowTaskDueDates = data.settings?.showTaskDueDates;
  const showGanttTasks =
    data.settings?.showGanttTaskDueDates ?? (legacyShowTaskDueDates !== false);
  const showCalendarTasks =
    data.settings?.showCalendarTaskDueDates ?? (legacyShowTaskDueDates !== false);

  const tasksByProject = useMemo(() => {
    const map = new Map();
    visibleTasks.forEach((task) => {
      if (!map.has(task.projectId)) map.set(task.projectId, []);
      map.get(task.projectId).push(task);
    });
    map.forEach((tasks) =>
      tasks.sort((a, b) => {
        const aKey = a.due || '9999-12-31';
        const bKey = b.due || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return a.label.localeCompare(b.label);
      }),
    );
    return map;
  }, [visibleTasks]);

  const rows = useMemo(
    () =>
      buildScheduleRowsView(
        filteredProjects,
        tasksByProject,
        showGanttTasks,
        expandedProjects,
        expandedPhases,
      ),
    [expandedPhases, expandedProjects, filteredProjects, showGanttTasks, tasksByProject],
  );

  const datedRows = useMemo(
    () => rows.filter((row) => parseDateValue(row.start) && parseDateValue(row.end || row.start)),
    [rows],
  );
  const hasScheduledRows = datedRows.length > 0;

  const timeline = useMemo(() => {
    if (datedRows.length) {
      const allDates = datedRows.flatMap((row) => [parseDateValue(row.start), parseDateValue(row.end || row.start)]);
      const validDates = allDates.filter(Boolean).sort((a, b) => a - b);
      if (validDates.length) {
        const minDate = startOfMonth(validDates[0]);
        const maxDate = endOfMonth(validDates[validDates.length - 1]);
        return {
          minDate,
          maxDate,
          months: enumerateMonths(minDate, maxDate),
        };
      }
    }

    const minDate = startOfMonth(calendarMonth);
    const maxDate = endOfMonth(calendarMonth);
    return {
      minDate,
      maxDate,
      months: enumerateMonths(minDate, maxDate),
    };
  }, [calendarMonth, datedRows]);
  const timelineTotalDays = useMemo(
    () => Math.max(1, diffInDays(timeline.minDate, timeline.maxDate) + 1),
    [timeline],
  );
  const ganttPixelsPerDay = useMemo(
    () =>
      GANTT_ZOOM_MIN_PIXELS_PER_DAY +
      ((GANTT_ZOOM_MAX_PIXELS_PER_DAY - GANTT_ZOOM_MIN_PIXELS_PER_DAY) * ganttZoomValue) /
        GANTT_ZOOM_MAX,
    [ganttZoomValue],
  );
  const ganttZoomLabel = useMemo(() => {
    const visibleDays = Math.max(1, Math.round(760 / ganttPixelsPerDay));
    if (visibleDays >= 365) return '1 year';
    if (visibleDays >= 180) return '6 months';
    if (visibleDays >= 90) return '3 months';
    if (visibleDays >= 30) return '1 month';
    if (visibleDays >= 14) return '2 weeks';
    return 'Days';
  }, [ganttPixelsPerDay]);
  const timelineCanvasWidth = useMemo(
    () => Math.max(760, timelineTotalDays * ganttPixelsPerDay),
    [ganttPixelsPerDay, timelineTotalDays],
  );

  const resolvedRowHeights = useMemo(
    () => rows.map((_, index) => Math.max(GANTT_ROW_MIN_HEIGHT, rowHeights[index] || GANTT_ROW_MIN_HEIGHT)),
    [rowHeights, rows],
  );

  const rowTopOffsets = useMemo(() => {
    const offsets = [];
    let currentTop = 0;
    resolvedRowHeights.forEach((height) => {
      offsets.push(currentTop);
      currentTop += height;
    });
    return offsets;
  }, [resolvedRowHeights]);

  const timelineViewHeight = useMemo(
    () => resolvedRowHeights.reduce((sum, height) => sum + height, 0),
    [resolvedRowHeights],
  );

  const dependencyArrows = useMemo(() => {
    if (!hasScheduledRows) return [];
    try {
      const stepRows = datedRows.filter((row) => row.type === 'step' && row.entityId);
      const rowIndexByStepId = new Map(
        rows
          .map((row, index) => [row, index])
          .filter(
            ([row]) =>
              row.type === 'step' &&
              row.entityId &&
              parseDateValue(row.start) &&
              parseDateValue(row.end || row.start),
          )
          .map(([row, index]) => [row.entityId, index]),
      );
      const rowByStepId = new Map(stepRows.map((row) => [row.entityId, row]));
      const arrows = [];

      stepRows.forEach((row) => {
        normalizePreds(row.predecessors).forEach((pred) => {
          const fromRow = rowByStepId.get(pred.id);
          const toRow = rowByStepId.get(row.entityId);
          const fromIndex = rowIndexByStepId.get(pred.id);
          const toIndex = rowIndexByStepId.get(row.entityId);
          if (!fromRow || !toRow || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;

          const fromMetrics = getTimelineMetrics(fromRow, timeline.minDate, timeline.maxDate);
          const toMetrics = getTimelineMetrics(toRow, timeline.minDate, timeline.maxDate);
          if (!fromMetrics || !toMetrics) return;

          const fromX = fromMetrics.leftPct + fromMetrics.widthPct;
          const toX = toMetrics.leftPct;
          const fromY = (rowTopOffsets[fromIndex] || 0) + (resolvedRowHeights[fromIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
          const toY = (rowTopOffsets[toIndex] || 0) + (resolvedRowHeights[toIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
          const midX = (fromX + toX) / 2;
          const coords = [fromX, toX, fromY, toY, midX];
          if (!coords.every((value) => Number.isFinite(value))) return;

          arrows.push({
            key: `${pred.id}-${row.entityId}`,
            d: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
          });
        });
      });

      return arrows;
    } catch {
      return [];
    }
  }, [datedRows, hasScheduledRows, resolvedRowHeights, rowTopOffsets, rows, timeline]);

  const stepRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.type === 'step' &&
          row.entityId &&
          parseDateValue(row.start) &&
          parseDateValue(row.end || row.start),
      ),
    [rows],
  );

  const stepRowIndexById = useMemo(
    () => new Map(stepRows.map((row, index) => [row.entityId, index])),
    [stepRows],
  );

  const stepRowById = useMemo(
    () => new Map(stepRows.map((row) => [row.entityId, row])),
    [stepRows],
  );

  const dragPreview = useMemo(() => {
    if (!dragDependency || !hasScheduledRows) return null;
    const fromRow = stepRowById.get(dragDependency.fromStepId);
    const fromIndex = stepRowIndexById.get(dragDependency.fromStepId);
    if (!fromRow || !Number.isInteger(fromIndex)) return null;
    const fromMetrics = getTimelineMetrics(fromRow, timeline.minDate, timeline.maxDate);
    if (!fromMetrics) return null;

    const gridRect = ganttGridRef.current?.getBoundingClientRect();
    if (!gridRect || !gridRect.width || !gridRect.height) return null;

    const startX = fromMetrics.leftPct + fromMetrics.widthPct;
    const startY = (rowTopOffsets[fromIndex] || 0) + (resolvedRowHeights[fromIndex] || GANTT_ROW_MIN_HEIGHT) / 2;
    const endX = clamp(((dragDependency.currentClientX - gridRect.left) / gridRect.width) * 100, 0, 100);
    const viewHeight = timelineViewHeight || GANTT_ROW_MIN_HEIGHT;
    const endY = clamp(((dragDependency.currentClientY - gridRect.top) / gridRect.height) * viewHeight, 0, viewHeight);
    const midX = (startX + endX) / 2;
    const coords = [startX, startY, endX, endY, midX];
    if (!coords.every((value) => Number.isFinite(value))) return null;

    return {
      d: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
    };
  }, [dragDependency, hasScheduledRows, resolvedRowHeights, rowTopOffsets, stepRowById, stepRowIndexById, timeline, timelineViewHeight]);

  const stats = useMemo(() => {
    const phases = filteredProjects.reduce((sum, project) => sum + (project.phases?.length || 0), 0);
    const steps = filteredProjects.reduce(
      (sum, project) =>
        sum +
        (project.phases || []).reduce((phaseTotal, phase) => phaseTotal + (phase.steps?.length || 0), 0),
      0,
    );
    const scheduledRows = datedRows.length;
    const visibleTaskCount = filteredProjects.reduce(
      (sum, project) => sum + (tasksByProject.get(project.id)?.length || 0),
      0,
    );
    return { phases, steps, scheduledRows, visibleTaskCount };
  }, [datedRows.length, filteredProjects, tasksByProject]);

  const calendarData = useMemo(
    () => buildCalendarItemsView(filteredProjects, showCalendarTasks ? tasksByProject : new Map(), data.settings),
    [data.settings, filteredProjects, showCalendarTasks, tasksByProject],
  );
  const emptyScheduleTarget = useMemo(() => getFallbackStepTarget(), [data.projects, filteredProjects]);

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
      buildCalendarWeeksView(
        calendarCells,
        calendarData.rangeItems,
        CALENDAR_VISIBLE_RANGE_LANES,
        new Set(Object.entries(expandedCalendarWeeks).filter(([, expanded]) => expanded).map(([key]) => key)),
      ),
    [calendarCells, calendarData.rangeItems, expandedCalendarWeeks],
  );

  useEffect(() => {
    function measureRowHeights() {
      const nextHeights = rows.map((_, index) => {
        const labelHeight = ganttLabelRowRefs.current[index]?.offsetHeight || 0;
        const timelineHeight = ganttTimelineRowRefs.current[index]?.offsetHeight || 0;
        return Math.max(GANTT_ROW_MIN_HEIGHT, labelHeight, timelineHeight);
      });

      setRowHeights((current) => {
        if (
          current.length === nextHeights.length &&
          current.every((value, index) => value === nextHeights[index])
        ) {
          return current;
        }
        return nextHeights;
      });
    }

    measureRowHeights();
    window.addEventListener('resize', measureRowHeights);
    return () => window.removeEventListener('resize', measureRowHeights);
  }, [rows, filter, showGanttTasks, expandedProjects, expandedPhases, dragDependency]);

  function toggleProject(projectId) {
    setExpandedProjects((current) => ({ ...current, [projectId]: !(current[projectId] ?? true) }));
  }

  function togglePhase(phaseId) {
    setExpandedPhases((current) => ({ ...current, [phaseId]: !(current[phaseId] ?? true) }));
  }

  function openPhaseEditor(row, event = null) {
    setEditorPredecessorDraft(null);
    setEditorDraft({
      mode: 'edit',
      type: 'phase',
      projectId: row.parentProjectId,
      phaseId: row.entityId,
      name: row.label,
      assign: row.assign || '',
      status: row.status || 'planning',
      start: row.start || '',
      end: row.end || '',
    });
  }

  function openStepEditor(row, event = null) {
    setEditorPredecessorDraft(null);
    const project = data.projects.find((item) => item.id === row.parentProjectId);
    const phase = project?.phases?.find((item) => item.id === row.parentPhaseId);
    const step = phase?.steps?.find((item) => item.id === row.entityId);
    setEditorDraft({
      mode: 'edit',
      type: 'step',
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      sourceProjectId: row.parentProjectId,
      sourcePhaseId: row.parentPhaseId,
      stepId: row.entityId,
      name: row.label,
      assign: row.assign || '',
      status: row.status || 'planning',
      start: row.start || '',
      duration: row.duration || 1,
      endPreview: row.start
        ? computeStepEndDate(row.start, row.duration || 1, data.settings)
        : row.end || '',
      predecessorOptions: buildStepDependencyOptions(
        row.parentProjectId,
        row.parentPhaseId,
        row.entityId,
        step?.predecessors || [],
      ),
      autoStart: false,
    });
  }

  function buildStepDependencyOptions(projectId, phaseId, stepId = '', selectedPreds = [], projectsSource = data.projects) {
    const project = (projectsSource || []).find((item) => item.id === projectId);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    const selectedMap = new Map(normalizePreds(selectedPreds).map((pred) => [pred.id, pred.lag || 0]));
    return (phase?.steps || [])
      .filter((item) => item.id !== stepId)
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        dateLabel: item.start
          ? `${formatShortDate(item.start)} - ${item.end ? formatShortDate(item.end) : 'No end'}`
          : item.end
            ? `Ends ${formatShortDate(item.end)}`
            : 'Date not set',
        selected: selectedMap.has(item.id),
        lag: selectedMap.get(item.id) || 0,
      }));
  }

  function buildStepDraftFromState(state, projectId, phaseId, mode = 'create', startOverride = '') {
    const selectedStateProject = state.projects.find((item) => item.id === projectId);
    const start = startOverride
      ? normalizeStartDate(startOverride, state.settings)
      : getDefaultNewStepStartFromProject(selectedStateProject, phaseId, state.settings);
    return {
      mode,
      type: 'step',
      projectId,
      phaseId,
      sourceProjectId: projectId,
      sourcePhaseId: phaseId,
      stepId: '',
      name: '',
      assign: '',
      status: 'planning',
      start,
      duration: 1,
      endPreview: start ? computeStepEndDate(start, 1, state.settings) : '',
      predecessorOptions: buildStepDependencyOptions(projectId, phaseId, '', [], state.projects),
      autoStart: !startOverride,
    };
  }

  function openDependencyEditor(row) {
    const project = data.projects.find((item) => item.id === row.parentProjectId);
    const phase = project?.phases?.find((item) => item.id === row.parentPhaseId);
    const step = phase?.steps?.find((item) => item.id === row.entityId);
    if (!phase || !step) return;
    const selectedMap = new Map(normalizePreds(step.predecessors).map((pred) => [pred.id, pred.lag || 0]));
    const options = (phase.steps || [])
      .filter((item) => item.id !== row.entityId)
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        dateLabel: item.start
          ? `${formatShortDate(item.start)} - ${item.end ? formatShortDate(item.end) : 'No end'}`
          : item.end
            ? `Ends ${formatShortDate(item.end)}`
            : 'Date not set',
        selected: selectedMap.has(item.id),
        lag: selectedMap.get(item.id) || 0,
      }));

    setDependencyDraft({
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      stepId: row.entityId,
      name: row.label,
      options,
    });
  }

  function startCreatePhase(projectId) {
    setEditorPredecessorDraft(null);
    setExpandedProjects((current) => ({ ...current, [projectId]: true }));
    setEditorDraft({
      mode: 'create',
      type: 'phase',
      projectId,
      phaseId: '',
      name: '',
      assign: '',
      status: 'planning',
      start: '',
      end: '',
    });
  }

  async function handleQuickAddPhase(projectId) {
    if (!projectId) return;
    const name = window.prompt('New phase name');
    if (!name || !name.trim()) return;

    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === projectId);
      if (!project) return;

      const newPhase = {
        id: `ph${Date.now()}`,
        name: name.trim(),
        assign: '',
        status: 'planning',
        start: '',
        end: '',
        steps: [],
      };

      const nextProject = {
        ...project,
        phases: [...(project.phases || []), newPhase],
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
      setExpandedPhases((current) => ({ ...current, [newPhase.id]: true }));
      setEditorDraft((current) => {
        if (!current || current.type !== 'step') return current;
        const nextDraft = {
          ...current,
          projectId,
          phaseId: newPhase.id,
          predecessorOptions: buildStepDependencyOptions(projectId, newPhase.id),
        };
        if (nextDraft.mode === 'create' && nextDraft.autoStart) {
          nextDraft.start = '';
          nextDraft.endPreview = '';
        }
        return nextDraft;
      });
      setEditorPredecessorDraft(null);
    } finally {
      setSaving(false);
    }
  }

  function getDefaultNewStepStartFromProject(project, phaseId, settings) {
    const phase = project?.phases?.find((item) => item.id === phaseId);
    if (!phase) return '';

    const latestDate = (phase.steps || []).reduce((latest, step) => {
      const candidate = step.end || step.start || '';
      if (!candidate) return latest;
      return !latest || candidate > latest ? candidate : latest;
    }, phase.end || '');

    if (!latestDate) return '';
    const latest = parseDateValue(latestDate);
    if (!latest) return '';
    return normalizeStartDate(toIsoDate(addDays(latest, 1)), settings);
  }

  function getDefaultNewStepStart(projectId, phaseId) {
    const project = data.projects.find((item) => item.id === projectId);
    return getDefaultNewStepStartFromProject(project, phaseId, data.settings);
  }

  function startCreateStep(projectId, phaseId, startOverride = '') {
    setEditorPredecessorDraft(null);
    if (projectId) {
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
    }
    if (phaseId) {
      setExpandedPhases((current) => ({ ...current, [phaseId]: true }));
    }
    setEditorDraft(buildStepDraftFromState(data, projectId, phaseId, 'create', startOverride));
  }

  function resolveCalendarPhaseForDate(dateKey) {
    if (filteredProjects.length !== 1) return null;
    const project = filteredProjects[0];
    const phases = project.phases || [];
    if (!phases.length) return null;

    const containingPhase = phases.find((phase) => {
      const start = phase.start || '';
      const end = phase.end || phase.start || '';
      return start && end && dateKey >= start && dateKey <= end;
    });
    if (containingPhase) return { projectId: project.id, phaseId: containingPhase.id };

    const phasesBefore = phases
      .filter((phase) => (phase.end || phase.start || '') && (phase.end || phase.start || '') <= dateKey)
      .sort((a, b) => (a.end || a.start || '').localeCompare(b.end || b.start || ''));
    if (phasesBefore.length) {
      return { projectId: project.id, phaseId: phasesBefore[phasesBefore.length - 1].id };
    }

    const phasesAfter = phases
      .filter((phase) => (phase.start || phase.end || '') && (phase.start || phase.end || '') >= dateKey)
      .sort((a, b) => (a.start || a.end || '').localeCompare(b.start || b.end || ''));
    if (phasesAfter.length) {
      return { projectId: project.id, phaseId: phasesAfter[0].id };
    }

    return { projectId: project.id, phaseId: phases[0].id };
  }

  function getFallbackStepTarget(dateKey = '') {
    const resolved = resolveCalendarPhaseForDate(dateKey);
    if (resolved) return resolved;

    const project = filteredProjects[0] || data.projects[0];
    const phase = project?.phases?.[0];
    return {
      projectId: project?.id || '',
      phaseId: phase?.id || '',
    };
  }

  function handleCalendarDateClick(cell, event) {
    event.stopPropagation();
    const target = getFallbackStepTarget(cell.key);
    startCreateStep(target.projectId, target.phaseId, cell.key);
  }

  function openCalendarItem(item, event = null) {
    if (item.type === 'phase') {
      openPhaseEditor({
        entityId: item.phaseId,
        parentProjectId: item.projectId,
        label: item.label,
        assign: item.assign,
        status: item.status,
        start: item.start,
        end: item.end,
      }, event);
      return;
    }
    if (item.type === 'step') {
      openStepEditor({
        entityId: item.stepId,
        parentProjectId: item.projectId,
        parentPhaseId: item.phaseId,
        label: item.label,
        assign: item.assign,
        status: item.status,
        start: item.start,
        end: item.end,
        duration: item.duration,
      }, event);
      return;
    }
    if (item.type === 'delay') {
      openDelayEditor({
        entityId: item.delayId,
        parentProjectId: item.projectId,
        parentPhaseId: item.phaseId,
        parentStepId: item.stepId,
        delayDays: item.days,
        delayCause: item.cause,
        description: item.description,
      }, event);
      return;
    }
    if (item.type === 'task') {
      openTaskEditor(item);
    }
  }

  function openTaskEditor(taskLike) {
    setTaskDraft({
      id: taskLike.taskId || taskLike.entityId,
      label: taskLike.label || '',
      projectId: taskLike.projectId || taskLike.parentProjectId || '',
      due: taskLike.due || taskLike.start || '',
      done: !!taskLike.done,
    });
  }

  function updateTaskDraft(field, value) {
    setTaskDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleSaveTaskDraft() {
    if (!taskDraft?.id || !taskDraft.label.trim()) return;
    setSaving(true);
    try {
      const nextState = await updateTask(data, taskDraft.id, {
        label: taskDraft.label.trim(),
        projectId: taskDraft.projectId || '',
        due: taskDraft.due || '',
        done: !!taskDraft.done,
      });
      onStateChange(nextState);
      setTaskDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTaskDraft() {
    if (!taskDraft?.id) return;
    const confirmed = window.confirm(`Delete "${taskDraft.label}"?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      const nextState = await deleteTask(data, taskDraft.id);
      onStateChange(nextState);
      setTaskDraft(null);
    } finally {
      setSaving(false);
    }
  }

  function buildDelayStepOptions(projectId, phaseId) {
    const project = data.projects.find((item) => item.id === projectId);
    const phase = project?.phases?.find((item) => item.id === phaseId);
    return [...(phase?.steps || [])]
      .sort((a, b) => {
        const aKey = a.start || a.end || '9999-12-31';
        const bKey = b.start || b.end || '9999-12-31';
        if (aKey !== bKey) return aKey < bKey ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((step) => ({
        value: step.id,
        label: `${step.name} (${step.start ? formatShortDate(step.start) : step.end ? `Ends ${formatShortDate(step.end)}` : 'Date not set'})`,
      }));
  }

  function startCreateDelay(projectId, phaseId) {
    const stepOptions = buildDelayStepOptions(projectId, phaseId);
    setDelayDraft({
      mode: 'create',
      projectId,
      phaseId,
      delayId: '',
      stepId: stepOptions[0]?.value || '',
      days: 1,
      cause: 'Inspector',
      description: '',
      stepOptions,
    });
  }

  function openDelayEditor(row, event = null) {
    const stepOptions = buildDelayStepOptions(row.parentProjectId, row.parentPhaseId);
    setDelayDraft({
      mode: 'edit',
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      delayId: row.entityId,
      stepId: row.parentStepId,
      days: row.delayDays || 1,
      cause: row.delayCause || 'Inspector',
      description: row.description || '',
      stepOptions,
    });
  }

  function updateDelayDraft(field, value) {
    setDelayDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function toggleDependencyPred(stepId, checked) {
    setDependencyDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, selected: checked, lag: checked ? option.lag : 0 } : option,
            ),
          }
        : current,
    );
  }

  function changeDependencyLag(stepId, value) {
    setDependencyDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, lag: parseInt(value, 10) || 0 } : option,
            ),
          }
        : current,
    );
  }

  function updateEditorDraft(field, value) {
    setEditorDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      const shouldRefreshPreds = next.type === 'step' && (field === 'projectId' || field === 'phaseId');
      if (next.type === 'step' && field === 'projectId') {
        const nextProject = data.projects.find((project) => project.id === value);
        const phaseExists = (nextProject?.phases || []).some((phase) => phase.id === next.phaseId);
        next.phaseId = phaseExists ? next.phaseId : nextProject?.phases?.[0]?.id || '';
        if (value) {
          setExpandedProjects((expanded) => ({ ...expanded, [value]: true }));
        }
        if (next.phaseId) {
          setExpandedPhases((expanded) => ({ ...expanded, [next.phaseId]: true }));
        }
      }
      if (next.type === 'step' && field === 'phaseId' && value) {
        setExpandedPhases((expanded) => ({ ...expanded, [value]: true }));
      }
      if (shouldRefreshPreds) {
        const selectedPreds = (next.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 }));
        next.predecessorOptions = buildStepDependencyOptions(
          next.projectId,
          next.phaseId,
          next.stepId,
          selectedPreds,
        );
      }
      if (next.type === 'step' && next.mode === 'create' && next.autoStart && (field === 'projectId' || field === 'phaseId')) {
        const defaultStart = next.projectId && next.phaseId ? getDefaultNewStepStart(next.projectId, next.phaseId) : '';
        next.start = defaultStart;
      }
      if (next.type === 'step' && (field === 'start' || field === 'duration')) {
        next.autoStart = false;
      }
      if (
        next.type === 'step' &&
        ((field === 'start' || field === 'duration') || (next.mode === 'create' && next.autoStart && (field === 'projectId' || field === 'phaseId')))
      ) {
        const normalizedStart = normalizeStartDate(next.start, data.settings);
        next.start = normalizedStart;
        next.endPreview = normalizedStart
          ? computeStepEndDate(normalizedStart, next.duration, data.settings)
          : '';
      }
      return next;
    });
  }

  function openEditorPredecessors() {
    if (editorDraft?.type !== 'step') return;
    setEditorPredecessorDraft({
      name: editorDraft.name || 'New step',
      options: (editorDraft.predecessorOptions || []).map((option) => ({ ...option })),
    });
  }

  function toggleEditorPred(stepId, checked) {
    setEditorPredecessorDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, selected: checked, lag: checked ? option.lag : 0 } : option,
            ),
          }
        : current,
    );
  }

  function changeEditorPredLag(stepId, value) {
    setEditorPredecessorDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option) =>
              option.id === stepId ? { ...option, lag: parseInt(value, 10) || 0 } : option,
            ),
          }
        : current,
    );
  }

  function saveEditorPredecessors() {
    if (!editorPredecessorDraft) return;
    setEditorDraft((current) =>
      current?.type === 'step'
        ? {
            ...current,
            predecessorOptions: editorPredecessorDraft.options.map((option) => ({ ...option })),
          }
        : current,
    );
    setEditorPredecessorDraft(null);
  }

  async function saveDependencyConnection(source, target, lag = 0) {
    if (!source || !target) return;
    if (source.projectId !== target.projectId || source.phaseId !== target.phaseId) {
      window.alert('Dependencies can only connect steps within the same phase.');
      return;
    }
    if (source.fromStepId === target.stepId) return;

    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === source.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== source.phaseId) return phase;

          const targetStep = (phase.steps || []).find((step) => step.id === target.stepId);
          if (!targetStep) return phase;

          const existingPreds = normalizePreds(targetStep.predecessors);
          const nextPreds = existingPreds.some((pred) => pred.id === source.fromStepId)
            ? existingPreds.map((pred) => (pred.id === source.fromStepId ? { ...pred, lag } : pred))
            : [...existingPreds, { id: source.fromStepId, lag }];

          if (wouldCreateCycleFromPreds(phase, source.fromStepId, target.stepId)) {
            throw new Error('Cannot create a circular dependency.');
          }

          const nextPhase = {
            ...phase,
            steps: (phase.steps || []).map((step) =>
              step.id === target.stepId
                ? {
                    ...step,
                    predecessors: nextPreds,
                  }
                : step,
            ),
          };

          syncStepLinks(nextPhase);
          cascadeStepDates(nextPhase, data.settings);
          return nextPhase;
        }),
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to create dependency.');
    } finally {
      setSaving(false);
    }
  }

  function beginDependencyDrag(event, row) {
    if (!timeline || saving) return;
    event.preventDefault();
    event.stopPropagation();
    setDragDependency({
      fromStepId: row.entityId,
      projectId: row.parentProjectId,
      phaseId: row.parentPhaseId,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
    });
  }

  useEffect(() => {
    if (!dragDependency) return undefined;

    function handlePointerMove(event) {
      setDragDependency((current) =>
        current
          ? {
              ...current,
              currentClientX: event.clientX,
              currentClientY: event.clientY,
            }
          : current,
      );
    }

    function handlePointerUp(event) {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-connect-target]');
      const source = dragDependency;
      setDragDependency(null);
      if (!targetElement || !source) return;

      const target = {
        projectId: targetElement.getAttribute('data-project-id') || '',
        phaseId: targetElement.getAttribute('data-phase-id') || '',
        stepId: targetElement.getAttribute('data-step-id') || '',
      };

      if (!target.stepId || target.stepId === source.fromStepId) return;
      void saveDependencyConnection(source, target, 0);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [data, dragDependency]);

  async function handleSaveEditor(nextAction = 'close') {
    if (!editorDraft?.name.trim()) return;
    if (editorDraft.type === 'step' && (!editorDraft.projectId || !editorDraft.phaseId)) {
      window.alert('Choose a project and phase before saving the step.');
      return;
    }

    setSaving(true);
    setEditorPredecessorDraft(null);
    try {
      if (editorDraft.type === 'phase') {
        const project = data.projects.find((item) => item.id === editorDraft.projectId);
        if (!project) return;

        const nextProject = {
          ...project,
          phases:
            editorDraft.mode === 'create'
              ? [
                  ...(project.phases || []),
                  {
                    id: `ph${Date.now()}`,
                    name: editorDraft.name.trim(),
                    assign: editorDraft.assign.trim(),
                    status: editorDraft.status,
                    start: '',
                    end: '',
                    steps: [],
                  },
                ]
              : (project.phases || []).map((phase) =>
                  phase.id === editorDraft.phaseId
                    ? {
                        ...phase,
                        name: editorDraft.name.trim(),
                        assign: editorDraft.assign.trim(),
                        status: editorDraft.status,
                      }
                    : phase,
                ),
        };

        const syncedProject = syncProjectPhaseDates(nextProject);
        const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
        const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
        onStateChange(nextState);
        setEditorDraft(null);
        return;
      }

      const targetProjectId = editorDraft.projectId;
      const targetPhaseId = editorDraft.phaseId;
      const sourceProjectId = editorDraft.sourceProjectId || editorDraft.projectId;
      const sourcePhaseId = editorDraft.sourcePhaseId || editorDraft.phaseId;
      const sourceProject = data.projects.find((item) => item.id === sourceProjectId);
      const targetProject = data.projects.find((item) => item.id === targetProjectId);
      if (!targetProject) return;
      const targetPhase = targetProject.phases?.find((phase) => phase.id === targetPhaseId);
      if (!targetPhase) {
        window.alert('The selected phase no longer exists.');
        return;
      }

      const existingStep =
        editorDraft.mode === 'edit'
          ? sourceProject?.phases
              ?.find((phase) => phase.id === sourcePhaseId)
              ?.steps?.find((step) => step.id === editorDraft.stepId)
          : null;
      const isMovingStep =
        editorDraft.mode === 'edit' && (targetProjectId !== sourceProjectId || targetPhaseId !== sourcePhaseId);
      const nextStep = {
        ...(existingStep || {}),
        id: editorDraft.mode === 'create' ? `s${Date.now()}` : editorDraft.stepId,
        name: editorDraft.name.trim(),
        assign: editorDraft.assign.trim(),
        status: editorDraft.status,
        done: editorDraft.status === 'done',
        start: editorDraft.start || '',
        duration: Math.max(1, Number(editorDraft.duration) || 1),
        end: editorDraft.start ? editorDraft.endPreview || '' : '',
        predecessors: (editorDraft.predecessorOptions || [])
          .filter((option) => option.selected)
          .map((option) => ({ id: option.id, lag: option.lag || 0 })),
      };
      if (isMovingStep) {
        nextStep.successors = [];
      }

      for (const pred of nextStep.predecessors || []) {
        if (wouldCreateCycleFromPreds(targetPhase, pred.id, nextStep.id)) {
          throw new Error('Cannot create a circular dependency.');
        }
      }

      const finalizePhase = (phase) => {
        const nextPhase = {
          ...phase,
          steps: [...(phase.steps || [])],
        };
        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      };

      const removeStepFromPhase = (phase) => {
        const filteredSteps = (phase.steps || []).map((step) => ({
          ...step,
          predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== editorDraft.stepId),
          successors: Array.isArray(step.successors)
            ? step.successors.filter((successorId) => successorId !== editorDraft.stepId)
            : step.successors,
        }));
        return finalizePhase({
          ...phase,
          steps: filteredSteps.filter((step) => step.id !== editorDraft.stepId),
          delays: (phase.delays || []).filter((delay) => delay.stepId !== editorDraft.stepId),
        });
      };

      const upsertStepInPhase = (phase, preserveExistingLinks) => {
        const existingSteps = [...(phase.steps || [])];
        const nextSteps =
          editorDraft.mode === 'create'
            ? [...existingSteps, nextStep]
            : existingSteps.some((step) => step.id === editorDraft.stepId)
              ? existingSteps.map((step) =>
                  step.id === editorDraft.stepId
                    ? {
                        ...nextStep,
                        predecessors: nextStep.predecessors || [],
                        successors:
                          preserveExistingLinks && !isMovingStep
                            ? step.successors
                            : nextStep.successors || [],
                      }
                    : step,
                )
              : [...existingSteps, nextStep];
        return finalizePhase({
          ...phase,
          steps: nextSteps,
        });
      };

      if (targetProjectId === sourceProjectId) {
        const project = sourceProject;
        if (!project) return;
        const nextProject = {
          ...project,
          phases: (project.phases || []).map((phase) => {
            if (editorDraft.mode === 'create') {
              if (phase.id !== targetPhaseId) return phase;
              return upsertStepInPhase(phase, false);
            }
            if (isMovingStep) {
              if (phase.id === sourcePhaseId) return removeStepFromPhase(phase);
              if (phase.id === targetPhaseId) return upsertStepInPhase(phase, false);
              return phase;
            }
            if (phase.id !== targetPhaseId) return phase;
            return upsertStepInPhase(phase, true);
          }),
        };

        const syncedProject = syncProjectPhaseDates(nextProject);
        const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
        const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
        onStateChange(nextState);
        if (nextAction === 'new') {
          setEditorDraft(buildStepDraftFromState(nextState, targetProjectId, targetPhaseId));
        } else {
          setEditorDraft(null);
        }
        return;
      }

      if (!sourceProject) return;
      const nextSourceProject = syncProjectPhaseDates({
        ...sourceProject,
        phases: (sourceProject.phases || []).map((phase) =>
          phase.id === sourcePhaseId ? removeStepFromPhase(phase) : phase,
        ),
      });
      const nextTargetProject = syncProjectPhaseDates({
        ...targetProject,
        phases: (targetProject.phases || []).map((phase) =>
          phase.id === targetPhaseId ? upsertStepInPhase(phase, false) : phase,
        ),
      });

      let nextTasks = syncProjectTasks(sourceProject.id, nextSourceProject, data.tasks);
      nextTasks = syncProjectTasks(targetProject.id, nextTargetProject, nextTasks);
      const sourceState = await updateProject(data, sourceProject.id, nextSourceProject);
      const nextState = await updateProjectAndTasks(sourceState, targetProject.id, nextTargetProject, nextTasks);
      onStateChange(nextState);
      if (nextAction === 'new') {
        setEditorDraft(buildStepDraftFromState(nextState, targetProjectId, targetPhaseId));
      } else {
        setEditorDraft(null);
      }
    } finally {
      setSaving(false);
    }
  }

  function buildProjectAfterStepDelete(project, phaseId, stepId) {
    return {
      ...project,
      phases: (project.phases || []).map((phase) => {
        if (phase.id !== phaseId) return phase;

        const nextPhase = {
          ...phase,
          steps: (phase.steps || [])
            .filter((step) => step.id !== stepId)
            .map((step) => ({
              ...step,
              predecessors: normalizePreds(step.predecessors).filter((pred) => pred.id !== stepId),
              successors: Array.isArray(step.successors)
                ? step.successors.filter((successorId) => successorId !== stepId)
                : step.successors,
            })),
          delays: (phase.delays || []).filter((delay) => delay.stepId !== stepId),
        };

        syncStepLinks(nextPhase);
        cascadeStepDates(nextPhase, data.settings);
        return nextPhase;
      }),
    };
  }

  async function deleteStepFromRow(row) {
    const confirmed = window.confirm(`Delete "${row.label}"?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      const projectId = row.sourceProjectId || row.parentProjectId || row.projectId;
      const phaseId = row.sourcePhaseId || row.parentPhaseId || row.phaseId;
      const stepId = row.stepId || row.entityId;
      const project = data.projects.find((item) => item.id === projectId);
      if (!project || !phaseId || !stepId) return;

      const nextProject = syncProjectPhaseDates(buildProjectAfterStepDelete(project, phaseId, stepId));
      const nextTasks = syncProjectTasks(projectId, nextProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, projectId, nextProject, nextTasks);
      onStateChange(nextState);
      setEditorDraft((current) => (current?.stepId === stepId ? null : current));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDelayFromRow(row) {
    const confirmed = window.confirm('Remove this delay and reverse its effect on the step?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const projectId = row.parentProjectId || row.projectId;
      const phaseId = row.parentPhaseId || row.phaseId;
      const delayId = row.entityId || row.delayId;
      const project = data.projects.find((item) => item.id === projectId);
      if (!project || !phaseId || !delayId) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== phaseId) return phase;

          const existing = (phase.delays || []).find((delay) => delay.id === delayId);
          let steps = [...(phase.steps || [])];
          if (existing) {
            steps = steps.map((step) =>
              step.id === existing.stepId ? applyDelayToStep(step, -Number(existing.days || 0), data.settings) : step,
            );
          }

          return {
            ...phase,
            steps,
            delays: (phase.delays || []).filter((delay) => delay.id !== delayId),
          };
        }),
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(projectId, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, projectId, syncedProject, nextTasks);
      onStateChange(nextState);
      setDelayDraft((current) => (current?.delayId === delayId ? null : current));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEditor() {
    if (!editorDraft || editorDraft.mode === 'create') return;
    if (editorDraft.type === 'step') {
      await deleteStepFromRow(editorDraft);
      return;
    }
    const confirmed = window.confirm(
      `Delete "${editorDraft.name}"${editorDraft.type === 'phase' ? ' and its steps' : ''}?`,
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const projectId = editorDraft.projectId;
      const phaseId = editorDraft.phaseId;
      const project = data.projects.find((item) => item.id === projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases:
          editorDraft.type === 'phase'
            ? (project.phases || []).filter((phase) => phase.id !== phaseId)
            : (project.phases || []).map((phase) =>
                phase.id === phaseId
                  ? {
                      ...phase,
                      steps: (phase.steps || []).filter((step) => step.id !== editorDraft.stepId),
                    }
                  : phase,
              ),
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(projectId, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, projectId, syncedProject, nextTasks);
      onStateChange(nextState);
      setEditorDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDelay() {
    if (!delayDraft?.stepId) return;

    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === delayDraft.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== delayDraft.phaseId) return phase;

          const existingDelays = [...(phase.delays || [])];
          let steps = [...(phase.steps || [])];

          if (delayDraft.mode === 'edit') {
            const existing = existingDelays.find((delay) => delay.id === delayDraft.delayId);
            if (existing) {
              steps = steps.map((step) =>
                step.id === existing.stepId ? applyDelayToStep(step, -Number(existing.days || 0), data.settings) : step,
              );
            }
          }

          const nextDelay =
            delayDraft.mode === 'edit'
              ? {
                  id: delayDraft.delayId,
                  stepId: delayDraft.stepId,
                  days: Math.max(1, Number(delayDraft.days) || 1),
                  cause: delayDraft.cause,
                  description: delayDraft.description.trim(),
                }
              : {
                  id: `dl${Date.now()}`,
                  stepId: delayDraft.stepId,
                  days: Math.max(1, Number(delayDraft.days) || 1),
                  cause: delayDraft.cause,
                  description: delayDraft.description.trim(),
                };

          steps = steps.map((step) =>
            step.id === nextDelay.stepId ? applyDelayToStep(step, nextDelay.days, data.settings) : step,
          );

          const delays =
            delayDraft.mode === 'edit'
              ? existingDelays.map((delay) => (delay.id === delayDraft.delayId ? nextDelay : delay))
              : [...existingDelays, nextDelay];

          return {
            ...phase,
            status: phase.status === 'done' ? 'done' : 'delayed',
            steps: steps.map((step) => {
              if (step.id !== nextDelay.stepId) return step;
              return step.status === 'done' ? step : { ...step, status: 'delayed' };
            }),
            delays,
          };
        }),
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setDelayDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDelay() {
    if (!delayDraft || delayDraft.mode === 'create') return;
    await deleteDelayFromRow(delayDraft);
  }

  async function handleSaveDependencies() {
    if (!dependencyDraft) return;

    setSaving(true);
    try {
      const project = data.projects.find((item) => item.id === dependencyDraft.projectId);
      if (!project) return;

      const nextProject = {
        ...project,
        phases: (project.phases || []).map((phase) => {
          if (phase.id !== dependencyDraft.phaseId) return phase;

          const nextPhase = {
            ...phase,
            steps: (phase.steps || []).map((step) => {
              if (step.id !== dependencyDraft.stepId) return step;
              const nextPreds = dependencyDraft.options
                .filter((option) => option.selected)
                .map((option) => ({ id: option.id, lag: option.lag || 0 }));

              for (const pred of nextPreds) {
                if (wouldCreateCycleFromPreds(phase, pred.id, step.id)) {
                  throw new Error('Cannot create a circular dependency.');
                }
              }

              return {
                ...step,
                predecessors: nextPreds,
              };
            }),
          };

          syncStepLinks(nextPhase);
          cascadeStepDates(nextPhase, data.settings);
          return nextPhase;
        }),
      };

      const syncedProject = syncProjectPhaseDates(nextProject);
      const nextTasks = syncProjectTasks(project.id, syncedProject, data.tasks);
      const nextState = await updateProjectAndTasks(data, project.id, syncedProject, nextTasks);
      onStateChange(nextState);
      setDependencyDraft(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to save dependencies.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>{isCalendarView ? 'Month Calendar' : 'Schedule and Gantt'}</h2>
        </div>
        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
            {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <DashboardStat label="Projects" value={filteredProjects.length} tone="brand" />
        <DashboardStat label="Phases" value={stats.phases} />
        <DashboardStat label="Steps" value={stats.steps} />
        <DashboardStat
          label={isCalendarView ? 'Visible tasks' : 'Visible tasks'}
          value={(isCalendarView ? showCalendarTasks : showGanttTasks) ? stats.visibleTaskCount : 0}
        />
      </div>

      <div className="schedule-toolbar">
        <label className="task-filter">
          <span>Project filter</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All projects</option>
            {visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {isScheduleView ? (
          <div className="gantt-zoom-controls" aria-label="Gantt zoom controls">
            <span>Zoom</span>
            <input
              className="gantt-zoom-slider"
              type="range"
              min={GANTT_ZOOM_MIN}
              max={GANTT_ZOOM_MAX}
              step="1"
              value={ganttZoomValue}
              onChange={(event) => setGanttZoomValue(Number(event.target.value))}
            />
            <strong>{ganttZoomLabel}</strong>
          </div>
        ) : null}
      </div>

      {isScheduleView ? (
        rows.length ? (
        <div className="gantt-shell">
          <div className="gantt-table">
            <div className="gantt-header gantt-label-header">
              <span>Item</span>
              <span>Dates</span>
            </div>

            {rows.map((row, index) => (
              <div
                key={row.id}
                ref={(element) => {
                  ganttLabelRowRefs.current[index] = element;
                }}
                className={`gantt-row-label gantt-row-label-${row.type}`}
                style={rowHeights[index] ? { minHeight: `${rowHeights[index]}px` } : undefined}
              >
                <div className="gantt-row-title" style={{ paddingLeft: `${16 + row.depth * 18}px` }}>
                  <div className="gantt-row-title-line">
                    {row.type === 'project' ? (
                      <button
                        className="gantt-expand-button"
                        type="button"
                        onClick={() => toggleProject(row.entityId)}
                        aria-label={row.expanded ? 'Collapse project' : 'Expand project'}
                      >
                        {row.expanded ? '-' : '+'}
                      </button>
                    ) : row.type === 'phase' ? (
                      <button
                        className="gantt-expand-button"
                        type="button"
                        onClick={() => togglePhase(row.entityId)}
                        aria-label={row.expanded ? 'Collapse phase' : 'Expand phase'}
                      >
                        {row.expanded ? '-' : '+'}
                      </button>
                    ) : (
                      <span className="gantt-expand-spacer" />
                    )}
                    <strong title={row.type === 'delay' && row.description ? row.description : undefined}>
                      {row.label}
                    </strong>
                  </div>
                  {row.subtitle ? <small>{row.subtitle}</small> : null}
                </div>
                <div className="gantt-row-meta">
                  {row.type !== 'step' && row.type !== 'phase' && row.type !== 'delay' ? (
                    <span className="gantt-row-dates">
                      {formatShortDate(row.start)}
                      {row.end && row.end !== row.start ? ` - ${formatShortDate(row.end)}` : ''}
                    </span>
                  ) : null}
                  {row.type === 'project' ? (
                    <button
                      className="button secondary gantt-edit-button"
                      type="button"
                      onClick={() => startCreatePhase(row.entityId)}
                    >
                      Add phase
                    </button>
                  ) : null}
                  {row.type === 'phase' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => startCreateDelay(row.parentProjectId, row.entityId)}
                        aria-label={`Add delay to ${row.label}`}
                        title="Add delay"
                      >
                        !
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => startCreateStep(row.parentProjectId, row.entityId)}
                        aria-label={`Add step to ${row.label}`}
                        title="Add step"
                      >
                        +
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openPhaseEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit phase"
                      >
                        <span aria-hidden="true">&#9998;</span>
                      </button>
                    </>
                  ) : null}
                  {row.type === 'step' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={() => openDependencyEditor(row)}
                        aria-label={`Edit dependencies for ${row.label}`}
                        title="Dependencies"
                      >
                        <span aria-hidden="true">&#8645;</span>
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button gantt-trash-button"
                        type="button"
                        onClick={() => deleteStepFromRow(row)}
                        aria-label={`Delete ${row.label}`}
                        title="Delete step"
                      >
                        <span aria-hidden="true">&#128465;</span>
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openStepEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit step"
                      >
                        <span aria-hidden="true">&#9998;</span>
                      </button>
                    </>
                  ) : null}
                  {row.type === 'delay' ? (
                    <>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button gantt-trash-button"
                        type="button"
                        onClick={() => deleteDelayFromRow(row)}
                        aria-label={`Delete ${row.label}`}
                        title="Delete delay"
                      >
                        <span aria-hidden="true">&#128465;</span>
                      </button>
                      <button
                        className="button secondary gantt-edit-button gantt-icon-button"
                        type="button"
                        onClick={(event) => openDelayEditor(row, event)}
                        aria-label={`Edit ${row.label}`}
                        title="Edit delay"
                      >
                        <span aria-hidden="true">&#9998;</span>
                      </button>
                    </>
                  ) : null}
                  {row.type === 'task' ? (
                    <button
                      className="button secondary gantt-edit-button gantt-icon-button"
                      type="button"
                      onClick={() => openTaskEditor(row)}
                      aria-label={`Edit ${row.label}`}
                      title="Edit task"
                    >
                      <span aria-hidden="true">&#9998;</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="gantt-timeline-wrap">
            <div className="gantt-months" style={{ width: `${timelineCanvasWidth}px` }}>
              {timeline.months.map((month) => {
                const monthStart = month > timeline.minDate ? month : timeline.minDate;
                const monthEnd = endOfMonth(month) < timeline.maxDate ? endOfMonth(month) : timeline.maxDate;
                const offset = diffInDays(timeline.minDate, monthStart);
                const width = Math.max(1, diffInDays(monthStart, monthEnd) + 1);
                return (
                  <div
                    key={month.toISOString()}
                    className="gantt-month"
                    style={{
                      left: `${(offset / timelineTotalDays) * 100}%`,
                      width: `${(width / timelineTotalDays) * 100}%`,
                    }}
                  >
                    {month.toLocaleString('default', { month: 'short', year: 'numeric' })}
                  </div>
                );
              })}
            </div>

            <div
              ref={ganttGridRef}
              className={`gantt-grid${dragDependency ? ' connecting' : ''}`}
              style={{ width: `${timelineCanvasWidth}px` }}
            >
              {dependencyArrows.length || dragPreview ? (
                <svg
                  className="gantt-arrows"
                  viewBox={`0 0 100 ${timelineViewHeight || GANTT_ROW_MIN_HEIGHT}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="gantt-arrowhead"
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M1 1L7 4L1 7"
                        fill="none"
                        stroke="#c7cae3"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </marker>
                  </defs>
                  {dependencyArrows.map((arrow) => (
                    <path
                      key={arrow.key}
                      d={arrow.d}
                      fill="none"
                      stroke="#c7cae3"
                      strokeWidth="0.25"
                      opacity="0.7"
                      markerEnd="url(#gantt-arrowhead)"
                    />
                  ))}
                  {dragPreview ? (
                    <path
                      d={dragPreview.d}
                      fill="none"
                      stroke="#4d58b7"
                      strokeWidth="2"
                      strokeDasharray="6 4"
                      opacity="0.95"
                      markerEnd="url(#gantt-arrowhead)"
                    />
                  ) : null}
                </svg>
              ) : null}
              {rows.map((row, index) => {
                const style = getTimelineStyle(row, timeline.minDate, timeline.maxDate);
                const canConnectHere =
                  dragDependency &&
                  row.type === 'step' &&
                  row.entityId !== dragDependency.fromStepId &&
                  row.parentProjectId === dragDependency.projectId &&
                  row.parentPhaseId === dragDependency.phaseId;
                const barTitle =
                  row.type === 'delay'
                    ? `${row.label}: ${formatTooltipDate(row.start)}${row.end && row.end !== row.start ? ` to ${formatTooltipDate(row.end)}` : ''}`
                    : `${row.label}: ${formatTooltipDate(row.start)}${row.end && row.end !== row.start ? ` to ${formatTooltipDate(row.end)}` : ''}${row.assign ? ` | Assignee: ${row.assign}` : ''}`;
                return (
                  <div
                    key={row.id}
                    ref={(element) => {
                      ganttTimelineRowRefs.current[index] = element;
                    }}
                    className="gantt-grid-row"
                    style={rowHeights[index] ? { minHeight: `${rowHeights[index]}px` } : undefined}
                  >
                    {style ? (
                      <div
                        className={`gantt-bar gantt-bar-${row.type} status-${row.status || 'planning'}${row.isMilestone ? ' milestone' : ''}${canConnectHere ? ' connect-target' : ''}${dragDependency?.fromStepId === row.entityId ? ' connect-source' : ''}`}
                        style={style}
                        title={barTitle}
                        data-connect-target={row.type === 'step' ? 'true' : undefined}
                        data-project-id={row.type === 'step' ? row.parentProjectId : undefined}
                        data-phase-id={row.type === 'step' ? row.parentPhaseId : undefined}
                        data-step-id={row.type === 'step' ? row.entityId : undefined}
                        onClick={row.type === 'task' ? () => openTaskEditor(row) : undefined}
                      />
                    ) : null}
                    {row.type === 'step' && style ? (
                      <>
                        <button
                          type="button"
                          className={`gantt-connect-handle input${dragDependency?.fromStepId === row.entityId ? ' active' : ''}`}
                          style={{ left: style.left }}
                          title={`Use "${row.label}" as dependency target`}
                          data-connect-target="true"
                          data-project-id={row.parentProjectId}
                          data-phase-id={row.parentPhaseId}
                          data-step-id={row.entityId}
                        />
                        <button
                          type="button"
                          className={`gantt-connect-handle output${dragDependency?.fromStepId === row.entityId ? ' active' : ''}`}
                          style={{
                            left: row.isMilestone
                              ? `calc(${style.left} + 16px)`
                              : `calc(${style.left} + ${style.width})`,
                          }}
                          title={`Drag from "${row.label}" to connect it as a predecessor`}
                          onPointerDown={(event) => beginDependencyDrag(event, row)}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <h3>No scheduled items to show</h3>
          <p>
            Add phase, step, delay, or task dates to see them in the Gantt timeline.
          </p>
          <button
            className="button primary"
            type="button"
            onClick={() => startCreateStep(emptyScheduleTarget.projectId, emptyScheduleTarget.phaseId)}
            disabled={!emptyScheduleTarget.projectId}
          >
            Add step
          </button>
        </div>
      )
      ) : null}

      {isScheduleView ? (
        <div className="schedule-footer-note">
          <strong>Tip:</strong> drag from the small handle at the end of a step bar onto another step in the same phase to create a dependency instantly.
        </div>
      ) : null}

      {isCalendarView ? (
      <section className="schedule-calendar-card">
        <div className="panel-header schedule-calendar-header">
          <div>
            <p className="panel-copy">
              Daily visibility for phases, steps, tasks, holidays, and weekends using the same project filter as the Gantt.
            </p>
          </div>
          <div className="calendar-nav">
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
                )
              }
            >
              Previous
            </button>
            <div className="calendar-month-label">
              {calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
                )
              }
            >
              Next
            </button>
          </div>
        </div>

        <div className="calendar-dow-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="calendar-dow">
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
            const renderableScheduleBars = scheduleBars.flatMap((item) =>
              splitStepBarAroundBlockedDays(item, week.cells),
            );
            const visibleLaneCount = week.isExpanded ? week.laneCount : collapsedVisibleLaneCount;
            const baseSpanOffset = 30 + visibleLaneCount * 24 + (!week.isExpanded && hiddenScheduledBarCount ? 20 : 0);
            const holidayTop = baseSpanOffset;
            const spanOffset = holidayTop + week.holidayLaneCount * 28;
            const provisionalAvailableBodyHeight = Math.max(0, CALENDAR_COLLAPSED_WEEK_HEIGHT - spanOffset - 10);
            const maxVisibleDayItems = Math.max(
              0,
              Math.floor((provisionalAvailableBodyHeight + 6) / 42),
            );
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
            const availableBodyHeight = Math.max(0, cellHeight - spanOffset - 10);
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
                      const commonProps = {
                        key: `${week.key}-${item.segmentKey || item.id}`,
                        className: `calendar-span-bar ${item.type} status-${item.status || 'planning'}`,
                        style: {
                          gridColumn: `${item.startCol + 1} / ${item.endCol + 2}`,
                          gridRow: `${item.lane + 1}`,
                          borderColor: getProjectAccentColor(item.projectId || item.projectName),
                        },
                        title: `${item.label}${item.projectName ? ` | ${item.projectName}` : ''}`,
                      };
                      return (
                        <button
                          {...commonProps}
                          type="button"
                          onClick={(event) => openCalendarItem(item, event)}
                        >
                          <span>
                            {inlineProjectName ? `${item.label} - ${item.projectName}` : item.label}
                          </span>
                        </button>
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
                    onClick={() =>
                      setExpandedCalendarWeeks((current) => ({ ...current, [week.key]: true }))
                    }
                    title={`${hiddenScheduledBarCount} additional scheduled bar${hiddenScheduledBarCount === 1 ? '' : 's'} hidden for this week`}
                  >
                    +{hiddenScheduledBarCount} more scheduled
                  </button>
                ) : null}

                {week.isExpanded && week.laneCount > collapsedVisibleLaneCount ? (
                  <button
                    type="button"
                    className="calendar-span-overflow"
                    onClick={() =>
                      setExpandedCalendarWeeks((current) => ({ ...current, [week.key]: false }))
                    }
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
                          onClick={(event) => handleCalendarDateClick(cell, event)}
                          title={`Add step on ${formatShortDate(cell.key)}`}
                        >
                          {cell.date.getDate()}
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
                            <button
                              key={`${cell.key}-${item.id}`}
                              type="button"
                              className={`calendar-chip ${item.type} status-${item.status || 'planning'}`}
                              title={`${item.label} | ${item.projectName}`}
                              onClick={(event) => openCalendarItem(item, event)}
                            >
                              <span>{item.label}</span>
                              <small>{item.projectName}</small>
                            </button>
                          ))}

                          {hiddenCount > 0 ? (
                            <div className="calendar-more">+{hiddenCount} more</div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      ) : null}

      <ScheduleItemModal
        draft={editorDraft}
        type={editorDraft?.type}
        projects={visibleProjects}
        saving={saving}
        onChange={updateEditorDraft}
        onOpenPreds={openEditorPredecessors}
        onAddPhase={handleQuickAddPhase}
        onClose={() => {
          setEditorPredecessorDraft(null);
          setEditorDraft(null);
        }}
        onSave={() => handleSaveEditor('close')}
        onSaveAndNew={() => handleSaveEditor('new')}
        onDelete={handleDeleteEditor}
      />
      <StepPredecessorModal
        draft={editorPredecessorDraft}
        saving={saving}
        onTogglePred={toggleEditorPred}
        onLagChange={changeEditorPredLag}
        onClose={() => setEditorPredecessorDraft(null)}
        onSave={saveEditorPredecessors}
      />
      <DelayModal
        draft={delayDraft}
        saving={saving}
        onChange={updateDelayDraft}
        onClose={() => setDelayDraft(null)}
        onSave={handleSaveDelay}
        onDelete={handleDeleteDelay}
      />
      <DependencyModal
        draft={dependencyDraft}
        saving={saving}
        onTogglePred={toggleDependencyPred}
        onLagChange={changeDependencyLag}
        onClose={() => setDependencyDraft(null)}
        onSave={handleSaveDependencies}
      />
      <TaskModal
        draft={taskDraft}
        projects={visibleProjects}
        saving={saving}
        onChange={updateTaskDraft}
        onClose={() => setTaskDraft(null)}
        onSave={handleSaveTaskDraft}
        onDelete={handleDeleteTaskDraft}
      />
    </section>
  );
}

function StepPredecessorModal({ draft, saving, onTogglePred, onLagChange, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card dependency-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Predecessors</p>
            <h2>Step Predecessors</h2>
            <p className="panel-copy">
              Editing: <strong>{draft.name}</strong>
            </p>
          </div>
        </div>

        <div className="dependency-help">
          <strong>Lag days</strong> offset the successor start after a predecessor finishes.
          Positive values wait extra days. Negative values allow overlap.
        </div>

        <div className="dependency-list">
          {draft.options.length ? (
            draft.options.map((option) => (
              <label key={option.id} className="dependency-option">
                <div className="dependency-option-main">
                  <input
                    type="checkbox"
                    checked={option.selected}
                    onChange={(event) => onTogglePred(option.id, event.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.dateLabel}</small>
                  </span>
                </div>
                <input
                  className="dependency-lag-input"
                  type="number"
                  value={option.lag}
                  disabled={!option.selected || saving}
                  onChange={(event) => onLagChange(option.id, event.target.value)}
                />
              </label>
            ))
          ) : (
            <div className="empty-state compact">
              <h3>No other steps in this phase</h3>
              <p>Add more steps to create dependencies in this phase.</p>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Use predecessors'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function MoveFileModal({ draft, saving, onChange, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card move-file-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Move file</p>
            <h2>Move File</h2>
            <p className="panel-copy">
              <strong>{draft.fileName || draft.originalName || 'Untitled file'}</strong>
            </p>
          </div>
        </div>

        <div className="project-form-grid">
          <label className="full">
            <span>Destination folder</span>
            <select value={draft.targetFolderId} onChange={(event) => onChange(event.target.value)} disabled={saving}>
              {draft.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving || draft.targetFolderId === draft.sourceFolderId}>
            {saving ? 'Saving...' : 'Move file'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function NativeSettingsView({ data, onStateChange, refresh, loading }) {
  const [saving, setSaving] = useState(false);

  const settings = useMemo(
    () => {
      const legacyShowTaskDueDates = data.settings?.showTaskDueDates;
      return {
        weekdaysOnly: !!data.settings?.weekdaysOnly,
        showSampleData: data.settings?.showSampleData !== false,
        showGanttTaskDueDates: data.settings?.showGanttTaskDueDates ?? (legacyShowTaskDueDates !== false),
        showCalendarTaskDueDates: data.settings?.showCalendarTaskDueDates ?? (legacyShowTaskDueDates !== false),
        showCalendarPhases: data.settings?.showCalendarPhases !== false,
      peopleListColumns: Array.isArray(data.settings?.peopleListColumns)
        ? data.settings.peopleListColumns
        : DEFAULT_PEOPLE_LIST_COLUMNS,
      peopleListBoldColumns: Array.isArray(data.settings?.peopleListBoldColumns)
        ? data.settings.peopleListBoldColumns
        : ['name'],
      holidays: Array.isArray(data.settings?.holidays) ? data.settings.holidays : [],
      };
    },
    [data.settings],
  );

  const sampleDataPresent = hasVisibleSampleData(data);
  const nonWorkdayCount = settings.holidays.filter((holiday) => holiday.nonWorkday !== false).length;

  async function runSettingsMutation(nextSettings) {
    setSaving(true);
    try {
      const nextState = await updateSettings(data, nextSettings);
      onStateChange(nextState);
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(field, value) {
    runSettingsMutation({ ...settings, [field]: value });
  }

  function handleHolidayChange(index, field, value) {
    const holidays = settings.holidays.map((holiday, holidayIndex) =>
      holidayIndex === index ? { ...holiday, [field]: value } : holiday,
    );
    runSettingsMutation({ ...settings, holidays });
  }

  function handleToggleHolidayRange(index, enabled) {
    const holidays = settings.holidays.map((holiday, holidayIndex) =>
      holidayIndex === index
        ? { ...holiday, endDate: enabled ? holiday.endDate || holiday.date || '' : '' }
        : holiday,
    );
    runSettingsMutation({ ...settings, holidays });
  }

  function handleAddHoliday() {
    const holidays = [
      ...settings.holidays,
      { id: `h${Date.now()}`, date: '', endDate: '', name: '', nonWorkday: true },
    ];
    runSettingsMutation({ ...settings, holidays });
  }

  function handleRemoveHoliday(index) {
    const holidays = settings.holidays.filter((_, holidayIndex) => holidayIndex !== index);
    runSettingsMutation({ ...settings, holidays });
  }

  function handleTogglePeopleColumn(columnId, enabled) {
    const current = settings.peopleListColumns.filter((item) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === item),
    );
    const next = enabled
      ? current.includes(columnId)
        ? current
        : [...current, columnId]
      : current.filter((item) => item !== columnId);
    runSettingsMutation({ ...settings, peopleListColumns: next });
  }

  function movePeopleColumn(columnId, direction) {
    const current = [...settings.peopleListColumns];
    const index = current.indexOf(columnId);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    runSettingsMutation({ ...settings, peopleListColumns: next });
  }

  function handleTogglePeopleBold(columnId, enabled) {
    const current = settings.peopleListBoldColumns.filter((item) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === item),
    );
    const next = enabled
      ? current.includes(columnId)
        ? current
        : [...current, columnId]
      : current.filter((item) => item !== columnId);
    runSettingsMutation({ ...settings, peopleListBoldColumns: next });
  }

  return (
    <section className="panel native-panel">
      <div className="panel-header">
        <div>
          <h2>Settings</h2>
        </div>
        <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
          {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
        </button>
      </div>

      <div className="metrics-grid">
        <DashboardStat label="Holidays" value={settings.holidays.length} tone="brand" />
        <DashboardStat label="Non-workdays" value={nonWorkdayCount} />
        <DashboardStat label="Weekdays only" value={settings.weekdaysOnly ? 'On' : 'Off'} />
        <DashboardStat label="Gantt task dates" value={settings.showGanttTaskDueDates ? 'Shown' : 'Hidden'} />
        <DashboardStat label="Calendar task dates" value={settings.showCalendarTaskDueDates ? 'Shown' : 'Hidden'} />
        <DashboardStat label="Calendar phases" value={settings.showCalendarPhases ? 'Shown' : 'Hidden'} />
        <DashboardStat label="People columns" value={settings.peopleListColumns.length} />
        <DashboardStat label="Sample data" value={settings.showSampleData ? 'Shown' : 'Hidden'} />
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Scheduling defaults</h3>
              <p>Control the default work-calendar behavior for schedule calculations.</p>
            </div>
          </div>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.weekdaysOnly}
              onChange={(event) => handleToggle('weekdaysOnly', event.target.checked)}
              disabled={saving}
            />
            <span>
              <strong>Use weekdays only</strong>
              <small>Skip weekends when the scheduling logic calculates dates.</small>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.showGanttTaskDueDates}
              onChange={(event) => handleToggle('showGanttTaskDueDates', event.target.checked)}
              disabled={saving}
            />
            <span>
              <strong>Show task due dates in Gantt</strong>
              <small>Display task due-date markers in the Gantt view.</small>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.showCalendarTaskDueDates}
              onChange={(event) => handleToggle('showCalendarTaskDueDates', event.target.checked)}
              disabled={saving}
            />
            <span>
              <strong>Show task due dates in Calendar</strong>
              <small>Display task due-date markers in the Calendar tab.</small>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.showCalendarPhases}
              onChange={(event) => handleToggle('showCalendarPhases', event.target.checked)}
              disabled={saving}
            />
            <span>
              <strong>Show phases in calendar</strong>
              <small>Display phase bars in the Calendar tab.</small>
            </span>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Sample data</h3>
              <p>Show or hide the starter records that came with the tracker.</p>
            </div>
          </div>

          {sampleDataPresent ? (
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showSampleData}
                onChange={(event) => handleToggle('showSampleData', event.target.checked)}
                disabled={saving}
              />
              <span>
                <strong>Show sample data</strong>
                <small>Hide starter projects, tasks, subcontractors, and employees from the UI.</small>
              </span>
            </label>
          ) : (
            <div className="empty-state compact">
              <h3>No sample data found</h3>
              <p>This workspace does not currently include any starter records to toggle.</p>
            </div>
          )}
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>People list columns</h3>
              <p>Choose which columns appear in People list view and arrange their order.</p>
            </div>
          </div>

          <div className="settings-order-list">
            {[
              ...settings.peopleListColumns.filter((columnId) =>
                PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId),
              ),
              ...PEOPLE_LIST_COLUMN_DEFS.map((column) => column.id).filter(
                (columnId) => !settings.peopleListColumns.includes(columnId),
              ),
            ].map((columnId) => {
              const column = PEOPLE_LIST_COLUMN_DEFS.find((item) => item.id === columnId);
              if (!column) return null;
              const visible = settings.peopleListColumns.includes(column.id);
              const orderIndex = settings.peopleListColumns.indexOf(column.id);
              return (
                <div key={column.id} className="settings-order-row">
                  <label className="settings-toggle compact">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(event) => handleTogglePeopleColumn(column.id, event.target.checked)}
                      disabled={saving}
                    />
                    <span>
                      <strong>{column.label}</strong>
                      <small>{visible ? `Position ${orderIndex + 1}` : 'Hidden'}</small>
                    </span>
                  </label>
                  <label className="settings-toggle compact settings-inline-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.peopleListBoldColumns.includes(column.id)}
                      onChange={(event) => handleTogglePeopleBold(column.id, event.target.checked)}
                      disabled={saving}
                    />
                    <span>
                      <strong>Bold</strong>
                    </span>
                  </label>
                  <div className="settings-order-actions">
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => movePeopleColumn(column.id, 'up')}
                      disabled={saving || !visible || orderIndex <= 0}
                      title="Move up"
                    >
                      <span aria-hidden="true">&#8593;</span>
                    </button>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => movePeopleColumn(column.id, 'down')}
                      disabled={saving || !visible || orderIndex < 0 || orderIndex >= settings.peopleListColumns.length - 1}
                      title="Move down"
                    >
                      <span aria-hidden="true">&#8595;</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h3>Holiday calendar</h3>
            <p>Add single dates or inclusive date ranges for holidays and other blocked time.</p>
          </div>
          <button className="button primary" type="button" onClick={handleAddHoliday} disabled={saving}>
            Add holiday
          </button>
        </div>

        {settings.holidays.length ? (
          <div className="holiday-list">
            {settings.holidays.map((holiday, index) => {
              const isRange = !!(holiday.endDate && holiday.endDate >= holiday.date && holiday.date);
              return (
                <article key={holiday.id || index} className="holiday-row">
                  <label>
                    <span>Start</span>
                    <input
                      type="date"
                      value={holiday.date || ''}
                      onChange={(event) => handleHolidayChange(index, 'date', event.target.value)}
                      disabled={saving}
                    />
                  </label>

                  <label className="holiday-inline-toggle">
                    <input
                      type="checkbox"
                      checked={isRange}
                      onChange={(event) => handleToggleHolidayRange(index, event.target.checked)}
                      disabled={saving}
                    />
                    <span>Range</span>
                  </label>

                  <label>
                    <span>End</span>
                    <input
                      type="date"
                      value={holiday.endDate || ''}
                      min={holiday.date || ''}
                      onChange={(event) => handleHolidayChange(index, 'endDate', event.target.value)}
                      disabled={saving || !isRange}
                    />
                  </label>

                  <label className="holiday-name">
                    <span>Name</span>
                    <input
                      type="text"
                      value={holiday.name || ''}
                      placeholder="Name (optional)"
                      onChange={(event) => handleHolidayChange(index, 'name', event.target.value)}
                      disabled={saving}
                    />
                  </label>

                  <label className="holiday-inline-toggle">
                    <input
                      type="checkbox"
                      checked={holiday.nonWorkday !== false}
                      onChange={(event) => handleHolidayChange(index, 'nonWorkday', event.target.checked)}
                      disabled={saving}
                    />
                    <span>Non-workday</span>
                  </label>

                  <button
                    className="button secondary danger"
                    type="button"
                    onClick={() => handleRemoveHoliday(index)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <h3>No holidays yet</h3>
            <p>Add your first holiday or closure period to start shaping the scheduling calendar.</p>
          </div>
        )}
      </section>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState(getTabFromLocation);
  const [trackerState, setTrackerState] = useState({
    projects: [],
    tasks: [],
    subs: [],
    employees: [],
    settings: {
      showSampleData: true,
      showGanttTaskDueDates: true,
      showCalendarTaskDueDates: true,
      showCalendarPhases: true,
    },
    storageMode: 'loading',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refreshData() {
    setLoading(true);
    setError('');
    try {
      const next = await loadTrackerData();
      setTrackerState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracker data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    syncTabToLocation(activeTab);
  }, [activeTab]);

  useEffect(() => {
    function handlePopState() {
      setActiveTab(getTabFromLocation());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const storageBanner = getStorageBannerMessage(trackerState.storageMode);
  const activeView = (() => {
    if (activeTab === 'projects') {
      return (
        <NativeProjectsView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
        />
      );
    }

    if (activeTab === 'tasks') {
      return (
        <NativeTasksView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
        />
      );
    }

    if (activeTab === 'files') {
      return (
        <NativeFilesView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
        />
      );
    }

    if (activeTab === 'schedule') {
      return (
        <NativeScheduleView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
          view="schedule"
        />
      );
    }

    if (activeTab === 'calendar') {
      return (
        <NativeScheduleView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
          view="calendar"
        />
      );
    }

    if (activeTab === 'people') {
      return (
        <NativePeopleView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <NativeSettingsView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
        />
      );
    }

    return null;
  })();

  return (
    <main className="app-shell">
      <section className="hero hero-compact">
        <div className="hero-copy">
          <div className="hero-brand">
            <div className="hero-logo" aria-hidden="true">
              <img src="/destiny-logo.png" alt="Destiny Homes logo" />
            </div>
            <h1>Destiny Project Hub</h1>
          </div>
        </div>
      </section>

      {storageBanner ? (
        <section className="storage-banner">
          <strong>{storageBanner.title}</strong>
          <span>{storageBanner.message}</span>
        </section>
      ) : null}

      {error ? (
        <section className="error-banner">
          <strong>Data load failed.</strong>
          <span>{error}</span>
        </section>
      ) : null}

      <nav className="react-tabs" aria-label="Destiny Project Hub sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`react-tab${activeTab === tab.id ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <AppErrorBoundary resetKey={activeTab}>
        {activeView}
      </AppErrorBoundary>
    </main>
  );
}


