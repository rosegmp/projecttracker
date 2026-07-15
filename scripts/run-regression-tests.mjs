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
import { getCalendarWeekLayout } from '../src/utils/calendarUi.js';
import { getContrastRatio, getReadableTextColor } from '../src/utils/colorContrast.js';
import {
  buildTaskAssigneeDirectory,
  buildTaskAssigneeOptions,
  getVisibleProjectsForUser,
  getVisibleTasksForUser,
  normalizeProjectAccessUserIds,
} from '../src/utils/accessUi.js';
import { buildAndroidReminderNotifications } from '../src/utils/androidNotifications.js';
import { buildAuditTrailEntries } from '../src/utils/auditTrail.js';
import { isRetryableQueryError, QueryClient } from '../src/services/queryClient.js';
import { normalizeMutationKey } from '../src/hooks/useEntityMutations.js';
import {
  calculateHorizontalWindow,
  calculateVirtualRange,
  timelineItemIntersectsWindow,
} from '../src/utils/virtualization.js';

const weekdaySettings = {
  weekdaysOnly: true,
  holidays: [{ date: '2026-05-25', name: 'Memorial Day', nonWorkday: true }],
};

const tests = [
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
    },
  },
  {
    name: 'server-backed file settings and inspection actions expose visible mutation states',
    async run() {
      const [filesSource, settingsSource, inspectionsSource, styleSource] = await Promise.all([
        readFile(new URL('../src/components/ProjectFilesManager.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeSettingsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/NativeInspectionsView.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      ]);
      assert.match(filesSource, /uploading \? ' is-loading'/);
      assert.match(filesSource, /aria-busy=\{uploading\}/);
      assert.match(filesSource, /await runFilesMutation\(\['folder', 'create'\]/);
      assert.match(settingsSource, /schedulingSaving \? ' is-loading'/);
      assert.match(settingsSource, /Saving display settings\.\.\./);
      assert.match(inspectionsSource, /\['inspection-preview', inspection\.id, field\]/);
      assert.match(inspectionsSource, /inspection-thumbnail-button\$\{isMutating/);
      assert.match(styleSource, /\.button\.is-loading > \.fluent-icon/);
      assert.match(styleSource, /\.inspection-thumbnail-button\.is-loading::after/);
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
    name: 'Android downloads offer Save and Share with visible progress',
    async run() {
      const dialogSource = await readFile(new URL('../src/components/AppDialogs.jsx', import.meta.url), 'utf8');
      const downloadSource = await readFile(new URL('../src/utils/downloadUi.js', import.meta.url), 'utf8');
      const trackerSource = await readFile(new URL('../src/services/trackerData.js', import.meta.url), 'utf8');
      const nativeSource = await readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/DownloadsPlugin.java', import.meta.url), 'utf8');
      const activitySource = await readFile(new URL('../android/app/src/main/java/com/destinyhomes/projecthub/MainActivity.java', import.meta.url), 'utf8');

      assert.match(dialogSource, /export function beginDownloadProgress/);
      assert.match(dialogSource, /className="download-progress-bar"/);
      assert.match(downloadSource, /label: 'Save to Downloads'/);
      assert.match(downloadSource, /label: 'Share'/);
      assert.match(trackerSource, /response\.body\.getReader\(\)/);
      assert.match(trackerSource, /onProgress\(loaded, total\)/);
      assert.match(nativeSource, /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/);
      assert.match(nativeSource, /Environment\.DIRECTORY_DOWNLOADS/);
      assert.match(activitySource, /registerPlugin\(DownloadsPlugin\.class\)/);
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
    name: 'audit history expands project dates dependencies statuses and file changes',
    run() {
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
      assert.match(trackerSource, /const \{ _version, \.\.\.data \} = item/);
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
