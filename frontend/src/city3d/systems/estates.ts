/**
 * Team district land in one city (docs/CITY_ESTATES.md): the ground of every prepared module, the buildings
 * and shared projects the server reports, and the build mode. Buildings go through instance pools of their
 * own, so a purchase rebuilds only these copies, not the city. The grid shows only while building: over the
 * operator's estate, the business lots or, for staff, the public square. The preview follows the pointer
 * (a tap pins it on a phone) and says why a place does not fit; the server checks everything again.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { TAP_DISTANCE, TAP_TIME } from "../engine/input";
import {
  CELL, HOUSE_ROWS, LOT_CELLS, MODULE_CELLS, cellPoint, estateBorder, footprint, moduleGround, objectLayout, onDistrictLand, placementProblem, pointCell, siteLayout,
  type DistrictLand, type EstateFamily, type ModuleSlot,
} from "../world/estates";
import type { Placement, Surface } from "../world/types";
import type { CityBuildView, CityEstateView, EstatePick } from "../types";

/** Signs over projects and the operator's own house show only this close. */
const SIGN_REACH = 230;
const OK = new THREE.Color("#35b07a"), BAD = new THREE.Color("#e0525d");
/** How tall a skyscraper stands at each stage (world/estates.ts tower, OFFICE_FLOORS), roof included. */
const TOWER_HEIGHTS = [11, 17, 24, 33];

export interface EstateFocus { district: string; kind: "estate" | "lot" | "public" | "object"; object?: number }
export interface Estates {
  set(view: CityEstateView | null): void;
  setCatalogue(catalogue: Catalogue): void;
  setBuild(view: CityBuildView | null): void;
  setActive(active: boolean): void;
  /**
   * A point to look at (the operator's estate or tower lot, a district's public square, a building) and the
   * azimuth to look from, for a camera `distance` away at `polar` from straight down.
   */
  focus(target: EstateFocus, distance: number, polar: number): { point: THREE.Vector3; azimuth: number } | null;
  dispose(): void;
}

const numberOf = (district: string) => Number(district.split("-").at(-1));
const cellKey = (module: number, u: number, v: number) => `${module}:${u}:${v}`;

