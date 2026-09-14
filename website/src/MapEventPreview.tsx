import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type L from 'leaflet';
import gridCSV from '../../services/risk_forecasting/data/grid_cells.csv?raw';
import { getBoundaries } from './api.ts';
import { configFor, type EventRecord } from './data.ts';
import { previewPosition, spatialFields } from './spatial.ts';
import { useRemote } from './useRemote';

const grid = gridCSV.trim().split(/\r?\n/).slice(1).map(line => {
  const [id, lat, lon] = line.split(',').map(Number);
  return { id, lat, lon };
});
export interface EventPreview { record: EventRecord; location: [number, number]; pinned: boolean }

export function MapEventPreview({ map, container, preview, onClose, onEnter, onLeave, onInspect }: {
  map: L.Map; container: HTMLElement; preview: EventPreview;
  onClose: () => void; onEnter: () => void; onLeave: () => void; onInspect: () => void;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, arrow: 16, above: false, visible: false });
  const remote = useRemote('spatial-boundaries', async () => {
    const [territories, hftd] = await Promise.all([getBoundaries('territories'), getBoundaries('hftd')]);
    return { territories, hftd };
  });
  const fields = useMemo(() => spatialFields(preview.record, preview.location, grid, remote.data, Boolean(remote.error)), [preview.record, preview.location, remote.data, remote.error]);
  useLayoutEffect(() => {
    const place = () => {
      const element = bubble.current!;
      const parent = container.getBoundingClientRect();
      const mapBounds = map.getContainer().getBoundingClientRect();
      const point = map.latLngToContainerPoint(preview.location);
      setPosition({ ...previewPosition(point.x + mapBounds.left - parent.left, point.y + mapBounds.top - parent.top, element.offsetWidth, element.offsetHeight, parent.width, parent.height), visible: point.x >= 0 && point.y >= 0 && point.x <= mapBounds.width && point.y <= mapBounds.height });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bubble.current!); observer.observe(container);
    map.on('move zoom resize', place);
    return () => { observer.disconnect(); map.off('move zoom resize', place); };
  }, [map, container, preview.location]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !bubble.current?.contains(event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (bubble.current?.contains(document.activeElement)) map.getContainer().focus({ preventScroll: true });
      onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [map, onClose]);
  const { record } = preview;
  return <div ref={bubble} role="dialog" aria-label={`${record.name} location`} className={`map-event-preview ${position.above ? 'is-above' : 'is-below'}`} style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden', '--preview-arrow-x': `${position.arrow}px` } as CSSProperties}
    onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onEnter}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
    <header><div><p>{configFor(record.dataset).name}{record.date && ` · ${record.date.slice(0, 10)}`}{record.properties.circuit_detail ? ' · Circuit' : ''}</p><h3 title={record.name}>{record.name}</h3></div><button aria-label="Close location preview" onClick={() => { map.getContainer().focus({ preventScroll: true }); onClose(); }}>×</button></header>
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <footer>{remote.error && <button className="text-button" onClick={remote.retry}>Retry boundaries</button>}<button className="text-button" onClick={onInspect}>View details →</button></footer>
  </div>;
}
