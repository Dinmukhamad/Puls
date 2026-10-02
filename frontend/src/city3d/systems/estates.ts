/**
 * Team district land in one city (docs/CITY_ESTATES.md): the plots of its three districts, laid out like a Monopoly
 * board (world/land.ts), every district's centre with its public square, and what the server reports standing on
 * them. Free plots are meadow with a thin path round each; a district's own colour tints its land a little. In
 * build mode the operator's district lights up: the plots for sale in its open bands bright, the bands still
 * closed dim; a tap picks a plot (or a building), and a building from the inventory follows the pointer with its
 * reason when it does not fit. Staff place a shared project on the cells of the public square. Buildings go
 * through instance pools of their own, so a purchase rebuilds only these copies, not the city; the server checks
 * everything again.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { TAP_DISTANCE, TAP_TIME } from "../engine/input";
import { CELL, MODULE_CELLS, cellPoint, moduleGround, objectLayout, pointCell, siteLayout, squareProblem, plotFootprint, projectFootprint, type ProjectFamily } from "../world/estates";
import { areaFrame, blockCell, districtBorders, plotAt, type DistrictCentre, type Frame, type LandBlock, type LandGrid } from "../world/land";
import { createBorders } from "../render/borders";
import { plotLayout } from "../world/landLayouts";
import { districtColour, type PlotFamily } from "../world/estateGrid";
import { HOUSE_SCALE, READY_HOUSES, isReadyHouse } from "../world/familyHouses";
import { OFFICE_BUILDINGS, isOfficeBuilding, officeBuildingScale, officeBuildingBounds, officeBuildingRayDistance } from "../world/officeBuildings";
import type { Placement, Surface } from "../world/types";
import type { CityBuildView, CityEstateView, EstatePick, EstateTarget } from "../types";
import type { DistrictEstate, PublicObject } from "../../api/cityEstate";

/** Signs over projects show only this close. */
const SIGN_REACH = 230;
const OK = new THREE.Color("#35b07a"), BAD = new THREE.Color("#e0525d");
/** Meadow of a free plot, the paving of a centre; in build mode the plots for sale and the bands still closed. */
const MEADOW = new THREE.Color("#97b67c"), PAVING = new THREE.Color("#ddd4c0"), FOR_SALE = new THREE.Color("#c4e59a"), CLOSED = new THREE.Color("#7f9172");
/** The plots' ground over the land, under every patch of what stands on them (render/terrain.ts TOP and its lifts). */
const PLOT_Y = .203, INSET = .24;

export interface Estates {
  set(view: CityEstateView | null): void;
  setCatalogue(catalogue: Catalogue): void;
  setBuild(view: CityBuildView | null): void;
  setActive(active: boolean): void;
  /** A point to look at (a district's centre or square, a plot, a building) and the azimuth to look from. */
  focus(target: EstateTarget, distance: number, polar: number): { point: THREE.Vector3; azimuth: number } | null;
  dispose(): void;
}

const numberOf = (district: string) => Number(district.split("-").at(-1));
const plotKey = (district: number, block: number, col: number, row: number) => `${district}:${block}:${col}:${row}`;
const onSquare = (obj: { module: number | null }) => obj.module === 0;

/** Where a building on plots stands: the frame over its plots. */
function objectFrame(block: LandBlock, obj: Pick<PublicObject, "u" | "v" | "w" | "h">) {
  return areaFrame(block, obj.u!, obj.v!, obj.w, obj.h);
}

/** The plots' ground: every plot for sale a meadow inset from its edges, every centre's plots paved edge to edge. */
function plotGround(grid: LandGrid) {
  const positions: number[] = [], colours: number[] = [], index: number[] = [], slots = new Map<string, number>();
  const centres = new Map(grid.centres.map(c => [`${c.district}:${c.block}`, c]));
  const quad = (corners: { x: number; z: number }[], colour: THREE.Color) => {
    const base = positions.length / 3, [a, b, c] = corners;
    for (const p of corners) { positions.push(p.x, PLOT_Y, p.z); colours.push(colour.r, colour.g, colour.b); }
    // Facing up whichever way round the corners go (a ring block's run the other way from a rectangle's).
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    return base;
  };
  for (const block of grid.blocks) {
    const centre = centres.get(`${block.district}:${block.block}`);
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) {
      const f = areaFrame(block, c, r), inCentre = centre && c >= centre.col && c < centre.col + centre.cols && r >= centre.row && r < centre.row + centre.rows;
      if (inCentre) { quad(f.corners, PAVING); continue; }
      if (block.skip.has(`${c}:${r}`)) continue;
      slots.set(plotKey(block.district, block.block, c, r), quad(inset(f), MEADOW));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .85, metalness: .02 }));
  mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.name = "district-plots";
  return { mesh, slots };
}
/** A plot's corners moved INSET in from its edges, along its own width and depth. */
function inset(f: Frame) {
  const s = Math.sin(f.rotation), c = Math.cos(f.rotation);
  return f.corners.map(p => {
    const dx = p.x - f.x, dz = p.z - f.z, lu = dx * c - dz * s, lw = dx * s + dz * c;
    const u = lu - Math.sign(lu) * INSET, w = lw - Math.sign(lw) * INSET;
    return { x: f.x + c * u + s * w, z: f.z - s * u + c * w };
  });
}

