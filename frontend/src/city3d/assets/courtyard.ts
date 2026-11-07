/**
 * Procedural models for the residential complexes (world/complexes.ts): the courtyard furniture and two more
 * kinds of tree (the buildings are assets/residential.ts). Every model is painted boxes and cylinders merged into one geometry
 * with vertex colours and no uvs, so one material draws them all and each model is one pool (one draw
 * call) however many yards there are. Sizes go with the walkers (about 1.2 tall): a bench seat is 0.3 high,
 * a slide platform 0.9, a football goal 0.8. Every model's front is +z.
 */
import * as THREE from "three/webgpu";
import { fitPropEnvelope, foliageGeometry, mergePropGeometries, paintProp, vegetationGeometry } from "./vegetation";

type Vec = [number, number, number];

/** Linear colours and surface properties stay in one merged mesh. */
function paint(geometry: THREE.BufferGeometry, color: string) {
  const hex = color.toLowerCase();
  const water = ["#46b9db", "#e3f2fa", "#dcedf6"].includes(hex);
  const foliage = ["#39924c", "#5bb264", "#78c477", "#4ea55a", "#3c9951", "#62b56a", "#86c77d"].includes(hex);
  const metal = [IRON, "#cfd6dc", "#5b6270", "#adb6b0"].includes(hex);
  const soil = ["#f1d99d", "#5f4a3a", "#584b3b"].includes(hex);
  return paintProp(geometry, color, water ? .17 : foliage ? .94 : soil ? .98 : metal ? .4 : .76, metal ? .62 : water ? .04 : 0);
}
const merge = mergePropGeometries;
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

const WOOD = "#b7804c", IRON = "#455052", WHITE = "#f2efe3";

/** A park bench, 0.95 long: slats on two iron frames, the back towards -z. */
function bench(detail = true) {
  const parts: THREE.BufferGeometry[] = [];
  if (!detail) {
    for (const x of [-.4, .4]) {
      parts.push(cube(.045, .3, .3, x, 0, 0, IRON), cube(.045, .3, .04, x, .3, -.155, IRON));
      parts.push(cube(.04, .035, .26, x, .415, -.02, IRON), cube(.035, .1, .035, x, .32, .1, IRON));
    }
    for (let i = 0; i < 4; i++) parts.push(cube(.95, .032, .063, 0, .3, -.105 + i * .07, WOOD));
    for (const y of [.4, .48, .56]) parts.push(cube(.95, .055, .032, 0, y, -.16, WOOD));
    return merge(parts);
  }
  for (const x of [-.4, .4]) {
    for (const z of [-.12, .12]) parts.push(bar([x, .02, z], [x, .3, z], .022, IRON), cube(.08, .018, .09, x, 0, z, IRON));
    parts.push(bar([x, .28, .13], [x, .28, -.14], .023, IRON), bar([x, .28, -.14], [x, .59, -.17], .021, IRON));
    parts.push(bar([x, .43, .11], [x, .43, -.15], .018, IRON), bar([x, .31, .11], [x, .43, .11], .018, IRON));
  }
  for (let i = 0; i < 4; i++) parts.push(cube(.95, .032, .063, 0, .3, -.105 + i * .07, i % 2 ? WOOD : "#c28f5c"));
  for (const y of [.4, .48, .56]) parts.push(cube(.95, .055, .032, 0, y, -.16, WOOD));
  return merge(parts);
}

