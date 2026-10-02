/** Two departmental roots share the renderer, sky, camera and catalogue. Only the active root ticks. */
import * as THREE from "three/webgpu";
import type { CityWorld, DepartmentId } from "../../api/cityWorld";
import { SALES_RESOURCES } from "../../api/cityWorld";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import type { Model } from "../assets/loader";
import { createInstancePools } from "../render/instances";
import { createMountains } from "../render/mountains";
import { RELIEF_END } from "../world/relief";
import { PORTAL_AT, RAIL_LINES, STATION, railHeading, railPoint, type RailLine } from "../world/railway";
import { loadModels } from "../assets/loader";
import portalUrl from "../../pages/city/models/railway-portal.glb?url";
import stationUrl from "../../pages/city/models/railway-station.glb?url";
import { createTerrain } from "../render/terrain";
import { createWater } from "../render/water";
import { createTraffic } from "./traffic";
import { createCrowd } from "./crowd";
import { disposeTree } from "./districts";
import { mergeStatic } from "../assets/landmarks";
import { generateSalesWorld, SALES_CENTERS } from "../world/sales";
import { landGrid, type LandGrid } from "../world/land";
import { DISTRICT_COLOURS, districtColour, districtNumber, preparedLand } from "../world/estateGrid";
import { createEstates, type Estates } from "./estates";
import type { CityBuildView, CityEstateView, EstatePick, EstateTarget } from "../types";

export interface DepartmentWorld {
  show(id: DepartmentId): void; setConfig(config: CityWorld): void;
  frame(dt: number, now: number, moved: boolean): void;
  setNight(night: boolean): void; setTraffic(active: boolean): void;
  point(id: string): THREE.Vector3 | undefined;
  railway(progress: number): THREE.Vector3;
  /** Camera azimuths for the trip in the city on screen: following the train out, and arriving at its station. */
  railView(): { departure: number; arrival: number };
  /** Team district land: buildings, projects and the headquarters stage of every district of a city. */
  setEstates(city: DepartmentId, view: CityEstateView | null): void;
  setBuild(view: CityBuildView | null): void;
  focusEstate(target: EstateTarget, distance: number, polar: number): { point: THREE.Vector3; azimuth: number } | null;
  dispose(): void;
}
const WALL = "#f0e8d6", GLASS = "#397181", DARK = "#39484b", GOLD = "#ddb04f", GREEN = "#728963";
const materialSets = new WeakMap<THREE.Object3D, Map<string, THREE.MeshStandardNodeMaterial>>();
function builder(root: THREE.Object3D) {
  const materials = materialSets.get(root) ?? new Map<string, THREE.MeshStandardNodeMaterial>(); materialSets.set(root, materials);
  return (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardNodeMaterial({ color, roughness: color === GLASS ? .25 : .7, metalness: color === GLASS ? .3 : .03 }));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.get(color)!);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
}
/**
 * A team's headquarters at one of five stages (TZ §9.1), built round its own origin with the entrance to +z:
 * a small office, a second wing with a courtyard, a modern facade with a canopy and a square, a campus with a
 * roof terrace and a rear block, and the flagship with its tower, crown and flag. It never leaves its site.
 */
