import { configFor, filterError, unavailableReason, utilityCode, recordsFromFeatures, type Bucket, type DatasetId, type Filters, type LayerResponse, type Boundary } from './data.ts';

export const VISUALIZATION_URL = 'https://d3t70p3if3twy3.cloudfront.net/api/visualization';
export const AGENT_URL = 'https://d3t70p3if3twy3.cloudfront.net/api/agent';
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
export function clearDataCache() { cache.clear(); }
export async function getJSON<T>(url: string): Promise<T> {
  const found = cache.get(url);
  if (found && Date.now() - found.at < 300_000) return found.promise as Promise<T>;
  const promise = (async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`Data service returned HTTP ${response.status}. Please retry.`);
    return await response.json() as T;
  })();
  const entry = { at: Date.now(), promise };
  cache.set(url, entry);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  try { return await promise; }
  catch (error) { if (cache.get(url) === entry) cache.delete(url); throw error; }
}
function queryParams(dataset: DatasetId, filters: Filters) {
  const error = filterError(filters) || unavailableReason(dataset, filters);
  if (error) throw new Error(error);
  const params = new URLSearchParams({ dataset: configFor(dataset).api, start_date: filters.start, end_date: filters.end });
  if (filters.utility) params.set('utility', utilityCode(filters.utility));
  if (filters.county) params.set('county', filters.county);
  return params;
}
export async function collectPages(load: (offset: number) => Promise<LayerResponse>): Promise<LayerResponse> {
  const first = await load(0);
  const features = [...first.geojson.features];
  const ids = new Set(features.map(f => String(f.id)));
  while (features.length < first.meta.total) {
    const next = await load(features.length);
    if (next.meta.total !== first.meta.total || !next.geojson.features.length) throw new Error('Data changed or pagination stopped before completion. Please retry.');
    for (const feature of next.geojson.features) {
      const id = String(feature.id);
      if (ids.has(id)) throw new Error('Overlapping data pages. Please retry.');
      ids.add(id); features.push(feature);
    }
  }
  if (features.length !== first.meta.total) throw new Error('The response count does not match the complete dataset.');
  return { ...first, geojson: { type: 'FeatureCollection', features }, meta: { ...first.meta, returned: features.length, truncated: false } };
}
export async function getLayer(dataset: DatasetId, filters: Filters, outages = false) {
  const params = queryParams(dataset, filters);
  params.set('limit', '1000');
  if (outages && dataset === 'epss') params.set('include_outages', 'true');
  return collectPages(offset => {
    const page = new URLSearchParams(params); page.set('offset', String(offset));
    return getJSON<LayerResponse>(`${VISUALIZATION_URL}/map-layer?${page}`);
  });
}
export async function getRecords(dataset: DatasetId, filters: Filters) {
  return recordsFromFeatures(dataset, (await getLayer(dataset, filters, true)).geojson.features);
}
export async function getDailySeries(dataset: DatasetId, filters: Filters) {
  const params = queryParams(dataset, filters); params.set('interval', 'daily');
  const result = await getJSON<{ buckets: Bucket[]; meta: { total_events: number } }>(`${VISUALIZATION_URL}/time-series?${params}`);
  if (result.buckets.reduce((sum, bucket) => sum + bucket.count, 0) !== result.meta.total_events) throw new Error('Time series total does not match its buckets.');
  return result.buckets;
}
export async function getCoverage(dataset: DatasetId) {
  const result = await getJSON<{ buckets: Bucket[] }>(`${VISUALIZATION_URL}/time-series?dataset=${configFor(dataset).api}&interval=daily`);
  const nonzero = result.buckets.filter(b => b.count > 0);
  return { start: nonzero[0]?.start ?? null, end: nonzero.at(-1)?.end ?? null, total: result.buckets.reduce((sum, b) => sum + b.count, 0) };
}
export async function getBoundaries(kind: 'hftd' | 'territories'): Promise<Boundary[]> {
  if (kind === 'hftd') {
    const data = await getJSON<LayerResponse>(`${VISUALIZATION_URL}/map-layer?dataset=hftd`);
    return data.geojson.features as Boundary[];
  }
  const results = await Promise.all(['PGE', 'SCE', 'SDGE'].map(utility => getJSON<{ geojson: Boundary }>(`${VISUALIZATION_URL}/utility-territory?utility=${utility}`)));
  return results.map(result => result.geojson);
}
export interface DetailResponse { attributes: Record<string, unknown>; detail_fields: { label: string; value: unknown }[]; geometry: GeoJSON.Geometry | null }
export function getDetail(dataset: DatasetId, id: string, circuitScope?: { start: string; end: string }) {
  const params = new URLSearchParams({ dataset: circuitScope ? 'circuits' : configFor(dataset).api, id });
  if (circuitScope) { params.set('start_date', circuitScope.start); params.set('end_date', circuitScope.end); }
  return getJSON<DetailResponse>(`${VISUALIZATION_URL}/event-detail?${params}`);
}
export interface AgentAnswer { answer_text: string; status: string; qualifications?: { text: string }[]; views?: { type: string; params: Record<string, unknown> }[] }
export function parseSSE(frame: string): { event: string; data: unknown } | null {
  const lines = frame.split('\n');
  const payload = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!payload) return null;
  return { event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message', data: JSON.parse(payload) };
}
export async function askAgent(question: string, signal: AbortSignal, onProgress: (text: string) => void): Promise<AgentAnswer> {
  const response = await fetch(`${AGENT_URL}/ask/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ question }), signal });
  if (!response.ok || !response.body) throw new Error(`Agent unavailable (HTTP ${response.status}). You can still use the data panels.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const parsed = parseSSE(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
        if (!parsed) continue;
        if (parsed.event === 'answer' || parsed.event === 'error') {
          const answer = parsed.data as AgentAnswer;
          if (typeof answer.answer_text !== 'string') throw new Error('The agent returned an incomplete answer.');
          return answer;
        }
        onProgress(parsed.event.includes('tool') ? 'Reading data…' : 'Working on your question…');
      }
      if (done) throw new Error('The connection ended before an answer arrived. Please retry.');
    }
  } finally { await reader.cancel(); }
}
