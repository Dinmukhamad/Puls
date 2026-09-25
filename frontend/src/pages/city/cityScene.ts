import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createArchitecture } from "./cityArchitecture";
import { createTaxiModel } from "./cityTraffic";
import { createDistrictIslands } from "./cityIslands";
import maleUrl from "./models/operator-male.glb?url";
import femaleUrl from "./models/operator-female.glb?url";
import type { DistrictId } from "../../api/city";
import { districtLevel } from "./cityLevels";
import { BANK, CITY_LOCATIONS, DISTRICT_ISLAND_HEIGHT, DISTRICT_ISLAND_OUTLINE, DISTRICT_SCALE, HORIZON, OUTER_RING, PLAZA, PROMENADE, QUAY, RING_ROAD, SKYLINE_ANGLE, angularDistance, avenueAngles, crosswalks, innerRoads, islandLots, lampSpots, mainlandLots, parkingLots, rng, sampleRoute, trafficRoutes, treeSpots, type CityLocation, type Route } from "./cityLayout";
import modelsUrl from "./models/city-models.glb?url";
import vehiclesUrl from "./models/vehicles.glb?url";

export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean; level: number }
export interface CitySceneOptions {
  levels: Record<string, number>; selected: DistrictId; view?: CityView; labels: CityLabelInfo[];
  /** Districts that levelled up since the last visit: they grow in with a burst of confetti. */
  grown?: DistrictId[];
  /** Фигура в центре площади: робот Пульсар или оператор выбранного пола с именем помощника. */
  mascot?: CityMascot;
  /** The part of the screen the panels leave free; the city is centred there. */
  frame?: HTMLElement;
  onSelect: (id: DistrictId) => void; onView: (view: CityView) => void; onReady: () => void; onLost: () => void;
}
export interface CityMascot { gender: "male" | "female" | null; name: string }
export interface CitySceneControl { focusMascot: () => void; setMascot: (mascot: CityMascot) => void; setTraffic: (enabled: boolean) => void; dispose: () => void; select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void; zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void }

/** The default view looks over the depot at the CRM centre on the left and the academy on the right. */
export const DEFAULT_VIEW: CityView = { azimuth: -2.62, polar: .95, distance: 90, target: [0, 0, 1] };
const MIN_DISTANCE = 18, MAX_DISTANCE = 140, MIN_POLAR = .18, MAX_POLAR = 1.3, PAN_RADIUS = 40;
/** Car Kit vehicles are 1.5 units wide; this makes them fit a one-unit lane. */
const CAR_SCALE = .5;
const HOUSES = ["s-building-type-a", "s-building-type-b", "s-building-type-c", "s-building-type-d", "s-building-type-f", "s-building-type-g", "s-building-type-h", "s-building-type-k", "s-building-type-m", "s-building-type-p", "s-building-type-q", "s-building-type-t"];
const OFFICES = ["c-building-a", "c-building-c", "c-building-d", "c-building-f", "c-building-g", "c-building-h", "c-building-m", "c-building-n"];
/** Offices light enough to repeat along the mainland rows. */
const LIGHT_OFFICES = ["c-building-a", "c-building-c", "c-building-d", "c-building-f", "c-building-g", "c-building-h"];
const TOWERS = ["c-building-skyscraper-a", "c-building-skyscraper-b", "c-building-skyscraper-c", "c-building-skyscraper-d"];
const INDUSTRY = ["i-building-g", "i-building-h", "i-building-i", "i-building-g", "i-water-tower", "i-building-h"];
const TRAFFIC = ["taxi", "sedan", "taxi", "suv", "taxi", "van", "taxi", "delivery", "taxi", "hatchback-sports"];
const PARKED = [["taxi", "delivery", "van", "taxi", "truck", "suv"], ["sedan", "suv", "hatchback-sports", "taxi", "police", "sedan"], ["truck", "delivery", "van", "truck"]];
type Slots = Map<string, { matrix: THREE.Matrix4; fit: number }[]>;

