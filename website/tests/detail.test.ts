import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDataCache, getDetail } from '../src/api.ts';

test('circuit details preserve nested outages, zero values and exact date scope', async t => {
  clearDataCache(); t.after(clearDataCache);
  const body = {attributes: {circuit_id: '043371102'}, detail_fields: [], geometry: null, outages: [
    {id: 1, circuit_id: '043371102', start_date: '2024-01-01', cause: 'Unknown', customer_minutes: 0, restoration_min: null},
  ]};
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('dataset'), 'circuits');
    assert.equal(url.searchParams.get('id'), '043371102');
    assert.equal(url.searchParams.get('start_date'), '2024-01-01');
    assert.equal(url.searchParams.get('end_date'), '2024-01-31');
    return Response.json(body);
  });
  assert.deepEqual(await getDetail('epss', '043371102', {start: '2024-01-01', end: '2024-01-31'}), body);
});

test('PSPS details retain every affected circuit including missing geometry and leading zeros', async t => {
  clearDataCache(); t.after(clearDataCache);
  const body = {attributes: {event_name: '10/11/21 & Marin'}, detail_fields: [], geometry: null, affected_circuits: [
    {circuit_id: '043371102', circuit_name: 'Marin', geometry_missing: false},
    {circuit_id: '001234567', circuit_name: null, geometry_missing: true},
  ]};
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    assert.equal(new URL(input).searchParams.get('id'), '10/11/21 & Marin');
    return Response.json(body);
  });
  assert.deepEqual(await getDetail('psps', '10/11/21 & Marin'), body);
});

test('malformed nested record collections fail instead of crashing the detail dialog', async t => {
  clearDataCache(); t.after(clearDataCache);
  t.mock.method(globalThis, 'fetch', async () => Response.json({attributes: {}, detail_fields: [], geometry: null, affected_circuits: 'unavailable'}));
  await assert.rejects(getDetail('psps', 'broken'), /invalid related records/);
});
