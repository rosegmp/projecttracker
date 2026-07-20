import React, { useEffect, useMemo, useState } from 'react';
import { createConstructionWorkflowService } from '../services/constructionWorkflows.js';
import { createPerson, deleteProjectFileFromStorage, downloadProjectFileFromStorage, uploadProjectFileToStorage } from '../services/trackerData.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { formatCurrentWeather, loadCurrentWeatherConditions } from '../utils/weather.js';
import { openPreview } from '../platform/platformAdapter.js';
import { showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import PersonModal from './PersonModal.jsx';

const TODAY = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function emptyDraft(type, records) {
  if (type === 'dailyLogs') return {
    id: '', version: 0, date: TODAY(), title: 'Daily log', weather: '',
    subcontractorWork: [], deletedPhotos: [], deliveries: '', visitors: '', delays: '', issues: '', notes: '',
  };
  const maxNumber = (records || []).reduce((max, record) => Math.max(max, Number(String(record.number || '').replace(/\D/g, '')) || 0), 0);
  return {
    id: '', version: 0, number: `CO-${String(maxNumber + 1).padStart(3, '0')}`, title: '', status: 'proposed',
    description: '', reason: '', costImpact: '', scheduleDays: '', dueDate: '', approvalDate: '', notes: '',
  };
}

function createId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function contractorEntries(record) {
  return Array.isArray(record?.subcontractorWork) ? record.subcontractorWork : [];
}

function contractorPhotos(record) {
  return contractorEntries(record).flatMap((entry) => (Array.isArray(entry.photos) ? entry.photos : []));
}

function subcontractorDisplayName(person) {
  const company = String(person?.company || '').trim();
  const contact = `${person?.first || ''} ${person?.last || ''}`.trim();
  if (company && contact) return `${company} (${contact})`;
  return company || contact || 'Unnamed subcontractor';
}

function subcontractorEntryName(entry, options) {
  return options.find((person) => person.id === String(entry?.subcontractorId || ''))?.label
    || String(entry?.subcontractorCompany || '').trim()
    || String(entry?.subcontractorName || '').trim()
    || 'Unselected subcontractor';
}

function dailyDraftFromRecord(record) {
  return { ...record, deletedPhotos: [] };
}

function WorkflowPhoto({ photo, onRemove = null, disabled = false }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void (async () => {
      try {
        const source = photo?.file || (photo?.storagePath ? await downloadProjectFileFromStorage(photo) : photo?.dataUrl || '');
        if (!source || cancelled) return;
        objectUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
        setPreviewUrl(objectUrl);
      } catch {
        // Keep the photo name and controls available if its thumbnail cannot be loaded.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  async function openPhoto() {
    const source = photo?.file || (photo?.storagePath ? await downloadProjectFileFromStorage(photo) : photo?.dataUrl || '');
    if (source) openPreview(source, { features: 'noopener' });
  }

  const name = photo?.name || photo?.originalName || 'Work photo';
  return (
    <div className="project-workflow-photo">
      <button type="button" className="project-workflow-photo-preview" onClick={() => void openPhoto()} aria-label={`Open ${name}`}>
        {previewUrl ? <img src={previewUrl} alt="" /> : <FluentIcon name="camera" size={20} />}
      </button>
      <span title={name}>{name}</span>
      {onRemove ? <button type="button" className="button secondary gantt-icon-button" onClick={onRemove} disabled={disabled} aria-label={`Remove ${name}`}><FluentIcon name="delete" size={16} /></button> : null}
    </div>
  );
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(number) : 'Not set';
}

export default function ProjectWorkflowManager({ data, project, canEdit = true, workflowType, subcontractors = [], onStateChange = null }) {
  const daily = workflowType === 'dailyLogs';
  const service = useMemo(() => createConstructionWorkflowService({ projectId: project.id, canEdit }), [canEdit, project.id]);
  const [records, setRecords] = useState([]);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [personDraft, setPersonDraft] = useState(null);
  const [personSaving, setPersonSaving] = useState(false);
  const [weatherPrefilling, setWeatherPrefilling] = useState(false);
  const subcontractorOptions = useMemo(() => (subcontractors || [])
    .map((person) => ({ id: String(person.id || ''), label: subcontractorDisplayName(person), company: String(person.company || '') }))
    .filter((person) => person.id && person.label)
    .sort((a, b) => a.label.localeCompare(b.label)), [subcontractors]);

  async function loadRecords() {
    setLoading(true);
    setMessage('');
    try {
      const result = await service.list(workflowType);
      setRecords(result.records || []);
      setSetupRequired(result.setupRequired === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load records.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadRecords(); }, [service, workflowType]);

  function change(field, value) { setDraft((current) => ({ ...current, [field]: value })); }

  async function startNewRecord() {
    setDraft(emptyDraft(workflowType, records));
    if (!daily) return;
    setWeatherPrefilling(true);
    try {
      const currentWeather = await loadCurrentWeatherConditions();
      const weatherText = formatCurrentWeather(currentWeather);
      setDraft((current) => current && !current.id && !String(current.weather || '').trim()
        ? { ...current, weather: weatherText }
        : current);
    } catch {
      // Weather is a convenience; leave the editable field blank if it is unavailable.
    } finally {
      setWeatherPrefilling(false);
    }
  }

  function addContractorEntry() {
    setDraft((current) => ({
      ...current,
      subcontractorWork: [...contractorEntries(current), { id: createId('contractor-work'), subcontractorId: '', subcontractorName: '', subcontractorCompany: '', workPerformed: '', photos: [] }],
    }));
  }

  function updateContractorEntry(entryId, patch) {
    setDraft((current) => ({
      ...current,
      subcontractorWork: contractorEntries(current).map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  }

  function selectContractor(entryId, subcontractorId) {
    const selected = subcontractorOptions.find((person) => person.id === subcontractorId);
    updateContractorEntry(entryId, {
      subcontractorId,
      subcontractorName: selected?.label || '',
      subcontractorCompany: selected?.company || '',
    });
  }

  function startCreateSubcontractor(entryId) {
    setPersonDraft({
      id: '', entryId, first: '', last: '', company: '', role: '', phone: '', email: '', license: '', notes: '', tags: '', type: 'sub',
    });
  }

  async function saveNewSubcontractor() {
    if (!personDraft || personSaving || !data || typeof onStateChange !== 'function') return;
    if (!personDraft.first.trim() && !personDraft.last.trim() && !personDraft.company.trim()) return;
    setPersonSaving(true);
    setMessage('');
    try {
      const previousIds = new Set((data.subs || []).map((person) => String(person.id)));
      const nextState = await createPerson(data, 'sub', personDraft);
      const created = (nextState.subs || []).find((person) => !previousIds.has(String(person.id)));
      onStateChange(nextState);
      if (created) {
        updateContractorEntry(personDraft.entryId, {
          subcontractorId: String(created.id || ''),
          subcontractorName: subcontractorDisplayName(created),
          subcontractorCompany: String(created.company || ''),
        });
      }
      setPersonDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add subcontractor.');
    } finally {
      setPersonSaving(false);
    }
  }

  function removeContractorEntry(entryId) {
    setDraft((current) => {
      const removed = contractorEntries(current).find((entry) => entry.id === entryId);
      const removedStoredPhotos = (removed?.photos || []).filter((photo) => photo.storagePath);
      return {
        ...current,
        subcontractorWork: contractorEntries(current).filter((entry) => entry.id !== entryId),
        deletedPhotos: [...(current.deletedPhotos || []), ...removedStoredPhotos],
      };
    });
  }

  function addContractorPhotos(entryId, fileList) {
    const files = Array.from(fileList || []).filter((file) => String(file.type || '').startsWith('image/'));
    if (!files.length) return;
    setDraft((current) => ({
      ...current,
      subcontractorWork: contractorEntries(current).map((entry) => entry.id === entryId
        ? {
            ...entry,
            photos: [
              ...(entry.photos || []),
              ...files.map((file) => ({ id: createId('work-photo'), name: file.name, originalName: file.name, type: file.type, size: file.size, file })),
            ],
          }
        : entry),
    }));
  }

  function removeContractorPhoto(entryId, photoId) {
    setDraft((current) => {
      const entry = contractorEntries(current).find((item) => item.id === entryId);
      const removed = (entry?.photos || []).find((photo) => photo.id === photoId);
      return {
        ...current,
        subcontractorWork: contractorEntries(current).map((item) => item.id === entryId
          ? { ...item, photos: (item.photos || []).filter((photo) => photo.id !== photoId) }
          : item),
        deletedPhotos: removed?.storagePath ? [...(current.deletedPhotos || []), removed] : current.deletedPhotos || [],
      };
    });
  }

  async function prepareDailyLogForSave(sourceDraft, uploadedPhotos) {
    const entries = [];
    for (const entry of contractorEntries(sourceDraft)) {
      const photos = [];
      for (const photo of entry.photos || []) {
        if (!photo.file) {
          photos.push(photo);
          continue;
        }
        const storedPhoto = {
          id: photo.id || createId('work-photo'),
          name: photo.name || photo.file.name,
          originalName: photo.originalName || photo.file.name,
          type: photo.type || photo.file.type,
          size: Number(photo.size || photo.file.size) || 0,
          uploadedAt: new Date().toISOString(),
          ...(await uploadProjectFileToStorage(project.id, 'daily-log-photos', photo.id || createId('work-photo'), photo.file)),
        };
        uploadedPhotos.push(storedPhoto);
        photos.push(storedPhoto);
      }
      entries.push({ ...entry, photos });
    }
    const prepared = { ...sourceDraft };
    delete prepared.deletedPhotos;
    delete prepared.workPerformed;
    delete prepared.labor;
    return { ...prepared, subcontractorWork: entries };
  }

  async function save() {
    if (!draft || saving) return;
    if (daily ? !draft.date : !draft.number.trim() || !draft.title.trim()) return;
    setSaving(true);
    setMessage('');
    const uploadedPhotos = [];
    try {
      const preparedDraft = daily ? await prepareDailyLogForSave(draft, uploadedPhotos) : draft;
      const result = await service.save(workflowType, preparedDraft);
      if (daily) await Promise.allSettled((draft.deletedPhotos || []).map((photo) => deleteProjectFileFromStorage(photo)));
      setSetupRequired(result.setupRequired === true);
      setDraft(null);
      await loadRecords();
    } catch (error) {
      await Promise.allSettled(uploadedPhotos.map((photo) => deleteProjectFileFromStorage(photo)));
      setMessage(error instanceof Error ? error.message : 'Unable to save record.');
    }
    finally { setSaving(false); }
  }

  async function remove(record) {
    const confirmed = await showAppConfirm(`Delete ${daily ? 'this daily log' : `${record.number} ${record.title}`}?`, { title: 'Delete record', confirmLabel: 'Delete', tone: 'danger' });
    if (!confirmed) return;
    setSaving(true);
    try {
      await service.remove(workflowType, record);
      if (daily) await Promise.allSettled(contractorPhotos(record).map((photo) => deleteProjectFileFromStorage(photo)));
      setDraft(null);
      await loadRecords();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete record.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="project-workflow-manager">
      <header className="project-workflow-header">
        <div>
          <p className="eyebrow">Project operations</p>
          <h2>{daily ? 'Daily logs' : 'Change orders'}</h2>
          <p>{daily ? 'Capture jobsite activity, staffing, deliveries, delays, issues, and weather.' : 'Track scope changes, approval, cost impact, and schedule impact.'}</p>
        </div>
        {canEdit ? <button className="button primary" type="button" onClick={() => void startNewRecord()}><FluentIcon name="add" size={16} />{daily ? 'New daily log' : 'New change order'}</button> : null}
      </header>

      {setupRequired ? <div className="project-workflow-notice"><FluentIcon name="warning" size={18} /><span>Using device-only draft storage until the included construction-workflows migration is applied.</span></div> : null}
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}

      {draft ? (
        <section className="project-workflow-editor">
          <div className="project-workflow-editor-heading"><h3>{draft.id ? 'Edit' : 'Create'} {daily ? 'daily log' : 'change order'}</h3><button className="button secondary" type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button></div>
          <div className="project-workflow-form-grid">
            {daily ? (
              <>
                <label><span>Date</span><input type="date" value={draft.date} onChange={(event) => change('date', event.target.value)} /></label>
                <label><span>Weather / conditions</span><input value={draft.weather} onChange={(event) => change('weather', event.target.value)} placeholder="Clear, 78°F; muddy site" />{weatherPrefilling ? <small className="project-workflow-field-status">Loading current weather…</small> : null}</label>
                <section className="project-workflow-contractors full" aria-labelledby="daily-log-contractors-heading">
                  <div className="project-workflow-contractors-heading">
                    <div><h4 id="daily-log-contractors-heading">Subcontractor work</h4><p>Select subcontractors from People and record their work and photos.</p></div>
                    <button className="button secondary" type="button" onClick={addContractorEntry}><FluentIcon name="add" size={16} />Add subcontractor</button>
                  </div>
                  {subcontractorOptions.length ? null : <p className="project-workflow-contractor-empty">Add subcontractors in People before assigning them to a daily log.</p>}
                  {contractorEntries(draft).map((entry, index) => (
                    <article className="project-workflow-contractor-editor" key={entry.id}>
                      <div className="project-workflow-contractor-number">Subcontractor {index + 1}</div>
                      <button className="button secondary gantt-icon-button" type="button" onClick={() => removeContractorEntry(entry.id)} aria-label={`Remove subcontractor ${index + 1}`}><FluentIcon name="delete" size={16} /></button>
                      <div className="project-workflow-contractor-select"><label><span>Subcontractor</span><select value={entry.subcontractorId || ''} onChange={(event) => selectContractor(entry.id, event.target.value)}><option value="">Select from People</option>{subcontractorOptions.map((person) => <option value={person.id} key={person.id}>{person.label}</option>)}</select></label><button className="button secondary" type="button" onClick={() => startCreateSubcontractor(entry.id)}><FluentIcon name="add" size={16} />New subcontractor</button></div>
                      <label className="project-workflow-contractor-work"><span>Work performed</span><textarea value={entry.workPerformed || ''} onChange={(event) => updateContractorEntry(entry.id, { workPerformed: event.target.value })} placeholder="Describe the work completed by this subcontractor" /></label>
                      <div className="project-workflow-contractor-photos">
                        <div className="project-workflow-contractor-photo-heading"><strong>Work photos</strong><label className="button secondary project-workflow-photo-picker"><FluentIcon name="camera" size={16} />Add photos<input className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { addContractorPhotos(entry.id, event.target.files); event.target.value = ''; }} /></label></div>
                        {(entry.photos || []).length ? <div className="project-workflow-photo-list">{entry.photos.map((photo) => <WorkflowPhoto key={photo.id} photo={photo} onRemove={() => removeContractorPhoto(entry.id, photo.id)} disabled={saving} />)}</div> : <span className="project-workflow-contractor-empty">No photos added.</span>}
                      </div>
                    </article>
                  ))}
                </section>
                <label><span>Deliveries</span><textarea value={draft.deliveries} onChange={(event) => change('deliveries', event.target.value)} /></label>
                <label><span>Visitors</span><textarea value={draft.visitors} onChange={(event) => change('visitors', event.target.value)} /></label>
                <label><span>Delays</span><textarea value={draft.delays} onChange={(event) => change('delays', event.target.value)} /></label>
                <label><span>Issues / safety</span><textarea value={draft.issues} onChange={(event) => change('issues', event.target.value)} /></label>
                <label className="full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
              </>
            ) : (
              <>
                <label><span>Number</span><input value={draft.number} onChange={(event) => change('number', event.target.value)} /></label>
                <label><span>Status</span><select value={draft.status} onChange={(event) => change('status', event.target.value)}><option value="draft">Draft</option><option value="proposed">Proposed</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="void">Void</option></select></label>
                <label className="full"><span>Title</span><input value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
                <label className="full"><span>Description / scope</span><textarea value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
                <label><span>Reason</span><textarea value={draft.reason} onChange={(event) => change('reason', event.target.value)} /></label>
                <label><span>Notes</span><textarea value={draft.notes} onChange={(event) => change('notes', event.target.value)} /></label>
                <label><span>Cost impact</span><input type="number" step="0.01" value={draft.costImpact} onChange={(event) => change('costImpact', event.target.value)} /></label>
                <label><span>Schedule impact (days)</span><input type="number" value={draft.scheduleDays} onChange={(event) => change('scheduleDays', event.target.value)} /></label>
                <label><span>Response due</span><input type="date" value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
                <label><span>Approval date</span><input type="date" value={draft.approvalDate} onChange={(event) => change('approvalDate', event.target.value)} /></label>
              </>
            )}
          </div>
          <div className="project-workflow-editor-actions">
            {draft.id ? <button className="button secondary danger" type="button" onClick={() => void remove(draft)} disabled={saving}>Delete</button> : null}
            <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </section>
      ) : null}

      {loading ? <div className="empty-state compact"><p>Loading {daily ? 'daily logs' : 'change orders'}...</p></div> : records.length ? (
        <div className="project-workflow-list">
          {records.map((record) => (
            <article className="project-workflow-card" key={record.id}>
              <div className="project-workflow-card-heading">
                <div><span className={`status-pill status-${record.status || 'active'}`}>{daily ? formatShortDate(record.date) : record.status}</span><h3>{daily ? record.title || 'Daily log' : `${record.number} · ${record.title}`}</h3></div>
                {canEdit ? <button className="button secondary gantt-icon-button" type="button" onClick={() => setDraft(daily ? dailyDraftFromRecord(record) : { ...record })} aria-label={`Edit ${daily ? `daily log ${record.date}` : record.number}`}><FluentIcon name="edit" /></button> : null}
              </div>
              {daily ? (
                <>
                  <dl className="project-workflow-summary"><div><dt>Weather</dt><dd>{record.weather || 'Not recorded'}</dd></div><div><dt>Notes</dt><dd>{record.notes || 'Not recorded'}</dd></div><div><dt>Delays / issues</dt><dd>{[record.delays, record.issues].filter(Boolean).join(' · ') || 'None recorded'}</dd></div></dl>
                  {contractorEntries(record).length ? <div className="project-workflow-contractor-summary">{contractorEntries(record).map((entry) => <div key={entry.id}><strong>{subcontractorEntryName(entry, subcontractorOptions)}</strong><span>{entry.workPerformed || 'No work details recorded.'}</span>{(entry.photos || []).length ? <div className="project-workflow-photo-list">{entry.photos.map((photo) => <WorkflowPhoto key={photo.id} photo={photo} />)}</div> : null}</div>)}</div> : null}
                </>
              ) : (
                <dl className="project-workflow-summary"><div><dt>Cost impact</dt><dd>{money(record.costImpact)}</dd></div><div><dt>Schedule impact</dt><dd>{record.scheduleDays ? `${record.scheduleDays} days` : 'None'}</dd></div><div><dt>Response due</dt><dd>{record.dueDate ? formatShortDate(record.dueDate) : 'Not set'}</dd></div></dl>
              )}
            </article>
          ))}
        </div>
      ) : <div className="empty-state compact"><h3>No {daily ? 'daily logs' : 'change orders'} yet</h3><p>{canEdit ? `Create the first ${daily ? 'jobsite log' : 'change order'} for this project.` : 'No records are available.'}</p></div>}

      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type="sub"
          isEditing={false}
          saving={personSaving}
          onChange={(field, value) => setPersonDraft((current) => ({ ...current, [field]: value }))}
          onClose={() => setPersonDraft(null)}
          onSave={() => void saveNewSubcontractor()}
          onDelete={() => {}}
        />
      ) : null}
    </div>
  );
}
