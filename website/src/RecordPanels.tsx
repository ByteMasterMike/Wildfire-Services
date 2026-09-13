import { useContext, useEffect, useRef, useState } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import gridCSV from '../../services/risk_forecasting/data/grid_cells.csv?raw';
import { getBoundaries, getDetail, getRecords } from './api.ts';
import { asText, configFor, filterError, sumMetric, unavailableReason, utilityLabel, type EventRecord } from './data.ts';
import { ChartFilters, DatasetSelect, LoadState } from './Controls';
import { SelectionContext, usePanel } from './state';
import { useRemote } from './useRemote';
import { useRowCapacity } from './useRowCapacity';
import { ExportActions } from './ExportActions';

export function RecordTable() {
  const { settings, update, expanded } = usePanel(); const { dataset, filters } = settings;
  const { inspect } = useContext(SelectionContext);
  const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const validation = filterError(filters) || unavailableReason(dataset, filters);
  const remote = useRemote(validation ? null : JSON.stringify(['records', dataset, filters]), () => getRecords(dataset, filters));
  const events = remote.data ?? [];
  const rows = events.filter(e => [e.name,e.county,e.utility,e.cause,e.id].join(' ').toLowerCase().includes(query.toLowerCase()));
  const capacity = useRowCapacity(viewport, 'tbody tr', rows.length > 0, 'thead');
  const pageSize = expanded ? 25 : capacity;
  const current = Math.min(offset, Math.max(0, rows.length - 1));
  useEffect(() => setOffset(0), [dataset, filters, query]);
  return <div className="analysis-chart records-panel"><div className="record-toolbar"><DatasetSelect hideLabel value={dataset} onChange={dataset => update({ dataset })} /><ChartFilters filters={filters} onChange={filters => update({ filters })} dataset={dataset} /></div>
    <ExportActions disabled={Boolean(validation||remote.error||remote.loading||!rows.length)} rows={()=>rows.map(record=>({dataset:configFor(dataset).name,...record.properties}))} />
    <input className="record-search" aria-label="Filter records" placeholder="Filter by event, county, utility, or cause…" value={query} onChange={e => setQuery(e.target.value)} />
    {validation || remote.error || remote.loading ? <LoadState loading={remote.loading} error={validation || remote.error} retry={remote.error ? remote.retry : undefined} /> : <>
      <div ref={viewport} className="record-scroll"><table><thead><tr><th>Event</th><th>County</th><th>Date</th><th>{dataset === 'calfire' ? 'Acres' : 'Utility'}</th></tr></thead><tbody>{rows.slice(current, current + pageSize).map(e => <tr key={e.id}><td><button className="record-link" onClick={() => inspect(e)}>{e.name}</button></td><td>{e.county ?? '—'}</td><td>{e.date || '—'}</td><td>{dataset === 'calfire' ? e.acres?.toLocaleString() ?? '—' : e.utility ?? '—'}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="panel-note">No matching records.</p>}
      <div className="record-pagination"><span>{rows.length ? `${current + 1}–${Math.min(current + pageSize, rows.length)}` : '0'} of {rows.length.toLocaleString()} records{query && ` (${events.length.toLocaleString()} before search)`}</span><div><button aria-label="Previous page" disabled={current === 0} onClick={() => setOffset(Math.max(0, current - pageSize))}>←</button><button aria-label="Next page" disabled={current + pageSize >= rows.length} onClick={() => setOffset(current + pageSize)}>→</button></div></div>
    </>}
  </div>;
}
export function StatCard() {
  const { settings, update } = usePanel(); const { dataset, filters, metric, answerStat } = settings;
  const validation = filterError(filters) || unavailableReason(dataset, filters)
    || (metric === 'acres' && dataset !== 'calfire' ? 'Burned acreage is available for CAL FIRE only.' : null)
    || (metric === 'customers' && dataset !== 'psps' ? 'Affected customer counts are available for PSPS. EPSS customer-minutes are a different measure.' : null);
  const remote = useRemote(validation || answerStat ? null : JSON.stringify(['records', dataset, filters]), () => getRecords(dataset, filters));
  const events = remote.data ?? [];
  const counties = new Set(events.map(e => e.county).filter(Boolean));
  const total = metric === 'acres' || metric === 'customers' ? sumMetric(events, metric) : { value: metric === 'counties' ? counties.size || (events.length ? null : 0) : events.length, missing: metric === 'counties' ? events.filter(e => !e.county).length : 0 };
  if (answerStat) return <div className="stat-content"><p className="panel-note">{answerStat.scope} · {answerStat.period}</p><div className="stat-value">{(answerStat.unit === 'risk' ? answerStat.value * 100 : answerStat.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{answerStat.unit === 'risk' ? '%' : ''}<span>{answerStat.label}{answerStat.unit === 'percentile' ? ' · percentile' : ''}</span></div><p className="panel-note">From the agent's cited result.</p></div>;
  return <div className="analysis-chart"><div className="comparison-selectors"><DatasetSelect value={dataset} onChange={dataset => update({ dataset, metric: 'events' })} /><label>Metric<select aria-label="Metric" value={metric} onChange={e => update({ metric: e.target.value as typeof metric })}><option value="events">Events</option><option value="acres">Acres</option><option value="counties">Counties</option><option value="customers">Customers affected</option></select></label></div>
    <ExportActions disabled={Boolean(validation||remote.error||remote.loading)} rows={()=>[{dataset:configFor(dataset).name,metric,value:total.value,missing_records:total.missing,unit:metric==='customers'?'customer-event total':metric,...filters}]} />
    <ChartFilters filters={filters} onChange={filters => update({ filters })} dataset={dataset} />
    {validation || remote.error || remote.loading ? <LoadState loading={remote.loading} error={validation || remote.error} retry={remote.error ? remote.retry : undefined} /> : <>
      <div className="stat-value">{total.value === null ? '—' : total.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}<span>{metric === 'customers' ? 'customer-event total' : metric} · {configFor(dataset).name}</span></div>
      {total.missing > 0 && <p className="panel-note">{total.missing} records have no {metric === 'counties' ? 'county' : 'value'}; excluded from this metric.</p>}
    </>}
  </div>;
}
const grid = gridCSV.trim().split(/\r?\n/).slice(1).map(line => { const [id,lat,lon] = line.split(',').map(Number); return { id, lat, lon }; });
export function SpatialContext() {
  const { selected } = useContext(SelectionContext);
  const coords = selected?.location ?? (selected?.record.geometry?.type === 'Point' ? [selected.record.geometry.coordinates[1], selected.record.geometry.coordinates[0]] : null);
  const remote = useRemote(coords ? 'spatial-boundaries' : null, async () => ({ territories: await getBoundaries('territories'), hftd: await getBoundaries('hftd') }));
  if (!selected) return <div className="spatial-content"><p className="chart-empty">Select an event on a map or in a record table to inspect its location.</p></div>;
  const cell = coords ? grid.find(c => coords[0] >= c.lat && coords[0] < c.lat + .24 && coords[1] >= c.lon && coords[1] < c.lon + .24) : null;
  const point = coords ? [coords[1], coords[0]] : null;
  const territories = point && remote.data ? remote.data.territories.filter(f => booleanPointInPolygon(point, f)).map(f => utilityLabel(f.properties.utility)).join(', ') || 'Outside IOU territories' : 'Unresolved';
  const tiers = point && remote.data ? remote.data.hftd.filter(f => booleanPointInPolygon(point, f)).map(f => asText(f.properties.tier)).join(', ') || 'None' : 'Unresolved';
  return <div className="spatial-content"><p className="selected-location">{selected.record.name}</p><dl>{[
    ['Coordinates', coords ? `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}` : 'Select a position on the map'],
    ['IOU territory', territories], ['HFTD', tiers], ['County', selected.record.county ?? 'Not recorded'], ['Grid cell', cell ? String(cell.id) : coords ? 'Outside grid' : 'Unresolved'],
  ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {remote.error && <p className="chart-notice">Spatial boundaries could not be loaded. <button className="text-button" onClick={remote.retry}>Retry</button></p>}
  </div>;
}
export function EventDetail({ record, onClose }: { record: EventRecord; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scope = record.properties.circuit_detail ? { start: String(record.properties.scope_start), end: String(record.properties.scope_end) } : undefined;
  const result = useRemote(JSON.stringify(['detail', record.dataset, record.id, scope]), () => getDetail(record.dataset, record.id, scope));
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const attributes = result.data?.attributes ?? {};
  return <dialog ref={dialog} className="event-dialog" aria-labelledby="event-detail-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div onClick={e => e.stopPropagation()}>
    <header><div><p>{configFor(record.dataset).name} · {scope ? 'Circuit' : 'Event'} detail</p><h2 id="event-detail-title">{record.name}</h2></div><button aria-label="Close event detail" onClick={onClose}>×</button></header>
    {result.loading || result.error ? <LoadState loading={result.loading} error={result.error} retry={result.retry} /> : <dl>{Object.entries(attributes).filter(([key]) => !['geom','geometry'].includes(key)).map(([key,value]) => <div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>}
  </div></dialog>;
}
