import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createArchitecture, mergeStatic } from "./cityArchitecture";
import maleUrl from "./models/operator-male.glb?url";
import femaleUrl from "./models/operator-female.glb?url";
import type { DistrictId } from "../../api/city";
import { districtLevel } from "./cityLevels";
import modelsUrl from "./models/city-models.glb?url";

interface CityLocation { id: DistrictId; x: number; z: number; color: string; soon?: boolean }
export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean; level: number }
export interface CitySceneOptions {
  levels: Record<string, number>; selected: DistrictId; view?: CityView; labels: CityLabelInfo[];
  /** Districts that levelled up since the last visit: they grow in with a burst of confetti. */
  grown?: DistrictId[];
  /** Фигура в центре площади: робот Пульсар или оператор выбранного пола с именем помощника. */
  mascot?: CityMascot;
  onSelect: (id: DistrictId) => void; onView: (view: CityView) => void; onReady: () => void; onLost: () => void;
}
export interface CityMascot { gender: "male" | "female" | null; name: string }
export interface CitySceneControl { focusMascot: () => void; setMascot: (mascot: CityMascot) => void; dispose: () => void; select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void; zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void }

export const CITY_LOCATIONS: CityLocation[] = [
  { id: "academy", x: -17, z: 2, color: "#5b8def" },
  { id: "driver", x: -6.5, z: -16.5, color: "#f0a23a" },
  { id: "crm", x: 14, z: -9, color: "#7b5cff" },
  { id: "dispatch", x: 14.5, z: 12.5, color: "#35b6a6", soon: true },
  { id: "oktell", x: -5.5, z: 17.5, color: "#e86aa6", soon: true },
];
export const DEFAULT_VIEW: CityView = { azimuth: .55, polar: .86, distance: 96, target: [0, 0, 2] };
/** District buildings are drawn in small units and scaled up to stand above the ordinary city blocks. */
const DISTRICT_SCALE = 2.3, MIN_DISTANCE = 18, MAX_DISTANCE = 160, MIN_POLAR = .18, MAX_POLAR = 1.32, PAN_RADIUS = 24;

