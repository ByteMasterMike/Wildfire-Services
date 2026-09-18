import type { AgentAnswer, AgentStreamEvent, AgentTrajectoryStep } from './agentContracts.ts';

export interface TraceStep {
  tool: string;
  service: string;
  status: 'Running' | 'Completed' | 'Failed' | 'No result';
  arguments: Record<string, unknown>;
  error?: string;
  evidenceId?: string;
  latencyMs?: number;
  qualification?: boolean;
}
function serviceName(tool: string): string {
  if (tool.startsWith('data_query_')) return 'Data query';
  if (tool.startsWith('visualization_')) return 'Visualization';
  if (tool === 'comparison_run') return 'Comparison';
  if (tool === 'risk_forecast') return 'Risk forecasting';
  return 'Tool';
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function step(data: Record<string, unknown>, finished: boolean): TraceStep {
  const tool = String(data.tool);
  const error = object(data.error);
  return {
    tool, service: serviceName(tool), arguments: object(data.arguments),
    status: data.ok === true ? 'Completed' : data.ok === false ? 'Failed' : finished ? 'No result' : 'Running',
    error: typeof error.message === 'string' ? error.message : typeof error.code === 'string' ? error.code : undefined,
    evidenceId: typeof data.evidence_id === 'string' ? data.evidence_id : undefined,
    latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
    qualification: data.qualification_call === true,
  };
}
export function traceSteps(answer: AgentAnswer | undefined, events: readonly AgentStreamEvent[], finished: boolean): TraceStep[] {
  const finalCalls = answer?.trajectory?.filter((item: AgentTrajectoryStep) => item.type === 'tool_call' && typeof item.tool === 'string') ?? [];
  if (finalCalls.length) return finalCalls.map(item => step(item, true));
  const calls: TraceStep[] = [];
  for (const {event, data} of events) {
    if (typeof data.tool !== 'string') continue;
    const pending = [...calls].reverse().find(item => item.tool === data.tool && item.status === 'Running');
    if (event === 'tool_call') calls.push(step(data, false));
    if (event === 'retry') {
      if (pending) {
        pending.status = 'Failed';
        pending.error = typeof data.error_code === 'string' ? data.error_code : 'Retry requested';
      }
    }
    if (event === 'tool_result') {
      const result = step(data, true);
      if (pending) Object.assign(pending, result); else calls.push(result);
    }
  }
  if (calls.length) return calls.map(item => finished && item.status === 'Running' ? {...item, status: 'No result'} : item);
  return (answer?.evidence ?? []).map(item => step({...item, evidence_id: item.id, ok: true}, true));
}
