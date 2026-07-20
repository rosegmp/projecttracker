import React, { useEffect, useMemo, useState } from 'react';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { personAssignmentLabel } from '../utils/accessUi.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';

const TYPES = {
  rfis: {
    singular: 'RFI', plural: 'RFIs', prefix: 'RFI', empty: 'No RFIs yet',
    description: 'Track questions, responsibility, responses, and potential project impacts.',
  },
  submittals: {
    singular: 'submittal', plural: 'Submittals', prefix: 'SUB', empty: 'No submittals yet',
    description: 'Track specifications, submissions, reviews, decisions, and responsible subcontractors.',
  },
};

const RFI_STATUSES = ['draft', 'open', 'answered', 'closed', 'cancelled'];
const SUBMITTAL_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'closed'];

function statusLabel(status) {
  const labels = {
    draft: 'Draft', open: 'Open', answered: 'Answered', closed: 'Closed', cancelled: 'Cancelled',
    submitted: 'Submitted', under_review: 'Under review', approved: 'Approved', approved_as_noted: 'Approved as noted',
    revise_resubmit: 'Revise and resubmit', rejected: 'Rejected',
  };
  return labels[status] || status || 'Draft';
}

function companyFirstName(person) {
  const company = String(person?.company || '').trim();
  const contact = `${person?.first || ''} ${person?.last || ''}`.trim();
  if (company && contact) return `${company} (${contact})`;
  return company || contact || 'Unnamed person';
}

function nextNumber(type, records) {
  const max = (records || []).reduce((current, record) => Math.max(current, Number(String(record.number || '').replace(/\D/g, '')) || 0), 0);
  return `${TYPES[type].prefix}-${String(max + 1).padStart(3, '0')}`;
}

function emptyDraft(type, records) {
  if (type === 'rfis') return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'open', question: '', response: '',
    responsibleId: '', responsibleName: '', dueDate: '', responseDate: '', costImpact: '', scheduleDays: '', notes: '',
  };
  return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'draft', specSection: '',
    subcontractorId: '', subcontractorName: '', reviewer: '', description: '', dueDate: '', submittedDate: '',
    decisionDate: '', reviewerNotes: '', notes: '',
  };
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && value !== ''
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(number)
    : 'Not set';
}

