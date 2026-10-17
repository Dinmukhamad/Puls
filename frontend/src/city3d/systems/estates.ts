/**
 * Team district land in one city (docs/CITY_ESTATES.md): the small cells of its three districts (world/land.ts),
 * every district's centre with its main building, and what the server reports standing on them: buildings on cells
 * of their own size (a house 3 × 3, a square or an office 2 × 2, parks 4 × 4 and 6 × 4), and the small things
 * operators lay a cell at a time, roads, footpaths, alleys, hedges, trees, lamps, benches, bushes and flowerbeds
 * (world/decor.ts). Normal exploration shows the land as it is built. Only in build mode does the operator's own grid
 * of cells appear, thin white lines between them, free cells lit grass and taken ones grey. There the cells are chosen
 * first: a tap chooses one cell (yellow) or opens a building, a drag of the mouse's left button chooses a line of
 * cells, Ctrl (Cmd) with either button adds an area and a click with it a cell in or out; on a phone taps go by the
 * shape the page asks for. What the shop chose for them shows on them: a building's cells round the one cell, a small
 * thing on the cells of the line it goes on, green where free and red where not. A building from the inventory follows
 * the pointer the same way. Staff place a shared project on the cells of an old public square. Buildings and small things go through instance pools of their own, so a purchase
 * rebuilds only these copies, not the city; the server checks everything again.
 */
import * as THREE from "three/webgpu";
import { attribute, color, fwidth, max, min, mix, saturate, smoothstep, vec2, vertexColor } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { createLampLights, type LampLights } from "../render/lampLights";
import { TAP_DISTANCE, TAP_TIME } from "../engine/input";
import { CELL, MODULE_CELLS, cellPoint, footprintAt, itemFootprint, moduleGround, objectLayout, pointCell, siteLayout, squareProblem, plotFootprint, projectFootprint, type ProjectFamily } from "../world/estates";
import { WAYS, areaCorners, areaFrame, areaPoint, areaSpan, blockCell, cellUnder, cellsBetween, cellsWithin, districtBorders, homeSide, sideOf, type CellRef, type DistrictCentre, type Frame, type LandBlock, type LandGrid, type Way } from "../world/land";
import { buildingFacing, decorKey, decorLayout, decorMap, decorSide, edgeToward, isTurning, type DecorMap, type GroundQuad } from "../world/decor";
import { createBorders } from "../render/borders";
import { plotLayout } from "../world/landLayouts";
import { districtColour, isDecorFamily, type DecorFamily, type PlotFamily } from "../world/estateGrid";
import { HOUSE_SCALE, READY_HOUSES, isReadyHouse } from "../world/familyHouses";
import { OFFICE_BUILDINGS, isOfficeBuilding, officeBuildingScale, officeBuildingBounds, officeBuildingRayDistance } from "../world/officeBuildings";
import { districtMainFrame, districtMainLayout, landmarkHeight, landmarkBounds, landmarkRayDistance } from "../world/districtLandmark";
import { districtGarden, type Garden } from "../world/districtGarden";
import type { Placement, Surface } from "../world/types";
import type { CellState, ChosenCell, CityBuildView, CityEstateView, EstatePick, EstateTarget, PlotAddress } from "../types";
import type { DistrictEstate, PublicObject } from "../../api/cityEstate";
import { plural } from "../../utils/format";

/** Signs over projects show only this close. */
const SIGN_REACH = 230;
/** The square's invitation belongs to a close district view, rather than the whole-city skyline. */
const SQUARE_SIGN_REACH = 85;
const OK = new THREE.Color("#35b07a"), BAD = new THREE.Color("#e0525d"), TAKE = new THREE.Color("#f0a23a"), PICKED = new THREE.Color("#ffd24a");
/** In build mode: a free cell (grass, lit up a little), a taken one (grey). */
const FOR_SALE = new THREE.Color("#a6d47a"), TAKEN = new THREE.Color("#a3a8a0");
/** The lines between the cells: white, this much of a cell's side on each side of a line. */
const LINE = new THREE.Color("#ffffff"), LINE_WIDTH = .02;
/**
 * The grid over the land in build mode: above the ground patches of what stands on it (render/terrain.ts TOP and its
 * lifts, a building's yard up to .024 over it), so a building's cells read grey, and under its pieces. Cells under a
 * road or a footpath are left out, their paving showing instead.
 */
const PLOT_Y = .23, INSET = .1;
const PAVED: readonly DecorFamily[] = ["road", "path", "alley"];
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
const cellsWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? "клетка" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "клетки" : "клеток";
/** The cell under the mouse while choosing where to build. */
const HOVER = new THREE.Color("#fff3b0");

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
 * The grid's material: unlit and out of the shadows, so nothing on it shimmers as the camera or the sun moves. Each
 * cell shows its own colour with a thin white line along its edges (its neighbour draws the other half). The lines
 * are antialiased by how wide a cell is on the screen, and where cells shrink to a few pixels in the distance they
 * fade into their average, without a moiré.
 */
