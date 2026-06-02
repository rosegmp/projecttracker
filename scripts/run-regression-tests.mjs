import assert from 'node:assert/strict';
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
import { buildCalendarItems, buildCalendarWeeks, buildScheduleRows } from '../src/utils/scheduleView.js';

const weekdaySettings = {
  weekdaysOnly: true,
  holidays: [{ date: '2026-05-25', name: 'Memorial Day', nonWorkday: true }],
};

const tests = [
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
    test.run();
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