function headquarters(root: THREE.Object3D, stage: number, colour: string) {
  const b = builder(root), pad = [10, 10, 12, 14, 15][stage - 1];
  b(pad, .3, pad, 0, .35, 0, "#d4cabb");
  const wide = stage === 1 ? 7.6 : 6, x = stage === 1 ? 0 : 1, h = [3.4, 4.6, 4.6, 5.8, 5.8][stage - 1];
  b(wide, h, 6, x, .5 + h / 2, 0, WALL);
  b(wide - .8, h - .8, .12, x, .9 + (h - .8) / 2, 3.03, GLASS); b(wide - .8, h - .8, .12, x, .9 + (h - .8) / 2, -3.03, GLASS);
  for (const dx of stage >= 3 ? [-2.6, -1.3, 0, 1.3, 2.6] : [-2.6, 0, 2.6]) b(.2, h, 6.3, x + dx * wide / 7.6, .5 + h / 2, 0, stage >= 3 ? GOLD : WALL);
  for (let y = 1; y < h; y += 1.25) b(wide, .13, 6.3, x, .5 + y, 0, WALL);
  b(wide + .6, .35, 6.6, x, h + .6, 0, DARK);
  b(3.1, .2, 1.9, x, 1.8, 3.5, colour); b(2, 1.4, .15, x, 1.15, 3.2, DARK);
  if (stage >= 2) {
    // The second wing and a courtyard beside it.
    b(3.2, 2.8, 4.6, -3.4, .5 + 1.4, -.6, WALL); b(2.6, 1.6, .12, -3.4, 1.6, 1.72, GLASS); b(3.6, .3, 5, -3.4, 3.45, -.6, DARK);
    b(3, .06, 2.2, -3.4, .53, 3.2, GREEN);
  }
  if (stage >= 3) {
    // A canopy over the entrance and a square in front: lawn, low hedges, two benches.
    b(4.6, .18, 2.4, x, 3.1, 3.9, DARK); for (const dx of [-2, 2]) b(.14, 2.6, .14, x + dx, 1.8, 4.9, GOLD);
    b(pad - 2, .05, 2.4, 0, .53, pad / 2 - 1.4, GREEN);
    for (const dx of [-3.5, 3.5]) { b(2.2, .45, .5, dx, .75, pad / 2 - 1.4, "#557f46"); b(1, .12, .35, dx, .62, pad / 2 - 2.2, "#8b6a4b"); }
  }
  if (stage >= 4) {
    // A rear block and a terrace with a green roof and a rail.
    b(5, 3.6, 3.2, 1.6, .5 + 1.8, -4.6, WALL); b(4.4, 2.6, .12, 1.6, 2.3, -6.22, GLASS); b(5.4, .3, 3.6, 1.6, 4.45, -4.6, DARK);
    b(wide - .6, .12, 5.4, x, h + .84, 0, GREEN); for (const dz of [-2.8, 2.8]) b(wide - .4, .5, .08, x, h + 1.1, dz, GOLD);
  } else b(Math.min(5.6, wide - 1), .3, 4, x, h + .85, 0, GREEN);
  if (stage === 5) {
    // The flagship: a slim tower with a crown at the corner, a flag in the team's colour, hedges round the plaza.
    b(2.4, 11, 2.4, -5.2, .5 + 5.5, -5.2, WALL); for (const dy of [3, 5.5, 8]) b(2.5, .14, 2.5, -5.2, .5 + dy, -5.2, GOLD);
    b(1.6, 8, .1, -5.2, 6, -3.98, GLASS); b(2.8, .5, 2.8, -5.2, 11.75, -5.2, GOLD); b(1.4, 1.4, 1.4, -5.2, 12.7, -5.2, colour);
    b(.1, 4.5, .1, 5.6, 2.75, 5.6, DARK); b(1.4, .8, .05, 6.3, 4.6, 5.6, colour);
    for (const dx of [-6.6, 6.6]) b(.5, .55, 9, dx, .8, 1.5, "#557f46");
  }
  for (const dx of [-3.2, 3.2]) { b(1.2, .5, 1.2, x + dx * .9, .7, 3.8, WALL); b(1, .65, 1, x + dx * .9, 1.1, 3.8, GREEN); }
}
/** The headquarters' accents: the districts' own colours, then more for districts beyond the three with land. */
const HQ_COLOURS = [...DISTRICT_COLOURS, "#4b7fd6", "#c4568a", "#7a9a3c"];
function offices(root: THREE.Object3D, x: number, z: number, index: number) {
  const b = builder(root), h = 3.4 + (index % 3) * .7;
  b(10, .3, 10, x, .35, z, "#d4cabb"); b(7.6, h, 6, x, .5 + h / 2, z, WALL);
  b(6.8, h - .8, .12, x, .9 + (h - .8) / 2, z + 3.03, GLASS);
  b(6.8, h - .8, .12, x, .9 + (h - .8) / 2, z - 3.03, GLASS);
  for (const dx of [-3.5, -1.2, 1.2, 3.5]) b(.2, h, 6.3, x + dx, .5 + h / 2, z, index % 2 ? GOLD : WALL);
  for (let y = 1; y < h; y += 1.25) b(7.6, .13, 6.3, x, .5 + y, z, WALL);
  b(8.2, .35, 6.6, x, h + .6, z, DARK); b(5.6, .3, 4, x, h + .85, z, GREEN);
  b(3.1, .2, 1.9, x, 1.8, z + 3.5, GOLD); b(2, 1.4, .15, x, 1.15, z + 3.2, DARK);
  for (const dx of [-3.2, 3.2]) { b(1.2, .5, 1.2, x + dx, .7, z + 3.8, WALL); b(1, .65, 1, x + dx, 1.1, z + 3.8, GREEN); }
}
const STONE = "#a29c8f", STONE_DARK = "#7f7a70", TUNNEL = "#20282b", PULS = "#6b55c8", GROUND_Y = .2;
/** Lamps that shine day and night: the tunnel's lights, the signal, the buffer stop's lamp. */
const glows = new Map<string, THREE.MeshBasicNodeMaterial>();
function glow(color: string) {
  if (!glows.has(color)) glows.set(color, new THREE.MeshBasicNodeMaterial({ color }));
  return glows.get(color)!;
}
/**
 * The terminus at the town's edge and the short line out into the hills (world/railway.ts): the forecourt across
 * the end of the track, the station building behind it on a floor slab that runs on to the platform under its
 * canopy, the track in its cutting, and the portal in the hill's face. The building and the portal are models
 * that arrive later (railway-station.glb, railway-portal.glb); drawn ones stand in until then, or for good if
 * they cannot load. Built in the line's own frame: u along the track from the buffer stop (local +z), w across
 * it, positive on the station's side. `city` picks the name on the station's boards.
 */
