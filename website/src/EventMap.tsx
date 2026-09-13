import { useContext, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { getBoundaries, getLayer } from './api.ts';
import { configFor, filterError, unavailableReason, recordsFromFeatures, asText, type EventRecord } from './data.ts';
import { ChartFilters, DatasetSelect, LoadState } from './Controls';
import { useRemote } from './useRemote';
import { SelectionContext, usePanel } from './state';

export function EventMap() {
  const { settings, update } = usePanel();
  const { dataset, filters, overlays } = settings;
  const selection = useContext(SelectionContext);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [current, setCurrent] = useState<EventRecord | null>(null);
  const [tileError, setTileError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const validation = filterError(filters) || unavailableReason(dataset, filters);
  const result = useRemote(validation ? null : JSON.stringify(['map', dataset, filters]), () => getLayer(dataset, filters));
  const boundaries = useRemote(overlays.length ? JSON.stringify(['boundaries', overlays]) : null, async () => (await Promise.all(overlays.map(o => getBoundaries(o as 'hftd' | 'territories')))).flat());
  useEffect(() => {
    const instance = L.map(host.current!, { preferCanvas: true, scrollWheelZoom: false }).setView([37.6, -120.8], 5);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'base-map-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => setTileError(true)).addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false })); observer.observe(host.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !boundaries.data || !overlays.length) return;
    const layer = L.geoJSON(boundaries.data, { interactive: false, style: feature => ({ color: feature?.properties.tier ? '#d97706' : '#9ba9bb', weight: 1, opacity: .65, fillOpacity: feature?.properties.tier === 'Tier 3' ? .2 : feature?.properties.tier ? .1 : .025 }) }).addTo(instance);
    layer.bringToBack();
    return () => { instance.removeLayer(layer); };
  }, [boundaries.data, overlays.length]);
  useEffect(() => {
    const instance = map.current; setCurrent(null);
    if (!instance || !result.data || validation) return;
    const config = configFor(dataset);
    const featureGroup = L.featureGroup().addTo(instance);
    const clusters = L.markerClusterGroup({ maxClusterRadius: 35, showCoverageOnHover: false, chunkedLoading: true, iconCreateFunction: cluster => L.divIcon({ className: 'event-cluster', html: `<span style="border-color:${config.color}">${cluster.getChildCount()}</span>`, iconSize: [34,34] }) });
    const points: L.Marker[] = [];
    for (const feature of result.data.geojson.features) {
      if (!feature.geometry) continue;
      const props = feature.properties;
      const record: EventRecord = dataset === 'epss' ? {
        id: String(props.circuit_id), dataset, name: asText(props.circuit_name) ?? 'Circuit', date: asText(props.first_event) ?? '', county: null, utility: 'PG&E', cause: null, acres: null,
        geometry: feature.geometry, properties: { ...props, circuit_detail: true, scope_start: filters.start, scope_end: filters.end },
      } : recordsFromFeatures(dataset, [feature])[0];
      const choose = (location: L.LatLng) => { setCurrent(record); selectionRef.current.select({ record, location: [location.lat, location.lng] }); };
      if (feature.geometry.type === 'Point' && dataset !== 'calfire') {
        const [lon, lat] = feature.geometry.coordinates;
        const marker = L.marker([lat, lon], { icon: L.divIcon({ className: 'event-marker', html: `<span style="background:${config.color}"></span>`, iconSize: [12,12] }), title: record.name });
        marker.on('click', () => choose(marker.getLatLng())); points.push(marker);
      } else {
        L.geoJSON(feature, {
          style: { color: dataset === 'calfire' ? '#b91c1c' : config.color, weight: dataset === 'calfire' ? 1 : 2, fillOpacity: .35 },
          pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: Math.min(20, 4 + Math.sqrt(Number(f.properties.acres_burned) || 0) * .03), color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: .35, weight: 1 }),
          onEachFeature: (_f, layer) => { const label = document.createElement('span'); label.textContent = record.name; layer.bindTooltip(label); layer.on('click', (event: L.LeafletMouseEvent) => choose(event.latlng)); },
        }).addTo(featureGroup);
      }
    }
    if (points.length) { clusters.addLayers(points); featureGroup.addLayer(clusters); }
    const bounds = featureGroup.getBounds();
    if (bounds.isValid()) instance.fitBounds(bounds, { padding: [24, 24], maxZoom: 10, animate: false });
    return () => { instance.removeLayer(featureGroup); };
  }, [result.data, dataset, validation, filters.start, filters.end]);
  const missing = result.data?.geojson.features.filter(f => !f.geometry).length ?? 0;
  const error = validation || result.error;
  return <div className="live-map">
    <div className="analysis-chart map-toolbar"><div className="map-filter-line"><DatasetSelect value={dataset} onChange={dataset => update({ dataset })} />
      <details className="layer-picker"><summary>Layers</summary><div>{[['hftd','HFTD Tier 2 / 3'],['territories','IOU territories']].map(([id,label]) => <label key={id}><input type="checkbox" checked={overlays.includes(id)} onChange={() => update({ overlays: overlays.includes(id) ? overlays.filter(o => o !== id) : [...overlays,id] })} />{label}</label>)}</div></details>
      <span className="map-count">{result.data && !error ? `${result.data.meta.total.toLocaleString()} ${dataset === 'epss' ? 'circuits' : 'events'}` : ''}</span></div>
      <ChartFilters filters={filters} onChange={filters => update({ filters })} dataset={dataset} />
    </div>
    <div className="map-stage"><div ref={host} className="leaflet-host" aria-label="Wildfire event map" />
      {(error || result.loading || (result.data && !result.data.meta.total)) && <div className="map-status"><LoadState loading={result.loading} error={error} retry={result.error ? result.retry : undefined} /></div>}
      {(boundaries.error || boundaries.loading || tileError || missing > 0) && <div className="map-warning" role="status">{boundaries.error ? <>Boundary layer unavailable. <button onClick={boundaries.retry}>Retry</button></> : boundaries.loading ? 'Loading boundaries…' : tileError ? 'Basemap unavailable; event geometry is still shown.' : `${missing} records have no geometry.`}</div>}
    </div>
    <div className="map-detail"><span>{current ? current.name : dataset === 'us_ignitions' ? 'IRWIN / FireCastRL sample · not a census' : dataset === 'calfire' ? 'Circle size: acres burned · select an incident for details' : 'Select an event to inspect its location'}</span>{current && <button className="text-button" onClick={() => selection.inspect(current)}>View details →</button>}</div>
  </div>;
}
