import type { Feature, FeatureCollection, Geometry } from 'geojson';

export const DATASETS = [
  { id: 'cpuc', api: 'ignitions', query: 'cpuc_ignitions', name: 'CPUC', color: '#f3a16c', hasCause: false },
  { id: 'epss', api: 'epss', query: 'epss_outages', name: 'EPSS', color: '#b7a0f0', hasCause: true },
  { id: 'calfire', api: 'calfire', query: 'calfire_incidents', name: 'CAL FIRE', color: '#ee8585', hasCause: false },
  { id: 'psps', api: 'psps', query: 'psps_events', name: 'PSPS', color: '#7caef1', hasCause: false },
  { id: 'us_ignitions', api: 'us_ignitions', query: 'us_ignitions', name: 'US ignitions', color: '#dc2626', hasCause: false },
] as const;
export type DatasetId = typeof DATASETS[number]['id'];
export const CHART_DATASETS = DATASETS.slice(0, 3);
export const UTILITIES = ['PG&E', 'SCE', 'SDG&E'];
export const COUNTIES = ['Alameda','Alpine','Amador','Butte','Calaveras','Colusa','Contra Costa','Del Norte','El Dorado','Fresno','Glenn','Humboldt','Imperial','Inyo','Kern','Kings','Lake','Lassen','Los Angeles','Madera','Marin','Mariposa','Mendocino','Merced','Modoc','Mono','Monterey','Napa','Nevada','Orange','Placer','Plumas','Riverside','Sacramento','San Benito','San Bernardino','San Diego','San Francisco','San Joaquin','San Luis Obispo','San Mateo','Santa Barbara','Santa Clara','Santa Cruz','Shasta','Sierra','Siskiyou','Solano','Sonoma','Stanislaus','Sutter','Tehama','Trinity','Tulare','Tuolumne','Ventura','Yolo','Yuba'];
export type Interval = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type GroupBy = 'cause' | 'utility' | 'county';
export interface Filters { start: string; end: string; county: string; utility: string }
export const DEFAULT_FILTERS: Filters = { start: '2024-01-01', end: '2024-12-31', county: '', utility: '' };
export interface EventRecord {
  id: string; dataset: DatasetId; name: string; date: string; county: string | null;
  utility: string | null; cause: string | null; acres: number | null;
  geometry: Geometry | null; properties: Record<string, unknown>;
}
export interface LayerResponse {
  geojson: FeatureCollection<Geometry | null, Record<string, unknown>>;
  meta: { total: number; returned: number; truncated: boolean; [key: string]: unknown };
}
export interface Bucket { start: string; end: string; count: number }
export const configFor = (id: DatasetId) => DATASETS.find(d => d.id === id)!;
export const utilityCode = (label: string) => ({ 'PG&E': 'PGE', 'SDG&E': 'SDGE' }[label] ?? label);
export const utilityLabel = (code: unknown) => typeof code === 'string' ? ({ PGE: 'PG&E', SDGE: 'SDG&E' }[code] ?? code) : null;
export const asText = (value: unknown): string | null => value === null || value === undefined || value === '' ? null : String(value);
export const asNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function filterSupport(datasets: readonly DatasetId[]) {
  return {
    county: !datasets.some(dataset => dataset === 'psps' || dataset === 'us_ignitions'),
    utility: datasets.includes('us_ignitions') ? 'none' as const : datasets.includes('epss') ? 'pge' as const : 'all' as const,
  };
}

export function supportedFilters(filters: Filters, datasets: readonly DatasetId[]): Filters {
  const support = filterSupport(datasets);
  return {...filters, county: support.county ? filters.county : '',
    utility: support.utility === 'none' || (support.utility === 'pge' && filters.utility !== 'PG&E') ? '' : filters.utility};
}

export function filterError(filters: Filters): string | null {
  for (const value of [filters.start, filters.end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return 'Choose a valid start and end date.';
  }
  return filters.start > filters.end ? 'Start date must be on or before end date.' : null;
}
export function unavailableReason(dataset: DatasetId, filters: Filters): string | null {
  if (dataset === 'epss' && filters.utility && filters.utility !== 'PG&E') return 'EPSS is available for PG&E only. This utility has no EPSS data.';
  if (dataset === 'us_ignitions' && (filters.utility || filters.county)) return 'US ignitions do not support county or utility filters. Clear these filters.';
  if (dataset === 'psps' && filters.county) return 'PSPS county filtering is not available. Clear the county filter.';
  return null;
}
export function datasetNote(dataset: DatasetId) {
  if (dataset === 'cpuc') return 'Utility uses the source attribute; spatial territory counts can differ.';
  if (dataset === 'calfire') return 'Wildfire / Fire records from the incident-map feed; reporting coverage varies across years.';
  if (dataset === 'epss') return 'PG&E only. Counts are outage events, not unique circuits or customers.';
  if (dataset === 'us_ignitions') return 'IRWIN / FireCastRL all-cause sample, not a national census or comparable to CPUC.';
  return 'PSPS event areas; affected customers may recur across events.';
}
export function recordsFromFeatures(dataset: DatasetId, features: LayerResponse['geojson']['features']): EventRecord[] {
  const records = new Map<string, EventRecord>();
  for (const feature of features) {
    const props = feature.properties;
    const entries = dataset === 'epss' ? props.outages : [props];
    if (!Array.isArray(entries)) throw new Error('The outage response is missing event records.');
    for (const p of entries as Record<string, unknown>[]) {
      const id = asText(p.id ?? p.incident_id ?? p.event_name);
      if (!id) throw new Error('An event has no record ID.');
      const record: EventRecord = {
        id, dataset, name: asText(p.incident_name ?? p.event_name ?? p.circuit) ?? `${configFor(dataset).name} #${id}`,
        date: asText(p.event_date ?? p.start_date ?? p.date_only_created ?? p.deenergization_start_date) ?? '',
        county: asText(p.county), utility: dataset === 'epss' ? 'PG&E' : utilityLabel(p.utility),
        cause: asText(p.cause), acres: asNumber(p.acres_burned), geometry: feature.geometry, properties: p,
      };
      if (records.has(id)) throw new Error('The server returned duplicate event IDs. Refresh to load a consistent snapshot.');
      records.set(id, record);
    }
  }
  return [...records.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function aggregateDaily(buckets: Bucket[], interval: Interval): Bucket[] {
  const groups = new Map<string, Bucket>();
  for (const bucket of buckets) {
    const year = Number(bucket.start.slice(0, 4));
    const month = Number(bucket.start.slice(5, 7));
    const key = interval === 'daily' ? bucket.start : interval === 'monthly' ? bucket.start.slice(0, 7)
      : interval === 'quarterly' ? `${year}-Q${Math.ceil(month / 3)}`
      : `${year}-W${Math.floor((Date.parse(bucket.start) - Date.UTC(year, 0, 1)) / 86400000 / 7)}`;
    const previous = groups.get(key);
    if (previous) { previous.end = bucket.end; previous.count += bucket.count; }
    else groups.set(key, { ...bucket });
  }
  return [...groups.values()];
}
export type Boundary = Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
