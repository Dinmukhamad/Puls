import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./coachTours.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { coachLayout, COACH_TOURS, appealTour } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
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
  for (const steps of Object.values(COACH_TOURS)) for (const step of steps) { assert.ok(step.target && step.title); assert.ok(step.text.length > 20 && step.text.length < 200, step.title); if (step.advanceWhen || step.waitClick) assert.ok(step.action, `${step.title} waits but the lit element is locked`); assert.equal(step.autoClick, undefined, step.title); }
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
  assert.ok(COACH_TOURS.drivers.find((step) => step.target.includes('car-save')).waitClick);
  assert.ok(COACH_TOURS.appeals.at(-1).waitClick && COACH_TOURS.appeals.at(-1).untilGone, 'the appeal tour ends when the appeal is saved');
});

test('the appeal takes phone, ВУ and ID from the driver account and Pulsar checks each one', () => {
  const steps = COACH_TOURS.appeals, at = (target) => steps.findIndex((step) => step.target === target);
  const fields = [['phone', 'phone'], ['license_number', 'license'], ['driver_id', 'id']];
  let previous = at('[data-coach=channel]');
  for (const [field, copied] of fields) {
    const paste = at(`[data-coach=${field}]`), step = steps[paste];
    assert.ok(paste > previous, `${field} comes after the field before it`);
    // Pulsar moves on only when the field holds this account's data, and says what is wrong otherwise.
    assert.equal(step.advanceWhen, `[data-coach=${field}][data-match=true]`);
    assert.ok(step.mistakes.some((m) => m.when === `[data-coach=${field}][data-match=false]`));
    // Before it: to the Диспетчерская, the copy there, and back to CRM.
    const trip = steps.slice(previous + 1, paste);
    assert.equal(trip[0].target, '[data-coach=site-dispatch]');
    assert.equal(trip.at(-1).target, '[data-coach=site-crm]');
    assert.ok(trip.some((s) => s.advanceWhen === `.work-sites[data-copied=${copied}]`), `${field} is copied first`);
    // A field that already holds the data needs no trip at all.
    assert.ok(trip.every((s) => s.skipWhen?.includes(`[data-coach=${field}][data-match=true]`)), `${field} trip skips when done`);
    previous = paste;
  }
  assert.ok(previous < at('[data-coach=park]'), 'the driver data come before the park');
  // The ID comes from the address bar, not a field of the account.
  assert.ok(steps.some((s) => s.target === '[data-coach=fleet-address-id]' && s.advanceWhen === '.work-sites[data-copied=id]'));
});

test('a request copies the account link before its comment and waits for it there', () => {
  const steps = COACH_TOURS.appeals;
  const copyLink = steps.findIndex((s) => s.target === '[data-coach=copy-link]');
  const firstComment = steps.findIndex((s) => s.target === '[data-coach=comment]');
  assert.ok(copyLink > 0 && copyLink < firstComment);
  // The trip runs only for a request that needs the link, and not once the comment has it.
  for (const step of steps.slice(copyLink - 1, copyLink + 2)) {
    assert.ok(step.when?.startsWith('.work-sites[data-link=need]'), step.title);
    assert.ok(step.skipWhen?.includes('[data-coach=comment][data-link=ok]'), step.title);
  }
  const linked = steps.filter((s) => s.doneWhen === '[data-coach=comment][data-link=ok]').map((s) => s.title);
  assert.deepEqual(linked, ['Смена номера: комментарий', 'Смена автомобиля: комментарий', 'Комментарий к запросу']);
});

test('a call driver\'s appeal walks to that very account', () => {
  const account = '.fleet-driver[data-driver="abenov-id"]';
  const open = { target: '[data-coach=fleet-search]', advanceWhen: '[data-coach=search-input]', action: 'Нажми', title: 'Поиск', text: 'Нажми на лупу рядом с парком.' };
  const steps = appealTour({ account, open: [open] });
  // The walk is used before every copy, and the copies come from that account only.
  assert.equal(steps.filter((s) => s.target === open.target).length, 4);
  assert.ok(steps.some((s) => s.target === `${account} [data-coach=driver-phone]`));
  assert.ok(steps.some((s) => s.target === `${account} [data-coach=driver-license]`));
  assert.ok(!steps.some((s) => s.target.startsWith('.fleet-driver[data-driver] ')));
});
