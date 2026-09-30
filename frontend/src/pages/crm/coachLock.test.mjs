import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A tiny stand-in for the DOM: just what the lock asks of elements, events and the window.
class Element {
  constructor(name, parent = null, box = { left: 0, top: 0, right: 0, bottom: 0 }) { this.name = name; this.parent = parent; this.box = box; this.control = null; }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  closest(selector) { for (let n = this; n; n = n.parent) if (selector.split(',').some(s => s.trim() === n.name)) return n; return null; }
  getBoundingClientRect() { return this.box; }
}
class MouseEvent {}
const listeners = new Map();
globalThis.Element = Element;
globalThis.MouseEvent = MouseEvent;
globalThis.window = {
  addEventListener: (type, fn, options) => listeners.set(type, { fn, options }),
  removeEventListener: (type, fn, capture) => { if (listeners.get(type)?.fn === fn && capture === true) listeners.delete(type); },
};
const html = new Element('html'), body = new Element('body', html);
globalThis.document = { body, documentElement: html };

const built = await build({ entryPoints: [fileURLToPath(new URL('./coachLock.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { lockPage, within } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const page = new Element('page', body), coach = new Element('.coach', body), bubble = new Element('button', coach);
const lit = new Element('[data-coach=park]', page, { left: 100, top: 100, right: 300, bottom: 140 }), select = new Element('select', lit);
const other = new Element('button', page), dock = new Element('[data-coach=dock-code]', page), dockButton = new Element('button', dock);
const label = new Element('label', page); label.control = select;
let target = lit, allow, blocked = 0;

function send(type, node, extra = {}) {
  const event = Object.assign(/mouse|click|pointer|drop/.test(type) ? new MouseEvent() : {}, { type, target: node, isTrusted: true, stopped: false, cancelled: false, ...extra });
  event.stopPropagation = () => { event.stopped = true; };
  event.preventDefault = () => { event.cancelled = true; };
  listeners.get(type).fn(event);
  return event;
}

test('only the lit element, labels of its controls and Pulsar\'s bubble answer clicks', () => {
  const lift = lockPage({ coach: () => coach, target: () => target, allow: () => allow, onBlocked: () => blocked++ });
  assert.ok(listeners.get('click').options.capture && !listeners.get('click').options.passive);
  assert.ok(listeners.get('touchstart').options.passive, 'touches never stop the page from scrolling');
  for (const node of [lit, select, label, bubble]) assert.equal(send('click', node).stopped, false);
  const outside = send('click', other, { clientX: 20, clientY: 20 });
  assert.ok(outside.stopped && outside.cancelled); assert.equal(blocked, 1);
  const touch = send('touchstart', other, { changedTouches: [{ clientX: 20, clientY: 20 }] });
  assert.ok(touch.stopped && !touch.cancelled, 'a touch is stopped but may still scroll');
  // A backdrop over the lit place lets the click through; Pulsar's own synthetic clicks always pass.
  assert.equal(send('mousedown', other, { clientX: 150, clientY: 120 }).stopped, false);
  assert.equal(send('click', other, { isTrusted: false }).stopped, false);
  // While Pulsar still looks for the target, only the bubble works.
  target = null;
  assert.ok(send('click', lit, { clientX: 150, clientY: 120 }).stopped);
  assert.equal(send('click', bubble).stopped, false);
  target = lit;
  // A step can open one more place, e.g. the courier code in Pulsar's panel.
  assert.ok(send('click', dockButton).stopped);
  allow = '[data-coach=dock-code]';
  assert.equal(send('click', dockButton).stopped, false);
  allow = undefined;
  lift();
  assert.equal(listeners.size, 0, 'closing the tour removes every listener');
});

test('keys and edits work only in the lit element; Tab, Escape and an idle page stay free', () => {
  blocked = 0;
  const lift = lockPage({ coach: () => coach, target: () => lit, allow: () => undefined, onBlocked: () => blocked++ });
  assert.equal(send('keydown', select, { key: 'a' }).stopped, false);
  const typed = send('keydown', other, { key: 'Enter' });
  assert.ok(typed.stopped && typed.cancelled); assert.equal(blocked, 1);
  assert.equal(send('keydown', other, { key: 'a', repeat: true }).cancelled, true); assert.equal(blocked, 1, 'held keys nudge once');
  for (const key of ['Tab', 'Escape', 'Shift']) assert.equal(send('keydown', other, { key }).stopped, false, key);
  assert.equal(send('keydown', body, { key: ' ' }).stopped, false);
  assert.equal(send('paste', body).stopped, false);
  assert.ok(send('beforeinput', other).cancelled);
  assert.equal(send('beforeinput', select).cancelled, false);
  lift();
});

test('the rect check includes the edges of the lit place', () => {
  const box = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.ok(within(box, 10, 20) && within(box, 15, 15));
  assert.ok(!within(box, 9, 15) && !within(box, 15, 21));
});
