import test from 'node:test';
import assert from 'node:assert/strict';
import { statMetrics } from '../src/stats.ts';
import type { EventRecord } from '../src/data.ts';

const event = (id: string, patch: Partial<EventRecord> = {}): EventRecord => ({
  id, dataset: 'cpuc', name: id, date: '2024-01-01', county: 'Marin', utility: 'PG&E',
  cause: null, acres: null, geometry: null, properties: {}, ...patch,
});

test('summary separates event totals from distinct counties, utilities and circuits', () => {
  const records = [event('1', { properties: { circuit_id: '043371102' } }), event('2', { properties: { circuit_id: '043371102' } }), event('3', { county: null, utility: 'SCE', properties: { circuit_id: '012041102' } })];
  assert.deepEqual(statMetrics(records, 'cpuc').map(({id, value, missing}) => ({id, value, missing})), [
    {id: 'events', value: 3, missing: 0}, {id: 'counties', value: 1, missing: 1}, {id: 'utilities', value: 2, missing: 0},
  ]);
  assert.equal(statMetrics(records, 'epss').find(metric => metric.id === 'circuits')?.value, 2);
});

test('summary keeps missing acreage distinct from zero and sums customer-event totals', () => {
  const unknown = statMetrics([event('1')], 'calfire').find(metric => metric.id === 'acres')!;
  assert.equal(unknown.value, null);
  assert.equal(unknown.missing, 1);
  const partial = statMetrics([event('1', {acres: 0}), event('2', {acres: 7}), event('3')], 'calfire');
  assert.equal(partial.find(metric => metric.id === 'acres')?.value, 7);
  assert.equal(partial.find(metric => metric.id === 'acres')?.missing, 1);
  const customers = statMetrics([event('1', {properties: {customers_deenergized: 50}}), event('2', {properties: {customers_deenergized: 50}})], 'psps');
  assert.equal(customers.find(metric => metric.id === 'customers')?.value, 100);
  assert.equal(customers.find(metric => metric.id === 'customers')?.unit, 'customer-events');
  assert.ok(customers.every(metric => metric.id !== 'counties' && metric.id !== 'acres'));
});

test('multi-county CAL FIRE events contribute each county once across the whole selection', () => {
  const metrics = statMetrics([event('1', {county: 'Los Angeles, Ventura'}), event('2', {county: 'Los Angeles'}), event('3', {county: null})], 'calfire');
  const counties = metrics.find(metric => metric.id === 'counties')!;
  assert.equal(counties.value, 2);
  assert.equal(counties.missing, 1);
});

test('empty filtered populations are zero while missing geographic attributes stay unavailable', () => {
  assert.ok(statMetrics([], 'calfire').every(metric => metric.value === 0 && metric.missing === 0));
  assert.equal(statMetrics([event('1', {county: null})], 'cpuc').find(metric => metric.id === 'counties')?.value, null);
  assert.deepEqual(statMetrics([event('1')], 'us_ignitions').map(metric => metric.id), ['events']);
});
