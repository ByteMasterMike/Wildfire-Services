import { useContext, useEffect, useRef, useState } from 'react';
import { getDetail, getRecords } from './api.ts';
import { configFor, filterError, unavailableReason, type EventRecord } from './data.ts';
import { ChartFilters, DatasetSelect, LoadState } from './Controls';
import { SelectionContext, usePanel } from './state';
import { useRemote } from './useRemote';
import { useRowCapacity } from './useRowCapacity';
import { ExportActions } from './ExportActions';
import { statMetrics } from './stats.ts';

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
  const { settings, update } = usePanel(); const { dataset, filters, answerStat } = settings;
  const validation = filterError(filters) || unavailableReason(dataset, filters);
  const remote = useRemote(validation || answerStat ? null : JSON.stringify(['records', dataset, filters]), () => getRecords(dataset, filters));
  const events = remote.data ?? [];
  const metrics = statMetrics(events, dataset);
  if (answerStat) return <div className="stat-content"><p className="panel-note">{answerStat.scope} · {answerStat.period}</p><div className="stat-value">{(answerStat.unit === 'risk' ? answerStat.value * 100 : answerStat.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{answerStat.unit === 'risk' ? '%' : ''}<span>{answerStat.label}{answerStat.unit === 'percentile' ? ' · percentile' : ''}</span></div><p className="panel-note">From the agent's cited result.</p></div>;
  return <div className="analysis-chart stat-panel"><div className="stat-toolbar"><DatasetSelect hideLabel value={dataset} onChange={dataset => update({ dataset })} /><ChartFilters filters={filters} onChange={filters => update({ filters })} dataset={dataset} /></div>
    <ExportActions disabled={Boolean(validation||remote.error||remote.loading)} rows={()=>metrics.map(metric=>({dataset:configFor(dataset).name,metric:metric.id,value:metric.value,missing_records:metric.missing,unit:metric.unit,...filters}))} />
    {validation || remote.error || remote.loading ? <LoadState loading={remote.loading} error={validation || remote.error} retry={remote.error ? remote.retry : undefined} /> : <dl className="stat-metrics" aria-label={`${configFor(dataset).name} summary`}>
      {metrics.map(metric => <div key={metric.id} className="stat-metric"><dt>{metric.label}{metric.missing > 0 && <span className="stat-missing" title={`${metric.missing} records have no value for this metric`}> · {metric.missing} missing</span>}</dt><dd>{metric.value === null ? '—' : metric.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd></div>)}
    </dl>}
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
