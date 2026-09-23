import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DistrictId } from "../../api/city";

interface CityLocation { id: DistrictId; x: number; z: number; color: string; soon?: boolean }
export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean }
export interface CitySceneOptions {
  levels: Record<string, number>; selected: DistrictId; view?: CityView; labels: CityLabelInfo[];
  onSelect: (id: DistrictId) => void; onView: (view: CityView) => void; onReady: () => void; onLost: () => void;
}
export interface CitySceneControl { dispose: () => void; select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void; zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void }

export const CITY_LOCATIONS: CityLocation[] = [
  { id: "academy", x: -17, z: 2, color: "#5b8def" },
  { id: "driver", x: -6.5, z: -16.5, color: "#f0a23a" },
  { id: "crm", x: 14, z: -9, color: "#7b5cff" },
  { id: "dispatch", x: 14.5, z: 12.5, color: "#35b6a6", soon: true },
  { id: "opteo", x: -5.5, z: 17.5, color: "#e86aa6", soon: true },
];
export const DEFAULT_VIEW: CityView = { azimuth: .55, polar: .86, distance: 80, target: [0, 0, 2] };
/** District buildings are drawn in small units and scaled up to stand above the ordinary city blocks. */
const DISTRICT_SCALE = 2.3, MIN_DISTANCE = 18, MAX_DISTANCE = 125, MIN_POLAR = .18, MAX_POLAR = 1.32, PAN_RADIUS = 24;

