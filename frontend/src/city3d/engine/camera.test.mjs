import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const built = await build({ stdin: { contents: 'export * from "./camera.ts"; export * as THREE from "three/webgpu";', resolveDir: dir }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;

// A minimal DOM: elements are event targets that count their listeners; the clock is driven by the test.
let listeners = 0;
class FakeNode extends EventTarget {
  children = [];
  addEventListener(...args) { listeners++; super.addEventListener(...args); }
  removeEventListener(...args) { listeners--; super.removeEventListener(...args); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}
class FakeElement extends FakeNode { dataset = {}; tagName = 'DIV'; isContentEditable = false; }
const fakeWindow = new FakeNode();
Object.assign(globalThis, { Node: FakeNode, HTMLElement: FakeElement, window: fakeWindow, document: { body: new FakeElement(), activeElement: null } });
let clock = 0;
Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });

const W = 1600, H = 900;
function setup(extra = {}) {
  const rect = { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
  const dom = Object.assign(new FakeElement(), { clientHeight: H, getBoundingClientRect: () => rect, setPointerCapture() {} });
  const host = Object.assign(new FakeElement(), { getBoundingClientRect: () => rect, focus() { document.activeElement = host; } });
  host.children.push(dom);
  const camera = city.createCamera(320), views = [];
  const rig = city.createCameraRig(camera, { dom, host, radius: 320, ring: 62.2, reach: 246, onView: view => views.push(view), ...extra });
  rig.resize(W, H);
  let now = 1000;
  /** Runs frames for `seconds` of the test clock. */
  const frames = (seconds = .5) => { for (let t = 0; t < seconds; t += 1 / 60) { now += 1000 / 60; clock += 1000 / 60; rig.update(now); } };
  frames(1 / 60);
  return { dom, host, camera, rig, views, frames };
}
const pointer = (type, id, x, y, more = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, isPrimary: id === 1, ...more });
const mouse = (type, x, y, more = {}) => pointer(type, 1, x, y, { pointerType: 'mouse', ...more });
function key(type, code, target, more = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), { code, key: code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more });
  Object.defineProperty(event, 'target', { value: target });
  fakeWindow.dispatchEvent(event);
  return event;
}
/** Where a world point is on the canvas. */
function screenOf(camera, point) {
  const v = point.clone().project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
}
/** The ground (y = 0) under a canvas point. */
function groundAt(camera, x, y) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x / W * 2 - 1, 1 - y / H * 2), camera);
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
}
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
/** Moves pointers in steps from their start to their end points, one pointer per event like a browser. */
function gesture(dom, paths, steps = 12, more = {}) {
  for (const [id, [x, y]] of paths) dom.dispatchEvent(pointer('pointerdown', id, x, y, more));
  for (let i = 1; i <= steps; i++) {
    for (const [id, [x0, y0, x1, y1]] of paths) { clock += 4; dom.dispatchEvent(pointer('pointermove', id, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, more)); }
  }
}

test('a drag grabs the ground: the point under the pointer follows it, the view only slides', () => {
  const { dom, host, camera, rig } = setup();
  const before = rig.currentView(), grabbed = groundAt(camera, 800, 500);
  dom.dispatchEvent(mouse('pointerdown', 800, 500));
  assert.equal(host.dataset.dragging, 'true');
  assert.equal(document.activeElement, host, 'a click focuses the map, so the keys work straight away');
  for (let i = 1; i <= 10; i++) { clock += 16; dom.dispatchEvent(mouse('pointermove', 800 - 30 * i, 500 + 15 * i)); }
  const at = screenOf(camera, grabbed), after = rig.currentView();
  near(at.x, 500, .5, 'grabbed point x'); near(at.y, 650, .5, 'grabbed point y');
  assert.equal(after.azimuth, before.azimuth); assert.equal(after.polar, before.polar); assert.equal(after.distance, before.distance);
  assert.notDeepEqual(after.target, before.target);
  clock += 200; dom.dispatchEvent(mouse('pointerup', 500, 650));
  assert.equal(host.dataset.dragging, undefined);
  rig.dispose();
});

