import { useMemo, useRef, useState } from 'react';
import { getCoverage, getDailySeries } from './api.ts';
import { configFor, unavailableReason } from './data.ts';
import { ChartFilters, DatasetSelect, LoadState } from './Controls';
import { ExportActions } from './ExportActions';
import { lineSvg } from './exports.ts';
import { seasonalProfile, seasonalYears } from './temporal.ts';
import { TemporalPlot } from './TemporalPlot';
import { YearPicker } from './YearComparison';
import { usePanel } from './state';
import { useRemote } from './useRemote';

export function SeasonalSeries() {
  const {settings,update,title}=usePanel();
  const {filters}=settings;
  const dataset=['cpuc','epss','calfire'].includes(settings.dataset)?settings.dataset:'cpuc';
  const coverage=useRemote(`coverage:${dataset}`,()=>getCoverage(dataset));
  const available=coverage.data?seasonalYears(coverage.data):[];
  const years=(settings.seasonYears??available.slice(-5)).filter(year=>available.includes(year)).sort((a,b)=>a-b);
  const [picker,setPicker]=useState(false);
  const [inspected,setInspected]=useState<number|null>(null);
  const plot=useRef<HTMLDivElement>(null);
  const reason=unavailableReason(dataset,filters)||(!coverage.loading&&coverage.data&&years.length<2?'Select at least two years within the recorded date range.':null);
  const remote=useRemote(!coverage.data||reason?null:JSON.stringify(['seasonal',dataset,years,filters.county,filters.utility]),async()=>seasonalProfile(await Promise.all(years.map(async year=>({year,daily:await getDailySeries(dataset,{...filters,start:`${year}-01-01`,end:`${year}-12-31`})})))));
  const profile=useMemo(()=>remote.data??[],[remote.data]);
  const values=useMemo(()=>profile.map(week=>week.mean),[profile]);
  const labels=useMemo(()=>profile.map(week=>`W${week.week}`),[profile]);
  const error=coverage.error||reason||remote.error;
  const loading=coverage.loading||remote.loading;
  const ready=!error&&!loading&&profile.some(week=>week.mean!==null);
  const ceiling=Math.ceil(Math.max(4,...values.map(value=>value??0))/4)*4;
  const active=inspected===null?null:profile[inspected];
  const caption=`${configFor(dataset).name}; ${years.join(', ')}; ${filters.utility||'All utilities'}; ${filters.county||'All counties'}. Mean events per complete 7-day block from Jan 1; final 1–2 days excluded. Recorded range is not collection-completeness verification.`;
  return <div className="analysis-chart seasonal-panel">
    <ExportActions disabled={!ready} rows={()=>profile.map(week=>({dataset:configFor(dataset).name,week:week.week,start_day_of_year:(week.week-1)*7+1,end_day_of_year:week.week*7,mean_events:week.mean,contributing_years:week.years.length,included_years:week.years.join(';'),...Object.fromEntries(years.map(year=>[`events_${year}`,week.counts[year]])),utility:filters.utility,county:filters.county}))} svg={()=>{const svg=plot.current?.querySelector('svg');if(!svg)throw new Error('Chart is not ready.');return lineSvg(svg,title,caption,[{label:'Mean weekly events',color:'#b7a0f0'}]);}}/>
    <div className="seasonal-toolbar"><DatasetSelect hideLabel all={false} value={dataset} onChange={dataset=>update({dataset,seasonYears:undefined})}/><button className="years-button" onClick={()=>setPicker(true)}>Years · {years.join(', ')||'Choose'}</button>
      <details className="season-method"><summary aria-label="About seasonal averages">ⓘ</summary><p>Weeks are seven-day blocks starting January 1. A year contributes only when all seven daily counts are present. The last one or two days of each year are excluded. Only completed calendar years inside the source's recorded date range are offered. Recorded dates do not prove complete collection; CAL FIRE posting coverage varies across years.</p></details>
    </div>
    <ChartFilters filters={filters} dataset={dataset} years={years} onChange={filters=>update({filters})}/>
    <div ref={plot} className="seasonal-plot">{ready?<TemporalPlot values={values} labels={labels} ceiling={ceiling} unit="Mean events / week" onInspect={setInspected}/>:<LoadState loading={loading} error={error} retry={coverage.error?coverage.retry:remote.error?remote.retry:undefined}/>}</div>
    <div className="series-readout" aria-live="polite"><span>{active?`Week ${active.week} · ${active.years.length} contributing years`:`52 weeks · ${years.length} selected years`}</span>{active&&<strong>{active.mean===null?'Unavailable':`${active.mean.toLocaleString(undefined,{maximumFractionDigits:2})} events / week`}</strong>}</div>
    {picker&&<YearPicker available={available} selected={years} onChange={seasonYears=>update({seasonYears})} onClose={()=>setPicker(false)} purpose="Seasonal years"/>}
  </div>;
}
