import { aggregateDaily, asNumber, type Bucket, type EventRecord, type Interval } from './data.ts';

export interface CustomerEventSeries {
  buckets: Bucket[];
  total: number;
  missing: number;
}

export function customerEventsOverTime(
  events: readonly EventRecord[],
  start: string,
  end: string,
  interval: Interval,
): CustomerEventSeries {
  const daily = new Map<string, number>();
  let missing = 0;
  for (const event of events) {
    if (event.date < start || event.date > end) continue;
    const value = asNumber(event.properties.customers_deenergized);
    if (value === null) {
      missing += 1;
      continue;
    }
    daily.set(event.date, (daily.get(event.date) ?? 0) + value);
  }
  const days: Bucket[] = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86_400_000) {
    const day = new Date(time).toISOString().slice(0, 10);
    days.push({start: day, end: day, count: daily.get(day) ?? 0});
  }
  const buckets = aggregateDaily(days, interval);
  return {
    buckets,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    missing,
  };
}
