/**
 * Procedural models for the residential complexes (world/complexes.ts): the courtyard furniture, two more
 * kinds of tree and the section box. Every model is painted boxes and cylinders merged into one geometry
 * with vertex colours and no uvs, so one material draws them all and each model is one pool (one draw
 * call) however many yards there are. Sizes go with the walkers (about 1.2 tall): a bench seat is 0.3 high,
 * a slide platform 0.9, a football goal 0.8. Every model's front is +z.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Vec = [number, number, number];

/** One colour per vertex and no uvs, so the pieces merge. */
function paint(geometry: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color), part = geometry.index ? geometry.toNonIndexed() : geometry, n = part.getAttribute("position").count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  part.setAttribute("color", new THREE.BufferAttribute(colors, 3)); part.deleteAttribute("uv");
  if (part !== geometry) geometry.dispose();
  return part;
}
function merge(parts: THREE.BufferGeometry[]) { const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged; }
/** A box standing on y (its bottom), centred on x, z. */
const cube = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color);
const up = new THREE.Vector3(0, 1, 0);
/** A round bar from a to b. */
function bar(a: Vec, b: Vec, r: number, color: string, sides = 6) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r, r, length, sides, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return paint(g, color);
}
const ball = (r: number, x: number, y: number, z: number, color: string, detail = 0) => paint(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z), color);

const WOOD = "#b98352", IRON = "#4b5160", WHITE = "#f4f2ec";

/** A park bench, 0.95 long: slats on two iron frames, the back towards -z. */
function bench() {
  const parts = [-.4, .4].flatMap(x => [cube(.05, .3, .32, x, 0, 0, IRON), cube(.05, .3, .04, x, .3, -.15, IRON)]);
  for (const z of [-.1, 0, .1]) parts.push(cube(.95, .035, .085, 0, .3, z, WOOD));
  for (const y of [.42, .53]) parts.push(cube(.95, .06, .035, 0, y, -.16, WOOD));
  return merge(parts);
}

/** A slide: a platform with a little roof and a ladder at the back, the chute running down to +z. */
function slide() {
  const post = "#e05a4f", deck = "#f2c94c", ladder = "#4a90d9", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.3, .3]) for (const z of [-.9, -.3]) parts.push(cube(.06, 1.5, .06, x, 0, z, post));
  parts.push(cube(.7, .06, .7, 0, .88, -.6, deck), paint(new THREE.ConeGeometry(.52, .35, 4, 1).rotateY(Math.PI / 4).translate(0, 1.67, -.6), ladder));
  for (const x of [-.18, .18]) parts.push(bar([x, 0, -1.2], [x, .92, -.95], .025, ladder, 5));
  for (let k = 1; k <= 4; k++) { const t = k / 5; parts.push(bar([-.18, .92 * t, -1.2 + .25 * t], [.18, .92 * t, -1.2 + .25 * t], .02, ladder, 4)); }
  // The chute: 1.45 long from the platform edge down to the ground, with low sides.
  const chute = new THREE.BoxGeometry(.4, .04, 1.45), slope = Math.atan2(.82, 1.2);
  chute.rotateX(slope).translate(0, .5, .33); parts.push(paint(chute, deck));
  for (const x of [-.21, .21]) { const side = new THREE.BoxGeometry(.03, .12, 1.45); side.rotateX(slope).translate(x, .56, .33); parts.push(paint(side, post)); }
  return merge(parts);
}

/** Two swings under a bar on A-frames, swinging along z. */
function swings() {
  const frame = "#3f7fc4", seat = "#f25c54", rope = "#5a5f68", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.85, .85]) for (const z of [-.38, .38]) parts.push(bar([x, 0, z], [x, 1.3, 0], .035, frame));
  parts.push(bar([-.9, 1.3, 0], [.9, 1.3, 0], .04, frame));
  for (const x of [-.4, .4]) {
    for (const dx of [-.13, .13]) parts.push(bar([x + dx, 1.3, 0], [x + dx, .4, 0], .01, rope, 3));
    parts.push(cube(.34, .04, .16, x, .36, 0, seat));
  }
  return merge(parts);
}

