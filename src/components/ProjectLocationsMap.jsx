import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function fitVisibleLocations(map, positions) {
  if (!positions.length) return;
  map.fitBounds(positions, {
    padding: [35, 35],
    maxZoom: 13,
  });
}

export default function ProjectLocationsMap({ locations, onOpenProject }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const positionsRef = useRef([]);
  const openProjectRef = useRef(onOpenProject);
  openProjectRef.current = onOpenProject;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([40.1, -74.5], 8);
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);

    maplibreGL({ style: MAP_STYLE }).addTo(map);
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      fitVisibleLocations(map, positionsRef.current);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    const bounds = [];
    const groups = new Map();
    for (const { project, lat, lng, accuracy } of locations) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const position = [lat, lng];
      bounds.push(position);
      const key = `${lat.toFixed(6)}:${lng.toFixed(6)}`;
      const group = groups.get(key) || { position, projects: [], approximate: false };
      group.projects.push(project);
      group.approximate ||= accuracy === 'approximate';
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const marker = L.circleMarker(group.position, {
        radius: group.projects.length > 1 ? 11 : 8,
        color: '#fff',
        weight: 2,
        fillColor: group.approximate ? '#f6a527' : '#12c878',
        fillOpacity: 1,
      }).bindTooltip(() => {
        const label = document.createElement('span');
        label.textContent = `${group.projects.map((project) => project.name).join(', ')}${group.approximate ? ' · approximate street location' : ''}`;
        return label;
      }).addTo(markerLayer);
      if (group.projects.length === 1) marker.on('click', () => openProjectRef.current(group.projects[0]));
      else marker.bindPopup(() => {
        const list = document.createElement('div');
        for (const project of group.projects) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = project.name;
          button.className = 'hub-map-project-link';
          button.addEventListener('click', () => openProjectRef.current(project));
          list.appendChild(button);
        }
        return list;
      });
    }
    positionsRef.current = bounds;
    fitVisibleLocations(map, bounds);
  }, [locations]);

  return <div ref={containerRef} className="hub-location-map" role="img" aria-label="Map of active project locations" />;
}
