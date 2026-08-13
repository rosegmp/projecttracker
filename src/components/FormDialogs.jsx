import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';

export function StepPredecessorModal({ draft, saving, onTogglePred, onLagChange, onClose, onSave }) {
  if (!draft) return null;
  const entityLabel = draft.entityType === 'phase' ? 'Phase' : 'Schedule step';
  const emptyTitle = draft.entityType === 'phase' ? 'No other phases in this project' : 'No other schedule steps in this phase';
  const emptyCopy =
    draft.entityType === 'phase'
      ? 'Add more phases to create dependencies between phases in this project.'
      : 'Add more schedule steps to create dependencies in this phase.';
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card dependency-modal-card" role="dialog" aria-modal="true" aria-labelledby="predecessor-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Predecessors</p>
            <h2 id="predecessor-dialog-title">{entityLabel} Predecessors</h2>
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
              <h3>{emptyTitle}</h3>
              <p>{emptyCopy}</p>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving} aria-busy={saving}>
            {saving ? 'Saving...' : 'Use predecessors'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function MoveFileModal({ draft, saving, onChange, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card move-file-modal-card" role="dialog" aria-modal="true" aria-labelledby="move-file-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Move file</p>
            <h2 id="move-file-dialog-title">Move File</h2>
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving || draft.targetFolderId === draft.sourceFolderId} aria-busy={saving}>
            {saving ? 'Saving...' : 'Move file'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function UploadFilesModal({ draft, saving, onChange, onClose, onSave }) {
  if (!draft) return null;
  const fileCount = draft.files?.length || 0;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card move-file-modal-card" role="dialog" aria-modal="true" aria-labelledby="upload-files-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Upload files</p>
            <h2 id="upload-files-dialog-title">Choose a folder</h2>
            <p className="panel-copy">
              Select where to upload {fileCount === 1 ? <strong>{draft.files[0].name}</strong> : `${fileCount} files`}.
            </p>
          </div>
        </div>

        <div className="project-form-grid">
          <label className="full">
            <span>Project folder</span>
            <select autoFocus value={draft.targetFolderId} onChange={(event) => onChange(event.target.value)} disabled={saving}>
              <option value="">Choose a folder</option>
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
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving || !draft.targetFolderId} aria-busy={saving}>
            {saving ? 'Uploading...' : `Upload ${fileCount === 1 ? 'file' : `${fileCount} files`}`}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function TextEntryModal({ draft, saving, onChange, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card compact-modal-card" role="dialog" aria-modal="true" aria-labelledby="text-entry-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">{draft.eyebrow || 'Entry'}</p>
            <h2 id="text-entry-dialog-title">{draft.title || 'Update value'}</h2>
            {draft.description ? <p className="panel-copy">{draft.description}</p> : null}
          </div>
        </div>

        <form
          className="project-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving || !String(draft.value || '').trim()) return;
            onSave();
          }}
        >
          <label className="full">
            <span>{draft.label || 'Name'}</span>
            <input
              autoFocus
              type="text"
              value={draft.value}
              placeholder={draft.placeholder || ''}
              onChange={(event) => onChange(event.target.value)}
              disabled={saving}
            />
          </label>
        </form>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving || !String(draft.value || '').trim()} aria-busy={saving}>
            {saving ? 'Saving...' : draft.saveLabel || 'Save'}
          </button>
        </div>
      </div>
    </div>,
  );
}

export function EmailAddressModal({ draft, saving, onChange, onToggleSave, onClose, onSave }) {
  if (!draft) return null;
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card compact-modal-card" role="dialog" aria-modal="true" aria-labelledby="email-entry-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Email</p>
            <h2 id="email-entry-dialog-title">{draft.title || 'Enter email address'}</h2>
            <p className="panel-copy">
              {draft.description || 'Add an email address now, or continue without a recipient.'}
            </p>
          </div>
        </div>

        <form
          className="project-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving) return;
            onSave();
          }}
        >
          <label className="full">
            <span>Email address</span>
            <input
              autoFocus
              type="email"
              multiple={draft.allowMultiple === true}
              value={draft.email}
              placeholder="name@example.com"
              onChange={(event) => onChange(event.target.value)}
              disabled={saving}
            />
          </label>
          {draft.canSave ? (
            <label className="settings-toggle compact settings-inline-checkbox full">
              <input type="checkbox" checked={draft.saveToPerson} onChange={(event) => onToggleSave(event.target.checked)} disabled={saving} />
              <span>
                Save this email to {draft.personLabel || 'this person'}
              </span>
            </label>
          ) : null}
        </form>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Continue to email'}
          </button>
        </div>
      </div>
    </div>,
  );
}
