/** Six pedestrian silhouettes on the city's shared shader rig; no skeletons, textures or per-frame CPU animation. */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const PEOPLE = [
  { id: "casual-jacket", name: "Горожанин в куртке", outfit: "Куртка и джинсы", description: "Короткая стрижка, куртка с воротником, джинсы и светлые кеды.", palette: { shirt: "#287b9e", skin: "#d19b77", trousers: "#354b68", hair: "#292520", shoes: "#e8e5dc", accent: "#d5aa69" } },
  { id: "trench-bag", name: "Горожанка в плаще", outfit: "Плащ и сумка", description: "Приталенный плащ, волосы до плеч, пояс и небольшая сумка через плечо.", palette: { shirt: "#c6a276", skin: "#e9bc99", trousers: "#4b515b", hair: "#432e25", shoes: "#654533", accent: "#854d32" } },
  { id: "sporty-ponytail", name: "Горожанка в худи", outfit: "Худи и кроссовки", description: "Спортивная одежда, собранные волосы, худи с капюшоном и контрастные кроссовки.", palette: { shirt: "#8262ae", skin: "#976543", trousers: "#343e4b", hair: "#272322", shoes: "#f1ede4", accent: "#54b79f" } },
  { id: "business-suit", name: "Горожанин в костюме", outfit: "Костюм и галстук", description: "Пиджак с лацканами, светлая рубашка, галстук и аккуратная короткая причёска.", palette: { shirt: "#354d66", skin: "#bd8965", trousers: "#344154", hair: "#332a26", shoes: "#342d29", accent: "#a64d51" } },
  { id: "silver-coat", name: "Горожанин в пальто", outfit: "Пальто и шарф", description: "Седые волосы, свободное пальто, шарф и удобная обувь.", palette: { shirt: "#597563", skin: "#dfb391", trousers: "#5b5754", hair: "#c5c6c2", shoes: "#58483e", accent: "#c1a56b" } },
  { id: "backpack-cap", name: "Горожанин с рюкзаком", outfit: "Футболка, кепка и рюкзак", description: "Футболка с короткими рукавами, кепка с козырьком и небольшой городской рюкзак.", palette: { shirt: "#d97a49", skin: "#b7805c", trousers: "#42666a", hair: "#302923", shoes: "#e2ded2", accent: "#325872" } },
] as const;

export type PersonDetail = "near" | "far";
const BONE = { body: 0, thighL: 1, shinL: 2, footL: 3, thighR: 4, shinR: 5, footR: 6, armL: 7, foreL: 8, armR: 9, foreR: 10 } as const;
const SLOT = { shirt: 0, skin: 1, trousers: 2, hair: 3, shoes: 4, sleeve: 5, accent: 6, white: 7, eyes: 8 } as const;
const HIP = .71, KNEE = .41, ANKLE = .09, SHOULDER = 1.166, ELBOW = .921;
interface Shape { shoulder: number; waist: number; hem: number; bottom: number; depth: number; arm: number; leg: number; head: number; style: "short" | "bob" | "pony" | "part" | "silver" | "cap" }
const SHAPES: Shape[] = [
  { shoulder: .202, waist: .154, hem: .155, bottom: .80, depth: .69, arm: .062, leg: .064, head: .104, style: "short" },
  { shoulder: .177, waist: .127, hem: .198, bottom: .59, depth: .66, arm: .054, leg: .056, head: .098, style: "bob" },
  { shoulder: .184, waist: .145, hem: .154, bottom: .835, depth: .70, arm: .055, leg: .059, head: .099, style: "pony" },
  { shoulder: .194, waist: .148, hem: .165, bottom: .785, depth: .66, arm: .059, leg: .060, head: .103, style: "part" },
  { shoulder: .196, waist: .168, hem: .182, bottom: .665, depth: .73, arm: .061, leg: .062, head: .105, style: "silver" },
  { shoulder: .181, waist: .145, hem: .152, bottom: .835, depth: .69, arm: .054, leg: .058, head: .101, style: "cap" },
];