function station(line: RailLine, city: DepartmentId) {
  const root = new THREE.Group(), fixed = new THREE.Group(), train = new THREE.Group(); root.add(fixed, train);
  const b = builder(fixed), t = builder(train), G = GROUND_Y, L = line.length, F = STATION.floor, x = (w: number) => -line.side * w;
  const box = (across: number, height: number, along: number, w: number, y: number, u: number, color: string) => b(across, height, along, x(w), y, u, color);
  const lamp = (across: number, height: number, along: number, w: number, y: number, u: number, color: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(across, height, along), glow(color)); mesh.position.set(x(w), y, u); fixed.add(mesh);
  };
  // The forecourt with planters and two lamps.
  box(17.5, .06, 5.4, 3.75, G + .03, -13.3, "#d9cfbf");
  for (const w of [-3.4, 10.9]) { box(1.3, .5, 1.3, w, G + .25, -14.2, WALL); box(1.1, .3, 1.1, w, G + .62, -14.2, GREEN); }
  for (const w of [-1.4, 8.9]) { box(.12, 3, .12, w, G + 1.5, -15.2, DARK); box(.45, .3, .45, w, G + 3.1, -15.2, GLASS); }
  // The floor slab under the building out to the platform, a step up to it from the forecourt.
  box(17, F, 9.2, 4, G + F / 2, -6, "#cfc6b5"); box(17, F / 2, .45, 4, G + F / 4, -10.82, "#cfc6b5");
  // The platform along the track under its canopy, its edge marked yellow, two benches.
  box(3.4, F, 22, 3.6, G + F / 2, 9.5, "#cfc6b5"); box(.14, .02, 22, 2.12, G + F + .01, 9.5, "#e2b33c");
  for (const u of [1, 6, 11, 16]) box(.16, 3.3, .16, 4.6, G + F + 1.65, u, GOLD);
  box(4.6, .25, 19.5, 3.7, G + F + 3.45, 8.5, DARK); box(.4, .06, 18.5, 3.2, G + F + 3.3, 8.5, GLASS);
  for (const u of [3.5, 13.5]) box(.5, .4, 1.4, 4.6, G + F + .2, u, "#8b6a4b");
  // The track from the buffer stop, through the cutting, into the tunnel.
  const along = L + 22.5, middle = (L + 21.5) / 2;
  box(3.2, .18, along, 0, G + .09, middle, "#a59b8b");
  for (const w of [-.55, .55]) box(.1, .12, along, w, G + .24, middle, DARK);
  for (let u = .3; u < L + 21; u += .9) box(2.3, .08, .26, 0, G + .2, u, "#786b5b");
  box(2.2, .9, .4, 0, G + .65, -.3, "#c4423c"); lamp(.3, .3, .1, 0, G + 1.25, -.52, "#ff5a4e");
  // A signal on the far side before the portal: green above, red below.
  box(.15, 3.4, .15, -3.4, G + 1.7, L - 7, DARK); box(.5, 1.1, .35, -3.4, G + 3.6, L - 7, DARK);
  lamp(.22, .22, .06, -3.4, G + 3.85, L - 7.2, "#57d68d"); lamp(.22, .22, .06, -3.4, G + 3.35, L - 7.2, "#7a2a26");
  // Three cars on the rails, the head one towards the tunnel.
  for (const u of [2.8, 6.8, 10.8]) {
    t(1.8, 1.6, 3.6, 0, G + 1.35, u, WALL); t(1.88, .24, 3.65, 0, G + .75, u, PULS); t(1.9, .2, 3.7, 0, G + 2.25, u, DARK);
    for (const w of [-.91, .91]) for (const du of [-1, 0, 1]) t(.06, .65, .65, w, G + 1.6, u + du, GLASS);
    for (const du of [-1.1, 1.1]) t(1.7, .32, .5, 0, G + .42, u + du, DARK);
  }
  t(1.5, .7, .08, 0, G + 1.6, 12.61, GLASS);
  mergeOwned(fixed); mergeOwned(train);
  let building = drawnBuilding(line), portal = drawnPortal(line); root.add(building, portal);
  root.position.set(line.x, 0, line.z); root.rotation.y = railHeading(line);
  // The head reaches the portal at 85 % of the trip, so the train is in the tunnel when the trip says so.
  const travel = (L - 12.6) / .85;
  return {
    root, train,
    position(progress: number) {
      const s = Math.max(0, Math.min(1, progress)) * travel; train.position.z = s;
      const p = railPoint(line, 6.8 + s); return new THREE.Vector3(p.x, G + 1.4, p.z);
    },
    /** The modelled portal takes the drawn one's place; its geometry and materials stay the model's. */
    usePortal(model: Model) {
      portal.removeFromParent(); disposeDrawn(portal);
      portal = modelPortal(line, model); root.add(portal);
    },
    /** The modelled station building with this city's name takes the drawn one's place, as the portal does. */
    useBuilding(models: Map<string, Model>) {
      const model = models.get("railway-station");
      if (!model) return;
      building.removeFromParent(); disposeDrawn(building);
      building = modelBuilding(line, model, models.get(`station-sign-${city}`)); root.add(building);
    },
  };
}
/**
 * The drawn station building: a long glazed hall with a taller middle, the brand stripe, a clock and the entrance
 * canopy, on the floor slab across the end of the track. Its own materials, freed with it.
 */
