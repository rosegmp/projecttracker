import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTask, loadAuditEvents, updateTask } from '../services/trackerData.js';
import { buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser } from '../utils/accessUi.js';
import { formatAuditValue } from '../utils/auditTrail.js';
import { taskAssigneeFields } from '../utils/assignees.js';
import {
  addLocalDays,
  buildHomeAttentionSummary,
  buildHomeOpenTasks,
  buildHomeRangeSummary,
  getLocalIsoDate,
  getProjectOperationalHealth,
  groupRecentAuditChanges,
} from '../utils/homeView.js';
import { loadFourDayForecast } from '../utils/weather.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
import FluentIcon from './FluentIcon.jsx';

const HOME_LIST_LIMIT = 5;

function formatDayHeading(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatCompactDate(value, prefix = '') {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return prefix ? `${prefix} ${formatted}` : formatted;
}

function getItemDateLabel(item) {
  if (item.type === 'task') return formatCompactDate(item.due, 'Due');
  if (item.type === 'inspection') return formatCompactDate(item.date);
  if (item.start && item.end && item.start !== item.end) {
    return `${formatCompactDate(item.start)}–${formatCompactDate(item.end)}`;
  }
  return formatCompactDate(item.start || item.end);
}

function weatherPreferenceKey(activeUser) {
  return `cx_home_weather_visible:${activeUser?.id || activeUser?.email || 'default'}`;
}

function readWeatherPreference(activeUser) {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(weatherPreferenceKey(activeUser)) !== 'false';
  } catch {
    return true;
  }
}

