import React, { useEffect, useMemo, useState } from 'react';
import FluentIcon from './FluentIcon.jsx';

function normalizeLocation(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export default function TaskLocationField({
  projectId = '',
  locations = [],
  value = '',
  onChange,
  onAddLocation,
  disabled = false,
  className = '',
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const options = useMemo(() => {
    const normalized = [];
    [...locations, value].forEach((location) => {
      const next = normalizeLocation(location);
      if (!next || normalized.some((item) => item.toLocaleLowerCase() === next.toLocaleLowerCase())) return;
      normalized.push(next);
    });
    return normalized.sort((left, right) => left.localeCompare(right));
  }, [locations, value]);

  useEffect(() => {
    setAdding(false);
    setDraft('');
    setError('');
  }, [projectId]);

  async function saveLocation() {
    const next = normalizeLocation(draft);
    if (!next || !projectId || saving) return;
    const existing = options.find((location) => location.toLocaleLowerCase() === next.toLocaleLowerCase());
    if (existing) {
      onChange(existing);
      setAdding(false);
      setDraft('');
      setError('');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const savedLocation = await onAddLocation(projectId, next);
      onChange(savedLocation || next);
      setAdding(false);
      setDraft('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add location.');
    } finally {
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <div className={`task-location-add${className ? ` ${className}` : ''}`}>
        <input
          className="task-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void saveLocation();
            }
            if (event.key === 'Escape') {
              setAdding(false);
              setDraft('');
              setError('');
            }
          }}
          placeholder="New location"
          aria-label="New task location"
          autoFocus
          disabled={disabled || saving}
        />
        <button className="button primary gantt-icon-button" type="button" onClick={() => void saveLocation()} disabled={disabled || saving || !draft.trim()} title="Save location" aria-label="Save location">
          <FluentIcon name="check" />
        </button>
        <button className="button secondary gantt-icon-button" type="button" onClick={() => { setAdding(false); setDraft(''); setError(''); }} disabled={disabled || saving} title="Cancel adding location" aria-label="Cancel adding location">
          <FluentIcon name="dismiss" />
        </button>
        {error ? <small className="task-location-error" role="alert">{error}</small> : null}
      </div>
    );
  }

  return (
    <div className={`inline-action-field task-location-field${className ? ` ${className}` : ''}`}>
      <select className="task-input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !projectId} aria-label="Task location">
        <option value="">{projectId ? 'Location...' : 'Select project first'}</option>
        {options.map((location) => <option key={location} value={location}>{location}</option>)}
      </select>
      <button className="button secondary gantt-icon-button" type="button" onClick={() => setAdding(true)} disabled={disabled || !projectId} title="Add location" aria-label="Add location">
        <FluentIcon name="add" />
      </button>
    </div>
  );
}
