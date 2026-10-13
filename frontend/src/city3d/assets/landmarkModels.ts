/**
 * The district landmarks on their islands, five levels each (pages/city/cityLevels.ts): every level a building of its
 * own, bigger and richer than the one before, every district its own architecture.
 * - Academy: a village school, a college with a clock, a university with a portico and a clock tower, a campus round a
 *   dome, a great university with a stepped tower and a spire.
 * - Driver: a garage, a service station, a taxi fleet, a depot with a hangar, a transport hub with a car park.
 * - CRM: a small office, a glass office, a tower on a podium, a tower with roof gardens, twin towers with a skybridge.
 * - Dispatch: a radio hut with a mast, a radio station, a control tower, a control tower with a radar, a TV tower.
 * - Oktell: a telephone exchange, the domed exchange, a call centre under a headset, a communications centre, a
 *   satellite centre.
 * - Scenarios: an open-air stage, a studio, a theatre, a film studio, a grand theatre.
 * Drawn with assets/landmarkKit.ts on the 5.7 × 5.3 plinth, the front to +z; ground-level parts stay on the plinth.
 */
import * as THREE from 'three';
import type { DistrictId } from '../../api/city';
import { C, PLINTH as Y, type LandmarkKit } from './landmarkKit';

type Kit = LandmarkKit;
type Part = THREE.Object3D;
type Model = (k: Kit, p: Part, level: number) => void;

/** The districts' own colours (as on the map's district shields): flags, awnings, stripes. */
const ACCENT = { academy: '#5b8def', driver: '#f0a23a', crm: '#7b5cff', dispatch: '#35b6a6', oktell: '#e86aa6', scenarios: '#6fa8c7' };
const BULB = '#fff0c0';
const up = new THREE.Vector3(0, 1, 0);

/** A rod of thickness t from a to b: braces, guy wires, legs. */
function rod(k: Kit, p: Part, a: [number, number, number], b: [number, number, number], t: number, c: string) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), along = to.clone().sub(from), length = along.length();
  const m = k.box(p, t, length, t, c, 0, 0, 0, 0);
  m.position.copy(from).addScaledVector(along, .5); m.quaternion.setFromUnitVectors(up, along.normalize());
  return m;
}
/** A column h tall on y0: a plinth block, a shaft of radius r and a capital. */
function column(k: Kit, p: Part, x: number, z: number, y0: number, h: number, r = .09, c: string = C.ivory) {
  k.block(p, r * 2.7, .07, r * 2.7, C.stone, x, y0, z);
  k.post(p, r, h - .14, c, x, y0 + .07, z, r * .88, 10);
  k.block(p, r * 2.9, .07, r * 2.9, C.stone, x, y0 + h - .07, z);
}
/**
 * A temple front w wide and d deep, centred at z: a stylobate on y0, columns at xs h tall, an entablature and a
 * pediment of `rise`; returns the top of the entablature.
 */
function portico(k: Kit, p: Part, xs: readonly number[], w: number, d: number, z: number, y0: number, h: number, rise: number) {
  k.block(p, w, .16, d, C.ivory, 0, y0, z);
  for (const x of xs) column(k, p, x, z + d / 2 - .22, y0 + .16, h);
  const top = y0 + .16 + h;
  k.block(p, w + .1, .24, d + .06, C.ivory, 0, top, z);
  k.block(p, w + .14, .05, d + .1, C.trim, 0, top + .24, z);
  if (rise > 0) k.prism(p, w + .12, rise, d + .08, C.ivory, 0, top + .29, z);
  return top + .24;
}
/**
 * Storeys of glass between slabs: w × d centred on (x, z), from y0, each `storey` high, with fins on the front;
 * returns the top of the last slab.
 */
function glassFloors(k: Kit, p: Part, w: number, d: number, x: number, z: number, y0: number, floors: number, storey: number, slab: string = C.ivory, fins = 0) {
  k.block(p, w - .08, floors * storey, d - .08, C.glass, x, y0, z);
  for (let i = 0; i <= floors; i++) k.block(p, w + .06, .09, d + .06, slab, x, y0 + i * storey - (i ? .09 : 0), z);
  for (let i = 0; i < fins; i++) k.block(p, .05, floors * storey, .07, C.gold, x - w / 2 + w * (i + .5) / fins, y0, z + d / 2 - .01);
  return y0 + floors * storey;
}
/** Corner piers over a block's height, so a glass box reads as a framed building. */
function piers(k: Kit, p: Part, w: number, d: number, x: number, z: number, y0: number, h: number, c: string = C.ivory) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(p, .14, h, .14, c, x + sx * (w / 2 - .04), y0, z + sz * (d / 2 - .04));
}
/** A clock face on the front at (x, y, z): dial, gold rim and hands. */
function clock(k: Kit, p: Part, x: number, y: number, z: number, r = .24) {
  k.cyl(p, r, .05, C.ivory, x, y, z, r, 24).rotation.x = Math.PI / 2;
  k.torus(p, r, .025, C.gold, x, y, z + .03, 24);
  k.box(p, .025, r * .75, .02, C.ink, x, y + r * .3, z + .045, 0);
  k.box(p, r * .6, .025, .02, C.ink, x + r * .25, y, z + .045, 0);
}
/** A row of trees along x at z. */
const trees = (k: Kit, p: Part, xs: readonly number[], z: number, s = .8) => xs.forEach((x, i) => k.tree(p, x, z, s * (i % 2 ? .9 : 1)));
/** A park bench facing +z turned by `turn`. */
function bench(k: Kit, p: Part, x: number, z: number, turn = 0) {
  const g = new THREE.Group(); g.position.set(x, Y, z); g.rotation.y = turn; p.add(g);
  k.block(g, .7, .05, .2, C.wood, 0, .2, 0); k.block(g, .7, .18, .04, C.wood, 0, .25, -.09);
  for (const sx of [-1, 1]) k.block(g, .04, .2, .18, C.ink, sx * .3, 0, 0);
}
/** Light bulbs along a marquee's edge, from x0 to x1 at y and z. */
function bulbs(k: Kit, p: Part, x0: number, x1: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) k.ball(p, .04, BULB, x0 + (x1 - x0) * i / (n - 1), y, z, 6);
}
/** A checker band of `n` squares s wide along x at (y, z): the taxi livery. */
function checker(k: Kit, p: Part, x0: number, y: number, z: number, n: number, s: number, rows = 2) {
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) k.box(p, s, s, .03, (i + r) % 2 ? C.ink : C.taxi, x0 + s * (i + .5), y + s * (r + .5), z, 0);
}