export function createCityScene(host: HTMLDivElement, options: CitySceneOptions): CitySceneControl {
  const { levels } = options;
  let disposed = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  const mobile = host.clientWidth < 600;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : 1.75));
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

  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; scene.environmentIntensity = .4;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight("#e6f3ff", "#6c8061", 1.1));
  const sun = new THREE.DirectionalLight("#fff3dc", 3.1);
  sun.position.set(-30, 55, 25); sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 }); sun.shadow.normalBias = .04; sun.shadow.bias = -.00015; sun.shadow.radius = 3; scene.add(sun);

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .04, ...extra }));
    return materials.get(key)!;
  }
  const world = new THREE.Group(); scene.add(world);
  const architecture = createArchitecture();
  const scenery = new THREE.Group(); world.add(scenery);
  function mesh(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = scenery, extra?: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.Mesh(geometry, material(color, extra)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const box = (w: number, h: number, d: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z, p);
  const cyl = (r: number, h: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D, n = 32) => mesh(new THREE.CylinderGeometry(r, r, h, n), c, x, y, z, p);
  const sphere = (r: number, c: string, x: number, y: number, z: number, p?: THREE.Object3D) => mesh(new THREE.SphereGeometry(r, 18, 14), c, x, y, z, p);
  const tint = (color: string, amount: number) => "#" + new THREE.Color(color).lerp(new THREE.Color(amount > 0 ? "#ffffff" : "#1c1830"), Math.abs(amount)).getHexString();

  // Island, water and greenery.
  const water = new THREE.Mesh(new THREE.CircleGeometry(320, 64), material("#6dabab", { roughness: .25, metalness: .25 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.4; water.receiveShadow = true; scenery.add(water);
  mesh(new THREE.CylinderGeometry(35, 36.5, 1.8, 96), "#e9d7ad", 0, -.75, 0);
  mesh(new THREE.CylinderGeometry(33.8, 35, .3, 96), "#8ba67a", 0, .05, 0);
  function tree(x: number, z: number, s = 1, p: THREE.Object3D = scenery) {
    cyl(.1 * s, .8 * s, "#8a6a55", x, .6 * s, z, p, 7);
    const crown = sphere(.58 * s, "#517b60", x, 1.35 * s, z, p); crown.scale.set(.95, 1.22, .9);
    sphere(.43 * s, "#789465", x + .27 * s, 1.9 * s, z + .05 * s, p);
    sphere(.4 * s, "#668c65", x - .28 * s, 1.66 * s, z - .1 * s, p);
  }
  function roundTree(x: number, z: number, s = 1) { cyl(.09 * s, .7 * s, "#8a6a55", x, .55 * s, z, scenery, 7); sphere(.55 * s, "#799363", x, 1.2 * s, z); }
  const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const random = rng(7);
  for (let i = 0; i < 90; i++) {
    const angle = random() * Math.PI * 2, radius = 27.8 + random() * 5.2, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    (i % 3 ? tree : roundTree)(x, z, 1.1 + random() * .8);
  }

  // Roads: a ring through every district and spokes to the central square.
  const plaza = cyl(4.6, .12, "#efe7d6", 0, .25, 0, scenery, 64);
  plaza.receiveShadow = true; architecture.plaza(scenery);
  const ringRoad = new THREE.Mesh(new THREE.RingGeometry(24, 26, 160), material("#6d7385"));
  ringRoad.rotation.x = -Math.PI / 2; ringRoad.position.y = .215; ringRoad.receiveShadow = true; scenery.add(ringRoad);
  for (let i = 0; i < 110; i++) { const a = i / 110 * Math.PI * 2, dash = box(.14, .02, .7, "#f7f3e8", Math.cos(a) * 25, .23, Math.sin(a) * 25); dash.rotation.y = -a; dash.castShadow = false; }
  const roads: [number, number, number, number][] = [];
  function road(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz), angle = Math.atan2(dx, dz);
    roads.push([ax, az, bx, bz]);
    const kerb = box(2.65, .08, length, "#e5dfcf", (ax + bx) / 2, .18, (az + bz) / 2); kerb.rotation.y = angle; kerb.castShadow = false;
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

  // Ordinary city blocks fill the space between the districts: Kenney models once they load, simple shapes if they cannot.
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
  const lots: { x: number; z: number; r: number; rotation: number; roll: number; pick: number; size: number }[] = [];
  for (let gx = -24; gx <= 24; gx += 2.9) for (let gz = -24; gz <= 24; gz += 2.9) {
    const x = gx + (blockRandom() - .5) * 1.1, z = gz + (blockRandom() - .5) * 1.1, r = Math.hypot(x, z);
    const lot = { x, z, r, rotation: Math.atan2(x, z) + (blockRandom() < .5 ? 0 : Math.PI / 2), roll: blockRandom(), pick: blockRandom(), size: blockRandom() };
    if (r < 6.6 || r > 22.6 || nearRoad(x, z, 1.8) || CITY_LOCATIONS.some(d => Math.hypot(d.x - x, d.z - z) < DISTRICT_SCALE * 2.7 + .55)) continue;
    lots.push(lot);
  }
  const walls = ["#f3e6d3", "#e9eef5", "#f6d9cf", "#dfe9dd", "#ece4f4", "#f4efe2"], roofs = ["#c7775d", "#8a6f9e", "#5f7f9c", "#a3685a"];
  function simpleBlocks() {
    for (const lot of lots) {
      const g = new THREE.Group(); g.position.set(lot.x, .2, lot.z); g.rotation.y = lot.rotation; scenery.add(g);
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
  const HOUSES = ["s-building-type-a", "s-building-type-b", "s-building-type-c", "s-building-type-d", "s-building-type-f", "s-building-type-g", "s-building-type-h", "s-building-type-k", "s-building-type-m", "s-building-type-p", "s-building-type-q", "s-building-type-t"];
  const OFFICES = ["c-building-a", "c-building-c", "c-building-d", "c-building-f", "c-building-g", "c-building-h", "c-building-m", "c-building-n"];
  const TOWERS = ["c-building-skyscraper-a", "c-building-skyscraper-b", "c-building-skyscraper-c", "c-building-skyscraper-d"];
  function modelBlocks() {
    for (const lot of lots) {
      const list = lot.roll < .08 ? ["s-tree-large"] : lot.r > 17 ? (lot.roll < .8 ? HOUSES : OFFICES) : lot.roll > .88 ? TOWERS : lot.roll < .3 ? HOUSES : OFFICES;
      const name = list[Math.floor(lot.pick * list.length)];
      if (name === "s-tree-large") { for (const [dx, dz] of [[-.6, -.4], [.6, .3], [0, .8]]) spawn(scenery, name, lot.x + dx, lot.z + dz, 3.4 + lot.size, lot.rotation); continue; }
      spawn(scenery, name, lot.x, lot.z, 0, lot.rotation, .2, 2.6);
    }
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

  // Kenney models (CC0) are cloned on demand; a slot with fit > 0 is scaled to that footprint.
  let models: Map<string, THREE.Object3D> | null = null;
  const pending: { parent: THREE.Object3D; name: string; x: number; z: number; scale: number; rotation: number; y: number; fit: number }[] = [];
  function spawn(parent: THREE.Object3D, name: string, x: number, z: number, scale: number, rotation = 0, y = 0, fit = 0) {
    if (!models) { pending.push({ parent, name, x, z, scale, rotation, y, fit }); return; }
    const source = models.get(name); if (!source) return;
    const copy = source.clone(true);
    if (fit) { const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()); scale = Math.min(2.5, fit / Math.max(size.x, size.z)); }
    copy.position.set(x, y, z); copy.rotation.y = rotation; copy.scale.setScalar(scale);
    copy.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    parent.add(copy);
  }

  // Recognizable landmarks gain architectural detail over five levels.
  const pickables: THREE.Object3D[] = [];
  const anchors = new Map<DistrictId, THREE.Vector3>();
  const rings = new Map<DistrictId, THREE.Mesh>();
  const districtGroups = new Map<DistrictId, THREE.Group>();
  const stages = new Map<DistrictId, number>(CITY_LOCATIONS.map(d => [d.id, districtLevel(levels[d.id] ?? 0, d.soon)]));
  function building(d: CityLocation) {
    const stage = stages.get(d.id)!;
    const { group: g, height } = architecture.landmark(d.id, stage, !!d.soon);
    g.position.set(d.x, .2, d.z); g.scale.setScalar(DISTRICT_SCALE); g.rotation.y = Math.atan2(-d.x, -d.z);
    g.userData.district = d.id; world.add(g); districtGroups.set(d.id, g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, .11, 8, 96), new THREE.MeshBasicMaterial({ color: '#e9bf69', transparent: true, opacity: 0 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(d.x, .45, d.z); world.add(ring); rings.set(d.id, ring);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, height * DISTRICT_SCALE, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(d.x, height * DISTRICT_SCALE / 2, d.z); hit.userData.district = d.id; world.add(hit); pickables.push(hit);
    anchors.set(d.id, new THREE.Vector3(d.x, .2 + height * DISTRICT_SCALE + .7, d.z));
  }
  CITY_LOCATIONS.forEach(building);

  // One compressed file with all models; the city stays usable if it cannot be loaded.
  let modelsSettled = false;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  loader.loadAsync(modelsUrl).then(gltf => {
    if (disposed) return;
    models = new Map(gltf.scenes.map(scene => [scene.name, scene]));
    modelBlocks();
    for (const slot of pending.splice(0)) spawn(slot.parent, slot.name, slot.x, slot.z, slot.scale, slot.rotation, slot.y, slot.fit);
    mergeStatic(scenery);
  }).catch(() => { if (!disposed) { pending.length = 0; simpleBlocks(); mergeStatic(scenery); } }).finally(() => { modelsSettled = true; });


  // Little cars drive around the outer ring road.
  const cars = ["#e8c060", "#e8ede5", "#456e7c"].map((color, i) => {
    const car = architecture.car(world, 0, 0, color); car.scale.setScalar(1.8); mergeStatic(car);
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
      const level = info?.level ?? 1;
      ctx.font = "44px system-ui,sans-serif"; ctx.textAlign = "right";
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i < level ? (active ? "#fff4c2" : "#f2b400") : active ? "#ffffff55" : "#d9d6cf"; ctx.fillText("★", 990 - (4 - i) * 44, 58); }
      ctx.textAlign = "left";
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
    // Keep panning on the island.
    const t = controls.target, length = Math.hypot(t.x, t.z);
    if (length > PAN_RADIUS) { const shift = new THREE.Vector3(t.x, 0, t.z).multiplyScalar(PAN_RADIUS / length - 1); t.add(shift); camera.position.add(shift); }
    t.y = THREE.MathUtils.clamp(t.y, 0, 5);
  });

  let width = 0, height = 0, fitted = false;
  let homeView = DEFAULT_VIEW;
  function resize() {
    width = host.clientWidth; height = host.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.fov = width < 480 ? 55 : 36; camera.updateProjectionMatrix();
    homeView = { ...DEFAULT_VIEW, distance: Math.min(MAX_DISTANCE, Math.max(DEFAULT_VIEW.distance, 42 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect))) };
    if (!fitted && !options.view) applyView(homeView);
    fitted = true;
  }
  drawBoards();
  const observer = new ResizeObserver(resize); observer.observe(host); resize();

  let frame = 0, last = performance.now(), visible = true, ready = false;
  const visibility = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); if (visible && !frame) frame = requestAnimationFrame(tick); });
  visibility.observe(host);
  function tick(now: number) {
    frame = 0; if (!visible || document.hidden) return;
    if (mobile && now - last < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!width || !height) resize();
    stepTween(now);
    controls.update();
    const pulse = reduced ? .5 : (Math.sin(now / 380) + 1) / 2;
    rings.forEach((ring, id) => {
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity = id === selected ? .55 + pulse * .4 : id === hovered ? .45 : 0;
      ring.scale.setScalar(id === selected ? 1 + pulse * .04 : 1);
    });
    if (!reduced) {
      moveCars(dt);
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
    select(id) { if (id === selected) return; selected = id; drawBoards(); focus(id); },
    setLabels(next) { labels = next; drawBoards(); },
    zoom(factor) { animateTo({ distance: currentView().distance * factor }, 320); },
    rotate(radians) { animateTo({ azimuth: currentView().azimuth + radians }, 420); },
    tilt(radians) { animateTo({ polar: currentView().polar + radians }, 320); },
    reset() { animateTo(homeView, 700); },
    focusMascot() { animateTo({ target: [0, 3, 0], azimuth: .12, polar: 1.12, distance: 22 }, 650); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); controls.dispose();
      document.removeEventListener("visibilitychange", onVisible);
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onHover); renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const ownedMaterials = new Set<THREE.Material>();
      scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) { if ('geometry' in o) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => ownedMaterials.add(m)); } });
      ownedMaterials.forEach(m => { Object.values(m).forEach(v => { if (v instanceof THREE.Texture) v.dispose(); }); m.dispose(); });
      materials.forEach(m => m.dispose()); facadeMaterials.forEach(list => list[0].dispose()); facades.forEach(t => t.dispose()); boards.forEach(b => b.texture.dispose()); architecture.dispose(); environment.dispose(); characterRequest++; characterMixer?.stopAllAction(); disposeCharacter(figure); if (nameTag) { (nameTag.material as THREE.SpriteMaterial).map?.dispose(); (nameTag.material as THREE.SpriteMaterial).dispose(); } renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); delete host.dataset.dragging;
    },
  };
}