/** A climbing frame: a cube of bars 1.2 wide with a ladder of rungs and a yellow top. */
function climber() {
  const green = "#2fa37f", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.6, .6]) for (const z of [-.6, .6]) parts.push(bar([x, 0, z], [x, 1, z], .03, green));
  for (const y of [.5, 1]) for (const [a, b] of [[[-.6, y, -.6], [.6, y, -.6]], [[-.6, y, .6], [.6, y, .6]], [[-.6, y, -.6], [-.6, y, .6]], [[.6, y, -.6], [.6, y, .6]]] as [Vec, Vec][]) parts.push(bar(a, b, .025, green));
  for (let k = -2; k <= 2; k++) parts.push(bar([k * .24, 1, -.6], [k * .24, 1, .6], .02, "#f2c94c", 4));
  parts.push(cube(.5, .05, .5, -.3, .5, -.3, "#f2c94c"));
  return merge(parts);
}

/** A sandbox with a wooden edge and the classic mushroom sunshade in a corner. */
function sandbox() {
  const edge = "#c49a6c", parts = [cube(1.3, .06, 1.3, 0, 0, 0, "#ead7a4")];
  for (const s of [-1, 1]) parts.push(cube(1.3, .14, .1, 0, 0, s * .6, edge), cube(.1, .14, 1.1, s * .6, 0, 0, edge));
  parts.push(bar([.45, 0, .45], [.45, 1.05, .45], .035, WHITE), paint(new THREE.ConeGeometry(.5, .28, 10, 1).translate(.45, 1.15, .45), "#e2574c"));
  return merge(parts);
}

/** A football goal 1.8 wide and 0.8 high, facing +z, its frame sloping back to the ground. */
function goal() {
  const parts = [cube(.05, .8, .05, -.9, 0, 0, WHITE), cube(.05, .8, .05, .9, 0, 0, WHITE), cube(1.85, .05, .05, 0, .76, 0, WHITE), cube(1.85, .03, .03, 0, 0, -.55, "#cfd6dc")];
  for (const x of [-.9, .9]) parts.push(bar([x, .78, 0], [x, 0, -.55], .018, "#cfd6dc", 4));
  // A few net lines over the back.
  for (let k = -2; k <= 2; k++) parts.push(bar([k * .36, .78, 0], [k * .36, 0, -.55], .008, "#dfe4e8", 3));
  return merge(parts);
}

/** A basketball hoop on a pole behind the board, the rim towards +z. */
function hoop() {
  return merge([
    bar([0, 0, -.4], [0, 1.72, -.4], .05, "#5b6270"), cube(.06, .06, .34, 0, 1.6, -.25, "#5b6270"),
    cube(.64, .42, .04, 0, 1.3, -.07, WHITE), cube(.2, .14, .045, 0, 1.36, -.065, "#e8663d"),
    paint(new THREE.TorusGeometry(.12, .014, 5, 14).rotateX(Math.PI / 2).translate(0, 1.36, .1), "#e8663d"),
  ]);
}

/** A six-sided gazebo 2.3 across with a low rail, a wooden floor and a brown roof. */
function gazebo() {
  const parts = [paint(new THREE.CylinderGeometry(1.12, 1.12, .12, 6).translate(0, .06, 0), "#cdb89a")];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, b = (k + 1) / 6 * Math.PI * 2, x = Math.cos(a) * .98, z = Math.sin(a) * .98;
    parts.push(bar([x, .12, z], [x, 1.25, z], .045, WHITE));
    // A rail between the posts, open on one side for the way in.
    if (k !== 1) parts.push(bar([x, .5, z], [Math.cos(b) * .98, .5, Math.sin(b) * .98], .025, WHITE, 4));
  }
  parts.push(paint(new THREE.ConeGeometry(1.4, .65, 6, 1).translate(0, 1.55, 0), "#8c5a3c"), paint(new THREE.CylinderGeometry(1.42, 1.42, .06, 6).translate(0, 1.22, 0), "#7a4d33"));
  return merge(parts);
}