test('a flick glides on and comes to rest, reported once; a drag held still before release stays put', () => {
  const { dom, rig, views, frames } = setup();
  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  for (let i = 1; i <= 6; i++) { clock += 16; dom.dispatchEvent(mouse('pointermove', 800 - 25 * i, 450)); }
  const released = rig.currentView();
  clock += 4; dom.dispatchEvent(mouse('pointerup', 650, 450));
  frames(.2);
  const gliding = rig.currentView();
  const moved = Math.hypot(gliding.target[0] - released.target[0], gliding.target[2] - released.target[2]);
  assert.ok(moved > 1, `the city glides on after a flick (${moved.toFixed(2)})`);
  assert.equal(views.length, 0, 'not at rest while gliding');
  frames(3);
  const rest = rig.currentView();
  frames(.5);
  assert.deepEqual(rig.currentView(), rest, 'the glide stops');
  assert.equal(views.length, 1, 'the resting view is reported once');

  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  for (let i = 1; i <= 6; i++) { clock += 16; dom.dispatchEvent(mouse('pointermove', 800 - 25 * i, 450)); }
  const held = rig.currentView();
  clock += 300; dom.dispatchEvent(mouse('pointerup', 650, 450));
  frames(.5);
  assert.deepEqual(rig.currentView(), held, 'no glide after the pointer stood still');
  rig.dispose();
});

test('a tap stays a tap: the view barely moves and never glides', () => {
  const { dom, rig, frames } = setup();
  const before = rig.currentView();
  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  clock += 16; dom.dispatchEvent(mouse('pointermove', 802, 451));
  clock += 16; dom.dispatchEvent(mouse('pointerup', 802, 451));
  const tapped = rig.currentView();
  frames(.5);
  assert.deepEqual(rig.currentView(), tapped);
  assert.ok(Math.hypot(tapped.target[0] - before.target[0], tapped.target[2] - before.target[2]) < 1);
  rig.dispose();
});

test('the right button, or Shift with the left, turns and tilts around the view centre', () => {
  for (const press of [{ button: 2 }, { button: 0, shiftKey: true }]) {
    const { dom, rig } = setup();
    const before = rig.currentView();
    dom.dispatchEvent(mouse('pointerdown', 800, 450, press));
    dom.dispatchEvent(mouse('pointermove', 900, 450, press));
    dom.dispatchEvent(mouse('pointermove', 900, 420, press));
    const after = rig.currentView();
    near(after.azimuth, before.azimuth - 2 * Math.PI * .75 * 100 / H, 1e-9, 'dragging right turns the camera left around the centre');
    near(after.polar, before.polar + 2 * Math.PI * .75 * 30 / H, 1e-9, 'dragging up lowers the camera towards the horizon');
    assert.deepEqual(after.target, before.target);
    dom.dispatchEvent(mouse('pointerup', 900, 420, press));
    rig.dispose();
  }
});

test('the two mouse schemes: "map" drags with the left button, "orbit" (as before) turns with it and moves with the right', () => {
  const { mouseGesture, fingerGesture } = city;
  assert.equal(mouseGesture('map', 0), 'drag');
  assert.equal(mouseGesture('map', 2), 'turn');
  assert.equal(mouseGesture('map', 1), 'turn');
  assert.equal(mouseGesture('map', 0, { shiftKey: true }), 'turn');
  assert.equal(mouseGesture('map', 0, { altKey: true }), 'turn');
  assert.equal(mouseGesture('orbit', 0), 'turn');
  assert.equal(mouseGesture('orbit', 2), 'drag');
  // As OrbitControls: Shift, Ctrl or Cmd swap the buttons, Alt changes nothing.
  for (const key of ['shiftKey', 'ctrlKey', 'metaKey']) {
    assert.equal(mouseGesture('orbit', 0, { [key]: true }), 'drag', `${key} + left moves`);
    assert.equal(mouseGesture('orbit', 2, { [key]: true }), 'turn', `${key} + right turns`);
  }
  assert.equal(mouseGesture('orbit', 0, { altKey: true }), 'turn');
  assert.equal(mouseGesture('orbit', 1), 'dolly');
  assert.equal(fingerGesture('map'), 'drag');
  assert.equal(fingerGesture('orbit'), 'turn');
});