export function createEstates(ctx: CityContext, land: DistrictLand, onPick: (pick: EstatePick) => void): Estates {
  let view: CityEstateView | null = null, build: CityBuildView | null = null, catalogue: Catalogue | null = null, active = true;
  let groundPools: InstancePools | null = null, groundPatches: THREE.Mesh | null = null;
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null, builtKey = "";
  const seen = new Map<number, number>();
  const modulesOf = (district: string): ModuleSlot[] => land.modules[numberOf(district) - 1] ?? [];
  const moduleOf = (district: string, slot: number | null) => slot === null ? undefined : modulesOf(district).find(m => m.slot === slot);

  // Prepared land is laid out once: lawns, squares, paths and trees round every module.
  function rebuildGround() {
    groundPools?.dispose(); groundPools = null;
    if (groundPatches) { ctx.scene.remove(groundPatches); groundPatches.geometry.dispose(); (groundPatches.material as THREE.Material).dispose(); groundPatches = null; }
    const layouts = land.modules.flat().map(moduleGround);
    if (!layouts.length) return;
    groundPatches = createPatches(layouts.flatMap(l => l.surfaces)); ctx.scene.add(groundPatches);
    if (catalogue) groundPools = createInstancePools(ctx, catalogue, layouts.flatMap(l => l.placements));
  }

  function rebuild() {
    const key = view ? JSON.stringify(view.state.districts.map(d => [d.id, d.objects.map(o => [o.id, o.level, o.module, o.u, o.v, o.rotation]), d.projects.map(p => [p.id, p.module, p.u, p.v, p.rotation])])) : "";
    if (key === builtKey && (pools || !catalogue)) { refreshSigns(); return; }
    builtKey = key;
    pools?.dispose(); pools = null;
    if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); patches = null; }
    const placements: Placement[] = [], surfaces: Surface[] = [];
    for (const district of view?.state.districts ?? []) {
      // Estates and tower lots in use get their paths; free land stays a lawn.
      const held = new Set<string>();
      for (const obj of district.objects) {
        const module = moduleOf(district.id, obj.module);
        if (!module || module.kind === "public" || obj.u === null || obj.v === null) continue;
        const key = `${module.slot}:${Math.floor(obj.u / LOT_CELLS)}:${Math.floor(obj.v / LOT_CELLS)}`;
        if (held.has(key)) continue;
        held.add(key); surfaces.push(...estateBorder(module, Math.floor(obj.u / LOT_CELLS) * LOT_CELLS, Math.floor(obj.v / LOT_CELLS) * LOT_CELLS));
      }
      for (const obj of district.objects) {
        const module = moduleOf(district.id, obj.module);
        if (!module || obj.u === null || obj.v === null) continue;
        const layout = objectLayout(module, { family: obj.family, level: obj.level, u: obj.u, v: obj.v, rotation: obj.rotation });
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
        // A new building or a new stage rises behind a short veil; the first look at the city shows it as it is.
        const before = seen.get(obj.id);
        if (seen.size && before !== obj.level) veil(module, obj.family, obj.u, obj.v, obj.rotation);
      }
      for (const project of district.projects) {
        const module = moduleOf(district.id, project.module);
        if (!module || project.u === null || project.v === null) continue;
        const layout = siteLayout(module, { family: project.family, u: project.u, v: project.v, rotation: project.rotation });
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
      }
    }
    seen.clear();
    for (const district of view?.state.districts ?? []) for (const obj of district.objects) seen.set(obj.id, obj.level);
    if (surfaces.length) { patches = createPatches(surfaces); ctx.scene.add(patches); }
    if (catalogue && placements.length) pools = createInstancePools(ctx, catalogue, placements);
    ctx.requestShadowUpdate();
    refreshSigns();
    refreshBuild();
  }

  // ---- build mode: grid, preview, selection ----
  const lineMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffffff", transparent: true, opacity: .8, depthWrite: false });
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial); grid.visible = false; grid.renderOrder = 3;
  const ghostMaterial = new THREE.MeshBasicNodeMaterial({ color: OK, transparent: true, opacity: .42, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), ghostMaterial); ghost.visible = false; ghost.renderOrder = 4;
  const edgeMaterial = new THREE.LineBasicNodeMaterial({ color: OK, transparent: true, opacity: .95, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), edgeMaterial); ghost.add(edges);
  const selectMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffd24a", transparent: true, depthWrite: false });
  const selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), selectMaterial); selection.visible = false;
  ctx.scene.add(grid, ghost, selection);
  let pinned: { module: number; u: number; v: number } | null = null, reported = "";

  /** Cells taken in a district, without the building being moved. */
  function occupied(district: string, except: number | null) {
    const taken = new Set<string>(), state = view?.state.districts.find(d => d.id === district);
    for (const obj of state?.objects ?? []) if (obj.id !== except && obj.module !== null && obj.u !== null && obj.v !== null)
      for (let i = 0; i < obj.w; i++) for (let j = 0; j < obj.h; j++) taken.add(cellKey(obj.module, obj.u + i, obj.v + j));
    for (const p of state?.projects ?? []) if (p.module !== null && p.u !== null && p.v !== null)
      for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) taken.add(cellKey(p.module, p.u + i, p.v + j));
    return taken;
  }
  /** The area the grid covers: the estate (house rows and garden), the business quarter's lots, or the public square. */
  function area(): { module: ModuleSlot; u0: number; v0: number; size: number; step: number }[] {
    if (!build) return [];
    const own = view?.own, modules = modulesOf(build.district);
    if (build.area === "public") { const m = modules.find(x => x.kind === "public"); return m ? [{ module: m, u0: 0, v0: 0, size: MODULE_CELLS, step: 1 }] : []; }
    if (build.area === "lot") return modules.filter(m => m.kind === "business").map(m => ({ module: m, u0: 0, v0: 0, size: MODULE_CELLS, step: LOT_CELLS }));
    const estate = own?.estate && own.estate.district_id === build.district ? own.estate : null, m = estate ? modules.find(x => x.slot === estate.module) : undefined;
    return m && estate ? [{ module: m, u0: estate.u, v0: estate.v, size: LOT_CELLS, step: 1 }] : [];
  }
  function refreshGrid() {
    const points: number[] = [], y = .29;
    for (const { module, u0, v0, size, step } of area()) {
      for (let k = 0; k <= size; k += step) {
        for (const [a, b] of [[cellPoint(module, u0 + k, v0), cellPoint(module, u0 + k, v0 + size)], [cellPoint(module, u0, v0 + k), cellPoint(module, u0 + size, v0 + k)]]) points.push(a.x, y, a.z, b.x, y, b.z);
      }
      if (build?.area === "estate") { const a = cellPoint(module, u0, v0 + HOUSE_ROWS), b = cellPoint(module, u0 + size, v0 + HOUSE_ROWS); points.push(a.x, y + .01, a.z, b.x, y + .01, b.z); }
    }
    grid.geometry.dispose(); grid.geometry = new THREE.BufferGeometry(); grid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    grid.visible = points.length > 0;
  }
  /** The footprint's first cell for a pointer over `cell`: the house has its rows, a tower its lot, the rest centre on the cell. */
  function snap(family: EstateFamily, rotation: number, module: number, u: number, v: number) {
    const estate = view?.own?.estate;
    if (family === "house" && estate && build?.area === "estate") return { module: estate.module, u: estate.u, v: estate.v };
    if (family === "tower") return { module, u: Math.floor(u / LOT_CELLS) * LOT_CELLS, v: Math.floor(v / LOT_CELLS) * LOT_CELLS };
    const [w, h] = footprint(family, rotation);
    return { module, u: u - Math.floor((w - 1) / 2), v: v - Math.floor((h - 1) / 2) };
  }
  function showGhost(target: { module: number; u: number; v: number } | null) {
    if (!build?.placing || !target) { ghost.visible = false; return; }
    const { family, rotation, moving } = build.placing, module = moduleOf(build.district, target.module);
    if (!module) { ghost.visible = false; return; }
    const at = snap(family, rotation, target.module, target.u, target.v), [w, h] = footprint(family, rotation);
    const own = view?.own, estate = own?.estate && own.estate.district_id === build.district ? own.estate : null;
    const taken = occupied(build.district, moving);
    const problem = placementProblem({ family, rotation, ...at }, modulesOf(build.district), { district: numberOf(build.district), estate, tower: null }, (m, u, v) => taken.has(cellKey(m, u, v)), build.area === "public");
    const centre = cellPoint(module, at.u + w / 2, at.v + h / 2);
    ghost.position.set(centre.x, .21, centre.z); ghost.rotation.set(0, module.rotation, 0); ghost.scale.set(w * CELL - .1, family === "tower" ? 2.4 : 1.1, h * CELL - .1);
    ghostMaterial.color.copy(problem ? BAD : OK); edgeMaterial.color.copy(problem ? BAD : OK); ghost.visible = true;
    const key = `${build.district}:${at.module}:${at.u}:${at.v}:${rotation}:${problem}`;
    if (key !== reported) { reported = key; onPick({ kind: "place", district: build.district, module: at.module, u: at.u, v: at.v, rotation, problem }); }
  }
  function showSelection() {
    const id = build?.selected, district = view?.state.districts.find(d => d.objects.some(o => o.id === id));
    const obj = district?.objects.find(o => o.id === id), module = district && obj ? moduleOf(district.id, obj.module) : undefined;
    if (!obj || !module || obj.u === null || obj.v === null) { selection.visible = false; return; }
    const centre = cellPoint(module, obj.u + obj.w / 2, obj.v + obj.h / 2);
    selection.position.set(centre.x, .22, centre.z); selection.rotation.set(0, module.rotation, 0); selection.scale.set(obj.w * CELL, 1.4, obj.h * CELL); selection.visible = true;
  }
  function refreshBuild() {
    refreshGrid(); showSelection();
    if (build?.placing && !pinned && build.placing.family === "house") { const e = view?.own?.estate; if (e) pinned = { module: e.module, u: e.u, v: e.v }; }
    reported = ""; showGhost(pinned);
  }

  // ---- signs: the operator's house and every project still collecting ----
  const layer = document.createElement("div"); layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Районы команд");
  ctx.overlay.append(layer);
  const signs = new Map<string, { el: HTMLButtonElement; point: THREE.Vector3; transform: string }>();
  function sign(id: string, icon: string, title: string, sub: string, point: THREE.Vector3, pick: EstatePick) {
    let item = signs.get(id);
    if (!item) {
      const el = document.createElement("button"); el.type = "button"; el.className = "c3-site c3-estate-sign";
      el.innerHTML = `<span aria-hidden="true"></span><span><strong></strong><small></small></span>`;
      layer.append(el); item = { el, point: point.clone(), transform: "" }; signs.set(id, item);
    }
    item.point.copy(point);
    item.el.querySelector("span")!.textContent = icon; item.el.querySelector("strong")!.textContent = title; item.el.querySelector("small")!.textContent = sub;
    item.el.setAttribute("aria-label", `${title}. ${sub}`);
    item.el.onclick = () => onPick(pick);
  }
  function refreshSigns() {
    const live = new Set<string>();
    for (const district of view?.state.districts ?? []) {
      for (const obj of district.objects) if (obj.owner === "mine" && obj.family === "house" && obj.module !== null && obj.u !== null && obj.v !== null) {
        const m = moduleOf(district.id, obj.module); if (!m) continue;
        const p = cellPoint(m, obj.u + obj.w / 2, obj.v + obj.h / 2); live.add("house");
        sign("house", "🏡", "Твой дом", "Мой участок", new THREE.Vector3(p.x, 4.2, p.z), { kind: "object", district: district.id, object: obj.id });
      }
      for (const project of district.projects) {
        const m = moduleOf(district.id, project.module ?? district.objects.find(o => o.id === project.target_id)?.module ?? null);
        const target = project.target_id ? district.objects.find(o => o.id === project.target_id) : project;
        if (!m || !target || target.u === null || target.v === null) continue;
        const p = cellPoint(m, target.u + target.w / 2, target.v + target.h / 2), id = `project-${project.id}`; live.add(id);
        sign(id, "🏗️", project.name, project.progress === null ? "Сбор идёт" : `Собрано ${project.progress}%`, new THREE.Vector3(p.x, 3, p.z), { kind: "project", district: district.id, project: project.id });
      }
    }
    for (const [id, item] of signs) if (!live.has(id)) { item.el.remove(); signs.delete(id); }
    place();
  }
  const scratch = new THREE.Vector3();
  function place() {
    const width = ctx.overlay.clientWidth, height = ctx.overlay.clientHeight;
    if (!width || !height || !active) return;
    ctx.camera.updateMatrixWorld();
    const focal = ctx.camera.projectionMatrix.elements[5] * height / 2;
    for (const item of signs.values()) {
      scratch.copy(item.point).applyMatrix4(ctx.camera.matrixWorldInverse);
      const depth = -scratch.z; scratch.applyMatrix4(ctx.camera.projectionMatrix);
      const hidden = depth < ctx.camera.near || ctx.camera.position.distanceTo(item.point) > SIGN_REACH || Math.abs(scratch.x) > 1.1 || Math.abs(scratch.y) > 1.1;
      item.el.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const scale = THREE.MathUtils.clamp(focal / depth * .07, .55, 1);
      const next = `translate3d(${((scratch.x + 1) * width / 2).toFixed(1)}px,${((1 - scratch.y) * height / 2).toFixed(1)}px,0) translate(-50%,-100%) scale(${scale.toFixed(3)})`;
      if (next !== item.transform) { item.transform = next; item.el.style.transform = next; }
    }
  }

  // ---- the veil over a building going up ----
  const veils: { mesh: THREE.Mesh; age: number; height: number }[] = [];
  const veilMaterial = new THREE.MeshBasicNodeMaterial({ color: "#f4efe3", transparent: true, opacity: .55, depthWrite: false });
  function veil(module: ModuleSlot, family: EstateFamily, u: number, v: number, rotation: number) {
    if (ctx.reducedMotion || veils.length > 3) return;
    const [w, h] = footprint(family, rotation), centre = cellPoint(module, u + w / 2, v + h / 2);
    const mesh = new THREE.Mesh(ghost.geometry, veilMaterial.clone());
    mesh.position.set(centre.x, .21, centre.z); mesh.rotation.y = module.rotation; mesh.scale.set(w * CELL, .01, h * CELL);
    ctx.scene.add(mesh); veils.push({ mesh, age: 0, height: family === "tower" ? 8 : Math.min(3.5, Math.max(1.4, w * CELL * .6)) });
  }
  const offFrame = ctx.onFrame(dt => {
    if (!active) return;
    place();
    for (let i = veils.length - 1; i >= 0; i--) {
      const item = veils[i]; item.age += Math.min(dt, .1);
      // Up in the first part, then it thins out over the finished building.
      const t = item.age / 1.4;
      item.mesh.scale.y = Math.max(.01, item.height * Math.min(1, t * 1.6)); (item.mesh.material as THREE.MeshBasicNodeMaterial).opacity = .55 * Math.max(0, 1 - Math.max(0, t - .45) / .55);
      if (t >= 1) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); veils.splice(i, 1); }
    }
  });
  const offMove = ctx.onCameraMove(place);

  // ---- pointer: a tap picks a building or pins the preview; the mouse moves the preview ----
  const canvas = ctx.renderer.domElement, raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.2), hit = new THREE.Vector3();
  function cellAt(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, ctx.camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const districts = build ? [build.district] : (view?.state.districts.map(d => d.id) ?? []);
    for (const district of districts) for (const module of modulesOf(district)) {
      const c = pointCell(module, hit);
      if (c.u >= 0 && c.v >= 0 && c.u < MODULE_CELLS && c.v < MODULE_CELLS) return { district, module: module.slot, u: Math.floor(c.u), v: Math.floor(c.v) };
    }
    return null;
  }
  function objectAt(district: string, module: number, u: number, v: number) {
    const state = view?.state.districts.find(d => d.id === district);
    return state?.objects.find(o => o.module === module && o.u !== null && o.v !== null && u >= o.u && u < o.u + o.w && v >= o.v && v < o.v + o.h) ?? null;
  }
  let down: { x: number; y: number; time: number } | null = null, pressed = 0, frame = 0, hover: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => { if (event.isPrimary) { pressed = 1; down = { x: event.clientX, y: event.clientY, time: performance.now() }; } else { pressed++; down = null; } };
  const onUp = (event: PointerEvent) => {
    pressed = Math.max(0, pressed - 1);
    const tap = down && pressed === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && performance.now() - down.time < TAP_TIME;
    if (pressed === 0) down = null;
    if (!tap || !active) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    if (build?.placing) { pinned = cell; reported = ""; showGhost(cell); return; }
    const obj = objectAt(cell.district, cell.module, cell.u, cell.v);
    onPick(obj ? { kind: "object", district: cell.district, object: obj.id } : { kind: "land", district: cell.district, module: cell.module, u: cell.u, v: cell.v });
  };
  const onMove = (event: PointerEvent) => {
    if (!build?.placing || event.pointerType !== "mouse" || event.buttons || !active) return;
    hover = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!hover || !build?.placing || build.placing.family === "house") return;
      const cell = cellAt(hover.x, hover.y);
      if (cell && cell.district === build.district) { pinned = cell; showGhost(cell); }
    });
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointermove", onMove);

  /**
   * Which way to look at `point` from, for a camera `reach` away over the ground and `rise` above it. District
   * land is cleared of the city's houses, so the line of sight should run over it, and miss the skyscrapers and
   * headquarters standing there. The usual angle first, then turning by 15° either way.
   */
  function sightline(point: { x: number; z: number }, reach: number, rise: number, preferred: number) {
    const tall: { x: number; z: number; r: number; h: number }[] = land.headquarters.map((h, i) => {
      const stage = view?.state.districts.find(d => numberOf(d.id) === i + 1)?.hq.level ?? 1;
      return { x: h.x, z: h.z, r: 7, h: stage === 5 ? 14 : 7 };
    });
    for (const district of view?.state.districts ?? []) for (const obj of district.objects) {
      const m = moduleOf(district.id, obj.module);
      if (obj.family !== "tower" || !m || obj.u === null || obj.v === null) continue;
      const c = cellPoint(m, obj.u + obj.w / 2, obj.v + obj.h / 2);
      if (Math.hypot(c.x - point.x, c.z - point.z) > 1) tall.push({ x: c.x, z: c.z, r: 4.5, h: TOWER_HEIGHTS[obj.level - 1] ?? 33 });
    }
    let best = preferred, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const turn = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12, azimuth = preferred + turn, dx = Math.sin(azimuth), dz = Math.cos(azimuth);
      let score = -Math.abs(turn) * .5;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, x = point.x + dx * reach * t, z = point.z + dz * reach * t, height = 1 + rise * t;
        if (onDistrictLand(land, { x, z }, 2.5, 2.5)) score += 1;
        if (tall.some(o => o.h > height && Math.hypot(x - o.x, z - o.z) < o.r)) score -= 8;
      }
      if (score > bestScore) { bestScore = score; best = azimuth; }
    }
    return best;
  }

  rebuildGround();
  return {
    set(next) { view = next; rebuild(); },
    setCatalogue(value) { catalogue = value; rebuildGround(); builtKey = ""; rebuild(); },
    setBuild(next) {
      const same = build && next && build.district === next.district && build.area === next.area && build.placing?.family === next.placing?.family && build.placing?.moving === next.placing?.moving;
      build = next; if (!same) pinned = null;
      refreshBuild();
    },
    setActive(value) {
      active = value; layer.hidden = !value;
      if (!value) for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
    },
    focus(target, distance, polar) {
      const modules = modulesOf(target.district), own = view?.own;
      let point: { x: number; z: number } | null = null;
      if (target.kind === "estate" && own?.estate?.district_id === target.district) { const m = modules.find(x => x.slot === own.estate!.module); if (m) point = cellPoint(m, own.estate.u + 2, own.estate.v + 2); }
      else if (target.kind === "lot") { const m = modules.find(x => x.kind === "business"); if (m) point = cellPoint(m, 6, 6); }
      else if (target.kind === "public") { const m = modules.find(x => x.kind === "public"); if (m) point = cellPoint(m, 6, 6); }
      else if (target.kind === "object") {
        const obj = view?.state.districts.find(d => d.id === target.district)?.objects.find(o => o.id === target.object), m = obj && moduleOf(target.district, obj.module);
        if (obj && m && obj.u !== null && obj.v !== null) point = cellPoint(m, obj.u + obj.w / 2, obj.v + obj.h / 2);
      }
      if (!point && modules[0]) point = { x: modules[0].x, z: modules[0].z };
      if (!point) return null;
      // Along the ring from slightly outside, unless the district's own land offers a clearer line of sight.
      const preferred = Math.atan2(point.x, point.z) + 1.15;
      return { point: new THREE.Vector3(point.x, 1, point.z), azimuth: sightline(point, distance * Math.sin(polar), distance * Math.cos(polar), preferred) };
    },
    dispose() {
      offFrame(); offMove(); if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointermove", onMove);
      layer.remove(); groundPools?.dispose(); pools?.dispose();
      for (const mesh of [groundPatches, patches]) if (mesh) { ctx.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
      ctx.scene.remove(grid, ghost, selection);
      grid.geometry.dispose(); ghost.geometry.dispose(); edges.geometry.dispose(); selection.geometry.dispose();
      [lineMaterial, ghostMaterial, edgeMaterial, selectMaterial, veilMaterial].forEach(m => m.dispose());
    },
  };
}