/** A slide: a platform with a little roof and a ladder at the back, the chute running down to +z. */
function slide() {
  const post = "#e3654f", deck = "#f2ca4f", ladder = "#3c91bd", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.3, .3]) for (const z of [-.9, -.3]) parts.push(cube(.06, 1.5, .06, x, 0, z, post));
  parts.push(cube(.7, .06, .7, 0, .88, -.6, deck), paint(new THREE.ConeGeometry(.52, .35, 4, 1).rotateY(Math.PI / 4).translate(0, 1.67, -.6), ladder));
  for (const x of [-.18, .18]) parts.push(bar([x, 0, -1.2], [x, .92, -.95], .025, ladder, 5));
  for (let k = 1; k <= 4; k++) { const t = k / 5; parts.push(bar([-.18, .92 * t, -1.2 + .25 * t], [.18, .92 * t, -1.2 + .25 * t], .02, ladder, 4)); }
  for (const x of [-.29, .29]) {
    parts.push(bar([x, 1.15, -.88], [x, 1.15, -.34], .018, ladder));
    for (const z of [-.75, -.53]) parts.push(bar([x, .94, z], [x, 1.15, z], .014, ladder, 5));
  }
  for (const x of [-.3, .3]) for (const z of [-.9, -.3]) parts.push(cube(.1, .025, .1, x, 0, z, IRON));
  // The chute: 1.45 long from the platform edge down to the ground, with low sides.
  const chute = new THREE.BoxGeometry(.4, .04, 1.45), slope = Math.atan2(.82, 1.2);
  chute.rotateX(slope).translate(0, .5, .33); parts.push(paint(chute, deck));
  for (const x of [-.21, .21]) { const side = new THREE.BoxGeometry(.03, .12, 1.45); side.rotateX(slope).translate(x, .56, .33); parts.push(paint(side, post)); }
  parts.push(cube(.4, .045, .16, 0, .055, .87, "#b8bdba"));
  return merge(parts);
}

/** Two swings under a bar on A-frames, swinging along z. */
function swings() {
  const frame = "#267da0", seat = "#df6654", rope = "#5a5f68", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.85, .85]) for (const z of [-.38, .38]) parts.push(bar([x, 0, z], [x, 1.3, 0], .035, frame));
  parts.push(bar([-.9, 1.3, 0], [.9, 1.3, 0], .04, frame));
  for (const x of [-.4, .4]) {
    for (const dx of [-.13, .13]) parts.push(bar([x + dx, 1.3, 0], [x + dx, .4, 0], .01, rope, 3));
    parts.push(cube(.34, .04, .16, x, .36, 0, seat));
    for (const dx of [-.13, .13]) parts.push(paint(new THREE.TorusGeometry(.027, .009, 4, 8).translate(x + dx, 1.27, 0), IRON));
  }
  for (const x of [-.85, .85]) for (const z of [-.38, .38]) parts.push(cube(.1, .025, .1, x, 0, z, IRON));
  for (const x of [-.85, .85]) parts.push(bar([x, .55, -.22], [x, .55, .22], .02, frame));
  return merge(parts);
}

/** A climbing frame: a cube of bars 1.2 wide with a ladder of rungs and a yellow top. */
function climber() {
  const green = "#31966f", parts: THREE.BufferGeometry[] = [];
  for (const x of [-.6, .6]) for (const z of [-.6, .6]) parts.push(bar([x, 0, z], [x, 1, z], .03, green));
  for (const y of [.5, 1]) for (const [a, b] of [[[-.6, y, -.6], [.6, y, -.6]], [[-.6, y, .6], [.6, y, .6]], [[-.6, y, -.6], [-.6, y, .6]], [[.6, y, -.6], [.6, y, .6]]] as [Vec, Vec][]) parts.push(bar(a, b, .025, green));
  for (let k = -2; k <= 2; k++) parts.push(bar([k * .24, 1, -.6], [k * .24, 1, .6], .02, "#f2c94c", 4));
  parts.push(cube(.5, .05, .5, -.3, .5, -.3, "#f2c94c"));
  for (const y of [.22, .45, .7]) parts.push(bar([-.6, y, -.6], [.6, y, -.6], .018, "#e9c14f", 5));
  for (const x of [-.6, .6]) for (const z of [-.6, .6]) parts.push(cube(.08, .025, .08, x, 0, z, IRON));
  return merge(parts);
}