test('"orbit": a left drag turns around the view centre, a right drag grabs the ground, the middle button zooms', () => {
  const { dom, camera, rig } = setup({ controls: 'orbit' });
  const before = rig.currentView();
  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  dom.dispatchEvent(mouse('pointermove', 900, 450));
  dom.dispatchEvent(mouse('pointerup', 900, 450));
  const turned = rig.currentView();
  near(turned.azimuth, before.azimuth - 2 * Math.PI * .75 * 100 / H, 1e-9, 'a left drag turns');
  assert.deepEqual(turned.target, before.target, 'and does not move the city');
  const grabbed = groundAt(camera, 800, 500);
  dom.dispatchEvent(mouse('pointerdown', 800, 500, { button: 2 }));
  for (let i = 1; i <= 10; i++) { clock += 16; dom.dispatchEvent(mouse('pointermove', 800 - 20 * i, 500 + 10 * i, { button: 2 })); }
  const at = screenOf(camera, grabbed), moved = rig.currentView();
  near(at.x, 600, .5, 'the ground under the pointer follows a right drag (x)'); near(at.y, 600, .5, '(y)');
  assert.equal(moved.azimuth, turned.azimuth); assert.equal(moved.polar, turned.polar);
  dom.dispatchEvent(mouse('pointerup', 600, 600, { button: 2 }));
  const wheelDown = new Event('mousedown', { cancelable: true }); Object.assign(wheelDown, { button: 1 });
  dom.dispatchEvent(wheelDown);
  assert.equal(wheelDown.defaultPrevented, true, 'the middle button does not start autoscroll');
  const far = rig.currentView().distance;
  dom.dispatchEvent(mouse('pointerdown', 800, 450, { button: 1 }));
  dom.dispatchEvent(mouse('pointermove', 800, 350, { button: 1 }));
  const closer = rig.currentView().distance;
  near(far / closer, 1 / Math.pow(.95, .9), 1e-6, 'dragging up 100 px comes closer at the old OrbitControls rate');
  dom.dispatchEvent(mouse('pointermove', 800, 650, { button: 1 }));
  assert.ok(rig.currentView().distance > far, 'dragging down goes away');
  dom.dispatchEvent(mouse('pointerup', 800, 650, { button: 1 }));
  rig.dispose();
});

test('"orbit": two fingers sliding up together move the city instead of tilting', () => {
  const { dom, rig } = setup({ controls: 'orbit' });
  const before = rig.currentView();
  gesture(dom, [[1, [700, 600, 700, 400]], [2, [900, 600, 900, 400]]]);
  dom.dispatchEvent(pointer('pointerup', 1, 700, 400)); dom.dispatchEvent(pointer('pointerup', 2, 900, 400));
  const after = rig.currentView();
  near(after.polar, before.polar, 1e-9, 'no tilt');
  assert.notDeepEqual(after.target, before.target, 'the city moved');
  rig.dispose();
});

test('"orbit": two fingers twisting do not turn the map, as before', () => {
  const { dom, rig } = setup({ controls: 'orbit' });
  const before = rig.currentView();
  gesture(dom, [[1, [700, 450, 700, 350]], [2, [900, 450, 900, 550]]]);
  dom.dispatchEvent(pointer('pointerup', 1, 700, 350)); dom.dispatchEvent(pointer('pointerup', 2, 900, 550));
  near(rig.currentView().azimuth, before.azimuth, 1e-9, 'no twist in orbit');
  rig.dispose();
});

test('a zoom anchored in the sky zooms around the view centre instead of dragging the view across the city', () => {
  const { dom, rig } = setup({ controls: 'orbit', view: { polar: 1.3, distance: 90, target: [0, 0, 1], azimuth: 0 } });
  const before = rig.currentView();
  dom.dispatchEvent(mouse('pointerdown', 800, 20, { button: 1 }));
  dom.dispatchEvent(mouse('pointermove', 800, 220, { button: 1 }));
  dom.dispatchEvent(mouse('pointerup', 800, 220, { button: 1 }));
  const after = rig.currentView();
  assert.ok(after.distance > before.distance);
  assert.deepEqual(after.target, before.target, 'the centre stays put');
  rig.dispose();
});

