import React, { useEffect, useMemo, useRef, useState } from 'react';
import { inviteAuthUser, loadAuditEvents, updateProjects, updateSettings, USER_ROLE_OPTIONS } from '../services/trackerData.js';
import { addDays, toIsoDate } from '../utils/calendarUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { DashboardStat } from './SharedUI.jsx';
import { getAppRedirectUrl, isNativeAndroidApp, openAndroidNotificationSettings } from '../platform/platformAdapter.js';
import {
  getAndroidNotificationPermissionStatus,
  getAndroidNotificationPreferences,
  saveAndroidNotificationPreferences,
  syncAndroidNotifications,
} from '../utils/androidNotifications.js';
import { syncAndroidPushRegistration } from '../utils/androidPushNotifications.js';
import { buildAuditTrailEntries, formatAuditValue } from '../utils/auditTrail.js';
import { buildProjectAccessUpdates } from '../utils/accessUi.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';

const DEFAULT_PEOPLE_LIST_COLUMNS = ['company', 'name', 'role', 'phone', 'email', 'tags'];
const AUDIT_PAGE_SIZE = 50;
const SETTINGS_SECTIONS = [
  { id: 'scheduling', label: 'Scheduling', description: 'Work calendar and schedule display defaults.' },
  { id: 'calendar', label: 'Calendar & holidays', description: 'Calendar visibility, holidays, and closure periods.' },
  { id: 'inspections', label: 'Inspections', description: 'Inspection codes and editor defaults.' },
  { id: 'notifications', label: 'Notifications', description: 'Android reminder and notification preferences.' },
  { id: 'users', label: 'Users & access', description: 'App roles and project assignments.' },
  { id: 'audit', label: 'Audit history', description: 'Recent project changes and responsible users.' },
  { id: 'display', label: 'Display preferences', description: 'People columns and visual preferences.' },
  { id: 'system', label: 'System status', description: 'Data source, record counts, and refresh controls.' },
];
const PEOPLE_LIST_COLUMN_DEFS = [
  { id: 'name', label: 'Name' }, { id: 'company', label: 'Company' }, { id: 'role', label: 'Role' },
  { id: 'phone', label: 'Phone' }, { id: 'email', label: 'Email' }, { id: 'tags', label: 'Tags' },
];
function normalizeAppUserRole(role) { return USER_ROLE_OPTIONS.includes(role) ? role : 'View Only'; }
function normalizeProjectAccessUserIds(userIds) { return Array.isArray(userIds) ? Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean))) : []; }

function getNthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
  const firstDay = new Date(year, monthIndex, 1);
  const offset = (weekday - firstDay.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (occurrence - 1) * 7);
}

function getLastWeekdayOfMonth(year, monthIndex, weekday) {
  const lastDay = new Date(year, monthIndex + 1, 0);
  const offset = (lastDay.getDay() - weekday + 7) % 7;
  return new Date(year, monthIndex, lastDay.getDate() - offset);
}

function getObservedHolidayDate(date) {
  const day = date.getDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return new Date(date);
}

function sortHolidays(holidays) {
  return [...holidays].sort((left, right) => {
    const leftDate = left.date || '';
    const rightDate = right.date || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function normalizeHolidayEntry(holiday) {
  return {
    id: holiday?.id || '',
    date: holiday?.date || '',
    endDate: holiday?.endDate || '',
    name: holiday?.name || '',
    nonWorkday: holiday?.nonWorkday !== false,
  };
}

function holidaysMatch(left, right) {
  const normalizedLeft = normalizeHolidayEntry(left);
  const normalizedRight = normalizeHolidayEntry(right);
  return (
    normalizedLeft.id === normalizedRight.id &&
    normalizedLeft.date === normalizedRight.date &&
    normalizedLeft.endDate === normalizedRight.endDate &&
    normalizedLeft.name === normalizedRight.name &&
    normalizedLeft.nonWorkday === normalizedRight.nonWorkday
  );
}

function buildLegalHolidayCandidatesForYear(year) {
  return [
    { name: "New Year's Day", date: new Date(year, 0, 1) },
    { name: 'Martin Luther King Jr. Day', date: getNthWeekdayOfMonth(year, 0, 1, 3) },
    { name: "Washington's Birthday", date: getNthWeekdayOfMonth(year, 1, 1, 3) },
    { name: 'Memorial Day', date: getLastWeekdayOfMonth(year, 4, 1) },
    { name: 'Juneteenth National Independence Day', date: new Date(year, 5, 19) },
    { name: 'Independence Day', date: new Date(year, 6, 4) },
    { name: 'Labor Day', date: getNthWeekdayOfMonth(year, 8, 1, 1) },
    { name: 'Columbus Day', date: getNthWeekdayOfMonth(year, 9, 1, 2) },
    { name: 'Veterans Day', date: new Date(year, 10, 11) },
    { name: 'Thanksgiving Day', date: getNthWeekdayOfMonth(year, 10, 4, 4) },
    { name: 'Christmas Day', date: new Date(year, 11, 25) },
  ];
}

function buildNextTwelveMonthsLegalHolidays(today = new Date()) {
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 12, rangeStart.getDate());
  const years = [rangeStart.getFullYear(), rangeEnd.getFullYear()];
  const holidays = [];

  years.forEach((year) => {
    buildLegalHolidayCandidatesForYear(year).forEach((holiday, index) => {
      const observed = getObservedHolidayDate(holiday.date);
      if (observed < rangeStart || observed >= rangeEnd) return;
      const observedName =
        toIsoDate(observed) === toIsoDate(holiday.date) ? holiday.name : `${holiday.name} (Observed)`;
      holidays.push({
        id: `legal-${year}-${index}-${toIsoDate(observed)}`,
        date: toIsoDate(observed),
        endDate: '',
        name: observedName,
        nonWorkday: true,
      });
    });
  });

  return sortHolidays(holidays);
}

function getHebrewDateParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-hebrew', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  return {
    month: parts.find((part) => part.type === 'month')?.value || '',
    day: Number(parts.find((part) => part.type === 'day')?.value || 0),
    year: Number(parts.find((part) => part.type === 'year')?.value || 0),
  };
}

