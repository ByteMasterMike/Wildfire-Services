export const DATASETS = [
  { id: "cpuc", name: "CPUC", description: "Utility ignition records", color: "#f3a16c", hasCause: false },
  { id: "epss", name: "EPSS", description: "PG&E outage records", color: "#b7a0f0", hasCause: true },
  { id: "calfire", name: "CAL FIRE", description: "Fire incident records", color: "#ee8585", hasCause: false },
] as const;
export type DatasetId = typeof DATASETS[number]["id"];
export type Interval = "daily" | "weekly" | "monthly" | "quarterly";
export type GroupBy = "cause" | "utility" | "county";
export const UTILITIES = ["PG&E", "SCE", "SDG&E"];
export const COUNTIES = ["Placer", "Sacramento", "Fresno", "Kern", "Riverside", "San Diego"];
export interface Filters { start: string; end: string; county: string; utility: string }
export interface DateRange { start: string; end: string }
export interface DemoEvent { dataset: DatasetId; date: string; county: string; utility: string; cause: string | null }

const PROFILES = {
  cpuc: [4, 6, 5, 9, 12, 21, 35, 41, 29, 17, 8, 4],
  epss: [9, 8, 7, 12, 18, 34, 61, 75, 48, 24, 15, 10],
  calfire: [3, 2, 4, 6, 16, 31, 53, 68, 42, 20, 7, 5],
};
const CAUSES = ["Unknown", "Vegetation", "Equipment", "Unknown", "Weather", null, "Animal", "Unknown", "Other"];
const DAY = 86400000;
const isoDate = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

// Synthetic chart records, independent of the map's six illustrative events.
// Cause availability mirrors the current warehouse; absent fields are not Unknown.
export const DEMO_EVENTS: DemoEvent[] = DATASETS.flatMap(dataset =>
  [2023, 2024].flatMap(year => PROFILES[dataset.id].flatMap((count, month) => {
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({ length: year === 2024 ? count : Math.round(count * .8) }, (_, index) => {
      const countyIndex = (index + month) % COUNTIES.length;
      return {
        dataset: dataset.id,
        date: isoDate(Date.UTC(year, month, 1 + (index * 7 + month * 3) % days)),
        county: COUNTIES[countyIndex],
        utility: dataset.id === "epss" ? "PG&E" : UTILITIES[countyIndex < 3 ? 0 : countyIndex < 5 ? 1 : 2],
        cause: dataset.hasCause ? CAUSES[(index + month) % CAUSES.length] : null,
      };
    });
  }))
);

export function getDateRange(events: readonly Pick<DemoEvent, "date">[]): DateRange | null {
  if (!events.length) return null;
  let start = events[0].date;
  let end = start;
  for (const event of events) {
    if (event.date < start) start = event.date;
    if (event.date > end) end = event.date;
  }
  return { start, end };
}

// This is the full in-memory collection. SQL integration must supply full-dataset
// MIN/MAX date metadata rather than deriving coverage from a paginated response.
export const DATE_RANGE = getDateRange(DEMO_EVENTS);
export const DEFAULT_FILTERS: Filters = { start: DATE_RANGE?.start ?? "", end: DATE_RANGE?.end ?? "", county: "", utility: "" };

export function filterError(filters: Filters, range: DateRange | null = DATE_RANGE): string | null {
  if (!range) return "No dated records are available.";
  if (!filters.start || !filters.end) return "Choose both a start and end date.";
  if (filters.start > filters.end) return "Start date must be on or before end date.";
  if (filters.start < range.start || filters.end > range.end) return `Available dates: ${range.start} to ${range.end}.`;
  return null;
}

export function unavailableReason(dataset: DatasetId, filters: Filters): string | null {
  return dataset === "epss" && filters.utility && filters.utility !== "PG&E"
    ? "EPSS is available for PG&E only. This utility has no EPSS data."
    : null;
}

export function filteredEvents(dataset: DatasetId, filters: Filters): DemoEvent[] {
  return DEMO_EVENTS.filter(event => event.dataset === dataset && event.date >= filters.start && event.date <= filters.end
    && (!filters.county || event.county === filters.county) && (!filters.utility || event.utility === filters.utility));
}

function bucketKey(date: string, interval: Interval): string {
  if (interval === "daily") return date;
  if (interval === "monthly") return `${date.slice(0, 7)}-01`;
  const year = Number(date.slice(0, 4));
  if (interval === "quarterly") return isoDate(Date.UTC(year, Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3, 1));
  // Jan 1 + 7-day bins, matching the existing visualization API (not ISO weeks).
  const start = Date.UTC(year, 0, 1);
  return isoDate(start + Math.floor((Date.parse(date) - start) / DAY / 7) * 7 * DAY);
}

export function timeBuckets(filters: Filters, interval: Interval) {
  const buckets = new Map<string, { key: string; start: string; end: string }>();
  for (let day = Date.parse(filters.start); day <= Date.parse(filters.end); day += DAY) {
    const date = isoDate(day);
    const key = bucketKey(date, interval);
    const bucket = buckets.get(key);
    if (bucket) bucket.end = date;
    else buckets.set(key, { key, start: date, end: date });
  }
  return [...buckets.values()];
}

export function countSeries(events: DemoEvent[], buckets: ReturnType<typeof timeBuckets>, interval: Interval): number[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = bucketKey(event.date, interval);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return buckets.map(bucket => counts.get(bucket.key) ?? 0);
}

export function groupedCounts(events: DemoEvent[], dataset: DatasetId, groupBy: GroupBy, filters: Filters) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event[groupBy] ?? "Not recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = groupBy === "utility" ? (filters.utility ? [filters.utility] : UTILITIES) : [...counts.keys()];
  return keys.map(key => ({
    key,
    value: groupBy === "utility" && dataset === "epss" && key !== "PG&E" ? null : counts.get(key) ?? 0,
  })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.key.localeCompare(b.key));
}