test('"orbit": one finger turns; setControls switches the scheme for the next gesture', () => {
  const { dom, rig } = setup({ controls: 'orbit' });
  const before = rig.currentView();
  gesture(dom, [[1, [800, 450, 900, 450]]]);
  dom.dispatchEvent(pointer('pointerup', 1, 900, 450));
  assert.ok(rig.currentView().azimuth < before.azimuth, 'one finger turns the view');
  assert.deepEqual(rig.currentView().target, before.target);
  rig.setControls('map');
  const turned = rig.currentView();
  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  dom.dispatchEvent(mouse('pointermove', 700, 450));
  dom.dispatchEvent(mouse('pointerup', 700, 450));
  assert.equal(rig.currentView().azimuth, turned.azimuth, 'after switching to "map" the left drag no longer turns');
  assert.notDeepEqual(rig.currentView().target, turned.target, 'it moves the city');
  rig.dispose();
});

test('two fingers: a pinch keeps the ground under each finger, even in a tilted view', () => {
  const { dom, camera, rig } = setup();
  const before = rig.currentView(), underA = groundAt(camera, 700, 380), underB = groundAt(camera, 900, 520);
  gesture(dom, [[1, [700, 380, 620, 330]], [2, [900, 520, 990, 590]]], 16);
  const after = rig.currentView(), a = screenOf(camera, underA), b = screenOf(camera, underB);
  assert.ok(after.distance < before.distance, 'spreading zooms in');
  near(a.x, 620, 1, 'finger A keeps its ground (x)'); near(a.y, 330, 1, '(y)');
  near(b.x, 990, 1, 'finger B keeps its ground (x)'); near(b.y, 590, 1, '(y)');
  dom.dispatchEvent(pointer('pointerup', 1, 620, 330)); dom.dispatchEvent(pointer('pointerup', 2, 990, 590));
  rig.dispose();
});

test('two fingers twisting turn the map with them, past a small dead zone', () => {
  const { dom, camera, rig } = setup();
  const before = rig.currentView(), underA = groundAt(camera, 700, 450), underB = groundAt(camera, 900, 450);
  // Turn 0.6 rad clockwise on the screen about the midpoint, spreading a little.
  const angle = .6, span = 120, end = (sign) => [800 + sign * span * Math.cos(angle), 450 + sign * span * Math.sin(angle)];
  gesture(dom, [[1, [700, 450, ...end(-1)]], [2, [900, 450, ...end(1)]]], 24);
  const after = rig.currentView(), a = screenOf(camera, underA), b = screenOf(camera, underB);
  assert.ok(after.azimuth > before.azimuth + .2, `the view turned the same way as the fingers: ${after.azimuth - before.azimuth}`);
  const [ax, ay] = end(-1), [bx, by] = end(1);
  // Only the dead zone at the start is not followed.
  for (const [p, x, y] of [[a, ax, ay], [b, bx, by]]) assert.ok(Math.hypot(p.x - x, p.y - y) < span * (city.TWIST_START + .03), `the ground under a finger stays near it: (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) vs (${x.toFixed(0)}, ${y.toFixed(0)})`);
  dom.dispatchEvent(pointer('pointerup', 1, ax, ay)); dom.dispatchEvent(pointer('pointerup', 2, bx, by));
  rig.dispose();
});

test('a pinch that only zooms does not wobble the map; lifting one finger carries on dragging without a jump', () => {
  const { dom, camera, rig } = setup();
  const before = rig.currentView();
  gesture(dom, [[1, [700, 450, 640, 452]], [2, [900, 450, 960, 440]]], 10);
  const pinched = rig.currentView();
  assert.equal(pinched.azimuth, before.azimuth, 'a small twist is ignored');
  assert.ok(pinched.distance < before.distance);
  dom.dispatchEvent(pointer('pointerup', 2, 960, 440));
  const grabbed = groundAt(camera, 640, 452);
  for (let i = 1; i <= 5; i++) dom.dispatchEvent(pointer('pointermove', 1, 640 + 20 * i, 452));
  const at = screenOf(camera, grabbed);
  near(at.x, 740, .5, 'the remaining finger drags from where it is'); near(at.y, 452, .5, 'y');
  dom.dispatchEvent(pointer('pointerup', 1, 740, 452));
  rig.dispose();
});

