import test from 'node:test';
import assert from 'node:assert/strict';
import { currentView, PANEL_VIEWS, updatePanelSettings, viewSettings } from '../src/panelViews.ts';
import type { PanelSettings } from '../src/state';

const settings: PanelSettings = {
  dataset: 'calfire', filters: {start: '2023-01-01', end: '2023-12-31', county: 'Marin', utility: ''},
  interval: 'weekly', groupBy: 'county', measure: 'share', metric: 'events',
  datasets: ['calfire'], overlays: ['hftd'], comparisonYears: [2022,2023],
};

test('changing view preserves the selected period and creates independent settings', () => {
  const view = PANEL_VIEWS.find(view => view.id === 'weather-map')!;
  const changed = viewSettings(settings,view);
  assert.deepEqual(changed.filters,settings.filters);
  assert.equal(changed.interval,'weekly');
  assert.equal(currentView('map',changed),'weather-map');
  changed.filters.county = 'Sonoma'; changed.overlays.push('territories'); changed.comparisonYears!.push(2024);
  assert.equal(settings.filters.county,'Marin');
  assert.deepEqual(settings.overlays,['hftd']);
  assert.deepEqual(settings.comparisonYears,[2022,2023]);
  assert.deepEqual(view.settings.overlays,['hdw']);
});

test('view changes discard stale weather frames and scalar agent results', () => {
  const changed = viewSettings({...settings, weatherDate:'2024-07-04', weatherYear:2024, riskDate:'2024-07-15', answerStat:{value:99,label:'Previous answer',scope:'All',period:'2024',unit:'events'}}, PANEL_VIEWS.find(view=>view.id==='summary-stats')!);
  assert.equal(changed.answerStat,undefined);
  assert.equal(changed.weatherDate,undefined);
  assert.equal(changed.weatherYear,undefined);
  assert.equal(changed.riskDate,undefined);
});

test('risk surface view is a map hindcast, not an event overlay', () => {
  const view = PANEL_VIEWS.find(view => view.id === 'risk-surface-map')!;
  const changed = viewSettings(settings, view);
  assert.equal(changed.mapMode, 'risk');
  assert.equal(currentView('map', changed), 'risk-surface-map');
  assert.equal(view.title, 'Modeled ignition risk surface');
});

test('residual map view joins the training assignment, not event overlays', () => {
  const view = PANEL_VIEWS.find(view => view.id === 'residual-map')!;
  const changed = viewSettings(settings, view);
  assert.equal(changed.mapMode, 'residual');
  assert.equal(currentView('map', changed), 'residual-map');
  assert.equal(view.title, 'Model residual map');
});

test('current view follows actual settings including legacy panels without a preset id', () => {
  assert.equal(currentView('comparison',{...settings,groupBy:'cause'}),'cause-comparison');
  assert.equal(currentView('time_series',{...settings,seriesMode:'yearly'}),'annual-time');
  assert.equal(currentView('map',{...settings,dataset:'psps'}),'psps-map');
  assert.equal(currentView('map',{...settings,dataset:'epss',overlays:['hdw']}),'weather-map');
});

test('automatic titles follow direct source/layer changes while custom names stay intact', () => {
  const panel = {id: 8, type: 'map' as const, name: 'Fire weather', settings: {...settings,overlays:['hdw']}};
  const changed = updatePanelSettings(panel,{dataset:'epss',overlays:[]});
  assert.equal(changed.name,'Outage circuits');
  assert.equal(changed.id,8);
  assert.deepEqual(panel.settings.overlays,['hdw']);
  assert.equal(updatePanelSettings({...panel,name:'Marin study'},{dataset:'epss',overlays:[]}).name,'Marin study');
});

test('initial panels acquire the current view title when their settings change', () => {
  const panel = {id: 1, type: 'map' as const, settings: {...settings, dataset: 'cpuc' as const, overlays: []}};
  assert.equal(updatePanelSettings(panel, {dataset: 'epss'}).name, 'Outage circuits');
});

test('an explicitly chosen name stays custom even when it matches a preset title', () => {
  const panel = {id: 8, type: 'map' as const, name: 'Wildfire events', nameIsCustom: true, settings};
  assert.equal(updatePanelSettings(panel, {dataset: 'epss', overlays: []}).name, 'Wildfire events');
});
