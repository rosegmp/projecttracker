import React, { useMemo } from 'react';
import { normalizeAssignees } from '../utils/assignees.js';

export default function AssigneeMultiSelect({ value, options = [], onChange, disabled = false, className = '' }) {
  const selected = normalizeAssignees(value);
  const resolvedOptions = useMemo(
    () => Array.from(new Set([...selected, ...options].map((option) => String(option || '').trim()).filter(Boolean))),
    [options, selected],
  );

  function toggle(option, checked) {
    onChange(checked ? [...selected, option] : selected.filter((item) => item !== option));
  }

  return (
    <details className={`assignee-multi-select${className ? ` ${className}` : ''}`}>
      <summary aria-label="Choose assignees">
        {selected.length ? `${selected.length} selected` : 'Unassigned'}
      </summary>
      <div className="assignee-multi-options" role="group" aria-label="Assignees">
        {resolvedOptions.length ? resolvedOptions.map((option) => (
          <label key={option} className="assignee-multi-option">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => toggle(option, event.target.checked)}
              disabled={disabled}
            />
            <span>{option}</span>
          </label>
        )) : <span className="assignee-multi-empty">Add a person to assign this item.</span>}
      </div>
    </details>
  );
}
