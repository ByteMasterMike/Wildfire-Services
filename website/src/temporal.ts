import { aggregateDaily, asText, type Bucket, type EventRecord, type Filters, type Interval } from './data.ts';

const DAY = 86400000;
export interface RegionSeries { name: string; total: number; buckets: Bucket[] }
export function regionalSeries(events: EventRecord[], filters: Filters, interval: Interval): RegionSeries[] {
  const days: Bucket[] = [];
  for (let time = Date.parse(filters.start); time <= Date.parse(filters.end); time += DAY) {
    const date = new Date(time).toISOString().slice(0,10);
    days.push({start: date, end: date, count: 0});
  }
  const groups = new Map<string, Map<string, number>>();
  for (const event of events) {
    if (event.date < filters.start || event.date > filters.end) continue;
    const name = asText(event.properties.division)?.trim() || 'Not recorded';
    if (!groups.has(name)) groups.set(name, new Map());
    const counts = groups.get(name)!;
    counts.set(event.date, (counts.get(event.date) ?? 0) + 1);
  }
  return [...groups].map(([name, counts]) => {
    const buckets = aggregateDaily(days.map(day => ({...day, count: counts.get(day.start) ?? 0})), interval);
    return { name, buckets, total: buckets.reduce((sum, bucket) => sum + bucket.count, 0) };
  }).sort((a,b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function seasonalYears(coverage: {start: string | null; end: string | null}, now = new Date()): number[] {
  if (!coverage.start || !coverage.end) return [];
  const years: number[] = [];
  for (let year = Number(coverage.start.slice(0,4)); year <= Number(coverage.end.slice(0,4)); year++) {
    if (year < now.getUTCFullYear() && `${year}-01-01` >= coverage.start && `${year}-12-31` <= coverage.end) years.push(year);
  }
  return years;
}

export interface SeasonalWeek { week: number; counts: Record<number, number | null>; mean: number | null; years: number[] }
export function seasonalProfile(series: {year: number; daily: Bucket[]}[]): SeasonalWeek[] {
  const seenYears = new Set<number>();
  const indexed = series.map(({year, daily}) => {
    if (seenYears.has(year)) throw new Error('A seasonal year was returned twice.');
    seenYears.add(year);
    const dates = new Map<string, number>();
    for (const bucket of daily) {
      if (bucket.start !== bucket.end || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.start) || !Number.isFinite(Date.parse(bucket.start)) || new Date(bucket.start).toISOString().slice(0,10) !== bucket.start || Number(bucket.start.slice(0,4)) !== year || dates.has(bucket.start) || !Number.isInteger(bucket.count) || bucket.count < 0) throw new Error('Seasonal data must contain unique daily counts for each selected year.');
      dates.set(bucket.start, bucket.count);
    }
    return {year, dates};
  });
  return Array.from({length:52}, (_,index) => {
    const counts: Record<number,number|null> = {};
    for (const {year, dates} of indexed) {
      const values = Array.from({length:7}, (_,day) => dates.get(new Date(Date.UTC(year,0,1) + (index*7+day)*DAY).toISOString().slice(0,10)));
      counts[year] = values.every(value => value !== undefined) ? values.reduce<number>((sum,value) => sum + value!,0) : null;
    }
    const years = indexed.map(item=>item.year).filter(year=>counts[year] !== null);
    return {week:index+1, counts, years, mean:years.length ? years.reduce((sum,year)=>sum+counts[year]!,0)/years.length : null};
  });
}
