import type { PanelId } from './PanelPicker';
import type { PanelSettings } from './state';
import { followWorkspaceYear, pinToYear, yearOverrideMarker, type GlobalFilters } from './globalFilters.ts';

export function YearOverrideMarker({ type, settings }: { type: PanelId; settings: PanelSettings }) {
  const label = yearOverrideMarker(type, settings);
  return label ? <span className="panel-year-badge">{label}</span> : null;
}

export function PanelYearPin({
  type, settings, global, onUpdate,
}: {
  type: PanelId; settings: PanelSettings; global: GlobalFilters; onUpdate: (patch: Partial<PanelSettings>) => void;
}) {
  const overridden = settings.filterMode === 'override';
  return <div className="panel-year-control" onPointerDown={event => event.stopPropagation()}>
    <YearOverrideMarker type={type} settings={settings} />
    <button type="button" className="panel-expand" title={overridden ? 'Follow workspace year' : "Pin this panel's year"}
      aria-label={overridden ? 'Follow workspace year' : "Pin this panel's year"}
      onClick={() => onUpdate(overridden ? followWorkspaceYear() : pinToYear(settings, global))}>
      {overridden
        ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 12a9 9 0 0115-6.7M21 3v6h-6M21 12a9 9 0 01-15 6.7M3 21v-6h6"/></svg>
        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 17v5M8 3h8l-1 8h3L12 17 6 11h3L8 3z"/></svg>}
    </button>
  </div>;
}
