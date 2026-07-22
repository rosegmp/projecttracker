import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AppDialogHost from './components/AppDialogs.jsx';
import FluentIcon from './components/FluentIcon.jsx';
import { PasswordResetView, SignInView } from './components/AuthViews.jsx';
import { getVisibleProjectsForUser } from './utils/accessUi.js';
import { getProjectOperationalHealth } from './utils/homeView.js';
import { AppErrorBoundary, WorkspaceSplash } from './components/SharedUI.jsx';

const NativeProjectsView = lazy(() => import('./components/NativeProjectsView.jsx'));
const NativeHomeView = lazy(() => import('./components/NativeHomeView.jsx'));
const NativeScheduleView = lazy(() => import('./components/NativeScheduleView.jsx'));
const NativeTasksView = lazy(() => import('./components/NativeTasksView.jsx'));
const NativePeopleView = lazy(() => import('./components/NativePeopleView.jsx'));
const NativeSettingsView = lazy(() => import('./components/NativeSettingsView.jsx'));
const AndroidNotificationPreferences = lazy(() => import('./components/AndroidNotificationPreferences.jsx'));
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
    id: 'home',
    label: 'Home',
    description: 'Prioritize overdue and blocked work, then review today and the next seven days.',
  },
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
const NON_EDITOR_TAB_IDS = ['home', 'projects', 'calendar'];

function normalizeAppUserRole(role) {
  return USER_ROLE_OPTIONS.includes(role) ? role : 'View Only';
}

