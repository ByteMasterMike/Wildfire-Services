import { createContext, useContext } from 'react';
import { DEFAULT_FILTERS, type DatasetId, type EventRecord, type Filters, type GroupBy, type Interval } from './data.ts';
import type { PanelId, PanelInstance } from './PanelPicker';

export interface PanelSettings {
  dataset: DatasetId; filters: Filters; interval: Interval; groupBy: GroupBy;
  measure: 'count' | 'share'; metric: 'events' | 'acres' | 'counties' | 'customers';
  datasets: DatasetId[]; overlays: string[];
  mapMode?: 'events' | 'risk' | 'residual';
  riskDate?: string;
  statMode?: 'summary' | 'medical_exposure';
  weatherYear?: number; weatherDate?: string;
  seriesMode?: 'timeline' | 'yearly' | 'regional' | 'seasonal'; comparisonYears?: number[]; seasonYears?: number[];
  answerStat?: { value: number; label: string; scope: string; period: string; unit: string; sourceDataset?: string };
}
export function newPanel(id: number, type: PanelId): PanelInstance {
  return { id, type, settings: {
    dataset: type === 'comparison' ? 'epss' : 'cpuc', filters: { ...DEFAULT_FILTERS },
    interval: 'monthly', groupBy: 'cause', measure: 'count', metric: 'events',
    datasets: ['cpuc', 'epss', 'calfire'], overlays: [],
  } };
}
export const SelectionContext = createContext<{ inspect: (record: EventRecord) => void }>({ inspect: () => {} });
export const PanelContext = createContext<{ settings: PanelSettings; update: (patch: Partial<PanelSettings>) => void; expanded: boolean; expand: () => void; actionsHost: HTMLElement | null; title: string } | null>(null);
export function usePanel() {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error('Panel context missing');
  return panel;
}
