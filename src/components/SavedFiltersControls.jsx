import React, { lazy, Suspense, useEffect, useState } from 'react';
import { showAppConfirm } from './AppDialogs.jsx';

const TextEntryModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.TextEntryModal })));

function loadSavedFilters(storageKey) {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((filter) => filter?.id && filter?.name && filter?.value && typeof filter.value === 'object')
      : [];
  } catch {
    return [];
  }
}

function persistSavedFilters(storageKey, filters) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    // The current page state remains usable when local storage is unavailable.
  }
}

export default function SavedFiltersControls({
  storageKey,
  currentValue,
  onApply,
  label = 'Saved filters',
  disabled = false,
}) {
  const [filters, setFilters] = useState(() => loadSavedFilters(storageKey));
  const [selectedFilterId, setSelectedFilterId] = useState('');
  const [nameDraft, setNameDraft] = useState(null);

  useEffect(() => {
    setFilters(loadSavedFilters(storageKey));
    setSelectedFilterId('');
    setNameDraft(null);
  }, [storageKey]);

  function updateFilters(nextFilters) {
    setFilters(nextFilters);
    persistSavedFilters(storageKey, nextFilters);
  }

  function selectFilter(filterId) {
    setSelectedFilterId(filterId);
    const selectedFilter = filters.find((filter) => filter.id === filterId);
    if (selectedFilter) onApply({ ...selectedFilter.value });
  }

  function openSaveDialog() {
    const selectedFilter = filters.find((filter) => filter.id === selectedFilterId);
    setNameDraft({
      eyebrow: 'Saved filter',
      title: selectedFilter ? 'Update saved filter' : 'Save current filter',
      description: 'Save the current page filters so you can restore them later.',
      label: 'Filter name',
      placeholder: 'Example: Active projects',
      value: selectedFilter?.name || '',
      saveLabel: selectedFilter ? 'Update filter' : 'Save filter',
    });
  }

  function saveCurrentFilter() {
    const name = String(nameDraft?.value || '').trim();
    if (!name) return;
    const matchingFilter = filters.find((filter) => filter.name.toLowerCase() === name.toLowerCase());
    const id = matchingFilter?.id || selectedFilterId || `filter-${Date.now()}`;
    const nextFilter = {
      id,
      name,
      value: JSON.parse(JSON.stringify(currentValue || {})),
      updatedAt: new Date().toISOString(),
    };
    const nextFilters = matchingFilter || filters.some((filter) => filter.id === id)
      ? filters.map((filter) => (filter.id === (matchingFilter?.id || id) ? nextFilter : filter))
      : [...filters, nextFilter];
    updateFilters(nextFilters.sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedFilterId(id);
    setNameDraft(null);
  }

  async function deleteSelectedFilter() {
    const selectedFilter = filters.find((filter) => filter.id === selectedFilterId);
    if (!selectedFilter) return;
    const confirmed = await showAppConfirm(`Delete saved filter "${selectedFilter.name}"?`, {
      title: 'Delete saved filter',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    updateFilters(filters.filter((filter) => filter.id !== selectedFilterId));
    setSelectedFilterId('');
  }

  return (
    <div className="saved-filter-controls">
      <label className="saved-filter-select">
        <span>{label}</span>
        <select
          value={selectedFilterId}
          onChange={(event) => selectFilter(event.target.value)}
          disabled={disabled || !filters.length}
        >
          <option value="">{filters.length ? 'Choose filter' : 'None saved'}</option>
          {filters.map((filter) => (
            <option key={filter.id} value={filter.id}>{filter.name}</option>
          ))}
        </select>
      </label>
      <button className="button secondary saved-filter-button" type="button" onClick={openSaveDialog} disabled={disabled}>
        {selectedFilterId ? 'Update' : 'Save filter'}
      </button>
      {selectedFilterId ? (
        <button className="button secondary danger saved-filter-button" type="button" onClick={() => void deleteSelectedFilter()} disabled={disabled}>
          Delete
        </button>
      ) : null}
      {nameDraft ? <Suspense fallback={null}>
        <TextEntryModal
          draft={nameDraft}
          saving={false}
          onChange={(value) => setNameDraft((current) => (current ? { ...current, value } : current))}
          onClose={() => setNameDraft(null)}
          onSave={saveCurrentFilter}
        />
      </Suspense> : null}
    </div>
  );
}
