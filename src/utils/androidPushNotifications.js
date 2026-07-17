import { PushNotifications } from '@capacitor/push-notifications';
import { fetchAuthorizedSupabase } from '../services/trackerData.js';
import { isNativeAndroidApp } from '../platform/platformAdapter.js';
import { ANDROID_NOTIFICATION_CHANNELS, getAndroidNotificationPreferences } from './androidNotifications.js';

const TOKEN_STORAGE_PREFIX = 'project-tracker:android-push-token:';
const LIVE_PUSH_ENABLED = String(import.meta.env?.VITE_FIREBASE_PUSH_ENABLED || '').toLowerCase() === 'true';
let registrationChain = Promise.resolve();

function tokenStorageKey(userId) {
  return `${TOKEN_STORAGE_PREFIX}${userId || 'default'}`;
}

function readStoredToken(userId) {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(tokenStorageKey(userId)) || '';
  } catch {
    return '';
  }
}

function writeStoredToken(userId, token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(tokenStorageKey(userId), token);
    else window.localStorage.removeItem(tokenStorageKey(userId));
  } catch {
    // Token persistence can retry on the next app start.
  }
}

async function savePushToken(activeUser, token) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/register_device_push_token',
    {
      method: 'POST',
      body: JSON.stringify({
        p_token: token,
        p_device_label: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 240),
      }),
    },
    'Push notification registration',
  );
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || 'Unable to save this device for live notifications.');
  }
  writeStoredToken(activeUser.id, token);
}

async function deletePushToken(activeUser) {
  const token = readStoredToken(activeUser?.id);
  if (!token) return;
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/unregister_device_push_token',
    { method: 'POST', body: JSON.stringify({ p_token: token }) },
    'Push notification removal',
  );
  if (!response.ok) throw new Error('Unable to remove this device from live notifications.');
  writeStoredToken(activeUser.id, '');
}

async function createPushChannels() {
  await Promise.all([
    PushNotifications.createChannel({
      id: ANDROID_NOTIFICATION_CHANNELS.tasks,
      name: 'Due soon',
      description: 'Upcoming tasks and assignments',
      importance: 3,
      visibility: 0,
    }),
    PushNotifications.createChannel({
      id: ANDROID_NOTIFICATION_CHANNELS.inspections,
      name: 'Inspections',
      description: 'Upcoming project inspections',
      importance: 3,
      visibility: 0,
    }),
    PushNotifications.createChannel({
      id: ANDROID_NOTIFICATION_CHANNELS.overdue,
      name: 'Overdue summary',
      description: 'A quiet daily summary of overdue project work',
      importance: 2,
      visibility: 0,
      vibration: false,
    }),
  ]);
}

async function performPushRegistration({ activeUser, requestPermission = false }) {
  if (!isNativeAndroidApp() || !activeUser?.id) return { status: 'unsupported' };
  const preferences = getAndroidNotificationPreferences(activeUser.id);
  if (!preferences.enabled) {
    await deletePushToken(activeUser).catch(() => {});
    await PushNotifications.unregister().catch(() => {});
    return { status: 'disabled' };
  }
  if (!LIVE_PUSH_ENABLED) {
    return { status: 'unavailable', message: 'Firebase is not enabled in this Android build.' };
  }

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted' && requestPermission) {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') return { status: 'permission-denied' };

  await createPushChannels();
  return new Promise((resolve) => {
    let settled = false;
    const handles = [];
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      await Promise.all(handles.map((handle) => handle?.remove?.().catch(() => {})));
      resolve(result);
    };
    const timeoutId = window.setTimeout(
      () => void finish({ status: 'unavailable', message: 'Firebase registration timed out.' }),
      12_000,
    );

    Promise.all([
      PushNotifications.addListener('registration', async ({ value }) => {
        try {
          await savePushToken(activeUser, value);
          await finish({ status: 'registered' });
        } catch (error) {
          await finish({ status: 'unavailable', message: error instanceof Error ? error.message : String(error) });
        }
      }),
      PushNotifications.addListener('registrationError', ({ error }) =>
        void finish({ status: 'unavailable', message: error || 'Firebase registration failed.' }),
      ),
    ]).then((listenerHandles) => {
      handles.push(...listenerHandles);
      return PushNotifications.register();
    }).catch((error) =>
      void finish({ status: 'unavailable', message: error instanceof Error ? error.message : String(error) }),
    );
  });
}

export function syncAndroidPushRegistration(options) {
  const next = registrationChain.catch(() => undefined).then(() => performPushRegistration(options));
  registrationChain = next;
  return next;
}

export async function addAndroidPushActionListener(listener) {
  if (!isNativeAndroidApp()) return { remove: async () => {} };
  return PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    listener({
      actionId: action.actionId || 'tap',
      notification: action.notification,
      extra: action.notification?.data || {},
    });
  });
}

export async function sendProjectPushNotification(event) {
  if (!event?.projectId || !event?.kind) return { status: 'skipped' };
  const response = await fetchAuthorizedSupabase(
    '/functions/v1/send-project-notification',
    {
      method: 'POST',
      body: JSON.stringify({
        eventId: event.eventId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        projectId: String(event.projectId),
        kind: String(event.kind),
        entityId: String(event.entityId || ''),
        title: String(event.title || '').slice(0, 120),
        body: String(event.body || '').slice(0, 300),
        tab: String(event.tab || 'projects'),
        recipientAppUserIds: Array.isArray(event.recipientAppUserIds) ? event.recipientAppUserIds : [],
      }),
    },
    'Live notification delivery',
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to deliver live notification.');
  return payload;
}