const academy: Model = (k, p, level) => {
  const blue = ACCENT.academy;
  if (level === 1) {
    // A village school: one hall under a pitched roof, its gable to the front, a belfry and a flag.
    k.block(p, 2.6, 1.25, 1.8, C.stone, 0, Y, -.55, .06);
    k.block(p, 2.7, .08, 1.9, C.ivory, 0, Y + 1.25, -.55);
    k.pitched(p, 2.6, 1.8, .85, 0, Y + 1.33, -.55);
    k.block(p, .55, .92, .07, C.ink, 0, Y, .37); k.block(p, .75, .08, .3, C.roof, 0, Y + .98, .5);
    k.panes(p, 'front', .35, Y + .35, [-.85, .85], .5, .6);
    k.panes(p, 'left', -1.3, Y + .35, [-1.05, -.2], .45, .6); k.panes(p, 'right', 1.3, Y + .35, [-1.05, -.2], .45, .6);
    k.sign(p, 'ACADEMY', 0, Y + 1.6, .37, .9);
    // The belfry on the ridge: four posts, a bell and a little pyramid roof.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(p, .05, .42, .05, C.ivory, sx * .15, Y + 2.05, -.15 + sz * .15);
    k.block(p, .42, .06, .42, C.ivory, 0, Y + 2.47, -.15); k.ball(p, .1, C.gold, 0, Y + 2.25, -.15, 10);
    k.pyramid(p, .5, .5, .36, C.roof, 0, Y + 2.53, -.15); k.ball(p, .05, C.gold, 0, Y + 2.93, -.15, 8);
    k.flag(p, 1.75, 1.05, 2.2, blue);
    k.block(p, .9, .02, 1.55, C.stone, 0, Y, 1.15);
    trees(k, p, [-2.1, 2.1], -1.95, .85); bench(k, p, -1.6, .9);
    return;
  }
  if (level === 2) {
    // A college: two storeys along the front, a pediment with a clock over the entrance bay, a clock turret, flags.
    k.block(p, 3.4, 2.1, 1.8, C.stone, 0, Y, -.75, .06);
    k.block(p, 3.5, .1, 1.9, C.ivory, 0, Y + 2.1, -.75);
    k.pitched(p, 3.4, 1.8, .7, 0, Y + 2.2, -.75, { along: 'x' });
    k.block(p, 1.2, 2.35, .45, C.ivory, 0, Y, .37);
    k.prism(p, 1.32, .5, .5, C.stone, 0, Y + 2.35, .37);
    clock(k, p, 0, Y + 2.55, .64, .17);
    k.block(p, .5, .95, .07, C.ink, 0, Y, .6); k.arch(p, .5, .3, C.glass, 0, Y + .96, .56);
    k.sign(p, 'ACADEMY', 0, Y + 1.22, .61, .95);
    k.panes(p, 'front', .6, Y + 1.45, [-.27, .27], .3, .6);
    for (const y of [Y + .35, Y + 1.3]) k.panes(p, 'front', .15, y, [-1.45, -.95, .95, 1.45], .32, .58);
    for (const y of [Y + .35, Y + 1.3]) { k.panes(p, 'left', -1.7, y, [-1.3, -.45], .36, .58); k.panes(p, 'right', 1.7, y, [-1.3, -.45], .36, .58); }
    // A clock turret astride the ridge.
    k.block(p, .55, .62, .55, C.ivory, 0, Y + 2.6, -.75); k.block(p, .65, .06, .65, C.stone, 0, Y + 3.22, -.75);
    k.pyramid(p, .66, .66, .45, C.roof, 0, Y + 3.28, -.75); k.ball(p, .055, C.gold, 0, Y + 3.78, -.75, 8);
    clock(k, p, 0, Y + 2.92, -.46, .16);
    k.flag(p, -2.05, 1.0, 2.6, blue); k.flag(p, 2.05, 1.0, 2.6, blue);
    k.block(p, 1.1, .02, 1.3, C.stone, 0, Y, 1.25);
    trees(k, p, [-2.2, -1.5, 1.5, 2.2], -2.15, .8);
    return;
  }
  if (level === 3) {
    // A university: a portico of four columns before the central hall, two wings, a clock tower behind.
    k.block(p, 2.3, 2.4, 2.0, C.stone, 0, Y, -.95, .06);
    k.block(p, 2.4, .1, 2.1, C.ivory, 0, Y + 2.4, -.95);
    k.pitched(p, 2.3, 2.0, .7, 0, Y + 2.5, -.95);
    const top = portico(k, p, [-.75, -.25, .25, .75], 2.15, .95, .55, Y, 1.85, .55);
    k.sign(p, 'ACADEMY', 0, top - .12, 1.07, 1.25);
    k.block(p, .55, 1.05, .06, C.ink, 0, Y + .16, .07);
    for (const sx of [-1, 1]) {
      const x = sx * 1.88;
      k.block(p, 1.46, 1.75, 1.7, C.stone, x, Y, -.9, .06); k.block(p, 1.56, .08, 1.8, C.ivory, x, Y + 1.75, -.9);
      k.pitched(p, 1.46, 1.7, .55, x, Y + 1.83, -.9, { along: 'x' });
      for (const y of [Y + .3, Y + 1.0]) k.panes(p, 'front', -.05, y, [x - .35, x + .35], .32, .52);
    }
    // The clock tower over the back of the hall.
    k.block(p, .9, 1.55, .9, C.ivory, 0, Y + 2.4, -1.35); k.block(p, 1.0, .1, 1.0, C.stone, 0, Y + 3.95, -1.35);
    clock(k, p, 0, Y + 3.45, -.88, .27);
    k.pyramid(p, 1.0, 1.0, .8, C.roof, 0, Y + 4.05, -1.35); k.ball(p, .07, C.gold, 0, Y + 4.92, -1.35, 8);
    k.flag(p, -2.3, 1.05, 2.4, blue); k.flag(p, 2.3, 1.05, 2.4, blue);
    trees(k, p, [-1.3, 1.3], 1.25, .75);
    return;
  }
  if (level === 4) {
    // A campus round a court: the domed hall at the back with a portico, two wings forward, a fountain between.
    k.block(p, 3.2, 2.8, 1.4, C.stone, 0, Y, -1.65, .06); k.block(p, 3.3, .1, 1.5, C.ivory, 0, Y + 2.8, -1.65);
    portico(k, p, [-1.25, -.75, -.25, .25, .75, 1.25], 3.0, .7, -.6, Y, 2.1, .45);
    k.sign(p, 'ACADEMY', 0, Y + 2.38, -.2, 1.3);
    k.block(p, .6, 1.2, .06, C.ink, 0, Y + .16, -.94);
    // Drum, a ring of pilasters, the dome and its lantern.
    k.post(p, .95, .7, C.ivory, 0, Y + 2.9, -1.65, .95, 28);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; k.block(p, .07, .6, .07, C.stone, Math.sin(a) * .97, Y + 2.95, -1.65 + Math.cos(a) * .97); }
    k.dome(p, .98, C.roof, 0, Y + 3.6, -1.65, .9);
    k.post(p, .2, .32, C.ivory, 0, Y + 4.45, -1.65, .2, 12); k.cone(p, .24, .3, C.gold, 0, Y + 4.77, -1.65, 12); k.ball(p, .06, C.gold, 0, Y + 5.12, -1.65, 8);
    for (const sx of [-1, 1]) {
      const x = sx * 2.12;
      k.block(p, 1.05, 2.1, 2.9, C.stone, x, Y, -.85, .06); k.block(p, 1.15, .08, 3.0, C.ivory, x, Y + 2.1, -.85);
      k.pitched(p, 1.05, 2.9, .5, x, Y + 2.18, -.85);
      k.arch(p, .55, 1.1, C.glass, x, Y + .35, .6);
      k.panes(p, sx < 0 ? 'right' : 'left', x - sx * .525, Y + .4, [-1.7, -.9], .36, .55);
      k.panes(p, sx < 0 ? 'right' : 'left', x - sx * .525, Y + 1.3, [-1.7, -.9, -.1], .36, .5);
    }
    // The court: paving, a fountain, benches.
    k.block(p, 2.9, .02, 1.7, C.stone, 0, Y, .25);
    k.post(p, .6, .2, C.stone, 0, Y, .45, .6, 24); k.post(p, .5, .03, '#7fc4d8', 0, Y + .2, .45, .5, 24);
    k.post(p, .07, .55, C.ivory, 0, Y + .2, .45, .05, 8); k.ball(p, .12, C.ivory, 0, Y + .78, .45, 10);
    bench(k, p, -1.1, 1.0); bench(k, p, 1.1, 1.0);
    k.flag(p, -1.75, 1.45, 2.6, blue); k.flag(p, 1.75, 1.45, 2.6, blue);
    return;
  }
  // A great university: a stepped central tower with a spire and a star, wings with corner turrets, a grand portico.
  k.block(p, 2.0, 3.0, 1.6, C.stone, 0, Y, -1.45, .06); k.block(p, 2.12, .12, 1.72, C.ivory, 0, Y + 3.0, -1.45);
  k.block(p, 1.44, 1.5, 1.1, C.stone, 0, Y + 3.12, -1.45, .05); k.block(p, 1.56, .1, 1.22, C.ivory, 0, Y + 4.62, -1.45);
  clock(k, p, 0, Y + 4.05, -.88, .3);
  k.block(p, .98, .95, .74, C.stone, 0, Y + 4.72, -1.45, .04); k.block(p, 1.08, .08, .84, C.ivory, 0, Y + 5.67, -1.45);
  k.panes(p, 'front', -.62, Y + 4.95, [-.22, .22], .2, .5);
  k.post(p, .36, .45, C.ivory, 0, Y + 5.75, -1.45, .28, 16);
  k.metal(k.cone(p, .24, 1.55, C.gold, 0, Y + 6.2, -1.45, 12), C.gold);
  k.metal(k.mesh(p, k.cached('star', () => new THREE.OctahedronGeometry(.17)), C.gold, 0, Y + 7.85, -1.45), C.gold);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cone(p, .1, .5, C.roof, sx * .9, Y + 3.12, -1.45 + sz * .7, 8);
    k.cone(p, .07, .38, C.roof, sx * .64, Y + 4.7, -1.45 + sz * .48, 8);
  }
  for (let i = 0; i < 4; i++) k.panes(p, 'front', -.65, Y + .5 + i * .62, [-.6, -.2, .2, .6], .22, .38);
  // Wings with balustrades, and turrets at their outer front corners.
  for (const sx of [-1, 1]) {
    const x = sx * 1.85;
    k.block(p, 1.7, 2.25, 1.75, C.stone, x, Y, -1.2, .06); k.block(p, 1.8, .1, 1.85, C.ivory, x, Y + 2.25, -1.2);
    for (let i = 0; i < 7; i++) k.block(p, .06, .2, .06, C.ivory, x - .75 + i * .25, Y + 2.35, -.34);
    k.block(p, 1.7, .05, .08, C.ivory, x, Y + 2.55, -.34);
    for (const y of [Y + .35, Y + 1.25]) k.panes(p, 'front', -.32, y, [x - sx * .35, x + sx * .25], .3, .55);
    const tx = sx * 2.42;
    k.block(p, .62, 2.95, .62, C.ivory, tx, Y, -.55, .04);
    k.block(p, .7, .08, .7, C.stone, tx, Y + 2.95, -.55);
    k.pyramid(p, .7, .7, .75, C.roof, tx, Y + 3.03, -.55); k.ball(p, .05, C.gold, tx, Y + 3.82, -.55, 8);
    k.panes(p, 'front', -.24, Y + 1.9, [tx], .2, .5);
  }
  const top = portico(k, p, [-.9, -.54, -.18, .18, .54, .9], 2.2, 1.1, -.1, Y, 2.3, .5);
  k.sign(p, 'ACADEMY', 0, top - .12, .5, 1.3);
  k.block(p, .7, 1.4, .06, C.ink, 0, Y + .16, -.62);
  for (const x of [-1.5, 0, 1.5]) k.flag(p, x, 1.4, 2.6, blue);
  trees(k, p, [-2.3, 2.3], 1.2, .8);
};

