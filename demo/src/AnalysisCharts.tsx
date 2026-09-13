import { useEffect, useRef, useState } from "react";
import {
  COUNTIES, DATASETS, DATE_RANGE, DEFAULT_FILTERS, UTILITIES, countSeries, filteredEvents,
  filterError, groupedCounts, timeBuckets, unavailableReason,
  type DatasetId, type Filters, type GroupBy, type Interval,
} from "./analysisData";

function ChartFilters({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  return <details className="chart-filter-drawer">
    <summary aria-label="Filters"><span>Filters</span><span className="filter-summary" title={[filters.start, filters.end, filters.county, filters.utility].filter(Boolean).join(' · ')}>{filters.start} – {filters.end}{filters.county && ` · ${filters.county}`}{filters.utility && ` · ${filters.utility}`}</span></summary>
    <div className="analysis-filters">
    <label>From<input aria-label="Start date" type="date" min={DATE_RANGE?.start} max={DATE_RANGE?.end} disabled={!DATE_RANGE} value={filters.start} onChange={event => onChange({ ...filters, start: event.target.value })} /></label>
    <label>To<input aria-label="End date" type="date" min={DATE_RANGE?.start} max={DATE_RANGE?.end} disabled={!DATE_RANGE} value={filters.end} onChange={event => onChange({ ...filters, end: event.target.value })} /></label>
    <label>County<select aria-label="County" value={filters.county} onChange={event => onChange({ ...filters, county: event.target.value })}><option value="">All counties</option>{COUNTIES.map(county => <option key={county}>{county}</option>)}</select></label>
    <label>Utility<select aria-label="Utility" value={filters.utility} onChange={event => onChange({ ...filters, utility: event.target.value })}><option value="">All utilities</option>{UTILITIES.map(utility => <option key={utility}>{utility}</option>)}</select></label>
    </div>
  </details>;
}

export function DemoSeries() {
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [interval, setInterval] = useState<Interval>("monthly");
  const [selected, setSelected] = useState<DatasetId[]>(["cpuc", "epss", "calfire"]);
  const [hovered, setHovered] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(540);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(plot.current!);
    return () => observer.disconnect();
  }, []);

  const error = filterError(filters);
  const buckets = error ? [] : timeBuckets(filters, interval);
  const series = DATASETS.filter(dataset => selected.includes(dataset.id)).map(dataset => {
    const events = filteredEvents(dataset.id, filters);
    return { ...dataset, total: events.length, values: countSeries(events, buckets, interval), reason: unavailableReason(dataset.id, filters) };
  });
  const visible = series.filter(dataset => !dataset.reason);
  const max = Math.max(4, ...visible.flatMap(dataset => dataset.values));
  const ceiling = Math.ceil(max / 4) * 4;
  const left = 36, right = width - 16, top = 28, bottom = 210;
  const x = (index: number) => buckets.length <= 1 ? (left + right) / 2 : left + index / (buckets.length - 1) * (right - left);
  const y = (value: number) => bottom - value / ceiling * (bottom - top);
  const tickIndices = [...new Set(Array.from({ length: Math.min(5, buckets.length) }, (_, i) => Math.round(i * (buckets.length - 1) / Math.max(1, Math.min(5, buckets.length) - 1))))];
  const activeIndex = hovered === null || !buckets.length ? null : Math.min(hovered, buckets.length - 1);
  const empty = error || (!selected.length ? "Select at least one dataset to show a line." : !visible.length ? "No data is available for the selected datasets and utility." : null);

  return <div className="analysis-chart">
    <div className="analysis-heading series-toolbar">
    <div className="dataset-switches" role="group" aria-label="Visible datasets">
      {DATASETS.map(dataset => <button key={dataset.id} type="button" role="checkbox" aria-checked={selected.includes(dataset.id)} aria-label={dataset.name}
        title={dataset.description} onClick={() => setSelected(current => current.includes(dataset.id) ? current.filter(id => id !== dataset.id) : [...current, dataset.id])}>
        <span className="dataset-swatch" style={{ background: dataset.color }} />{dataset.name}
        <span aria-hidden="true" className="dataset-check">{selected.includes(dataset.id) ? "✓" : "−"}</span>
      </button>)}
    </div>
    <label>Interval<select aria-label="Time interval" value={interval} onChange={event => { setInterval(event.target.value as Interval); setHovered(null); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
    </div>
    <ChartFilters filters={filters} onChange={next => { setFilters(next); setHovered(null); }} />
    <div ref={plot} className="series-plot">
      {empty ? <p className="chart-empty" role="status">{empty}</p> : <svg viewBox={`0 0 ${width} 246`} role="img" tabIndex={0}
        aria-label={`${interval} event counts. Use left and right arrows to inspect periods.`}
        onMouseLeave={() => setHovered(null)} onMouseMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - bounds.left) / bounds.width * width;
          setHovered(Math.max(0, Math.min(buckets.length - 1, Math.round((position - left) / (right - left) * (buckets.length - 1)))));
        }} onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setHovered(Math.max(0, Math.min(buckets.length - 1, (activeIndex ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
          }
        }}>
        <text x={left} y="13">Events</text>
        {[0, 1, 2, 3, 4].map(i => <g key={i}><path d={`M${left} ${y(ceiling * i / 4)}H${right}`} stroke="#ffffff12" /><text x={left - 9} y={y(ceiling * i / 4) + 4} textAnchor="end">{ceiling * i / 4}</text></g>)}
        {tickIndices.map(index => <text key={index} x={x(index)} y="235" textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}>{filters.start.slice(0, 4) === filters.end.slice(0, 4) ? buckets[index].start.slice(5) : buckets[index].start.slice(0, 7)}</text>)}
        {visible.map(dataset => <g key={dataset.id}>
          <polyline points={dataset.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} fill="none" stroke={dataset.color} strokeWidth="2" strokeLinejoin="round" />
          {dataset.values.length <= 24 && dataset.values.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r="3" fill={dataset.color}><title>{dataset.name}: {buckets[index].start} – {buckets[index].end}: {value} events</title></circle>)}
        </g>)}
        {activeIndex !== null && <g><path d={`M${x(activeIndex)} ${top}V${bottom}`} stroke="#ffffff45" strokeDasharray="3 4" />{visible.map(dataset => <circle key={dataset.id} cx={x(activeIndex)} cy={y(dataset.values[activeIndex])} r="4" fill={dataset.color} stroke="#222" strokeWidth="2" />)}</g>}
      </svg>}
    </div>
    {!empty && <div className="series-readout" aria-live="polite"><span>{activeIndex === null ? "Selected period" : `${buckets[activeIndex].start} – ${buckets[activeIndex].end}`}</span><div>{visible.map(dataset => <span key={dataset.id} style={{ color: dataset.color }}>{dataset.name} <strong>{activeIndex === null ? dataset.total : dataset.values[activeIndex]}</strong></span>)}</div></div>}
    {series.filter(dataset => dataset.reason).map(dataset => <p key={dataset.id} className="chart-notice" role="status">{dataset.reason}</p>)}
  </div>;
}

