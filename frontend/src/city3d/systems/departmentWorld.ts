/** Two departmental roots share the renderer, sky, camera and catalogue. Only the active root ticks. */
import * as THREE from "three/webgpu";
import type { CityWorld, DepartmentId } from "../../api/cityWorld";
import { SALES_RESOURCES } from "../../api/cityWorld";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import type { Model } from "../assets/loader";
import { createInstancePools } from "../render/instances";
import { createTerrain } from "../render/terrain";
import { createWater } from "../render/water";
import { createTraffic } from "./traffic";
import { createCrowd } from "./crowd";
import { disposeTree } from "./districts";
import { mergeStatic } from "../assets/landmarks";
import { generateSalesWorld, salesLand, SALES_CENTERS, supportLand, teamPositions } from "../world/sales";
import type { DistrictLand } from "../world/estates";
import { createEstates, type EstateFocus, type Estates } from "./estates";
import type { CityBuildView, CityEstateView, EstatePick } from "../types";

export interface DepartmentWorld {
  show(id: DepartmentId): void; setConfig(config: CityWorld): void;
  frame(dt: number, now: number, moved: boolean): void;
  setNight(night: boolean): void; setTraffic(active: boolean): void;
  point(id: string): THREE.Vector3 | undefined;
  railway(progress: number): THREE.Vector3;
  /** Team district land: buildings, projects and the headquarters stage of every district of a city. */
  setEstates(city: DepartmentId, view: CityEstateView | null): void;
  setBuild(view: CityBuildView | null): void;
  focusEstate(target: EstateFocus, distance: number, polar: number): { point: THREE.Vector3; azimuth: number } | null;
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
const HQ_COLOURS = ["#6b55c8", "#2f9e8f", "#d1823a", "#4b7fd6", "#c4568a", "#7a9a3c"];
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
function station(support: boolean) {
  const root = new THREE.Group(), fixed = new THREE.Group(), train = new THREE.Group(); root.add(fixed, train);
  const b = builder(fixed), t = builder(train);
  const length = support ? 328 : 170;
  // All local paths run towards +z; the support station faces +x along an elevated corridor.
  b(4.7, .55, length, 0, 4.2, length / 2, "#c0b8a8");
  for (const x of [-.55, .55]) b(.12, .12, length, x, 4.6, length / 2, DARK);
  for (let z = 1; z < length; z += 2) b(2.1, .12, .3, 0, 4.5, z, "#786b5b");
  for (let z = 12; z < length - 12; z += 18) b(1.1, 5.7, 1.2, 0, 1.1, z, "#b5b0a5");
  b(5, .6, 17, 4.4, 4.45, 4, WALL); b(5.4, .3, 15, 4.4, 7.2, 4, DARK);
  for (const z of [-1, 9]) for (const x of [2.6, 6.2]) b(.16, 2.5, .16, x, 5.85, z, GOLD);
  b(4, 2, 6, 5, 5.65, -5, WALL); b(3.5, 1.25, .15, 5, 5.9, -1.9, GLASS);
  for (let step = 0; step < 12; step++) b(4, .35 + step * .36, .6, 5, (.35 + step * .36) / 2, -15 + step * .6, WALL);
  const portalZ = length - 4;
  b(3.2, 10, 8, -3.7, 5, portalZ, "#888b7b"); b(3.2, 10, 8, 3.7, 5, portalZ, "#888b7b");
  b(10.6, 3, 8, 0, 10, portalZ, "#888b7b"); b(4.2, 6.8, .3, 0, 7, portalZ + 2, "#111e22");
  const hill = new THREE.Mesh(new THREE.ConeGeometry(24, 32, 7), new THREE.MeshStandardNodeMaterial({ color: "#6f8268", roughness: .95 }));
  hill.position.set(-17, 13, portalZ + 6); fixed.add(hill);
  for (let car = 0; car < 3; car++) {
    const z = -car * 4;
    t(1.8, 1.6, 3.6, 0, 5.6, z, WALL); t(1.88, .24, 3.65, 0, 5.25, z, "#6b55c8");
    t(1.9, .2, 3.7, 0, 6.48, z, DARK);
    for (const x of [-.91, .91]) for (const dz of [-1, 0, 1]) t(.06, .65, .65, x, 5.95, z + dz, GLASS);
    t(1.5, .7, .08, 0, 5.95, z + 1.81, GLASS);
    for (const dz of [-1.1, 1.1]) t(1.7, .32, .5, 0, 4.75, z + dz, DARK);
  }
  // mergeStatic copies its source geometries; free those originals after batching.
  const batch = (g: THREE.Group) => { const geometries = new Set<THREE.BufferGeometry>(); g.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); }); mergeStatic(g); geometries.forEach(v => v.dispose()); };
  batch(fixed); batch(train);
  if (support) { root.rotation.y = Math.PI / 2; root.position.x = 8; } else root.position.z = 48;
  return { root, train, length, position(progress: number) {
    train.position.z = Math.max(0, Math.min(1, progress)) * (length - 9);
    root.updateMatrixWorld(true); return root.localToWorld(new THREE.Vector3(0, 6, train.position.z));
  } };
}

