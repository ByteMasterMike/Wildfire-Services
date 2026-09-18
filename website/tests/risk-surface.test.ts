import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDataCache, getRiskSurface } from '../src/api.ts';
import { riskBand, validateRiskSurface } from '../src/riskSurface.ts';

function surface(date='2024-07-15') {
  return {
    date,
    lookback_days:90,
    cells:Array.from({length:824},(_,cell_id)=>({
      cell_id,
      lat:32+cell_id/100,
      lon:-124+cell_id/100,
      risk:cell_id/100_000,
      expected_count:cell_id/99_000,
      intensity:cell_id/99_000,
    })),
  };
}

test('risk surface requires 824 unique, internally consistent cells', () => {
  const valid=surface();
  assert.equal(validateRiskSurface(valid,valid.date).cells.length,824);
  assert.throws(()=>validateRiskSurface({...valid,cells:valid.cells.slice(1)},valid.date),/incomplete/);
  assert.throws(()=>validateRiskSurface({...valid,cells:[...valid.cells.slice(0,-1),valid.cells[0]]},valid.date),/inconsistent/);
});

test('risk bands progress from lowest to highest', () => {
  assert.deepEqual([.1,.4,.7,.9].map(value=>riskBand(value,1).label),['Lowest','Low','High','Highest']);
});

test('risk fetch uses the configured CloudFront route', async t => {
  clearDataCache(); t.after(clearDataCache);
  const fetch=t.mock.method(globalThis,'fetch',async(input:string)=>{
    const url=new URL(input);
    assert.equal(url.pathname,'/api/risk-forecasting/surface');
    assert.equal(url.searchParams.get('date'),'2024-07-15');
    return Response.json(surface());
  });
  assert.equal((await getRiskSurface('2024-07-15')).cells.length,824);
  assert.equal(fetch.mock.callCount(),1);
});
