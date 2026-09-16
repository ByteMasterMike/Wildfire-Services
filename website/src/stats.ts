import type { DatasetId } from './data.ts';

export interface StatMetric {
  id: string;
  label: string;
  value: number | null;
  missing: number;
  unit: string;
}

export interface SummaryResponse {total: number; metrics: {id: string; value: number | null; missing: number}[]}

export function readSummary(response: SummaryResponse, dataset: DatasetId): StatMetric[] {
  const definitions: {id: string; label: string; unit: string}[] = [{
    id: 'events', label: dataset === 'epss' ? 'Outages' : dataset === 'us_ignitions' ? 'Sample records' : 'Events',
    unit: 'events',
  }];
  if (dataset === 'calfire') definitions.push({id: 'acres', label: 'Acres burned', unit: 'acres'});
  if (dataset === 'psps') definitions.push({id: 'customers', label: 'Customer-event total', unit: 'customer-events'});
  if (dataset === 'epss') definitions.push({id: 'circuits', label: 'Circuits', unit: 'circuits'});
  if (['cpuc', 'calfire', 'epss'].includes(dataset)) definitions.push({id: 'counties', label: 'Counties', unit: 'counties'});
  if (dataset === 'cpuc' || dataset === 'psps') definitions.push({id: 'utilities', label: 'Utilities', unit: 'utilities'});
  if (!Number.isSafeInteger(response.total) || response.total < 0 || !Array.isArray(response.metrics)
    || response.metrics.length !== definitions.length || new Set(response.metrics.map(metric => metric?.id)).size !== definitions.length) throw new Error('The summary response is incomplete.');
  return definitions.map(definition => {
    const metric = response.metrics.find(item => item?.id === definition.id);
    if (!metric || (metric.value !== null && (typeof metric.value !== 'number' || !Number.isFinite(metric.value)))
      || !Number.isSafeInteger(metric.missing) || metric.missing < 0 || metric.missing > response.total
      || (metric.id === 'events' && (metric.value !== response.total || metric.missing !== 0))) throw new Error('The summary response is inconsistent.');
    return {...definition, value: metric.value, missing: metric.missing};
  });
}
