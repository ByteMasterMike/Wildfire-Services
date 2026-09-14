import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPosition, spatialFields } from '../src/spatial.ts';
import type { Boundary, EventRecord } from '../src/data.ts';

const record: EventRecord = { id: '1', dataset: 'cpuc', name: 'Test event', date: '2024-01-01', county: 'Marin', utility: 'SCE', cause: null, acres: null, geometry: {type: 'Point', coordinates: [-122.5, 38]}, properties: {} };
const polygon = (properties: Record<string, unknown>): Boundary => ({
  type: 'Feature', properties, geometry: {type: 'Polygon', coordinates: [[[-123,37],[-122,37],[-122,39],[-123,39],[-123,37]]]},
});
const grid = [{id: 0, lat: 38, lon: -122.5}];

test('event context uses point-in-polygon territory rather than utility attribution', () => {
  const fields = Object.fromEntries(spatialFields(record, [38, -122.5], grid, {territories: [polygon({utility: 'PGE'})], hftd: [polygon({tier: 'Tier 3'})]}));
  assert.equal(fields['Coordinates'], '38.0000, -122.5000');
  assert.equal(fields['IOU territory'], 'PG&E');
  assert.equal(fields['HFTD'], 'Tier 3');
  assert.equal(fields['County'], 'Marin');
  assert.equal(fields['Grid cell'], '0');
});

test('unloaded or failed boundaries stay distinct from no coverage, and paths show the hovered map position', () => {
  const pending = Object.fromEntries(spatialFields(record, [38, -122.5], grid));
  assert.equal(pending['HFTD'], 'Loading…');
  const failed = Object.fromEntries(spatialFields(record, [38, -122.5], grid, undefined, true));
  assert.equal(failed['HFTD'], 'Unavailable');
  const path = {...record, county: null, geometry: {type: 'LineString' as const, coordinates: [[-122,38],[-121,39]]}};
  const outside = Object.fromEntries(spatialFields(path, [39, -121], grid, {territories: [polygon({utility: 'PGE'})], hftd: [polygon({tier: 'Tier 3'})]}));
  assert.equal(outside['Map position'], '39.0000, -121.0000');
  assert.equal(outside['IOU territory'], 'Outside IOU territories');
  assert.equal(outside['HFTD'], 'None');
  assert.equal(outside['County'], 'Not recorded');
  assert.equal(outside['Grid cell'], 'Outside grid');
});

test('location bubble stays inside narrow panels near the top, bottom and horizontal edges', () => {
  for (const [x, y] of [[2,10],[320,10],[2,455],[320,455],[160,200]]) {
    const position = previewPosition(x,y,280,230,330,468);
    assert.ok(position.left >= 8 && position.left + 280 <= 322);
    assert.ok(position.top >= 8 && position.top + 230 <= 460);
    assert.ok(position.arrow >= 16 && position.arrow <= 264);
  }
  assert.equal(previewPosition(160,10,280,230,330,468).above, false);
  assert.equal(previewPosition(160,455,280,230,330,468).above, true);
});
