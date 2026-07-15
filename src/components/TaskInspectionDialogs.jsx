import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';
import AssigneeMultiSelect from './AssigneeMultiSelect.jsx';

const INSPECTION_STATUS_OPTIONS = ['requested', 'scheduled', 'passed', 'failed', 'follow-up'];

export function TaskModal({ draft, projects, assigneeOptions, saving, onChange, onAddPerson, onClose, onSave, onDelete }) {
  if (!draft) return null;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Task</p>
            <h2 id="task-modal-title">Edit task</h2>
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
          <label>
            <span>Assignees</span>
            <div className="inline-action-field">
              <AssigneeMultiSelect
                value={draft.assignees}
                options={assigneeOptions}
                onChange={(value) => onChange('assignees', value)}
                disabled={saving}
              />
              {onAddPerson ? (
                <button className="button secondary" type="button" onClick={onAddPerson} disabled={saving}>
                  Add person
                </button>
              ) : null}
            </div>
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save task'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function InspectionModal({ draft, project, projects, subcodes, saving, onChange, onAddSubcode, onClose, onSave, onDelete }) {
  if (!draft) return null;
  const isEditing = draft.mode === 'edit';
  const showReportField = ['failed', 'follow-up'].includes(draft.status);

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="inspection-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Inspection</p>
            <h2 id="inspection-modal-title">{isEditing ? 'Edit inspection' : 'Add inspection'}</h2>
            <p className="panel-copy">
              {project?.name || 'Project'}
            </p>
          </div>
        </div>

        <div className="inspection-form-grid">
          <label>
            <span>Project</span>
            <select value={draft.projectId} onChange={(event) => onChange('projectId', event.target.value)}>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Subcode</span>
            <div className="inspection-inline-field">
              <select value={draft.subcode} onChange={(event) => onChange('subcode', event.target.value)}>
                <option value="">Select subcode</option>
                {subcodes.map((subcode) => (
                  <option key={subcode} value={subcode}>
                    {subcode}
                  </option>
                ))}
              </select>
              <button className="button secondary" type="button" onClick={onAddSubcode} disabled={saving}>
                Add subcode
              </button>
            </div>
          </label>
          <label>
            <span>Inspection type</span>
            <input
              type="text"
              value={draft.inspectionType}
              onChange={(event) => onChange('inspectionType', event.target.value)}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
              {INSPECTION_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Date</span>
            <input
              type="date"
              value={draft.date}
              onChange={(event) => onChange('date', event.target.value)}
            />
          </label>
          <label className="inspection-form-span">
            <span>Agency / inspector</span>
            <input type="text" value={draft.agency} onChange={(event) => onChange('agency', event.target.value)} />
          </label>
          <label className="inspection-form-span">
            <span>Notes</span>
            <textarea value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} rows={4} />
          </label>
          <label className="inspection-form-span">
            <span>Inspection sticker photo</span>
            <input type="file" accept="image/*,.pdf" onChange={(event) => onChange('stickerPendingFile', event.target.files?.[0] || null)} />
            <small className="inspection-file-help">
              {draft.stickerPendingFile
                ? `Ready to upload: ${draft.stickerPendingFile.name}`
                : draft.stickerFile?.originalName || 'No sticker photo uploaded yet.'}
            </small>
          </label>
          {showReportField ? (
            <label className="inspection-form-span">
              <span>Failed inspection report</span>
              <input type="file" accept="image/*,.pdf" onChange={(event) => onChange('reportPendingFile', event.target.files?.[0] || null)} />
              <small className="inspection-file-help">
                {draft.reportPendingFile
                  ? `Ready to upload: ${draft.reportPendingFile.name}`
                  : draft.reportFile?.originalName || 'No failed inspection report uploaded yet.'}
              </small>
            </label>
          ) : null}
        </div>

        <div className="panel-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          {isEditing ? (
            <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : null}
          <button
            className={`button primary${saving ? ' is-loading' : ''}`}
            type="button"
            onClick={onSave}
            disabled={saving || !draft.subcode.trim() || !draft.inspectionType.trim()}
          >
            {saving ? 'Saving...' : 'Save inspection'}
          </button>
        </div>
      </div>
    </div>,
  );
}