function buildNextTwelveMonthsJewishHolidays(today = new Date()) {
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 12, rangeStart.getDate());
  const holidayByHebrewDate = {
    Tishri: {
      1: 'Rosh Hashanah',
      2: 'Rosh Hashanah',
      10: 'Yom Kippur',
      15: 'Sukkot',
      16: 'Sukkot',
      22: 'Shemini Atzeret',
      23: 'Simchat Torah',
    },
    Nisan: {
      15: 'Passover',
      16: 'Passover',
      21: 'Passover (Last Days)',
      22: 'Passover (Last Days)',
    },
    Sivan: {
      6: 'Shavuot',
      7: 'Shavuot',
    },
  };
  const rawHolidays = [];

  for (let day = new Date(rangeStart); day < rangeEnd; day = addDays(day, 1)) {
    const hebrew = getHebrewDateParts(day);
    const name = holidayByHebrewDate[hebrew.month]?.[hebrew.day];
    if (!name) continue;
    rawHolidays.push({
      date: toIsoDate(day),
      name,
      nonWorkday: true,
    });
  }

  const holidays = [];
  rawHolidays.forEach((holiday) => {
    const previous = holidays[holidays.length - 1];
    const previousEnd = previous?.endDate || previous?.date || '';
    const expectedNextDate = previousEnd ? toIsoDate(addDays(new Date(`${previousEnd}T00:00:00`), 1)) : '';
    if (previous && previous.name === holiday.name && holiday.date === expectedNextDate) {
      previous.endDate = holiday.date;
      return;
    }
    holidays.push({
      id: `jewish-${holiday.date}-${holiday.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      date: holiday.date,
      endDate: '',
      name: holiday.name,
      nonWorkday: true,
    });
  });

  return sortHolidays(holidays);
}


export default function NativeSettingsView({ data, onStateChange, refresh, loading, activeUser = null }) {
  const { beginMutation, endMutation, isMutating } = useEntityMutations();
  const [activeSettingsSection, setActiveSettingsSection] = useState('scheduling');
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState({ tone: '', message: '' });
  const [notificationPermission, setNotificationPermission] = useState('');
  const [notificationDraft, setNotificationDraft] = useState(() => getAndroidNotificationPreferences(activeUser?.id));
  const [authInviteStatus, setAuthInviteStatus] = useState({});
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditProjectFilter, setAuditProjectFilter] = useState('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState('all');
  const [schedulingDraft, setSchedulingDraft] = useState(() => ({
    weekdaysOnly: !!data.settings?.weekdaysOnly,
    showGanttTaskDueDates: data.settings?.showGanttTaskDueDates ?? (data.settings?.showTaskDueDates !== false),
    showCalendarTaskDueDates: data.settings?.showCalendarTaskDueDates ?? (data.settings?.showTaskDueDates !== false),
    showCalendarPhases: data.settings?.showCalendarPhases !== false,
    showCalendarHebrewDates: data.settings?.showCalendarHebrewDates === true,
    showPageStats: data.settings?.showPageStats !== false,
  }));
  const settingsStateRef = useRef(data);
  const settingsSaveChainRef = useRef(Promise.resolve());
  const isAndroidApp = isNativeAndroidApp();
  const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection) || SETTINGS_SECTIONS[0];

  useEffect(() => {
    if (!isAndroidApp) return;
    void getAndroidNotificationPermissionStatus()
      .then(setNotificationPermission)
      .catch(() => setNotificationPermission(''));
  }, [activeUser?.id, isAndroidApp]);

  const settings = useMemo(
    () => {
      const legacyShowTaskDueDates = data.settings?.showTaskDueDates;
      return {
        weekdaysOnly: !!data.settings?.weekdaysOnly,
        showGanttTaskDueDates: data.settings?.showGanttTaskDueDates ?? (legacyShowTaskDueDates !== false),
        showCalendarTaskDueDates: data.settings?.showCalendarTaskDueDates ?? (legacyShowTaskDueDates !== false),
        showCalendarPhases: data.settings?.showCalendarPhases !== false,
        showCalendarHebrewDates: data.settings?.showCalendarHebrewDates === true,
        showPageStats: data.settings?.showPageStats !== false,
        inspectionSubcodes: Array.isArray(data.settings?.inspectionSubcodes)
          ? data.settings.inspectionSubcodes.filter(Boolean)
          : ['FOOT-101', 'FRAME-220', 'ELEC-310'],
        peopleListColumns: Array.isArray(data.settings?.peopleListColumns)
          ? data.settings.peopleListColumns
          : DEFAULT_PEOPLE_LIST_COLUMNS,
        peopleListBoldColumns: Array.isArray(data.settings?.peopleListBoldColumns)
          ? data.settings.peopleListBoldColumns
          : ['name'],
        users: Array.isArray(data.settings?.users) && data.settings.users.length
          ? data.settings.users.map((user, index) => ({
              id: user?.id || `user-${Date.now()}-${index}`,
              name: String(user?.name || '').trim() || 'Unnamed user',
              email: String(user?.email || '').trim(),
              role: normalizeAppUserRole(String(user?.role || 'View Only')),
            }))
          : [{ id: 'user-admin', name: 'Admin', email: '', role: 'Admin' }],
        currentUserId:
          Array.isArray(data.settings?.users) && data.settings.users.some((user) => user.id === data.settings?.currentUserId)
            ? data.settings.currentUserId
            : 'user-admin',
        holidays: Array.isArray(data.settings?.holidays) ? data.settings.holidays : [],
      };
    },
    [data.settings],
  );
  const [holidayDrafts, setHolidayDrafts] = useState(() =>
    (Array.isArray(data.settings?.holidays) ? data.settings.holidays : []).map(normalizeHolidayEntry),
  );
  const [inspectionSubcodeDrafts, setInspectionSubcodeDrafts] = useState(() =>
    (Array.isArray(data.settings?.inspectionSubcodes) ? data.settings.inspectionSubcodes : []).map((subcode, index) => ({
      id: `saved-subcode-${index}`,
      value: subcode,
      savedValue: subcode,
      persisted: true,
    })),
  );
  const [userDrafts, setUserDrafts] = useState(() =>
    (Array.isArray(data.settings?.users) ? data.settings.users : []).map((user, index) => ({
      id: user?.id || `user-${Date.now()}-${index}`,
      name: String(user?.name || '').trim() || 'Unnamed user',
      email: String(user?.email || '').trim(),
      role: normalizeAppUserRole(String(user?.role || 'View Only')),
      projectIds: data.projects
        .filter((project) => normalizeProjectAccessUserIds(project.accessUserIds).includes(user?.id))
        .map((project) => project.id),
      savedProjectIds: data.projects
        .filter((project) => normalizeProjectAccessUserIds(project.accessUserIds).includes(user?.id))
        .map((project) => project.id),
      savedName: String(user?.name || '').trim() || 'Unnamed user',
      savedEmail: String(user?.email || '').trim(),
      savedRole: normalizeAppUserRole(String(user?.role || 'View Only')),
      persisted: true,
    })),
  );

  useEffect(() => {
    settingsStateRef.current = data;
  }, [data]);

  useEffect(() => {
    setNotificationDraft(getAndroidNotificationPreferences(activeUser?.id));
    setNotificationStatus({ tone: '', message: '' });
  }, [activeUser?.id]);

  useEffect(() => {
    setHolidayDrafts((settings.holidays || []).map(normalizeHolidayEntry));
  }, [settings.holidays]);

  useEffect(() => {
    setSchedulingDraft({
      weekdaysOnly: settings.weekdaysOnly,
      showGanttTaskDueDates: settings.showGanttTaskDueDates,
      showCalendarTaskDueDates: settings.showCalendarTaskDueDates,
      showCalendarPhases: settings.showCalendarPhases,
      showCalendarHebrewDates: settings.showCalendarHebrewDates,
      showPageStats: settings.showPageStats,
    });
  }, [
    settings.weekdaysOnly,
    settings.showGanttTaskDueDates,
    settings.showCalendarTaskDueDates,
    settings.showCalendarPhases,
    settings.showCalendarHebrewDates,
    settings.showPageStats,
  ]);

  useEffect(() => {
    setInspectionSubcodeDrafts((current) => {
      const unsaved = current.filter((item) => !item.persisted);
      return [
        ...settings.inspectionSubcodes.map((subcode, index) => ({
          id: `saved-subcode-${index}`,
          value: subcode,
          savedValue: subcode,
          persisted: true,
        })),
        ...unsaved,
      ];
    });
  }, [settings.inspectionSubcodes]);

  useEffect(() => {
    setUserDrafts((current) => {
      const unsaved = current.filter((item) => !item.persisted);
      return [
        ...settings.users.map((user, index) => ({
          id: user?.id || `user-${Date.now()}-${index}`,
          name: String(user?.name || '').trim() || 'Unnamed user',
          email: String(user?.email || '').trim(),
          role: normalizeAppUserRole(String(user?.role || 'View Only')),
          projectIds: data.projects
            .filter((project) => normalizeProjectAccessUserIds(project.accessUserIds).includes(user?.id))
            .map((project) => project.id),
          savedProjectIds: data.projects
            .filter((project) => normalizeProjectAccessUserIds(project.accessUserIds).includes(user?.id))
            .map((project) => project.id),
          savedName: String(user?.name || '').trim() || 'Unnamed user',
          savedEmail: String(user?.email || '').trim(),
          savedRole: normalizeAppUserRole(String(user?.role || 'View Only')),
          persisted: true,
        })),
        ...unsaved,
      ];
    });
  }, [data.projects, settings.users]);

  const auditEntries = useMemo(() => {
    const entries = buildAuditTrailEntries(auditRows);
    return auditCategoryFilter === 'all'
      ? entries
      : entries.filter((entry) => entry.category === auditCategoryFilter);
  }, [auditCategoryFilter, auditRows]);
  const auditActorNames = useMemo(
    () => new Map(settings.users.map((user) => [String(user.email || '').trim().toLowerCase(), user.name])),
    [settings.users],
  );

  async function refreshAuditTrail(projectId = auditProjectFilter) {
    setAuditLoading(true);
    setAuditError('');
    try {
      const rows = await loadAuditEvents({ projectId, limit: AUDIT_PAGE_SIZE });
      setAuditRows(rows);
      setAuditHasMore(rows.length === AUDIT_PAGE_SIZE);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load audit history.';
      setAuditError(
        /audit_events|404|does not exist|schema cache/i.test(message)
          ? 'Audit storage is not installed yet. Apply the included Supabase audit-events migration, then refresh.'
          : message,
      );
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadMoreAuditTrail() {
    const beforeId = auditRows.at(-1)?.id;
    if (!beforeId || auditLoading) return;
    setAuditLoading(true);
    setAuditError('');
    try {
      const rows = await loadAuditEvents({
        projectId: auditProjectFilter,
        limit: AUDIT_PAGE_SIZE,
        beforeId,
      });
      setAuditRows((current) => [...current, ...rows]);
      setAuditHasMore(rows.length === AUDIT_PAGE_SIZE);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'Unable to load more audit history.');
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (activeSettingsSection !== 'audit') return;
    void refreshAuditTrail(auditProjectFilter);
  }, [activeSettingsSection, auditProjectFilter]);

  function runSettingsMutation(nextSettings, mutationKey = ['settings', ...Object.keys(nextSettings).sort()]) {
    beginMutation(mutationKey);

    const queuedSave = settingsSaveChainRef.current.then(async () => {
      const nextState = await updateSettings(settingsStateRef.current, nextSettings);
      settingsStateRef.current = nextState;
      onStateChange(nextState);
      return nextState;
    });

    settingsSaveChainRef.current = queuedSave.catch(() => {});

    return queuedSave.finally(() => endMutation(mutationKey));
  }

  function handleToggle(field, value) {
    runSettingsMutation({ [field]: value });
  }

  function handleSchedulingDraftToggle(field, value) {
    setSchedulingDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function hasPendingSchedulingDefaults() {
    return (
      schedulingDraft.weekdaysOnly !== settings.weekdaysOnly ||
      schedulingDraft.showGanttTaskDueDates !== settings.showGanttTaskDueDates ||
      schedulingDraft.showCalendarTaskDueDates !== settings.showCalendarTaskDueDates ||
      schedulingDraft.showCalendarPhases !== settings.showCalendarPhases ||
      schedulingDraft.showCalendarHebrewDates !== settings.showCalendarHebrewDates ||
      schedulingDraft.showPageStats !== settings.showPageStats
    );
  }

  function handleSaveSchedulingDefaults() {
    runSettingsMutation({
      weekdaysOnly: schedulingDraft.weekdaysOnly,
      showGanttTaskDueDates: schedulingDraft.showGanttTaskDueDates,
      showCalendarTaskDueDates: schedulingDraft.showCalendarTaskDueDates,
      showCalendarPhases: schedulingDraft.showCalendarPhases,
      showCalendarHebrewDates: schedulingDraft.showCalendarHebrewDates,
      showPageStats: schedulingDraft.showPageStats,
    }, ['settings', 'scheduling']);
  }

  function handleHolidayDraftChange(index, field, value) {
    setHolidayDrafts((current) =>
      current.map((holiday, holidayIndex) =>
        holidayIndex === index ? normalizeHolidayEntry({ ...holiday, [field]: value }) : holiday,
      ),
    );
  }

  function handleToggleHolidayRange(index, enabled) {
    setHolidayDrafts((current) =>
      current.map((holiday, holidayIndex) =>
        holidayIndex === index
          ? normalizeHolidayEntry({
              ...holiday,
              endDate: enabled ? holiday.endDate || holiday.date || '' : '',
            })
          : holiday,
      ),
    );
  }

  function handleSaveHoliday(index) {
    const draft = normalizeHolidayEntry(holidayDrafts[index]);
    const existingIndex = settings.holidays.findIndex((holiday) => holiday.id === draft.id);
    const holidays =
      existingIndex >= 0
        ? settings.holidays.map((holiday, holidayIndex) =>
            holidayIndex === existingIndex ? draft : holiday,
          )
        : [...settings.holidays, draft];
    runSettingsMutation({ holidays: sortHolidays(holidays) }, ['settings', 'holiday', draft.id]);
  }

  function handleAddHoliday() {
    setHolidayDrafts((current) =>
      sortHolidays([
        ...current,
        { id: `h${Date.now()}`, date: '', endDate: '', name: '', nonWorkday: true },
      ]).map(normalizeHolidayEntry),
    );
  }

  function handleRemoveHoliday(index) {
    const draft = holidayDrafts[index];
    if (!draft) return;
    const existingIndex = settings.holidays.findIndex((holiday) => holiday.id === draft.id);
    if (existingIndex < 0) {
      setHolidayDrafts((current) => current.filter((_, holidayIndex) => holidayIndex !== index));
      return;
    }
    const holidays = settings.holidays.filter((_, holidayIndex) => holidayIndex !== existingIndex);
    runSettingsMutation({ holidays }, ['settings', 'holiday', draft.id]);
  }

  async function handleAddStandardLegalHolidays() {
    const confirmed = await showAppConfirm(
      'Add the standard U.S. legal holidays for the next 12 months? Existing matching holidays will be kept and not duplicated.',
      { title: 'Add legal holidays', confirmLabel: 'Add holidays' },
    );
    if (!confirmed) return;
    const generated = buildNextTwelveMonthsLegalHolidays(new Date());
    const existingKeys = new Set(
      settings.holidays.map((holiday) =>
        `${holiday.date || ''}::${String(holiday.name || '').trim().toLowerCase()}`,
      ),
    );
    const holidays = sortHolidays([
      ...settings.holidays,
      ...generated.filter((holiday) => {
        const key = `${holiday.date || ''}::${String(holiday.name || '').trim().toLowerCase()}`;
        return !existingKeys.has(key);
      }),
    ]);
    runSettingsMutation({ holidays });
  }

  async function handleAddJewishHolidays() {
    const confirmed = await showAppConfirm(
      'Add the major Jewish holidays for the next 12 months? Existing matching holidays will be kept and not duplicated.',
      { title: 'Add Jewish holidays', confirmLabel: 'Add holidays' },
    );
    if (!confirmed) return;
    const generated = buildNextTwelveMonthsJewishHolidays(new Date());
    const existingKeys = new Set(
      settings.holidays.map((holiday) =>
        `${holiday.date || ''}::${holiday.endDate || ''}::${String(holiday.name || '').trim().toLowerCase()}`,
      ),
    );
    const holidays = sortHolidays([
      ...settings.holidays,
      ...generated.filter((holiday) => {
        const key = `${holiday.date || ''}::${holiday.endDate || ''}::${String(holiday.name || '').trim().toLowerCase()}`;
        return !existingKeys.has(key);
      }),
    ]);
    runSettingsMutation({ holidays });
  }

  function handleTogglePeopleColumn(columnId, enabled) {
    const current = settings.peopleListColumns.filter((item) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === item),
    );
    const next = enabled
      ? current.includes(columnId)
        ? current
        : [...current, columnId]
      : current.filter((item) => item !== columnId);
    runSettingsMutation({ peopleListColumns: next });
  }

  function movePeopleColumn(columnId, direction) {
    const current = [...settings.peopleListColumns];
    const index = current.indexOf(columnId);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    runSettingsMutation({ peopleListColumns: next });
  }

  function handleTogglePeopleBold(columnId, enabled) {
    const current = settings.peopleListBoldColumns.filter((item) =>
      PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === item),
    );
    const next = enabled
      ? current.includes(columnId)
        ? current
        : [...current, columnId]
      : current.filter((item) => item !== columnId);
    runSettingsMutation({ peopleListBoldColumns: next });
  }

  function handleInspectionSubcodeChange(draftId, value) {
    setInspectionSubcodeDrafts((current) =>
      current.map((item) => (item.id === draftId ? { ...item, value } : item)),
    );
  }

  function hasPendingInspectionSubcode(draft) {
    return !draft.persisted || String(draft.value || '').trim() !== String(draft.savedValue || '').trim();
  }

  async function saveInspectionSubcode(draftId) {
    const draft = inspectionSubcodeDrafts.find((item) => item.id === draftId);
    const nextValue = String(draft?.value || '').trim();
    if (!draft || !nextValue) {
      await showAppAlert('Enter an inspection subcode before saving.', 'Subcode required');
      return;
    }
    const inspectionSubcodes = inspectionSubcodeDrafts
      .filter((item) => item.persisted || item.id === draftId)
      .map((item) => (item.id === draftId ? nextValue : String(item.savedValue || '').trim()))
      .filter(Boolean);
    await runSettingsMutation({ inspectionSubcodes }, ['settings', 'subcode', draftId]);
    setInspectionSubcodeDrafts((current) =>
      current.map((item) =>
        item.id === draftId
          ? {
              ...item,
              value: nextValue,
              savedValue: nextValue,
              persisted: true,
            }
          : item,
      ),
    );
  }

  function handleAddInspectionSubcode() {
    setInspectionSubcodeDrafts((current) => [
      ...current,
      {
        id: `draft-subcode-${Date.now()}`,
        value: '',
        savedValue: '',
        persisted: false,
      },
    ]);
  }

  function handleRemoveInspectionSubcode(draftId) {
    const draft = inspectionSubcodeDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    if (!draft.persisted) {
      setInspectionSubcodeDrafts((current) => current.filter((item) => item.id !== draftId));
      return;
    }
    const inspectionSubcodes = inspectionSubcodeDrafts
      .filter((item) => item.persisted && item.id !== draftId)
      .map((item) => String(item.savedValue || '').trim())
      .filter(Boolean);
    runSettingsMutation({ inspectionSubcodes }, ['settings', 'subcode', draftId]);
  }

  function handleUserFieldChange(userId, field, value) {
    setUserDrafts((current) =>
      current.map((user) =>
        user.id === userId
          ? { ...user, [field]: field === 'role' ? normalizeAppUserRole(value) : value }
          : user,
      ),
    );
  }

  function hasPendingUserDraft(user) {
    const projectIds = normalizeProjectAccessUserIds(user.projectIds);
    const savedProjectIds = normalizeProjectAccessUserIds(user.savedProjectIds);
    return (
      !user.persisted ||
      user.name !== user.savedName ||
      user.email !== user.savedEmail ||
      user.role !== user.savedRole ||
      projectIds.length !== savedProjectIds.length ||
      projectIds.some((projectId) => !savedProjectIds.includes(projectId))
    );
  }

  function handleUserProjectAccessChange(userId, projectId, enabled) {
    setUserDrafts((current) =>
      current.map((user) => {
        if (user.id !== userId) return user;
        const currentProjectIds = normalizeProjectAccessUserIds(user.projectIds);
        const nextProjectIds = enabled
          ? currentProjectIds.includes(projectId)
            ? currentProjectIds
            : [...currentProjectIds, projectId]
          : currentProjectIds.filter((value) => value !== projectId);
        return { ...user, projectIds: nextProjectIds };
      }),
    );
  }

  function handleToggleAllUserProjects(userId) {
    setUserDrafts((current) =>
      current.map((user) => {
        if (user.id !== userId) return user;
        const allProjectIds = data.projects.map((project) => project.id);
        const currentProjectIds = normalizeProjectAccessUserIds(user.projectIds);
        const hasAllProjects =
          allProjectIds.length > 0 && allProjectIds.every((projectId) => currentProjectIds.includes(projectId));
        return {
          ...user,
          projectIds: hasAllProjects ? [] : allProjectIds,
        };
      }),
    );
  }

  async function saveUserDraft(userId) {
    const targetUser = userDrafts.find((user) => user.id === userId);
    if (!targetUser) return;
    const users = userDrafts
      .filter((user) => user.persisted || user.id === userId)
      .map((user) =>
        user.id === userId
          ? {
              id: user.id,
              name: String(user.name || '').trim() || 'Unnamed user',
              email: String(user.email || '').trim(),
              role: normalizeAppUserRole(user.role),
            }
          : {
              id: user.id,
              name: String(user.savedName || '').trim() || 'Unnamed user',
              email: String(user.savedEmail || '').trim(),
              role: normalizeAppUserRole(user.savedRole),
            },
      );
    let nextState = await runSettingsMutation({ users }, ['settings', 'user', userId]);
    const selectedProjectIds = normalizeProjectAccessUserIds(targetUser.projectIds);
    const projectUpdates = buildProjectAccessUpdates(nextState.projects, userId, selectedProjectIds);
    if (projectUpdates.length) nextState = await updateProjects(nextState, projectUpdates);
    onStateChange(nextState);
    settingsStateRef.current = nextState;
    setUserDrafts((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              name: String(user.name || '').trim() || 'Unnamed user',
              email: String(user.email || '').trim(),
              role: normalizeAppUserRole(user.role),
              projectIds: normalizeProjectAccessUserIds(user.projectIds),
              savedProjectIds: normalizeProjectAccessUserIds(user.projectIds),
              savedName: String(user.name || '').trim() || 'Unnamed user',
              savedEmail: String(user.email || '').trim(),
              savedRole: normalizeAppUserRole(user.role),
              persisted: true,
            }
          : user,
      ),
    );
  }

  async function handleSendAuthInvite(user) {
    const email = String(user?.email || '').trim();
    if (!email) {
      setAuthInviteStatus((current) => ({
        ...current,
        [user.id]: { status: 'error', message: 'Add an email address before sending an invite.' },
      }));
      return;
    }
    if (hasPendingUserDraft(user)) {
      setAuthInviteStatus((current) => ({
        ...current,
        [user.id]: { status: 'error', message: 'Save this user before sending an invite.' },
      }));
      return;
    }
    setAuthInviteStatus((current) => ({
      ...current,
      [user.id]: { status: 'sending', message: 'Sending login invite...' },
    }));
    try {
      await inviteAuthUser(email, user.name, getAppRedirectUrl());
      setAuthInviteStatus((current) => ({
        ...current,
        [user.id]: { status: 'success', message: `Login invite sent to ${email}.` },
      }));
    } catch (error) {
      setAuthInviteStatus((current) => ({
        ...current,
        [user.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to send login invite.',
        },
      }));
    }
  }

  function handleAddUser() {
    setUserDrafts((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        name: '',
        email: '',
        role: 'View Only',
        projectIds: [],
        savedProjectIds: [],
        savedName: '',
        savedEmail: '',
        savedRole: 'View Only',
        persisted: false,
      },
    ]);
  }

  async function handleRemoveUser(userId) {
    const draftUser = userDrafts.find((item) => item.id === userId);
    if (!draftUser) return;
    if (!draftUser.persisted) {
      setUserDrafts((current) => current.filter((item) => item.id !== userId));
      return;
    }
    if (settings.users.length <= 1) {
      await showAppAlert('Keep at least one user in the app.', 'User required');
      return;
    }
    const confirmed = await showAppConfirm(`Remove ${draftUser?.savedName || draftUser?.name || 'this user'}?`, {
      title: 'Remove user',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) return;
    const users = settings.users.filter((item) => item.id !== userId);
    const currentUserId = settings.currentUserId === userId ? users[0]?.id || '' : settings.currentUserId;
    void (async () => {
      let nextState = await runSettingsMutation({ users, currentUserId }, ['settings', 'user', userId]);
      const projectUpdates = buildProjectAccessUpdates(nextState.projects, userId, []);
      if (projectUpdates.length) nextState = await updateProjects(nextState, projectUpdates);
      onStateChange(nextState);
      settingsStateRef.current = nextState;
    })();
  }

  async function handleSaveNotificationSettings() {
    setNotificationSaving(true);
    setNotificationStatus({ tone: '', message: '' });
    try {
      const preferences = saveAndroidNotificationPreferences(activeUser?.id, notificationDraft);
      setNotificationDraft(preferences);
      const result = await syncAndroidNotifications({
        data,
        activeUser,
        requestPermission: preferences.enabled,
      });
      if (result.status === 'permission-denied') {
        setNotificationPermission('denied');
        setNotificationStatus({ tone: 'error', message: 'Android notification permission was not granted.' });
      } else if (result.status === 'disabled') {
        await syncAndroidPushRegistration({ activeUser }).catch(() => {});
        setNotificationStatus({ tone: 'success', message: 'Android reminders are disabled and pending reminders were cleared.' });
      } else {
        setNotificationPermission('granted');
        const pushResult = await syncAndroidPushRegistration({ activeUser, requestPermission: true });
        const liveStatus = pushResult.status === 'registered'
          ? ' Live project updates are enabled.'
          : ` Scheduled reminders are active; live updates still need Firebase configuration${pushResult.message ? ` (${pushResult.message})` : ''}.`;
        setNotificationStatus({
          tone: pushResult.status === 'registered' ? 'success' : '',
          message: `${result.scheduled} reminder${result.scheduled === 1 ? '' : 's'} scheduled on this device.${liveStatus}`,
        });
      }
    } catch (error) {
      setNotificationStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to update Android reminders.',
      });
    } finally {
      setNotificationSaving(false);
    }
  }

  const schedulingSaving = isMutating(['settings', 'scheduling']);
  const holidaysSaving = isMutating(['settings', 'holidays']);
  const peopleColumnsSaving =
    isMutating(['settings', 'peopleListColumns']) || isMutating(['settings', 'peopleListBoldColumns']);
  const isSubcodeSaving = (draftId) => isMutating(['settings', 'subcode', draftId]);
  const isHolidaySaving = (holidayId) => holidaysSaving || isMutating(['settings', 'holiday', holidayId]);
  const isUserSaving = (userId) => isMutating(['settings', 'user', userId]);

  return (
    <section className="panel native-panel top-level-settings-page">
      <div className="settings-page-intro">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Settings</h2>
          <p>{activeSection.description}</p>
        </div>
        <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
          <FluentIcon name="replace" size={16} />
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </div>

      <div className="settings-section-navigation">
        <div
          className="settings-section-tabs"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
            const currentIndex = tabs.indexOf(event.target);
            if (currentIndex < 0) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[nextIndex]?.focus();
            tabs[nextIndex]?.click();
          }}
        >
          {SETTINGS_SECTIONS.map((section) => (
            <button
              id={`settings-tab-${section.id}`}
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSettingsSection === section.id ? 'true' : 'false'}
              aria-controls={`settings-panel-${section.id}`}
              tabIndex={activeSettingsSection === section.id ? 0 : -1}
              onClick={() => setActiveSettingsSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
        <label className="settings-section-select">
          <span>Settings section</span>
          <select value={activeSettingsSection} onChange={(event) => setActiveSettingsSection(event.target.value)}>
            {SETTINGS_SECTIONS.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
        </label>
      </div>

      <div className="settings-sections">
        <section className="settings-section settings-primary-section" hidden={!['scheduling', 'calendar', 'inspections'].includes(activeSettingsSection)}>
          <div className="settings-section-header">
            <div>
              <h3>{activeSection.label}</h3>
              <p>{activeSection.description}</p>
            </div>
          </div>
          <div className="settings-grid">
            <section id="settings-panel-scheduling" className="settings-card settings-card-full" role="tabpanel" aria-labelledby="settings-tab-scheduling" hidden={activeSettingsSection !== 'scheduling'}>
              <div className="settings-card-header">
                <div>
                  <h3>Scheduling defaults</h3>
                  <p>Control the default work-calendar behavior for schedule calculations.</p>
                </div>
                <div className="settings-card-actions">
                  <button
                    className={`button secondary gantt-icon-button inline-save-button${schedulingSaving ? ' is-loading' : ''}`}
                    type="button"
                    onClick={handleSaveSchedulingDefaults}
                    disabled={schedulingSaving || !hasPendingSchedulingDefaults()}
                    title="Save scheduling defaults"
                    aria-label="Save scheduling defaults"
                    aria-busy={schedulingSaving}
                  >
                    <FluentIcon name="check" />
                  </button>
                </div>
              </div>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.weekdaysOnly}
                  onChange={(event) => handleSchedulingDraftToggle('weekdaysOnly', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Use weekdays only</strong>
                  <small>Skip weekends when the scheduling logic calculates dates.</small>
                </span>
              </label>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.showGanttTaskDueDates}
                  onChange={(event) => handleSchedulingDraftToggle('showGanttTaskDueDates', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Show standalone task due dates in Gantt</strong>
                  <small>Display standalone task due-date markers in the Gantt view.</small>
                </span>
              </label>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.showCalendarTaskDueDates}
                  onChange={(event) => handleSchedulingDraftToggle('showCalendarTaskDueDates', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Show standalone task due dates in Calendar</strong>
                  <small>Display standalone task due-date markers in the Calendar tab.</small>
                </span>
              </label>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.showCalendarPhases}
                  onChange={(event) => handleSchedulingDraftToggle('showCalendarPhases', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Show phases in calendar</strong>
                  <small>Display phase bars in the Calendar tab.</small>
                </span>
              </label>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.showCalendarHebrewDates}
                  onChange={(event) => handleSchedulingDraftToggle('showCalendarHebrewDates', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Show Jewish lunar dates in Calendar</strong>
                  <small>Display Hebrew calendar dates under each day number in month calendars.</small>
                </span>
              </label>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={schedulingDraft.showPageStats}
                  onChange={(event) => handleSchedulingDraftToggle('showPageStats', event.target.checked)}
                  disabled={schedulingSaving}
                />
                <span>
                  <strong>Show page stats</strong>
                  <small>Display summary stat cards at the bottom of each main page.</small>
                </span>
              </label>
            </section>

            <section id="settings-panel-inspections" className="settings-card settings-card-full" role="tabpanel" aria-labelledby="settings-tab-inspections" hidden={activeSettingsSection !== 'inspections'}>
              <div className="settings-card-header">
                <div>
                  <h3>Inspection subcodes</h3>
                  <p>Manage the dropdown list used in the inspection editor.</p>
                </div>
                <button className="button primary" type="button" onClick={handleAddInspectionSubcode}>
                  Add subcode
                </button>
              </div>

              {inspectionSubcodeDrafts.length ? (
                <div className="inspection-subcode-list">
                  {inspectionSubcodeDrafts.map((draft) => (
                    <div key={draft.id} className="inspection-subcode-row">
                      <input
                        type="text"
                        value={draft.value}
                        placeholder="Inspection subcode"
                        onChange={(event) => handleInspectionSubcodeChange(draft.id, event.target.value)}
                        disabled={isSubcodeSaving(draft.id)}
                      />
                      <button
                        className={`button secondary gantt-icon-button inline-save-button${isSubcodeSaving(draft.id) ? ' is-loading' : ''}`}
                        type="button"
                        onClick={() => void saveInspectionSubcode(draft.id)}
                        disabled={isSubcodeSaving(draft.id) || !hasPendingInspectionSubcode(draft)}
                        title="Save subcode"
                        aria-label="Save subcode"
                        aria-busy={isSubcodeSaving(draft.id)}
                      >
                        <FluentIcon name="check" />
                      </button>
                      <button
                        className={`button secondary danger gantt-icon-button${isSubcodeSaving(draft.id) ? ' is-loading' : ''}`}
                        type="button"
                        onClick={() => handleRemoveInspectionSubcode(draft.id)}
                        disabled={isSubcodeSaving(draft.id)}
                        title="Remove subcode"
                        aria-label="Remove subcode"
                        aria-busy={isSubcodeSaving(draft.id)}
                      >
                        <FluentIcon name="delete" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">
                  <h3>No subcodes yet</h3>
                  <p>Add subcodes here to make them available in the inspection modal dropdown.</p>
                </div>
              )}
            </section>

            <section id="settings-panel-calendar" className="settings-card settings-card-full" role="tabpanel" aria-labelledby="settings-tab-calendar" hidden={activeSettingsSection !== 'calendar'}>
              <div className="settings-card-header">
                <div>
                  <h3>Holiday calendar</h3>
                  <p>Add single dates or inclusive date ranges for holidays and other blocked time.</p>
                </div>
                <div className="settings-card-actions">
                  <button
                    className={`button secondary${holidaysSaving ? ' is-loading' : ''}`}
                    type="button"
                    onClick={handleAddStandardLegalHolidays}
                    disabled={holidaysSaving}
                    aria-busy={holidaysSaving}
                  >
                    {holidaysSaving ? 'Adding...' : 'Add legal holidays'}
                  </button>
                  <button
                    className={`button secondary${holidaysSaving ? ' is-loading' : ''}`}
                    type="button"
                    onClick={handleAddJewishHolidays}
                    disabled={holidaysSaving}
                    aria-busy={holidaysSaving}
                  >
                    {holidaysSaving ? 'Adding...' : 'Add Jewish holidays'}
                  </button>
                  <button className="button primary" type="button" onClick={handleAddHoliday}>
                    Add holiday
                  </button>
                </div>
              </div>

              {holidayDrafts.length ? (
                <div className="holiday-list">
                  {holidayDrafts.map((holiday, index) => {
                    const isRange = !!(holiday.endDate && holiday.endDate >= holiday.date && holiday.date);
                    const savedHoliday = settings.holidays.find((item) => item.id === holiday.id) || null;
                    const isDirty = !savedHoliday || !holidaysMatch(savedHoliday, holiday);
                    return (
                      <article key={holiday.id || index} className="holiday-row">
                        <label>
                          <span>Start</span>
                          <input
                            type="date"
                            value={holiday.date || ''}
                            onChange={(event) => handleHolidayDraftChange(index, 'date', event.target.value)}
                            disabled={isHolidaySaving(holiday.id)}
                          />
                        </label>

                        <label className="holiday-inline-toggle">
                          <input
                            type="checkbox"
                            checked={isRange}
                            onChange={(event) => handleToggleHolidayRange(index, event.target.checked)}
                            disabled={isHolidaySaving(holiday.id)}
                          />
                          <span>Range</span>
                        </label>

                        <label>
                          <span>End</span>
                          <input
                            type="date"
                            value={holiday.endDate || ''}
                            min={holiday.date || ''}
                            onChange={(event) => handleHolidayDraftChange(index, 'endDate', event.target.value)}
                            disabled={isHolidaySaving(holiday.id) || !isRange}
                          />
                        </label>

                        <label className="holiday-name">
                          <span>Name</span>
                          <input
                            type="text"
                            value={holiday.name || ''}
                            placeholder="Name (optional)"
                            onChange={(event) => handleHolidayDraftChange(index, 'name', event.target.value)}
                            disabled={isHolidaySaving(holiday.id)}
                          />
                        </label>

                        <label className="holiday-inline-toggle">
                          <input
                            type="checkbox"
                            checked={holiday.nonWorkday !== false}
                            onChange={(event) => handleHolidayDraftChange(index, 'nonWorkday', event.target.checked)}
                            disabled={isHolidaySaving(holiday.id)}
                          />
                          <span>Non-workday</span>
                        </label>

                        <div className="holiday-row-actions">
                          <button
                            className={`button secondary gantt-icon-button${isHolidaySaving(holiday.id) ? ' is-loading' : ''}`}
                            type="button"
                            onClick={() => handleSaveHoliday(index)}
                            disabled={isHolidaySaving(holiday.id) || !isDirty}
                            title="Save holiday"
                            aria-label={`Save ${holiday.name || 'holiday'}`}
                            aria-busy={isHolidaySaving(holiday.id)}
                          >
                            <FluentIcon name="check" />
                          </button>
                          <button
                            className={`button secondary danger gantt-icon-button${isHolidaySaving(holiday.id) ? ' is-loading' : ''}`}
                            type="button"
                            onClick={() => handleRemoveHoliday(index)}
                            disabled={isHolidaySaving(holiday.id)}
                            title="Remove holiday"
                            aria-label={`Remove ${holiday.name || 'holiday'}`}
                            aria-busy={isHolidaySaving(holiday.id)}
                          >
                            <FluentIcon name="delete" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact">
                  <h3>No holidays yet</h3>
                  <p>Add your first holiday or closure period to start shaping the scheduling calendar.</p>
                </div>
              )}
            </section>
          </div>
        </section>

        {isAndroidApp ? (
          <section id="settings-panel-notifications" className="settings-section" role="tabpanel" aria-labelledby="settings-tab-notifications" hidden={activeSettingsSection !== 'notifications'}>
            <div className="settings-section-header">
              <div>
                <h3>Android Notifications</h3>
                <p>Schedule reminders on this device for visible project work.</p>
              </div>
            </div>
            <div className="settings-grid settings-grid-single">
              <section className="settings-card android-notification-settings">
                <div className="settings-card-header">
                  <div>
                    <h3>Project reminders</h3>
                    <p>Reminder preferences are stored separately for each signed-in user on this Android device.</p>
                  </div>
                  <button
                    className={`button primary${notificationSaving ? ' is-loading' : ''}`}
                    type="button"
                    onClick={() => void handleSaveNotificationSettings()}
                    disabled={notificationSaving}
                    aria-busy={notificationSaving}
                  >
                    {notificationSaving ? 'Updating...' : 'Save reminder settings'}
                  </button>
                </div>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={notificationDraft.enabled}
                    onChange={(event) => setNotificationDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    disabled={notificationSaving}
                  />
                  <span>
                    <strong>Enable Android reminders</strong>
                    <small>Android will ask for notification permission when you save this setting.</small>
                  </span>
                </label>

                <div className="android-notification-options">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={notificationDraft.upcomingTasks}
                      onChange={(event) => setNotificationDraft((current) => ({ ...current, upcomingTasks: event.target.checked }))}
                      disabled={notificationSaving}
                    />
                    <span><strong>Upcoming tasks</strong><small>Notify before incomplete task due dates.</small></span>
                  </label>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={notificationDraft.inspections}
                      onChange={(event) => setNotificationDraft((current) => ({ ...current, inspections: event.target.checked }))}
                      disabled={notificationSaving}
                    />
                    <span><strong>Upcoming inspections</strong><small>Notify before inspections that have not passed.</small></span>
                  </label>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={notificationDraft.overdueWork}
                      onChange={(event) => setNotificationDraft((current) => ({ ...current, overdueWork: event.target.checked }))}
                      disabled={notificationSaving}
                    />
                    <span><strong>Daily overdue summary</strong><small>Summarize overdue tasks and inspections once each day.</small></span>
                  </label>
                </div>

                <div className="android-notification-timing">
                  <label>
                    <span>Remind me</span>
                    <select
                      value={notificationDraft.reminderDays}
                      onChange={(event) => setNotificationDraft((current) => ({ ...current, reminderDays: Number(event.target.value) }))}
                      disabled={notificationSaving}
                    >
                      <option value="0">On the due date</option>
                      <option value="1">1 day before</option>
                      <option value="2">2 days before</option>
                      <option value="3">3 days before</option>
                      <option value="7">1 week before</option>
                    </select>
                  </label>
                  <label>
                    <span>Reminder time</span>
                    <input
                      type="time"
                      value={notificationDraft.reminderTime}
                      onChange={(event) => setNotificationDraft((current) => ({ ...current, reminderTime: event.target.value }))}
                      disabled={notificationSaving}
                    />
                  </label>
                </div>

                {notificationStatus.message ? (
                  <div className={`android-notification-status ${notificationStatus.tone}`} role="status">
                    {notificationStatus.message}
                  </div>
                ) : null}
                {notificationPermission === 'denied' ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void openAndroidNotificationSettings()}
                  >
                    Open Android notification settings
                  </button>
                ) : null}
              </section>
            </div>
          </section>
        ) : (
          <section id="settings-panel-notifications" className="settings-section" role="tabpanel" aria-labelledby="settings-tab-notifications" hidden={activeSettingsSection !== 'notifications'}>
            <div className="settings-section-header">
              <div><h3>Notifications</h3><p>Manage reminders delivered by the Android app.</p></div>
            </div>
            <div className="settings-grid settings-grid-single">
              <section className="settings-card settings-platform-notice">
                <FluentIcon name="warning" size={22} />
                <div>
                  <h3>Open Settings on Android</h3>
                  <p>Device reminder timing, permission, and delivery preferences are stored separately for each user on each Android device.</p>
                </div>
              </section>
            </div>
          </section>
        )}

        <section id="settings-panel-audit" className="settings-section audit-trail-section" role="tabpanel" aria-labelledby="settings-tab-audit" hidden={activeSettingsSection !== 'audit'}>
          <div className="settings-section-header audit-trail-header">
            <div>
              <h3>Audit Trail</h3>
              <p>Review who changed project dates, dependencies, statuses, and files.</p>
            </div>
            <button
              className={`button secondary${auditLoading ? ' is-loading' : ''}`}
              type="button"
              onClick={() => void refreshAuditTrail()}
              disabled={auditLoading}
              aria-busy={auditLoading}
            >
              <FluentIcon name="replace" />
              {auditLoading ? 'Refreshing...' : 'Refresh history'}
            </button>
          </div>

          <div className="audit-trail-filters" aria-label="Audit trail filters">
            <label>
              <span>Project</span>
              <select value={auditProjectFilter} onChange={(event) => setAuditProjectFilter(event.target.value)}>
                <option value="">All projects</option>
                {[...data.projects]
                  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
                  .map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>
              <span>Change type</span>
              <select value={auditCategoryFilter} onChange={(event) => setAuditCategoryFilter(event.target.value)}>
                <option value="all">All changes</option>
                <option value="dates">Dates</option>
                <option value="dependencies">Dependencies</option>
                <option value="statuses">Statuses</option>
                <option value="files">Files</option>
                <option value="activity">Created and deleted</option>
              </select>
            </label>
          </div>

          {auditError ? (
            <div className="audit-trail-message error" role="alert">{auditError}</div>
          ) : auditLoading && !auditRows.length ? (
            <div className="audit-trail-message">Loading history...</div>
          ) : (
            <div>
              {auditEntries.length ? (
                <div className="audit-trail-list">
                  {auditEntries.map((entry) => {
                    const actorEmail = String(entry.actorEmail || '').trim();
                    const actorName = auditActorNames.get(actorEmail.toLowerCase()) || actorEmail || 'Unknown user';
                    const projectName = data.projects.find((project) => project.id === entry.projectId)?.name || 'General';
                    return (
                      <article key={entry.id} className="audit-trail-row">
                        <div className={`audit-trail-marker ${entry.category}`} aria-hidden="true" />
                        <div className="audit-trail-content">
                          <div className="audit-trail-summary">
                            <strong>{entry.label}</strong>
                            <span>{entry.entityName}</span>
                          </div>
                          {entry.action === 'update' ? (
                            <div className="audit-trail-values">
                              <span>{formatAuditValue(entry.before)}</span>
                              <FluentIcon name="chevronRight" />
                              <span>{formatAuditValue(entry.after)}</span>
                            </div>
                          ) : null}
                          <div className="audit-trail-meta">
                            <span>{actorName}</span>
                            <span>{projectName}</span>
                            <time dateTime={entry.createdAt}>
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown time'}
                            </time>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="audit-trail-message">No matching changes are loaded.</div>
              )}
              {auditHasMore ? (
                <div className="audit-trail-pagination">
                  <button
                    className={`button secondary${auditLoading ? ' is-loading' : ''}`}
                    type="button"
                    onClick={() => void loadMoreAuditTrail()}
                    disabled={auditLoading}
                    aria-busy={auditLoading}
                  >
                    {auditLoading ? 'Loading...' : 'Load older changes'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section id="settings-panel-users" className="settings-section" role="tabpanel" aria-labelledby="settings-tab-users" hidden={activeSettingsSection !== 'users'}>
          <div className="settings-section-header">
            <div>
              <h3>Users and Access</h3>
              <p>Manage who can use the app and which role each person has.</p>
            </div>
          </div>
          <div className="settings-grid settings-grid-single">
            <section className="settings-card">
              <div className="settings-card-header">
                <div>
                  <h3>Users and roles</h3>
                  <p>Manage who can use the app and which role each person has.</p>
                </div>
                <button className="button primary" type="button" onClick={handleAddUser}>
                  Add user
                </button>
              </div>

              <div className="inspection-subcode-list">
                {userDrafts.map((user) => {
                  const inviteStatus = authInviteStatus[user.id];
                  const userSaving = isUserSaving(user.id);
                  const hasPendingChanges = hasPendingUserDraft(user);
                  const hasEmail = !!String(user.email || '').trim();
                  const inviteDisabled = userSaving || inviteStatus?.status === 'sending' || hasPendingChanges || !hasEmail;
                  const inviteTitle = !hasEmail
                    ? 'Add an email before sending an invite'
                    : hasPendingChanges
                      ? 'Save this user before sending an invite'
                      : 'Send login invite';
                  return (
                  <div key={user.id} className="user-role-card">
                    <div className="user-role-row">
                      <input
                        type="text"
                        value={user.name}
                        placeholder="User name"
                        onChange={(event) => handleUserFieldChange(user.id, 'name', event.target.value)}
                        disabled={userSaving}
                      />
                      <input
                        type="email"
                        value={user.email}
                        placeholder="Email (optional)"
                        onChange={(event) => handleUserFieldChange(user.id, 'email', event.target.value)}
                        disabled={userSaving}
                      />
                      <select
                        value={user.role}
                        onChange={(event) => handleUserFieldChange(user.id, 'role', event.target.value)}
                        disabled={userSaving}
                      >
                        {USER_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </div>
                    <div className="user-project-access">
                      <div className="user-project-access-header">
                        <span>Project access</span>
                        {data.projects.length ? (
                          <button
                            className="button secondary compact-button"
                            type="button"
                            onClick={() => handleToggleAllUserProjects(user.id)}
                            disabled={isUserSaving(user.id)}
                          >
                            {data.projects.every((project) =>
                              normalizeProjectAccessUserIds(user.projectIds).includes(project.id),
                            )
                              ? 'Clear all'
                              : 'Select all'}
                          </button>
                        ) : null}
                      </div>
                      {data.projects.length ? (
                        <div className="user-project-access-list">
                          {data.projects.map((project) => (
                            <label key={project.id} className="project-access-option compact">
                              <input
                                type="checkbox"
                                checked={normalizeProjectAccessUserIds(user.projectIds).includes(project.id)}
                                onChange={(event) =>
                                  handleUserProjectAccessChange(user.id, project.id, event.target.checked)
                                }
                                disabled={isUserSaving(user.id)}
                              />
                              <span>{project.name}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <small>No projects available.</small>
                      )}
                    </div>
                    <div className="user-role-actions" aria-label={`Actions for ${user.name || 'user'}`}>
                      <button
                        className={`button secondary gantt-icon-button inline-save-button${userSaving ? ' is-loading' : ''}`}
                        type="button"
                        onClick={() => void saveUserDraft(user.id)}
                        disabled={userSaving || !hasPendingChanges}
                        title="Save user"
                        aria-label={`Save ${user.name || 'user'}`}
                        aria-busy={userSaving}
                      >
                        <FluentIcon name="check" />
                      </button>
                      <button
                        className={`button secondary gantt-icon-button${inviteStatus?.status === 'sending' ? ' is-loading' : ''}`}
                        type="button"
                        onClick={() => void handleSendAuthInvite(user)}
                        disabled={inviteDisabled}
                        title={inviteTitle}
                        aria-label={`Send login invite to ${user.name || 'user'}`}
                        aria-busy={inviteStatus?.status === 'sending'}
                      >
                        <FluentIcon name="mail" />
                      </button>
                      <button
                        className={`button secondary danger gantt-icon-button${userSaving ? ' is-loading' : ''}`}
                        type="button"
                        onClick={() => handleRemoveUser(user.id)}
                        disabled={userSaving || settings.users.length <= 1}
                        title="Remove user"
                        aria-label={`Remove ${user.name || 'user'}`}
                        aria-busy={userSaving}
                      >
                        <FluentIcon name="delete" />
                      </button>
                    </div>
                    {inviteStatus?.message ? <div className={`auth-invite-message ${inviteStatus.status}`}>{inviteStatus.message}</div> : null}
                  </div>
                  );
                })}
              </div>
            </section>
          </div>
        </section>

        <section id="settings-panel-display" className="settings-section" role="tabpanel" aria-labelledby="settings-tab-display" hidden={activeSettingsSection !== 'display'}>
          <div className="settings-section-header">
            <div>
              <h3>People List Display</h3>
              <p>Choose which columns appear in People list view, how they are ordered, and which are emphasized.</p>
            </div>
          </div>
          <div className="settings-grid settings-grid-single">
            <section className="settings-card">
              <div className="settings-card-header">
                <div>
                  <h3>People list columns</h3>
                  <p>Choose which columns appear in People list view and arrange their order.</p>
                </div>
              </div>

              <div className="settings-order-list">
                {peopleColumnsSaving ? <div className="mutation-status" role="status">Saving display settings...</div> : null}
                {[
                  ...settings.peopleListColumns.filter((columnId) =>
                    PEOPLE_LIST_COLUMN_DEFS.some((column) => column.id === columnId),
                  ),
                  ...PEOPLE_LIST_COLUMN_DEFS.map((column) => column.id).filter(
                    (columnId) => !settings.peopleListColumns.includes(columnId),
                  ),
                ].map((columnId) => {
                  const column = PEOPLE_LIST_COLUMN_DEFS.find((item) => item.id === columnId);
                  if (!column) return null;
                  const visible = settings.peopleListColumns.includes(column.id);
                  const orderIndex = settings.peopleListColumns.indexOf(column.id);
                  return (
                    <div key={column.id} className="settings-order-row">
                      <label className="settings-toggle compact">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={(event) => handleTogglePeopleColumn(column.id, event.target.checked)}
                          disabled={peopleColumnsSaving}
                        />
                        <span>
                          <strong>{column.label}</strong>
                          <small>{visible ? `Position ${orderIndex + 1}` : 'Hidden'}</small>
                        </span>
                      </label>
                      <label className="settings-toggle compact settings-inline-checkbox">
                        <input
                          type="checkbox"
                          checked={settings.peopleListBoldColumns.includes(column.id)}
                          onChange={(event) => handleTogglePeopleBold(column.id, event.target.checked)}
                          disabled={peopleColumnsSaving}
                        />
                        <span>
                          <strong>Bold</strong>
                        </span>
                      </label>
                      <div className="settings-order-actions">
                        <button
                          className="button secondary gantt-icon-button"
                          type="button"
                          onClick={() => movePeopleColumn(column.id, 'up')}
                          disabled={peopleColumnsSaving || !visible || orderIndex <= 0}
                          title="Move up"
                        >
                          <FluentIcon name="arrowUp" />
                        </button>
                        <button
                          className="button secondary gantt-icon-button"
                          type="button"
                          onClick={() => movePeopleColumn(column.id, 'down')}
                          disabled={peopleColumnsSaving || !visible || orderIndex < 0 || orderIndex >= settings.peopleListColumns.length - 1}
                          title="Move down"
                        >
                          <FluentIcon name="arrowDown" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </section>

        <section id="settings-panel-system" className="settings-section" role="tabpanel" aria-labelledby="settings-tab-system" hidden={activeSettingsSection !== 'system'}>
          <div className="settings-section-header">
            <div>
              <h3>System Status</h3>
              <p>Confirm the active data source and the records currently loaded on this device.</p>
            </div>
            <button className={`button secondary${loading ? ' is-loading' : ''}`} type="button" onClick={refresh} disabled={loading} aria-busy={loading}>
              <FluentIcon name="replace" size={16} />
              {loading ? 'Refreshing...' : 'Refresh data'}
            </button>
          </div>
          <div className="settings-system-status-grid">
            <DashboardStat label="Data source" value={data.storageMode === 'supabase' ? 'Supabase' : 'Local'} tone="brand" />
            <DashboardStat label="Platform" value={isAndroidApp ? 'Android' : 'Web'} />
            <DashboardStat label="Projects" value={(data.projects || []).length} />
            <DashboardStat label="Tasks" value={(data.tasks || []).length} />
            <DashboardStat label="People" value={(data.subs || []).length + (data.employees || []).length} />
            <DashboardStat label="App users" value={settings.users.length} />
            <DashboardStat label="Holidays" value={settings.holidays.length} />
            <DashboardStat label="Inspection subcodes" value={settings.inspectionSubcodes.length} />
          </div>
          <section className="settings-card settings-system-summary">
            <h3>Current user</h3>
            <dl>
              <div><dt>Name</dt><dd>{activeUser?.name || 'Not available'}</dd></div>
              <div><dt>Email</dt><dd>{activeUser?.email || 'Not available'}</dd></div>
              <div><dt>Role</dt><dd>{activeUser?.role || 'Not available'}</dd></div>
            </dl>
          </section>
        </section>
      </div>
    </section>
  );
}