export default function ProjectRfiSubmittalsManager({ project, data, canEdit = true }) {
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit }), [canEdit, project.id]);
  const [activeType, setActiveType] = useState('rfis');
  const [recordsByType, setRecordsByType] = useState({ rfis: [], submittals: [] });
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const records = recordsByType[activeType] || [];
  const meta = TYPES[activeType];

  const responsibleOptions = useMemo(() => [
    ...(data?.subs || []).map((person) => ({ id: String(person.id), label: companyFirstName(person) })),
    ...(data?.employees || []).map((person) => ({ id: String(person.id), label: personAssignmentLabel(person) })),
  ].filter((person) => person.id && person.label).sort((a, b) => a.label.localeCompare(b.label)), [data?.employees, data?.subs]);

  const subcontractorOptions = useMemo(() => (data?.subs || [])
    .map((person) => ({ id: String(person.id), label: companyFirstName(person) }))
    .filter((person) => person.id && person.label)
    .sort((a, b) => a.label.localeCompare(b.label)), [data?.subs]);

  async function loadRecords() {
    setLoading(true);
    setMessage('');
    try {
      const [rfis, submittals] = await Promise.all([service.list('rfis'), service.list('submittals')]);
      setRecordsByType({ rfis: rfis.records || [], submittals: submittals.records || [] });
      setSetupRequired(rfis.setupRequired === true || submittals.setupRequired === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load RFIs and submittals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecords(); }, [service]);

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function selectPerson(field, nameField, id, options) {
    change(field, id);
    change(nameField, options.find((person) => person.id === id)?.label || '');
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
    const confirmed = await showAppConfirm(`Delete ${record.number} ${record.title}?`, {
      title: `Delete ${meta.singular}`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
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
    <div className="project-workflow-manager project-document-workflow-manager">
      <header className="project-workflow-header">
        <div><p className="eyebrow">Project communication</p><h2>RFIs &amp; submittals</h2><p>{meta.description}</p></div>
        {canEdit ? <button className="button primary" type="button" onClick={() => setDraft(emptyDraft(activeType, records))}><FluentIcon name="add" size={16} />New {meta.singular}</button> : null}
      </header>

      <div className="project-document-workflow-switch" role="tablist" aria-label="RFIs and submittals">
        {Object.entries(TYPES).map(([type, item]) => <button key={type} type="button" role="tab" aria-selected={activeType === type} className={activeType === type ? 'active' : ''} onClick={() => switchType(type)}>{item.plural}<span>{recordsByType[type].length}</span></button>)}
      </div>

      {setupRequired ? <div className="project-workflow-notice"><FluentIcon name="warning" size={18} /><span>Using device-only draft storage until the included RFIs-and-submittals migration is applied.</span></div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}

      {draft ? (
        <section className="project-workflow-editor">
          <div className="project-workflow-editor-heading"><h3>{draft.id ? 'Edit' : 'Create'} {meta.singular}</h3><button className="button secondary" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            <label><span>Number</span><input value={draft.number} onChange={(event) => change('number', event.target.value)} /></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => change('status', event.target.value)}>{(activeType === 'rfis' ? RFI_STATUSES : SUBMITTAL_STATUSES).map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
            <label className="full"><span>{activeType === 'rfis' ? 'Subject' : 'Title'}</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
            {activeType === 'rfis' ? (
              <>
                <label className="full"><span>Question</span><textarea value={draft.question} onChange={(event) => change('question', event.target.value)} /></label>
                <label><span>Responsible person</span><select value={draft.responsibleId} onChange={(event) => selectPerson('responsibleId', 'responsibleName', event.target.value, responsibleOptions)}><option value="">Unassigned</option>{responsibleOptions.map((person) => <option value={person.id} key={person.id}>{person.label}</option>)}</select></label>
                <label><span>Response due</span><input type="date" value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
                <label className="full"><span>Response</span><textarea value={draft.response} onChange={(event) => change('response', event.target.value)} /></label>
                <label><span>Response date</span><input type="date" value={draft.responseDate} onChange={(event) => change('responseDate', event.target.value)} /></label>
                <label><span>Cost impact</span><input type="number" step="0.01" value={draft.costImpact} onChange={(event) => change('costImpact', event.target.value)} /></label>
                <label><span>Schedule impact (days)</span><input type="number" value={draft.scheduleDays} onChange={(event) => change('scheduleDays', event.target.value)} /></label>
                <label className="full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
              </>
            ) : (
              <>
                <label><span>Specification section</span><input value={draft.specSection} onChange={(event) => change('specSection', event.target.value)} placeholder="08 71 00" /></label>
                <label><span>Subcontractor</span><select value={draft.subcontractorId} onChange={(event) => selectPerson('subcontractorId', 'subcontractorName', event.target.value, subcontractorOptions)}><option value="">Unassigned</option>{subcontractorOptions.map((person) => <option value={person.id} key={person.id}>{person.label}</option>)}</select></label>
                <label className="full"><span>Description</span><textarea value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
                <label><span>Reviewer</span><input value={draft.reviewer} onChange={(event) => change('reviewer', event.target.value)} /></label>
                <label><span>Review due</span><input type="date" value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
                <label><span>Submitted date</span><input type="date" value={draft.submittedDate} onChange={(event) => change('submittedDate', event.target.value)} /></label>
                <label><span>Decision date</span><input type="date" value={draft.decisionDate} onChange={(event) => change('decisionDate', event.target.value)} /></label>
                <label className="full"><span>Reviewer notes</span><textarea value={draft.reviewerNotes} onChange={(event) => change('reviewerNotes', event.target.value)} /></label>
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

      {loading ? <div className="empty-state compact"><p>Loading RFIs and submittals…</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => (
            <article className="project-workflow-card" key={record.id}>
              <div className="project-workflow-card-heading">
                <div><span className={`status-pill status-${record.status}`}>{statusLabel(record.status)}</span><h3>{record.number} · {record.title}</h3></div>
                {canEdit ? <button className="button secondary gantt-icon-button" type="button" onClick={() => setDraft({ ...record })} aria-label={`Edit ${record.number}`}><FluentIcon name="edit" /></button> : null}
              </div>
              {activeType === 'rfis' ? (
                <dl className="project-workflow-summary"><div><dt>Responsible</dt><dd>{record.responsibleName || 'Unassigned'}</dd></div><div><dt>Response due</dt><dd>{record.dueDate ? formatShortDate(record.dueDate) : 'Not set'}</dd></div><div><dt>Potential impact</dt><dd>{record.costImpact !== '' ? money(record.costImpact) : record.scheduleDays ? `${record.scheduleDays} days` : 'None recorded'}</dd></div></dl>
              ) : (
                <dl className="project-workflow-summary"><div><dt>Specification</dt><dd>{record.specSection || 'Not set'}</dd></div><div><dt>Subcontractor</dt><dd>{record.subcontractorName || 'Unassigned'}</dd></div><div><dt>Review due</dt><dd>{record.dueDate ? formatShortDate(record.dueDate) : 'Not set'}</dd></div></dl>
              )}
            </article>
          ))}
        </div>
      ) : <div className="empty-state compact"><h3>{meta.empty}</h3><p>{canEdit ? `Create the first ${meta.singular} for this project.` : 'No records are available.'}</p></div>}
    </div>
  );
}
