/**
 * The map camera rig: the city moves like a map. A drag grabs the ground and slides it with the pointer,
 * gliding on after a flick; the right mouse button (or Shift, Ctrl, Alt + drag) turns and tilts the view;
 * the wheel and a pinch zoom towards the pointer; two fingers twist to turn and slide up or down together
 * to tilt; WASD or the arrows move, Q/E turn, R/F tilt. Flights (district focus, buttons) ease in between,
 * the default view is fitted into the free frame between the panels, and the view stays over the city.
 */
import * as THREE from "three/webgpu";
import type { CityView } from "../types";

/** The default view looks over the depot at the CRM centre on the left and the academy on the right. */
export const DEFAULT_VIEW: CityView = { azimuth: -2.62, polar: .95, distance: 90, target: [0, 0, 1] };
/** The old city's limits. Its world reached 150 units and its inner ring road 25; bigger worlds scale them. */
const V1_RADIUS = 150, V1_RING = 25;
export const MIN_DISTANCE = 18, MAX_DISTANCE = 140, MIN_POLAR = .18, MAX_POLAR = 1.3, PAN_RADIUS = 40;
/** A press that moves less than this (CSS px) stays a tap for the picker: it does not glide. */
export const TAP_SLOP = 6;
/** Mouse turning, radians per canvas height of drag (OrbitControls' 2π at rotateSpeed .75). */
const TURN = 2 * Math.PI * .75;
/** Two fingers sliding up or down together tilt this many radians per canvas height. */
const TOUCH_TILT = 2.4;
/** A twist turns the map only once it passes this angle, so a pinch that only zooms does not wobble. */
export const TWIST_START = .12;
/** A drag glides on at its release speed, which decays e-fold every 1/GLIDE_DECAY seconds. */
const GLIDE_DECAY = 5, GLIDE_WINDOW = 100, GLIDE_STILL = 60;
/** Wheel zoom per pixel of delta: a mouse notch (100 px) zooms 1.2×; a trackpad pinch (ctrl) sends small deltas. */
const WHEEL = .0018, WHEEL_PINCH = .01;
/** The wheel's zoom is eased: the distance closes on its goal e-fold every 1/ZOOM_EASE seconds. */
const ZOOM_EASE = 16;
/** Held keys: ground speed in view distances per second, turning, tilting and zooming per second. */
const KEY_MOVE = 1.1, KEY_TURN = 1.6, KEY_TILT = .9, KEY_ZOOM = 1.6;
/** The ground the drag grabs. Rays that meet it farther than this many view distances (near the horizon) stop there. */
const GROUND_Y = 0, GROUND_REACH = 3;
const { clamp, degToRad } = THREE.MathUtils;

type KeyAction = "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight" | "raise" | "lower" | "in" | "out";
const KEYS: Record<string, KeyAction> = {
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyQ: "turnLeft", KeyE: "turnRight", KeyR: "raise", PageUp: "raise", KeyF: "lower", PageDown: "lower",
  Equal: "in", NumpadAdd: "in", Minus: "out", NumpadSubtract: "out",
};
/** Shift + arrows turn and tilt, as the arrows alone did before. */
const SHIFT_KEYS: Record<string, KeyAction> = { ArrowLeft: "turnLeft", ArrowRight: "turnRight", ArrowUp: "raise", ArrowDown: "lower" };
const RESET_KEYS = new Set(["Digit0", "Numpad0", "Home"]);

/** The yaw that turns a district's landmark at (x, z) so its front (+z) faces out to the city, away from the plaza. */
export function districtFacing(x: number, z: number) {
  return Math.atan2(x, z);
}

/** Three-quarter entrance view from the city side: the plaza stays beside the landmark, never on its sightline. */
export function districtFocusView(x: number, z: number, distance = 52): CityView {
  return { target: [x, 2.5, z], azimuth: districtFacing(x, z) + 1, polar: .92, distance: clamp(distance, 38, 60) };
}

/**
 * How two fingers moved, `a` and `b` each from its previous to its current point: the zoom (span ratio,
 * above 1 when they spread), the twist in radians (positive clockwise on screen), and both midpoints.
 */
export function twoFingerStep(a0: Point, b0: Point, a1: Point, b1: Point) {
  const span0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), span1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  let twist = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  if (twist > Math.PI) twist -= 2 * Math.PI; else if (twist < -Math.PI) twist += 2 * Math.PI;
  return {
    spread: span0 > 1 && span1 > 1 ? span1 / span0 : 1, twist,
    from: { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, to: { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 },
  };
}

