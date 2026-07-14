import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AppDialogHost from './components/AppDialogs.jsx';
import FluentIcon from './components/FluentIcon.jsx';
import { PasswordResetView, SignInView } from './components/AuthViews.jsx';
import { getVisibleProjectsForUser } from './utils/accessUi.js';
import { AppErrorBoundary, WorkspaceSplash } from './components/SharedUI.jsx';

const NativeProjectsView = lazy(() => import('./components/NativeProjectsView.jsx'));
const NativeScheduleView = lazy(() => import('./components/NativeScheduleView.jsx'));
const NativeTasksView = lazy(() => import('./components/NativeTasksView.jsx'));
const NativePeopleView = lazy(() => import('./components/NativePeopleView.jsx'));
const NativeSettingsView = lazy(() => import('./components/NativeSettingsView.jsx'));
const NativeFilesView = lazy(() =>
  import('./components/ProjectAssetsViews.jsx').then((module) => ({ default: module.NativeFilesView })),
);
const NativePhotosView = lazy(() =>
  import('./components/ProjectAssetsViews.jsx').then((module) => ({ default: module.NativePhotosView })),
);
import {
  getAppRedirectUrl,
  getSearchParam,
  isNativeAndroidApp,
  updateCurrentUrl,
} from './platform/platformAdapter.js';

const USER_ROLE_OPTIONS = ['Admin', 'Edit', 'Customer', 'Subcontractor', 'View Only'];
let trackerDataModulePromise = null;
let androidNotificationsModulePromise = null;

function loadTrackerDataModule() {
  if (!trackerDataModulePromise) trackerDataModulePromise = import('./services/trackerData.js');
  return trackerDataModulePromise;
}

function loadAndroidNotificationsModule() {
  if (!androidNotificationsModulePromise) androidNotificationsModulePromise = import('./utils/androidNotifications.js');
  return androidNotificationsModulePromise;
}

function getProjectHealth(project) {
  const labels = { active: 'On track', planning: 'In planning', delayed: 'Needs attention', done: 'Completed' };
  return { label: labels[project?.status || 'planning'] || 'Project' };
}

function getStorageBannerMessage(storageMode, storageIssue = '') {
  if (storageMode === 'supabase' || storageMode === 'loading') return null;
  if (storageMode === 'local-unconfigured') {
    return { title: 'Supabase not configured.', message: storageIssue || 'The React app is currently reading browser local storage only.' };
  }
  return {
    title: 'Using local storage.',
    message: storageIssue
      ? `Supabase is unavailable right now. ${storageIssue}`
      : 'Supabase is unavailable right now, so this React slice is reading browser-stored data on this device.',
  };
}

const tabs = [
  {
    id: 'projects',
    label: 'Projects',
    description: 'Review active jobs, scan next actions, and open any project into its full workspace.',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    description: 'Review phases, step timing, dependencies, delays, and task markers in one timeline.',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Daily visibility for phases, steps, tasks, holidays, and weekends using the same project filter as the Gantt.',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Track what is open, overdue, and already complete.',
  },
  {
    id: 'people',
    label: 'People',
    description: 'Switch between people types, search quickly, and choose the best view.',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Controls that shape date calculations, calendar visibility, and page-level display helpers.',
  },
];

const SESSION_PROJECT_FILTER_KEY = 'cx_session_project_filter';
const LAST_ACTIVE_TAB_KEY = 'cx_last_active_tab';
const PROJECT_SCOPED_TAB_IDS = new Set(['schedule', 'calendar', 'tasks']);
const validTabIds = new Set(tabs.map((tab) => tab.id));
const NON_EDITOR_TAB_IDS = ['projects', 'calendar'];

function normalizeAppUserRole(role) {
  return USER_ROLE_OPTIONS.includes(role) ? role : 'View Only';
}

function getUserCapabilities(role) {
  const normalizedRole = normalizeAppUserRole(role);
  const canManageUsers = normalizedRole === 'Admin';
  const canEdit = normalizedRole === 'Admin' || normalizedRole === 'Edit';
  const readOnlyAllowedTabs =
    normalizedRole === 'Customer'
      ? ['projects']
      : NON_EDITOR_TAB_IDS;
  const allowedTabs =
    normalizedRole === 'Admin'
      ? tabs.map((tab) => tab.id)
      : normalizedRole === 'Edit'
        ? tabs.filter((tab) => tab.id !== 'settings').map((tab) => tab.id)
        : readOnlyAllowedTabs;

  return {
    role: normalizedRole,
    canEdit,
    canManageUsers,
    canAccessSettings: canManageUsers,
    showTabs: normalizedRole !== 'Customer',
    allowedTabs,
  };
}

