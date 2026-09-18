import type { RiskSurface } from './riskSurface.ts';

export interface ObservedCell {
  cell_id: number;
  lat: number;
  lon: number;
  observed_count: number;
}

export interface ObservedTraining {
  date: string;
  cells: ObservedCell[];
}

export interface ResidualCell {
  cell_id: number;
  lat: number;
  lon: number;
  observed_count: number;
  expected_count: number;
  residual: number;
}

export function validateObservedTraining(value: unknown, requestedDate: string): ObservedTraining {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Risk service returned an invalid observed-training grid.');
  }
  const observed = value as Partial<ObservedTraining>;
  if (observed.date !== requestedDate || !Array.isArray(observed.cells) || observed.cells.length !== 824) {
    throw new Error('Risk service returned an incomplete observed-training grid.');
  }
  const ids = new Set<number>();
  for (const cell of observed.cells) {
    if (!cell || !Number.isSafeInteger(cell.cell_id) || ids.has(cell.cell_id)
      || ![cell.lat, cell.lon].every(Number.isFinite)
      || !Number.isSafeInteger(cell.observed_count) || cell.observed_count < 0) {
      throw new Error('Risk service returned an inconsistent grid cell.');
    }
    ids.add(cell.cell_id);
  }
  return observed as ObservedTraining;
}

export function residualCells(surface: RiskSurface, observed: ObservedTraining): ResidualCell[] {
  if (surface.date !== observed.date || surface.cells.length !== 824 || observed.cells.length !== 824) {
    throw new Error('Risk service returned an incomplete residual.');
  }
  const byId = new Map(observed.cells.map(cell => [cell.cell_id, cell]));
  return surface.cells.map(cell => {
    const match = byId.get(cell.cell_id);
    if (!match) throw new Error('Risk service returned an inconsistent grid cell.');
    return {
      cell_id: cell.cell_id,
      lat: cell.lat,
      lon: cell.lon,
      observed_count: match.observed_count,
      expected_count: cell.expected_count,
      residual: match.observed_count - cell.expected_count,
    };
  });
}

export function residualBand(value: number, maxAbs: number): {color: string; label: string} {
  if (maxAbs <= 0 || Math.abs(value) < 1e-12) return {color: '#e2e8f0', label: 'Near expected'};
  const ratio = Math.abs(value) / maxAbs;
  if (value > 0) return ratio > 0.5 ? {color: '#b91c1c', label: 'More observed'} : {color: '#fca5a5', label: 'Slightly more observed'};
  return ratio > 0.5 ? {color: '#1d4ed8', label: 'Fewer observed'} : {color: '#93c5fd', label: 'Slightly fewer observed'};
}
