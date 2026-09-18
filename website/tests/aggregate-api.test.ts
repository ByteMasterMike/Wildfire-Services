import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearDataCache, getGroupedCounts, getRegionalSeries, getSummary } from '../src/api.ts';
import { DEFAULT_FILTERS } from '../src/data.ts';

test('production build profile pins Data Query to the live CloudFront URL', () => {
  const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../.env.production'), 'utf8');
  const value = text.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith('VITE_DATA_QUERY_URL='))?.slice('VITE_DATA_QUERY_URL='.length);
  assert.equal(value, 'https://d3t70p3if3twy3.cloudfront.net/api/data-query');
});

test('grouped counts fetch one geometry-free response and retain all categories', async t => {
  clearDataCache(); t.after(clearDataCache);
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input); urls.push(url);
    return Response.json({total: 60, rows: Array.from({length: 60}, (_, index) => ({key: `County ${index}`, value: 1}))});
  });
  const result = await getGroupedCounts('cpuc', {...DEFAULT_FILTERS, utility: 'PG&E'}, 'county');
  assert.equal(result.rows.length, 60);
  assert.equal(result.total, 60);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname.endsWith('/grouped-counts'), true);
  assert.equal(urls[0].searchParams.get('dataset'), 'cpuc_ignitions');
  assert.equal(urls[0].searchParams.get('utility'), 'PGE');
  assert.equal(urls[0].searchParams.has('limit'), false);
});

test('grouped counts retain unknown causes, missing causes and unavailable utilities', async t => {
  clearDataCache(); t.after(clearDataCache);
  t.mock.method(globalThis, 'fetch', async (input: string) => Response.json(new URL(input).searchParams.get('group_by') === 'cause'
    ? {total: 4, rows: [{key: 'Unknown', value: 2}, {key: 'Not recorded', value: 1}, {key: 'Weather', value: 1}]}
    : {total: 4, rows: [{key: 'PG&E', value: 4}, {key: 'SCE', value: null}, {key: 'SDG&E', value: null}]}));
  const causes = await getGroupedCounts('epss', DEFAULT_FILTERS, 'cause');
  assert.equal(causes.rows.find(row => row.key === 'Unknown')?.value, 2);
  assert.equal(causes.rows.find(row => row.key === 'Not recorded')?.value, 1);
  assert.equal((await getGroupedCounts('epss', DEFAULT_FILTERS, 'utility')).rows.find(row => row.key === 'SCE')?.value, null);
});

test('summary downloads totals without any map-layer request', async t => {
  clearDataCache(); t.after(clearDataCache);
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    urls.push(new URL(input));
    return Response.json({total: 33457, metrics: [{id: 'events', value: 33457, missing: 0}]});
  });
  assert.equal((await getSummary('us_ignitions', DEFAULT_FILTERS))[0].value, 33457);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname.endsWith('/summary'), true);
  assert.equal(urls[0].searchParams.get('dataset'), 'us_ignitions');
});

test('regional series use the selected interval and return every division for rendering and exports', async t => {
  clearDataCache(); t.after(clearDataCache);
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input);
    assert.equal(url.pathname.endsWith('/regional-series'), true);
    assert.equal(url.searchParams.get('interval'), 'quarterly');
    assert.equal(url.searchParams.get('county'), 'Marin');
    return Response.json({total: 18, series: Array.from({length: 18}, (_, index) => ({name: `Division ${index}`, total: 1, buckets: [
      {start: '2024-01-01', end: '2024-03-31', count: 1}, {start: '2024-04-01', end: '2024-06-30', count: 0},
      {start: '2024-07-01', end: '2024-09-30', count: 0}, {start: '2024-10-01', end: '2024-12-31', count: 0},
    ]}))});
  });
  const result = await getRegionalSeries({...DEFAULT_FILTERS, county: 'Marin'}, 'quarterly');
  assert.equal(result.series.length, 18);
  assert.equal(result.total, 18);
  assert.deepEqual(result.series[0].buckets.map(bucket => bucket.count), [1, 0, 0, 0]);
});

test('aggregate totals cannot silently truncate and backend failures never fall back to GeoJSON', async t => {
  clearDataCache(); t.after(clearDataCache);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({total: 60, rows: [{key: 'Marin', value: 1}]}));
  await assert.rejects(getGroupedCounts('cpuc', DEFAULT_FILTERS, 'county'), /complete dataset/);
  clearDataCache();
  fetch.mock.mockImplementation(async () => new Response('Not deployed', {status: 404}));
  await assert.rejects(getSummary('cpuc', DEFAULT_FILTERS), /HTTP 404/);
  assert.equal(fetch.mock.callCount(), 2);
});

test('unsupported aggregate filters are blocked before network access', async t => {
  clearDataCache(); t.after(clearDataCache);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  await assert.rejects(getSummary('psps', {...DEFAULT_FILTERS, county: 'Marin'}), /not available/);
  await assert.rejects(getGroupedCounts('epss', {...DEFAULT_FILTERS, utility: 'SCE'}, 'utility'), /PG&E only/);
  await assert.rejects(getRegionalSeries({...DEFAULT_FILTERS, utility: 'SCE'}, 'daily'), /PG&E only/);
  assert.equal(fetch.mock.callCount(), 0);
});
