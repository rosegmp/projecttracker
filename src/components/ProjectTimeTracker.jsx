import React, { useEffect, useMemo, useState } from 'react';
import { getStoredAuthSession } from '../services/trackerData.js';
import { createProjectTimeService, formatTrackedDuration, timeEntryMinutes } from '../services/projectTime.js';
import { getVisibleProjectsForUser } from '../utils/accessUi.js';
import { showAppConfirm } from './AppDialogs.jsx';
import './project-time.css';

function localDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateLabel(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function draftFromEntry(entry, projectId) {
  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 60 * 60000);
  return {
    id: entry?.id || '', project_id: entry?.project_id || projectId, task_id: entry?.task_id || '', description: entry?.description || '',
    started_at: entry ? localDateTime(entry.started_at) : localDateTime(defaultStart),
    ended_at: entry ? localDateTime(entry.ended_at) : localDateTime(defaultEnd),
  };
}

export default function ProjectTimeTracker({ project, tasks = [], data, activeUser, canEdit = true }) {
  const service = useMemo(() => createProjectTimeService(project.id), [project.id]);
  const userId = getStoredAuthSession()?.user?.id || activeUser?.id || '';
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState(null);
  const [timerTaskId, setTimerTaskId] = useState('');
  const [timerDescription, setTimerDescription] = useState('');
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    service.list().then((rows) => { if (live) setEntries(rows); })
      .catch((cause) => { if (live) setError(cause.message || 'Unable to load time entries.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [service]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const running = entries.find((entry) => !entry.ended_at && entry.user_id === userId);
  const completed = entries.filter((entry) => entry.ended_at);
  const taskNames = useMemo(() => new Map(tasks.map((task) => [String(task.id), task.label || 'Untitled task'])), [tasks]);
  const availableProjects = useMemo(() => getVisibleProjectsForUser(data?.projects, data?.settings, activeUser)
    .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [activeUser, data?.projects, data?.settings]);
  const draftTasks = useMemo(() => (data?.tasks || tasks).filter((task) => task.projectId === draft?.project_id), [data?.tasks, draft?.project_id, tasks]);
  const totalMinutes = completed.reduce((sum, entry) => sum + timeEntryMinutes(entry), 0);
  const myMinutes = completed.filter((entry) => entry.user_id === userId).reduce((sum, entry) => sum + timeEntryMinutes(entry), 0);

  async function perform(action, success) {
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      setEntries(await service.list());
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause.message || 'Unable to save time.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function canManage(entry) {
    return canEdit && (entry.user_id === userId || activeUser?.role === 'Admin');
  }

  async function startTimer(event) {
    event.preventDefault();
    await perform(() => service.create({
      task_id: timerTaskId, description: timerDescription, started_at: new Date().toISOString(), user_id: userId, user_email: activeUser?.email,
    }), 'Timer started.');
  }

  async function stopTimer() {
    if (!running) return;
    await perform(() => service.update(running.id, { ...running, ended_at: new Date().toISOString() }), 'Time saved.');
  }

  async function saveDraft(event) {
    event.preventDefault();
    const start = new Date(draft.started_at);
    const end = new Date(draft.ended_at);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      setError('End time must be after start time.');
      return;
    }
    if (draft.id && !availableProjects.some((item) => item.id === draft.project_id)) {
      setError('Choose a project you can access.');
      return;
    }
    const changes = { project_id: draft.project_id, task_id: draft.task_id, description: draft.description, started_at: start.toISOString(), ended_at: end.toISOString(), user_id: userId, user_email: activeUser?.email };
    const moved = draft.id && draft.project_id !== project.id;
    const destination = availableProjects.find((item) => item.id === draft.project_id);
    if (await perform(() => draft.id ? service.update(draft.id, changes) : service.create(changes), moved ? `Entry moved to ${destination?.name || 'the selected project'}.` : draft.id ? 'Entry updated.' : 'Time added.')) setDraft(null);
  }

  async function deleteEntry(entry) {
    if (!await showAppConfirm('Delete this time entry?', { title: 'Delete time entry?', confirmLabel: 'Delete', tone: 'danger' })) return;
    await perform(() => service.remove(entry.id), 'Entry deleted.');
  }

  return <div className="project-time">
    <header className="project-records-header"><div><p className="eyebrow">Project hours</p><h2>Time tracking</h2><p>Record work against this project and its tasks.</p></div></header>
    <div className="project-time-summary" aria-label="Time totals">
      <div><span>Project total</span><strong>{formatTrackedDuration(totalMinutes)}</strong></div>
      <div><span>My time</span><strong>{formatTrackedDuration(myMinutes)}</strong></div>
      <div><span>Entries</span><strong>{completed.length}</strong></div>
    </div>
    {error ? <p className="project-time-error" role="alert">{error}</p> : null}
    {notice ? <p className="project-time-notice" role="status">{notice}</p> : null}
    {canEdit ? <div className="project-time-panel">
      <h3>{running ? 'Timer running' : 'Start a timer'}</h3>
      {running ? <div className="project-time-running">
        <strong>{formatTrackedDuration(timeEntryMinutes(running, now))}</strong>
        <span>{running.description || taskNames.get(String(running.task_id)) || 'Project work'} · Started {dateLabel(running.started_at)}</span>
        <button type="button" className="primary" disabled={busy} onClick={stopTimer}>Stop timer</button>
      </div> : <form className="project-time-form" onSubmit={startTimer}>
        <label>Task <select value={timerTaskId} onChange={(event) => setTimerTaskId(event.target.value)}><option value="">General project work</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.label || 'Untitled task'}</option>)}</select></label>
        <label>Description <input value={timerDescription} maxLength={1000} onChange={(event) => setTimerDescription(event.target.value)} placeholder="What are you working on?" /></label>
        <button type="submit" className="primary" disabled={busy || loading}>Start timer</button>
      </form>}
      <button type="button" disabled={busy} onClick={() => { setDraft(draftFromEntry(null, project.id)); setError(''); }}>Add time manually</button>
    </div> : null}
    {draft ? <form className="project-time-panel project-time-form" onSubmit={saveDraft}>
      <h3>{draft.id ? 'Edit time entry' : 'Add time'}</h3>
      {draft.id ? <label>Project <select value={draft.project_id} onChange={(event) => setDraft({ ...draft, project_id: event.target.value, task_id: '' })}>{availableProjects.map((item) => <option key={item.id} value={item.id}>{item.name || 'Untitled project'}</option>)}</select></label> : null}
      <label>Task <select value={draft.task_id} onChange={(event) => setDraft({ ...draft, task_id: event.target.value })}><option value="">General project work</option>{draftTasks.map((task) => <option key={task.id} value={task.id}>{task.label || 'Untitled task'}</option>)}</select></label>
      <label>Start <input type="datetime-local" required value={draft.started_at} onChange={(event) => setDraft({ ...draft, started_at: event.target.value })} /></label>
      <label>End <input type="datetime-local" required value={draft.ended_at} onChange={(event) => setDraft({ ...draft, ended_at: event.target.value })} /></label>
      <label>Description <input value={draft.description} maxLength={1000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="project-time-actions"><button type="submit" className="primary" disabled={busy}>Save entry</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
    </form> : null}
    <div className="project-time-panel"><h3>Entries</h3>
      {loading ? <p role="status">Loading time entries…</p> : entries.length ? <div className="project-time-list">{entries.map((entry) => <div className="project-time-entry" key={entry.id}>
        <div><strong>{entry.description || taskNames.get(String(entry.task_id)) || 'General project work'}</strong><span>{dateLabel(entry.started_at)}{entry.ended_at ? ` – ${dateLabel(entry.ended_at)}` : ' · Running'}{entry.user_email ? ` · ${entry.user_email}` : ''}</span>{entry.task_id && entry.description ? <small>{taskNames.get(String(entry.task_id)) || 'Task'}</small> : null}</div>
        <strong>{formatTrackedDuration(timeEntryMinutes(entry, now))}</strong>
        {canManage(entry) && entry.ended_at ? <div className="project-time-actions"><button type="button" disabled={busy} onClick={() => setDraft(draftFromEntry(entry, project.id))}>Edit</button><button type="button" disabled={busy} onClick={() => deleteEntry(entry)}>Delete</button></div> : null}
      </div>)}</div> : <p>No time recorded yet.</p>}
    </div>
  </div>;
}
