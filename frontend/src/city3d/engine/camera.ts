/**
 * The orbit camera rig, ported from the old cityScene.ts: OrbitControls within limits, eased flights,
 * the default view fitted into the free frame between the panels, and panning kept over the city.
 */
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CityView } from "../types";

/** The default view looks over the depot at the CRM centre on the left and the academy on the right. */
export const DEFAULT_VIEW: CityView = { azimuth: -2.62, polar: .95, distance: 90, target: [0, 0, 1] };
/** The old city's limits. Its world reached 150 units and its inner ring road 25; bigger worlds scale them. */
const V1_RADIUS = 150, V1_RING = 25;
const MIN_DISTANCE = 18, MAX_DISTANCE = 140, MIN_POLAR = .18, MAX_POLAR = 1.3, PAN_RADIUS = 40;
/** OrbitControls damping per 60 Hz frame; rescaled each update so 30 fps glides the same. */
const DAMPING = .09;
const { clamp, degToRad } = THREE.MathUtils;

export interface CameraRigOptions {
  /** The canvas the controls listen on. */
  dom: HTMLElement;
  /** The element the canvas fills: the frame is centred relative to it; `data-dragging` is set on it while dragging. */
  host: HTMLElement;
  /** WorldData.radius: distance and pan limits grow with it for the ×4 world. */
  radius: number;
  /** Radius of the inner ring road (WorldSpec.roadRings[0]), which the default view fits into the frame. */
  ring?: number;
  /** The part of the screen the panels leave free. */
  frame?: HTMLElement;
  /** A view to restore (from the previous visit); the default view otherwise. */
  view?: CityView;
  /** prefers-reduced-motion: flights jump straight to the end. */
  reducedMotion?: boolean;
  /** The camera came to rest after a drag or a flight. */
  onView: (view: CityView) => void;
}

export interface CameraRig {
  controls: OrbitControls;
  /** Steps the flight and the controls; returns true if the camera moved since the last call. */
  update(now: number): boolean;
  animateTo(to: Partial<CityView>, duration?: number): void;
  /** Flies to a district at (x, z), looking at it from the plaza, where its entrance faces. */
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

export function createCameraRig(camera: THREE.PerspectiveCamera, options: CameraRigOptions): CameraRig {
  const { host, frame, reducedMotion = false } = options;
  const scale = Math.max(1, options.radius / V1_RADIUS), fit = (options.ring ?? V1_RING) / V1_RING;
  const maxDistance = MAX_DISTANCE * scale, panRadius = PAN_RADIUS * scale;
  const controls = new OrbitControls(camera, options.dom);
  Object.assign(controls, { enableDamping: true, dampingFactor: DAMPING, minDistance: MIN_DISTANCE, maxDistance, minPolarAngle: MIN_POLAR, maxPolarAngle: MAX_POLAR, screenSpacePanning: false, rotateSpeed: .75, zoomSpeed: .9, panSpeed: .8, zoomToCursor: true });
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  const spherical = new THREE.Spherical(), offset = new THREE.Vector3(), shift = new THREE.Vector3();
  let tween: { from: CityView; to: CityView; start: number; duration: number } | null = null;
  let width = 0, height = 0, last = 0, moved = true, placed = !!options.view;

  function applyView(view: CityView) {
    controls.target.set(...view.target);
    spherical.set(view.distance, view.polar, view.azimuth);
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    camera.lookAt(controls.target);
    moved = true;
  }
  function currentView(): CityView {
    spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
    return { azimuth: spherical.theta, polar: spherical.phi, distance: spherical.radius, target: [controls.target.x, controls.target.y, controls.target.z] };
  }
  /** Keeps a view within the limits, e.g. one saved in the ×4 world and restored in the small one. */
  function limit(view: CityView): CityView {
    const [x, y, z] = view.target, length = Math.hypot(x, z), k = length > panRadius ? panRadius / length : 1;
    return { azimuth: view.azimuth, polar: clamp(view.polar, MIN_POLAR, MAX_POLAR), distance: clamp(view.distance, MIN_DISTANCE, maxDistance), target: [x * k, y, z * k] };
  }
  const frameRect = () => { const f = frame?.getBoundingClientRect(); return f && f.width > 60 && f.height > 60 ? f : null; };
  /** Default view sized so the inner ring road fills the free frame, whatever the screen. */
  function defaultView(): CityView {
    const f = frameRect(), low = 62 * fit, high = Math.min(125 * fit, maxDistance);
    if (!f || !height) return { ...DEFAULT_VIEW, distance: clamp(DEFAULT_VIEW.distance * fit, low, high) };
    const perPixel = 2 * Math.tan(degToRad(camera.fov) / 2) / height;
    return { ...DEFAULT_VIEW, distance: clamp(Math.max(52 * fit / (perPixel * f.width), 38 * fit / (perPixel * f.height)), low, high) };
  }

  function animateTo(to: Partial<CityView>, duration = 650) {
    const from = currentView();
    let azimuth = to.azimuth ?? from.azimuth;
    while (azimuth - from.azimuth > Math.PI) azimuth -= Math.PI * 2;
    while (azimuth - from.azimuth < -Math.PI) azimuth += Math.PI * 2;
    const end = { ...limit({ ...from, ...to }), azimuth };
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

  // Direct manipulation takes priority over a flight.
  const onStart = () => { tween = null; host.dataset.dragging = "true"; };
  const onEnd = () => { delete host.dataset.dragging; options.onView(currentView()); };
  const onChange = () => {
    moved = true;
    if (tween) return;
    // Keep panning over the city: the target slides back to the edge, the camera with it.
    const t = controls.target, length = Math.hypot(t.x, t.z);
    if (length > panRadius) { shift.set(t.x, 0, t.z).multiplyScalar(panRadius / length - 1); t.add(shift); camera.position.add(shift); }
  };
  controls.addEventListener("start", onStart);
  controls.addEventListener("end", onEnd);
  controls.addEventListener("change", onChange);
  applyView(limit(options.view ?? DEFAULT_VIEW));

  return {
    controls, animateTo, currentView, defaultView,
    update(now) {
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      stepTween(now);
      controls.dampingFactor = 1 - Math.pow(1 - DAMPING, clamp(dt * 60, .5, 4));
      controls.update();
      const result = moved; moved = false;
      return result;
    },
    focus(x, z, distance = 52) {
      animateTo({ target: [x * .85, 0, z * .85], azimuth: Math.atan2(-x, -z), distance: Math.min(currentView().distance, distance) });
    },
    focusPoint(target, distance, polar) { animateTo({ target, distance, ...(polar === undefined ? {} : { polar }) }); },
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
      tween = null;
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      delete host.dataset.dragging;
    },
  };
}
