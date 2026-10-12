/**
 * Team district land in one city (docs/CITY_ESTATES.md): the small cells of its three districts (world/land.ts),
 * every district's centre with its main building, and what the server reports standing on them: buildings on 3 × 3
 * cells, and the small things operators lay a cell at a time, roads, footpaths, hedges, trees, lamps, benches, bushes
 * and flowerbeds (world/decor.ts). Normal exploration shows the land as it is built. Only in build mode does the
 * operator's own grid of cells appear, free cells light green: a tap picks a plot for a building (or a building), a
 * building from the inventory follows the pointer with its reason when it does not fit, and with a small thing's tool
 * a drag (or taps) chooses the cells to lay it on or to take it from. Staff place a shared project on the cells of an
 * old public square. Buildings and small things go through instance pools of their own, so a purchase rebuilds only
 * these copies, not the city; the server checks everything again.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { createLampLights, type LampLights } from "../render/lampLights";
import { TAP_DISTANCE, TAP_TIME } from "../engine/input";
import { CELL, MODULE_CELLS, cellPoint, moduleGround, objectLayout, pointCell, siteLayout, squareProblem, plotFootprint, projectFootprint, type ProjectFamily } from "../world/estates";
import { CELLS, areaCorners, areaFrame, blockCell, cellUnder, cellsBetween, districtBorders, homeSide, type CellRef, type DistrictCentre, type Frame, type LandBlock, type LandGrid } from "../world/land";
import { buildingFacing, decorKey, decorLayout, decorMap, type DecorMap, type GroundQuad } from "../world/decor";
import { createBorders } from "../render/borders";
import { plotLayout } from "../world/landLayouts";
import { districtColour, type PlotFamily } from "../world/estateGrid";
import { HOUSE_SCALE, READY_HOUSES, isReadyHouse } from "../world/familyHouses";
import { OFFICE_BUILDINGS, isOfficeBuilding, officeBuildingScale, officeBuildingBounds, officeBuildingRayDistance } from "../world/officeBuildings";
import { districtMainFrame, districtMainLayout, landmarkHeight, landmarkBounds, landmarkRayDistance } from "../world/districtLandmark";
import { districtGarden, type Garden } from "../world/districtGarden";
import type { Placement, Surface } from "../world/types";
import type { CityBuildView, CityEstateView, EstatePick, EstateTarget, PlotAddress } from "../types";
import type { DistrictEstate, PublicObject } from "../../api/cityEstate";

/** Signs over projects show only this close. */
const SIGN_REACH = 230;
/** The square's invitation belongs to a close district view, rather than the whole-city skyline. */
const SQUARE_SIGN_REACH = 85;
const OK = new THREE.Color("#35b07a"), BAD = new THREE.Color("#e0525d"), TAKE = new THREE.Color("#f0a23a");
/** A taken cell; in build mode the free cells, and one's own small things while taking them away. */
const MEADOW = new THREE.Color("#97b67c"), FOR_SALE = new THREE.Color("#c4e59a"), OWN_DECOR = new THREE.Color("#f2c46d");
/** The seams between the cells: a shade darker than free land, so the grid reads up close and does not ripple from afar. */
const GROUT = new THREE.Color("#afd088");
/** The cells' ground over the land, under every patch of what stands on them (render/terrain.ts TOP and its lifts). */
const PLOT_Y = .203, INSET = .1;
/** Chosen cells and the cell under the mouse: over the roads and the yards, under the buildings. */
const PICK_Y = .25;

export interface EstateFocusView {
  point: THREE.Vector3;
  azimuth: number;
  /** All the own district's cell corners, including occupied land, for a build overview. */
  bounds?: THREE.Box3;
}

export interface Estates {
  set(view: CityEstateView | null): void;
  setCatalogue(catalogue: Catalogue): void;
  setBuild(view: CityBuildView | null): void;
  setActive(active: boolean): void;
  /** A point to look at (a district's centre or square, a plot, a building) and the azimuth to look from. */
  focus(target: EstateTarget, distance: number, polar: number): EstateFocusView | null;
  dispose(): void;
}

const numberOf = (district: string) => Number(district.split("-").at(-1));
const onSquare = (obj: { module: number | null }) => obj.module === 0;
const isPark = (family: string) => family === "park" || family === "bigpark";

/** Corners moved INSET in, towards the middle (a cell's or a plot's). */
function inset(corners: { x: number; z: number }[], by = INSET) {
  const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length, cz = corners.reduce((s, p) => s + p.z, 0) / corners.length;
  return corners.map(p => { const dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1, k = Math.max(0, l - by * Math.SQRT2) / l; return { x: cx + dx * k, z: cz + dz * k }; });
}

