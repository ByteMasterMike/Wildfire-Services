import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS } from '../src/data.ts';
import {
  applySettingsPatch,
  effectiveFilters,
  followWorkspaceYear,
  inheritsGlobalYear,
  parseStoredGlobalFilters,
  pinToYear,
  panelUsesGlobalYear,
  yearOverrideMarker,
} from '../src/globalFilters.ts';
import type { PanelSettings } from '../src/state';

const settings = (patch: Partial<PanelSettings> = {}): PanelSettings => ({
  dataset: 'cpuc', filters: { ...DEFAULT_FILTERS }, interval: 'monthly', groupBy: 'cause',
  measure: 'count', metric: 'events', datasets: ['cpuc'], overlays: [], ...patch,
});

test('inheriting panels follow a global year change without mutating stored filters', () => {
  const stored = settings({ filters: { ...DEFAULT_FILTERS, county: 'Marin' } });
  assert.equal(inheritsGlobalYear('map', stored), true);
  assert.deepEqual(effectiveFilters('map', stored, { year: 2022 }), { start: '2022-01-01', end: '2022-12-31', county: 'Marin', utility: '' });
  assert.deepEqual(stored.filters, { ...DEFAULT_FILTERS, county: 'Marin' });
  assert.deepEqual(effectiveFilters('stat_card', stored, { year: 2020 }), { start: '2020-01-01', end: '2020-12-31', county: 'Marin', utility: '' });
});

test('overridden panels keep their own year when the global year changes', () => {
  const stored = settings({ filterMode: 'override', filters: { start: '2021-01-01', end: '2021-12-31', county: '', utility: '' } });
  assert.deepEqual(effectiveFilters('map', stored, { year: 2024 }), stored.filters);
  assert.deepEqual(effectiveFilters('record_table', stored, { year: 2018 }), stored.filters);
});

test('reset-to-global returns a pinned panel to inheriting the workspace year', () => {
  const pinned = settings({ filterMode: 'override', filters: { start: '2021-01-01', end: '2021-12-31', county: 'Napa', utility: '' } });
  const reset = { ...pinned, ...followWorkspaceYear() };
  assert.equal(reset.filterMode, 'inherit');
  assert.deepEqual(effectiveFilters('comparison', reset, { year: 2023 }), { start: '2023-01-01', end: '2023-12-31', county: 'Napa', utility: '' });
});

test('pinning copies the current workspace year into the panel override', () => {
  const stored = settings({ filters: { ...DEFAULT_FILTERS, utility: 'PG&E' } });
  const patch = pinToYear(stored, { year: 2019 });
  assert.equal(patch.filterMode, 'override');
  assert.deepEqual(patch.filters, { start: '2019-01-01', end: '2019-12-31', county: '', utility: 'PG&E' });
});

test('editing dates while inheriting detaches the panel; county-only edits do not', () => {
  const stored = settings();
  const detached = applySettingsPatch('map', stored, { filters: { start: '2021-03-01', end: '2021-09-30', county: '', utility: '' } }, { year: 2024 });
  assert.equal(detached.filterMode, 'override');
  const countyOnly = applySettingsPatch('map', stored, { filters: { start: '2024-01-01', end: '2024-12-31', county: 'Marin', utility: '' } }, { year: 2024 });
  assert.equal(countyOnly.filterMode, undefined);
});

test('year comparison, seasonal profile, and agent stat cards ignore the global year', () => {
  const stored = settings();
  assert.equal(panelUsesGlobalYear('time_series', { ...stored, seriesMode: 'yearly' }), false);
  assert.equal(panelUsesGlobalYear('time_series', { ...stored, seriesMode: 'seasonal' }), false);
  assert.equal(panelUsesGlobalYear('stat_card', { ...stored, answerStat: { value: 1, label: 'Events', scope: 'All', period: '2023', unit: 'events' } }), false);
  assert.equal(panelUsesGlobalYear('map', stored), true);
  assert.deepEqual(effectiveFilters('time_series', { ...stored, seriesMode: 'yearly' }, { year: 2018 }), stored.filters);
});

test('the pinned marker renders only when a panel is actually overridden', () => {
  const inherited = settings();
  const overridden = settings({ filterMode: 'override', filters: { start: '2023-01-01', end: '2023-12-31', county: '', utility: '' } });
  assert.equal(yearOverrideMarker('map', inherited), null);
  assert.equal(yearOverrideMarker('map', overridden), 'Pinned: 2023');
  assert.equal(yearOverrideMarker('time_series', { ...overridden, seriesMode: 'yearly' }), null);
  assert.equal(yearOverrideMarker('stat_card', { ...overridden, answerStat: { value: 1, label: 'Events', scope: 'All', period: '2023', unit: 'events' } }), null);
});

test('stored global year rejects unknown values', () => {
  assert.deepEqual(parseStoredGlobalFilters(null), { year: 2024 });
  assert.deepEqual(parseStoredGlobalFilters('{"year":2021}'), { year: 2021 });
  assert.deepEqual(parseStoredGlobalFilters('{"year":1999}'), { year: 2024 });
});