export function createCityScene(host: HTMLDivElement, options: CitySceneOptions): CitySceneControl {
  const { levels } = options;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0); host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#dff1f7", 150, 300);
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 500);
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
  applyView(options.view ?? DEFAULT_VIEW);

  scene.add(new THREE.HemisphereLight("#fdfbff", "#9bb39a", 2.1));
  const sun = new THREE.DirectionalLight("#fff3dc", 3.1);
  sun.position.set(-30, 55, 25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 }); sun.shadow.normalBias = .05; scene.add(sun);

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .04, ...extra }));
    return materials.get(key)!;
  }
  const world = new THREE.Group(); scene.add(world);
  function mesh(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = world, extra?: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.Mesh(geometry, material(color, extra)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const box = (w: number, h: number, d: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z, p);
  const cyl = (r: number, h: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D, n = 32) => mesh(new THREE.CylinderGeometry(r, r, h, n), c, x, y, z, p);
  const sphere = (r: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => mesh(new THREE.SphereGeometry(r, 18, 14), c, x, y, z, p);
  const tint = (color: string, amount: number) => "#" + new THREE.Color(color).lerp(new THREE.Color(amount > 0 ? "#ffffff" : "#1c1830"), Math.abs(amount)).getHexString();

  // Island, water and greenery.
  const water = new THREE.Mesh(new THREE.CircleGeometry(320, 64), material("#8fd0e4", { roughness: .35 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.4; water.receiveShadow = true; world.add(water);
  mesh(new THREE.CylinderGeometry(35, 36.5, 1.8, 96), "#e9d7ad", 0, -.75, 0);
  mesh(new THREE.CylinderGeometry(33.8, 35, .3, 96), "#a9d68f", 0, .05, 0);
  function tree(x: number, z: number, s = 1, p: THREE.Object3D = world) {
    cyl(.1 * s, .8 * s, "#8a6a55", x, .6 * s, z, p, 7);
    const crown = mesh(new THREE.ConeGeometry(.55 * s, 1.3 * s, 9), "#5fae6e", x, 1.45 * s, z, p); crown.rotation.y = x;
    mesh(new THREE.ConeGeometry(.42 * s, 1 * s, 9), "#78c282", x, 1.95 * s, z, p);
  }
  function roundTree(x: number, z: number, s = 1) { cyl(.09 * s, .7 * s, "#8a6a55", x, .55 * s, z, world, 7); sphere(.55 * s, "#6fbb77", x, 1.2 * s, z); }
  const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const random = rng(7);
  for (let i = 0; i < 150; i++) {
    const angle = random() * Math.PI * 2, radius = 27.8 + random() * 5.2, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    (i % 3 ? tree : roundTree)(x, z, 1.1 + random() * .8);
  }

  // Roads: a ring through every district and spokes to the central square.
  const plaza = cyl(4.6, .12, "#efe7d6", 0, .25, 0, world, 64);
  plaza.receiveShadow = true;
  const ringRoad = new THREE.Mesh(new THREE.RingGeometry(24, 26, 160), material("#6d7385"));
  ringRoad.rotation.x = -Math.PI / 2; ringRoad.position.y = .215; ringRoad.receiveShadow = true; world.add(ringRoad);
  for (let i = 0; i < 110; i++) { const a = i / 110 * Math.PI * 2, dash = box(.14, .02, .7, "#f7f3e8", Math.cos(a) * 25, .23, Math.sin(a) * 25); dash.rotation.y = -a; dash.castShadow = false; }
  const roads: [number, number, number, number][] = [];
  function road(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz), angle = Math.atan2(dx, dz);
    roads.push([ax, az, bx, bz]);
    const r = box(2, .06, length, "#6d7385", (ax + bx) / 2, .23, (az + bz) / 2); r.rotation.y = angle; r.castShadow = false;
    for (let t = 1.2; t < length - .8; t += 2) { const dash = box(.14, .07, .8, "#f7f3e8", ax + dx * t / length, .245, az + dz * t / length); dash.rotation.y = angle; dash.castShadow = false; }
  }
  const edge = DISTRICT_SCALE * 2.7;
  CITY_LOCATIONS.forEach(a => {
    const r = Math.hypot(a.x, a.z), ux = a.x / r, uz = a.z / r;
    road(ux * 4.6, uz * 4.6, ux * (r - edge), uz * (r - edge));
    road(ux * (r + edge), uz * (r + edge), ux * 24, uz * 24);
  });
  // A cross street through the blocks between neighbouring districts.
  CITY_LOCATIONS.forEach((a, i) => {
    const b = CITY_LOCATIONS[(i + 1) % CITY_LOCATIONS.length], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, r = Math.hypot(mx, mz);
    road(mx / r * 4.6, mz / r * 4.6, mx / r * 24, mz / r * 24);
  });

  // Ordinary city blocks fill the space between the districts.
  const nearRoad = (x: number, z: number, pad: number) => roads.some(([ax, az, bx, bz]) => {
    const dx = bx - ax, dz = bz - az, t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - ax - dx * t, z - az - dz * t) < pad;
  });
  function facadeTexture(floors: number, glass: boolean) {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64 * floors;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let f = 0; f < floors; f++) for (let c = 0; c < 3; c++) {
      ctx.fillStyle = (f * 3 + c) % 7 === 0 ? "#ffe9a8" : glass ? "#8fb3dc" : "#9aabc4";
      ctx.fillRect(6 + c * 19, f * 64 + 14, 14, 30);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  const facades = new Map<string, THREE.CanvasTexture>(), facadeMaterials = new Map<string, THREE.Material[]>();
  function facadeMaterial(color: string, floors: number, glass: boolean) {
    const key = `${color}:${floors}:${glass}`;
    if (!facadeMaterials.has(key)) {
      const textureKey = `${floors}:${glass}`;
      if (!facades.has(textureKey)) facades.set(textureKey, facadeTexture(floors, glass));
      const side = new THREE.MeshStandardMaterial({ color, map: facades.get(textureKey), roughness: glass ? .35 : .8, metalness: glass ? .2 : .02 });
      const top = material(tint(color, -.12));
      facadeMaterials.set(key, [side, side, top, top, side, side]);
    }
    return facadeMaterials.get(key)!;
  }
  const blockRandom = rng(21);
  const walls = ["#f3e6d3", "#e9eef5", "#f6d9cf", "#dfe9dd", "#ece4f4", "#f4efe2"], roofs = ["#c7775d", "#8a6f9e", "#5f7f9c", "#a3685a"];
  for (let gx = -24; gx <= 24; gx += 2.9) for (let gz = -24; gz <= 24; gz += 2.9) {
    const x = gx + (blockRandom() - .5) * 1.1, z = gz + (blockRandom() - .5) * 1.1, r = Math.hypot(x, z), roll = blockRandom();
    if (r < 6.6 || r > 22.6 || nearRoad(x, z, 2.3) || CITY_LOCATIONS.some(d => Math.hypot(d.x - x, d.z - z) < DISTRICT_SCALE * 2.6 + 1.4)) continue;
    const g = new THREE.Group(); g.position.set(x, .2, z); g.rotation.y = Math.atan2(x, z) + (blockRandom() < .5 ? 0 : Math.PI / 2); world.add(g);
    if (roll < .1) { tree(0, 0, 1.3, g); continue; }
    if (roll < .45) {
      const w = 1.8 + blockRandom() * .6, h = 1.2 + blockRandom() * .6, wall = walls[Math.floor(blockRandom() * walls.length)];
      box(w, h, w * .9, wall, 0, h / 2, 0, g);
      const roof = mesh(new THREE.ConeGeometry(w * .78, .9, 4), roofs[Math.floor(blockRandom() * roofs.length)], 0, h + .45, 0, g); roof.rotation.y = Math.PI / 4;
      box(.4, .7, .05, "#6b5a50", 0, .35, w * .45 + .01, g);
    } else {
      const glass = roll > .8, floors = glass ? 7 + Math.floor(blockRandom() * 4) : 3 + Math.floor(blockRandom() * 4), h = floors * .75, w = glass ? 2.1 : 2.5;
      const color = glass ? ["#b8cbe3", "#a9c4d8", "#c4c9e6"][Math.floor(blockRandom() * 3)] : walls[Math.floor(blockRandom() * walls.length)];
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), facadeMaterial(color, floors, glass)); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      box(w + .15, .15, w + .15, tint(color, -.25), 0, h + .07, 0, g);
      if (!glass && blockRandom() < .5) box(.5, .4, .5, "#9aa3b2", .5, h + .35, -.4, g);
    }
  }

  // Pulsar statue in the square.
  const bot = new THREE.Group(); bot.position.set(0, .3, 0); bot.scale.setScalar(2.4); world.add(bot);
  cyl(.8, .35, "#d8cfee", 0, .17, 0, bot, 32);
  const head = sphere(.55, "#a787e3", 0, 1.05, 0, bot); head.scale.set(1.1, .92, .8);
  const face = sphere(.42, "#2f2a48", 0, 1.08, .26, bot); face.scale.set(1, .64, .35);
  sphere(.08, "#9ff5ea", -.16, 1.12, .4, bot); sphere(.08, "#9ff5ea", .16, 1.12, .4, bot);
  cyl(.04, .32, "#b397dd", 0, 1.6, 0, bot); sphere(.09, "#ffd976", 0, 1.8, 0, bot);
  sphere(.28, "#9474cc", 0, .52, 0, bot);

  // Districts.
  const pickables: THREE.Object3D[] = [];
  const anchors = new Map<DistrictId, THREE.Vector3>();
  const rings = new Map<DistrictId, THREE.Mesh>();
  function windows(x: number, y: number, z: number, cols: number, rows: number, p: THREE.Object3D, side = false) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lit = (i + j) % 3 === 0 ? "#fff1b8" : "#dfe9ff";
      if (side) box(.04, .3, .32, lit, x, y + j * .52, z + i * .48, p); else box(.32, .3, .04, lit, x + i * .48, y + j * .52, z, p);
    }
  }
  function crane(p: THREE.Object3D) {
    const yellow = "#f2b632";
    box(.18, 4.4, .18, yellow, 1.5, 2.4, -1.1, p); box(3.2, .16, .16, yellow, .75, 4.6, -1.1, p);
    box(.5, .35, .35, "#6d7385", 2.5, 4.4, -1.1, p); box(.03, 1.4, .03, "#4a4f5e", -.4, 3.9, -1.1, p);
    for (const [x, z] of [[-1.7, 1.5], [-1.2, 1.7], [1.7, 1.5]]) { mesh(new THREE.ConeGeometry(.14, .38, 12), "#ff8a3d", x, .45, z, p); }
    box(2.2, .28, .06, "#ffffff", 0, .5, 1.95, p); for (const x of [-.7, 0, .7]) box(.3, .29, .07, "#ff5b5b", x, .5, 1.96, p);
  }
  function building(d: CityLocation) {
    const g = new THREE.Group(); g.position.set(d.x, .2, d.z); g.scale.setScalar(DISTRICT_SCALE); g.rotation.y = Math.atan2(-d.x, -d.z); g.userData.district = d.id; world.add(g);
    const level = Math.min(levels[d.id] ?? 0, 3), wall = d.soon ? tint(d.color, .55) : tint(d.color, .15), roof = d.soon ? tint(d.color, .25) : tint(d.color, -.35);
    cyl(2.5, .3, d.soon ? "#e4e2dc" : "#f4efe4", 0, .05, 0, g, 6);
    const rim = cyl(2.56, .12, d.soon ? "#c9c6bd" : d.color, 0, -.05, 0, g, 6); rim.castShadow = false;
    const body = new THREE.Group(); g.add(body); if (!d.soon) body.scale.y = 1 + level * .06;
    if (d.id === "academy") {
      box(2.5, 1.7, 2, wall, 0, 1.05, 0, body);
      const r = mesh(new THREE.ConeGeometry(1.95, 1, 4), roof, 0, 2.4, 0, body); r.rotation.y = Math.PI / 4;
      for (const x of [-.8, -.27, .27, .8]) cyl(.09, 1.4, "#ffffff", x, .9, 1.12, body, 12);
      box(2.3, .16, .5, "#ffffff", 0, 1.66, 1.12, body); box(.6, 1, .06, "#3e4a7a", 0, .7, 1.02, body);
      cyl(.05, 1.2, "#6d7385", .95, 3.2, 0, body); box(.6, .36, .04, "#ffd24d", 1.25, 3.55, 0, body);
    } else if (d.id === "driver") {
      box(2.9, 1.25, 1.8, wall, 0, .82, -.45, body); box(3.15, .2, 2.05, roof, 0, 1.55, -.45, body);
      for (const x of [-.78, .78]) { box(1, .9, .05, "#4a4f5e", x, .66, .47, body); for (let i = 0; i < 4; i++) box(1, .025, .07, "#8c92a3", x, .36 + i * .18, .5, body); }
      for (const [x, z, c] of [[-.8, 1.35, "#ffd24d"], [.8, 1.5, "#ffffff"]] as const) {
        box(.62, .26, 1.1, c, x, .42, z, body); box(.54, .24, .58, "#39405a", x, .66, z - .05, body);
        for (const xx of [-.33, .33]) for (const zz of [-.33, .33]) { const w = cyl(.13, .1, "#2d3142", x + xx, .3, z + zz, body, 12); w.rotation.z = Math.PI / 2; }
      }
      box(.08, 1.5, .08, "#6d7385", 1.85, .95, -.3, body); box(.7, .55, .12, "#ffd24d", 1.85, 1.7, -.3, body);
    } else if (d.id === "crm") {
      const high = 2.8 + level * .35;
      box(2.3, high, 1.9, wall, 0, high / 2 + .2, 0, body); box(2.5, .18, 2.1, roof, 0, high + .3, 0, body); box(1.7, .5, 1.3, tint(d.color, .3), 0, high + .62, 0, body);
      windows(-.72, .8, .97, 4, Math.floor(high / .55) - 1, body); windows(1.17, .8, -.6, 3, Math.floor(high / .55) - 1, body, true);
      box(.6, .75, .06, "#2f2a48", 0, .58, .97, body);
      cyl(.05, .8, "#6d7385", 0, high + 1.25, 0, body);
      const gem = mesh(new THREE.OctahedronGeometry(.4), level >= 2 ? "#ffd976" : "#9ff5ea", 0, high + 1.9, 0, body, { emissive: level >= 2 ? "#ffb300" : "#3fd6c6", emissiveIntensity: .45 });
      gem.userData.spin = true;
    } else if (d.id === "dispatch") {
      cyl(.72, 2.8, wall, 0, 1.6, 0, body, 10); cyl(1.25, .8, tint(d.color, .05), 0, 3.3, 0, body, 10); cyl(1.42, .18, roof, 0, 3.8, 0, body, 10);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(.34, .32, .05, "#e8fbff", Math.sin(a) * 1.25, 3.33, Math.cos(a) * 1.25, body).rotation.y = a; }
      box(2, .6, 1.5, wall, 0, .5, .4, body); crane(body);
    } else {
      box(2.5, 1.4, 2, wall, 0, .9, 0, body); const dome = sphere(1.05, tint(d.color, .35), 0, 1.6, 0, body); dome.scale.set(1, .6, .85);
      box(2.7, .16, 2.2, roof, 0, 1.65, 0, body); box(1.3, .56, .05, "#3e4a7a", 0, .95, 1.02, body);
      const dish = mesh(new THREE.TorusGeometry(.55, .06, 10, 32), "#ffffff", .5, 2.65, 0, body); dish.rotation.x = -.6; crane(body);
    }
    for (let i = 0; i < level; i++) { const star = mesh(new THREE.OctahedronGeometry(.17), "#ffcf4d", -1.25 + i * .4, .45, 1.9, g, { emissive: "#ffb300", emissiveIntensity: .35 }); star.rotation.z = .25; }
    tree(-1.9, -.8, .55, g); tree(1.85, .9, .45, g);
    if (!d.soon) { cyl(.04, 1.2, "#6d7385", -1.85, .75, 1.2, g); sphere(.12, "#fff3c4", -1.85, 1.4, 1.2, g); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.95 * DISTRICT_SCALE, .2, 10, 96), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(d.x, .45, d.z); world.add(ring); rings.set(d.id, ring);
    // An invisible hit volume makes the whole district clickable, not only thin details.
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * DISTRICT_SCALE, 2.5 * DISTRICT_SCALE, 5 * DISTRICT_SCALE, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(d.x, 2.5 * DISTRICT_SCALE, d.z); hit.userData.district = d.id; world.add(hit); pickables.push(hit);
    g.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(body);
    anchors.set(d.id, new THREE.Vector3(d.x, bounds.max.y + .6, d.z));
  }
  CITY_LOCATIONS.forEach(building);

  // Little cars drive around the outer ring road.
  const cars = ["#ff6b6b", "#ffd24d", "#5b8def"].map((color, i) => {
    const car = new THREE.Group(); world.add(car);
    car.scale.setScalar(2);
    box(.42, .2, .75, color, 0, .08, 0, car); box(.36, .18, .38, "#39405a", 0, .26, -.04, car);
    return { car, t: i / 3 };
  });
  function moveCars(dt: number) {
    for (const item of cars) {
      item.t = (item.t + dt * .012) % 1;
      const a = item.t * Math.PI * 2, r = 24.6;
      item.car.position.set(Math.cos(a) * r, .26, Math.sin(a) * r); item.car.rotation.y = -a;
    }
  }
  moveCars(0);

  let selected = options.selected, hovered: DistrictId | null = null;
  // Billboards on the roofs carry the district names and always turn towards the camera.
  let labels = options.labels;
  const boards = new Map<DistrictId, { group: THREE.Group; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  for (const d of CITY_LOCATIONS) {
    const group = new THREE.Group(), anchor = anchors.get(d.id)!; group.position.copy(anchor); world.add(group);
    for (const x of [-2.6, 2.6]) box(.22, 1.6, .22, "#5b6275", x, .8, 0, group);
    box(9.6, 3.6, .3, "#3a3f52", 0, 3.3, -.2, group);
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 368;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 3.3), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }));
    face.position.set(0, 3.3, 0); face.userData.district = d.id; group.add(face); pickables.push(face);
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
      const active = d.id === selected, soon = info?.soon ?? !!d.soon, accent = soon ? "#8d93a0" : d.color;
      ctx.clearRect(0, 0, 1024, 368);
      roundRect(ctx, 8, 8, 1008, 352, 44); ctx.fillStyle = active ? accent : soon ? "#f1f1ee" : "#ffffff"; ctx.fill();
      ctx.lineWidth = 14; ctx.strokeStyle = active ? "#ffffff" : accent; ctx.stroke();
      ctx.fillStyle = active ? "#ffffff33" : tint(accent, .82); ctx.beginPath(); ctx.arc(170, 184, 118, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "130px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; ctx.fillStyle = "#000"; ctx.fillText(info?.icon ?? "", 170, 192);
      ctx.textAlign = "left"; ctx.fillStyle = active ? "#ffffff" : "#1d2a3a";
      const name = info?.name ?? d.id;
      let size = 96; do { ctx.font = `800 ${size}px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`; size -= 4; } while (size > 60 && ctx.measureText(name).width > 670);
      ctx.fillText(fitText(ctx, name, 670), 320, 140);
      ctx.font = "600 58px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"; ctx.fillStyle = active ? "#ffffffe6" : info?.reward ? "#b7791f" : "#5b6778";
      ctx.fillText(fitText(ctx, info?.status ?? "", 700), 322, 250);
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
    autoRotate = false;
  }
  function stepTween(now: number) {
    if (!tween) return;
    const k = Math.min(1, (now - tween.start) / tween.duration), e = 1 - Math.pow(1 - k, 3), { from, to } = tween;
    applyView({ azimuth: from.azimuth + (to.azimuth - from.azimuth) * e, polar: from.polar + (to.polar - from.polar) * e, distance: from.distance + (to.distance - from.distance) * e, target: from.target.map((v, i) => v + (to.target[i] - v) * e) as CityView["target"] });
    if (k >= 1) { tween = null; options.onView(currentView()); }
  }
  function focus(id: DistrictId) {
    const d = CITY_LOCATIONS.find(item => item.id === id); if (!d) return;
    animateTo({ target: [d.x * .55, 0, d.z * .55], distance: Math.min(currentView().distance, 62) });
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

  // Gentle idle spin until the first interaction.
  let autoRotate = !reduced && !options.view;
  controls.addEventListener("start", () => { autoRotate = false; tween = null; host.dataset.dragging = "true"; });
  controls.addEventListener("end", () => { delete host.dataset.dragging; options.onView(currentView()); });
  controls.addEventListener("change", () => {
    // Keep panning on the island.
    const t = controls.target, length = Math.hypot(t.x, t.z);
    if (length > PAN_RADIUS) { const shift = new THREE.Vector3(t.x, 0, t.z).multiplyScalar(PAN_RADIUS / length - 1); t.add(shift); camera.position.add(shift); }
    t.y = 0;
  });

  let width = 0, height = 0;
  function resize() {
    width = host.clientWidth; height = host.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.fov = width < 480 ? 50 : 36; camera.updateProjectionMatrix();
  }
  drawBoards();
  const observer = new ResizeObserver(resize); observer.observe(host); resize();

  let frame = 0, last = performance.now(), visible = true, ready = false;
  const visibility = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); if (visible && !frame) frame = requestAnimationFrame(tick); });
  visibility.observe(host);
  function tick(now: number) {
    frame = 0; if (!visible || document.hidden) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!width || !height) resize();
    stepTween(now);
    if (autoRotate) { spherical.setFromVector3(offset.copy(camera.position).sub(controls.target)); spherical.theta += dt * .12; camera.position.copy(controls.target).add(offset.setFromSpherical(spherical)); }
    controls.update();
    const pulse = reduced ? .5 : (Math.sin(now / 380) + 1) / 2;
    rings.forEach((ring, id) => {
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity = id === selected ? .55 + pulse * .4 : id === hovered ? .45 : 0;
      ring.scale.setScalar(id === selected ? 1 + pulse * .04 : 1);
    });
    if (!reduced) { moveCars(dt); world.traverse(o => { if (o.userData.spin) o.rotation.y += dt * 1.2; }); }
    if (width && height) { updateBoards(); renderer.render(scene, camera); if (!ready) { ready = true; options.onReady(); } }
    frame = requestAnimationFrame(tick);
  }
  const onVisible = () => { if (!document.hidden && !frame) { last = performance.now(); frame = requestAnimationFrame(tick); } };
  document.addEventListener("visibilitychange", onVisible);
  frame = requestAnimationFrame(tick);

  const lost = (event: Event) => { event.preventDefault(); options.onLost(); };
  renderer.domElement.addEventListener("webglcontextlost", lost);

  return {
    select(id) { if (id === selected) return; selected = id; drawBoards(); focus(id); },
    setLabels(next) { labels = next; drawBoards(); },
    zoom(factor) { animateTo({ distance: currentView().distance * factor }, 320); },
    rotate(radians) { animateTo({ azimuth: currentView().azimuth + radians }, 420); },
    tilt(radians) { animateTo({ polar: currentView().polar + radians }, 320); },
    reset() { animateTo(DEFAULT_VIEW, 700); },
    dispose() {
      cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); controls.dispose();
      document.removeEventListener("visibilitychange", onVisible);
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onHover); renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.material instanceof THREE.MeshBasicMaterial) o.material.dispose(); } });
      materials.forEach(m => m.dispose()); facadeMaterials.forEach(list => list[0].dispose()); facades.forEach(t => t.dispose()); boards.forEach(b => b.texture.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); delete host.dataset.dragging;
    },
  };
}
