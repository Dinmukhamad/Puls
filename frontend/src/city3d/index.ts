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
import { generateWorld } from "./world/generate";
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
import "./city3d.css";

/** Static shadows are redrawn only once the camera has rested this long: culling changes casters while it moves. */
const SHADOW_REST_MS = 250;
const LOD_FILES = ["city/v1/city-models.glb", "city/v1/vehicles.glb"].map(path => `${import.meta.env.BASE_URL}${path}`);

interface Parts {
  handle: RendererHandle; quality: QualityControl; stats: Stats; loop: Loop; rig: CameraRig; picker: Picker; post: Post;
  sky: Sky; terrain: Terrain; water: Water; districts: Districts; mascot: Mascot; labels: Labels; traffic: Traffic; crowd: Crowd;
  catalogue?: Catalogue; pools?: InstancePools; observer: ResizeObserver; night: Night; lamps: LampLights; mountains: Mountains; plots: Plots; sites: Sites; quests: Quests;
}

export function createCity(host: HTMLDivElement, options: CityOptions): CityControl {
  const mobile = host.clientWidth < 600;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const world = generateWorld(options.world === "x4" ? WORLD_X4 : WORLD_V1);
  let disposed = false, parts: Parts | null = null, forceWebGL = !!options.forceWebGL, everReady = false;
  // Calls before the city is up; replayed in order afterwards.
  const pending: ((p: Parts) => void)[] = [];
  let selected = options.selected, labels = options.labels, mascot = options.mascot ?? { gender: null, name: "Пульсар" }, trafficOn = !reducedMotion;
  let timeOfDay: TimeOfDay = options.timeOfDay ?? "day", plotStates: CityPlotInfo[] = options.plots ?? [], siteStates: CitySiteInfo[] | null = options.sites ?? null, questStates: CityQuestInfo[] = options.quests ?? [];
  let controls: ControlScheme = options.controls ?? "orbit";
  const when = (fn: (p: Parts) => void) => { if (parts) fn(parts); else pending.push(fn); };
  const daylight = (p: Parts) => {
    const night = timeOfDay === "night";
    p.sky.setTimeOfDay(night ? 22 : 10.5); p.water.setNight(night); p.districts.setNight(night);
    p.night.set(night, reducedMotion);
    host.dataset.timeOfDay = timeOfDay;
  };
  function focusDistrict(id: DistrictId) {
    selected = id;
    when(p => { p.districts.select(id); p.labels.setSelected(id); const d = world.districts.find(item => item.id === id); if (d) p.rig.focus(d.x, d.z); });
  }
  const choose = (id: DistrictId) => { focusDistrict(id); options.onSelect(id); };

  async function start() {
    // A fresh canvas each start: a canvas that held a WebGPU context cannot take a WebGL2 one (fallback, restore).
    const canvas = document.createElement("canvas"); canvas.className = "c3-canvas";
    const overlay = document.createElement("div"); overlay.className = "c3-overlay";
    host.replaceChildren(canvas, overlay);
    const handle = await createRenderer(canvas, { forceWebGL, mobile });
    if (disposed) { handle.dispose(); return; }
    const { renderer, backend } = handle;
    host.dataset.backend = backend === "webgpu" ? "WebGPU" : "WebGL2";
    const scene = new THREE.Scene(), camera = createCamera(world.radius);
    let loading = true, shadowWanted = false, lastMove = 0;
    const quality = createQuality({ backend, mobile, gpu: handle.gpu, busy: () => loading });

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

    const sky = createSky(ctx); sun = sky.sun;
    const terrain = createTerrain(ctx), water = createWater(ctx);
    const lamps = createLampLights(ctx), mountains = createMountains(ctx);
    const districts = createDistricts(ctx, { levels: options.levels, grown: options.grown });
    const mascotSystem = createMascot(ctx, mascot);
    const traffic = createTraffic(ctx);
    const crowd = createCrowd(ctx);
    const plots = createPlots(ctx, { states: plotStates, onPick: options.onPlot });
    const sites = createSites(ctx, { states: siteStates, onPick: options.onSite });
    const quests = createQuests(ctx, { states: questStates, onPick: options.onQuest });
    const labelLayer = createLabels(ctx, { anchors: districts.anchors, mascotAnchor: mascotSystem.nameAnchor, onSelect: choose });
    // The view may go out to the outer ring road; the shadow map follows it there.
    const rig = createCameraRig(camera, {
      dom: canvas, host, radius: world.radius, ring: world.spec.roadRings[0], reach: world.spec.roadRings[world.spec.roadRings.length - 1],
      frame: options.frame, view: options.view, controls, reducedMotion, onView: view => { sky.followView(view.target[0], view.target[2], view.distance); options.onView(view); },
    });
    const first = rig.currentView(); sky.followView(first.target[0], first.target[2], first.distance); sky.setViewDistance(first.distance);
    const picker = createPicker(canvas, camera, () => districts.pickables, { onPick: id => choose(id as DistrictId), onHover: id => districts.hover(id) });
    const post = createPost(ctx);
    const stats = createStats({ renderer, backend, host, visible: !!options.stats, quality, userIdKnown: true, gpu: handle.gpu, extra: () => { const s = parts?.pools?.stats(); return s ? `copies ${s.drawn}/${s.copies} · pools ${s.drawCalls} calls` : "loading models"; } });

    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      renderer.setPixelRatio(pixelRatio(mobile, quality.settings.resolution)); renderer.setSize(width, height, false);
      rig.resize(width, height); post.setSize(width, height);
    };
    const observer = new ResizeObserver(resize); observer.observe(host); if (options.frame) observer.observe(options.frame);
    quality.onChange(resize);
    resize();

    let ready = false;
    const loop = createLoop({
      host, fps: () => quality.settings.fps,
      onGap: (gap, now) => quality.frame(gap, now),
      render(dt, now) {
        stats.beginFrame();
        if (rig.update(now)) { lastMove = now; sky.setViewDistance(rig.currentView().distance); moveCallbacks.forEach(cb => cb()); }
        night.step(dt);
        frameCallbacks.forEach(cb => cb(dt, now));
        if (shadowWanted && sun && now - lastMove > SHADOW_REST_MS) { shadowWanted = false; requestShadowRedraw(sun); }
        post.render();
        stats.endFrame();
        if (!ready && !loading) {
          ready = true; everReady = true; stats.markFirstFrame(); options.onProgress?.(1); options.onReady();
          const grown = districts.startGrowth(), d = grown ? world.districts.find(item => item.id === grown) : null;
          if (d) rig.focus(d.x, d.z, 48);
        }
      },
    });

    // WebGPU that fails while the city is starting (driver or browser bugs) is retried once on WebGL2.
    handle.onLost(() => {
      if (!everReady && !forceWebGL && !disposed) { forceWebGL = true; teardown(); void start().catch(() => options.onLost()); return; }
      options.onLost();
    });
    handle.onRestored(() => { if (!disposed) { teardown(); void start().then(() => options.onRestored?.()); } });

    parts = { handle, quality, stats, loop, rig, picker, post, sky, terrain, water, districts, mascot: mascotSystem, labels: labelLayer, traffic, crowd, observer, night, lamps, mountains, plots, sites, quests };
    labelLayer.setLabels(labels); labelLayer.setSelected(selected); labelLayer.setMascotName(mascot.name);
    districts.select(selected); traffic.setEnabled(trafficOn); crowd.setEnabled(trafficOn); daylight(parts);
    pending.splice(0).forEach(fn => fn(parts!));
    options.onProgress?.(.3);

    // Models: the Kenney kits with their generated LOD copies, then the instance pools and catalogue cars.
    try {
      const models = await loadCatalogueModels(LOD_FILES);
      if (disposed || !parts) return;
      const catalogue = createCatalogue(models, night);
      parts.catalogue = catalogue;
      parts.pools = createInstancePools(ctx, catalogue, world.placements);
      parts.plots.setCatalogue(catalogue); parts.sites.setCatalogue(catalogue);
      traffic.setVehicles(models);
      // Every pool, near and far, has its shaders built before the city shows, so coming closer never
      // stalls or pops (at most 8 s; the renderer builds whatever is left on first use).
      await Promise.race([renderer.compileAsync(scene, camera).catch(() => undefined), new Promise(done => setTimeout(done, 8000))]);
      if (disposed || !parts) return;
    } catch { /* The city still shows terrain, landmarks and taxis. */ }
    loading = false; shadowWanted = true;
  }

  function teardown() {
    const p = parts; parts = null; if (!p) return;
    p.loop.dispose(); p.observer.disconnect(); p.picker.dispose(); p.rig.dispose(); p.stats.dispose(); p.quality.dispose();
    p.labels.dispose(); p.plots.dispose(); p.sites.dispose(); p.quests.dispose(); p.crowd.dispose(); p.traffic.dispose(); p.mascot.dispose(); p.districts.dispose(); p.pools?.dispose(); p.catalogue?.dispose();
    p.lamps.dispose(); p.mountains.dispose(); p.water.dispose(); p.terrain.dispose(); p.sky.dispose(); p.post.dispose(); p.handle.dispose();
  }

  void start().catch(() => { if (!disposed) options.onLost(); });

  return {
    focusMascot: () => when(p => p.rig.focusPoint([p.mascot.focusPoint.x, p.mascot.focusPoint.y, p.mascot.focusPoint.z], 18, 1.05)),
    setTimeOfDay(mode) { timeOfDay = mode; when(daylight); },
    setMascot(next: CityMascot) { mascot = next; when(p => { p.mascot.setMascot(next); p.labels.setMascotName(next.name); }); },
    setTraffic(enabled: boolean) { trafficOn = enabled; when(p => { p.traffic.setEnabled(enabled); p.crowd.setEnabled(enabled); }); },
    select: focusDistrict,
    setLabels(next: CityLabelInfo[]) { labels = next; when(p => p.labels.setLabels(next)); },
    setPlots(next) { plotStates = next; when(p => p.plots.set(next)); },
    focusPlot: key => when(p => { const plot = p.plots.find(key); if (plot) p.rig.focusPoint([plot.x, 1, plot.z], 30, .95); }),
    setSites(next) { siteStates = next; when(p => p.sites.set(next)); },
    focusSite: key => when(p => { const site = p.sites.find(key); if (site) p.rig.focusPoint([site.x, 2, site.z], 55, .9); }),
    setQuests(next) { questStates = next; when(p => p.quests.set(next)); },
    focusQuest: slot => when(p => { const spot = p.quests.spot(slot); if (spot) p.rig.focusPoint([spot.x, 1, spot.z], 26, 1.0); }),
    zoom: factor => when(p => p.rig.zoom(factor)),
    rotate: radians => when(p => p.rig.rotate(radians)),
    tilt: radians => when(p => p.rig.tilt(radians)),
    reset: () => when(p => p.rig.reset()),
    setControls(next) { controls = next; when(p => p.rig.setControls(next)); },
    dispose() { disposed = true; pending.length = 0; teardown(); host.replaceChildren(); delete host.dataset.backend; delete host.dataset.timeOfDay; },
  };
}
