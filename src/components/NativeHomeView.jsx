import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addProjectTaskLocation, createTask, loadAuditEvents, updateTask } from '../services/trackerData.js';
import { loadInsuranceCertificates, loadSubcontractorComplianceDocuments } from '../services/insuranceCertificates.js';
import { loadPortalItemsForProjects, loadWorkflowItemsForProjects } from '../services/constructionWorkflows.js';
import { reportError } from '../services/observability.js';
import { buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser } from '../utils/accessUi.js';
import { formatAuditValue } from '../utils/auditTrail.js';
import { taskAssigneeFields } from '../utils/assignees.js';
import {
  addLocalDays,
  buildHomeActionCenterItems,
  buildHomeAttentionSummary,
  buildHomeCertificateExceptions,
  buildHomeFinancialExceptions,
  buildMyDaySummary,
  buildHomeOfflineSyncExceptions,
  buildHomeWarrantyCloseoutExceptions,
  buildHomeOpenTasks,
  buildHomeOverdueDocumentExceptions,
  buildHomePendingDecisionExceptions,
  buildHomeRangeSummary,
  getLocalIsoDate,
  getProjectOperationalHealth,
  groupRecentAuditChanges,
} from '../utils/homeView.js';
import { loadFourDayForecast } from '../utils/weather.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
import useSubcontractorComplianceWarnings from '../hooks/useSubcontractorComplianceWarnings.js';
import { getVisibleProjectTabs } from '../utils/projectTabs.js';
import FluentIcon from './FluentIcon.jsx';
import TaskLocationField from './TaskLocationField.jsx';

const HOME_LIST_LIMIT = 5;
const ACTION_CENTER_LIMIT = 8;

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

