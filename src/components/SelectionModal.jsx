import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';

const SELECTION_STATUS_OPTIONS = ['needs decision', 'selected', 'ordered', 'installed'];
const SELECTION_CATEGORY_OPTIONS = ['Exterior', 'Interior', 'Flooring', 'Cabinets', 'Countertops', 'Plumbing', 'Electrical', 'Paint', 'Appliances', 'Misc'];

export default function SelectionModal({
  draft,
  projectName,
  vendorOptions,
  saving,
  onChange,
  onAddPerson,
  onClose,
  onSave,
  onDelete,
  onDownloadFile,
  onRemoveAttachment,
  onRemovePhoto,
  onRemovePendingAttachment,
  onRemovePendingPhoto,
}) {
  if (!draft) return null;
  const isEditing = draft.mode === 'edit';

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="selection-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Selection</p>
            <h2 id="selection-modal-title">{isEditing ? 'Edit selection' : 'Add selection'}</h2>
            <p className="panel-copy">{projectName || 'Project'}</p>
          </div>
        </div>

        <div className="project-form-grid">
          <label>
            <span>Category</span>
            <select value={draft.category} onChange={(event) => onChange('category', event.target.value)}>
              <option value="">Select category</option>
              {SELECTION_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
              {SELECTION_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            <span>Item name</span>
            <input value={draft.itemName} onChange={(event) => onChange('itemName', event.target.value)} />
          </label>
          <label className="full">
            <span>Chosen option</span>
            <input value={draft.chosenOption} onChange={(event) => onChange('chosenOption', event.target.value)} />
          </label>
          <label>
            <span>Vendor / supplier</span>
            <div className="inline-action-field">
              <select value={draft.vendor} onChange={(event) => onChange('vendor', event.target.value)}>
                <option value="">Not set</option>
                {vendorOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button className="button secondary" type="button" onClick={onAddPerson} disabled={saving}>
                Add person
              </button>
            </div>
          </label>
          <label>
            <span>Selection date</span>
            <input type="date" value={draft.selectionDate} onChange={(event) => onChange('selectionDate', event.target.value)} />
          </label>
          <label className="full">
            <span>Notes</span>
            <textarea rows={4} value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} />
          </label>
          <label className="settings-toggle compact settings-inline-checkbox full">
            <input
              type="checkbox"
              checked={draft.subcontractorVisible === true}
              onChange={(event) => onChange('subcontractorVisible', event.target.checked)}
              disabled={saving}
            />
            <span>Visible to subcontractors assigned to this project</span>
          </label>
          <label className="full">
            <span>Attachments</span>
            <input type="file" multiple onChange={(event) => onChange('pendingAttachments', Array.from(event.target.files || []))} />
            {draft.attachments?.length || draft.pendingAttachments?.length ? (
              <div className="task-attachment-list selection-modal-file-list">
                {(draft.attachments || []).map((attachment) => (
                  <div key={attachment.id} className="task-attachment-chip">
                    <button
                      className="task-attachment-link"
                      type="button"
                      onClick={() => onDownloadFile(attachment)}
                      disabled={saving}
                    >
                      {attachment.originalName || attachment.name || 'Attachment'}
                    </button>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      disabled={saving}
                      title="Remove attachment"
                      aria-label="Remove attachment"
                    >
                      <FluentIcon name="delete" />
                    </button>
                  </div>
                ))}
                {(draft.pendingAttachments || []).map((file, index) => (
                  <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="task-attachment-chip pending">
                    <span>{file.name}</span>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onRemovePendingAttachment(index)}
                      disabled={saving}
                      title="Remove pending attachment"
                      aria-label="Remove pending attachment"
                    >
                      <FluentIcon name="delete" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <small className="task-attachment-empty">No attachments yet.</small>
            )}
          </label>
          <label className="full">
            <span>Photos</span>
            <input type="file" accept="image/*" multiple onChange={(event) => onChange('pendingPhotos', Array.from(event.target.files || []))} />
            {draft.photos?.length || draft.pendingPhotos?.length ? (
              <div className="task-attachment-list selection-modal-file-list">
                {(draft.photos || []).map((photo) => (
                  <div key={photo.id} className="task-attachment-chip">
                    <button
                      className="task-attachment-link"
                      type="button"
                      onClick={() => onDownloadFile(photo)}
                      disabled={saving}
                    >
                      {photo.originalName || photo.name || 'Photo'}
                    </button>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onRemovePhoto(photo.id)}
                      disabled={saving}
                      title="Remove photo"
                      aria-label="Remove photo"
                    >
                      <FluentIcon name="delete" />
                    </button>
                  </div>
                ))}
                {(draft.pendingPhotos || []).map((file, index) => (
                  <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="task-attachment-chip pending">
                    <span>{file.name}</span>
                    <button
                      className="button secondary gantt-icon-button"
                      type="button"
                      onClick={() => onRemovePendingPhoto(index)}
                      disabled={saving}
                      title="Remove pending photo"
                      aria-label="Remove pending photo"
                    >
                      <FluentIcon name="delete" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <small className="task-attachment-empty">No photos yet.</small>
            )}
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving || !draft.itemName.trim()}>
            {saving ? 'Saving...' : 'Save selection'}
          </button>
        </div>
      </div>
    </div>,
  );
}

