/**
 * City v3 entry point (TZ §3.2): builds the world, the renderer (WebGPU, WebGL2 fallback) and every module,
 * and returns the same control API as the old city, so CityMap switches engines with `?city=v3`.
 * Creation is synchronous for the caller; the renderer and models arrive asynchronously, and calls made
 * before that are remembered and applied once the city is up.
 */
import * as THREE from "three/webgpu";
import type { DistrictId } from "../api/city";
import type { CityContext } from "./engine/context";
import type { CityControl, CityLabelInfo, CityMascot, CityOptions, CityPlotInfo, CityQuestInfo, CitySiteInfo, TimeOfDay } from "./types";
import { createRenderer, pixelRatio, requestShadowRedraw, type RendererHandle } from "./engine/renderer";
import { createLoop, type Loop } from "./engine/loop";
import { createCamera, createCameraRig, type CameraRig, type ControlScheme } from "./engine/camera";
import { createPicker, type Picker } from "./engine/input";
import { createQuality, type QualityControl } from "./engine/quality";
import { createStats, type Stats } from "./engine/stats";
import { islandWorld } from "./world/cities";
import { WORLD_V1, WORLD_X4 } from "./world/worldSpec";
import { createCatalogue, loadCatalogueModels, type Catalogue } from "./assets/catalogue";
import { createInstancePools, type InstancePools } from "./render/instances";
import { createTerrain, type Terrain } from "./render/terrain";
import { createWater, type Water } from "./render/water";
import { createSky, type Sky } from "./render/sky";
import { createPost, type Post } from "./render/post";
import { createDistricts, type Districts } from "./systems/districts";
import { createMascot, type Mascot } from "./systems/mascot";
import { createLabels, type Labels } from "./systems/labels";
import { createTraffic, type Traffic } from "./systems/traffic";
import { createCrowd, type Crowd } from "./systems/crowd";
import { createNight, type Night } from "./render/night";
import { createLampLights, type LampLights } from "./render/lampLights";
import { createMountains, type Mountains } from "./render/mountains";
import { createPlots, type Plots } from "./systems/plots";
import { createSites, type Sites } from "./systems/sites";
import { createQuests, type Quests } from "./systems/quests";
import { createDepartmentWorld, type DepartmentWorld } from "./systems/departmentWorld";
import { railPoint } from "./world/railway";
import type { CityWorld, DepartmentId } from "../api/cityWorld";
import type { CityBuildView, CityEstateView, CityView, EstateTarget, JourneyPhase } from "./types";
import "./city3d.css";

/** Static shadows are redrawn only once the camera has rested this long: culling changes casters while it moves. */
const SHADOW_REST_MS = 250;
const SHADER_WARMUP_MS = 4000;
const LOD_FILES = ["city/v1/city-models.glb", "city/v1/vehicles.glb"].map(path => `${import.meta.env.BASE_URL}${path}`);

interface Parts {
  handle: RendererHandle; quality: QualityControl; stats: Stats; loop: Loop; rig: CameraRig; picker: Picker; post: Post;
  sky: Sky; terrain: Terrain; water: Water; districts: Districts; mascot: Mascot; labels: Labels; traffic: Traffic; crowd: Crowd;
  catalogue?: Catalogue; pools?: InstancePools; observer: ResizeObserver; night: Night; lamps: LampLights; mountains: Mountains; plots: Plots; sites: Sites; quests: Quests;
  resize: () => void;
  departments?: DepartmentWorld;
}

