import React from 'react';
import { renderModalPortal } from './AppDialogs.jsx';

function getPeopleTypeMeta(type) {
  const labels = { sub: 'Subcontractor', supplier: 'Supplier', consultant: 'Consultant', customer: 'Customer', emp: 'Employee' };
  return { label: labels[type] || 'Person' };
}

export default function PersonModal({ draft, type, isEditing, saving, onChange, onClose, onSave, onDelete, showTypeSelector = false }) {
  const typeMeta = getPeopleTypeMeta(type);
  const title = isEditing ? `Edit ${typeMeta.label.toLowerCase()}` : `Add ${typeMeta.label.toLowerCase()}`;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="person-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Person</p>
            <h2 id="person-modal-title">{title}</h2>
          </div>
        </div>

        <div className="project-form-grid">
          {showTypeSelector && !isEditing ? (
            <label>
              <span>Type</span>
              <select value={draft.type} onChange={(event) => onChange('type', event.target.value)}>
                <option value="emp">Employee</option>
                <option value="sub">Subcontractor</option>
                <option value="supplier">Supplier</option>
                <option value="consultant">Consultant</option>
                <option value="customer">Customer</option>
              </select>
            </label>
          ) : null}
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
            {saving ? 'Saving...' : `Save ${typeMeta.label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>,
  );
}
