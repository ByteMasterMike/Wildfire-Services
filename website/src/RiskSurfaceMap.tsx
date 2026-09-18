import { useCallback, useMemo } from 'react';
import { getRiskSurface } from './api.ts';
import { ExportActions } from './ExportActions';
import { GridSurfaceMap, type GridSurfaceCell } from './GridSurfaceMap.tsx';
import { magnitudeFillOpacity } from './gridSurface.ts';
import { LoadState } from './Controls';
import { riskBand } from './riskSurface.ts';
import { usePanel } from './state';
import { useRemote } from './useRemote';

export function RiskSurfaceMap() {
  const {settings, update} = usePanel();
  const preferred = '2024-07-15';
  const date = settings.riskDate && settings.riskDate >= settings.filters.start && settings.riskDate <= settings.filters.end
    ? settings.riskDate
    : preferred >= settings.filters.start && preferred <= settings.filters.end
      ? preferred
      : settings.filters.end;
  const remote = useRemote(`risk-surface:${date}`,()=>getRiskSurface(date));
  const maximum = Math.max(0,...(remote.data?.cells.map(cell=>cell.risk)??[]));
  const cells = useMemo<GridSurfaceCell[]>(()=>remote.data?.cells.map(cell=>({
    cell_id:cell.cell_id,lat:cell.lat,lon:cell.lon,value:cell.risk,
  }))??[],[remote.data]);
  const color = useCallback((value:number)=>riskBand(value,maximum).color,[maximum]);
  const fillOpacity = useCallback((value:number)=>magnitudeFillOpacity(value,maximum),[maximum]);
  const label = useCallback((cell:GridSurfaceCell)=>`Cell ${cell.cell_id}: ${(cell.value*100).toFixed(3)}% modeled risk`,[]);
  return <div className="live-map risk-surface-map">
    <ExportActions datasets={[]} disabled={Boolean(remote.error||remote.loading||!remote.data)} rows={()=>remote.data!.cells.map(cell=>({
      date:remote.data!.date,cell_id:cell.cell_id,lat:cell.lat,lon:cell.lon,risk:cell.risk,expected_count:cell.expected_count,intensity:cell.intensity,
      interpretation:'Statistical hindcast for a historical date; not a forecast',
    }))}/>
    <div className="analysis-chart map-toolbar"><label>Historical date <input aria-label="Risk surface date" type="date" min={settings.filters.start} max={settings.filters.end} value={date} onChange={event=>update({riskDate:event.target.value})}/></label>
      <span className="map-count">{remote.data ? `${remote.data.cells.length.toLocaleString()} grid cells` : ''}</span></div>
    <p className="panel-note">Modeled ignition risk, {date} (statistical hindcast, not a forecast).</p>
    {remote.data ? <GridSurfaceMap cells={cells} color={color} fillOpacity={fillOpacity} label={label} ariaLabel="Modeled ignition risk surface"/> : <div className="map-stage"><div className="map-status"><LoadState loading={remote.loading} error={remote.error} retry={remote.error?remote.retry:undefined}/></div></div>}
    <div className="map-legend" aria-label="Risk legend"><div className="legend-keys">
      {[.125,.375,.625,.875].map(ratio=>{const band=riskBand(ratio,1);return <span className="legend-key" key={ratio}><i className="legend-symbol is-area" style={{backgroundColor:band.color,color:band.color}}/>{band.label}</span>;})}
      <span>Relative to this date’s maximum ({(maximum*100).toFixed(3)}%)</span>
    </div></div>
  </div>;
}