function drawnBuilding(line: RailLine) {
  const group = new THREE.Group(), b = builder(group), G = GROUND_Y + STATION.floor, side = line.side;
  const box = (across: number, height: number, along: number, w: number, y: number, u: number, color: string) => b(across, height, along, -side * w, y, u, color);
  box(17, 4.8, 8.5, 4, G + 2.4, -5.75, WALL); box(15.6, 3.2, .12, 4, G + 2.3, -10.02, GLASS);
  for (const w of [-4.2, -.2, 3.8, 7.8, 12.2]) box(.32, 4.8, .3, w, G + 2.4, -10.1, WALL);
  box(17.1, .35, 8.6, 4, G + 4.25, -5.75, PULS); box(17.6, .35, 9.1, 4, G + 4.95, -5.75, DARK);
  box(7, 2.8, 7.5, 4, G + 6.2, -5.75, WALL); box(7.6, .3, 8.1, 4, G + 7.75, -5.75, DARK);
  for (const w of [1.65, 6.35]) box(2.3, 1.9, .12, w, G + 6.1, -9.52, GLASS);
  box(1.5, 1.5, .14, 4, G + 6.25, -9.55, "#f7f3e8"); box(.12, .62, .06, 4, G + 6.45, -9.64, DARK); box(.5, .12, .06, 4.2, G + 6.25, -9.64, DARK);
  // The canopy's posts stand on the forecourt, in front of the floor slab.
  box(6.5, .2, 2.4, 4, G + 3.05, -11.2, DARK); for (const w of [1.2, 6.8]) box(.14, 2.95 + STATION.floor, .14, w, GROUND_Y + (2.95 + STATION.floor) / 2, -12.2, GOLD);
  box(2.6, 2.2, .14, 4, G + 1.1, -10.1, DARK);
  mergeOwned(group);
  return group;
}
/** The station model's windows as a node material of their own, so night lights them as it does the drawn glass. */
function litWindows(models: Map<string, Model>) {
  for (const model of models.values()) for (const part of model.parts) {
    const source = part.material as THREE.MeshStandardMaterial;
    if (source.name !== "station-glass" || source instanceof THREE.MeshStandardNodeMaterial) continue;
    part.material = new THREE.MeshStandardNodeMaterial({ name: source.name, color: source.color, roughness: source.roughness, metalness: source.metalness });
    source.dispose();
  }
}
/**
 * The modelled station building (frontend/src/pages/city/models/railway-station.glb, prepared by
 * scripts/prepare_railway_station.py): its origin on the ground under its floor, its platform side towards the
 * track, standing on the floor slab across the end of the track; the boards read this city's name.
 */
