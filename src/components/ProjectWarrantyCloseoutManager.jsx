import React, { useEffect, useMemo, useState } from 'react';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { personAssignmentLabel } from '../utils/accessUi.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import WorkflowAttachments, { addPendingWorkflowAttachments, deleteWorkflowAttachments, prepareWorkflowAttachments, removeWorkflowAttachment } from './WorkflowAttachments.jsx';

const TYPES = {
  warrantyItems: {
    singular: 'warranty item', plural: 'Warranty', prefix: 'WAR', empty: 'No warranty items yet',
    description: 'Track reported warranty concerns, responsibility, scheduling, and resolution.',
  },
  closeoutItems: {
    singular: 'closeout item', plural: 'Closeout', prefix: 'CLS', empty: 'No closeout items yet',
    description: 'Manage the final documents, inspections, training, handover, and completion checklist.',
  },
};

const WARRANTY_STATUSES = ['open', 'scheduled', 'in_progress', 'completed', 'not_covered'];
const CLOSEOUT_STATUSES = ['not_started', 'in_progress', 'blocked', 'complete', 'not_applicable'];
const WARRANTY_CATEGORIES = ['General', 'Exterior', 'Interior', 'Mechanical', 'Electrical', 'Plumbing', 'Appliances', 'Other'];
const CLOSEOUT_CATEGORIES = ['Punch list', 'Final inspection', 'Document', 'Training', 'Handover', 'Payment', 'Other'];

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statusLabel(status) {
  return ({
    open: 'Open', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', not_covered: 'Not covered',
    not_started: 'Not started', blocked: 'Blocked', complete: 'Complete', not_applicable: 'Not applicable',
  })[status] || status || 'Not started';
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
  if (type === 'warrantyItems') return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'open', category: 'General', priority: 'normal',
    reportedBy: '', reportedDate: today(), responsibleId: '', responsibleName: '', dueDate: '', scheduledDate: '',
    completedDate: '', warrantyEndDate: '', description: '', resolution: '', notes: '', attachments: [], deletedAttachments: [],
  };
  return {
    id: '', version: 0, number: nextNumber(type, records), title: '', status: 'not_started', category: 'Punch list', required: true,
    responsibleId: '', responsibleName: '', dueDate: '', completedDate: '', description: '', notes: '', attachments: [], deletedAttachments: [],
  };
}

function emptyCustomerDraft() {
  return { title: '', category: 'General', priority: 'normal', description: '' };
}