function getActiveUserForAuthSession(users, authSession) {
  const email = String(authSession?.user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const normalizedUsers = Array.isArray(users) ? users : [];
  const matchingUser = normalizedUsers.find((user) => String(user?.email || '').trim().toLowerCase() === email);
  if (matchingUser) return matchingUser;
  const bootstrapAdmin =
    normalizedUsers.length === 1 &&
    normalizeAppUserRole(normalizedUsers[0]?.role) === 'Admin' &&
    !String(normalizedUsers[0]?.email || '').trim();
  return bootstrapAdmin ? { ...normalizedUsers[0], email } : null;
}

function getTabFromLocation() {
  const tab = getSearchParam('tab');
  if (validTabIds.has(tab)) return tab;
  let storedTab = '';
  try {
    storedTab = window.localStorage.getItem(LAST_ACTIVE_TAB_KEY) || '';
  } catch {
    storedTab = '';
  }
  return validTabIds.has(storedTab) ? storedTab : 'projects';
}

function getProjectIdFromLocation() {
  return String(getSearchParam('project') || '').trim();
}

function syncTabToLocation(tab, { push = false } = {}) {
  if (!validTabIds.has(tab)) return;
  updateCurrentUrl((url) => {
    url.searchParams.set('tab', tab);
    if (tab !== 'projects') url.searchParams.delete('project');
  }, { push });
}

function syncProjectToLocation(projectId, { push = false } = {}) {
  updateCurrentUrl((url) => {
    if (String(projectId || '').trim()) url.searchParams.set('project', String(projectId).trim());
    else url.searchParams.delete('project');
  }, { push });
}


export default function App() {
  const nativeAndroid = isNativeAndroidApp();
  const [activeTab, setActiveTab] = useState(getTabFromLocation);
  const [projectsHomeSignal, setProjectsHomeSignal] = useState(0);
  const [projectNavigationTarget, setProjectNavigationTarget] = useState(null);
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [passwordResetError, setPasswordResetError] = useState('');
  const [trackerState, setTrackerState] = useState({
    projects: [],
    tasks: [],
    subs: [],
    employees: [],
    settings: {
      showGanttTaskDueDates: true,
      showCalendarTaskDueDates: true,
      showCalendarPhases: true,
      showCalendarHebrewDates: false,
      showPageStats: true,
      inspectionSubcodes: ['FOOT-101', 'FRAME-220', 'ELEC-310'],
      users: [{ id: 'user-admin', name: 'Admin', email: '', role: 'Admin' }],
      currentUserId: 'user-admin',
    },
    settingsLoadedFromSupabase: false,
    settingsVersion: 0,
    concurrencyEnabled: false,
    storageMode: 'loading',
    storageIssue: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionTest, setConnectionTest] = useState({ status: 'idle', message: '' });
  const [startupCheck, setStartupCheck] = useState({ status: 'idle', message: '' });
  const [showAndroidNavMenu, setShowAndroidNavMenu] = useState(false);
  const [showAndroidAccountMenu, setShowAndroidAccountMenu] = useState(false);
  const [taskHighlightRequest, setTaskHighlightRequest] = useState({ taskId: '', token: '' });
  const [sessionProjectFilter, setSessionProjectFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return window.sessionStorage.getItem(SESSION_PROJECT_FILTER_KEY) || 'all';
  });
  const trackerStateRef = useRef(trackerState);
  const previousActiveTabRef = useRef(activeTab);

  useEffect(() => {
    trackerStateRef.current = trackerState;
  }, [trackerState]);

  async function refreshData(options = {}) {
    if (!authSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { loadTrackerData } = await loadTrackerDataModule();
      const next = await loadTrackerData({ force: options?.force !== false });
      setTrackerState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracker data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadTrackerDataModule()
      .then(async ({ consumeAuthSessionFromUrl, initializeAuthSession }) => {
        const recoverySession = consumeAuthSessionFromUrl();
        if (recoverySession?.type === 'recovery') setRecoveryMode(true);
        return recoverySession || initializeAuthSession();
      })
      .then((session) => {
        if (!cancelled) {
          setAuthSession(session);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Failed to initialize sign-in.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authLoading && authSession) {
      refreshData({ force: false });
    } else if (!authLoading && !authSession) {
      setLoading(false);
    }
  }, [authLoading, authSession]);

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    const shouldPushHistory = isNativeAndroidApp() && previousTab !== activeTab;
    syncTabToLocation(activeTab, { push: shouldPushHistory });
    if (typeof window !== 'undefined' && validTabIds.has(activeTab)) {
      try {
        window.localStorage.setItem(LAST_ACTIVE_TAB_KEY, activeTab);
      } catch {
        // Ignore storage issues and keep navigation working.
      }
    }
    previousActiveTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    function handlePopState() {
      setActiveTab(getTabFromLocation());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const storageBanner = getStorageBannerMessage(
    trackerState.storageMode,
    trackerState.storageIssue,
  );
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const supabaseDiagnostics = { url: supabaseUrl, configured: !!supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_URL' };
  const users = useMemo(
    () =>
      Array.isArray(trackerState.settings?.users) && trackerState.settings.users.length
        ? trackerState.settings.users
        : [{ id: 'user-admin', name: 'Admin', email: '', role: 'Admin' }],
    [trackerState.settings?.users],
  );
  const activeUser = useMemo(() => getActiveUserForAuthSession(users, authSession), [users, authSession]);
  const capabilities = useMemo(() => getUserCapabilities(activeUser?.role), [activeUser?.role]);

  useEffect(() => {
    if (!nativeAndroid || loading || !authSession || !activeUser?.id) return;
    void loadAndroidNotificationsModule()
      .then(({ syncAndroidNotifications }) => syncAndroidNotifications({ data: trackerState, activeUser }))
      .catch(() => {});
  }, [activeUser, authSession, loading, nativeAndroid, trackerState.projects, trackerState.settings, trackerState.tasks]);

  useEffect(() => {
    if (!nativeAndroid) return undefined;
    let listenerHandle = null;
    let cancelled = false;
    void loadAndroidNotificationsModule()
      .then(({ addAndroidNotificationActionListener }) => addAndroidNotificationActionListener((extra) => {
        const requestedTab = String(extra.tab || 'projects');
        const targetTab = capabilities.allowedTabs.includes(requestedTab) ? requestedTab : 'projects';
        if (extra.projectId) setSessionProjectFilter(extra.projectId || 'all');
        if (targetTab === 'tasks' && extra.taskId) {
          setTaskHighlightRequest({ taskId: extra.taskId, token: `${Date.now()}` });
        }
        if (targetTab === 'projects' && extra.projectId && extra.projectId !== 'all') {
          setProjectNavigationTarget({ projectId: extra.projectId, token: `${Date.now()}` });
        }
        setActiveTab(targetTab);
      }))
      .then((handle) => {
        if (cancelled) void handle.remove();
        else listenerHandle = handle;
      });
    return () => {
      cancelled = true;
      if (listenerHandle) void listenerHandle.remove();
    };
  }, [capabilities.allowedTabs, nativeAndroid]);
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(trackerState.projects, trackerState.settings, activeUser),
    [trackerState.projects, trackerState.settings, activeUser],
  );
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);
  const railTaskCountByProject = useMemo(() => {
    const counts = new Map();
    (trackerState.tasks || []).forEach((task) => {
      if (!task?.projectId || !visibleProjectIds.has(task.projectId)) return;
      counts.set(task.projectId, (counts.get(task.projectId) || 0) + 1);
    });
    return counts;
  }, [trackerState.tasks, visibleProjectIds]);
  const railSelectedProjectId = getProjectIdFromLocation();
  const railActiveProjectId =
    activeTab === 'projects'
      ? railSelectedProjectId
      : PROJECT_SCOPED_TAB_IDS.has(activeTab) && sessionProjectFilter !== 'all'
        ? sessionProjectFilter
        : '';
  const railAllProjectsActive = !railActiveProjectId;
  const signedInUserName =
    String(activeUser?.name || '').trim() || String(authSession?.user?.email || '').trim() || 'Signed-in user';
  const signedInUserEmail = String(activeUser?.email || authSession?.user?.email || '').trim();
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => capabilities.allowedTabs.includes(tab.id)),
    [capabilities.allowedTabs],
  );
  const activeTabMeta = useMemo(
    () => visibleTabs.find((tab) => tab.id === activeTab) || tabs.find((tab) => tab.id === activeTab) || tabs[0],
    [visibleTabs, activeTab],
  );
  const sharedScopeEnabled = PROJECT_SCOPED_TAB_IDS.has(activeTab) && visibleProjects.length > 0;
  const sharedScopeProject = useMemo(
    () =>
      sessionProjectFilter === 'all'
        ? null
        : visibleProjects.find((project) => project.id === sessionProjectFilter) || null,
    [sessionProjectFilter, visibleProjects],
  );
  const initialWorkspaceLoading =
    !!authSession &&
    loading &&
    trackerState.storageMode === 'loading' &&
    !trackerState.projects.length &&
    !trackerState.tasks.length &&
    !trackerState.subs.length &&
    !trackerState.employees.length;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(SESSION_PROJECT_FILTER_KEY, sessionProjectFilter || 'all');
  }, [sessionProjectFilter]);

  useEffect(() => {
    if (!capabilities.allowedTabs.includes(activeTab)) {
      setActiveTab(capabilities.allowedTabs[0] || 'projects');
    }
  }, [activeTab, capabilities.allowedTabs]);

  useEffect(() => {
    setShowAndroidNavMenu(false);
    setShowAndroidAccountMenu(false);
  }, [activeTab, authSession]);

  function goToProjectsHome() {
    if (activeTab === 'projects' && getProjectIdFromLocation()) {
      syncProjectToLocation('', { push: true });
    }
    setActiveTab('projects');
    setProjectNavigationTarget(null);
    setProjectsHomeSignal((current) => current + 1);
    setShowAndroidNavMenu(false);
    setShowAndroidAccountMenu(false);
  }

  function openNewProjectFromRail() {
    if (activeTab === 'projects' && getProjectIdFromLocation()) {
      syncProjectToLocation('', { push: true });
    }
    setSessionProjectFilter('all');
    setActiveTab('projects');
    setProjectsHomeSignal((current) => current + 1);
    setProjectNavigationTarget({
      action: 'create',
      token: `create-${Date.now()}`,
    });
    setShowAndroidNavMenu(false);
    setShowAndroidAccountMenu(false);
  }

  function openProjectSelectionLink(selectionLink) {
    if (!selectionLink?.projectId || !selectionLink?.selectionId) return;
    setProjectNavigationTarget({
      ...selectionLink,
      detailTab: 'selections',
      token: `${selectionLink.projectId}-${selectionLink.selectionId}-${Date.now()}`,
    });
    setActiveTab('projects');
    setShowAndroidNavMenu(false);
    setShowAndroidAccountMenu(false);
  }

  async function handleSignIn(email, password) {
    setSigningIn(true);
    setAuthError('');
    try {
      const { signInWithPassword } = await loadTrackerDataModule();
      const session = await signInWithPassword(email, password);
      setAuthSession(session);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSendPasswordEmail(email) {
    const trimmedEmail = String(email || '').trim();
    if (!trimmedEmail) return;
    setRecoveryLoading(true);
    setRecoveryMessage(null);
    try {
      const { sendPasswordRecoveryEmail } = await loadTrackerDataModule();
      await sendPasswordRecoveryEmail(trimmedEmail, getAppRedirectUrl());
      setRecoveryMessage({
        type: 'success',
        text: `Password email sent to ${trimmedEmail}.`,
      });
    } catch (err) {
      setRecoveryMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to send password email.',
      });
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleSaveRecoveredPassword(password) {
    setRecoveryLoading(true);
    setPasswordResetError('');
    try {
      const { updateAuthPassword } = await loadTrackerDataModule();
      const nextSession = await updateAuthPassword(password, authSession);
      setAuthSession(nextSession || authSession);
      setRecoveryMode(false);
      await refreshData();
    } catch (err) {
      setPasswordResetError(err instanceof Error ? err.message : 'Unable to save password.');
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleSignOut() {
    const { signOutAuthSession } = await loadTrackerDataModule();
    await signOutAuthSession();
    setAuthSession(null);
    setRecoveryMode(false);
    setRecoveryMessage(null);
    setPasswordResetError('');
    setTrackerState((current) => ({
      ...current,
      projects: [],
      tasks: [],
      subs: [],
      employees: [],
      storageMode: 'loading',
      storageIssue: '',
    }));
    setActiveTab('projects');
  }

  async function handleTestSupabaseConnection() {
    setConnectionTest({ status: 'testing', message: '' });
    const { testSupabaseConnection } = await loadTrackerDataModule();
    const result = await testSupabaseConnection();
    setConnectionTest({
      status: result.ok ? 'success' : 'error',
      message: result.message,
    });
  }

  async function handleRunSupabaseStartupCheck() {
    setStartupCheck({ status: 'testing', message: '' });
    const { runSupabaseStartupCheck } = await loadTrackerDataModule();
    const result = await runSupabaseStartupCheck();
    setStartupCheck({
      status: result.ok ? 'success' : 'error',
      message: result.message,
    });
  }

  if (authLoading) {
    return <WorkspaceSplash message="Preparing sign-in" />;
  }

  if (!authSession) {
    return (
      <SignInView
        loading={signingIn}
        recoveryLoading={recoveryLoading}
        error={authError}
        recoveryMessage={recoveryMessage}
        onSignIn={(email, password) => void handleSignIn(email, password)}
        onSendPasswordEmail={(email) => void handleSendPasswordEmail(email)}
      />
    );
  }

  if (recoveryMode) {
    return (
      <PasswordResetView
        loading={recoveryLoading}
        error={passwordResetError}
        onSavePassword={(password) => void handleSaveRecoveredPassword(password)}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  if (initialWorkspaceLoading) {
    return <WorkspaceSplash message="Loading workspace" />;
  }
  const activeView = (() => {
    if (activeTab === 'projects') {
      return (
        <NativeProjectsView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
          readOnly={!capabilities.canEdit}
          activeUser={activeUser}
          users={users}
          homeSignal={projectsHomeSignal}
          navigationTarget={projectNavigationTarget}
        />
      );
    }

    if (activeTab === 'tasks') {
      return (
        <NativeTasksView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
          activeUser={activeUser}
          projectFilter={sessionProjectFilter}
          onProjectFilterChange={setSessionProjectFilter}
          highlightTaskId={taskHighlightRequest.taskId}
          highlightToken={taskHighlightRequest.token}
          onOpenSelection={openProjectSelectionLink}
        />
      );
    }

    if (activeTab === 'schedule') {
      return (
        <NativeScheduleView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
          view="schedule"
          activeUser={activeUser}
          projectFilter={sessionProjectFilter}
          onProjectFilterChange={setSessionProjectFilter}
        />
      );
    }

    if (activeTab === 'calendar') {
      return (
        <NativeScheduleView
          data={trackerState}
          refresh={refreshData}
          loading={loading}
          onStateChange={setTrackerState}
          view="calendar"
          activeUser={activeUser}
          projectFilter={sessionProjectFilter}
          onProjectFilterChange={setSessionProjectFilter}
        />
      );
    }

    if (activeTab === 'people') {
      return (
        <NativePeopleView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
          activeUser={activeUser}
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <NativeSettingsView
          data={trackerState}
          onStateChange={setTrackerState}
          refresh={refreshData}
          loading={loading}
          activeUser={activeUser}
        />
      );
    }

    return null;
  })();

  return (
    <main className="app-shell">
      <AppDialogHost />
      {nativeAndroid ? (
        <section className="workspace-shell-bar android-shell-bar">
          <div className="android-shell-main">
            {capabilities.showTabs ? (
              <div className="android-nav-menu-shell">
                <button
                  className="button secondary android-nav-trigger"
                  type="button"
                  onClick={() => {
                    setShowAndroidAccountMenu(false);
                    setShowAndroidNavMenu((current) => !current);
                  }}
                  aria-expanded={showAndroidNavMenu ? 'true' : 'false'}
                  aria-label="Open navigation menu"
                >
                  <span className="android-nav-trigger-copy">
                    <span className="android-nav-trigger-label">Navigate</span>
                    <strong>{activeTabMeta?.label || 'Destiny Project Hub'}</strong>
                  </span>
                  <FluentIcon name="arrowDown" />
                </button>
                {showAndroidNavMenu ? (
                  <div className="android-nav-menu" role="menu" aria-label="Navigation">
                    {visibleTabs.map((tab) => (
                      <button
                        key={tab.id}
                        className={`android-nav-menu-item${activeTab === tab.id ? ' active' : ''}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={activeTab === tab.id ? 'true' : 'false'}
                        onClick={() => {
                          if (tab.id === 'projects') {
                            goToProjectsHome();
                          } else {
                            setActiveTab(tab.id);
                          }
                          setShowAndroidNavMenu(false);
                        }}
                      >
                        <span className="android-nav-menu-item-copy">
                          <strong>{tab.label}</strong>
                          <small>{tab.description}</small>
                        </span>
                        {activeTab === tab.id ? <FluentIcon name="check" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <strong className="android-shell-title">{activeTabMeta?.label || 'Destiny Project Hub'}</strong>
            )}
            <div className="android-shell-actions">
              <button
                className="button secondary gantt-icon-button android-account-button"
                type="button"
                onClick={() => {
                  setShowAndroidNavMenu(false);
                  setShowAndroidAccountMenu((current) => !current);
                }}
                title="Account"
                aria-label="Account"
                aria-expanded={showAndroidAccountMenu ? 'true' : 'false'}
              >
                <span className="android-account-initial" aria-hidden="true">
                  {signedInUserName.slice(0, 1).toUpperCase()}
                </span>
              </button>
            </div>
          </div>
          {sharedScopeEnabled ? (
            <div className="workspace-scope-bar android-scope-bar">
              <div className="workspace-scope-meta">
                <span className="workspace-scope-label">Project scope</span>
                <strong>{sharedScopeProject?.name || 'All visible projects'}</strong>
              </div>
              <label className="task-filter workspace-scope-filter">
                <span>Current filter</span>
                <select value={sessionProjectFilter} onChange={(event) => setSessionProjectFilter(event.target.value)}>
                  <option value="all">All projects</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {showAndroidAccountMenu ? (
            <div className="android-account-menu">
              <div className="workspace-user-card android-account-card">
                <div className="workspace-user-avatar" aria-hidden="true">
                  {signedInUserName.slice(0, 1).toUpperCase()}
                </div>
                <div className="signed-in-user" title={signedInUserEmail || undefined}>
                  <span className="signed-in-label">Signed in</span>
                  <strong>{signedInUserName}</strong>
                  {signedInUserEmail ? <small>{signedInUserEmail}</small> : null}
                </div>
              </div>
              <button
                className="button secondary android-signout-button"
                type="button"
                onClick={() => void handleSignOut()}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {storageBanner ? (
        <section className="storage-banner">
          <div className="storage-banner-copy">
            <strong>{storageBanner.title}</strong>
            <span>{storageBanner.message}</span>
            <small className="storage-diagnostics-line">
              Supabase URL: {supabaseDiagnostics.url || 'Not configured'}
            </small>
            {connectionTest.message ? (
              <small
                className={`storage-diagnostics-line${connectionTest.status === 'error' ? ' error' : ''}`}
              >
                Connection test: {connectionTest.message}
              </small>
            ) : null}
            {startupCheck.message ? (
              <small
                className={`storage-diagnostics-line${startupCheck.status === 'error' ? ' error' : ''}`}
              >
                Startup check: {startupCheck.message}
              </small>
            ) : null}
          </div>
          <div className="storage-banner-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => void handleTestSupabaseConnection()}
              disabled={connectionTest.status === 'testing'}
            >
              {connectionTest.status === 'testing' ? 'Testing...' : 'Test connection'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => void handleRunSupabaseStartupCheck()}
              disabled={startupCheck.status === 'testing'}
            >
              {startupCheck.status === 'testing' ? 'Checking...' : 'Run full check'}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="error-banner">
          <strong>Data load failed.</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {capabilities.showTabs && !nativeAndroid ? (
        <section className="workspace-shell-bar">
          <div className="workspace-top-strip">
            <button
              className="workspace-strip-home"
              type="button"
              onClick={goToProjectsHome}
              aria-label="Go to projects home"
              title="Projects home"
            >
              <div className="workspace-logo workspace-strip-logo" aria-hidden="true">
                <img src="/destiny-logo.png" alt="Destiny Homes logo" />
              </div>
            </button>
            <nav className="react-tabs" aria-label="Destiny Project Hub navigation">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`react-tab${activeTab === tab.id ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'projects') {
                      goToProjectsHome();
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  title={tab.description}
                  aria-label={`${tab.label}: ${tab.description}`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="workspace-user-controls workspace-strip-user">
              <div className="workspace-user-card">
                <div className="workspace-user-avatar" aria-hidden="true">
                  {signedInUserName.slice(0, 1).toUpperCase()}
                </div>
                <div className="signed-in-user" title={signedInUserEmail || undefined}>
                  <strong>{signedInUserName}</strong>
                  {signedInUserEmail ? <small>{signedInUserEmail}</small> : null}
                </div>
              </div>
              <button
                className="button secondary gantt-icon-button workspace-signout-button"
                type="button"
                onClick={() => void handleSignOut()}
                title="Sign out"
                aria-label="Sign out"
              >
                <FluentIcon name="signOut" />
              </button>
            </div>
          </div>
          {sharedScopeEnabled ? (
            <div className="workspace-scope-bar">
              <div className="workspace-scope-meta">
                <span className="workspace-scope-label">Project scope</span>
                <strong>{sharedScopeProject?.name || 'All visible projects'}</strong>
              </div>
              <label className="task-filter workspace-scope-filter">
                <span>Current filter</span>
                <select value={sessionProjectFilter} onChange={(event) => setSessionProjectFilter(event.target.value)}>
                  <option value="all">All projects</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className={`workspace-content-shell${capabilities.showTabs && !nativeAndroid && visibleProjects.length ? ' has-project-rail' : ''}`}>
        {capabilities.showTabs && !nativeAndroid && visibleProjects.length ? (
          <aside className="projects-rail workspace-projects-rail">
            <div className="projects-rail-header">
              <strong>Projects</strong>
              <span>{visibleProjects.length} jobs</span>
            </div>
            <div className="projects-rail-list" role="list" aria-label="All projects">
              <button
                className={`projects-rail-item projects-rail-all${railAllProjectsActive ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  setSessionProjectFilter('all');
                  goToProjectsHome();
                }}
                aria-pressed={railAllProjectsActive}
                aria-current={railAllProjectsActive ? 'page' : undefined}
              >
                <span className="projects-rail-item-title">All Projects</span>
                <span className="projects-rail-item-meta">Portfolio overview</span>
              </button>
              {visibleProjects.map((project) => {
                const taskCount = railTaskCountByProject.get(project.id) || 0;
                const health = getProjectHealth(project);
                const isActive = project.id === railActiveProjectId;
                return (
                  <button
                    key={project.id}
                    className={`projects-rail-item${isActive ? ' active' : ''}`}
                    type="button"
                    onClick={() => {
                      setProjectNavigationTarget({
                        projectId: project.id,
                        token: `${project.id}-${Date.now()}`,
                      });
                      if (activeTab !== 'projects') {
                        setActiveTab('projects');
                      }
                      syncProjectToLocation(project.id, { push: true });
                    }}
                    aria-pressed={isActive}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="projects-rail-item-title">{project.name}</span>
                    <span className="projects-rail-item-meta">
                      {project.status || 'planning'} | {taskCount} tasks
                    </span>
                    <span className="projects-rail-item-meta subtle">{health.label}</span>
                  </button>
                );
              })}
              {capabilities.canEdit ? (
                <button className="button primary projects-rail-create" type="button" onClick={openNewProjectFromRail}>
                  New project
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
        <div className="workspace-content-main">
          <AppErrorBoundary resetKey={activeTab}>
            <Suspense
              fallback={(
                <section className="panel native-panel workspace-page" aria-live="polite" aria-busy="true">
                  <div className="empty-state compact">
                    <h3>Loading workspace</h3>
                    <p>Preparing this page…</p>
                  </div>
                </section>
              )}
            >
              {activeView}
            </Suspense>
          </AppErrorBoundary>
        </div>
      </div>
    </main>
  );
}









