import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./coachTours.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { coachLayout, COACH_TOURS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const size = { mascot: 108, bubbleW: 320, bubbleH: 170 };
const inside = (box, w, h, view) => box.x >= 0 && box.y >= 0 && box.x + w <= view.right && box.y + h <= view.height;

test('Pulsar stands beside the target and points towards it', () => {
  const view = { width: 1600, height: 900, right: 1230 };
  const right = coachLayout({ left: 300, top: 400, right: 600, bottom: 440 }, view, size);
  assert.equal(right.side, 'right'); assert.ok(right.mascot.x > 600); assert.equal(right.hand.icon, '👈'); assert.equal(right.mascot.flip, false);
  const left = coachLayout({ left: 900, top: 400, right: 1180, bottom: 440 }, view, size);
  assert.equal(left.side, 'left'); assert.ok(left.mascot.x + size.mascot < 900); assert.equal(left.hand.icon, '👉'); assert.equal(left.mascot.flip, true);
  // Mascot, hand and bubble never cover the target itself.
  for (const l of [right, left]) assert.ok(inside(l.bubble, size.bubbleW, size.bubbleH, view));
});

test('a full-width target sends Pulsar above or below, and everything stays on screen', () => {
  const view = { width: 390, height: 820, right: 390 };
  const below = coachLayout({ left: 10, top: 100, right: 380, bottom: 140 }, view, size);
  assert.equal(below.side, 'below'); assert.equal(below.hand.icon, '👆'); assert.ok(below.mascot.y >= 140);
  const above = coachLayout({ left: 10, top: 700, right: 380, bottom: 740 }, view, size);
  assert.equal(above.side, 'above'); assert.ok(above.mascot.y + size.mascot <= 700);
  for (const l of [below, above]) { assert.ok(inside(l.mascot, size.mascot, size.mascot, view)); assert.ok(inside(l.bubble, size.bubbleW, size.bubbleH, view)); }
});

test('every tour step has a target and a short explanation', () => {
  for (const steps of Object.values(COACH_TOURS)) for (const step of steps) { assert.ok(step.target && step.title); assert.ok(step.text.length > 20 && step.text.length < 200, step.title); if (step.autoClick) assert.ok(step.advanceWhen, step.title); }
});

test('the appeal tour asks for the city after the park and leaves the comment for the end', () => {
  const steps = COACH_TOURS.appeals, at = (target) => steps.findIndex((step) => step.target === target);
  assert.equal(at('[data-coach=city]'), at('[data-coach=park]') + 1);
  assert.equal(steps[at('[data-coach=park]')].advanceWhen, '[data-coach=city]');
  const lastCategory = Math.max(...steps.map((step, i) => step.target.startsWith('[data-coach=category-') ? i : -1));
  assert.ok(steps.every((step, i) => !['[data-coach=comment]', '[data-coach=files]'].includes(step.target) || i > lastCategory));
  assert.ok(!steps.some((step) => step.target === '[data-coach=ticket]'));
});

test('the drivers tour walks through the card, the car editor and the cash limit', () => {
  const targets = COACH_TOURS.drivers.map((step) => step.target);
  for (const anchor of ['drv-tiles', 'car-brand', 'car-model', 'car-callsign', 'limit-on']) assert.ok(targets.some((t) => t.includes(anchor)), anchor);
});