export function createDepartmentWorld(ctx: CityContext, catalogue: Catalogue, models: Map<string, Model>, onPick: (id: string) => void, onEstate: (pick: EstatePick) => void = () => undefined): DepartmentWorld {
  let active: DepartmentId = "support", sales: ReturnType<typeof salesRoot> | undefined;
  const supportNodes = [...ctx.scene.children].filter(n => !(n instanceof THREE.Light));
  const supportRoot = new THREE.Group(); supportRoot.name = "support-city";
  supportNodes.forEach(n => supportRoot.add(n)); ctx.scene.add(supportRoot);
  const supportOverlayNodes = [...ctx.overlay.children] as HTMLElement[];
  const supportRail = station(true); ctx.scene.add(supportRail.root);
  const supportTeams = new THREE.Group(); ctx.scene.add(supportTeams);
  const supportLabels = document.createElement("div"), salesLabels = document.createElement("div");
  ctx.overlay.append(supportLabels, salesLabels);
  let config: CityWorld | undefined, layoutKey = "";
  // District land: the island city has it in its suburbs (the full map only), the lake city all round the lake.
  const lands: Partial<Record<DepartmentId, DistrictLand>> = { sales: salesLand() };
  if (ctx.world.spec.name === "x4") lands.support = supportLand(ctx.world.roads);
  const supportLand3d = new THREE.Scene(); supportLand3d.name = "support-districts"; supportRoot.add(supportLand3d);
  const estates: Partial<Record<DepartmentId, Estates>> = {};
  if (lands.support) { estates.support = createEstates({ ...ctx, scene: supportLand3d, overlay: supportLabels }, lands.support, onEstate); estates.support.setCatalogue(catalogue); }
  const views: Partial<Record<DepartmentId, CityEstateView | null>> = {};
  let build: CityBuildView | null = null;
  const anchors = { support: new Map<string, THREE.Vector3>(), sales: new Map<string, THREE.Vector3>() };
  const elements = { support: new Map<string, HTMLElement>(), sales: new Map<string, HTMLElement>() };
  let night = false, traffic = true;
  function illuminate(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material instanceof THREE.MeshStandardNodeMaterial && material.color.getHexString() === GLASS.slice(1)) {
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
    const rail = station(false); scene.add(rail.root);
    const land3d = createEstates(context, lands.sales!, onEstate); land3d.setCatalogue(catalogue);
    estates.sales = land3d; land3d.set(views.sales ?? null); land3d.setBuild(build && cityOf(build.district) === "sales" ? build : null);
    return { scene, frames, moves, terrain, water, pools, cars, crowd, campus, teams, rail, land3d };
  }
  const cityOf = (district: string): DepartmentId => district.startsWith("sales-") ? "sales" : "support";
  function batch(root: THREE.Group) {
    const originals = new Set<THREE.BufferGeometry>(); root.traverse(o => { if (o instanceof THREE.Mesh) originals.add(o.geometry); });
    mergeStatic(root); originals.forEach(g => g.dispose());
  }
  function label(city: DepartmentId, id: string, name: string, status: string, icon: string) {
    let el = elements[city].get(id);
    if (!el) {
      el = document.createElement("button"); (el as HTMLButtonElement).type = "button"; el.className = "c3-label"; el.dataset.worldObject = id;
      el.style.setProperty("--c3-district", city === "sales" ? "#c59437" : "#7965d5");
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
        const land = lands[city.id], points = land?.headquarters ?? teamPositions(city.districts.length, city.id === "support", ctx.world.roads.streets).map(p => ({ ...p, rotation: 0 }));
        city.districts.forEach((d, i) => {
          const p = points[i], site = new THREE.Group(); site.position.set(p.x, 0, p.z); site.rotation.y = p.rotation; root.add(site);
          headquarters(site, stageOf(city.id, d.id), HQ_COLOURS[i % HQ_COLOURS.length]);
          anchors[city.id].set(d.id, new THREE.Vector3(p.x, [8, 9, 9, 10, 15][stageOf(city.id, d.id) - 1], p.z));
        });
        batch(root);
      }
      layoutKey = key; ctx.requestShadowUpdate();
    }
    for (const c of config.cities) {
      c.districts.forEach(d => label(c.id, d.id, d.name, `${d.supervisor ?? "Команда не назначена"} · штаб ${stageOf(c.id, d.id)}/5`, "⚑"));
      anchors[c.id].set("station", c.id === "support" ? new THREE.Vector3(11, 10, -5) : new THREE.Vector3(5, 10, 52));
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
    setNight(value) { night = value; sales?.water.setNight(value); [supportTeams, supportRail.root, sales?.campus, sales?.teams, sales?.rail.root].forEach(root => { if (root) illuminate(root); }); },
    setTraffic(value) { traffic = value; sales?.cars.setEnabled(value); sales?.crowd.setEnabled(value); },
    dispose() {
      estates.support?.dispose(); estates.sales?.dispose(); supportLand3d.removeFromParent();
      [...supportRoot.children].forEach(n => ctx.scene.add(n)); supportRoot.removeFromParent();
      supportLabels.remove(); salesLabels.remove(); supportRail.root.removeFromParent(); supportTeams.removeFromParent(); disposeTree(supportRail.root); disposeTree(supportTeams);
      if (sales) { sales.crowd.dispose(); sales.cars.dispose(); sales.pools.dispose(); sales.water.dispose(); sales.terrain.dispose(); disposeTree(sales.campus); disposeTree(sales.teams); disposeTree(sales.rail.root); sales.scene.removeFromParent(); }
    },
  };
}
