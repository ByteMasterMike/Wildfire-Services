import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDataCache, getObservedTraining, getRiskSurface } from '../src/api.ts';
import { residualBand, residualCells, validateObservedTraining } from '../src/residual.ts';
import { validateRiskSurface } from '../src/riskSurface.ts';

function surface(date='2024-07-15') {
  return {
    date,
    lookback_days:90,
    cells:Array.from({length:824},(_,cell_id)=>({
      cell_id,
      lat:32+cell_id/100,
      lon:-124+cell_id/100,
      risk:cell_id/100_000,
      expected_count:cell_id === 114 ? 0.4 : 0.1,
      intensity:cell_id === 114 ? 0.4 : 0.1,
    })),
  };
}

function observed(date='2024-07-15') {
  return {
    date,
    cells:Array.from({length:824},(_,cell_id)=>({
      cell_id,
      lat:32+cell_id/100,
      lon:-124+cell_id/100,
      observed_count:cell_id === 114 ? 2 : 0,
    })),
  };
}

test('observed-training requires 824 unique cells with integer counts', () => {
  const valid=observed();
  assert.equal(validateObservedTraining(valid,valid.date).cells.length,824);
  assert.throws(()=>validateObservedTraining({...valid,cells:valid.cells.slice(1)},valid.date),/incomplete/);
  assert.throws(()=>validateObservedTraining({...valid,cells:[...valid.cells.slice(0,-1),{...valid.cells[0],observed_count:1.5}]},valid.date),/inconsistent/);
});

test('residual joins surface expected_count to observed-training on cell_id', () => {
  const cells=residualCells(validateRiskSurface(surface(),'2024-07-15'), validateObservedTraining(observed(),'2024-07-15'));
  assert.equal(cells.length,824);
  const cell=cells.find(item=>item.cell_id===114)!;
  assert.equal(cell.observed_count,2);
  assert.equal(cell.expected_count,0.4);
  assert.equal(cell.residual,1.6);
  assert.equal(cells.find(item=>item.cell_id===0)!.residual,-0.1);
});

test('residual bands distinguish more observed from fewer observed', () => {
  assert.equal(residualBand(0,1).label,'Near expected');
  assert.equal(residualBand(0.8,1).label,'More observed');
  assert.equal(residualBand(-0.8,1).label,'Fewer observed');
});

test('residual fetch uses /surface and /observed-training, never /observed', async t => {
  clearDataCache(); t.after(clearDataCache);
  const paths: string[] = [];
  t.mock.method(globalThis,'fetch',async(input:string)=>{
    const url=new URL(input);
    paths.push(url.pathname);
    assert.equal(url.searchParams.get('date'),'2024-07-15');
    if (url.pathname.endsWith('/surface')) return Response.json(surface());
    if (url.pathname.endsWith('/observed-training')) return Response.json(observed());
    throw new Error(`unexpected path ${url.pathname}`);
  });
  assert.equal((await getRiskSurface('2024-07-15')).cells.length,824);
  assert.equal((await getObservedTraining('2024-07-15')).cells.length,824);
  assert.deepEqual(paths,['/api/risk-forecasting/surface','/api/risk-forecasting/observed-training']);
  assert.ok(!paths.some(path=>path.endsWith('/observed') && !path.endsWith('/observed-training')));
});