const driver: Model = (k, p, level) => {
  const orange = ACCENT.driver;
  if (level === 1) {
    // A garage: one bay with a roller door, a cabin for the dispatcher, a taxi and a fuel pump.
    k.block(p, 1.8, 1.3, 1.8, C.concrete, -.75, Y, -.85, .05); k.block(p, 1.9, .1, 1.9, C.ink, -.75, Y + 1.3, -.85);
    k.block(p, 1.32, .98, .05, C.slate, -.75, Y, .07);
    for (let i = 1; i < 6; i++) k.block(p, 1.3, .025, .03, C.steel, -.75, Y + i * .16, .1);
    k.block(p, 1.8, .12, .04, orange, -.75, Y + 1.08, .07);
    k.sign(p, 'PULS GARAGE', -.75, Y + 1.24, .1, 1.2);
    k.block(p, 1.05, 1.1, 1.0, C.ivory, .85, Y, -.65, .04); k.block(p, 1.12, .07, 1.08, C.ink, .85, Y + 1.1, -.65);
    k.block(p, 1.05, .1, .04, orange, .85, Y + .82, -.14);
    k.panes(p, 'front', -.15, Y + .38, [1.08], .42, .4); k.block(p, .32, .72, .05, C.slate, .55, Y, -.13);
    k.taxi(p, -.75, 1.05);
    k.block(p, .3, .62, .24, C.ivory, 1.25, Y, .75); k.block(p, .32, .08, .26, orange, 1.25, Y + .62, .75); k.block(p, .2, .14, .03, C.ink, 1.25, Y + .42, .88);
    for (let i = 0; i < 3; i++) k.post(p, .17, .09, C.ink, 1.9, Y + i * .09, -1.7, .17, 12);
    trees(k, p, [-2.1, 2.1], -2.0, .8);
    return;
  }
  if (level === 2) {
    // A service station: two bays (a taxi up on the lift in the open one), the office's glass corner, tyres, a sign box.
    k.block(p, 3.3, 1.6, 1.9, C.concrete, -.4, Y, -1.05, .05); k.block(p, 3.42, .12, 2.02, C.ink, -.4, Y + 1.6, -1.05);
    k.block(p, 3.3, .14, .04, orange, -.4, Y + 1.36, -.08);
    k.block(p, .92, 1.15, .04, C.slate, -1.55, Y, -.08);
    for (let i = 1; i < 7; i++) k.block(p, .9, .02, .03, C.steel, -1.55, Y + i * .16, -.05);
    k.block(p, .92, 1.15, .04, C.ink, -.5, Y, -.08);
    k.taxi(p, -.5, .02);
    k.block(p, 1.1, 1.3, 1.8, C.glass, .75, Y, -1.0); piers(k, p, 1.1, 1.8, .75, -1.0, Y, 1.3);
    k.block(p, 1.0, .06, .5, orange, .75, Y + 1.0, .1);
    k.block(p, 1.7, .48, .14, orange, -.4, Y + 1.72, -.45); k.sign(p, 'PULS GARAGE', -.4, Y + 1.96, -.37, 1.5);
    for (const x of [-.95, .15]) k.block(p, .06, .2, .06, C.ink, x, Y + 1.6, -.45);
    k.taxi(p, -1.55, 1.05); k.taxi(p, 1.65, .9, -.4);
    for (let i = 0; i < 4; i++) k.post(p, .17, .09, C.ink, 2.2, Y + i * .09, -.3, .17, 12);
    for (const x of [1.95, 2.35]) k.post(p, .13, .38, orange, x, Y, -1.7, .13, 10);
    trees(k, p, [-2.35, 2.25], -2.2, .75);
    return;
  }
  if (level === 3) {
    // A taxi fleet: three bays with skylights, a two-storey office, a parking canopy over the line of taxis.
    k.block(p, 3.15, 1.75, 1.7, C.concrete, -.5, Y, -1.4, .05); k.block(p, 3.27, .12, 1.82, C.ink, -.5, Y + 1.75, -1.4);
    for (const x of [-1.55, -.5, .55]) {
      k.block(p, .9, 1.25, .05, C.ink, x, Y, -.53); k.block(p, .8, 1.12, .05, C.glass, x, Y + .06, -.5);
      for (let i = 1; i < 4; i++) k.block(p, .8, .02, .02, C.steel, x, Y + i * .3, -.47);
      k.block(p, .7, .1, .9, C.glass, x, Y + 1.87, -1.4).rotation.x = -.2;
    }
    k.block(p, 3.15, .13, .04, orange, -.5, Y + 1.5, -.53);
    k.sign(p, 'PULS GARAGE', -.5, Y + 1.5, -.5, 1.6);
    k.block(p, 1.3, 2.7, 1.9, C.ivory, 1.75, Y, -1.25, .05); k.block(p, 1.38, .1, 1.98, C.ink, 1.75, Y + 2.7, -1.25);
    for (const y of [Y + .9, Y + 1.8]) k.block(p, 1.32, .1, 1.92, orange, 1.75, y, -1.25);
    for (const y of [Y + .25, Y + 1.12, Y + 2.0]) k.panes(p, 'front', -.3, y, [1.45, 2.05], .4, .5);
    // The canopy over the waiting taxis.
    for (const x of [-2.05, -1.0, .0, 1.05]) for (const z of [.4, 1.6]) k.block(p, .08, 1.25, .08, C.ink, x, Y, z);
    k.block(p, 3.3, .08, 1.35, C.slate, -.5, Y + 1.25, 1.0); k.block(p, 3.3, .14, .05, orange, -.5, Y + 1.2, 1.68);
    for (const x of [-1.5, -.5, .5]) k.taxi(p, x, .95);
    trees(k, p, [2.25], .6, .8);
    return;
  }
  if (level === 4) {
    // A depot: a vaulted hangar with a glass arch, an office tower with the taxi checker crown, chargers.
    k.block(p, 2.5, 1.0, 2.5, C.concrete, -1.35, Y, -1.05);
    k.vault(p, 1.25, 2.5, C.slate, -1.35, Y + 1.0, -1.05);
    for (let i = 1; i < 5; i++) k.block(p, .03, .05, 2.52, C.steel, -1.35 + Math.cos(i * Math.PI / 5) * 1.24, Y + 1.0 + Math.sin(i * Math.PI / 5) * 1.24, -1.05);
    k.arch(p, 1.9, 1.95, C.glass, -1.35, Y + .05, .21);
    k.block(p, 1.2, .95, .05, C.ink, -1.35, Y, .28);
    k.block(p, 2.5, .12, .04, orange, -1.35, Y + 1.0, .21);
    k.sign(p, 'PULS DEPOT', -1.35, Y + 1.12, .32, 1.2);
    glassFloors(k, p, 1.3, 1.3, 1.1, -1.4, Y, 4, .85, C.ivory, 4);
    for (let i = 0; i < 4; i++) k.block(p, 1.34, .1, 1.34, orange, 1.1, Y + .4 + i * .85, -1.4);
    k.block(p, 1.3, .33, 1.3, C.ink, 1.1, Y + 3.42, -1.4);
    checker(k, p, .45, Y + 3.42, -.73, 8, .1625, 2);
    k.block(p, 1.36, .07, 1.36, C.ink, 1.1, Y + 3.75, -1.4);
    k.box(p, .5, .2, .3, C.taxi, 1.1, Y + 3.92, -1.4, .04); k.ball(p, .07, C.red, 1.1, Y + 4.1, -1.4, 8);
    for (const x of [.65, 1.25, 1.85]) {
      k.block(p, .22, .62, .16, C.ivory, x, Y, .35); k.block(p, .16, .2, .02, '#5fd08a', x, Y + .38, .44);
    }
    k.taxi(p, .95, 1.05); k.taxi(p, 1.85, 1.05);
    k.taxi(p, -1.35, .95);
    return;
  }
  // A transport hub: a four-deck car park with a helipad, a vaulted glass terminal, a clock tower with a taxi light.
  const deck = (y: number) => k.block(p, 2.55, .1, 2.3, C.concrete, -1.35, y, -1.25);
  for (let i = 0; i < 4; i++) {
    const y = Y + i * .78;
    deck(y);
    if (i < 3) for (const x of [-2.58, -1.78, -.92, -.12]) for (const z of [-2.35, -.15]) k.block(p, .09, .68, .09, C.concrete, x, y + .1, z);
    k.block(p, 2.55, .2, .04, i % 2 ? orange : C.white, -1.35, y + .1, -.1);
  }
  const colours = [C.taxi, '#d9dee2', C.taxi, '#c9584f', C.taxi, '#5b8def'];
  for (let i = 0; i < 6; i++) k.taxi(p, -2.2 + (i % 3) * .85, -.9 - (i > 2 ? .9 : 0), Math.PI, colours[i], Y + .78 * (1 + (i % 2)) + .1);
  for (let i = 0; i < 3; i++) k.taxi(p, -2.2 + i * .85, -1.3, Math.PI, colours[i + 2], Y + .1);
  // The helipad on the roof deck.
  const roof = Y + 3 * .78 + .1;
  k.post(p, .78, .04, C.ink, -1.35, roof, -1.25, .78, 24); k.torus(p, .7, .03, C.taxi, -1.35, roof + .05, -1.25, 32).rotation.x = Math.PI / 2;
  for (const x of [-.18, .18]) k.block(p, .07, .02, .5, C.ivory, -1.35 + x, roof + .04, -1.25);
  k.block(p, .36, .02, .07, C.ivory, -1.35, roof + .04, -1.25);
  // The terminal.
  k.block(p, 2.5, 1.0, 2.2, C.glass, 1.35, Y, -1.0); piers(k, p, 2.5, 2.2, 1.35, -1.0, Y, 1.0);
  k.vault(p, 1.28, 2.3, C.ivory, 1.35, Y + 1.0, -1.0);
  k.arch(p, 2.0, 2.15, C.glass, 1.35, Y + .05, .17);
  for (let i = 1; i < 6; i++) k.block(p, .04, 1.2, .04, C.ivory, .35 + i * .33, Y + .9, .27);
  k.sign(p, 'PULS TAXI HUB', 1.35, Y + 1.08, .3, 1.6);
  // The clock tower at the back corner, a taxi light on top.
  k.block(p, .8, 4.6, .8, C.ivory, 2.15, Y, -2.15, .04);
  for (let i = 1; i < 5; i++) k.block(p, .84, .08, .84, orange, 2.15, Y + i * .92, -2.15);
  clock(k, p, 2.15, Y + 4.1, -1.72, .26);
  k.block(p, .8, .32, .8, C.ink, 2.15, Y + 4.6, -2.15);
  checker(k, p, 1.75, Y + 4.6, -1.74, 5, .16, 2);
  k.block(p, .86, .08, .86, C.ink, 2.15, Y + 4.92, -2.15);
  k.box(p, .55, .26, .3, C.taxi, 2.15, Y + 5.15, -2.15, .05); k.ball(p, .08, C.red, 2.15, Y + 5.4, -2.15, 8);
  // The taxi rank before the terminal.
  for (const x of [.6, 1.4, 2.2]) k.taxi(p, x, 1.05);
};

