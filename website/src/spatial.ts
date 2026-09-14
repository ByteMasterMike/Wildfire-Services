import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { asText, utilityLabel, type Boundary, type EventRecord } from './data.ts';

export interface GridCell { id: number; lat: number; lon: number }
export interface SpatialBoundaries { territories: Boundary[]; hftd: Boundary[] }

export function spatialFields(record: EventRecord, coordinates: [number, number], grid: GridCell[], boundaries?: SpatialBoundaries, failed = false) {
  const [lat, lon] = coordinates;
  const cell = grid.find(cell => lat >= cell.lat && lat < cell.lat + .24 && lon >= cell.lon && lon < cell.lon + .24);
  const point = [lon, lat];
  const pending = failed ? 'Unavailable' : 'Loading…';
  const territories = boundaries ? boundaries.territories.filter(feature => booleanPointInPolygon(point, feature)).map(feature => utilityLabel(feature.properties.utility)).filter(Boolean).join(', ') || 'Outside IOU territories' : pending;
  const tiers = boundaries ? [...new Set(boundaries.hftd.filter(feature => booleanPointInPolygon(point, feature)).map(feature => asText(feature.properties.tier)).filter(Boolean))].join(', ') || 'None' : pending;
  return [
    [record.geometry?.type === 'Point' ? 'Coordinates' : 'Map position', `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
    ['IOU territory', territories], ['HFTD', tiers], ['County', record.county ?? 'Not recorded'], ['Grid cell', cell ? String(cell.id) : 'Outside grid'],
  ];
}

export function previewPosition(x: number, y: number, width: number, height: number, containerWidth: number, containerHeight: number) {
  const above = y >= height + 20;
  const left = Math.max(8, Math.min(x - width / 2, containerWidth - width - 8));
  const top = Math.max(8, Math.min(above ? y - height - 12 : y + 12, containerHeight - height - 8));
  return { left, top, above, arrow: Math.max(16, Math.min(x - left, width - 16)) };
}
