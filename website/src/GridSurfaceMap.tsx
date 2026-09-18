import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import gridJSON from '../../docs/assets/data/weather_anim/grid_cells.json';

const SPACING = gridJSON.meta.spacing;

export interface GridSurfaceCell {
  cell_id: number;
  lat: number;
  lon: number;
  value: number;
}

export function GridSurfaceMap({
  cells,
  color,
  fillOpacity,
  label,
  ariaLabel,
}: {
  cells: readonly GridSurfaceCell[];
  color: (value: number) => string;
  fillOpacity: (value: number) => number;
  label: (cell: GridSurfaceCell) => string;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    const instance = L.map(host.current!, {preferCanvas:true, scrollWheelZoom:false}).setView([37.6,-120.8],5);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      className:'base-map-tiles',
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom:19,
    }).on('tileerror',()=>setTileError(true)).addTo(instance);
    const observer = new ResizeObserver(()=>instance.invalidateSize({pan:true,animate:false}));
    observer.observe(host.current!);
    return ()=>{observer.disconnect();instance.remove();map.current=null;};
  },[]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !cells.length) return;
    if (!instance.getPane('grid-surface')) instance.createPane('grid-surface').style.zIndex='350';
    const renderer = L.canvas({pane:'grid-surface'});
    const group = L.layerGroup().addTo(instance);
    for (const cell of cells) {
      L.rectangle([[cell.lat,cell.lon],[cell.lat+SPACING,cell.lon+SPACING]], {
        renderer,
        pane:'grid-surface',
        stroke:false,
        fillColor:color(cell.value),
        fillOpacity:fillOpacity(cell.value),
      }).bindTooltip(label(cell),{sticky:true}).addTo(group);
    }
    instance.fitBounds(L.latLngBounds(cells.map(cell=>[cell.lat,cell.lon] as [number,number])),{padding:[16,16],animate:false});
    return ()=>{instance.removeLayer(group);if(instance.hasLayer(renderer))instance.removeLayer(renderer);};
  },[cells,color,fillOpacity,label]);
  return <div className="map-stage"><div ref={host} className="leaflet-host" aria-label={ariaLabel}/>
    {tileError&&<div className="map-warning" role="status">Basemap unavailable; grid values are still shown.</div>}</div>;
}
