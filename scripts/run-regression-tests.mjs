import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyDelayToStep,
  cascadePhaseDates,
  cascadeStepDates,
  computeStepEndDate,
  normalizePreds,
  normalizeStartDate,
  syncProjectPhaseDates,
  syncProjectTasks,
  syncStepLinks,
  wouldCreatePhaseCycleFromPreds,
  wouldCreateCycleFromPreds,
} from '../src/utils/schedule.js';
import { buildCalendarItems, buildCalendarWeeks, buildScheduleRows, filterScheduleRows, filterScheduleRowsForToday, getDefaultPhaseExpansion, isPhaseEntirelyPast } from '../src/utils/scheduleView.js';
import { formatShortDate, getCalendarWeekLayout } from '../src/utils/calendarUi.js';
import { getContrastRatio, getReadableTextColor } from '../src/utils/colorContrast.js';
import {
  buildTaskAssigneeDirectory,
  buildTaskAssigneeOptions,
  buildProjectAccessUpdates,
  getVisibleProjectsForUser,
  getVisibleTasksForUser,
  normalizeProjectAccessUserIds,
} from '../src/utils/accessUi.js';
import { buildAndroidReminderNotifications } from '../src/utils/androidNotifications.js';
import { buildAuditTrailEntries } from '../src/utils/auditTrail.js';
import {
  buildHomeActionCenterItems,
  buildHomeAttentionSummary,
  buildHomeCertificateExceptions,
  buildHomeFinancialExceptions,
  buildHomeOfflineSyncExceptions,
  buildHomeWarrantyCloseoutExceptions,
  buildHomeDaySummary,
  buildHomeOpenTasks,
  buildHomeOverdueDocumentExceptions,
  buildHomePendingDecisionExceptions,
  buildHomeRangeSummary,
  getLocalIsoDate,
  getProjectOperationalHealth,
  groupRecentAuditChanges,
} from '../src/utils/homeView.js';
import { describeWeatherCode, formatCurrentWeather, normalizeCurrentWeather, normalizeWeatherForecast } from '../src/utils/weather.js';
import { isRetryableQueryError, QueryClient } from '../src/services/queryClient.js';
import {
  initializeObservability,
  isExpectedOperationalError,
  isObservabilityEnabled,
  normalizeObservabilityOperation,
  reportError,
  sanitizeSentryEvent,
  setObservabilityTestSink,
} from '../src/services/observability.js';
import {
  getNormalizedProjectSectionChanges,
  hydratePeopleFromNormalizedRows,
  hydrateSettingsWithNormalizedUsers,
  hydrateProjectsWithNormalizedAssets,
  hydrateProjectsWithNormalizedAccess,
  hydrateProjectsWithNormalizedInspections,
  hydrateProjectsWithNormalizedSchedule,
  hydrateProjectsWithNormalizedScheduleRelationships,
  hydrateProjectsWithNormalizedSelectionTaskLinks,
  hydrateProjectsWithNormalizedSelections,
  hydrateTrackerWithNormalizedAssignments,
  hydrateTasksWithNormalizedAttachments,
  hydrateTasksWithNormalizedSelectionLinks,
} from '../src/services/trackerData.js';
import { normalizeMutationKey } from '../src/hooks/useEntityMutations.js';
import {
  calculateHorizontalWindow,
  calculateVirtualRange,
  timelineItemIntersectsWindow,
} from '../src/utils/virtualization.js';
import {
  isProjectPdf,
  listProjectPdfFiles,
  projectFileDisplayName,
} from '../src/features/takeoff/projectFilePicker.js';
import { buildProjectPhotoGallery } from '../src/utils/projectPhotoGallery.js';
import {
  attachRequestId,
  createRequestId,
  getResponseRequestId,
  normalizeRequestId,
} from '../src/utils/requestCorrelation.js';
import { DEFAULT_VISIBLE_TOP_LEVEL_TABS, normalizeVisibleTopLevelTabs } from '../src/utils/navigationTabs.js';
import {
  findClosestSubcontractor,
  normalizeSubcontractorName,
} from '../src/utils/certificateMatching.js';
import { certificateMatchesStatusFilter } from '../src/utils/certificateStatus.js';
import {
  DEFAULT_VISIBLE_PROJECT_TABS,
  getVisibleProjectTabs,
  normalizeVisibleProjectTabs,
} from '../src/utils/projectTabs.js';
import {
  MAX_PINNED_PROJECT_SECTIONS,
  buildProjectNavigationModel,
  normalizeProjectNavigationPreferences,
  recordRecentProjectSection,
  setProjectNavigationCompactMode,
  togglePinnedProjectSection,
} from '../src/utils/projectNavigation.js';
import { reorderSettingIds } from '../src/utils/settingsOrder.js';
import { buildTaskShareContent } from '../src/utils/taskSharing.js';
import {
  buildGlobalSearchItems,
  loadGlobalSearchRecentIds,
  recordGlobalSearchRecentId,
  searchGlobalItems,
} from '../src/utils/globalSearch.js';
import {
  hydrateNormalizedTakeoff,
  splitTakeoffSnapshot,
} from '../src/features/takeoff/services/takeoffNormalization.js';
import { constrainDrawingEndpoint } from '../src/features/takeoff/services/takeoffDrawing.js';
import {
  applyQueuedInspectionOperations,
  applyQueuedTaskOperations,
  enqueueOfflineOperation,
  getOfflineOperations,
  getOfflineOperationSummary,
  isOfflineNetworkError,
  mergeQueuedDailyLogs,
  mergeQueuedWarrantyItems,
  removeOfflineOperation,
} from '../src/services/offlineOperations.js';
import {
  buildOfflineProjectSnapshot,
  formatOfflineProjectSize,
  getOfflineStructuredSectionIds,
  getProjectOfflineOperationSummary,
  planOfflineProjectRefresh,
  reconcileOfflineProjectAssetState,
} from '../src/services/offlineProjectStore.js';
import {
  MAX_OFFLINE_ASSET_BYTES_PER_ITEM,
  MAX_OFFLINE_ASSET_BYTES_PER_USER,
  buildOfflineProjectAssetKindSignatures,
  canStoreOfflineAsset,
  getOfflineProjectAssetCandidates,
} from '../src/services/offlineProjectAssetStore.js';
import {
  isAppWriteFreezeError,
  maintenanceDisplayMessage,
  normalizeAppRuntimeStatus,
  throwIfAppWriteFrozen,
} from '../src/services/runtimeStatus.js';
import {
  buildWorkspaceCacheRecord,
  workspaceCacheMatches,
} from '../src/services/workspaceCache.js';
import { OFFLINE_WORKFLOW_SECTION_TYPES } from '../src/services/constructionWorkflows.js';

const weekdaySettings = {
  weekdaysOnly: true,
  holidays: [{ date: '2026-05-25', name: 'Memorial Day', nonWorkday: true }],
};

