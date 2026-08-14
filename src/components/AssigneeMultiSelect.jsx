import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeAssignees } from '../utils/assignees.js';
import { renderModalPortal } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';

export default function AssigneeMultiSelect({ value, options = [], warnings = new Map(), onChange, onAddPerson = null, disabled = false, className = '' }) {
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0, width: 260 });
  const selected = normalizeAssignees(value);
  const resolvedOptions = useMemo(
    () => Array.from(new Set([...selected, ...options].map((option) => String(option || '').trim()).filter(Boolean))),
    [options, selected],
  );
  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query
      ? resolvedOptions.filter((option) => option.toLocaleLowerCase().includes(query))
      : resolvedOptions;
  }, [resolvedOptions, searchQuery]);
  const warningFor = (option) => warnings?.get?.(option) || warnings?.[option] || null;
  const selectedWarnings = selected.map((option) => ({ option, warning: warningFor(option) })).filter((item) => item.warning);

  function toggle(option, checked) {
    onChange(checked ? [...selected, option] : selected.filter((item) => item !== option));
  }

  function addPerson() {
    setOpen(false);
    onAddPerson?.();
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

  useEffect(() => {
    if (!open) setSearchQuery('');
  }, [open]);

  return (
    <div className={`assignee-multi-select${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        className={`assignee-multi-trigger${selectedWarnings.length ? ' has-compliance-warning' : ''}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <span>{selected.length ? `${selected.length} selected` : 'Unassigned'}</span>
        {selectedWarnings.length ? (
          <span className="assignee-trigger-warning" title={`${selectedWarnings.length} selected subcontractor${selectedWarnings.length === 1 ? '' : 's'} need compliance attention`} aria-label={`${selectedWarnings.length} compliance warning${selectedWarnings.length === 1 ? '' : 's'}`}>
            <FluentIcon name="warning" size={16} />
          </span>
        ) : null}
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
              <div className="assignee-picker-header-actions">
                <span>{selected.length ? `${selected.length} selected` : 'None selected'}</span>
                {onAddPerson ? (
                  <button
                    className="button secondary assignee-add-person-button"
                    type="button"
                    onClick={addPerson}
                    disabled={disabled}
                    title="Add person"
                    aria-label="Add person"
                  >
                    <FluentIcon name="add" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="assignee-picker-search">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search assignees"
                aria-label="Search assignees"
                autoComplete="off"
              />
            </div>
            <div className="assignee-multi-options" role="group" aria-label="Assignees">
              {filteredOptions.length ? filteredOptions.map((option) => {
                const warning = warningFor(option);
                return (
                <label key={option} className={`assignee-multi-option${warning ? ' has-compliance-warning' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(event) => toggle(option, event.target.checked)}
                    disabled={disabled}
                  />
                  <span className="assignee-option-label">{option}</span>
                  {warning ? (
                    <span className="assignee-option-warning" title={warning.message} aria-label={warning.message}>
                      <FluentIcon name="warning" size={17} />
                    </span>
                  ) : null}
                </label>
                );
              }) : (
                <span className="assignee-multi-empty">
                  {resolvedOptions.length ? 'No assignees match your search.' : 'Add a person to assign this item.'}
                </span>
              )}
            </div>
            {warnings?.loadStatus === 'error' ? (
              <div className="assignee-compliance-warning is-unavailable" role="status">
                <FluentIcon name="warning" size={18} />
                <span>Compliance status is temporarily unavailable. Assignment is still allowed.</span>
              </div>
            ) : null}
            {selectedWarnings.length ? (
              <div className="assignee-compliance-warning" role="status">
                <FluentIcon name="warning" size={18} />
                <span>
                  {selectedWarnings.map(({ option, warning }) => `${option}: ${warning.missing.join(', ')}`).join(' · ')}. Assignment is still allowed.
                </span>
              </div>
            ) : null}
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