/**
 * What a two-finger gesture is, once a finger has moved past the slop: "tilt" when both slide up or down
 * together, side by side; "pinch" (zoom, twist and pan) otherwise; null while it is still too small to tell.
 */
export function classifyTwoFingers(a0: Point, b0: Point, a1: Point, b1: Point): "tilt" | "pinch" | null {
  const ax = a1.x - a0.x, ay = a1.y - a0.y, bx = b1.x - b0.x, by = b1.y - b0.y;
  const most = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)), least = Math.min(Math.hypot(ax, ay), Math.hypot(bx, by));
  // Browsers report one finger per event: wait for the other one unless it is clearly held still.
  if (most < TAP_SLOP + 2 || (least < 4 && most < 4 * TAP_SLOP)) return null;
  const upright = (x: number, y: number) => Math.abs(y) > 4 && Math.abs(y) > 2 * Math.abs(x);
  const sideBySide = Math.abs(b0.y - a0.y) <= Math.abs(b0.x - a0.x);
  return upright(ax, ay) && upright(bx, by) && ay * by > 0 && sideBySide ? "tilt" : "pinch";
}

export interface Point { x: number; y: number }

export interface CameraRigOptions {
  /** The canvas: drags, pinches and taps start on it. */
  dom: HTMLElement;
  /** The focusable element the canvas fills: wheel and keys are read on it; `data-dragging` is set on it while dragging. */
  host: HTMLElement;
  /** WorldData.radius: distance limits grow with it for the ×4 world. */
  radius: number;
  /** Radius of the inner ring road (WorldSpec.roadRings[0]), which the default view fits into the frame. */
  ring?: number;
  /** How far from the plaza the view's centre may go: the outer ring road. Defaults to the old city's limit, scaled. */
  reach?: number;
  /** The part of the screen the panels leave free. */
  frame?: HTMLElement;
  /** A view to restore (from the previous visit); the default view otherwise. */
  view?: CityView;
  /** prefers-reduced-motion: flights jump to the end, drags do not glide, the wheel zooms in steps. */
  reducedMotion?: boolean;
  /** The camera came to rest after a drag, a glide, a zoom, keys or a flight. */
  onView: (view: CityView) => void;
}

export interface CameraRig {
  /** Steps flights, glides, eased zoom and held keys; returns true if the camera moved since the last call. */
  update(now: number): boolean;
  animateTo(to: Partial<CityView>, duration?: number): void;
  /** Flies to a district at (x, z), showing its entrance from the side of the plaza. */
  focus(x: number, z: number, distance?: number): void;
  /** Flies to a point keeping the direction; `polar` defaults to the current tilt. */
  focusPoint(target: CityView["target"], distance: number, polar?: number): void;
  zoom(factor: number): void; rotate(radians: number): void; tilt(radians: number): void; reset(): void;
  /** The canvas size in CSS pixels: aspect, field of view and centring in the frame. */
  resize(width: number, height: number): void;
  currentView(): CityView;
  defaultView(): CityView;
  dispose(): void;
}

/** A camera for a world of this radius: far enough to see the horizon from the farthest zoom. */
export function createCamera(radius: number) {
  const scale = Math.max(1, radius / V1_RADIUS);
  return new THREE.PerspectiveCamera(36, 1, 1, Math.max(800, 2 * radius + MAX_DISTANCE * scale));
}

interface Grip { id: number; x: number; y: number; lastX: number; lastY: number; startX: number; startY: number }

