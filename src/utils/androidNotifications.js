import { LocalNotifications } from '@capacitor/local-notifications';
import { getVisibleProjectsForUser, getVisibleTasksForUser } from './accessUi.js';
import { isNativeAndroidApp } from '../platform/platformAdapter.js';

const MANAGED_NOTIFICATION_MIN_ID = 100_000_000;
const MANAGED_NOTIFICATION_MAX_ID = 399_999_999;
const REMINDER_CHANNEL_ID = 'project-reminders';
let notificationSyncChain = Promise.resolve();

export const DEFAULT_ANDROID_NOTIFICATION_PREFERENCES = {
  enabled: false,
  upcomingTasks: true,
  inspections: true,
  overdueWork: true,
  reminderDays: 1,
  reminderTime: '08:00',
};

function notificationStorageKey(userId) {
  return `project-tracker:android-notifications:${userId || 'default'}`;
}

export function normalizeAndroidNotificationPreferences(preferences = {}) {
  const reminderDays = [0, 1, 2, 3, 7].includes(Number(preferences.reminderDays))
    ? Number(preferences.reminderDays)
    : DEFAULT_ANDROID_NOTIFICATION_PREFERENCES.reminderDays;
  const reminderTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.reminderTime || ''))
    ? String(preferences.reminderTime)
    : DEFAULT_ANDROID_NOTIFICATION_PREFERENCES.reminderTime;
  return {
    enabled: preferences.enabled === true,
    upcomingTasks: preferences.upcomingTasks !== false,
    inspections: preferences.inspections !== false,
    overdueWork: preferences.overdueWork !== false,
    reminderDays,
    reminderTime,
  };
}

export function getAndroidNotificationPreferences(userId) {
  if (typeof window === 'undefined') return { ...DEFAULT_ANDROID_NOTIFICATION_PREFERENCES };
  try {
    const stored = JSON.parse(window.localStorage.getItem(notificationStorageKey(userId)) || '{}');
    return normalizeAndroidNotificationPreferences(stored);
  } catch {
    return { ...DEFAULT_ANDROID_NOTIFICATION_PREFERENCES };
  }
}

export function saveAndroidNotificationPreferences(userId, preferences) {
  const normalized = normalizeAndroidNotificationPreferences(preferences);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(notificationStorageKey(userId), JSON.stringify(normalized));
  }
  return normalized;
}

function parseLocalDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function stableNotificationId(kind, value) {
  let hash = 2166136261;
  const source = `${kind}:${value}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const base = kind === 'task' ? 100_000_000 : kind === 'inspection' ? 200_000_000 : 300_000_000;
  return base + ((hash >>> 0) % 99_000_000);
}

function reminderDateFor(dateKey, preferences) {
  const date = parseLocalDate(dateKey);
  if (!date) return null;
  const [hour, minute] = preferences.reminderTime.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - preferences.reminderDays);
  return date;
}

function relativeDueText(dateKey, today) {
  const date = parseLocalDate(dateKey);
  if (!date) return 'soon';
  const days = Math.round((startOfLocalDay(date) - today) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function buildAndroidReminderNotifications({ data, activeUser, preferences, now = new Date() }) {
  const normalizedPreferences = normalizeAndroidNotificationPreferences(preferences);
  if (!normalizedPreferences.enabled) return [];
  const visibleProjects = getVisibleProjectsForUser(data.projects || [], data.settings || {}, activeUser);
  const visibleTasks = getVisibleTasksForUser(data.tasks || [], data.settings || {}, visibleProjects);
  const projectById = new Map(visibleProjects.map((project) => [project.id, project]));
  const today = startOfLocalDay(now);
  const notifications = [];

  if (normalizedPreferences.upcomingTasks) {
    visibleTasks
      .filter((task) => !task.done && task.due)
      .forEach((task) => {
        const dueDate = parseLocalDate(task.due);
        const at = reminderDateFor(task.due, normalizedPreferences);
        if (!dueDate || dueDate < today || !at || at <= now) return;
        const projectName = projectById.get(task.projectId)?.name || 'Unassigned';
        notifications.push({
          id: stableNotificationId('task', task.id),
          title: `Task due ${relativeDueText(task.due, today)}`,
          body: `${task.label} · ${projectName}`,
          schedule: { at },
          channelId: REMINDER_CHANNEL_ID,
          group: 'project-work',
          autoCancel: true,
          extra: { managedBy: 'project-tracker', kind: 'task', tab: 'tasks', taskId: task.id, projectId: task.projectId || 'all' },
        });
      });
  }

  const overdueInspections = [];
  if (normalizedPreferences.inspections || normalizedPreferences.overdueWork) {
    visibleProjects.forEach((project) => {
      (project.inspections || []).forEach((inspection) => {
        if (!inspection.date || inspection.status === 'passed') return;
        const inspectionDate = parseLocalDate(inspection.date);
        if (!inspectionDate) return;
        if (inspectionDate < today) overdueInspections.push({ inspection, project });
        if (!normalizedPreferences.inspections || inspectionDate < today) return;
        const at = reminderDateFor(inspection.date, normalizedPreferences);
        if (!at || at <= now) return;
        const label = inspection.subcode || inspection.inspectionType || 'Inspection';
        notifications.push({
          id: stableNotificationId('inspection', inspection.id),
          title: `Inspection ${relativeDueText(inspection.date, today)}`,
          body: `${label} · ${project.name}`,
          schedule: { at },
          channelId: REMINDER_CHANNEL_ID,
          group: 'project-work',
          autoCancel: true,
          extra: { managedBy: 'project-tracker', kind: 'inspection', tab: 'calendar', inspectionId: inspection.id, projectId: project.id },
        });
      });
    });
  }

  if (normalizedPreferences.overdueWork) {
    const overdueTasks = visibleTasks.filter((task) => {
      const dueDate = parseLocalDate(task.due);
      return !task.done && dueDate && dueDate < today;
    });
    if (overdueTasks.length || overdueInspections.length) {
      const [hour, minute] = normalizedPreferences.reminderTime.split(':').map(Number);
      const summaryParts = [];
      if (overdueTasks.length) summaryParts.push(`${overdueTasks.length} overdue task${overdueTasks.length === 1 ? '' : 's'}`);
      if (overdueInspections.length) summaryParts.push(`${overdueInspections.length} overdue inspection${overdueInspections.length === 1 ? '' : 's'}`);
      notifications.push({
        id: stableNotificationId('overdue', activeUser?.id || 'default'),
        title: 'Overdue project work',
        body: summaryParts.join(' · '),
        schedule: { on: { hour, minute } },
        channelId: REMINDER_CHANNEL_ID,
        group: 'project-work',
        autoCancel: true,
        extra: { managedBy: 'project-tracker', kind: 'overdue', tab: 'tasks', projectId: 'all' },
      });
    }
  }

  const recurringNotifications = notifications.filter((notification) => notification.extra.kind === 'overdue');
  const timedNotifications = notifications
    .filter((notification) => notification.extra.kind !== 'overdue')
    .sort((left, right) => left.schedule.at.getTime() - right.schedule.at.getTime())
    .slice(0, 60 - recurringNotifications.length);
  return [...timedNotifications, ...recurringNotifications];
}

async function cancelManagedNotifications() {
  const pending = await LocalNotifications.getPending();
  const notifications = (pending.notifications || []).filter(
    (notification) => notification.id >= MANAGED_NOTIFICATION_MIN_ID && notification.id <= MANAGED_NOTIFICATION_MAX_ID,
  );
  if (notifications.length) await LocalNotifications.cancel({ notifications });
}

async function performAndroidNotificationSync({ data, activeUser, requestPermission = false }) {
  if (!isNativeAndroidApp()) return { status: 'unsupported', scheduled: 0 };
  const preferences = getAndroidNotificationPreferences(activeUser?.id);
  await cancelManagedNotifications();
  if (!preferences.enabled) return { status: 'disabled', scheduled: 0 };

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== 'granted') return { status: 'permission-denied', scheduled: 0 };

  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: 'Project reminders',
    description: 'Upcoming tasks, inspections, and overdue project work',
    importance: 4,
    visibility: 1,
  });
  const notifications = buildAndroidReminderNotifications({ data, activeUser, preferences });
  if (notifications.length) await LocalNotifications.schedule({ notifications });
  return { status: 'scheduled', scheduled: notifications.length };
}

export function syncAndroidNotifications(options) {
  const nextSync = notificationSyncChain
    .catch(() => undefined)
    .then(() => performAndroidNotificationSync(options));
  notificationSyncChain = nextSync;
  return nextSync;
}

export async function addAndroidNotificationActionListener(listener) {
  if (!isNativeAndroidApp()) return { remove: async () => {} };
  return LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    listener(action.notification?.extra || {});
  });
}
