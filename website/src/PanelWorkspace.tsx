import { useRef, useState } from 'react';
import { panelTitle, type PanelId, type PanelInstance } from './PanelPicker';
import { PanelContext, type PanelSettings } from './state';
import { TimeSeries, Comparison } from './AnalysisCharts';
import { EventMap } from './EventMap';
import { RecordTable, StatCard, SpatialContext } from './RecordPanels';

const CONTENT: Record<PanelId, () => React.JSX.Element> = { map: EventMap, time_series: TimeSeries, comparison: Comparison, record_table: RecordTable, stat_card: StatCard, spatial_context: SpatialContext };
function PanelTitle({ panel, onRename }: { panel: PanelInstance; onRename: (id: number, name: string) => void }) {
  const title = panelTitle(panel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);
  const titleButton = useRef<HTMLButtonElement>(null);
  const save = () => { if (!cancelled.current && draft.trim()) onRename(panel.id, draft.trim()); setEditing(false); };
  return <h2 id={`panel-title-${panel.id}`} className="panel-title" aria-label={title}>
    {editing ? <input autoFocus aria-label="Panel name" value={draft} onFocus={e => e.currentTarget.select()} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); cancelled.current = e.key === 'Escape'; e.currentTarget.blur(); requestAnimationFrame(() => titleButton.current?.focus({ preventScroll: true })); }
    }} /> : <button ref={titleButton} type="button" className="panel-title-button" title="Click to rename" aria-label={`Rename ${title}`} onClick={() => { setDraft(title); cancelled.current = false; setEditing(true); }}>{title}</button>}
  </h2>;
}
export function PanelWorkspace({ panels, activeId, onRemove, onRename, onUpdate }: {
  panels: PanelInstance[]; activeId: number | null; onRemove: (id: number) => void;
  onRename: (id: number, name: string) => void; onUpdate: (id: number, patch: Partial<PanelSettings>) => void;
}) {
  if (!panels.length) return null;
  return <section className="panel-workspace" aria-label="Panel workspace"><header className="workspace-heading"><h1>Your workspace <span>{panels.length} panels</span></h1><span className="warehouse-label">Remote warehouse</span></header>
    <div className="panel-grid">{panels.map(panel => {
      const Content = CONTENT[panel.type];
      return <article key={panel.id} id={`panel-${panel.id}`} tabIndex={-1} aria-labelledby={`panel-title-${panel.id}`} data-panel-type={panel.type} className={`workspace-panel ${activeId === panel.id ? 'is-active' : ''}`}>
        <header className="panel-header"><PanelTitle panel={panel} onRename={onRename} /><button className="panel-close" aria-label={`Close ${panelTitle(panel)}`} onClick={() => onRemove(panel.id)}>×</button></header>
        <div className="panel-body" role="region" aria-label={`${panelTitle(panel)} content`} tabIndex={0}><PanelContext.Provider value={{ settings: panel.settings, update: patch => onUpdate(panel.id, patch) }}><Content /></PanelContext.Provider></div>
      </article>;
    })}</div>
  </section>;
}
