import test from 'node:test';
import assert from 'node:assert/strict';
import { medicalExposureMetrics } from '../src/exposure.ts';
import type { EventRecord } from '../src/data.ts';

function outage(id: string, medical: number | null, lifeSupport: number | null): EventRecord {
  return {
    id,
    dataset: 'epss',
    name: `Outage ${id}`,
    date: '2024-07-05',
    county: null,
    utility: 'PG&E',
    cause: null,
    acres: null,
    geometry: null,
    properties: {medical_baseline: medical, life_support: lifeSupport},
  };
}

test('medical exposure sums customer-events and retains missing-value counts', () => {
  const metrics = medicalExposureMetrics([
    outage('1', 10, 4),
    outage('2', 6, null),
    outage('3', null, 3),
  ]);
  assert.deepEqual(metrics, [
    {id: 'outages', label: 'EPSS outages', value: 3, missing: 0, unit: 'events'},
    {id: 'medical_baseline', label: 'Medical baseline customer-event total', value: 16, missing: 1, unit: 'customer-events'},
    {id: 'life_support', label: 'Life support customer-event total', value: 7, missing: 1, unit: 'customer-events'},
  ]);
});
