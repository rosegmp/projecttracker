import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAuditEvents } from '../services/trackerData.js';
import { getVisibleProjectsForUser, getVisibleTasksForUser } from '../utils/accessUi.js';
import { formatAuditValue } from '../utils/auditTrail.js';
import { addLocalDays, buildHomeDaySummary, buildHomeOpenTasks, getLocalIsoDate, groupRecentAuditChanges } from '../utils/homeView.js';
import FluentIcon from './FluentIcon.jsx';
import { loadFourDayForecast } from '../utils/weather.js';

function formatDayHeading(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatTaskDueDate(value) {
  if (!value) return 'No due date';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return `Due ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}`;
}

function HomeList({ title, items, emptyMessage, onOpen }) {
  return (
    <section className="home-summary-section">
      <div className="home-summary-heading">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className="home-item-list">
          {items.map((item) => (
            <button
              key={`${item.type}-${item.projectId || 'general'}-${item.id}`}
              className="home-item-row"
              type="button"
              onClick={() => onOpen(item)}
            >
              <span className="home-item-copy">
                <strong>{item.label}</strong>
                <small>
                  {item.projectName}
                  {item.type === 'step' && item.phaseName ? ` · ${item.phaseName}` : ''}
                  {item.type === 'task' ? ` · ${formatTaskDueDate(item.due)}` : ''}
                </small>
              </span>
              <span className={`home-item-kind ${item.type}`}>{item.type === 'step' ? 'Step' : item.type === 'phase' ? 'Phase' : item.type === 'task' ? 'Task' : item.status || 'Inspection'}</span>
              <FluentIcon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      ) : <p className="home-empty-row">{emptyMessage}</p>}
    </section>
  );
}

function ChangeGroup({ title, entries, projectNames }) {
  return (
    <section className="home-change-group">
      <div className="home-summary-heading">
        <h3>{title}</h3>
        <span>{entries.length}</span>
      </div>
      {entries.length ? (
        <div className="home-change-list">
          {entries.map((entry) => (
            <div className="home-change-row" key={entry.id}>
              <span className={`audit-trail-marker ${entry.category || 'activity'}`} aria-hidden="true" />
              <div className="home-change-copy">
                <strong>{entry.entityName}: {entry.label}</strong>
                {entry.before !== null || entry.after !== null ? (
                  <span>{formatAuditValue(entry.before)} → {formatAuditValue(entry.after)}</span>
                ) : null}
                <small>
                  {formatTime(entry.createdAt)} · {entry.actorEmail || 'Workspace user'}
                  {entry.projectId && projectNames.get(entry.projectId) ? ` · ${projectNames.get(entry.projectId)}` : ''}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="home-empty-row">No recorded changes.</p>}
    </section>
  );
}

function WeatherWidget({ forecast, loading, error, onRefresh }) {
  return (
    <section className="home-weather-section" aria-live="polite" aria-busy={loading ? 'true' : 'false'}>
      <header className="home-changes-heading">
        <div>
          <p className="eyebrow">Your location</p>
          <h2>4-day weather</h2>
        </div>
        <button className="button secondary gantt-icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh weather" aria-label="Refresh weather">
          <FluentIcon name="replace" />
        </button>
      </header>
      {error ? (
        <div className="home-weather-message">
          <span>{error}</span>
          <button className="button secondary" type="button" onClick={onRefresh} disabled={loading}>Try again</button>
        </div>
      ) : null}
      {loading && !forecast?.days?.length ? <p className="home-weather-message">Loading local forecast…</p> : null}
      {forecast?.days?.length ? (
        <div className="home-weather-grid">
          {forecast.days.map((day, index) => {
            const date = new Date(`${day.date}T12:00:00`);
            return (
              <article className="home-weather-day" key={day.date}>
                <div className="home-weather-day-heading">
                  <strong>{index === 0 ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}</strong>
                  <small>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}</small>
                </div>
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

export default function NativeHomeView({ data, activeUser, refresh, loading, onOpenItem }) {
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [forecast, setForecast] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState('');
  const now = useMemo(() => new Date(), [data]);
  const tomorrow = useMemo(() => addLocalDays(now, 1), [now]);
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );
  const visibleTasks = useMemo(
    () => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects),
    [data.settings, data.tasks, visibleProjects],
  );
  const todaySummary = useMemo(
    () => buildHomeDaySummary(visibleProjects, visibleTasks, getLocalIsoDate(now)),
    [now, visibleProjects, visibleTasks],
  );
  const tomorrowSummary = useMemo(
    () => buildHomeDaySummary(visibleProjects, visibleTasks, getLocalIsoDate(tomorrow)),
    [tomorrow, visibleProjects, visibleTasks],
  );
  const homeTasks = useMemo(
    () => buildHomeOpenTasks(visibleTasks, visibleProjects, activeUser, [...(data.subs || []), ...(data.employees || [])]),
    [activeUser, data.employees, data.subs, visibleProjects, visibleTasks],
  );
  const changes = useMemo(() => groupRecentAuditChanges(auditRows, now), [auditRows, now]);
  const projectNames = useMemo(() => new Map(visibleProjects.map((project) => [project.id, project.name])), [visibleProjects]);

  const refreshAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      setAuditRows(await loadAuditEvents({ limit: 250 }));
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'Unable to load recent changes.');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  const refreshWeather = useCallback(async (force = true) => {
    setWeatherLoading(true);
    setWeatherError('');
    try {
      setForecast(await loadFourDayForecast({ force }));
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : 'Unable to load weather.');
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWeather(false);
  }, [refreshWeather]);

  async function refreshHome() {
    await Promise.all([refresh({ force: true }), refreshAudit(), refreshWeather(true)]);
  }

  return (
    <section className="panel native-panel workspace-page home-page">
      <header className="home-page-header">
        <div>
          <p className="eyebrow">Daily overview</p>
          <h1>Home</h1>
          <p>{formatDayHeading(now)} and {formatDayHeading(tomorrow)}</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void refreshHome()} disabled={loading || auditLoading}>
          <FluentIcon name="replace" />
          {loading || auditLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <WeatherWidget forecast={forecast} loading={weatherLoading} error={weatherError} onRefresh={() => void refreshWeather(true)} />

      <div className="home-day-grid">
        {[
          { key: 'today', label: 'Today', date: now, summary: todaySummary },
          { key: 'tomorrow', label: 'Tomorrow', date: tomorrow, summary: tomorrowSummary },
        ].map((day) => (
          <section className="home-day-column" key={day.key}>
            <header className="home-day-heading">
              <span>{day.label}</span>
              <h2>{formatDayHeading(day.date)}</h2>
            </header>
            <HomeList title="Inspections" items={day.summary.inspections} emptyMessage="No inspections scheduled." onOpen={onOpenItem} />
            <HomeList title="Schedule" items={day.summary.scheduleItems} emptyMessage="No schedule items." onOpen={onOpenItem} />
          </section>
        ))}
      </div>

      <section className="home-tasks-section">
        <header className="home-changes-heading">
          <div>
            <p className="eyebrow">Tasks</p>
            <h2>Open tasks</h2>
          </div>
          <span>{activeUser?.role === 'Admin' ? 'All users' : `Assigned to ${activeUser?.name || 'you'}`}</span>
        </header>
        <HomeList title="Task list" items={homeTasks} emptyMessage="No open tasks assigned." onOpen={onOpenItem} />
      </section>

      <section className="home-changes-section">
        <header className="home-changes-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h2>Recent changes</h2>
          </div>
          <span>Today and yesterday</span>
        </header>
        {auditError ? <p className="home-audit-message error">Recent changes are unavailable. {auditError}</p> : null}
        {auditLoading && !auditRows.length ? <p className="home-audit-message">Loading recent changes…</p> : (
          <div className="home-change-grid">
            <ChangeGroup title="Today" entries={changes.today} projectNames={projectNames} />
            <ChangeGroup title="Yesterday" entries={changes.yesterday} projectNames={projectNames} />
          </div>
        )}
      </section>
    </section>
  );
}