/** A sandbox with a wooden edge and the classic mushroom sunshade in a corner. */
function sandbox() {
  const edge = "#bd8c56", parts = [cube(1.3, .06, 1.3, 0, 0, 0, "#f1d99d")];
  for (const s of [-1, 1]) parts.push(cube(1.3, .14, .1, 0, 0, s * .6, edge), cube(.1, .14, 1.1, s * .6, 0, 0, edge));
  parts.push(bar([.45, 0, .45], [.45, 1.05, .45], .035, WHITE), paint(new THREE.ConeGeometry(.5, .28, 10, 1).translate(.45, 1.15, .45), "#e36e55"));
  for (const x of [-.54, .54]) for (const z of [-.54, .54]) parts.push(cube(.22, .035, .22, x, .14, z, WOOD));
  for (const x of [-.59, .59]) for (const z of [-.5, .5]) parts.push(paint(new THREE.CylinderGeometry(.012, .012, .004, 5).translate(x, .179, z), IRON));
  return merge(parts);
}

/** A football goal 1.8 wide and 0.8 high, facing +z, its frame sloping back to the ground. */
function goal() {
  const parts = [bar([-.9, 0, 0], [-.9, .78, 0], .025, WHITE, 8), bar([.9, 0, 0], [.9, .78, 0], .025, WHITE, 8), bar([-.9, .78, 0], [.9, .78, 0], .025, WHITE, 8), bar([-.9, .015, -.55], [.9, .015, -.55], .015, "#cfd6dc")];
  for (const x of [-.9, .9]) parts.push(bar([x, .78, 0], [x, 0, -.55], .018, "#cfd6dc"));
  for (let k = -3; k <= 3; k++) parts.push(bar([k * .3, .78, 0], [k * .3, .02, -.55], .004, "#adb6b0", 3));
  for (let k = 1; k <= 6; k++) { const t = k / 7; parts.push(bar([-.9, .78 * t, -.55 * (1 - t)], [.9, .78 * t, -.55 * (1 - t)], .004, "#adb6b0", 3)); }
  return merge(parts);
}

/** A basketball hoop on a pole behind the board, the rim towards +z. */
function hoop() {
  const parts = [
    bar([0, 0, -.4], [0, 1.72, -.4], .05, "#5b6270"), cube(.06, .06, .34, 0, 1.6, -.25, "#5b6270"),
    cube(.64, .42, .04, 0, 1.3, -.07, WHITE),
    paint(new THREE.TorusGeometry(.12, .014, 5, 14).rotateX(Math.PI / 2).translate(0, 1.36, .1), "#ef7844"),
    cube(.14, .025, .14, 0, 0, -.4, IRON),
  ];
  for (const x of [-.105, .105]) parts.push(cube(.015, .14, .006, x, 1.36, -.045, "#df7844"));
  for (const y of [1.36, 1.49]) parts.push(cube(.22, .015, .006, 0, y, -.045, "#df7844"));
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; parts.push(bar([Math.cos(a) * .115, 1.35, .1 + Math.sin(a) * .115], [Math.cos(a + .18) * .07, 1.16, .1 + Math.sin(a + .18) * .07], .004, "#adb6b0", 3)); }
  parts.push(paint(new THREE.TorusGeometry(.07, .004, 3, 8).rotateX(Math.PI / 2).translate(0, 1.16, .1), "#adb6b0"));
  return merge(parts);
}

