/** Near-zero almost clear, extremes opaque. Power scale, no extra deps. */
export function magnitudeFillOpacity(value: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(value)) return 0;
  const t = Math.min(1, Math.abs(value) / scale);
  if (t <= 0) return 0;
  return 0.88 * Math.pow(t, 1.25);
}