function CustomerWarrantyRequests({ project, activeUser }) {
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit: false }), [project.id]);
  const [records, setRecords] = useState([]);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);

  async function loadRecords() {
    setLoading(true);
    setMessage('');
    try {
      const result = await service.listCustomerWarrantyRequests();
      setRecords(result.records || []);
      setSetupRequired(result.setupRequired === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load warranty requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecords(); }, [service]);

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit() {
    if (!draft || saving || draft.title.trim().length < 3 || draft.description.trim().length < 3) return;
    setSaving(true);
    setMessage('');
    setSuccessMessage('');
    try {
      const result = await service.submitCustomerWarrantyRequest(draft);
      setSetupRequired(result.setupRequired === true);
      setDraft(null);
      setSuccessMessage(`Warranty request ${result.record.number} was submitted.`);
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit warranty request.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="project-workflow-manager project-document-workflow-manager project-warranty-closeout-manager customer-warranty-manager">
      <header className="project-workflow-header">
        <div><p className="eyebrow">Project support</p><h2>Warranty requests</h2><p>Report a warranty concern and follow its status. Your builder will manage scheduling, responsibility, and resolution.</p></div>
        <button className="button primary" type="button" onClick={() => { setDraft(emptyCustomerDraft()); setSuccessMessage(''); }}><FluentIcon name="add" size={16} />Submit request</button>
      </header>

      {setupRequired ? <div className="project-workflow-notice"><FluentIcon name="warning" size={18} /><span>Customer warranty requests require the included database migration before they can be shared with your builder.</span></div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}
      {successMessage ? <div className="audit-trail-message success" role="status">{successMessage}</div> : null}

      {draft ? (
        <section className="project-workflow-editor">
          <div className="project-workflow-editor-heading"><div><h3>Submit a warranty request</h3><p>Submitted as {activeUser?.email || 'your customer account'}.</p></div><button className="button secondary" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            <label className="full"><span>Title</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} maxLength={255} placeholder="Briefly identify the concern" /></label>
            <label><span>Category</span><select value={draft.category} onChange={(event) => change('category', event.target.value)}>{WARRANTY_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
            <label><span>Priority</span><select value={draft.priority} onChange={(event) => change('priority', event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="full"><span>Description</span><textarea value={draft.description} onChange={(event) => change('description', event.target.value)} maxLength={10000} placeholder="Describe the issue, its location, and when you first noticed it" /></label>
          </div>
          <div className="project-workflow-editor-actions"><button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={() => void submit()} disabled={saving || draft.title.trim().length < 3 || draft.description.trim().length < 3}>{saving ? 'Submitting…' : 'Submit warranty request'}</button></div>
        </section>
      ) : null}

      {loading ? <div className="empty-state compact"><p>Loading warranty requests…</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => (
            <article className="project-workflow-card" key={record.id}>
              <div className="project-workflow-card-heading"><div><span className={`status-pill status-${record.status}`}>{statusLabel(record.status)}</span><h3>{record.number} · {record.title}</h3></div></div>
              <dl className="project-workflow-summary"><div><dt>Submitted</dt><dd>{record.reportedDate ? formatShortDate(record.reportedDate) : 'Not available'}</dd></div><div><dt>Category / priority</dt><dd>{record.category || 'General'} · {statusLabel(record.priority || 'normal')}</dd></div><div><dt>Scheduled</dt><dd>{record.scheduledDate ? formatShortDate(record.scheduledDate) : 'Not scheduled'}</dd></div></dl>
              <div className="customer-warranty-description"><strong>Description</strong><p>{record.description}</p>{record.resolution ? <><strong>Resolution</strong><p>{record.resolution}</p></> : null}</div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state compact"><h3>No warranty requests yet</h3><p>Submit a request if something in your completed project needs warranty attention.</p></div>}
    </div>
  );
}

function StaffWarrantyCloseoutManager({ project, data, canEdit = true }) {
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit }), [canEdit, project.id]);
  const [activeType, setActiveType] = useState('warrantyItems');
  const [recordsByType, setRecordsByType] = useState({ warrantyItems: [], closeoutItems: [] });
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const records = recordsByType[activeType] || [];
  const meta = TYPES[activeType];
  const warranty = recordsByType.warrantyItems;
  const closeout = recordsByType.closeoutItems;

  const subcontractorOptions = useMemo(() => (data?.subs || [])
    .map((person) => ({ id: String(person.id || ''), label: companyFirstName(person) }))
    .filter((person) => person.id)
    .sort((a, b) => a.label.localeCompare(b.label)), [data?.subs]);
  const responsibleOptions = useMemo(() => [
    ...subcontractorOptions,
    ...(data?.employees || []).map((person) => ({ id: String(person.id || ''), label: personAssignmentLabel(person) })),
  ].filter((person) => person.id).sort((a, b) => a.label.localeCompare(b.label)), [data?.employees, subcontractorOptions]);

  const summary = useMemo(() => {
    const openWarranty = warranty.filter((item) => !['completed', 'not_covered'].includes(item.status)).length;
    const completedWarranty = warranty.filter((item) => item.status === 'completed').length;
    const requiredCloseout = closeout.filter((item) => item.required !== false && item.status !== 'not_applicable');
    const completedCloseout = requiredCloseout.filter((item) => item.status === 'complete').length;
    const closeoutPercent = requiredCloseout.length ? Math.round((completedCloseout / requiredCloseout.length) * 100) : 0;
    return { openWarranty, completedWarranty, remainingCloseout: Math.max(0, requiredCloseout.length - completedCloseout), closeoutPercent };
  }, [closeout, warranty]);

  async function loadRecords() {
    setLoading(true);
    setMessage('');
    try {
      const [warrantyResult, closeoutResult] = await Promise.all([service.list('warrantyItems'), service.list('closeoutItems')]);
      setRecordsByType({ warrantyItems: warrantyResult.records || [], closeoutItems: closeoutResult.records || [] });
      setSetupRequired(warrantyResult.setupRequired === true || closeoutResult.setupRequired === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load warranty and closeout records.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecords(); }, [service]);

  function change(field, value) { setDraft((current) => ({ ...current, [field]: value })); }
  function addAttachments(fileList) { setDraft((current) => addPendingWorkflowAttachments(current, fileList)); }
  function removeAttachment(attachmentId) { setDraft((current) => removeWorkflowAttachment(current, attachmentId)); }

  function selectResponsible(id, options) {
    setDraft((current) => ({ ...current, responsibleId: id, responsibleName: options.find((person) => person.id === id)?.label || '' }));
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
    let uploaded = [];
    try {
      const preparedResult = await prepareWorkflowAttachments(project.id, activeType === 'warrantyItems' ? 'warranty-attachments' : 'closeout-attachments', draft);
      uploaded = preparedResult.uploaded;
      const result = await service.save(activeType, preparedResult.prepared);
      await deleteWorkflowAttachments(draft.deletedAttachments);
      setSetupRequired(result.setupRequired === true);
      setDraft(null);
      await loadRecords();
    } catch (error) {
      await deleteWorkflowAttachments(uploaded);
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
      await deleteWorkflowAttachments(record.attachments);
      setDraft(null);
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to delete ${meta.singular}.`);
    } finally {
      setSaving(false);
    }
  }

  const activeResponsibleOptions = activeType === 'warrantyItems' ? subcontractorOptions : responsibleOptions;

  return (
    <div className="project-workflow-manager project-document-workflow-manager project-warranty-closeout-manager">
      <header className="project-workflow-header">
        <div><p className="eyebrow">Project completion</p><h2>Warranty &amp; closeout</h2><p>{meta.description}</p></div>
        {canEdit ? <button className="button primary" type="button" onClick={() => setDraft(emptyDraft(activeType, records))}><FluentIcon name="add" size={16} />New {meta.singular}</button> : null}
      </header>

      <section className="project-financial-summary" aria-label="Warranty and closeout summary">
        <div><span>Open warranty</span><strong>{summary.openWarranty}</strong><small>Needs resolution</small></div>
        <div><span>Warranty completed</span><strong>{summary.completedWarranty}</strong><small>{warranty.length} total items</small></div>
        <div><span>Closeout remaining</span><strong>{summary.remainingCloseout}</strong><small>Required items</small></div>
        <div><span>Closeout progress</span><strong>{summary.closeoutPercent}%</strong><small>Required checklist complete</small></div>
      </section>

      <div className="project-document-workflow-switch" role="tablist" aria-label="Warranty and closeout">
        {Object.entries(TYPES).map(([type, item]) => <button key={type} type="button" role="tab" aria-selected={activeType === type} className={activeType === type ? 'active' : ''} onClick={() => switchType(type)}>{item.plural}<span>{recordsByType[type].length}</span></button>)}
      </div>

      {setupRequired ? <div className="project-workflow-notice"><FluentIcon name="warning" size={18} /><span>Using device-only draft storage until the included warranty-and-closeout migration is applied.</span></div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}

      {draft ? (
        <section className="project-workflow-editor">
          <div className="project-workflow-editor-heading"><h3>{draft.id ? 'Edit' : 'Create'} {meta.singular}</h3><button className="button secondary" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            <label><span>Number</span><input value={draft.number} onChange={(event) => change('number', event.target.value)} /></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => change('status', event.target.value)}>{(activeType === 'warrantyItems' ? WARRANTY_STATUSES : CLOSEOUT_STATUSES).map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
            <label className="full"><span>Title</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
            {activeType === 'warrantyItems' ? (
              <>
                <label><span>Category</span><select value={draft.category} onChange={(event) => change('category', event.target.value)}>{WARRANTY_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
                <label><span>Priority</span><select value={draft.priority} onChange={(event) => change('priority', event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                <label><span>Reported by</span><input value={draft.reportedBy} onChange={(event) => change('reportedBy', event.target.value)} /></label>
                <label><span>Reported date</span><input type="date" value={draft.reportedDate} onChange={(event) => change('reportedDate', event.target.value)} /></label>
                <label><span>Responsible subcontractor</span><select value={draft.responsibleId} onChange={(event) => selectResponsible(event.target.value, activeResponsibleOptions)}><option value="">Unassigned</option>{activeResponsibleOptions.map((person) => <option value={person.id} key={person.id}>{person.label}</option>)}</select></label>
                <label><span>Target date</span><input type="date" value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
                <label><span>Scheduled date</span><input type="date" value={draft.scheduledDate} onChange={(event) => change('scheduledDate', event.target.value)} /></label>
                <label><span>Completed date</span><input type="date" value={draft.completedDate} onChange={(event) => change('completedDate', event.target.value)} /></label>
                <label><span>Warranty end date</span><input type="date" value={draft.warrantyEndDate} onChange={(event) => change('warrantyEndDate', event.target.value)} /></label>
                <label className="full"><span>Description</span><textarea value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
                <label className="full"><span>Resolution</span><textarea value={draft.resolution} onChange={(event) => change('resolution', event.target.value)} /></label>
              </>
            ) : (
              <>
                <label><span>Category</span><select value={draft.category} onChange={(event) => change('category', event.target.value)}>{CLOSEOUT_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
                <label><span>Responsible person</span><select value={draft.responsibleId} onChange={(event) => selectResponsible(event.target.value, activeResponsibleOptions)}><option value="">Unassigned</option>{activeResponsibleOptions.map((person) => <option value={person.id} key={person.id}>{person.label}</option>)}</select></label>
                <label><span>Due date</span><input type="date" value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
                <label><span>Completed date</span><input type="date" value={draft.completedDate} onChange={(event) => change('completedDate', event.target.value)} /></label>
                <label className="checkbox-label full"><input type="checkbox" checked={draft.required !== false} onChange={(event) => change('required', event.target.checked)} /><span>Required for project closeout</span></label>
                <label className="full"><span>Description / acceptance criteria</span><textarea value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
              </>
            )}
            <label className="full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
            <WorkflowAttachments attachments={draft.attachments || []} onAdd={addAttachments} onRemove={removeAttachment} disabled={saving} />
          </div>
          <div className="project-workflow-editor-actions">
            {draft.id ? <button className="button secondary danger" type="button" onClick={() => void remove(draft)} disabled={saving}>Delete</button> : null}
            <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </section>
      ) : null}

      {loading ? <div className="empty-state compact"><p>Loading warranty and closeout…</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => (
            <article className="project-workflow-card" key={record.id}>
              <div className="project-workflow-card-heading">
                <div><span className={`status-pill status-${record.status}`}>{statusLabel(record.status)}</span><h3>{record.number} · {record.title}</h3></div>
                {canEdit ? <button className="button secondary gantt-icon-button" type="button" onClick={() => setDraft({ ...record, deletedAttachments: [] })} aria-label={`Edit ${record.number}`}><FluentIcon name="edit" /></button> : null}
              </div>
              {activeType === 'warrantyItems' ? (
                <dl className="project-workflow-summary"><div><dt>Responsible</dt><dd>{record.responsibleName || 'Unassigned'}</dd></div><div><dt>Target</dt><dd>{record.dueDate ? formatShortDate(record.dueDate) : 'Not set'}</dd></div><div><dt>Category / priority</dt><dd>{record.category || 'General'} · {record.priority || 'normal'}</dd></div></dl>
              ) : (
                <dl className="project-workflow-summary"><div><dt>Responsible</dt><dd>{record.responsibleName || 'Unassigned'}</dd></div><div><dt>Due</dt><dd>{record.dueDate ? formatShortDate(record.dueDate) : 'Not set'}</dd></div><div><dt>Requirement</dt><dd>{record.required === false ? 'Optional' : 'Required'} · {record.category || 'Other'}</dd></div></dl>
              )}
            </article>
          ))}
        </div>
      ) : <div className="empty-state compact"><h3>{meta.empty}</h3><p>{canEdit ? `Create the first ${meta.singular} for this project.` : 'No records are available.'}</p></div>}
    </div>
  );
}

export default function ProjectWarrantyCloseoutManager({ customerMode = false, activeUser = null, ...props }) {
  return customerMode
    ? <CustomerWarrantyRequests project={props.project} activeUser={activeUser} />
    : <StaffWarrantyCloseoutManager {...props} />;
}
