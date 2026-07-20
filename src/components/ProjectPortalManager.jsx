import React, { useEffect, useMemo, useState } from 'react';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { formatShortDate } from '../utils/calendarUi.js';
import FluentIcon from './FluentIcon.jsx';

const PORTAL_ROLES = new Set(['Customer', 'Subcontractor']);
const STATUS_LABELS = {
  draft: 'Draft', published: 'Published', response_requested: 'Response requested', answered: 'Answered',
  approved: 'Approved', declined: 'Declined', closed: 'Closed',
};

function nextNumber(records) {
  const highest = records.reduce((max, record) => Math.max(max, Number(String(record.number || '').match(/\d+/)?.[0]) || 0), 0);
  return `POR-${String(highest + 1).padStart(3, '0')}`;
}

function emptyDraft(records) {
  return {
    id: '', number: nextNumber(records), title: '', itemType: 'update', audience: 'all', status: 'published',
    dueDate: '', message: '', response: '', version: 0,
  };
}

export default function ProjectPortalManager({ project, activeUser, canEdit = true }) {
  const role = String(activeUser?.role || 'View Only');
  const portalUser = PORTAL_ROLES.has(role);
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit }), [canEdit, project.id]);
  const [records, setRecords] = useState([]);
  const [draft, setDraft] = useState(null);
  const [responseDraft, setResponseDraft] = useState({ id: '', text: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage('');
    void service.list('portalItems').then((result) => {
      if (cancelled) return;
      const audience = role.toLowerCase();
      setRecords(portalUser ? result.records.filter((record) => ['all', audience].includes(record.audience)) : result.records);
      setLocalMode(!!result.local);
    }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load portal items.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [portalUser, role, service]);

  function updateDraft(field, value) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === 'itemType' && !current.id) next.status = value === 'update' ? 'published' : 'response_requested';
      return next;
    });
  }

  async function saveDraft(event) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.message.trim()) {
      setMessage('Add a title and message before publishing.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = await service.save('portalItems', { ...draft, title: draft.title.trim(), message: draft.message.trim() });
      setRecords((current) => [result.record, ...current.filter((record) => record.id !== result.record.id)]);
      setLocalMode(!!result.local);
      setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save portal item.');
    } finally { setSaving(false); }
  }

  async function removeRecord(record) {
    if (!window.confirm(`Delete ${record.number}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await service.remove('portalItems', record);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setLocalMode(!!result.local);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete portal item.');
    } finally { setSaving(false); }
  }

  async function submitResponse(record, decision = '') {
    const text = responseDraft.id === record.id ? responseDraft.text.trim() : '';
    if (!text && !decision) {
      setMessage('Add a response before submitting.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = await service.respondToPortalItem(record, text, decision);
      setRecords((current) => current.map((item) => (item.id === record.id ? result.record : item)));
      setResponseDraft({ id: '', text: '' });
      setLocalMode(!!result.local);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save your response.');
    } finally { setSaving(false); }
  }

  return (
    <div className="project-workflow-manager project-portal-manager">
      <header className="project-workflow-header">
        <div><p className="eyebrow">Project portal</p><h2>{portalUser ? `Welcome to ${project.name}` : 'Customer & subcontractor portal'}</h2><p>{portalUser ? 'Review published project updates and respond to requests.' : 'Publish selected updates, questions, and approval requests without exposing internal project notes.'}</p></div>
        {canEdit ? <button className="button primary" type="button" onClick={() => setDraft(emptyDraft(records))}><FluentIcon name="add" size={16} />New portal item</button> : null}
      </header>

      {localMode ? <div className="project-workflow-notice">Using device-only draft storage until the included project-portal migration is applied.</div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}

      {draft ? (
        <form className="project-workflow-editor" onSubmit={saveDraft}>
          <div className="project-workflow-editor-heading"><h3>{draft.id ? `Edit ${draft.number}` : 'Create portal item'}</h3><button className="button secondary" type="button" onClick={() => setDraft(null)}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            <label><span>Item number</span><input value={draft.number} onChange={(event) => updateDraft('number', event.target.value)} required /></label>
            <label><span>Type</span><select value={draft.itemType} onChange={(event) => updateDraft('itemType', event.target.value)}><option value="update">Project update</option><option value="request">Information request</option><option value="approval">Approval request</option></select></label>
            <label><span>Audience</span><select value={draft.audience} onChange={(event) => updateDraft('audience', event.target.value)}><option value="all">Customers and subcontractors</option><option value="customer">Customers only</option><option value="subcontractor">Subcontractors only</option></select></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => updateDraft('status', event.target.value)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="full"><span>Title</span><input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} required /></label>
            <label><span>Response due</span><input type="date" value={draft.dueDate || ''} onChange={(event) => updateDraft('dueDate', event.target.value)} /></label>
            <label className="full"><span>Message</span><textarea value={draft.message} onChange={(event) => updateDraft('message', event.target.value)} required /></label>
          </div>
          <div className="project-workflow-editor-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
        </form>
      ) : null}

      {loading ? <div className="empty-state compact"><p>Loading portal items…</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => {
            const acceptsResponse = portalUser && !['draft', 'closed'].includes(record.status);
            const responding = responseDraft.id === record.id;
            return (
              <article className="project-workflow-card project-portal-card" key={record.id}>
                <div className="project-workflow-card-heading">
                  <div><span className="project-workflow-number">{record.number}</span><h3>{record.title}</h3><p>{record.itemType === 'approval' ? 'Approval request' : record.itemType === 'request' ? 'Information request' : 'Project update'} · {record.audience === 'all' ? 'All portal users' : `${record.audience[0].toUpperCase()}${record.audience.slice(1)}s`}</p></div>
                  <div className="project-workflow-card-actions"><span className={`status-pill status-${record.status}`}>{STATUS_LABELS[record.status] || record.status}</span>{canEdit ? <><button className="button secondary gantt-icon-button" type="button" onClick={() => setDraft({ ...record })} aria-label={`Edit ${record.number}`}><FluentIcon name="edit" /></button><button className="button danger gantt-icon-button" type="button" onClick={() => void removeRecord(record)} aria-label={`Delete ${record.number}`}><FluentIcon name="delete" /></button></> : null}</div>
                </div>
                <p className="project-portal-message">{record.message}</p>
                {record.dueDate ? <p className="project-portal-due"><strong>Response due:</strong> {formatShortDate(record.dueDate)}</p> : null}
                {record.response ? <div className="project-portal-response"><strong>Portal response</strong><p>{record.response}</p>{record.respondedAt ? <span>{formatShortDate(record.respondedAt)}</span> : null}</div> : null}
                {acceptsResponse ? (
                  responding ? <div className="project-portal-response-form"><label><span>Your response</span><textarea value={responseDraft.text} onChange={(event) => setResponseDraft({ id: record.id, text: event.target.value })} /></label><div>{record.itemType === 'approval' ? <><button className="button primary" type="button" disabled={saving} onClick={() => void submitResponse(record, 'approved')}>Approve</button><button className="button danger" type="button" disabled={saving} onClick={() => void submitResponse(record, 'declined')}>Decline</button></> : <button className="button primary" type="button" disabled={saving} onClick={() => void submitResponse(record)}>Submit response</button>}<button className="button secondary" type="button" onClick={() => setResponseDraft({ id: '', text: '' })}>Cancel</button></div></div>
                    : <button className="button secondary" type="button" onClick={() => setResponseDraft({ id: record.id, text: record.response || '' })}>{record.itemType === 'approval' ? 'Review request' : 'Respond'}</button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state compact"><h3>No portal items yet</h3><p>{canEdit ? 'Publish the first customer or subcontractor update.' : 'There are no published updates for you yet.'}</p></div>}
    </div>
  );
}