function modelBuilding(line: RailLine, model: Model, sign: Model | undefined) {
  const group = new THREE.Group();
  group.position.set(-line.side * STATION.middle, GROUND_Y, STATION.building);
  for (const part of [...model.parts, ...(sign?.parts ?? [])]) {
    const mesh = new THREE.Mesh(part.geometry, part.material); mesh.castShadow = part.castShadow; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

/** mergeStatic copies its source geometries; free those originals after batching. */
function mergeOwned(g: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(); g.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); });
  mergeStatic(g); geometries.forEach(v => v.dispose());
}
/** A lamp that shines day and night, in the line's frame (w across, u along). */
function lampAt(group: THREE.Object3D, side: 1 | -1, across: number, height: number, along: number, w: number, y: number, u: number, color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(across, height, along), glow(color)); mesh.position.set(-side * w, y, u); group.add(mesh);
}
/**
 * The drawn portal: piers and lintel round the opening, a lighter frame, a cap; the headwall runs from 3 before the
 * face to 0.6 past it, over the hole in the hill's face, the wing walls step down beside the cutting, and inside
 * dark walls, floor and vault (the hill has no ground in the bore), lamps along both walls and the far end out of
 * sight. Its own materials, freed with it.
 */
function drawnPortal(line: RailLine) {
  const group = new THREE.Group(), b = builder(group), G = GROUND_Y, L = line.length, side = line.side;
  const box = (across: number, height: number, along: number, w: number, y: number, u: number, color: string) => b(across, height, along, -side * w, y, u, color);
  const wall = L - 1.2;
  for (const w of [-4.4, 4.4]) box(4.2, 8.4, 3.6, w, G + 4.2, wall, STONE);
  box(4.6, 2.8, 3.6, 0, G + 7, wall, STONE); box(13.6, .45, 4, 0, G + 8.6, wall, STONE_DARK);
  box(5.4, .5, .3, 0, G + 5.85, L - 3.1, "#c9c2b4"); for (const w of [-2.5, 2.5]) box(.4, 5.6, .3, w, G + 2.8, L - 3.1, "#c9c2b4");
  for (const sign of [-1, 1]) for (const [k, height] of [[0, 6], [1, 4.4], [2, 2.8]]) {
    const u = L - 4.3 - k * 2.7, w = sign * (6.8 + k * .65), piece = box(.8, height, 2.8, w, G + height / 2, u, STONE);
    piece.rotation.y = Math.atan2(sign * side * .65, 2.7);
  }
  for (const w of [-2.45, 2.45]) box(.3, 5.6, 25, w, G + 2.8, L + 9.5, TUNNEL);
  box(5.2, .3, 25, 0, G + 5.75, L + 9.5, TUNNEL); box(5.2, .04, 25, 0, G + .02, L + 9.5, TUNNEL); box(5.2, 5.6, .3, 0, G + 2.8, L + 22, "#0e1416");
  for (let u = L + 1.5; u < L + 20; u += 4) for (const w of [-2.26, 2.26]) lampAt(group, side, .1, .22, .6, w, G + 4.2, u, "#ffd38a");
  mergeOwned(group);
  return group;
}
/** Frees the drawn portal: its geometry and its own materials (the lamps' materials are shared). */
function disposeDrawn(group: THREE.Group) {
  const shared = new Set<THREE.Material>(glows.values());
  group.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (!shared.has(o.material as THREE.Material)) (o.material as THREE.Material).dispose(); } });
  materialSets.delete(group);
}
/**
 * The modelled portal (frontend/src/pages/city/models/railway-portal.glb, prepared by
 * scripts/prepare_railway_portal.py): built in the line's frame with its origin on the track at the rail top,
 * PORTAL_AT before the hill's face. Under the track inside, a dark floor hides the bore's curved bottom; lamps
 * sit on the bore's walls where a ray from the track meets them.
 */
function modelPortal(line: RailLine, model: Model) {
  const group = new THREE.Group(), place = new THREE.Group(), G = GROUND_Y, L = line.length;
  place.position.set(0, G + .3, L - PORTAL_AT); group.add(place);
  for (const part of model.parts) { const mesh = new THREE.Mesh(part.geometry, part.material); mesh.castShadow = part.castShadow; mesh.receiveShadow = true; place.add(mesh); }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7.4, .04, 31), new THREE.MeshStandardNodeMaterial({ color: TUNNEL, roughness: .95 }));
  floor.position.set(0, G + .02, L + 12.5); floor.receiveShadow = true; group.add(floor);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), parts = place.children, lamps = new THREE.Group();
  for (let u = L + 1.5; u < L + 24; u += 4) for (const side of [-1, 1] as const) {
    ray.set(new THREE.Vector3(0, G + 3.6, u), new THREE.Vector3(side, 0, 0));
    const hit = ray.intersectObjects(parts, false)[0];
    if (hit) lampAt(lamps, -1, .1, .22, .6, side * (hit.distance - .1), G + 3.6, u, "#ffd38a");
  }
  if (lamps.children.length) { mergeOwned(lamps); group.add(lamps); }
  return group;
}