export function createEstates(ctx: CityContext, grid: LandGrid, onPick: (pick: EstatePick) => void): Estates {
  let view: CityEstateView | null = null, build: CityBuildView | null = null, catalogue: Catalogue | null = null, active = true;
  const blocks = new Map(grid.blocks.map(b => [`${b.district}:${b.block}`, b]));
  const blockOf = (district: number, block: number | null) => block === null ? undefined : blocks.get(`${district}:${block}`);
  const centreOf = (district: string): DistrictCentre | undefined => grid.centres.find(c => c.district === numberOf(district));
  const stateOf = (district: string): DistrictEstate | undefined => view?.state.districts.find(d => d.id === district);

  // ---- the ground: plots, centres and their public squares, laid out once ----
  const ground = plotGround(grid); ctx.scene.add(ground.mesh);
  // Where the districts meet: a band in both districts' colours and posts along it (render/borders.ts).
  const borders = createBorders(districtBorders(grid, ctx.world), districtColour); ctx.scene.add(borders.band, borders.posts);
  const squares = grid.centres.map(c => moduleGround(c.square));
  const squarePatches = createPatches(squares.flatMap(l => l.surfaces)); ctx.scene.add(squarePatches);
  let squarePools: InstancePools | null = null;

  /** Colours every plot: its district's faint tint, and in build mode what is for sale, what waits and what is taken. */
  function recolour() {
    const colour = ground.mesh.geometry.getAttribute("color") as THREE.BufferAttribute, c = new THREE.Color(), tint = new THREE.Color();
    const own = build?.area === "plots" ? numberOf(build.district) : 0, state = build ? stateOf(build.district) : undefined, open = state?.land?.open_band ?? 1;
    const taken = takenPlots();
    for (const block of grid.blocks) for (let col = 0; col < block.cols; col++) for (let row = 0; row < block.rows; row++) {
      const slot = ground.slots.get(plotKey(block.district, block.block, col, row));
      if (slot === undefined) continue;
      tint.set(districtColour(block.district));
      // Every district's free land in its own shade, so its extent reads at a glance; in build mode the own district's plots are lit instead.
      c.copy(MEADOW).lerp(tint, own ? .05 : .28);
      if (own === block.district && !taken.has(plotKey(block.district, block.block, col, row))) c.copy(block.band <= open ? FOR_SALE : CLOSED);
      else if (own && own !== block.district) c.lerp(CLOSED, .35);
      for (let k = 0; k < 4; k++) colour.setXYZ(slot + k, c.r, c.g, c.b);
    }
    colour.needsUpdate = true;
  }
  /** Plots that something stands on, in every district. */
  function takenPlots() {
    const taken = new Set<string>();
    for (const d of view?.state.districts ?? []) for (const o of d.objects) if (!onSquare(o) && o.module !== null && o.u !== null && o.v !== null)
      for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) taken.add(plotKey(d.number, o.module, o.u + i, o.v + j));
    return taken;
  }

  // ---- buildings ----
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null, builtKey = "";
  const seen = new Map<number, number>();
  function rebuild() {
    const key = view ? JSON.stringify(view.state.districts.map(d => [d.id, d.objects.map(o => [o.id, o.family, o.level, o.module, o.u, o.v, o.rotation]), d.projects.map(p => [p.id, p.module, p.u, p.v, p.rotation])])) : "";
    if (key === builtKey && (pools || !catalogue)) { recolour(); refreshSigns(); refreshBuild(); return; }
    builtKey = key;
    pools?.dispose(); pools = null;
    if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); patches = null; }
    const placements: Placement[] = [], surfaces: Surface[] = [];
    for (const district of view?.state.districts ?? []) {
      const centre = centreOf(district.id);
      for (const obj of district.objects) {
        const layout = layoutOf(district, obj, centre);
        if (!layout) continue;
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
        // A new building or a new stage rises behind a short veil; the first look at the city shows it as it is.
        const before = seen.get(obj.id);
        if (seen.size && before !== obj.level) veil(district, obj, centre);
      }
      if (centre) for (const project of district.projects) {
        if (project.u === null || project.v === null || project.target_id) continue;
        const layout = siteLayout(centre.square, { family: project.family, u: project.u, v: project.v, rotation: project.rotation });
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
      }
    }
    seen.clear();
    for (const district of view?.state.districts ?? []) for (const obj of district.objects) seen.set(obj.id, obj.level);
    if (surfaces.length) { patches = createPatches(surfaces); ctx.scene.add(patches); }
    if (catalogue && placements.length) pools = createInstancePools(ctx, catalogue, placements);
    ctx.requestShadowUpdate();
    recolour(); refreshSigns(); refreshBuild();
  }
  function layoutOf(district: DistrictEstate, obj: PublicObject, centre: DistrictCentre | undefined) {
    if (obj.module === null || obj.u === null || obj.v === null) return null;
    if (onSquare(obj)) return centre ? objectLayout(centre.square, { family: obj.family as ProjectFamily, level: obj.level, u: obj.u, v: obj.v, rotation: obj.rotation }) : null;
    const block = blockOf(district.number, obj.module);
    return block ? plotLayout(objectFrame(block, obj), obj.family as PlotFamily, obj.level, obj.id) : null;
  }
  /** Where a building stands: its frame (on plots) or the middle of its cells (on the square), with its size. */
  function placeOf(district: DistrictEstate, obj: PublicObject): { x: number; z: number; rotation: number; width: number; depth: number } | null {
    if (obj.module === null || obj.u === null || obj.v === null) return null;
    if (onSquare(obj)) {
      const centre = centreOf(district.id); if (!centre) return null;
      const p = cellPoint(centre.square, obj.u + obj.w / 2, obj.v + obj.h / 2);
      return { ...p, rotation: centre.square.rotation, width: obj.w * CELL, depth: obj.h * CELL };
    }
    const block = blockOf(district.number, obj.module);
    return block ? objectFrame(block, obj) : null;
  }

  // ---- build mode: the picked plot, the preview, the selection, the square's cells ----
  const lineMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffffff", transparent: true, opacity: .8, depthWrite: false });
  const cells = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial); cells.visible = false; cells.renderOrder = 3;
  const ghostMaterial = new THREE.MeshBasicNodeMaterial({ color: OK, transparent: true, opacity: .4, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), ghostMaterial); ghost.visible = false; ghost.renderOrder = 4;
  const edgeMaterial = new THREE.LineBasicNodeMaterial({ color: OK, transparent: true, opacity: .95, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), edgeMaterial); ghost.add(edges);
  const selectMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffd24a", transparent: true, depthWrite: false });
  const selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), selectMaterial); selection.visible = false;
  ctx.scene.add(cells, ghost, selection);
  let pinned: { module: number; u: number; v: number } | null = null, reported = "";

  const box = (mesh: THREE.Object3D, place: { x: number; z: number; rotation: number; width: number; depth: number }, height: number, pad = 0) => {
    mesh.position.set(place.x, .21, place.z); mesh.rotation.set(0, place.rotation, 0); mesh.scale.set(place.width - pad, height, place.depth - pad); mesh.visible = true;
  };
  /** Why the operator's building from the inventory cannot stand there, as the server would say (city_estate.py free_plots), or null. */
  function plotProblem(block: LandBlock | undefined, col: number, row: number, w: number, h: number) {
    const state = build && stateOf(build.district);
    if (!block || col < 0 || row < 0 || col + w > block.cols || row + h > block.rows) return w * h === 1 ? "Здесь нет участков твоего района на продажу" : "Постройка должна целиком помещаться на участках одного квартала";
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (block.skip.has(`${col + i}:${row + j}`)) return w * h === 1 ? "Здесь нет участков твоего района на продажу" : "Постройка должна целиком помещаться на участках одного квартала";
    if (block.band > (state?.land?.open_band ?? 1)) return "Этот пояс района ещё закрыт: он откроется, когда займут 70 % участков ближе к центру";
    const taken = takenPlots();
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (taken.has(plotKey(block.district, block.block, col + i, row + j))) return "Этот участок уже занят";
    return null;
  }
  function showGhost(target: { module: number; u: number; v: number } | null) {
    if (!build?.placing || !target) { ghost.visible = false; return; }
    const { family, rotation } = build.placing, number = numberOf(build.district);
    let problem: string | null, place: { x: number; z: number; rotation: number; width: number; depth: number } | null = null, at = target;
    if (build.area === "public") {
      const centre = centreOf(build.district); if (!centre) { ghost.visible = false; return; }
      const [w, h] = projectFootprint(family as ProjectFamily, rotation);
      at = { module: 0, u: target.u - Math.floor((w - 1) / 2), v: target.v - Math.floor((h - 1) / 2) };
      const taken = new Set<string>(), state = stateOf(build.district);
      for (const o of state?.objects ?? []) if (onSquare(o) && o.u !== null && o.v !== null) for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) taken.add(`${o.u + i}:${o.v + j}`);
      for (const p of state?.projects ?? []) if (p.u !== null && p.v !== null) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) taken.add(`${p.u + i}:${p.v + j}`);
      problem = squareProblem({ family: family as ProjectFamily, u: at.u, v: at.v, rotation }, (u, v) => taken.has(`${u}:${v}`));
      const p = cellPoint(centre.square, at.u + w / 2, at.v + h / 2);
      place = { ...p, rotation: centre.square.rotation, width: w * CELL, depth: h * CELL };
    } else {
      const [w, h] = plotFootprint(family as PlotFamily, rotation), block = blockOf(number, target.module);
      problem = plotProblem(block, target.u, target.v, w, h);
      if (block) { const cols = Math.min(w, block.cols - target.u), rows = Math.min(h, block.rows - target.v); if (cols > 0 && rows > 0) place = areaFrame(block, target.u, target.v, cols, rows); }
    }
    if (!place) { ghost.visible = false; return; }
    box(ghost, place, build.area === "public" ? 1.1 : 1.6, .25);
    ghostMaterial.color.copy(problem ? BAD : OK); edgeMaterial.color.copy(problem ? BAD : OK);
    const key = `${build.district}:${at.module}:${at.u}:${at.v}:${rotation}:${problem}`;
    if (key !== reported) { reported = key; onPick({ kind: "place", district: build.district, module: at.module, u: at.u, v: at.v, rotation, problem }); }
  }
  function showSelection() {
    const id = build?.selected, district = view?.state.districts.find(d => d.objects.some(o => o.id === id));
    const obj = district?.objects.find(o => o.id === id), place = district && obj ? placeOf(district, obj) : null;
    if (place) { box(selection, place, 1.6); return; }
    // The plot picked for a purchase.
    const picked = build?.plot && blockOf(numberOf(build.district), build.plot.block);
    if (picked && build?.plot) box(selection, areaFrame(picked, build.plot.col, build.plot.row), 1.2, .2);
    else selection.visible = false;
  }
  /** The square's cells while staff place a shared project. */
  function refreshCells() {
    const points: number[] = [], y = .29, centre = build?.area === "public" ? centreOf(build.district) : undefined;
    if (centre) for (let k = 0; k <= MODULE_CELLS; k++) {
      for (const [a, b] of [[cellPoint(centre.square, k, 0), cellPoint(centre.square, k, MODULE_CELLS)], [cellPoint(centre.square, 0, k), cellPoint(centre.square, MODULE_CELLS, k)]]) points.push(a.x, y, a.z, b.x, y, b.z);
    }
    cells.geometry.dispose(); cells.geometry = new THREE.BufferGeometry(); cells.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    cells.visible = points.length > 0;
  }
  function refreshBuild() { refreshCells(); showSelection(); reported = ""; showGhost(pinned); }

  // ---- signs over the projects still collecting ----
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
      const centre = centreOf(district.id); if (!centre) continue;
      for (const project of district.projects) {
        const target = project.target_id ? district.objects.find(o => o.id === project.target_id) : project;
        if (!target || target.u === null || target.v === null) continue;
        const p = cellPoint(centre.square, target.u + target.w / 2, target.v + target.h / 2), id = `project-${project.id}`; live.add(id);
        sign(id, "🏗️", project.name, project.progress === null ? "Сбор идёт" : `Собрано ${project.progress}%`, new THREE.Vector3(p.x, 3, p.z), { kind: "project", district: district.id, project: project.id });
      }
    }
    for (const [id, item] of signs) if (!live.has(id)) { item.el.remove(); signs.delete(id); }
    place();
  }
  const scratch = new THREE.Vector3();
  function place() {
    // The sign layer covers the screen; the city's own label container may have no height of its own.
    const width = layer.clientWidth || ctx.overlay.clientWidth, height = layer.clientHeight || ctx.overlay.clientHeight;
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
  function veil(district: DistrictEstate, obj: PublicObject, centre: DistrictCentre | undefined) {
    if (ctx.reducedMotion || veils.length > 3) return;
    const at = centre && placeOf(district, obj);
    if (!at) return;
    const mesh = new THREE.Mesh(ghost.geometry, veilMaterial.clone());
    mesh.position.set(at.x, .21, at.z); mesh.rotation.y = at.rotation; mesh.scale.set(at.width, .01, at.depth);
    const height = obj.family === "house" ? 2.4 + obj.level * .4 : isReadyHouse(obj.family) ? READY_HOUSES[obj.family].height * HOUSE_SCALE + .4
      : isOfficeBuilding(obj.family) ? OFFICE_BUILDINGS[obj.family].height * officeBuildingScale(obj.family, at.width, at.depth) + .4 : 2.2;
    ctx.scene.add(mesh); veils.push({ mesh, age: 0, height });
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

  // ---- pointer: a tap picks a plot or a building, or pins the preview; the mouse moves the preview ----
  const canvas = ctx.renderer.domElement, raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.2), hit = new THREE.Vector3();
  function rayAt(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, ctx.camera);
    return raycaster.ray;
  }
  function groundAt(clientX: number, clientY: number) {
    return rayAt(clientX, clientY)?.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }
  /** Tall facades project beyond their plots on the ground, so select their actual volume first. */
  function officeAtRay(ray: THREE.Ray) {
    let nearest: { district: DistrictEstate; obj: PublicObject } | null = null, distance = Infinity;
    for (const district of view?.state.districts ?? []) for (const obj of district.objects) {
      if (!isOfficeBuilding(obj.family)) continue;
      const frame = placeOf(district, obj);
      if (!frame) continue;
      const at = officeBuildingRayDistance(obj.family, frame, ray.origin, ray.direction);
      if (at !== null && at < distance) { distance = at; nearest = { district, obj }; }
    }
    return nearest;
  }
  /** The square's cell under a point, for the square of `district`. */
  function cellAt(district: string, p: { x: number; z: number }) {
    const centre = centreOf(district); if (!centre) return null;
    const c = pointCell(centre.square, p);
    return c.u >= 0 && c.v >= 0 && c.u < MODULE_CELLS && c.v < MODULE_CELLS ? { module: 0, u: Math.floor(c.u), v: Math.floor(c.v) } : null;
  }
  /** What stands at a point: a building on plots or on a district's square. */
  function objectAt(p: { x: number; z: number }) {
    for (const district of view?.state.districts ?? []) {
      const cell = cellAt(district.id, p);
      for (const o of district.objects) {
        if (o.module === null || o.u === null || o.v === null) continue;
        if (onSquare(o)) { if (cell && cell.u >= o.u && cell.u < o.u + o.w && cell.v >= o.v && cell.v < o.v + o.h) return { district, obj: o }; continue; }
        const block = blockOf(district.number, o.module), at = block && blockCell(block, p);
        if (at && at.u >= o.u && at.u < o.u + o.w && at.v >= o.v && at.v < o.v + o.h) return { district, obj: o };
      }
    }
    return null;
  }
  /** Where the preview goes for a point: a cell of the square (staff) or a plot of the district's own blocks, for sale or not, so it can say why. */
  function previewAt(p: { x: number; z: number }) {
    if (!build) return null;
    if (build.area === "public") return cellAt(build.district, p);
    const number = numberOf(build.district);
    for (const block of grid.blocks) {
      if (block.district !== number) continue;
      const at = blockCell(block, p);
      if (at && at.u < block.cols && at.v < block.rows) return { module: block.block, u: Math.floor(at.u), v: Math.floor(at.v) };
    }
    return null;
  }
  function pick(p: { x: number; z: number }) {
    if (build?.placing) {
      const target = previewAt(p);
      if (target) { pinned = target; reported = ""; showGhost(target); }
      return;
    }
    const found = objectAt(p);
    if (found) { onPick({ kind: "object", district: found.district.id, object: found.obj.id }); return; }
    if (build?.area !== "plots") return;
    const at = plotAt(grid, p);
    if (!at || at.block.district !== numberOf(build.district)) return;
    onPick({ kind: "plot", district: build.district, block: at.block.block, col: at.col, row: at.row, band: at.block.band, problem: plotProblem(at.block, at.col, at.row, 1, 1) });
  }
  let down: { x: number; y: number; time: number } | null = null, pressed = 0, frame = 0, hover: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => { if (event.isPrimary) { pressed = 1; down = { x: event.clientX, y: event.clientY, time: performance.now() }; } else { pressed++; down = null; } };
  const onUp = (event: PointerEvent) => {
    pressed = Math.max(0, pressed - 1);
    const tap = down && pressed === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && performance.now() - down.time < TAP_TIME;
    if (pressed === 0) down = null;
    if (!tap || !active) return;
    const ray = rayAt(event.clientX, event.clientY);
    if (!ray) return;
    if (!build?.placing) {
      const found = officeAtRay(ray);
      if (found) { onPick({ kind: "object", district: found.district.id, object: found.obj.id }); return; }
    }
    if (ray.intersectPlane(plane, hit)) pick({ x: hit.x, z: hit.z });
  };
  const onMove = (event: PointerEvent) => {
    if (!build?.placing || event.pointerType !== "mouse" || event.buttons || !active) return;
    hover = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!hover || !build?.placing) return;
      const p = groundAt(hover.x, hover.y), target = p && previewAt(p);
      if (target) { pinned = target; showGhost(target); }
    });
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointermove", onMove);

  function rebuildSquares() {
    squarePools?.dispose(); squarePools = null;
    if (catalogue) squarePools = createInstancePools(ctx, catalogue, squares.flatMap(l => l.placements));
  }

  recolour();
  return {
    set(next) {
      // The other land on the same ground (the administrators' test city, or back from it) is a first look: nothing rises.
      if (!!next?.state.sandbox !== !!view?.state.sandbox) seen.clear();
      view = next; rebuild();
    },
    setCatalogue(value) { catalogue = value; rebuildSquares(); builtKey = ""; rebuild(); },
    setBuild(next) {
      const same = build && next && build.district === next.district && build.area === next.area && build.placing?.family === next.placing?.family && build.placing?.moving === next.placing?.moving;
      build = next; if (!same) pinned = null;
      recolour(); refreshBuild();
    },
    setActive(value) {
      active = value; layer.hidden = !value;
      if (!value) for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
    },
    focus(target) {
      const number = numberOf(target.district), centre = centreOf(target.district);
      let place: { x: number; z: number; rotation: number } | null = null, y = 1;
      if (target.kind === "plot" && target.plot) { const block = blockOf(number, target.plot.block); if (block) place = areaFrame(block, target.plot.col, target.plot.row); }
      else if (target.kind === "object") {
        const district = stateOf(target.district), obj = district?.objects.find(o => o.id === target.object);
        if (district && obj) {
          const frame = placeOf(district, obj);
          place = frame;
          if (frame && isOfficeBuilding(obj.family)) { const bounds = officeBuildingBounds(obj.family, frame); place = bounds; y = .2 + bounds.height / 2; }
        }
      } else if (target.kind === "public" && centre) place = { ...centre.square };
      if (!place && centre) place = { x: centre.area.x, z: centre.area.z, rotation: centre.area.rotation };
      if (!place) return null;
      // From the street in front of it, a little to the side, so its front and the plots beside it show.
      return { point: new THREE.Vector3(place.x, y, place.z), azimuth: place.rotation + .55 };
    },
    dispose() {
      offFrame(); offMove(); if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointermove", onMove);
      layer.remove(); squarePools?.dispose(); pools?.dispose();
      for (const mesh of [ground.mesh, squarePatches, patches]) if (mesh) { ctx.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      ctx.scene.remove(borders.band, borders.posts); borders.dispose();
      for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
      ctx.scene.remove(cells, ghost, selection);
      cells.geometry.dispose(); ghost.geometry.dispose(); edges.geometry.dispose(); selection.geometry.dispose();
      [lineMaterial, ghostMaterial, edgeMaterial, selectMaterial, veilMaterial].forEach(m => m.dispose());
    },
  };
}