export function createCameraRig(camera: THREE.PerspectiveCamera, options: CameraRigOptions): CameraRig {
  const { dom, host, frame, reducedMotion = false } = options;
  const scale = Math.max(1, options.radius / V1_RADIUS), fit = (options.ring ?? V1_RING) / V1_RING;
  const maxDistance = MAX_DISTANCE * scale, panRadius = Math.max(PAN_RADIUS * scale, options.reach ?? 0);

  // The view: the point the camera looks at (centred in the free frame) and the camera around it.
  const target = new THREE.Vector3();
  let azimuth = 0, polar = 1, distance = 60;
  const spherical = new THREE.Spherical(), offset = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), grabbed = new THREE.Vector3(), under = new THREE.Vector3();
  let tween: { from: CityView; to: CityView; start: number; duration: number } | null = null;
  let width = 0, height = 0, last = 0, moved = true, placed = !!options.view, unsaved = false;

  function place() {
    camera.position.copy(target).add(offset.setFromSpherical(spherical.set(distance, polar, azimuth)));
    camera.lookAt(target);
    camera.updateMatrixWorld();
    moved = true;
  }
  function applyView(view: CityView) {
    target.set(...view.target); azimuth = view.azimuth; polar = view.polar; distance = view.distance;
    place();
  }
  function currentView(): CityView {
    return { azimuth, polar, distance, target: [target.x, target.y, target.z] };
  }
  /** Keeps a view within the limits, e.g. one saved in the ×4 world and restored in the small one. */
  function limit(view: CityView): CityView {
    const [x, y, z] = view.target, length = Math.hypot(x, z), k = length > panRadius ? panRadius / length : 1;
    return { azimuth: view.azimuth, polar: clamp(view.polar, MIN_POLAR, MAX_POLAR), distance: clamp(view.distance, MIN_DISTANCE, maxDistance), target: [x * k, y, z * k] };
  }
  /** Keeps the view's centre over the city; returns false if it had to be pulled back. */
  function keepInside() {
    const length = Math.hypot(target.x, target.z);
    if (length <= panRadius) return true;
    target.x *= panRadius / length; target.z *= panRadius / length;
    return false;
  }
  const frameRect = () => { const f = frame?.getBoundingClientRect(); return f && f.width > 60 && f.height > 60 ? f : null; };
  /** Default view sized so the inner ring road fills the free frame, whatever the screen. */
  function defaultView(): CityView {
    const f = frameRect(), low = 62 * fit, high = Math.min(125 * fit, maxDistance);
    if (!f || !height) return { ...DEFAULT_VIEW, distance: clamp(DEFAULT_VIEW.distance * fit, low, high) };
    const perPixel = 2 * Math.tan(degToRad(camera.fov) / 2) / height;
    return { ...DEFAULT_VIEW, distance: clamp(Math.max(52 * fit / (perPixel * f.width), 38 * fit / (perPixel * f.height)), low, high) };
  }

  /**
   * The ground point under a point on the canvas (client coordinates) into `out`. Near the horizon it is the
   * farthest the ray reaches, and the result is false: the point is not really under the pointer.
   */
  function ground(x: number, y: number, out: THREE.Vector3) {
    const rect = dom.getBoundingClientRect();
    ndc.set((x - rect.left) / (rect.width || 1) * 2 - 1, -(y - rect.top) / (rect.height || 1) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray, reach = distance * GROUND_REACH;
    const hit = direction.y < -1e-4 ? (GROUND_Y - origin.y) / direction.y : Infinity, t = Math.min(reach, hit);
    out.copy(direction).multiplyScalar(t).add(origin); out.y = GROUND_Y;
    return hit <= reach;
  }
  /** Slides the city so the ground under (x0, y0) comes under (x1, y1). */
  function drag(x0: number, y0: number, x1: number, y1: number) {
    ground(x0, y0, grabbed); ground(x1, y1, under);
    target.x += grabbed.x - under.x; target.z += grabbed.z - under.z;
    const inside = keepInside(); place();
    return inside;
  }
  /** Sets the distance keeping the ground under `at` where it was (the view's centre without `at`). */
  function zoomAround(at: Point | null, nextDistance: number) {
    if (at) ground(at.x, at.y, grabbed);
    distance = clamp(nextDistance, MIN_DISTANCE, maxDistance); place();
    if (at) { ground(at.x, at.y, under); target.x += grabbed.x - under.x; target.z += grabbed.z - under.z; keepInside(); place(); }
  }
  const fingers = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /**
   * Two fingers moved from a0, b0 to a1, b1: the view zooms and turns so the ground under each finger stays
   * under it. Both are measured on the ground, so a tilted view follows the fingers exactly; if a finger is
   * near the horizon, on the screen instead.
   */
  function pinch(a0: Point, b0: Point, a1: Point, b1: Point) {
    const [ga, gb, ha, hb] = fingers;
    const onGround = [ground(a0.x, a0.y, ga), ground(b0.x, b0.y, gb), ground(a1.x, a1.y, ha), ground(b1.x, b1.y, hb)].every(Boolean);
    let spread: number, twist: number;
    const x0 = gb.x - ga.x, z0 = gb.z - ga.z, x1 = hb.x - ha.x, z1 = hb.z - ha.z, span0 = Math.hypot(x0, z0), span1 = Math.hypot(x1, z1);
    if (onGround && span0 > 1e-3 && span1 > 1e-3) {
      spread = span1 / span0; twist = Math.atan2(z1, x1) - Math.atan2(z0, x0);
      if (twist > Math.PI) twist -= 2 * Math.PI; else if (twist < -Math.PI) twist += 2 * Math.PI;
    } else ({ spread, twist } = twoFingerStep(a0, b0, a1, b1));
    twisted += twist;
    if (!twisting && Math.abs(twisted) > TWIST_START) twisting = true;
    distance = clamp(distance / spread, MIN_DISTANCE, maxDistance);
    if (twisting) azimuth += twist;
    place();
    // Then the ground that was under the fingers is slid back under them.
    ground(a1.x, a1.y, ha); ground(b1.x, b1.y, hb);
    target.x += (ga.x + gb.x - ha.x - hb.x) / 2; target.z += (ga.z + gb.z - ha.z - hb.z) / 2;
    keepInside(); place();
  }

  function animateTo(to: Partial<CityView>, duration = 650) {
    stopInput(); unsaved = false;
    const from = currentView();
    let turnTo = to.azimuth ?? from.azimuth;
    while (turnTo - from.azimuth > Math.PI) turnTo -= Math.PI * 2;
    while (turnTo - from.azimuth < -Math.PI) turnTo += Math.PI * 2;
    const end = { ...limit({ ...from, ...to }), azimuth: turnTo };
    if (reducedMotion || duration <= 0) { tween = null; applyView(end); options.onView(currentView()); return; }
    // The flight starts on the next frame, so its first step is never skipped or negative.
    tween = { from, to: end, start: -1, duration };
  }
  function stepTween(now: number) {
    if (!tween) return;
    if (tween.start < 0) tween.start = now;
    const k = Math.min(1, (now - tween.start) / tween.duration), e = 1 - Math.pow(1 - k, 3), { from, to } = tween;
    applyView({ azimuth: from.azimuth + (to.azimuth - from.azimuth) * e, polar: from.polar + (to.polar - from.polar) * e, distance: from.distance + (to.distance - from.distance) * e, target: from.target.map((v, i) => v + (to.target[i] - v) * e) as CityView["target"] });
    if (k >= 1) { tween = null; options.onView(currentView()); }
  }

  // Pointers: one drags the ground (a mouse turns with its right button or a modifier), two pinch or tilt.
  const grips = new Map<number, Grip>();
  let mode: "none" | "drag" | "turn" | "two" | "pinch" | "tilt" = "none", travelled = 0, twisted = 0, twisting = false;
  const samples: { time: number; x: number; z: number }[] = [];
  const glide = new THREE.Vector2();
  let gliding = false;
  // Wheel zoom eases towards `zoomGoal`, keeping the ground under `zoomAt` in place.
  let zooming = false, zoomGoal = 0, zoomAt: Point | null = null;
  const held = new Map<string, KeyAction>();

  /** Stops glides, eased zoom and held keys: a flight or a new gesture takes over. */
  function stopInput() { gliding = false; zooming = false; held.clear(); }
  function begin() { tween = null; gliding = false; zooming = false; unsaved = true; }
  const pair = () => { const [a, b] = grips.values(); return [a, b] as const; };
  const pointsOf = (g: Grip) => ({ last: { x: g.lastX, y: g.lastY }, now: { x: g.x, y: g.y }, start: { x: g.startX, y: g.startY } });
  function restartGrips() { for (const g of grips.values()) { g.lastX = g.startX = g.x; g.lastY = g.startY = g.y; } }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && grips.size) return;
    if (grips.size >= 2) return;
    begin();
    try { dom.setPointerCapture(event.pointerId); } catch { /* A synthetic or already released pointer. */ }
    grips.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, startX: event.clientX, startY: event.clientY });
    if (event.pointerType === "mouse") {
      // A click focuses the map, so the keys work straight after it.
      if (document.activeElement !== host) host.focus?.({ preventScroll: true });
      mode = event.button === 0 && !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) ? "drag" : "turn";
    } else if (grips.size === 1) mode = "drag";
    else { mode = "two"; restartGrips(); }
    travelled = 0; twisted = 0; twisting = false; samples.length = 0;
    host.dataset.dragging = "true";
  };

  const onPointerMove = (event: PointerEvent) => {
    const grip = grips.get(event.pointerId);
    if (!grip || (event.clientX === grip.x && event.clientY === grip.y)) return;
    grip.x = event.clientX; grip.y = event.clientY;
    unsaved = true;
    if (mode === "drag") {
      travelled = Math.max(travelled, Math.hypot(grip.x - grip.startX, grip.y - grip.startY));
      if (!drag(grip.lastX, grip.lastY, grip.x, grip.y)) samples.length = 0;
      else { const time = performance.now(); samples.push({ time, x: target.x, z: target.z }); while (samples.length > 2 && time - samples[0].time > GLIDE_WINDOW) samples.shift(); }
    } else if (mode === "turn") {
      const h = height || dom.clientHeight || 1;
      travelled = Math.max(travelled, Math.hypot(grip.x - grip.startX, grip.y - grip.startY));
      azimuth -= TURN * (grip.x - grip.lastX) / h;
      polar = clamp(polar - TURN * (grip.y - grip.lastY) / h, MIN_POLAR, MAX_POLAR);
      place();
    } else if (grips.size === 2) {
      const [a, b] = pair(), pa = pointsOf(a), pb = pointsOf(b);
      travelled = TAP_SLOP;
      if (mode === "two") {
        // Undecided until a finger has moved enough to tell a tilt from a pinch; then the whole movement counts.
        const kind = classifyTwoFingers(pa.start, pb.start, pa.now, pb.now);
        if (!kind) return;
        mode = kind;
        pa.last = pa.start; pb.last = pb.start;
      }
      if (mode === "tilt") {
        const dy = (pa.now.y - pa.last.y + pb.now.y - pb.last.y) / 2;
        polar = clamp(polar - TOUCH_TILT * dy / (height || dom.clientHeight || 1), MIN_POLAR, MAX_POLAR);
        place();
      } else {
        pinch(pa.last, pb.last, pa.now, pb.now);
      }
      a.lastX = a.x; a.lastY = a.y; b.lastX = b.x; b.lastY = b.y;
      return;
    }
    grip.lastX = grip.x; grip.lastY = grip.y;
  };

  const onPointerUp = (event: PointerEvent) => {
    const grip = grips.get(event.pointerId);
    if (!grip) return;
    grips.delete(event.pointerId);
    if (grips.size === 1) {
      // One finger left of a pinch: it carries on dragging from where it is, without a jump.
      mode = "drag"; restartGrips(); samples.length = 0; travelled = TAP_SLOP;
      return;
    }
    if (grips.size) return;
    if (mode === "drag" && travelled >= TAP_SLOP && !reducedMotion && event.type === "pointerup") startGlide();
    mode = "none";
    delete host.dataset.dragging;
  };
  /** A flick glides on at the speed of the last tenth of a second; a drag that stopped before release stays. */
  function startGlide() {
    const time = performance.now(), first = samples[0], lastSample = samples[samples.length - 1];
    samples.length = 0;
    if (!first || !lastSample || time - lastSample.time > GLIDE_STILL || lastSample.time - first.time < 8) return;
    const seconds = (lastSample.time - first.time) / 1000;
    glide.set((lastSample.x - first.x) / seconds, (lastSample.z - first.z) / seconds);
    const speed = glide.length(), cap = distance * 6;
    if (speed < distance * .05) return;
    if (speed > cap) glide.multiplyScalar(cap / speed);
    gliding = true;
  }
  const onContextMenu = (event: Event) => event.preventDefault();
  // The middle button turns the view too, instead of starting the browser's autoscroll.
  const onMouseDown = (event: MouseEvent) => { if (event.button === 1) event.preventDefault(); };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (!zooming) zoomGoal = distance;
    begin();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height || 800 : 1;
    zoomGoal = clamp(zoomGoal * Math.exp(event.deltaY * unit * (event.ctrlKey ? WHEEL_PINCH : WHEEL)), MIN_DISTANCE, maxDistance);
    zoomAt = { x: event.clientX, y: event.clientY };
    if (reducedMotion) zoomAround(zoomAt, zoomGoal);
    else zooming = true;
  };

  const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  /** Keys work while the map (or nothing else on the page) has focus, and never while typing or with Ctrl/Cmd/Alt. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
    if (event.target !== document.body && !(event.target instanceof Node && host.contains(event.target))) return;
    if (RESET_KEYS.has(event.code)) { event.preventDefault(); if (!event.repeat) animateTo(defaultView(), 700); return; }
    const action = (event.shiftKey && SHIFT_KEYS[event.code]) || KEYS[event.code];
    if (!action) return;
    event.preventDefault();
    if (!held.has(event.code)) { tween = null; gliding = false; zooming = false; unsaved = true; held.set(event.code, action); }
  };
  const onKeyUp = (event: KeyboardEvent) => { held.delete(event.code); };
  const release = () => { held.clear(); };

  function stepKeys(dt: number) {
    let forward = 0, right = 0, turn = 0, raise = 0, zoom = 0;
    for (const action of held.values()) {
      if (action === "forward") forward++; else if (action === "back") forward--;
      else if (action === "right") right++; else if (action === "left") right--;
      else if (action === "turnRight") turn++; else if (action === "turnLeft") turn--;
      else if (action === "raise") raise++; else if (action === "lower") raise--;
      else if (action === "in") zoom++; else zoom--;
    }
    const length = Math.hypot(forward, right);
    if (length) {
      // Forward is up the screen along the ground, right is to the screen's right.
      const step = distance * KEY_MOVE * dt / length, sin = Math.sin(azimuth), cos = Math.cos(azimuth);
      target.x += (-sin * forward + cos * right) * step; target.z += (-cos * forward - sin * right) * step;
      keepInside();
    }
    azimuth += turn * KEY_TURN * dt;
    polar = clamp(polar - raise * KEY_TILT * dt, MIN_POLAR, MAX_POLAR);
    distance = clamp(distance * Math.exp(-zoom * KEY_ZOOM * dt), MIN_DISTANCE, maxDistance);
    place();
  }

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerUp);
  dom.addEventListener("lostpointercapture", onPointerUp);
  dom.addEventListener("contextmenu", onContextMenu);
  dom.addEventListener("mousedown", onMouseDown);
  host.addEventListener("wheel", onWheel, { passive: false });
  // Capture, so the keys the map takes are marked handled before the page's own key handlers see them.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", release);
  host.addEventListener("focusout", release);
  applyView(limit(options.view ?? DEFAULT_VIEW));

  return {
    animateTo, currentView, defaultView,
    update(now) {
      const dt = last ? clamp((now - last) / 1000, 0, .05) : 1 / 60;
      last = now;
      stepTween(now);
      if (gliding) {
        target.x += glide.x * dt; target.z += glide.y * dt;
        glide.multiplyScalar(Math.exp(-GLIDE_DECAY * dt));
        if (!keepInside() || glide.length() < distance * .02) gliding = false;
        place();
      }
      if (zooming) {
        const next = distance * Math.pow(zoomGoal / distance, 1 - Math.exp(-ZOOM_EASE * dt));
        const done = Math.abs(Math.log(zoomGoal / next)) < .002;
        zoomAround(zoomAt, done ? zoomGoal : next);
        if (done) zooming = false;
      }
      if (held.size) stepKeys(dt);
      // The view is remembered once the camera comes to rest after direct manipulation.
      if (unsaved && !grips.size && !gliding && !zooming && !held.size && !tween) { unsaved = false; options.onView(currentView()); }
      const result = moved; moved = false;
      return result;
    },
    focus(x, z, focusDistance = 52) {
      animateTo(districtFocusView(x, z, focusDistance));
    },
    focusPoint(point, focusDistance, focusPolar) { animateTo({ target: point, distance: focusDistance, ...(focusPolar === undefined ? {} : { polar: focusPolar }) }); },
    zoom(factor) { animateTo({ distance: currentView().distance * factor }, 320); },
    rotate(radians) { animateTo({ azimuth: currentView().azimuth + radians }, 420); },
    tilt(radians) { animateTo({ polar: currentView().polar + radians }, 320); },
    reset() { animateTo(defaultView(), 700); },
    resize(w, h) {
      width = w; height = h;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.fov = width < 480 ? 50 : 36;
      // The canvas fills the screen; the city is centred in the free frame between the panels.
      const f = frameRect(), bounds = host.getBoundingClientRect();
      if (f) camera.setViewOffset(width, height, bounds.left + width / 2 - (f.left + f.right) / 2, bounds.top + height / 2 - (f.top + f.bottom) / 2, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      moved = true;
      // The default view depends on the frame, so it is placed once the size is known.
      if (!placed) { placed = true; applyView(defaultView()); }
    },
    dispose() {
      tween = null; stopInput(); grips.clear();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      dom.removeEventListener("lostpointercapture", onPointerUp);
      dom.removeEventListener("contextmenu", onContextMenu);
      dom.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      host.removeEventListener("focusout", release);
      delete host.dataset.dragging;
    },
  };
}