export function createCity(host: HTMLDivElement, options: CityOptions): CityControl {
  const mobile = host.clientWidth < 600;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The full map's mainland is the team districts' land, cut into plots (world/land.ts): of the town only its roads,
  // the station with its square and the group quarters stay (world/cities.ts).
  const world = islandWorld(options.world === "x4" ? WORLD_X4 : WORLD_V1);
  let disposed = false, parts: Parts | null = null, forceWebGL = !!options.forceWebGL, everReady = false;
  let department: DepartmentId = "support", desiredDepartment = options.department ?? "support", departmentConfig = options.departmentWorld;
  const estateViews: Partial<Record<DepartmentId, CityEstateView | null>> = { ...options.estates };
  let buildView: CityBuildView | null = options.build ?? null;
  let sceneReady = false, requestedEstateFocus: EstateTarget | null = null, lastEstateFocus: EstateTarget | null = null;
  const views: Partial<Record<DepartmentId, CityView>> = {};
  let journey: { to: DepartmentId; from: DepartmentId; elapsed: number; last?: number; swapped: boolean } | null = null;
  let phase: JourneyPhase = null;
  let worldMoved = true;
  host.dataset.department = department;
  const notifyJourney = (next: JourneyPhase) => { if (phase !== next) { phase = next; options.onJourney?.(next); } };
  let active = options.active ?? true, generation = 0;
  let startupController: AbortController | null = null, startingHandle: RendererHandle | null = null;
  let startupDisposers: (() => void)[] = [];
  const activityWaiters = new Set<() => void>();
  const wake = () => { activityWaiters.forEach(done => done()); activityWaiters.clear(); };
  const current = (run: number) => !disposed && run === generation;
  const activityChanged = () => new Promise<void>(done => activityWaiters.add(done));
  // Calls before the city is up; replayed in order afterwards.
  const pending: ((p: Parts) => void)[] = [];
  let selected = options.selected, labels = options.labels, mascot = options.mascot ?? { gender: null, name: "Пульсар" }, trafficOn = !reducedMotion;
  let timeOfDay: TimeOfDay = options.timeOfDay ?? "day", plotStates: CityPlotInfo[] = options.plots ?? [], siteStates: CitySiteInfo[] | null = options.sites ?? null, questStates: CityQuestInfo[] = options.quests ?? [];
  let controls: ControlScheme = options.controls ?? "orbit";
  const when = (fn: (p: Parts) => void) => { if (disposed) return; if (parts) fn(parts); else pending.push(fn); };
  const daylight = (p: Parts) => {
    const night = timeOfDay === "night";
    p.sky.setTimeOfDay(night ? 22 : 10.5); p.water.setNight(night); p.districts.setNight(night);
    p.night.set(night, reducedMotion);
    p.departments?.setNight(night);
    host.dataset.timeOfDay = timeOfDay;
  };
  function focusDistrict(id: DistrictId) {
    selected = id;
    when(p => { p.districts.select(id); p.labels.setSelected(id); const d = world.districts.find(item => item.id === id); if (d && department === "support") p.rig.focus(d.x, d.z); });
  }
  // The server supplies the districts this viewer may use (scenarios are TP only).
  const choose = (id: DistrictId) => { if (!labels.some(label => label.id === id)) return; focusDistrict(id); options.onSelect(id); };
  function switchDepartment(next: DepartmentId, saveView = true) {
    desiredDepartment = next;
    const p = parts; if (!p?.departments || next === department) return;
    if (saveView) views[department] = p.rig.currentView();
    p.departments.show(next); department = next; host.dataset.department = next; worldMoved = true;
    p.rig.animateTo(views[next] ?? { target: [0, 0, 0], distance: next === "sales" ? 160 : 90, azimuth: .7, polar: .82 }, 0);
    if (next === "support") p.pools?.update();
  }
  function finishJourney() {
    if (!journey || !parts) return;
    const to = journey.to; journey = null; switchDepartment(to, false);
    parts.rig.animateTo(views[to] ?? { target: [0, 0, 0], distance: to === "sales" ? 160 : 90, azimuth: .7, polar: .82 }, 0);
    parts.departments?.railway(0); notifyJourney(null); options.onArrival?.(to);
  }
  function focusEstate(target: EstateTarget) {
    lastEstateFocus = target;
    // Models and departmental land arrive after the camera. Keep only the latest requested destination.
    if (!sceneReady || !parts?.departments) { requestedEstateFocus = target; return; }
    requestedEstateFocus = null;
    const distance = target.kind === "object" || target.kind === "plot" ? 30 : 48, polar = .86;
    const view = parts.departments.focusEstate(target, distance, polar);
    if (view?.bounds) parts.rig.focusBounds(view.bounds, view.azimuth, .5, reducedMotion ? 0 : 700);
    else if (view) parts.rig.animateTo({ target: [view.point.x, view.point.y, view.point.z], distance, polar, azimuth: view.azimuth }, reducedMotion ? 0 : 700);
  }

  function startupFailed(run: number) {
    if (!current(run)) return;
    if (!forceWebGL) {
      forceWebGL = true; teardown(); launch();
    } else { teardown(); options.onLost(); }
  }
  function launch() {
    const promise = start(), run = generation;
    void promise.catch(() => startupFailed(run));
  }

  async function start() {
    const run = ++generation;
    const controller = new AbortController(); startupController = controller;
    sceneReady = false;
    // Check synchronously after every await: a release/dispose can happen in the
    // same microtask turn that resumes startup. Waiting itself is not a lease.
    while (!active && current(run)) await activityChanged();
    if (!current(run)) return;
    // A fresh canvas each start: a canvas that held a WebGPU context cannot take a WebGL2 one (fallback, restore).
    const canvas = document.createElement("canvas"); canvas.className = "c3-canvas";
    const overlay = document.createElement("div"); overlay.className = "c3-overlay";
    host.replaceChildren(canvas, overlay);
    const handle = await createRenderer(canvas, { forceWebGL, mobile, signal: controller.signal });
    if (!current(run)) { handle.dispose(); return; }
    startingHandle = handle;
    while (!active && current(run)) await activityChanged();
    if (!current(run)) { handle.dispose(); if (startingHandle === handle) startingHandle = null; return; }
    // A factory may fail before Parts exists. Remember completed modules so fallback also removes their hooks.
    const own = <T extends { dispose(): void }>(value: T): T => { startupDisposers.push(() => value.dispose()); return value; };
    const { renderer, backend } = handle;
    host.dataset.backend = backend === "webgpu" ? "WebGPU" : "WebGL2";
    const scene = new THREE.Scene(), camera = createCamera(world.radius);
    let loading = true, shadowWanted = false, lastMove = 0;
    const quality = own(createQuality({ backend, mobile, gpu: handle.gpu, busy: () => loading }));

    const frameCallbacks = new Set<(dt: number, now: number) => void>(), moveCallbacks = new Set<() => void>();
    let sun: THREE.DirectionalLight | null = null;
    const night = createNight(timeOfDay === "night");
    const ctx: CityContext = {
      renderer, backend, scene, camera, world, mobile, reducedMotion, overlay, night,
      get quality() { return quality.settings; },
      onFrame(cb) { frameCallbacks.add(cb); return () => frameCallbacks.delete(cb); },
      onCameraMove(cb) { moveCallbacks.add(cb); return () => moveCallbacks.delete(cb); },
      onQuality(cb) { return quality.onChange(cb); },
      requestShadowUpdate() { shadowWanted = true; },
    };

    const sky = own(createSky(ctx)); sun = sky.sun;
    const terrain = own(createTerrain(ctx)), water = own(createWater(ctx));
    const lamps = own(createLampLights(ctx)), mountains = own(createMountains(ctx));
    const districts = own(createDistricts(ctx, { levels: options.levels, grown: options.grown }));
    const mascotSystem = own(createMascot(ctx, mascot));
    const traffic = own(createTraffic(ctx));
    const crowd = own(createCrowd(ctx));
    const plots = own(createPlots(ctx, { states: plotStates, onPick: options.onPlot }));
    const sites = own(createSites(ctx, { states: siteStates, onPick: options.onSite }));
    const quests = own(createQuests(ctx, { states: questStates, onPick: options.onQuest }));
    const labelLayer = own(createLabels(ctx, { anchors: districts.anchors, mascotAnchor: mascotSystem.nameAnchor, onSelect: choose }));
    // The view may go out to the outer ring road (and the tunnel's portal in the hills); the shadow map follows it there.
    const portal = world.railway && railPoint(world.railway, world.railway.length), portalReach = portal ? Math.hypot(portal.x, portal.z) + 8 : 0;
    const rig = own(createCameraRig(camera, {
      dom: canvas, host, radius: world.radius, ring: world.spec.roadRings[0], reach: Math.max(world.radius + 20, portalReach),
      frame: options.frame, view: options.view, controls, reducedMotion, onView: view => { sky.followView(view.target[0], view.target[2], view.distance); options.onView(view); },
    }));
    const first = rig.currentView(); sky.followView(first.target[0], first.target[2], first.distance); sky.setViewDistance(first.distance);
    rig.setActive(active);
    // Legacy learning-district hit volumes overlap the team land. Build taps belong to the estate picker.
    const picker = own(createPicker(canvas, camera, () => department === "support" && !journey && !buildView ? districts.pickables.filter(hit => labels.some(label => label.id === hit.userData.district)) : [], { onPick: id => choose(id as DistrictId), onHover: id => districts.hover(id) }));
    const post = own(createPost(ctx));
    const stats = own(createStats({ renderer, backend, host, visible: !!options.stats, quality, userIdKnown: true, gpu: handle.gpu, extra: () => { const s = parts?.pools?.stats(); return s ? `copies ${s.drawn}/${s.copies} · pools ${s.drawCalls} calls` : "loading models"; } }));

    const resize = () => {
      if (!active) return;
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      renderer.setPixelRatio(pixelRatio(mobile, quality.settings.resolution)); renderer.setSize(width, height, false);
      rig.resize(width, height); post.setSize(width, height);
    };
    const observer = new ResizeObserver(resize); startupDisposers.push(() => observer.disconnect()); observer.observe(host); if (options.frame) observer.observe(options.frame);
    quality.onChange(resize);
    resize();

    let ready = false;
    const loop = own(createLoop({
      host, active, fps: () => quality.settings.fps,
      onGap: (gap, now) => quality.frame(gap, now),
      onError: () => startupFailed(run),
      render(dt, now) {
        stats.beginFrame();
        if (journey && parts?.departments) {
          // Keep the trip short on low-FPS PCs, but don't jump after a hidden-tab pause.
          journey.elapsed += journey.last === undefined ? dt : Math.min(.25, Math.max(0, (now - journey.last) / 1000));
          journey.last = now;
          if (journey.elapsed < 3.4) {
            const point = parts.departments.railway(journey.elapsed / 3.4);
            rig.animateTo({ target: [point.x, point.y, point.z], distance: 30, polar: 1.03, azimuth: parts.departments.railView().departure }, 0);
            notifyJourney(journey.elapsed > 2.9 ? "tunnel" : "departing");
          } else if (!journey.swapped) {
            journey.swapped = true; switchDepartment(journey.to, false); notifyJourney("arriving");
            const point = parts.departments.railway(0);
            rig.animateTo({ target: [point.x, point.y, point.z], distance: 55, polar: 1.0, azimuth: parts.departments.railView().arrival }, 0);
            rig.animateTo(views[journey.to] ?? { target: [0, 0, 0], distance: journey.to === "sales" ? 160 : 90, azimuth: .7, polar: .82 }, 1600);
          } else if (journey.elapsed > 5.2) finishJourney();
        }
        const moved = rig.update(now) || worldMoved || !!journey;
        worldMoved = false;
        if (moved) { lastMove = now; sky.setViewDistance(rig.currentView().distance); if (department === "support") moveCallbacks.forEach(cb => cb()); }
        night.step(dt);
        if (department === "support") frameCallbacks.forEach(cb => cb(dt, now));
        parts?.departments?.frame(dt, now, moved);
        if (shadowWanted && sun && now - lastMove > SHADOW_REST_MS) { shadowWanted = false; requestShadowRedraw(sun); }
        post.render();
        stats.endFrame();
        if (!ready && !loading) {
          ready = true; everReady = true; sceneReady = true; stats.markFirstFrame(); options.onProgress?.(1);
          const grown = districts.startGrowth(), d = grown ? world.districts.find(item => item.id === grown) : null;
          if (d && department === "support") rig.focus(d.x, d.z, 48);
          if (requestedEstateFocus) focusEstate(requestedEstateFocus);
          options.onReady();
        }
      },
    }));

    // WebGPU that fails while the city is starting (driver or browser bugs) is retried once on WebGL2.
    handle.onLost(() => {
      if (!current(run)) return;
      if (!everReady && !forceWebGL) { startupFailed(run); return; }
      options.onLost();
    });
    handle.onRestored(() => {
      if (!current(run)) return;
      teardown();
      const promise = start(), nextRun = generation;
      void promise.then(() => { if (current(nextRun)) options.onRestored?.(); }).catch(() => startupFailed(nextRun));
    });

    parts = { handle, quality, stats, loop, rig, picker, post, sky, terrain, water, districts, mascot: mascotSystem, labels: labelLayer, traffic, crowd, observer, night, lamps, mountains, plots, sites, quests, resize };
    startingHandle = null; startupDisposers = [];
    labelLayer.setLabels(labels); labelLayer.setSelected(selected); labelLayer.setMascotName(mascot.name);
    districts.select(selected); traffic.setEnabled(trafficOn); crowd.setEnabled(trafficOn); daylight(parts);
    pending.splice(0).forEach(fn => fn(parts!));
    options.onProgress?.(.3);

    // Models: the Kenney kits with their generated LOD copies, then the instance pools and catalogue cars.
    try {
      // The procedural catalogue, stations and campus also work when optional model downloads fail.
      const models = await loadCatalogueModels(LOD_FILES, { signal: controller.signal }).catch(() => new Map());
      while (!active && current(run)) await activityChanged();
      if (!current(run)) { disposeModels(models); return; }
      options.onProgress?.(.65);
      const catalogue = createCatalogue(models, night);
      parts.catalogue = catalogue;
      parts.pools = createInstancePools(ctx, catalogue, world.placements);
      parts.plots.setCatalogue(catalogue); parts.sites.setCatalogue(catalogue);
      traffic.setVehicles(models);
      parts.departments = createDepartmentWorld(ctx, catalogue, models, id => options.onWorldPick?.(id), pick => options.onEstate?.(pick));
      if (departmentConfig) parts.departments.setConfig(departmentConfig);
      for (const city of ["support", "sales"] as const) if (estateViews[city] !== undefined) parts.departments.setEstates(city, estateViews[city] ?? null);
      parts.departments.setBuild(buildView);
      parts.departments.setTraffic(trafficOn); parts.departments.setNight(timeOfDay === "night");
      department = "support"; switchDepartment(desiredDepartment); parts.departments.show(department);
      // Every pool, near and far, has its shaders built before the city shows, so coming closer never
      // stalls or pops (at most 4 s; the renderer builds whatever is left on first use).
      options.onProgress?.(.85);
      let compileTimer: ReturnType<typeof setTimeout> | undefined;
      let cancelCompile = () => {};
      try {
        await Promise.race([
          renderer.compileAsync(scene, camera).catch(() => undefined),
          new Promise<void>(done => { compileTimer = setTimeout(done, SHADER_WARMUP_MS); cancelCompile = done; controller.signal.addEventListener("abort", cancelCompile, { once: true }); }),
        ]);
      } finally { clearTimeout(compileTimer); controller.signal.removeEventListener("abort", cancelCompile); }
      while (!active && current(run)) await activityChanged();
      if (!current(run)) return;
    } catch (error) { if (current(run)) throw error; return; }
    options.onProgress?.(.95);
    loading = false; shadowWanted = true;
  }

  function teardown() {
    generation++; sceneReady = false; wake();
    startupController?.abort(); startupController = null;
    const unfinished = startupDisposers; startupDisposers = [];
    unfinished.reverse().forEach(dispose => dispose());
    startingHandle?.dispose(); startingHandle = null;
    if (!disposed) requestedEstateFocus = lastEstateFocus;
    const p = parts; parts = null; if (!p) return;
    p.loop.dispose(); p.observer.disconnect(); p.picker.dispose(); p.rig.dispose(); p.stats.dispose(); p.quality.dispose();
    p.departments?.dispose();
    p.labels.dispose(); p.plots.dispose(); p.sites.dispose(); p.quests.dispose(); p.crowd.dispose(); p.traffic.dispose(); p.mascot.dispose(); p.districts.dispose(); p.pools?.dispose(); p.catalogue?.dispose();
    p.lamps.dispose(); p.mountains.dispose(); p.water.dispose(); p.terrain.dispose(); p.sky.dispose(); p.post.dispose(); p.handle.dispose();
  }

  launch();

  return {
    setDepartment(id) { if (journey) { journey = null; notifyJourney(null); } switchDepartment(id); },
    setDepartmentWorld(config: CityWorld) { departmentConfig = config; parts?.departments?.setConfig(config); },
    setEstates(city, view) { estateViews[city] = view; parts?.departments?.setEstates(city, view); },
    setBuild(view) { if (buildView && !view) requestedEstateFocus = lastEstateFocus = null; buildView = view; parts?.departments?.setBuild(view); },
    focusEstate,
    focusWorld(id) { const point = parts?.departments?.point(id); if (point) parts?.rig.focusPoint([point.x, point.y, point.z], id === "station" ? 38 : 46, .9); },
    travelTo(id) {
      if (!parts?.departments || !everReady || journey || id === department) return;
      views[department] = parts.rig.currentView(); journey = { to: id, from: department, elapsed: 0, swapped: false };
      if (reducedMotion) finishJourney(); else notifyJourney("departing");
    },
    skipTravel: finishJourney,
    setActive(value) {
      if (disposed) return;
      active = value; host.dataset.active = String(value);
      if (!value && journey) { const from = journey.from; journey = null; switchDepartment(from, false); if (parts && views[from]) parts.rig.animateTo(views[from]!, 0); notifyJourney(null); }
      if (parts) {
        parts.rig.setActive(value);
        parts.stats.setActive(value);
        if (value) parts.resize();
        parts.loop.setActive(value);
      }
      if (value) wake();
    },
    setLevels(levels, grown) {
      options.levels = levels; options.grown = grown;
      when(p => {
        p.districts.setLevels(levels, grown);
        if (everReady) {
          const id = p.districts.startGrowth(), d = world.districts.find(item => item.id === id);
          if (d && department === "support") p.rig.focus(d.x, d.z, 48);
        }
      });
    },
    focusMascot: () => when(p => p.rig.focusPoint([p.mascot.focusPoint.x, p.mascot.focusPoint.y, p.mascot.focusPoint.z], 18, 1.05)),
    setTimeOfDay(mode) { if (timeOfDay === mode) return; timeOfDay = mode; when(daylight); },
    setMascot(next: CityMascot) { mascot = next; when(p => { p.mascot.setMascot(next); p.labels.setMascotName(next.name); }); },
    setTraffic(enabled: boolean) { trafficOn = enabled; when(p => { p.traffic.setEnabled(enabled); p.crowd.setEnabled(enabled); p.departments?.setTraffic(enabled); }); },
    select: focusDistrict,
    setLabels(next: CityLabelInfo[]) { labels = next; when(p => p.labels.setLabels(next)); },
    setPlots(next) { if (JSON.stringify(plotStates) === JSON.stringify(next)) return; plotStates = next; when(p => p.plots.set(next)); },
    focusPlot: key => when(p => { const plot = p.plots.find(key); if (plot) p.rig.focusPoint([plot.x, 1, plot.z], 30, .95); }),
    setSites(next) { if (JSON.stringify(siteStates) === JSON.stringify(next)) return; siteStates = next; when(p => p.sites.set(next)); },
    focusSite: key => when(p => { const site = p.sites.find(key); if (site) p.rig.focusPoint([site.x, 2, site.z], 55, .9); }),
    setQuests(next) { if (JSON.stringify(questStates) === JSON.stringify(next)) return; questStates = next; when(p => p.quests.set(next)); },
    focusQuest: slot => when(p => { const spot = p.quests.spot(slot); if (spot) p.rig.focusPoint([spot.x, 1, spot.z], 26, 1.0); }),
    zoom: factor => when(p => p.rig.zoom(factor)),
    rotate: radians => when(p => p.rig.rotate(radians)),
    tilt: radians => when(p => p.rig.tilt(radians)),
    reset: () => when(p => { if (department === "sales") p.rig.animateTo({ target: [0, 0, 0], distance: 160, azimuth: .7, polar: .82 }, 500); else p.rig.reset(); }),
    setControls(next) { controls = next; when(p => p.rig.setControls(next)); },
    dispose() { disposed = true; requestedEstateFocus = lastEstateFocus = null; pending.length = 0; teardown(); host.replaceChildren(); delete host.dataset.backend; delete host.dataset.timeOfDay; },
  };
}

/** A detached loading scene can be discarded before its catalogue takes ownership of these resources. */
function disposeModels(models: Awaited<ReturnType<typeof loadCatalogueModels>>) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  models.forEach(model => model.parts.forEach(part => { geometries.add(part.geometry); materials.add(part.material); }));
  materials.forEach(material => Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); }));
  geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
}
