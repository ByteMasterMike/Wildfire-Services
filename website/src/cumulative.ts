import type { EventRecord } from './data.ts';

export interface CumulativePoint {
  date: string;
  acres: number;
}

export function cumulativeAcres(
  events: readonly EventRecord[],
  start: string,
  end: string,
): {points: CumulativePoint[]; total: number; missing: number} {
  const daily = new Map<string, number>();
  let missing = 0;
  for (const event of events) {
    if (event.date < start || event.date > end) continue;
    if (event.acres === null) {
      missing += 1;
      continue;
    }
    daily.set(event.date, (daily.get(event.date) ?? 0) + event.acres);
  }
  const points: CumulativePoint[] = [];
  let total = 0;
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    total += daily.get(date) ?? 0;
    points.push({date, acres: total});
  }
  return {points, total, missing};
}