/** A round flower bed: a stone rim, soil, a clipped shrub in the middle and flowers round it. */
function flowerbed(detail: boolean) {
  const parts = [paint(new THREE.CylinderGeometry(.56, .58, .2, detail ? 16 : 8).translate(0, .1, 0), "#cbc3b4"), paint(new THREE.CylinderGeometry(.5, .5, .04, detail ? 16 : 8).translate(0, .21, 0), "#5d7f45"),
    ball(.2, 0, .36, 0, "#4f7f45", detail ? 1 : 0)];
  if (detail) {
    const colours = ["#f06a8a", "#f3d34a", "#b58be0", "#ff7b54", "#ffffff"];
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, r = k % 2 ? .36 : .27; parts.push(ball(.065, Math.cos(a) * r, .27, Math.sin(a) * r, colours[k % colours.length])); }
  }
  return merge(parts);
}

/** A rounded shrub; copies get shades of green. */
const bush = (detail: boolean) => merge([ball(.34, 0, .26, 0, "#6f9a57", detail ? 1 : 0).scale(1, .82, 1), ...(detail ? [ball(.22, .2, .22, .1, "#7fa864"), ball(.2, -.18, .2, -.08, "#648e4e")] : [])]);

/** A clipped hedge piece 1.05 long (pieces stand end to end along a path), with a lighter top. */
const hedge = () => merge([cube(1.05, .3, .32, 0, 0, 0, "#557f46"), cube(1.02, .06, .3, 0, .3, 0, "#6c9657")]);

/** A young tree in a square concrete planter, for the paving round the complexes. */
function planter(detail: boolean) {
  return merge([cube(.5, .3, .5, 0, 0, 0, "#b9b5ad"), cube(.44, .03, .44, 0, .3, 0, "#5f4a3a"), paint(new THREE.CylinderGeometry(.03, .04, .6, 5).translate(0, .6, 0), "#7b5a44"),
    ball(.3, 0, 1.02, 0, "#6f9a57", detail ? 1 : 0), ...(detail ? [ball(.2, .12, 1.2, .05, "#83ad66")] : [])]);
}

/** A round fountain: a stone basin with water, a column with a bowl, and jets of spray. */
function fountain(detail: boolean) {
  const sides = detail ? 20 : 10, parts = [
    paint(new THREE.CylinderGeometry(.95, 1, .32, sides).translate(0, .16, 0), "#cfc8bb"), paint(new THREE.CylinderGeometry(.84, .84, .04, sides).translate(0, .3, 0), "#6fb3d8"),
    paint(new THREE.CylinderGeometry(.12, .16, .62, 8).translate(0, .62, 0), "#d8d2c6"), paint(new THREE.CylinderGeometry(.38, .26, .1, 12).translate(0, .95, 0), "#d8d2c6"),
    paint(new THREE.ConeGeometry(.08, .45, 6).translate(0, 1.22, 0), "#e3f2fa"),
  ];
  if (detail) for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; parts.push(paint(new THREE.ConeGeometry(.05, .3, 5).translate(Math.cos(a) * .55, .45, Math.sin(a) * .55), "#dcedf6")); }
  return merge(parts);
}

/** A birch: a slim white trunk with dark marks and a light, tall crown. */
function birch(far: boolean) {
  const parts = [paint(new THREE.CylinderGeometry(.045, .065, 1.7, far ? 4 : 6).translate(0, .85, 0), "#efeae0")];
  if (!far) for (const y of [.5, .9, 1.25]) parts.push(paint(new THREE.CylinderGeometry(.067, .067, .05, 6).translate(0, y, 0), "#3d3b38"));
  parts.push(paint(new THREE.IcosahedronGeometry(.46, far ? 0 : 1).scale(1, 1.45, 1).translate(0, 1.85, 0), "#9fc26b"));
  if (!far) parts.push(ball(.3, .12, 2.35, .05, "#b4d27a", 1));
  return merge(parts);
}