/** Flat quads into one indexed mesh, each facing up whichever way round its corners go. */
function flatMesh(quads: { points: { x: number; z: number }[]; y: number; colour: THREE.Color }[], material: THREE.Material, name: string) {
  const positions: number[] = [], colours: number[] = [], index: number[] = [];
  for (const q of quads) {
    const base = positions.length / 3, [a, b, c] = q.points;
    for (const p of q.points) { positions.push(p.x, q.y, p.z); colours.push(q.colour.r, q.colour.g, q.colour.b); }
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false; mesh.name = name;
  return mesh;
}

/**
 * Pooled meshes: the permanent ground of the centres' gardens (world/districtGarden.ts), and the own district's grid of
 * cells over the seams between them, visible only in build mode.
 */
function plotGround(grid: LandGrid, gardens: readonly Garden[]) {
  const slots = new Map<string, number>(), indices = new Map<number, number[]>(), seams = new Map<number, number[]>();
  const plots = { positions: [] as number[], colours: [] as number[], index: [] as number[] };
  const paving = { positions: [] as number[], colours: [] as number[], index: [] as number[] };
  const grout = { positions: [] as number[], colours: [] as number[], index: [] as number[] };
  const quad = (parts: typeof plots, corners: { x: number; z: number }[], colour: THREE.Color) => {
    const base = parts.positions.length / 3, [a, b, c] = corners;
    for (const p of corners) { parts.positions.push(p.x, PLOT_Y, p.z); parts.colours.push(colour.r, colour.g, colour.b); }
    // Facing up whichever way round the corners go (a ring block's run the other way from a rectangle's).
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    parts.index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    return base;
  };
  const colour = new THREE.Color();
  for (const garden of gardens) for (const q of garden.ground) quad(paving, q.points, colour.set(q.colour));
  for (const block of grid.blocks) {
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) {
      if (block.skip.has(`${c}:${r}`)) continue;
      slots.set(decorKey(block.district, block.block, c, r), quad(plots, inset(areaCorners(block, c, r)), MEADOW));
      const own = indices.get(block.district) ?? [];
      own.push(...plots.index.slice(-6)); indices.set(block.district, own);
    }
    // Under them the seams: a strip down each column over every run of cells for sale.
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows;) {
      if (block.skip.has(`${c}:${r}`)) { r++; continue; }
      let end = r;
      while (end + 1 < block.rows && !block.skip.has(`${c}:${end + 1}`)) end++;
      quad(grout, areaCorners(block, c, r, 1, end - r + 1), GROUT);
      const own = seams.get(block.district) ?? [];
      own.push(...grout.index.slice(-6)); seams.set(block.district, own);
      r = end + 1;
    }
  }
  const meshOf = (parts: typeof plots, name: string, bias = -2) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(parts.positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(parts.colours, 3));
    geometry.setIndex(parts.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(parts.index, 1) : new THREE.Uint16BufferAttribute(parts.index, 1));
    // In a whole-district view the 0.003-unit lift loses depth precision against the terrain.
    // Bias the ground surface toward the camera while retaining ordinary building occlusion; the seams a little
    // less, so the cells over them always win.
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .85, metalness: .02, polygonOffset: true, polygonOffsetFactor: bias, polygonOffsetUnits: bias }));
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.name = name;
    return mesh;
  };
  // Keep one index buffer for the lifetime of the scene. A draw range selects the own district without
  // creating or replacing GPU buffers whenever the dock opens, closes or changes district.
  const byDistrict = (parts: typeof plots, lists: Map<number, number[]>) => {
    const ranges = new Map<number, { start: number; count: number }>();
    parts.index = [];
    for (const [district, own] of lists) { ranges.set(district, { start: parts.index.length, count: own.length }); parts.index.push(...own); }
    return ranges;
  };
  const ranges = byDistrict(plots, indices), seamRanges = byDistrict(grout, seams);
  const mesh = meshOf(plots, "district-plots"), centreMesh = meshOf(paving, "district-centres"), seamMesh = meshOf(grout, "district-seams", -1);
  mesh.visible = seamMesh.visible = false;
  return { mesh, centreMesh, seamMesh, slots, show(district: number) {
    const range = ranges.get(district), seam = seamRanges.get(district);
    mesh.visible = !!range; seamMesh.visible = !!seam;
    mesh.geometry.setDrawRange(range?.start ?? 0, range?.count ?? 0);
    seamMesh.geometry.setDrawRange(seam?.start ?? 0, seam?.count ?? 0);
  } };
}