const crm: Model = (k, p, level) => {
  const violet = ACCENT.crm;
  /** The chat bubble: a rounded board with a tail, on two posts from y0. */
  const bubble = (x: number, y0: number, z: number, w: number) => {
    for (const sx of [-1, 1]) k.block(p, .05, .3, .05, C.ink, x + sx * w * .3, y0, z);
    k.box(p, w, w * .55, .14, violet, x, y0 + .3 + w * .275, z, .1);
    k.box(p, .18, .18, .1, violet, x - w * .25, y0 + .3, z, 0).rotation.z = .8;
    k.sign(p, 'CRM', x, y0 + .3 + w * .275, z + .08, w * .8, violet);
  };
  if (level === 1) {
    // A small office: two glass storeys in a white frame, a canopy, a chat bubble on the roof.
    glassFloors(k, p, 2.4, 1.7, 0, -.9, Y, 2, .82, C.ivory);
    piers(k, p, 2.4, 1.7, 0, -.9, Y, 1.64);
    for (let i = 1; i < 5; i++) k.block(p, .04, 1.64, .05, C.ivory, -1.2 + i * .48, Y, -.03);
    k.block(p, 1.1, .06, .55, violet, 0, Y + .82, .2); k.block(p, .5, .76, .05, C.slate, 0, Y, -.02);
    k.block(p, .6, .32, .5, C.steel, .7, Y + 1.64, -1.3);
    bubble(-.3, Y + 1.64, -.6, .95);
    k.sign(p, 'PULS / CRM', 0, Y + 1.05, .0, 1.1);
    for (const x of [-1.7, 1.7]) k.tree(p, x, .6, .75);
    bench(k, p, -1.55, -.2, Math.PI / 2);
    return;
  }
  if (level === 2) {
    // A glass office: three storeys with fins, a glass lobby, a roof terrace with a pergola.
    glassFloors(k, p, 3.0, 2.0, 0, -1.1, Y, 3, .85, C.ivory, 7);
    piers(k, p, 3.0, 2.0, 0, -1.1, Y, 2.55);
    k.block(p, 1.3, .95, .6, C.glass, 0, Y, .2); piers(k, p, 1.3, .6, 0, .2, Y, .95, C.ivory);
    k.block(p, 1.45, .08, .75, violet, 0, Y + .95, .2);
    k.sign(p, 'PULS / CRM', 0, Y + 2.38, -.08, 1.3, violet);
    const roof = Y + 2.55;
    k.block(p, 2.6, .06, 1.6, C.lawn, 0, roof, -1.1);
    for (const [x, z] of [[-1.0, -1.6], [1.0, -1.6], [-1.0, -.6], [.2, -1.7]] as const) k.ball(p, .2, C.leaf, x, roof + .2, z, 10);
    for (const x of [.4, 1.2]) for (const z of [-1.0, -.4]) k.block(p, .05, .5, .05, C.wood, x, roof, z);
    for (let i = 0; i < 5; i++) k.block(p, .05, .04, .7, C.wood, .4 + i * .2, roof + .5, -.7);
    k.block(p, .55, .3, .45, C.steel, -.4, roof, -1.5);
    trees(k, p, [-2.0, 2.0], .55, .8);
    return;
  }
  if (level === 3) {
    // A tower on a podium: six storeys of glass with fins over a stone and glass base, a crown and an aerial.
    k.block(p, 3.8, .45, 2.2, C.stone, 0, Y, -1.2); k.block(p, 3.7, .5, 2.1, C.glass, 0, Y + .45, -1.2); k.block(p, 3.9, .1, 2.3, C.ivory, 0, Y + .95, -1.2);
    k.block(p, 1.4, .07, .6, violet, 0, Y + .95, .1);
    k.sign(p, 'PULS / CRM', 0, Y + .7, -.08, 1.3, violet);
    const top = glassFloors(k, p, 1.9, 1.5, 0, -1.3, Y + 1.05, 6, .6, C.ivory, 6);
    piers(k, p, 1.9, 1.5, 0, -1.3, Y + 1.05, 3.6);
    k.block(p, 1.4, .42, 1.05, C.ivory, 0, top, -1.35); k.block(p, 1.5, .06, 1.15, violet, 0, top + .3, -1.35);
    k.post(p, .03, .7, C.ink, .4, top + .42, -1.5, .02, 6); k.ball(p, .05, C.red, .4, top + 1.13, -1.5, 6);
    for (const x of [-1.5, 1.5]) for (const z of [-1.9, -.6]) k.ball(p, .22, C.leaf, x, Y + 1.2, z, 10);
    trees(k, p, [-2.2, 2.2], .7, .8);
    return;
  }
  if (level === 4) {
    // A taller tower stepping back to a roof garden, beside a lower wing with a green roof.
    k.block(p, 4.2, 1.0, 2.3, C.stone, 0, Y, -1.2); k.block(p, 4.1, .55, 2.2, C.glass, 0, Y + .3, -1.2); k.block(p, 4.3, .1, 2.4, C.ivory, 0, Y + 1.0, -1.2);
    k.block(p, 1.5, .07, .65, violet, -.6, Y + 1.0, .1);
    k.sign(p, 'PULS / CRM', -.6, Y + .62, -.03, 1.3, violet);
    const top = glassFloors(k, p, 2.0, 1.6, -.6, -1.3, Y + 1.1, 7, .6, C.ivory, 6);
    piers(k, p, 2.0, 1.6, -.6, -1.3, Y + 1.1, 4.2);
    const crown = glassFloors(k, p, 1.4, 1.1, -.75, -1.45, top, 1, .65, C.ivory, 4);
    k.block(p, 2.04, .05, 1.64, C.lawn, -.6, top + .01, -1.3);
    for (const [x, z] of [[.1, -.75], [-1.45, -.75], [.15, -1.95]] as const) k.tree(p, x, z, .5, top);
    k.block(p, 1.5, .05, 1.15, C.lawn, -.75, crown + .01, -1.45);
    for (const x of [-1.15, -.4]) k.tree(p, x, -1.45, .5, crown);
    k.block(p, 1.44, .08, 1.14, violet, -.75, crown - .32, -1.45);
    // The lower wing.
    const wing = glassFloors(k, p, 1.35, 1.5, 1.35, -1.25, Y + 1.1, 3, .55, C.ivory, 3);
    k.block(p, 1.37, .06, 1.52, C.lawn, 1.35, wing, -1.25);
    for (const z of [-1.7, -.85]) k.tree(p, 1.35, z, .55, wing);
    trees(k, p, [1.7], .8, .8); bench(k, p, 1.9, .1, -Math.PI / 2);
    return;
  }
  // Twin towers over a podium, joined by a skybridge, a glass crown, the chat bubble over the entrance.
  k.block(p, 4.8, 1.0, 2.3, C.stone, 0, Y, -1.25); k.block(p, 4.7, .55, 2.2, C.glass, 0, Y + .3, -1.25); k.block(p, 4.9, .1, 2.4, C.ivory, 0, Y + 1.0, -1.25);
  k.block(p, 1.6, .07, .7, violet, 0, Y + 1.0, .1);
  k.sign(p, 'PULS / CRM', 0, Y + .62, -.03, 1.3, violet);
  for (const [x, floors] of [[-1.3, 9], [1.3, 10]] as const) {
    const top = glassFloors(k, p, 1.6, 1.5, x, -1.45, Y + 1.1, floors, .6, C.ivory, 4);
    piers(k, p, 1.6, 1.5, x, -1.45, Y + 1.1, floors * .6);
    k.block(p, 1.62, .1, 1.52, violet, x, top - .35, -1.45);
    if (floors === 10) {
      k.pyramid(p, 1.5, 1.4, .65, C.glass, x, top, -1.45);
      k.post(p, .03, .8, C.ink, x, top + .6, -1.45, .02, 6); k.ball(p, .05, C.red, x, top + 1.42, -1.45, 6);
    } else {
      k.block(p, 1.2, .3, 1.1, C.ivory, x, top, -1.45);
      k.block(p, 1.62, .05, 1.52, C.lawn, x, top + .01, -1.45).scale.set(.7, 1, .7);
      for (const sx of [-1, 1]) k.tree(p, x + sx * .55, -.85, .45, top);
    }
  }
  // The skybridge.
  k.block(p, 1.2, .5, .8, C.glass, 0, Y + 4.1, -1.45); k.block(p, 1.2, .07, .86, C.ivory, 0, Y + 4.05, -1.45); k.block(p, 1.2, .07, .86, C.ivory, 0, Y + 4.6, -1.45);
  bubble(0, Y + 1.1, -.55, 1.0);
  for (const x of [-2.2, 2.2]) k.tree(p, x, .7, .8);
  for (const x of [-1.0, 1.0]) k.ball(p, .25, C.leaf, x, Y + .35, .55, 10);
};

