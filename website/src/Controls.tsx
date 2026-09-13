import { useEffect, useId, useRef, useState } from 'react';
import { COUNTIES, DATASETS, UTILITIES, configFor, datasetNote, type DatasetId, type Filters } from './data.ts';
import { getCoverage } from './api.ts';
import { useRemote } from './useRemote';

export function DatasetSelect({ value, onChange, label = 'Dataset', all = true }: { value: DatasetId; onChange: (value: DatasetId) => void; label?: string; all?: boolean }) {
  return <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value as DatasetId)}>{(all ? DATASETS : DATASETS.slice(0, 3)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>;
}
export function ChartFilters({ filters, onChange, dataset }: { filters: Filters; onChange: (filters: Filters) => void; dataset?: DatasetId }) {
  const [open, setOpen] = useState(false);
  return <div className="chart-filter-drawer">
    <button className="filter-trigger" aria-label="Filters" aria-haspopup="dialog" onClick={() => setOpen(true)}><span>Filters</span><span className="filter-summary" title={[filters.start, filters.end, filters.county, filters.utility].filter(Boolean).join(' · ')}>{filters.start} – {filters.end}{filters.county && ` · ${filters.county}`}{filters.utility && ` · ${filters.utility}`}</span></button>
    {open && <FilterDialog filters={filters} onChange={onChange} dataset={dataset} onClose={() => setOpen(false)} />}
  </div>;
}
function FilterDialog({ filters, onChange, dataset, onClose }: { filters: Filters; onChange: (filters: Filters) => void; dataset?: DatasetId; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current!;
    const root = document.documentElement; const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden'; element.showModal();
    return () => { element.close(); root.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="filter-dialog analysis-chart" aria-labelledby={title} onCancel={event => { event.stopPropagation(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div onClick={event => event.stopPropagation()}>
    <header><h2 id={title}>{dataset ? `${configFor(dataset).name} filters` : 'Time series filters'}</h2><button aria-label="Close filters" onClick={onClose}>×</button></header>
    <div className="analysis-filters">
      <label>From<input aria-label="Start date" type="date" value={filters.start} onChange={e => onChange({ ...filters, start: e.target.value })} /></label>
      <label>To<input aria-label="End date" type="date" value={filters.end} onChange={e => onChange({ ...filters, end: e.target.value })} /></label>
      <label>County<select aria-label="County" value={filters.county} onChange={e => onChange({ ...filters, county: e.target.value })}><option value="">All counties</option>{COUNTIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Utility<select aria-label="Utility" value={filters.utility} onChange={e => onChange({ ...filters, utility: e.target.value })}><option value="">All utilities</option>{UTILITIES.map(u => <option key={u}>{u}</option>)}</select></label>
    </div>
    {dataset && <Coverage dataset={dataset} />}
    <button className="quiet-button" onClick={onClose}>Done</button>
  </div></dialog>;
}
function Coverage({ dataset }: { dataset: DatasetId }) {
  const result = useRemote(`coverage:${dataset}`, () => getCoverage(dataset));
  return <p className="panel-note">{result.data ? `Recorded dates: ${result.data.start ?? 'unavailable'} – ${result.data.end ?? 'unavailable'}` : result.error ? 'Date coverage unavailable.' : 'Checking recorded date range…'}</p>;
}
export function LoadState({ loading, error, retry }: { loading?: boolean; error?: string | null; retry?: () => void }) {
  return <div className={`chart-empty ${error ? 'load-error' : ''}`} role="status">{error ? <div><p>{error}</p>{retry && <button className="quiet-button" onClick={retry}>Retry</button>}</div> : loading ? <span className="loading-text">Loading records…</span> : 'No matching records. Try another date range or filter.'}</div>;
}
export function SourceNote({ dataset }: { dataset: DatasetId }) { return <p className="panel-note">{datasetNote(dataset)}</p>; }
function SourceRow({ dataset }: { dataset: DatasetId }) {
  const result = useRemote(`coverage:${dataset}`, () => getCoverage(dataset));
  return <div className="source-row"><strong>{configFor(dataset).name}</strong><span>{result.data ? `${result.data.total.toLocaleString()} dated records · ${result.data.start} – ${result.data.end}` : result.error ?? 'Checking coverage…'}</span></div>;
}
export function DataSources() {
  const [open, setOpen] = useState(false);
  return <footer className="data-sources"><details onToggle={e => setOpen(e.currentTarget.open)}><summary>Data sources & coverage</summary>
    {open && <>{DATASETS.map(d => <SourceRow key={d.id} dataset={d.id} />)}<p>Loaded from the remote wildfire warehouse. These are recorded event dates; last scrape times are not provided by the service.</p><p>CPUC is utility-attributed. CAL FIRE contains posted incidents. National ignitions are an all-cause sample. Their counts should not be added together.</p></>}
  </details></footer>;
}
