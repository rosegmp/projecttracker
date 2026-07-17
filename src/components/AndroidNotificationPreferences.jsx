import React, { useEffect, useState } from 'react';
import { openAndroidNotificationSettings } from '../platform/platformAdapter.js';
import {
  getAndroidNotificationPermissionStatus,
  getAndroidNotificationPreferences,
  saveAndroidNotificationPreferences,
  syncAndroidNotifications,
} from '../utils/androidNotifications.js';
import { syncAndroidPushRegistration } from '../utils/androidPushNotifications.js';

export default function AndroidNotificationPreferences({ data, activeUser }) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ tone: '', message: '' });
  const [permission, setPermission] = useState('');
  const [draft, setDraft] = useState(() => getAndroidNotificationPreferences(activeUser?.id));

  useEffect(() => {
    setDraft(getAndroidNotificationPreferences(activeUser?.id));
    void getAndroidNotificationPermissionStatus().then(setPermission).catch(() => setPermission(''));
  }, [activeUser?.id]);

  async function savePreferences() {
    setSaving(true);
    setStatus({ tone: '', message: '' });
    try {
      const preferences = saveAndroidNotificationPreferences(activeUser?.id, draft);
      setDraft(preferences);
      const result = await syncAndroidNotifications({ data, activeUser, requestPermission: preferences.enabled });
      if (result.status === 'permission-denied') {
        setPermission('denied');
        setStatus({ tone: 'error', message: 'Android notification permission was not granted.' });
        return;
      }
      if (result.status === 'disabled') {
        await syncAndroidPushRegistration({ activeUser }).catch(() => {});
        setStatus({ tone: 'success', message: 'Android reminders are disabled and pending reminders were cleared.' });
        return;
      }
      setPermission('granted');
      const pushResult = await syncAndroidPushRegistration({ activeUser, requestPermission: true });
      const liveStatus = pushResult.status === 'registered'
        ? ' Live project updates are enabled.'
        : ` Scheduled reminders are active; live updates still need Firebase configuration${pushResult.message ? ` (${pushResult.message})` : ''}.`;
      setStatus({
        tone: pushResult.status === 'registered' ? 'success' : '',
        message: `${result.scheduled} reminder${result.scheduled === 1 ? '' : 's'} scheduled on this device.${liveStatus}`,
      });
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to update Android reminders.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-card android-notification-settings">
      <div className="settings-card-header">
        <div><h3>Project reminders</h3><p>Preferences are stored separately for each signed-in user on this Android device.</p></div>
        <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={() => void savePreferences()} disabled={saving} aria-busy={saving}>
          {saving ? 'Updating...' : 'Save reminder settings'}
        </button>
      </div>
      <label className="settings-toggle">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} disabled={saving} />
        <span><strong>Enable Android reminders</strong><small>Android asks for permission only after you enable and save reminders.</small></span>
      </label>
      <div className="android-notification-options">
        <label className="settings-toggle">
          <input type="checkbox" checked={draft.upcomingTasks} onChange={(event) => setDraft((current) => ({ ...current, upcomingTasks: event.target.checked }))} disabled={saving} />
          <span><strong>Upcoming tasks</strong><small>Notify before incomplete task due dates.</small></span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={draft.inspections} onChange={(event) => setDraft((current) => ({ ...current, inspections: event.target.checked }))} disabled={saving} />
          <span><strong>Upcoming inspections</strong><small>Notify before scheduled inspections that have not passed.</small></span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={draft.overdueWork} onChange={(event) => setDraft((current) => ({ ...current, overdueWork: event.target.checked }))} disabled={saving} />
          <span><strong>Daily overdue summary</strong><small>Summarize overdue tasks and inspections once each day.</small></span>
        </label>
      </div>
      <div className="android-notification-timing">
        <label><span>Remind me</span><select value={draft.reminderDays} onChange={(event) => setDraft((current) => ({ ...current, reminderDays: Number(event.target.value) }))} disabled={saving}>
          <option value="0">On the due date</option><option value="1">1 day before</option><option value="2">2 days before</option><option value="3">3 days before</option><option value="7">1 week before</option>
        </select></label>
        <label><span>Reminder time</span><input type="time" value={draft.reminderTime} onChange={(event) => setDraft((current) => ({ ...current, reminderTime: event.target.value }))} disabled={saving} /></label>
      </div>
      {status.message ? <div className={`android-notification-status ${status.tone}`} role="status">{status.message}</div> : null}
      {permission === 'denied' ? <button className="button secondary" type="button" onClick={() => void openAndroidNotificationSettings()}>Open Android notification settings</button> : null}
    </section>
  );
}