const dispatch: Model = (k, p, level) => {
  const teal = ACCENT.dispatch;
  if (level === 1) {
    // A radio hut: a booth glazed all round, a lattice mast with a warning light, a dish on the roof.
    k.block(p, 1.7, .5, 1.4, C.ivory, -.65, Y, -.75); k.block(p, 1.65, .62, 1.35, C.glass, -.65, Y + .5, -.75);
    piers(k, p, 1.7, 1.4, -.65, -.75, Y + .5, .62);
    k.block(p, 1.85, .1, 1.55, C.ink, -.65, Y + 1.12, -.75); k.block(p, 1.86, .06, 1.56, teal, -.65, Y + 1.06, -.75);
    k.sign(p, 'CONTROL', -.65, Y + .28, -.04, .95);
    k.dish(p, .32, -.95, Y + 1.35, -.9, .7, .6);
    k.post(p, .025, .6, C.ink, -.2, Y + 1.22, -1.1, .02, 6);
    k.mast(p, .42, 3.0, 1.35, Y, -1.25, C.red);
    k.block(p, .62, .55, .5, C.concrete, 1.35, Y, -.4);
    k.taxi(p, .9, .95, -.3, teal);
    trees(k, p, [-2.2, -1.5], -1.95, .75);
    return;
  }
  if (level === 2) {
    // A radio station: an operations building with a window band, dishes on the roof, a tall guyed mast.
    k.block(p, 3.0, 1.35, 1.9, C.ivory, -.85, Y, -1.15, .05);
    k.block(p, 3.04, .42, 1.94, C.glass, -.85, Y + .5, -1.15);
    k.block(p, 3.12, .1, 2.02, C.ink, -.85, Y + 1.35, -1.15); k.block(p, 3.1, .08, 2.0, teal, -.85, Y + 1.27, -1.15);
    k.sign(p, 'CONTROL', -.85, Y + .25, -.18, 1.1);
    k.block(p, .65, .9, .06, C.slate, .3, Y, -.18);
    k.dish(p, .42, -1.65, Y + 1.6, -1.35, .6, .4); k.dish(p, .3, -.6, Y + 1.55, -1.6, .8, -.5);
    const mx = 1.55, mz = -1.35, h = 4.1;
    k.mast(p, .5, h, mx, Y, mz, C.red);
    for (const [ax, az] of [[2.6, -2.35], [2.55, -.35], [.85, -2.45]] as const) rod(k, p, [mx, Y + h * .78, mz], [ax, Y, az], .018, C.steel);
    k.dish(p, .25, mx, Y + h * .62, mz + .3, .2, 0);
    trees(k, p, [-2.3, -1.4], .7, .8);
    return;
  }
  if (level === 3) {
    // A control tower: a stone base, a round shaft with gold ribs, the glazed cab and its gallery, an aerial.
    k.block(p, 2.8, .95, 2.0, C.stone, 0, Y, -.75, .06); k.block(p, 2.9, .1, 2.1, C.ivory, 0, Y + .95, -.75);
    k.panes(p, 'front', .25, Y + .3, [-1.05, -.6, .6, 1.05], .32, .45);
    k.sign(p, 'CONTROL', 0, Y + .55, .27, 1.0);
    const shaft = Y + 1.05, h = 2.7;
    k.post(p, .62, h, C.stone, 0, shaft, -.8, .55, 28);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; k.block(p, .05, h, .05, C.gold, Math.sin(a) * .6, shaft, -.8 + Math.cos(a) * .6); }
    const cab = shaft + h;
    k.post(p, 1.3, .12, C.ivory, 0, cab, -.8, 1.3, 32);
    k.post(p, 1.08, .7, C.glass, 0, cab + .12, -.8, 1.2, 24);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; k.block(p, .05, .7, .05, C.gold, Math.sin(a) * 1.15, cab + .12, -.8 + Math.cos(a) * 1.15); }
    k.post(p, 1.38, .16, C.ink, 0, cab + .82, -.8, 1.3, 32); k.block(p, .5, .2, .5, C.ink, 0, cab + .98, -.8);
    k.post(p, .03, 1.0, C.gold, 0, cab + 1.18, -.8, .02, 6); k.ball(p, .07, C.red, 0, cab + 2.2, -.8, 8);
    k.dish(p, .35, 1.05, Y + 1.3, -1.35, .6, .9);
    k.taxi(p, -1.9, .95, .2, teal);
    trees(k, p, [2.1], .8, .8);
    return;
  }
  if (level === 4) {
    // A taller control tower with a radar tower beside it and a wing either side.
    k.block(p, 3.1, 1.05, 2.0, C.stone, 0, Y, -.85, .06); k.block(p, 3.2, .1, 2.1, C.ivory, 0, Y + 1.05, -.85);
    for (const sx of [-1, 1]) {
      k.block(p, .95, .85, 1.7, C.ivory, sx * 2.1, Y, -.75, .04); k.block(p, 1.0, .07, 1.75, C.ink, sx * 2.1, Y + .85, -.75);
      k.panes(p, 'front', .1, Y + .3, [sx * 2.1], .55, .38);
    }
    k.panes(p, 'front', .15, Y + .3, [-1.1, -.65, .65, 1.1], .32, .5);
    k.sign(p, 'CONTROL', 0, Y + .6, .17, 1.1);
    const shaft = Y + 1.15, h = 3.3;
    k.post(p, .68, h, C.stone, -.35, shaft, -.95, .58, 28);
    for (let i = 0; i < 3; i++) k.post(p, .7, .06, teal, -.35, shaft + .8 + i * .9, -.95, .66, 28);
    const cab = shaft + h;
    k.post(p, .7, .45, C.ivory, -.35, cab - .4, -.95, 1.15, 28);
    k.post(p, 1.38, .12, C.ivory, -.35, cab + .05, -.95, 1.38, 32);
    k.post(p, 1.15, .78, C.glass, -.35, cab + .17, -.95, 1.28, 24);
    for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7; k.block(p, .05, .78, .05, C.gold, -.35 + Math.sin(a) * 1.22, cab + .17, -.95 + Math.cos(a) * 1.22); }
    k.post(p, 1.45, .17, C.ink, -.35, cab + .95, -.95, 1.35, 32); k.block(p, .55, .25, .55, C.ink, -.35, cab + 1.12, -.95);
    k.post(p, .03, 1.1, C.gold, -.35, cab + 1.37, -.95, .02, 6); k.ball(p, .07, C.red, -.35, cab + 2.5, -.95, 8);
    // The radar on its own tower.
    k.post(p, .28, 1.7, C.ivory, 1.4, Y + 1.15, -1.6, .24, 16);
    k.post(p, .4, .1, C.ink, 1.4, Y + 2.85, -1.6, .4, 16);
    k.ball(p, .58, C.ivory, 1.4, Y + 3.48, -1.6, 20);
    k.dish(p, .3, 1.2, Y + 1.5, -.35, .5, .3);
    trees(k, p, [-2.2, 2.2], .75, .8);
    return;
  }
  // A TV tower: a round base with a glass band, a tapering shaft on four legs, a glazed pod, a striped spire.
  k.post(p, 1.55, .95, C.ivory, 0, Y, -.8, 1.55, 40);
  k.post(p, 1.58, .38, C.glass, 0, Y + .3, -.8, 1.58, 40);
  k.post(p, 1.62, .08, teal, 0, Y + .87, -.8, 1.62, 40); k.post(p, 1.6, .1, C.white, 0, Y + .95, -.8, 1.45, 40);
  k.sign(p, 'CONTROL', 0, Y + .5, .8, 1.2);
  const foot = Y + 1.05, h = 5.4;
  k.post(p, .55, h, C.stone, 0, foot, -.8, .3, 28);
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; rod(k, p, [Math.sin(a) * 1.25, foot, -.8 + Math.cos(a) * 1.25], [Math.sin(a) * .42, foot + 1.9, -.8 + Math.cos(a) * .42], .16, C.stone); }
  for (let i = 1; i < 4; i++) k.post(p, .55 - i * .065 + .03, .07, teal, 0, foot + i * 1.25, -.8, .55 - i * .065 + .03, 24);
  // The pod: a flared underside, the gallery, the glass and a teal roof ring; a smaller pod above.
  const pod = foot + 3.7;
  k.post(p, .42, .32, C.ivory, 0, pod - .32, -.8, 1.05, 32);
  k.post(p, 1.08, .4, C.glass, 0, pod, -.8, 1.08, 32);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; k.block(p, .04, .4, .04, C.ivory, Math.sin(a) * 1.08, pod, -.8 + Math.cos(a) * 1.08); }
  k.post(p, 1.15, .12, teal, 0, pod + .4, -.8, 1.15, 32); k.post(p, 1.0, .14, C.ivory, 0, pod + .52, -.8, .55, 32);
  k.post(p, .5, .28, C.glass, 0, pod + 1.15, -.8, .5, 24); k.post(p, .55, .07, teal, 0, pod + 1.43, -.8, .55, 24);
  const spire = foot + h;
  for (let i = 0; i < 4; i++) k.post(p, .12 - i * .022, .5, i % 2 ? C.red : C.ivory, 0, spire + i * .5, -.8, .12 - (i + 1) * .022, 10);
  k.ball(p, .07, C.red, 0, spire + 2.05, -.8, 8);
  for (const x of [-2.2, 2.2]) k.flag(p, x, .9, 2.2, teal);
};

