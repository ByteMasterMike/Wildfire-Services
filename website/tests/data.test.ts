import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDaily, DEFAULT_FILTERS, filterError, groupedCounts, recordsFromFeatures, sumMetric, unavailableReason, type EventRecord, type LayerResponse } from '../src/data.ts';
import { askAgent, collectPages, parseSSE } from '../src/api.ts';

function page(ids: number[], total: number): LayerResponse {
  return { geojson: { type: 'FeatureCollection', features: ids.map(id => ({ type: 'Feature', id, geometry: null, properties: { id, event_date: '2024-01-01' } })) }, meta: { total, returned: ids.length, truncated: ids.length < total } };
}
function event(id: string, cause: string | null, acres: number | null = null): EventRecord {
  return { id, dataset: 'epss', name: id, date: '2024-01-01', county: 'Marin', utility: 'PG&E', cause, acres, geometry: null, properties: {} };
}
test('pagination includes the final page and refuses a changing or overlapping snapshot', async () => {
  const offsets: number[] = [];
  const result = await collectPages(async offset => { offsets.push(offset); return offset ? page([3], 3) : page([1,2], 3); });
  assert.deepEqual(offsets, [0,2]); assert.equal(result.geojson.features.length, 3); assert.equal(result.meta.truncated, false);
  await assert.rejects(collectPages(async offset => offset ? page([2], 3) : page([1,2], 3)), /Overlapping/);
  await assert.rejects(collectPages(async offset => offset ? page([], 3) : page([1,2], 3)), /pagination stopped/);
  await assert.rejects(collectPages(async offset => offset ? page([3], 4) : page([1,2], 3)), /Data changed/);
});
test('EPSS counts outage records instead of circuit features and preserves leading-zero IDs', () => {
  const layer = page([1,2], 2);
  layer.geojson.features[0].properties = { circuit_id: '043371102', event_count: 2, outages: [{id: 1, circuit_id:'043371102', start_date:'2024-01-02'}, {id:2, start_date:'2024-01-03'}] };
  layer.geojson.features[1].properties = { outages: [{id:3, start_date:'2024-02-02'}] };
  const records = recordsFromFeatures('epss', layer.geojson.features);
  assert.equal(records.length, 3); assert.equal(records[0].properties.circuit_id, '043371102');
  assert.equal(records[0].utility, 'PG&E');
  assert.throws(() => recordsFromFeatures('epss', page([1],1).geojson.features), /missing event records/);
});
test('cause totals retain unknown and missing categories; unavailable utilities stay null', () => {
  const records = [event('1','Unknown'),event('2',null),event('3','Weather'),event('4','Unknown')];
  const causes = groupedCounts(records, 'epss', 'cause', DEFAULT_FILTERS);
  assert.equal(causes.reduce((sum,row) => sum + (row.value ?? 0),0),4);
  assert.equal(causes.find(row => row.key === 'Unknown')?.value,2);
  assert.equal(causes.find(row => row.key === 'Not recorded')?.value,1);
  assert.equal(groupedCounts(records, 'epss', 'utility', DEFAULT_FILTERS).find(row => row.key === 'SCE')?.value,null);
  assert.match(unavailableReason('epss', {...DEFAULT_FILTERS,utility:'SCE'})!,/PG&E only/);
  assert.match(unavailableReason('psps', {...DEFAULT_FILTERS,county:'Marin'})!,/county filtering/);
});
test('calendar buckets conserve counts across a year boundary, leap day and clipped weeks', () => {
  const daily = [{start:'2023-12-31',end:'2023-12-31',count:2},{start:'2024-01-01',end:'2024-01-01',count:3},{start:'2024-01-02',end:'2024-01-02',count:0},{start:'2024-02-29',end:'2024-02-29',count:4}];
  for (const interval of ['daily','weekly','monthly','quarterly'] as const) assert.equal(aggregateDaily(daily,interval).reduce((sum,b) => sum+b.count,0),9);
  assert.deepEqual(aggregateDaily(daily,'weekly').slice(0,2),[{start:'2023-12-31',end:'2023-12-31',count:2},{start:'2024-01-01',end:'2024-01-02',count:3}]);
  assert.equal(filterError({...DEFAULT_FILTERS,start:'2024-02-30'}),'Choose a valid start and end date.');
  assert.equal(filterError({...DEFAULT_FILTERS,start:'2025-01-01'}),'Start date must be on or before end date.');
});
test('missing numeric values are distinct from zeros and empty populations', () => {
  assert.deepEqual(sumMetric([event('1',null)],'acres'),{value:null,missing:1});
  assert.deepEqual(sumMetric([event('1',null,0),event('2',null)],'acres'),{value:0,missing:1});
  assert.deepEqual(sumMetric([],'acres'),{value:0,missing:0});
});
test('SSE parsing handles data lines and fragmented answers, and rejects premature closure', async t => {
  assert.deepEqual(parseSSE('event: answer\ndata: {"answer_text":"Ready",\ndata: "status":"ok"}'), { event:'answer',data:{answer_text:'Ready',status:'ok'} });
  const encoder = new TextEncoder();
  t.mock.method(globalThis,'fetch', async () => new Response(new ReadableStream({ start(controller) {
    for (const part of ['event: tool_done\ndata: {}\n\nevent: ans','wer\ndata: {"answer_text":"532 records",','"status":"ok"}\n\n']) controller.enqueue(encoder.encode(part));
    controller.close();
  } }),{status:200}));
  const answer = await askAgent('How many?', new AbortController().signal, () => {});
  assert.equal(answer.answer_text,'532 records');
  t.mock.restoreAll();
  t.mock.method(globalThis,'fetch', async () => new Response('event: tool_done\ndata: {}\n\n'));
  await assert.rejects(askAgent('How many?',new AbortController().signal,()=>{}),/before an answer/);
});
