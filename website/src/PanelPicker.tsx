import { useEffect, useRef, useState } from "react";
import type { PanelSettings } from './state';

// Spatial context is shown directly on map events.
export const PANELS = [
  { id: "map", name: "Map", description: "Explore wildfire and outage locations.", icon: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16" },
  { id: "time_series", name: "Time series", description: "Track events over days, months, or years.", icon: "M3 3v18h18M6 15l4-5 4 3 6-8" },
  { id: "comparison", name: "Comparison", description: "Compare utilities, regions, or periods.", icon: "M3 3v18h18M7 17v-5m5 5V6m5 11V9" },
  { id: "record_table", name: "Record table", description: "Browse individual events and their details.", icon: "M3 4h18v16H3V4zm0 5h18M3 14h18M9 4v16" },
  { id: "stat_card", name: "Stat card", description: "Highlight counts, risk, and key metrics.", icon: "M3 5h18v14H3V5zm4 10V9m4 6v-3m4 3V8" },
] as const;

export type PanelId = typeof PANELS[number]["id"];
export interface PanelInstance { id: number; type: PanelId; name?: string; settings: PanelSettings }
export function panelTitle(panel: PanelInstance) {
  return panel.name ?? `${PANELS.find(item => item.id === panel.type)!.name} ${panel.id}`;
}

function PanelIcon({ path }: { path: string }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

export function PanelStrip({ panels, onRemove, onOpen, onLocate }: {
  panels: PanelInstance[]; onRemove: (id: number) => void;
  onOpen: () => void; onLocate: (id: number) => void;
}) {
  return <nav aria-label="Open panels" className="panel-strip">
    {panels.map(instance => {
      const panel = PANELS.find(panel => panel.id === instance.type)!;
      const title = panelTitle(instance);
      return <div key={instance.id} className="panel-shortcut">
        <button type="button" onClick={() => onLocate(instance.id)} aria-label={`Go to ${title}`} aria-controls={`panel-${instance.id}`} className="panel-shortcut-icon">
          <PanelIcon path={panel.icon} />
        </button>
        <span className="panel-shortcut-label" title={title}>{title}</span>
        <button type="button" onClick={() => onRemove(instance.id)} aria-label={`Remove ${title}`} className="shortcut-remove">×</button>
      </div>;
    })}
    <button type="button" onClick={onOpen} className="panel-shortcut add-panel">
      <span className="panel-shortcut-icon"><PanelIcon path="M12 5v14M5 12h14" /></span>
      <span className="text-xs">Add panel</span>
    </button>
  </nav>;
}

export function PanelPicker({ onSave, onClose }: {
  onSave: (ids: PanelId[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<PanelId[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="panel-picker-title" onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-white/10 bg-[#252525] p-0 text-white shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
    <div className="p-6" onClick={event => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div><h2 id="panel-picker-title" className="text-lg font-medium">Choose panels</h2>
          <p className="text-sm text-white/50 mt-1">Add views below. You can open more than one of each.</p></div>
        <button type="button" onClick={onClose} aria-label="Close panel picker" className="text-white/50 hover:text-white text-xl px-2 cursor-pointer">×</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PANELS.map(panel => {
          const checked = draft.includes(panel.id);
          return <div key={panel.id} className="relative">
            <button type="button" role="checkbox" aria-label={panel.name} aria-checked={checked}
              aria-describedby={`panel-description-${panel.id}`}
              onClick={() => setDraft(current => current.includes(panel.id) ? current.filter(id => id !== panel.id) : [...current, panel.id])}
              className={`panel-option ${checked ? "is-selected" : ""}`}>
              <span className={checked ? "text-blue-300" : "text-white/55"}><PanelIcon path={panel.icon} /></span>
              <span className="flex-1"><span className="block text-sm font-medium">{panel.name}</span><span id={`panel-description-${panel.id}`} className="block text-xs leading-relaxed text-white/50 mt-1">{panel.description}</span></span>
              <span aria-hidden="true" className="panel-option-check">{checked && "✓"}</span>
            </button>
            {checked && <div className="panel-quantity">
              <button type="button" aria-label={`Fewer ${panel.name}`} onClick={() => setDraft(current => { const index = current.lastIndexOf(panel.id); return current.filter((_, i) => i !== index); })}>−</button>
              <span aria-label={`${panel.name} quantity`}>{draft.filter(id => id === panel.id).length}</span>
              <button type="button" aria-label={`More ${panel.name}`} onClick={() => setDraft(current => [...current, panel.id])}>+</button>
            </div>}
          </div>;
        })}
      </div>
      <div className="flex items-center justify-between gap-3 mt-6">
        <span className="text-xs text-white/45" aria-live="polite">{draft.length} selected</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/65 hover:bg-white/5 cursor-pointer">Cancel</button>
          <button type="button" onClick={() => { onSave(draft); onClose(); }} disabled={!draft.length} className="disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium bg-blue-400 text-[#152030] hover:bg-blue-300 transition-colors cursor-pointer">Add panels</button>
        </div>
      </div>
    </div>
  </dialog>;
}
