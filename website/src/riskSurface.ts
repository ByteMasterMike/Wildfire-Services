export interface RiskCell {
  cell_id: number;
  lat: number;
  lon: number;
  risk: number;
  expected_count: number;
  intensity: number;
}

export interface RiskSurface {
  date: string;
  lookback_days: number;
  cells: RiskCell[];
}

export function validateRiskSurface(value: unknown, requestedDate: string): RiskSurface {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Risk service returned an invalid surface.');
  }
  const surface = value as Partial<RiskSurface>;
  if (surface.date !== requestedDate || !Number.isSafeInteger(surface.lookback_days)
    || !Array.isArray(surface.cells) || surface.cells.length !== 824) {
    throw new Error('Risk service returned an incomplete surface.');
  }
  const ids = new Set<number>();
  for (const cell of surface.cells) {
    if (!cell || !Number.isSafeInteger(cell.cell_id) || ids.has(cell.cell_id)
      || ![cell.lat, cell.lon, cell.risk, cell.expected_count, cell.intensity].every(Number.isFinite)
      || cell.risk < 0 || cell.risk > 1 || cell.expected_count < 0 || cell.intensity < 0
      || Math.abs(cell.expected_count - cell.intensity) > 1e-12) {
      throw new Error('Risk service returned an inconsistent grid cell.');
    }
    ids.add(cell.cell_id);
  }
  return surface as RiskSurface;
}

export function riskBand(value: number, maximum: number): {color: string; label: string} {
  const ratio = maximum > 0 ? value / maximum : 0;
  if (ratio <= 0.25) return {color: '#ede9fe', label: 'Lowest'};
  if (ratio <= 0.5) return {color: '#c4b5fd', label: 'Low'};
  if (ratio <= 0.75) return {color: '#8b5cf6', label: 'High'};
  return {color: '#5b21b6', label: 'Highest'};
}
