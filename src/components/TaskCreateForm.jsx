import React from 'react';
import FluentIcon from './FluentIcon.jsx';
import AssigneeMultiSelect from './AssigneeMultiSelect.jsx';

export default function TaskCreateForm({
  task,
  onTaskChange,
  lockedProjectName = '',
  projects,
  assigneeOptions,
  onAddPerson,
  saving,
  attachmentInputKey,
  attachmentInputRef,
  onAttachmentAdd,
  files,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  saveMessage,
  nameInputRef,
  onSubmit,
  modal = false,
  onClose = () => {},
}) {
  return (
    <form
      className={`task-create-panel workspace-plain-card${modal ? ' modal-card task-create-modal-card' : ' task-create-desktop'}`}
      onSubmit={onSubmit}
      onClick={modal ? (event) => event.stopPropagation() : undefined}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? 'true' : undefined}
      aria-labelledby={modal ? 'task-create-modal-title' : undefined}
    >
      {modal ? (
        <div className="panel-header task-create-modal-header">
          <div>
            <p className="eyebrow">Task</p>
            <h2 id="task-create-modal-title">Add task</h2>
          </div>
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
      ) : null}

      <div className="task-create-grid">
        <input
          ref={nameInputRef}
          className="task-input"
          placeholder="Task name"
          value={task.label}
          onChange={(event) => onTaskChange('label', event.target.value)}
          autoFocus={modal}
        />
        {lockedProjectName ? (
          <div className="task-input task-input-static">{lockedProjectName}</div>
        ) : (
          <select className="task-input" value={task.projectId} onChange={(event) => onTaskChange('projectId', event.target.value)}>
            <option value="">Project...</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        )}
        <input
          className="task-input"
          type="date"
          value={task.due}
          onChange={(event) => onTaskChange('due', event.target.value)}
        />
        <div className="inline-action-field task-assignee-field">
          <AssigneeMultiSelect
            value={task.assignees}
            options={assigneeOptions}
            onChange={(value) => onTaskChange('assignees', value)}
            disabled={saving}
            className="task-input"
          />
          <button className="button secondary" type="button" onClick={onAddPerson} disabled={saving}>
            Add person
          </button>
        </div>
        {!modal ? (
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Add task'}
          </button>
        ) : null}
        <input
          key={attachmentInputKey}
          ref={attachmentInputRef}
          className="task-attachment-input"
          type="file"
          multiple
          onChange={onAttachmentAdd}
          disabled={saving}
        />
        {files.length ? (
          <div className="task-attachment-editor task-create-attachments">
            <div className="task-attachment-editor-header">
              <strong>Attachments</strong>
              <button className="button secondary" type="button" onClick={onOpenAttachmentPicker} disabled={saving}>
                Add more files
              </button>
            </div>
            <div className="task-attachment-list">
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="task-attachment-chip pending">
                  <span>{file.name}</span>
                  <button
                    className="button secondary gantt-icon-button"
                    type="button"
                    onClick={() => onRemoveAttachment(index)}
                    disabled={saving}
                    title="Remove pending attachment"
                    aria-label="Remove pending attachment"
                  >
                    <FluentIcon name="delete" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button className="button secondary task-add-attachment-button" type="button" onClick={onOpenAttachmentPicker} disabled={saving}>
            Add attachment
          </button>
        )}
        <div className={`task-save-notice${saveMessage ? ' visible' : ''}`} aria-live="polite">
          {saveMessage || '\u00A0'}
        </div>
      </div>

      {modal ? (
        <div className="modal-actions task-create-modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Add task'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
