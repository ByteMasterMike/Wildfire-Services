import { asNumber, type EventRecord } from './data.ts';

export interface ExposureMetric {
  id: 'outages' | 'medical_baseline' | 'life_support';
  label: string;
  value: number;
  missing: number;
  unit: 'events' | 'customer-events';
}

export function medicalExposureMetrics(events: readonly EventRecord[]): ExposureMetric[] {
  const sum = (field: 'medical_baseline' | 'life_support') => {
    const values = events.map(event => asNumber(event.properties[field]));
    return {
      value: values.reduce<number>((total, value) => total + (value ?? 0), 0),
      missing: values.filter(value => value === null).length,
    };
  };
  const medical = sum('medical_baseline');
  const lifeSupport = sum('life_support');
  return [
    {id: 'outages', label: 'EPSS outages', value: events.length, missing: 0, unit: 'events'},
    {id: 'medical_baseline', label: 'Medical baseline customer-event total', ...medical, unit: 'customer-events'},
    {id: 'life_support', label: 'Life support customer-event total', ...lifeSupport, unit: 'customer-events'},
  ];
}
