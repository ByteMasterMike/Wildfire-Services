import type { AgentAnswer } from './api.ts';
import type { PanelId } from './PanelPicker';
import type { PanelSettings } from './state';
import { CHART_DATASETS, DATASETS, utilityLabel } from './data.ts';

interface AnswerPanel { type: PanelId; name: string; settings: Partial<PanelSettings> }

// Adapt only contracts supported by the existing workspace components.
export function panelsFromAnswer(answer: AgentAnswer): AnswerPanel[] {
  const panels: AnswerPanel[] = [];
  for (const view of answer.views ?? []) {
    const p = view.params;
    if (view.type === 'stat_card' && typeof p.value === 'number' && Number.isFinite(p.value)
      && ['label', 'scope', 'period'].every(key => typeof p[key] === 'string')) {
      panels.push({type: 'stat_card', name: String(p.label), settings: {answerStat: {
        value: p.value, label: String(p.label), scope: String(p.scope), period: String(p.period),
        unit: typeof p.unit === 'string' ? p.unit : '',
      }}});
      continue;
    }
    if (!['map', 'time_series', 'record_table'].includes(view.type)
      || (p.incident_type_mode && p.incident_type_mode !== 'wildfire_default')) continue;
    const ids = view.type === 'map' ? p.datasets : [p.dataset];
    if (!Array.isArray(ids) || ids.length !== 1) continue;
    const dataset = DATASETS.find(d => d.api === ids[0] || d.id === ids[0] || d.query === ids[0]);
    if (!dataset || (view.type === 'time_series' && !CHART_DATASETS.some(d => d.id === dataset.id))) continue;
    const start = typeof p.start_date === 'string' ? p.start_date : p.year ? `${p.year}-01-01` : null;
    const end = typeof p.end_date === 'string' ? p.end_date : p.year ? `${p.year}-12-31` : null;
    if (!start || !end) continue;
    const settings: Partial<PanelSettings> = {
      dataset: dataset.id, datasets: [dataset.id],
      filters: {start, end, utility: utilityLabel(p.utility) ?? '', county: typeof p.county === 'string' ? p.county : ''},
      overlays: [...(p.show_hftd ? ['hftd'] : []), ...(p.show_territory ? ['territories'] : [])],
    };
    if (['daily', 'weekly', 'monthly'].includes(String(p.interval))) settings.interval = p.interval as 'daily' | 'weekly' | 'monthly';
    panels.push({type: view.type as PanelId, name: `${dataset.name} · ${start.slice(0, 4)}`, settings});
  }
  return panels;
}
