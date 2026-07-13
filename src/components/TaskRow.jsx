import React from 'react';
import { Delete24Regular, Edit24Regular, Mail24Regular } from '@fluentui/react-icons';
import { isOverdue } from '../utils/schedule.js';

function Icon({ component: Component }) {
  return (
    <Component
      className="fluent-icon"
      aria-hidden="true"
      focusable="false"
      style={{ fontSize: '18px' }}
    />
  );
}

function formatShortDate(iso) {
  if (!iso) return 'No date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`));
}

function formatDateTime(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function TaskRow({
  projectName,
  projectOptions,
  task,
  selectionLink,
  highlighted = false,
  rowRef = null,
  assigneeLabel,
  assigneeEmail,
  editingTaskId,
  editDraft,
  editPendingFiles,
  assigneeOptions,
  onEditStart,
  onEditCancel,
  onEditDraftChange,
  onEditSave,
  editAttachmentInputRef,
  editAttachmentInputKey,
  onOpenEditAttachmentPicker,
  onEditAttachmentAdd,
  onEditAttachmentRemove,
  onEditPendingAttachmentRemove,
  onToggle,
  onEmail,
  onAttachmentDownload,
  onOpenSelection,
  onDelete,
  saving,
  deleting = false,
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
          <select
            className="task-input"
            value={editDraft.projectId || ''}
            onChange={(event) => onEditDraftChange('projectId', event.target.value)}
          >
            <option value="">No project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <input
            className="task-input"
            type="date"
            value={editDraft.due}
            onChange={(event) => onEditDraftChange('due', event.target.value)}
          />
          <select
            className="task-input"
            value={editDraft.assignee || ''}
            onChange={(event) => onEditDraftChange('assignee', event.target.value)}
          >
            <option value="">Unassigned</option>
            {assigneeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <div className="task-row-actions">
            <button
              className={`button primary${saving ? ' is-loading' : ''}`}
              type="button"
              onClick={() => onEditSave(task)}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="button secondary" type="button" onClick={onEditCancel} disabled={saving}>Cancel</button>
          </div>
          <div className="task-attachment-editor">
            <div className="task-attachment-editor-header">
              <strong>Attachments</strong>
              <button className="button secondary" type="button" onClick={onOpenEditAttachmentPicker} disabled={saving}>Add files</button>
              <input
                key={editAttachmentInputKey}
                ref={editAttachmentInputRef}
                className="task-attachment-input"
                type="file"
                multiple
                onChange={onEditAttachmentAdd}
                disabled={saving}
              />
            </div>
            {editDraft.attachments?.length || editPendingFiles.length ? (
              <div className="task-attachment-list">
                {(editDraft.attachments || []).map((attachment) => (
                  <div key={attachment.id} className="task-attachment-chip">
                    <button
                      className="task-attachment-link"
                      type="button"
                      onClick={() => onAttachmentDownload(attachment)}
                      disabled={saving}
                    >
                      {attachment.originalName || attachment.name || 'Attachment'}
                    </button>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onEditAttachmentRemove(attachment.id)}
                      disabled={saving}
                      title="Remove attachment"
                      aria-label="Remove attachment"
                    >
                      <Icon component={Delete24Regular} />
                    </button>
                  </div>
                ))}
                {editPendingFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="task-attachment-chip pending">
                    <span>{file.name}</span>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onEditPendingAttachmentRemove(index)}
                      disabled={saving}
                      title="Remove pending attachment"
                      aria-label="Remove pending attachment"
                    >
                      <Icon component={Delete24Regular} />
                    </button>
                  </div>
                ))}
              </div>
            ) : <small className="task-attachment-empty">No attachments yet.</small>}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      ref={rowRef}
      className={`task-row-card${task.done ? ' done' : ''}${overdue ? ' overdue' : ''}${highlighted ? ' highlighted' : ''}${deleting ? ' deleting' : ''}`}
      aria-busy={deleting}
    >
      <div className="task-main">
        <input type="checkbox" checked={!!task.done} onChange={(event) => onToggle(task, event.target.checked)} disabled={saving} />
        <span className="task-main-copy">
          <strong>{task.label}</strong>
          <small>{projectName || 'No project assigned'}</small>
        </span>
      </div>

      <div className="task-meta">
        <span className="task-assignee-chip">{assigneeLabel || 'Unassigned'}</span>
        <div className="task-date-meta">
          {task.due ? (
            <span className={`task-due-chip${overdue ? ' overdue' : ''}`}>
              {overdue ? 'Overdue | ' : ''}{formatShortDate(task.due)}
            </span>
          ) : <span className="task-due-chip">No due date</span>}
          {task.createdAt ? <small className="task-created-line">Added {formatDateTime(task.createdAt)}</small> : null}
        </div>
      </div>

      {task.attachments?.length || selectionLink ? (
        <div className="task-attachment-list task-attachment-list-inline">
          {(task.attachments || []).map((attachment) => (
            <button
              key={attachment.id}
              className="task-attachment-link-chip"
              type="button"
              onClick={() => onAttachmentDownload(attachment)}
              disabled={saving}
            >
              {attachment.originalName || attachment.name || 'Attachment'}
            </button>
          ))}
          {selectionLink ? (
            <button
              className="task-attachment-link-chip task-selection-link-chip"
              type="button"
              onClick={() => onOpenSelection(task)}
              disabled={saving}
              title={`Open ${selectionLink.label || 'selection'}`}
            >
              Selection: {selectionLink.label || 'Open'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="task-row-actions">
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => onEmail(task)}
          disabled={saving}
          title={assigneeEmail ? 'Email task to assignee' : 'Add an email or continue without a recipient'}
          aria-label={`Email ${task.label} to assignee`}
        >
          <Icon component={Mail24Regular} />
        </button>
        <button
          className="button secondary gantt-icon-button"
          type="button"
          onClick={() => onEditStart(task)}
          disabled={saving}
          title="Edit task"
          aria-label={`Edit ${task.label}`}
        >
          <Icon component={Edit24Regular} />
        </button>
        <button
          className={`button secondary gantt-trash-button${deleting ? ' is-loading task-delete-working' : ' gantt-icon-button'}`}
          type="button"
          onClick={() => onDelete(task)}
          disabled={saving}
          title={deleting ? 'Deleting task' : 'Delete task'}
          aria-label={`Delete ${task.label}`}
        >
          {deleting ? 'Deleting…' : <Icon component={Delete24Regular} />}
        </button>
      </div>
    </article>
  );
}
