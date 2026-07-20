import React, { useEffect, useMemo, useState } from 'react';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';

const TYPES = {
  budgetItems: { singular: 'budget item', plural: 'Budget', prefix: '01', description: 'Plan costs and compare current budget, forecast, and actual spending.' },
  commitments: { singular: 'commitment', plural: 'Commitments', prefix: 'COM', description: 'Track approved vendor scope, committed value, payments, and retainage.' },
};

const BUDGET_STATUSES = ['planned', 'active', 'closed'];
const COMMITMENT_STATUSES = ['draft', 'proposed', 'approved', 'issued', 'complete', 'void'];

function statusLabel(status) {
  return String(status || 'draft').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric(value));
}

function companyFirstName(person) {
  const company = String(person?.company || '').trim();
  const contact = `${person?.first || ''} ${person?.last || ''}`.trim();
  if (company && contact) return `${company} (${contact})`;
  return company || contact || 'Unnamed company';
}

function nextNumber(type, records) {
  const max = (records || []).reduce((current, record) => Math.max(current, Number(String(record.number || '').replace(/\D/g, '')) || 0), 0);
  if (type === 'budgetItems') return String(max + 1).padStart(2, '0');
  return `COM-${String(max + 1).padStart(3, '0')}`;
}

function emptyDraft(type, records) {
  if (type === 'budgetItems') return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'active', category: '',
    originalBudget: '', approvedChanges: '', forecastCost: '', actualCost: '', notes: '',
  };
  return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'draft', vendorId: '', vendorName: '',
    budgetCode: '', scope: '', committedAmount: '', paidAmount: '', retainagePercent: '', startDate: '', endDate: '', notes: '',
  };
}

