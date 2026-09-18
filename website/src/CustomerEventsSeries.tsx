import { useRef, useState } from 'react';
import { getRecords, getSummary } from './api.ts';
import { ChartFilters, LoadState } from './Controls';
import { customerEventsOverTime } from './customerEvents.ts';
import { ExportActions } from './ExportActions';
import { lineSvg } from './exports.ts';
import { usePanel } from './state';
import { TemporalPlot } from './TemporalPlot';
import { useRemote } from './useRemote';

export function CustomerEventsSeries() {
  const {settings, update, title} = usePanel();
  const {filters, interval} = settings;
  const plot = useRef<HTMLDivElement>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const remote = useRemote(JSON.stringify(['customer-events-series', filters, interval]), async () => {
    const [events, summary] = await Promise.all([
      getRecords('psps', filters),
      getSummary('psps', filters),
    ]);
    const result = customerEventsOverTime(events, filters.start, filters.end, interval);
    const eventTotal = summary.find(metric => metric.id === 'events')?.value;
    const customerTotal = summary.find(metric => metric.id === 'customers')?.value;
    if (eventTotal !== events.length || customerTotal !== result.total) {
      throw new Error('Customer-event series does not match the server summary.');
    }
    return {...result, eventTotal};
  });
  const buckets = remote.data?.buckets ?? [];
  const values = buckets.map(bucket => bucket.count);
  const ceiling = Math.max(1, ...values);
  const active = inspected === null ? null : buckets[inspected];
  const caption = `PSPS; ${filters.start} – ${filters.end}; ${interval} customer-event totals. Customers may recur across events.`;
  return <div className="analysis-chart seasonal-panel">
    <ExportActions datasets={['psps']} disabled={Boolean(remote.error||remote.loading||!buckets.length)}
      rows={()=>buckets.map(bucket=>({dataset:'PSPS',period_start:bucket.start,period_end:bucket.end,customer_events:bucket.count,utility:filters.utility}))}
      svg={()=>{const svg=plot.current?.querySelector('svg');if(!svg)throw new Error('Chart is not ready.');return lineSvg(svg,title,caption,[{label:'Customer-event total',color:'#7caef1'}]);}}/>
    <div className="analysis-heading series-toolbar"><label>Interval<select aria-label="Time interval" value={interval} onChange={event=>{update({interval:event.target.value as typeof interval});setInspected(null);}}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label></div>
    <ChartFilters filters={filters} dataset="psps" onChange={filters=>{update({filters});setInspected(null);}}/>
    <p className="panel-note">Observed PSPS customer-event totals; customers may recur across events and are not deduplicated.</p>
    <div ref={plot} className="seasonal-plot">{remote.data
      ? <TemporalPlot values={values} labels={buckets.map(bucket=>bucket.start)} ceiling={ceiling} unit="Customer-events" onInspect={setInspected}/>
      : <LoadState loading={remote.loading} error={remote.error} retry={remote.error?remote.retry:undefined}/>}</div>
    {remote.data && <div className="series-readout seasonal-readout" aria-live="polite"><span>{active ? `${active.start} – ${active.end}` : `${filters.start} – ${filters.end}`}</span><div><strong>{(active?.count ?? remote.data.total).toLocaleString()} customer-events</strong><span>{remote.data.eventTotal.toLocaleString()} PSPS events · {remote.data.missing.toLocaleString()} missing customer counts</span></div></div>}
  </div>;
}