function formatActionStatus(value) {
  return String(value || 'Open')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ActionCenter({ actions, canEdit, onOpen, onComplete, sourceWarning = '' }) {
  const [showAll, setShowAll] = useState(false);
  const visibleActions = showAll ? actions : actions.slice(0, ACTION_CENTER_LIMIT);

  return (
    <section className="home-action-center" aria-labelledby="home-action-center-title">
      <header className="home-changes-heading">
        <div><p className="eyebrow">Exceptions</p><h2 id="home-action-center-title">Action center</h2></div>
        <span>{actions.length} open {actions.length === 1 ? 'item' : 'items'}</span>
      </header>
      {visibleActions.length ? (
        <div className="home-action-list">
          <div className="home-action-columns" aria-hidden="true">
            <span>Work item</span><span>Project</span><span>Owner</span><span>Due</span><span>Reason</span><span>Status</span><span>Actions</span>
          </div>
          {visibleActions.map((action) => (
            <article className={`home-action-row tone-${action.tone}`} key={action.sourceKey}>
              <div className="home-action-cell home-action-title" data-label="Work item"><strong>{action.label}</strong></div>
              <div className="home-action-cell" data-label="Project">{action.projectName}</div>
              <div className="home-action-cell" data-label="Owner">{action.owner}</div>
              <div className="home-action-cell" data-label="Due">{action.dueDate ? formatCompactDate(action.dueDate) : 'Not set'}</div>
              <div className="home-action-cell home-action-reason" data-label="Reason">{action.reason}</div>
              <div className="home-action-cell" data-label="Status"><span className={`home-action-status tone-${action.tone}`}>{formatActionStatus(action.status)}</span></div>
              <div className="home-action-cell home-action-buttons" data-label="Actions">
                <button className="button secondary" type="button" onClick={() => onOpen(action.item)}>Open</button>
                {canEdit && action.item.type === 'task' ? (
                  <button className="button secondary" type="button" onClick={() => onComplete(action.item)} aria-label={`Mark ${action.label} complete`}><FluentIcon name="check" />Complete</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="home-empty-row">No operational exceptions need attention.</p>}
      {sourceWarning ? <p className="home-audit-message error">{sourceWarning}</p> : null}
      {actions.length > ACTION_CENTER_LIMIT ? (
        <button className="text-button home-action-toggle" type="button" onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Show fewer' : `Show all ${actions.length}`}
        </button>
      ) : null}
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

function QuickTaskForm({ draft, projects, locationOptions, assigneeOptions, complianceWarnings, saving, message, onChange, onAddLocation, onSubmit }) {
  const complianceWarning = complianceWarnings?.get?.(draft.assignee) || null;
  return (
    <form className="home-quick-task" onSubmit={onSubmit}>
      <div><p className="eyebrow">Quick action</p><h2>Add a task</h2></div>
      <div className="home-quick-task-fields">
        <input id="home-quick-task-name" value={draft.label} onChange={(event) => onChange('label', event.target.value)} placeholder="What needs to be done?" aria-label="Task name" />
        <select value={draft.projectId} onChange={(event) => onChange('projectId', event.target.value)} aria-label="Task project">
          <option value="">General task</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <input type="date" value={draft.due} onChange={(event) => onChange('due', event.target.value)} aria-label="Task due date" />
        <select value={draft.assignee} onChange={(event) => onChange('assignee', event.target.value)} aria-label="Task assignee">
          <option value="">Unassigned</option>
          {assigneeOptions.map((assignee) => <option key={assignee} value={assignee}>{complianceWarnings?.has?.(assignee) ? `${assignee} (Needs compliance)` : assignee}</option>)}
        </select>
        <TaskLocationField
          projectId={draft.projectId}
          locations={locationOptions}
          value={draft.location || ''}
          onChange={(value) => onChange('location', value)}
          onAddLocation={onAddLocation}
          disabled={saving}
        />
        <button className={`button primary${saving ? ' is-loading' : ''}`} type="submit" disabled={saving || !draft.label.trim()}><FluentIcon name="add" />{saving ? 'Adding…' : 'Add task'}</button>
      </div>
      {complianceWarning ? <p className="home-quick-task-compliance-warning"><FluentIcon name="warning" size={17} />{complianceWarning.message} Assignment is still allowed.</p> : null}
      <p className={`home-quick-task-message${message?.tone ? ` ${message.tone}` : ''}`} aria-live="polite">{message?.text || ''}</p>
    </form>
  );
}

function MyDayWorkspace({ summary, activeUser, canEdit, offline, onOpen, onComplete, onAddTask, onQuickAction }) {
  const count = new Set([
    ...summary.tasks,
    ...summary.inspections,
    ...summary.scheduleItems,
    ...summary.overdueItems,
  ].map((item) => `${item.type}:${item.projectId || 'general'}:${item.id}`)).size;
  const scopeLabel = activeUser?.role === 'Admin' ? 'Portfolio scope' : 'Assigned to you';
  return (
    <section className="my-day-workspace" aria-labelledby="my-day-title">
      <header className="my-day-header">
        <div><p className="eyebrow">Field workspace</p><h2 id="my-day-title">My Day</h2><p>{scopeLabel} · {count} visible work {count === 1 ? 'item' : 'items'}{offline ? ' · Using offline data' : ''}</p></div>
        {canEdit ? (
          <div className="my-day-quick-actions" aria-label="My Day quick actions">
            <button className="button primary" type="button" onClick={onAddTask}><FluentIcon name="add" />Task</button>
            <button className="button secondary" type="button" onClick={() => onQuickAction?.('create-daily-log')}><FluentIcon name="document" />Daily log</button>
            <button className="button secondary" type="button" onClick={() => onQuickAction?.('create-photo')} disabled={offline} title={offline ? 'Reconnect before uploading a project photo.' : 'Open project photos'}><FluentIcon name="camera" />Photo</button>
          </div>
        ) : null}
      </header>
      {offline ? <p className="my-day-offline-note"><FluentIcon name="warning" />Tasks and daily logs can be saved on this device. Reconnect before uploading photos.</p> : null}
      <div className="my-day-grid">
        <HomeList title="Due today" items={summary.tasks} emptyMessage="No assigned tasks due today." onOpen={onOpen} onComplete={onComplete} limit={4} />
        <HomeList title="Schedule" items={summary.scheduleItems} emptyMessage="No assigned schedule work today." onOpen={onOpen} limit={4} />
        <HomeList title="Inspections" items={summary.inspections} emptyMessage="No inspections today." onOpen={onOpen} limit={4} />
        <HomeList title="Overdue & blocked" items={summary.overdueItems} emptyMessage="Nothing overdue or blocked." onOpen={onOpen} onComplete={onComplete} limit={4} tone="danger" />
      </div>
    </section>
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
  onQuickAction,
  includeCertificateExceptions = false,
  offlineOperations = [],
}) {
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [forecast, setForecast] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [weatherVisible, setWeatherVisible] = useState(() => readWeatherPreference(activeUser));
  const [quickTask, setQuickTask] = useState({ label: '', projectId: '', location: '', due: '', assignee: '' });
  const [quickTaskMessage, setQuickTaskMessage] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const complianceWarnings = useSubcontractorComplianceWarnings(data.subs || [], canEdit);
  const [complianceDocuments, setComplianceDocuments] = useState([]);
  const [certificateLoadError, setCertificateLoadError] = useState('');
  const [portalItems, setPortalItems] = useState([]);
  const [portalLoadError, setPortalLoadError] = useState('');
  const [documentItems, setDocumentItems] = useState({ rfis: [], submittals: [] });
  const [documentLoadError, setDocumentLoadError] = useState('');
  const [financialItems, setFinancialItems] = useState({ changeOrders: [], budgetItems: [], commitments: [] });
  const [financialLoadError, setFinancialLoadError] = useState('');
  const [warrantyCloseoutItems, setWarrantyCloseoutItems] = useState({ warrantyItems: [], closeoutItems: [] });
  const [warrantyCloseoutLoadError, setWarrantyCloseoutLoadError] = useState('');
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
  const visibleProjectTabIds = useMemo(
    () => new Set(getVisibleProjectTabs(data.settings?.visibleProjectTabs, activeUser?.role).map((tab) => tab.id)),
    [activeUser?.role, data.settings?.visibleProjectTabs],
  );
  const scopedOpenTasks = useMemo(
    () => buildHomeOpenTasks(visibleTasks, visibleProjects, activeUser, [...(data.subs || []), ...(data.employees || [])]),
    [activeUser, data.employees, data.subs, visibleProjects, visibleTasks],
  );
  const certificateExceptions = useMemo(
    () => includeCertificateExceptions
      ? buildHomeCertificateExceptions(data.subs || [], certificates, todayIso, complianceDocuments)
      : [],
    [certificates, complianceDocuments, data.subs, includeCertificateExceptions, todayIso],
  );
  const people = useMemo(() => [...(data.subs || []), ...(data.employees || [])], [data.employees, data.subs]);
  const myDaySummary = useMemo(
    () => buildMyDaySummary(visibleProjects, scopedOpenTasks, activeUser, people, todayIso),
    [activeUser, people, scopedOpenTasks, todayIso, visibleProjects],
  );
  const offline = data.storageMode === 'offline-cache'
    || data.storageMode === 'workspace-cache-offline'
    || (typeof navigator !== 'undefined' && navigator.onLine === false);
  const pendingDecisions = useMemo(
    () => buildHomePendingDecisionExceptions(visibleProjects, portalItems, todayIso, {
      includeSelections: visibleProjectTabIds.has('selections'),
    }),
    [portalItems, todayIso, visibleProjectTabIds, visibleProjects],
  );
  const overdueDocuments = useMemo(
    () => visibleProjectTabIds.has('rfis-submittals')
      ? buildHomeOverdueDocumentExceptions(
        visibleProjects,
        documentItems.rfis,
        documentItems.submittals,
        todayIso,
      )
      : [],
    [documentItems.rfis, documentItems.submittals, todayIso, visibleProjectTabIds, visibleProjects],
  );
  const financialExceptions = useMemo(
    () => buildHomeFinancialExceptions(
      visibleProjects,
      visibleProjectTabIds.has('change-orders') ? financialItems.changeOrders : [],
      visibleProjectTabIds.has('budget-commitments') ? financialItems.budgetItems : [],
      visibleProjectTabIds.has('budget-commitments') ? financialItems.commitments : [],
      todayIso,
    ),
    [
      financialItems.budgetItems,
      financialItems.changeOrders,
      financialItems.commitments,
      todayIso,
      visibleProjectTabIds,
      visibleProjects,
    ],
  );
  const warrantyCloseoutExceptions = useMemo(
    () => visibleProjectTabIds.has('warranty-closeout')
      ? buildHomeWarrantyCloseoutExceptions(
        visibleProjects,
        warrantyCloseoutItems.warrantyItems,
        warrantyCloseoutItems.closeoutItems,
        todayIso,
      )
      : [],
    [todayIso, visibleProjectTabIds, visibleProjects, warrantyCloseoutItems.closeoutItems, warrantyCloseoutItems.warrantyItems],
  );
  const offlineSyncExceptions = useMemo(
    () => buildHomeOfflineSyncExceptions(
      visibleProjects,
      offlineOperations,
      activeUser?.name || activeUser?.email || 'You',
    ),
    [activeUser?.email, activeUser?.name, offlineOperations, visibleProjects],
  );
  const attention = useMemo(() => ({
    ...buildHomeAttentionSummary(visibleProjects, scopedOpenTasks, todayIso, canEdit ? visibleTasks : []),
    certificateExceptions,
    pendingDecisions,
    overdueDocuments,
    financialExceptions,
    warrantyCloseoutExceptions,
    offlineSyncExceptions,
  }), [canEdit, certificateExceptions, financialExceptions, offlineSyncExceptions, overdueDocuments, pendingDecisions, scopedOpenTasks, todayIso, visibleProjects, visibleTasks, warrantyCloseoutExceptions]);
  const actionCenterItems = useMemo(() => buildHomeActionCenterItems(attention), [attention]);
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

  const refreshCertificates = useCallback(async () => {
    if (!includeCertificateExceptions) {
      setCertificates([]);
      setComplianceDocuments([]);
      setCertificateLoadError('');
      return;
    }
    setCertificateLoadError('');
    try {
      const [certificateRows, documentRows] = await Promise.all([
        loadInsuranceCertificates(),
        loadSubcontractorComplianceDocuments(),
      ]);
      setCertificates(certificateRows);
      setComplianceDocuments(documentRows);
    } catch (error) {
      reportError(error, { operation: 'certificate.home-list', workspace: 'home' });
      setCertificateLoadError('Certificate exceptions are temporarily unavailable.');
    }
  }, [includeCertificateExceptions]);

  useEffect(() => { void refreshCertificates(); }, [refreshCertificates]);

  const refreshPortalActions = useCallback(async () => {
    if (!visibleProjects.length || !visibleProjectTabIds.has('portal')) {
      setPortalItems([]);
      setPortalLoadError('');
      return;
    }
    setPortalLoadError('');
    try {
      setPortalItems(await loadPortalItemsForProjects(visibleProjects.map((project) => project.id)));
    } catch (error) {
      reportError(error, { operation: 'portal.home-list', workspace: 'home' });
      setPortalLoadError('Pending portal actions are temporarily unavailable.');
    }
  }, [visibleProjectTabIds, visibleProjects]);

  useEffect(() => { void refreshPortalActions(); }, [refreshPortalActions]);

  const refreshDocumentActions = useCallback(async () => {
    if (!visibleProjects.length || !visibleProjectTabIds.has('rfis-submittals')) {
      setDocumentItems({ rfis: [], submittals: [] });
      setDocumentLoadError('');
      return;
    }
    setDocumentLoadError('');
    try {
      const projectIds = visibleProjects.map((project) => project.id);
      const [rfis, submittals] = await Promise.all([
        loadWorkflowItemsForProjects('rfis', projectIds),
        loadWorkflowItemsForProjects('submittals', projectIds),
      ]);
      setDocumentItems({ rfis, submittals });
    } catch (error) {
      reportError(error, { operation: 'rfi-submittal.home-list', workspace: 'home' });
      setDocumentLoadError('Overdue RFI and submittal actions are temporarily unavailable.');
    }
  }, [visibleProjectTabIds, visibleProjects]);

  useEffect(() => { void refreshDocumentActions(); }, [refreshDocumentActions]);

  const refreshFinancialActions = useCallback(async () => {
    const includeChangeOrders = visibleProjectTabIds.has('change-orders');
    const includeBudget = visibleProjectTabIds.has('budget-commitments');
    if (!visibleProjects.length || (!includeChangeOrders && !includeBudget)) {
      setFinancialItems({ changeOrders: [], budgetItems: [], commitments: [] });
      setFinancialLoadError('');
      return;
    }
    setFinancialLoadError('');
    try {
      const projectIds = visibleProjects.map((project) => project.id);
      const [changeOrders, budgetItems, commitments] = await Promise.all([
        includeChangeOrders ? loadWorkflowItemsForProjects('changeOrders', projectIds) : Promise.resolve([]),
        includeBudget ? loadWorkflowItemsForProjects('budgetItems', projectIds) : Promise.resolve([]),
        includeBudget ? loadWorkflowItemsForProjects('commitments', projectIds) : Promise.resolve([]),
      ]);
      setFinancialItems({ changeOrders, budgetItems, commitments });
    } catch (error) {
      reportError(error, { operation: 'financial.home-list', workspace: 'home' });
      setFinancialLoadError('Change-order and budget actions are temporarily unavailable.');
    }
  }, [visibleProjectTabIds, visibleProjects]);

  useEffect(() => { void refreshFinancialActions(); }, [refreshFinancialActions]);

  const refreshWarrantyCloseoutActions = useCallback(async () => {
    if (!visibleProjects.length || !visibleProjectTabIds.has('warranty-closeout')) {
      setWarrantyCloseoutItems({ warrantyItems: [], closeoutItems: [] });
      setWarrantyCloseoutLoadError('');
      return;
    }
    setWarrantyCloseoutLoadError('');
    try {
      const projectIds = visibleProjects.map((project) => project.id);
      const [warrantyItems, closeoutItems] = await Promise.all([
        loadWorkflowItemsForProjects('warrantyItems', projectIds),
        loadWorkflowItemsForProjects('closeoutItems', projectIds),
      ]);
      setWarrantyCloseoutItems({ warrantyItems, closeoutItems });
    } catch (error) {
      reportError(error, { operation: 'warranty-closeout.home-list', workspace: 'home' });
      setWarrantyCloseoutLoadError('Warranty and closeout actions are temporarily unavailable.');
    }
  }, [visibleProjectTabIds, visibleProjects]);

  useEffect(() => { void refreshWarrantyCloseoutActions(); }, [refreshWarrantyCloseoutActions]);

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
    await Promise.all([
      refresh({ force: true }),
      refreshAudit(),
      refreshCertificates(),
      refreshPortalActions(),
      refreshDocumentActions(),
      refreshFinancialActions(),
      refreshWarrantyCloseoutActions(),
      weatherVisible ? refreshWeather(true) : Promise.resolve(),
    ]);
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
          location: quickTask.location,
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

  function updateQuickTask(field, value) {
    setQuickTask((current) => (
      field === 'projectId' && value !== current.projectId
        ? { ...current, projectId: value, location: '' }
        : { ...current, [field]: value }
    ));
  }

  async function addQuickTaskLocation(projectId, location) {
    if (!visibleProjects.some((project) => project.id === projectId)) throw new Error('This project is not available.');
    return runMutation(['project', projectId, 'locations'], async () => {
      const result = await addProjectTaskLocation(dataRef.current, projectId, location);
      if (result.nextState !== dataRef.current) {
        dataRef.current = result.nextState;
        onStateChange(result.nextState);
      }
      return result.location;
    });
  }

  const taskComplete = canEdit ? (task) => void completeTask(task) : null;

  function focusQuickTask() {
    document.getElementById('home-quick-task-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => document.getElementById('home-quick-task-name')?.focus(), 250);
  }

  return (
    <section className="panel native-panel workspace-page home-page">
      <header className="home-page-header">
        <div><p className="eyebrow">Daily command center</p><h1>Home</h1><p>{formatDayHeading(now)} · Next 7 days through {formatDayHeading(addLocalDays(now, 7))}</p></div>
        <div className="home-page-actions">
          <button className="button secondary" type="button" onClick={toggleWeather}>{weatherVisible ? 'Hide weather' : 'Show weather'}</button>
          <button className="button secondary home-refresh-button" type="button" onClick={() => void refreshHome()} disabled={loading || auditLoading}><FluentIcon name="replace" />{loading || auditLoading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      <MyDayWorkspace
        summary={myDaySummary}
        activeUser={activeUser}
        canEdit={canEdit}
        offline={offline}
        onOpen={onOpenItem}
        onComplete={taskComplete}
        onAddTask={focusQuickTask}
        onQuickAction={onQuickAction}
      />

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

      <ActionCenter
        actions={actionCenterItems}
        canEdit={canEdit}
        onOpen={onOpenItem}
        onComplete={taskComplete}
        sourceWarning={[
          certificateLoadError,
          portalLoadError,
          documentLoadError,
          financialLoadError,
          warrantyCloseoutLoadError,
        ].filter(Boolean).join(' ')}
      />

      {canEdit ? <QuickTaskForm draft={quickTask} projects={visibleProjects} locationOptions={visibleProjects.find((project) => project.id === quickTask.projectId)?.locations || []} assigneeOptions={assigneeOptions} complianceWarnings={complianceWarnings} saving={isMutating('home:task:create')} message={quickTaskMessage} onChange={updateQuickTask} onAddLocation={addQuickTaskLocation} onSubmit={(event) => void submitQuickTask(event)} /> : null}

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
