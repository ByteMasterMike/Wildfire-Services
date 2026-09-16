import test from 'node:test';
import assert from 'node:assert/strict';
import { askAgent } from '../src/api.ts';
import type { AgentAnswer, AgentStreamEvent, ComponentSpec } from '../src/agentContracts.ts';

const views: ComponentSpec[] = [
  {type: 'map', params: {datasets: ['ignitions', 'calfire'], year: 2024, extent: 'territory', utility: 'PGE', highlight_ids: ['001'], show_territory: true}, evidence_ids: ['map-evidence'], artifact_refs: ['map-artifact']},
  {type: 'time_series', params: {dataset: 'psps', interval: 'monthly', start_date: '2024-01-01', end_date: '2024-12-31'}, evidence_ids: ['series-evidence']},
  {type: 'comparison', params: {kind: 'periods', metric: 'ignition_count', scope_type: 'utility', scope: 'PGE', ignition_definition: 'spatial', normalize: 'per_km2', period_a_start: '2023-01-01', period_a_end: '2023-12-31', period_b_start: '2024-01-01', period_b_end: '2024-12-31'}, evidence_ids: ['comparison-evidence']},
  {type: 'record_table', params: {dataset: 'epss_outages', year: 2024, row_limit: 10, columns: 'default'}, evidence_ids: ['records-evidence'], artifact_refs: ['records-artifact']},
  {type: 'stat_card', params: {kind: 'risk', value: 0, label: 'P(≥1 ignition)', scope: 'Cell 0', period: '2024-01-01', source_dataset: 'cnhpp', unit: 'risk'}, evidence_ids: ['risk-evidence']},
  {type: 'spatial_context', params: {lat: 38, lon: -122, cell_id: 0, county: null, hftd_tier: null, iou: 'PGE'}, evidence_ids: ['spatial-evidence']},
];

test('SSE retains every ComponentSpec and its evidence, artifacts and scope for later rendering', async t => {
  const response: AgentAnswer = {
    answer_text: '中文 response', status: 'ok', request_id: 'request-1', views,
    view_status: 'applied', view_scope: {year: 2024, utility: 'PGE'},
    route: {path: 'deterministic', answer_origin: 'deterministic'},
    evidence: [{id: 'records-evidence', tool: 'data_query_records', arguments: {year: 2024}, summary: {total: 0}}],
    artifacts: [{ref: 'records-artifact', kind: 'records', expires_at: '2026-09-16T15:00:00Z'}],
    trajectory: [{type: 'tool_call', tool: 'data_query_records', arguments: {year: 2024}, ok: true, latency_ms: 0, evidence_id: 'records-evidence'}],
    qualifications: [{id: 'definition', text: 'Use the source definition.', source: 'dataset_definition'}],
    timings_ms: {total: 12}, model_metrics: {turns: 0},
  };
  const events: AgentStreamEvent[] = [
    {event: 'routing', data: {path: 'deterministic'}},
    {event: 'tool_call', data: {tool: 'data_query_records', arguments: {year: 2024}, attempt: 1}},
    {event: 'tool_result', data: {tool: 'data_query_records', ok: true, arguments: {year: 2024}, summary: {total: 0}}},
  ];
  const wire = [...events, {event: 'answer', data: response}].map(item => `event: ${item.event}\r\ndata: ${JSON.stringify(item.data)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(wire);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  }})));
  const observed: AgentStreamEvent[] = [];
  const result = await askAgent('Question', new AbortController().signal, () => {}, event => observed.push(event));
  assert.deepEqual(result, response);
  assert.deepEqual(observed, events);
});

test('stream interruption retains already received tool events and releases the reader', async t => {
  let cancelled = false;
  const encoder = new TextEncoder();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(controller) {
    controller.enqueue(encoder.encode('event: tool_call\ndata: {"tool":"comparison_run","arguments":{"kind":"periods"}}\n\nevent: routing\ndata: null\n\n'));
  }, cancel() { cancelled = true; }})));
  const events: AgentStreamEvent[] = [];
  await assert.rejects(askAgent('Question', new AbortController().signal, () => {}, event => events.push(event)), /invalid stream event/);
  assert.equal(events[0].data.tool, 'comparison_run');
  assert.equal(cancelled, true);
});
