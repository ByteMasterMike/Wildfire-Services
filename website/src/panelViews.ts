import type { PanelId, PanelInstance } from './PanelPicker';
import type { PanelSettings } from './state';

export interface PanelView {
  id: string;
  type: PanelId;
  title: string;
  description: string;
  settings: Partial<PanelSettings>;
}

export const PANEL_VIEWS: PanelView[] = [
  { id: 'events-map', type: 'map', title: 'Wildfire events', description: 'Explore ignition and fire locations.', settings: { dataset: 'cpuc', overlays: [] } },
  { id: 'outages-map', type: 'map', title: 'Outage circuits', description: 'Locate PG&E EPSS outages by circuit.', settings: { dataset: 'epss', overlays: [] } },
  { id: 'psps-map', type: 'map', title: 'PSPS areas', description: 'Explore shutoff areas by utility.', settings: { dataset: 'psps', overlays: [] } },
  { id: 'weather-map', type: 'map', title: 'Fire weather', description: 'Play daily HDW alongside event starts.', settings: { dataset: 'cpuc', overlays: ['hdw'] } },
  { id: 'events-time', type: 'time_series', title: 'Event trends', description: 'Follow CPUC, EPSS and CAL FIRE over time.', settings: { seriesMode: 'timeline', datasets: ['cpuc', 'epss', 'calfire'] } },
  { id: 'annual-time', type: 'time_series', title: 'Year comparison', description: 'Compare years on the same calendar axis.', settings: { dataset: 'cpuc', seriesMode: 'yearly' } },
  { id: 'county-comparison', type: 'comparison', title: 'County ranking', description: 'Rank counties by recorded events.', settings: { dataset: 'cpuc', groupBy: 'county' } },
  { id: 'utility-comparison', type: 'comparison', title: 'Utility comparison', description: 'Compare recorded counts across utilities.', settings: { dataset: 'cpuc', groupBy: 'utility' } },
  { id: 'cause-comparison', type: 'comparison', title: 'Cause breakdown', description: 'Compare the recorded causes of EPSS outages.', settings: { dataset: 'epss', groupBy: 'cause' } },
  { id: 'event-records', type: 'record_table', title: 'Event records', description: 'Search individual events and open their details.', settings: { dataset: 'cpuc' } },
  { id: 'summary-stats', type: 'stat_card', title: 'Summary metrics', description: 'See related totals under one set of filters.', settings: { dataset: 'cpuc' } },
];

export function viewSettings(current: PanelSettings, view: PanelView): PanelSettings {
  return structuredClone({ ...current, ...view.settings, answerStat: undefined, weatherDate: undefined, weatherYear: undefined });
}

export function currentView(type: PanelId, settings: PanelSettings): string {
  if (type === 'map') return settings.overlays.includes('hdw') ? 'weather-map' : settings.dataset === 'epss' ? 'outages-map' : settings.dataset === 'psps' ? 'psps-map' : 'events-map';
  if (type === 'time_series') return settings.seriesMode === 'yearly' ? 'annual-time' : 'events-time';
  if (type === 'comparison') return `${settings.groupBy}-comparison`;
  return type === 'record_table' ? 'event-records' : 'summary-stats';
}

export function updatePanelSettings(panel: PanelInstance, patch: Partial<PanelSettings>): PanelInstance {
  const settings = { ...panel.settings, ...patch };
  const automaticTitle = PANEL_VIEWS.some(view => view.type === panel.type && view.title === panel.name);
  const name = automaticTitle ? PANEL_VIEWS.find(view => view.id === currentView(panel.type, settings))!.title : panel.name;
  return { ...panel, name, settings };
}
