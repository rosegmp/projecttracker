import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPerson, deletePerson, importPeople, updatePerson } from '../services/trackerData.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import ResponsiveFilterMenu from './ResponsiveFilterMenu.jsx';
import { useVirtualRange } from '../utils/virtualization.js';
import { deliverBlob, isShareDismissed } from '../platform/platformAdapter.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
const PersonModal = lazy(() => import('./PersonModal.jsx'));
import { DashboardStat, PageStats } from './SharedUI.jsx';

const DEFAULT_PEOPLE_LIST_COLUMNS = ['company', 'name', 'role', 'phone', 'email', 'tags'];
const PEOPLE_VIEW_MODE_KEY = 'cx_people_view_mode';
const PEOPLE_LIST_ACTIONS_WIDTH = 92;
const DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS = { company: 220, name: 220, role: 180, phone: 170, email: 240, tags: 200 };
const PEOPLE_LIST_COLUMN_DEFS = [
  { id: 'name', label: 'Name', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.name },
  { id: 'company', label: 'Company', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.company },
  { id: 'role', label: 'Role', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.role },
  { id: 'phone', label: 'Phone', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.phone },
  { id: 'email', label: 'Email', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.email },
  { id: 'tags', label: 'Tags', width: DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS.tags },
];
function splitTags(value) { if (Array.isArray(value)) return value; return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean); }
function escapeCsvCell(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (char === '"') { if (inQuotes && next === '"') { cell += '"'; index += 1; } else inQuotes = !inQuotes; continue; }
    if (char === ',' && !inQuotes) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !inQuotes) { if (char === '\r' && next === '\n') index += 1; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => String(value).trim()));
}
function personDisplayName(person) { return `${person.first || ''} ${person.last || ''}`.trim() || 'Unnamed'; }
function personNameOnly(person) { return `${person.first || ''} ${person.last || ''}`.trim(); }
function personInitials(person) { const initials = `${person.first?.[0] || ''}${person.last?.[0] || ''}`.toUpperCase(); return initials || person.company?.[0]?.toUpperCase() || '?'; }
function getPeopleTypeMeta(type) {
  const metadata = {
    sub: ['Subcontractor', 'Subcontractors', 'Add subcontractor', 'subcontractors', 'subcontractors'],
    supplier: ['Supplier', 'Suppliers', 'Add supplier', 'suppliers', 'suppliers'],
    consultant: ['Consultant', 'Consultants', 'Add consultant', 'consultants', 'consultants'],
    customer: ['Customer', 'Customers', 'Add customer', 'customers', 'customers'],
    emp: ['Employee', 'Employees', 'Add employee', 'employees', 'employees'],
  }[type] || ['Employee', 'Employees', 'Add employee', 'employees', 'employees'];
  return { label: metadata[0], plural: metadata[1], addLabel: metadata[2], searchLabel: metadata[3], fileName: metadata[4] };
}