/** A closed coat at distance: keep the shoulder breadth without subpixel folds. */
function coarseJacket(shape: Shape) {
  const rings = [[shape.bottom, shape.hem, shape.hem * shape.depth], [1.12, shape.shoulder, shape.shoulder * shape.depth], [1.195, shape.shoulder * .92, shape.shoulder * .92 * shape.depth], [1.235, .076, .061]];
  const points: number[] = [], index: number[] = [];
  for (const [y, w, d] of rings) for (const [x, z] of [[-w, -d], [w, -d], [w, d], [-w, d]]) points.push(x, y, z);
  for (let row = 0; row < rings.length - 1; row++) for (let side = 0; side < 4; side++) { const a = row * 4 + side, b = row * 4 + (side + 1) % 4; index.push(a, a + 4, b + 4, a, b + 4, b); }
  index.push(0, 1, 2, 0, 2, 3, 12, 14, 13, 12, 15, 14);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3)); g.setIndex(index); g.computeVertexNormals(); return g;
}

/** Fresh geometry per call; the crowd owns and disposes its six near/far prototypes. */
export function personGeometry(variant = 0, detail: PersonDetail = "near"): THREE.BufferGeometry {
  const index = Number.isFinite(variant) ? ((Math.trunc(variant) % PEOPLE.length) + PEOPLE.length) % PEOPLE.length : 0;
  const shape = SHAPES[index], far = detail === "far", parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, bone: number, slot: number, shade = 1) => {
    let flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute("uv");
    // Collapsed pole triangles from capsules/lathe caps have no normal and do not draw a surface.
    const p = flat.getAttribute("position"), kept: number[] = [];
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
      const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
      const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      if (x * x + y * y + z * z > 1e-16) kept.push(i, i + 1, i + 2);
    }
    if (kept.length !== p.count) {
      const clean = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(flat.attributes)) {
        const data = new Float32Array(kept.length * attr.itemSize);
        kept.forEach((v, i) => { for (let k = 0; k < attr.itemSize; k++) data[i * attr.itemSize + k] = attr.getComponent(v, k); });
        clean.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize));
      }
      flat.dispose(); flat = clean;
    }
    const normal = flat.getAttribute("normal"), marks = new Float32Array(normal.count * 2), shades = new Float32Array(normal.count);
    for (let i = 0; i < normal.count; i++) { marks.set([bone, slot], i * 2); shades[i] = shade * (.86 + .14 * (normal.getY(i) * .5 + .5)); }
    flat.setAttribute("aPart", new THREE.BufferAttribute(marks, 2)); flat.setAttribute("aShade", new THREE.BufferAttribute(shades, 1)); parts.push(flat);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, slot: number, bone: number = BONE.body, shade = 1) => add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), bone, slot, shade);
  const sphere = (radius: number, x: number, y: number, z: number, slot: number, sx = 1, sy = 1, sz = 1, bone: number = BONE.body) => {
    const g = far ? new THREE.OctahedronGeometry(radius) : new THREE.SphereGeometry(radius, 6, 4);
    g.scale(sx, sy, sz).translate(x, y, z); add(g, bone, slot);
  };
  const strip = (w: number, h: number, x: number, y: number, z: number, slot: number, angle = 0, shade = 1) => {
    const g = new THREE.PlaneGeometry(w, h); g.rotateZ(angle); g.translate(x, y, z); add(g, BONE.body, slot, shade);
  };
  if (far) add(coarseJacket(shape), BONE.body, SLOT.shirt);
  else {
    const profile = [[0, shape.bottom], [shape.hem, shape.bottom], [shape.waist, .9], [shape.shoulder, 1.12], [shape.shoulder * .92, 1.195], [.078, 1.24], [0, 1.24]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(profile, 10); g.scale(1, 1, shape.depth); add(g, BONE.body, SLOT.shirt);
  }
  if (shape.bottom > .73) {
    if (far) box(.27, .16, .18, 0, .785, 0, SLOT.trousers);
    else { const g = new THREE.CapsuleGeometry(.125, .13, 2, 8); g.rotateZ(Math.PI / 2); g.scale(.82, .78, .82); g.translate(0, .769, 0); add(g, BONE.body, SLOT.trousers); }
  }
  const neck = new THREE.CylinderGeometry(.047, .054, .105, far ? 4 : 6, 1, true); neck.translate(0, 1.2825, 0); add(neck, BONE.body, SLOT.skin);
  const head = far ? new THREE.OctahedronGeometry(1) : new THREE.SphereGeometry(1, 8, 6);
  const hp = head.getAttribute("position");
  for (let i = 0; i < hp.count; i++) { const y = hp.getY(i), jaw = y < 0 ? 1 + y * .12 : 1; hp.setX(i, hp.getX(i) * jaw); }
  head.scale(shape.head, .119, .102).translate(0, 1.429, 0); head.computeVertexNormals(); add(head, BONE.body, SLOT.skin);
  if (!far) {
    const nose = new THREE.ConeGeometry(.012, .03, 4); nose.rotateX(Math.PI / 2); nose.translate(0, 1.423, .105); add(nose, BONE.body, SLOT.skin);
    for (const side of [-1, 1]) {
      sphere(.014, side * (shape.head - .003), 1.426, -.004, SLOT.skin, .55, 1.2, .7);
      strip(.012, .0045, side * .034, 1.447, .097, SLOT.eyes);
      strip(.021, .003, side * .034, 1.459, .096, SLOT.hair);
    }
    strip(.022, .0028, 0, 1.39, .099, SLOT.skin, 0, .72);
  }
  // Hair is geometry, not a painted face: each style retains its own visible silhouette in the far prototype.
  const hairAngle = Math.PI * (shape.style === "bob" ? .72 : .55);
  const hair = new THREE.SphereGeometry(.113, far ? 4 : 8, far ? 2 : 4, 0, Math.PI * 2, 0, hairAngle), hairPoints = hair.getAttribute("position");
  for (let i = 0; i < hairPoints.count; i++) {
    const x = hairPoints.getX(i), y = hairPoints.getY(i), z = hairPoints.getZ(i), horizontal = Math.hypot(x, z);
    if (horizontal < 1e-8) continue;
    // Lift the fringe above the eyes, while keeping the bob/nape long at the sides and back.
    const front = Math.max(0, z / horizontal), angle = Math.acos(Math.max(-1, Math.min(1, y / .113))) * (hairAngle - (hairAngle - Math.PI * .47) * front) / hairAngle;
    const ring = Math.sin(angle) * .113 / horizontal;
    hairPoints.setXYZ(i, x * ring, Math.cos(angle) * .113, z * ring);
  }
  hair.computeVertexNormals();
  hair.rotateX(-.16); hair.scale(shape.head / .104, 1.04, .95); hair.translate(0, 1.436, -.008); add(hair, BONE.body, SLOT.hair);
  if (shape.style === "bob") box(.18, .17, .056, 0, 1.358, -.075, SLOT.hair);
  if (shape.style === "pony") sphere(.048, 0, 1.391, -.137, SLOT.hair, .78, 1.8, .82);
  if (shape.style === "cap") {
    // The textile crown lies over the hair, and the thin visor extends forward.
    const cap = new THREE.SphereGeometry(.117, far ? 4 : 8, far ? 2 : 3, 0, Math.PI * 2, 0, Math.PI * .48); cap.scale(.98, .64, 1).translate(0, 1.503, -.004); add(cap, BONE.body, SLOT.accent);
    box(far ? .15 : .17, .012, .12, 0, 1.511, .103, SLOT.accent);
  }
  const armX = shape.shoulder + .028;
  for (const side of [-1, 1]) {
    const left = side < 0, x = side * .095, ax = side * armX;
    const limb = (radius: number, from: number, to: number, bone: number, slot: number, lx: number, taper = 1) => {
      const height = from - to;
      // The cap centres sit on the rig pivots, so neighbouring limbs overlap even while bent.
      const g = far ? new THREE.CylinderGeometry(radius, radius * taper, height + radius * 2, 4, 1, true) : new THREE.CapsuleGeometry(radius, height, 2, 6);
      if (!far && taper !== 1) { const p = g.getAttribute("position"); for (let i = 0; i < p.count; i++) { const t = Math.max(0, Math.min(1, (p.getY(i) + height / 2) / height)), k = taper + (1 - taper) * t; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals(); }
      g.translate(lx, (from + to) / 2, 0); add(g, bone, slot);
    };
    limb(shape.leg, HIP, KNEE, left ? BONE.thighL : BONE.thighR, SLOT.trousers, x);
    limb(shape.leg * .86, KNEE, ANKLE, left ? BONE.shinL : BONE.shinR, SLOT.trousers, x, .88);
    const foot = left ? BONE.footL : BONE.footR;
    if (far) box(.108, .086, .18, x, .047, .035, SLOT.shoes, foot);
    else {
      const g = new THREE.CapsuleGeometry(.056, .09, 1, 6); g.rotateX(Math.PI / 2); g.scale(1, .88, 1); g.translate(x, .049, .035); add(g, foot, SLOT.shoes);
      box(.105, .013, .175, x, .01005, .035, SLOT.shoes, foot, .55);
    }
    const upper = left ? BONE.armL : BONE.armR, fore = left ? BONE.foreL : BONE.foreR;
    limb(shape.arm, SHOULDER, ELBOW, upper, SLOT.shirt, ax);
    limb(.041, ELBOW, ELBOW - .225, fore, SLOT.sleeve, ax, .7);
    sphere(.043, ax, ELBOW - .241, .003, SLOT.skin, .72, 1.05, .62, fore);
  }
  // Garment seams and accessories stay on the torso's bone; no extra animated meshes or material groups.
  if (index === 0) {
    if (!far) { strip(.014, .34, 0, 1.047, .141, SLOT.accent); for (const side of [-1, 1]) strip(.05, .028, side * .09, 1.015, .131, SLOT.shirt, side * .14, .72); }
  } else if (index === 1) {
    if (!far) box(.28, .028, .22, 0, .868, 0, SLOT.accent);
    {
      // Follow the coat surface to the bag, instead of ending a flat diagonal above it.
      const coordinates = far
        ? [[-.11, 1.21, .10], [.06, 1.04, .13], [.278, .84, .032]]
        : [[-.11, 1.21, .062], [-.04, 1.14, .124], [.06, 1.04, .112], [.13, .94, .04], [.278, .84, .032]];
      const path = coordinates.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], direction = b.clone().sub(a);
        const strap = new THREE.BoxGeometry(.024, direction.length() + .012, .012);
        strap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
        strap.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); add(strap, BONE.body, SLOT.accent);
      }
    }
    box(.105, .16, .075, .278, .763, -.008, SLOT.accent);
  } else if (index === 2) {
    if (far) box(.14, .105, .075, 0, 1.227, -.088, SLOT.shirt);
    else { sphere(.09, 0, 1.223, -.063, SLOT.shirt, 1, .73, .72); strip(.065, .045, 0, 1.08, .134, SLOT.accent); for (const side of [-1, 1]) strip(.007, .09, side * .029, 1.185, .108, SLOT.white, side * .06); }
  } else if (index === 3) {
    strip(.077, .13, 0, 1.17, .112, SLOT.white);
    strip(.021, .145, 0, 1.111, .142, SLOT.accent);
    if (!far) for (const side of [-1, 1]) strip(.04, .19, side * .057, 1.136, .137, SLOT.shirt, side * .32, .74);
  } else if (index === 4) {
    box(.12, .07, .12, 0, 1.26, .015, SLOT.accent);
    if (!far) { strip(.06, .26, -.042, 1.1, .15, SLOT.accent, -.10); for (const y of [.82, .94, 1.06]) sphere(.009, .025, y, .143, SLOT.eyes, 1, 1, .4); }
  } else {
    box(.205, .27, .105, 0, 1.012, -.153, SLOT.accent);
    if (!far) { box(.155, .10, .036, 0, .952, -.222, SLOT.accent, BONE.body, .76); for (const side of [-1, 1]) strip(.024, .25, side * .124, 1.082, .124, SLOT.accent, side * -.08); }
  }
  const geometry = mergeGeometries(parts)!; parts.forEach(part => part.dispose());
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = `person-${PEOPLE[index].id}-${detail}`;
  return geometry;
}