const tests = [
  {
    name: 'global search indexes only enabled authorized records and ranks useful matches',
    async run() {
      const items = buildGlobalSearchItems({
        projects: [{
          id: 'project-1',
          name: 'Lake House',
          address: '10 Main Street',
          status: 'active',
          phases: [{ id: 'phase-1', name: 'Roughs', steps: [{ id: 'step-1', name: 'Rough plumbing', start: '2026-08-01', end: '2026-08-04', assignees: ['Pipe It'] }] }],
           inspections: [{ id: 'inspection-1', subcode: 'PLUMB-101', inspectionType: 'Plumbing', agency: 'Township', status: 'scheduled', date: '2026-08-08' }],
           selections: [{ id: 'selection-1', itemName: 'Kitchen tile', category: 'Flooring', status: 'needs_decision' }],
           files: { folders: [{ id: 'folder-1', name: 'Permits', files: [{ id: 'file-1', originalName: 'Building Permit.pdf', type: 'application/pdf' }] }] },
         }],
        tasks: [
          { id: 'task-1', projectId: 'project-1', label: 'Frame basement walls', due: '2026-08-10', assignees: ['Alex Rivera'] },
          { id: 'task-hidden', projectId: 'project-hidden', label: 'Private task' },
          { id: 'task-general', projectId: '', label: 'Call insurance broker' },
        ],
        subs: [{
          id: 'sub-1',
          company: 'Royal Stonework',
          first: 'Rosa',
          last: 'Stone',
          email: 'office@example.com',
          certificates: [{ insurer: 'Evanston Insurance', policyNumber: 'ABC-123' }],
        }],
        employees: [{ id: 'emp-1', first: 'Alex', last: 'Rivera', peopleType: 'emp', role: 'Manager' }],
        includeTasks: true,
        includePeople: true,
        includeCertificates: true,
        includeSchedule: true,
         includeInspections: true,
         includeSelections: true,
         includeFiles: true,
         dailyLogs: [{ id: 'log-1', projectId: 'project-1', title: 'Foundation pour log', date: '2026-08-03', weather: 'Sunny', notes: 'Concrete delivery complete' }],
         rfis: [{ id: 'rfi-1', projectId: 'project-1', number: 'RFI-007', title: 'Header detail', status: 'open', question: 'Confirm beam size' }],
         submittals: [{ id: 'submittal-1', projectId: 'project-1', number: 'SUB-004', title: 'Window package', status: 'submitted', specSection: '08 50 00' }],
         warrantyItems: [{ id: 'warranty-1', projectId: 'project-1', number: 'WAR-003', title: 'Patio door adjustment', status: 'open', responsibleName: 'Royal Stonework' }],
         closeoutItems: [{ id: 'closeout-1', projectId: 'project-1', number: 'CLS-002', title: 'Final lien waiver', status: 'not_started', dueDate: '2026-08-20' }],
       });
      assert.ok(items.some((item) => item.id === 'project:project-1'));
      assert.ok(items.some((item) => item.id === 'task:task-1'));
      assert.ok(items.some((item) => item.id === 'task:task-general'));
      assert.ok(!items.some((item) => item.id === 'task:task-hidden'));
      assert.ok(items.some((item) => item.id === 'person:sub:sub-1'));
      assert.ok(items.some((item) => item.id === 'certificate:sub-1'));
      assert.ok(items.some((item) => item.id === 'schedule-step:project-1:step-1'));
      assert.ok(items.some((item) => item.id === 'inspection:project-1:inspection-1'));
       assert.ok(items.some((item) => item.id === 'selection:project-1:selection-1'));
       assert.ok(items.some((item) => item.id === 'file:project-1:file-1'));
       assert.ok(items.some((item) => item.id === 'daily-log:project-1:log-1'));
       assert.ok(items.some((item) => item.id === 'rfi:project-1:rfi-1'));
       assert.ok(items.some((item) => item.id === 'submittal:project-1:submittal-1'));
       assert.ok(items.some((item) => item.id === 'warranty:project-1:warranty-1'));
       assert.ok(items.some((item) => item.id === 'closeout:project-1:closeout-1'));
      assert.equal(searchGlobalItems(items, 'lake')[0].id, 'project:project-1');
      assert.equal(searchGlobalItems(items, 'frame alex')[0].id, 'task:task-1');
      assert.equal(searchGlobalItems(items, 'abc-123')[0].id, 'certificate:sub-1');
      assert.equal(searchGlobalItems(items, 'rough pipe it')[0].id, 'schedule-step:project-1:step-1');
      assert.equal(searchGlobalItems(items, 'township plumbing')[0].id, 'inspection:project-1:inspection-1');
       assert.equal(searchGlobalItems(items, 'kitchen flooring')[0].id, 'selection:project-1:selection-1');
       assert.equal(searchGlobalItems(items, 'building permit')[0].id, 'file:project-1:file-1');
       assert.equal(searchGlobalItems(items, 'concrete delivery')[0].id, 'daily-log:project-1:log-1');
       assert.equal(searchGlobalItems(items, 'beam size')[0].id, 'rfi:project-1:rfi-1');
       assert.equal(searchGlobalItems(items, '08 50 00')[0].id, 'submittal:project-1:submittal-1');
       assert.equal(searchGlobalItems(items, 'patio royal')[0].id, 'warranty:project-1:warranty-1');
       assert.equal(searchGlobalItems(items, 'lien waiver')[0].id, 'closeout:project-1:closeout-1');

       const hiddenWorkflow = buildGlobalSearchItems({
         projects: [{ id: 'project-1', name: 'Lake House' }],
         rfis: [{ id: 'rfi-hidden', projectId: 'project-hidden', title: 'Private RFI' }],
       });
       assert.ok(!hiddenWorkflow.some((item) => item.id.includes('rfi-hidden')));

      const restricted = buildGlobalSearchItems({
        projects: [{ id: 'project-1', name: 'Lake House' }],
        tasks: [{ id: 'task-1', projectId: 'project-1', label: 'Frame basement walls' }],
        subs: [{ id: 'sub-1', company: 'Royal Stonework' }],
      });
      assert.deepEqual(restricted.map((item) => item.id), ['project:project-1']);

      const storedValues = new Map();
      const storage = {
        getItem: (key) => storedValues.get(key) || null,
        setItem: (key, value) => storedValues.set(key, value),
      };
      recordGlobalSearchRecentId('user-1', 'project:project-1', storage);
      recordGlobalSearchRecentId('user-1', 'task:task-1', storage);
      recordGlobalSearchRecentId('user-1', 'project:project-1', storage);
      assert.deepEqual(loadGlobalSearchRecentIds('user-1', storage), ['project:project-1', 'task:task-1']);
      assert.deepEqual(loadGlobalSearchRecentIds('other-user', storage), []);

       const [appSource, paletteSource, peopleSource, filesSource, workflowSource, workflowServiceSource, styleSource] = await Promise.all([
         readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
         readFile(new URL('../src/components/GlobalCommandPalette.jsx', import.meta.url), 'utf8'),
         readFile(new URL('../src/components/NativePeopleView.jsx', import.meta.url), 'utf8'),
         readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8'),
         readFile(new URL('../src/components/ProjectWorkflowManager.jsx', import.meta.url), 'utf8'),
         readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
         readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(appSource, /event\.key\.toLowerCase\(\) !== 'k'/);
      assert.match(appSource, /includePeople: capabilities\.allowedTabs\.includes\('people'\)/);
      assert.match(appSource, /includeCertificates: capabilities\.allowedTabs\.includes\('certificates'\)/);
      assert.match(appSource, /command: 'create-task'/);
      assert.match(appSource, /command: 'create-project-record'/);
      assert.match(appSource, /visibleProjectTabIds\.has\('inspections'\)/);
       assert.match(appSource, /visibleProjectTabIds\.has\('daily-logs'\)/);
       assert.match(appSource, /WORKFLOW_SEARCH_CACHE_TTL_MS = 60_000/);
       assert.match(appSource, /loadWorkflowSearchItemsForProjects/);
       assert.match(appSource, /workflowSearchCacheRef\.current\.size > 8/);
       assert.match(appSource, /detailTab: 'files'/);
       assert.match(appSource, /detailTab: 'rfis-submittals'/);
       assert.match(appSource, /detailTab: 'warranty-closeout'/);
      assert.match(paletteSource, /role="dialog"/);
      assert.match(paletteSource, /aria-activedescendant/);
      assert.match(paletteSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
      assert.match(paletteSource, /event\.key === 'Tab'/);
      assert.match(paletteSource, /dialogRef\.current\?\.contains\(document\.activeElement\)/);
      assert.match(paletteSource, /item\.recent \? 'Recent'/);
      assert.match(paletteSource, /field categories show the latest 250 records/);
      assert.match(workflowServiceSource, /WORKFLOW_SEARCH_RESULT_LIMIT = 250/);
      assert.match(workflowServiceSource, /select=\$\{select\}[^`]+limit=\$\{boundedLimit\}/);
      assert.doesNotMatch(
        workflowServiceSource.match(/export async function loadWorkflowSearchItemsForProjects[\s\S]*?\n}\n/)?.[0] || '',
        /select=\*/,
      );
       assert.match(peopleSource, /navigationTarget\.personType/);
       assert.match(filesSource, /navigationTarget\.fileId/);
       assert.match(workflowSource, /navigationTarget\.workflowItemId/);
       assert.match(styleSource, /\.global-search-dialog/);
      assert.match(styleSource, /@media \(max-width: 620px\)/);
    },
  },
  {
    name: 'application runtime status normalizes maintenance state and messages',
    run() {
      const status = normalizeAppRuntimeStatus({
        writesFrozen: true,
        message: '  Incident maintenance  ',
        changedAt: '2026-08-04T16:00:00Z',
      });
      assert.deepEqual(status, {
        writesFrozen: true,
        message: 'Incident maintenance',
        changedAt: '2026-08-04T16:00:00Z',
      });
      assert.equal(maintenanceDisplayMessage(status), 'Incident maintenance');
      assert.match(maintenanceDisplayMessage({ writesFrozen: true }), /temporarily read-only/);
    },
  },
  {
    name: 'application write-freeze responses become stable operational errors',
    async run() {
      await assert.rejects(
        () => throwIfAppWriteFrozen(new Response(JSON.stringify({
          code: '55000',
          message: 'APP_WRITES_FROZEN',
          details: 'Maintenance drill in progress.',
        }), { status: 500 })),
        (error) => {
          assert.equal(error.code, 'APP_WRITES_FROZEN');
          assert.equal(error.message, 'Maintenance drill in progress.');
          assert.equal(isAppWriteFreezeError(error), true);
          return true;
        },
      );
      const ordinary = new Response('{"message":"permission denied"}', { status: 403 });
      assert.equal(await throwIfAppWriteFrozen(ordinary), ordinary);
    },
  },
  {
    name: 'offline field queue coalesces edits and preserves conflict versions',
    run() {
      const originalWindow = globalThis.window;
      const originalCustomEvent = globalThis.CustomEvent;
      const values = new Map();
      const eventTarget = new EventTarget();
      const localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
      };
      globalThis.window = Object.assign(eventTarget, { localStorage });
      globalThis.CustomEvent = class CustomEvent extends Event {
        constructor(type, options = {}) {
          super(type);
          this.detail = options.detail;
        }
      };
      try {
        const first = enqueueOfflineOperation('user-1', {
          id: 'offline-operation-1',
          kind: 'daily-log.save',
          projectId: 'project-1',
          entityId: 'log-1',
          payload: { id: 'log-1', version: 4, notes: 'First device edit' },
          expected: { version: 4 },
        });
        assert.equal(first.id, 'offline-operation-1');
        const second = enqueueOfflineOperation('user-1', {
          kind: 'daily-log.save',
          projectId: 'project-1',
          entityId: 'log-1',
          payload: { id: 'log-1', version: 4, notes: 'Latest device edit' },
          expected: { version: 99 },
        });
        assert.equal(second.id, first.id);
        assert.equal(getOfflineOperations('user-1').length, 1);
        assert.equal(getOfflineOperations('user-1')[0].payload.notes, 'Latest device edit');
        assert.equal(getOfflineOperations('user-1')[0].expected.version, 4);
        assert.deepEqual(getOfflineOperationSummary('user-1'), {
          total: 1,
          pending: 1,
          syncing: 0,
          needsAttention: 0,
        });
        assert.equal(removeOfflineOperation('user-1', first.id), true);
        assert.equal(getOfflineOperations('user-1').length, 0);
      } finally {
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
      }
    },
  },
  {
    name: 'offline field overlays remain visible until synchronization completes',
    run() {
      const operations = [
        {
          kind: 'daily-log.save',
          projectId: 'project-1',
          entityId: 'log-1',
          status: 'pending',
          queuedAt: '2026-07-27T12:00:00.000Z',
          payload: { id: 'log-1', date: '2026-07-27', title: 'Daily log', notes: 'Device notes' },
        },
        {
          kind: 'inspection.save',
          projectId: 'project-1',
          entityId: 'inspection-1',
          status: 'needs-attention',
          queuedAt: '2026-07-27T12:01:00.000Z',
          payload: { id: 'inspection-1', status: 'failed', notes: 'Corrected offline' },
        },
        {
          kind: 'task.save',
          projectId: 'project-1',
          entityId: 'task-1',
          status: 'pending',
          queuedAt: '2026-07-27T12:02:00.000Z',
          payload: { id: 'task-1', projectId: 'project-1', label: 'Device task', done: true },
        },
        {
          kind: 'warranty-item.save',
          projectId: 'project-1',
          entityId: 'warranty-1',
          status: 'pending',
          queuedAt: '2026-07-27T12:03:00.000Z',
          payload: { id: 'warranty-1', projectId: 'project-1', number: 'WAR-001', title: 'Device punch item', status: 'in_progress' },
        },
      ];
      const logs = mergeQueuedDailyLogs(
        [{ id: 'log-1', date: '2026-07-27', title: 'Daily log', notes: 'Server notes' }],
        operations,
      );
      assert.equal(logs[0].notes, 'Device notes');
      assert.equal(logs[0]._offlineStatus, 'pending');
      assert.equal(logs[0]._offlineServerRecord.notes, 'Server notes');
      const state = applyQueuedTaskOperations(applyQueuedInspectionOperations({
        tasks: [{ id: 'task-1', projectId: 'project-1', label: 'Server task', done: false }],
        projects: [{ id: 'project-1', inspections: [{ id: 'inspection-1', status: 'scheduled' }] }],
      }, operations), operations);
      assert.equal(state.projects[0].inspections[0].status, 'failed');
      assert.equal(state.projects[0].inspections[0]._offlineStatus, 'needs-attention');
      assert.equal(state.projects[0].inspections[0]._offlineServerRecord.status, 'scheduled');
      assert.equal(state.tasks[0].label, 'Device task');
      assert.equal(state.tasks[0].done, true);
      assert.equal(state.tasks[0]._offlineStatus, 'pending');
      assert.equal(state.tasks[0]._offlineServerRecord.label, 'Server task');
      const warrantyItems = mergeQueuedWarrantyItems(
        [{ id: 'warranty-1', number: 'WAR-001', title: 'Server punch item', status: 'open' }],
        operations,
      );
      assert.equal(warrantyItems[0].title, 'Device punch item');
      assert.equal(warrantyItems[0]._offlineStatus, 'pending');
      assert.equal(warrantyItems[0]._offlineServerRecord.title, 'Server punch item');
      assert.equal(isOfflineNetworkError(new Error('Network connection was lost.')), true);
      assert.equal(isOfflineNetworkError(new Error('Permission denied.')), false);
    },
  },
  {
    name: 'offline queued deletes remain visible as reviewable optimistic tombstones',
    run() {
      const deleteOperations = [
        {
          kind: 'daily-log.save', action: 'delete', projectId: 'project-1', entityId: 'log-1',
          status: 'pending', queuedAt: '2026-08-04T17:00:00.000Z',
          payload: { id: 'log-1', date: '2026-08-04', title: 'Daily log', version: 3 },
        },
        {
          kind: 'inspection.save', action: 'delete', projectId: 'project-1', entityId: 'inspection-1',
          status: 'needs-attention', queuedAt: '2026-08-04T17:01:00.000Z',
          payload: { id: 'inspection-1', inspectionType: 'Framing', status: 'scheduled' },
        },
      ];
      const logs = mergeQueuedDailyLogs(
        [{ id: 'log-1', date: '2026-08-04', title: 'Daily log', version: 3 }],
        deleteOperations,
      );
      assert.equal(logs[0]._offlineDeleted, true);
      assert.equal(logs[0]._offlineAction, 'delete');
      const state = applyQueuedInspectionOperations({
        projects: [{ id: 'project-1', inspections: [{ id: 'inspection-1', inspectionType: 'Framing', status: 'scheduled' }] }],
      }, deleteOperations);
      assert.equal(state.projects[0].inspections[0]._offlineDeleted, true);
      assert.equal(state.projects[0].inspections[0]._offlineStatus, 'needs-attention');
    },
  },
  {
    name: 'offline field attachments persist before metadata and clean up after sync',
    async run() {
      const [storeSource, syncSource, workflowSource, inspectionSource] = await Promise.all([
        readFile(new URL('../src/services/offlineAttachmentStore.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/offlineSync.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
      ]);
      assert.match(storeSource, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
      assert.match(storeSource, /createObjectStore\(STORE_NAME, \{ keyPath: 'id' \}\)/);
      assert.match(storeSource, /reconcileOfflineAttachments/);
      assert.match(syncSource, /await getOfflineAttachments\(operation\.id\)/);
      assert.match(syncSource, /await uploadStoredAttachment\(operation, record, 'daily-log-photos'/);
      assert.match(syncSource, /await removeOfflineAttachments\(operation\.id\)/);
      assert.match(workflowSource, /queueDailyLog: queueDailyLogRecord/);
      assert.match(workflowSource, /queueDailyLogDelete/);
      assert.match(workflowSource, /_offlineAttachmentId: offlineAttachmentId/);
      assert.match(inspectionSource, /export async function queueProjectInspectionOffline/);
      assert.match(inspectionSource, /export async function queueProjectInspectionDeleteOffline/);
      assert.match(inspectionSource, /delete_project_inspection/);
      assert.match(inspectionSource, /storageProvider: 'device'/);
      assert.match(syncSource, /operation\.kind === 'task\.save'/);
      assert.match(syncSource, /operation\.kind === 'warranty-item\.save'/);
      assert.match(inspectionSource, /export function queueTaskUpdateOffline/);
      assert.match(inspectionSource, /export async function syncQueuedTask/);
    },
  },
  {
    name: 'top-level tab visibility preserves required navigation and safe defaults',
    run() {
      assert.deepEqual(normalizeVisibleTopLevelTabs(undefined), DEFAULT_VISIBLE_TOP_LEVEL_TABS);
      assert.deepEqual(normalizeVisibleTopLevelTabs(['home', 'tasks']), ['home', 'projects', 'tasks', 'settings']);
      assert.deepEqual(normalizeVisibleTopLevelTabs(['unknown', 'calendar', 'calendar']), ['projects', 'calendar', 'settings']);
      assert.deepEqual(normalizeVisibleTopLevelTabs([]), ['projects', 'settings']);
    },
  },
  {
    name: 'project tab visibility preserves required and role-safe navigation',
    run() {
      assert.deepEqual(normalizeVisibleProjectTabs(undefined), DEFAULT_VISIBLE_PROJECT_TABS);
      assert.deepEqual(normalizeVisibleProjectTabs(['tasks', 'files']), ['overview', 'portal', 'tasks', 'files']);
      assert.deepEqual(normalizeVisibleProjectTabs(['unknown', 'photos', 'photos']), ['overview', 'portal', 'photos']);
      assert.deepEqual(
        normalizeVisibleProjectTabs(['files', 'overview', 'tasks', 'portal']),
        ['overview', 'files', 'tasks', 'portal'],
      );
      assert.deepEqual(
        getVisibleProjectTabs(['overview', 'portal', 'tasks', 'calendar', 'files'], 'Customer').map((tab) => tab.id),
        ['overview', 'portal', 'calendar', 'files'],
      );
      assert.deepEqual(
        getVisibleProjectTabs(['overview', 'portal', 'tasks', 'files'], 'Subcontractor').map((tab) => tab.id),
        ['portal', 'files'],
      );
      assert.deepEqual(
        getVisibleProjectTabs(['files', 'calendar', 'portal', 'overview', 'tasks'], 'Customer').map((tab) => tab.id),
        ['overview', 'files', 'calendar', 'portal'],
      );
    },
  },
  {
    name: 'administrator project navigation settings expose ordered tab controls',
    async run() {
      const settingsSource = await readFile(
        new URL('../src/components/NativeSettingsView.jsx', import.meta.url),
        'utf8',
      );
      assert.match(settingsSource, /function moveProjectTab\(tabId, direction\)/);
      assert.match(settingsSource, /if \(index < 0 \|\| tabId === 'overview'\) return/);
      assert.match(settingsSource, /settings\.visibleProjectTabs[\s\S]*PROJECT_TAB_DEFS\.filter/);
      assert.match(settingsSource, /Move \$\{tab\.label\} up/);
      assert.match(settingsSource, /Move \$\{tab\.label\} down/);
      assert.match(settingsSource, /Position \$\{orderIndex \+ 1\}/);
    },
  },
  {
    name: 'offline project snapshots are user-scoped bounded and privacy-safe',
    run() {
      const visibleTabs = getVisibleProjectTabs(DEFAULT_VISIBLE_PROJECT_TABS, 'Admin');
      assert.deepEqual(
        getOfflineStructuredSectionIds(visibleTabs),
        ['overview', 'tasks', 'calendar', 'inspections', 'selections'],
      );
      const snapshot = buildOfflineProjectSnapshot({
        userId: 'auth-user-1',
        project: {
          id: 'project-1',
          name: 'Offline House',
          phases: [],
          photos: [{ id: 'photo-1', dataUrl: 'data:image/png;base64,private' }],
          _offlineServerRecord: { name: 'duplicate server copy' },
        },
        tasks: [
          { id: 'task-1', projectId: 'project-1', label: 'Cached task' },
          { id: 'task-2', projectId: 'project-2', label: 'Other project' },
        ],
        settings: { currentUserId: 'app-user-1' },
        visibleTabs,
        savedAt: '2026-08-07T12:00:00.000Z',
      });
      assert.equal(snapshot.id, 'auth-user-1:project-1');
      assert.equal(snapshot.snapshot.tasks.length, 1);
      assert.equal(snapshot.snapshot.project.photos[0].dataUrl, undefined);
      assert.equal(snapshot.snapshot.project._offlineServerRecord, undefined);
      assert.ok(snapshot.byteSize > 0);
      assert.match(formatOfflineProjectSize(snapshot.byteSize), / B| KB| MB/);
      assert.deepEqual(getProjectOfflineOperationSummary([
        { projectId: 'project-1', status: 'pending' },
        { projectId: 'project-1', status: 'syncing' },
        { projectId: 'project-1', status: 'needs-attention' },
        { projectId: 'project-2', status: 'needs-attention' },
      ], 'project-1'), { total: 3, pending: 1, syncing: 1, needsAttention: 1 });
      assert.deepEqual(planOfflineProjectRefresh([
        { projectId: 'project-1' },
        { projectId: 'project-revoked' },
      ], [{ id: 'project-1' }]), {
        refreshProjectIds: ['project-1'],
        removeProjectIds: ['project-revoked'],
      });
    },
  },
  {
    name: 'offline project asset selection is explicit deduplicated and quota bounded',
    run() {
      const project = {
        id: 'project-1',
        files: {
          folders: [{
            id: 'folder-1',
            name: 'Plans',
            files: [
              { id: 'file-1', originalName: 'Plan.pdf', storageBucket: 'project-files', storagePath: 'projects/1/plan.pdf' },
              { id: 'file-duplicate', originalName: 'Plan copy.pdf', storageBucket: 'project-files', storagePath: 'projects/1/plan.pdf' },
              { id: 'local-only', originalName: 'Local draft.pdf' },
            ],
          }],
        },
        photos: [{ id: 'photo-1', name: 'Kitchen.jpg', type: 'image/jpeg', storageBucket: 'project-files', storagePath: 'projects/1/kitchen.jpg' }],
        selections: [{
          id: 'selection-1',
          itemName: 'Kitchen tile',
          attachments: [{ id: 'selection-file', name: 'Tile quote.pdf', type: 'application/pdf', storageBucket: 'project-files', storagePath: 'projects/1/tile-quote.pdf' }],
          photos: [{ id: 'selection-photo', name: 'Tile sample.png', type: 'image/png', storageBucket: 'project-files', storagePath: 'projects/1/tile-sample.png' }],
        }],
        inspections: [{
          id: 'inspection-1',
          inspectionType: 'Framing',
          stickerFile: { id: 'sticker-1', name: 'Sticker.jpg', type: 'image/jpeg', storageBucket: 'project-files', storagePath: 'projects/1/sticker.jpg' },
          reportFile: { id: 'report-1', name: 'Report.pdf', type: 'application/pdf', storageBucket: 'project-files', storagePath: 'projects/1/report.pdf' },
        }],
      };
      assert.deepEqual(
        getOfflineProjectAssetCandidates(project, ['files']).map(({ kind, name, sourceName }) => ({ kind, name, sourceName })),
        [
          { kind: 'files', name: 'Plan.pdf', sourceName: 'Files · Plans' },
          { kind: 'files', name: 'Tile quote.pdf', sourceName: 'Selections · Kitchen tile' },
          { kind: 'files', name: 'Sticker.jpg', sourceName: 'Inspections · Framing' },
          { kind: 'files', name: 'Report.pdf', sourceName: 'Inspections · Framing' },
        ],
      );
      const tasks = [{
        id: 'task-1',
        projectId: 'project-1',
        label: 'Confirm tile',
        attachments: [
          { id: 'task-photo', name: 'Field photo.webp', type: 'image/webp', storageBucket: 'project-files', storagePath: 'projects/1/field-photo.webp' },
          { id: 'task-note', name: 'Field note.txt', type: 'text/plain', storageBucket: 'project-files', storagePath: 'projects/1/field-note.txt' },
        ],
      }];
      assert.equal(getOfflineProjectAssetCandidates(project, ['files', 'photos'], tasks).length, 8);
      assert.deepEqual(
        getOfflineProjectAssetCandidates(project, ['photos'], tasks).map((candidate) => candidate.name),
        ['Kitchen.jpg', 'Tile sample.png', 'Sticker.jpg', 'Field photo.webp'],
      );
      assert.deepEqual(
        getOfflineProjectAssetCandidates(project, ['files', 'photos'], tasks)
          .find((candidate) => candidate.name === 'Sticker.jpg')?.kinds,
        ['files', 'photos'],
      );
      const signatures = buildOfflineProjectAssetKindSignatures(project, tasks);
      assert.match(signatures.files, /project-files:projects\/1\/plan\.pdf/);
      assert.match(signatures.photos, /project-files:projects\/1\/sticker\.jpg/);
      assert.notEqual(
        signatures.files,
        buildOfflineProjectAssetKindSignatures({
          ...project,
          files: { folders: [] },
        }, tasks).files,
      );
      assert.deepEqual(
        reconcileOfflineProjectAssetState({
          assetSections: ['files', 'photos'],
          assetSummary: { kindSignatures: signatures, count: 8 },
        }, project, tasks).assetSections,
        ['files', 'photos'],
      );
      const changedState = reconcileOfflineProjectAssetState({
        assetSections: ['files', 'photos'],
        assetSummary: { kindSignatures: signatures, count: 8 },
      }, { ...project, photos: [] }, tasks);
      assert.deepEqual(changedState.assetSections, ['files']);
      assert.deepEqual(changedState.assetSummary.staleKinds, ['photos']);
      assert.deepEqual(
        canStoreOfflineAsset({ itemBytes: MAX_OFFLINE_ASSET_BYTES_PER_ITEM + 1, currentUserBytes: 0 }),
        { allowed: false, reason: 'item-too-large' },
      );
      assert.deepEqual(
        canStoreOfflineAsset({ itemBytes: 10, currentUserBytes: MAX_OFFLINE_ASSET_BYTES_PER_USER }),
        { allowed: false, reason: 'user-limit' },
      );
      assert.equal(canStoreOfflineAsset({ itemBytes: 10, currentUserBytes: 20, replacingBytes: 20 }).allowed, true);
    },
  },
  {
    name: 'offline project copies include visible workflows takeoffs and workflow attachments',
    async run() {
      const visibleTabs = [
        { id: 'overview' },
        { id: 'daily-logs' },
        { id: 'change-orders' },
        { id: 'rfis-submittals' },
        { id: 'budget-commitments' },
        { id: 'warranty-closeout' },
        { id: 'takeoff' },
      ];
      const workflows = {
        dailyLogs: [{
          id: 'log-1',
          subcontractorWork: [{ photos: [{ id: 'daily-photo', name: 'Daily.jpg', type: 'image/jpeg', storageBucket: 'project-files', storagePath: 'projects/1/daily.jpg' }] }],
        }],
        changeOrders: [{
          id: 'co-1', number: 'CO-001',
          attachments: [{ id: 'co-file', name: 'Change.pdf', type: 'application/pdf', storageBucket: 'project-files', storagePath: 'projects/1/change.pdf' }],
        }],
        commitments: [{
          id: 'commitment-1', number: 'COM-001',
          invoices: [{ id: 'invoice-1', name: 'Invoice.pdf', type: 'application/pdf', storageBucket: 'project-files', storagePath: 'projects/1/invoice.pdf' }],
        }],
        warrantyItems: [{
          id: 'warranty-1', number: 'WAR-001',
          attachments: [{ id: 'warranty-photo', name: 'Warranty.png', type: 'image/png', storageBucket: 'project-files', storagePath: 'projects/1/warranty.png' }],
        }],
      };
      const snapshot = buildOfflineProjectSnapshot({
        userId: 'auth-user-1',
        project: { id: 'project-1', name: 'Complete offline project' },
        workflows,
        workflowSections: ['daily-logs', 'change-orders', 'budget-commitments', 'warranty-closeout'],
        visibleTabs,
      });
      assert.deepEqual(snapshot.cachedSections, [
        'overview',
        'daily-logs',
        'change-orders',
        'budget-commitments',
        'warranty-closeout',
        'takeoff',
      ]);
      assert.equal(snapshot.snapshot.workflows.changeOrders[0].number, 'CO-001');
      assert.deepEqual(Object.keys(OFFLINE_WORKFLOW_SECTION_TYPES), [
        'portal',
        'daily-logs',
        'change-orders',
        'rfis-submittals',
        'budget-commitments',
        'warranty-closeout',
      ]);
      const candidates = getOfflineProjectAssetCandidates(
        { id: 'project-1' },
        ['files', 'photos'],
        [],
        workflows,
      );
      assert.deepEqual(candidates.map((candidate) => candidate.name), [
        'Daily.jpg',
        'Change.pdf',
        'Invoice.pdf',
        'Warranty.png',
      ]);
      assert.deepEqual(candidates.find((candidate) => candidate.name === 'Warranty.png')?.kinds, ['files', 'photos']);
      const signatures = buildOfflineProjectAssetKindSignatures({ id: 'project-1' }, [], workflows);
      assert.match(signatures.files, /projects\/1\/invoice\.pdf/);
      assert.match(signatures.photos, /projects\/1\/daily\.jpg/);

      const [workflowSource, detailSource] = await Promise.all([
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(workflowSource, /loadOfflineProjectWorkflowSnapshot/);
      assert.match(workflowSource, /readOfflineWorkflowRecords/);
      assert.match(workflowSource, /updateOfflineProjectWorkflowRecords/);
      assert.match(detailSource, /workflows: offlineWorkflows/);
      assert.match(detailSource, /Takeoff opens projects already saved on this device/);
    },
  },
  {
    name: 'workspace quick-load cache is user-scoped sanitized and manifest conditional',
    async run() {
      const record = buildWorkspaceCacheRecord({
        userId: 'auth-user-1',
        manifestToken: 'manifest-1',
        savedAt: '2026-08-07T14:00:00.000Z',
        state: {
          projects: [{ id: 'project-1', photos: [{ id: 'photo-1', dataUrl: 'data:image/png;base64,private' }], _offlineServerRecord: { private: true } }],
          tasks: [],
          settings: { currentUserId: 'app-user-1' },
          storageMode: 'offline-cache',
          storageIssue: 'old issue',
          deferredDataStatus: 'loading',
          workspaceCache: { status: 'checking' },
        },
      });
      assert.equal(record.id, 'auth-user-1');
      assert.equal(record.state.projects[0].photos[0].dataUrl, undefined);
      assert.equal(record.state.projects[0]._offlineServerRecord, undefined);
      assert.equal(record.state.workspaceCache, undefined);
      assert.equal(record.state.storageMode, 'supabase');
      assert.equal(record.state.deferredDataStatus, 'ready');
      assert.ok(record.byteSize > 0);
      assert.equal(record.mode, 'staff');
      assert.equal(workspaceCacheMatches(record, { schemaVersion: 1, mode: 'staff', token: 'manifest-1' }), true);
      assert.equal(workspaceCacheMatches(record, { schemaVersion: 1, mode: 'staff', token: 'manifest-2' }), false);
      assert.equal(workspaceCacheMatches(record, { schemaVersion: 1, mode: 'portal', token: 'manifest-1' }), false);
      const portalRecord = buildWorkspaceCacheRecord({
        userId: 'portal-user',
        manifestToken: 'manifest-1',
        state: { portalMode: true, projects: [] },
      });
      assert.equal(portalRecord.mode, 'portal');
      assert.equal(workspaceCacheMatches(portalRecord, { schemaVersion: 1, mode: 'portal', token: 'manifest-1' }), true);

      const [migrationSource, trackerSource, appSource] = await Promise.all([
        readFile(new URL('../supabase/migrations/20260807140000_add_workspace_cache_manifest.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(migrationSource, /create or replace function public\.get_workspace_cache_manifest\(\)/);
      assert.match(migrationSource, /security invoker/);
      assert.doesNotMatch(migrationSource, /security definer/);
      assert.match(migrationSource, /to_jsonb\(source_row\)::text/);
      assert.match(migrationSource, /md5\(public\.get_project_portal_bootstrap\(\)::text\)/);
      assert.match(migrationSource, /revoke all on function public\.get_workspace_cache_manifest\(\) from public, anon/);
      assert.match(migrationSource, /grant execute on function public\.get_workspace_cache_manifest\(\) to authenticated/);
      assert.match(trackerSource, /'get_workspace_cache_manifest'/);
      assert.match(appSource, /workspaceCacheMatches\(quickCache, manifest\)/);
      assert.match(appSource, /Saved workspace loaded\./);
    },
  },
  {
    name: 'project section navigation keeps role-safe pins recents and overflow',
    run() {
      const internalTabs = getVisibleProjectTabs(DEFAULT_VISIBLE_PROJECT_TABS, 'Admin');
      const defaults = normalizeProjectNavigationPreferences(null, internalTabs, 'Admin');
      assert.deepEqual(defaults.pinnedIds, ['overview', 'tasks', 'calendar', 'daily-logs', 'files', 'photos']);
      assert.equal(MAX_PINNED_PROJECT_SECTIONS, 10);

      const withRecent = recordRecentProjectSection(defaults, 'takeoff', internalTabs, 'Admin');
      const model = buildProjectNavigationModel(internalTabs, withRecent, 'takeoff', 'Admin');
      assert.equal(model.primaryTabs.at(-1).id, 'takeoff');
      assert.equal(model.moreTabs[0].id, 'takeoff');

      const filledPins = internalTabs
        .filter((tab) => !defaults.pinnedIds.includes(tab.id))
        .slice(0, MAX_PINNED_PROJECT_SECTIONS - defaults.pinnedIds.length)
        .reduce(
          (preferences, tab) => togglePinnedProjectSection(preferences, tab.id, internalTabs, 'Admin'),
          defaults,
        );
      assert.equal(filledPins.pinnedIds.length, MAX_PINNED_PROJECT_SECTIONS);
      const nextUnpinnedTab = internalTabs.find((tab) => !filledPins.pinnedIds.includes(tab.id));
      assert.ok(nextUnpinnedTab);
      assert.deepEqual(
        togglePinnedProjectSection(filledPins, nextUnpinnedTab.id, internalTabs, 'Admin').pinnedIds,
        filledPins.pinnedIds,
      );
      const compact = setProjectNavigationCompactMode(filledPins, true, internalTabs, 'Admin');
      assert.equal(compact.compactDesktop, true);
      assert.deepEqual(compact.pinnedIds, filledPins.pinnedIds);
      assert.equal(normalizeProjectNavigationPreferences(compact, internalTabs, 'Admin').compactDesktop, true);

      const customerTabs = getVisibleProjectTabs(DEFAULT_VISIBLE_PROJECT_TABS, 'Customer');
      assert.deepEqual(
        normalizeProjectNavigationPreferences(null, customerTabs, 'Customer').pinnedIds,
        ['overview', 'portal', 'calendar', 'selections'],
      );
      const subcontractorTabs = getVisibleProjectTabs(DEFAULT_VISIBLE_PROJECT_TABS, 'Subcontractor');
      assert.deepEqual(
        normalizeProjectNavigationPreferences(null, subcontractorTabs, 'Subcontractor').pinnedIds,
        ['portal', 'selections', 'files'],
      );
    },
  },
  {
    name: 'settings drag reorder preserves pinned items and supports columns',
    async run() {
      assert.deepEqual(
        reorderSettingIds(['overview', 'tasks', 'files', 'photos'], 'photos', 'tasks', 'before', { pinnedFirstId: 'overview' }),
        ['overview', 'photos', 'tasks', 'files'],
      );
      assert.deepEqual(
        reorderSettingIds(['overview', 'tasks', 'files'], 'files', 'overview', 'before', { pinnedFirstId: 'overview' }),
        ['overview', 'files', 'tasks'],
      );
      assert.deepEqual(
        reorderSettingIds(['overview', 'tasks', 'files'], 'overview', 'files', 'after', { pinnedFirstId: 'overview' }),
        ['overview', 'tasks', 'files'],
      );
      assert.deepEqual(
        reorderSettingIds(['name', 'company', 'email'], 'name', 'email', 'after'),
        ['company', 'email', 'name'],
      );

      const settingsSource = await readFile(
        new URL('../src/components/NativeSettingsView.jsx', import.meta.url),
        'utf8',
      );
      const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(settingsSource, /function startSettingsDrag\(event, kind, itemId, enabled\)/);
      assert.match(settingsSource, /dropSettingsItem\(event, 'project-tab'/);
      assert.match(settingsSource, /dropSettingsItem\(event, 'people-column'/);
      assert.match(settingsSource, /draggable=\{visible && !projectTabsSaving && tab\.id !== 'overview'\}/);
      assert.match(settingsSource, /className="settings-drag-handle"/);
      assert.match(stylesSource, /\.settings-order-row\.is-drag-over-before/);
      assert.match(stylesSource, /\.settings-order-row\.is-drag-over-after/);
    },
  },
  {
    name: 'project tabs render in configured order and survive page refresh',
    async run() {
      const [detailSource, appSource, projectsSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(detailSource, /getSearchParam\('projectTab'\)/);
      assert.match(detailSource, /url\.searchParams\.set\('projectTab', activeDetailTab\)/);
      assert.match(detailSource, /projectNavigation\.primaryTabs\.map\(\(tab\) =>/);
      assert.match(detailSource, /id=\{`project-tab-\$\{tab\.id\}`\}/);
      assert.match(detailSource, /aria-label="More project sections"/);
      assert.match(detailSource, /aria-label="Project breadcrumb"/);
      assert.match(appSource, /url\.searchParams\.delete\('projectTab'\)/);
      assert.match(projectsSource, /url\.searchParams\.delete\('projectTab'\)/);
    },
  },
  {
    name: 'project photo gallery includes images from every photo-bearing project area',
    run() {
      const image = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg' });
      const project = {
        id: 'project-1',
        photos: [image('project-photo')],
        files: { folders: [{ id: 'folder-1', name: 'Plans', files: [image('file-photo'), { id: 'pdf', name: 'plan.pdf', type: 'application/pdf' }] }] },
        selections: [{ id: 'selection-1', itemName: 'Tile', photos: [image('selection-photo')], attachments: [image('selection-attachment')] }],
        inspections: [{ id: 'inspection-1', inspectionType: 'Rough', stickerFile: image('sticker'), reportFile: image('report') }],
      };
      const tasks = [
        { id: 'task-1', projectId: 'project-1', label: 'Framing', attachments: [image('task-photo')] },
        { id: 'task-2', projectId: 'other-project', label: 'Other', attachments: [image('other-photo')] },
      ];
      const workflowRecords = [
        { type: 'dailyLogs', records: [{ id: 'log-1', date: '2026-07-21', subcontractorWork: [{ id: 'work-1', subcontractorCompany: 'Test Sub', photos: [image('daily-photo')] }] }] },
        { type: 'changeOrders', records: [{ id: 'co-1', number: 'CO-1', attachments: [image('change-photo')] }] },
        { type: 'rfis', records: [{ id: 'rfi-1', number: 'RFI-1', attachments: [image('rfi-photo')] }] },
        { type: 'submittals', records: [{ id: 'submittal-1', number: 'SUB-1', attachments: [image('submittal-photo')] }] },
        { type: 'commitments', records: [{ id: 'commitment-1', number: 'COM-1', attachments: [image('commitment-photo')], invoices: [image('invoice-photo')] }] },
        { type: 'warrantyItems', records: [{ id: 'warranty-1', number: 'W-1', attachments: [image('warranty-photo')] }] },
        { type: 'closeoutItems', records: [{ id: 'closeout-1', number: 'C-1', attachments: [image('closeout-photo')] }] },
      ];

      const gallery = buildProjectPhotoGallery({ project, tasks, workflowRecords });
      assert.equal(gallery.length, 15);
      assert.equal(gallery.some((photo) => photo.id === 'pdf'), false);
      assert.equal(gallery.some((photo) => photo.id === 'other-photo'), false);
      assert.deepEqual(
        new Set(gallery.map((photo) => photo.gallerySourceType)),
        new Set(['project', 'files', 'selections', 'inspections', 'tasks', 'dailyLogs', 'changeOrders', 'rfis', 'submittals', 'commitments', 'warrantyItems', 'closeoutItems']),
      );
    },
  },
  {
    name: 'user access updates preserve every selected project in one batch',
    run() {
      const projects = [
        { id: 'p1', name: 'First', accessUserIds: [] },
        { id: 'p2', name: 'Second', accessUserIds: ['other-user'] },
        { id: 'p3', name: 'Third', accessUserIds: ['customer-user'] },
      ];
      const updates = buildProjectAccessUpdates(projects, 'customer-user', ['p1', 'p2']);
      assert.deepEqual(updates.map((project) => project.id), ['p1', 'p2', 'p3']);
      assert.deepEqual(updates[0].accessUserIds, ['customer-user']);
      assert.deepEqual(updates[1].accessUserIds, ['other-user', 'customer-user']);
      assert.deepEqual(updates[2].accessUserIds, []);
    },
  },
  {
    name: 'short date formatting accepts calendar dates and portal response timestamps',
    run() {
      assert.equal(formatShortDate('2026-07-20'), 'Jul 20, 2026');
      assert.match(formatShortDate('2026-07-20T19:27:57.773Z'), /^Jul (20|21), 2026$/);
      assert.equal(formatShortDate('not-a-date'), 'Invalid date');
    },
  },
  {
    name: 'home weather normalizes exactly four forecast days and WMO conditions',
    run() {
      const forecast = normalizeWeatherForecast({ daily: {
        time: ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20'],
        weather_code: [0, 3, 63, 95, 1],
        temperature_2m_max: [81.4, 79.7, 75.2, 77.8, 82],
        temperature_2m_min: [65.2, 64.1, 62.9, 63.4, 66],
        precipitation_probability_max: [5, 10, 80, 60, 0],
        wind_speed_10m_max: [8.2, 10.1, 14.8, 18.3, 7],
      } });
      assert.equal(forecast.length, 4);
      assert.deepEqual(forecast.map((day) => day.label), ['Clear', 'Cloudy', 'Rain', 'Thunderstorms']);
      assert.equal(forecast[0].high, 81);
      assert.equal(forecast[2].rainChance, 80);
      assert.equal(describeWeatherCode(999).label, 'Variable weather');
      const current = normalizeCurrentWeather({ current: {
        time: '2026-07-20T10:15', weather_code: 2, temperature_2m: 78.2,
        apparent_temperature: 80.1, wind_speed_10m: 7.6, precipitation: 0,
      } });
      assert.equal(current.label, 'Partly cloudy');
      assert.equal(formatCurrentWeather(current), 'Partly cloudy, 78°F, feels like 80°F, wind 8 mph');
    },
  },
  {
    name: 'restoring an authenticated session cannot leave the startup splash waiting indefinitely',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      assert.match(trackerSource, /async function fetchAuthWithTimeout/);
      assert.match(trackerSource, /controller\.abort\(\)/);
      assert.match(trackerSource, /fetchAuthWithTimeout\(getAuthEndpoint\('\/token\?grant_type=refresh_token'\)/);
      assert.match(trackerSource, /fetchAuthWithTimeout\(getAuthEndpoint\('\/user'\)/);
      assert.match(trackerSource, /Session refresh.*timed out|timed out.*Check your connection/s);
    },
  },
  {
    name: 'home summaries include matching inspections, open tasks, and active schedule ranges',
    run() {
      const projects = [{
        id: 'p1',
        name: 'Maple House',
        inspections: [
          { id: 'i1', date: '2026-07-16', subcode: 'FRAME-220', inspectionType: 'Framing' },
          { id: 'i2', date: '2026-07-18', inspectionType: 'Final' },
        ],
        phases: [{
          id: 'phase-1',
          name: 'Framing',
          start: '2026-07-14',
          end: '2026-07-17',
          steps: [
            { id: 'step-1', name: 'Frame walls', start: '2026-07-16', end: '2026-07-17' },
            { id: 'step-2', name: 'Set trusses', start: '2026-07-18', end: '2026-07-18' },
          ],
        }],
      }, {
        id: 'p2',
        name: 'Completed phase project',
        status: 'active',
        inspections: [],
        phases: [{
          id: 'phase-done',
          name: 'Framing',
          status: 'Done',
          steps: [{ id: 'step-phase-done', name: 'Frame floors', start: '2026-05-01', status: 'delayed' }],
        }],
      }, {
        id: 'p3',
        name: 'Completed project',
        status: 'completed',
        inspections: [],
        phases: [{
          id: 'phase-open',
          name: 'Closeout',
          status: 'active',
          steps: [{ id: 'step-project-done', name: 'Final item', start: '2026-05-01', status: 'delayed' }],
        }],
      }, {
        id: 'p4',
        name: 'Completed step project',
        status: 'active',
        inspections: [],
        phases: [{
          id: 'phase-active',
          name: 'Punch',
          status: 'active',
          steps: [{ id: 'step-done', name: 'Done item', start: '2026-05-01', status: 'Done', predecessors: [{ id: 'missing' }] }],
        }],
      }];
      const tasks = [
        { id: 't1', projectId: 'p1', label: 'Order lumber', due: '2026-07-16', done: false },
        { id: 't2', projectId: 'p1', label: 'Completed task', due: '2026-07-16', done: true },
        { id: 't3', projectId: 'p1', label: 'Later task', due: '2026-07-17', done: false },
      ];
      const summary = buildHomeDaySummary(projects, tasks, '2026-07-16');
      assert.deepEqual(summary.inspections.map((item) => item.id), ['i1']);
      assert.deepEqual(summary.openTasks.map((item) => item.id), ['t1']);
      assert.deepEqual(summary.scheduleItems.map((item) => item.id).sort(), ['phase-1', 'step-1']);
      assert.equal(summary.scheduleItems.find((item) => item.id === 'step-1').phaseName, 'Framing');
    },
  },
  {
    name: 'home change feed keeps only local today and yesterday activity',
    run() {
      const now = new Date(2026, 6, 16, 15, 30);
      const atLocalTime = (day, hour) => new Date(2026, 6, day, hour, 0).toISOString();
      const rows = [
        { id: 'a1', created_at: atLocalTime(16, 9), entity_type: 'task', entity_id: 't1', project_id: 'p1', action: 'insert', after_data: { id: 't1', label: 'Today task' } },
        { id: 'a2', created_at: atLocalTime(15, 17), entity_type: 'project', entity_id: 'p1', project_id: 'p1', action: 'delete', before_data: { id: 'p1', name: 'Yesterday project' } },
        { id: 'a3', created_at: atLocalTime(14, 12), entity_type: 'task', entity_id: 't2', project_id: 'p1', action: 'insert', after_data: { id: 't2', label: 'Older task' } },
      ];
      const groups = groupRecentAuditChanges(rows, now);
      assert.deepEqual(groups.today.map((entry) => entry.eventId), ['a1']);
      assert.deepEqual(groups.yesterday.map((entry) => entry.eventId), ['a2']);
      assert.equal(getLocalIsoDate(now), '2026-07-16');
    },
  },
  {
    name: 'home shows every open task for admins and only the current user assignments for other roles',
    run() {
      const projects = [{ id: 'p1', name: 'Maple House' }];
      const people = [{ first: 'Alex', last: 'Rivera', company: 'Destiny', email: 'alex@example.com' }];
      const tasks = [
        { id: 't1', projectId: 'p1', label: 'Undated assigned task', due: '', assignees: ['Alex Rivera (Destiny)'], done: false },
        { id: 't2', projectId: 'p1', label: 'Dated assigned task', due: '2026-08-01', assignees: ['Alex Rivera'], done: false },
        { id: 't3', projectId: 'p1', label: 'Another user task', due: '', assignees: ['Jamie Smith'], done: false },
        { id: 't4', projectId: 'p1', label: 'Completed task', due: '', assignees: ['Alex Rivera'], done: true },
      ];
      const userTasks = buildHomeOpenTasks(tasks, projects, { name: 'Alex Rivera', email: 'alex@example.com', role: 'Edit' }, people);
      assert.deepEqual(userTasks.map((task) => task.id), ['t2', 't1']);
      const adminTasks = buildHomeOpenTasks(tasks, projects, { name: 'Admin', role: 'Admin' }, people);
      assert.deepEqual(adminTasks.map((task) => task.id), ['t2', 't3', 't1']);
    },
  },
  {
    name: 'home action center aggregates certificate exceptions with portfolio drill-through data',
    run() {
      const subcontractors = [
        { id: 'expired-sub', company: 'Expired Electric' },
        { id: 'expiring-sub', company: 'Expiring HVAC' },
        { id: 'missing-sub', company: 'Missing Plumbing' },
        { id: 'missing-date-sub', company: 'No Date Roofing' },
        { id: 'active-sub', company: 'Active Concrete' },
        { id: 'newer-active-sub', company: 'Renewed Framing' },
        { id: 'inactive-sub', company: 'Inactive Landscaping', inactive: true },
        { id: 'not-required-sub', company: 'No Certificate Needed', certificateRequirement: 'not_required' },
      ];
      const certificates = [
        { id: 'expired-cert', subcontractorId: 'expired-sub', expirationDate: '2026-07-15' },
        { id: 'expiring-cert', subcontractorId: 'expiring-sub', expirationDate: '2026-08-15' },
        { id: 'missing-date-cert', subcontractorId: 'missing-date-sub', expirationDate: '' },
        { id: 'active-cert', subcontractorId: 'active-sub', expirationDate: '2026-09-01' },
        { id: 'renewed-old-cert', subcontractorId: 'newer-active-sub', expirationDate: '2026-07-01' },
        { id: 'renewed-active-cert', subcontractorId: 'newer-active-sub', expirationDate: '2026-09-15' },
      ];
      const certificateExceptions = buildHomeCertificateExceptions(subcontractors, certificates, '2026-07-16');
      assert.deepEqual(certificateExceptions.map((item) => item.statusId), ['expired-expiring', 'missing']);
      assert.deepEqual(certificateExceptions.map((item) => item.ownerLabel), [
        '2 subcontractors',
        '2 subcontractors',
      ]);
      assert.deepEqual(certificateExceptions.map((item) => item.certificateCount), [2, 2]);
      assert.equal(certificateExceptions[0].status, '1 expired · 1 expiring within 30 days');
      assert.equal(certificateExceptions[1].status, '1 certificate missing · 1 expiration date missing');
      assert.ok(certificateExceptions.every((item) => item.projectName === 'Portfolio' && item.type === 'certificate'));
      const actions = buildHomeActionCenterItems({ certificateExceptions });
      assert.deepEqual(actions.map((action) => action.reason), [
        '2 certificates need attention',
        '2 certificate records need attention',
      ]);
      assert.deepEqual(actions.map((action) => action.owner), [
        '2 subcontractors',
        '2 subcontractors',
      ]);
      assert.equal(certificateMatchesStatusFilter('expired', 'expired-expiring'), true);
      assert.equal(certificateMatchesStatusFilter('expiring', 'expired-expiring'), true);
      assert.equal(certificateMatchesStatusFilter('active', 'expired-expiring'), false);
      assert.equal(certificateMatchesStatusFilter('missing', 'missing'), true);
    },
  },
  {
    name: 'home action center consolidates pending selection approvals and portal response requests',
    run() {
      const projects = [{
        id: 'p1',
        name: 'Maple House',
        selections: [
          { id: 'selection-open', itemName: 'Kitchen faucet', status: 'needs decision' },
          { id: 'selection-approval', itemName: 'Exterior color', status: 'needs decision' },
          { id: 'selection-done', itemName: 'Roof color', status: 'selected' },
        ],
      }];
      const portalItems = [
        {
          id: 'approval-current', projectId: 'p1', selectionId: 'selection-approval', itemType: 'approval',
          audience: 'customer', status: 'response_requested', title: 'Selection approval: Exterior color',
          dueDate: '2026-07-17', updatedAt: '2026-07-16T15:00:00Z',
        },
        {
          id: 'approval-old', projectId: 'p1', selectionId: 'selection-approval', itemType: 'approval',
          audience: 'customer', status: 'response_requested', title: 'Old approval request',
          dueDate: '2026-07-14', updatedAt: '2026-07-15T15:00:00Z',
        },
        {
          id: 'portal-overdue', projectId: 'p1', itemType: 'request', audience: 'subcontractor',
          status: 'response_requested', title: 'Confirm mobilization', dueDate: '2026-07-15', updatedAt: '2026-07-16T14:00:00Z',
        },
        {
          id: 'portal-answered', projectId: 'p1', itemType: 'request', audience: 'customer',
          status: 'answered', title: 'Answered question', dueDate: '2026-07-14', updatedAt: '2026-07-16T13:00:00Z',
        },
      ];
      const pending = buildHomePendingDecisionExceptions(projects, portalItems, '2026-07-16');
      assert.equal(pending.length, 3);
      const byId = new Map(pending.map((item) => [item.id, item]));
      assert.equal(byId.get('selection-open').attentionReason, 'Selection needs a decision');
      assert.equal(byId.get('selection-open').ownerLabel, 'Unassigned');
      assert.equal(byId.get('selection-approval').attentionReason, 'Customer approval is pending');
      assert.equal(byId.get('selection-approval').ownerLabel, 'Customer');
      assert.equal(byId.get('portal-overdue').attentionReason, 'Portal response is overdue');
      assert.equal(byId.get('portal-overdue').attentionTone, 'danger');
      assert.ok(!byId.has('approval-current'));
      assert.ok(!byId.has('approval-old'));
      assert.ok(!byId.has('portal-answered'));

      const withoutSelections = buildHomePendingDecisionExceptions(
        projects,
        portalItems,
        '2026-07-16',
        { includeSelections: false },
      );
      assert.deepEqual(withoutSelections.map((item) => item.id).sort(), ['approval-current', 'portal-overdue']);
      const actions = buildHomeActionCenterItems({ pendingDecisions: pending });
      assert.deepEqual(actions.map((action) => action.projectName), ['Maple House', 'Maple House', 'Maple House']);
      assert.ok(actions.every((action) => ['warning', 'danger'].includes(action.tone)));
    },
  },
  {
    name: 'home action center includes only overdue unresolved RFIs and submittals with actionable owners',
    run() {
      const projects = [{ id: 'p1', name: 'Maple House' }];
      const rfis = [
        { id: 'rfi-open', projectId: 'p1', number: 'RFI-001', title: 'Beam size', status: 'open', dueDate: '2026-07-15', responsibleName: 'Project Engineer' },
        { id: 'rfi-answered', projectId: 'p1', number: 'RFI-002', title: 'Door detail', status: 'answered', dueDate: '2026-07-14', responsibleName: 'Architect' },
        { id: 'rfi-draft', projectId: 'p1', number: 'RFI-003', title: 'Draft question', status: 'draft', dueDate: '2026-07-13' },
        { id: 'rfi-today', projectId: 'p1', number: 'RFI-004', title: 'Due today', status: 'open', dueDate: '2026-07-16' },
      ];
      const submittals = [
        { id: 'sub-review', projectId: 'p1', number: 'SUB-001', title: 'Windows', status: 'under_review', dueDate: '2026-07-14', reviewer: 'Architect', subcontractorName: 'Window Co' },
        { id: 'sub-resubmit', projectId: 'p1', number: 'SUB-002', title: 'Roofing', status: 'revise_resubmit', dueDate: '2026-07-13', reviewer: 'Architect', subcontractorName: 'Roofing Co' },
        { id: 'sub-rejected', projectId: 'p1', number: 'SUB-003', title: 'Hardware', status: 'rejected', dueDate: '2026-07-12', subcontractorName: '' },
        { id: 'sub-approved', projectId: 'p1', number: 'SUB-004', title: 'Tile', status: 'approved', dueDate: '2026-07-11', reviewer: 'Designer' },
        { id: 'sub-draft', projectId: 'p1', number: 'SUB-005', title: 'Draft package', status: 'draft', dueDate: '2026-07-10' },
      ];
      const overdue = buildHomeOverdueDocumentExceptions(projects, rfis, submittals, '2026-07-16');
      assert.deepEqual(overdue.map((item) => item.id), ['rfi-open', 'sub-review', 'sub-resubmit', 'sub-rejected']);
      const byId = new Map(overdue.map((item) => [item.id, item]));
      assert.equal(byId.get('rfi-open').ownerLabel, 'Project Engineer');
      assert.equal(byId.get('rfi-open').attentionReason, 'RFI response is overdue');
      assert.equal(byId.get('sub-review').ownerLabel, 'Architect');
      assert.equal(byId.get('sub-review').attentionReason, 'Submittal review is overdue');
      assert.equal(byId.get('sub-resubmit').ownerLabel, 'Roofing Co');
      assert.equal(byId.get('sub-resubmit').attentionReason, 'Submittal resubmission is overdue');
      assert.equal(byId.get('sub-rejected').ownerLabel, 'Unassigned');
      const actions = buildHomeActionCenterItems({ overdueDocuments: overdue });
      assert.ok(actions.every((action) => action.tone === 'danger' && action.projectName === 'Maple House'));
      assert.deepEqual(actions.map((action) => action.status).sort(), ['open', 'rejected', 'revise_resubmit', 'under_review'].sort());
    },
  },
  {
    name: 'home action center reports threshold-free change-order and budget exceptions without resolved history',
    run() {
      const projects = [{ id: 'p1', name: 'Maple House' }];
      const changeOrders = [
        { id: 'co-overdue', projectId: 'p1', number: 'CO-001', title: 'Foundation change', status: 'proposed', dueDate: '2026-07-15' },
        { id: 'co-approved', projectId: 'p1', number: 'CO-002', title: 'Approved change', status: 'approved', dueDate: '2026-07-14' },
        { id: 'co-draft', projectId: 'p1', number: 'CO-003', title: 'Draft change', status: 'draft', dueDate: '2026-07-13' },
        { id: 'co-future', projectId: 'p1', number: 'CO-004', title: 'Future response', status: 'proposed', dueDate: '2026-07-17' },
      ];
      const budgetItems = [
        { id: 'budget-over', projectId: 'p1', number: '03', title: 'Concrete', status: 'active', originalBudget: 100, approvedChanges: 20, forecastCost: 130, actualCost: 140 },
        { id: 'budget-ok', projectId: 'p1', number: '04', title: 'Framing', status: 'active', originalBudget: 80, approvedChanges: 0, forecastCost: 75, actualCost: 70 },
        { id: 'budget-closed', projectId: 'p1', number: '05', title: 'Closed history', status: 'closed', originalBudget: 20, forecastCost: 40, actualCost: 50 },
      ];
      const commitments = [
        { id: 'commitment-issued', projectId: 'p1', number: 'COM-001', title: 'Concrete contract', status: 'issued', vendorName: 'Concrete Co', committedAmount: 100, paidAmount: 110, endDate: '2026-07-15' },
        { id: 'commitment-complete', projectId: 'p1', number: 'COM-002', title: 'Framing contract', status: 'complete', vendorName: 'Framing Co', committedAmount: 50, paidAmount: 55, endDate: '2026-07-14' },
        { id: 'commitment-proposed', projectId: 'p1', number: 'COM-003', title: 'Proposed contract', status: 'proposed', vendorName: 'Vendor', committedAmount: 100, paidAmount: 120, endDate: '2026-07-13' },
        { id: 'commitment-void', projectId: 'p1', number: 'COM-004', title: 'Void contract', status: 'void', committedAmount: 500, paidAmount: 600, endDate: '2026-07-12' },
      ];
      const exceptions = buildHomeFinancialExceptions(projects, changeOrders, budgetItems, commitments, '2026-07-16');
      assert.equal(exceptions.length, 7);
      assert.ok(!exceptions.some((item) => ['co-approved', 'co-draft', 'co-future', 'budget-closed', 'commitment-void'].includes(item.id)));
      const actions = buildHomeActionCenterItems({ financialExceptions: exceptions });
      assert.equal(actions.length, 5);
      const byId = new Map(actions.map((action) => [action.item.id, action]));
      assert.equal(byId.get('co-overdue').reason, 'Change-order response is overdue');
      assert.equal(byId.get('budget-over').reason, 'Actual cost exceeds current budget · Forecast exceeds current budget');
      assert.equal(byId.get('commitment-issued').reason, 'Commitment is past its end date · Payments exceed committed amount');
      assert.equal(byId.get('commitment-issued').owner, 'Concrete Co');
      assert.equal(byId.get('commitment-complete').reason, 'Payments exceed committed amount');
      assert.equal(byId.get('budget-summary-p1').reason, 'Commitments exceed current budget');
      assert.ok(actions.every((action) => action.tone === 'danger' && action.projectName === 'Maple House'));
    },
  },
  {
    name: 'home action center includes only overdue unresolved warranty and required closeout deadlines',
    run() {
      const projects = [{ id: 'p1', name: 'Maple House' }];
      const warrantyItems = [
        { id: 'war-open', projectId: 'p1', number: 'WAR-001', title: 'Door adjustment', status: 'open', dueDate: '2026-07-15', responsibleName: 'Finish Carpenter' },
        { id: 'war-progress', projectId: 'p1', number: 'WAR-002', title: 'HVAC callback', status: 'in_progress', dueDate: '2026-07-14', responsibleName: '' },
        { id: 'war-complete', projectId: 'p1', number: 'WAR-003', title: 'Resolved leak', status: 'completed', dueDate: '2026-07-13', responsibleName: 'Plumber' },
        { id: 'war-today', projectId: 'p1', number: 'WAR-004', title: 'Due today', status: 'scheduled', dueDate: '2026-07-16' },
      ];
      const closeoutItems = [
        { id: 'closeout-punch', projectId: 'p1', number: 'CLS-001', title: 'Paint touchups', category: 'Punch list', required: true, status: 'blocked', dueDate: '2026-07-13', responsibleName: 'Painter' },
        { id: 'closeout-doc', projectId: 'p1', number: 'CLS-002', title: 'Owner manuals', category: 'Document', required: true, status: 'in_progress', dueDate: '2026-07-14', responsibleName: 'Project Manager' },
        { id: 'closeout-optional', projectId: 'p1', number: 'CLS-003', title: 'Optional photos', category: 'Other', required: false, status: 'not_started', dueDate: '2026-07-12' },
        { id: 'closeout-complete', projectId: 'p1', number: 'CLS-004', title: 'Final inspection', category: 'Final inspection', required: true, status: 'complete', dueDate: '2026-07-11' },
        { id: 'closeout-na', projectId: 'p1', number: 'CLS-005', title: 'Training', category: 'Training', required: true, status: 'not_applicable', dueDate: '2026-07-10' },
      ];
      const exceptions = buildHomeWarrantyCloseoutExceptions(projects, warrantyItems, closeoutItems, '2026-07-16');
      assert.deepEqual(exceptions.map((item) => item.id), ['war-open', 'war-progress', 'closeout-punch', 'closeout-doc']);
      const actions = buildHomeActionCenterItems({ warrantyCloseoutExceptions: exceptions });
      const byId = new Map(actions.map((action) => [action.item.id, action]));
      assert.equal(byId.get('war-open').owner, 'Finish Carpenter');
      assert.equal(byId.get('war-progress').owner, 'Unassigned');
      assert.equal(byId.get('war-open').reason, 'Warranty target date is overdue');
      assert.equal(byId.get('closeout-punch').reason, 'Punch-list deadline is overdue');
      assert.equal(byId.get('closeout-doc').reason, 'Closeout deadline is overdue');
      assert.ok(actions.every((action) => action.tone === 'danger' && action.projectName === 'Maple House'));
    },
  },
  {
    name: 'home action center includes only visible offline sync failures with review-safe details',
    run() {
      const projects = [{ id: 'p1', name: 'Maple House' }];
      const operations = [
        { id: 'offline-task', projectId: 'p1', kind: 'task.save', entityId: 'task-1', status: 'needs-attention', payload: { label: 'Order windows' }, lastError: 'private server detail' },
        { id: 'offline-delete', projectId: 'p1', kind: 'inspection.save', entityId: 'inspection-1', action: 'delete', status: 'needs-attention', payload: { subcode: 'FRAME-220' } },
        { id: 'offline-pending', projectId: 'p1', kind: 'daily-log.save', entityId: 'log-1', status: 'pending', payload: { date: '2026-07-15' } },
        { id: 'offline-hidden', projectId: 'p2', kind: 'warranty-item.save', entityId: 'war-1', status: 'needs-attention', payload: { number: 'WAR-001', title: 'Hidden' } },
      ];
      const exceptions = buildHomeOfflineSyncExceptions(projects, operations, 'Aaron Admin');
      assert.deepEqual(exceptions.map((item) => item.id), ['offline-task', 'offline-delete']);
      assert.equal(exceptions[0].label, 'Order windows');
      assert.equal(exceptions[1].label, 'Delete FRAME-220');
      assert.ok(exceptions.every((item) => item.ownerLabel === 'Aaron Admin' && item.status === 'Needs attention'));
      assert.ok(exceptions.every((item) => !Object.hasOwn(item, 'lastError')));
      const actions = buildHomeActionCenterItems({ offlineSyncExceptions: exceptions });
      assert.ok(actions.every((action) => action.reason === 'Device-saved change failed to sync' && action.tone === 'danger'));
    },
  },
  {
    name: 'home prioritizes overdue blocked and upcoming work with operational project health',
    async run() {
      const homeSource = await readFile(new URL('../src/components/NativeHomeView.jsx', import.meta.url), 'utf8');
      const projects = [{
        id: 'p1',
        name: 'Lake House',
        status: 'active',
        inspections: [
          { id: 'i-old', date: '2026-07-15', status: 'requested', inspectionType: 'Framing' },
          { id: 'i-next', date: '2026-07-18', status: 'requested', inspectionType: 'Electric' },
        ],
        phases: [{
          id: 'phase-1',
          name: 'Roughs',
          steps: [
            { id: 'step-1', name: 'Plumbing', start: '2026-07-14', end: '2026-07-15', status: 'active' },
            { id: 'step-2', name: 'Electric', start: '2026-07-16', end: '2026-07-18', predecessors: [{ id: 'step-1', lag: 0 }] },
          ],
        }],
      }];
      const tasks = [
        { id: 'overdue', projectId: 'p1', label: 'Order wire', due: '2026-07-15', done: false, assignees: ['Alex'] },
        { id: 'upcoming', projectId: 'p1', label: 'Confirm trim', due: '2026-07-20', done: false, assignees: ['Alex'] },
        { id: 'unassigned', projectId: 'p1', label: 'Call inspector', due: '', done: false, assignees: [] },
      ];
      const attention = buildHomeAttentionSummary(projects, tasks, '2026-07-16', tasks);
      const actions = buildHomeActionCenterItems(attention);
      const range = buildHomeRangeSummary(projects, tasks, '2026-07-17', '2026-07-23');
      const health = getProjectOperationalHealth(projects[0], tasks, '2026-07-16');
      assert.deepEqual(attention.overdueTasks.map((item) => item.id), ['overdue']);
      assert.deepEqual(attention.overdueInspections.map((item) => item.id), ['i-old']);
      assert.deepEqual(attention.blockedSteps.map((item) => item.id), ['step-2']);
      assert.deepEqual(attention.unassignedTasks.map((item) => item.id), ['unassigned']);
      assert.deepEqual(actions.map((action) => action.item.id), ['overdue', 'i-old', 'step-2', 'unassigned']);
      assert.deepEqual(actions.map((action) => action.owner), ['Alex', 'Unassigned', 'Unassigned', 'Unassigned']);
      assert.deepEqual(actions.map((action) => action.reason), [
        'Task is past due',
        'Inspection is past due',
        'Schedule is blocked or delayed',
        'Work has no owner',
      ]);
      const multiReasonTask = { ...tasks[2], type: 'task', projectName: 'Lake House', attentionKind: 'Overdue' };
      const deduplicatedActions = buildHomeActionCenterItems({
        overdueTasks: [multiReasonTask],
        unassignedTasks: [multiReasonTask],
      });
      assert.equal(deduplicatedActions.length, 1);
      assert.equal(deduplicatedActions[0].reason, 'Task is past due · Work has no owner');
      assert.deepEqual(range.openTasks.map((item) => item.id), ['upcoming']);
      assert.equal(health.tone, 'attention');
      assert.equal(health.issueCount, 3);
      assert.match(homeSource, /Action center/);
      assert.match(homeSource, /Work item.*Project.*Owner.*Due.*Reason.*Status.*Actions/);
      assert.match(homeSource, /Next 7 days/);
      assert.match(homeSource, /QuickTaskForm/);
      assert.match(homeSource, /Mark .* complete/);
      assert.match(homeSource, /cx_home_weather_visible/);
    },
  },
  {
    name: 'home workspace is lazy loaded, navigable, and responsive',
    async run() {
      const [appSource, styleSource, detailSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(appSource, /const NativeHomeView = lazy/);
      assert.match(appSource, /id: 'home'/);
      assert.match(appSource, /if \(activeTab === 'home'\)/);
      assert.match(styleSource, /\.home-day-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*\.home-day-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
      assert.match(detailSource, /'inspections'/);
    },
  },
  {
    name: 'custom schedule colors always receive a readable foreground',
    run() {
      const backgrounds = ['#ffffff', '#000000', '#ffff00', '#2f6f8f', '#c54f7c', '#abc', '#1234'];
      backgrounds.forEach((background) => {
        const foreground = getReadableTextColor(background);
        assert.ok(getContrastRatio(background, foreground) >= 4.5, `${background} does not have readable text`);
      });
      assert.equal(getReadableTextColor('#ffffff'), '#000000');
      assert.equal(getReadableTextColor('#000000'), '#ffffff');
      assert.equal(getReadableTextColor('not-a-color'), '#ffffff');
    },
  },
  {
    name: 'small screens and touch pointers expose full-size non-hover interaction targets',
    async run() {
      const [styleSource, tokenSource] = await Promise.all([
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/design-tokens.css', import.meta.url), 'utf8'),
      ]);
      assert.match(tokenSource, /--touch-target-size:\s*44px/);
      assert.match(styleSource, /@media \(max-width: 720px\), \(hover: none\) and \(pointer: coarse\)/);
      assert.match(styleSource, /\.top-level-schedule-page \.gantt-icon-button\s*\{\s*opacity:\s*1;/s);
      assert.match(styleSource, /\.gantt-connect-handle::after\s*\{/);
      assert.match(styleSource, /\.files-tree-toggle,[\s\S]*?min-width:\s*var\(--touch-target-size\)/s);
      assert.match(styleSource, /\.workspace-content-main :where\([\s\S]*?\.mobile-filter-menu-trigger,[\s\S]*?background:\s*transparent !important;/s);
      assert.match(styleSource, /\.files-list-row \.gantt-icon-button \.fluent-icon,[\s\S]*?width:\s*44px;[\s\S]*?font-size:\s*44px !important;/s);
      assert.doesNotMatch(styleSource, /\.material-top-app-bar[\s\S]{0,240}font-size:\s*44px !important;/s);
      assert.match(styleSource, /\.task-row-card \.task-attachment-list-inline,[\s\S]*?\.task-row-card > \.task-row-actions\s*\{[\s\S]*?grid-column:\s*1;/s);
      assert.match(styleSource, /\.task-row-card > \.task-row-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;/s);
    },
  },
  {
    name: 'server-backed file settings and inspection actions expose visible mutation states',
    async run() {
      const [appSource, filesSource, settingsSource, inspectionsSource, trackerSource, styleSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeInspectionsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(filesSource, /uploading \? ' is-loading'/);
      assert.match(filesSource, /aria-busy=\{uploading\}/);
      assert.match(filesSource, /await runFilesMutation\(\['folder', 'create'\]/);
      assert.match(settingsSource, /schedulingSaving \? ' is-loading'/);
      assert.match(settingsSource, /Saving display settings\.\.\./);
      assert.match(inspectionsSource, /\['inspection-preview', inspection\.id, field\]/);
      assert.match(inspectionsSource, /inspection-thumbnail-button\$\{isMutating/);
      assert.match(trackerSource, /inviteAuthUser[\s\S]*fetchAuthorizedSupabase\('\/functions\/v1\/create-auth-user'/);
      assert.match(trackerSource, /inviteAuthUser[\s\S]*Your sign-in session is missing/);
      assert.match(trackerSource, /inviteAuthUser[\s\S]*Unable to reach the login invite service/);
      assert.match(trackerSource, /refresh token not found\|invalid refresh token/);
      assert.match(trackerSource, /writeAuthSession\(null\)/);
      assert.match(trackerSource, /Your login session expired\. Sign out, then sign in again before sending the invite\./);
      assert.match(appSource, /\['recovery', 'invite'\]\.includes\(recoverySession\?\.type\)/);
      assert.match(trackerSource, /error_description/);
      assert.match(trackerSource, /Authentication callback error/);
      assert.match(styleSource, /\.button\.is-loading > \.fluent-icon/);
      assert.match(styleSource, /\.inspection-thumbnail-button\.is-loading::after/);
    },
  },
  {
    name: 'settings are divided into responsive administration sections',
    async run() {
      const [settingsSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      for (const section of ['scheduling', 'calendar', 'inspections', 'notifications', 'users', 'audit', 'display', 'system']) {
        assert.match(settingsSource, new RegExp(`id: '${section}'`));
        assert.match(settingsSource, new RegExp(`settings-panel-${section}`));
      }
      assert.match(settingsSource, /role="tablist"\s+aria-label="Settings sections"/);
      assert.match(settingsSource, /className="settings-section-select"/);
      assert.match(settingsSource, /activeSettingsSection !== 'audit'/);
      assert.match(settingsSource, /settings-system-status-grid/);
      assert.ok(settingsSource.indexOf('className="user-project-access"') < settingsSource.indexOf('className="user-role-actions"'));
      assert.match(styleSource, /\.settings-section-tabs/);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*\.settings-section-tabs[\s\S]*display: none;/);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*\.settings-section-select[\s\S]*display: grid;/);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*\.user-role-actions[\s\S]*flex-wrap: nowrap;/);
    },
  },
  {
    name: 'schedule steps and standalone tasks use distinct user-facing terminology',
    async run() {
      const [dialogsSource, scheduleSource, projectsSource, settingsSource] = await Promise.all([
        readFile(new URL('../src/components/ScheduleDialogs.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(dialogsSource, /Schedule step color/);
      assert.match(dialogsSource, /Save schedule step/);
      assert.doesNotMatch(dialogsSource, />Task color</);
      assert.match(scheduleSource, /Standalone tasks/);
      assert.match(scheduleSource, /label="Schedule steps"/);
      assert.match(projectsSource, /label="Standalone tasks"/);
      assert.match(settingsSource, /Show standalone task due dates in Gantt/);
    },
  },
  {
    name: 'foundational design values live in a dedicated token layer',
    async run() {
      const [mainSource, tokenSource, styleSource] = await Promise.all([
        readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/design-tokens.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.ok(mainSource.indexOf("./design-tokens.css") < mainSource.indexOf("./styles.css"));
      for (const token of [
        '--font-family-base', '--font-size-base', '--space-4', '--surface', '--on-brand',
        '--mobile-app-bar', '--touch-target-size', '--button-radius', '--panel-radius', '--transition-fast',
      ]) {
        assert.match(tokenSource, new RegExp(`${token}:`), `${token} is missing`);
      }
      assert.doesNotMatch(styleSource, /^:root\s*\{/m);
      assert.match(styleSource, /border-radius:\s*var\(--panel-radius\)/);
      assert.match(styleSource, /background:\s*var\(--mobile-app-bar\)/);
    },
  },
  {
    name: 'mobile project menu remains available while the workspace scrolls',
    async run() {
      const [appSource, styleSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(appSource, /className="button secondary mobile-project-drawer-trigger"/);
      assert.match(styleSource, /@media \(max-width: 960px\)[\s\S]*?\.mobile-project-drawer-trigger\s*\{[^}]*position:\s*sticky;[^}]*top:\s*74px;[^}]*z-index:\s*79;/s);
      assert.match(styleSource, /@media \(max-width: 720px\)\s*\{\s*\.mobile-project-drawer-trigger\s*\{\s*top:\s*56px;/s);
    },
  },
  {
    name: 'tasks filter by assignee and preserve the selection in saved filters',
    async run() {
      const tasksSource = await readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8');
      assert.match(tasksSource, /const \[assigneeFilter, setAssigneeFilter\] = useState\('all'\)/);
      assert.match(tasksSource, /assigneeFilter === '__unassigned__'/);
      assert.match(tasksSource, /<span>Assignee<\/span>/);
      assert.match(tasksSource, /<option value="all">All assignees<\/option>/);
      assert.match(tasksSource, /<option value="__unassigned__">Unassigned<\/option>/);
      assert.match(tasksSource, /currentValue=\{\{ projectId: projectFilter, status: statusFilter, assignee: assigneeFilter, groupBy \}\}/);
      assert.match(tasksSource, /all: assigneeScopedTasks\.length/);
      assert.match(tasksSource, /<option value="project">Project<\/option>/);
      assert.match(tasksSource, /groupBy === 'project'[\s\S]*?projectMap\.get\(key\)\?\.name \|\| 'No project assigned'/s);
      assert.match(tasksSource, /setGroupBy\(\['project', 'assignee'\]\.includes\(filter\.groupBy\)/);
    },
  },
  {
    name: 'entity mutation keys normalize consistently',
    run() {
      assert.equal(normalizeMutationKey(['project', 'p1', '', 'step', 's1']), 'project:p1:step:s1');
      assert.equal(normalizeMutationKey('task:t1'), 'task:t1');
      assert.equal(normalizeMutationKey(null), 'default');
    },
  },
  {
    name: 'workspace components use keyed mutations instead of global saving flags',
    async run() {
      const componentNames = [
        'NativeTasksView', 'NativePeopleView', 'NativeProjectsView', 'NativeScheduleView',
        'NativeInspectionsView', 'NativeSettingsView', 'ProjectFilesManager',
        'ProjectPhotosManager', 'ProjectSelectionsManager',
      ];
      const sources = await Promise.all(componentNames.map(async (name) => ({
        name,
        source: await readFile(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8'),
      })));
      sources.forEach(({ name, source }) => {
        assert.doesNotMatch(source, /\[saving,\s*setSaving\]/, `${name} still has a global saving flag`);
        assert.match(source, /useEntityMutations/, `${name} is missing keyed mutation state`);
      });
    },
  },
  {
    name: 'project access normalization removes blanks and duplicates',
    run() {
      assert.deepEqual(normalizeProjectAccessUserIds(['user-1', ' user-1 ', '', null, 'user-2']), ['user-1', 'user-2']);
    },
  },
  {
    name: 'project and task visibility follows role and project assignments',
    run() {
      const projects = [
        { id: 'open', accessUserIds: [] },
        { id: 'assigned', accessUserIds: ['user-1'] },
        { id: 'other', accessUserIds: ['user-2'] },
      ];
      const editVisible = getVisibleProjectsForUser(projects, {}, { id: 'user-1', role: 'Edit' });
      const customerVisible = getVisibleProjectsForUser(projects, {}, { id: 'user-1', role: 'Customer' });
      assert.deepEqual(editVisible.map((project) => project.id), ['open', 'assigned']);
      assert.deepEqual(customerVisible.map((project) => project.id), ['assigned']);
      assert.deepEqual(
        getVisibleTasksForUser(
          [{ id: 'general', projectId: '' }, { id: 'visible', projectId: 'assigned' }, { id: 'hidden', projectId: 'other' }],
          {},
          customerVisible,
        ).map((task) => task.id),
        ['general', 'visible'],
      );
    },
  },
  {
    name: 'assignee helpers deduplicate labels and prefer records with email',
    run() {
      const subs = [{ first: 'Alex', last: 'Smith', company: 'Build Co', email: '' }];
      const employees = [
        { first: 'Alex', last: 'Smith', company: 'Build Co', email: 'alex@example.com' },
        { first: 'Jamie', last: 'Jones', company: '', email: 'jamie@example.com' },
      ];
      assert.deepEqual(buildTaskAssigneeOptions(subs, employees), ['Alex Smith (Build Co)', 'Jamie Jones']);
      assert.equal(buildTaskAssigneeDirectory(subs, employees).get('Alex Smith (Build Co)').email, 'alex@example.com');
    },
  },
  {
    name: 'workspaces, project tabs, and modal suites remain lazy-loaded',
    async run() {
      const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
      const projectDetailSource = await readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8');
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      for (const moduleName of ['NativeProjectsView', 'NativeScheduleView', 'NativeTasksView', 'NativePeopleView', 'NativeSettingsView']) {
        assert.match(appSource, new RegExp(`const ${moduleName} = lazy\\(`));
      }
      for (const moduleName of ['NativeTasksView', 'ProjectDetailCalendar', 'ProjectFilesManager', 'ProjectPhotosManager', 'ProjectSelectionsManager']) {
        assert.match(projectDetailSource, new RegExp(`const ${moduleName} = lazy\\(`));
      }
      for (const moduleName of ['ScheduleItemModal', 'DelayModal', 'DependencyModal', 'TaskModal', 'InspectionModal', 'PersonModal']) {
        assert.match(scheduleSource, new RegExp(`const ${moduleName} = lazy\\(`));
      }
      assert.match(appSource, /import\('\.\/services\/trackerData\.js'\)/);
      assert.doesNotMatch(appSource, /from ['"]\.\/services\/trackerData\.js['"]/);
      assert.match(appSource, /<Suspense/);
      assert.match(appSource, /Loading workspace/);
    },
  },
  {
    name: 'long lists render a buffered window while preserving full scroll height',
    run() {
      const range = calculateVirtualRange({
        count: 1000,
        getSize: () => 50,
        scrollOffset: 20000,
        viewportSize: 500,
        overscan: 100,
        threshold: 40,
      });
      assert.equal(range.virtualized, true);
      assert.ok(range.startIndex > 0);
      assert.ok(range.endIndex < 1000);
      assert.equal(range.totalSize, 50000);
      assert.equal(range.beforeSize + (range.endIndex - range.startIndex) * 50 + range.afterSize, 50000);
    },
  },
  {
    name: 'tasks people and Gantt use the shared virtual range',
    async run() {
      const sources = await Promise.all(
        ['NativeTasksView', 'NativePeopleView', 'NativeScheduleView']
          .map((name) => readFile(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8')),
      );
      sources.forEach((source) => assert.match(source, /useVirtualRange/));
      assert.match(sources[0], /VirtualTaskRows/);
      assert.match(sources[1], /visiblePeople/);
      assert.match(sources[2], /visibleGanttRows/);
      assert.match(sources[2], /visibleTimelineDays/);
      assert.match(sources[2], /visibleTimelineWeeks/);
    },
  },
  {
    name: 'Gantt date elements are limited to the horizontal viewport with overscan',
    run() {
      const window = calculateHorizontalWindow({
        contentSize: 12000,
        scrollOffset: 4800,
        viewportSize: 1200,
        overscan: 300,
      });
      assert.deepEqual(window, { start: 4500, end: 6300, virtualized: true });
      assert.equal(timelineItemIntersectsWindow({ left: 40, width: 1 }, window, 12000), true);
      assert.equal(timelineItemIntersectsWindow({ left: 10, width: 1 }, window, 12000), false);
      assert.equal(timelineItemIntersectsWindow({ left: 52, width: 4 }, window, 12000), true);
    },
  },
  {
    name: 'destructive actions expose a recoverable undo window',
    async run() {
      const dialogSource = await readFile(new URL('../src/components/AppDialogs.jsx', import.meta.url), 'utf8');
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const destructiveViews = await Promise.all(
        ['NativeTasksView', 'NativeScheduleView', 'NativeProjectsView', 'ProjectFilesManager', 'ProjectPhotosManager']
          .map((name) => readFile(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8')),
      );

      assert.match(dialogSource, /export function showUndoAction/);
      assert.match(dialogSource, /role="status"/);
      assert.match(dialogSource, /['"]Undo['"]/);
      assert.match(dialogSource, /onCommit/);
      assert.match(trackerSource, /options\.preserveAttachments/);
      destructiveViews.forEach((source) => assert.match(source, /showUndoAction/));
    },
  },
  {
    name: 'Android downloads offer Open Save and Share with visible progress',
    async run() {
      const dialogSource = await readFile(new URL('../src/components/AppDialogs.jsx', import.meta.url), 'utf8');
      const downloadSource = await readFile(new URL('../src/utils/downloadUi.js', import.meta.url), 'utf8');
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const nativeSource = await readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/DownloadsPlugin.java', import.meta.url), 'utf8');
      const activitySource = await readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/MainActivity.java', import.meta.url), 'utf8');

      assert.match(dialogSource, /export function beginDownloadProgress/);
      assert.match(dialogSource, /className="download-progress-bar"/);
      assert.match(downloadSource, /label: 'Open file'/);
      assert.match(downloadSource, /label: 'Save to Downloads'/);
      assert.match(downloadSource, /label: 'Share'/);
      assert.match(trackerSource, /response\.body\.getReader\(\)/);
      assert.match(trackerSource, /onProgress\(loaded, total\)/);
      assert.match(nativeSource, /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/);
      assert.match(nativeSource, /Environment\.DIRECTORY_DOWNLOADS/);
      assert.match(nativeSource, /Intent\.ACTION_VIEW/);
      assert.match(nativeSource, /FileProvider\.getUriForFile/);
      assert.match(activitySource, /registerPlugin\(DownloadsPlugin\.class\)/);
    },
  },
  {
    name: 'Android launcher icon uses the brand mark and adaptive icon layers',
    async run() {
      const buildSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
      const adaptiveSource = await readFile(new URL('../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', import.meta.url), 'utf8');
      const backgroundSource = await readFile(new URL('../android/app/src/main/res/values/ic_launcher_background.xml', import.meta.url), 'utf8');
      const generatorSource = await readFile(new URL('./generate_android_icons.py', import.meta.url), 'utf8');
      assert.match(buildSource, /versionCode 5/);
      assert.match(buildSource, /versionName "1\.4\.0"/);
      assert.match(buildSource, /signingConfigs \{/);
      assert.match(buildSource, /signingConfig signingConfigs\.release/);
      assert.match(buildSource, /ANDROID_RELEASE_KEYSTORE_PATH/);
      assert.match(buildSource, /Release signing is not configured/);
      assert.match(adaptiveSource, /<foreground android:drawable="@mipmap\/ic_launcher_foreground"\/>/);
      assert.match(adaptiveSource, /<monochrome android:drawable="@mipmap\/ic_launcher_foreground"\/>/);
      assert.match(backgroundSource, /#444A80/);
      assert.match(generatorSource, /destiny-logo\.png/);
      assert.match(generatorSource, /ic_launcher_round\.png/);
    },
  },
  {
    name: 'tasks support native sharing and reviewed multi-task share or email',
    async run() {
      const [tasksSource, rowSource, platformSource, dialogSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/TaskRow.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/platform/platformAdapter.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/FormDialogs.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      const content = buildTaskShareContent(
        [
          { id: 'task-1', label: 'Frame walls', projectId: 'project-1', due: '2026-08-05', assignees: ['Alex Smith'], done: false },
          { id: 'task-2', label: 'Close permit', projectId: 'project-2', due: '', assignees: [], done: true },
        ],
        [{ id: 'project-1', name: 'Lake House' }, { id: 'project-2', name: 'Hill House' }],
      );
      assert.equal(content.title, '2 Project Tracker tasks');
      assert.match(content.body, /1\. Frame walls/);
      assert.match(content.body, /Project: Lake House/);
      assert.match(content.body, /Due date: Aug 5, 2026/);
      assert.match(content.body, /2\. Close permit/);
      assert.match(content.body, /Status: Completed/);
      assert.equal((content.body.match(/Due date:/g) || []).length, 1);
      assert.doesNotMatch(content.body, /No due date/);
      const commonContent = buildTaskShareContent(
        [
          { id: 'task-3', label: 'Install trim', projectId: 'project-1', due: '2026-08-06', assignees: ['Alex Smith'], done: false },
          { id: 'task-4', label: 'Install doors', projectId: 'project-1', due: '', assignees: ['Alex Smith'], done: false },
        ],
        [{ id: 'project-1', name: 'Lake House' }],
      );
      assert.equal((commonContent.body.match(/Project: Lake House/g) || []).length, 1);
      assert.equal((commonContent.body.match(/Assignee: Alex Smith/g) || []).length, 1);
      assert.equal((commonContent.body.match(/Status: Open/g) || []).length, 1);
      assert.equal((commonContent.body.match(/Due date:/g) || []).length, 1);
      assert.match(commonContent.body, /Project: Lake House\nAssignee: Alex Smith\nStatus: Open\n\nTasks:/);
      const groupedContent = buildTaskShareContent(
        [
          { id: 'task-5', label: 'First task', projectId: 'project-1', due: '', assignees: ['Alex Smith', 'Jamie Reed'], done: false },
          { id: 'task-6', label: 'Second task', projectId: 'project-1', due: '', assignees: ['Jamie Reed', 'Alex Smith'], done: false },
          { id: 'task-7', label: 'Third task', projectId: 'project-2', due: '', assignees: ['Taylor Jones'], done: false },
          { id: 'task-8', label: 'Fourth task', projectId: 'project-2', due: '', assignees: ['Taylor Jones'], done: false },
        ],
        [{ id: 'project-1', name: 'Lake House' }, { id: 'project-2', name: 'Hill House' }],
      );
      assert.equal((groupedContent.body.match(/Project: Lake House/g) || []).length, 1);
      assert.equal((groupedContent.body.match(/Project: Hill House/g) || []).length, 1);
      assert.equal((groupedContent.body.match(/Assignees: Alex Smith, Jamie Reed/g) || []).length, 1);
      assert.equal((groupedContent.body.match(/Assignee: Taylor Jones/g) || []).length, 1);
      assert.equal((groupedContent.body.match(/Status: Open/g) || []).length, 1);
      assert.doesNotMatch(groupedContent.body, /No due date/);
      const mixedStatusContent = buildTaskShareContent(
        [
          { id: 'task-9', label: 'Open one', projectId: 'project-1', due: '', assignees: ['Alex Smith'], done: false },
          { id: 'task-10', label: 'Done one', projectId: 'project-1', due: '', assignees: ['Alex Smith'], done: true },
          { id: 'task-11', label: 'Open two', projectId: 'project-1', due: '', assignees: ['Alex Smith'], done: false },
        ],
        [{ id: 'project-1', name: 'Lake House' }],
      );
      assert.equal((mixedStatusContent.body.match(/Status: Open/g) || []).length, 1);
      assert.equal((mixedStatusContent.body.match(/Status: Completed/g) || []).length, 1);
      assert.match(mixedStatusContent.body, /Status: Open\n1\. Open one\n\n2\. Open two\n\nStatus: Completed\n3\. Done one/);
      assert.match(tasksSource, /buildTaskShareContent\(openTasks, visibleProjects\)\.body/);
      assert.match(tasksSource, /const \[selectedTaskIds, setSelectedTaskIds\] = useState/);
      assert.match(tasksSource, /Select all visible/);
      assert.match(tasksSource, /handleShareTasks\(selectedTasks\)/);
      assert.match(tasksSource, /handleEmailSelectedTasks/);
      assert.match(tasksSource, /showShare=\{nativeAndroid\}/);
      assert.match(rowSource, /aria-label=\{`Share \$\{task\.label\}`\}/);
      assert.match(rowSource, /aria-pressed=\{selected\}/);
      assert.match(platformSource, /export async function shareText/);
      assert.match(platformSource, /await Share\.share\(\{ title, text, dialogTitle \}\)/);
      assert.match(platformSource, /navigator\.clipboard\.writeText/);
      assert.match(dialogSource, /multiple=\{draft\.allowMultiple === true\}/);
      assert.match(styleSource, /\.task-bulk-toolbar/);
      assert.match(styleSource, /\.task-row-card\.selected-for-sharing/);
    },
  },
  {
    name: 'Android quick actions sharing file actions and camera capture stay connected',
    async run() {
      const [
        manifestSource,
        shortcutsSource,
        intentPluginSource,
        activitySource,
        appSource,
        platformSource,
        filesSource,
        photosSource,
        workflowSource,
        inspectionDialogSource,
        selectionDialogSource,
      ] = await Promise.all([
        readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8'),
        readFile(new URL('../android/app/src/main/res/xml/shortcuts.xml', import.meta.url), 'utf8'),
        readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/AndroidIntentsPlugin.java', import.meta.url), 'utf8'),
        readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/MainActivity.java', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/platform/platformAdapter.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectPhotosManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectWorkflowManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/TaskInspectionDialogs.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/SelectionModal.jsx', import.meta.url), 'utf8'),
      ]);

      assert.match(manifestSource, /android\.intent\.action\.SEND/);
      assert.match(manifestSource, /android:mimeType="image\/\*"/);
      assert.match(manifestSource, /android\.app\.shortcuts/);
      assert.match(manifestSource, /android:launchMode="singleTask"/);
      assert.match(shortcutsSource, /CREATE_TASK/);
      assert.match(shortcutsSource, /CREATE_INSPECTION/);
      assert.match(shortcutsSource, /CREATE_DAILY_LOG/);
      assert.match(activitySource, /registerPlugin\(AndroidIntentsPlugin\.class\)/);
      assert.match(activitySource, /onNewIntent\(Intent intent\)/);
      assert.match(activitySource, /getOnBackPressedDispatcher\(\)\.addCallback/);
      assert.match(activitySource, /bridge\.getWebView\(\)\.canGoBack\(\)/);
      assert.match(activitySource, /bridge\.getWebView\(\)\.goBack\(\)/);
      assert.match(activitySource, /moveTaskToBack\(true\)/);
      assert.match(intentPluginSource, /Intent\.ACTION_SEND/);
      assert.doesNotMatch(intentPluginSource, /actionPayload\("open-home"\)/);
      assert.match(intentPluginSource, /cacheSharedPhoto/);
      assert.match(intentPluginSource, /removeSharedFile/);
      assert.match(platformSource, /export async function addAndroidIntentListener/);
      assert.match(platformSource, /export async function readAndroidSharedPhoto/);
      assert.match(appSource, /detailAction: androidProjectPrompt\.type/);
      assert.match(appSource, /createRequest=\{androidTaskCreateRequest\}/);
      assert.match(appSource, /nativeAndroid \? 'home' : getTabFromLocation\(\)/);
      assert.match(appSource, /handlingPopStateRef/);
      assert.match(filesSource, /runAndroidFileAction\(file, 'open'\)/);
      assert.match(filesSource, /runAndroidFileAction\(file, 'share'\)/);
      assert.match(photosSource, /capture="environment"/);
      assert.match(workflowSource, /capture="environment"/);
      assert.match(inspectionDialogSource, /capture="environment"/);
      assert.match(selectionDialogSource, /capture="environment"/);
    },
  },
  {
    name: 'platform downloads sharing previews mail and navigation stay behind one adapter',
    async run() {
      const platformSource = await readFile(new URL('../src/platform/platformAdapter.js', import.meta.url), 'utf8');
      const fileSource = await readFile(new URL('../src/utils/fileUi.js', import.meta.url), 'utf8');
      const migratedSources = await Promise.all(
        [
          '../src/App.jsx',
          '../src/components/NativeProjectsView.jsx',
          '../src/components/NativeTasksView.jsx',
          '../src/components/NativePeopleView.jsx',
          '../src/components/NativeInspectionsView.jsx',
          '../src/components/ProjectPhotosManager.jsx',
          '../src/components/ProjectSelectionsManager.jsx',
        ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
      );

      assert.match(platformSource, /export async function deliverBlob/);
      assert.match(platformSource, /export function openPreview/);
      assert.match(platformSource, /export function openMailComposer/);
      assert.match(platformSource, /export function updateCurrentUrl/);
      assert.match(platformSource, /import\('@capacitor\/filesystem'\)/);
      assert.doesNotMatch(fileSource, /@capacitor|window\.|document\./);
      migratedSources.forEach((source) => assert.match(source, /platformAdapter\.js/));
    },
  },
  {
    name: 'query cache deduplicates reads retries failures and invalidates by prefix',
    async run() {
      const client = new QueryClient();
      let calls = 0;
      const query = () => client.query({
        key: ['tracker', 'data'],
        staleTime: 60000,
        retryDelay: 0,
        queryFn: async () => {
          calls += 1;
          await Promise.resolve();
          return { calls };
        },
      });
      const [first, concurrent] = await Promise.all([query(), query()]);
      assert.deepEqual(first, concurrent);
      assert.equal(calls, 1);
      assert.deepEqual(await query(), { calls: 1 });
      client.invalidateQueries(['tracker']);
      assert.deepEqual(await query(), { calls: 2 });

      let attempts = 0;
      const retried = await client.query({
        key: ['retry'],
        retry: 2,
        retryDelay: 0,
        queryFn: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error('temporary');
          return 'ready';
        },
      });
      assert.equal(retried, 'ready');
      assert.equal(attempts, 3);
      assert.equal(isRetryableQueryError({ status: 401 }), false);
      assert.equal(isRetryableQueryError(new Error('offline')), true);
    },
  },
  {
    name: 'query mutations expose scoped pending state and invalidate reads',
    async run() {
      const client = new QueryClient();
      client.setQueryData(['tracker', 'data'], { revision: 1 });
      await client.mutate({
        key: ['tracker', 'task', 'task-1'],
        invalidate: [['tracker']],
        mutationFn: async () => {
          assert.equal(client.getMutationState(['tracker', 'task']).pending, true);
          assert.equal(client.getMutationState(['tracker', 'task']).count, 1);
          return 'saved';
        },
      });
      assert.equal(client.getMutationState(['tracker', 'task']).pending, false);
      let refreshed = false;
      await client.query({
        key: ['tracker', 'data'],
        queryFn: async () => {
          refreshed = true;
          return { revision: 2 };
        },
      });
      assert.equal(refreshed, true);
    },
  },
  {
    name: 'projects tasks calendar and schedule expose named saved filters',
    async run() {
      const controlsSource = await readFile(new URL('../src/components/SavedFiltersControls.jsx', import.meta.url), 'utf8');
      const projectsSource = await readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8');
      const tasksSource = await readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8');
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');

      assert.match(controlsSource, /localStorage\.setItem\(storageKey/);
      assert.match(controlsSource, /Save current filter/);
      assert.match(controlsSource, /Delete saved filter/);
      assert.match(projectsSource, /saved-filters:projects/);
      assert.match(projectsSource, /projectStatusFilter/);
      assert.match(tasksSource, /saved-filters:tasks/);
      assert.match(tasksSource, /currentValue=\{\{ projectId: projectFilter, status: statusFilter, assignee: assigneeFilter, groupBy \}\}/);
      assert.match(scheduleSource, /saved-filters:schedule/);
      assert.match(scheduleSource, /saved-filters:calendar/);
      assert.match(scheduleSource, /calendarItemFilter/);
    },
  },
  {
    name: 'Android reminders include upcoming tasks inspections and overdue summaries',
    run() {
      const notifications = buildAndroidReminderNotifications({
        data: {
          settings: {},
          projects: [
            {
              id: 'project-1',
              name: 'Lake House',
              inspections: [
                { id: 'inspection-upcoming', date: '2026-07-14', status: 'scheduled', subcode: 'FRAME-220' },
                { id: 'inspection-overdue', date: '2026-07-12', status: 'requested', subcode: 'FOOT-101' },
                { id: 'inspection-passed', date: '2026-07-14', status: 'passed', subcode: 'ELEC-310' },
              ],
            },
          ],
          tasks: [
            { id: 'task-upcoming', projectId: 'project-1', label: 'Order windows', due: '2026-07-14', done: false },
            { id: 'task-overdue', projectId: 'project-1', label: 'Submit permit', due: '2026-07-12', done: false },
            { id: 'task-done', projectId: 'project-1', label: 'Completed work', due: '2026-07-14', done: true },
          ],
        },
        activeUser: { id: 'user-1', role: 'Admin' },
        preferences: {
          enabled: true,
          upcomingTasks: true,
          inspections: true,
          overdueWork: true,
          reminderDays: 1,
          reminderTime: '08:00',
        },
        now: new Date(2026, 6, 13, 7, 0, 0),
      });

      assert.deepEqual(notifications.map((notification) => notification.extra.kind), ['task', 'inspection', 'overdue']);
      assert.equal(notifications[0].schedule.at.getHours(), 8);
      assert.match(notifications[2].body, /1 overdue task/);
      assert.match(notifications[2].body, /1 overdue inspection/);
      notifications.forEach((notification) => assert.ok(notification.id >= 100_000_000 && notification.id <= 399_999_999));
    },
  },
  {
    name: 'Android reminders digest matching project work and use scoped channels',
    run() {
      const notifications = buildAndroidReminderNotifications({
        data: {
          settings: {},
          projects: [{ id: 'project-1', name: 'Lake House', inspections: [] }],
          tasks: [
            { id: 'task-1', projectId: 'project-1', label: 'Order windows', due: '2026-07-14', done: false },
            { id: 'task-2', projectId: 'project-1', label: 'Confirm delivery', due: '2026-07-14', done: false },
          ],
        },
        activeUser: { id: 'user-1', role: 'Admin' },
        preferences: { enabled: true, reminderDays: 1, reminderTime: '08:00' },
        now: new Date(2026, 6, 13, 7, 0, 0),
      });

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].extra.kind, 'task-summary');
      assert.equal(notifications[0].channelId, 'project-tasks-v2');
      assert.deepEqual(notifications[0].inboxList, ['Order windows', 'Confirm delivery']);
      assert.match(notifications[0].body, /Lake House/);
    },
  },
  {
    name: 'Android live notifications secure tokens and project delivery',
    async run() {
      const [pushSource, migrationSource, functionSource, appSource, manifestSource, ciWorkflowSource] = await Promise.all([
        readFile(new URL('../src/utils/androidPushNotifications.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260717070000_add_android_push_notifications.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/send-project-notification/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
      ]);

      assert.match(pushSource, /register_device_push_token/);
      assert.match(pushSource, /['"]Content-Type['"]:\s*['"]application\/json['"]/);
      assert.match(pushSource, /pushNotificationActionPerformed/);
      assert.match(migrationSource, /create table if not exists public\.device_push_tokens/);
      assert.match(migrationSource, /auth_user_id = auth\.uid\(\)/);
      assert.match(migrationSource, /public\.current_app_user_id\(\)/);
      assert.match(functionSource, /FIREBASE_SERVICE_ACCOUNT_JSON/);
      assert.match(functionSource, /project_user_access/);
      assert.match(functionSource, /visibility: 'PRIVATE'/);
      assert.match(appSource, /snoozeAndroidNotification/);
      assert.match(appSource, /actionId === 'mark-done'/);
      assert.match(appSource, /AndroidNotificationPreferences/);
      assert.match(appSource, /Notification settings/);
      assert.match(manifestSource, /android\.permission\.POST_NOTIFICATIONS/);
      assert.match(ciWorkflowSource, /VITE_SUPABASE_URL: \$\{\{ secrets\.VITE_SUPABASE_URL \}\}/);
      assert.match(ciWorkflowSource, /VITE_SUPABASE_KEY: \$\{\{ secrets\.VITE_SUPABASE_KEY \}\}/);
      assert.match(ciWorkflowSource, /Supabase Android client configuration is missing/);
      assert.match(ciWorkflowSource, /if \[ -z "\$VITE_SUPABASE_URL" \] \|\| \[ -z "\$VITE_SUPABASE_KEY" \]/);
      assert.match(ciWorkflowSource, /workflow_dispatch:/);
    },
  },
  {
    name: 'private Android releases are signed verified and published from protected main',
    async run() {
      const [workflowSource, gitignoreSource, releaseGuideSource, signingSetupSource] = await Promise.all([
        readFile(new URL('../.github/workflows/android-private-release.yml', import.meta.url), 'utf8'),
        readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
        readFile(new URL('../ANDROID_PRIVATE_RELEASE.md', import.meta.url), 'utf8'),
        readFile(new URL('./setup-android-release-signing.ps1', import.meta.url), 'utf8'),
      ]);

      assert.match(workflowSource, /workflow_dispatch:/);
      assert.match(workflowSource, /environment: production/);
      assert.match(workflowSource, /actions: read/);
      assert.match(workflowSource, /contents: write/);
      assert.match(workflowSource, /refs\/heads\/main/);
      assert.match(workflowSource, /--commit "\$GITHUB_SHA"/);
      assert.match(workflowSource, /exact main commit has not passed the complete push-triggered CI workflow/);
      assert.match(workflowSource, /ANDROID_RELEASE_KEYSTORE_BASE64: \$\{\{ secrets\.ANDROID_RELEASE_KEYSTORE_BASE64 \}\}/);
      assert.match(workflowSource, /ANDROID_RELEASE_STORE_PASSWORD: \$\{\{ secrets\.ANDROID_RELEASE_STORE_PASSWORD \}\}/);
      assert.match(workflowSource, /ANDROID_RELEASE_KEY_ALIAS: \$\{\{ secrets\.ANDROID_RELEASE_KEY_ALIAS \}\}/);
      assert.match(workflowSource, /ANDROID_RELEASE_KEY_PASSWORD: \$\{\{ secrets\.ANDROID_RELEASE_KEY_PASSWORD \}\}/);
      assert.match(workflowSource, /assembleRelease/);
      assert.match(workflowSource, /APKSIGNER="\$ANDROID_SDK_ROOT\/build-tools\/36\.0\.0\/apksigner"/);
      assert.match(workflowSource, /"\$APKSIGNER" verify --verbose/);
      assert.match(workflowSource, /Release APK is missing its Supabase project URL/);
      assert.match(workflowSource, /Release APK is missing its Supabase client key/);
      assert.match(workflowSource, /gh release create/);
      assert.match(workflowSource, /retention-days: 90/);
      assert.match(gitignoreSource, /^\*\.jks$/m);
      assert.match(gitignoreSource, /^\*\.keystore$/m);
      assert.match(releaseGuideSource, /GitHub Secrets are build inputs, not a recoverable backup/);
      assert.match(releaseGuideSource, /will not install over a debug-signed build/);
      assert.match(signingSetupSource, /must be stored outside the Git repository/);
      assert.match(signingSetupSource, /Read-Host .* -AsSecureString/);
      assert.match(signingSetupSource, /-storepass:env PROJECT_TRACKER_SIGNING_PASSWORD/);
      assert.match(signingSetupSource, /gh secret set ANDROID_RELEASE_KEYSTORE_BASE64/);
      assert.doesNotMatch(signingSetupSource, /Write-Output .*passwordValue/);
    },
  },
  {
    name: 'new task assignment emails use separate internal and external settings with server-side recipient enforcement',
    async run() {
      const [settingsSource, trackerSource, pushSource, functionSource, tasksSource, scheduleSource, appSource, projectDetailSource] = await Promise.all([
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/androidPushNotifications.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/send-project-notification/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
      ]);

      assert.match(settingsSource, /New task assignment emails/);
      assert.match(settingsSource, /Employees and administrators/);
      assert.match(settingsSource, /Subcontractors and suppliers/);
      assert.match(settingsSource, /emailNewTasksToInternalAssignees/);
      assert.match(settingsSource, /emailNewTasksToExternalAssignees/);
      assert.match(trackerSource, /emailNewTasksToInternalAssignees: false/);
      assert.match(trackerSource, /emailNewTasksToExternalAssignees: false/);
      assert.match(trackerSource, /assignees: eventKind === 'task-created'/);
      assert.match(trackerSource, /projectlessTaskCreation = event\?\.kind === 'task-created'/);
      assert.match(trackerSource, /project\?\.name \|\| 'General tasks'/);
      assert.match(pushSource, /assignees: Array\.isArray\(event\.assignees\)/);
      assert.match(pushSource, /projectlessTaskCreation = event\?\.kind === 'task-created'/);
      assert.match(functionSource, /admin\.from\('settings'\)/);
      assert.match(functionSource, /admin\.from\('people'\)/);
      assert.match(functionSource, /admin\.from\('tasks'\)/);
      assert.match(functionSource, /admin\.from\('task_assignments'\)/);
      assert.match(functionSource, /task_project_mismatch/);
      assert.match(functionSource, /\['sub', 'supplier'\]/);
      assert.match(functionSource, /\['Admin', 'Edit', 'View Only'\]/);
      assert.match(functionSource, /RESEND_API_KEY/);
      assert.match(functionSource, /TASK_ASSIGNMENT_EMAIL_FROM/);
      assert.match(functionSource, /https:\/\/api\.resend\.com\/emails/);
      assert.match(functionSource, /'Idempotency-Key'/);
      assert.match(functionSource, /buildTaskDeepLink/);
      assert.match(functionSource, /url\.searchParams\.set\('projectTab', 'tasks'\)/);
      assert.match(functionSource, /Open task in Destiny Project Hub/);
      assert.match(functionSource, /task_email\.projectless_task\.read/);
      assert.match(functionSource, /projectName: 'General tasks'/);
      assert.match(functionSource, /url\.searchParams\.set\('tab', projectId \? 'projects' : 'tasks'\)/);
      assert.match(appSource, /getTaskIdFromLocation/);
      assert.match(appSource, /hasTaskDeepLink \? \(linkedProjectId \? 'projects' : 'tasks'\) : 'home'/);
      assert.match(appSource, /activeTab !== 'tasks'/);
      assert.match(appSource, /token: `deep-link-\$\{taskId\}`/);
      assert.match(projectDetailSource, /getSearchParam\('task'\)/);
      assert.match(projectDetailSource, /deep-link-\$\{project\.id\}-\$\{taskId\}/);
      assert.match(tasksSource, /sendAssignmentNotifications: false/);
      assert.match(scheduleSource, /sendAssignmentNotifications: false/);
    },
  },
  {
    name: 'audit history expands project dates dependencies statuses and file changes',
    async run() {
      const [trackerSource, settingsSource, homeSource, migrationSource] = await Promise.all([
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeHomeView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260719090000_compact_and_paginate_audit_events.sql', import.meta.url), 'utf8'),
      ]);
      assert.match(trackerSource, /rpc\/get_audit_events/);
      assert.match(trackerSource, /beforeId = null/);
      assert.match(settingsSource, /AUDIT_PAGE_SIZE = 50/);
      assert.match(settingsSource, /Load older changes/);
      assert.match(homeSource, /since: since\.toISOString\(\)/);
      assert.match(migrationSource, /create or replace function public\.compact_audit_json/);
      assert.match(migrationSource, /create or replace function public\.get_audit_events/);
      assert.match(migrationSource, /measurementCount/);
      assert.doesNotMatch(migrationSource, /jsonb_build_object\('name', old\.name, 'snapshot'/);

      const [event] = buildAuditTrailEntries([{
        id: 12,
        created_at: '2026-07-13T16:00:00Z',
        actor_user_id: 'auth-1',
        actor_email: 'alex@example.com',
        entity_type: 'project',
        entity_id: 'project-1',
        project_id: 'project-1',
        action: 'update',
        before_data: { id: 'project-1', name: 'Lake House', status: 'planning', start: '2026-07-10' },
        after_data: { id: 'project-1', name: 'Lake House', status: 'active', start: '2026-07-11' },
      }]);
      assert.equal(event.actorEmail, 'alex@example.com');

      const entries = buildAuditTrailEntries([{
        id: 13,
        created_at: '2026-07-13T16:05:00Z',
        actor_email: 'alex@example.com',
        entity_type: 'project',
        entity_id: 'project-1',
        project_id: 'project-1',
        action: 'update',
        before_data: {
          id: 'project-1', name: 'Lake House', phases: [{ id: 'phase-1', name: 'Framing', steps: [{ id: 'step-1', name: 'Walls', predecessors: [] }] }],
          files: { folders: [{ id: 'folder-1', name: 'Plans', files: [] }] },
        },
        after_data: {
          id: 'project-1', name: 'Lake House', phases: [{ id: 'phase-1', name: 'Framing', steps: [{ id: 'step-1', name: 'Walls', predecessors: [{ id: 'step-0', lag: 1 }] }] }],
          files: { folders: [{ id: 'folder-1', name: 'Plans', files: [{ id: 'file-1', name: 'Framing plan.pdf' }] }] },
        },
      }]);
      assert.deepEqual(entries.map((entry) => entry.category), ['dependencies', 'files']);
      assert.match(entries[1].label, /added/i);
    },
  },
  {
    name: 'optimistic concurrency uses atomic version checks and preserves record metadata',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260713150000_add_optimistic_concurrency.sql', import.meta.url),
        'utf8',
      );
      assert.match(trackerSource, /rpc\/apply_tracker_batch/);
      assert.match(trackerSource, /expectedVersion: Number\(previous\?\._version\) \|\| 0/);
      assert.match(trackerSource, /if \(previous && recordsMatch\(previous, item\)\) return/);
      assert.match(trackerSource, /const \{ _version, _normalizedVersions, _personKey, \.\.\.data \} = item/);
      assert.match(trackerSource, /persistVersionedProjectAndTasks/);
      assert.match(trackerSource, /code = 'concurrency-conflict'/);
      assert.match(migrationSource, /create or replace function public\.apply_tracker_batch/);
      assert.match(migrationSource, /VERSION_CONFLICT/);
      assert.match(migrationSource, /version = version \+ 1/);
      assert.match(migrationSource, /create or replace function public\.bump_tracker_record_version/);
      assert.match(migrationSource, /actor_role = 'Edit'/);
    },
  },
  {
    name: 'project phases and schedule steps use a normalized Supabase read model',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260715150000_normalize_project_schedule.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.project_phases/);
      assert.match(migrationSource, /create table if not exists public\.project_steps/);
      assert.match(migrationSource, /foreign key \(project_id, phase_id\)[\s\S]*?on delete cascade/s);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_project_schedule/);
      assert.match(migrationSource, /projects_normalized_schedule_insert_trigger/);
      assert.match(migrationSource, /projects_normalized_schedule_update_trigger/);
      assert.match(migrationSource, /for project_row in select id, data from public\.projects loop/);
      assert.match(migrationSource, /alter table public\.project_phases enable row level security/);
      assert.match(migrationSource, /alter table public\.project_steps enable row level security/);
      assert.match(trackerSource, /export function hydrateProjectsWithNormalizedSchedule/);
      assert.match(trackerSource, /\/rest\/v1\/project_phases\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_steps\?select=/);
      assert.match(trackerSource, /using project JSON schedule data/);

      const [project] = hydrateProjectsWithNormalizedSchedule(
        [{ id: 'project-1', name: 'Lake House', phases: [{ id: 'legacy', name: 'Legacy' }] }],
        [
          { project_id: 'project-1', id: 'phase-2', position: 1, data: { name: 'Finish' } },
          { project_id: 'project-1', id: 'phase-1', position: 0, data: { name: 'Foundation' } },
        ],
        [
          { project_id: 'project-1', phase_id: 'phase-1', id: 'step-2', position: 1, data: { name: 'Pour' } },
          { project_id: 'project-1', phase_id: 'phase-1', id: 'step-1', position: 0, data: { name: 'Excavate' } },
        ],
      );
      assert.deepEqual(project.phases.map((phase) => phase.id), ['phase-1', 'phase-2']);
      assert.deepEqual(project.phases[0].steps.map((step) => step.id), ['step-1', 'step-2']);
      assert.equal(project.phases[0].name, 'Foundation');
    },
  },
  {
    name: 'project folders files and photos use a normalized Supabase read model',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260715180000_normalize_project_assets.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.project_file_folders/);
      assert.match(migrationSource, /create table if not exists public\.project_files/);
      assert.match(migrationSource, /create table if not exists public\.project_photos/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_project_assets/);
      assert.match(migrationSource, /projects_normalized_assets_insert_trigger/);
      assert.match(migrationSource, /projects_normalized_assets_update_trigger/);
      assert.match(migrationSource, /alter table public\.project_files enable row level security/);
      assert.match(trackerSource, /export function hydrateProjectsWithNormalizedAssets/);
      assert.match(trackerSource, /\/rest\/v1\/project_file_folders\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_files\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_photos\?select=/);
      assert.match(trackerSource, /using project JSON file and photo data/);

      const [project] = hydrateProjectsWithNormalizedAssets(
        [{ id: 'project-1', name: 'Lake House', files: { folders: [] }, photos: [] }],
        [
          { project_id: 'project-1', id: 'folder-2', position: 1, data: { name: 'Permits' } },
          { project_id: 'project-1', id: 'folder-1', position: 0, data: { name: 'Plans' } },
        ],
        [
          { project_id: 'project-1', folder_id: 'folder-1', id: 'file-2', position: 1, data: { name: 'Details.pdf' } },
          { project_id: 'project-1', folder_id: 'folder-1', id: 'file-1', position: 0, data: { name: 'Site.pdf' } },
        ],
        [
          { project_id: 'project-1', id: 'photo-2', position: 1, data: { name: 'After.jpg' } },
          { project_id: 'project-1', id: 'photo-1', position: 0, data: { name: 'Before.jpg' } },
        ],
      );
      assert.deepEqual(project.files.folders.slice(0, 2).map((folder) => folder.id), ['folder-1', 'folder-2']);
      assert.deepEqual(project.files.folders[0].files.map((file) => file.id), ['file-1', 'file-2']);
      assert.deepEqual(project.photos.map((photo) => photo.id), ['photo-1', 'photo-2']);
    },
  },
  {
    name: 'edit project selects the main image for the project overview',
    async run() {
      const [photosSource, detailSource, modalSource, projectsSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectPhotosManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectModal.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);

      assert.match(photosSource, /mainPhotoId: wasMainPhoto \? '' : currentProject\.mainPhotoId/);
      assert.doesNotMatch(photosSource, /Set as main project photo|setMainProjectPhoto/);
      assert.match(photosSource, /className="main-photo-badge"/);
      assert.match(modalSource, /Main project image/);
      assert.match(modalSource, /onChange\('mainPhotoId', event\.target\.value\)/);
      assert.match(modalSource, /Crop image to fill/);
      assert.match(modalSource, /onChange\('mainPhotoCrop', event\.target\.checked\)/);
      assert.match(modalSource, /Add photos from the project Photos tab/);
      assert.match(projectsSource, /mainPhotoId: project\.mainPhotoId \|\| ''/);
      assert.match(projectsSource, /mainPhotoCrop: project\.mainPhotoCrop === true/);
      assert.match(detailSource, /function ProjectOverviewMainPhoto/);
      assert.match(detailSource, /photo\.id === project\?\.mainPhotoId/);
      assert.match(detailSource, /downloadProjectFileFromStorage\(mainPhoto\)/);
      assert.match(detailSource, /project\.mainPhotoCrop \? ' is-cropped' : ''/);
      assert.match(detailSource, /<ProjectOverviewMainPhoto project=\{project\}/);
      assert.match(detailSource, /className="home-overview-shell project-overview-shell"/);
      assert.match(detailSource, /What&apos;s happening/);
      assert.match(detailSource, /openOverviewTarget\(row\)/);
      assert.match(detailSource, /Next milestone/);
      assert.match(detailSource, /Last activity/);
      assert.match(detailSource, /Project team/);
      assert.match(detailSource, /ProjectOverviewRecentPhotos/);
      assert.match(detailSource, /href=\{`tel:\$\{project\.customerPhone\}`\}/);
      assert.match(detailSource, /Missing information/);
      assert.match(modalSource, /Project manager/);
      assert.match(projectsSource, /manager: project\.manager \|\| ''/);
      assert.doesNotMatch(detailSource, /ProjectOverviewWeather|4-day weather/);
      assert.doesNotMatch(detailSource, /project-overview-details-section/);
      assert.match(styleSource, /\.home-overview-shell[\s\S]*grid-template-columns: minmax\(220px, 0\.72fr\)/);
      assert.match(styleSource, /\.project-overview-hero-photo img[\s\S]*object-fit: contain/);
      assert.match(styleSource, /\.project-overview-hero-photo\.is-cropped img[\s\S]*object-fit: cover/);
      assert.match(styleSource, /\.project-overview-recent-photos/);
    },
  },
  {
    name: 'project selections attachments and photos use a normalized Supabase read model',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260715210000_normalize_project_selections.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.project_selections/);
      assert.match(migrationSource, /create table if not exists public\.project_selection_attachments/);
      assert.match(migrationSource, /create table if not exists public\.project_selection_photos/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_project_selections/);
      assert.match(migrationSource, /projects_normalized_selections_insert_trigger/);
      assert.match(migrationSource, /projects_normalized_selections_update_trigger/);
      assert.match(migrationSource, /alter table public\.project_selections enable row level security/);
      assert.match(trackerSource, /export function hydrateProjectsWithNormalizedSelections/);
      assert.match(trackerSource, /\/rest\/v1\/project_selections\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_selection_attachments\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_selection_photos\?select=/);
      assert.match(trackerSource, /using project JSON selection data/);

      const [project] = hydrateProjectsWithNormalizedSelections(
        [{ id: 'project-1', name: 'Lake House', selections: [] }],
        [
          { project_id: 'project-1', id: 'selection-2', position: 1, data: { itemName: 'Paint' } },
          { project_id: 'project-1', id: 'selection-1', position: 0, data: { itemName: 'Flooring', taskIds: ['task-1'] } },
        ],
        [
          { project_id: 'project-1', selection_id: 'selection-1', id: 'attachment-2', position: 1, data: { name: 'Quote.pdf' } },
          { project_id: 'project-1', selection_id: 'selection-1', id: 'attachment-1', position: 0, data: { name: 'Spec.pdf' } },
        ],
        [
          { project_id: 'project-1', selection_id: 'selection-1', id: 'photo-1', position: 0, data: { name: 'Sample.jpg' } },
        ],
      );
      assert.deepEqual(project.selections.map((selection) => selection.id), ['selection-1', 'selection-2']);
      assert.deepEqual(project.selections[0].attachments.map((file) => file.id), ['attachment-1', 'attachment-2']);
      assert.deepEqual(project.selections[0].photos.map((file) => file.id), ['photo-1']);
      assert.deepEqual(project.selections[0].taskIds, ['task-1']);
    },
  },
  {
    name: 'normalized project sections save through per-entity version checks',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260715230000_add_normalized_project_write_rpc.sql', import.meta.url),
        'utf8',
      );
      const previous = {
        id: 'project-1',
        name: 'Lake House',
        phases: [],
        files: { folders: [] },
        photos: [],
        selections: [],
      };
      const sections = getNormalizedProjectSectionChanges(previous, {
        ...previous,
        files: { folders: [{ id: 'plans', name: 'Plans', files: [] }] },
        photos: [{ id: 'photo-1', name: 'Progress.jpg' }],
      });
      assert.deepEqual(Object.keys(sections), ['files', 'photos']);
      assert.match(migrationSource, /create or replace function public\.save_normalized_project_sections/);
      assert.match(migrationSource, /NORMALIZED_VERSION_CONFLICT/);
      assert.match(migrationSource, /for update;/);
      assert.match(migrationSource, /perform public\.sync_normalized_project_assets/);
      assert.match(migrationSource, /grant execute on function public\.save_normalized_project_sections/);
      assert.match(trackerSource, /'save_normalized_project_sections'/);
      assert.match(trackerSource, /p_expected_versions: previousProject\._normalizedVersions/);
      assert.match(trackerSource, /hasOnlyNormalizedProjectChanges/);
      assert.match(trackerSource, /NORMALIZED_VERSION_CONFLICT\|40001/);
    },
  },
  {
    name: 'project inspections and their files use normalized version-checked storage',
    async run() {
      const [trackerSource, migrationSource, focusedSaveSource, inspectionsViewSource, scheduleSource] = await Promise.all([
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260716100000_normalize_project_inspections.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260722090000_add_focused_inspection_save.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeInspectionsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8'),
      ]);
      assert.match(migrationSource, /create table if not exists public\.project_inspections/);
      assert.match(migrationSource, /create table if not exists public\.project_inspection_files/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_project_inspections/);
      assert.match(migrationSource, /create or replace function public\.save_normalized_project_inspections/);
      assert.match(migrationSource, /projects_normalized_inspections_insert_trigger/);
      assert.match(migrationSource, /projects_normalized_inspections_update_trigger/);
      assert.match(migrationSource, /alter table public\.project_inspection_files enable row level security/);
      assert.match(migrationSource, /NORMALIZED_VERSION_CONFLICT/);
      assert.match(trackerSource, /export function hydrateProjectsWithNormalizedInspections/);
      assert.match(trackerSource, /\/rest\/v1\/project_inspections\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_inspection_files\?select=/);
      assert.match(trackerSource, /rpcName = inspectionsOnly \? 'save_normalized_project_inspections'/);
      assert.match(trackerSource, /using project JSON inspection data/);
      assert.match(trackerSource, /export async function saveProjectInspection/);
      assert.match(trackerSource, /'save_project_inspection'/);
      assert.match(trackerSource, /p_expected_file_versions: expectedFileVersions/);
      assert.match(focusedSaveSource, /create or replace function public\.save_project_inspection/);
      assert.match(focusedSaveSource, /public\.app_user_can_edit_project\(p_project_id\)/);
      assert.match(focusedSaveSource, /NORMALIZED_VERSION_CONFLICT:inspections/);
      assert.match(focusedSaveSource, /grant execute on function public\.save_project_inspection/);
      assert.match(inspectionsViewSource, /saveProjectInspection\(nextState, project\.id, nextInspection, \{/);
      assert.match(scheduleSource, /saveProjectInspection\(nextState, project\.id, nextInspection\)/);
      assert.match(inspectionsViewSource, /Failed to save inspection\./);
      assert.match(scheduleSource, /Failed to save inspection\./);

      const [project] = hydrateProjectsWithNormalizedInspections(
        [{ id: 'project-1', name: 'Lake House', inspections: [], _normalizedVersions: { phases: { p1: 2 } } }],
        [
          { project_id: 'project-1', id: 'inspection-2', position: 1, data: { inspectionType: 'Final' }, version: 3 },
          { project_id: 'project-1', id: 'inspection-1', position: 0, data: { inspectionType: 'Rough-in' }, version: 4 },
        ],
        [
          { project_id: 'project-1', inspection_id: 'inspection-1', kind: 'report', id: 'report-1', data: { name: 'Report.pdf' }, version: 6 },
          { project_id: 'project-1', inspection_id: 'inspection-1', kind: 'sticker', id: 'sticker-1', data: { name: 'Sticker.jpg' }, version: 5 },
        ],
      );
      assert.deepEqual(project.inspections.map((inspection) => inspection.id), ['inspection-1', 'inspection-2']);
      assert.equal(project.inspections[0].stickerFile.name, 'Sticker.jpg');
      assert.equal(project.inspections[0].reportFile.name, 'Report.pdf');
      assert.equal(project._normalizedVersions.phases.p1, 2);
      assert.equal(project._normalizedVersions.inspections['inspection-1'], 4);
      assert.equal(project._normalizedVersions.inspectionFiles['inspection-1:sticker'], 5);
    },
  },
  {
    name: 'task attachments use normalized storage with transactional task saves',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716120000_normalize_task_attachments.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.task_attachments/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_task_attachments/);
      assert.match(migrationSource, /create or replace function public\.save_task_with_attachments/);
      assert.match(migrationSource, /tasks_normalized_attachments_insert_trigger/);
      assert.match(migrationSource, /tasks_normalized_attachments_update_trigger/);
      assert.match(migrationSource, /alter table public\.task_attachments enable row level security/);
      assert.match(migrationSource, /NORMALIZED_VERSION_CONFLICT:task_attachments/);
      assert.match(migrationSource, /references public\.tasks\(id\) on delete cascade/);
      assert.match(trackerSource, /export function hydrateTasksWithNormalizedAttachments/);
      assert.match(trackerSource, /\/rest\/v1\/task_attachments\?select=/);
      assert.match(trackerSource, /rpc\/save_task_with_attachments/);
      assert.match(trackerSource, /p_expected_attachment_versions: expectedAttachmentVersions/);
      assert.match(trackerSource, /using task JSON attachment data/);

      const [task] = hydrateTasksWithNormalizedAttachments(
        [{ id: 'task-1', label: 'Submit permit', attachments: [], _version: 7 }],
        [
          { task_id: 'task-1', id: 'attachment-2', position: 1, data: { name: 'Receipt.pdf' }, version: 3 },
          { task_id: 'task-1', id: 'attachment-1', position: 0, data: { name: 'Application.pdf' }, version: 2 },
        ],
      );
      assert.deepEqual(task.attachments.map((attachment) => attachment.id), ['attachment-1', 'attachment-2']);
      assert.equal(task.attachments[0].name, 'Application.pdf');
      assert.equal(task._version, 7);
      assert.equal(task._normalizedVersions.attachments['attachment-1'], 2);
      assert.equal(task._normalizedVersions.attachments['attachment-2'], 3);
    },
  },
  {
    name: 'task phase and step assignments use normalized relationship rows',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716140000_normalize_assignments.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.task_assignments/);
      assert.match(migrationSource, /create table if not exists public\.project_phase_assignments/);
      assert.match(migrationSource, /create table if not exists public\.project_step_assignments/);
      assert.match(migrationSource, /resolve_assignee_person_key/);
      assert.match(migrationSource, /tasks_normalized_assignments_trigger/);
      assert.match(migrationSource, /phases_normalized_assignments_trigger/);
      assert.match(migrationSource, /steps_normalized_assignments_trigger/);

      const hydrated = hydrateTrackerWithNormalizedAssignments(
        [{ id: 'p1', phases: [{ id: 'ph1', assignees: [], steps: [{ id: 's1', assignees: [] }] }] }],
        [{ id: 't1', label: 'Call inspector', assignees: [] }],
        [
          { task_id: 't1', assignee: 'Alex Builder', position: 1 },
          { task_id: 't1', assignee: 'Dana Smith', position: 0 },
        ],
        [{ project_id: 'p1', phase_id: 'ph1', assignee: 'Alex Builder', position: 0 }],
        [{ project_id: 'p1', phase_id: 'ph1', step_id: 's1', assignee: 'Dana Smith', position: 0 }],
      );
      assert.deepEqual(hydrated.tasks[0].assignees, ['Dana Smith', 'Alex Builder']);
      assert.equal(hydrated.tasks[0].assignee, 'Dana Smith');
      assert.deepEqual(hydrated.projects[0].phases[0].assignees, ['Alex Builder']);
      assert.deepEqual(hydrated.projects[0].phases[0].steps[0].assignees, ['Dana Smith']);
    },
  },
  {
    name: 'project access uses normalized project-user relationship rows',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716150000_normalize_project_access.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.project_user_access/);
      assert.match(migrationSource, /references public\.projects\(id\) on delete cascade/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_project_access/);
      assert.match(migrationSource, /projects_normalized_access_trigger/);

      const [project] = hydrateProjectsWithNormalizedAccess(
        [{ id: 'p1', name: 'Lake House', accessUserIds: ['legacy-user'] }],
        [
          { project_id: 'p1', user_id: 'user-2', position: 1 },
          { project_id: 'p1', user_id: 'user-1', position: 0 },
        ],
      );
      assert.deepEqual(project.accessUserIds, ['user-1', 'user-2']);
    },
  },
  {
    name: 'selection task relationships use normalized link rows',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716160000_normalize_selection_task_links.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.selection_task_links/);
      assert.match(migrationSource, /references public\.tasks\(id\) on delete cascade/);
      assert.match(migrationSource, /references public\.project_selections\(project_id, id\) on delete cascade/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_selection_task_links/);
      assert.match(migrationSource, /selections_normalized_task_links_trigger/);

      const [project] = hydrateProjectsWithNormalizedSelectionTaskLinks(
        [{ id: 'p1', selections: [{ id: 'sel1', itemName: 'Flooring', taskIds: ['legacy-task'] }] }],
        [
          { project_id: 'p1', selection_id: 'sel1', task_id: 'task-2', position: 1 },
          { project_id: 'p1', selection_id: 'sel1', task_id: 'task-1', position: 0 },
        ],
      );
      assert.deepEqual(project.selections[0].taskIds, ['task-1', 'task-2']);

      const tasks = hydrateTasksWithNormalizedSelectionLinks(
        [
          { id: 'task-1', label: 'Choose flooring', sourceSelectionId: 'legacy', sourceSelectionLabel: 'Old label' },
          { id: 'task-3', label: 'Unlinked task', sourceSelectionId: 'orphan', sourceSelectionLabel: 'Orphan' },
        ],
        [project],
        [{ project_id: 'p1', selection_id: 'sel1', task_id: 'task-1', position: 0 }],
      );
      assert.equal(tasks[0].sourceSelectionId, 'sel1');
      assert.equal(tasks[0].sourceSelectionProjectId, 'p1');
      assert.equal(tasks[0].sourceSelectionLabel, 'Flooring');
      assert.equal(tasks[1].sourceSelectionId, '');
      assert.equal(tasks[1].sourceSelectionLabel, '');
    },
  },
  {
    name: 'schedule dependencies and delays use normalized cycle-safe relationship rows',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716170000_normalize_schedule_relationships.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.project_phase_dependencies/);
      assert.match(migrationSource, /create table if not exists public\.project_step_dependencies/);
      assert.match(migrationSource, /create table if not exists public\.project_schedule_delays/);
      assert.match(migrationSource, /create constraint trigger phase_dependency_cycle_trigger/);
      assert.match(migrationSource, /create constraint trigger step_dependency_cycle_trigger/);
      assert.match(migrationSource, /SCHEDULE_DEPENDENCY_CYCLE:phase/);
      assert.match(migrationSource, /SCHEDULE_DEPENDENCY_CYCLE:step/);
      assert.match(migrationSource, /sync_phase_dependencies/);
      assert.match(migrationSource, /sync_step_dependencies/);
      assert.match(migrationSource, /sync_phase_delays/);
      assert.match(trackerSource, /export function hydrateProjectsWithNormalizedScheduleRelationships/);
      assert.match(trackerSource, /\/rest\/v1\/project_phase_dependencies\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_step_dependencies\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/project_schedule_delays\?select=/);

      const [project] = hydrateProjectsWithNormalizedScheduleRelationships(
        [{
          id: 'p1',
          phases: [
            { id: 'ph1', predecessors: [], delays: [], steps: [{ id: 's1' }, { id: 's2' }] },
            { id: 'ph2', predecessors: [], delays: [], steps: [] },
          ],
        }],
        [{ project_id: 'p1', phase_id: 'ph2', predecessor_phase_id: 'ph1', position: 0, lag: 2 }],
        [{ project_id: 'p1', phase_id: 'ph1', step_id: 's2', predecessor_step_id: 's1', position: 0, lag: 1 }],
        [{ project_id: 'p1', phase_id: 'ph1', id: 'delay-1', step_id: 's2', position: 0, data: { days: 3, cause: 'Weather' } }],
      );
      assert.deepEqual(project.phases[1].predecessors, [{ id: 'ph1', lag: 2 }]);
      assert.deepEqual(project.phases[0].successors, ['ph2']);
      assert.deepEqual(project.phases[0].steps[1].predecessors, [{ id: 's1', lag: 1 }]);
      assert.deepEqual(project.phases[0].steps[0].successors, ['s2']);
      assert.deepEqual(project.phases[0].delays[0], { id: 'delay-1', stepId: 's2', days: 3, cause: 'Weather' });
    },
  },
  {
    name: 'employees and subcontractors use one normalized People read model',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716180000_unify_people.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table if not exists public\.people/);
      assert.match(migrationSource, /unique \(source_table, legacy_id\)/);
      assert.match(migrationSource, /create or replace function public\.sync_unified_person/);
      assert.match(migrationSource, /subs_unified_people_trigger/);
      assert.match(migrationSource, /employees_unified_people_trigger/);
      assert.match(migrationSource, /task_assignments_person_fk/);
      assert.match(migrationSource, /phase_assignments_person_fk/);
      assert.match(migrationSource, /step_assignments_person_fk/);
      assert.match(trackerSource, /export function hydratePeopleFromNormalizedRows/);
      assert.match(trackerSource, /async function loadPeopleReadModel/);
      assert.match(trackerSource, /\/rest\/v1\/people\?select=/);
      assert.match(trackerSource, /loadProjectReadModel\(\),\s*loadTaskReadModel\(\),\s*loadPeopleReadModel\(\)/s);
      assert.match(trackerSource, /Unified People table is not available yet; using legacy People tables/);
      assert.match(trackerSource, /versionRows: \[\.\.\.subsRows, \.\.\.employeeRows\]/);
      assert.match(trackerSource, /personLabels\.get\(String\(row\?\.person_key/);

      const people = hydratePeopleFromNormalizedRows([
        { id: 'sub:sub1', source_table: 'subs', legacy_id: 'sub1', people_type: 'sub', data: { first: 'Alex', company: 'Build Co' }, version: 4 },
        { id: 'employee:emp1', source_table: 'employees', legacy_id: 'emp1', people_type: 'consultant', data: { first: 'Dana', last: 'Smith' }, version: 6 },
      ]);
      assert.equal(people.subs[0].id, 'sub1');
      assert.equal(people.subs[0]._personKey, 'sub:sub1');
      assert.equal(people.subs[0]._version, 4);
      assert.equal(people.employees[0].peopleType, 'consultant');
      assert.equal(people.employees[0]._personKey, 'employee:emp1');

      const assigned = hydrateTrackerWithNormalizedAssignments(
        [],
        [{ id: 't1', label: 'Review plans' }],
        [{ task_id: 't1', assignee: 'Old Name', person_key: 'employee:emp1', position: 0 }],
        [],
        [],
        people.subs,
        people.employees,
      );
      assert.deepEqual(assigned.tasks[0].assignees, ['Dana Smith']);
    },
  },
  {
    name: 'project and task reads use lightweight normalized core views with safe fallback',
    async run() {
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716200000_add_normalized_core_views.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create or replace view public\.project_core_records/);
      assert.match(migrationSource, /create or replace view public\.task_core_records/);
      assert.match(migrationSource, /security_invoker = true/);
      for (const key of ['phases', 'files', 'photos', 'selections', 'inspections', 'accessUserIds']) {
        assert.match(migrationSource, new RegExp(`- '${key}'`));
      }
      for (const key of ['attachments', 'assignees', 'sourceSelectionId', 'sourceSelectionProjectId', 'sourceSelectionLabel']) {
        assert.match(migrationSource, new RegExp(`- '${key}'`));
      }
      assert.match(trackerSource, /async function loadProjectReadModel/);
      assert.match(trackerSource, /async function loadTaskReadModel/);
      assert.match(trackerSource, /\/rest\/v1\/project_core_records\?select=/);
      assert.match(trackerSource, /\/rest\/v1\/task_core_records\?select=/);
      assert.match(trackerSource, /projectReadModel\?\.core && !projectNormalizedSourcesReady/);
      assert.match(trackerSource, /taskReadModel\?\.core && !taskNormalizedSourcesReady/);
      assert.match(trackerSource, /\/rest\/v1\/projects\?select=\*&order=created_at\.asc/);
      assert.match(trackerSource, /\/rest\/v1\/tasks\?select=\*&order=created_at\.asc/);
    },
  },
  {
    name: 'staff startup renders a compact overview before deferred workspace hydration',
    async run() {
      const [appSource, trackerSource, projectSource, detailSource, migrationSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260722120000_add_progressive_staff_bootstrap.sql', import.meta.url), 'utf8'),
      ]);
      assert.match(migrationSource, /create or replace function public\.get_app_startup_bootstrap/);
      assert.match(migrationSource, /public\.get_project_portal_bootstrap\(\)/);
      assert.match(migrationSource, /public\.project_core_records/);
      assert.match(migrationSource, /public\.task_core_records/);
      assert.match(migrationSource, /startupProjectId/);
      assert.match(migrationSource, /grant execute on function public\.get_app_startup_bootstrap/);
      assert.match(trackerSource, /export async function loadTrackerStartupData/);
      assert.match(trackerSource, /'get_app_startup_bootstrap'/);
      assert.match(trackerSource, /deferredDataStatus: 'loading'/);
      assert.match(appSource, /loadTrackerStartupData/);
      assert.match(appSource, /loadTrackerData\(\{ force: true \}\)/);
      assert.match(appSource, /deferredDataStatus: 'ready'/);
      assert.match(appSource, /The project overview is ready/);
      assert.match(projectSource, /deferredDataLoading=\{deferredDataLoading\}/);
      assert.match(detailSource, /activeDetailTab !== 'overview' && deferredDataLoading/);
    },
  },
  {
    name: 'application users use normalized rows linked to project access',
    async run() {
      const [trackerSource, settingsSource, migrationSource, customerLinkMigration] = await Promise.all([
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260716210000_normalize_app_users.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260722140000_link_portal_users_to_people.sql', import.meta.url), 'utf8'),
      ]);
      assert.match(migrationSource, /create table if not exists public\.app_users/);
      assert.match(migrationSource, /create or replace function public\.sync_normalized_app_users/);
      assert.match(migrationSource, /settings_normalized_app_users_trigger/);
      assert.match(migrationSource, /project_user_access_app_user_fk/);
      assert.match(migrationSource, /references public\.app_users\(id\) on delete cascade not valid/);
      assert.match(trackerSource, /export function hydrateSettingsWithNormalizedUsers/);
      assert.match(trackerSource, /\/rest\/v1\/app_users\?select=/);
      assert.match(trackerSource, /using settings JSON users/);
      assert.match(trackerSource, /\['Customer', 'Subcontractor'\]\.includes\(role\)/);
      assert.match(settingsSource, /Select a \{linkedRoleLabel\} from People/);
      assert.match(settingsSource, /\['Customer', 'Subcontractor'\]\.includes\(targetUser\.role\)/);
      assert.match(settingsSource, /savedPersonId/);
      assert.match(settingsSource, /role === 'Subcontractor'\) return contactName \|\| companyName/);
      assert.match(settingsSource, /subcontractorPeople/);
      assert.match(customerLinkMigration, /app_users_linked_person_unique/);
      assert.match(customerLinkMigration, /validate_app_user_person_link/);
      assert.match(customerLinkMigration, /when 'Subcontractor' then 'sub'/);
      assert.match(customerLinkMigration, /people_protect_linked_portal_person/);
      assert.match(customerLinkMigration, /'personId', coalesce\(app_user\.data->>'personId'/);

      const settings = hydrateSettingsWithNormalizedUsers(
        { currentUserId: 'user-2', users: [{ id: 'legacy', name: 'Legacy', role: 'Admin' }] },
        [
          { id: 'user-2', position: 1, data: { name: 'Customer', email: 'viewer@example.com', role: 'Customer', personId: 'employee:customer-1' } },
          { id: 'user-1', position: 0, data: { name: 'Admin', email: 'admin@example.com', role: 'Admin' } },
          { id: 'user-3', position: 2, data: { name: 'Sub User', email: 'sub@example.com', role: 'Subcontractor', personId: 'sub:sub-1' } },
        ],
      );
      assert.deepEqual(settings.users.map((user) => user.id), ['user-1', 'user-2', 'user-3']);
      assert.equal(settings.currentUserId, 'user-2');
      assert.equal(settings.users[1].email, 'viewer@example.com');
      assert.equal(settings.users[1].personId, 'employee:customer-1');
      assert.equal(settings.users[2].name, 'Sub User');
      assert.equal(settings.users[2].personId, 'sub:sub-1');
    },
  },
  {
    name: 'extracted pages import FluentIcon when they render it',
    async run() {
      for (const componentName of ['NativeScheduleView', 'ProjectPhotosManager']) {
        const source = await readFile(new URL(`../src/components/${componentName}.jsx`, import.meta.url), 'utf8');
        assert.match(source, /<FluentIcon\b/);
        assert.match(source, /import FluentIcon from ['"]\.\/FluentIcon\.jsx['"]/);
      }
    },
  },
  {
    name: 'schedule week labels use an encoding-safe date separator',
    async run() {
      const source = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(source, /label: `\$\{startLabel\} - \$\{endLabel\}`/);
      assert.doesNotMatch(source, /â/);
    },
  },
  {
    name: 'modal components expose accessible dialog semantics',
    async run() {
      const modalModules = [
        'AppDialogs',
        'FormDialogs',
        'InspectionImageEditorModal',
        'PersonModal',
        'ProjectModal',
        'ScheduleDialogs',
        'SelectionModal',
        'TaskInspectionDialogs',
      ];
      for (const moduleName of modalModules) {
        const source = await readFile(new URL(`../src/components/${moduleName}.jsx`, import.meta.url), 'utf8');
        const modalCards = source.match(/<div className="modal-card[^>]+>/g) || [];
        assert.ok(modalCards.length > 0, `${moduleName} should contain a modal card`);
        for (const modalCard of modalCards) {
          assert.match(modalCard, /role="dialog"/);
          assert.match(modalCard, /aria-modal="true"/);
          assert.match(modalCard, /aria-labelledby="[^"]+"/);
        }
      }
    },
  },
  {
    name: 'shared calendar week layout keeps range overflow and day capacity consistent',
    run() {
      const cells = Array.from({ length: 7 }, (_, index) => ({
        isWeekend: index === 0 || index === 6,
        holidays: [],
        items: index === 2 ? [{ id: 'task-1' }, { id: 'task-2' }] : [],
      }));
      const week = {
        cells,
        laneCount: 5,
        holidayLaneCount: 0,
        isExpanded: false,
        scheduledBars: Array.from({ length: 5 }, (_, lane) => ({
          id: `bar-${lane}`,
          type: 'phase',
          lane,
          startCol: 1,
          endCol: 5,
        })),
        holidayBars: [],
      };
      const layout = getCalendarWeekLayout(week);
      assert.equal(layout.visibleLaneCount, 5);
      assert.equal(layout.hiddenScheduledBarCount, 0);
      assert.ok(layout.maxVisibleDayItems >= 0);
      assert.ok(layout.cellHeight >= layout.spanOffset + 10);
    },
  },
  {
    name: 'top-level and project calendars use the shared grid renderer',
    async run() {
      for (const moduleName of ['NativeScheduleView', 'ProjectDetailCalendar']) {
        const source = await readFile(new URL(`../src/components/${moduleName}.jsx`, import.meta.url), 'utf8');
        assert.match(source, /import SharedCalendarGrid from ['"]\.\/SharedCalendarGrid\.jsx['"]/);
        assert.match(source, /<SharedCalendarGrid/);
        assert.doesNotMatch(source, /className="calendar-week-grid"/);
      }
    },
  },
  {
    name: 'mobile schedule uses a dedicated agenda instead of the desktop Gantt',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(scheduleSource, /<MobileScheduleAgenda/);
      assert.match(scheduleSource, /gantt-shell desktop-schedule-gantt/);
      assert.match(agendaSource, /aria-label="Schedule agenda"/);
      assert.match(styleSource, /\.top-level-schedule-page \.desktop-schedule-gantt/);
      assert.match(styleSource, /\.mobile-schedule-agenda \{\s+display: grid;/);
    },
  },
  {
    name: 'schedule steps expose a shared desktop and Android status picker',
    async run() {
      const [scheduleSource, agendaSource, buttonSource, dialogSource, styleSource, statusModule] = await Promise.all([
        readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/StepStatusButton.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ScheduleDialogs.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        import('../src/utils/stepStatus.js'),
      ]);
      assert.match(scheduleSource, /<StepStatusButton row=\{row\} onClick=\{openStepStatus\}/);
      assert.match(scheduleSource, /<StepStatusModal/);
      assert.match(scheduleSource, /status: stepStatusDraft\.status/);
      assert.match(scheduleSource, /done: stepStatusDraft\.status === 'done'/);
      assert.match(scheduleSource, /updateProjectAndTasks\(currentData, project\.id, nextProject, nextTasks\)/);
      assert.match(agendaSource, /<StepStatusButton row=\{row\} onClick=\{onStatus\}/);
      assert.match(buttonSource, /Current status: \$\{status\.label\}/);
      assert.match(dialogSource, /role="radiogroup"/);
      assert.match(dialogSource, /Save status/);
      assert.match(styleSource, /\.schedule-step-status-button/);
      assert.match(styleSource, /\.step-status-modal-card/);
      assert.deepEqual(
        statusModule.STEP_STATUS_OPTIONS.map((option) => option.value),
        ['planning', 'active', 'delayed', 'done'],
      );
      assert.equal(statusModule.normalizeStepStatus('unknown'), 'planning');
      assert.equal(statusModule.normalizeStepStatus('active', true), 'done');
      const statusRows = buildScheduleRows(
        [{
          id: 'project-status',
          name: 'Status project',
          status: 'active',
          phases: [{
            id: 'phase-status',
            name: 'Status phase',
            status: 'active',
            steps: [{ id: 'step-status', name: 'Delayed step', status: 'delayed' }],
          }],
        }],
        {},
        false,
        { 'project-status': true },
        { 'phase-status': true },
      );
      assert.equal(statusRows.find((row) => row.id === 'step-step-status')?.status, 'delayed');
    },
  },
  {
    name: 'mobile calendars use day and week views instead of the desktop month canvas',
    async run() {
      const sharedSource = await readFile(new URL('../src/components/SharedCalendarGrid.jsx', import.meta.url), 'utf8');
      const mobileSource = await readFile(new URL('../src/components/MobileCalendarView.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(sharedSource, /<MobileCalendarView/);
      assert.match(mobileSource, /aria-label="Mobile calendar"/);
      assert.match(mobileSource, /setViewMode\('day'\)/);
      assert.match(mobileSource, /setViewMode\('week'\)/);
      assert.match(mobileSource, /className="mobile-calendar-week-agenda"/);
      assert.match(mobileSource, /\(selectedWeek\?\.cells \|\| \[\]\)\.map/);
      assert.match(mobileSource, /item\.startCol <= index && item\.endCol >= index/);
      assert.match(mobileSource, /onTouchStart=\{handleTouchStart\}/);
      assert.match(styleSource, /\.calendar-grid-shell > \.desktop-calendar-grid\s*\{\s*display:\s*none;/);
    },
  },
  {
    name: 'mobile workspace uses a project drawer and touch dependency actions',
    async run() {
      const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(appSource, /const \[projectDrawerOpen, setProjectDrawerOpen\] = useState\(false\)/);
      assert.match(appSource, /aria-controls="workspace-projects-drawer"/);
      assert.match(appSource, /className="project-drawer-backdrop"/);
      assert.match(styleSource, /\.projects-rail\.drawer-open\s*\{\s*transform:\s*translateX\(0\)/);
      assert.match(agendaSource, />Dependencies<\/button>/);
      assert.match(agendaSource, /onDependencies\(row\)/);
    },
  },
  {
    name: 'project overview cards expand and collapse on desktop and mobile',
    async run() {
      const cardSource = await readFile(new URL('../src/components/ProjectCard.jsx', import.meta.url), 'utf8');
      const projectsSource = await readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(cardSource, /expanded = false, onToggle/);
      assert.match(cardSource, /aria-expanded=\{expanded\}/);
      assert.match(cardSource, /aria-controls=\{detailId\}/);
      assert.match(cardSource, /hidden=\{!expanded\}/);
      assert.match(cardSource, /name="chevronRight"/);
      assert.match(projectsSource, /expandedOverviewProjectIds/);
      assert.match(projectsSource, /allOverviewProjectsExpanded/);
      assert.match(projectsSource, /toggleAllOverviewProjects/);
      assert.match(projectsSource, /allOverviewProjectsExpanded \? 'Collapse all' : 'Expand all'/);
      assert.match(styleSource, /\.project-card\.collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
      assert.match(styleSource, /\.project-card-header\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
      assert.match(styleSource, /\.project-card-expanded-content\[hidden\]\s*\{\s*display:\s*none;/s);
      assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.project-card-header\s*\{[^}]*flex-direction:\s*row;/s);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.projects-overview-section \.project-card-heading[\s\S]*?text-align:\s*left;/s);
      assert.match(styleSource, /\.projects-overview-section \.project-card-heading\s*\{[^}]*width:\s*100%;[^}]*justify-items:\s*start;/s);
      assert.match(styleSource, /\.projects-overview-section \.project-card-header\s*\{[^}]*width:\s*100%;[^}]*align-items:\s*stretch;/s);
      assert.match(styleSource, /\.projects-overview-section \.project-card-status-row\s*\{[^}]*justify-content:\s*flex-start;/s);
    },
  },
  {
    name: 'filter toolbars align right and expand controls share one treatment',
    async run() {
      const projectsSource = await readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8');
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      const filesSource = await readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(styleSource, /\.projects-filter-toolbar,[\s\S]*?\.selection-filters\s*\{[^}]*justify-content:\s*flex-end;/s);
      assert.match(styleSource, /\.expand-collapse-button\s*\{[^}]*place-items:\s*center;[^}]*border:\s*1px solid var\(--border\);/s);
      assert.match(projectsSource, /expand-collapse-all-button projects-expand-all-button/);
      assert.match(scheduleSource, /expand-collapse-button gantt-expand-button/);
      assert.match(scheduleSource, /aria-expanded=\{row\.expanded\}/);
      assert.match(agendaSource, /expand-collapse-button mobile-agenda-expand-indicator/);
      assert.match(filesSource, /expand-collapse-button files-tree-toggle/);
      assert.match(filesSource, /expand-collapse-all-button/);
    },
  },
  {
    name: 'phone-width page filters move into consistent overflow menus',
    async run() {
      const menuSource = await readFile(new URL('../src/components/ResponsiveFilterMenu.jsx', import.meta.url), 'utf8');
      const projectsSource = await readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8');
      const tasksSource = await readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8');
      const peopleSource = await readFile(new URL('../src/components/NativePeopleView.jsx', import.meta.url), 'utf8');
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const selectionsSource = await readFile(new URL('../src/components/ProjectSelectionsManager.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(menuSource, /mobile-filter-menu-trigger/);
      assert.match(menuSource, /name="moreVertical"/);
      assert.match(projectsSource, /<ResponsiveFilterMenu label="Project filters">/);
      assert.match(tasksSource, /<ResponsiveFilterMenu label="Task filters">/);
      assert.match(peopleSource, /<ResponsiveFilterMenu label="People filters">/);
      assert.match(scheduleSource, /<ResponsiveFilterMenu label="Calendar filters">/);
      assert.match(selectionsSource, /<ResponsiveFilterMenu label="Selection filters">/);
      assert.match(scheduleSource, /schedule-secondary-controls[\s\S]*?className="schedule-search-input"/s);
      assert.doesNotMatch(scheduleSource, /schedule-search-toggle/);
      assert.match(styleSource, /\.responsive-filter-menu-content\.mobile-open\s*\{[^}]*display:\s*grid;/s);
    },
  },
  {
    name: 'task status filters show scoped counts without the top totals strip',
    async run() {
      const tasksSource = await readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(tasksSource, /const statusCounts = useMemo/);
      assert.match(tasksSource, /All \(\{statusCounts\.all\}\)/);
      assert.match(tasksSource, /Open \(\{statusCounts\.open\}\)/);
      assert.match(tasksSource, /Completed \(\{statusCounts\.completed\}\)/);
      assert.doesNotMatch(tasksSource, /className="task-summary-strip"/);
      assert.doesNotMatch(styleSource, /\.task-summary-strip\s*\{/);
    },
  },
  {
    name: 'mobile task creation opens in a compact dialog while desktop stays inline',
    async run() {
      const tasksSource = await readFile(new URL('../src/components/NativeTasksView.jsx', import.meta.url), 'utf8');
      const formSource = await readFile(new URL('../src/components/TaskCreateForm.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(tasksSource, /mobileCreateTaskOpen/);
      assert.match(tasksSource, /className="button primary mobile-task-create-trigger"/);
      assert.match(tasksSource, /renderModalPortal\(/);
      assert.match(formSource, /role=\{modal \? 'dialog' : undefined\}/);
      assert.match(formSource, /aria-modal=\{modal \? 'true' : undefined\}/);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.task-create-desktop\s*\{\s*display:\s*none;/s);
      assert.match(styleSource, /\.mobile-task-create-trigger\s*\{\s*display:\s*inline-flex;/s);
    },
  },
  {
    name: 'Android and small-screen browsers use the breakpoint-scoped Material app bar',
    async run() {
      const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(appSource, /material-top-app-bar/);
      assert.match(appSource, /browser-mobile-app-bar/);
      assert.match(appSource, /browser-desktop-shell/);
      assert.match(appSource, /android-material-project-filter/);
      assert.match(appSource, /android-account-project-filter/);
      assert.match(appSource, /android-mobile-overflow-icon/);
      assert.match(appSource, /android-wide-scope-bar/);
      assert.match(appSource, /name="navigation"/);
      assert.match(styleSource, /Compact Material-style Android app bar\. Phone widths only\./);
      assert.match(styleSource, /@media \(max-width: 720px\) \{\s+\.material-top-app-bar\.android-shell-bar/s);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.browser-mobile-app-bar\s*\{\s*display:\s*grid;/s);
      assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.browser-desktop-shell\s*\{\s*display:\s*none;/s);
      assert.match(styleSource, /\.material-top-app-bar \.android-wide-scope-bar\s*\{\s*display:\s*none;/s);
      assert.match(styleSource, /\.material-top-app-bar \.android-material-project-filter\s*\{\s*display:\s*none;/s);
      assert.match(styleSource, /\.material-top-app-bar\.android-shell-bar\s*\{[^}]*backdrop-filter:\s*none;/s);
      assert.match(styleSource, /\.material-top-app-bar \.android-nav-menu\s*\{[^}]*height:\s*100dvh;/s);
    },
  },
  {
    name: 'Android schedule toolbar keeps filters in one overflow menu',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const iconSource = await readFile(new URL('../src/components/FluentIcon.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(scheduleSource, /schedule-secondary-controls/);
      assert.match(scheduleSource, /className="schedule-search-input"/);
      assert.match(scheduleSource, /name="moreVertical"/);
      assert.match(scheduleSource, /name=\{allExpanded \? 'collapseAll' : 'expandAll'\}/);
      assert.doesNotMatch(scheduleSource, /gantt-icon-button schedule-mobile-only/);
      assert.match(iconSource, /Search24Regular/);
      assert.match(iconSource, /MoreVertical24Regular/);
      assert.match(styleSource, /\.schedule-secondary-controls \.schedule-search-input\s*\{[^}]*display:\s*block;/s);
      assert.match(styleSource, /\.schedule-secondary-controls\.mobile-open\s*\{\s*display:\s*grid;/s);
      assert.match(styleSource, /\.schedule-mobile-only\s*\{[^}]*opacity:\s*1;/s);
    },
  },
  {
    name: 'desktop schedule can switch between Gantt and agenda views',
    async run() {
      const source = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(source, /const \[scheduleDisplayMode, setScheduleDisplayMode\] = useState\(getStoredScheduleView\)/);
      assert.match(source, /aria-label="Schedule view"/);
      assert.match(source, /aria-pressed=\{scheduleDisplayMode === 'agenda'\}/);
      assert.match(source, /desktop-hidden/);
      assert.match(source, /desktop-visible/);
    },
  },
  {
    name: 'desktop schedule remembers the selected view and zoom',
    async run() {
      const source = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(source, /const SCHEDULE_VIEW_STORAGE_KEY = 'project-tracker:schedule-view'/);
      assert.match(source, /const SCHEDULE_ZOOM_STORAGE_KEY = 'project-tracker:schedule-zoom'/);
      assert.match(source, /const \[ganttZoomValue, setGanttZoomValue\] = useState\(getStoredScheduleZoom\)/);
      assert.match(source, /localStorage\.setItem\(SCHEDULE_VIEW_STORAGE_KEY, scheduleDisplayMode\)/);
      assert.match(source, /localStorage\.setItem\(SCHEDULE_ZOOM_STORAGE_KEY, String\(ganttZoomValue\)\)/);
    },
  },
  {
    name: 'desktop schedule remembers project and phase expansion',
    async run() {
      const source = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(source, /const SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY = 'project-tracker:schedule-project-expansion'/);
      assert.match(source, /const SCHEDULE_PHASE_EXPANSION_STORAGE_KEY = 'project-tracker:schedule-phase-expansion'/);
      assert.match(source, /useState\(\(\) => getStoredExpansion\(SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY\)\)/);
      assert.match(source, /\.\.\.getDefaultPhaseExpansion\(data\.projects\),\s+\.\.\.getStoredExpansion\(SCHEDULE_PHASE_EXPANSION_STORAGE_KEY\)/);
      assert.match(source, /localStorage\.setItem\(SCHEDULE_PROJECT_EXPANSION_STORAGE_KEY, JSON\.stringify\(expandedProjects\)\)/);
      assert.match(source, /localStorage\.setItem\(SCHEDULE_PHASE_EXPANSION_STORAGE_KEY, JSON\.stringify\(expandedPhases\)\)/);
    },
  },
  {
    name: 'schedule can hide past items and remembers the filter',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(scheduleSource, /const SCHEDULE_HIDE_PAST_STORAGE_KEY = 'project-tracker:schedule-hide-past'/);
      assert.match(scheduleSource, /const \[hidePastScheduleItems, setHidePastScheduleItems\] = useState/);
      assert.match(scheduleSource, /showCurrentAndFutureOnly: hidePastScheduleItems/);
      assert.match(scheduleSource, /className="schedule-history-filter"/);
      assert.match(scheduleSource, /<span>Hide past<\/span>/);
      assert.match(scheduleSource, /localStorage\.setItem\(SCHEDULE_HIDE_PAST_STORAGE_KEY, String\(hidePastScheduleItems\)\)/);
      assert.match(styleSource, /\.schedule-history-filter\s*\{/);
    },
  },
  {
    name: 'schedule search includes matching items with project and phase context',
    run() {
      const rows = [
        { id: 'project-1', type: 'project', label: 'Lake House' },
        { id: 'phase-1', type: 'phase', label: 'Roughs' },
        { id: 'step-1', type: 'step', label: 'Rough electric', assign: 'Bright Electric' },
        { id: 'delay-1', type: 'delay', label: 'Weather delay', stepName: 'Rough electric' },
        { id: 'phase-2', type: 'phase', label: 'Finishes' },
        { id: 'step-2', type: 'step', label: 'Paint' },
        { id: 'task-1', type: 'task', label: 'Order fixtures', assignee: 'Ari' },
      ];
      assert.deepEqual(filterScheduleRows(rows, 'bright').map((row) => row.id), ['project-1', 'phase-1', 'step-1']);
      assert.deepEqual(filterScheduleRows(rows, 'weather').map((row) => row.id), ['project-1', 'phase-1', 'step-1', 'delay-1']);
      assert.deepEqual(filterScheduleRows(rows, 'finishes').map((row) => row.id), ['project-1', 'phase-2', 'step-2']);
      assert.deepEqual(filterScheduleRows(rows, 'lake').map((row) => row.id), rows.map((row) => row.id));
      assert.deepEqual(filterScheduleRows(rows, 'ari').map((row) => row.id), ['project-1', 'task-1']);
    },
  },
  {
    name: 'schedule search expands matches in Gantt and agenda without changing saved expansion',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      assert.match(scheduleSource, /aria-label="Search schedule"/);
      assert.match(scheduleSource, /filterScheduleRows\(scheduleRows, scheduleSearchQuery\)/);
      assert.match(scheduleSource, /expansionLocked=\{scheduleContextFilterActive\}/);
      assert.match(scheduleSource, /disabled=\{scheduleContextFilterActive\}/);
      assert.match(agendaSource, /disabled=\{expansionLocked\}/);
    },
  },
  {
    name: 'schedule agenda can show only unfinished items active today with hierarchy context',
    async run() {
      const rows = [
        { id: 'project-1', type: 'project', label: 'Lake House' },
        { id: 'phase-1', type: 'phase', label: 'Roughs' },
        { id: 'step-active', type: 'step', label: 'Electric', start: '2026-07-13', end: '2026-07-16', status: 'active' },
        { id: 'delay-active', type: 'delay', label: 'Weather', start: '2026-07-14', end: '2026-07-15', status: 'delayed' },
        { id: 'step-done', type: 'step', label: 'Plumbing', start: '2026-07-12', end: '2026-07-15', done: true, status: 'done' },
        { id: 'phase-2', type: 'phase', label: 'Finishes' },
        { id: 'step-future', type: 'step', label: 'Paint', start: '2026-07-20', end: '2026-07-22', status: 'active' },
        { id: 'task-today', type: 'task', label: 'Call inspector', start: '2026-07-14', end: '2026-07-14', status: 'active' },
      ];
      assert.deepEqual(filterScheduleRowsForToday(rows, '2026-07-14').map((row) => row.id), [
        'project-1', 'phase-1', 'step-active', 'delay-active', 'task-today',
      ]);
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(scheduleSource, /Today&apos;s active items/);
      assert.match(scheduleSource, /filterScheduleRowsForToday/);
      assert.match(scheduleSource, /todayActive: showTodayActiveItems/);
      assert.match(scheduleSource, /SCHEDULE_TODAY_ACTIVE_STORAGE_KEY/);
    },
  },
  {
    name: 'tasks and schedule items support multiple People-backed assignees',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const dialogSource = await readFile(new URL('../src/components/ScheduleDialogs.jsx', import.meta.url), 'utf8');
      const taskDialogSource = await readFile(new URL('../src/components/TaskInspectionDialogs.jsx', import.meta.url), 'utf8');
      const assigneeSource = await readFile(new URL('../src/utils/assignees.js', import.meta.url), 'utf8');
      assert.match(scheduleSource, /personAssignmentLabel/);
      assert.match(scheduleSource, /<ScheduleItemModal[\s\S]*?assigneeOptions=\{taskAssigneeOptions\}/);
      assert.match(scheduleSource, /onAddPerson=\{\(\) => startCreateTaskAssignee\('schedule'\)\}/);
      assert.match(scheduleSource, /personAssignmentTarget === 'schedule'/);
      assert.match(scheduleSource, /assignees: \[\.\.\.new Set\(\[\.\.\.\(current\.assignees \|\| \[\]\), nextAssignee\]\)\]/);
      assert.match(dialogSource, /<AssigneeMultiSelect/);
      assert.match(dialogSource, /value=\{draft\.assignees\}/);
      assert.match(taskDialogSource, /<AssigneeMultiSelect/);
      assert.match(assigneeSource, /export function normalizeAssignees/);
      assert.match(assigneeSource, /return \{ assignees, assignee: assignees\[0\] \|\| '' \}/);
      assert.match(assigneeSource, /return \{ assignees, assign: assignees\[0\] \|\| '' \}/);
      assert.match(dialogSource, />\s*Add person\s*<\/button>/);
    },
  },
  {
    name: 'multi-assignee picker escapes clipped containers and supports Android touch selection',
    async run() {
      const pickerSource = await readFile(new URL('../src/components/AssigneeMultiSelect.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(pickerSource, /renderModalPortal/);
      assert.match(pickerSource, /type="checkbox"/);
      assert.match(pickerSource, /setOpen\(false\)/);
      assert.match(pickerSource, />Done<\/button>/);
      assert.match(pickerSource, /type="search"/);
      assert.match(pickerSource, /placeholder="Search assignees"/);
      assert.match(pickerSource, /resolvedOptions\.filter\(\(option\) => option\.toLocaleLowerCase\(\)\.includes\(query\)\)/);
      assert.match(pickerSource, /No assignees match your search\./);
      assert.match(styleSource, /\.assignee-picker-layer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
      assert.match(styleSource, /@media \(max-width: 560px\)[\s\S]*?\.assignee-picker-popover\s*\{[^}]*bottom:\s*0;/s);
    },
  },
  {
    name: 'schedule headers remain visible inside scrolling Gantt and agenda views',
    async run() {
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(agendaSource, /className="mobile-agenda-column-header"/);
      assert.match(styleSource, /\.mobile-agenda-column-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
      assert.match(styleSource, /\.top-level-schedule-page \.gantt-shell\s*\{[^}]*max-height:[^;]+;[^}]*overflow:\s*auto;/s);
      assert.match(styleSource, /\.top-level-schedule-page \.gantt-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
      assert.match(styleSource, /\.gantt-timeline-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
    },
  },
  {
    name: 'Gantt item and timeline rows share hover and keyboard focus highlighting',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
      assert.match(scheduleSource, /const \[activeGanttRowId, setActiveGanttRowId\] = useState\(null\)/);
      assert.match(scheduleSource, /className=\{`gantt-row-label[^`]+is-active/);
      assert.match(scheduleSource, /className=\{`gantt-grid-row[^`]+is-active/);
      assert.match(scheduleSource, /onFocusCapture=\{\(\) => setActiveGanttRowId\(row\.id\)\}/);
      assert.match(styleSource, /\.top-level-schedule-page \.gantt-row-label\.is-active/);
      assert.match(styleSource, /\.top-level-schedule-page \.gantt-grid-row\.is-active/);
    },
  },
  {
    name: 'agenda Today targets the earliest step starting today or later',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      const agendaSource = await readFile(new URL('../src/components/MobileScheduleAgenda.jsx', import.meta.url), 'utf8');
      assert.match(agendaSource, /data-start-date=\{row\.type === 'step'/);
      assert.match(scheduleSource, /dataset\.startDate >= todayKey/);
      assert.match(scheduleSource, /sort\(\(first, second\) => first\.dataset\.startDate\.localeCompare\(second\.dataset\.startDate\)\)/);
      assert.match(scheduleSource, /target\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
      assert.match(scheduleSource, /onClick=\{handleScheduleToday\}/);
    },
  },
  {
    name: 'Gantt Today centers the real sticky-layout scroll container',
    async run() {
      const scheduleSource = await readFile(new URL('../src/components/NativeScheduleView.jsx', import.meta.url), 'utf8');
      assert.match(scheduleSource, /const ganttShellRef = useRef\(null\)/);
      assert.match(scheduleSource, /const ganttTableRef = useRef\(null\)/);
      assert.match(scheduleSource, /ref=\{ganttShellRef\} className=\{`gantt-shell/);
      assert.match(scheduleSource, /const visibleTimelineWidth = Math\.max\(1, shell\.clientWidth - tableWidth\)/);
      assert.match(scheduleSource, /shell\.scrollTo\(\{/);
      assert.doesNotMatch(scheduleSource, /function scrollGanttToToday\(\) \{[\s\S]*?wrap\.scrollTo\(/);
    },
  },
  {
    name: 'normalizePreds supports legacy and current dependency shapes',
    run() {
      assert.deepEqual(normalizePreds('step-1'), [{ id: 'step-1', lag: 0 }]);
      assert.deepEqual(normalizePreds({ id: 'step-2', lag: 3 }), [{ id: 'step-2', lag: 3 }]);
      assert.deepEqual(normalizePreds(['step-3', { id: 'step-4', lag: 1 }]), [
        { id: 'step-3', lag: 0 },
        { id: 'step-4', lag: 1 },
      ]);
    },
  },
  {
    name: 'normalizeStartDate and computeStepEndDate skip weekends and holidays',
    run() {
      assert.equal(normalizeStartDate('2026-05-24', weekdaySettings), '2026-05-26');
      assert.equal(computeStepEndDate('2026-05-22', 2, weekdaySettings), '2026-05-26');
    },
  },
  {
    name: 'syncStepLinks builds successors and removes invalid predecessors',
    run() {
      const phase = {
        steps: [
          { id: 'a', predecessors: [] },
          { id: 'b', predecessors: [{ id: 'a', lag: 0 }, { id: 'missing', lag: 0 }] },
          { id: 'c', predecessors: ['b'] },
        ],
      };

      syncStepLinks(phase);

      assert.deepEqual(phase.steps[1].predecessors, [{ id: 'a', lag: 0 }]);
      assert.deepEqual(phase.steps[0].successors, ['b']);
      assert.deepEqual(phase.steps[1].successors, ['c']);
      assert.deepEqual(phase.steps[2].successors, []);
    },
  },
  {
    name: 'wouldCreateCycleFromPreds blocks reverse links that would create a cycle',
    run() {
      const phase = {
        steps: [
          { id: 'a', predecessors: [] },
          { id: 'b', predecessors: [{ id: 'a', lag: 0 }] },
          { id: 'c', predecessors: [{ id: 'b', lag: 0 }] },
        ],
      };

      assert.equal(wouldCreateCycleFromPreds(phase, 'c', 'a'), true);
      assert.equal(wouldCreateCycleFromPreds(phase, 'a', 'c'), false);
    },
  },
  {
    name: 'cascadeStepDates reschedules dependents using predecessor end dates and lag',
    run() {
      const phase = {
        start: '2026-05-18',
        steps: [
          { id: 'a', name: 'Layout', start: '2026-05-18', duration: 2, end: '2026-05-19', predecessors: [] },
          { id: 'b', name: 'Framing', start: '', duration: 3, end: '', predecessors: [{ id: 'a', lag: 1 }] },
          { id: 'c', name: 'Inspection', start: '', duration: 1, end: '', predecessors: [{ id: 'b', lag: 0 }] },
        ],
      };

      cascadeStepDates(phase, weekdaySettings);

      assert.equal(phase.steps[1].start, '2026-05-21');
      assert.equal(phase.steps[1].end, '2026-05-26');
      assert.equal(phase.steps[2].start, '2026-05-27');
      assert.equal(phase.steps[2].end, '2026-05-27');
    },
  },
  {
    name: 'cascadeStepDates treats a dependent step date as a no-sooner-than constraint',
    run() {
      const phase = {
        start: '2026-05-18',
        steps: [
          { id: 'a', name: 'Layout', start: '2026-05-18', duration: 2, end: '2026-05-19', predecessors: [] },
          {
            id: 'b',
            name: 'Framing',
            start: '2026-06-01',
            notBefore: '2026-06-01',
            duration: 2,
            end: '2026-06-02',
            predecessors: [{ id: 'a', lag: 0 }],
          },
        ],
      };

      cascadeStepDates(phase, weekdaySettings);
      assert.equal(phase.steps[1].start, '2026-06-01');
      assert.equal(phase.steps[1].end, '2026-06-02');

      phase.steps[0].end = '2026-06-03';
      cascadeStepDates(phase, weekdaySettings);
      assert.equal(phase.steps[1].start, '2026-06-04');
      assert.equal(phase.steps[1].end, '2026-06-05');

      phase.steps[0].end = '2026-05-19';
      cascadeStepDates(phase, weekdaySettings);
      assert.equal(phase.steps[1].start, '2026-06-01');
      assert.equal(phase.steps[1].end, '2026-06-02');

      phase.steps[1].predecessors = [];
      cascadeStepDates(phase, weekdaySettings);
      assert.equal(phase.steps[1].notBefore, '');
    },
  },
  {
    name: 'applyDelayToStep extends duration and recomputes end date',
    run() {
      const step = {
        id: 'a',
        start: '2026-05-18',
        duration: 2,
        end: '2026-05-19',
      };

      const delayed = applyDelayToStep(step, 2, weekdaySettings);

      assert.equal(delayed.duration, 4);
      assert.equal(delayed.end, '2026-05-21');
    },
  },
  {
    name: 'syncProjectTasks updates matching task due dates from step end dates',
    run() {
      const project = syncProjectPhaseDates({
        id: 'project-1',
        status: 'active',
        phases: [
          {
            id: 'phase-1',
            status: 'active',
            steps: [
              { id: 'step-1', name: 'Excavation', start: '2026-05-18', end: '2026-05-20', status: 'done' },
              { id: 'step-2', name: 'Framing', start: '2026-05-21', end: '2026-05-28', status: 'active' },
            ],
          },
        ],
      });

      const tasks = [
        { id: 'task-1', projectId: 'project-1', label: 'Framing', due: '' },
        { id: 'task-2', projectId: 'project-1', label: 'Cleanup', due: '' },
        { id: 'task-3', projectId: 'project-2', label: 'Framing', due: '' },
      ];

      const synced = syncProjectTasks('project-1', project, tasks);

      assert.equal(synced[0].due, '2026-05-28');
      assert.equal(synced[1].due, '');
      assert.equal(synced[2].due, '');
      assert.equal(project.phases[0].start, '2026-05-18');
      assert.equal(project.phases[0].end, '2026-05-28');
    },
  },
  {
    name: 'syncProjectTasks skips unnamed steps without crashing',
    run() {
      const project = {
        id: 'project-1',
        phases: [
          {
            id: 'phase-1',
            steps: [
              { id: 'step-1', end: '2026-05-28' },
              { id: 'step-2', name: 'Framing', end: '2026-05-30' },
            ],
          },
        ],
      };

      const tasks = [
        { id: 'task-1', projectId: 'project-1', label: 'Framing', due: '' },
        { id: 'task-2', projectId: 'project-1', due: '' },
      ];

      const synced = syncProjectTasks('project-1', project, tasks);

      assert.equal(synced[0].due, '2026-05-30');
      assert.equal(synced[1].due, '');
    },
  },
  {
    name: 'wouldCreatePhaseCycleFromPreds blocks reverse links that would create a phase cycle',
    run() {
      const project = {
        phases: [
          { id: 'phase-a', predecessors: [] },
          { id: 'phase-b', predecessors: [{ id: 'phase-a', lag: 0 }] },
          { id: 'phase-c', predecessors: [{ id: 'phase-b', lag: 0 }] },
        ],
      };

      assert.equal(wouldCreatePhaseCycleFromPreds(project, 'phase-c', 'phase-a'), true);
      assert.equal(wouldCreatePhaseCycleFromPreds(project, 'phase-a', 'phase-c'), false);
    },
  },
  {
    name: 'cascadePhaseDates shifts dependent phases after predecessor phase end dates',
    run() {
      const project = {
        id: 'project-1',
        status: 'active',
        phases: [
          {
            id: 'phase-a',
            name: 'Foundation',
            steps: [
              { id: 'step-a', name: 'Footings', start: '2026-05-18', duration: 3, end: '2026-05-20', predecessors: [] },
            ],
          },
          {
            id: 'phase-b',
            name: 'Framing',
            predecessors: [{ id: 'phase-a', lag: 1 }],
            steps: [
              { id: 'step-b1', name: 'Walls', start: '2026-05-19', duration: 2, end: '2026-05-20', predecessors: [] },
              { id: 'step-b2', name: 'Trusses', start: '2026-05-21', duration: 1, end: '2026-05-21', predecessors: [{ id: 'step-b1', lag: 0 }] },
            ],
          },
        ],
      };

      const cascaded = syncProjectPhaseDates(cascadePhaseDates(syncProjectPhaseDates(project), weekdaySettings));

      assert.equal(cascaded.phases[1].start, '2026-05-22');
      assert.equal(cascaded.phases[1].steps[0].start, '2026-05-22');
      assert.equal(cascaded.phases[1].steps[0].end, '2026-05-26');
      assert.equal(cascaded.phases[1].steps[1].start, '2026-05-27');
    },
  },
  {
    name: 'buildScheduleRows sorts steps within each phase by start date, then end date, then name',
    run() {
      const rows = buildScheduleRows(
        [
          {
            id: 'project-1',
            name: 'House',
            status: 'active',
            phases: [
              {
                id: 'phase-1',
                name: 'Build',
                status: 'active',
                steps: [
                  { id: 'step-z', name: 'Zeta', start: '', end: '2026-05-29', duration: 1 },
                  { id: 'step-b', name: 'Beta', start: '2026-05-19', end: '2026-05-21', duration: 3 },
                  { id: 'step-a', name: 'Alpha', start: '2026-05-19', end: '2026-05-20', duration: 2 },
                  { id: 'step-c', name: 'Charlie', start: '', end: '', duration: 1 },
                ],
                delays: [],
              },
            ],
          },
        ],
        new Map(),
        false,
        { 'project-1': true },
        { 'phase-1': true },
      );

      const orderedStepIds = rows
        .filter((row) => row.type === 'step')
        .map((row) => row.entityId);

      assert.deepEqual(orderedStepIds, ['step-a', 'step-b', 'step-z', 'step-c']);
    },
  },
  {
    name: 'past phases default to collapsed while current, future, and undated phases stay open',
    run() {
      const pastPhase = {
        id: 'past',
        start: '2026-06-01',
        end: '2026-06-30',
        steps: [{ id: 'past-step', start: '2026-06-05', end: '2026-06-10' }],
      };
      const futurePhase = {
        id: 'future',
        start: '2026-06-01',
        end: '2026-07-20',
        steps: [{ id: 'future-step', start: '2026-07-15', end: '2026-07-20' }],
      };
      const undatedPhase = { id: 'undated', steps: [] };
      assert.equal(isPhaseEntirelyPast(pastPhase, '2026-07-13'), true);
      assert.equal(isPhaseEntirelyPast(futurePhase, '2026-07-13'), false);
      assert.equal(isPhaseEntirelyPast(undatedPhase, '2026-07-13'), false);
      assert.deepEqual(
        getDefaultPhaseExpansion([{ phases: [pastPhase, futurePhase, undatedPhase] }], '2026-07-13'),
        { past: false },
      );
    },
  },
  {
    name: 'buildScheduleRows can hide past phases and steps while keeping current and future ones',
    run() {
      const rows = buildScheduleRows(
        [
          {
            id: 'project-1',
            name: 'House',
            status: 'active',
            phases: [
              {
                id: 'phase-past',
                name: 'Past',
                start: '2026-05-01',
                end: '2026-05-05',
                status: 'done',
                steps: [
                  { id: 'step-past', name: 'Past step', start: '2026-05-01', end: '2026-05-05', duration: 5 },
                ],
                delays: [],
              },
              {
                id: 'phase-current',
                name: 'Current',
                start: '2026-06-01',
                end: '2026-06-04',
                status: 'active',
                steps: [
                  { id: 'step-current', name: 'Current step', start: '2026-06-02', end: '2026-06-04', duration: 3 },
                ],
                delays: [],
              },
              {
                id: 'phase-future',
                name: 'Future',
                start: '2026-06-10',
                end: '2026-06-12',
                status: 'active',
                steps: [
                  { id: 'step-future', name: 'Future step', start: '2026-06-10', end: '2026-06-12', duration: 3 },
                ],
                delays: [],
              },
            ],
          },
        ],
        new Map(),
        false,
        { 'project-1': true },
        { 'phase-past': true, 'phase-current': true, 'phase-future': true },
        { showCurrentAndFutureOnly: true, todayIso: '2026-06-01' },
      );

      assert.deepEqual(
        rows.map((row) => row.id),
        ['project-project-1', 'phase-phase-current', 'step-step-current', 'phase-phase-future', 'step-step-future'],
      );
    },
  },
  {
    name: 'buildCalendarItems emits multi-day phases, steps, and delays as range items once',
    run() {
      const calendar = buildCalendarItems(
        [
          {
            id: 'project-1',
            name: 'House',
            status: 'active',
            phases: [
              {
                id: 'phase-1',
                name: 'Foundation',
                start: '2026-05-18',
                end: '2026-05-22',
                status: 'active',
                steps: [
                  {
                    id: 'step-1',
                    name: 'Excavate',
                    start: '2026-05-18',
                    end: '2026-05-20',
                    duration: 3,
                    assign: 'Crew A',
                  },
                ],
                delays: [
                  {
                    id: 'delay-1',
                    stepId: 'step-1',
                    cause: 'Rain',
                    days: 2,
                    description: 'Site too wet',
                  },
                ],
              },
            ],
          },
        ],
        new Map(),
        { holidays: [] },
      );

      assert.equal(calendar.rangeItems.filter((item) => item.type === 'phase').length, 1);
      assert.equal(calendar.rangeItems.filter((item) => item.type === 'step').length, 1);
      assert.equal(calendar.rangeItems.filter((item) => item.type === 'delay').length, 1);
      assert.equal(calendar.itemsByDate.size, 0);

      const delayItem = calendar.rangeItems.find((item) => item.type === 'delay');
      assert.equal(delayItem.start, '2026-05-18');
      assert.equal(delayItem.end, '2026-05-20');
    },
  },
  {
    name: 'buildCalendarItems keeps task due dates in day items while holidays span each covered day',
    run() {
      const tasksByProject = new Map([
        [
          'project-1',
          [
            { id: 'task-1', label: 'Inspection', due: '2026-05-21', done: false, assignee: 'Crew A' },
            { id: 'task-2', label: 'Cleanup', due: '2026-05-21', done: true, assignee: '' },
          ],
        ],
      ]);

      const calendar = buildCalendarItems(
        [{ id: 'project-1', name: 'House', status: 'active', phases: [] }],
        tasksByProject,
        {
          holidays: [
            {
              id: 'holiday-1',
              name: 'Break',
              date: '2026-05-25',
              endDate: '2026-05-26',
              nonWorkday: true,
            },
          ],
        },
      );

      assert.deepEqual(
        calendar.itemsByDate.get('2026-05-21').map((item) => item.id),
        ['task-task-2', 'task-task-1'],
      );
      assert.equal(calendar.itemsByDate.get('2026-05-21')[0].taskId, 'task-2');
      assert.equal(calendar.itemsByDate.get('2026-05-21')[0].projectId, 'project-1');
      assert.equal(calendar.itemsByDate.get('2026-05-21')[1].assignee, 'Crew A');
      assert.equal(calendar.holidayMap.get('2026-05-25').length, 1);
      assert.equal(calendar.holidayMap.get('2026-05-26').length, 1);
    },
  },
  {
    name: 'buildCalendarItems includes inspections as day items on their inspection date',
    run() {
      const calendar = buildCalendarItems(
        [
          {
            id: 'project-1',
            name: 'House',
            status: 'active',
            inspections: [
              {
                id: 'inspection-1',
                subcode: 'FRAME-220',
                inspectionType: 'Framing inspection',
                date: '2026-05-22',
                status: 'requested',
                agency: 'County',
                notes: 'AM window',
              },
            ],
            phases: [],
          },
        ],
        new Map(),
        { holidays: [] },
      );

      const inspectionItems = calendar.itemsByDate.get('2026-05-22') || [];
      assert.equal(inspectionItems.length, 1);
      assert.equal(inspectionItems[0].type, 'inspection');
      assert.equal(inspectionItems[0].subcode, 'FRAME-220');
      assert.equal(inspectionItems[0].inspectionType, 'Framing inspection');
    },
  },
  {
    name: 'buildCalendarItems promotes multi-day holidays to range bars and keeps daily holiday shading',
    run() {
      const calendar = buildCalendarItems(
        [],
        new Map(),
        {
          holidays: [
            {
              id: 'holiday-1',
              name: 'Shutdown',
              date: '2026-05-25',
              endDate: '2026-05-27',
              nonWorkday: true,
            },
          ],
        },
      );

      const holidayBar = calendar.rangeItems.find((item) => item.type === 'holiday');
      assert.equal(holidayBar.label, 'Shutdown');
      assert.equal(holidayBar.start, '2026-05-25');
      assert.equal(holidayBar.end, '2026-05-27');
      assert.equal(calendar.holidayMap.get('2026-05-25')[0].isRange, true);
      assert.equal(calendar.holidayMap.get('2026-05-26')[0].isRange, true);
      assert.equal(calendar.holidayMap.get('2026-05-27')[0].isRange, true);
    },
  },
  {
    name: 'buildCalendarItems can hide phase bars while keeping step bars',
    run() {
      const calendar = buildCalendarItems(
        [
          {
            id: 'project-1',
            name: 'House',
            status: 'active',
            phases: [
              {
                id: 'phase-1',
                name: 'Foundation',
                start: '2026-05-18',
                end: '2026-05-22',
                status: 'active',
                steps: [
                  {
                    id: 'step-1',
                    name: 'Excavate',
                    start: '2026-05-18',
                    end: '2026-05-20',
                    duration: 3,
                    assign: 'Crew A',
                  },
                ],
              },
            ],
          },
        ],
        new Map(),
        { holidays: [], showCalendarPhases: false },
      );

      assert.equal(calendar.rangeItems.some((item) => item.type === 'phase'), false);
      assert.equal(calendar.rangeItems.some((item) => item.type === 'step'), true);
    },
  },
  {
    name: 'buildCalendarWeeks caps visible lanes and reports hidden overlapping bars',
    run() {
      const cells = [
        '2026-05-17',
        '2026-05-18',
        '2026-05-19',
        '2026-05-20',
        '2026-05-21',
        '2026-05-22',
        '2026-05-23',
      ].map((key) => ({
        key,
        date: new Date(`${key}T00:00:00`),
        isCurrentMonth: true,
        isToday: false,
        holidays: [],
        items: [],
      }));

      const weeks = buildCalendarWeeks(
        cells,
        [
          { id: 'a', type: 'phase', label: 'A', start: '2026-05-18', end: '2026-05-21' },
          { id: 'b', type: 'step', label: 'B', start: '2026-05-18', end: '2026-05-21' },
          { id: 'c', type: 'delay', label: 'C', start: '2026-05-18', end: '2026-05-21' },
          { id: 'd', type: 'step', label: 'D', start: '2026-05-18', end: '2026-05-21' },
        ],
        3,
      );

      assert.equal(weeks.length, 1);
      assert.equal(weeks[0].laneCount, 4);
      assert.equal(weeks[0].visibleLaneCount, 3);
      assert.equal(weeks[0].hiddenBarCount, 1);
      assert.equal(weeks[0].holidayBars.length, 0);
      assert.deepEqual(
        weeks[0].bars.map((bar) => ({ id: bar.id, lane: bar.lane })),
        [
          { id: 'a', lane: 0 },
          { id: 'b', lane: 1 },
          { id: 'c', lane: 2 },
        ],
      );
    },
  },
  {
    name: 'buildCalendarWeeks reuses lanes for non-overlapping bars in the same week',
    run() {
      const cells = [
        '2026-05-17',
        '2026-05-18',
        '2026-05-19',
        '2026-05-20',
        '2026-05-21',
        '2026-05-22',
        '2026-05-23',
      ].map((key) => ({
        key,
        date: new Date(`${key}T00:00:00`),
        isCurrentMonth: true,
        isToday: false,
        holidays: [],
        items: [],
      }));

      const weeks = buildCalendarWeeks(cells, [
        { id: 'a', type: 'phase', label: 'A', start: '2026-05-17', end: '2026-05-18' },
        { id: 'b', type: 'step', label: 'B', start: '2026-05-19', end: '2026-05-20' },
        { id: 'c', type: 'delay', label: 'C', start: '2026-05-21', end: '2026-05-22' },
      ]);

      assert.equal(weeks[0].laneCount, 1);
      assert.equal(weeks[0].visibleLaneCount, 1);
      assert.equal(weeks[0].hiddenBarCount, 0);
      assert.deepEqual(
        weeks[0].bars.map((bar) => ({ id: bar.id, startCol: bar.startCol, endCol: bar.endCol, lane: bar.lane })),
        [
          { id: 'a', startCol: 0, endCol: 1, lane: 0 },
          { id: 'b', startCol: 2, endCol: 3, lane: 0 },
          { id: 'c', startCol: 4, endCol: 5, lane: 0 },
        ],
      );
    },
  },
  {
    name: 'buildCalendarWeeks keeps holidays visible while hiding only scheduled overflow',
    run() {
      const cells = [
        '2026-05-17',
        '2026-05-18',
        '2026-05-19',
        '2026-05-20',
        '2026-05-21',
        '2026-05-22',
        '2026-05-23',
      ].map((key) => ({
        key,
        date: new Date(`${key}T00:00:00`),
        isCurrentMonth: true,
        isToday: false,
        holidays: [],
        items: [],
      }));

      const weeks = buildCalendarWeeks(
        cells,
        [
          { id: 'holiday-1', type: 'holiday', label: 'Holiday', start: '2026-05-18', end: '2026-05-22' },
          { id: 'a', type: 'phase', label: 'A', start: '2026-05-18', end: '2026-05-21' },
          { id: 'b', type: 'step', label: 'B', start: '2026-05-18', end: '2026-05-21' },
          { id: 'c', type: 'delay', label: 'C', start: '2026-05-18', end: '2026-05-21' },
          { id: 'd', type: 'step', label: 'D', start: '2026-05-18', end: '2026-05-21' },
        ],
        3,
      );

      assert.equal(weeks[0].hiddenBarCount, 1);
      assert.equal(weeks[0].bars.length, 3);
      assert.equal(weeks[0].holidayBars.length, 1);
      assert.equal(weeks[0].holidayBars[0].id, 'holiday-1');
    },
  },
  {
    name: 'normalized authorization policies use app-user helpers instead of settings JSON',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716220000_use_normalized_authorization.sql', import.meta.url),
        'utf8',
      );

      assert.match(migrationSource, /create or replace function public\.current_app_user_id\(\)/);
      assert.match(migrationSource, /create or replace function public\.current_app_user_role\(\)/);
      assert.match(migrationSource, /create or replace function public\.is_app_user\(\)/);
      assert.match(migrationSource, /create or replace function public\.app_user_can_edit\(\)/);
      assert.match(migrationSource, /security definer/g);
      assert.match(migrationSource, /grant execute on function public\.is_app_user\(\) to authenticated/);
      assert.doesNotMatch(migrationSource, /jsonb_array_elements[\s\S]*?data->'users'/);
      assert.equal(
        (migrationSource.match(/using \(public\.is_app_user\(\)\)/g) || []).length,
        22,
      );
    },
  },
  {
    name: 'write RPCs authorize through normalized users and project access',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260716230000_use_normalized_write_authorization.sql', import.meta.url),
        'utf8',
      );

      assert.match(migrationSource, /create or replace function public\.app_user_can_edit_project\(p_project_id text\)/);
      assert.match(migrationSource, /from public\.project_user_access access_row/);
      assert.match(migrationSource, /access_row\.user_id = public\.current_app_user_id\(\)/);
      assert.match(migrationSource, /coalesce\(public\.current_app_user_role\(\) in \('Admin', 'Edit'\), false\)/);
      for (const functionName of [
        'apply_tracker_batch',
        'save_normalized_project_sections',
        'save_normalized_project_inspections',
        'save_task_with_attachments',
      ]) {
        assert.match(migrationSource, new RegExp(`create or replace function public\\.${functionName}\\(`));
      }
      assert.doesNotMatch(migrationSource, /app_settings|accessUserIds|data->'users'/);
      assert.ok((migrationSource.match(/public\.app_user_can_edit_project\(/g) || []).length >= 6);
    },
  },
  {
    name: 'project records and normalized children enforce server-side visibility',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260717000000_scope_project_reads.sql', import.meta.url),
        'utf8',
      );

      assert.match(migrationSource, /create or replace function public\.app_user_can_view_project\(p_project_id text\)/);
      assert.match(migrationSource, /create or replace function public\.app_user_can_view_task\(p_task_id text\)/);
      assert.match(migrationSource, /when public\.current_app_user_role\(\) = 'Admin' then true/);
      assert.match(migrationSource, /else public\.current_app_user_role\(\) = 'Edit'/);
      assert.match(migrationSource, /access_row\.user_id = public\.current_app_user_id\(\)/);
      assert.match(migrationSource, /create policy "App users can select projects"[\s\S]*?as permissive for select/s);
      assert.match(migrationSource, /create policy "App users can select tasks"[\s\S]*?as permissive for select/s);
      assert.match(migrationSource, /create policy "App users can read visible projects"[\s\S]*?as restrictive for select/s);
      assert.match(migrationSource, /create policy "App users can read visible tasks"[\s\S]*?as restrictive for select/s);
      for (const tableName of [
        'project_phases',
        'project_steps',
        'project_file_folders',
        'project_files',
        'project_photos',
        'project_selections',
        'project_selection_attachments',
        'project_selection_photos',
        'project_inspections',
        'project_inspection_files',
        'project_phase_assignments',
        'project_step_assignments',
        'project_user_access',
        'selection_task_links',
        'project_phase_dependencies',
        'project_step_dependencies',
        'project_schedule_delays',
      ]) {
        assert.match(
          migrationSource,
          new RegExp(`create policy [\\s\\S]*? on public\\.${tableName}[\\s\\S]*?app_user_can_view_project\\(project_id\\)`),
        );
      }
      assert.match(migrationSource, /on public\.task_attachments[\s\S]*?app_user_can_view_task\(task_id\)/);
      assert.match(migrationSource, /on public\.task_assignments[\s\S]*?app_user_can_view_task\(task_id\)/);
    },
  },
  {
    name: 'schedule cascades save normalized projects and tasks in one transaction',
    async run() {
      const [migrationSource, trackerSource] = await Promise.all([
        readFile(
          new URL('../supabase/migrations/20260717010000_add_normalized_project_task_batch.sql', import.meta.url),
          'utf8',
        ),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
      ]);

      assert.match(migrationSource, /create or replace function public\.save_normalized_project_task_batch/);
      assert.match(migrationSource, /public\.save_normalized_project_sections\(/);
      assert.match(migrationSource, /public\.save_normalized_project_inspections\(/);
      assert.match(migrationSource, /task_results := public\.apply_tracker_batch\(p_task_operations\)/);
      assert.match(migrationSource, /operation->>'table' <> 'tasks'/);
      assert.match(trackerSource, /rpc\/save_normalized_project_task_batch/);
      assert.match(trackerSource, /canUseNormalizedBatch/);
      assert.match(trackerSource, /applyNormalizedProjectTaskBatch\(normalizedProjectUpdates, taskOperations\)/);
    },
  },
  {
    name: 'schedule synchronization is explicit instead of project-trigger driven',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260717020000_make_schedule_sync_explicit.sql', import.meta.url),
        'utf8',
      );

      assert.match(migrationSource, /drop trigger if exists projects_normalized_schedule_insert_trigger/);
      assert.match(migrationSource, /drop trigger if exists projects_normalized_schedule_update_trigger/);
      assert.match(migrationSource, /create or replace function public\.apply_tracker_batch/);
      assert.match(migrationSource, /record_data := operation->'data'/);
      assert.match(migrationSource, /table_name = 'projects' and not delete_record and record_data \? 'phases'/);
      assert.match(migrationSource, /perform public\.sync_normalized_project_schedule\(record_id, record_data\)/);
      assert.doesNotMatch(migrationSource, /create trigger projects_normalized_schedule/);
    },
  },
  {
    name: 'all project-owned normalized sections synchronize explicitly',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260717030000_make_project_section_sync_explicit.sql', import.meta.url),
        'utf8',
      );

      for (const triggerName of [
        'projects_normalized_assets_insert_trigger',
        'projects_normalized_assets_update_trigger',
        'projects_normalized_selections_insert_trigger',
        'projects_normalized_selections_update_trigger',
        'projects_normalized_inspections_insert_trigger',
        'projects_normalized_inspections_update_trigger',
        'projects_normalized_access_trigger',
      ]) {
        assert.match(migrationSource, new RegExp(`drop trigger if exists ${triggerName}`));
      }
      assert.match(migrationSource, /create or replace function public\.sync_explicit_project_sections/);
      for (const functionName of [
        'sync_normalized_project_schedule',
        'sync_normalized_project_assets',
        'sync_normalized_project_selections',
        'sync_normalized_project_inspections',
        'sync_normalized_project_access',
      ]) {
        assert.match(migrationSource, new RegExp(`perform public\\.${functionName}\\(p_project_id, p_project_data\\)`));
      }
      assert.match(migrationSource, /perform public\.sync_explicit_project_sections\(record_id, record_data\)/);
      assert.doesNotMatch(migrationSource, /create trigger projects_normalized_(assets|selections|inspections|access)/);
    },
  },
  {
    name: 'task attachments and assignees synchronize explicitly',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260717040000_make_task_section_sync_explicit.sql', import.meta.url),
        'utf8',
      );

      assert.match(migrationSource, /drop trigger if exists tasks_normalized_attachments_insert_trigger/);
      assert.match(migrationSource, /drop trigger if exists tasks_normalized_attachments_update_trigger/);
      assert.match(migrationSource, /drop trigger if exists tasks_normalized_assignments_trigger/);
      assert.match(migrationSource, /create or replace function public\.sync_explicit_task_sections/);
      assert.match(migrationSource, /perform public\.sync_normalized_task_attachments\(p_task_id, p_task_data\)/);
      assert.match(migrationSource, /perform public\.sync_task_assignments\(p_task_id, p_task_data\)/);
      assert.match(migrationSource, /perform public\.sync_explicit_task_sections\(record_id, record_data\)/);
      assert.match(migrationSource, /perform public\.sync_explicit_task_sections\(p_task_id, p_task_data\)/);
      assert.doesNotMatch(migrationSource, /create trigger tasks_normalized_(attachments|assignments)/);
    },
  },
  {
    name: 'Takeoff project file picker lists PDFs from the current project',
    run() {
      const project = {
        files: {
          folders: [
            {
              id: 'plans',
              name: 'Plans',
              files: [
                { id: 'pdf-by-type', name: 'Drawing', type: 'application/pdf' },
                { id: 'pdf-by-name', originalName: 'Details.PDF', type: 'application/octet-stream' },
                { id: 'image', name: 'Elevation.jpg', type: 'image/jpeg' },
              ],
            },
          ],
        },
      };

      assert.equal(isProjectPdf(project.files.folders[0].files[0]), true);
      assert.equal(isProjectPdf(project.files.folders[0].files[1]), true);
      assert.equal(isProjectPdf(project.files.folders[0].files[2]), false);
      assert.equal(projectFileDisplayName(project.files.folders[0].files[1]), 'Details.PDF');
      assert.deepEqual(listProjectPdfFiles(project).map((file) => ({ id: file.id, folderName: file.folderName })), [
        { id: 'pdf-by-type', folderName: 'Plans' },
        { id: 'pdf-by-name', folderName: 'Plans' },
      ]);
    },
  },
  {
    name: 'Takeoff stays lazy loaded and uses project-scoped authenticated storage',
    async run() {
      const [projectDetailSource, takeoffWorkspaceSource, takeoffStyleSource, takeoffServiceSource, takeoffEditorSource, takeoffMigrationSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/features/takeoff/TakeoffWorkspace.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/features/takeoff/takeoff.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/features/takeoff/services/projectTakeoffData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/features/takeoff/lib/takeoffApp.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260717060000_add_project_takeoffs.sql', import.meta.url), 'utf8'),
      ]);

      assert.match(projectDetailSource, /lazy\(\(\) => import\('\.\.\/features\/takeoff\/TakeoffWorkspace\.jsx'\)\)/);
      assert.match(projectDetailSource, /<TakeoffWorkspace project=\{project\} projectId=\{project\.id\} canEdit=\{canEdit\}/);
      assert.match(takeoffWorkspaceSource, /selectProjectPdf/);
      assert.match(takeoffWorkspaceSource, /projectFileToBrowserFile/);
      assert.match(takeoffWorkspaceSource, /Project PDF/);
      assert.match(takeoffEditorSource, /Replace this drawing\? Unsaved Takeoff changes will be discarded\./);
      assert.match(takeoffWorkspaceSource, /project-tracker:takeoff-sidebar-layout:v1/);
      assert.match(takeoffWorkspaceSource, /takeoff-full-window-open/);
      assert.match(takeoffWorkspaceSource, /is-full-window/);
      assert.match(takeoffWorkspaceSource, /Expand Takeoff to full browser window/);
      assert.match(takeoffWorkspaceSource, /className="header-edit-actions"/);
      assert.match(takeoffWorkspaceSource, /FolderOpen24Regular/);
      assert.match(takeoffWorkspaceSource, /FullScreenMaximize24Regular/);
      assert.match(takeoffWorkspaceSource, /ZoomIn24Regular/);
      assert.match(takeoffWorkspaceSource, /<span>Open<\/span>/);
      assert.doesNotMatch(takeoffWorkspaceSource, /Saved Takeoffs/);
      assert.ok(
        takeoffWorkspaceSource.indexOf('id="uploadButton"') > takeoffWorkspaceSource.indexOf('className="button compact button-with-icon full-window-toggle"'),
        'Upload PDF should be the last Takeoff header action',
      );
      assert.ok(
        takeoffWorkspaceSource.indexOf('id="emptyUploadButton"') > takeoffWorkspaceSource.indexOf('id="emptySelectProjectPdfButton"'),
        'Upload PDF should be the last Takeoff empty-state action',
      );
      assert.match(takeoffEditorSource, /!state\.savedProjectId/);
      assert.match(takeoffEditorSource, /state\.savedProjectId = result\?\.id/);
      const toolStripSource = takeoffWorkspaceSource.match(/<div className="tool-strip"[\s\S]*?<div id="viewer"/)?.[0] || '';
      assert.doesNotMatch(toolStripSource, /id="undoAction"|id="redoAction"|id="snapToggle"|id="finishMeasure"/);
      assert.match(takeoffStyleSource, /\.workspace\.pages-collapsed/);
      assert.match(takeoffStyleSource, /\.workspace\.takeoff-collapsed/);
      assert.match(takeoffServiceSource, /fetchAuthorizedSupabase/);
      assert.match(takeoffServiceSource, /project_id=eq\.\$\{encodeURIComponent\(scopedProjectId\)\}/);
      assert.match(takeoffServiceSource, /plan-takeoff:autosave:\$\{scopedProjectId\}/);
      assert.doesNotMatch(takeoffServiceSource, /VITE_SUPABASE_KEY|Bearer \$\{SUPABASE_KEY\}/);
      assert.match(takeoffEditorSource, /const unbindEvents = bindEvents\(\)/);
      assert.match(takeoffEditorSource, /const eventController = new AbortController\(\)/);
      assert.match(takeoffEditorSource, /target\.addEventListener\(type, listener, \{ \.\.\.options, signal \}\)/);
      assert.match(takeoffEditorSource, /return \(\) => eventController\.abort\(\)/);
      assert.match(takeoffEditorSource, /unbindEvents\(\)/);
      assert.match(takeoffEditorSource, /sessionStorageKey = String\(services\.sessionKey/);
      assert.match(takeoffMigrationSource, /create table if not exists public\.project_takeoffs/);
      assert.match(takeoffMigrationSource, /public\.app_user_can_view_project\(project_id\)/);
      assert.match(takeoffMigrationSource, /public\.app_user_can_edit_project\(project_id\)/);
      assert.match(takeoffMigrationSource, /values \('takeoff-files', 'takeoff-files', false\)/);
      assert.match(takeoffMigrationSource, /public\.app_user_can_edit_project\(\(storage\.foldername\(name\)\)\[2\]\)/);
    },
  },
  {
    name: 'daily logs and change orders are project-scoped authorized workflows',
    async run() {
      const [detailSource, managerSource, serviceSource, migrationSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectWorkflowManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260719180000_add_daily_logs_and_change_orders.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(detailSource, /lazy\(\(\) => import\('\.\/ProjectWorkflowManager\.jsx'\)\)/);
      assert.match(detailSource, /workflowType="dailyLogs"/);
      assert.match(detailSource, /workflowType="changeOrders"/);
      assert.match(detailSource, /subcontractors=\{data\?\.subs \|\| \[\]\}/);
      assert.match(detailSource, /onStateChange=\{onStateChange\}/);
      assert.match(managerSource, /Work performed/);
      assert.doesNotMatch(managerSource, /Additional labor notes/);
      assert.match(managerSource, /<label className="full"><span>Notes<\/span>/);
      assert.match(managerSource, /subcontractorDisplayName/);
      assert.match(managerSource, /`\$\{company\} \(\$\{contact\}\)`/);
      assert.match(managerSource, /createPerson\(data, 'sub', personDraft\)/);
      assert.match(managerSource, /New subcontractor/);
      assert.match(managerSource, /<PersonModal/);
      assert.match(managerSource, /subcontractorWork/);
      assert.match(managerSource, /Select from People/);
      assert.match(managerSource, /uploadProjectFileToStorage\(project\.id, 'daily-log-photos'/);
      assert.match(managerSource, /accept="image\/\*"/);
      assert.match(managerSource, /deleteProjectFileFromStorage/);
      assert.match(managerSource, /loadCurrentWeatherConditions/);
      assert.match(managerSource, /Loading current weather/);
      assert.match(managerSource, /Cost impact/);
      assert.match(managerSource, /change-order-attachments/);
      assert.match(managerSource, /<WorkflowAttachments/);
      assert.match(serviceSource, /version=eq\.\$\{draft\.version\}/);
      assert.match(serviceSource, /project_id=eq\.\$\{encodeURIComponent\(scopedProjectId\)\}/);
      assert.match(migrationSource, /create table if not exists public\.project_daily_logs/);
      assert.match(migrationSource, /create table if not exists public\.project_change_orders/);
      assert.match(migrationSource, /public\.app_user_can_view_project\(project_id\)/);
      assert.match(migrationSource, /public\.app_user_can_edit_project\(project_id\)/);
      assert.match(migrationSource, /'daily_log', 'change_order'/);
      assert.match(styleSource, /\.project-workflow-form-grid/);
      assert.match(styleSource, /grid-auto-rows: max-content/);
      assert.match(styleSource, /\.project-workflow-form-grid > \.full/);
      assert.match(styleSource, /\.project-workflow-contractor-editor/);
      assert.match(styleSource, /\.project-workflow-photo-list/);
    },
  },
  {
    name: 'RFIs and submittals are project-scoped construction workflows',
    async run() {
      const [detailSource, managerSource, serviceSource, migrationSource, styleSource, projectTabsSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectRfiSubmittalsManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720140000_add_rfis_and_submittals.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/projectTabs.js', import.meta.url), 'utf8'),
      ]);
      assert.match(detailSource, /lazy\(\(\) => import\('\.\/ProjectRfiSubmittalsManager\.jsx'\)\)/);
      assert.match(projectTabsSource, /label: 'RFIs & Submittals'/);
      assert.match(detailSource, /activeDetailTab === 'rfis-submittals'/);
      assert.match(managerSource, /service\.list\('rfis'\)/);
      assert.match(managerSource, /service\.list\('submittals'\)/);
      assert.match(managerSource, /Responsible person/);
      assert.match(managerSource, /Specification section/);
      assert.match(managerSource, /Subcontractor/);
      assert.match(managerSource, /approved_as_noted/);
      assert.match(managerSource, /revise_resubmit/);
      assert.match(managerSource, /rfi-attachments/);
      assert.match(managerSource, /submittal-attachments/);
      assert.match(managerSource, /<WorkflowAttachments/);
      assert.match(serviceSource, /rfis: \{ table: 'project_rfis'/);
      assert.match(serviceSource, /submittals: \{ table: 'project_submittals'/);
      assert.match(serviceSource, /version=eq\.\$\{draft\.version\}/);
      assert.match(migrationSource, /create table if not exists public\.project_rfis/);
      assert.match(migrationSource, /create table if not exists public\.project_submittals/);
      assert.match(migrationSource, /public\.app_user_can_view_project\(project_id\)/);
      assert.match(migrationSource, /public\.app_user_can_edit_project\(project_id\)/);
      assert.match(migrationSource, /'rfi', 'submittal'/);
      assert.match(styleSource, /\.project-document-workflow-switch/);
    },
  },
  {
    name: 'budget items and commitments are project-scoped financial workflows',
    async run() {
      const [detailSource, managerSource, serviceSource, migrationSource, styleSource, projectTabsSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectBudgetCommitmentsManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720170000_add_budget_and_commitments.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/projectTabs.js', import.meta.url), 'utf8'),
      ]);
      assert.match(detailSource, /lazy\(\(\) => import\('\.\/ProjectBudgetCommitmentsManager\.jsx'\)\)/);
      assert.match(projectTabsSource, /label: 'Budget & Commitments'/);
      assert.match(detailSource, /activeDetailTab === 'budget-commitments'/);
      assert.match(managerSource, /service\.list\('budgetItems'\)/);
      assert.match(managerSource, /service\.list\('commitments'\)/);
      assert.match(managerSource, /Current budget/);
      assert.match(managerSource, /Committed amount/);
      assert.match(managerSource, /Retainage percent/);
      assert.match(managerSource, /peopleType === 'supplier'/);
      assert.match(managerSource, /remaining: current - committed/);
      assert.match(managerSource, /commitment-invoices/);
      assert.match(managerSource, /label="Invoices"/);
      assert.match(serviceSource, /budgetItems: \{ table: 'project_budget_items'.*numberColumn: 'item_code'/);
      assert.match(serviceSource, /commitments: \{ table: 'project_commitments'.*numberColumn: 'commitment_number'/);
      assert.match(serviceSource, /\[config\.numberColumn\]: record\.number/);
      assert.match(migrationSource, /create table if not exists public\.project_budget_items/);
      assert.match(migrationSource, /create table if not exists public\.project_commitments/);
      assert.match(migrationSource, /public\.app_user_can_view_project\(project_id\)/);
      assert.match(migrationSource, /public\.app_user_can_edit_project\(project_id\)/);
      assert.match(migrationSource, /'budget_item', 'commitment'/);
      assert.match(styleSource, /\.project-financial-summary/);
    },
  },
  {
    name: 'warranty and closeout are project-scoped completion workflows',
    async run() {
      const [detailSource, managerSource, serviceSource, migrationSource, customerMigrationSource, projectTabsSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectWarrantyCloseoutManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260721000000_add_warranty_and_closeout.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260721120000_allow_customer_warranty_requests.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/projectTabs.js', import.meta.url), 'utf8'),
      ]);
      assert.match(detailSource, /lazy\(\(\) => import\('\.\/ProjectWarrantyCloseoutManager\.jsx'\)\)/);
      assert.match(projectTabsSource, /label: 'Warranty & Closeout'/);
      assert.match(detailSource, /activeDetailTab === 'warranty-closeout'/);
      assert.match(managerSource, /service\.list\('warrantyItems'\)/);
      assert.match(managerSource, /service\.list\('closeoutItems'\)/);
      assert.match(managerSource, /Responsible subcontractor/);
      assert.match(managerSource, /Required for project closeout/);
      assert.match(managerSource, /Closeout progress/);
      assert.match(managerSource, /warranty-attachments/);
      assert.match(managerSource, /closeout-attachments/);
      assert.match(managerSource, /<WorkflowAttachments/);
      assert.match(managerSource, /CustomerWarrantyRequests/);
      assert.match(managerSource, /Submit warranty request/);
      assert.match(serviceSource, /listCustomerWarrantyRequests/);
      assert.match(serviceSource, /submitCustomerWarrantyRequest/);
      assert.match(serviceSource, /warrantyItems: \{ table: 'project_warranty_items'/);
      assert.match(serviceSource, /closeoutItems: \{ table: 'project_closeout_items'/);
      assert.match(migrationSource, /create table if not exists public\.project_warranty_items/);
      assert.match(migrationSource, /create table if not exists public\.project_closeout_items/);
      assert.match(migrationSource, /as restrictive for select to authenticated/);
      assert.match(migrationSource, /public\.app_user_can_edit_project\(project_id\)/);
      assert.match(migrationSource, /'warranty_item', 'closeout_item'/);
      assert.match(customerMigrationSource, /create or replace function public\.list_customer_warranty_requests/);
      assert.match(customerMigrationSource, /create or replace function public\.submit_customer_warranty_request/);
      assert.match(customerMigrationSource, /item\.created_by = auth\.uid\(\)/);
      assert.match(customerMigrationSource, /public\.app_user_can_view_project\(p_project_id\)/);
      assert.match(customerMigrationSource, /coalesce\(item\.data->>'submissionSource', ''\) = 'customer'/);
      assert.match(customerMigrationSource, /item\.data - array\['notes', 'responsibleId', 'responsibleName', 'attachments', 'warrantyEndDate'\]/);
    },
  },
  {
    name: 'workflow attachments use project storage and clean up removed files',
    async run() {
      const [attachmentSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/WorkflowAttachments.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(attachmentSource, /uploadProjectFileToStorage\(projectId, folderId, attachmentId/);
      assert.match(attachmentSource, /downloadProjectFileFromStorage\(attachment\)/);
      assert.match(attachmentSource, /deleteProjectFileFromStorage\(item\)/);
      assert.match(attachmentSource, /deletedAttachments/);
      assert.match(styleSource, /\.workflow-attachments/);
      assert.match(styleSource, /\.workflow-attachment-row/);
    },
  },
  {
    name: 'customer and subcontractor portal items use restricted response workflows',
    async run() {
      const [appSource, accessSource, projectTabsSource, projectsSource, detailSource, managerSource, filesSource, selectionsSource, selectionModalSource, photosSource, serviceSource, migrationSource, hardeningSource, customerReadsSource, customerPhotoWritesSource, sharedContentSource, visibilityUpdatesSource, trackerSource, styleSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/accessUi.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/projectTabs.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeProjectsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectPortalManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectSelectionsManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/SelectionModal.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectPhotosManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/constructionWorkflows.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720190000_add_project_portal_workflows.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720200000_harden_project_portal_reads.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720220000_expand_customer_project_reads.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260720230000_allow_customer_photo_uploads.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260721150000_add_portal_file_and_selection_visibility.sql', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260721183000_add_portal_visibility_update_rpcs.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(appSource, /normalizedRole === 'Customer' \|\| normalizedRole === 'Subcontractor'/);
      assert.match(appSource, /showTabs: !portalRole/);
      assert.match(appSource, /className="portal-account-bar"/);
      assert.match(appSource, /portal-account-bar[\s\S]*handleSignOut/);
      assert.match(appSource, /loadCurrentAppUserProfile,[\s\S]*loadPortalTrackerData,[\s\S]*loadTrackerData/);
      assert.match(appSource, /loadTrackerStartupData/);
      assert.match(appSource, /\? await loadPortalTrackerData/);
      assert.match(accessSource, /'Customer', 'Subcontractor'/);
      assert.match(projectsSource, /activeUser\?\.role !== 'Customer' \|\| selectedProjectId \|\| visibleProjects\.length !== 1/);
      assert.match(projectsSource, /setSelectedProject\(visibleProjects\[0\]\.id, 'replace'\)/);
      assert.match(projectsSource, /const previousHomeSignalRef = useRef\(homeSignal\)/);
      assert.match(projectsSource, /if \(previousHomeSignalRef\.current === homeSignal\) return/);
      assert.match(projectsSource, /buildTaskAssigneeOptions\(data\.subs \|\| \[\], data\.employees \|\| \[\]\)/);
      assert.match(projectsSource, /assigneeOptions=\{scheduleAssigneeOptions\}/);
      assert.match(detailSource, /lazy\(\(\) => import\('\.\/ProjectPortalManager\.jsx'\)\)/);
      assert.match(detailSource, /subcontractorReadOnly \? 'portal' : 'overview'/);
      assert.match(detailSource, /activeDetailTab === 'portal'/);
      assert.match(managerSource, /service\.list\('portalItems'\)/);
      assert.match(managerSource, /respondToPortalItem/);
      assert.match(managerSource, /Customers only/);
      assert.match(managerSource, /Subcontractors only/);
      assert.match(serviceSource, /portalItems: \{ table: 'project_portal_items'/);
      assert.match(serviceSource, /\/rest\/v1\/rpc\/respond_to_project_portal_item/);
      assert.match(migrationSource, /create table if not exists public\.project_portal_items/);
      assert.match(migrationSource, /audience = lower\(public\.current_app_user_role\(\)\)/);
      assert.match(migrationSource, /create or replace function public\.respond_to_project_portal_item/);
      assert.match(migrationSource, /actor_role not in \('Customer', 'Subcontractor'\)/);
      assert.match(migrationSource, /grant execute on function public\.respond_to_project_portal_item/);
      assert.match(migrationSource, /'portal_item'/);
      assert.match(hardeningSource, /create or replace function public\.get_current_app_user_profile/);
      assert.match(hardeningSource, /create or replace function public\.get_project_portal_bootstrap/);
      assert.match(hardeningSource, /project_row\.data->>'name'/);
      assert.doesNotMatch(hardeningSource, /project_row\.data(?!->>)/);
      assert.match(hardeningSource, /as restrictive for select to authenticated/);
      assert.match(hardeningSource, /'projects', 'tasks', 'settings'.*'audit_events'/s);
      assert.match(hardeningSource, /Portal accounts cannot read internal storage/);
      assert.match(trackerSource, /export async function loadCurrentAppUserProfile/);
      assert.match(trackerSource, /export async function loadPortalTrackerData/);
      assert.match(trackerSource, /tasks: \[\],\s+subs: \[\],\s+employees: \[\]/);
      assert.match(trackerSource, /payload\?\.calendarSettings/);
      assert.match(trackerSource, /const sharedFolderIds = new Set/);
      assert.match(trackerSource, /filter\(\(folder\) => sharedFolderIds\.has\(folder\.id\)\)/);
      assert.match(trackerSource, /portalMode: true/);
      assert.match(projectTabsSource, /const CUSTOMER_PROJECT_TABS = new Set\(\[/);
      assert.match(projectTabsSource, /'warranty-closeout'/);
      assert.match(projectTabsSource, /const SUBCONTRACTOR_PROJECT_TABS = new Set\(\['portal', 'selections', 'files'\]\)/);
      assert.match(projectTabsSource, /export function getVisibleProjectTabs/);
      assert.match(detailSource, /const subcontractorReadOnly = activeUser\?\.role === 'Subcontractor'/);
      assert.match(detailSource, /getVisibleProjectTabs\(settings\?\.visibleProjectTabs, activeUser\?\.role\)/);
      assert.match(detailSource, /if \(!visibleProjectTabIds\.has\(requestedTab\)\) return/);
      assert.match(detailSource, /if \(externalPortalUser\) return/);
      assert.match(detailSource, /readOnly=\{!canEdit\}/);
      assert.match(detailSource, /canAddPhotos=\{canEdit \|\| customerReadOnly\}/);
      assert.match(photosSource, /canAddPhotos = !readOnly/);
      assert.match(photosSource, /addCustomerProjectPhotos\(project\.id, uploads\)/);
      assert.match(photosSource, /if \(!canAddPhotos\) return;[\s\S]*uploadInputRef\.current\?\.click\(\)/);
      assert.match(trackerSource, /export async function addCustomerProjectPhotos/);
      assert.match(customerPhotoWritesSource, /create policy "Customers can upload assigned project photos"/);
      assert.match(customerPhotoWritesSource, /create or replace function public\.add_customer_project_photos/);
      assert.match(customerPhotoWritesSource, /actor_role <> 'Customer'/);
      assert.match(customerPhotoWritesSource, /public\.app_user_can_view_project\(p_project_id\)/);
      assert.match(customerReadsSource, /case when actor_role = 'Customer'/);
      assert.match(customerReadsSource, /from public\.project_phases phase_row/);
      assert.match(customerReadsSource, /from public\.project_file_folders folder_row/);
      assert.match(customerReadsSource, /from public\.project_photos photo_row/);
      assert.match(customerReadsSource, /from public\.project_selections selection_row/);
      assert.match(customerReadsSource, /'calendarSettings', calendar_settings/);
      assert.match(customerReadsSource, /public\.current_app_user_role\(\) = 'Customer'[\s\S]*bucket_id = 'project-files'[\s\S]*public\.app_user_can_view_project/s);
      assert.match(customerReadsSource, /actor_role = 'Subcontractor'|else[\s\S]*'accessUserIds'/s);
      assert.match(filesSource, /customerVisible: false/);
      assert.match(filesSource, /subcontractorVisible: false/);
      assert.match(filesSource, /updateFolderVisibility/);
      assert.match(filesSource, /updateProjectFolderVisibility/);
      assert.match(filesSource, /Visible to/);
      assert.match(selectionsSource, /subcontractorVisible: selectionDraft\.subcontractorVisible === true/);
      assert.match(selectionsSource, /updateProjectSelectionVisibility/);
      assert.match(selectionsSource, /Visible to subcontractors/);
      assert.match(selectionModalSource, /Visible to subcontractors assigned to this project/);
      assert.match(sharedContentSource, /rename to get_project_portal_bootstrap_unfiltered_20260721/);
      assert.match(sharedContentSource, /actor_role = 'Customer'.*customerVisible[\s\S]*actor_role = 'Subcontractor'.*subcontractorVisible/s);
      assert.match(sharedContentSource, /coalesce\(selection_row\.data->>'subcontractorVisible', 'false'\) = 'true'/);
      assert.match(sharedContentSource, /create or replace function public\.portal_storage_object_is_visible/);
      assert.match(sharedContentSource, /project_selection_attachments[\s\S]*storagePath/s);
      assert.match(sharedContentSource, /create policy "Portal users can read shared project files"/);
      assert.match(visibilityUpdatesSource, /create or replace function public\.update_project_folder_visibility/);
      assert.match(visibilityUpdatesSource, /create or replace function public\.update_project_selection_visibility/);
      assert.match(visibilityUpdatesSource, /NORMALIZED_VERSION_CONFLICT:folders/);
      assert.match(visibilityUpdatesSource, /NORMALIZED_VERSION_CONFLICT:selections/);
      assert.match(visibilityUpdatesSource, /grant execute on function public\.update_project_folder_visibility/);
      assert.match(visibilityUpdatesSource, /grant execute on function public\.update_project_selection_visibility/);
      assert.match(trackerSource, /export async function updateProjectFolderVisibility/);
      assert.match(trackerSource, /export async function updateProjectSelectionVisibility/);
      assert.match(styleSource, /\.portal-user-view > \.project-detail-tabs/);
      assert.match(styleSource, /#project-tab-portal\):not\(#project-tab-selections\):not\(#project-tab-files\)/);
      assert.match(styleSource, /\.folder-visibility-controls/);
      assert.match(styleSource, /\.customer-project-view > \.project-detail-tabs[\s\S]*#project-tab-overview[\s\S]*#project-tab-photos/);
      assert.match(styleSource, /\.portal-account-bar/);
      assert.match(styleSource, /\.project-portal-response-form/);
    },
  },
  {
    name: 'selections support customer approval requests and synchronized decisions',
    async run() {
      const [selectionSource, detailSource, appSource, pushSource, functionSource, migrationSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectSelectionsManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ProjectDetailView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/androidPushNotifications.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/send-project-notification/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/migrations/20260722160000_add_selection_customer_approvals.sql', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(selectionSource, /sendSelectionForApproval/);
      assert.match(selectionSource, /Assign at least one Customer user to this project/);
      assert.match(selectionSource, /itemType: 'approval'/);
      assert.match(selectionSource, /audience: 'customer'/);
      assert.match(selectionSource, /status: 'response_requested'/);
      assert.match(selectionSource, /selectionId: selection\.id/);
      assert.match(selectionSource, /respondToSelectionApproval/);
      assert.match(selectionSource, />Approve<\/button>/);
      assert.match(selectionSource, />Decline<\/button>/);
      assert.match(detailSource, /activeUser=\{activeUser\}/);
      assert.match(pushSource, /detailTab: String\(event\.detailTab \|\| ''\)/);
      assert.match(functionSource, /selection-approval-requested/);
      assert.match(functionSource, /normalizeRole\(user\.data\?\.role\) === 'Customer' && accessIds\.has\(user\.id\)/);
      assert.match(functionSource, /selectionId: kind === 'selection-approval-requested'/);
      assert.match(appSource, /detailTab: extra\.detailTab \|\| ''/);
      assert.match(appSource, /extra\.detailTab === 'selections' \? extra\.entityId/);
      assert.match(migrationSource, /project_portal_items_selection_approval_idx/);
      assert.match(migrationSource, /portal_row\.item_type <> 'approval'/);
      assert.match(migrationSource, /actor_role <> 'Customer'/);
      assert.match(migrationSource, /update public\.project_selections/);
      assert.match(migrationSource, /'status', case when decision = 'approved' then 'selected' else 'needs decision' end/);
      assert.match(migrationSource, /'approvalStatus', decision/);
      assert.match(styleSource, /\.selection-approval-panel/);
      assert.match(styleSource, /\.selection-approval-response/);
    },
  },
  {
    name: 'legacy People and settings synchronize explicitly',
    async run() {
      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260717050000_make_people_and_user_sync_explicit.sql', import.meta.url),
        'utf8',
      );

      for (const triggerName of [
        'subs_unified_people_trigger',
        'employees_unified_people_trigger',
        'subs_delete_unified_people_trigger',
        'employees_delete_unified_people_trigger',
        'settings_normalized_app_users_trigger',
      ]) {
        assert.match(migrationSource, new RegExp(`drop trigger if exists ${triggerName}`));
      }
      assert.match(migrationSource, /create or replace function public\.sync_explicit_legacy_record/);
      assert.match(migrationSource, /perform public\.sync_unified_person\(/);
      assert.match(migrationSource, /delete from public\.people/);
      assert.match(migrationSource, /perform public\.sync_normalized_app_users\(p_record_data\)/);
      assert.match(migrationSource, /perform public\.sync_explicit_legacy_record\(/);
      assert.doesNotMatch(migrationSource, /create trigger (subs|employees|settings)_(unified_people|normalized_app_users)/);
    },
  },
  {
    name: 'privileged requests use privacy-safe correlation IDs and structured Edge failure logs',
    async run() {
      const generated = createRequestId();
      assert.match(generated, /^REQ-[A-F0-9]{16}$/);
      assert.equal(normalizeRequestId(generated.toLowerCase()), generated);
      assert.equal(normalizeRequestId('REQ-private-project-id'), '');

      const correlatedError = attachRequestId(new Error('Private failure detail'), generated);
      assert.equal(correlatedError.requestId, generated);
      assert.equal(
        getResponseRequestId(
          { headers: new Headers({ 'x-request-id': generated }) },
          {},
        ),
        generated,
      );

      const [trackerSource, inviteSource, notificationSource, sharedSource] = await Promise.all([
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/create-auth-user/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/send-project-notification/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../supabase/functions/_shared/requestCorrelation.ts', import.meta.url), 'utf8'),
      ]);
      assert.match(trackerSource, /headers\['x-request-id'\] = requestId/);
      assert.match(trackerSource, /throw attachRequestId\(error, requestId\)/);
      assert.match(inviteSource, /Access-Control-Expose-Headers/);
      assert.match(notificationSource, /Access-Control-Expose-Headers/);
      assert.match(inviteSource, /return fail\(\s*'Unexpected function error\.'/);
      assert.match(notificationSource, /return fail\(\s*'Unexpected notification error\.'/);
      assert.match(sharedSource, /event: 'edge_function_failure'/);
      assert.match(sharedSource, /request_id: requestId/);
      assert.match(sharedSource, /\/\^\[a-z0-9_\]\{1,40\}\$\//);
      assert.doesNotMatch(sharedSource, /email|project_id|user_id|payload|message/);
    },
  },
  {
    name: 'Takeoff normalization splits and reconstructs editor snapshots without data loss',
    async run() {
      const snapshot = {
        app: 'plan-takeoff',
        version: 1,
        pageCount: 2,
        pageNumber: 2,
        projectName: '105 Destiny Way',
        scales: {
          1: { pageNumber: 1, pdfUnitsPerUnit: 12, unit: 'ft' },
        },
        measurements: [{
          id: 'measurement-1',
          pageNumber: 1,
          type: 'count',
          label: 'Door',
          color: '#123456',
          symbol: 'square',
          points: [{ x: 10, y: 20 }],
          createdAt: '2026-07-27T12:00:00.000Z',
        }],
        markups: [{
          id: 'markup-1',
          pageNumber: 2,
          type: 'text',
          text: 'Verify opening',
          color: '#654321',
          thickness: 3,
          points: [{ x: 30, y: 40 }],
          createdAt: '2026-07-27T12:01:00.000Z',
        }, {
          id: 'markup-2',
          pageNumber: 2,
          type: 'rectangle',
          color: '#112233',
          thickness: 5,
          points: [{ x: 10, y: 15 }, { x: 50, y: 75 }],
          createdAt: '2026-07-27T12:02:00.000Z',
        }],
      };
      const normalized = splitTakeoffSnapshot(snapshot);
      assert.equal(normalized.snapshot.measurements, undefined);
      assert.equal(normalized.snapshot.markups, undefined);
      assert.equal(normalized.snapshot.scales, undefined);
      assert.deepEqual(normalized.sheets.map((sheet) => sheet.page_number), [1, 2]);
      assert.deepEqual(normalized.measurements[0].points, snapshot.measurements[0].points);
      assert.equal(normalized.markups[0].text, 'Verify opening');
      assert.equal(normalized.markups[1].type, 'rectangle');
      assert.equal(normalized.markups[1].line_width, 5);

      const hydrated = hydrateNormalizedTakeoff(
        normalized.snapshot,
        normalized.sheets,
        normalized.measurements,
        normalized.markups,
      );
      assert.deepEqual(hydrated.scales, snapshot.scales);
      assert.deepEqual(hydrated.measurements, snapshot.measurements);
      assert.deepEqual(hydrated.markups, snapshot.markups);

      assert.deepEqual(
        constrainDrawingEndpoint({ x: 10, y: 15 }, { x: 50, y: 75 }, 'rectangle', true),
        { x: 70, y: 75 },
      );
      assert.deepEqual(
        constrainDrawingEndpoint({ x: 10, y: 15 }, { x: 50, y: 75 }, 'oval', false),
        { x: 50, y: 75 },
      );

      const migrationSource = await readFile(
        new URL('../supabase/migrations/20260727150000_normalize_project_takeoffs.sql', import.meta.url),
        'utf8',
      );
      assert.match(migrationSource, /create table public\.project_takeoff_sheets/);
      assert.match(migrationSource, /create table public\.project_takeoff_measurements/);
      assert.match(migrationSource, /create table public\.project_takeoff_markups/);
      assert.match(migrationSource, /security invoker/);
      assert.match(migrationSource, /takeoff_version_conflict/);
      assert.match(migrationSource, /Portal accounts cannot read takeoff measurements/);
      const drawingMigrationSource = await readFile(
        new URL('../supabase/migrations/20260804180000_add_takeoff_drawing_shapes.sql', import.meta.url),
        'utf8',
      );
      assert.match(drawingMigrationSource, /'line', 'multiline', 'rectangle', 'oval'/);
      assert.match(drawingMigrationSource, /line_width numeric not null default 3/);
      assert.match(drawingMigrationSource, /save_project_takeoff_normalized/);
    },
  },
  {
    name: 'observability redacts private data and suppresses expected operational failures',
    async run() {
      assert.equal(await initializeObservability({}), false);
      assert.equal(isObservabilityEnabled(), false);
      assert.equal(
        normalizeObservabilityOperation(['task', '65e8c830-b4af-4ee4-a560-8355f4c28646', 'save']),
        'task.save',
      );

      const sanitized = sanitizeSentryEvent({
        breadcrumbs: [{ message: 'Opened 105 Destiny Way' }],
        contexts: { browser: { name: 'Chrome' } },
        extra: { customerName: 'Private Customer' },
        message: 'Failed for private@example.com',
        logentry: { formatted: 'Customer private@example.com at 105 Destiny Way' },
        request: {
          cookies: { session: 'secret' },
          headers: { Authorization: 'Bearer secret' },
          url: 'https://projecthub.destinyhomesnj.com/?project=private-project-id',
        },
        tags: {
          operation: 'project.save',
          privateTag: 'Private Customer',
          request_id: 'REQ-A1B2C3D4E5F60708',
          support_id: 'ERR-SAFE123',
        },
        user: { email: 'private@example.com', id: 'private-user-id' },
        exception: {
          values: [{
            type: 'TypeError',
            value: 'Private Customer failed',
            stacktrace: {
              frames: [{
                filename: 'https://projecthub.destinyhomesnj.com/assets/index.js?project=private-project-id',
                function: 'saveProject',
                lineno: 42,
                vars: { projectName: '105 Destiny Way' },
              }],
            },
          }],
        },
      });

      assert.equal(sanitized.message, 'Unexpected application error.');
      assert.equal(sanitized.user, undefined);
      assert.equal(sanitized.request, undefined);
      assert.equal(sanitized.contexts, undefined);
      assert.equal(sanitized.extra, undefined);
      assert.equal(sanitized.logentry, undefined);
      assert.equal(sanitized.stacktrace, undefined);
      assert.deepEqual(sanitized.breadcrumbs, []);
      assert.deepEqual(sanitized.tags, {
        operation: 'project.save',
        platform: 'web',
        request_id: 'req-a1b2c3d4e5f60708',
        support_id: 'err-safe123',
      });
      assert.equal(sanitized.exception.values[0].value, 'Unexpected application error.');
      assert.equal(sanitized.exception.values[0].stacktrace.frames[0].filename, '/assets/index.js');
      assert.equal('vars' in sanitized.exception.values[0].stacktrace.frames[0], false);

      const forbiddenText = JSON.stringify(sanitized);
      assert.doesNotMatch(forbiddenText, /private@example\.com|Private Customer|105 Destiny Way|private-project-id|Bearer secret/);

      const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 });
      assert.equal(isExpectedOperationalError(forbiddenError), true);
      assert.equal(reportError(forbiddenError, { operation: 'project.save' }).reported, false);
    },
  },
  {
    name: 'observability reports one sanitized operation and guards source-map activation',
    async run() {
      const reports = [];
      setObservabilityTestSink((report) => reports.push(report));
      const sensitiveError = Object.assign(new Error('Save failed for private@example.com at 105 Destiny Way'), {
        code: 'PGRST500',
        requestId: 'REQ-A1B2C3D4E5F60708',
        status: 500,
      });
      const first = reportError(sensitiveError, {
        operation: ['task', '65e8c830-b4af-4ee4-a560-8355f4c28646', 'save'],
        workspace: 'tasks',
      });
      const duplicate = reportError(sensitiveError, {
        operation: ['task', '65e8c830-b4af-4ee4-a560-8355f4c28646', 'save'],
        workspace: 'tasks',
      });
      const fatal = reportError(
        Object.assign(new Error('Private render failure'), { code: 'RENDER_FAILED', status: 500 }),
        { force: true, level: 'fatal', operation: 'application.render', workspace: 'projects' },
      );
      setObservabilityTestSink(null);

      assert.equal(first.reported, true);
      assert.match(first.supportId, /^ERR-[A-Z0-9]{10}$/);
      assert.equal(duplicate.reported, false);
      assert.equal(fatal.reported, true);
      assert.deepEqual(reports, [
        {
          code: 'pgrst500',
          level: 'error',
          operation: 'task.save',
          platform: 'web',
          requestId: 'REQ-A1B2C3D4E5F60708',
          status: 500,
          supportId: first.supportId,
          type: 'Error',
          workspace: 'tasks',
        },
        {
          code: 'render_failed',
          level: 'fatal',
          operation: 'application.render',
          platform: 'web',
          requestId: undefined,
          status: 500,
          supportId: fatal.supportId,
          type: 'Error',
          workspace: 'projects',
        },
      ]);
      assert.doesNotMatch(JSON.stringify(reports), /private@example\.com|105 Destiny Way|65e8c830/);

      const [boundarySource, mainSource, viteSource, packageSource] = await Promise.all([
        readFile(new URL('../src/components/SharedUI.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
        readFile(new URL('../package.json', import.meta.url), 'utf8'),
      ]);
      assert.match(boundarySource, /componentDidCatch\(error\)/);
      assert.match(boundarySource, /force: true/);
      assert.match(boundarySource, /level: 'fatal'/);
      assert.match(boundarySource, /Support ID:/);
      assert.doesNotMatch(boundarySource, /this\.state\.message/);
      assert.match(mainSource, /await initializeObservability\(\)/);
      assert.match(
        await readFile(new URL('../src/services/observability.js', import.meta.url), 'utf8'),
        /await waitForSentryClient\(capacitorSentry\)/,
      );
      assert.match(viteSource, /sourcemap: sentryUploadEnabled \? 'hidden' : false/);
      assert.match(viteSource, /setCommits: false/);
      assert.match(viteSource, /deploy: sentryDeployEnabled/);
      assert.match(viteSource, /env: sentryEnvironment/);
      assert.match(viteSource, /name: deployContext \? `netlify-\$\{deployContext\}` : 'trusted-build'/);
      assert.match(viteSource, /filesToDeleteAfterUpload: \['\.\/dist\/\*\*\/\*\.map'\]/);
      assert.match(viteSource, /telemetry: false/);
      assert.match(packageSource, /"@sentry\/capacitor": "4\.2\.0"/);
      assert.match(packageSource, /"@sentry\/react": "10\.60\.0"/);
      assert.match(packageSource, /"@sentry\/vite-plugin": "5\.4\.0"/);
    },
  },
  {
    name: 'staging application tests reject production and always clean disposable fixtures',
    async run() {
      const [stagingSource, workflowSource, ciWorkflowSource, packageSource] = await Promise.all([
        readFile(new URL('./run-staging-application-tests.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/staging-application-tests.yml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
        readFile(new URL('../package.json', import.meta.url), 'utf8'),
      ]);
      assert.match(stagingSource, /PRODUCTION_PROJECT_REF = 'oxojlwhmarafxuqvqgqg'/);
      assert.match(stagingSource, /Refusing to run staging writes against the production Supabase project/);
      assert.match(stagingSource, /finally \{\s*await cleanup\(\);\s*\}/);
      assert.match(stagingSource, /\/auth\/v1\/admin\/users/);
      assert.match(stagingSource, /submit_customer_warranty_request/);
      assert.match(stagingSource, /Customer portal audience boundary/);
      assert.match(stagingSource, /Subcontractor portal audience boundary/);
      assert.match(workflowSource, /workflow_dispatch:/);
      assert.match(workflowSource, /environment: staging/);
      assert.match(workflowSource, /STAGING_SUPABASE_SERVICE_ROLE_KEY/);
      assert.match(workflowSource, /STAGING_SUPABASE_DB_URL/);
      assert.match(workflowSource, /Refusing to migrate the production Supabase project/);
      assert.match(workflowSource, /supabase db push --db-url "\$STAGING_SUPABASE_DB_URL" --include-all/);
      assert.match(workflowSource, /supabase\/setup-cli@v3/);
      assert.match(ciWorkflowSource, /supabase\/setup-cli@v3/);
      assert.match(workflowSource, /version: 2\.109\.1/);
      assert.match(ciWorkflowSource, /version: 2\.109\.1/);
      assert.doesNotMatch(`${workflowSource}\n${ciWorkflowSource}`, /supabase\/setup-cli@v1/);
      assert.doesNotMatch(workflowSource, /push:|pull_request:/);
      assert.match(packageSource, /"test:staging": "node scripts\/run-staging-application-tests\.mjs"/);
    },
  },
  {
    name: 'certificate extraction matches the closest subcontractor company or contact name',
    run() {
      const subcontractors = [
        { id: 'sub-1', company: 'Bright Electric LLC', first: 'Jamie', last: 'Bright' },
        { id: 'sub-2', company: 'Brighton Electrical Services', first: 'Taylor', last: 'Reed' },
        { id: 'sub-3', company: 'Northstar Plumbing', first: 'Morgan', last: 'Lee' },
      ];
      assert.equal(normalizeSubcontractorName('Bright Electric, L.L.C.'), 'bright electric');
      assert.equal(findClosestSubcontractor('Bright Electric, L.L.C.', subcontractors)?.subcontractor.id, 'sub-1');
      assert.equal(findClosestSubcontractor('Morgan Lee', subcontractors)?.subcontractor.id, 'sub-3');
      assert.equal(findClosestSubcontractor('', subcontractors), null);
    },
  },
  {
    name: 'insurance certificates are normalized around subcontractors without project relationships',
    async run() {
      const [migrationSource, coverageDatesMigrationSource, aggregateLimitMigrationSource] = await Promise.all([
        readFile(
          new URL('../supabase/migrations/20260728170000_add_subcontractor_insurance_certificates.sql', import.meta.url),
          'utf8',
        ),
        readFile(
          new URL('../supabase/migrations/20260728200000_add_insurance_coverage_policy_dates.sql', import.meta.url),
          'utf8',
        ),
        readFile(
          new URL('../supabase/migrations/20260728210000_add_insurance_coverage_aggregate_limit.sql', import.meta.url),
          'utf8',
        ),
      ]);
      assert.match(migrationSource, /create table if not exists public\.insurance_certificates/);
      assert.match(migrationSource, /subcontractor_id text not null references public\.subs\(id\) on delete restrict/);
      assert.match(migrationSource, /create table if not exists public\.insurance_certificate_coverages/);
      assert.match(migrationSource, /coverage_amount[\s\S]+effective_date date,[\s\S]+expiration_date date/);
      assert.doesNotMatch(
        migrationSource.match(/create table if not exists public\.insurance_certificates[\s\S]+?\n\);/)?.[0] || '',
        /project_id/,
      );
      assert.match(migrationSource, /coalesce\(public\.current_app_user_role\(\), ''\) in \('Admin', 'Edit', 'View Only'\)/);
      assert.match(migrationSource, /create or replace function public\.save_insurance_certificate/);
      assert.match(migrationSource, /VERSION_CONFLICT/);
      assert.match(migrationSource, /'certificate-files'/);
      assert.match(migrationSource, /file_size_limit = excluded\.file_size_limit/);
      assert.match(migrationSource, /'insurance_certificate'/);
      assert.match(coverageDatesMigrationSource, /add column if not exists effective_date date/);
      assert.match(coverageDatesMigrationSource, /add column if not exists expiration_date date/);
      assert.match(coverageDatesMigrationSource, /coverage->>'effectiveDate'/);
      assert.match(coverageDatesMigrationSource, /coverage->>'expirationDate'/);
      assert.match(aggregateLimitMigrationSource, /add column if not exists aggregate_amount/);
      assert.match(aggregateLimitMigrationSource, /coverage->>'generalLimit'/);
      assert.match(aggregateLimitMigrationSource, /coverage->>'aggregateLimit'/);
    },
  },
  {
    name: 'certificate workspace uses native navigation and subcontractor-only forms',
    async run() {
      const [appSource, navigationSource, componentSource, serviceSource, styleSource, trackerSource] = await Promise.all([
        readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/utils/navigationTabs.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeCertificatesView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/insuranceCertificates.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8'),
      ]);
      assert.match(appSource, /lazy\(\(\) => import\('\.\/components\/NativeCertificatesView\.jsx'\)\)/);
      assert.match(appSource, /activeTab === 'certificates'/);
      assert.match(navigationSource, /\{ id: 'certificates', label: 'Certificates'/);
      assert.match(componentSource, /Subcontractor compliance/);
      assert.match(componentSource, /data\.subs/);
      assert.match(componentSource, /All subcontractors/);
      assert.match(componentSource, /certificateRequired,/);
      assert.match(componentSource, /No cert needed/);
      assert.match(componentSource, /Mark inactive/);
      assert.match(componentSource, /updatePerson\(data, 'sub'/);
      assert.match(componentSource, /findClosestSubcontractor/);
      assert.doesNotMatch(componentSource, /projectId|projectFilter|Project required/);
      assert.match(serviceSource, /save_insurance_certificate/);
      assert.match(serviceSource, /certificate-files/);
      assert.match(serviceSource, /15 \* 1024 \* 1024/);
      assert.match(serviceSource, /subcontractorName: cleanText\(payload\.subcontractorName\)/);
      assert.match(serviceSource, /effectiveDate: cleanText\(row\.effective_date \?\? row\.effectiveDate\)/);
      assert.match(componentSource, /Coverage effective date/);
      assert.match(componentSource, /Coverage expiration date/);
      assert.match(componentSource, /General limit/);
      assert.match(componentSource, /Aggregate limit/);
      assert.match(componentSource, /Liability dates/);
      assert.match(componentSource, /Workers comp dates/);
      assert.doesNotMatch(componentSource, /<span>Document<\/span>/);
      assert.match(componentSource, /formatDisplayDate/);
      assert.match(componentSource, /certificate-coverage-table/);
      assert.match(componentSource, /additional-insured-missing/);
      assert.match(componentSource, /Select certificate & extract/);
      assert.match(componentSource, /Show coverage details/);
      assert.match(componentSource, /aria-expanded=\{coverageExpanded\}/);
      assert.doesNotMatch(componentSource, /findDuplicate|Duplicate certificate/);
      assert.match(serviceSource, /aggregateLimit: Number\(row\.aggregate_amount/);
      assert.match(trackerSource, /certificateRequirement: payload\.certificateRequirement === 'not_required'/);
      assert.match(trackerSource, /inactive: payload\.inactive === true/);
      assert.match(styleSource, /\.top-level-certificates-page/);
      assert.match(styleSource, /\.certificate-card/);
    },
  },
  {
    name: 'certificate extraction is authenticated fixed-purpose and privacy bounded',
    async run() {
      const functionSource = await readFile(
        new URL('../supabase/functions/extract-insurance-certificate/index.ts', import.meta.url),
        'utf8',
      );
      assert.match(functionSource, /admin\.auth\.getUser\(callerToken\)/);
      assert.match(functionSource, /\['Admin', 'Edit'\]\.includes/);
      assert.match(functionSource, /CERTIFICATE_BUCKET = 'certificate-files'/);
      assert.match(functionSource, /requiredPrefix = `certificates\/\$\{caller\.id\}\//);
      assert.match(functionSource, /ANTHROPIC_CERTIFICATE_MODEL/);
      assert.match(functionSource, /Extract insurance certificate data/);
      assert.match(functionSource, /subcontractorName/);
      assert.match(functionSource, /Commercial General Liability and Workers Compensation/);
      assert.match(functionSource, /omit other sublimits/);
      assert.match(functionSource, /General Aggregate and Products-Completed Operations Aggregate/);
      assert.match(functionSource, /getRequestId\(request\)/);
      assert.match(functionSource, /logEdgeFailure/);
      assert.doesNotMatch(functionSource, /console\.(log|error)\([^)]*(sourcePath|providerPayload|bytes)/);
    },
  },
  {
    name: 'certificate workspace supports bounded bulk upload extraction and reviewed saves',
    async run() {
      const [componentSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/NativeCertificatesView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(componentSource, /const MAX_BULK_CERTIFICATES = 20/);
      assert.match(componentSource, /Bulk upload &amp; extract/);
      assert.match(componentSource, /multiple/);
      assert.match(componentSource, /async function processBulkItems\(items\)/);
      assert.match(componentSource, /for \(const item of items\)/);
      assert.match(componentSource, /await uploadCertificateFile\(item\.file\)/);
      assert.match(componentSource, /await extractInsuranceCertificate\(uploaded\)/);
      assert.match(componentSource, /buildExtractedCertificate/);
      assert.match(componentSource, /Confirm each subcontractor match before saving/);
      assert.match(componentSource, /await saveInsuranceCertificate\(item\.draft\)/);
      assert.match(componentSource, /Promise\.all\(uploads\.map\(\(uploaded\) => deleteCertificateFile/);
      assert.match(styleSource, /\.certificate-bulk-modal-card/);
      assert.match(styleSource, /\.certificate-bulk-result/);
    },
  },
  {
    name: 'workers compensation coverage variants preserve policy dates',
    async run() {
      const [componentSource, certificateService] = await Promise.all([
        readFile(new URL('../src/components/NativeCertificatesView.jsx', import.meta.url), 'utf8'),
        import('../src/services/insuranceCertificates.js'),
      ]);
      assert.equal(
        certificateService.normalizeCoverageType("Workers' Compensation & Employers' Liability"),
        'Workers Compensation',
      );
      assert.equal(
        certificateService.normalizeCoverageType('Workers Comp / Employers Liability'),
        'Workers Compensation',
      );
      assert.equal(
        certificateService.normalizeCoverageType("Workman's Compensation"),
        'Workers Compensation',
      );
      assert.match(componentSource, /function coverageTypeMatches/);
      assert.match(componentSource, /normalized\.startsWith\(`\$\{type\} `\)/);
      assert.match(componentSource, /'workmans compensation'/);
    },
  },
];

let failed = 0;

for (const test of tests) {
  try {
    await test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${test.name}`);
    console.error(error);
  }
}

if (failed) {
  console.error(`\n${failed} regression test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} regression tests passed.`);