function gridMaterial() {
  // In a whole-district view the small lift loses depth precision against the ground under it: bias the grid toward
  // the camera while keeping ordinary building occlusion. A cell whose colour has no alpha (a paved one) is not drawn.
  const material = new THREE.MeshBasicNodeMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: .5 });
  const at = attribute("cellUv", "vec2"), edge = min(at, at.oneMinus()), deriv = fwidth(at), width = vec2(LINE_WIDTH, LINE_WIDTH);
  const draw = max(width, deriv), soft = deriv.mul(1.5);
  const sharp = smoothstep(draw.sub(soft), draw.add(soft), edge).oneMinus().mul(saturate(width.div(draw)));
  const lines = mix(sharp, width.mul(2), saturate(deriv.mul(2).sub(1)));
  material.colorNode = mix(vertexColor().xyz, color(LINE), max(lines.x, lines.y));
  material.opacityNode = vertexColor().w;
  return material;
}

/**
 * Pooled meshes: the permanent ground of the centres' gardens (world/districtGarden.ts), and the own district's grid of
 * cells, visible only in build mode.
 */
function plotGround(grid: LandGrid, gardens: readonly Garden[]) {
  const slots = new Map<string, number>(), indices = new Map<number, number[]>();
  const plots = { positions: [] as number[], colours: [] as number[], uvs: [] as number[], index: [] as number[] };
  const paving = { positions: [] as number[], colours: [] as number[], uvs: [] as number[], index: [] as number[] };
  const quad = (parts: typeof plots, corners: { x: number; z: number }[], colour: THREE.Color) => {
    const base = parts.positions.length / 3, [a, b, c] = corners;
    for (const p of corners) { parts.positions.push(p.x, PLOT_Y, p.z); parts.colours.push(colour.r, colour.g, colour.b, 1); }
    // The cell's own coordinates at its corners (world/land.ts areaCorners order), for its lines.
    parts.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    // Facing up whichever way round the corners go.
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    parts.index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    return base;
  };
  const colour = new THREE.Color();
  for (const garden of gardens) for (const q of garden.ground) quad(paving, q.points, colour.set(q.colour));
  for (const block of grid.blocks) for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) {
    if (block.skip.has(`${c}:${r}`)) continue;
    slots.set(decorKey(block.district, block.block, c, r), quad(plots, areaCorners(block, c, r), FOR_SALE));
    const own = indices.get(block.district) ?? [];
    own.push(...plots.index.slice(-6)); indices.set(block.district, own);
  }
  const geometryOf = (parts: typeof plots) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(parts.positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(parts.colours, 4));
    geometry.setAttribute("cellUv", new THREE.Float32BufferAttribute(parts.uvs, 2));
    geometry.setIndex(parts.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(parts.index, 1) : new THREE.Uint16BufferAttribute(parts.index, 1));
    return geometry;
  };
  // Keep one index buffer for the lifetime of the scene. A draw range selects the own district without
  // creating or replacing GPU buffers whenever the dock opens, closes or changes district.
  const ranges = new Map<number, { start: number; count: number }>();
  plots.index = [];
  for (const [district, own] of indices) { ranges.set(district, { start: plots.index.length, count: own.length }); plots.index.push(...own); }
  const mesh = new THREE.Mesh(geometryOf(plots), gridMaterial());
  mesh.matrixAutoUpdate = false; mesh.name = "district-plots"; mesh.visible = false;
  // The gardens' paving is ground like the rest of the land: lit, and in the shadows of what stands on it.
  const centreMesh = new THREE.Mesh(geometryOf(paving), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .85, metalness: .02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  centreMesh.receiveShadow = true; centreMesh.matrixAutoUpdate = false; centreMesh.name = "district-centres";
  return { mesh, centreMesh, slots, show(district: number) {
    const range = ranges.get(district);
    mesh.visible = !!range;
    mesh.geometry.setDrawRange(range?.start ?? 0, range?.count ?? 0);
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
  const ground = plotGround(grid, gardens); ctx.scene.add(ground.mesh, ground.centreMesh);
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
  /** The own district's grid appears only while choosing land: free cells and taken ones; a paved cell shows its paving. */
  function recolour() {
    const colour = ground.mesh.geometry.getAttribute("color") as THREE.BufferAttribute, c = new THREE.Color();
    const own = build?.area === "plots" ? numberOf(build.district) : 0;
    ground.show(active ? own : 0);
    if (!own || !active) return;
    for (const block of grid.blocks) if (block.district === own) for (let col = 0; col < block.cols; col++) for (let row = 0; row < block.rows; row++) {
      const key = decorKey(block.district, block.block, col, row), slot = ground.slots.get(key);
      if (slot === undefined) continue;
      const paved = PAVED.includes(decor.get(key)?.family as DecorFamily);
      c.copy(taken.has(key) ? TAKEN : FOR_SALE);
      for (let k = 0; k < 4; k++) colour.setXYZW(slot + k, c.r, c.g, c.b, paved ? 0 : 1);
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
  // The cells chosen for small things, and the one under the mouse; on the chosen lamps and benches of one's own, an
  // arrow to the side of the cell each stands at or looks to.
  const pickMaterial = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  // Pulled further towards the camera than the chosen cells, so the grid under them never covers an arrow.
  const turnMaterial = new THREE.MeshBasicNodeMaterial({ color: "#ffd24a", transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  let chosen: THREE.Mesh | null = null, turns: THREE.Mesh | null = null;
  ctx.scene.add(cells, ghost, selection, front);
  let pinned: { module: number; u: number; v: number } | null = null, reported = "";

  const box = (mesh: THREE.Object3D, place: { x: number; z: number; rotation: number; width: number; depth: number }, height: number, pad = 0) => {
    mesh.position.set(place.x, .21, place.z); mesh.rotation.set(0, place.rotation, 0); mesh.scale.set(place.width - pad, height, place.depth - pad); mesh.visible = true;
  };
  /** Why a cell cannot be built on, as the server would say (city_estate.py free_cells): it is not the district's land, or it is taken. */
  function cellProblem(block: LandBlock | undefined, col: number, row: number): "land" | "taken" | null {
    if (!block || col < 0 || row < 0 || col >= block.cols || row >= block.rows || block.skip.has(`${col}:${row}`)) return "land";
    return taken.has(decorKey(block.district, block.block, col, row)) ? "taken" : null;
  }
  /** Why something of w × h cells cannot stand at (col, row), for the operator, or null. */
  function plotProblem(block: LandBlock | undefined, col: number, row: number, w: number, h: number) {
    let land = false, busy = 0;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) { const why = cellProblem(block, col + i, row + j); if (why === "land") land = true; else if (why) busy++; }
    if (w * h === 1) return land ? "Здесь нет свободной земли твоего района" : busy ? "Эта клетка уже занята" : null;
    if (land) return `Не помещается: нужно ${w} × ${h} свободных клеток на земле района, в одной зоне. Красные клетки — за её краем или заняты.`;
    return busy ? `Не помещается: ${busy} ${cellsWord(busy)} из ${w * h} заняты — они красные на карте.` : null;
  }
  /** Something of w × h cells for the cell picked: the free place covering it nearest its middle, else the place round it with its blocked cells. */
  function placeFor(block: LandBlock, col: number, row: number, w: number, h: number) {
    const at = footprintAt(col, row, w, h, block.cols, block.rows, (c, r) => cellProblem(block, c, r));
    return { block, col: at.col, row: at.row, w, h, blocked: at.blocked, problem: at.fits ? null : plotProblem(block, at.col, at.row, w, h) };
  }
  type Place = ReturnType<typeof placeFor>;
  /** A building chosen for the one cell chosen: its cells round the cell, where they fit best. */
  function plotPlace(): (Place & { cell: { col: number; row: number }; family: PlotFamily }) | null {
    const choice = build?.area === "plots" && !build.placing ? build.choice : null;
    const family = choice?.family && !isDecorFamily(choice.family) ? choice.family : null, cell = choice?.cells.length === 1 ? choice.cells[0] : null;
    const block = cell ? blockOf(numberOf(build!.district), cell.block) : undefined;
    if (!choice || !family || !cell || !block) return null;
    const [w, h] = itemFootprint(family, choice.rotation);
    return { ...placeFor(block, cell.col, cell.row, w, h), cell: { col: cell.col, row: cell.row }, family };
  }
  /** The inventory's building following the pointer, its cells on the land. */
  let ghostPlace: Place | null = null;
  /** Tells the page where the building chosen for the cell goes and why it does not fit, once per change. */
  let reportedPlot = "";
  function reportPlot() {
    const place = plotPlace(), choice = build?.choice;
    if (!place || !choice || !build) return;
    const key = `${build.district}:${place.block.block}:${place.cell.col}:${place.cell.row}:${place.family}:${choice.rotation}:${place.col}:${place.row}:${place.problem}`;
    if (key === reportedPlot) return;
    reportedPlot = key;
    onPick({ kind: "footprint", district: build.district, cell: { block: place.block.block, col: place.cell.col, row: place.cell.row }, family: place.family, col: place.col, row: place.row, rotation: choice.rotation, problem: place.problem });
  }
  function showGhost(target: { module: number; u: number; v: number } | null, draw = true) {
    ghostPlace = null;
    if (!build?.placing || !target) { ghost.visible = false; if (draw) showCells(); return; }
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
      // The free place covering the cell pointed at, nearest its middle; or the place round it, its blocked cells red.
      const [w, h] = plotFootprint(family as PlotFamily, rotation), block = blockOf(number, target.module);
      if (block) { ghostPlace = placeFor(block, target.u, target.v, w, h); at = { module: target.module, u: ghostPlace.col, v: ghostPlace.row }; }
      problem = ghostPlace ? ghostPlace.problem : plotProblem(block, at.u, at.v, w, h);
      if (block) { const cols = Math.min(w, block.cols - at.u), rows = Math.min(h, block.rows - at.v); if (cols > 0 && rows > 0) place = areaFrame(block, at.u, at.v, cols, rows); }
    }
    if (draw) showCells();
    if (!place) { ghost.visible = false; return; }
    box(ghost, place, build.area === "public" ? 1.1 : 1.6, .25);
    ghostMaterial.color.copy(problem ? BAD : OK); edgeMaterial.color.copy(problem ? BAD : OK);
    const key = `${build.district}:${at.module}:${at.u}:${at.v}:${rotation}:${problem}`;
    if (key !== reported) { reported = key; onPick({ kind: "place", district: build.district, module: at.module, u: at.u, v: at.v, rotation, problem }); }
  }
  function showSelection() {
    front.visible = false; selection.visible = false;
    const id = build?.selected, district = view?.state.districts.find(d => d.objects.some(o => o.id === id));
    const obj = district?.objects.find(o => o.id === id), place = district && obj ? placeOf(district, obj) : null;
    if (place) { box(selection, place, 1.6); return; }
    // A building chosen for the cell: where its front will look, on its cells.
    const picked = plotPlace();
    if (!picked || isPark(picked.family) || picked.family === "square") return;
    const facing = buildingFacing(grid, decor, picked.block, picked.col, picked.row, picked.w, picked.h, build!.choice!.rotation);
    const frame = areaFrame(picked.block, picked.col, picked.row, picked.w, picked.h, facing.side);
    front.position.set(frame.x + Math.sin(frame.rotation) * (frame.depth / 2 - .9), PICK_Y + .02, frame.z + Math.cos(frame.rotation) * (frame.depth / 2 - .9));
    front.rotation.set(0, frame.rotation, 0); front.visible = true;
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

  // ---- the cells chosen: a stroke being drawn (a line or an area), the cell under the mouse, where taps go on from ----
  /**
   * A stroke being drawn: an `area` or a line; `add`: after the cells chosen (Ctrl, Cmd or Shift held), when a click
   * without moving takes a cell in or out.
   */
  let stroke: { from: CellRef; cells: CellRef[]; pointer: number; x: number; y: number; moved: boolean; area: boolean; add: boolean } | null = null;
  /** `last`: where the next tap's line or area goes on from (the last cell added, or an area's first corner). */
  let hoverCell: CellRef | null = null, last: CellRef | null = null, lineDistrict = "";
  /** The cells just reported, shown until the page sends them back (so a drag's line does not flicker). */
  let reportedList: CellRef[] | null = null, reportedCells = "";
  const refOf = (a: PlotAddress): CellRef | null => { const block = build ? blockOf(numberOf(build.district), a.block) : undefined; return block ? { block, col: a.col, row: a.row } : null; };
  const keyOf = (c: CellRef) => decorKey(c.block.district, c.block.block, c.col, c.row);
  const chosenNow = () => reportedList ?? (build?.choice?.cells ?? []).map(refOf).filter((c): c is CellRef => !!c);
  /** A cell of the own district for sale: one that can be chosen. */
  const forSale = (c: CellRef) => !!build && c.block.district === numberOf(build.district) && !c.block.skip.has(`${c.col}:${c.row}`);
  /** What stands on a cell for the one choosing: free land, a small thing they may take away (in the test city anyone's), or something else. */
  function stateAt(c: CellRef): CellState {
    const key = keyOf(c), there = decor.get(key);
    if (there && (view?.state.sandbox || there.mine)) return "own";
    return taken.has(key) ? "taken" : "free";
  }
  const chosenCell = (c: CellRef): ChosenCell => ({ block: c.block.block, col: c.col, row: c.row, band: c.block.band, state: stateAt(c) });
  /** How taps choose cells, as the page asks. */
  const shape = () => build?.choice?.shape ?? "cell";
  /** Taps go on from the last cell: a line from it, or an area to the corner waiting. */
  const goingOn = () => !!(build?.area === "plots" && !build.placing && shape() !== "cell" && last);
  /**
   * The cells the operator works with over the grid. The cells chosen, yellow (a small thing of one's own on them
   * orange, something else red); with a small thing chosen for them, green on the cells it goes on where free and red
   * where taken; with a building chosen for the one cell, its cells round it, green where free and red where not. The
   * corner an area waits on, the cell under the mouse; the inventory's building's cells under the pointer.
   */
  function showCells() {
    if (chosen) { ctx.scene.remove(chosen); chosen.geometry.dispose(); chosen = null; }
    if (turns) { ctx.scene.remove(turns); turns.geometry.dispose(); turns = null; }
    if (!build || !active) return;
    const quads: { points: { x: number; z: number }[]; y: number; colour: THREE.Color }[] = [], arrows: typeof quads = [];
    const cell = (block: LandBlock, col: number, row: number, colour: THREE.Color, by = .08) => quads.push({ points: inset(areaCorners(block, col, row), by), y: PICK_Y, colour });
    /** The cells of a place that are there to show: in the block, the district's land or not. */
    const footprint = (place: Place) => {
      const blocked = new Set(place.blocked.map(([c, r]) => `${c}:${r}`));
      for (let i = 0; i < place.w; i++) for (let j = 0; j < place.h; j++) {
        const c = place.col + i, r = place.row + j;
        if (c >= 0 && r >= 0 && c < place.block.cols && r < place.block.rows) cell(place.block, c, r, blocked.has(`${c}:${r}`) ? BAD : OK);
      }
    };
    if (build.placing) {
      if (ghostPlace) footprint(ghostPlace);
    } else if (build.area === "plots") {
      const choice = build.choice, picked = stroke ? null : plotPlace(), small = choice?.family && isDecorFamily(choice.family), every = Math.max(1, choice?.every ?? 1);
      const corner = shape() === "area" && last && !stroke ? [last] : [];
      const list = stroke ? stroke.add ? [...chosenNow(), ...stroke.cells] : stroke.cells : [...chosenNow(), ...corner], done = new Set<string>();
      if (picked) {
        footprint(picked);
        // The cell chosen: a yellow middle over the building's cells.
        cell(picked.block, picked.cell.col, picked.cell.row, PICKED, .9);
        done.add(keyOf({ block: picked.block, col: picked.cell.col, row: picked.cell.row }));
      } else list.forEach(c => {
        const key = keyOf(c);
        if (done.has(key) || !forSale(c)) return;
        const index = done.size, state = stateAt(c); done.add(key);
        // A small thing on every `every`-th cell of the line; the cells between stay faintly chosen.
        if (small) cell(c.block, c.col, c.row, index % every ? PICKED : state === "free" ? OK : BAD, index % every ? .34 : .18);
        else cell(c.block, c.col, c.row, state === "free" ? PICKED : state === "own" ? TAKE : BAD, .18);
        if (!stroke && state === "own" && isTurning(decor.get(key)?.family)) arrows.push(turnArrow(c));
      });
      if (hoverCell && !done.has(keyOf(hoverCell))) cell(hoverCell.block, hoverCell.col, hoverCell.row, HOVER, .3);
    }
    if (arrows.length) { turns = flatMesh(arrows, turnMaterial, "district-chosen-turns"); turns.renderOrder = 5; ctx.scene.add(turns); }
    if (!quads.length) return;
    chosen = flatMesh(quads, pickMaterial, "district-chosen-cells"); chosen.renderOrder = 4;
    ctx.scene.add(chosen);
  }
  /** A flat arrow over a lamp's or a bench's cell, from its middle to the side it stands at or looks to. */
  function turnArrow(c: CellRef) {
    const centre = areaPoint(areaCorners(c.block, c.col, c.row), .5, .5), d = edgeToward(c.block, c.col, c.row, centre, decorSide(grid, decor, c.block, c.col, c.row));
    const at = (along: number, across: number) => ({ x: centre.x + d.x * along - d.z * across, z: centre.z + d.z * along + d.x * across }), tip = at(1.05, 0);
    return { points: [at(.1, -.38), at(.1, .38), tip, tip], y: PICK_Y + .02, colour: PICKED };
  }

  /**
   * Which way of the cells is up the screen and which to its right, for the panel's arrows (EstatePick "screen"): the
   * camera's look along the ground, to the nearest of the four ways. Told in build mode, once and when it changes.
   */
  let reportedScreen = "";
  const lookAt = new THREE.Vector3();
  function reportScreen() {
    const own = build?.area === "plots" && active ? numberOf(build.district) : 0, block = own ? grid.blocks.find(b => b.district === own) : undefined;
    if (!block) { reportedScreen = ""; return; }
    ctx.camera.getWorldDirection(lookAt);
    const centre = areaPoint(areaCorners(block, 0, 0), .5, .5), nearest = (x: number, z: number) => {
      let best: Way = "row-", most = -Infinity;
      for (const way of WAYS) { const d = edgeToward(block, 0, 0, centre, sideOf(block, way)), dot = d.x * x + d.z * z; if (dot > most) { most = dot; best = way; } }
      return best;
    };
    const length = Math.hypot(lookAt.x, lookAt.z);
    if (length < 1e-6) return;
    // Right of the screen is the look turned a quarter clockwise seen from above.
    const ux = lookAt.x / length, uz = lookAt.z / length, up = nearest(ux, uz), right = nearest(-uz, ux), key = `${up}:${right}`;
    if (key === reportedScreen) return;
    reportedScreen = key;
    onPick({ kind: "screen", up, right });
  }
  /**
   * Reports the cells chosen now: `add` instead of the ones before (`replace`), after them (`extend`), or a click's cell
   * in or out (`toggle`). `from` is where the next tap's line or area goes on from: the last cell added, or nowhere once
   * an area is done.
   */
  function choose(add: CellRef[], mode: "replace" | "extend" | "toggle", from: CellRef | null = add.length ? add[add.length - 1] : last) {
    if (!build || build.area !== "plots" || build.placing) return;
    const own = add.filter(forSale), before = mode === "replace" ? [] : chosenNow(), keys = new Set(before.map(keyOf));
    let next = before;
    if (mode === "toggle" && own.length === 1 && keys.has(keyOf(own[0]))) next = before.filter(c => keyOf(c) !== keyOf(own[0]));
    else for (const c of own) if (!keys.has(keyOf(c))) { next = [...next, c]; keys.add(keyOf(c)); }
    last = from;
    reportedList = next;
    report(next);
    showCells();
  }
  function report(list: CellRef[]) {
    if (!build) return;
    const cells = list.map(chosenCell);
    reportedCells = `${build.district}:${JSON.stringify(cells)}`;
    onPick({ kind: "cells", district: build.district, cells });
  }
  /** What the chosen cells hold, told again when it changes (the land changed, or the page chose a cell itself). */
  function reportCells() {
    const choice = build?.area === "plots" && !build.placing ? build.choice : null;
    if (!build || !choice?.cells.length) { reportedCells = ""; return; }
    const cells = choice.cells.map(refOf).filter((c): c is CellRef => !!c).map(chosenCell);
    const key = `${build.district}:${JSON.stringify(cells)}`;
    if (key === reportedCells) return;
    reportedCells = key;
    onPick({ kind: "cells", district: build.district, cells, update: true });
  }
  /** While an area is drawn: its size by the pointer, in cells across and along when it lies in one block, and how many of them are free. */
  const sizeLabel = document.createElement("div");
  sizeLabel.className = "c3-area-size"; sizeLabel.setAttribute("aria-hidden", "true"); sizeLabel.hidden = true;
  function showSize(event: { clientX: number; clientY: number } | null) {
    if (!event || !stroke?.area || !stroke.moved) { sizeLabel.hidden = true; return; }
    const end = stroke.cells.length ? stroke.cells : [stroke.from], to = hoverEnd ?? stroke.from;
    const count = end.filter(c => forSale(c) && stateAt(c) === "free").length, span = areaSpan(stroke.from, to);
    const across = span ? `${span[0]} × ${span[1]} · ` : "";
    sizeLabel.textContent = `${across}${count} ${plural(count, "клетка", "клетки", "клеток")}`;
    // Beside the pointer, on its left in the right half of the map, where the dock may cover it.
    const rect = ctx.overlay.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, left = x > rect.width / 2;
    sizeLabel.style.transform = `translate3d(${(left ? x - 16 : x + 16).toFixed(0)}px,${(y + 16).toFixed(0)}px,0)${left ? " translateX(-100%)" : ""}`;
    sizeLabel.hidden = false;
  }
  let hoverEnd: CellRef | null = null;
  /** A cell of the own district under a point (for sale or not), or null. */
  function ownCellAt(p: { x: number; z: number }): CellRef | null {
    if (!build) return null;
    const at = cellUnder(grid, p);
    return at && at.block.district === numberOf(build.district) && !at.skipped ? { block: at.block, col: at.col, row: at.row } : null;
  }
  /** An area's corner: any cell of the own district under a point, so an area may reach over its centre or the railway. */
  function cornerAt(p: { x: number; z: number }): CellRef | null {
    if (!build) return null;
    const at = cellUnder(grid, p);
    return at && at.block.district === numberOf(build.district) ? { block: at.block, col: at.col, row: at.row } : null;
  }

  function refreshBuild() {
    if (!active) { cells.visible = ghost.visible = selection.visible = front.visible = false; showCells(); return; }
    // Lines and areas go on only in the district they were started in.
    const district = build?.area === "plots" ? build.district : "";
    if (district !== lineDistrict) { lineDistrict = district; last = null; stroke = null; sizeLabel.hidden = true; }
    refreshCells(); showSelection(); reported = ""; showGhost(pinned, false); showCells(); reportPlot(); reportCells(); reportScreen();
  }

  // ---- the community square and projects still collecting ----
  const layer = document.createElement("div"); layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Районы команд");
  ctx.overlay.append(layer); ctx.overlay.append(sizeLabel);
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
      const hidden = ((id.startsWith("public-") || id.startsWith("main-")) && (!!build?.placing || !!build?.choice?.cells.length)) || depth < ctx.camera.near || ctx.camera.position.distanceTo(item.point) > item.reach || Math.abs(scratch.x) > 1.1 || Math.abs(scratch.y) > 1.1;
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
  const offMove = ctx.onCameraMove(() => { place(); if (build) reportScreen(); });

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
    // The island city's blocks overlap where its bands meet: the block whose cell there is for sale.
    let off: { module: number; u: number; v: number } | null = null;
    for (const block of grid.blocks) {
      if (block.district !== number) continue;
      const at = blockCell(block, p);
      if (!at || at.u >= block.cols || at.v >= block.rows) continue;
      const u = Math.floor(at.u), v = Math.floor(at.v);
      if (!block.skip.has(`${u}:${v}`)) return { module: block.block, u, v };
      off ??= { module: block.block, u, v };
    }
    return off;
  }
  /** A tap on the ground: pins the preview, goes on with a line or an area, opens a building or the square, or chooses the cell. */
  function pick(p: { x: number; z: number }) {
    if (build?.placing) {
      const target = previewAt(p);
      if (target) { pinned = target; reported = ""; showGhost(target); }
      return;
    }
    const area = shape() === "area";
    if (goingOn()) {
      // Drawing lines, every cell from the last one to it; drawing areas, every cell of the rectangle between the corner
      // waiting and this one, after which the next tap starts a new area. Whatever stands on the cells.
      const at = area ? cornerAt(p) : ownCellAt(p);
      if (!at || !last) return;
      if (last.block.district !== at.block.district) choose([at], "extend", at);
      else if (area) choose(cellsWithin(grid, last, at), "extend", null);
      else choose(cellsBetween(grid, last, at), "extend");
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
    const at = area ? cornerAt(p) : ownCellAt(p);
    // One cell instead of the ones chosen; drawing lines or areas, their first cell or corner, after the ones chosen.
    if (at) { if (shape() === "cell") choose([at], "replace"); else choose([at], "extend", at); }
  }
  /** A tap at a point of the screen: a building's body first (its roof may stand over another cell), then the ground. */
  function tapAt(clientX: number, clientY: number) {
    const ray = rayAt(clientX, clientY);
    if (!ray) return;
    if (!build?.placing && !goingOn()) {
      const found = buildingAtRay(ray);
      if (found) { onPick(found); return; }
    }
    if (ray.intersectPlane(plane, hit)) pick({ x: hit.x, z: hit.z });
  }
  let down: { x: number; y: number; time: number } | null = null, pressed = 0, frame = 0, hover: { x: number; y: number } | null = null;
  /**
   * On the own land the mouse's left button draws cells only where drawing is asked for: a line of them in the line mode
   * (an area in the area mode) instead of the ones chosen, with Shift a line after them. With Ctrl or Cmd held either
   * button draws an area after them (a road two or three cells wide, a grove), and a click takes one cell in or out.
   * Otherwise (a building, one cell at a time, nothing chosen yet) a left drag moves the camera as everywhere in the
   * city and a click is a tap. The camera keeps the right button, the middle one to turn, the wheel and the keys.
   */
  const onPress = (event: PointerEvent) => {
    const held = event.ctrlKey || event.metaKey;
    if (!build || build.area !== "plots" || build.placing || !active || event.pointerType !== "mouse") return;
    const draws = held || event.shiftKey || shape() !== "cell";
    if (!((event.button === 0 && draws) || (held && event.button === 2))) return;
    const area = held || shape() === "area", p = groundAt(event.clientX, event.clientY), at = p && (area ? cornerAt(p) : ownCellAt(p));
    if (!at) return;
    event.stopImmediatePropagation(); event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer. */ }
    stroke = { from: at, cells: [at], pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, area, add: held || event.shiftKey };
    hoverEnd = at;
  };
  const onDown = (event: PointerEvent) => { if (event.isPrimary) { pressed = 1; down = { x: event.clientX, y: event.clientY, time: performance.now() }; } else { pressed++; down = null; } };
  const onUp = (event: PointerEvent) => {
    if (stroke && event.pointerId === stroke.pointer) {
      const done = stroke; stroke = null; hoverEnd = null; sizeLabel.hidden = true;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
      // A drag chooses its whole line or area; a click with Ctrl, Cmd or Shift takes one cell in or out; a click is a tap.
      if (done.moved) choose(done.cells, done.add ? "extend" : "replace", done.area ? null : undefined);
      else if (done.add) { const p = groundAt(event.clientX, event.clientY), at = p && ownCellAt(p); if (at) choose([at], "toggle", at); else showCells(); }
      else { tapAt(event.clientX, event.clientY); showCells(); }
      return;
    }
    pressed = Math.max(0, pressed - 1);
    const tap = down && pressed === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && performance.now() - down.time < TAP_TIME;
    if (pressed === 0) down = null;
    if (!tap || !active) return;
    tapAt(event.clientX, event.clientY);
  };
  const onMove = (event: PointerEvent) => {
    if (stroke && event.pointerId === stroke.pointer) {
      if (Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) >= TAP_DISTANCE) stroke.moved = true;
      if (!stroke.moved) return;
      const p = groundAt(event.clientX, event.clientY), at = p && (stroke.area ? cornerAt(p) : ownCellAt(p));
      if (at) { hoverEnd = at; stroke.cells = stroke.area ? cellsWithin(grid, stroke.from, at) : cellsBetween(grid, stroke.from, at); showCells(); }
      showSize(event);
      return;
    }
    if ((!build?.placing && build?.area !== "plots") || event.pointerType !== "mouse" || event.buttons || !active) return;
    hover = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!hover) return;
      const p = groundAt(hover.x, hover.y);
      if (build?.placing) { const target = p && previewAt(p); if (target) { pinned = target; showGhost(target); } return; }
      if (build?.area === "plots") {
        const at = p ? ownCellAt(p) : null;
        if ((at && hoverCell && keyOf(at) === keyOf(hoverCell)) || (!at && !hoverCell)) return;
        hoverCell = at; showCells();
      }
    });
  };
  const onLeave = () => { if (hoverCell) { hoverCell = null; showCells(); } };
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
      // Cleared or laid: a line or an area starts afresh from the next tap.
      if (build?.choice?.cells.length && !next?.choice?.cells.length) last = null;
      build = next; reportedList = null; if (!same) pinned = null;
      if (!next || next.area !== "plots" || next.placing) hoverCell = null;
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
      if (target.kind === "plot" && target.plot) { const block = blockOf(number, target.plot.block); if (block) place = areaFrame(block, target.plot.col, target.plot.row); }
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
          // As far as the cells for sale reach: the island city's blocks are rectangles round theirs, overlapping.
          for (const block of own) {
            let c0 = block.cols, c1 = -1, r0 = block.rows, r1 = -1;
            for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) if (!block.skip.has(`${c}:${r}`)) {
              c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
            }
            if (c1 >= 0) for (const corner of areaCorners(block, c0, r0, c1 - c0 + 1, r1 - r0 + 1)) bounds.expandByPoint(new THREE.Vector3(corner.x, PLOT_Y, corner.z));
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
      layer.remove(); sizeLabel.remove(); squarePools?.dispose(); squareLights?.dispose(); pools?.dispose(); lights?.dispose();
      for (const mesh of [ground.mesh, ground.centreMesh, squarePatches, patches]) if (mesh) { ctx.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      if (paving) { ctx.scene.remove(paving); paving.geometry.dispose(); }
      if (chosen) { ctx.scene.remove(chosen); chosen.geometry.dispose(); }
      if (turns) { ctx.scene.remove(turns); turns.geometry.dispose(); }
      ctx.scene.remove(borders.band, borders.posts); borders.dispose();
      for (const item of veils.splice(0)) { ctx.scene.remove(item.mesh); (item.mesh.material as THREE.Material).dispose(); }
      ctx.scene.remove(cells, ghost, selection, front);
      cells.geometry.dispose(); ghost.geometry.dispose(); edges.geometry.dispose(); selection.geometry.dispose(); front.geometry.dispose();
      [lineMaterial, ghostMaterial, edgeMaterial, selectMaterial, veilMaterial, frontMaterial, pickMaterial, turnMaterial, pavingMaterial].forEach(m => m.dispose());
    },
  };
}