/** A six-sided gazebo 2.3 across with a low rail, a wooden floor and a brown roof. */
function gazebo() {
  const parts = [paint(new THREE.CylinderGeometry(1.12, 1.12, .12, 6).translate(0, .06, 0), "#cdb89a")];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, b = (k + 1) / 6 * Math.PI * 2, x = Math.cos(a) * .98, z = Math.sin(a) * .98;
    parts.push(bar([x, .12, z], [x, 1.25, z], .045, WHITE));
    // A rail between the posts, open on one side for the way in.
    if (k !== 1) parts.push(bar([x, .5, z], [Math.cos(b) * .98, .5, Math.sin(b) * .98], .025, WHITE, 4));
    const nx = Math.cos(b) * .98, nz = Math.sin(b) * .98;
    if (k !== 1) for (const t of [.25, .5, .75]) parts.push(bar([x + (nx - x) * t, .15, z + (nz - z) * t], [x + (nx - x) * t, .49, z + (nz - z) * t], .014, WHITE, 4));
    parts.push(bar([x, .95, z], [x * .72, 1.23, z * .72], .025, WOOD, 5));
    parts.push(bar([x * 1.4, 1.24, z * 1.4], [0, 1.87, 0], .012, "#6e5541", 4));
  }
  for (let k = -4; k <= 4; k++) { const x = k * .2, length = Math.sqrt(Math.max(0, 1.02 ** 2 - x * x)) * 1.65; parts.push(cube(.185, .018, length, x, .118, 0, k % 2 ? "#bd956a" : "#c7a37b")); }
  parts.push(paint(new THREE.ConeGeometry(1.4, .65, 6, 1).translate(0, 1.55, 0), "#b2673e"), paint(new THREE.CylinderGeometry(1.42, 1.42, .06, 6).translate(0, 1.22, 0), "#965432"));
  return merge(parts);
}

/** A round flower bed: a stone rim, soil, a clipped shrub in the middle and flowers round it. */
function flowerbed(detail: boolean) {
  const parts = [paint(new THREE.CylinderGeometry(.56, .58, .2, detail ? 16 : 8).translate(0, .1, 0), "#bdb5a5"), paint(new THREE.CylinderGeometry(.5, .5, .025, detail ? 16 : 8).translate(0, .21, 0), "#584b3b"),
    foliageGeometry([0, .36, 0], [.2, .2, .2], "#489951", 5, detail ? 1 : 0)];
  if (detail) {
    const colours = ["#f45b8b", "#ffd24b", "#af7ee8", "#ff8457", "#ffffff"];
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, r = k % 2 ? .36 : .27, x = Math.cos(a) * r, z = Math.sin(a) * r; parts.push(bar([x, .22, z], [x, .31, z], .008, "#3c9951", 4), ball(.05, x, .32, z, colours[k % colours.length])); }
  }
  return merge(parts);
}

/** A rounded shrub; copies get shades of green. */
const bush = (detail: boolean) => merge([
  foliageGeometry([-.12, .23, -.06], [.25, .24, .27], "#47964f", 3, detail ? 1 : 0),
  foliageGeometry([.16, .24, .06], [.25, .25, .24], "#60ac5a", 7, detail ? 1 : 0),
  foliageGeometry([.01, .36, -.03], [.27, .2, .25], "#76b966", 11, detail ? 1 : 0),
]);

/** A clipped hedge piece 1.05 long (pieces stand end to end along a path), with a lighter top. */
const hedge = () => merge(Array.from({ length: 6 }, (_, i) => foliageGeometry([-.43 + i * .172, .18 + (i % 2) * .025, 0], [.18, .18, .17], i % 2 ? "#459c56" : "#60ad60", 13 + i, 0)));

/** A young tree in a square concrete planter, for the paving round the complexes. */
function planter(detail: boolean) {
  const parts = [cube(.5, .26, .5, 0, 0, 0, "#c5bdab"), cube(.44, .025, .44, 0, .26, 0, "#5f4a3a"), paint(new THREE.CylinderGeometry(.027, .04, .62, 7).translate(0, .6, 0), "#7b5a44")];
  for (const side of [-1, 1]) parts.push(cube(.5, .045, .04, 0, .26, side * .23, "#ddd2bf"), cube(.04, .045, .42, side * .23, .26, 0, "#ddd2bf"));
  parts.push(bar([0, .65, 0], [-.13, 1.05, .04], .018, "#7b5a44"), bar([0, .77, 0], [.14, 1.16, -.04], .015, "#7b5a44"));
  parts.push(foliageGeometry([-.1, 1.02, .03], [.23, .25, .24], "#529f55", 17, detail ? 1 : 0), foliageGeometry([.12, 1.15, -.02], [.23, .25, .22], "#85c26d", 19, detail ? 1 : 0));
  return merge(parts);
}

