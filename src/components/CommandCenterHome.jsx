import React, { Suspense, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { downloadProjectFileFromStorage } from '../services/trackerData.js';
import { getLocalIsoDate } from '../utils/homeView.js';
import FluentIcon from './FluentIcon.jsx';

const ProjectLocationsMap = React.lazy(() => import('./ProjectLocationsMap.jsx'));
const GEOCODE_GAP_MS = 1150;
let lastGeocodeRequestAt = 0;

function waitForGeocodeSlot(signal) {
  const delay = Math.max(0, lastGeocodeRequestAt + GEOCODE_GAP_MS - Date.now());
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException('Geocoding cancelled', 'AbortError'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function geocodeAddress(address, signal) {
  await waitForGeocodeSlot(signal);
  if (signal.aborted) return null;
  lastGeocodeRequestAt = Date.now();
  const params = new URLSearchParams({ q: address, format: 'jsonv2', addressdetails: '1', limit: '1' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
  if (!response.ok) return null;
  const [match] = await response.json();
  const lng = Number(match?.lon);
  const lat = Number(match?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const requestedNumber = address.trim().match(/^\d+/)?.[0] || '';
  const matchedNumber = String(match.address?.house_number || '').trim();
  if (requestedNumber && matchedNumber && requestedNumber !== matchedNumber) return null;
  return { lng, lat, accuracy: requestedNumber && requestedNumber === matchedNumber ? 'exact' : 'approximate' };
}

async function geocodeProjects(projects, signal) {
  const locations = [];
  for (const project of projects.filter((item) => item.address).slice(0, 10)) {
    if (signal.aborted) return [];
    const cacheKey = `project-hub:map:${project.address.trim().toLowerCase()}`;
    let point = null;
    try { point = JSON.parse(window.localStorage.getItem(cacheKey) || 'null'); } catch { /* Geocode below. */ }
    if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) {
      try {
        point = await geocodeAddress(project.address, signal);
        if (!point) continue;
        try { window.localStorage.setItem(cacheKey, JSON.stringify(point)); } catch { /* Cache is optional. */ }
      } catch { continue; }
    }
    locations.push({ project, lng: point.lng, lat: point.lat, accuracy: point.accuracy || 'approximate' });
  }
  return locations;
}

function ProjectThumbnail({ project }) {
  const photo = (project?.photos || []).find((item) => item.id === project.mainPhotoId) || null;
  const [url, setUrl] = useState(photo?.dataUrl || '');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setUrl(photo?.dataUrl || '');
    if (photo?.storageBucket && photo?.storagePath) {
      void downloadProjectFileFromStorage(photo).then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => setUrl(''));
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo?.dataUrl, photo?.id, photo?.storageBucket, photo?.storagePath]);
  return url ? <img src={url} alt="" className={project.mainPhotoCrop ? 'is-cropped' : ''} /> : <span className="hub-project-image-fallback"><FluentIcon name="camera" size={22} /></span>;
}

function toItemLabel(item) {
  return item?.label || item?.name || item?.subcode || item?.inspectionType || 'Scheduled work';
}

function stepIsComplete(step) {
  return step.done || ['done', 'complete', 'completed'].includes(String(step.status || '').toLowerCase());
}

function stepIsCurrent(step, todayIso) {
  if (stepIsComplete(step)) return false;
  const status = String(step.status || '').toLowerCase();
  return status === 'active' || status === 'in progress' || status === 'in_progress'
    || (step.start && step.start <= todayIso && (step.end ? todayIso <= step.end : step.start === todayIso));
}

export default function CommandCenterHome({ projects, projectHealth, openTasks, attention, todaySummary, nextSevenSummary, changes, onOpenItem, onOpenCollection }) {
  const [mapLocations, setMapLocations] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [locationView, setLocationView] = useState(() => {
    try { return window.localStorage.getItem('project-hub:location-view') === 'list' ? 'list' : 'map'; }
    catch { return 'map'; }
  });
  const [timelineProjectId, setTimelineProjectId] = useState('');
  const timelineScrollRef = useRef(null);
  const addressSignature = projects.map((project) => `${project.id}:${project.address || ''}`).join('|');
  useEffect(() => {
    try { window.localStorage.setItem('project-hub:location-view', locationView); } catch { /* Preference is optional. */ }
  }, [locationView]);
  useEffect(() => {
    if (locationView !== 'map') return undefined;
    const controller = new AbortController();
    setMapLoading(true);
    void geocodeProjects(projects, controller.signal).then((locations) => {
      if (!controller.signal.aborted) setMapLocations(locations);
    }).finally(() => { if (!controller.signal.aborted) setMapLoading(false); });
    return () => controller.abort();
  }, [addressSignature, locationView]);
  const mapLocationByProjectId = useMemo(() => new Map(mapLocations.map((location) => [location.project.id, location])), [mapLocations]);
  const mapNote = mapLoading ? 'Locating project addresses…'
    : mapLocations.some((location) => location.accuracy === 'approximate') ? 'Orange pins show approximate street locations'
      : projects.some((project) => project.address) && !mapLocations.length ? 'No project locations found' : '';
  const featuredProject = projects.find((project) => project.id === timelineProjectId) || projects[0] || null;
  const todayIso = getLocalIsoDate();
  const milestones = useMemo(() => (featuredProject?.phases || []).flatMap((phase) => (phase.steps || []).map((step) => ({ ...step, phaseName: phase.name }))), [featuredProject]);
  const healthByProjectId = useMemo(() => new Map(projectHealth.map(({ project, health }) => [project.id, health])), [projectHealth]);
  useLayoutEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller || !milestones.length) return;
    const currentIndices = milestones.flatMap((step, index) => stepIsCurrent(step, todayIso) ? [index] : []);
    const nextIndex = milestones.findIndex((step) => !stepIsComplete(step));
    const focusIndex = currentIndices.length
      ? currentIndices[Math.floor(currentIndices.length / 2)]
      : nextIndex >= 0 ? nextIndex : milestones.length - 1;
    const target = scroller.children[focusIndex];
    if (target) scroller.scrollLeft = Math.max(0, target.offsetLeft + target.offsetWidth / 2 - scroller.clientWidth / 2);
  }, [featuredProject?.id, milestones, todayIso]);
  const focusItems = [...(todaySummary.inspections || []), ...(todaySummary.openTasks || []), ...(todaySummary.scheduleItems || [])].slice(0, 5);
  const recentEntries = [...(changes.today || []), ...(changes.yesterday || [])].slice(0, 4);
  const recentFiles = projects.flatMap((project) => (project.files?.folders || []).flatMap((folder) => (folder.files || []).map((file) => ({ ...file, project })))).slice(0, 4);
  const upcomingInspections = (todaySummary.inspections?.length || 0) + (nextSevenSummary.inspections?.length || 0);
  const attentionCount = (attention.overdueTasks?.length || 0) + (attention.overdueInspections?.length || 0) + (attention.blockedSteps?.length || 0);

  return (
    <div className="hub-dashboard">
      <div className="hub-stats" aria-label="Project Hub summary">
        <div className="hub-stat"><span className="hub-stat-icon"><FluentIcon name="folder" size={29} /></span><div><small>Active projects</small><strong>{projects.length}</strong></div></div>
        <div className="hub-stat"><span className="hub-stat-icon teal"><FluentIcon name="checkCircle" size={29} /></span><div><small>Open tasks</small><strong>{openTasks.length}</strong></div></div>
        <div className="hub-stat"><span className="hub-stat-icon"><FluentIcon name="document" size={29} /></span><div><small>Next 7 days · inspections</small><strong>{upcomingInspections}</strong></div></div>
        <div className="hub-stat"><span className="hub-stat-icon orange"><FluentIcon name="warning" size={29} /></span><div><small>Needs attention</small><strong>{attentionCount}</strong></div></div>
      </div>

      <div className="hub-primary-grid">
        <section className="hub-panel hub-locations">
          <header>
            <h2>Project locations</h2>
            <div className="hub-location-header-actions">
              <span>{projects.length} active</span>
              <div className="hub-location-view-switch" role="group" aria-label="Project locations view">
                <button type="button" aria-pressed={locationView === 'map'} onClick={() => setLocationView('map')}>Map</button>
                <button type="button" aria-pressed={locationView === 'list'} onClick={() => setLocationView('list')}>List</button>
              </div>
            </div>
          </header>
          <div className={`hub-location-body is-${locationView}-view`}>
            {locationView === 'map' ? (
              <>
                <Suspense fallback={<div className="hub-location-art" aria-hidden="true" />}>
                  <ProjectLocationsMap locations={mapLocations} onOpenProject={(project) => onOpenItem({ ...project, type: 'project' })} />
                </Suspense>
                {mapNote ? <span className="hub-map-note" role="status">{mapNote}</span> : null}
              </>
            ) : (
              <div className="hub-location-list">
                {projects.length ? projects.map((project) => (
                  <button type="button" key={project.id} onClick={() => onOpenItem({ ...project, type: 'project' })}>
                    <span className={`hub-location-dot${mapLocationByProjectId.get(project.id)?.accuracy === 'approximate' ? ' is-approximate' : ''}`} />
                    <span><strong>{project.name}</strong><small>{project.address || 'Address not entered'}</small></span>
                    <FluentIcon name="chevronRight" size={16} />
                  </button>
                )) : <p>No active projects are available.</p>}
              </div>
            )}
          </div>
        </section>
        <section className="hub-panel hub-portfolio"><header><h2>Active projects</h2><button type="button" onClick={() => onOpenCollection('projects')}>View all →</button></header><div className="hub-portfolio-list">{projects.length ? projects.map((project) => { const health = healthByProjectId.get(project.id); return <button type="button" className="hub-portfolio-row" key={project.id} onClick={() => onOpenItem({ ...project, type: 'project' })}><ProjectThumbnail project={project} /><span><strong>{project.name}</strong><small>{project.address || project.customerName || 'Project details'}</small>{health ? <span className={`hub-project-health tone-${health.tone}`}>{health.label}</span> : null}</span><FluentIcon name="chevronRight" size={16} /></button>; }) : <p className="hub-empty">No active projects.</p>}</div></section>
        <section className="hub-panel hub-focus"><header><h2>Today's focus</h2><button type="button" onClick={() => onOpenCollection('schedule')}>View schedule →</button></header><div className="hub-focus-list">{focusItems.length ? focusItems.map((item, index) => <button type="button" key={`${item.type}-${item.id || index}`} onClick={() => onOpenItem(item)}><i /><span><strong>{toItemLabel(item)}</strong><small>{item.projectName || 'General'}</small></span></button>) : <p className="hub-empty">No work scheduled for today.</p>}</div></section>
      </div>

      <section className="hub-panel hub-timeline"><header><h2>Construction timeline</h2><div className="hub-timeline-actions"><label htmlFor="hub-timeline-project">Project</label><select id="hub-timeline-project" value={featuredProject?.id || ''} onChange={(event) => setTimelineProjectId(event.target.value)} disabled={!projects.length}>{projects.length ? projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">No active projects</option>}</select><button type="button" disabled={!featuredProject} onClick={() => featuredProject && onOpenItem({ ...featuredProject, type: 'project', detailTab: 'calendar' })}>View schedule →</button></div></header>{milestones.length ? <div className="hub-milestones" ref={timelineScrollRef} aria-label={`${featuredProject.name} construction timeline`} tabIndex={0}>{milestones.map((step, index) => { const complete = stepIsComplete(step); const current = stepIsCurrent(step, todayIso); return <button type="button" className={current ? 'current' : ''} key={step.id || index} onClick={() => onOpenItem({ ...featuredProject, type: 'project', detailTab: 'calendar' })}><i className={complete ? 'complete' : current ? 'current' : ''}>{complete ? '✓' : index + 1}</i><strong title={step.name || 'Step'}>{step.name || 'Step'}</strong><small>{complete ? 'Complete' : current ? 'Active' : step.status || 'Upcoming'}</small></button>; })}</div> : <p className="hub-empty">{featuredProject ? `No schedule steps yet for ${featuredProject.name}.` : 'Select an active project to see its timeline.'}</p>}</section>

      <div className="hub-bottom-grid">
        <section className="hub-panel hub-operations"><header><h2>Field operations</h2></header><div className="hub-operation-grid"><button type="button" onClick={() => onOpenCollection('tasks')}><FluentIcon name="checkCircle" /><strong>{openTasks.length}</strong><span>Open tasks</span></button><button type="button" onClick={() => onOpenCollection('inspections')}><FluentIcon name="document" /><strong>{upcomingInspections}</strong><span>Upcoming inspections</span></button><button type="button" onClick={() => onOpenCollection('schedule')}><FluentIcon name="warning" /><strong>{attention.blockedSteps?.length || 0}</strong><span>Blocked steps</span></button></div></section>
        <section className="hub-panel hub-activity"><header><h2>Recent activity</h2></header>{recentEntries.length ? recentEntries.map((entry) => <div className="hub-activity-row" key={entry.id}><span className="hub-activity-marker" /><span><strong>{entry.entityName || entry.label || 'Project update'}</strong><small>{entry.label || entry.category || 'Activity'}</small></span></div>) : <p className="hub-empty">No recent changes.</p>}</section>
        <section className="hub-panel hub-documents"><header><h2>Project documents</h2></header>{recentFiles.length ? recentFiles.map((file, index) => <button type="button" key={`${file.project.id}-${file.id || index}`} onClick={() => onOpenItem({ ...file.project, type: 'project', detailTab: 'files' })}><FluentIcon name="document" /><span><strong>{file.name || file.originalName || 'Document'}</strong><small>{file.project.name}</small></span></button>) : <p className="hub-empty">No project documents yet.</p>}</section>
      </div>
    </div>
  );
}
