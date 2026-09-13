import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { getBoundaries, getLayer, getRecords } from './api.ts';
import { configFor, filterError, unavailableReason, recordsFromFeatures, asText, type EventRecord } from './data.ts';
import { ChartFilters, DatasetSelect, LoadState } from './Controls';
import { useRemote } from './useRemote';
import { SelectionContext, usePanel } from './state';
import { HdwPlayer, HDW_GRID } from './HdwPlayer';
import { MapLegend, acresRadius } from './MapLegend';
import { featuresOnDate } from './weather.ts';
import { ExportActions } from './ExportActions';

export function EventMap() {
  const { settings, update, expanded } = usePanel();
  const { dataset, filters, overlays } = settings;
  const weather = overlays.includes('hdw');
  const weatherDate = weather && settings.weatherDate && settings.weatherDate >= filters.start && settings.weatherDate <= filters.end ? settings.weatherDate : null;
  const selection = useContext(SelectionContext);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [current, setCurrent] = useState<EventRecord | null>(null);
  const [tileError, setTileError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const validation = filterError(filters) || unavailableReason(dataset, filters);
  const result = useRemote(validation ? null : JSON.stringify(['map', dataset, filters, weather]), () => getLayer(dataset, filters, weather));
  const boundaryKinds = overlays.filter(o => o === 'hftd' || o === 'territories');
  const boundaryKey = boundaryKinds.join(',');
  const boundaries = useRemote(boundaryKey ? `boundaries:${boundaryKey}` : null, async () => (await Promise.all(boundaryKinds.map(o => getBoundaries(o as 'hftd' | 'territories')))).flat());
  const shown = useMemo(() => {
    const features = result.data?.geojson.features ?? [];
    return weather ? weatherDate ? featuresOnDate(features, dataset, weatherDate) : [] : features;
  }, [result.data, weather, weatherDate, dataset]);
  useEffect(() => {
    const instance = L.map(host.current!, { preferCanvas: true, scrollWheelZoom: false }).setView([37.6, -120.8], 5);
    map.current = instance;
    setMapInstance(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'base-map-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => setTileError(true)).addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: true, animate: false })); observer.observe(host.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current!;
    const coarsePointer = matchMedia('(pointer: coarse)');
    const updateGestures = () => {
      if (expanded) instance.scrollWheelZoom.enable(); else instance.scrollWheelZoom.disable();
      if (expanded || !coarsePointer.matches) instance.dragging.enable(); else instance.dragging.disable();
      if (expanded) instance.touchZoom.enable(); else instance.touchZoom.disable();
    };
    updateGestures(); coarsePointer.addEventListener('change', updateGestures);
    return () => coarsePointer.removeEventListener('change', updateGestures);
  }, [expanded]);
  useEffect(() => {
    if (weather && mapInstance) mapInstance.fitBounds(L.latLngBounds(HDW_GRID.cells.map(c => [c.lat, c.lon] as [number, number])), { padding: [16,16], animate: false });
  }, [weather, mapInstance]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !boundaries.data || !boundaryKey) return;
    const layer = L.geoJSON(boundaries.data, { interactive: false, style: feature => ({ color: feature?.properties.tier ? '#d97706' : '#9ba9bb', weight: 1, opacity: .65, fillOpacity: feature?.properties.tier === 'Tier 3' ? .2 : feature?.properties.tier ? .1 : .025 }) }).addTo(instance);
    layer.bringToBack();
    return () => { instance.removeLayer(layer); };
  }, [boundaries.data, boundaryKey]);
  useEffect(() => {
    const instance = map.current; setCurrent(null);
    if (!instance || !result.data || validation) return;
    const config = configFor(dataset);
    const featureGroup = L.featureGroup().addTo(instance);
    const clusters = L.markerClusterGroup({ maxClusterRadius: 35, showCoverageOnHover: false, chunkedLoading: true, iconCreateFunction: cluster => L.divIcon({ className: 'event-cluster', html: `<span style="border-color:${config.color}">${cluster.getChildCount()}</span>`, iconSize: [34,34] }) });
    const points: L.Marker[] = [];
    for (const feature of shown) {
      if (!feature.geometry) continue;
      const props = feature.properties;
      const record: EventRecord = dataset === 'epss' ? {
        id: String(props.circuit_id), dataset, name: asText(props.circuit_name) ?? 'Circuit', date: asText(props.first_event) ?? '', county: null, utility: 'PG&E', cause: null, acres: null,
        geometry: feature.geometry, properties: { ...props, circuit_detail: true, scope_start: weatherDate ?? filters.start, scope_end: weatherDate ?? filters.end },
      } : recordsFromFeatures(dataset, [feature])[0];
      const choose = (location: L.LatLng) => { setCurrent(record); selectionRef.current.select({ record, location: [location.lat, location.lng] }); };
      if (feature.geometry.type === 'Point' && dataset !== 'calfire') {
        const [lon, lat] = feature.geometry.coordinates;
        const marker = L.marker([lat, lon], { icon: L.divIcon({ className: 'event-marker', html: `<span style="background:${config.color}"></span>`, iconSize: [12,12] }), title: record.name });
        marker.on('click', () => choose(marker.getLatLng())); points.push(marker);
      } else {
        L.geoJSON(feature, {
          style: { color: dataset === 'calfire' ? '#b91c1c' : config.color, weight: dataset === 'calfire' ? 1 : 2, fillOpacity: .35 },
          pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: acresRadius(f.properties.acres_burned), color: '#b91c1c', fillColor: '#b91c1c', fillOpacity: .35, weight: 1 }),
          onEachFeature: (_f, layer) => { const label = document.createElement('span'); label.textContent = record.name; layer.bindTooltip(label); layer.on('click', (event: L.LeafletMouseEvent) => choose(event.latlng)); },
        }).addTo(featureGroup);
      }
    }
    if (points.length) { clusters.addLayers(points); featureGroup.addLayer(clusters); }
    const bounds = featureGroup.getBounds();
    if (!weather && bounds.isValid()) instance.fitBounds(bounds, { padding: [24, 24], maxZoom: 10, animate: false });
    return () => { instance.removeLayer(featureGroup); };
  }, [result.data, shown, dataset, validation, filters.start, filters.end, weather, weatherDate]);
  const missing = shown.filter(f => !f.geometry).length;
  const error = validation || result.error;
  return <div className="live-map">
    <ExportActions disabled={Boolean(error||result.loading||!shown.length||(weather&&!weatherDate))} rows={async()=>{
      const records=await getRecords(dataset,{...filters,start:weatherDate??filters.start,end:weatherDate??filters.end});
      return records.map(record=>({dataset:configFor(dataset).name,...record.properties}));
    }} />
    <div className="analysis-chart map-toolbar"><div className="map-filter-line"><DatasetSelect value={dataset} onChange={dataset => update({ dataset })} />
      <details className="layer-picker"><summary>Layers</summary><div>{[['hftd','HFTD Tier 2 / 3'],['territories','IOU territories'],['hdw','HDW playback']].map(([id,label]) => <label key={id}><input type="checkbox" checked={overlays.includes(id)} onChange={() => update({ overlays: overlays.includes(id) ? overlays.filter(o => o !== id) : [...overlays,id] })} />{label}</label>)}</div></details>
      <span className="map-count">{result.data && !error ? `${shown.length.toLocaleString()} ${dataset === 'epss' ? 'circuits' : weather ? 'starts' : 'events'}` : ''}</span></div>
      <ChartFilters filters={filters} onChange={filters => update({ filters })} dataset={dataset} />
    </div>
    {weather && <HdwPlayer map={mapInstance} />}
    <div className="map-stage"><div ref={host} className="leaflet-host" aria-label="Wildfire event map" />
      {(error || result.loading || (!weather && result.data && !result.data.meta.total)) && <div className="map-status"><LoadState loading={result.loading} error={error} retry={result.error ? result.retry : undefined} /></div>}
      {(boundaries.error || boundaries.loading || tileError || missing > 0) && <div className="map-warning" role="status">{boundaries.error ? <>Boundary layer unavailable. <button onClick={boundaries.retry}>Retry</button></> : boundaries.loading ? 'Loading boundaries…' : tileError ? 'Basemap unavailable; event geometry is still shown.' : `${missing} records have no geometry.`}</div>}
    </div>
    <MapLegend dataset={dataset} hftd={overlays.includes('hftd')} territories={overlays.includes('territories')} weather={weather} />
    <div className="map-detail"><span>{current ? current.name : weather ? `Event starts: ${weatherDate ?? 'loading'} · HDW daily approximation` : dataset === 'us_ignitions' ? 'IRWIN / FireCastRL sample · not a census' : dataset === 'calfire' ? 'Sizes use reported acreage; missing acres use the smallest circle.' : 'Select an event to inspect its location'}</span>{current && <button className="text-button" onClick={() => selection.inspect(current)}>View details →</button>}</div>
  </div>;
}
