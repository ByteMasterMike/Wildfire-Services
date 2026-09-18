import test from 'node:test';
import assert from 'node:assert/strict';
import { customerEventsOverTime } from '../src/customerEvents.ts';
import type { EventRecord } from '../src/data.ts';

function event(id: string, date: string, customers: number | null): EventRecord {
  return {id, date, dataset:'psps', name:id, county:null, utility:'PG&E', cause:null, acres:null, geometry:null, properties:{customers_deenergized:customers}};
}

test('customer-event series sums records into selected calendar buckets', () => {
  const result = customerEventsOverTime([
    event('a','2024-01-01',10),
    event('b','2024-01-15',20),
    event('c','2024-02-03',7),
    event('d','2024-02-04',null),
  ], '2024-01-01', '2024-02-29', 'monthly');
  assert.deepEqual(result, {
    buckets: [
      {start:'2024-01-01', end:'2024-01-31', count:30},
      {start:'2024-02-01', end:'2024-02-29', count:7},
    ],
    total:37,
    missing:1,
  });
});
