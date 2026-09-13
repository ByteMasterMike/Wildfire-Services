import { useRef, useState } from "react";
import { panelTitle, type PanelId, type PanelInstance } from "./PanelPicker";
import { DemoSeries, DemoComparison } from "./AnalysisCharts";

const EVENTS = [
  { name: "Foothill", county: "Placer", utility: "PG&E", acres: 18, date: "2024-06-12", x: 172, y: 105 },
  { name: "Creek", county: "Sacramento", utility: "PG&E", acres: 7, date: "2024-07-03", x: 154, y: 135 },
  { name: "Ridge", county: "Fresno", utility: "PG&E", acres: 42, date: "2024-08-18", x: 215, y: 185 },
  { name: "Valley", county: "Kern", utility: "SCE", acres: 11, date: "2024-09-02", x: 233, y: 219 },
  { name: "Canyon", county: "Riverside", utility: "SCE", acres: 24, date: "2024-09-15", x: 291, y: 254 },
  { name: "Mesa", county: "San Diego", utility: "SDG&E", acres: 5, date: "2024-10-04", x: 292, y: 288 },
];
function DemoMap() {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(1);
  return <div className="demo-map">
    <div className="map-controls"><button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => value - .25)}>−</button><button aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(value => value + .25)}>+</button></div>
    <svg viewBox="0 0 400 330" aria-label="California event map">
      <rect width="400" height="330" fill="#19272c" />
      <g stroke="#ffffff08">{[50, 100, 150, 200, 250, 300, 350].map(x => <path key={x} d={`M${x} 0v330M0 ${x}h400`} />)}</g>
      <g transform={`translate(200 165) scale(${zoom}) translate(-200 -165)`}>
        <path d="M100 24L192 24L192 106L322 255L306 299L255 295L223 260L193 246L186 222L160 203L154 176L133 158L128 127L107 99L110 66Z" fill="#34433e" stroke="#7d9484" strokeWidth="1.5" />
        <path d="M140 35L153 112L184 171L240 243L290 281" fill="none" stroke="#a5b69b" strokeDasharray="4 5" opacity=".3" />
        {EVENTS.map((event, index) => <g key={event.name}><circle cx={event.x} cy={event.y} r={selected === index ? 11 : 6} fill={selected === index ? "#b1d2ff" : "#efad73"} opacity=".85" /><title>{event.name}: {event.acres} acres</title></g>)}
      </g>
      <text x="30" y="260" fill="#718c99" fontSize="11" transform="rotate(-35 30 260)">PACIFIC OCEAN</text>
    </svg>
    <div className="map-detail"><label>Event <select aria-label="Map event" value={selected} onChange={event => setSelected(Number(event.target.value))}>{EVENTS.map((event, i) => <option key={event.name} value={i}>{event.name}</option>)}</select></label><span>{EVENTS[selected].county} · {EVENTS[selected].acres} acres</span></div>
  </div>;
}

function DemoRecords() {
  const [query, setQuery] = useState("");
  const rows = EVENTS.filter(event => `${event.name} ${event.county} ${event.utility}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="records-content"><input className="record-search" aria-label="Filter records" placeholder="Filter by event, county, or utility…" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="record-scroll"><table><thead><tr><th>Event</th><th>County</th><th>Date</th><th>Acres</th></tr></thead><tbody>{rows.map(event => <tr key={event.name}><td>{event.name}</td><td>{event.county}</td><td>{event.date}</td><td>{event.acres}</td></tr>)}</tbody></table>{!rows.length && <p className="panel-note">No matching records.</p>}</div>
    <p className="panel-note">{rows.length} of {EVENTS.length} records</p></div>;
}

function DemoStat() {
  const [metric, setMetric] = useState("Events");
  return <div className="stat-content"><label className="panel-filter">Event records <select aria-label="Metric" value={metric} onChange={event => setMetric(event.target.value)}><option>Events</option><option>Acres</option><option>Counties</option></select></label>
    <div className="stat-value">{metric === "Acres" ? EVENTS.reduce((sum, event) => sum + event.acres, 0) : EVENTS.length}<span>{metric.toLowerCase()}</span></div>
    </div>;
}

function DemoSpatial() {
  const [place, setPlace] = useState("Sacramento");
  const sacramento = place === "Sacramento";
  return <div className="spatial-content"><label className="panel-filter">Location <select aria-label="Spatial location" value={place} onChange={event => setPlace(event.target.value)}><option>Sacramento</option><option>San Diego</option></select></label>
    <dl>{[["Coordinates", sacramento ? "38.58, −121.49" : "32.72, −117.16"], ["Utility", sacramento ? "PG&E" : "SDG&E"], ["HFTD", "Unresolved"], ["County", place], ["Grid cell", sacramento ? "042" : "108"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>;
}

const CONTENT: Record<PanelId, () => React.JSX.Element> = { map: DemoMap, time_series: DemoSeries, comparison: DemoComparison, record_table: DemoRecords, stat_card: DemoStat, spatial_context: DemoSpatial };

function PanelTitle({ panel, onRename }: { panel: PanelInstance; onRename: (id: number, name: string) => void }) {
  const title = panelTitle(panel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);
  const titleButton = useRef<HTMLButtonElement>(null);
  const save = () => {
    if (!cancelled.current && draft.trim()) onRename(panel.id, draft.trim());
    setEditing(false);
  };

  return <h2 id={`panel-title-${panel.id}`} className="panel-title" aria-label={title}>
    {editing ? <input autoFocus aria-label="Panel name" value={draft}
      onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)}
      onBlur={save} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          cancelled.current = event.key === "Escape";
          event.currentTarget.blur();
          requestAnimationFrame(() => titleButton.current?.focus({ preventScroll: true }));
        }
      }} /> : <button ref={titleButton} type="button" className="panel-title-button" title="Click to rename" aria-label={`Rename ${title}`}
        onClick={() => { setDraft(title); cancelled.current = false; setEditing(true); }}>{title}</button>}
  </h2>;
}

export function PanelWorkspace({ panels, activeId, onRemove, onRename }: { panels: PanelInstance[]; activeId: number | null; onRemove: (id: number) => void; onRename: (id: number, name: string) => void }) {
  if (!panels.length) return null;
  return <section className="panel-workspace" aria-label="Panel workspace">
    <header className="workspace-heading"><h1>Your workspace <span>{panels.length} panels</span></h1></header>
    <div className="panel-grid">
      {panels.map(panel => {
        const Content = CONTENT[panel.type];
        return <article key={panel.id} id={`panel-${panel.id}`} tabIndex={-1} aria-labelledby={`panel-title-${panel.id}`}
          data-panel-type={panel.type} className={`workspace-panel ${activeId === panel.id ? "is-active" : ""}`}>
          <header className="panel-header"><PanelTitle panel={panel} onRename={onRename} /><button className="panel-close" aria-label={`Close ${panelTitle(panel)}`} onClick={() => onRemove(panel.id)}>×</button></header>
          <div className="panel-body" role="region" aria-label={`${panelTitle(panel)} content`} tabIndex={0}><Content /></div>
        </article>;
      })}
    </div>
  </section>;
}
