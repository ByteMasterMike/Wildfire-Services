import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonalProfile, seasonalYears } from '../src/temporal.ts';
import { csvText, regionalSvg } from '../src/exports.ts';
import type { Bucket } from '../src/data.ts';

const days=(year:number,length:number,count:number):Bucket[]=>Array.from({length},(_,i)=>{const date=new Date(Date.UTC(year,0,i+1)).toISOString().slice(0,10);return {start:date,end:date,count};});


test('seasonal years exclude source endpoint years and the current calendar year',()=>{
  assert.deepEqual(seasonalYears({start:'2021-11-01',end:'2025-11-15'},new Date('2026-01-01')),[2022,2023,2024]);
  assert.deepEqual(seasonalYears({start:'2020-01-01',end:'2025-12-31'},new Date('2024-08-01')),[2020,2021,2022,2023]);
  assert.deepEqual(seasonalYears({start:null,end:null}),[]);
});

test('seasonal averages include real zeros but exclude a year with an incomplete week',()=>{
  const profile=seasonalProfile([{year:2022,daily:days(2022,7,2)},{year:2023,daily:days(2023,7,0)},{year:2024,daily:days(2024,6,10)}]);
  assert.equal(profile[0].mean,7);
  assert.deepEqual(profile[0].years,[2022,2023]);
  assert.equal(profile[0].counts[2024],null);
  assert.equal(profile[1].mean,null);
  assert.equal(profile[1].years.length,0);
});

test('seasonal CSV keeps incomplete weeks empty and observed zero weeks numeric', () => {
  const profile = seasonalProfile([{year: 2023, daily: days(2023, 7, 0)}, {year: 2024, daily: days(2024, 6, 10)}]);
  const csv = csvText(profile.slice(0, 2).map(week => ({week: week.week, mean: week.mean, events_2023: week.counts[2023], events_2024: week.counts[2024]})));
  assert.deepEqual(csv.slice(1).split('\r\n'), [
    '"week","mean","events_2023","events_2024"',
    '"1","0","0",""',
    '"2","","",""',
  ]);
});

test('seasonal weeks always contain seven days, with trailing leap/non-leap days excluded',()=>{
  const regular=days(2023,365,1), leap=days(2024,366,1);
  regular[364].count=99; leap[364].count=99; leap[365].count=99;
  const profile=seasonalProfile([{year:2023,daily:regular},{year:2024,daily:leap}]);
  assert.equal(profile.length,52);
  assert.ok(profile.every(week=>week.mean===7&&week.years.length===2));
  assert.equal(profile.reduce((sum,week)=>sum+week.counts[2024]!,0),364);
});

test('malformed or duplicate seasonal observations fail rather than distort the mean',()=>{
  assert.throws(()=>seasonalProfile([{year:2024,daily:[...days(2024,7,1),...days(2024,1,1)]}]),/unique daily/);
  assert.throws(()=>seasonalProfile([{year:2024,daily:[{start:'2024-02-30',end:'2024-02-30',count:1}]}]),/unique daily/);
  assert.throws(()=>seasonalProfile([{year:2024,daily:[]},{year:2024,daily:[]}]),/twice/);
});

test('regional image export contains every region and escapes source labels',()=>{
  const series=Array.from({length:18},(_,i)=>({name:i===0?'A & <B>':`Division ${i}`,total:i,buckets:[{start:'2024-01-01',end:'2024-01-31',count:i}]}));
  const svg=regionalSvg('Regional trends','2024; monthly',series);
  assert.match(svg,/Division 17/);
  assert.match(svg,/A &amp; &lt;B&gt;/);
  assert.equal((svg.match(/<polyline/g)||[]).length,18);
});