/** A round fountain: a stone basin with water, a column with a bowl, and jets of spray. */
function fountain(detail: boolean) {
  const sides = detail ? 20 : 10, profile = [[.84, .02], [1, .02], [.98, .25], [.94, .32], [.84, .32], [.84, .02]].map(([x, y]) => new THREE.Vector2(x, y));
  const parts = [
    paint(new THREE.LatheGeometry(profile, sides), "#d2c8b4"),
    paint(new THREE.CylinderGeometry(.835, .835, .018, sides).translate(0, .265, 0), "#46b9db"),
    paint(new THREE.CylinderGeometry(.11, .16, .62, 10).translate(0, .58, 0), "#d0c9bc"),
    paint(new THREE.LatheGeometry([[.09, .83], [.26, .85], [.38, .95], [.37, .99], [.25, .91], [.09, .9]].map(([x, y]) => new THREE.Vector2(x, y)), 12), "#d8d2c6"),
    paint(new THREE.CylinderGeometry(.018, .035, .44, 6).translate(0, 1.21, 0), "#e3f2fa"), ball(.035, 0, 1.44, 0, "#e3f2fa"),
  ];
  if (detail) for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x * .22, .94, z * .22), new THREE.Vector3(x * .48, 1.15, z * .48), new THREE.Vector3(x * .67, .28, z * .67));
    parts.push(paint(new THREE.TubeGeometry(curve, 5, .012, 4, false), "#dcedf6"));
  }
  return merge(parts);
}

export type FurnitureKind = "bench" | "slide" | "swings" | "climber" | "sandbox" | "goal" | "hoop" | "gazebo" | "flowerbed" | "bush" | "hedge" | "planter" | "fountain";
/** The near and far geometry of a courtyard model; far is null where it is too small to see at LOD2. */
function buildFurniture(kind: FurnitureKind): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  switch (kind) {
    case "bench": return [bench(), bench(false)];
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

/** Original placement envelopes: detailed replacements retain every path/road clearance and planted height. */
export const FURNITURE_ENVELOPES: Record<FurnitureKind, [Vec, Vec]> = {
  bench: [[-.475, 0, -.1775], [.475, .6, .16]], slide: [[-.367696, -.006556, -1.219518], [.367696, 1.845, .962444]],
  swings: [[-.9, -.00982, -.413595], [.9, 1.334641, .413595]], climber: [[-.625981, 0, -.63], [.625981, 1.025, .63]],
  sandbox: [[-.65, 0, -.65], [.925528, 1.29, .95]], goal: [[-.925, -.010373, -.565], [.925, .81, .025]],
  hoop: [[-.32, 0, -.45], [.32, 1.72, .23064]], gazebo: [[-1.229756, 0, -1.42], [1.229756, 1.875, 1.42]],
  flowerbed: [[-.58, 0, -.58], [.58, .56, .58]], bush: [[-.35013, -.0656, -.34], [.387143, .492, .34]],
  hedge: [[-.525, 0, -.16], [.525, .36, .16]], planter: [[-.3, 0, -.3], [.3, 1.37013, .3]], fountain: [[-1, 0, -1], [1, 1.445, 1]],
};
export function furnitureGeometry(kind: FurnitureKind): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const [near, far] = buildFurniture(kind);
  return [fitPropEnvelope(near, FURNITURE_ENVELOPES[kind]), far ? fitPropEnvelope(far, FURNITURE_ENVELOPES[kind]) : null];
}
export function treeKindGeometry(kind: "birch" | "oak", far: boolean) { return vegetationGeometry(kind, far); }
