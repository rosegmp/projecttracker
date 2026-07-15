import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeAssignees } from '../utils/assignees.js';
import { renderModalPortal } from './AppDialogs.jsx';

export default function AssigneeMultiSelect({ value, options = [], onChange, disabled = false, className = '' }) {
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 260 });
  const selected = normalizeAssignees(value);
  const resolvedOptions = useMemo(
    () => Array.from(new Set([...selected, ...options].map((option) => String(option || '').trim()).filter(Boolean))),
    [options, selected],
  );

  function toggle(option, checked) {
    onChange(checked ? [...selected, option] : selected.filter((item) => item !== option));
  }

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect || typeof window === 'undefined') return;
    const gutter = 12;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - gutter * 2);
    const estimatedHeight = Math.min(340, window.innerHeight - gutter * 2);
    const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, window.innerWidth - width - gutter));
    const top = rect.bottom + estimatedHeight + 6 <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(gutter, rect.top - estimatedHeight - 4);
    setPosition({ top, left, width });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <div className={`assignee-multi-select${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        className="assignee-multi-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        {selected.length ? `${selected.length} selected` : 'Unassigned'}
      </button>
      {open ? renderModalPortal(
        <div className="assignee-picker-layer" onClick={() => setOpen(false)}>
          <div
            className="assignee-picker-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Choose assignees"
            style={{ top: position.top, left: position.left, width: position.width }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="assignee-picker-header">
              <strong>Assignees</strong>
              <span>{selected.length ? `${selected.length} selected` : 'None selected'}</span>
            </div>
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
            <div className="assignee-picker-actions">
              {selected.length ? (
                <button className="button secondary" type="button" onClick={() => onChange([])} disabled={disabled}>Clear</button>
              ) : <span />}
              <button className="button primary" type="button" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>,
      ) : null}
    </div>
  );
}
