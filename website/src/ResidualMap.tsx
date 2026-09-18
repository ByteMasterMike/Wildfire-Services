import { useCallback, useMemo } from 'react';
import { getObservedTraining, getRiskSurface } from './api.ts';
import { ExportActions } from './ExportActions';
import { GridSurfaceMap, type GridSurfaceCell } from './GridSurfaceMap.tsx';
import { magnitudeFillOpacity } from './gridSurface.ts';
import { LoadState } from './Controls';
import { residualBand, residualCells } from './residual.ts';
import { usePanel } from './state';
import { useRemote } from './useRemote';

export function ResidualMap() {
  const {settings, update} = usePanel();
  const preferred = '2024-07-15';
  const date = settings.riskDate && settings.riskDate >= settings.filters.start && settings.riskDate <= settings.filters.end
    ? settings.riskDate
    : preferred >= settings.filters.start && preferred <= settings.filters.end
      ? preferred
      : settings.filters.end;
  const remote = useRemote(`risk-residual:${date}`, async () => {
    const [surface, observed] = await Promise.all([getRiskSurface(date), getObservedTraining(date)]);
    return {date: surface.date, cells: residualCells(surface, observed)};
  });
  const maxAbs = Math.max(0, ...(remote.data?.cells.map(cell => Math.abs(cell.residual)) ?? []));
  const cells = useMemo<GridSurfaceCell[]>(() => remote.data?.cells.map(cell => ({
    cell_id: cell.cell_id, lat: cell.lat, lon: cell.lon, value: cell.residual,
  })) ?? [], [remote.data]);
  const color = useCallback((value: number) => residualBand(value, maxAbs).color, [maxAbs]);
  const fillOpacity = useCallback((value: number) => magnitudeFillOpacity(value, maxAbs), [maxAbs]);
  const label = useCallback((cell: GridSurfaceCell) => {
    const signed = cell.value > 0 ? `+${cell.value.toFixed(3)}` : cell.value.toFixed(3);
    return `Cell ${cell.cell_id}: ${signed} observed − expected`;
  }, []);
  return <div className="live-map residual-map">
    <ExportActions datasets={['cpuc']} disabled={Boolean(remote.error || remote.loading || !remote.data)} rows={() => remote.data!.cells.map(cell => ({
      date: remote.data!.date, cell_id: cell.cell_id, lat: cell.lat, lon: cell.lon,
      observed_count: cell.observed_count, expected_count: cell.expected_count, residual: cell.residual,
      assignment: 'training-matched nearest SW-corner snap (/observed-training), not polygon containment',
      interpretation: 'Statistical hindcast residual for a historical date; not a forecast',
    }))}/>
    <div className="analysis-chart map-toolbar"><label>Historical date <input aria-label="Residual map date" type="date" min={settings.filters.start} max={settings.filters.end} value={date} onChange={event => update({riskDate: event.target.value})}/></label>
      <span className="map-count">{remote.data ? `${remote.data.cells.length.toLocaleString()} grid cells` : ''}</span></div>
    <p className="panel-note">Observed minus expected, {date}. Residuals use the training-matched nearest SW-corner assignment, not polygon containment. Statistical hindcast for a historical date, not a forecast.</p>
    {remote.data ? <GridSurfaceMap cells={cells} color={color} fillOpacity={fillOpacity} label={label} ariaLabel="Model residual map"/> : <div className="map-stage"><div className="map-status"><LoadState loading={remote.loading} error={remote.error} retry={remote.error ? remote.retry : undefined}/></div></div>}
    <div className="map-legend" aria-label="Residual legend"><div className="legend-keys">
      {[-1, -0.25, 0, 0.25, 1].map(value => {
        const band = residualBand(value, 1);
        return <span className="legend-key" key={value}><i className="legend-symbol is-area" style={{backgroundColor: band.color, color: band.color}}/>{band.label}</span>;
      })}
      <span>observed_count − expected_count · max |residual| {maxAbs.toFixed(3)}</span>
    </div></div>
  </div>;
}