/** An oak: a thick trunk and a wide crown of three clumps. */
function oak(far: boolean) {
  const parts = [paint(new THREE.CylinderGeometry(.09, .14, .9, far ? 4 : 7).translate(0, .45, 0), "#7b5a44")];
  if (far) parts.push(ball(.85, 0, 1.4, 0, "#5e8a4f"));
  else parts.push(ball(.6, 0, 1.45, 0, "#5e8a4f", 1), ball(.48, .42, 1.25, .2, "#6b9a58", 1), ball(.46, -.36, 1.3, -.26, "#557f47", 1));
  return merge(parts);
}

export type FurnitureKind = "bench" | "slide" | "swings" | "climber" | "sandbox" | "goal" | "hoop" | "gazebo" | "flowerbed" | "bush" | "hedge" | "planter" | "fountain";
/** The near and far geometry of a courtyard model; far is null where it is too small to see at LOD2. */
export function furnitureGeometry(kind: FurnitureKind): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  switch (kind) {
    case "bench": return [bench(), null];
    case "slide": return [slide(), null];
    case "swings": return [swings(), null];
    case "climber": return [climber(), null];
    case "sandbox": return [sandbox(), null];
    case "goal": return [goal(), null];
    case "hoop": return [hoop(), null];
    case "gazebo": return [gazebo(), null];
    case "flowerbed": return [flowerbed(true), flowerbed(false)];
    case "bush": return [bush(true), bush(false)];
    case "hedge": return [hedge(), null];
    case "planter": return [planter(true), planter(false)];
    case "fountain": return [fountain(true), fountain(false)];
  }
}
export function treeKindGeometry(kind: "birch" | "oak", far: boolean) { return kind === "birch" ? birch(far) : oak(far); }

/** The vertex attribute that tells the section material what a face is (SECTION_PARTS). */
export const SECTION_PART = "sectionPart";
/** Section faces: the facade with windows, white trim (balcony slabs, parapet, canopy), roof, balcony glass, plain walls. */
export const SECTION_PARTS = { facade: 0, trim: 1, roof: 2, glass: 3, plain: 4 } as const;

/** A box standing on y (its bottom), every face one part except its top and bottom, which may have their own. */
function partBox(w: number, h: number, d: number, x: number, y: number, z: number, part: number, top = part, bottom = part) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();
  g.deleteAttribute("uv");
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z, six vertices each once unindexed.
  const parts = new Float32Array(36).map((_, i) => { const face = Math.floor(i / 6); return face === 2 ? top : face === 3 ? bottom : part; });
  g.setAttribute(SECTION_PART, new THREE.BufferAttribute(parts, 1));
  return g;
}

/**
 * A section of `floors` in unit space (x and z in ±0.5, y 0…1); copies are scaled to their width, depth and
 * floors × 0.75. Detail 2: a balcony on every floor of both long fronts (a white slab, a glass rail), a
 * canopy over the ground floor, a parapet and a stair and lift house on the roof. Detail 1: the same with
 * bare slabs, no rails. Detail 0: the plain box, the same for every height. Sizes are in world units at a width of
 * 3.2 and a depth of 2.4; the bottom is closed, so a section over an arch is solid from below.
 */