const oktell: Model = (k, p, level) => {
  const pink = ACCENT.oktell;
  if (level === 1) {
    // A telephone exchange: a small stone building with tall windows, an aerial, a phone box outside.
    k.block(p, 2.4, 1.3, 1.6, C.stone, -.15, Y, -1.0, .05); k.block(p, 2.5, .12, 1.7, C.ivory, -.15, Y + 1.3, -1.0);
    k.panes(p, 'front', -.2, Y + .3, [-.95, -.5, .2, .65], .3, .75);
    k.block(p, .45, .9, .06, C.slate, -.15, Y, -.18);
    k.sign(p, 'OKTELL', -.15, Y + 1.36, -.12, .9);
    k.post(p, .025, .8, C.ink, .55, Y + 1.42, -1.35, .02, 6); k.block(p, .5, .03, .03, C.ink, .55, Y + 2.0, -1.35);
    // The phone box.
    k.block(p, .5, 1.05, .5, pink, 1.65, Y, .25, .03); k.block(p, .56, .08, .56, pink, 1.65, Y + 1.05, .25);
    k.panes(p, 'front', .5, Y + .35, [1.65], .3, .55, pink); k.panes(p, 'left', 1.4, Y + .35, [.25], .3, .55, pink);
    k.block(p, .4, .1, .03, C.ivory, 1.65, Y + .9, .51);
    trees(k, p, [-2.1, 2.1], -1.9, .8); bench(k, p, -1.6, .75);
    return;
  }
  if (level === 2) {
    // The domed exchange: arched windows, a dome with a gold ring, a dish beside it.
    k.block(p, 3.4, 1.35, 2.2, C.stone, 0, Y + .05, -.75, .2); k.block(p, 3.55, .15, 2.35, C.ivory, 0, Y + 1.4, -.75, .2);
    for (const x of [-1.12, -.55, 0, .55, 1.12]) k.window(p, x, Y + .35, .35, .4, .72, true);
    const dome = k.ball(p, 1.15, C.roof, 0, Y + 1.5, -.9, 28); dome.scale.set(1, .78, .9);
    k.torus(p, 1.18, .06, C.gold, 0, Y + 1.56, -.9).rotation.x = Math.PI / 2;
    k.ball(p, .08, C.gold, 0, Y + 2.45, -.9, 8);
    k.dish(p, .5, 1.2, Y + 1.75, -1.45, .6, -.5);
    k.sign(p, 'OKTELL', 0, Y + 1.2, .36, 1.2);
    trees(k, p, [-2.15, 2.15], -1.95, .8);
    return;
  }
  if (level === 3) {
    // A call centre: three storeys of ribbon windows under a giant headset, a glass lobby.
    k.block(p, 3.6, 2.45, 1.85, C.stone, 0, Y, -1.25, .05);
    for (const y of [Y + .3, Y + 1.1, Y + 1.9]) k.block(p, 3.64, .42, 1.89, C.glass, 0, y, -1.25);
    k.block(p, 3.72, .1, 1.97, C.ivory, 0, Y + 2.45, -1.25);
    k.block(p, 1.5, 1.2, .7, C.glass, 0, Y, .0); piers(k, p, 1.5, .7, 0, .0, Y, 1.2);
    k.block(p, 1.65, .1, .85, pink, 0, Y + 1.2, .0);
    k.sign(p, 'OKTELL', 0, Y + 1.0, .36, 1.1, pink);
    // The headset: a band over the roof, ear cups and a microphone.
    const roof = Y + 2.55, band = k.mesh(p, k.cached('headset', () => new THREE.TorusGeometry(.95, .1, 10, 28, Math.PI)), pink, 0, roof + .35, -1.3);
    band.rotation.set(0, 0, 0);
    for (const sx of [-1, 1]) { const cup = k.cyl(p, .3, .22, C.ink, sx * .95, roof + .35, -1.3, .3, 20); cup.rotation.z = Math.PI / 2; k.cyl(p, .22, .24, pink, sx * .95, roof + .35, -1.3, .22, 20).rotation.z = Math.PI / 2; }
    for (const sx of [-1, 1]) k.block(p, .12, .35, .12, C.ink, sx * .95, roof, -1.3);
    rod(k, p, [.9, roof + .25, -1.15], [.35, roof + .05, -.6], .06, C.ink); k.ball(p, .1, pink, .33, roof + .05, -.58, 10);
    for (const x of [-1.5, 1.5]) { k.post(p, .025, .9, C.ink, x, roof, -1.95, .02, 6); k.ball(p, .045, C.red, x, roof + .92, -1.95, 6); }
    trees(k, p, [-2.15, 2.15], .55, .8);
    return;
  }
  if (level === 4) {
    // A communications centre: a two-storey block with a small dome, a glass atrium, a round tower of dishes.
    k.block(p, 2.9, 2.0, 1.9, C.stone, -.8, Y, -1.2, .05);
    for (const y of [Y + .3, Y + 1.2]) k.block(p, 2.94, .5, 1.94, C.glass, -.8, y, -1.2);
    k.block(p, 3.0, .1, 2.0, C.ivory, -.8, Y + 2.0, -1.2);
    k.post(p, .55, .2, C.ivory, -1.3, Y + 2.1, -1.3, .55, 24); k.dome(p, .55, C.roof, -1.3, Y + 2.3, -1.3, .5);
    k.block(p, 1.5, 1.4, .8, C.glass, -.8, Y, .1); piers(k, p, 1.5, .8, -.8, .1, Y, 1.4);
    for (const x of [-1.3, -.8, -.3]) k.block(p, .05, 1.4, .05, C.ivory, x, Y, .51);
    k.block(p, 1.5, .05, .05, C.ivory, -.8, Y + .75, .51); k.block(p, .7, .06, .4, pink, -.8, Y + .7, .7);
    k.prism(p, 1.5, .4, .8, C.glass, -.8, Y + 1.4, .1); k.box(p, .08, .08, .86, C.ivory, -.8, Y + 1.8, .1, 0);
    k.sign(p, 'OKTELL', -.8, Y + 1.75, -.22, 1.1, pink);
    // The tower: glass rings, three dishes up its side, a lattice top.
    const tx = 1.55, tz = -1.15, h = 3.7;
    k.post(p, .72, h, C.ivory, tx, Y, tz, .62, 28);
    for (let i = 0; i < 4; i++) k.post(p, .7 - i * .025, .22, C.glass, tx, Y + .5 + i * .85, tz, .7 - i * .025, 28);
    k.post(p, .7, .1, pink, tx, Y + h, tz, .7, 28);
    k.dish(p, .42, tx - .2, Y + h * .45, tz + .75, .3, .2); k.dish(p, .36, tx + .6, Y + h * .65, tz + .45, .4, 1.0); k.dish(p, .32, tx - .65, Y + h * .82, tz + .4, .5, -.8);
    k.mast(p, .26, 1.1, tx, Y + h + .1, tz, C.red);
    trees(k, p, [.6, 2.3], .7, .75);
    return;
  }
  // A satellite centre: a great dish on its pedestal, the tower of dishes, an observatory, a long glass front.
  k.block(p, 4.6, 1.15, 1.2, C.stone, -.1, Y, .45, .05); k.block(p, 4.64, .5, 1.24, C.glass, -.1, Y + .35, .45);
  k.block(p, 4.72, .1, 1.32, C.ivory, -.1, Y + 1.15, .45); k.block(p, 4.7, .07, 1.3, pink, -.1, Y + 1.08, .45);
  k.sign(p, 'OKTELL', -.1, Y + .2, 1.07, 1.2, pink);
  k.dome(p, .55, C.steel, 1.55, Y + 1.25, .45, .55); k.block(p, .12, .4, .5, C.ink, 1.55, Y + 1.5, .55).rotation.x = .9;
  // The great dish.
  const dx = .9, dz = -1.4;
  k.post(p, .5, 2.1, C.concrete, dx, Y, dz, .38, 20);
  for (const sx of [-1, 1]) k.block(p, .14, .7, .5, C.ivory, dx + sx * .35, Y + 2.1, dz);
  k.dish(p, 1.55, dx, Y + 2.65, dz, .75, -.35);
  // The tower of dishes.
  const tx = -1.85, tz = -1.6, h = 4.4;
  k.post(p, .58, h, C.ivory, tx, Y, tz, .48, 24);
  for (let i = 0; i < 4; i++) k.post(p, .57 - i * .025, .2, C.glass, tx, Y + 1.4 + i * .75, tz, .57 - i * .025, 24);
  k.post(p, .55, .1, pink, tx, Y + h, tz, .55, 24);
  k.dish(p, .38, tx + .45, Y + 2.6, tz + .5, .4, .6); k.dish(p, .32, tx - .5, Y + 3.3, tz + .45, .5, -.7);
  k.mast(p, .24, 1.3, tx, Y + h + .1, tz, C.red);
  for (const x of [-2.3, 2.3]) k.ball(p, .25, C.leaf, x, Y + .35, 1.35, 10);
};

