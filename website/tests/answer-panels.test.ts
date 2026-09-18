import test from 'node:test';
import assert from 'node:assert/strict';
import { panelsFromAnswer, unsupportedViewNotice } from '../src/answerPanels.ts';
import type { AgentAnswer } from '../src/api.ts';

const answer = (views: NonNullable<AgentAnswer['views']>): AgentAnswer => ({status: 'ok', answer_text: 'Recorded results.', views});

test('record-table specs use the dataset names emitted by the agent planner', () => {
  const datasets = {cpuc_ignitions: 'cpuc', epss_outages: 'epss', calfire_incidents: 'calfire', psps_events: 'psps', us_ignitions: 'us_ignitions'};
  for (const [source, expected] of Object.entries(datasets)) {
    const result = panelsFromAnswer(answer([{type: 'record_table', params: {dataset: source, year: 2024, row_limit: 25}}]));
    assert.equal(result.length, 1, source);
    assert.equal(result[0].type, 'record_table');
    assert.equal(result[0].settings.dataset, expected);
    assert.deepEqual(result[0].settings.filters, {start: '2024-01-01', end: '2024-12-31', utility: '', county: ''});
  }
});

test('map and series specs preserve exact dates, filters, overlays and interval', () => {
  const result = panelsFromAnswer(answer([
    {type: 'map', params: {datasets: ['ignitions'], start_date: '2023-03-15', end_date: '2024-07-31', utility: 'PGE', county: 'Marin', show_hftd: true, show_territory: true}},
    {type: 'time_series', params: {dataset: 'calfire', year: 2024, interval: 'weekly', incident_type_mode: 'wildfire_default'}},
  ]));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].settings.filters, {start: '2023-03-15', end: '2024-07-31', utility: 'PG&E', county: 'Marin'});
  assert.deepEqual(result[0].settings.overlays, ['hftd', 'territories']);
  assert.deepEqual(result[0].settings.datasets, ['cpuc']);
  assert.equal(result[1].settings.interval, 'weekly');
  assert.deepEqual(result[1].settings.datasets, ['calfire']);
});

test('stat specs retain source values, including zero counts and risk probabilities', () => {
  const result = panelsFromAnswer(answer([
    {type: 'stat_card', params: {kind: 'count', source_dataset: 'cpuc_ignitions', value: 0, label: 'Events', scope: 'Marin', period: '2024', unit: 'events'}},
    {type: 'stat_card', params: {kind: 'risk', source_dataset: 'cnhpp', value: 0.12, label: 'P(≥1 ignition)', scope: 'cell 20', period: '2024-06-01', unit: 'risk'}},
  ]));
  assert.equal(result[0].settings.answerStat?.value, 0);
  assert.equal(result[0].settings.answerStat?.sourceDataset, 'cpuc_ignitions');
  assert.deepEqual(result[1].settings.answerStat, {value: 0.12, label: 'P(≥1 ignition)', scope: 'cell 20', period: '2024-06-01', unit: 'risk', sourceDataset: 'cnhpp'});
});

test('unrepresentable incident filters and missing dates never become a different query', () => {
  const result = panelsFromAnswer(answer([
    {type: 'time_series', params: {dataset: 'calfire', year: 2024, incident_type_mode: 'all'}},
    {type: 'record_table', params: {dataset: 'cpuc_ignitions'}},
  ]));
  assert.deepEqual(result, []);
});

test('answer adaptation does not mutate the service payload or share panel settings', () => {
  const response = answer([{type: 'map', params: {datasets: ['ignitions'], year: 2024, show_hftd: true}}]);
  const before = structuredClone(response);
  const first = panelsFromAnswer(response);
  first[0].settings.overlays!.push('territories');
  first[0].settings.filters!.county = 'Marin';
  assert.deepEqual(response, before);
  assert.deepEqual(panelsFromAnswer(response)[0].settings.overlays, ['hftd']);
  assert.equal(panelsFromAnswer(response)[0].settings.filters?.county, '');
});

test('unsupported Ask views receive a visible, deduplicated notice while supported views remain usable', () => {
  const response = answer([
    {type: 'comparison', params: {kind: 'utilities', metric: 'count'}},
    {type: 'comparison', params: {kind: 'ranking', metric: 'count'}},
    {type: 'spatial_context', params: {lat: 38, lon: -122}},
    {type: 'record_table', params: {dataset: 'cpuc_ignitions', year: 2024}},
  ]);
  const original = structuredClone(response);
  assert.equal(unsupportedViewNotice(response), 'Comparison and spatial context views are not supported here yet.');
  assert.equal(panelsFromAnswer(response).length, 1);
  assert.deepEqual(response, original);
  assert.equal(unsupportedViewNotice(answer([{type: 'spatial_context', params: {lat: 38, lon: -122}}])), 'Spatial context view is not supported here yet.');
  assert.equal(unsupportedViewNotice(answer([])), null);
  assert.equal(unsupportedViewNotice({status: 'error', answer_text: 'Unavailable'}), null);
});
