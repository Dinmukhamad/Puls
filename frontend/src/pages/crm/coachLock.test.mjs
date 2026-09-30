import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A tiny stand-in for the DOM: just what the lock asks of elements, events and the window.
class Element {
  constructor(name, parent = null, box = { left: 0, top: 0, right: 0, bottom: 0 }) { this.name = name; this.parent = parent; this.box = box; this.control = null; this.clicks = 0; }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  closest(selector) { for (let n = this; n; n = n.parent) if (selector.split(',').some(s => s.trim() === n.name)) return n; return null; }
  matches(selector) { return selector.split(',').some(s => s.trim() === this.name); }
  getBoundingClientRect() { return this.box; }
  click() { this.clicks++; }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = document.body; }
}
class MouseEvent {}
const listeners = new Map(), timers = [];
Object.assign(globalThis, { Element, HTMLElement: Element, MouseEvent });
globalThis.window = {
  addEventListener: (type, fn, options) => listeners.set(type, { fn, options }),
  removeEventListener: (type, fn, capture) => { if (listeners.get(type)?.fn === fn && capture === true) listeners.delete(type); },
  setTimeout: fn => timers.push(fn), clearTimeout: () => {},
};
const html = new Element('html'), body = new Element('body', html);
globalThis.document = { body, documentElement: html, activeElement: body };

const built = await build({ entryPoints: [fileURLToPath(new URL('./coachLock.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { lockPage, within } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const page = new Element('page', body), coach = new Element('.coach', body), bubble = new Element('button', coach);
const lit = new Element('[data-coach=rail-help]', page, { left: 100, top: 100, right: 300, bottom: 140 }), inner = new Element('span', lit);
const field = new Element('input', page), other = new Element('button', page), cover = new Element('div', page);
const search = new Element('[data-coach=search-input]', page), searchInput = new Element('input', search);
const label = new Element('label', page); label.control = inner;
const log = { used: 0, blocked: 0, escape: 0 };
let target = lit, allow;
const lock = () => lockPage({ coach: () => coach, target: () => target, allow: () => allow, onUsed: () => log.used++, onBlocked: () => log.blocked++, onEscape: () => log.escape++ });

function send(type, node, extra = {}) {
  const event = Object.assign(/mouse|click|pointer|drop/.test(type) ? new MouseEvent() : {}, { type, target: node, isTrusted: true, stopped: false, cancelled: false, ...extra });
  event.stopPropagation = () => { event.stopped = true; };
  event.preventDefault = () => { event.cancelled = true; };
  listeners.get(type).fn(event);
  return event;
}

test('only the element to press, labels of its controls and Pulsar\'s bubble answer clicks', () => {
  const { release } = lock();
  assert.ok(listeners.get('click').options.capture && !listeners.get('click').options.passive);
  assert.ok(listeners.get('touchstart').options.passive, 'touches never stop the page from scrolling');
  for (const node of [lit, inner, label, bubble]) assert.equal(send('click', node).stopped, false);
  assert.equal(log.used, 2, 'a click on the lit element counts as pressing it');
  const outside = send('click', other, { clientX: 20, clientY: 20 });
  assert.ok(outside.stopped && outside.cancelled); assert.equal(log.blocked, 1);
  const touch = send('touchstart', other, { changedTouches: [{ clientX: 20, clientY: 20 }] });
  assert.ok(touch.stopped && !touch.cancelled, 'a touch is stopped but may still scroll');
  // Something covering the lit place: the press is swallowed there and handed to the lit element.
  assert.ok(send('mousedown', cover, { clientX: 150, clientY: 120 }).cancelled);
  assert.ok(send('click', cover, { clientX: 150, clientY: 120 }).stopped);
  assert.equal(lit.clicks, 1); assert.equal(log.used, 3); assert.equal(log.blocked, 1);
  assert.equal(send('click', other, { isTrusted: false }).stopped, false, 'synthetic clicks pass');
  // A step that only explains (or a target not found yet): only the bubble works.
  target = null;
  assert.ok(send('click', lit, { clientX: 150, clientY: 120 }).stopped);
  assert.equal(lit.clicks, 1);
  assert.equal(send('click', bubble).stopped, false);
  target = lit;
  // A step can keep one more place open, e.g. the search field while the result is picked.
  assert.ok(send('click', searchInput).stopped);
  allow = '[data-coach=search-input]';
  assert.equal(send('click', searchInput).stopped, false);
  allow = undefined;
  release();
  assert.equal(listeners.size, 0, 'closing the tour removes every listener');
});

test('keys and typing work only in open places; Escape closes the tour alone', () => {
  Object.assign(log, { used: 0, blocked: 0, escape: 0 });
  const { release } = lock();
  target = field;
  assert.equal(send('keydown', field, { key: 'a' }).stopped, false);
  const typed = send('keydown', other, { key: 'Enter' });
  assert.ok(typed.stopped && typed.cancelled); assert.equal(log.blocked, 1);
  assert.equal(send('keydown', other, { key: 'a', repeat: true }).cancelled, true); assert.equal(log.blocked, 1, 'held keys nudge once');
  for (const key of ['Tab', 'Shift']) assert.equal(send('keydown', other, { key }).stopped, false, key);
  const escape = send('keydown', field, { key: 'Escape' });
  assert.ok(escape.stopped && escape.cancelled, 'the page\'s own Escape handlers stay silent'); assert.equal(log.escape, 1);
  assert.equal(send('keydown', body, { key: ' ' }).stopped, false);
  assert.equal(send('paste', body).stopped, false);
  assert.ok(send('beforeinput', other).cancelled); assert.equal(log.blocked, 2, 'blocked typing shows the hint too');
  assert.equal(send('beforeinput', field).cancelled, false);
  target = lit;
  release();
});

test('focus that lands outside the open places is dropped', () => {
  const { release, settle } = lock();
  target = field;
  other.focus(); settle();
  assert.equal(document.activeElement, body);
  field.focus(); settle();
  assert.equal(document.activeElement, field);
  // An autofocused field keeps focus if the next step needs it by the time the check runs.
  searchInput.focus(); listeners.get('focusin').fn({ type: 'focusin', target: searchInput });
  target = searchInput; timers.pop()();
  assert.equal(document.activeElement, searchInput);
  other.focus(); listeners.get('focusin').fn({ type: 'focusin', target: other }); timers.pop()();
  assert.equal(document.activeElement, body);
  target = lit;
  release();
});

test('the rect check includes the edges of the lit place', () => {
  const box = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.ok(within(box, 10, 20) && within(box, 15, 15));
  assert.ok(!within(box, 9, 15) && !within(box, 15, 21));
});
