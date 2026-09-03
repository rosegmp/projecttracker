import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AppDialogHost, { showAppAlert, showAppConfirm } from './components/AppDialogs.jsx';
import FluentIcon from './components/FluentIcon.jsx';
import GlobalCommandPalette from './components/GlobalCommandPalette.jsx';
import { PasswordResetView, SignInView } from './components/AuthViews.jsx';
import { getVisibleProjectsForUser, getVisibleTasksForUser } from './utils/accessUi.js';
import {
  buildGlobalSearchItems,
  loadGlobalSearchRecentIds,
  recordGlobalSearchRecentId,
} from './utils/globalSearch.js';
import { getProjectOperationalHealth } from './utils/homeView.js';
import { AppErrorBoundary, WorkspaceSplash } from './components/SharedUI.jsx';
import { DEFAULT_VISIBLE_TOP_LEVEL_TABS, normalizeVisibleTopLevelTabs } from './utils/navigationTabs.js';
import { DEFAULT_VISIBLE_PROJECT_TABS, getVisibleProjectTabs } from './utils/projectTabs.js';
import { reportError } from './services/observability.js';
import {
  applyQueuedInspectionOperations,
  applyQueuedProjectPhotoOperations,
  applyQueuedTaskOperations,
  getOfflineOperations,
  getOfflineOperationSummary,
  isOfflineNetworkError,
  removeOfflineOperation,
  subscribeToOfflineOperations,
  updateOfflineOperation,
} from './services/offlineOperations.js';
import { removeOfflineAttachments } from './services/offlineAttachmentStore.js';
import { loadOfflineTrackerData } from './services/offlineProjectStore.js';
import { readWorkspaceCache, workspaceCacheMatches, writeWorkspaceCache } from './services/workspaceCache.js';
import { flushOfflineOperations } from './services/offlineSync.js';
import {
  DEFAULT_RUNTIME_STATUS,
  maintenanceDisplayMessage,
} from './services/runtimeStatus.js';
import * as trackerDataModule from './services/trackerData.js';
import { consumeDigitalApprovalToken } from './services/digitalApprovals.js';
import { consumeVendor1099RecipientToken } from './services/vendor1099Recipient.js';

function applyQueuedFieldOperations(state, operations) {
  return applyQueuedProjectPhotoOperations(
    applyQueuedTaskOperations(applyQueuedInspectionOperations(state, operations), operations),
    operations,
  );
}

const NativeProjectsView = lazy(() => import('./components/NativeProjectsView.jsx'));
const NativeHomeView = lazy(() => import('./components/NativeHomeView.jsx'));
const NativeScheduleView = lazy(() => import('./components/NativeScheduleView.jsx'));
const NativeTasksView = lazy(() => import('./components/NativeTasksView.jsx'));
const NativePeopleView = lazy(() => import('./components/NativePeopleView.jsx'));
const NativeCertificatesView = lazy(() => import('./components/NativeCertificatesView.jsx'));
const ManagementReportingView = lazy(() => import('./components/ManagementReportingView.jsx'));
const NativeSettingsView = lazy(() => import('./components/NativeSettingsView.jsx'));
const AndroidNotificationPreferences = lazy(() => import('./components/AndroidNotificationPreferences.jsx'));
const DigitalApprovalPage = lazy(() => import('./components/DigitalApprovalPage.jsx'));
const Vendor1099RecipientPage = lazy(() => import('./components/Vendor1099RecipientPage.jsx'));
const NativeFilesView = lazy(() =>
  import('./components/ProjectAssetsViews.jsx').then((module) => ({ default: module.NativeFilesView })),
);
const NativePhotosView = lazy(() =>
  import('./components/ProjectAssetsViews.jsx').then((module) => ({ default: module.NativePhotosView })),
);
import {
  addAndroidIntentListener,
  getAppRedirectUrl,
  getSearchParam,
  isNativeAndroidApp,
  readAndroidSharedPhoto,
  updateCurrentUrl,
} from './platform/platformAdapter.js';

const USER_ROLE_OPTIONS = ['Admin', 'Edit', 'Customer', 'Subcontractor', 'View Only'];
const trackerDataModulePromise = Promise.resolve(trackerDataModule);
let androidNotificationsModulePromise = null;

function loadTrackerDataModule() {
  return trackerDataModulePromise;
}

function loadAndroidNotificationsModule() {
  if (!androidNotificationsModulePromise) androidNotificationsModulePromise = import('./utils/androidNotifications.js');
  return androidNotificationsModulePromise;
}

function getStorageBannerMessage(storageMode, storageIssue = '') {
  if (storageMode === 'supabase' || storageMode === 'loading') return null;
  if (storageMode === 'workspace-cache-offline') {
    return {
      title: 'Working from the saved workspace.',
      message: storageIssue || 'Reconnect to check for updates and synchronize device-saved changes.',
    };
  }
  if (storageMode === 'offline-cache') {
    return {
      title: 'Working from an offline project copy.',
      message: storageIssue || 'Reconnect to refresh project information and synchronize device-saved changes.',
    };
  }
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
    id: 'certificates',
    label: 'Compliance',
    description: 'Track subcontractor insurance, agreements, tax documents, and renewal history.',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Portfolio schedule, financial, approval, and closeout reporting.',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Controls that shape date calculations, calendar visibility, and page-level display helpers.',
  },
];

const SESSION_PROJECT_FILTER_KEY = 'cx_session_project_filter';
const EMPTY_WORKFLOW_SEARCH_RECORDS = {
  dailyLogs: [],
  rfis: [],
  submittals: [],
  warrantyItems: [],
  closeoutItems: [],
};
const WORKFLOW_SEARCH_CACHE_TTL_MS = 60_000;
const LAST_ACTIVE_TAB_KEY = 'cx_last_active_tab';
const PROJECT_SCOPED_TAB_IDS = new Set(['schedule', 'calendar', 'tasks']);
const validTabIds = new Set(tabs.map((tab) => tab.id));
const NON_EDITOR_TAB_IDS = ['home', 'projects', 'calendar', 'certificates'];

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
        ? tabs.filter((tab) => !['settings', 'reports'].includes(tab.id)).map((tab) => tab.id)
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

function getTaskIdFromLocation() {
  return String(getSearchParam('task') || '').trim();
}

function syncTabToLocation(tab, { push = false } = {}) {
  if (!validTabIds.has(tab)) return;
  updateCurrentUrl((url) => {
    url.searchParams.set('tab', tab);
    if (tab !== 'projects') {
      url.searchParams.delete('project');
      url.searchParams.delete('projectTab');
    }
    if (tab !== 'projects' && tab !== 'tasks') url.searchParams.delete('task');
  }, { push });
}

