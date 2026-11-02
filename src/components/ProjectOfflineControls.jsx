import React, { useEffect, useMemo, useState } from 'react';
import { downloadProjectFileFromStorage } from '../services/trackerData.js';
import { loadOfflineProjectWorkflowSnapshot } from '../services/constructionWorkflows.js';
import {
  cacheProjectForOffline, formatOfflineProjectSize, getOfflineProjectRecord,
  removeOfflineProject, setOfflineProjectAssetSummary, subscribeToOfflineProjects,
} from '../services/offlineProjectStore.js';
import {
  cacheOfflineProjectAssets, getOfflineProjectAssetCandidates,
  removeOfflineProjectAssets, summarizeOfflineProjectAssets,
} from '../services/offlineProjectAssetStore.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import '../project-offline-controls.css';

export default function ProjectOfflineControls({ data, project, tasks, settings, activeUser, visibleTabs, userId }) {
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [selection, setSelection] = useState({ files: false, photos: false });
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const workflows = record?.snapshot?.workflows || {};
  const assetCounts = useMemo(() => ({
    files: getOfflineProjectAssetCandidates(project, ['files'], tasks, workflows).length,
    photos: getOfflineProjectAssetCandidates(project, ['photos'], tasks, workflows).length,
  }), [project, tasks, workflows]);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !project.id) return undefined;
    const refresh = () => void getOfflineProjectRecord(userId, project.id)
      .then((next) => { if (!cancelled) setRecord(next); })
      .catch(() => { if (!cancelled) setRecord(null); });
    refresh();
    const unsubscribe = subscribeToOfflineProjects(userId, refresh);
    return () => { cancelled = true; unsubscribe(); };
  }, [project.id, userId]);

  useEffect(() => {
    const setOnlineStatus = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', setOnlineStatus);
    window.addEventListener('offline', setOnlineStatus);
    return () => { window.removeEventListener('online', setOnlineStatus); window.removeEventListener('offline', setOnlineStatus); };
  }, []);

  useEffect(() => {
    const selectedKinds = record?.assetSummary?.selectedKinds || record?.assetSections || [];
    setSelection({ files: selectedKinds.includes('files'), photos: selectedKinds.includes('photos') });
  }, [record?.id]);

  async function saveCopy() {
    if (!userId || !online || busy) return;
    setBusy(true);
    try {
      const snapshot = await loadOfflineProjectWorkflowSnapshot({ projectId: project.id, visibleTabs, role: activeUser?.role });
      const next = await cacheProjectForOffline({
        userId, project, tasks, settings,
        subs: data?.subs || [], employees: data?.employees || [],
        workflows: snapshot.workflows, workflowSections: snapshot.cachedSections, visibleTabs,
      });
      setRecord(next);
      if (snapshot.failures.length) await showAppAlert(`${snapshot.failures.length} workflow sections could not be saved. Reconnect and update this copy again before relying on them offline.`, 'Offline copy partially updated');
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'The project could not be stored on this device.', 'Offline copy failed');
    } finally { setBusy(false); }
  }

  async function removeCopy() {
    if (!record || busy) return;
    const confirmed = await showAppConfirm(`Remove the offline copy of ${project.name || 'this project'} from this device?`, { title: 'Remove offline copy?', confirmLabel: 'Remove copy', tone: 'danger' });
    if (!confirmed) return;
    setBusy(true);
    try {
      await removeOfflineProjectAssets(userId, project.id);
      await removeOfflineProject(userId, project.id);
      setRecord(null);
    } catch (error) { await showAppAlert(error instanceof Error ? error.message : 'The offline copy could not be removed.', 'Remove failed'); }
    finally { setBusy(false); }
  }

  async function downloadAssets() {
    const selectedKinds = Object.entries(selection).filter(([, value]) => value).map(([kind]) => kind);
    if (!record || !online || !selectedKinds.length || assetBusy) return;
    setAssetBusy(true);
    setMessage('');
    setProgress({ completed: 0, total: assetCounts.files + assetCounts.photos });
    try {
      const summary = await cacheOfflineProjectAssets({
        userId, project, tasks, workflows, selectedKinds,
        downloadAsset: (asset) => downloadProjectFileFromStorage(asset), onProgress: setProgress,
      });
      setRecord(await setOfflineProjectAssetSummary(userId, project.id, summary));
      setMessage(summary.failed || summary.truncated
        ? `${summary.count} downloaded. Some items could not be saved; update the copy while connected.`
        : `${summary.count} file${summary.count === 1 ? '' : 's'} and photo${summary.count === 1 ? '' : 's'} downloaded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Files and photos could not be downloaded.'); }
    finally { setAssetBusy(false); }
  }

  async function removeAssets() {
    if (!record || assetBusy) return;
    const confirmed = await showAppConfirm('Remove downloaded files and photos for this project?', { title: 'Remove offline downloads?', confirmLabel: 'Remove downloads', tone: 'danger' });
    if (!confirmed) return;
    setAssetBusy(true);
    try {
      await removeOfflineProjectAssets(userId, project.id);
      const summary = { ...summarizeOfflineProjectAssets([], []), completeKinds: [], updatedAt: new Date().toISOString() };
      setRecord(await setOfflineProjectAssetSummary(userId, project.id, summary));
      setSelection({ files: false, photos: false });
      setMessage('Offline downloads removed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Offline downloads could not be removed.'); }
    finally { setAssetBusy(false); }
  }

  if (!userId || ['Customer', 'Subcontractor'].includes(activeUser?.role)) return null;
  return <section className="settings-card project-offline-controls" aria-label="Offline project copy">
    <div className="settings-card-header"><div><h3>Offline project copy</h3><p>{record ? `Saved ${new Date(record.lastSyncedAt).toLocaleString()} · ${formatOfflineProjectSize(record.byteSize)}` : 'Save this project for use when disconnected.'}</p></div></div>
    <div className="panel-actions">
      <button className="button secondary" type="button" onClick={() => void saveCopy()} disabled={!online || busy}>{busy ? 'Saving…' : record ? 'Update offline copy' : 'Make available offline'}</button>
      {record ? <button className="button secondary" type="button" onClick={() => void removeCopy()} disabled={busy}>Remove copy</button> : null}
    </div>
    {record ? <div className="project-offline-asset-controls">
      <p>Download files and photos for offline viewing.</p>
      <div className="panel-actions">
        <label><input type="checkbox" checked={selection.files} onChange={(event) => setSelection((current) => ({ ...current, files: event.target.checked }))} /> Files ({assetCounts.files})</label>
        <label><input type="checkbox" checked={selection.photos} onChange={(event) => setSelection((current) => ({ ...current, photos: event.target.checked }))} /> Photos ({assetCounts.photos})</label>
        <button className="button secondary" type="button" onClick={() => void downloadAssets()} disabled={!online || assetBusy || (!selection.files && !selection.photos)}>{assetBusy ? 'Downloading…' : 'Download selected'}</button>
        {record.assetSummary?.count ? <button className="button secondary" type="button" onClick={() => void removeAssets()} disabled={assetBusy}>Remove downloads</button> : null}
      </div>
      {progress ? <p>{progress.completed} of {progress.total} processed</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </section>;
}
