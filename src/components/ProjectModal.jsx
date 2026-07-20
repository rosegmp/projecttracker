import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';

function normalizeProjectAccessUserIds(userIds) {
  return Array.isArray(userIds)
    ? Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
}

export default function ProjectModal({ draft, users, onChange, onClose, onSave, onDelete, saving, isEditing }) {
  const selectedUserIds = normalizeProjectAccessUserIds(draft.accessUserIds);
  const assignableUsers = (users || []).filter((user) => user?.id);
  const projectPhotos = Array.isArray(draft.photos) ? draft.photos : [];

  function toggleProjectUserAccess(userId, checked) {
    const nextUserIds = checked
      ? [...selectedUserIds, userId]
      : selectedUserIds.filter((value) => value !== userId);
    onChange('accessUserIds', normalizeProjectAccessUserIds(nextUserIds));
  }

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="project-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2 id="project-modal-title">{isEditing ? 'Edit project' : 'New project'}</h2>
          </div>
        </div>
        <div className="project-form-grid">
          <div className="project-form-section full">Project details</div>
          <label><span>Name</span><input value={draft.name} onChange={(event) => onChange('name', event.target.value)} /></label>
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(event) => onChange('status', event.target.value)}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="delayed">Delayed</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label><span>Start date</span><input type="date" value={draft.start} onChange={(event) => onChange('start', event.target.value)} /></label>
          <label><span>End date</span><input type="date" value={draft.end} onChange={(event) => onChange('end', event.target.value)} /></label>
          <label><span>Project manager</span><input value={draft.manager || ''} onChange={(event) => onChange('manager', event.target.value)} /></label>
          <label><span>Address</span><input value={draft.address} onChange={(event) => onChange('address', event.target.value)} /></label>
          <label><span>Permit #</span><input value={draft.permitNumber} onChange={(event) => onChange('permitNumber', event.target.value)} /></label>
          <label><span>DR #</span><input value={draft.drNumber} onChange={(event) => onChange('drNumber', event.target.value)} /></label>
          <label><span>Block</span><input value={draft.block} onChange={(event) => onChange('block', event.target.value)} /></label>
          <label><span>Lot</span><input value={draft.lot} onChange={(event) => onChange('lot', event.target.value)} /></label>
          <div className="project-form-section full">Project overview</div>
          <label className="full project-main-photo-field">
            <span>Main project image</span>
            <select
              value={draft.mainPhotoId || ''}
              onChange={(event) => {
                onChange('mainPhotoId', event.target.value);
                if (!event.target.value) onChange('mainPhotoCrop', false);
              }}
              disabled={!isEditing || !projectPhotos.length}
            >
              <option value="">No main image</option>
              {projectPhotos.map((photo) => (
                <option key={photo.id} value={photo.id}>{photo.name || photo.originalName || 'Untitled photo'}</option>
              ))}
            </select>
            <small>{projectPhotos.length ? 'Choose an uploaded photo for the project overview.' : 'Add photos from the project Photos tab, then return here to choose the main image.'}</small>
          </label>
          <label className="full project-main-photo-crop-option">
            <input
              type="checkbox"
              checked={draft.mainPhotoCrop === true}
              onChange={(event) => onChange('mainPhotoCrop', event.target.checked)}
              disabled={!draft.mainPhotoId}
            />
            <span>
              <strong>Crop image to fill</strong>
              <small>Off shows the entire photo. On crops the edges to fill the overview frame.</small>
            </span>
          </label>
          <div className="project-form-section full">Customer info</div>
          <label><span>Customer name</span><input value={draft.customerName} onChange={(event) => onChange('customerName', event.target.value)} /></label>
          <label><span>Customer phone</span><input value={draft.customerPhone} onChange={(event) => onChange('customerPhone', event.target.value)} /></label>
          <label><span>Customer email</span><input value={draft.customerEmail} onChange={(event) => onChange('customerEmail', event.target.value)} /></label>
          <label><span>Customer address</span><input value={draft.customerAddress} onChange={(event) => onChange('customerAddress', event.target.value)} /></label>
          <label className="full"><span>Customer notes</span><textarea value={draft.customerNotes} onChange={(event) => onChange('customerNotes', event.target.value)} /></label>
          <label className="full"><span>Description</span><textarea value={draft.desc} onChange={(event) => onChange('desc', event.target.value)} /></label>
          <div className="project-form-section full">Project access</div>
          <div className="project-access-panel full">
            <p className="project-access-copy">Admin users always see every project. Edit users see unassigned projects by default. Other roles only see projects assigned to them.</p>
            {assignableUsers.length ? (
              <div className="project-access-grid">
                {assignableUsers.map((user) => (
                  <label key={user.id} className="project-access-option">
                    <input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={(event) => toggleProjectUserAccess(user.id, event.target.checked)} />
                    <span><strong>{user.name || 'Unnamed user'}</strong><small>{user.role}</small></span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="empty-state compact"><h3>No users yet</h3><p>Add users in Settings to assign project access here.</p></div>
            )}
          </div>
        </div>
        <div className="modal-actions">
          {isEditing ? <button className="button secondary danger" type="button" onClick={onDelete} disabled={saving}>Delete</button> : null}
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save project'}
          </button>
        </div>
      </div>
    </div>,
  );
}