export function createCityScene(host: HTMLDivElement, options: CitySceneOptions): CitySceneControl {
  const { levels } = options;
  let disposed = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let trafficEnabled = !reduced;
  // Phones and weak machines get fewer rows of buildings, fewer cars and a smaller shadow map.
  const lite = Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  // Phones draw at most 30 frames a second.
  const mobile = host.clientWidth < 600;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0); host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#d6e9ef", 118, 330);
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .09, minDistance: MIN_DISTANCE, maxDistance: MAX_DISTANCE, minPolarAngle: MIN_POLAR, maxPolarAngle: MAX_POLAR, screenSpacePanning: false, rotateSpeed: .75, zoomSpeed: .9, panSpeed: .8, zoomToCursor: true });
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  const spherical = new THREE.Spherical(), offset = new THREE.Vector3();
  function applyView(view: CityView) {
    controls.target.set(...view.target);
    spherical.set(view.distance, view.polar, view.azimuth);
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    camera.lookAt(controls.target);
  }
  function currentView(): CityView {
    spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
    return { azimuth: spherical.theta, polar: spherical.phi, distance: spherical.radius, target: [controls.target.x, controls.target.y, controls.target.z] };
  }

  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; scene.environmentIntensity = .28;
  room.dispose(); pmrem.dispose();
  // A low, warm sun gives the landmarks a lit face and a readable, directional shadow.
  // One shadow-casting light covers the playable island; distant scenery keeps cheap contact shadows.
  scene.add(new THREE.HemisphereLight("#c9e6ff", "#71825a", .8));
  const sun = new THREE.DirectionalLight("#fff0ce", 3.6);
  sun.name = "city-afternoon-sun";
  sun.position.set(-32, 42, -28); sun.castShadow = true; sun.shadow.mapSize.setScalar(lite ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -43, right: 43, top: 43, bottom: -43, near: 1, far: 140 }); sun.shadow.normalBias = .025; sun.shadow.bias = -.0001; sun.shadow.radius = 2; scene.add(sun);

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const disposables: { dispose: () => void }[] = [];
  function material(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .04, ...extra }));
    return materials.get(key)!;
  }
  const world = new THREE.Group(); scene.add(world);
  function mesh(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = world, extra?: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.Mesh(geometry, material(color, extra)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const box = (w: number, h: number, d: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => { const m = mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z, p); if (Math.min(w, h, d) < .07) m.castShadow = false; return m; };
  const cyl = (r: number, h: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D, n = 32) => mesh(new THREE.CylinderGeometry(r, r, h, n), c, x, y, z, p);
  const sphere = (r: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => mesh(new THREE.SphereGeometry(r, 18, 14), c, x, y, z, p);
  const tint = (color: string, amount: number) => "#" + new THREE.Color(color).lerp(new THREE.Color(amount > 0 ? "#ffffff" : "#1c1830"), Math.abs(amount)).getHexString();
  /** A flat ring or disc lying on the ground at height `y`. */
  const flat = (geometry: THREE.BufferGeometry, color: string, y: number, extra?: THREE.MeshStandardMaterialParameters) => { const m = mesh(geometry, color, 0, y, 0, world, extra); m.rotation.x = -Math.PI / 2; m.castShadow = false; return m; };
  const canvasTexture = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; draw(canvas.getContext("2d")!);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; disposables.push(texture); return texture;
  };
  /** One draw call for many copies: `transforms` places each copy, `colors` tints it. */
  function instanced(geometry: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], transforms: THREE.Matrix4[], { shadow = false, receive = true, colors }: { shadow?: boolean; receive?: boolean; colors?: THREE.Color[] } = {}) {
    const m = new THREE.InstancedMesh(geometry, mat, Math.max(1, transforms.length));
    transforms.forEach((t, i) => { m.setMatrixAt(i, t); if (colors) m.setColorAt(i, colors[i % colors.length]); });
    m.count = transforms.length; m.castShadow = shadow; m.receiveShadow = receive; world.add(m); return m;
  }
  const place = (x: number, y: number, z: number, rotation = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(sx, sy, sz));
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => { if (!map.has(key)) map.set(key, []); map.get(key)!.push(value); };

  // Island with a stone quay, the canal and the mainland beyond it.
  const waves = canvasTexture(256, 256, ctx => {
    ctx.fillStyle = "#d3e3e8"; ctx.fillRect(0, 0, 256, 256);
    const random = rng(5); ctx.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = random() * 256, y = random() * 256, w = 10 + random() * 26;
      ctx.strokeStyle = random() < .7 ? "#ffffff" : "#b9ced5"; ctx.lineWidth = 1.5 + random() * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y - 3, x + w, y); ctx.stroke();
    }
  });
  waves.wrapS = waves.wrapT = THREE.RepeatWrapping; waves.repeat.set(9, 9);
  const waterMaterial = new THREE.MeshStandardMaterial({ color: "#6dabab", roughness: .25, metalness: .25, map: waves }); disposables.push(waterMaterial);
  const water = new THREE.Mesh(new THREE.RingGeometry(QUAY - .6, BANK + .6, 180, 1), waterMaterial);
  water.rotation.x = -Math.PI / 2; water.position.y = -1.25; water.receiveShadow = true; world.add(water);
  mesh(new THREE.CylinderGeometry(QUAY, QUAY + .25, 1.9, 140), "#d4cab6", 0, -.8, 0);
  mesh(new THREE.CylinderGeometry(QUAY - .32, QUAY - .32, .3, 140), "#8ba67a", 0, .05, 0).castShadow = false;
  flat(new THREE.RingGeometry(PROMENADE - .5, PROMENADE + .5, 180, 1), "#eadfc8", .215);
  const bank = new THREE.Mesh(new THREE.CylinderGeometry(BANK, BANK, 1.9, 180, 1, true), material("#d4cab6", { side: THREE.BackSide }));
  bank.position.y = -.75; bank.receiveShadow = true; world.add(bank);
  flat(new THREE.RingGeometry(BANK, 720, 200, 1), "#86a174", .2);
  flat(new THREE.RingGeometry(BANK, BANK + 1, 200, 1), "#eadfc8", .21);

  // Roads: the plaza, two ring roads, streets to the districts and avenues over the canal.
  const ROAD = "#6d7385", streets = new THREE.Group(); world.add(streets);
  const architecture = createArchitecture();
  const plaza = cyl(PLAZA, .12, "#efe7d6", 0, .25, 0, world, 64); plaza.castShadow = false; architecture.plaza(world);
  for (const r of [RING_ROAD, OUTER_RING]) flat(new THREE.RingGeometry(r - 1, r + 1, r > 40 ? 240 : 160, 1), ROAD, .215);
  const marks: THREE.Matrix4[] = [];
  for (const [radius, count] of [[RING_ROAD, 110], [OUTER_RING, 150]] as const) for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2; marks.push(place(Math.cos(a) * radius, .225, Math.sin(a) * radius, -a, .14, .02, .72)); }
  function road(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz), angle = Math.atan2(dx, dz);
    const kerb = box(2.65, .08, length, "#e5dfcf", (ax + bx) / 2, .18, (az + bz) / 2, streets); kerb.rotation.y = angle; kerb.castShadow = false;
    const r = box(2, .06, length, ROAD, (ax + bx) / 2, .23, (az + bz) / 2, streets); r.rotation.y = angle; r.castShadow = false;
    for (let t = 1.2; t < length - .8; t += 2.2) marks.push(place(ax + dx * t / length, .265, az + dz * t / length, angle, .14, .02, .8));
  }
  for (const [ax, az, bx, bz] of innerRoads()) road(ax, az, bx, bz);
  for (const a of avenueAngles()) {
    const c = Math.cos(a), s = Math.sin(a), along = Math.atan2(c, s);
    road(c * 26, s * 26, c * (QUAY - .2), s * (QUAY - .2));
    road(c * (BANK + .2), s * (BANK + .2), c * HORIZON, s * HORIZON);
    // Stone arch bridge over the canal; the deck carries the avenue.
    const bridge = new THREE.Group(), mid = (QUAY + BANK) / 2, span = BANK - QUAY + 1.4;
    bridge.position.set(c * mid, 0, s * mid); bridge.rotation.y = along; streets.add(bridge);
    box(2.3, .3, span, ROAD, 0, .11, 0, bridge).castShadow = false;
    for (const side of [-1, 1]) box(.24, .42, span, "#e8e1d2", side * 1.27, .36, 0, bridge);
    for (let t = -span / 2 + .8; t < span / 2 - .4; t += 2.2) marks.push(place(c * (mid + t), .265, s * (mid + t), along, .14, .02, .8));
    const arch = new THREE.Shape();
    arch.moveTo(-span / 2, 0); arch.lineTo(span / 2, 0); arch.lineTo(span / 2, -1.95); arch.lineTo(2.56, -1.95);
    arch.absarc(0, -2.95, 2.75, .372, Math.PI - .372, false); arch.lineTo(-span / 2, -1.95); arch.closePath();
    const wall = new THREE.ExtrudeGeometry(arch, { depth: 2.44, bevelEnabled: false }); wall.rotateY(-Math.PI / 2); wall.translate(1.22, -.04, 0);
    mesh(wall, "#dcd3c1", 0, 0, 0, bridge);
  }
  // Zebra crossings where streets meet the plaza and the ring roads.
  for (const w of crosswalks()) for (let k = -2; k <= 2; k++) marks.push(place(w.x + Math.cos(w.angle) * k * .4, .268, w.z - Math.sin(w.angle) * k * .4, w.angle, .24, .02, .95));

  // Car parks with painted stalls; the cars themselves arrive with the vehicle models.
  const parking = parkingLots();
  for (const lot of parking) {
    const pad = box(lot.depth + .4, .05, lot.length + .4, "#7c8292", lot.x, .225, lot.z, streets); pad.rotation.y = lot.angle; pad.castShadow = false;
    for (const stall of lot.stalls) for (const side of [-.55, .55]) marks.push(place(stall.x + Math.sin(lot.angle) * side, .255, stall.z + Math.cos(lot.angle) * side, stall.rotation, .05, .02, 1.5));
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  instanced(unit, material("#f7f3e8", { roughness: .9 }), marks);
  mergeStatic(streets);

  // Street lamps: a pole and a warm glowing lamp.
  const lamps = lampSpots().map(p => place(p.x, .2, p.z));
  const pole = new THREE.CylinderGeometry(.035, .05, 1.3, 6); pole.translate(0, .65, 0);
  const bulb = new THREE.SphereGeometry(.11, 10, 8); bulb.translate(0, 1.36, 0);
  instanced(pole, material("#5f6678"), lamps);
  instanced(bulb, material("#fff3c4", { emissive: "#ffe08a", emissiveIntensity: .9 }), lamps);

  // Trees: two kinds of low-poly trees, each tinted a little differently.
  function treeGeometry(round: boolean) {
    const paint = (g: THREE.BufferGeometry, color: string) => {
      const c = new THREE.Color(color), part = g.index ? g.toNonIndexed() : g, n = part.getAttribute("position").count, colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      part.setAttribute("color", new THREE.BufferAttribute(colors, 3)); part.deleteAttribute("uv"); return part;
    };
    const trunk = new THREE.CylinderGeometry(.08, .11, .8, 6); trunk.translate(0, .4, 0);
    const parts = [paint(trunk, "#8a6a55")];
    if (round) { const crown = new THREE.IcosahedronGeometry(.62, 1); crown.translate(0, 1.3, 0); parts.push(paint(crown, "#799363")); }
    else { const low = new THREE.ConeGeometry(.6, 1.3, 8); low.translate(0, 1.3, 0); const high = new THREE.ConeGeometry(.44, 1, 8); high.translate(0, 1.9, 0); parts.push(paint(low, "#517b60"), paint(high, "#789465")); }
    const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged;
  }
  const { lots: outskirts, parks } = mainlandLots(lite);
  const treeTint = ["#ffffff", "#eaf6e2", "#f7ffe8", "#dfeed7", "#fff6dc"].map(c => new THREE.Color(c));
  const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true }); disposables.push(treeMaterial);
  const trees = treeSpots(lite, parks), coneTree = treeGeometry(false), roundTree = treeGeometry(true);
  // Only trees on the island are inside the sun's shadow map, so only they cast shadows.
  for (const round of [false, true]) for (const island of [true, false]) {
    const list = trees.filter(t => t.round === round && (Math.hypot(t.x, t.z) < QUAY) === island);
    instanced(round ? roundTree : coneTree, treeMaterial, list.map(t => place(t.x, .2, t.z, t.x * 3.1, t.scale)), { shadow: island && !lite, colors: list.map((_, i) => treeTint[(i * 7) % treeTint.length]) });
  }
  // Soft round shadows ground the far buildings and trees that the sun's shadow map does not reach.
  const blob = canvasTexture(64, 64, ctx => { const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32); g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
  const blobMaterial = new THREE.MeshBasicMaterial({ map: blob, color: "#23402c", transparent: true, depthWrite: false, opacity: .5 }); disposables.push(blobMaterial);
  const blobPlane = new THREE.PlaneGeometry(1, 1); blobPlane.rotateX(-Math.PI / 2);
  instanced(blobPlane, blobMaterial, [...outskirts.map(l => place(l.x, .209, l.z, l.rotation, l.width * 1.25)), ...trees.filter(t => Math.hypot(t.x, t.z) > QUAY).map(t => place(t.x, .209, t.z, 0, 1.5 * t.scale))], { receive: false });

  // Ordinary blocks inside the ring: Kenney models once they load, simple shapes if they cannot.
  const lots = islandLots();
  function facadeTexture(floors: number, glass: boolean) {
    return canvasTexture(64, 64 * floors, ctx => {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 64, 64 * floors);
      for (let f = 0; f < floors; f++) for (let c = 0; c < 3; c++) { ctx.fillStyle = (f * 3 + c) % 7 === 0 ? "#ffe9a8" : glass ? "#8fb3dc" : "#9aabc4"; ctx.fillRect(6 + c * 19, f * 64 + 14, 14, 30); }
    });
  }
  const facadeMaterials = new Map<string, THREE.Material[]>();
  function facadeMaterial(color: string, floors: number, glass: boolean) {
    const key = `${color}:${floors}:${glass}`;
    if (!facadeMaterials.has(key)) {
      const side = new THREE.MeshStandardMaterial({ color, map: facadeTexture(floors, glass), roughness: glass ? .35 : .8, metalness: glass ? .2 : .02 }), top = material(tint(color, -.12));
      disposables.push(side); facadeMaterials.set(key, [side, side, top, top, side, side]);
    }
    return facadeMaterials.get(key)!;
  }
  function tree(x: number, z: number, s: number, p: THREE.Object3D) {
    cyl(.1 * s, .8 * s, "#8a6a55", x, .6 * s, z, p, 7);
    const crown = mesh(new THREE.ConeGeometry(.55 * s, 1.3 * s, 9), "#5fae6e", x, 1.45 * s, z, p); crown.rotation.y = x;
    mesh(new THREE.ConeGeometry(.42 * s, 1 * s, 9), "#78c282", x, 1.95 * s, z, p);
  }
  const walls = ["#f3e6d3", "#e9eef5", "#f6d9cf", "#dfe9dd", "#ece4f4", "#f4efe2"], roofs = ["#c7775d", "#8a6f9e", "#5f7f9c", "#a3685a"];
  function simpleBlocks() {
    for (const lot of lots) {
      const g = new THREE.Group(); g.position.set(lot.x, .2, lot.z); g.rotation.y = lot.rotation; world.add(g);
      if (lot.roll < .1) { tree(0, 0, 1.3, g); continue; }
      if (lot.roll < .45) {
        const w = 1.8 + lot.size * .6, h = 1.2 + lot.pick * .6;
        box(w, h, w * .9, walls[Math.floor(lot.pick * walls.length)], 0, h / 2, 0, g);
        const roof = mesh(new THREE.ConeGeometry(w * .78, .9, 4), roofs[Math.floor(lot.size * roofs.length)], 0, h + .45, 0, g); roof.rotation.y = Math.PI / 4;
      } else {
        const glass = lot.roll > .8, floors = glass ? 7 + Math.floor(lot.size * 4) : 3 + Math.floor(lot.size * 4), h = floors * .75, w = glass ? 2.1 : 2.5;
        const color = glass ? ["#b8cbe3", "#a9c4d8", "#c4c9e6"][Math.floor(lot.pick * 3)] : walls[Math.floor(lot.pick * walls.length)];
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), facadeMaterial(color, floors, glass)); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
        box(w + .15, .15, w + .15, tint(color, -.25), 0, h + .07, 0, g);
      }
    }
  }
  // Far blocks and the skyline are plain boxes with painted windows: four heights, tinted per building.
  const BLOCKS = [{ floors: 4, height: 3, glass: false }, { floors: 7, height: 5.2, glass: false }, { floors: 11, height: 8.4, glass: true }, { floors: 18, height: 13.6, glass: true }];
  function blockKind(lot: { zone: string; pick: number; x: number; z: number }) {
    if (lot.zone !== "towers") return lot.pick < .55 ? 0 : lot.pick < .9 ? 1 : 2;
    return angularDistance(Math.atan2(lot.z, lot.x), SKYLINE_ANGLE) < .75 ? (lot.pick < .4 ? 2 : 3) : (lot.pick < .5 ? 1 : 2);
  }
  const block = new THREE.BoxGeometry(1, 1, 1); block.translate(0, .5, 0);
  function plainBlocks(list: typeof outskirts) {
    BLOCKS.forEach((kind, index) => {
      const own = list.filter(l => blockKind(l) === index); if (!own.length) return;
      const top = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: .85 }), side = new THREE.MeshStandardMaterial({ color: "#ffffff", map: facadeTexture(kind.floors, kind.glass), roughness: kind.glass ? .4 : .85, metalness: kind.glass ? .15 : 0 });
      disposables.push(top, side);
      const palette = (kind.glass ? ["#b8cbe3", "#a9c4d8", "#c4c9e6", "#d5dde8"] : walls).map(c => new THREE.Color(c));
      instanced(block, [side, side, top, top, side, side], own.map(l => { const w = Math.min(l.width, kind.glass ? 3.4 : 3.8) * (.82 + l.size * .18); return place(l.x, .2, l.z, l.rotation, w, kind.height * (.9 + l.size * .2), w * (.8 + l.pick * .2)); }), { colors: own.map((_, i) => palette[(i * 5) % palette.length]) });
    });
  }

  // Центр площади: робот Пульсар или оператор, которого выбрал пользователь, с табличкой имени.
  const mascotRoot = new THREE.Group(); mascotRoot.position.set(0, .3, 0); mascotRoot.scale.setScalar(2.4); world.add(mascotRoot);
  cyl(.91, .12, "#aa8752", 0, .04, 0, mascotRoot, 48);
  cyl(.86, .23, "#324751", 0, .18, 0, mascotRoot, 48);
  cyl(.81, .06, "#ede4cf", 0, .325, 0, mascotRoot, 48);
  let figure = new THREE.Group(), nameTag: THREE.Sprite | null = null;
  function clearFigure() {
    figure.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    mascotRoot.remove(figure); figure = new THREE.Group(); mascotRoot.add(figure);
  }
  function buildRobot() {
    const head = sphere(.55, "#b1b4b9", 0, 1.05, 0, figure); head.scale.set(1.1, .92, .8);
    const face = sphere(.42, "#22242a", 0, 1.08, .26, figure); face.scale.set(1, .64, .35);
    sphere(.08, "#9ff5ea", -.16, 1.12, .4, figure); sphere(.08, "#9ff5ea", .16, 1.12, .4, figure);
    cyl(.04, .32, "#b6b9be", 0, 1.6, 0, figure); sphere(.09, "#ffd976", 0, 1.8, 0, figure);
    sphere(.28, "#9a9ea6", 0, .52, 0, figure);
  }
  let characterMixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let waveAction: THREE.AnimationAction | null = null;
  let nextWave = 0, characterRequest = 0;
  function buildOperator(gender: "male" | "female") {
    const request = ++characterRequest;
    const loader = new GLTFLoader();
    loader.loadAsync(gender === "female" ? femaleUrl : maleUrl).then(gltf => {
      if (disposed || request !== characterRequest) { disposeCharacter(gltf.scene); return; }
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
      model.scale.setScalar(2.25 / size.y);
      model.position.y = .36 - bounds.min.y * model.scale.x;
      model.traverse(o => {
        if (o instanceof THREE.Mesh) {
          const original = o.geometry;
          original.deleteAttribute('normal');
          o.geometry = mergeVertices(original, .0001); o.geometry.computeVertexNormals(); original.dispose();
          o.castShadow = o.receiveShadow = true;
          for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.roughness = .72;
              if (['Red_Dark', 'Orange'].includes(material.name)) material.color.set('#36596a');
              if (material.name === 'White') material.color.set('#e8e2d5');
            }
          }
        }
      });
      const head = model.getObjectByName('Head');
      if (head) {
        const headset = new THREE.Group(); headset.position.set(0, .095, gender === 'male' ? -.03 : .005); head.add(headset);
        const band = new THREE.Mesh(new THREE.TorusGeometry(.139, .014, 8, 32, Math.PI), new THREE.MeshStandardMaterial({color:'#28383f',roughness:.4})); headset.add(band);
        for (const side of [-1, 1]) {
          const ear = new THREE.Mesh(new THREE.CylinderGeometry(.046,.046,.035,16),band.material);ear.rotation.z=Math.PI/2;ear.position.x=side*.137;headset.add(ear);
        }
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(.145,-.025,.02),new THREE.Vector3(.13,-.08,.1),new THREE.Vector3(.04,-.095,.16)]);
        const mic = new THREE.Mesh(new THREE.TubeGeometry(curve,12,.008,6,false),band.material);headset.add(mic);
      }
      figure.add(model);
      characterMixer = new THREE.AnimationMixer(model);
      const idle = gltf.animations.find(a => a.name === 'Idle_Neutral'), hello = gltf.animations.find(a => a.name === 'Wave');
      if (idle) { idleAction = characterMixer.clipAction(idle); idleAction.play(); }
      // Keep the resting pose even when the user has disabled motion.
      characterMixer.update(0);
      if (hello) { waveAction = characterMixer.clipAction(hello); waveAction.setLoop(THREE.LoopOnce, 1); waveAction.clampWhenFinished = false; }
      nextWave = performance.now() + 2500;
      characterMixer.addEventListener('finished', () => { waveAction?.fadeOut(.4); idleAction?.reset().fadeIn(.4).play(); });
      host.dataset.character = gender;
    }).catch(() => { if (!disposed && request === characterRequest) { buildRobot(); host.dataset.character = 'fallback'; } });
  }
  function disposeCharacter(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
  function drawNameTag(name: string) {
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "700 60px system-ui, -apple-system, Segoe UI, sans-serif";
    const width = Math.min(900, Math.ceil(ctx.measureText(name).width) + 150);
    canvas.width = width; canvas.height = 128;
    ctx.font = "700 60px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#17191eea"; ctx.beginPath(); ctx.roundRect(4, 14, width - 8, 100, 50); ctx.fill();
    ctx.fillStyle = "#ffd21f"; ctx.beginPath(); ctx.arc(62, 64, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle"; ctx.fillText(name, 96, 66);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    if (nameTag) { (nameTag.material as THREE.SpriteMaterial).map?.dispose(); (nameTag.material as THREE.SpriteMaterial).dispose(); world.remove(nameTag); }
    nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
    nameTag.scale.set(1.35 * width / 128, 1.35, 1); nameTag.position.set(0, 7.4, 0); nameTag.renderOrder = 5; world.add(nameTag);
  }
  let currentGender: CityMascot["gender"] | undefined;
  function setMascot(next: CityMascot) {
    if (currentGender === next.gender) { drawNameTag(next.name); return; }
    currentGender = next.gender;
    characterRequest++;
    characterMixer?.stopAllAction(); characterMixer = null; idleAction = waveAction = null;
    disposeCharacter(figure); clearFigure();
    if (next.gender) buildOperator(next.gender); else buildRobot();
    drawNameTag(next.name);
  }
  setMascot(options.mascot ?? { gender: null, name: "Пульсар" });

  // Kenney models (CC0): district details are cloned, the ordinary blocks are drawn as instances.
  let models: Map<string, THREE.Object3D> | null = null;
  /**
   * Static parts built from many small meshes (district buildings, the mascot) are merged per material:
   * a construction site is dozens of boxes but only a dozen draw calls. `keep` marks animated parts.
   */
  function mergeStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false) {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert(), groups = new Map<string, { material: THREE.Material; shadow: boolean; parts: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep(p)) return;
      const key = o.material.uuid + (o.castShadow ? ":shadow" : "");
      if (!groups.has(key)) groups.set(key, { material: o.material, shadow: o.castShadow, parts: [], meshes: [] });
      const part = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
      part.deleteAttribute("uv"); groups.get(key)!.parts.push(part); groups.get(key)!.meshes.push(o);
    });
    groups.forEach(({ material: mat, shadow, parts, meshes }) => {
      const merged = meshes.length > 1 ? mergeGeometries(parts) : null; parts.forEach(p => p.dispose());
      if (!merged) return;
      for (const m of meshes) { m.parent?.remove(m); m.geometry.dispose(); }
      const m = new THREE.Mesh(merged, mat); m.castShadow = shadow; m.receiveShadow = true; root.add(m);
    });
  }
  /** Parts of a model with their matrices inside it, centred on the footprint and scaled to `fit` units. */
  function modelParts(source: THREE.Object3D, fit = 0) {
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const scale = fit ? Math.min(2.8, fit / Math.max(size.x, size.z)) : 1, base = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }[] = [];
    source.traverse(o => { if (o instanceof THREE.Mesh) parts.push({ geometry: o.geometry, material: o.material, matrix: base.clone().multiply(o.matrixWorld) }); });
    return parts;
  }
  /** Instances of catalogue models: `slots` lists where the copies of each model stand and the footprint they fill. */
  function drawModels(catalogue: Map<string, THREE.Object3D>, slots: Slots, shadow: boolean) {
    slots.forEach((list, name) => {
      const source = catalogue.get(name); if (!source) return;
      const byFit = new Map<string, THREE.Matrix4[]>();
      for (const slot of list) push(byFit, String(slot.fit), slot.matrix);
      byFit.forEach((matrices, fit) => { for (const part of modelParts(source, Number(fit))) instanced(part.geometry, part.material, matrices.map(m => m.clone().multiply(part.matrix)), { shadow }); });
    });
  }
  function modelBlocks(catalogue: Map<string, THREE.Object3D>) {
    const island: Slots = new Map();
    for (const lot of lots) {
      const list = lot.roll < .08 ? ["s-tree-large"] : lot.r > 17 ? (lot.roll < .8 ? HOUSES : OFFICES) : lot.roll > .88 ? TOWERS : lot.roll < .3 ? HOUSES : OFFICES;
      const name = list[Math.floor(lot.pick * list.length)];
      if (name === "s-tree-large") { for (const [dx, dz] of [[-.6, -.4], [.6, .3], [0, .8]]) push(island, name, { matrix: place(lot.x + dx, .2, lot.z + dz, lot.rotation, 3.4 + lot.size), fit: 0 }); continue; }
      push(island, name, { matrix: place(lot.x, .2, lot.z, lot.rotation), fit: 2.6 });
    }
    drawModels(catalogue, island, true);
    // The mainland rows that the default view shows get detailed models; phones keep the nearest one.
    const detailed = new Set(outskirts.filter(l => (l.zone === "houses" || l.zone === "industry") && l.r < (lite ? 50 : 92))), mainland: Slots = new Map();
    for (const lot of detailed) {
      const list = lot.zone === "industry" ? INDUSTRY : lot.roll < .8 ? HOUSES : LIGHT_OFFICES;
      push(mainland, list[Math.floor(lot.pick * list.length)], { matrix: place(lot.x, .2, lot.z, lot.rotation), fit: Math.round(lot.width * 2) / 2 });
    }
    drawModels(catalogue, mainland, false);
    plainBlocks(outskirts.filter(l => !detailed.has(l)));
  }

  // Recognizable landmarks gain architectural detail over five levels.
  const pickables: THREE.Object3D[] = [];
  const anchors = new Map<DistrictId, THREE.Vector3>();
  const rings = new Map<DistrictId, THREE.Mesh>();
  const districtGroups = new Map<DistrictId, THREE.Group>();
  const stages = new Map<DistrictId, number>(CITY_LOCATIONS.map(d => [d.id, districtLevel(levels[d.id] ?? 0, d.soon)]));
  world.add(createDistrictIslands());
  function building(d: CityLocation) {
    const stage = stages.get(d.id)!;
    const { group: g, height } = architecture.landmark(d.id, stage, !!d.soon);
    g.position.set(d.x, .2 + DISTRICT_ISLAND_HEIGHT, d.z); g.scale.setScalar(DISTRICT_SCALE); g.rotation.y = Math.atan2(-d.x, -d.z);
    g.userData.district = d.id; world.add(g); districtGroups.set(d.id, g);
    const outline = new THREE.CurvePath<THREE.Vector3>();
    DISTRICT_ISLAND_OUTLINE.forEach((p, i) => {
      const next = DISTRICT_ISLAND_OUTLINE[(i + 1) % DISTRICT_ISLAND_OUTLINE.length];
      outline.add(new THREE.LineCurve3(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(next.x, 0, next.z)));
    });
    const ring = new THREE.Mesh(new THREE.TubeGeometry(outline, 100, .075, 6, true), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0 }));
    ring.rotation.y = g.rotation.y; ring.position.set(d.x, .32 + DISTRICT_ISLAND_HEIGHT, d.z); world.add(ring); rings.set(d.id, ring);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, height * DISTRICT_SCALE, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(d.x, .2 + DISTRICT_ISLAND_HEIGHT + height * DISTRICT_SCALE / 2, d.z); hit.userData.district = d.id; world.add(hit); pickables.push(hit);
    anchors.set(d.id, new THREE.Vector3(d.x, .2 + DISTRICT_ISLAND_HEIGHT + height * DISTRICT_SCALE + .7, d.z));
  }
  CITY_LOCATIONS.forEach(building);


  // Each vehicle has one route position and several batched visual parts.
  // Locally generated taxis remain available even if the optional vehicle catalogue cannot load.
  interface Mover { route: Route; s: number; speed: number; parts: { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4 }[]; boat: boolean }
  const movers: Mover[] = [], trafficMeshes: THREE.InstancedMesh[] = [];
  let carShadows: THREE.InstancedMesh | null = null;
  const plans = trafficRoutes(lite), roadY = (x: number, z: number) => { const r = Math.hypot(x, z); return Math.abs(r - RING_ROAD) < 1.05 || Math.abs(r - OUTER_RING) < 1.05 ? .215 : .26; };
  const taxi = createTaxiModel(), boat = new THREE.Group();
  {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1, .36, 2.1), material("#ffffff")); hull.position.y = .18;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.02, .08, 2.12), material("#3f78d8")); stripe.position.y = .3;
    const top = new THREE.Mesh(new THREE.BoxGeometry(.6, .34, .7), material("#f4efe4")); top.position.set(0, .53, -.25);
    boat.add(hull, stripe, top);
  }
  function buildTraffic(catalogue: Map<string, THREE.Object3D> | null) {
    for (const m of trafficMeshes) { world.remove(m); m.dispose(); }
    trafficMeshes.length = 0; movers.length = 0;
    const slots = new Map<string, { plan: typeof plans[number]; offset: number }[]>();
    let n = 0;
    // Loops start at different phases, so cars are spread over the map from the first frame.
    plans.forEach((plan, i) => {
      const onMainRing = !plan.boats && plan.route.points.every(p => Math.abs(Math.hypot(p.x, p.z) - RING_ROAD) < 1);
      const count = onMainRing ? (lite ? 8 : 12) : plan.cars;
      for (let k = 0; k < count; k++) push(slots, plan.boats ? "boat" : !catalogue || (onMainRing && k % 4 !== 3) ? "taxi" : TRAFFIC[n++ % TRAFFIC.length], { plan, offset: (k / count + i * .618) % 1 });
    });
    slots.forEach((list, name) => {
      const source = name === "boat" ? boat : name === "taxi" ? taxi : catalogue?.get(name) ?? taxi;
      const vehicles: Mover[] = list.map(slot => ({ route: slot.plan.route, s: slot.offset * slot.plan.route.length, speed: slot.plan.speed, parts: [], boat: name === "boat" }));
      movers.push(...vehicles);
      modelParts(source).forEach(part => {
        const m = instanced(part.geometry, part.material, list.map(() => new THREE.Matrix4()), { shadow: name !== "boat", receive: true });
        m.name = `city-traffic-${name}`;
        m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); trafficMeshes.push(m);
        vehicles.forEach((vehicle, index) => vehicle.parts.push({ mesh: m, index, base: part.matrix }));
      });
    });
    carShadows?.dispose(); if (carShadows) world.remove(carShadows);
    carShadows = instanced(blobPlane, blobMaterial, movers.filter(item => !item.boat).map(() => new THREE.Matrix4()), { receive: false });
    carShadows.frustumCulled = false; carShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    moveTraffic(0, 0);
  }
  const moverMatrix = new THREE.Matrix4(), moverPosition = new THREE.Vector3(), moverScale = new THREE.Vector3(), moverTurn = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  function moveTraffic(dt: number, now: number) {
    let shadow = 0;
    for (const item of movers) {
      item.s = (item.s + item.speed * dt) % item.route.length;
      const p = sampleRoute(item.route, item.s);
      moverPosition.set(p.x, item.boat ? -1.36 + Math.sin(now / 600 + item.s) * .04 : roadY(p.x, p.z), p.z);
      moverTurn.setFromAxisAngle(yAxis, p.heading); moverScale.setScalar(p.hidden ? 0 : item.boat ? .75 : CAR_SCALE);
      for (const part of item.parts) part.mesh.setMatrixAt(part.index, moverMatrix.compose(moverPosition, moverTurn, moverScale).multiply(part.base));
      // Exactly one contact shadow per car, complementing its directional sun shadow.
      if (!item.boat && carShadows) { moverScale.set(p.hidden ? 0 : .95, 1, p.hidden ? 0 : 1.7); moverPosition.y += .012; carShadows.setMatrixAt(shadow++, moverMatrix.compose(moverPosition, moverTurn, moverScale)); }
    }
    for (const m of trafficMeshes) m.instanceMatrix.needsUpdate = true;
    if (carShadows) carShadows.instanceMatrix.needsUpdate = true;
  }
  function parkedVehicles(catalogue: Map<string, THREE.Object3D>) {
    const random = rng(11), slots: Slots = new Map();
    parking.forEach((lot, i) => lot.stalls.forEach((stall, k) => {
      if (random() < (i === 2 ? .5 : .35) || (lite && i === 2)) return;
      const list = PARKED[i]; push(slots, list[(k * 7 + i) % list.length], { matrix: place(stall.x, .25, stall.z, stall.rotation, CAR_SCALE), fit: 0 });
    }));
    drawModels(catalogue, slots, false);
  }
  buildTraffic(null);

  let selected = options.selected, hovered: DistrictId | null = null;
  // Billboards on the roofs carry the district names and always turn towards the camera.
  let labels = options.labels;
  const boards = new Map<DistrictId, { group: THREE.Group; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  for (const d of CITY_LOCATIONS) {
    const group = new THREE.Group(), anchor = anchors.get(d.id)!; group.position.copy(anchor); world.add(group);
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 368;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.5), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
    face.position.set(0, 1.5, 0); face.userData.district = d.id; group.add(face); pickables.push(face);
    boards.set(d.id, { group, canvas, texture });
  }
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
    if (ctx.measureText(text).width <= max) return text;
    let cut = text; while (cut.length > 1 && ctx.measureText(cut + "…").width > max) cut = cut.slice(0, -1);
    return cut + "…";
  }
  function drawBoards() {
    for (const d of CITY_LOCATIONS) {
      const board = boards.get(d.id)!, info = labels.find(l => l.id === d.id), ctx = board.canvas.getContext("2d")!;
      const active = d.id === selected, soon = info?.soon ?? !!d.soon;
      ctx.clearRect(0, 0, 1024, 368);
      roundRect(ctx, 10, 10, 1004, 348, 50); ctx.fillStyle = active ? d.color : "#ffffff"; ctx.fill();
      ctx.lineWidth = 16; ctx.strokeStyle = active ? "#ffffff" : "#1d2230"; ctx.stroke();
      roundRect(ctx, 56, 80, 208, 208, 46); ctx.fillStyle = active ? "#ffffff38" : "#eef1f5"; ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "124px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; ctx.fillStyle = "#000"; ctx.fillText(info?.icon ?? "", 160, 192);
      ctx.textAlign = "left"; ctx.fillStyle = active ? "#ffffff" : "#161a24";
      const name = info?.name ?? d.id;
      let size = 100; do { ctx.font = `800 ${size}px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`; size -= 4; } while (size > 60 && ctx.measureText(name).width > 680);
      ctx.fillText(fitText(ctx, name, 680), 304, 150);
      ctx.font = "600 60px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"; ctx.fillStyle = active ? "#ffffffe6" : info?.reward ? "#b7791f" : soon ? "#7b8494" : "#4c5767";
      ctx.fillText(fitText(ctx, info?.status ?? "", 680), 306, 256);
      board.texture.needsUpdate = true;
    }
  }
  function updateBoards() {
    for (const board of boards.values()) {
      const p = board.group.position;
      board.group.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      board.group.scale.setScalar(THREE.MathUtils.clamp(camera.position.distanceTo(p) / 78, .45, 1.5));
    }
  }

  // Selection, hover and camera animation.
  let tween: { from: CityView; to: CityView; start: number; duration: number } | null = null;
  function animateTo(to: Partial<CityView>, duration = 650) {
    const from = currentView();
    let azimuth = to.azimuth ?? from.azimuth;
    while (azimuth - from.azimuth > Math.PI) azimuth -= Math.PI * 2;
    while (azimuth - from.azimuth < -Math.PI) azimuth += Math.PI * 2;
    tween = { from, to: { ...from, ...to, azimuth, polar: THREE.MathUtils.clamp(to.polar ?? from.polar, MIN_POLAR, MAX_POLAR), distance: THREE.MathUtils.clamp(to.distance ?? from.distance, MIN_DISTANCE, MAX_DISTANCE) }, start: performance.now(), duration: reduced ? 1 : duration };
  }
  function stepTween(now: number) {
    if (!tween) return;
    const k = Math.min(1, (now - tween.start) / tween.duration), e = 1 - Math.pow(1 - k, 3), { from, to } = tween;
    applyView({ azimuth: from.azimuth + (to.azimuth - from.azimuth) * e, polar: from.polar + (to.polar - from.polar) * e, distance: from.distance + (to.distance - from.distance) * e, target: from.target.map((v, i) => v + (to.target[i] - v) * e) as CityView["target"] });
    if (k >= 1) { tween = null; options.onView(currentView()); }
  }
  function focus(id: DistrictId) {
    const d = CITY_LOCATIONS.find(item => item.id === id); if (!d) return;
    // Look at the district from the central square, where its entrance faces.
    animateTo({ target: [d.x * .85, 0, d.z * .85], azimuth: Math.atan2(-d.x, -d.z), distance: Math.min(currentView().distance, 52) });
  }

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function pick(event: PointerEvent): DistrictId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return (raycaster.intersectObjects(pickables, false)[0]?.object.userData.district as DistrictId | undefined) ?? null;
  }
  let down: { x: number; y: number; time: number } | null = null;
  const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, time: performance.now() }; };
  const onUp = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6 && performance.now() - down.time < 600) { const id = pick(event); if (id) options.onSelect(id); }
    down = null;
  };
  const onHover = (event: PointerEvent) => { if (event.pointerType !== "mouse" || event.buttons) return; hovered = pick(event); renderer.domElement.style.cursor = hovered ? "pointer" : ""; };
  const onLeave = () => { hovered = null; renderer.domElement.style.cursor = ""; };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onHover);
  renderer.domElement.addEventListener("pointerleave", onLeave);

  // A district that just levelled up rises from the ground under a shower of confetti.
  const growth: { group: THREE.Group; start: number }[] = [];
  let confetti: { points: THREE.Points; velocity: Float32Array; start: number } | null = null;
  function startGrowth(now: number) {
    const grown = (options.grown ?? []).filter(id => districtGroups.has(id));
    if (!grown.length || reduced) return;
    for (const id of grown) { const group = districtGroups.get(id)!; group.scale.set(DISTRICT_SCALE, .02, DISTRICT_SCALE); growth.push({ group, start: now + 500 }); }
    const d = CITY_LOCATIONS.find(item => item.id === grown[0])!;
    animateTo({ target: [d.x * .8, 0, d.z * .8], distance: 48 }, 900);
    const count = 160, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), velocity = new Float32Array(count * 3), palette = ["#ffcf4d", "#ff6b9a", "#7b5cff", "#5bd6ff", "#6be38a"].map(c => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      positions.set([d.x, 4, d.z], i * 3); const c = palette[i % palette.length]; colors.set([c.r, c.g, c.b], i * 3);
      const a = Math.random() * Math.PI * 2, speed = 4 + Math.random() * 7; velocity.set([Math.cos(a) * speed, 9 + Math.random() * 9, Math.sin(a) * speed], i * 3);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .7, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    points.visible = false; world.add(points); confetti = { points, velocity, start: now + 1300 };
  }
  function stepGrowth(now: number, dt: number) {
    for (let i = growth.length - 1; i >= 0; i--) {
      const item = growth[i], k = THREE.MathUtils.clamp((now - item.start) / 1300, 0, 1);
      // Ease-out with a small overshoot, like a building popping into place.
      const e = k === 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      item.group.scale.y = DISTRICT_SCALE * Math.max(.02, e);
      if (k === 1) growth.splice(i, 1);
    }
    if (confetti && now >= confetti.start) {
      const { points, velocity } = confetti, attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
      points.visible = true;
      for (let i = 0; i < attr.count; i++) {
        velocity[i * 3 + 1] -= 14 * dt;
        attr.setXYZ(i, attr.getX(i) + velocity[i * 3] * dt, Math.max(.3, attr.getY(i) + velocity[i * 3 + 1] * dt), attr.getZ(i) + velocity[i * 3 + 2] * dt);
      }
      attr.needsUpdate = true;
      const age = (now - confetti.start) / 1000; (points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 3.2);
      if (age > 3.2) { world.remove(points); points.geometry.dispose(); (points.material as THREE.Material).dispose(); confetti = null; }
    }
  }

  // Direct manipulation takes priority over a camera transition.
  controls.addEventListener("start", () => { tween = null; host.dataset.dragging = "true"; });
  controls.addEventListener("end", () => { delete host.dataset.dragging; options.onView(currentView()); });
  controls.addEventListener("change", () => {
    // Keep panning over the city.
    const t = controls.target, length = Math.hypot(t.x, t.z);
    if (length > PAN_RADIUS) { const shift = new THREE.Vector3(t.x, 0, t.z).multiplyScalar(PAN_RADIUS / length - 1); t.add(shift); camera.position.add(shift); }
    t.y = 0;
  });

  // The canvas fills the screen; the city is centred in the free frame between the panels.
  let width = 0, height = 0;
  const frameRect = () => { const f = options.frame?.getBoundingClientRect(); return f && f.width > 60 && f.height > 60 ? f : null; };
  function resize() {
    width = host.clientWidth; height = host.clientHeight; if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : lite ? 1.5 : 1.75, Math.sqrt(3.4e6 / (width * height))));
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.fov = width < 480 ? 50 : 36;
    const f = frameRect(), bounds = host.getBoundingClientRect();
    if (f) camera.setViewOffset(width, height, bounds.left + width / 2 - (f.left + f.right) / 2, bounds.top + height / 2 - (f.top + f.bottom) / 2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  /** Default view sized so the ring road fills the free frame, whatever the screen. */
  function defaultView(): CityView {
    const f = frameRect(); if (!f || !height) return DEFAULT_VIEW;
    const perPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height;
    return { ...DEFAULT_VIEW, distance: THREE.MathUtils.clamp(Math.max(52 / (perPixel * f.width), 38 / (perPixel * f.height)), 62, 125) };
  }
  drawBoards();
  const observer = new ResizeObserver(resize); observer.observe(host); if (options.frame) observer.observe(options.frame); resize();
  applyView(options.view ?? defaultView());

  // One compressed file with the city blocks and one with vehicles; the city stays usable if either fails.
  function disposeModel(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const mat of [o.material].flat()) {
        mats.add(mat);
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
      }
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); mats.forEach(m => m.dispose());
  }
  let modelsSettled = false;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const loaded: THREE.Object3D[] = [];
  loader.loadAsync(modelsUrl).then(gltf => {
    if (disposed) { gltf.scenes.forEach(disposeModel); return; }
    loaded.push(...gltf.scenes);
    models = new Map(gltf.scenes.map(s => [s.name, s]));
    modelBlocks(models);
  }).catch(() => { if (!disposed) { simpleBlocks(); plainBlocks(outskirts); } }).finally(() => { modelsSettled = true; });
  loader.loadAsync(vehiclesUrl).then(gltf => {
    if (disposed) { gltf.scenes.forEach(disposeModel); return; }
    loaded.push(...gltf.scenes);
    const catalogue = new Map<string, THREE.Object3D>(gltf.scenes.map(s => [s.name, s]));
    catalogue.set("taxi", taxi);
    buildTraffic(catalogue); parkedVehicles(catalogue);
  }).catch(() => { /* Local taxis keep driving. */ });

  let frame = 0, last = performance.now(), visible = true, ready = false;
  const visibility = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); if (visible && !frame) frame = requestAnimationFrame(tick); });
  visibility.observe(host);
  function tick(now: number) {
    frame = 0; if (!visible || document.hidden) return;
    if (mobile && now - last < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
    const elapsed = Math.min(.2, (now - last) / 1000), dt = Math.min(.05, elapsed); last = now;
    if (!width || !height) resize();
    stepTween(now);
    controls.update();
    const pulse = reduced ? .5 : (Math.sin(now / 380) + 1) / 2;
    rings.forEach((ring, id) => {
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity = id === selected ? .55 + pulse * .4 : id === hovered ? .45 : 0;
      ring.scale.setScalar(id === selected ? 1 + pulse * .04 : 1);
    });
    if (trafficEnabled) moveTraffic(elapsed, now);
    if (!reduced) {
      waves.offset.set(waves.offset.x + dt * .01, waves.offset.y + dt * .004);
      characterMixer?.update(dt);
      if (characterMixer && waveAction && now >= nextWave) { idleAction?.fadeOut(.35); waveAction.reset().fadeIn(.35).play(); nextWave = now + 18000; }
    }
    stepGrowth(now, dt);
    if (width && height && modelsSettled) { updateBoards(); renderer.render(scene, camera); host.dataset.drawCalls = String(renderer.info.render.calls); host.dataset.triangles = String(renderer.info.render.triangles); if (!ready) { ready = true; options.onReady(); startGrowth(now); } }
    frame = requestAnimationFrame(tick);
  }
  const onVisible = () => { if (!document.hidden && !frame) { last = performance.now(); frame = requestAnimationFrame(tick); } };
  document.addEventListener("visibilitychange", onVisible);
  frame = requestAnimationFrame(tick);

  const lost = (event: Event) => { event.preventDefault(); options.onLost(); };
  renderer.domElement.addEventListener("webglcontextlost", lost);

  return {
    setMascot,
    setTraffic(enabled) { trafficEnabled = enabled; },
    select(id) { if (id === selected) return; selected = id; drawBoards(); focus(id); },
    setLabels(next) { labels = next; drawBoards(); },
    zoom(factor) { animateTo({ distance: currentView().distance * factor }, 320); },
    rotate(radians) { animateTo({ azimuth: currentView().azimuth + radians }, 420); },
    tilt(radians) { animateTo({ polar: currentView().polar + radians }, 320); },
    reset() { animateTo(defaultView(), 700); },
    focusMascot() { animateTo({ target: [0, 3, 0], azimuth: currentView().azimuth, polar: 1.12, distance: 22 }, 650); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); controls.dispose();
      document.removeEventListener("visibilitychange", onVisible);
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onHover); renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      for (const root of [scene, ...loaded, taxi, boat]) disposeModel(root);
      unit.dispose(); block.dispose(); blobPlane.dispose(); pole.dispose(); bulb.dispose();
      materials.forEach(m => m.dispose()); disposables.forEach(d => d.dispose()); boards.forEach(b => b.texture.dispose()); architecture.dispose(); environment.dispose(); sun.shadow.dispose(); characterRequest++; characterMixer?.stopAllAction(); disposeCharacter(figure); if (nameTag) { (nameTag.material as THREE.SpriteMaterial).map?.dispose(); (nameTag.material as THREE.SpriteMaterial).dispose(); } renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); delete host.dataset.dragging;
    },
  };
}