test('two fingers side by side sliding up together tilt the view instead of panning', () => {
  const { dom, rig } = setup();
  const before = rig.currentView();
  gesture(dom, [[1, [700, 600, 700, 480]], [2, [900, 600, 900, 480]]], 12);
  const after = rig.currentView();
  near(after.polar, Math.min(1.3, before.polar + 2.4 * 120 / H), 1e-6, 'up tilts towards the horizon');
  assert.equal(after.distance, before.distance); assert.deepEqual(after.target, before.target);
  rig.dispose();
});

test('two-finger gestures are told apart only once a finger has moved past the slop', () => {
  const p = (x, y) => ({ x, y });
  assert.equal(city.classifyTwoFingers(p(0, 0), p(200, 0), p(0, -4), p(200, -4)), null);
  assert.equal(city.classifyTwoFingers(p(0, 0), p(200, 0), p(3, -40), p(198, -36)), 'tilt');
  assert.equal(city.classifyTwoFingers(p(0, 0), p(200, 0), p(0, 0), p(200, -40)), 'pinch', 'one finger still: a twist');
  assert.equal(city.classifyTwoFingers(p(0, 0), p(200, 0), p(0, -40), p(200, 40)), 'pinch', 'opposite ways: a twist');
  assert.equal(city.classifyTwoFingers(p(0, 0), p(0, 200), p(0, -40), p(0, 160)), 'pinch', 'one above the other: a drag');
  const step = city.twoFingerStep(p(0, 0), p(100, 0), p(-50, 0), p(150, 0));
  assert.equal(step.spread, 2); assert.equal(step.twist, 0); assert.deepEqual(step.to, p(50, 0));
  near(city.twoFingerStep(p(0, 0), p(100, 0), p(0, 0), p(0, 100)).twist, Math.PI / 2, 1e-12, 'clockwise on screen is positive');
  near(city.twoFingerStep(p(0, 0), p(-100, 1), p(0, 0), p(-100, -1)).twist, .02, 1e-3, 'across ±π the twist stays small');
  assert.equal(city.classifyTwoFingers(p(0, 0), p(200, 0), p(0, -12), p(200, 0)), null, 'waits for the other finger');
});

test('the wheel zooms smoothly towards the pointer and within the limits', () => {
  const { host, camera, rig, frames, views } = setup();
  const before = rig.currentView(), grabbed = groundAt(camera, 1200, 330);
  const wheel = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -300, deltaMode: 0, ctrlKey: false, clientX: 1200, clientY: 330 });
  host.dispatchEvent(wheel);
  assert.ok(wheel.defaultPrevented, 'the page does not scroll');
  frames(.05);
  assert.ok(rig.currentView().distance < before.distance && rig.currentView().distance > before.distance * Math.exp(-.54), 'eased, not in one jump');
  frames(1);
  near(rig.currentView().distance, before.distance * Math.exp(-300 * .0018), 1e-6, 'a notch zooms 1.2×');
  const at = screenOf(camera, grabbed);
  near(at.x, 1200, 1, 'the ground under the pointer stays (x)'); near(at.y, 330, 1, '(y)');
  assert.equal(views.length, 1);
  for (let i = 0; i < 20; i++) host.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 500, deltaMode: 0, ctrlKey: false, clientX: 800, clientY: 450 }));
  frames(2);
  near(rig.currentView().distance, 140 * 320 / 150, 1e-6, 'no farther than the limit');
  rig.dispose();
});

