import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';
import { formatShortDate, formatTooltipDate } from '../utils/calendarUi.js';

const TASK_COLOR_PALETTE = ['#2f6f8f', '#c54f7c', '#5f8f3d', '#b86a2f', '#6c5aa7', '#2f8c83', '#9a554f', '#4f6fb2'];

export function ScheduleItemModal({
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
                <span>Task color</span>
                <input
                  type="color"
                  value={draft.color || TASK_COLOR_PALETTE[0]}
                  onChange={(event) => onChange('color', event.target.value)}
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
            <>
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

              <div className="project-form-field full">
                <span>Predecessors</span>
                <div className="dependency-help inline">
                  {(draft.predecessorOptions || []).filter((option) => option.selected).length
                    ? `${(draft.predecessorOptions || []).filter((option) => option.selected).length} predecessor(s) selected.`
                    : 'No predecessors selected.'}
                </div>
                <button className="button secondary" type="button" onClick={onOpenPreds} disabled={saving}>
                  Edit predecessors
                </button>
              </div>
            </>
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
            <button className={`button secondary${saving ? ' is-loading' : ''}`} type="button" onClick={onSaveAndNew} disabled={saving}>
              {saving ? 'Saving...' : 'Save and new'}
            </button>
          ) : null}
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : type === 'phase' ? 'Save phase' : 'Save step'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function DelayModal({ draft, saving, onChange, onClose, onSave, onDelete }) {
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Save delay' : 'Apply delay'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function DependencyModal({ draft, saving, onTogglePred, onLagChange, onClose, onSave }) {
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save and recalculate'}
          </button>
        </div>
      </div>
    </div>,
  );
}
