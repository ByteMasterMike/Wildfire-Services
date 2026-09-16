import test from 'node:test';
import assert from 'node:assert/strict';
import { traceSteps } from '../src/agentTrace.ts';
import type { AgentAnswer, AgentStreamEvent } from '../src/agentContracts.ts';

test('live tool calls become completed steps without duplicating the call and result', () => {
  const events: AgentStreamEvent[] = [{event: 'tool_call', data: {tool: 'data_query_records', arguments: {year: 2024}}}];
  assert.equal(traceSteps(undefined, events, false)[0].status, 'Running');
  assert.equal(traceSteps(undefined, events, true)[0].status, 'No result');
  events.push({event: 'tool_result', data: {tool: 'data_query_records', arguments: {year: 2024}, ok: true}});
  const steps = traceSteps(undefined, events, true);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].status, 'Completed');
  assert.equal(steps[0].service, 'Data query');
});

test('retries retain the failed attempt and complete the correct subsequent call', () => {
  const events: AgentStreamEvent[] = [
    {event: 'tool_call', data: {tool: 'visualization_create', arguments: {year: 2024}, attempt: 1}},
    {event: 'retry', data: {tool: 'visualization_create', error_code: 'http_503'}},
    {event: 'tool_call', data: {tool: 'visualization_create', arguments: {year: 2024}, attempt: 2}},
    {event: 'tool_result', data: {tool: 'visualization_create', arguments: {year: 2024}, ok: true}},
  ];
  const before = structuredClone(events);
  const steps = traceSteps(undefined, events, true);
  assert.deepEqual(steps.map(step => step.status), ['Failed', 'Completed']);
  assert.equal(steps[0].error, 'http_503');
  assert.deepEqual(events, before);
});

test('final trajectory includes companion calls and evidence without duplicate streamed steps', () => {
  const response: AgentAnswer = {status: 'ok', answer_text: 'Result', trajectory: [
    {type: 'slot_resolution', slots: {year: 2024}},
    {type: 'tool_call', tool: 'data_query_records', arguments: {dataset: 'cpuc_ignitions'}, ok: true, latency_ms: 0, evidence_id: 'e1'},
    {type: 'tool_call', tool: 'data_query_spatial', arguments: {utility: 'PGE'}, ok: true, qualification_call: true, evidence_id: 'e2'},
  ]};
  const steps = traceSteps(response, [{event: 'tool_call', data: {tool: 'data_query_records'}}], true);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].latencyMs, 0);
  assert.equal(steps[1].qualification, true);
  assert.equal(steps[1].evidenceId, 'e2');
});

test('evidence-only answers and unsuccessful results retain their actual status', () => {
  const response: AgentAnswer = {status: 'ok', answer_text: 'Result', evidence: [{id: 'e1', tool: 'risk_forecast', arguments: {cell_id: 0}, summary: {risk: 0}}]};
  assert.equal(traceSteps(response, [], true)[0].service, 'Risk forecasting');
  const steps = traceSteps(undefined, [{event: 'tool_result', data: {tool: 'comparison_run', ok: false, error: {code: 'http_503', message: 'Service unavailable'}}}], true);
  assert.equal(steps[0].status, 'Failed');
  assert.equal(steps[0].error, 'Service unavailable');
});