function syncProjectToLocation(projectId, { push = false } = {}) {
  updateCurrentUrl((url) => {
    const normalizedProjectId = String(projectId || '').trim();
    const currentProjectId = String(url.searchParams.get('project') || '').trim();
    if (normalizedProjectId) url.searchParams.set('project', normalizedProjectId);
    else url.searchParams.delete('project');
    if (!normalizedProjectId || normalizedProjectId !== currentProjectId) {
      url.searchParams.delete('projectTab');
      url.searchParams.delete('task');
    }
  }, { push });
}


export default function App() {
  const nativeAndroid = isNativeAndroidApp();
  const [digitalApprovalToken] = useState(() => consumeDigitalApprovalToken());
  const [vendor1099RecipientToken] = useState(() => consumeVendor1099RecipientToken());
  const [activeTab, setActiveTab] = useState(() => nativeAndroid ? 'home' : getTabFromLocation());
  const [projectsHomeSignal, setProjectsHomeSignal] = useState(0);
  const [projectNavigationTarget, setProjectNavigationTarget] = useState(null);
  const [certificateNavigationTarget, setCertificateNavigationTarget] = useState(null);
  const [peopleNavigationTarget, setPeopleNavigationTarget] = useState(null);
  const [scheduleNavigationTarget, setScheduleNavigationTarget] = useState(null);
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
      visibleTopLevelTabs: DEFAULT_VISIBLE_TOP_LEVEL_TABS,
      visibleProjectTabs: DEFAULT_VISIBLE_PROJECT_TABS,
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
  const [offlineSyncSummary, setOfflineSyncSummary] = useState({ total: 0, pending: 0, syncing: 0, needsAttention: 0 });
  const [showOfflineReview, setShowOfflineReview] = useState(false);
  const [offlineReviewTargetId, setOfflineReviewTargetId] = useState('');
  const [offlineReviewBusyId, setOfflineReviewBusyId] = useState('');
  const offlineReviewItemRefs = useRef({});
  const [runtimeStatus, setRuntimeStatus] = useState(DEFAULT_RUNTIME_STATUS);
  const [showAndroidNavMenu, setShowAndroidNavMenu] = useState(false);
  const [showAndroidAccountMenu, setShowAndroidAccountMenu] = useState(false);
  const [showAndroidNotificationSettings, setShowAndroidNotificationSettings] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [recentSearchItemIds, setRecentSearchItemIds] = useState([]);
  const [workflowSearchData, setWorkflowSearchData] = useState({
    scopeKey: '',
    status: 'idle',
    records: EMPTY_WORKFLOW_SEARCH_RECORDS,
  });
  const workflowSearchCacheRef = useRef(new Map());
  const [taskHighlightRequest, setTaskHighlightRequest] = useState({ taskId: '', token: '' });
  const [androidPendingAction, setAndroidPendingAction] = useState(null);
  const [androidProjectPrompt, setAndroidProjectPrompt] = useState(null);
  const [androidTaskCreateRequest, setAndroidTaskCreateRequest] = useState(null);
  const [sessionProjectFilter, setSessionProjectFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return window.sessionStorage.getItem(SESSION_PROJECT_FILTER_KEY) || 'all';
  });
  const trackerStateRef = useRef(trackerState);
  const previousActiveTabRef = useRef(activeTab);
  const handlingPopStateRef = useRef(false);
  const initialWorkspaceLoadedRef = useRef(false);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    trackerStateRef.current = trackerState;
  }, [trackerState]);

  useEffect(() => {
    if (!nativeAndroid) return undefined;
    let cancelled = false;
    let handle = null;
    void addAndroidIntentListener((action) => {
      if (!cancelled && action?.type) setAndroidPendingAction(action);
    }).then((nextHandle) => {
      if (cancelled) void nextHandle.remove();
      else handle = nextHandle;
    }).catch((intentError) => {
      reportError(intentError, { operation: 'android.intent.listen' });
    });
    return () => {
      cancelled = true;
      if (handle) void handle.remove();
    };
  }, [nativeAndroid]);

  async function refreshData(options = {}) {
    if (!authSession) {
      setLoading(false);
      return;
    }
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const initialLoad = !initialWorkspaceLoadedRef.current;
    let quickCache = null;
    setLoading(true);
    setError('');
    try {
      if (initialLoad && options?.force !== true) {
        quickCache = await readWorkspaceCache(authSession?.user?.id).catch((cacheError) => {
          reportError(cacheError, { operation: 'workspace.cache.read', workspace: activeTab });
          return null;
        });
        if (quickCache?.state) {
          setTrackerState(applyQueuedFieldOperations({
            ...quickCache.state,
            storageMode: 'loading',
            storageIssue: '',
            deferredDataStatus: 'ready',
            workspaceCache: { status: 'checking', savedAt: quickCache.savedAt },
          }, getOfflineOperations(authSession?.user?.id)));
          setLoading(false);
        }
      }
      const {
        loadCurrentAppUserProfile,
        loadPortalTrackerData,
        loadWorkspaceCacheManifest,
        loadTrackerData,
        loadTrackerStartupData,
      } = await loadTrackerDataModule();
      if (initialLoad) {
        if (quickCache?.state) {
          let manifest = null;
          try {
            manifest = await loadWorkspaceCacheManifest();
          } catch (manifestError) {
            if (isOfflineNetworkError(manifestError)) {
              if (requestId !== refreshRequestIdRef.current) return;
              initialWorkspaceLoadedRef.current = true;
              setTrackerState(applyQueuedFieldOperations({
                ...quickCache.state,
                storageMode: 'workspace-cache-offline',
                storageIssue: 'No connection. Showing the last complete workspace saved on this device.',
                deferredDataStatus: 'ready',
                workspaceCache: { status: 'offline', savedAt: quickCache.savedAt },
              }, getOfflineOperations(authSession?.user?.id)));
              return;
            }
          }

          if (manifest && workspaceCacheMatches(quickCache, manifest)) {
            if (requestId !== refreshRequestIdRef.current) return;
            initialWorkspaceLoadedRef.current = true;
            setTrackerState(applyQueuedFieldOperations({
              ...quickCache.state,
              storageMode: 'supabase',
              storageIssue: '',
              deferredDataStatus: 'ready',
              workspaceCache: { status: 'fresh', savedAt: quickCache.savedAt },
            }, getOfflineOperations(authSession?.user?.id)));
            return;
          }

          if (requestId !== refreshRequestIdRef.current) return;
          setTrackerState((current) => ({
            ...current,
            storageMode: 'loading',
            workspaceCache: { status: 'updating', savedAt: quickCache.savedAt },
          }));
          const profile = !manifest || manifest.mode === 'portal' ? await loadCurrentAppUserProfile() : null;
          const portalMode = manifest?.mode === 'portal' || ['Customer', 'Subcontractor'].includes(profile?.role);
          const completeState = portalMode
            ? await loadPortalTrackerData({ profile, force: true })
            : await loadTrackerData({ force: true });
          if (requestId !== refreshRequestIdRef.current) return;
          initialWorkspaceLoadedRef.current = true;
          const nextState = applyQueuedFieldOperations(
            { ...completeState, deferredDataStatus: 'ready', workspaceCache: { status: 'fresh', savedAt: new Date().toISOString() } },
            getOfflineOperations(authSession?.user?.id),
          );
          setTrackerState(nextState);
          if (manifest) {
            void writeWorkspaceCache({
              userId: authSession?.user?.id,
              state: completeState,
              manifestToken: manifest.token,
            }).catch((cacheError) => reportError(cacheError, { operation: 'workspace.cache.write', workspace: activeTab }));
          }
          return;
        }

        const startup = await loadTrackerStartupData({
          projectId: getProjectIdFromLocation(),
          force: options?.force !== false,
        });
        if (requestId !== refreshRequestIdRef.current) return;
        initialWorkspaceLoadedRef.current = true;
        setTrackerState(applyQueuedFieldOperations(
          startup.data,
          getOfflineOperations(authSession?.user?.id),
        ));
        if (startup.complete) {
          void loadWorkspaceCacheManifest()
            .then((manifest) => writeWorkspaceCache({
              userId: authSession?.user?.id,
              state: startup.data,
              manifestToken: manifest.token,
            }))
            .catch((cacheError) => reportError(cacheError, { operation: 'workspace.cache.write', workspace: activeTab }));
        } else {
          setLoading(false);
          void loadTrackerData({ force: true })
            .then((completeState) => {
              if (requestId !== refreshRequestIdRef.current) return;
              setTrackerState(applyQueuedFieldOperations(
                { ...completeState, deferredDataStatus: 'ready' },
                getOfflineOperations(authSession?.user?.id),
              ));
              void loadWorkspaceCacheManifest()
                .then((manifest) => writeWorkspaceCache({
                  userId: authSession?.user?.id,
                  state: completeState,
                  manifestToken: manifest.token,
                }))
                .catch((cacheError) => reportError(cacheError, { operation: 'workspace.cache.write', workspace: activeTab }));
            })
            .catch((deferredError) => {
              if (requestId !== refreshRequestIdRef.current) return;
              reportError(deferredError, { operation: 'startup.hydrate', workspace: activeTab });
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
        const nextState = applyQueuedFieldOperations(
          { ...next, deferredDataStatus: 'ready' },
          getOfflineOperations(authSession?.user?.id),
        );
        setTrackerState(nextState);
        void loadWorkspaceCacheManifest()
          .then((manifest) => writeWorkspaceCache({
            userId: authSession?.user?.id,
            state: next,
            manifestToken: manifest.token,
          }))
          .catch((cacheError) => reportError(cacheError, { operation: 'workspace.cache.write', workspace: activeTab }));
      }
    } catch (err) {
      if (requestId === refreshRequestIdRef.current) {
        if (initialLoad && isOfflineNetworkError(err)) {
          try {
            const cachedState = await loadOfflineTrackerData(
              authSession?.user?.id,
              getProjectIdFromLocation(),
            );
            if (cachedState && requestId === refreshRequestIdRef.current) {
              initialWorkspaceLoadedRef.current = true;
              setTrackerState(applyQueuedFieldOperations(
                cachedState,
                getOfflineOperations(authSession?.user?.id),
              ));
              setError('');
              return;
            }
          } catch (cacheError) {
            reportError(cacheError, { operation: 'offline.project.load', workspace: activeTab });
          }
        }
        reportError(err, { operation: 'startup.bootstrap', workspace: activeTab });
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
          reportError(err, { operation: 'auth.startup' });
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
    if (!authSession?.user?.id) {
      setRuntimeStatus(DEFAULT_RUNTIME_STATUS);
      return undefined;
    }
    let cancelled = false;
    const refreshRuntimeStatus = () => {
      void loadTrackerDataModule()
        .then(({ loadAppRuntimeStatus }) => loadAppRuntimeStatus())
        .then((status) => {
          if (!cancelled) setRuntimeStatus(status);
        })
        .catch((statusError) => {
          reportError(statusError, { operation: 'runtime.status' });
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshRuntimeStatus();
    };
    refreshRuntimeStatus();
    const intervalId = window.setInterval(refreshRuntimeStatus, 30_000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authSession?.user?.id]);

  useEffect(() => {
    const userId = String(authSession?.user?.id || '').trim();
    if (!userId) {
      setOfflineSyncSummary({ total: 0, pending: 0, syncing: 0, needsAttention: 0 });
      return undefined;
    }
    const updateSummary = () => {
      const operations = getOfflineOperations(userId);
      setOfflineSyncSummary(getOfflineOperationSummary(userId));
      if (operations.length) setTrackerState((current) => applyQueuedFieldOperations(current, operations));
    };
    const syncNow = () => {
      updateSummary();
      if (runtimeStatus.writesFrozen) return;
      void flushOfflineOperations(userId)
        .then((result) => {
          updateSummary();
          if (result.synced > 0) void refreshData({ force: true });
        })
        .catch((syncError) => {
          reportError(syncError, { operation: 'offline.sync' });
          updateSummary();
        });
    };
    updateSummary();
    const unsubscribe = subscribeToOfflineOperations(userId, updateSummary);
    window.addEventListener('online', syncNow);
    if (navigator.onLine !== false) syncNow();
    return () => {
      unsubscribe();
      window.removeEventListener('online', syncNow);
    };
  }, [authSession?.user?.id, runtimeStatus.writesFrozen]);

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    const shouldPushHistory =
      isNativeAndroidApp() &&
      !handlingPopStateRef.current &&
      previousTab !== activeTab;
    syncTabToLocation(activeTab, { push: shouldPushHistory });
    if (typeof window !== 'undefined' && validTabIds.has(activeTab)) {
      try {
        window.localStorage.setItem(LAST_ACTIVE_TAB_KEY, activeTab);
      } catch {
        // Ignore storage issues and keep navigation working.
      }
    }
    previousActiveTabRef.current = activeTab;
    handlingPopStateRef.current = false;
  }, [activeTab]);

  useEffect(() => {
    function handlePopState() {
      const nextTab = getTabFromLocation();
      if (nextTab === previousActiveTabRef.current) return;
      handlingPopStateRef.current = true;
      setActiveTab(nextTab);
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
  const capabilities = useMemo(() => {
    const base = getUserCapabilities(activeUser?.role);
    const configuredTabs = new Set(normalizeVisibleTopLevelTabs(trackerState.settings?.visibleTopLevelTabs));
    const cacheCheckComplete = trackerState.storageMode !== 'loading';
    return {
      ...base,
      canEdit: base.canEdit && !runtimeStatus.writesFrozen && cacheCheckComplete,
      canManageUsers: base.canManageUsers && !runtimeStatus.writesFrozen && cacheCheckComplete,
      canAccessSettings: base.canAccessSettings && !runtimeStatus.writesFrozen && cacheCheckComplete,
      allowedTabs: base.allowedTabs.filter((tabId) => configuredTabs.has(tabId)),
    };
  }, [activeUser?.role, runtimeStatus.writesFrozen, trackerState.settings?.visibleTopLevelTabs, trackerState.storageMode]);

  useEffect(() => {
    if (loading || activeTab !== 'tasks') return;
    const taskId = getTaskIdFromLocation();
    if (!taskId) return;
    const linkedTask = (trackerState.tasks || []).find((task) => task.id === taskId);
    if (!linkedTask) return;
    setSessionProjectFilter(linkedTask.projectId || 'all');
    setTaskHighlightRequest({ taskId, token: `deep-link-${taskId}` });
  }, [activeTab, loading, trackerState.tasks]);

  const offlineReviewOperations = getOfflineOperations(String(authSession?.user?.id || ''));

  useEffect(() => {
    if (!showOfflineReview || !offlineReviewTargetId) return undefined;
    const scrollTimer = window.setTimeout(() => {
      offlineReviewItemRefs.current[offlineReviewTargetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    const clearTimer = window.setTimeout(() => setOfflineReviewTargetId(''), 2400);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [offlineReviewTargetId, showOfflineReview]);

  function offlineOperationLabel(operation) {
    const projectName = trackerState.projects.find((project) => project.id === operation.projectId)?.name || 'Project';
    const record = operation.payload || {};
    const recordName = operation.kind === 'project-photo.upload'
      ? record.name || record.originalName || 'Project photo'
      : operation.kind === 'daily-log.save'
      ? record.date || record.title || 'Daily log'
      : operation.kind === 'task.save'
        ? record.label || 'Task'
        : operation.kind === 'warranty-item.save'
          ? record.number || record.title || 'Warranty item'
          : record.subcode || record.inspectionType || 'Inspection';
    const deviceSummary = operation.kind === 'project-photo.upload'
      ? [record.type, record.size ? `${Math.max(1, Math.round(Number(record.size) / 1024))} KB` : ''].filter(Boolean).join(' · ')
      : operation.kind === 'daily-log.save'
      ? [record.weather, record.notes, record.delays, record.issues].find((value) => String(value || '').trim())
      : operation.kind === 'task.save'
        ? [record.done ? 'Done' : 'Open', record.due, ...(record.assignees || [])].filter((value) => String(value || '').trim()).join(' · ')
        : operation.kind === 'warranty-item.save'
          ? [record.title, record.status, record.dueDate, record.responsibleName].filter((value) => String(value || '').trim()).join(' · ')
          : [record.status, record.date, record.notes].filter((value) => String(value || '').trim()).join(' · ');
    return { projectName, recordName, deviceSummary: String(deviceSummary || '').trim().slice(0, 240) };
  }

  async function retryOfflineReviewOperation(operation) {
    const userId = String(authSession?.user?.id || '');
    if (!userId || !operation?.id || runtimeStatus.writesFrozen) return;
    setOfflineReviewBusyId(operation.id);
    try {
      updateOfflineOperation(userId, operation.id, { status: 'pending', lastError: '' });
      const result = await flushOfflineOperations(userId);
      if (result.synced > 0) await refreshData({ force: true });
    } finally {
      setOfflineReviewBusyId('');
    }
  }

  async function discardOfflineReviewOperation(operation) {
    const userId = String(authSession?.user?.id || '');
    if (!userId || !operation?.id) return;
    const { recordName } = offlineOperationLabel(operation);
    const confirmed = await showAppConfirm(`Discard the device-saved ${operation.action === 'delete' ? 'delete for' : 'changes to'} ${recordName}?`, {
      title: 'Discard device copy', confirmLabel: 'Discard', tone: 'danger',
    });
    if (!confirmed) return;
    setOfflineReviewBusyId(operation.id);
    try {
      if (operation.kind === 'project-photo.upload' && operation.payload?.storagePath) {
        try {
          await trackerDataModule.deleteProjectFileFromStorage(operation.payload);
        } catch (error) {
          await showAppAlert(error instanceof Error ? error.message : 'The uploaded photo could not be removed.', 'Discard failed');
          return;
        }
      }
      await removeOfflineAttachments(operation.id);
      removeOfflineOperation(userId, operation.id);
      await refreshData({ force: true });
    } finally {
      setOfflineReviewBusyId('');
    }
  }

  useEffect(() => {
    if (!nativeAndroid || loading || !authSession || !activeUser?.id || runtimeStatus.writesFrozen) return;
    void loadAndroidNotificationsModule()
      .then(({ syncAndroidNotifications }) => syncAndroidNotifications({ data: trackerState, activeUser }))
      .catch((notificationError) => {
        reportError(notificationError, { operation: 'notification.sync', workspace: activeTab });
      });
  }, [activeTab, activeUser, authSession, loading, nativeAndroid, runtimeStatus.writesFrozen, trackerState.projects, trackerState.settings, trackerState.tasks]);

  useEffect(() => {
    if (!nativeAndroid || loading || !authSession || !activeUser?.id || runtimeStatus.writesFrozen) return undefined;
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      void loadAndroidNotificationsModule()
        .then(({ syncAndroidNotifications }) => syncAndroidNotifications({ data: trackerStateRef.current, activeUser }))
        .catch((notificationError) => {
          reportError(notificationError, { operation: 'notification.sync', workspace: activeTab });
        });
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeTab, activeUser, authSession, loading, nativeAndroid, runtimeStatus.writesFrozen]);

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
          reportError(actionError, { operation: 'notification.task.update', workspace: 'tasks' });
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
    }).catch((notificationError) => {
      reportError(notificationError, { operation: 'notification.registration', workspace: activeTab });
    });
    return () => {
      cancelled = true;
      listenerHandles.forEach((handle) => void handle.remove());
    };
  }, [activeTab, activeUser, capabilities.allowedTabs, capabilities.canEdit, nativeAndroid]);
  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(trackerState.projects, trackerState.settings, activeUser),
    [trackerState.projects, trackerState.settings, activeUser],
  );
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);

  useEffect(() => {
    if (!androidPendingAction || authLoading || loading || !authSession || !activeUser?.id) return;
    const action = androidPendingAction;
    setAndroidPendingAction(null);

    if (action.type === 'error') {
      void showAppAlert(action.message || 'Android could not complete that action.', 'Android action failed');
      return;
    }
    if (!capabilities.canEdit) {
      void showAppAlert('Your account does not have permission to add field records or project photos.', 'Action unavailable');
      return;
    }
    if (action.type === 'create-task') {
      if (!capabilities.allowedTabs.includes('tasks')) {
        void showAppAlert('The Tasks workspace is hidden by the administrator.', 'Task shortcut unavailable');
        return;
      }
      setSessionProjectFilter('all');
      setAndroidTaskCreateRequest({ token: String(action.token || Date.now()) });
      setActiveTab('tasks');
      return;
    }
    if (!['create-inspection', 'create-daily-log', 'share-photo'].includes(action.type)) return;
    const requiredProjectTab = action.type === 'create-inspection'
      ? 'inspections'
      : action.type === 'create-daily-log'
        ? 'daily-logs'
        : 'photos';
    const allowedProjectTabs = new Set(getVisibleProjectTabs(
      trackerState.settings?.visibleProjectTabs,
      activeUser?.role,
    ).map((tab) => tab.id));
    if (!allowedProjectTabs.has(requiredProjectTab)) {
      void showAppAlert('That project workspace is hidden by the administrator.', 'Quick action unavailable');
      return;
    }
    if (!visibleProjects.length) {
      void showAppAlert('No editable project is available for this action.', 'Project required');
      return;
    }

    void (async () => {
      try {
        const file = action.type === 'share-photo' ? await readAndroidSharedPhoto(action) : null;
        const locationProjectId = getProjectIdFromLocation();
        const preferredProjectId = visibleProjects.some((project) => project.id === locationProjectId)
          ? locationProjectId
          : visibleProjects.some((project) => project.id === sessionProjectFilter)
            ? sessionProjectFilter
            : visibleProjects[0].id;
        setAndroidProjectPrompt({
          type: action.type,
          file,
          projectId: preferredProjectId,
          token: String(action.token || Date.now()),
        });
      } catch (intentError) {
        reportError(intentError, { operation: 'android.intent.import' });
        await showAppAlert(intentError instanceof Error ? intentError.message : 'Unable to import the shared photo.', 'Import failed');
      }
    })();
  }, [
    activeUser?.id,
    androidPendingAction,
    authLoading,
    authSession,
    capabilities.allowedTabs,
    capabilities.canEdit,
    loading,
    sessionProjectFilter,
    trackerState.settings?.visibleProjectTabs,
    visibleProjects,
  ]);

  function continueAndroidProjectAction() {
    if (!androidProjectPrompt?.projectId) return;
    const detailTab = androidProjectPrompt.type === 'create-inspection'
      ? 'inspections'
      : androidProjectPrompt.type === 'create-daily-log'
        ? 'daily-logs'
        : 'photos';
    setProjectNavigationTarget({
      projectId: androidProjectPrompt.projectId,
      detailTab,
      detailAction: androidProjectPrompt.type,
      sharedPhoto: androidProjectPrompt.file || null,
      token: androidProjectPrompt.token,
    });
    setAndroidProjectPrompt(null);
    setActiveTab('projects');
  }
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
  const visibleProjectTabIds = useMemo(
    () => new Set(getVisibleProjectTabs(trackerState.settings?.visibleProjectTabs, activeUser?.role).map((tab) => tab.id)),
    [activeUser?.role, trackerState.settings?.visibleProjectTabs],
  );
  const workflowSearchScopeKey = useMemo(() => [
    activeUser?.id || '',
    visibleProjects.map((project) => project.id).sort().join(','),
    ['daily-logs', 'rfis-submittals', 'warranty-closeout'].filter((tabId) => visibleProjectTabIds.has(tabId)).join(','),
  ].join('|'), [activeUser?.id, visibleProjectTabIds, visibleProjects]);
  const activeWorkflowSearchRecords = workflowSearchData.scopeKey === workflowSearchScopeKey
    ? workflowSearchData.records
    : EMPTY_WORKFLOW_SEARCH_RECORDS;
  const globalSearchItems = useMemo(() => buildGlobalSearchItems({
    projects: visibleProjects,
    tasks: getVisibleTasksForUser(trackerState.tasks, trackerState.settings, visibleProjects),
    subs: trackerState.subs,
    employees: trackerState.employees,
    includeTasks: capabilities.allowedTabs.includes('tasks'),
    includePeople: capabilities.allowedTabs.includes('people'),
    includeCertificates: capabilities.allowedTabs.includes('certificates'),
    includeSchedule: capabilities.allowedTabs.includes('schedule'),
    includeInspections: visibleProjectTabIds.has('inspections'),
    includeSelections: visibleProjectTabIds.has('selections'),
    includeFiles: visibleProjectTabIds.has('files'),
    ...activeWorkflowSearchRecords,
  }), [activeWorkflowSearchRecords, capabilities.allowedTabs, trackerState.employees, trackerState.settings, trackerState.subs, trackerState.tasks, visibleProjectTabIds, visibleProjects]);
  const globalSearchCommands = useMemo(() => {
    const commands = visibleTabs.map((tab) => ({
      id: `command:open-${tab.id}`,
      type: 'command',
      command: 'open-tab',
      tabId: tab.id,
      label: `Open ${tab.label}`,
      meta: tab.description,
      keywords: [tab.label, tab.description, 'workspace', 'go'],
      icon: tab.id === 'projects' ? 'folder' : 'play',
    }));
    if (capabilities.canEdit && capabilities.allowedTabs.includes('tasks')) {
      commands.unshift({
        id: 'command:create-task',
        type: 'command',
        command: 'create-task',
        label: 'Create task',
        meta: 'Open a new task in the Tasks workspace',
        keywords: ['add task', 'new task', 'quick action'],
        icon: 'add',
      });
    }
    if (capabilities.canEdit && visibleProjects.length && visibleProjectTabIds.has('daily-logs')) {
      commands.unshift({
        id: 'command:create-daily-log',
        type: 'command',
        command: 'create-project-record',
        actionType: 'create-daily-log',
        label: 'Start daily log',
        meta: 'Choose a project and open a new daily log',
        keywords: ['add daily log', 'new daily log', 'site log', 'quick action'],
        icon: 'add',
      });
    }
    if (capabilities.canEdit && visibleProjects.length && visibleProjectTabIds.has('inspections')) {
      commands.unshift({
        id: 'command:create-inspection',
        type: 'command',
        command: 'create-project-record',
        actionType: 'create-inspection',
        label: 'Add inspection',
        meta: 'Choose a project and open a new inspection',
        keywords: ['create inspection', 'new inspection', 'quick action'],
        icon: 'add',
      });
    }
    return commands;
  }, [capabilities.allowedTabs, capabilities.canEdit, visibleProjectTabIds, visibleProjects.length, visibleTabs]);
  const globalSearchRecentItems = useMemo(() => {
    const availableItems = new Map([...globalSearchItems, ...globalSearchCommands].map((item) => [item.id, item]));
    return recentSearchItemIds.map((id) => availableItems.get(id)).filter(Boolean);
  }, [globalSearchCommands, globalSearchItems, recentSearchItemIds]);
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
    if (!activeUser) return;
    if (!capabilities.allowedTabs.includes(activeTab)) {
      setActiveTab(capabilities.allowedTabs[0] || 'projects');
    }
  }, [activeTab, activeUser, capabilities.allowedTabs]);

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

  useEffect(() => {
    if (!capabilities.showTabs) return undefined;
    const openGlobalSearch = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setShowGlobalSearch(true);
    };
    window.addEventListener('keydown', openGlobalSearch);
    return () => window.removeEventListener('keydown', openGlobalSearch);
  }, [capabilities.showTabs]);

  useEffect(() => {
    setRecentSearchItemIds(loadGlobalSearchRecentIds(activeUser?.id));
  }, [activeUser?.id]);

  useEffect(() => {
    if (!showGlobalSearch || !activeUser?.id) return undefined;
    const enabledTypes = [
      ...(visibleProjectTabIds.has('daily-logs') ? ['dailyLogs'] : []),
      ...(visibleProjectTabIds.has('rfis-submittals') ? ['rfis', 'submittals'] : []),
      ...(visibleProjectTabIds.has('warranty-closeout') ? ['warrantyItems', 'closeoutItems'] : []),
    ];
    const projectIds = visibleProjects.map((project) => project.id);
    let cancelled = false;
    const cached = workflowSearchCacheRef.current.get(workflowSearchScopeKey);
    if (cached && Date.now() - cached.loadedAt < WORKFLOW_SEARCH_CACHE_TTL_MS) {
      setWorkflowSearchData({ scopeKey: workflowSearchScopeKey, status: 'ready', records: cached.records });
      return () => { cancelled = true; };
    }
    setWorkflowSearchData({ scopeKey: workflowSearchScopeKey, status: enabledTypes.length && projectIds.length ? 'loading' : 'ready', records: EMPTY_WORKFLOW_SEARCH_RECORDS });
    if (!enabledTypes.length || !projectIds.length) return () => { cancelled = true; };

    void import('./services/workflowSearch.js')
      .then(async ({ loadWorkflowSearchItemsForProjects }) => {
        const results = await Promise.allSettled(enabledTypes.map((type) => loadWorkflowSearchItemsForProjects(type, projectIds)));
        if (cancelled) return;
        const records = { ...EMPTY_WORKFLOW_SEARCH_RECORDS };
        let unavailable = false;
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') records[enabledTypes[index]] = result.value;
          else {
            unavailable = true;
            reportError(result.reason, { operation: 'global-search.workflow-load', workflowType: enabledTypes[index] });
          }
        });
        if (!unavailable) {
          workflowSearchCacheRef.current.set(workflowSearchScopeKey, { loadedAt: Date.now(), records });
          while (workflowSearchCacheRef.current.size > 8) {
            workflowSearchCacheRef.current.delete(workflowSearchCacheRef.current.keys().next().value);
          }
        }
        setWorkflowSearchData({ scopeKey: workflowSearchScopeKey, status: unavailable ? 'partial' : 'ready', records });
      })
      .catch((loadError) => {
        if (cancelled) return;
        reportError(loadError, { operation: 'global-search.workflow-module-load' });
        setWorkflowSearchData({ scopeKey: workflowSearchScopeKey, status: 'partial', records: EMPTY_WORKFLOW_SEARCH_RECORDS });
      });
    return () => { cancelled = true; };
  }, [activeUser?.id, showGlobalSearch, workflowSearchScopeKey]);

  useEffect(() => {
    if (!activeUser?.id || !capabilities.showTabs) return;
    const recentId = activeTab === 'projects' && railSelectedProjectId
      ? `project:${railSelectedProjectId}`
      : `command:open-${activeTab}`;
    setRecentSearchItemIds(recordGlobalSearchRecentId(activeUser.id, recentId));
  }, [activeTab, activeUser?.id, capabilities.showTabs, projectNavigationTarget?.token, railSelectedProjectId]);

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

  function handleGlobalSearchSelect(item) {
    if (item.type !== 'command' || item.command === 'open-tab') {
      const recentUserId = activeUser?.id;
      setRecentSearchItemIds(recordGlobalSearchRecentId(recentUserId, item.id));
      if (item.type !== 'command') {
        window.setTimeout(() => {
          setRecentSearchItemIds(recordGlobalSearchRecentId(recentUserId, item.id));
        }, 0);
      }
    }
    if (item.type === 'command' && item.command === 'create-task') {
      setSessionProjectFilter('all');
      setAndroidTaskCreateRequest({ token: `global-search-${Date.now()}` });
      setActiveTab('tasks');
      return;
    }
    if (item.type === 'command' && item.command === 'create-project-record') {
      const locationProjectId = getProjectIdFromLocation();
      const preferredProjectId = visibleProjects.some((project) => project.id === locationProjectId)
        ? locationProjectId
        : visibleProjects.some((project) => project.id === sessionProjectFilter)
          ? sessionProjectFilter
          : visibleProjects[0]?.id || '';
      if (!preferredProjectId) return;
      setAndroidProjectPrompt({
        type: item.actionType,
        projectId: preferredProjectId,
        token: `global-search-${Date.now()}`,
      });
      return;
    }
    if (item.type === 'command' && item.command === 'open-tab') {
      if (item.tabId === 'home') goToHome();
      else if (item.tabId === 'projects') goToProjectsHome();
      else setActiveTab(item.tabId);
      return;
    }
    if (item.type === 'project') {
      setProjectNavigationTarget({ projectId: item.projectId, token: `global-search-${Date.now()}` });
      syncProjectToLocation(item.projectId, { push: true });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'task') {
      setSessionProjectFilter(item.projectId || 'all');
      setTaskHighlightRequest({ taskId: item.taskId, token: `global-search-${Date.now()}` });
      setActiveTab('tasks');
      return;
    }
    if (item.type === 'person') {
      setPeopleNavigationTarget({ personType: item.personType, query: item.query, token: `global-search-${Date.now()}` });
      setActiveTab('people');
      return;
    }
    if (item.type === 'certificate') {
      setCertificateNavigationTarget({ subcontractorId: item.subcontractorId, statusId: 'all', token: `global-search-${Date.now()}` });
      setActiveTab('certificates');
      return;
    }
    if (item.type === 'schedule-step') {
      setSessionProjectFilter(item.projectId);
      setScheduleNavigationTarget({ projectId: item.projectId, stepId: item.stepId, query: item.query || item.label, token: `global-search-${Date.now()}` });
      setActiveTab('schedule');
      return;
    }
    if (item.type === 'inspection') {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'inspections',
        inspectionId: item.inspectionId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'selection') {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'selections',
        selectionId: item.selectionId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'file') {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'files',
        folderId: item.folderId,
        fileId: item.fileId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'daily-log') {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'daily-logs',
        workflowType: 'dailyLogs',
        workflowItemId: item.workflowItemId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (['rfi', 'submittal'].includes(item.type)) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'rfis-submittals',
        workflowType: item.type === 'rfi' ? 'rfis' : 'submittals',
        workflowItemId: item.workflowItemId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (['warranty', 'closeout'].includes(item.type)) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'warranty-closeout',
        workflowType: item.type === 'warranty' ? 'warrantyItems' : 'closeoutItems',
        workflowItemId: item.workflowItemId,
        token: `global-search-${Date.now()}`,
      });
      setActiveTab('projects');
    }
  }

  function openHomeItem(item) {
    if (item.type === 'offline-sync') {
      setOfflineReviewTargetId(item.id);
      setShowOfflineReview(true);
      return;
    }
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
    if (item.type === 'certificate' && capabilities.allowedTabs.includes('certificates')) {
      setCertificateNavigationTarget({
        subcontractorId: item.subcontractorId,
        statusId: item.statusId,
        token: `${Date.now()}`,
      });
      setActiveTab('certificates');
      return;
    }
    if (item.type === 'selection' && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'selections',
        selectionId: item.id,
        token: `${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'portal' && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'portal',
        portalItemId: item.id,
        token: `${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (['rfi', 'submittal'].includes(item.type) && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'rfis-submittals',
        workflowType: item.type === 'rfi' ? 'rfis' : 'submittals',
        workflowItemId: item.id,
        token: `${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (item.type === 'change-order' && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'change-orders',
        workflowType: 'changeOrders',
        workflowItemId: item.id,
        token: `${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (['budget', 'commitment', 'budget-summary'].includes(item.type) && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'budget-commitments',
        workflowType: item.type === 'commitment' ? 'commitments' : 'budgetItems',
        workflowItemId: item.type === 'budget-summary' ? '' : item.id,
        token: `${Date.now()}`,
      });
      setActiveTab('projects');
      return;
    }
    if (['warranty', 'closeout'].includes(item.type) && item.projectId) {
      setProjectNavigationTarget({
        projectId: item.projectId,
        detailTab: 'warranty-closeout',
        workflowType: item.type === 'warranty' ? 'warrantyItems' : 'closeoutItems',
        workflowItemId: item.id,
        token: `${Date.now()}`,
      });
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

  function openHomeQuickAction(actionType) {
    if (!capabilities.canEdit) return;
    const requiredProjectTab = actionType === 'create-daily-log'
      ? 'daily-logs'
      : actionType === 'create-photo'
        ? 'photos'
        : '';
    if (!requiredProjectTab || !visibleProjectTabIds.has(requiredProjectTab)) {
      void showAppAlert('That project workspace is hidden by the administrator.', 'Quick action unavailable');
      return;
    }
    if (!visibleProjects.length) {
      void showAppAlert('No editable project is available for this action.', 'Project required');
      return;
    }
    const locationProjectId = getProjectIdFromLocation();
    const preferredProjectId = visibleProjects.some((project) => project.id === locationProjectId)
      ? locationProjectId
      : visibleProjects.some((project) => project.id === sessionProjectFilter)
        ? sessionProjectFilter
        : visibleProjects[0].id;
    setAndroidProjectPrompt({
      type: actionType,
      projectId: preferredProjectId,
      token: `home-quick-action-${Date.now()}`,
    });
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
      const linkedProjectId = getProjectIdFromLocation();
      const linkedTaskId = getTaskIdFromLocation();
      const hasTaskDeepLink = !!linkedTaskId;
      setProjectNavigationTarget(hasTaskDeepLink && linkedProjectId
        ? { projectId: linkedProjectId, detailTab: 'tasks', taskId: linkedTaskId, token: `${Date.now()}` }
        : null);
      setSessionProjectFilter('all');
      setActiveTab(hasTaskDeepLink ? (linkedProjectId ? 'projects' : 'tasks') : 'home');
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
    refreshRequestIdRef.current += 1;
    initialWorkspaceLoadedRef.current = false;
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

  if (digitalApprovalToken) {
    return <Suspense fallback={<WorkspaceSplash message="Loading secure approval" />}><DigitalApprovalPage token={digitalApprovalToken} /></Suspense>;
  }

  if (vendor1099RecipientToken) {
    return <Suspense fallback={<WorkspaceSplash message="Loading secure tax document" />}><Vendor1099RecipientPage token={vendor1099RecipientToken} /></Suspense>;
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
          onQuickAction={openHomeQuickAction}
          includeCertificateExceptions={capabilities.allowedTabs.includes('certificates')}
          offlineOperations={offlineReviewOperations}
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
          offlineUserId={authSession?.user?.id}
          offlineOperations={offlineReviewOperations}
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
          createRequest={androidTaskCreateRequest}
          onCreateRequestHandled={() => setAndroidTaskCreateRequest(null)}
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
          navigationTarget={scheduleNavigationTarget}
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
          navigationTarget={peopleNavigationTarget}
        />
      );
    }

    if (activeTab === 'certificates') {
      return (
        <NativeCertificatesView
          data={trackerState}
          activeUser={activeUser}
          onStateChange={setTrackerState}
          navigationTarget={certificateNavigationTarget}
        />
      );
    }

    if (activeTab === 'reports') {
      return <ManagementReportingView data={trackerState} activeUser={activeUser} />;
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
      <GlobalCommandPalette
        open={showGlobalSearch}
        items={globalSearchItems}
        commands={globalSearchCommands}
        recentItems={globalSearchRecentItems}
        recordLoadStatus={workflowSearchData.scopeKey === workflowSearchScopeKey ? workflowSearchData.status : 'idle'}
        onClose={() => setShowGlobalSearch(false)}
        onSelect={handleGlobalSearchSelect}
      />
      {showOfflineReview ? (
        <div className="modal-backdrop" onClick={() => setShowOfflineReview(false)}>
          <div className="modal-card offline-review-modal" role="dialog" aria-modal="true" aria-labelledby="offline-review-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Offline field work</p>
                <h2 id="offline-review-title">Review device-saved changes</h2>
                <p>Retry one record while online, or discard its device copy to keep the current server record.</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setShowOfflineReview(false)}>Close</button>
            </div>
            {offlineReviewOperations.length ? (
              <div className="offline-review-list">
                {offlineReviewOperations.map((operation) => {
                  const { projectName, recordName, deviceSummary } = offlineOperationLabel(operation);
                  const busy = offlineReviewBusyId === operation.id;
                  return (
                    <article
                      className={`offline-review-item${operation.status === 'needs-attention' ? ' error' : ''}${offlineReviewTargetId === operation.id ? ' highlighted' : ''}`}
                      key={operation.id}
                      ref={(node) => {
                        if (node) offlineReviewItemRefs.current[operation.id] = node;
                        else delete offlineReviewItemRefs.current[operation.id];
                      }}
                    >
                      <div>
                        <span className={`status-pill offline-${operation.status}`}>{operation.status === 'needs-attention' ? 'Needs attention' : operation.status === 'syncing' ? 'Syncing' : 'Saved on device'}</span>
                        <h3>{operation.action === 'delete' ? `Delete ${recordName}` : recordName}</h3>
                        <p>{projectName} · {operation.kind === 'project-photo.upload' ? 'Project photo' : operation.kind === 'daily-log.save' ? 'Daily log' : operation.kind === 'task.save' ? 'Task' : operation.kind === 'warranty-item.save' ? 'Warranty item' : 'Inspection'}</p>
                        {deviceSummary ? <p><strong>Device copy:</strong> {deviceSummary}</p> : null}
                        {operation.lastError ? <p className="offline-review-error">{operation.lastError}</p> : null}
                        <small>Saved {operation.updatedAt ? new Date(operation.updatedAt).toLocaleString() : 'on this device'}</small>
                      </div>
                      <div className="offline-review-actions">
                        <button className={`button primary${busy ? ' is-loading' : ''}`} type="button" onClick={() => void retryOfflineReviewOperation(operation)} disabled={busy || runtimeStatus.writesFrozen || navigator.onLine === false}>Retry</button>
                        <button className="button secondary danger" type="button" onClick={() => void discardOfflineReviewOperation(operation)} disabled={busy}>Discard</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <div className="empty-state compact"><h3>No device-saved changes</h3><p>The offline queue is clear.</p></div>}
          </div>
        </div>
      ) : null}
      {androidProjectPrompt ? (
        <div className="modal-backdrop" onClick={() => setAndroidProjectPrompt(null)}>
          <div className="modal-card compact-modal-card" role="dialog" aria-modal="true" aria-labelledby="android-project-action-title" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Quick action</p>
                <h2 id="android-project-action-title">
                  {androidProjectPrompt.type === 'create-inspection'
                    ? 'Add inspection'
                    : androidProjectPrompt.type === 'create-daily-log'
                      ? 'Add daily log'
                      : androidProjectPrompt.type === 'create-photo'
                        ? 'Add project photo'
                        : 'Add shared photo'}
                </h2>
              </div>
            </div>
            <label className="field">
              <span>Project</span>
              <select
                value={androidProjectPrompt.projectId}
                onChange={(event) => setAndroidProjectPrompt((current) => ({ ...current, projectId: event.target.value }))}
              >
                {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            {androidProjectPrompt.file ? <p>Photo: {androidProjectPrompt.file.name}</p> : null}
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setAndroidProjectPrompt(null)}>Cancel</button>
              <button className="button primary" type="button" onClick={continueAndroidProjectAction}>Continue</button>
            </div>
          </div>
        </div>
      ) : null}
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
              {capabilities.showTabs ? (
                <button
                  className="android-app-bar-icon"
                  type="button"
                  onClick={() => { setShowAndroidNavMenu(false); setShowAndroidAccountMenu(false); setShowGlobalSearch(true); }}
                  title="Search and quick actions"
                  aria-label="Search and quick actions"
                >
                  <FluentIcon name="search" size={22} />
                </button>
              ) : null}
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

      {['checking', 'updating'].includes(trackerState.workspaceCache?.status) ? (
        <div className="workspace-cache-status" role="status" aria-live="polite">
          <FluentIcon name="replace" size={16} />
          <span>
            Saved workspace loaded. {trackerState.workspaceCache.status === 'checking' ? 'Checking for updates…' : 'Downloading changed data…'}
          </span>
        </div>
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
            <button
              className="workspace-global-search-trigger"
              type="button"
              onClick={() => setShowGlobalSearch(true)}
              aria-label="Search and quick actions"
            >
              <FluentIcon name="search" size={18} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
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

      {runtimeStatus.writesFrozen ? (
        <section className="offline-sync-banner maintenance" role="status" aria-live="polite">
          <FluentIcon name="lockClosed" size={18} />
          <div>
            <strong>Maintenance mode — changes are paused</strong>
            <span>{maintenanceDisplayMessage(runtimeStatus)} Reads remain available, and device-saved changes will resume syncing after maintenance.</span>
          </div>
        </section>
      ) : null}
      {offlineSyncSummary.total ? (
        <section className={`offline-sync-banner${offlineSyncSummary.needsAttention ? ' error' : ''}`} role="status">
          <FluentIcon name={offlineSyncSummary.needsAttention ? 'warning' : 'replace'} size={18} />
          <div>
            <strong>
              {offlineSyncSummary.needsAttention
                ? `${offlineSyncSummary.needsAttention} device-saved change${offlineSyncSummary.needsAttention === 1 ? '' : 's'} need attention`
                : offlineSyncSummary.syncing
                  ? 'Syncing device-saved changes'
                  : 'Changes saved on this device'}
            </strong>
            <span>
              {offlineSyncSummary.needsAttention
                ? 'Open the marked daily log or inspection while online and review it before saving.'
                : `${offlineSyncSummary.total} change${offlineSyncSummary.total === 1 ? '' : 's'} will sync automatically when a connection is available.`}
            </span>
          </div>
          <button className="button secondary" type="button" onClick={() => { setOfflineReviewTargetId(''); setShowOfflineReview(true); }}>Review</button>
        </section>
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