function getUserCapabilities(role) {
  const normalizedRole = normalizeAppUserRole(role);
  const canManageUsers = normalizedRole === 'Admin';
  const canEdit = normalizedRole === 'Admin' || normalizedRole === 'Edit';
  const portalRole = normalizedRole === 'Customer' || normalizedRole === 'Subcontractor';
  const readOnlyAllowedTabs =
    portalRole
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
    showTabs: !portalRole,
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
  return validTabIds.has(storedTab) ? storedTab : 'home';
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
    deferredDataStatus: 'idle',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionTest, setConnectionTest] = useState({ status: 'idle', message: '' });
  const [startupCheck, setStartupCheck] = useState({ status: 'idle', message: '' });
  const [showAndroidNavMenu, setShowAndroidNavMenu] = useState(false);
  const [showAndroidAccountMenu, setShowAndroidAccountMenu] = useState(false);
  const [showAndroidNotificationSettings, setShowAndroidNotificationSettings] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [taskHighlightRequest, setTaskHighlightRequest] = useState({ taskId: '', token: '' });
  const [sessionProjectFilter, setSessionProjectFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return window.sessionStorage.getItem(SESSION_PROJECT_FILTER_KEY) || 'all';
  });
  const trackerStateRef = useRef(trackerState);
  const previousActiveTabRef = useRef(activeTab);
  const initialWorkspaceLoadedRef = useRef(false);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    trackerStateRef.current = trackerState;
  }, [trackerState]);

  async function refreshData(options = {}) {
    if (!authSession) {
      setLoading(false);
      return;
    }
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const initialLoad = !initialWorkspaceLoadedRef.current;
    setLoading(true);
    setError('');
    try {
      const {
        loadCurrentAppUserProfile,
        loadPortalTrackerData,
        loadTrackerData,
        loadTrackerStartupData,
      } = await loadTrackerDataModule();
      if (initialLoad) {
        const startup = await loadTrackerStartupData({
          projectId: getProjectIdFromLocation(),
          force: options?.force !== false,
        });
        if (requestId !== refreshRequestIdRef.current) return;
        initialWorkspaceLoadedRef.current = true;
        setTrackerState(startup.data);
        if (!startup.complete) {
          setLoading(false);
          void loadTrackerData({ force: true })
            .then((completeState) => {
              if (requestId !== refreshRequestIdRef.current) return;
              setTrackerState({ ...completeState, deferredDataStatus: 'ready' });
            })
            .catch((deferredError) => {
              if (requestId !== refreshRequestIdRef.current) return;
              setError(
                deferredError instanceof Error
                  ? `The overview loaded, but remaining workspace data did not: ${deferredError.message}`
                  : 'The overview loaded, but remaining workspace data did not finish loading.',
              );
            });
        }
        return;
      }
      const profile = await loadCurrentAppUserProfile();
      const next = ['Customer', 'Subcontractor'].includes(profile?.role)
        ? await loadPortalTrackerData({ profile, force: options?.force !== false })
        : await loadTrackerData({ force: options?.force !== false });
      if (requestId === refreshRequestIdRef.current) {
        setTrackerState({ ...next, deferredDataStatus: 'ready' });
      }
    } catch (err) {
      if (requestId === refreshRequestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load tracker data.');
      }
    } finally {
      if (requestId === refreshRequestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadTrackerDataModule()
      .then(async ({ consumeAuthSessionFromUrl, initializeAuthSession }) => {
        const recoverySession = consumeAuthSessionFromUrl();
        if (['recovery', 'invite'].includes(recoverySession?.type)) setRecoveryMode(true);
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
    if (!nativeAndroid || loading || !authSession || !activeUser?.id) return undefined;
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      void loadAndroidNotificationsModule()
        .then(({ syncAndroidNotifications }) => syncAndroidNotifications({ data: trackerStateRef.current, activeUser }))
        .catch(() => {});
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeUser, authSession, loading, nativeAndroid]);

  useEffect(() => {
    if (!nativeAndroid) return undefined;
    const listenerHandles = [];
    let cancelled = false;

    async function handleNotificationAction({ actionId, notification, extra }) {
      if (actionId === 'snooze-tomorrow') {
        const { snoozeAndroidNotification } = await loadAndroidNotificationsModule();
        await snoozeAndroidNotification(notification, activeUser?.id);
        return;
      }
      if (actionId === 'mark-done' && extra.taskId && capabilities.canEdit) {
        try {
          const { updateTask } = await loadTrackerDataModule();
          const nextState = await updateTask(trackerStateRef.current, extra.taskId, { done: true });
          trackerStateRef.current = nextState;
          setTrackerState(nextState);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : 'Unable to mark the task complete.');
        }
      }

        const requestedTab = String(extra.tab || 'projects');
        const targetTab = capabilities.allowedTabs.includes(requestedTab) ? requestedTab : 'projects';
        if (extra.projectId) setSessionProjectFilter(extra.projectId || 'all');
        if (targetTab === 'tasks' && extra.taskId) {
          setTaskHighlightRequest({ taskId: extra.taskId, token: `${Date.now()}` });
        }
        if (targetTab === 'projects' && extra.projectId && extra.projectId !== 'all') {
          setProjectNavigationTarget({
            projectId: extra.projectId,
            detailTab: extra.detailTab || '',
            selectionId: extra.selectionId || (extra.detailTab === 'selections' ? extra.entityId : ''),
            token: `${Date.now()}`,
          });
        }
        setActiveTab(targetTab);
    }

    void Promise.all([
      loadAndroidNotificationsModule()
        .then(({ addAndroidNotificationActionListener }) => addAndroidNotificationActionListener(handleNotificationAction)),
      import('./utils/androidPushNotifications.js')
        .then(({ addAndroidPushActionListener, syncAndroidPushRegistration }) =>
          Promise.all([
            addAndroidPushActionListener(handleNotificationAction),
            activeUser?.id ? syncAndroidPushRegistration({ activeUser }) : Promise.resolve(null),
          ]).then(([handle]) => handle),
        ),
    ]).then((handles) => {
      if (cancelled) handles.forEach((handle) => void handle.remove());
      else listenerHandles.push(...handles);
    }).catch(() => {});
    return () => {
      cancelled = true;
      listenerHandles.forEach((handle) => void handle.remove());
    };
  }, [activeUser, capabilities.allowedTabs, capabilities.canEdit, nativeAndroid]);
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
  const deferredDataLoading = trackerState.deferredDataStatus === 'loading';

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
    setProjectDrawerOpen(false);
  }, [activeTab, authSession]);

  useEffect(() => {
    if (!projectDrawerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setProjectDrawerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [projectDrawerOpen]);

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

  function goToHome() {
    setActiveTab('home');
    setProjectNavigationTarget(null);
    setShowAndroidNavMenu(false);
    setShowAndroidAccountMenu(false);
    setProjectDrawerOpen(false);
  }

  function openHomeItem(item) {
    if (item.type === 'project') {
      setProjectNavigationTarget({ projectId: item.id, token: `${item.id}-${Date.now()}` });
      syncProjectToLocation(item.id, { push: true });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'task') {
      if (!capabilities.allowedTabs.includes('tasks') && item.projectId) {
        setProjectNavigationTarget({ projectId: item.projectId, detailTab: 'tasks', token: `${Date.now()}` });
        setActiveTab('projects');
        return;
      }
      setSessionProjectFilter(item.projectId || 'all');
      setTaskHighlightRequest({ taskId: item.id, token: `${Date.now()}` });
      setActiveTab('tasks');
      return;
    }
    if (item.type === 'inspection') {
      setProjectNavigationTarget({ projectId: item.projectId, detailTab: 'inspections', token: `${Date.now()}` });
      setActiveTab('projects');
      return;
    }
    if (!capabilities.allowedTabs.includes('schedule') && item.projectId) {
      setProjectNavigationTarget({ projectId: item.projectId, detailTab: 'calendar', token: `${Date.now()}` });
      setActiveTab('projects');
      return;
    }
    setSessionProjectFilter(item.projectId || 'all');
    setActiveTab('schedule');
  }

  function openHomeCollection(collection) {
    if (collection === 'tasks') {
      setSessionProjectFilter('all');
      setActiveTab('tasks');
      return;
    }
    if (collection === 'schedule') {
      setSessionProjectFilter('all');
      setActiveTab('schedule');
      return;
    }
    setSessionProjectFilter('all');
    goToProjectsHome();
  }

  function openNewProjectFromRail() {
    if (activeTab === 'projects' && getProjectIdFromLocation()) {
      syncProjectToLocation('', { push: true });
    }
    setSessionProjectFilter('all');
    setActiveTab('projects');
    setProjectsHomeSignal((current) => current + 1);
    setProjectDrawerOpen(false);
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
    refreshRequestIdRef.current += 1;
    initialWorkspaceLoadedRef.current = false;
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
      deferredDataStatus: 'idle',
    }));
    setActiveTab('home');
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
    if (deferredDataLoading && activeTab !== 'projects') {
      return (
        <section className="panel native-panel workspace-page">
          <div className="empty-state compact" role="status" aria-live="polite">
            <h2>Loading workspace details</h2>
            <p>The project overview is ready. Schedule, tasks, people, and other detailed records are loading in the background.</p>
          </div>
        </section>
      );
    }
    if (activeTab === 'home') {
      return (
        <NativeHomeView
          data={trackerState}
          activeUser={activeUser}
          refresh={refreshData}
          loading={loading}
          canEdit={capabilities.canEdit}
          onStateChange={setTrackerState}
          onOpenItem={openHomeItem}
          onOpenCollection={openHomeCollection}
        />
      );
    }

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
          deferredDataLoading={deferredDataLoading}
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
      {nativeAndroid && showAndroidNotificationSettings ? (
        <div className="modal-backdrop" onClick={() => setShowAndroidNotificationSettings(false)}>
          <div className="modal-card notification-preferences-modal" role="dialog" aria-modal="true" aria-labelledby="notification-preferences-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="notification-preferences-title">Android notifications</h2>
                <p>Choose the project updates this device should show.</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setShowAndroidNotificationSettings(false)}>Close</button>
            </div>
            <Suspense fallback={<WorkspaceSplash label="Loading notification settings..." />}>
              <AndroidNotificationPreferences data={trackerState} activeUser={activeUser} />
            </Suspense>
          </div>
        </div>
      ) : null}
      {nativeAndroid || capabilities.showTabs ? (
        <section className={`workspace-shell-bar android-shell-bar material-top-app-bar${nativeAndroid ? '' : ' browser-mobile-app-bar'}`}>
          <div className="android-shell-main">
            {capabilities.showTabs ? (
              <div className="android-nav-menu-shell">
                <button
                  className="android-app-bar-icon android-nav-trigger"
                  type="button"
                  onClick={() => {
                    setShowAndroidAccountMenu(false);
                    setShowAndroidNavMenu((current) => !current);
                  }}
                  aria-expanded={showAndroidNavMenu ? 'true' : 'false'}
                  aria-label="Open navigation menu"
                >
                  <FluentIcon name="navigation" size={24} className="android-material-navigation-icon" />
                  <span className="android-nav-trigger-copy android-wide-nav-trigger-copy">
                    <span className="android-nav-trigger-label">Navigate</span>
                    <strong>{activeTabMeta?.label || 'Destiny Project Hub'}</strong>
                  </span>
                  <FluentIcon name="arrowDown" className="android-wide-navigation-arrow" />
                </button>
                {showAndroidNavMenu ? (
                  <>
                  <button className="android-nav-backdrop" type="button" onClick={() => setShowAndroidNavMenu(false)} aria-label="Close navigation menu" />
                  <div className="android-nav-menu" role="menu" aria-label="Navigation">
                    <div className="android-nav-drawer-header">
                      <strong>Destiny Project Hub</strong>
                      <button type="button" onClick={() => setShowAndroidNavMenu(false)} aria-label="Close navigation menu">×</button>
                    </div>
                    {visibleTabs.map((tab) => (
                      <button
                        key={tab.id}
                        className={`android-nav-menu-item${activeTab === tab.id ? ' active' : ''}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={activeTab === tab.id ? 'true' : 'false'}
                        onClick={() => {
                          if (tab.id === 'home') {
                            goToHome();
                          } else if (tab.id === 'projects') {
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
                  </>
                ) : null}
              </div>
            ) : null}
            <strong className={`android-shell-title android-material-title${capabilities.showTabs ? ' has-navigation' : ''}`}>{activeTabMeta?.label || 'Destiny Project Hub'}</strong>
            {sharedScopeEnabled ? (
              <label className="android-material-project-filter">
                <span className="sr-only">Project</span>
                <select value={sessionProjectFilter} onChange={(event) => setSessionProjectFilter(event.target.value)} aria-label="Project">
                  <option value="all">All projects</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="android-shell-actions">
              <button
                className="android-app-bar-icon android-account-button"
                type="button"
                onClick={() => {
                  setShowAndroidNavMenu(false);
                  setShowAndroidAccountMenu((current) => !current);
                }}
                title="Account and filter options"
                aria-label="Account and filter options"
                aria-expanded={showAndroidAccountMenu ? 'true' : 'false'}
              >
                <FluentIcon name="moreVertical" className="android-mobile-overflow-icon" />
                <span className="android-account-initial" aria-hidden="true">
                  {signedInUserName.slice(0, 1).toUpperCase()}
                </span>
              </button>
            </div>
          </div>
          {sharedScopeEnabled ? (
            <div className="workspace-scope-bar android-scope-bar android-wide-scope-bar">
              <div className="workspace-scope-meta">
                <span className="workspace-scope-label">Project scope</span>
                <strong>{sharedScopeProject?.name || 'All visible projects'}</strong>
              </div>
              <label className="task-filter workspace-scope-filter">
                <span>Current filter</span>
                <select value={sessionProjectFilter} onChange={(event) => setSessionProjectFilter(event.target.value)}>
                  <option value="all">All projects</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {showAndroidAccountMenu ? (
            <div className="android-account-menu">
              {sharedScopeEnabled ? (
                <label className="task-filter android-account-project-filter">
                  <span>Project filter</span>
                  <select value={sessionProjectFilter} onChange={(event) => setSessionProjectFilter(event.target.value)}>
                    <option value="all">All projects</option>
                    {visibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
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
                className="button secondary android-notification-settings-button"
                type="button"
                onClick={() => {
                  setShowAndroidAccountMenu(false);
                  setShowAndroidNotificationSettings(true);
                }}
              >
                Notification settings
              </button>
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

      {!nativeAndroid && !capabilities.showTabs ? (
        <section className="portal-account-bar" aria-label="Portal account">
          <div>
            <strong>{signedInUserName}</strong>
            {signedInUserEmail ? <span>{signedInUserEmail}</span> : null}
          </div>
          <button className="button secondary" type="button" onClick={() => void handleSignOut()}>
            <FluentIcon name="signOut" size={16} />Sign out
          </button>
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
        <section className="workspace-shell-bar browser-desktop-shell">
          <div className="workspace-top-strip">
            <button
              className="workspace-strip-home"
              type="button"
              onClick={goToHome}
              aria-label="Go to home"
              title="Home"
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
                    if (tab.id === 'home') {
                      goToHome();
                      return;
                    }
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
      {capabilities.showTabs && visibleProjects.length ? (
        <button
          className="button secondary mobile-project-drawer-trigger"
          type="button"
          onClick={() => setProjectDrawerOpen(true)}
          aria-controls="workspace-projects-drawer"
          aria-expanded={projectDrawerOpen}
        >
          Projects
          <span>{sharedScopeProject?.name || (railActiveProjectId ? visibleProjects.find((project) => project.id === railActiveProjectId)?.name : 'All Projects')}</span>
        </button>
      ) : null}
      {projectDrawerOpen ? (
        <button className="project-drawer-backdrop" type="button" onClick={() => setProjectDrawerOpen(false)} aria-label="Close projects drawer" />
      ) : null}
      <div className={`workspace-content-shell${capabilities.showTabs && visibleProjects.length ? ' has-project-rail' : ''}`}>
        {capabilities.showTabs && visibleProjects.length ? (
          <aside id="workspace-projects-drawer" className={`projects-rail workspace-projects-rail${projectDrawerOpen ? ' drawer-open' : ''}`}>
            <div className="projects-rail-header">
              <strong>Projects</strong>
              <span>{visibleProjects.length} jobs</span>
              <button className="project-drawer-close" type="button" onClick={() => setProjectDrawerOpen(false)} aria-label="Close projects drawer">×</button>
            </div>
            <div className="projects-rail-list" role="list" aria-label="All projects">
              <button
                className={`projects-rail-item projects-rail-all${railAllProjectsActive ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  setSessionProjectFilter('all');
                  goToProjectsHome();
                  setProjectDrawerOpen(false);
                }}
                aria-pressed={railAllProjectsActive}
                aria-current={railAllProjectsActive ? 'page' : undefined}
              >
                <span className="projects-rail-item-title">All Projects</span>
                <span className="projects-rail-item-meta">Portfolio overview</span>
              </button>
              {visibleProjects.map((project) => {
                const taskCount = railTaskCountByProject.get(project.id) || 0;
                const health = getProjectOperationalHealth(project, trackerState.tasks);
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
                      setProjectDrawerOpen(false);
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









