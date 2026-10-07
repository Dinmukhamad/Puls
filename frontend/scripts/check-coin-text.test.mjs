import test from 'node:test';
import assert from 'node:assert/strict';
import { coinTextViolations } from './check-coin-text.mjs';

test('allows themed text and decorative surfaces, borders and icons', () => {
  assert.deepEqual(coinTextViolations(`
    .amount { color: var(--gold-text); background-color: var(--coin-color); }
    .icon { fill: var(--coin-color); border-color: var(--coin-color); }
    /* .old { color: var(--coin-color); } */
  `), []);
});

test('rejects decorative gold in direct and mixed text colors', () => {
  const errors = coinTextViolations(`
    .a { color : var( --coin-color, gold); }
    .b { background: red; color: color-mix(in srgb, var(--coin-color) 90%, black); }
  `);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.line > 0));
});