const scenarios: Model = (k, p, level) => {
  const blue = ACCENT.scenarios;
  if (level === 1) {
    // An open-air stage: a platform under a striped awning, a red backdrop, benches for the audience, a ticket booth.
    k.block(p, 2.4, .32, 1.4, C.wood, -.4, Y, -1.15);
    k.block(p, 2.2, 1.15, .06, C.red, -.4, Y + .32, -1.8);
    for (const sx of [-1, 1]) for (const z of [-1.8, -.5]) k.block(p, .07, 1.45, .07, C.ink, -.4 + sx * 1.17, Y, z);
    for (let i = 0; i < 6; i++) k.block(p, .42, .06, 1.6, i % 2 ? C.ivory : blue, -.4 - 1.05 + i * .42, Y + 1.45, -1.15);
    for (let i = 0; i < 6; i++) k.block(p, .42, .18, .03, i % 2 ? C.ivory : blue, -.4 - 1.05 + i * .42, Y + 1.3, -.34);
    k.sign(p, 'SCENARIOS', -.4, Y + 1.66, -.3, 1.1, blue);
    for (const z of [.15, .65]) for (const x of [-1.0, .2]) bench(k, p, x, z, Math.PI);
    k.block(p, .75, 1.0, .65, C.ivory, 1.75, Y, -.6, .04); k.panes(p, 'front', -.27, Y + .45, [1.75], .4, .3);
    for (let i = 0; i < 3; i++) k.block(p, .27, .05, .8, i % 2 ? C.ivory : blue, 1.48 + i * .27, Y + 1.0, -.6);
    trees(k, p, [2.1, -2.2], -1.9, .8);
    return;
  }
  if (level === 2) {
    // A studio: a dark box with a great sliding door, a marquee of bulbs over the entrance, posters, spotlights.
    k.block(p, 3.3, 1.75, 1.9, C.white, -.1, Y, -1.15, .04); k.block(p, 3.4, .1, 2.0, C.slate, -.1, Y + 1.75, -1.15);
    k.block(p, 3.32, .12, 1.92, blue, -.1, Y + 1.5, -1.15);
    k.block(p, 1.35, 1.35, .05, C.ink, -.95, Y, -.18); for (let i = 1; i < 4; i++) k.block(p, .03, 1.35, .03, C.steel, -.95 - .675 + i * .34, Y, -.15);
    k.block(p, 1.5, .05, .06, C.steel, -.95, Y + 1.38, -.16);
    k.block(p, .6, 1.0, .05, C.glass, .9, Y, -.17);
    k.block(p, 1.3, .14, .65, C.gold, .9, Y + 1.12, .12); bulbs(k, p, .3, 1.5, Y + 1.1, .46, 9);
    k.sign(p, 'SCENARIOS', .9, Y + 1.4, .45, 1.15, C.ink);
    for (const x of [-.05, 1.75]) { k.block(p, .48, .66, .03, blue, x, Y + .3, -.18); k.block(p, .38, .5, .02, C.ivory, x, Y + .38, -.16); }
    for (const x of [-1.4, .9]) { const s = k.cone(p, .14, .3, C.ink, x, Y + 1.85, -.6, 10); s.rotation.x = .8; }
    trees(k, p, [-2.2, 2.2], .6, .8);
    return;
  }
  if (level === 3) {
    // A theatre: a portico with a marquee, the auditorium, the stage's fly tower behind, posters either side.
    k.block(p, 3.3, 2.0, 1.7, C.stone, 0, Y, -1.2, .06); k.block(p, 3.4, .1, 1.8, C.ivory, 0, Y + 2.0, -1.2);
    k.block(p, 1.7, 3.35, 1.0, C.slate, 0, Y, -1.85, .04); k.block(p, 1.8, .1, 1.1, C.ink, 0, Y + 3.35, -1.85);
    const top = portico(k, p, [-.9, -.3, .3, .9], 2.3, .8, -.05, Y, 1.75, 0);
    k.block(p, 2.4, .35, .1, C.ivory, 0, top + .05, .33); k.sign(p, 'SCENARIOS', 0, top + .22, .39, 1.25);
    k.block(p, 1.5, .1, .55, C.gold, 0, Y + 1.15, .45); bulbs(k, p, -.7, .7, Y + 1.13, .73, 8);
    for (const x of [-.45, .45]) k.block(p, .5, .95, .06, C.red, x, Y + .16, -.33);
    for (const sx of [-1, 1]) { k.block(p, .5, .75, .03, blue, sx * 1.42, Y + .45, -.34); k.block(p, .4, .6, .02, C.ivory, sx * 1.42, Y + .52, -.32); }
    trees(k, p, [-2.2, 2.2], .5, .8);
    return;
  }
  if (level === 4) {
    // A film studio: two vaulted sound stages, an office in front, a water tower with the studio's band.
    for (const [x, n] of [[-1.7, 1], [-.1, 2]] as const) {
      k.block(p, 1.5, 1.1, 2.6, C.concrete, x, Y, -1.1); k.vault(p, .75, 2.6, C.slate, x, Y + 1.1, -1.1);
      k.block(p, .95, .9, .05, C.ink, x, Y, .2);
      k.block(p, .5, .5, .04, blue, x, Y + 1.25, .21);
      for (let i = 0; i < n; i++) k.block(p, .08, .32, .03, C.ivory, x - (n - 1) * .07 + i * .14, Y + 1.34, .24);
    }
    k.block(p, 1.55, 1.6, 1.3, C.ivory, 1.85, Y, -.05, .04); k.block(p, 1.62, .08, 1.37, C.ink, 1.85, Y + 1.6, -.05);
    for (const y of [Y + .3, Y + .95]) k.panes(p, 'front', .6, y, [1.55, 2.15], .38, .42);
    k.sign(p, 'SCENARIOS', 1.85, Y + 1.42, .62, 1.3, blue);
    // The water tower.
    const wx = 1.85, wz = -1.75, legs = 2.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(k, p, [wx + sx * .55, Y, wz + sz * .5], [wx + sx * .4, Y + legs, wz + sz * .38], .07, C.wood);
    for (const y of [Y + .9, Y + 1.8]) { k.block(p, .95, .04, .04, C.wood, wx, y, wz - .44); k.block(p, .95, .04, .04, C.wood, wx, y, wz + .44); }
    k.post(p, .58, .85, C.wood, wx, Y + legs, wz, .58, 20); k.post(p, .6, .2, blue, wx, Y + legs + .32, wz, .6, 20);
    k.cone(p, .66, .4, C.slate, wx, Y + legs + .85, wz, 20);
    trees(k, p, [-2.3, .9], .9, .75);
    return;
  }
  // A grand theatre: eight columns under an attic with a gilded quadriga, a dome, the fly tower, two wings.
  k.block(p, 3.6, 2.5, 1.7, C.stone, 0, Y, -1.25, .06); k.block(p, 3.7, .1, 1.8, C.ivory, 0, Y + 2.5, -1.25);
  k.block(p, 2.0, 3.5, .8, C.slate, 0, Y, -2.05, .04); k.block(p, 2.1, .1, .9, C.ink, 0, Y + 3.5, -2.05);
  for (const sx of [-1, 1]) {
    k.block(p, .85, 2.0, 1.9, C.stone, sx * 2.3, Y, -1.05, .05); k.block(p, .93, .08, 1.98, C.ivory, sx * 2.3, Y + 2.0, -1.05);
    k.pyramid(p, .93, 1.98, .3, C.roof, sx * 2.3, Y + 2.08, -1.05);
    for (const y of [Y + .35, Y + 1.2]) k.panes(p, 'front', -.1, y, [sx * 2.3], .38, .55);
  }
  const top = portico(k, p, [-1.58, -1.13, -.68, -.23, .23, .68, 1.13, 1.58], 3.6, .9, -.05, Y, 2.2, 0);
  k.block(p, 3.4, .45, .5, C.ivory, 0, top + .05, -.1);
  k.sign(p, 'SCENARIOS', 0, top + .27, .16, 1.4);
  // The quadriga: a plinth, four gilded horses and the chariot.
  k.block(p, 1.0, .18, .4, C.stone, 0, top + .5, -.15);
  for (let i = 0; i < 4; i++) { k.metal(k.box(p, .12, .26, .32, C.gold, -.27 + i * .18, top + .81, -.08, .03), C.gold); k.metal(k.box(p, .08, .12, .1, C.gold, -.27 + i * .18, top + .96, .08, .02), C.gold); }
  k.metal(k.box(p, .5, .22, .18, C.gold, 0, top + .79, -.3, .04), C.gold);
  // The dome over the auditorium.
  k.post(p, 1.0, .5, C.ivory, 0, Y + 2.6, -1.3, 1.0, 32);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; k.block(p, .06, .42, .06, C.stone, Math.sin(a) * 1.02, Y + 2.64, -1.3 + Math.cos(a) * 1.02); }
  k.dome(p, 1.02, C.roof, 0, Y + 3.1, -1.3, .95);
  k.post(p, .18, .3, C.ivory, 0, Y + 4.0, -1.3, .18, 12); k.metal(k.ball(p, .13, C.gold, 0, Y + 4.42, -1.3, 10), C.gold);
  for (const sx of [-1, 1]) k.flag(p, sx * 1.6, -.15, .9, blue, top + .5);
  k.block(p, 1.8, .1, .5, C.gold, 0, Y + 1.25, .58); bulbs(k, p, -.85, .85, Y + 1.23, .84, 10);
};

/** Every district's five levels, drawn on a plinth by assets/landmarks.ts. */
export const LANDMARK_MODELS: Record<DistrictId, Model> = { academy, driver, crm, dispatch, oktell, scenarios };