function HomeList({
  title,
  items,
  emptyMessage,
  onOpen,
  onComplete = null,
  onViewAll = null,
  limit = HOME_LIST_LIMIT,
  tone = '',
}) {
  const visibleItems = items.slice(0, limit);
  return (
    <section className={`home-summary-section${tone ? ` tone-${tone}` : ''}`}>
      <div className="home-summary-heading">
        <h3>{title}</h3>
        <div className="home-summary-heading-actions">
          <span>{items.length}</span>
          {onViewAll && items.length > limit ? (
            <button className="text-button" type="button" onClick={onViewAll}>View all</button>
          ) : null}
        </div>
      </div>
      {visibleItems.length ? (
        <div className="home-item-list">
          {visibleItems.map((item) => (
            <div className="home-item-row" key={`${item.type}-${item.projectId || 'general'}-${item.id}`}>
              <button className="home-item-open" type="button" onClick={() => onOpen(item)}>
                <span className="home-item-copy">
                  <strong>{item.label}</strong>
                  <small>
                    {item.projectName}
                    {item.type === 'step' && item.phaseName ? ` · ${item.phaseName}` : ''}
                    {getItemDateLabel(item) ? ` · ${getItemDateLabel(item)}` : ''}
                  </small>
                </span>
                <span className={`home-item-kind ${item.type}`}>{item.attentionKind || (item.type === 'step' ? 'Step' : item.type === 'phase' ? 'Phase' : item.type === 'task' ? 'Task' : item.status || 'Inspection')}</span>
                <FluentIcon name="chevronRight" size={16} />
              </button>
              {item.type === 'task' && onComplete ? (
                <button
                  className="home-task-complete"
                  type="button"
                  onClick={() => onComplete(item)}
                  aria-label={`Mark ${item.label} complete`}
                  title="Mark complete"
                >
                  <FluentIcon name="check" size={18} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="home-empty-row">{emptyMessage}</p>}
      {items.length > limit ? <p className="home-list-overflow">Showing {limit} of {items.length}</p> : null}
    </section>
  );
}

function ChangeGroup({ title, entries, projectNames }) {
  const visibleEntries = entries.slice(0, HOME_LIST_LIMIT);
  return (
    <section className="home-change-group">
      <div className="home-summary-heading"><h3>{title}</h3><span>{entries.length}</span></div>
      {visibleEntries.length ? (
        <div className="home-change-list">
          {visibleEntries.map((entry) => (
            <div className="home-change-row" key={entry.id}>
              <span className={`audit-trail-marker ${entry.category || 'activity'}`} aria-hidden="true" />
              <div className="home-change-copy">
                <strong>{entry.entityName}: {entry.label}</strong>
                {entry.before !== null || entry.after !== null ? <span>{formatAuditValue(entry.before)} → {formatAuditValue(entry.after)}</span> : null}
                <small>
                  {formatTime(entry.createdAt)} · {entry.actorEmail || 'Workspace user'}
                  {entry.projectId && projectNames.get(entry.projectId) ? ` · ${projectNames.get(entry.projectId)}` : ''}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="home-empty-row">No recorded changes.</p>}
      {entries.length > HOME_LIST_LIMIT ? <p className="home-list-overflow">Showing {HOME_LIST_LIMIT} of {entries.length}</p> : null}
    </section>
  );
}

function WeatherWidget({ forecast, loading, error, onRefresh }) {
  return (
    <section className="home-weather-section" aria-live="polite" aria-busy={loading ? 'true' : 'false'}>
      <header className="home-changes-heading">
        <div><p className="eyebrow">Your location</p><h2>4-day weather</h2></div>
        <button className="button secondary gantt-icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh weather" aria-label="Refresh weather"><FluentIcon name="replace" /></button>
      </header>
      {error ? <div className="home-weather-message"><span>{error}</span><button className="button secondary" type="button" onClick={onRefresh} disabled={loading}>Try again</button></div> : null}
      {loading && !forecast?.days?.length ? <p className="home-weather-message">Loading local forecast…</p> : null}
      {forecast?.days?.length ? (
        <div className="home-weather-grid">
          {forecast.days.map((day, index) => {
            const date = new Date(`${day.date}T12:00:00`);
            return (
              <article className="home-weather-day" key={day.date}>
                <div className="home-weather-day-heading"><strong>{index === 0 ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}</strong><small>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}</small></div>
                <span className="home-weather-symbol" role="img" aria-label={day.label}>{day.symbol}</span>
                <div className="home-weather-temperatures"><strong>{day.high}°</strong><span>{day.low}°</span></div>
                <span className="home-weather-condition">{day.label}</span>
                <small>{day.rainChance}% rain · {day.wind} mph</small>
              </article>
            );
          })}
        </div>
      ) : null}
      <a className="home-weather-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a>
    </section>
  );
}

function QuickTaskForm({ draft, projects, assigneeOptions, saving, message, onChange, onSubmit }) {
  return (
    <form className="home-quick-task" onSubmit={onSubmit}>
      <div><p className="eyebrow">Quick action</p><h2>Add a task</h2></div>
      <div className="home-quick-task-fields">
        <input value={draft.label} onChange={(event) => onChange('label', event.target.value)} placeholder="What needs to be done?" aria-label="Task name" />
        <select value={draft.projectId} onChange={(event) => onChange('projectId', event.target.value)} aria-label="Task project">
          <option value="">General task</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <input type="date" value={draft.due} onChange={(event) => onChange('due', event.target.value)} aria-label="Task due date" />
        <select value={draft.assignee} onChange={(event) => onChange('assignee', event.target.value)} aria-label="Task assignee">
          <option value="">Unassigned</option>
          {assigneeOptions.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
        </select>
        <button className={`button primary${saving ? ' is-loading' : ''}`} type="submit" disabled={saving || !draft.label.trim()}><FluentIcon name="add" />{saving ? 'Adding…' : 'Add task'}</button>
      </div>
      <p className={`home-quick-task-message${message?.tone ? ` ${message.tone}` : ''}`} aria-live="polite">{message?.text || ''}</p>
    </form>
  );
}

export default function NativeHomeView({
  data,
  activeUser,
  refresh,
  loading,
  canEdit = false,
  onStateChange,
  onOpenItem,
  onOpenCollection,
}) {
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [forecast, setForecast] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [weatherVisible, setWeatherVisible] = useState(() => readWeatherPreference(activeUser));
  const [quickTask, setQuickTask] = useState({ label: '', projectId: '', due: '', assignee: '' });
  const [quickTaskMessage, setQuickTaskMessage] = useState(null);
  const dataRef = useRef(data);
  const { runMutation, isMutating } = useEntityMutations();
  const now = useMemo(() => new Date(), [data]);
  const todayIso = getLocalIsoDate(now);
  const nextSevenStart = getLocalIsoDate(addLocalDays(now, 1));
  const nextSevenEnd = getLocalIsoDate(addLocalDays(now, 7));

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    const visible = readWeatherPreference(activeUser);
    setWeatherVisible(visible);
  }, [activeUser?.email, activeUser?.id]);

  const visibleProjects = useMemo(() => getVisibleProjectsForUser(data.projects, data.settings, activeUser), [activeUser, data.projects, data.settings]);
  const visibleTasks = useMemo(() => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects), [data.settings, data.tasks, visibleProjects]);
  const scopedOpenTasks = useMemo(
    () => buildHomeOpenTasks(visibleTasks, visibleProjects, activeUser, [...(data.subs || []), ...(data.employees || [])]),
    [activeUser, data.employees, data.subs, visibleProjects, visibleTasks],
  );
  const attention = useMemo(
    () => buildHomeAttentionSummary(visibleProjects, scopedOpenTasks, todayIso, canEdit ? visibleTasks : []),
    [canEdit, scopedOpenTasks, todayIso, visibleProjects, visibleTasks],
  );
  const todaySummary = useMemo(() => buildHomeRangeSummary(visibleProjects, scopedOpenTasks, todayIso, todayIso), [scopedOpenTasks, todayIso, visibleProjects]);
  const nextSevenSummary = useMemo(
    () => buildHomeRangeSummary(visibleProjects, scopedOpenTasks, nextSevenStart, nextSevenEnd),
    [nextSevenEnd, nextSevenStart, scopedOpenTasks, visibleProjects],
  );
  const projectHealth = useMemo(
    () => visibleProjects.map((project) => ({ project, health: getProjectOperationalHealth(project, visibleTasks, todayIso) })),
    [todayIso, visibleProjects, visibleTasks],
  );
  const changes = useMemo(() => groupRecentAuditChanges(auditRows, now), [auditRows, now]);
  const projectNames = useMemo(() => new Map(visibleProjects.map((project) => [project.id, project.name])), [visibleProjects]);
  const assigneeOptions = useMemo(() => {
    const options = buildTaskAssigneeOptions(data.subs || [], data.employees || []);
    const activeName = String(activeUser?.name || '').trim();
    if (activeName && !options.some((option) => option === activeName || option.startsWith(`${activeName} (`))) options.unshift(activeName);
    return options;
  }, [activeUser?.name, data.employees, data.subs]);

  useEffect(() => {
    const activeName = String(activeUser?.name || '').trim();
    if (!canEdit || !activeName) return;
    const matchingAssignee = assigneeOptions.find((option) => option === activeName || option.startsWith(`${activeName} (`)) || '';
    setQuickTask((current) => current.assignee ? current : { ...current, assignee: matchingAssignee });
  }, [activeUser?.name, assigneeOptions, canEdit]);

  const refreshAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      since.setHours(0, 0, 0, 0);
      setAuditRows(await loadAuditEvents({ limit: 100, since: since.toISOString() }));
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'Unable to load recent changes.');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => { void refreshAudit(); }, [refreshAudit]);

  const refreshWeather = useCallback(async (force = true) => {
    if (!weatherVisible) return;
    setWeatherLoading(true);
    setWeatherError('');
    try {
      setForecast(await loadFourDayForecast({ force }));
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : 'Unable to load weather.');
    } finally {
      setWeatherLoading(false);
    }
  }, [weatherVisible]);

  useEffect(() => { if (weatherVisible) void refreshWeather(false); }, [refreshWeather, weatherVisible]);

  function toggleWeather() {
    const next = !weatherVisible;
    setWeatherVisible(next);
    try { window.localStorage.setItem(weatherPreferenceKey(activeUser), String(next)); } catch { /* Keep the in-memory preference. */ }
  }

  async function refreshHome() {
    await Promise.all([refresh({ force: true }), refreshAudit(), weatherVisible ? refreshWeather(true) : Promise.resolve()]);
  }

  async function completeTask(task) {
    if (!canEdit || isMutating(['task', task.id, 'complete'])) return;
    setQuickTaskMessage(null);
    try {
      await runMutation(['task', task.id, 'complete'], async () => {
        const nextState = await updateTask(dataRef.current, task.id, { done: true });
        dataRef.current = nextState;
        onStateChange(nextState);
      });
    } catch (error) {
      setQuickTaskMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to complete the task.' });
    }
  }

  async function submitQuickTask(event) {
    event.preventDefault();
    if (!canEdit || !quickTask.label.trim() || isMutating('home:task:create')) return;
    setQuickTaskMessage(null);
    try {
      await runMutation('home:task:create', async () => {
        const nextState = await createTask(dataRef.current, {
          id: `t${Date.now()}`,
          label: quickTask.label,
          projectId: quickTask.projectId,
          due: quickTask.due,
          ...taskAssigneeFields(quickTask.assignee ? [quickTask.assignee] : []),
          createdAt: new Date().toISOString(),
        });
        dataRef.current = nextState;
        onStateChange(nextState);
      });
      setQuickTask((current) => ({ ...current, label: '', due: '' }));
      setQuickTaskMessage({ tone: 'success', text: 'Task added.' });
    } catch (error) {
      setQuickTaskMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to add the task.' });
    }
  }

  const taskComplete = canEdit ? (task) => void completeTask(task) : null;

  return (
    <section className="panel native-panel workspace-page home-page">
      <header className="home-page-header">
        <div><p className="eyebrow">Daily command center</p><h1>Home</h1><p>{formatDayHeading(now)} · Next 7 days through {formatDayHeading(addLocalDays(now, 7))}</p></div>
        <div className="home-page-actions">
          <button className="button secondary" type="button" onClick={toggleWeather}>{weatherVisible ? 'Hide weather' : 'Show weather'}</button>
          <button className="button secondary home-refresh-button" type="button" onClick={() => void refreshHome()} disabled={loading || auditLoading}><FluentIcon name="replace" />{loading || auditLoading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      <section className="home-health-section">
        <header className="home-changes-heading"><div><p className="eyebrow">Portfolio</p><h2>Project health</h2></div><span>Based on overdue and blocked work</span></header>
        <div className="home-health-grid">
          {projectHealth.map(({ project, health }) => (
            <button className={`home-health-card tone-${health.tone}`} type="button" key={project.id} onClick={() => onOpenItem({ ...project, type: 'project' })}>
              <span>{project.name}</span><strong>{health.label}</strong><FluentIcon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="home-attention-section">
        <header className="home-changes-heading"><div><p className="eyebrow">Exceptions</p><h2>Needs attention</h2></div><span>Act on the work most likely to cause delay</span></header>
        <div className="home-attention-grid">
          <HomeList title="Overdue tasks" items={attention.overdueTasks} emptyMessage="No overdue tasks." onOpen={onOpenItem} onComplete={taskComplete} onViewAll={() => onOpenCollection('tasks')} tone="danger" />
          <HomeList title="Overdue inspections" items={attention.overdueInspections} emptyMessage="No overdue inspections." onOpen={onOpenItem} onViewAll={() => onOpenCollection('inspections')} tone="warning" />
          <HomeList title="Blocked schedule" items={attention.blockedSteps} emptyMessage="No blocked schedule steps." onOpen={onOpenItem} onViewAll={() => onOpenCollection('schedule')} tone="warning" />
          {canEdit ? <HomeList title="Unassigned work" items={attention.unassignedTasks} emptyMessage="No unassigned tasks." onOpen={onOpenItem} onComplete={taskComplete} onViewAll={() => onOpenCollection('tasks')} tone="neutral" /> : null}
        </div>
      </section>

      {canEdit ? <QuickTaskForm draft={quickTask} projects={visibleProjects} assigneeOptions={assigneeOptions} saving={isMutating('home:task:create')} message={quickTaskMessage} onChange={(field, value) => setQuickTask((current) => ({ ...current, [field]: value }))} onSubmit={(event) => void submitQuickTask(event)} /> : null}

      <div className="home-day-grid">
        {[
          { key: 'today', label: 'Today', heading: formatDayHeading(now), summary: todaySummary },
          { key: 'next-seven', label: 'Next 7 days', heading: `${formatCompactDate(nextSevenStart)}–${formatCompactDate(nextSevenEnd)}`, summary: nextSevenSummary },
        ].map((period) => (
          <section className="home-day-column" key={period.key}>
            <header className="home-day-heading"><span>{period.label}</span><h2>{period.heading}</h2></header>
            <HomeList title="Tasks" items={period.summary.openTasks} emptyMessage="No tasks due." onOpen={onOpenItem} onComplete={taskComplete} onViewAll={() => onOpenCollection('tasks')} />
            <HomeList title="Inspections" items={period.summary.inspections} emptyMessage="No inspections scheduled." onOpen={onOpenItem} onViewAll={() => onOpenCollection('inspections')} />
            <HomeList title="Schedule" items={period.summary.scheduleItems} emptyMessage="No schedule items." onOpen={onOpenItem} onViewAll={() => onOpenCollection('schedule')} />
          </section>
        ))}
      </div>

      {weatherVisible ? <WeatherWidget forecast={forecast} loading={weatherLoading} error={weatherError} onRefresh={() => void refreshWeather(true)} /> : null}

      <section className="home-changes-section">
        <header className="home-changes-heading"><div><p className="eyebrow">Activity</p><h2>Recent changes</h2></div><span>Today and yesterday</span></header>
        {auditError ? <p className="home-audit-message error">Recent changes are unavailable. {auditError}</p> : null}
        {auditLoading && !auditRows.length ? <p className="home-audit-message">Loading recent changes…</p> : (
          <div className="home-change-grid"><ChangeGroup title="Today" entries={changes.today} projectNames={projectNames} /><ChangeGroup title="Yesterday" entries={changes.yesterday} projectNames={projectNames} /></div>
        )}
      </section>
    </section>
  );
}
