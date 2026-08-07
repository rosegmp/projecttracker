import React, { useEffect, useMemo, useRef, useState } from 'react';
import FluentIcon from './FluentIcon.jsx';
import { searchGlobalItems } from '../utils/globalSearch.js';

const TYPE_LABELS = {
  project: 'Project',
  task: 'Task',
  person: 'Person',
  certificate: 'Certificate',
  'schedule-step': 'Schedule',
  inspection: 'Inspection',
  selection: 'Selection',
  file: 'File',
  'daily-log': 'Daily log',
  rfi: 'RFI',
  submittal: 'Submittal',
  warranty: 'Warranty',
  closeout: 'Closeout',
  command: 'Quick action',
};

const SEARCH_LABEL = 'Search projects, files, tasks, people, and field records';

export default function GlobalCommandPalette({ open, items = [], commands = [], recentItems = [], recordLoadStatus = 'idle', onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const resultRefs = useRef([]);
  const previousFocusRef = useRef(null);
  const results = useMemo(
    () => query.trim()
      ? searchGlobalItems([...commands, ...items], query, 12)
      : [...recentItems.map((item) => ({ ...item, recent: true })), ...commands.filter((command) => !recentItems.some((item) => item.id === command.id))].slice(0, 8),
    [commands, items, query, recentItems],
  );

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    setQuery('');
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => previousFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (activeIndex < results.length) return;
    setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);

  useEffect(() => {
    if (!open || !results[activeIndex]) return;
    resultRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, results]);

  if (!open) return null;

  function choose(item) {
    if (!item) return;
    onSelect(item);
    onClose();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="global-search-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="global-search-heading">
          <div>
            <p className="eyebrow">Search and quick actions</p>
            <h2 id="global-search-title">Go anywhere</h2>
          </div>
          <button className="button secondary gantt-icon-button" type="button" onClick={onClose} aria-label="Close global search">×</button>
        </div>
        <label className="global-search-input-shell">
          <FluentIcon name="search" size={22} />
          <span className="sr-only">{SEARCH_LABEL}</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder={SEARCH_LABEL}
            aria-label={SEARCH_LABEL}
            aria-controls="global-search-results"
            aria-activedescendant={results[activeIndex] ? `global-search-result-${activeIndex}` : undefined}
            aria-expanded="true"
            aria-autocomplete="list"
            role="combobox"
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </label>
        <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Search results">
          {results.length ? results.map((item, index) => (
            <button
              id={`global-search-result-${index}`}
              className={`global-search-result${index === activeIndex ? ' active' : ''}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              key={item.id}
              ref={(node) => {
                if (node) resultRefs.current[index] = node;
                else delete resultRefs.current[index];
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              <span className={`global-search-result-icon type-${item.type}`} aria-hidden="true">
                <FluentIcon name={item.icon || (item.type === 'task' ? 'checkCircle' : ['certificate', 'file', 'daily-log', 'rfi', 'submittal', 'warranty', 'closeout'].includes(item.type) ? 'document' : item.type === 'command' ? 'play' : item.type === 'project' ? 'folder' : item.type === 'person' ? 'people' : item.type === 'inspection' ? 'checkCircle' : 'clock')} />
              </span>
              <span className="global-search-result-copy">
                <strong>{item.label}</strong>
                <small>{item.meta}</small>
              </span>
              <span className="global-search-result-type">{item.recent ? 'Recent' : TYPE_LABELS[item.type] || 'Result'}</span>
            </button>
          )) : (
            <div className="global-search-empty" role="status">
              <strong>No matching results</strong>
              <span>Try a project, task, person, company, policy, or workspace name.</span>
            </div>
          )}
        </div>
        <footer className="global-search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
          <span><kbd>Enter</kbd> Open</span>
          {recordLoadStatus === 'loading' ? <span role="status">Loading project records…</span> : null}
          {recordLoadStatus === 'partial' ? <span role="status">Some project records are unavailable.</span> : null}
          <span className="global-search-scope-note">Authorized data only; field categories show the latest 250 records.</span>
        </footer>
      </section>
    </div>
  );
}