export function sectionGeometry(floors: number, detail: 0 | 1 | 2) {
  const P = SECTION_PARTS, height = floors * .75, y = (units: number) => units / height, z = (units: number) => units / 2.4, x = (units: number) => units / 3.2;
  const parts = [partBox(1, 1, 1, 0, 0, 0, P.facade, P.roof, P.plain)];
  if (detail >= 1) {
    const rim = y(.28), thick = z(.08);
    parts.push(partBox(1, rim, thick, 0, 1, .5 - thick / 2, P.trim), partBox(1, rim, thick, 0, 1, -.5 + thick / 2, P.trim));
    parts.push(partBox(x(.08), rim, 1 - 2 * thick, .5 - x(.04), 1, 0, P.trim), partBox(x(.08), rim, 1 - 2 * thick, -.5 + x(.04), 1, 0, P.trim));
    parts.push(partBox(x(.75), y(.7), z(.9), x(.35), 1, 0, P.plain, P.roof));
  }
  if (detail >= 1) {
    const slab = y(.06), rail = y(.26), out = z(.15), glass = z(.02);
    for (const side of [-1, 1]) {
      // The canopy over the doors, a little deeper than the balconies.
      parts.push(partBox(1, slab, z(.26), 0, 1 / floors - slab, side * (.5 + z(.13)), P.trim));
      for (let k = 1; k < floors; k++) {
        const base = k / floors;
        parts.push(partBox(.98, slab, out, 0, base, side * (.5 + out / 2), P.trim));
        if (detail === 2) parts.push(partBox(.98, rail, glass, 0, base + slab, side * (.5 + out - glass / 2), P.glass));
      }
    }
  }
  const merged = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
  return merged;
}

/**
 * An office tower (or podium) of `floors` in unit space, scaled to its width, depth and floors × 0.9 like a
 * section. Detail 2: slim fins up the four corners, a glass crown band under a parapet, a canopy over the
 * lobby on both long fronts and plant on the roof. Detail 1: parapet and roof plant. Detail 0: the plain box.
 * Sizes are in world units at a nominal 9 × 7 footprint.
 */
export function officeGeometry(floors: number, detail: 0 | 1 | 2) {
  const P = SECTION_PARTS, height = floors * .9, y = (units: number) => units / height, z = (units: number) => units / 7, x = (units: number) => units / 9;
  const parts = [partBox(1, 1, 1, 0, 0, 0, P.facade, P.roof, P.plain)];
  if (detail >= 1) {
    const rim = y(.45), tz = z(.12), tx = x(.12);
    parts.push(partBox(1, rim, tz, 0, 1, .5 - tz / 2, P.trim), partBox(1, rim, tz, 0, 1, -.5 + tz / 2, P.trim));
    parts.push(partBox(tx, rim, 1 - 2 * tz, .5 - tx / 2, 1, 0, P.trim), partBox(tx, rim, 1 - 2 * tz, -.5 + tx / 2, 1, 0, P.trim));
    parts.push(partBox(x(3), y(1.1), z(2.6), x(-1.2), 1, z(.4), P.plain, P.roof), partBox(x(1.6), y(.7), z(1.6), x(2.4), 1, z(-1), P.plain, P.roof));
  }
  if (detail === 2) {
    const fin = x(.22), finZ = z(.22);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(partBox(fin, 1, finZ, sx * (.5 + fin / 2 - x(.05)), 0, sz * (.5 + finZ / 2 - z(.05)), P.trim));
    if (floors > 4) for (const side of [-1, 1]) parts.push(partBox(1.01, y(.22), z(.08), 0, 1 - y(.9), side * (.5 + z(.04)), P.trim));
    for (const side of [-1, 1]) parts.push(partBox(.5, y(.1), z(1.1), 0, 1 / floors, side * (.5 + z(.55)), P.trim));
  }
  const merged = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
  return merged;
}

/**
 * A gabled roof in unit space: x ±0.5 (the eaves), z ±0.5 (the ridge runs along z, so the gables face ±z), y 0…1
 * (the ridge); copies are scaled to the house's width, depth and roof height. Slopes and gables, no bottom.
 */
export function gableGeometry() {
  const p = [-.5, 0, -.5, .5, 0, -.5, 0, 1, -.5, -.5, 0, .5, .5, 0, .5, 0, 1, .5];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  // Gables (front and back) and the two slopes.
  geometry.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  const flat = geometry.toNonIndexed(); geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}
