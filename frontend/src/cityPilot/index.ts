import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CitySceneControl, CitySceneOptions } from "../pages/city/cityScene";
import { createCamera } from "./engine/camera";
import { disposeTree } from "./engine/resources";
import { CityStats } from "./engine/stats";
import { FramePacer } from "./engine/pacing";
import { createWater } from "./render/water";
import { createLife } from "./systems/life";
import { createMascot } from "./systems/mascot";

export type TimeOfDay = "day" | "night";
export type BenchmarkMode = "static" | "orbit";
export interface PilotReport {
  version: "v3-pilot-1"; backend: string; timeOfDay: TimeOfDay; dpr: number;
  width: number; height: number; firstFrameMs: number; stats: ReturnType<CityStats["snapshot"]>;
  geometries: number; textures: number; benchmark: { mode: BenchmarkMode; duration: number; status: "running" | "complete" | "interrupted"; progress: number } | null;
  userAgent: string; trafficEnabled: boolean; cameraView: ReturnType<ReturnType<typeof createCamera>["current"]>;
}
export interface PilotControl extends CitySceneControl {
  setTimeOfDay: (mode: TimeOfDay) => void;
  startBenchmark: (mode: BenchmarkMode, seconds: number) => void;
  getReport: () => PilotReport;
}
interface PilotOptions extends CitySceneOptions {
  forceWebGL?: boolean; timeOfDay?: TimeOfDay;
  onStats?: (report: PilotReport) => void;
}

