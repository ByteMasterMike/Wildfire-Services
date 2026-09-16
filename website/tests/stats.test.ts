import test from 'node:test';
import assert from 'node:assert/strict';
import { readSummary, type SummaryResponse } from '../src/stats.ts';

const response = (total: number, values: Record<string, [number | null, number]>): SummaryResponse => ({
  total, metrics: Object.entries(values).map(([id, [value, missing]]) => ({id, value, missing})),
});

test('summary renders server metrics with the existing labels and units', () => {
  const metrics = readSummary(response(3, {events: [3, 0], counties: [1, 1], utilities: [2, 0]}), 'cpuc');
  assert.deepEqual(metrics, [
    {id: 'events', label: 'Events', value: 3, missing: 0, unit: 'events'},
    {id: 'counties', label: 'Counties', value: 1, missing: 1, unit: 'counties'},
    {id: 'utilities', label: 'Utilities', value: 2, missing: 0, unit: 'utilities'},
  ]);
});

test('summary preserves missing acreage, observed zero, and customer-event labeling', () => {
  const missing = readSummary(response(1, {events: [1, 0], acres: [null, 1], counties: [null, 1]}), 'calfire');
  assert.equal(missing.find(metric => metric.id === 'acres')?.value, null);
  const zero = readSummary(response(1, {events: [1, 0], acres: [0, 0], counties: [1, 0]}), 'calfire');
  assert.equal(zero.find(metric => metric.id === 'acres')?.value, 0);
  const customers = readSummary(response(2, {events: [2, 0], customers: [100, 0], utilities: [1, 0]}), 'psps');
  assert.deepEqual(customers.find(metric => metric.id === 'customers'), {id: 'customers', label: 'Customer-event total', value: 100, missing: 0, unit: 'customer-events'});
  assert.ok(customers.every(metric => !/customers affected/i.test(metric.label)));
});

test('incomplete, duplicate and inconsistent aggregate responses fail loudly', () => {
  assert.throws(() => readSummary(response(3, {events: [3, 0]}), 'cpuc'), /incomplete/);
  assert.throws(() => readSummary({total: 3, metrics: [{id: 'events', value: 3, missing: 0}, {id: 'events', value: 3, missing: 0}, {id: 'counties', value: 1, missing: 0}]}, 'cpuc'), /incomplete/);
  assert.throws(() => readSummary(response(3, {events: [2, 0], counties: [1, 0], utilities: [1, 0]}), 'cpuc'), /inconsistent/);
  assert.throws(() => readSummary(response(1, {events: [1, 0], acres: [null, 2], counties: [1, 0]}), 'calfire'), /inconsistent/);
});

test('empty populations and national sample summaries retain their meaning', () => {
  assert.ok(readSummary(response(0, {events: [0, 0], acres: [0, 0], counties: [0, 0]}), 'calfire').every(metric => metric.value === 0));
  assert.deepEqual(readSummary(response(1, {events: [1, 0]}), 'us_ignitions'), [{id: 'events', label: 'Sample records', value: 1, missing: 0, unit: 'events'}]);
});