export function DemoComparison() {
  const [dataset, setDataset] = useState<DatasetId>("epss");
  const [groupBy, setGroupBy] = useState<GroupBy>("cause");
  const [measure, setMeasure] = useState<"count" | "share">("count");
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const config = DATASETS.find(item => item.id === dataset)!;
  const events = filteredEvents(dataset, filters);
  const error = filterError(filters) || unavailableReason(dataset, filters)
    || (groupBy === "cause" && !config.hasCause ? `Cause data is not available for ${config.name}. Choose Utility or County.` : null);
  const rows = error ? [] : groupedCounts(events, dataset, groupBy, filters);
  const max = Math.max(1, ...rows.map(row => row.value ?? 0));
  return <div className="analysis-chart">
    <div className="comparison-toolbar">
    <div className="comparison-selectors">
      <label>Dataset<select aria-label="Comparison dataset" value={dataset} onChange={event => setDataset(event.target.value as DatasetId)}>{DATASETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Group by<select aria-label="Group by" value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}><option value="cause">Cause</option><option value="utility">Utility</option><option value="county">County</option></select></label>
    </div>
    <div className="measure-switch" role="group" aria-label="Bar values"><button aria-pressed={measure === "count"} onClick={() => setMeasure("count")}>Count</button><button aria-pressed={measure === "share"} onClick={() => setMeasure("share")}>Share %</button></div>
    </div>
    <ChartFilters filters={filters} onChange={setFilters} />
    {error || !events.length ? <p className="chart-empty" role="status">{error || "No matching records. Try a wider date range or another filter."}</p> : <>
      <div className="bar-summary"><span>{config.name} · {events.length} events</span><span>{measure === "count" ? "Event count" : "% of selected records"}</span></div>
      <div className="analysis-bars" role="list" aria-label="Grouped event counts">
        {rows.map(row => {
          const share = (row.value ?? 0) / events.length * 100;
          return <div key={row.key} className="analysis-bar-row" role="listitem">
            <span className="bar-label" title={row.key}>{row.key}</span>
            <div className="bar-track">{row.value === null ? <span className="missing-bar" title="EPSS is PG&E-only">No data</span> : <div className="value-bar" style={{ background: row.key === "Not recorded" ? "#777" : config.color, width: `${measure === "count" ? row.value / max * 100 : share}%` }} />}</div>
            <span className="bar-value">{row.value === null ? "—" : <><strong>{measure === "count" ? row.value : `${share.toFixed(1)}%`}</strong><small>{measure === "count" ? `${share.toFixed(1)}%` : `${row.value} events`}</small></>}</span>
          </div>;
        })}
      </div>
      {groupBy === "cause" && <p className="panel-note">Unknown is a recorded cause category; Not recorded is a missing value. Both count toward the percentage total.</p>}
      {dataset === "epss" && groupBy === "utility" && <p className="chart-notice">EPSS is PG&E-only. Other utilities are unavailable, not zero.</p>}
    </>}
  </div>;
}