export function createDepartmentWorld(ctx: CityContext, catalogue: Catalogue, models: Map<string, Model>, onPick: (id: string) => void, onEstate: (pick: EstatePick) => void = () => undefined): DepartmentWorld {
  let active: DepartmentId = "support", sales: ReturnType<typeof salesRoot> | undefined;
  const supportNodes = [...ctx.scene.children].filter(n => !(n instanceof THREE.Light));
  const supportRoot = new THREE.Group(); supportRoot.name = "support-city";
  supportNodes.forEach(n => supportRoot.add(n)); ctx.scene.add(supportRoot);
  const supportOverlayNodes = [...ctx.overlay.children] as HTMLElement[];
  const supportLine: RailLine = ctx.world.railway ?? RAIL_LINES.x4, supportRail = station(supportLine, "support"); ctx.scene.add(supportRail.root);
  // The tunnel portals' model and the station buildings'; both stations use drawn ones until they arrive, and keep
  // them if they cannot.
  let portalModel: Model | null = null, stationModels: Map<string, Model> | null = null, disposed = false;
  void loadModels(portalUrl).then(models => {
    const model = models.get("railway-portal") ?? [...models.values()][0];
    if (disposed || !model) return;
    portalModel = model; supportRail.usePortal(model); sales?.rail.usePortal(model); ctx.requestShadowUpdate();
  }).catch(() => undefined);
  void loadModels(stationUrl).then(models => {
    if (disposed || !models.has("railway-station")) return;
    litWindows(models); stationModels = models; supportRail.useBuilding(models); sales?.rail.useBuilding(models);
    [supportRail.root, sales?.rail.root].forEach(root => { if (root) illuminate(root); });
    ctx.requestShadowUpdate();
  }).catch(() => undefined);
  const supportTeams = new THREE.Group(); ctx.scene.add(supportTeams);
  const supportLabels = document.createElement("div"), salesLabels = document.createElement("div");
  ctx.overlay.append(supportLabels, salesLabels);
  let config: CityWorld | undefined, layoutKey = "";
  // District land: the island city's whole mainland (the full map only), the lake city's all round the lake, in plots.
  const grids: Partial<Record<DepartmentId, LandGrid>> = {};
  const supportGrid = landGrid(ctx.world);
  if (supportGrid) grids.support = supportGrid;
  const supportLand3d = new THREE.Scene(); supportLand3d.name = "support-districts"; supportRoot.add(supportLand3d);
  const estates: Partial<Record<DepartmentId, Estates>> = {};
  if (grids.support) { estates.support = createEstates({ ...ctx, scene: supportLand3d, overlay: supportLabels }, grids.support, onEstate); estates.support.setCatalogue(catalogue); }
  const views: Partial<Record<DepartmentId, CityEstateView | null>> = {};
  let build: CityBuildView | null = null;
  const anchors = { support: new Map<string, THREE.Vector3>(), sales: new Map<string, THREE.Vector3>() };
  const elements = { support: new Map<string, HTMLElement>(), sales: new Map<string, HTMLElement>() };
  let night = false, traffic = true;
  function illuminate(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // The drawn buildings' glass, and the station model's windows (litWindows).
      for (const material of materials) if (material instanceof THREE.MeshStandardNodeMaterial && (material.name === "station-glass" || material.color.getHexString() === GLASS.slice(1))) {
        material.emissive.set(night ? "#ffc77d" : "#000000"); material.emissiveIntensity = .65;
      }
    });
  }

  function salesRoot() {
    const scene = new THREE.Scene(); scene.name = "sales-city"; ctx.scene.add(scene);
    const frames = new Set<(dt: number, now: number) => void>(), moves = new Set<() => void>();
    const world = generateSalesWorld();
    const context: CityContext = { ...ctx, scene, world, overlay: salesLabels, get quality() { return ctx.quality; },
      onFrame(cb) { frames.add(cb); return () => { frames.delete(cb); }; }, onCameraMove(cb) { moves.add(cb); return () => { moves.delete(cb); }; } };
    const terrain = createTerrain(context), water = createWater(context), pools = createInstancePools(context, catalogue, world.placements);
    const cars = createTraffic(context); cars.setVehicles(models); cars.setEnabled(traffic);
    const crowd = createCrowd(context); crowd.setEnabled(traffic); water.setNight(night);
    const campus = new THREE.Group(), teams = new THREE.Group(); scene.add(campus, teams);
    SALES_CENTERS.forEach((p, i) => { offices(campus, p.x, p.z, i); anchors.sales.set(p.id, new THREE.Vector3(p.x, 7, p.z)); });
    batch(campus);
    // The hills round the lake city, out as far as the island city's, so the fog hides their edge the same way.
    const hills = createMountains(context, { end: ctx.world.radius * RELIEF_END });
    const rail = station(world.railway ?? RAIL_LINES.sales, "sales"); scene.add(rail.root);
    if (portalModel) rail.usePortal(portalModel);
    if (stationModels) rail.useBuilding(stationModels);
    const grid = landGrid(world)!; grids.sales = grid;
    const land3d = createEstates(context, grid, onEstate); land3d.setCatalogue(catalogue);
    estates.sales = land3d; land3d.set(views.sales ?? null); land3d.setBuild(build && cityOf(build.district) === "sales" ? build : null);
    return { scene, frames, moves, terrain, water, hills, pools, cars, crowd, campus, teams, rail, land3d, line: world.railway ?? RAIL_LINES.sales };
  }
  const cityOf = (district: string): DepartmentId => district.startsWith("sales-") ? "sales" : "support";
  function batch(root: THREE.Group) {
    const originals = new Set<THREE.BufferGeometry>(); root.traverse(o => { if (o instanceof THREE.Mesh) originals.add(o.geometry); });
    mergeStatic(root); originals.forEach(g => g.dispose());
  }
  /** A label over a place of the city; a team district's in the district's own colour (world/estateGrid.ts). */
  function label(city: DepartmentId, id: string, name: string, status: string, icon: string, colour?: string) {
    let el = elements[city].get(id);
    if (!el) {
      el = document.createElement("button"); (el as HTMLButtonElement).type = "button"; el.className = "c3-label"; el.dataset.worldObject = id;
      el.style.setProperty("--c3-district", colour ?? (city === "sales" ? "#c59437" : "#7965d5"));
      if (colour) el.dataset.team = "";
      const symbol = document.createElement("span"), copy = document.createElement("span"), title = document.createElement("strong"), sub = document.createElement("small");
      symbol.className = "c3-label__icon"; symbol.setAttribute("aria-hidden", "true"); copy.className = "c3-label__text";
      title.className = "c3-label__name"; sub.className = "c3-label__status"; copy.append(title, sub); el.append(symbol, copy);
      el.addEventListener("click", () => onPick(id)); (city === "support" ? supportLabels : salesLabels).append(el); elements[city].set(id, el);
    }
    el.querySelector("strong")!.textContent = name; el.querySelector("small")!.textContent = status; el.querySelector("span")!.textContent = icon;
    el.setAttribute("aria-label", `${name}. ${status}`);
  }
  /** The headquarters stage the server reports for a district (1 until its land state arrives). */
  const stageOf = (city: DepartmentId, district: string) => views[city]?.state.districts.find(d => d.id === district)?.hq.level ?? 1;
  function configure() {
    if (!config) return;
    const key = config.cities.map(c => `${c.id}:${c.districts.map(d => `${d.id}@${stageOf(c.id, d.id)}`).join(",")}`).join(";");
    if (key !== layoutKey) {
      for (const city of config.cities) {
        const root = city.id === "support" ? supportTeams : sales?.teams; if (!root) continue;
        disposeTree(root); root.clear(); materialSets.delete(root);
        // A district's headquarters stand in its centre (by its number, "support-team-2" → 2); a district beyond the
        // three of a city has no land, and none.
        const centres = grids[city.id]?.centres ?? [];
        city.districts.forEach(d => {
          const number = districtNumber(d.id), p = centres.find(c => c.district === number)?.hq;
          if (!p) { anchors[city.id].delete(d.id); return; }
          const site = new THREE.Group(); site.position.set(p.x, 0, p.z); site.rotation.y = p.rotation; root.add(site);
          headquarters(site, stageOf(city.id, d.id), HQ_COLOURS[(number - 1) % HQ_COLOURS.length]);
          anchors[city.id].set(d.id, new THREE.Vector3(p.x, [8, 9, 9, 10, 15][stageOf(city.id, d.id) - 1], p.z));
        });
        batch(root);
      }
      layoutKey = key; ctx.requestShadowUpdate();
    }
    for (const c of config.cities) {
      c.districts.forEach(d => {
        const number = districtNumber(d.id);
        label(c.id, d.id, d.name, `${d.supervisor ?? "Команда не назначена"} · штаб ${stageOf(c.id, d.id)}/5`, "⚑", preparedLand(number) ? districtColour(number) : undefined);
      });
      const head = railPoint(c.id === "support" ? supportLine : RAIL_LINES.sales, STATION.building, STATION.middle); anchors[c.id].set("station", new THREE.Vector3(head.x, 9.5, head.z));
      label(c.id, "station", "Вокзал", `Поезд в ${config.cities.find(other => other.id !== c.id)?.name ?? "другой город"}`, "▰");
    }
    if (sales) SALES_CENTERS.forEach((p, i) => label("sales", p.id, SALES_RESOURCES[i], "Место для учебного центра", "◇"));
    [supportTeams, supportRail.root, sales?.campus, sales?.teams, sales?.rail.root].forEach(root => { if (root) illuminate(root); });
  }
  const vector = new THREE.Vector3();
  return {
    show(id) {
      active = id;
      if (id === "sales" && !sales) { sales = salesRoot(); layoutKey = ""; configure(); }
      // Both trains wait at their platforms: the one that just left is back for the next trip (TZ §8.1).
      supportRail.position(0); sales?.rail.position(0);
      supportRoot.visible = id === "support"; supportOverlayNodes.forEach(n => { n.style.display = id !== "support" ? "none" : ""; });
      supportRail.root.visible = supportTeams.visible = id === "support"; supportLabels.hidden = id !== "support";
      salesLabels.hidden = id !== "sales"; if (sales) { sales.scene.visible = id === "sales"; if (id === "sales") sales.pools.update(); }
      estates.support?.setActive(id === "support"); estates.sales?.setActive(id === "sales");
      ctx.requestShadowUpdate();
    },
    setConfig(next) { config = next; configure(); },
    setEstates(city, view) {
      views[city] = view; estates[city]?.set(view);
      // A new headquarters stage rebuilds the headquarters, nothing else.
      configure();
    },
    setBuild(view) {
      build = view;
      for (const city of ["support", "sales"] as const) estates[city]?.setBuild(view && cityOf(view.district) === city ? view : null);
    },
    focusEstate: (target, distance, polar) => estates[cityOf(target.district)]?.focus(target, distance, polar) ?? null,
    frame(dt, now, moved) {
      if (active === "sales" && sales) { if (moved) sales.moves.forEach(cb => cb()); sales.frames.forEach(cb => cb(dt, now)); }
      const w = ctx.overlay.clientWidth, h = ctx.overlay.clientHeight;
      for (const [id, el] of elements[active]) {
        const point = anchors[active].get(id); if (!point) { el.style.visibility = "hidden"; continue; }
        vector.copy(point).project(ctx.camera);
        el.style.visibility = vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1.2 || Math.abs(vector.y) > 1.2 ? "hidden" : "visible";
        const size = THREE.MathUtils.clamp(78 / ctx.camera.position.distanceTo(point), .4, 1);
        el.style.transform = `translate(${(vector.x + 1) * w / 2}px,${(1 - vector.y) * h / 2}px) translate(-50%,-100%) scale(${size})`;
      }
    },
    point: id => anchors[active].get(id),
    railway: progress => (active === "support" ? supportRail : sales!.rail).position(progress),
    railView() {
      const line = active === "support" ? supportLine : sales?.line ?? RAIL_LINES.sales, back = Math.atan2(-line.dx, -line.dz);
      // Leaving: behind the train on the side away from the station. Arriving: from the hills, over the station to the town.
      return { departure: back - line.side * 1.05, arrival: back + Math.PI + line.side * .45 };
    },
    setNight(value) { night = value; sales?.water.setNight(value); [supportTeams, supportRail.root, sales?.campus, sales?.teams, sales?.rail.root].forEach(root => { if (root) illuminate(root); }); },
    setTraffic(value) { traffic = value; sales?.cars.setEnabled(value); sales?.crowd.setEnabled(value); },
    dispose() {
      disposed = true;
      estates.support?.dispose(); estates.sales?.dispose(); supportLand3d.removeFromParent();
      [...supportRoot.children].forEach(n => ctx.scene.add(n)); supportRoot.removeFromParent();
      supportLabels.remove(); salesLabels.remove(); supportRail.root.removeFromParent(); supportTeams.removeFromParent(); disposeTree(supportRail.root); disposeTree(supportTeams);
      if (sales) { sales.crowd.dispose(); sales.cars.dispose(); sales.pools.dispose(); sales.water.dispose(); sales.terrain.dispose(); sales.hills.dispose(); disposeTree(sales.campus); disposeTree(sales.teams); disposeTree(sales.rail.root); sales.scene.removeFromParent(); }
    },
  };
}
