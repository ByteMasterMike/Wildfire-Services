import { asText, sumMetric, type DatasetId, type EventRecord } from './data.ts';

export interface StatMetric {
  id: string;
  label: string;
  value: number | null;
  missing: number;
  unit: string;
}

export function statMetrics(events: EventRecord[], dataset: DatasetId): StatMetric[] {
  const distinct = (id: string, label: string, values: (string | null)[], unit: string): StatMetric => {
    const known = values.filter(value => value !== null);
    return { id, label, value: known.length || !values.length ? new Set(known).size : null, missing: values.length - known.length, unit };
  };
  const metrics: StatMetric[] = [{
    id: 'events', label: dataset === 'epss' ? 'Outages' : dataset === 'us_ignitions' ? 'Sample records' : 'Events',
    value: events.length, missing: 0, unit: 'events',
  }];
  if (dataset === 'calfire') metrics.push({ id: 'acres', label: 'Acres burned', ...sumMetric(events, 'acres'), unit: 'acres' });
  if (dataset === 'psps') metrics.push({ id: 'customers', label: 'Customer-event total', ...sumMetric(events, 'customers'), unit: 'customer-events' });
  if (dataset === 'epss') metrics.push(distinct('circuits', 'Circuits', events.map(event => asText(event.properties.circuit_id)), 'circuits'));
  if (['cpuc', 'calfire', 'epss'].includes(dataset)) metrics.push(distinct('counties', 'Counties', events.flatMap(event => event.county?.split(',').map(county => county.trim()) ?? [null]), 'counties'));
  if (dataset === 'cpuc' || dataset === 'psps') metrics.push(distinct('utilities', 'Utilities', events.map(event => event.utility), 'utilities'));
  return metrics;
}