/** One finished island, isolated from the production city until real-device acceptance. */
export function createCity(host: HTMLDivElement, options: PilotOptions): PilotControl {
  const started = performance.now(), mobile = matchMedia("(max-width: 700px)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let disposed = false, initialized = false, failed = false, traffic = !reduced, visible = true;
  let previous = 0, elapsed = 0, firstFrameMs = 0, lastReport = 0, timeOfDay: TimeOfDay = options.timeOfDay ?? "day";
  const pacer = new FramePacer(mobile ? 30 : 60);
  let model: THREE.Object3D | undefined;
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: !!options.forceWebGL, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.info.autoReset = false;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const rig = createCamera(host, renderer.domElement, options.frame), { camera, controls } = rig;
  const sun = new THREE.DirectionalLight("#ffe5b9", 3.1);
  sun.position.set(-20, 32, 18); sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .035;
  scene.add(sun);
  const fill = new THREE.HemisphereLight("#d7eeff", "#738471", 1.4); scene.add(fill);
  const water = createWater(), life = createLife(), mascot = createMascot();
  scene.add(water.mesh, life.group, mascot.group);
  if (options.mascot) mascot.set(options.mascot);
  const stats = new CityStats();
  let benchmarkStats: CityStats | null = null;
  let benchmark: PilotReport["benchmark"] = null;
  let frozenReport: PilotReport | null = null;
  let benchmarkElapsed = 0, benchmarkView = rig.current();
  const board = document.createElement("button");
  board.type = "button"; board.className = "city-v3-label";
  board.setAttribute("aria-pressed", String(options.selected === "crm"));
  const labelTitle = document.createElement("strong"), labelStatus = document.createElement("span");
  board.append(labelTitle, labelStatus); host.append(board);
  const guide = document.createElement("span"); guide.className = "city-v3-guide-label";
  guide.textContent = options.mascot?.name ?? "Пульсар"; host.append(guide);
  const anchor = new THREE.Vector3(0, 10.7, -2), projected = new THREE.Vector3();
  const guideAnchor = new THREE.Vector3(3.8, 2.7, 5.5);
  function labels(value: CitySceneOptions["labels"]) {
    const crm = value.find(item => item.id === "crm");
    labelTitle.textContent = crm?.name ?? "CRM-центр"; labelStatus.textContent = crm?.status ?? "Остров практики";
    board.setAttribute("aria-label", `${labelTitle.textContent}. ${labelStatus.textContent}`);
  }
  labels(options.labels);
  board.onclick = () => options.onSelect("crm");
  board.addEventListener("pointerdown", event => event.stopPropagation());
  function updateLabel(element: HTMLElement, point: THREE.Vector3) {
    projected.copy(point).project(camera);
    const shown = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
    element.hidden = !shown;
    if (shown) element.style.transform = `translate(${(projected.x * .5 + .5) * host.clientWidth}px,${(-projected.y * .5 + .5) * host.clientHeight}px) translate(-50%,-100%)`;
  }
  function daylight(mode: TimeOfDay) {
    if (mode !== timeOfDay) interruptBenchmark();
    timeOfDay = mode; const night = mode === "night";
    scene.background = new THREE.Color(night ? "#14273f" : "#c3e3e7");
    scene.fog = new THREE.Fog(night ? "#14273f" : "#c3e3e7", 280, 700);
    sun.color.set(night ? "#a4c8ff" : "#ffe5b9"); sun.intensity = night ? .8 : 3.1;
    fill.color.set(night ? "#839bcc" : "#d7eeff"); fill.groundColor.set(night ? "#3c4256" : "#738471"); fill.intensity = night ? .85 : 1.4;
    water.setNight(night); life.setNight(night);
    model?.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of [object.material].flat()) {
        if (material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() !== 0) {
          material.emissive.set("#ffcf78");
          material.emissiveIntensity = night ? (material.name === "city-night-glass" ? 1.4 : 2.3) : .02;
        }
      }
    });
    host.dataset.timeOfDay = mode;
  }
  daylight(timeOfDay);
  function capture(measurement = stats.snapshot()): PilotReport {
    return { version: "v3-pilot-1", backend: (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2", timeOfDay, dpr: renderer.getPixelRatio(), width: widthBefore || host.clientWidth, height: heightBefore || host.clientHeight, firstFrameMs, stats: measurement, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, benchmark: benchmark ? { ...benchmark } : null, userAgent: navigator.userAgent, trafficEnabled: traffic, cameraView: benchmark ? benchmarkView : rig.current() };
  }
  function report(): PilotReport {
    return frozenReport ?? capture();
  }
  function interruptBenchmark() {
    if (benchmark?.status === "running") { benchmark.status = "interrupted"; frozenReport = capture(benchmarkStats!.snapshot()); rig.apply(benchmarkView); options.onStats?.(report()); }
  }
  function suspend() { previous = 0; pacer.reset(); stats.suspend(); benchmarkStats?.suspend(); interruptBenchmark(); }
  const visibility = () => { if (document.hidden) suspend(); };
  document.addEventListener("visibilitychange", visibility);
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; if (!visible) suspend(); });
  intersection.observe(host);
  let widthBefore = 0, heightBefore = 0;
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height || disposed) return;
    if (width !== widthBefore || height !== heightBefore) interruptBenchmark();
    widthBefore = width; heightBefore = height;
    renderer.setSize(width, height, false); rig.resize();
  }
  const observer = new ResizeObserver(resize); observer.observe(host); if (options.frame) observer.observe(options.frame);
  resize(); rig.reset(); if (options.view) rig.apply(options.view);
  const onStart = () => { interruptBenchmark(); host.dataset.dragging = "true"; };
  const onEnd = () => { delete host.dataset.dragging; options.onView(rig.current()); };
  controls.addEventListener("start", onStart); controls.addEventListener("end", onEnd);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const pointerCancel = () => { down = null; };
  const pointerUp = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6 && model) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(model, true)[0];
      if (hit && Math.abs(hit.point.x) < 6.5 && hit.point.z > -7 && hit.point.z < 3 && hit.point.y > .5) options.onSelect("crm");
    }
    down = null;
  };
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("pointercancel", pointerCancel);
  function fail() {
    if (disposed || failed) return;
    failed = true; suspend(); options.onLost();
  }
  renderer.onDeviceLost = fail;
  function frame(now: number) {
    if (disposed || failed) return;
    if (document.hidden || !visible) { previous = 0; return; }
    // Do not spend phone battery rendering at the display's 120/144Hz refresh rate.
    if (!pacer.shouldRender(now)) return;
    const cpuStart = performance.now(), dt = previous ? Math.max(0, (now - previous) / 1000) : 0; previous = now;
    if (traffic) { elapsed += Math.min(dt, .15); life.update(elapsed); water.update(elapsed); mascot.update(Math.min(dt, .1)); }
    if (benchmark?.status === "running") {
      benchmarkElapsed += dt; benchmark.progress = Math.min(1, benchmarkElapsed / benchmark.duration);
      if (benchmark.mode === "orbit") rig.apply({ ...benchmarkView, azimuth: benchmarkView.azimuth + benchmark.progress * Math.PI * 2, distance: benchmarkView.distance * (1 - .3 * Math.sin(benchmark.progress * Math.PI) ** 2) });
    }
    controls.update(); updateLabel(board, anchor); updateLabel(guide, guideAnchor);
    try {
      renderer.info.reset(); renderer.render(scene, camera);
      const cpu = performance.now() - cpuStart, info = renderer.info.render;
      stats.record(now, cpu, info.drawCalls, info.triangles);
      if (benchmark?.status === "running") {
        benchmarkStats?.record(now, cpu, info.drawCalls, info.triangles);
        if (benchmark.progress >= 1) { benchmark.status = "complete"; frozenReport = capture(benchmarkStats!.snapshot()); rig.apply(benchmarkView); }
      }
      if (!firstFrameMs) { firstFrameMs = performance.now() - started; options.onReady(); }
      if (now - lastReport >= 1000) { lastReport = now; options.onStats?.(report()); }
    } catch (error) { console.error("City pilot render failed", error); fail(); }
  }
  // Init and asset loading run concurrently. Every late result is explicitly released.
  const init = renderer.init().then(() => { initialized = true; if (disposed) renderer.dispose(); });
  const load = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/city/v3-pilot/crm-island.glb?v=${import.meta.env.PULS_CITY_ASSET}`).then(gltf => {
    if (disposed) { gltf.scenes.forEach(disposeTree); return; }
    model = gltf.scene;
    model.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    scene.add(model); daylight(timeOfDay);
  });
  void Promise.all([init, load]).then(async () => {
    if (disposed || failed) return;
    life.update(0);
    await renderer.compileAsync(scene, camera);
    if (disposed || failed) return;
    host.dataset.backend = report().backend;
    await renderer.setAnimationLoop(frame);
  }).catch(error => { if (!disposed) { console.error("City pilot initialization failed", error); fail(); } });
  return {
    setTimeOfDay: daylight, getReport: report,
    startBenchmark(mode, seconds) {
      if (disposed || failed || !firstFrameMs) return;
      if (benchmark?.status === "running") rig.apply(benchmarkView);
      controls.enableDamping = false; controls.update(); controls.enableDamping = true;
      benchmarkView = rig.current(); benchmarkElapsed = 0;
      benchmarkStats = new CityStats(180000); frozenReport = null;
      benchmark = { mode, duration: Math.max(10, Math.min(1200, seconds)), status: "running", progress: 0 };
      options.onStats?.(report());
    },
    setTraffic(enabled) { if (enabled !== traffic) interruptBenchmark(); traffic = enabled; },
    setMascot(value) { guide.textContent = value.name; mascot.set(value); },
    setLabels: labels,
    select(id) { board.setAttribute("aria-pressed", String(id === "crm")); },
    focusMascot() { interruptBenchmark(); rig.apply({ distance: 28, azimuth: .3, polar: 1.05, target: [3.8, 1.3, 5.5] }); },
    zoom(factor) { interruptBenchmark(); rig.apply({ ...rig.current(), distance: rig.current().distance * factor }); },
    rotate(radians) { interruptBenchmark(); rig.apply({ ...rig.current(), azimuth: rig.current().azimuth + radians }); },
    tilt(radians) { interruptBenchmark(); rig.apply({ ...rig.current(), polar: rig.current().polar + radians }); },
    reset() { interruptBenchmark(); rig.reset(); },
    dispose() {
      if (disposed) return; disposed = true;
      if (initialized) void renderer.setAnimationLoop(null);
      observer.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", visibility);
      controls.dispose(); renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      scene.remove(life.group, mascot.group); life.dispose(); mascot.dispose();
      disposeTree(scene); sun.shadow.dispose(); scene.clear();
      if (initialized) renderer.dispose();
      renderer.domElement.remove(); board.remove(); guide.remove();
      delete host.dataset.dragging; delete host.dataset.backend; delete host.dataset.timeOfDay;
    },
  };
}
