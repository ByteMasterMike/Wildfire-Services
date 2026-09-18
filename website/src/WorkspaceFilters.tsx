import { WORKSPACE_YEARS, type GlobalFilters } from './globalFilters.ts';

export function WorkspaceFilters({ filters, onYearChange }: { filters: GlobalFilters; onYearChange: (year: number) => void }) {
  return <div className="workspace-filters" role="region" aria-label="Workspace filters">
    <label>Year
      <select aria-label="Workspace year" value={filters.year} onChange={event => onYearChange(Number(event.target.value))}>
        {WORKSPACE_YEARS.map(year => <option key={year} value={year}>{year}</option>)}
      </select>
    </label>
  </div>;
}