test('held keys move along the view, turn and tilt, and stop when released or when focus leaves', () => {
  const { host, rig, frames } = setup();
  const start = rig.currentView();
  const w = key('keydown', 'KeyW', host);
  assert.ok(w.defaultPrevented, 'handled keys are marked, so the page handler skips them');
  frames(.5);
  const moved = rig.currentView(), dx = moved.target[0] - start.target[0], dz = moved.target[2] - start.target[2];
  const forward = [-Math.sin(start.azimuth), -Math.cos(start.azimuth)];
  near(dx * forward[0] + dz * forward[1], start.distance * 1.1 * .5, start.distance * .05, 'W moves forward, up the screen');
  near(dx * forward[1] - dz * forward[0], 0, 1e-6, 'and not sideways');
  key('keyup', 'KeyW', host);
  frames(.2);
  assert.deepEqual(rig.currentView(), (frames(.2), rig.currentView()), 'released: it stops');

  const turned = rig.currentView();
  key('keydown', 'KeyE', host); frames(.25); key('keyup', 'KeyE', host);
  assert.ok(rig.currentView().azimuth > turned.azimuth, 'E turns the camera right');
  const tilted = rig.currentView();
  key('keydown', 'ArrowUp', host, { shiftKey: true }); frames(.25);
  assert.ok(rig.currentView().polar < tilted.polar, 'Shift+Up raises the camera');
  key('keyup', 'ArrowUp', host); frames(.1);
  const raised = rig.currentView(); frames(.2);
  assert.deepEqual(rig.currentView(), raised, 'the key-up ends it even after Shift was let go');

  key('keydown', 'KeyD', host); frames(.1);
  host.dispatchEvent(new Event('focusout'));
  const left = rig.currentView(); frames(.3);
  assert.deepEqual(rig.currentView(), left, 'focus leaving the map releases held keys');

  const input = Object.assign(new FakeElement(), { tagName: 'INPUT' }); host.children.push(input);
  const elsewhere = new FakeElement();
  for (const [target, more] of [[input, {}], [elsewhere, {}], [host, { ctrlKey: true }]]) {
    const ignored = key('keydown', 'KeyW', target, more);
    assert.equal(ignored.defaultPrevented, false);
    frames(.1); key('keyup', 'KeyW', target);
  }
  assert.deepEqual(rig.currentView(), left, 'no movement while typing, from elsewhere on the page, or with Ctrl');
  const body = key('keydown', 'KeyS', document.body); frames(.1); key('keyup', 'KeyS', document.body);
  assert.ok(body.defaultPrevented, 'with nothing focused the map takes the keys');
  rig.dispose();
});

test('the view stays over the city: drags and glides stop at the outer ring road', () => {
  const { dom, rig, frames } = setup();
  for (let round = 0; round < 12; round++) {
    dom.dispatchEvent(mouse('pointerdown', 800, 800));
    for (let i = 1; i <= 8; i++) { clock += 8; dom.dispatchEvent(mouse('pointermove', 800, 800 - 90 * i)); }
    dom.dispatchEvent(mouse('pointerup', 800, 80));
    frames(.3);
  }
  const [x, , z] = rig.currentView().target;
  near(Math.hypot(x, z), 246, 1e-6, 'held at the outer ring');
  rig.dispose();
});

test('a new gesture stops a flight, a flight stops a glide, and dispose removes every listener', () => {
  const before = listeners;
  const { dom, rig, frames } = setup();
  assert.ok(listeners > before);
  rig.focus(100, 100);
  frames(.1);
  dom.dispatchEvent(mouse('pointerdown', 800, 450));
  const grabbed = rig.currentView();
  frames(.5);
  assert.deepEqual(rig.currentView(), grabbed, 'the flight stopped at the press');
  for (let i = 1; i <= 6; i++) { clock += 16; dom.dispatchEvent(mouse('pointermove', 800, 450 - 25 * i)); }
  clock += 4; dom.dispatchEvent(mouse('pointerup', 800, 300));
  rig.focus(-100, 50);
  frames(1.5);
  const landed = rig.currentView(), focus = city.districtFocusView(-100, 50);
  assert.deepEqual({ ...landed, azimuth: 0 }, { ...focus, azimuth: 0 }, 'the flight lands exactly, the glide does not drag it off');
  near(Math.cos(landed.azimuth - focus.azimuth), 1, 1e-12, 'facing the entrance (the short way round)');
  rig.dispose();
  assert.equal(listeners, before);
});