export function createEstates(ctx: CityContext, grid: LandGrid, onPick: (pick: EstatePick) => void): Estates {
  let view: CityEstateView | null = null, build: CityBuildView | null = null, catalogue: Catalogue | null = null, active = true;
  let decor: DecorMap = new Map();
  const blocks = new Map(grid.blocks.map(b => [`${b.district}:${b.block}`, b]));
  const blockOf = (district: number, block: number | null) => block === null ? undefined : blocks.get(`${district}:${block}`);
  const centreOf = (district: string): DistrictCentre | undefined => grid.centres.find(c => c.district === numberOf(district));
  const stateOf = (district: string): DistrictEstate | undefined => view?.state.districts.find(d => d.id === district);
  const landmarkFrame = (district: DistrictEstate) => {
    const centre = centreOf(district.id);
    return centre ? districtMainFrame(centre, district.landmark) : null;
  };

  // ---- the ground: cells, centres with their gardens and old public squares, laid out once ----
  const gardens = grid.centres.map(c => districtGarden(blocks.get(`${c.district}:${c.block}`)!, c));
  const ground = plotGround(grid, gardens); ctx.scene.add(ground.mesh, ground.centreMesh, ground.seamMesh);
  // Where the districts meet: a band in both districts' colours and posts along it (render/borders.ts).
  const borders = createBorders(districtBorders(grid, ctx.world), districtColour); ctx.scene.add(borders.band, borders.posts);
  let squarePatches: THREE.Mesh | null = null, squareKey = "";
  let squarePools: InstancePools | null = null, squareLights: LampLights | null = null;

  /** Cells something stands on, in every district: buildings' and small things'. */
  let taken = new Set<string>();
  function takenCells() {
    const out = new Set<string>();
    for (const d of view?.state.districts ?? []) for (const o of d.objects) if (!onSquare(o) && o.module !== null && o.u !== null && o.v !== null)
      for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) out.add(decorKey(d.number, o.module, o.u + i, o.v + j));
    for (const key of decor.keys()) out.add(key);
    return out;
  }
  /** The own district's grid appears only while choosing land: free cells, taken ones, one's own small things when taking them away. */
  function recolour() {
    const colour = ground.mesh.geometry.getAttribute("color") as THREE.BufferAttribute, c = new THREE.Color();
    const own = build?.area === "plots" ? numberOf(build.district) : 0, removing = build?.decor?.tool === "remove";
    ground.show(active ? own : 0);
    if (!own || !active) return;
    for (const block of grid.blocks) if (block.district === own) for (let col = 0; col < block.cols; col++) for (let row = 0; row < block.rows; row++) {
      const key = decorKey(block.district, block.block, col, row), slot = ground.slots.get(key);
      if (slot === undefined) continue;
      c.copy(removing && (build?.decor?.anyone ? decor.has(key) : decor.get(key)?.mine) ? OWN_DECOR : taken.has(key) ? MEADOW : FOR_SALE);
      for (let k = 0; k < 4; k++) colour.setXYZ(slot + k, c.r, c.g, c.b);
    }
    colour.needsUpdate = true;
  }

  // ---- buildings and small things ----
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null, paving: THREE.Mesh | null = null, lights: LampLights | null = null, builtKey = "";
  const pavingMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .82, metalness: .03, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  // The same catalogue transforms that draw houses also define their selectable bodies.
  // Gardens, trees and paving stay out of these volumes so adjacent free cells remain selectable.
  const houseBodies: { pick: EstatePick; bounds: THREE.Box3; matrix: THREE.Matrix4; inverse: THREE.Matrix4 }[] = [];
  const seen = new Map<number, number>();
  function rebuild() {
    rebuildSquares();
    decor = decorMap(view?.state.districts ?? []);
    taken = takenCells();
    const key = view ? JSON.stringify(view.state.districts.map(d => [d.id, d.version, d.landmark && [d.landmark.status, d.landmark.level, d.landmark.u, d.landmark.v, d.landmark.w, d.landmark.h], d.objects.map(o => [o.id, o.family, o.level, o.module, o.u, o.v, o.rotation]), d.projects.map(p => [p.id, p.module, p.u, p.v, p.rotation]), Object.entries(d.decor ?? {}).map(([k, v]) => [k, v.length])])) : "";
    if (key === builtKey && (pools || !catalogue)) { recolour(); refreshSigns(); refreshBuild(); return; }
    builtKey = key;
    houseBodies.length = 0;
    pools?.dispose(); pools = null;
    lights?.dispose(); lights = null;
    for (const mesh of [patches, paving]) if (mesh) { ctx.scene.remove(mesh); mesh.geometry.dispose(); }
    if (patches) (patches.material as THREE.Material).dispose();
    patches = paving = null;
    const placements: Placement[] = [], surfaces: Surface[] = [];
    for (const district of view?.state.districts ?? []) {
      const centre = centreOf(district.id);
      const main = landmarkFrame(district);
      if (main && district.landmark) {
        const layout = districtMainLayout(main, district.landmark.level);
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
      }
      for (const obj of district.objects) {
        const layout = layoutOf(district, obj, centre);
        if (!layout) continue;
        placements.push(...layout.placements); surfaces.push(...layout.surfaces);
        if (catalogue && (obj.family === "house" || isReadyHouse(obj.family))) {
          for (const placement of layout.placements) {
            if (placement.kind !== "cottage" && placement.kind !== "roof" && placement.kind !== "family-house") continue;
            const matrix = new THREE.Matrix4(), model = catalogue.resolve(placement, matrix);
            if (model) houseBodies.push({ pick: { kind: "object", district: district.id, object: obj.id }, bounds: model.bounds.clone(), matrix, inverse: matrix.clone().invert() });
          }
        }
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
    // The small things: their paving as one mesh, their pieces with the buildings', their lamps lit at night.
    const small = decorLayout(grid, decor);
    placements.push(...small.placements);
    if (small.ground.length) {
      const c = new THREE.Color();
      paving = flatMesh(small.ground.map((q: GroundQuad) => ({ points: q.points, y: q.y, colour: c.set(q.colour).clone() })), pavingMaterial, "district-roads");
      paving.receiveShadow = true; ctx.scene.add(paving);
    }
    if (small.lamps.length) lights = createLampLights(ctx, small.lamps, "district-lamp");
    seen.clear();
    for (const district of view?.state.districts ?? []) for (const obj of district.objects) seen.set(obj.id, obj.level);
    if (surfaces.length) { patches = createPatches(surfaces); ctx.scene.add(patches); }
    if (catalogue && placements.length) pools = createInstancePools(ctx, catalogue, placements);
    ctx.requestShadowUpdate();
    recolour(); refreshSigns(); refreshBuild();
  }
  /** Where a building on the land stands: its frame over its cells, its front to a road beside it or where its owner turned it. */
  function objectFrame(block: LandBlock, obj: Pick<PublicObject, "u" | "v" | "w" | "h" | "rotation" | "family">): Frame {
    if (isPark(obj.family)) return areaFrame(block, obj.u!, obj.v!, obj.w, obj.h);
    const front = buildingFacing(grid, decor, block, obj.u!, obj.v!, obj.w, obj.h, obj.rotation);
    return areaFrame(block, obj.u!, obj.v!, obj.w, obj.h, front.side, front.street);
  }
  function layoutOf(district: DistrictEstate, obj: PublicObject, centre: DistrictCentre | undefined) {
    if (obj.module === null || obj.u === null || obj.v === null) return null;
    if (onSquare(obj)) return centre ? objectLayout(centre.square, { family: obj.family as ProjectFamily, level: obj.level, u: obj.u, v: obj.v, rotation: obj.rotation }) : null;
    const block = blockOf(district.number, obj.module);
    return block ? plotLayout(objectFrame(block, obj), obj.family as PlotFamily, obj.level, obj.id) : null;
  }
  /** Where a building stands: its frame (on the land) or the middle of its cells (on the square), with its size. */
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

  // ---- build mode: the picked plot, the preview, the selection, the chosen cells, the square's cells ----
  const lineMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffffff", transparent: true, opacity: .8, depthWrite: false });
  const cells = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial); cells.visible = false; cells.renderOrder = 3; cells.name = "district-project-grid";
  const ghostMaterial = new THREE.MeshBasicNodeMaterial({ color: OK, transparent: true, opacity: .4, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), ghostMaterial); ghost.visible = false; ghost.renderOrder = 4;
  const edgeMaterial = new THREE.LineBasicNodeMaterial({ color: OK, transparent: true, opacity: .95, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), edgeMaterial); ghost.add(edges);
  const selectMaterial = new THREE.LineBasicNodeMaterial({ color: "#ffd24a", transparent: true, depthWrite: false });
  const selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0)), selectMaterial); selection.visible = false;
  // The front of the plot picked: a flat arrow on the ground at the edge it will look out of.
  const frontMaterial = new THREE.MeshBasicNodeMaterial({ color: "#ffd24a", transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide });
  const front = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.7, 0, 0), new THREE.Vector3(.7, 0, 0), new THREE.Vector3(0, 0, .9)]), frontMaterial);
  front.visible = false; front.renderOrder = 5; front.name = "district-plot-front";
  // The cells chosen for small things, and the one under the mouse.
  const pickMaterial = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  let chosen: THREE.Mesh | null = null;
  ctx.scene.add(cells, ghost, selection, front);
  let pinned: { module: number; u: number; v: number } | null = null, reported = "";

  const box = (mesh: THREE.Object3D, place: { x: number; z: number; rotation: number; width: number; depth: number }, height: number, pad = 0) => {
    mesh.position.set(place.x, .21, place.z); mesh.rotation.set(0, place.rotation, 0); mesh.scale.set(place.width - pad, height, place.depth - pad); mesh.visible = true;
  };
  /** Why a building of w × h cells cannot stand there, as the server would say (city_estate.py free_cells), or null. */
  function plotProblem(block: LandBlock | undefined, col: number, row: number, w: number, h: number) {
    const wrong = w * h === 1 ? "Здесь нет свободной земли твоего района" : `Постройка не помещается: нужны свободные клетки ${w} × ${h} на земле района, в одной зоне`;
    if (!block || col < 0 || row < 0 || col + w > block.cols || row + h > block.rows) return wrong;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (block.skip.has(`${col + i}:${row + j}`)) return wrong;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (taken.has(decorKey(block.district, block.block, col + i, row + j))) return w * h === 1 ? "Эта клетка уже занята" : "Часть этих клеток уже занята";
    return null;
  }
  /** A footprint of w × h cells round the cell pointed at, moved into its block where it would stick out. */
  function anchorAt(block: LandBlock, col: number, row: number, w: number, h: number) {
    return { col: Math.max(0, Math.min(block.cols - w, col - Math.floor((w - 1) / 2))), row: Math.max(0, Math.min(block.rows - h, row - Math.floor((h - 1) / 2))) };
  }
  function showGhost(target: { module: number; u: number; v: number } | null) {
    if (!build?.placing || !target) { ghost.visible = false; return; }
    const { family, rotation } = build.placing, number = numberOf(build.district);
    let problem: string | null, place: { x: number; z: number; rotation: number; width: number; depth: number } | null = null, at = target;
    if (build.area === "public") {
      const centre = centreOf(build.district); if (!centre) { ghost.visible = false; return; }
      const [w, h] = projectFootprint(family as ProjectFamily, rotation);
      at = { module: 0, u: target.u - Math.floor((w - 1) / 2), v: target.v - Math.floor((h - 1) / 2) };
      const used = new Set<string>(), state = stateOf(build.district);
      for (const o of state?.objects ?? []) if (onSquare(o) && o.u !== null && o.v !== null) for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) used.add(`${o.u + i}:${o.v + j}`);
      for (const p of state?.projects ?? []) if (p.u !== null && p.v !== null) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) used.add(`${p.u + i}:${p.v + j}`);
      problem = state?.landmark?.status === "active" ? "Площадь занята комплексом команды. Он растёт, когда операторы застраивают район." : squareProblem({ family: family as ProjectFamily, u: at.u, v: at.v, rotation }, (u, v) => used.has(`${u}:${v}`));
      const p = cellPoint(centre.square, at.u + w / 2, at.v + h / 2);
      place = { ...p, rotation: centre.square.rotation, width: w * CELL, depth: h * CELL };
    } else {
      const [w, h] = plotFootprint(family as PlotFamily, rotation), block = blockOf(number, target.module);
      if (block) { const a = anchorAt(block, target.u, target.v, w, h); at = { module: target.module, u: a.col, v: a.row }; }
      problem = plotProblem(block, at.u, at.v, w, h);
      if (block) { const cols = Math.min(w, block.cols - at.u), rows = Math.min(h, block.rows - at.v); if (cols > 0 && rows > 0) place = areaFrame(block, at.u, at.v, cols, rows); }
    }
    if (!place) { ghost.visible = false; return; }
    box(ghost, place, build.area === "public" ? 1.1 : 1.6, .25);
    ghostMaterial.color.copy(problem ? BAD : OK); edgeMaterial.color.copy(problem ? BAD : OK);
    const key = `${build.district}:${at.module}:${at.u}:${at.v}:${rotation}:${problem}`;
    if (key !== reported) { reported = key; onPick({ kind: "place", district: build.district, module: at.module, u: at.u, v: at.v, rotation, problem }); }
  }
  function showSelection() {
    front.visible = false;
    const id = build?.selected, district = view?.state.districts.find(d => d.objects.some(o => o.id === id));
    const obj = district?.objects.find(o => o.id === id), place = district && obj ? placeOf(district, obj) : null;
    if (place) { box(selection, place, 1.6); return; }
    // The plot picked for a purchase, and where its front will look.
    const picked = build?.plot && blockOf(numberOf(build.district), build.plot.block);
    if (picked && build?.plot) {
      const facing = buildingFacing(grid, decor, picked, build.plot.col, build.plot.row, CELLS, CELLS, build.plot.rotation);
      const frame = areaFrame(picked, build.plot.col, build.plot.row, CELLS, CELLS, facing.side);
      box(selection, frame, 1.2, .2);
      front.position.set(frame.x + Math.sin(frame.rotation) * (frame.depth / 2 - .9), PICK_Y + .02, frame.z + Math.cos(frame.rotation) * (frame.depth / 2 - .9));
      front.rotation.set(0, frame.rotation, 0); front.visible = true;
    } else selection.visible = false;
  }
  /** The square's cells while staff place a shared project. */
  function refreshCells() {
    const points: number[] = [], y = .29, centre = build?.area === "public" && build.placing && stateOf(build.district)?.landmark?.status !== "active" ? centreOf(build.district) : undefined;
    if (centre) for (let k = 0; k <= MODULE_CELLS; k++) {
      for (const [a, b] of [[cellPoint(centre.square, k, 0), cellPoint(centre.square, k, MODULE_CELLS)], [cellPoint(centre.square, 0, k), cellPoint(centre.square, MODULE_CELLS, k)]]) points.push(a.x, y, a.z, b.x, y, b.z);
    }
    cells.geometry.dispose(); cells.geometry = new THREE.BufferGeometry(); cells.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    cells.visible = points.length > 0;
  }

  // ---- small things: the cells chosen, a stroke being drawn, the cell under the mouse ----
  let stroke: { from: CellRef; cells: CellRef[]; pointer: number; x: number; y: number; moved: boolean } | null = null, hoverCell: CellRef | null = null, last: CellRef | null = null, tool = "";
  const refOf = (a: PlotAddress): CellRef | null => { const block = build ? blockOf(numberOf(build.district), a.block) : undefined; return block ? { block, col: a.col, row: a.row } : null; };
  const keyOf = (c: CellRef) => decorKey(c.block.district, c.block.block, c.col, c.row);
  /** Can the current tool take this cell: a free cell of one's district to lay on, one's own small thing to take away. */
  function fits(c: CellRef) {
    if (!build?.decor || c.block.district !== numberOf(build.district) || c.block.skip.has(`${c.col}:${c.row}`)) return false;
    return build.decor.tool === "remove" ? (build.decor.anyone ? decor.has(keyOf(c)) : !!decor.get(keyOf(c))?.mine) : !taken.has(keyOf(c));
  }
  function showChosen() {
    if (chosen) { ctx.scene.remove(chosen); chosen.geometry.dispose(); chosen = null; }
    if (!build?.decor || !active) return;
    const colour = build.decor.tool === "remove" ? TAKE : OK, quads: { points: { x: number; z: number }[]; y: number; colour: THREE.Color }[] = [];
    const list = [...build.decor.cells.map(refOf).filter((c): c is CellRef => !!c), ...(stroke?.cells ?? [])];
    const done = new Set<string>();
    for (const c of list) {
      const key = keyOf(c);
      if (done.has(key)) continue;
      done.add(key);
      quads.push({ points: inset(areaCorners(c.block, c.col, c.row), .18), y: PICK_Y, colour: fits(c) ? colour : BAD });
    }
    if (hoverCell && !done.has(keyOf(hoverCell))) quads.push({ points: inset(areaCorners(hoverCell.block, hoverCell.col, hoverCell.row), .3), y: PICK_Y, colour: fits(hoverCell) ? colour : BAD });
    if (!quads.length) return;
    chosen = flatMesh(quads, pickMaterial, "district-chosen-cells"); chosen.renderOrder = 4;
    ctx.scene.add(chosen);
  }
  /** Reports the cells chosen now: the ones chosen before with `add` added (or, for a tap on one of them, taken out). */
  function choose(add: CellRef[], toggle: boolean) {
    if (!build?.decor) return;
    const now = build.decor.cells.map(refOf).filter((c): c is CellRef => !!c), keys = new Set(now.map(keyOf));
    let next = now;
    if (toggle && add.length === 1 && keys.has(keyOf(add[0]))) next = now.filter(c => keyOf(c) !== keyOf(add[0]));
    else for (const c of add) if (fits(c) && !keys.has(keyOf(c))) { next = [...next, c]; keys.add(keyOf(c)); }
    if (add.length) last = add[add.length - 1];
    onPick({ kind: "cells", district: build.district, cells: next.map(c => ({ block: c.block.block, col: c.col, row: c.row })) });
  }
  /** A cell of the own district under a point (for sale or not), or null. */
  function ownCellAt(p: { x: number; z: number }): CellRef | null {
    if (!build) return null;
    const at = cellUnder(grid, p);
    return at && at.block.district === numberOf(build.district) && !at.skipped ? { block: at.block, col: at.col, row: at.row } : null;
  }

  function refreshBuild() {
    if (!active) { cells.visible = ghost.visible = selection.visible = front.visible = false; showChosen(); return; }
    const nextTool = build?.decor ? `${build.district}:${build.decor.tool}` : "";
    if (nextTool !== tool) { tool = nextTool; last = null; stroke = null; }
    refreshCells(); showSelection(); reported = ""; showGhost(pinned); showChosen();
  }

  // ---- the community square and projects still collecting ----
  const layer = document.createElement("div"); layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Районы команд");
  ctx.overlay.append(layer);
  const signs = new Map<string, { el: HTMLButtonElement; point: THREE.Vector3; reach: number; transform: string }>();
  function sign(id: string, icon: string, title: string, sub: string, point: THREE.Vector3, pick: EstatePick, reach = SIGN_REACH) {
    let item = signs.get(id);
    if (!item) {
      const el = document.createElement("button"); el.type = "button"; el.className = "c3-site c3-estate-sign";
      el.innerHTML = `<span aria-hidden="true"></span><span><strong></strong><small></small></span>`;
      layer.append(el); item = { el, point: point.clone(), reach, transform: "" }; signs.set(id, item);
    }
    item.point.copy(point); item.reach = reach;
    item.el.querySelector("span")!.textContent = icon; item.el.querySelector("strong")!.textContent = title; item.el.querySelector("small")!.textContent = sub;
    item.el.setAttribute("aria-label", `${title}. ${sub}`);
    item.el.onclick = () => onPick(pick);
  }
  function refreshSigns() {
    const live = new Set<string>();
    for (const district of view?.state.districts ?? []) {
      const centre = centreOf(district.id); if (!centre) continue;
      const id = `public-${district.id}`; live.add(id);
      const landmark = district.landmark, main = landmarkFrame(district);
      if (main && landmark) {
        const mainId = landmark.status === "active" ? id : `main-${district.id}`; live.add(mainId);
        const y = .5 + landmarkHeight(landmark.level, main.width, main.depth);
        sign(mainId, "▥", `Главное здание · ${district.name ?? district.id}`, `Уровень ${landmark.level} из 5 · развитие`, new THREE.Vector3(main.x, y, main.z), { kind: "public", district: district.id }, SQUARE_SIGN_REACH);
        signs.get(mainId)!.el.setAttribute("aria-label", `Главное здание района ${district.name ?? district.id}. Уровень ${landmark.level} из 5. Открыть развитие`);
      }
      if (landmark?.status !== "active") {
        sign(id, "♧", "Площадь команды", "Общие проекты · открыть", new THREE.Vector3(centre.square.x, .5, centre.square.z), { kind: "public", district: district.id }, SQUARE_SIGN_REACH);
        signs.get(id)!.el.setAttribute("aria-label", `Площадь команды района ${district.name ?? district.id}. Открыть общие проекты`);
      }
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
    for (const [id, item] of signs) {
      scratch.copy(item.point).applyMatrix4(ctx.camera.matrixWorldInverse);
      const depth = -scratch.z; scratch.applyMatrix4(ctx.camera.projectionMatrix);
      const hidden = ((id.startsWith("public-") || id.startsWith("main-")) && (!!build?.placing || !!build?.decor)) || depth < ctx.camera.near || ctx.camera.position.distanceTo(item.point) > item.reach || Math.abs(scratch.x) > 1.1 || Math.abs(scratch.y) > 1.1;
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

  // ---- pointer: a tap picks a plot or a building, or pins the preview; the mouse moves the preview or draws a line of cells ----
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
  /** Tall facades project beyond their cells on the ground, so select their actual volume first. */
  function buildingAtRay(ray: THREE.Ray) {
    let nearest: EstatePick | null = null, distance = Infinity;
    const local = new THREE.Ray(), at = new THREE.Vector3();
    for (const body of houseBodies) {
      if (!local.copy(ray).applyMatrix4(body.inverse).intersectBox(body.bounds, at)) continue;
      const reach = at.applyMatrix4(body.matrix).distanceTo(ray.origin);
      if (reach < distance) { distance = reach; nearest = body.pick; }
    }
    for (const district of view?.state.districts ?? []) {
      const landmark = district.landmark, landmarkPlace = landmarkFrame(district);
      if (landmarkPlace && landmark) {
        const at = landmarkRayDistance(landmarkPlace, landmark.level, ray.origin, ray.direction);
        if (at !== null && at < distance) { distance = at; nearest = { kind: "public", district: district.id }; }
      }
      for (const obj of district.objects) {
        if (!isOfficeBuilding(obj.family)) continue;
        const frame = placeOf(district, obj);
        if (!frame) continue;
        const at = officeBuildingRayDistance(obj.family, frame, ray.origin, ray.direction);
        if (at !== null && at < distance) { distance = at; nearest = { kind: "object", district: district.id, object: obj.id }; }
      }
    }
    return nearest;
  }
  /** The square's cell under a point, for the square of `district`. */
  function squareCellAt(district: string, p: { x: number; z: number }) {
    const centre = centreOf(district); if (!centre) return null;
    const c = pointCell(centre.square, p);
    return c.u >= 0 && c.v >= 0 && c.u < MODULE_CELLS && c.v < MODULE_CELLS ? { module: 0, u: Math.floor(c.u), v: Math.floor(c.v) } : null;
  }
  /** What stands at a point: a building on the land or on a district's square. */
  function objectAt(p: { x: number; z: number }) {
    for (const district of view?.state.districts ?? []) {
      const cell = squareCellAt(district.id, p);
      for (const o of district.objects) {
        if (o.module === null || o.u === null || o.v === null) continue;
        if (onSquare(o)) { if (cell && cell.u >= o.u && cell.u < o.u + o.w && cell.v >= o.v && cell.v < o.v + o.h) return { district, obj: o }; continue; }
        const block = blockOf(district.number, o.module), at = block && blockCell(block, p);
        if (at && at.u >= o.u && at.u < o.u + o.w && at.v >= o.v && at.v < o.v + o.h) return { district, obj: o };
      }
    }
    return null;
  }
  /** Where the preview goes for a point: a cell of the square (staff) or of the district's own blocks, for sale or not, so it can say why. */
  function previewAt(p: { x: number; z: number }) {
    if (!build) return null;
    if (build.area === "public") return squareCellAt(build.district, p);
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
    if (build?.decor) {
      const at = ownCellAt(p);
      if (!at) return;
      // A tap: one cell, or with lines on, every cell from the last one to it.
      choose(build.decor.line && last && last.block.district === at.block.district ? cellsBetween(grid, last, at) : [at], !(build.decor.line && last));
      return;
    }
    const found = objectAt(p);
    if (found) { onPick({ kind: "object", district: found.district.id, object: found.obj.id }); return; }
    for (const district of view?.state.districts ?? []) {
      const main = landmarkFrame(district);
      if (main) {
        const dx = p.x - main.x, dz = p.z - main.z, c = Math.cos(main.rotation), s = Math.sin(main.rotation);
        if (Math.abs(dx * c - dz * s) <= main.width / 2 && Math.abs(dx * s + dz * c) <= main.depth / 2) {
          onPick({ kind: "public", district: district.id }); return;
        }
      }
      const cell = squareCellAt(district.id, p); if (!cell) continue;
      const project = district.projects.find(o => o.u !== null && o.v !== null && cell.u >= o.u && cell.u < o.u + o.w && cell.v >= o.v && cell.v < o.v + o.h);
      onPick(project ? { kind: "project", district: district.id, project: project.id } : { kind: "public", district: district.id });
      return;
    }
    if (build?.area !== "plots") return;
    const at = cellUnder(grid, p);
    if (!at || at.block.district !== numberOf(build.district)) return;
    // The plot of 3 × 3 cells round the cell tapped, kept inside its block.
    const a = anchorAt(at.block, at.col, at.row, CELLS, CELLS);
    onPick({ kind: "plot", district: build.district, block: at.block.block, col: a.col, row: a.row, band: at.block.band, problem: plotProblem(at.block, a.col, a.row, CELLS, CELLS) });
  }
  let down: { x: number; y: number; time: number } | null = null, pressed = 0, frame = 0, hover: { x: number; y: number } | null = null;
  /** With a small thing's tool, the mouse's left button draws: the camera keeps the right button, the wheel and the keys. */
  const onPress = (event: PointerEvent) => {
    if (!build?.decor || !active || event.pointerType !== "mouse" || event.button !== 0) return;
    const p = groundAt(event.clientX, event.clientY), at = p && ownCellAt(p);
    if (!at) return;
    event.stopImmediatePropagation(); event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer. */ }
    stroke = { from: at, cells: [at], pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    showChosen();
  };
  const onDown = (event: PointerEvent) => { if (event.isPrimary) { pressed = 1; down = { x: event.clientX, y: event.clientY, time: performance.now() }; } else { pressed++; down = null; } };
  const onUp = (event: PointerEvent) => {
    if (stroke && event.pointerId === stroke.pointer) {
      const done = stroke; stroke = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
      // A drag lays its whole line; a click is a tap, one cell or a line from the last one.
      if (done.moved) choose(done.cells, false);
      else { const p = groundAt(event.clientX, event.clientY); if (p) pick(p); else showChosen(); }
      return;
    }
    pressed = Math.max(0, pressed - 1);
    const tap = down && pressed === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && performance.now() - down.time < TAP_TIME;
    if (pressed === 0) down = null;
    if (!tap || !active) return;
    const ray = rayAt(event.clientX, event.clientY);
    if (!ray) return;
    if (!build?.placing && !build?.decor) {
      const found = buildingAtRay(ray);
      if (found) { onPick(found); return; }
    }
    if (ray.intersectPlane(plane, hit)) pick({ x: hit.x, z: hit.z });
  };
  const onMove = (event: PointerEvent) => {
    if (stroke && event.pointerId === stroke.pointer) {
      if (Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) >= TAP_DISTANCE) stroke.moved = true;
      const p = groundAt(event.clientX, event.clientY), at = p && ownCellAt(p);
      if (at) { stroke.cells = cellsBetween(grid, stroke.from, at); showChosen(); }
      return;
    }
    if ((!build?.placing && !build?.decor) || event.pointerType !== "mouse" || event.buttons || !active) return;
    hover = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!hover) return;
      const p = groundAt(hover.x, hover.y);
      if (build?.placing) { const target = p && previewAt(p); if (target) { pinned = target; showGhost(target); } return; }
      if (build?.decor) {
        const at = p ? ownCellAt(p) : null;
        if ((at && hoverCell && keyOf(at) === keyOf(hoverCell)) || (!at && !hoverCell)) return;
        hoverCell = at; showChosen();
      }
    });
  };
  const onLeave = () => { if (hoverCell) { hoverCell = null; showChosen(); } };
  canvas.addEventListener("pointerdown", onPress, { capture: true });
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave);

  /** The centres: the garden round the main building, or an old public square still holding its projects beside it. */
  function rebuildSquares() {
    const key = JSON.stringify(grid.centres.map(c => [c.district, view?.state.districts.find(d => d.number === c.district)?.landmark?.status]));
    if (key === squareKey && (squarePools || !catalogue)) return;
    squareKey = key;
    squarePools?.dispose(); squarePools = null;
    squareLights?.dispose(); squareLights = null;
    if (squarePatches) { ctx.scene.remove(squarePatches); squarePatches.geometry.dispose(); (squarePatches.material as THREE.Material).dispose(); squarePatches = null; }
    const placements: Placement[] = [], surfaces: Surface[] = [], lamps: Placement[] = [];
    grid.centres.forEach((c, i) => {
      if (view?.state.districts.find(d => d.number === c.district)?.landmark?.status === "legacy_occupied") {
        const old = moduleGround(c.square);
        placements.push(...old.placements); surfaces.push(...old.surfaces);
        return;
      }
      placements.push(...gardens[i].placements); lamps.push(...gardens[i].lamps);
    });
    if (surfaces.length) { squarePatches = createPatches(surfaces); ctx.scene.add(squarePatches); }
    if (catalogue) squarePools = createInstancePools(ctx, catalogue, placements);
    if (lamps.length) squareLights = createLampLights(ctx, lamps, "district-lamp-garden");
  }

  recolour();
  return {
    set(next) {
      // The other land on the same ground (the administrators' test city, or back from it) is a first look: nothing rises.
      if (!!next?.state.sandbox !== !!view?.state.sandbox) seen.clear();
      view = next; rebuild();
    },
    setCatalogue(value) { catalogue = value; squareKey = ""; builtKey = ""; rebuild(); },
    setBuild(next) {
      const same = build && next && build.district === next.district && build.area === next.area && build.placing?.family === next.placing?.family && build.placing?.moving === next.placing?.moving;
      build = next; if (!same) pinned = null;
      if (!next?.decor) hoverCell = null;
      recolour(); refreshBuild(); place();
    },
    setActive(value) {
      active = value; layer.hidden = !value;
      recolour(); refreshBuild(); place();
      if (!value) for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
    },
    focus(target) {
      const number = numberOf(target.district), centre = centreOf(target.district);
      let place: { x: number; z: number; rotation: number } | null = null, y = 1, bounds: THREE.Box3 | undefined;
      if (target.kind === "plot" && target.plot) { const block = blockOf(number, target.plot.block); if (block) place = areaFrame(block, target.plot.col, target.plot.row, CELLS, CELLS); }
      else if (target.kind === "object") {
        const district = stateOf(target.district), obj = district?.objects.find(o => o.id === target.object);
        if (district && obj) {
          const frame = placeOf(district, obj);
          place = frame;
          if (frame && isOfficeBuilding(obj.family)) { const bounds = officeBuildingBounds(obj.family, frame); place = bounds; y = .2 + bounds.height / 2; }
        }
      } else if (target.kind === "public" && centre) {
        place = { ...centre.square };
        const district = stateOf(target.district), frame = district && landmarkFrame(district);
        if (frame && district?.landmark) { const bounds = landmarkBounds(frame, district.landmark.level); place = bounds; y = bounds.bottom + bounds.height / 2; }
      }
      else if (target.kind === "district" && build?.area === "plots" && build.district === target.district) {
        const own = grid.blocks.filter(b => b.district === number);
        if (own.length) {
          bounds = new THREE.Box3();
          // A ring block bulges past its corners: every column's edge at its inner and outer radius, where the cells reach farthest.
          for (const block of own) for (let c = 0; c < (block.shape.kind === "ring" ? block.cols : 1); c++) {
            const span = block.shape.kind === "ring" ? 1 : block.cols;
            for (const corner of areaCorners(block, c, 0, span, block.rows)) bounds.expandByPoint(new THREE.Vector3(corner.x, PLOT_Y, corner.z));
          }
          const middle = bounds.getCenter(new THREE.Vector3()), first = own[0];
          place = { x: middle.x, z: middle.z, rotation: centre?.area.rotation ?? areaFrame(first, 0, 0, 1, 1, homeSide(first, 0, 0)).rotation }; y = middle.y;
        }
      }
      if (!place && centre) place = { x: centre.area.x, z: centre.area.z, rotation: centre.area.rotation };
      if (!place) return null;
      // From the side in front of it, a little to the side, so its front and the cells beside it show.
      return { point: new THREE.Vector3(place.x, y, place.z), azimuth: place.rotation + .55, ...(bounds ? { bounds } : {}) };
    },
    dispose() {
      offFrame(); offMove(); if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onPress, { capture: true });
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave);
      layer.remove(); squarePools?.dispose(); squareLights?.dispose(); pools?.dispose(); lights?.dispose();
      for (const mesh of [ground.mesh, ground.centreMesh, ground.seamMesh, squarePatches, patches]) if (mesh) { ctx.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      if (paving) { ctx.scene.remove(paving); paving.geometry.dispose(); }
      if (chosen) { ctx.scene.remove(chosen); chosen.geometry.dispose(); }
      ctx.scene.remove(borders.band, borders.posts); borders.dispose();
      for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
      ctx.scene.remove(cells, ghost, selection, front);
      cells.geometry.dispose(); ghost.geometry.dispose(); edges.geometry.dispose(); selection.geometry.dispose(); front.geometry.dispose();
      [lineMaterial, ghostMaterial, edgeMaterial, selectMaterial, veilMaterial, frontMaterial, pickMaterial, pavingMaterial].forEach(m => m.dispose());
    },
  };
}
