import test from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeFillOpacity } from '../src/gridSurface.ts';

test('near-zero residuals stay nearly transparent while the max stays opaque', () => {
  const maxAbs = 0.991;
  assert.equal(magnitudeFillOpacity(0, maxAbs), 0);
  assert.ok(magnitudeFillOpacity(-0.1, maxAbs) < 0.08);
  assert.ok(magnitudeFillOpacity(-0.1, maxAbs) > magnitudeFillOpacity(0, maxAbs));
  assert.ok(magnitudeFillOpacity(0.991, maxAbs) > 0.8);
  assert.ok(magnitudeFillOpacity(0.991, maxAbs) > magnitudeFillOpacity(0.2, maxAbs));
});

test('risk fill opacity follows the same magnitude curve', () => {
  assert.equal(magnitudeFillOpacity(0, 0.0213), 0);
  assert.ok(magnitudeFillOpacity(0.002, 0.0213) < magnitudeFillOpacity(0.0213, 0.0213));
  assert.ok(magnitudeFillOpacity(0.0213, 0.0213) > 0.8);
});