function PersonCard({ person, type, onEdit, onDelete, saving }) {
  const tags = splitTags(person.tags);
  const name = personNameOnly(person);
  const typeMeta = getPeopleTypeMeta(type);
  const header = person.company || name || 'Unnamed';
  const secondary = person.company
    ? name || person.role || typeMeta.label
    : person.role || typeMeta.label;

  return (
    <article className="person-card">
      <div className="person-card-top">
        <div className="person-card-header">
          <div className="person-avatar">{personInitials(person)}</div>
          <div>
            <h3>{header}</h3>
            <p className="person-subtitle">{secondary}</p>
          </div>
        </div>
        <div className="task-row-actions person-card-actions">
          <button
            className={`button secondary gantt-icon-button${saving ? ' is-loading' : ''}`}
            type="button"
            onClick={() => onEdit(person)}
            disabled={saving}
            aria-label={`Edit ${personDisplayName(person)}`}
            title="Edit"
            aria-busy={saving}
          >
            <FluentIcon name="edit" />
          </button>
          <button
            className={`button secondary gantt-icon-button person-delete-button${saving ? ' is-loading' : ''}`}
            type="button"
            onClick={() => onDelete(person)}
            disabled={saving}
            aria-label={`Delete ${personDisplayName(person)}`}
            title="Delete"
            aria-busy={saving}
          >
            <FluentIcon name="delete" />
          </button>
        </div>
      </div>

      <dl className="person-details">
        {type === 'sub' && person.company && (person.first || person.last) ? (
          <div>
            <dt>Company</dt>
            <dd>{person.company}</dd>
          </div>
        ) : null}
        <div className="person-detail-full">
          <dt>Phone</dt>
          <dd>
            {person.phone ? (
              <a href={`tel:${person.phone}`}>{person.phone}</a>
            ) : (
              <span className="person-empty-value">Not provided</span>
            )}
          </dd>
        </div>
        <div className="person-detail-full">
          <dt>Email</dt>
          <dd>
            {person.email ? (
              <a href={`mailto:${person.email}`}>{person.email}</a>
            ) : (
              <span className="person-empty-value">Not provided</span>
            )}
          </dd>
        </div>
        {person.license ? (
          <div>
            <dt>{type === 'sub' ? 'License' : 'Credential'}</dt>
            <dd>{person.license}</dd>
          </div>
        ) : null}
        {person.notes ? (
          <div className="person-detail-full">
            <dt>Notes</dt>
            <dd>{person.notes}</dd>
          </div>
        ) : null}
      </dl>

      {tags.length ? (
        <div className="person-tags">
          {tags.map((tag) => (
            <span key={tag} className="person-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PeopleListTable({ people, type, columns, boldColumns, onEdit, onDelete, isPersonSaving }) {
  const typeMeta = getPeopleTypeMeta(type);
  const activeColumnIds = Array.isArray(columns) && columns.length
    ? columns
    : DEFAULT_PEOPLE_LIST_COLUMNS;
  const activeColumns = activeColumnIds
    .map((columnId) => PEOPLE_LIST_COLUMN_DEFS.find((column) => column.id === columnId))
    .filter(Boolean);
  const [columnWidths, setColumnWidths] = useState(() =>
    Object.fromEntries(PEOPLE_LIST_COLUMN_DEFS.map((column) => [column.id, column.width])),
  );
  const resizeStateRef = useRef(null);
  const listRef = useRef(null);
  const gridTemplateColumns = `${activeColumns
    .map((column) => `${Math.max(140, columnWidths[column.id] || column.width)}px`)
    .join(' ')} ${PEOPLE_LIST_ACTIONS_WIDTH}px`;
  const boldColumnSet = new Set(Array.isArray(boldColumns) ? boldColumns : ['name']);
  const virtualRange = useVirtualRange({
    count: people.length,
    getSize: () => 57,
    scrollRef: listRef,
    headerOffset: 49,
    threshold: 40,
  });
  const visiblePeople = people.slice(virtualRange.startIndex, virtualRange.endIndex);

  useEffect(() => {
    setColumnWidths((current) => {
      const next = { ...current };
      PEOPLE_LIST_COLUMN_DEFS.forEach((column) => {
        if (!Number.isFinite(next[column.id])) next[column.id] = column.width;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    function handlePointerMove(event) {
      if (!resizeStateRef.current) return;
      const { columnId, startX, startWidth } = resizeStateRef.current;
      const delta = event.clientX - startX;
      setColumnWidths((current) => ({
        ...current,
        [columnId]: Math.max(140, Math.round(startWidth + delta)),
      }));
    }

    function handlePointerUp() {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  function beginColumnResize(event, columnId) {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId] || DEFAULT_PEOPLE_LIST_COLUMN_WIDTHS[columnId] || 180,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function getValue(person, columnId) {
    if (columnId === 'name') return `${person.first || ''} ${person.last || ''}`.trim() || 'Not provided';
    if (columnId === 'company') return person.company || 'Not provided';
    if (columnId === 'role') return person.role || 'Not provided';
    if (columnId === 'phone') return person.phone || 'Not provided';
    if (columnId === 'email') return person.email || 'Not provided';
    if (columnId === 'tags') {
      const tags = splitTags(person.tags);
      return tags.length ? tags.join(', ') : 'Not provided';
    }
    return 'Not provided';
  }

  return (
    <div
      ref={listRef}
      className={`people-list${people.length >= 40 ? ' virtualized' : ''}`}
      role="table"
      aria-label={`${typeMeta.plural} list`}
    >
      <div className="people-list-header" role="row" style={{ gridTemplateColumns }}>
        {activeColumns.map((column) => (
          <span key={column.id} className="people-list-header-cell">
            <span>{column.label}</span>
            <button
              className="people-column-resizer"
              type="button"
              onPointerDown={(event) => beginColumnResize(event, column.id)}
              aria-label={`Resize ${column.label} column`}
              title={`Resize ${column.label}`}
            />
          </span>
        ))}
        <span>Actions</span>
      </div>
      {virtualRange.beforeSize ? <div className="virtual-list-spacer" style={{ height: `${virtualRange.beforeSize}px` }} aria-hidden="true" /> : null}
      {visiblePeople.map((person) => (
        <div key={person.id} className="people-list-row" role="row" style={{ gridTemplateColumns }}>
          {activeColumns.map((column) => (
            <span key={column.id}>
              {column.id === 'email' && person.email ? (
                <a href={`mailto:${person.email}`}>{person.email}</a>
              ) : boldColumnSet.has(column.id) ? (
                <strong>{getValue(person, column.id)}</strong>
              ) : (
                getValue(person, column.id)
              )}
            </span>
          ))}
          <span className="people-list-actions people-list-actions-cell">
            <button
              className={`button secondary gantt-icon-button${isPersonSaving(person.id) ? ' is-loading' : ''}`}
              type="button"
              onClick={() => onEdit(person)}
              disabled={isPersonSaving(person.id)}
              aria-label={`Edit ${personDisplayName(person)}`}
              title="Edit"
              aria-busy={isPersonSaving(person.id)}
            >
              <FluentIcon name="edit" />
            </button>
            <button
              className={`button secondary gantt-icon-button person-delete-button${isPersonSaving(person.id) ? ' is-loading' : ''}`}
              type="button"
              onClick={() => onDelete(person)}
              disabled={isPersonSaving(person.id)}
              aria-label={`Delete ${personDisplayName(person)}`}
              title="Delete"
              aria-busy={isPersonSaving(person.id)}
            >
              <FluentIcon name="delete" />
            </button>
          </span>
        </div>
      ))}
      {virtualRange.afterSize ? <div className="virtual-list-spacer" style={{ height: `${virtualRange.afterSize}px` }} aria-hidden="true" /> : null}
    </div>
  );
}

export default function NativePeopleView({ data, onStateChange, refresh, loading }) {
  const [personType, setPersonType] = useState('sub');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'list';
    const stored = window.localStorage.getItem(PEOPLE_VIEW_MODE_KEY);
    return stored === 'cards' || stored === 'list' ? stored : 'list';
  });
  const [personDraft, setPersonDraft] = useState(null);
  const { runMutation, isMutating } = useEntityMutations();
  const importInputRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PEOPLE_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const visibleSubs = useMemo(() => data.subs || [], [data.subs]);
  const employeeBackedPeople = useMemo(() => data.employees || [], [data.employees]);
  const visibleEmployees = useMemo(
    () => employeeBackedPeople.filter((person) => (person.peopleType || 'emp') === 'emp'),
    [employeeBackedPeople],
  );
  const visibleSuppliers = useMemo(
    () => employeeBackedPeople.filter((person) => (person.peopleType || 'emp') === 'supplier'),
    [employeeBackedPeople],
  );
  const visibleConsultants = useMemo(
    () => employeeBackedPeople.filter((person) => (person.peopleType || 'emp') === 'consultant'),
    [employeeBackedPeople],
  );
  const visibleCustomers = useMemo(
    () => employeeBackedPeople.filter((person) => (person.peopleType || 'emp') === 'customer'),
    [employeeBackedPeople],
  );
  const peopleByType = useMemo(
    () => ({
      sub: visibleSubs,
      emp: visibleEmployees,
      supplier: visibleSuppliers,
      consultant: visibleConsultants,
      customer: visibleCustomers,
    }),
    [visibleConsultants, visibleCustomers, visibleEmployees, visibleSubs, visibleSuppliers],
  );
  const visiblePeople = peopleByType[personType] || [];
  const typeMeta = getPeopleTypeMeta(personType);
  const peopleListColumns = useMemo(() => {
    const configured = Array.isArray(data.settings?.peopleListColumns) ? data.settings.peopleListColumns : [];
    const validConfigured = configured.filter((columnId) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId),
    );
    const missing = DEFAULT_PEOPLE_LIST_COLUMNS.filter((columnId) => !validConfigured.includes(columnId));
    return [...validConfigured, ...missing];
  }, [data.settings]);
  const peopleListBoldColumns = useMemo(() => {
    const configured = Array.isArray(data.settings?.peopleListBoldColumns) ? data.settings.peopleListBoldColumns : ['name'];
    return configured.filter((columnId) => PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId));
  }, [data.settings]);

  const filteredPeople = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return [...visiblePeople]
      .filter((person) => {
        if (!lowered) return true;
        return [personDisplayName(person), person.company, person.role, ...splitTags(person.tags)]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(lowered));
      })
      .sort((a, b) => {
        const aKey = personType === 'sub' || personType === 'supplier' ? a.company || personDisplayName(a) : personDisplayName(a);
        const bKey = personType === 'sub' || personType === 'supplier' ? b.company || personDisplayName(b) : personDisplayName(b);
        return aKey.localeCompare(bKey);
      });
  }, [personType, query, visiblePeople]);

  const totals = useMemo(
    () => ({
      subs: visibleSubs.length,
      employees: visibleEmployees.length,
      suppliers: visibleSuppliers.length,
      consultants: visibleConsultants.length,
      customers: visibleCustomers.length,
      withEmail: [...visibleSubs, ...employeeBackedPeople].filter((person) => person.email).length,
      tagged: [...visibleSubs, ...employeeBackedPeople].filter((person) => splitTags(person.tags).length).length,
    }),
    [employeeBackedPeople, visibleConsultants, visibleCustomers, visibleEmployees, visibleSubs, visibleSuppliers],
  );

  function startCreate(nextType = personType) {
    setPersonType(nextType);
    setPersonDraft({
      id: '',
      first: '',
      last: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      license: '',
      notes: '',
      tags: '',
      type: nextType,
    });
  }

  function startEdit(person) {
    setPersonDraft({
      id: person.id,
      first: person.first || '',
      last: person.last || '',
      company: person.company || '',
      role: person.role || '',
      phone: person.phone || '',
      email: person.email || '',
      license: person.license || '',
      notes: person.notes || '',
      tags: splitTags(person.tags).join(', '),
      type: personType,
    });
  }

  async function runPeopleMutation(key, mutation) {
    return runMutation(key, async () => {
      const nextState = await mutation();
      onStateChange(nextState);
      setPersonDraft(null);
      return nextState;
    });
  }

  async function handleSavePerson() {
    if (!personDraft) return;
    if (!personDraft.first.trim() && !personDraft.last.trim() && !personDraft.company.trim()) return;

    if (personDraft.id) {
      await runPeopleMutation(['person', personDraft.id], () => updatePerson(data, personDraft.type, personDraft.id, personDraft));
      return;
    }

    await runPeopleMutation('person:create', () => createPerson(data, personDraft.type, personDraft));
  }

  async function handleDeletePerson(person) {
    const label = personDisplayName(person);
    const confirmed = await showAppConfirm(`Delete "${label}"?`, {
      title: 'Delete person',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runPeopleMutation(['person', person.id], () => deletePerson(data, personType, person.id));
  }

  async function handleDeleteDraft() {
    if (!personDraft?.id) return;
    const label = personDisplayName(personDraft);
    const confirmed = await showAppConfirm(`Delete "${label}"?`, {
      title: 'Delete person',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runPeopleMutation(['person', personDraft.id], () => deletePerson(data, personDraft.type, personDraft.id));
  }

  function handleExportPeople() {
    const headers = ['first', 'last', 'company', 'role', 'phone', 'email', 'license', 'notes', 'tags'];
    const csv = [
      headers.join(','),
      ...filteredPeople.map((person) =>
        headers
          .map((key) => escapeCsvCell(key === 'tags' ? splitTags(person[key]).join(', ') : person[key] || ''))
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    void deliverBlob(blob, `${typeMeta.fileName}.csv`).catch((error) => {
      if (isShareDismissed(error)) return;
      void showAppAlert(error instanceof Error ? error.message : 'Unable to export people.', 'Export failed');
    });
  }

  function triggerImport() {
    importInputRef.current?.click();
  }

  async function handleImportPeople(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        await showAppAlert('The selected file is empty.', 'Import failed');
        return;
      }

      const [headerRow, ...dataRows] = rows;
      const headers = headerRow.map((value) => String(value || '').trim().toLowerCase());
      const imported = dataRows
        .map((cells) => {
          const record = {};
          headers.forEach((header, index) => {
            record[header] = String(cells[index] || '').trim();
          });
          return {
            first: record.first || '',
            last: record.last || '',
            company: record.company || '',
            role: record.role || '',
            phone: record.phone || '',
            email: record.email || '',
            license: record.license || record.credential || '',
            notes: record.notes || '',
            tags: record.tags || '',
          };
        })
        .filter((person) => person.first || person.last || person.company);

      if (!imported.length) {
        await showAppAlert('No valid people rows were found in that file.', 'Import failed');
        return;
      }

      await runPeopleMutation(['people', personType, 'import'], () => importPeople(data, personType, imported));
    } finally {
      event.target.value = '';
    }
  }

  const importSaving = isMutating(['people', personType, 'import']);
  const draftSaving = personDraft?.id
    ? isMutating(['person', personDraft.id])
    : isMutating('person:create');

  return (
    <section className="panel native-panel workspace-page top-level-people-page">
      <div className="panel-actions people-page-actions">
        <button className={`button secondary${importSaving ? ' is-loading' : ''}`} type="button" onClick={triggerImport} disabled={importSaving} aria-busy={importSaving}>
          {importSaving ? 'Importing...' : 'Import CSV'}
        </button>
        <button className="button secondary" type="button" onClick={handleExportPeople} disabled={!filteredPeople.length}>
          Export CSV
        </button>
        <button className="button primary" type="button" onClick={() => startCreate(personType)}>
          {typeMeta.addLabel}
        </button>
      </div>
      <input
        ref={importInputRef}
        className="sr-only"
        type="file"
        accept=".csv,text/csv"
        onChange={handleImportPeople}
      />

      <div className="workspace-control-grid">
        <section className="workspace-section workspace-control-card workspace-control-card-wide">
          <div className="people-toolbar">
            <ResponsiveFilterMenu label="People filters">
            <label className="task-filter people-type-filter">
              <span>People type</span>
              <select value={personType} onChange={(event) => setPersonType(event.target.value)}>
                <option value="sub">Subcontractors</option>
                <option value="emp">Employees</option>
                <option value="supplier">Suppliers</option>
                <option value="consultant">Consultants</option>
                <option value="customer">Customers</option>
              </select>
            </label>

            <label className="task-filter people-search">
              <span>Search {typeMeta.searchLabel}</span>
              <input
                className="task-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, company, role, or tag"
              />
            </label>
            </ResponsiveFilterMenu>

            <div className="people-view-toggle" role="tablist" aria-label="People view">
              <button
                className={`people-toggle-button${viewMode === 'cards' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('cards')}
              >
                Cards
              </button>
              <button
                className={`people-toggle-button${viewMode === 'list' ? ' active' : ''}`}
                type="button"
                onClick={() => setViewMode('list')}
              >
                List
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="workspace-section">
        {filteredPeople.length ? (
          viewMode === 'cards' ? (
            <div className="people-grid">
              {filteredPeople.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  type={personType}
                  onEdit={startEdit}
                  onDelete={handleDeletePerson}
                  saving={isMutating(['person', person.id])}
                />
              ))}
            </div>
          ) : (
            <PeopleListTable
              people={filteredPeople}
              type={personType}
              columns={peopleListColumns}
              boldColumns={peopleListBoldColumns}
              onEdit={startEdit}
              onDelete={handleDeletePerson}
              isPersonSaving={(personId) => isMutating(['person', personId])}
            />
          )
        ) : (
          <div className="empty-state">
            <h3>No {typeMeta.searchLabel} found</h3>
            <p>
              {query
                ? 'Try a different search term or clear the search field.'
                : `Add your first ${typeMeta.label.toLowerCase()} to get started.`}
            </p>
          </div>
        )}
      </section>

      <Suspense fallback={null}>
      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type={personDraft.type}
          isEditing={!!personDraft.id}
          saving={draftSaving}
          onChange={(field, value) => setPersonDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setPersonDraft(null)}
          onSave={handleSavePerson}
          onDelete={handleDeleteDraft}
        />
      ) : null}
      </Suspense>
      <PageStats settings={data.settings}>
        <DashboardStat label="Subcontractors" value={totals.subs} tone="brand" />
        <DashboardStat label="Employees" value={totals.employees} />
        <DashboardStat label="Suppliers" value={totals.suppliers} />
        <DashboardStat label="Consultants" value={totals.consultants} />
        <DashboardStat label="Customers" value={totals.customers} />
        <DashboardStat label="With email" value={totals.withEmail} />
        <DashboardStat label="Tagged contacts" value={totals.tagged} />
      </PageStats>
      <div className="page-refresh-footer">
        <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </div>
    </section>
  );
}