export default function ProjectBudgetCommitmentsManager({ project, data, canEdit = true }) {
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit }), [canEdit, project.id]);
  const [activeType, setActiveType] = useState('budgetItems');
  const [recordsByType, setRecordsByType] = useState({ budgetItems: [], commitments: [] });
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const records = recordsByType[activeType] || [];
  const meta = TYPES[activeType];

  const vendorOptions = useMemo(() => [
    ...(data?.subs || []),
    ...(data?.employees || []).filter((person) => person.peopleType === 'supplier'),
  ].map((person) => ({ id: String(person.id || ''), label: companyFirstName(person) }))
    .filter((person) => person.id && person.label)
    .sort((a, b) => a.label.localeCompare(b.label)), [data?.employees, data?.subs]);

  const totals = useMemo(() => {
    const budgetItems = recordsByType.budgetItems || [];
    const commitments = (recordsByType.commitments || []).filter((record) => record.status !== 'void');
    const original = budgetItems.reduce((sum, record) => sum + numeric(record.originalBudget), 0);
    const changes = budgetItems.reduce((sum, record) => sum + numeric(record.approvedChanges), 0);
    const current = original + changes;
    const committed = commitments.reduce((sum, record) => sum + numeric(record.committedAmount), 0);
    const paid = commitments.reduce((sum, record) => sum + numeric(record.paidAmount), 0);
    const forecast = budgetItems.reduce((sum, record) => sum + numeric(record.forecastCost), 0);
    return { original, changes, current, committed, paid, forecast, remaining: current - committed };
  }, [recordsByType]);

  async function loadRecords() {
    setLoading(true);
    setMessage('');
    try {
      const [budgetItems, commitments] = await Promise.all([service.list('budgetItems'), service.list('commitments')]);
      setRecordsByType({ budgetItems: budgetItems.records || [], commitments: commitments.records || [] });
      setSetupRequired(budgetItems.setupRequired === true || commitments.setupRequired === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load budget and commitments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecords(); }, [service]);

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function selectVendor(id) {
    const selected = vendorOptions.find((vendor) => vendor.id === id);
    setDraft((current) => ({ ...current, vendorId: id, vendorName: selected?.label || '' }));
  }

  function switchType(type) {
    setActiveType(type);
    setDraft(null);
    setMessage('');
  }

  async function save() {
    if (!draft || saving || !draft.number.trim() || !draft.title.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await service.save(activeType, draft);
      setSetupRequired(result.setupRequired === true);
      setDraft(null);
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to save ${meta.singular}.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(record) {
    const confirmed = await showAppConfirm(`Delete ${record.number} ${record.title}?`, { title: `Delete ${meta.singular}`, confirmLabel: 'Delete', tone: 'danger' });
    if (!confirmed) return;
    setSaving(true);
    setMessage('');
    try {
      await service.remove(activeType, record);
      setDraft(null);
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to delete ${meta.singular}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="project-workflow-manager project-financial-workflow-manager">
      <header className="project-workflow-header">
        <div><p className="eyebrow">Project financials</p><h2>Budget &amp; commitments</h2><p>{meta.description}</p></div>
        {canEdit ? <button className="button primary" type="button" onClick={() => setDraft(emptyDraft(activeType, records))}><FluentIcon name="add" size={16} />New {meta.singular}</button> : null}
      </header>

      <section className="project-financial-summary" aria-label="Project financial summary">
        <div><span>Current budget</span><strong>{money(totals.current)}</strong><small>{money(totals.original)} original · {money(totals.changes)} changes</small></div>
        <div><span>Committed</span><strong>{money(totals.committed)}</strong><small>{money(totals.paid)} paid</small></div>
        <div className={totals.remaining < 0 ? 'is-negative' : ''}><span>Uncommitted</span><strong>{money(totals.remaining)}</strong><small>Current budget less commitments</small></div>
        <div><span>Forecast</span><strong>{money(totals.forecast)}</strong><small>{money(totals.current - totals.forecast)} projected variance</small></div>
      </section>

      <div className="project-document-workflow-switch" role="tablist" aria-label="Budget and commitments">
        {Object.entries(TYPES).map(([type, item]) => <button key={type} type="button" role="tab" aria-selected={activeType === type} className={activeType === type ? 'active' : ''} onClick={() => switchType(type)}>{item.plural}<span>{recordsByType[type].length}</span></button>)}
      </div>

      {setupRequired ? <div className="project-workflow-notice"><FluentIcon name="warning" size={18} /><span>Using device-only draft storage until the included budget-and-commitments migration is applied.</span></div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}

      {draft ? (
        <section className="project-workflow-editor">
          <div className="project-workflow-editor-heading"><h3>{draft.id ? 'Edit' : 'Create'} {meta.singular}</h3><button className="button secondary" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            <label><span>{activeType === 'budgetItems' ? 'Budget code' : 'Commitment number'}</span><input value={draft.number} onChange={(event) => change('number', event.target.value)} /></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => change('status', event.target.value)}>{(activeType === 'budgetItems' ? BUDGET_STATUSES : COMMITMENT_STATUSES).map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
            <label className="full"><span>Title</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
            {activeType === 'budgetItems' ? (
              <>
                <label className="full"><span>Category</span><input value={draft.category} onChange={(event) => change('category', event.target.value)} placeholder="Site work, framing, finishes" /></label>
                <label><span>Original budget</span><input type="number" step="0.01" value={draft.originalBudget} onChange={(event) => change('originalBudget', event.target.value)} /></label>
                <label><span>Approved changes</span><input type="number" step="0.01" value={draft.approvedChanges} onChange={(event) => change('approvedChanges', event.target.value)} /></label>
                <label><span>Forecast cost</span><input type="number" step="0.01" value={draft.forecastCost} onChange={(event) => change('forecastCost', event.target.value)} /></label>
                <label><span>Actual cost</span><input type="number" step="0.01" value={draft.actualCost} onChange={(event) => change('actualCost', event.target.value)} /></label>
                <label className="full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
              </>
            ) : (
              <>
                <label><span>Company</span><select value={draft.vendorId} onChange={(event) => selectVendor(event.target.value)}><option value="">Unassigned</option>{vendorOptions.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.label}</option>)}</select></label>
                <label><span>Budget code</span><select value={draft.budgetCode} onChange={(event) => change('budgetCode', event.target.value)}><option value="">Not linked</option>{recordsByType.budgetItems.map((item) => <option value={item.number} key={item.id}>{item.number} · {item.title}</option>)}</select></label>
                <label className="full"><span>Scope</span><textarea value={draft.scope} onChange={(event) => change('scope', event.target.value)} /></label>
                <label><span>Committed amount</span><input type="number" step="0.01" value={draft.committedAmount} onChange={(event) => change('committedAmount', event.target.value)} /></label>
                <label><span>Paid amount</span><input type="number" step="0.01" value={draft.paidAmount} onChange={(event) => change('paidAmount', event.target.value)} /></label>
                <label><span>Retainage percent</span><input type="number" min="0" max="100" step="0.01" value={draft.retainagePercent} onChange={(event) => change('retainagePercent', event.target.value)} /></label>
                <label><span>Start date</span><input type="date" value={draft.startDate} onChange={(event) => change('startDate', event.target.value)} /></label>
                <label><span>End date</span><input type="date" value={draft.endDate} onChange={(event) => change('endDate', event.target.value)} /></label>
                <label className="full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
              </>
            )}
          </div>
          <div className="project-workflow-editor-actions">
            {draft.id ? <button className="button secondary danger" type="button" onClick={() => void remove(draft)} disabled={saving}>Delete</button> : null}
            <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </section>
      ) : null}

      {loading ? <div className="empty-state compact"><p>Loading budget and commitments…</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => {
            const currentBudget = numeric(record.originalBudget) + numeric(record.approvedChanges);
            return (
              <article className="project-workflow-card" key={record.id}>
                <div className="project-workflow-card-heading"><div><span className={`status-pill status-${record.status}`}>{statusLabel(record.status)}</span><h3>{record.number} · {record.title}</h3></div>{canEdit ? <button className="button secondary gantt-icon-button" type="button" onClick={() => setDraft({ ...record })} aria-label={`Edit ${record.number}`}><FluentIcon name="edit" /></button> : null}</div>
                {activeType === 'budgetItems' ? (
                  <dl className="project-workflow-summary"><div><dt>Current budget</dt><dd>{money(currentBudget)}</dd></div><div><dt>Forecast</dt><dd>{money(record.forecastCost)}</dd></div><div><dt>Variance</dt><dd>{money(currentBudget - numeric(record.forecastCost))}</dd></div></dl>
                ) : (
                  <dl className="project-workflow-summary"><div><dt>Company</dt><dd>{record.vendorName || 'Unassigned'}</dd></div><div><dt>Committed / paid</dt><dd>{money(record.committedAmount)} / {money(record.paidAmount)}</dd></div><div><dt>End date</dt><dd>{record.endDate ? formatShortDate(record.endDate) : 'Not set'}</dd></div></dl>
                )}
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state compact"><h3>No {meta.plural.toLowerCase()} yet</h3><p>{canEdit ? `Create the first ${meta.singular} for this project.` : 'No records are available.'}</p></div>}
    </div>
  );
}
