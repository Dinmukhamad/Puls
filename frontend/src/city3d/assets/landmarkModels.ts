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
 * - Voice («Разговор»): a talking pavilion, a recording studio, a house of talk under a speech bubble, a studio tower
 *   with a microphone, a palace of talk.
 * Drawn with assets/landmarkKit.ts on the 5.7 × 5.3 plinth, the front to +z; ground-level parts stay on the plinth. In
 * the city's v4 style (docs/CITY_V4.md): walls with chamfered edges, windows drawn by the facade material and lit one by
 * one at night, roofs with eaves and tiles, curtain walls with mullions; the masses, the silhouettes and the tops are
 * those the islands always had, so the labels and the picking stand where they did.
 */
import type { DistrictId } from '../../api/city';
import { C, PLINTH as Y, type LandmarkKit } from './landmarkKit';

type Kit = LandmarkKit;
type Model = (k: Kit, level: number) => void;

/** The districts' own colours (as on the map's district shields): flags, awnings, stripes. */
const ACCENT = { academy: '#5b8def', driver: '#f0a23a', crm: '#7b5cff', dispatch: '#35b6a6', oktell: '#e86aa6', scenarios: '#6fa8c7', voice: '#4fae7a' };

/** A column h tall on y0: a square base, a round shaft of radius r narrowing a little, a capital. */
function column(k: Kit, x: number, z: number, y0: number, h: number, r = .09, c: string = C.ivory) {
  k.block(r * 2.7, .07, r * 2.7, C.stone, x, y0, z, { r: 0 });
  k.post(r, h - .14, c, x, y0 + .07, z, r * .86, 10);
  k.block(r * 2.9, .07, r * 2.9, C.stone, x, y0 + h - .07, z, { r: 0 });
}
/**
 * A temple front w wide and d deep, centred at z: a stylobate on y0, columns at xs h tall, an entablature and a
 * pediment of `rise` under a tiled cover; returns the top of the entablature.
 */
function portico(k: Kit, xs: readonly number[], w: number, d: number, z: number, y0: number, h: number, rise: number) {
  k.block(w, .16, d, C.ivory, 0, y0, z);
  for (const x of xs) column(k, x, z + d / 2 - .22, y0 + .16, h);
  const top = y0 + .16 + h;
  k.block(w + .1, .24, d + .06, C.ivory, 0, top, z);
  k.block(w + .14, .05, d + .1, C.trim, 0, top + .24, z, { r: 0 });
  if (rise > 0) k.prism(w + .12, rise, d + .08, C.ivory, 0, top + .29, z, C.roof);
  return top + .24;
}
/**
 * Storeys of glass between slabs: w × d centred on (x, z), from y0, each `storey` high, with fins on the front;
 * returns the top of the last slab.
 */
function glassFloors(k: Kit, w: number, d: number, x: number, z: number, y0: number, floors: number, storey: number, slab: string = C.ivory, fins = 0) {
  k.block(w - .08, floors * storey, d - .08, C.glass, x, y0, z, { win: { bay: .4, floor: storey } });
  for (let i = 0; i <= floors; i++) k.block(w + .06, .09, d + .06, slab, x, y0 + i * storey - (i ? .09 : 0), z, { r: 0 });
  for (let i = 0; i < fins; i++) k.block(.05, floors * storey, .07, C.gold, x - w / 2 + w * (i + .5) / fins, y0, z + d / 2 - .01, { r: 0 });
  return y0 + floors * storey;
}
/** Corner piers over a block's height, so a glass box reads as a framed building. */
function piers(k: Kit, w: number, d: number, x: number, z: number, y0: number, h: number, c: string = C.ivory) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(.14, h, .14, c, x + sx * (w / 2 - .04), y0, z + sz * (d / 2 - .04), { r: .02 });
}
/** A clock face on the front at (x, y, z): dial, gold rim, hour marks and hands. */
function clock(k: Kit, x: number, y: number, z: number, r = .24) {
  k.disc(r, .05, C.ivory, x, y, z, 24);
  k.torus(r, .025, C.gold, x, y, z + .03, { front: true, seg: 24 });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; k.box(.03, .03, .02, C.ink, x + Math.sin(a) * r * .78, y + Math.cos(a) * r * .78, z + .035, { r: 0 }); }
  k.box(.025, r * .75, .02, C.ink, x, y + r * .3, z + .045, { r: 0 });
  k.box(r * .6, .025, .02, C.ink, x + r * .25, y, z + .045, { r: 0 });
}
/** A row of trees along x at z. */
const trees = (k: Kit, xs: readonly number[], z: number, s = .8) => xs.forEach((x, i) => k.tree(x, z, s * (i % 2 ? .9 : 1)));
/** Light bulbs along a marquee's edge, from x0 to x1 at y and z. */
function bulbs(k: Kit, x0: number, x1: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) k.bulb(.04, x0 + (x1 - x0) * i / (n - 1), y, z);
}
/** A checker band of `n` squares s wide along x at (y, z): the taxi livery. */
function checker(k: Kit, x0: number, y: number, z: number, n: number, s: number, rows = 2) {
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) k.box(s, s, .03, (i + r) % 2 ? C.ink : C.taxi, x0 + s * (i + .5), y + s * (r + .5), z, { r: 0 });
}

const academy: Model = (k, level) => {
  const blue = ACCENT.academy;
  if (level === 1) {
    // A village school: one hall under a pitched roof, its gable to the front, a belfry and a flag.
    k.block(2.6, 1.25, 1.8, C.stone, 0, Y, -.55, { r: .06 });
    k.block(2.7, .08, 1.9, C.ivory, 0, Y + 1.25, -.55);
    k.pitched(2.6, 1.8, .85, 0, Y + 1.33, -.55);
    k.door(.55, .92, 0, Y, .37); k.block(.75, .08, .3, C.roof, 0, Y + .98, .5);
    k.panes('front', .35, Y + .35, [-.85, .85], .5, .6);
    k.panes('left', -1.3, Y + .35, [-1.05, -.2], .45, .6); k.panes('right', 1.3, Y + .35, [-1.05, -.2], .45, .6);
    k.sign('ACADEMY', 0, Y + 1.6, .37, .9);
    // The belfry on the ridge: four posts, a bell and a little pyramid roof.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(.05, .42, .05, C.ivory, sx * .15, Y + 2.05, -.15 + sz * .15, { r: 0 });
    k.block(.42, .06, .42, C.ivory, 0, Y + 2.47, -.15, { r: 0 }); k.ball(.1, C.gold, 0, Y + 2.25, -.15, 10);
    k.pyramid(.5, .5, .36, C.roof, 0, Y + 2.53, -.15); k.ball(.05, C.gold, 0, Y + 2.93, -.15, 8);
    k.flag(1.75, 1.05, 2.2, blue);
    k.block(.9, .02, 1.55, C.stone, 0, Y, 1.15, { r: 0 });
    trees(k, [-2.1, 2.1], -1.95, .85); k.bench(-1.6, .9);
    return;
  }
  if (level === 2) {
    // A college: two storeys along the front, a pediment with a clock over the entrance bay, a clock turret, flags.
    k.block(3.4, 2.1, 1.8, C.stone, 0, Y, -.75, { r: .06 });
    k.block(3.5, .1, 1.9, C.ivory, 0, Y + 2.1, -.75);
    k.block(3.42, .06, 1.82, C.trim, 0, Y + 1.02, -.75, { r: 0 });
    k.pitched(3.4, 1.8, .7, 0, Y + 2.2, -.75, { along: 'x' });
    k.block(1.2, 2.35, .45, C.ivory, 0, Y, .37);
    k.prism(1.32, .5, .5, C.stone, 0, Y + 2.35, .37, C.roof);
    clock(k, 0, Y + 2.55, .64, .17);
    k.door(.5, .95, 0, Y, .6); k.arch(.5, .3, C.glass, 0, Y + .96, .56);
    k.sign('ACADEMY', 0, Y + 1.22, .61, .95);
    k.panes('front', .6, Y + 1.45, [-.27, .27], .3, .6);
    for (const y of [Y + .35, Y + 1.3]) k.panes('front', .15, y, [-1.45, -.95, .95, 1.45], .32, .58);
    for (const y of [Y + .35, Y + 1.3]) { k.panes('left', -1.7, y, [-1.3, -.45], .36, .58); k.panes('right', 1.7, y, [-1.3, -.45], .36, .58); }
    // A clock turret astride the ridge.
    k.block(.55, .62, .55, C.ivory, 0, Y + 2.6, -.75, { r: .02 }); k.block(.65, .06, .65, C.stone, 0, Y + 3.22, -.75, { r: 0 });
    k.pyramid(.66, .66, .45, C.roof, 0, Y + 3.28, -.75); k.ball(.055, C.gold, 0, Y + 3.78, -.75, 8);
    clock(k, 0, Y + 2.92, -.46, .16);
    k.flag(-2.05, 1.0, 2.6, blue); k.flag(2.05, 1.0, 2.6, blue);
    k.block(1.1, .02, 1.3, C.stone, 0, Y, 1.25, { r: 0 });
    trees(k, [-2.2, -1.5, 1.5, 2.2], -2.15, .8);
    return;
  }
  if (level === 3) {
    // A university: a portico of four columns before the central hall, two wings, a clock tower behind.
    k.block(2.3, 2.4, 2.0, C.stone, 0, Y, -.95, { r: .06 });
    k.block(2.4, .1, 2.1, C.ivory, 0, Y + 2.4, -.95);
    k.pitched(2.3, 2.0, .7, 0, Y + 2.5, -.95);
    const top = portico(k, [-.75, -.25, .25, .75], 2.15, .95, .55, Y, 1.85, .55);
    k.sign('ACADEMY', 0, top - .12, 1.07, 1.25);
    k.door(.55, 1.05, 0, Y + .16, .07);
    for (const sx of [-1, 1]) {
      const x = sx * 1.88;
      k.block(1.46, 1.75, 1.7, C.stone, x, Y, -.9, { r: .06 }); k.block(1.56, .08, 1.8, C.ivory, x, Y + 1.75, -.9);
      k.block(1.48, .05, 1.72, C.trim, x, Y + .86, -.9, { r: 0 });
      k.pitched(1.46, 1.7, .55, x, Y + 1.83, -.9, { along: 'x' });
      for (const y of [Y + .3, Y + 1.0]) k.panes('front', -.05, y, [x - .35, x + .35], .32, .52);
      k.panes(sx < 0 ? 'left' : 'right', x + sx * .73, Y + .3, [-1.3, -.55], .32, .52);
      k.panes(sx < 0 ? 'left' : 'right', x + sx * .73, Y + 1.0, [-1.3, -.55], .32, .52);
    }
    // The clock tower over the back of the hall.
    k.block(.9, 1.55, .9, C.ivory, 0, Y + 2.4, -1.35, { r: .03 }); k.block(1.0, .1, 1.0, C.stone, 0, Y + 3.95, -1.35, { r: 0 });
    clock(k, 0, Y + 3.45, -.88, .27);
    k.pyramid(1.0, 1.0, .8, C.roof, 0, Y + 4.05, -1.35); k.ball(.07, C.gold, 0, Y + 4.92, -1.35, 8);
    k.flag(-2.3, 1.05, 2.4, blue); k.flag(2.3, 1.05, 2.4, blue);
    trees(k, [-1.3, 1.3], 1.25, .75);
    return;
  }
  if (level === 4) {
    // A campus round a court: the domed hall at the back with a portico, two wings forward, a fountain between.
    k.block(3.2, 2.8, 1.4, C.stone, 0, Y, -1.65, { r: .06 }); k.block(3.3, .1, 1.5, C.ivory, 0, Y + 2.8, -1.65);
    portico(k, [-1.25, -.75, -.25, .25, .75, 1.25], 3.0, .7, -.6, Y, 2.1, .45);
    k.sign('ACADEMY', 0, Y + 2.38, -.2, 1.3);
    k.door(.6, 1.2, 0, Y + .16, -.94);
    k.panes('front', -.95, Y + 1.5, [-.9, .9], .3, .55);
    // Drum, a ring of pilasters, the dome and its lantern.
    k.post(.95, .7, C.ivory, 0, Y + 2.9, -1.65, .95, 28, { win: { bay: .5, floor: .7, w: .4, h: .55 } });
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; k.block(.07, .6, .07, C.stone, Math.sin(a) * .97, Y + 2.95, -1.65 + Math.cos(a) * .97, { r: 0 }); }
    k.torus(.97, .04, C.trim, 0, Y + 3.6, -1.65, { seg: 28 });
    k.dome(.98, C.roof, 0, Y + 3.6, -1.65, .9);
    k.post(.2, .32, C.ivory, 0, Y + 4.45, -1.65, .2, 12); k.cone(.24, .3, C.gold, 0, Y + 4.77, -1.65, 12); k.ball(.06, C.gold, 0, Y + 5.12, -1.65, 8);
    for (const sx of [-1, 1]) {
      const x = sx * 2.12;
      k.block(1.05, 2.1, 2.9, C.stone, x, Y, -.85, { r: .06 }); k.block(1.15, .08, 3.0, C.ivory, x, Y + 2.1, -.85);
      k.block(1.07, .05, 2.92, C.trim, x, Y + 1.0, -.85, { r: 0 });
      k.pitched(1.05, 2.9, .5, x, Y + 2.18, -.85);
      k.arch(.55, 1.1, C.glass, x, Y + .35, .6);
      k.panes(sx < 0 ? 'right' : 'left', x - sx * .525, Y + .4, [-1.7, -.9], .36, .55);
      k.panes(sx < 0 ? 'right' : 'left', x - sx * .525, Y + 1.3, [-1.7, -.9, -.1], .36, .5);
      k.panes(sx < 0 ? 'left' : 'right', x + sx * .525, Y + .4, [-1.7, -.9, -.1], .36, .55);
      k.panes(sx < 0 ? 'left' : 'right', x + sx * .525, Y + 1.3, [-1.7, -.9, -.1], .36, .5);
    }
    // The court: paving, a fountain, benches.
    k.block(2.9, .02, 1.7, C.stone, 0, Y, .25, { r: 0 });
    k.post(.6, .2, C.stone, 0, Y, .45, .6, 24); k.post(.5, .03, '#7fc4d8', 0, Y + .2, .45, .5, 24);
    k.post(.07, .55, C.ivory, 0, Y + .2, .45, .05, 8); k.ball(.12, C.ivory, 0, Y + .78, .45, 10);
    k.bench(-1.1, 1.0); k.bench(1.1, 1.0);
    k.flag(-1.75, 1.45, 2.6, blue); k.flag(1.75, 1.45, 2.6, blue);
    return;
  }
  // A great university: a stepped central tower with a spire and a star, wings with corner turrets, a grand portico.
  k.block(2.0, 3.0, 1.6, C.stone, 0, Y, -1.45, { r: .06, win: { bay: .4, floor: .62, w: .5, h: .55 } }); k.block(2.12, .12, 1.72, C.ivory, 0, Y + 3.0, -1.45);
  k.block(1.44, 1.5, 1.1, C.stone, 0, Y + 3.12, -1.45, { r: .05, win: { bay: .36, floor: .5, w: .45, h: .55 } }); k.block(1.56, .1, 1.22, C.ivory, 0, Y + 4.62, -1.45);
  clock(k, 0, Y + 4.05, -.88, .3);
  k.block(.98, .95, .74, C.stone, 0, Y + 4.72, -1.45, { r: .04 }); k.block(1.08, .08, .84, C.ivory, 0, Y + 5.67, -1.45);
  k.panes('front', -1.08, Y + 4.95, [-.22, .22], .2, .5);
  k.post(.36, .45, C.ivory, 0, Y + 5.75, -1.45, .28, 16);
  k.cone(.24, 1.55, C.gold, 0, Y + 6.2, -1.45, 12);
  k.ball(.17, C.gold, 0, Y + 7.85, -1.45, 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cone(.1, .5, C.roof, sx * .9, Y + 3.12, -1.45 + sz * .7, 8);
    k.cone(.07, .38, C.roof, sx * .64, Y + 4.7, -1.45 + sz * .48, 8);
  }
  // Wings with balustrades, and turrets at their outer front corners.
  for (const sx of [-1, 1]) {
    const x = sx * 1.85;
    k.block(1.7, 2.25, 1.75, C.stone, x, Y, -1.2, { r: .06 }); k.block(1.8, .1, 1.85, C.ivory, x, Y + 2.25, -1.2);
    k.block(1.72, .05, 1.77, C.trim, x, Y + 1.1, -1.2, { r: 0 });
    for (let i = 0; i < 7; i++) k.block(.06, .2, .06, C.ivory, x - .75 + i * .25, Y + 2.35, -.34, { r: 0 });
    k.block(1.7, .05, .08, C.ivory, x, Y + 2.55, -.34, { r: 0 });
    for (const y of [Y + .35, Y + 1.25]) k.panes('front', -.32, y, [x - sx * .35, x + sx * .25], .3, .55);
    for (const y of [Y + .35, Y + 1.25]) k.panes(sx < 0 ? 'left' : 'right', x + sx * .85, y, [-1.7, -1.0], .3, .55);
    const tx = sx * 2.42;
    k.block(.62, 2.95, .62, C.ivory, tx, Y, -.55, { r: .04 });
    k.block(.7, .08, .7, C.stone, tx, Y + 2.95, -.55, { r: 0 });
    k.pyramid(.7, .7, .75, C.roof, tx, Y + 3.03, -.55); k.ball(.05, C.gold, tx, Y + 3.82, -.55, 8);
    k.panes('front', -.24, Y + 1.9, [tx], .2, .5);
    k.panes('front', -.24, Y + .9, [tx], .2, .5);
  }
  const top = portico(k, [-.9, -.54, -.18, .18, .54, .9], 2.2, 1.1, -.1, Y, 2.3, .5);
  k.sign('ACADEMY', 0, top - .12, .5, 1.3);
  k.door(.7, 1.4, 0, Y + .16, -.62);
  for (const x of [-1.5, 0, 1.5]) k.flag(x, 1.4, 2.6, blue);
  trees(k, [-2.3, 2.3], 1.2, .8);
};

const driver: Model = (k, level) => {
  const orange = ACCENT.driver;
  if (level === 1) {
    // A garage: one bay with a roller door, a cabin for the dispatcher, a taxi and a fuel pump.
    k.block(1.8, 1.3, 1.8, C.concrete, -.75, Y, -.85, { r: .05 }); k.block(1.9, .1, 1.9, C.ink, -.75, Y + 1.3, -.85);
    k.block(1.32, .98, .05, C.slate, -.75, Y, .07, { r: 0 });
    for (let i = 1; i < 6; i++) k.block(1.3, .025, .03, C.steel, -.75, Y + i * .16, .1, { r: 0 });
    k.block(1.8, .12, .04, orange, -.75, Y + 1.08, .07, { r: 0 });
    k.sign('PULS GARAGE', -.75, Y + 1.24, .1, 1.2);
    k.block(1.05, 1.1, 1.0, C.ivory, .85, Y, -.65, { r: .04 }); k.block(1.12, .07, 1.08, C.ink, .85, Y + 1.1, -.65);
    k.block(1.05, .1, .04, orange, .85, Y + .82, -.14, { r: 0 });
    k.panes('front', -.15, Y + .38, [1.08], .42, .4); k.door(.32, .72, .55, Y, -.13, C.slate);
    k.panes('right', 1.375, Y + .38, [-.65], .42, .4);
    k.taxi(-.75, 1.05);
    k.block(.3, .62, .24, C.ivory, 1.25, Y, .75, { r: .03 }); k.block(.32, .08, .26, orange, 1.25, Y + .62, .75, { r: 0 }); k.block(.2, .14, .03, C.ink, 1.25, Y + .42, .88, { r: 0 });
    for (let i = 0; i < 3; i++) k.post(.17, .09, C.ink, 1.9, Y + i * .09, -1.7, .17, 12);
    trees(k, [-2.1, 2.1], -2.0, .8);
    return;
  }
  if (level === 2) {
    // A service station: two bays (a taxi up on the lift in the open one), the office's glass corner, tyres, a sign box.
    k.block(3.3, 1.6, 1.9, C.concrete, -.4, Y, -1.05, { r: .05 }); k.block(3.42, .12, 2.02, C.ink, -.4, Y + 1.6, -1.05);
    k.block(3.3, .14, .04, orange, -.4, Y + 1.36, -.08, { r: 0 });
    k.block(.92, 1.15, .04, C.slate, -1.55, Y, -.08, { r: 0 });
    for (let i = 1; i < 7; i++) k.block(.9, .02, .03, C.steel, -1.55, Y + i * .16, -.05, { r: 0 });
    k.block(.92, 1.15, .04, C.ink, -.5, Y, -.08, { r: 0 });
    k.taxi(-.5, .02);
    k.block(1.1, 1.3, 1.8, C.glass, .75, Y, -1.0, { win: { bay: .37, floor: 1.3 } }); piers(k, 1.1, 1.8, .75, -1.0, Y, 1.3);
    k.block(1.0, .06, .5, orange, .75, Y + 1.0, .1, { r: 0 });
    k.block(1.7, .48, .14, orange, -.4, Y + 1.72, -.45, { r: .03 }); k.sign('PULS GARAGE', -.4, Y + 1.96, -.37, 1.5);
    for (const x of [-.95, .15]) k.block(.06, .2, .06, C.ink, x, Y + 1.6, -.45, { r: 0 });
    k.taxi(-1.55, 1.05); k.taxi(1.65, .9, -.4);
    for (let i = 0; i < 4; i++) k.post(.17, .09, C.ink, 2.2, Y + i * .09, -.3, .17, 12);
    for (const x of [1.95, 2.35]) k.post(.13, .38, orange, x, Y, -1.7, .13, 10);
    trees(k, [-2.35, 2.25], -2.2, .75);
    return;
  }
  if (level === 3) {
    // A taxi fleet: three bays with skylights, a two-storey office, a parking canopy over the line of taxis.
    k.block(3.15, 1.75, 1.7, C.concrete, -.5, Y, -1.4, { r: .05 }); k.block(3.27, .12, 1.82, C.ink, -.5, Y + 1.75, -1.4);
    for (const x of [-1.55, -.5, .55]) {
      k.block(.9, 1.25, .05, C.ink, x, Y, -.53, { r: 0 }); k.block(.8, 1.12, .05, C.glass, x, Y + .06, -.5, { win: { bay: .4, floor: .37 } });
      for (let i = 1; i < 4; i++) k.block(.8, .02, .02, C.steel, x, Y + i * .3, -.47, { r: 0 });
      k.rotated(x, Y + 1.92, -1.4, -.2, 0, 0, () => k.box(.7, .1, .9, C.glass, 0, 0, 0, { top: C.glass }));
    }
    k.block(3.15, .13, .04, orange, -.5, Y + 1.5, -.53, { r: 0 });
    k.sign('PULS GARAGE', -.5, Y + 1.5, -.5, 1.6);
    k.block(1.3, 2.7, 1.9, C.ivory, 1.75, Y, -1.25, { r: .05 }); k.block(1.38, .1, 1.98, C.ink, 1.75, Y + 2.7, -1.25);
    for (const y of [Y + .9, Y + 1.8]) k.block(1.32, .1, 1.92, orange, 1.75, y, -1.25, { r: 0 });
    for (const y of [Y + .25, Y + 1.12, Y + 2.0]) k.panes('front', -.3, y, [1.45, 2.05], .4, .5);
    for (const y of [Y + .25, Y + 1.12, Y + 2.0]) k.panes('right', 2.4, y, [-1.7, -1.0], .4, .5);
    // The canopy over the waiting taxis.
    for (const x of [-2.05, -1.0, .0, 1.05]) for (const z of [.4, 1.6]) k.block(.08, 1.25, .08, C.ink, x, Y, z, { r: 0 });
    k.block(3.3, .08, 1.35, C.slate, -.5, Y + 1.25, 1.0, { r: 0, bottom: true }); k.block(3.3, .14, .05, orange, -.5, Y + 1.2, 1.68, { r: 0 });
    for (const x of [-1.5, -.5, .5]) k.taxi(x, .95);
    trees(k, [2.25], .6, .8);
    return;
  }
  if (level === 4) {
    // A depot: a vaulted hangar with a glass arch, an office tower with the taxi checker crown, chargers.
    k.block(2.5, 1.0, 2.5, C.concrete, -1.35, Y, -1.05);
    k.vault(1.25, 2.5, C.slate, -1.35, Y + 1.0, -1.05, C.concrete);
    for (let i = 1; i < 5; i++) k.block(.03, .05, 2.52, C.steel, -1.35 + Math.cos(i * Math.PI / 5) * 1.24, Y + 1.0 + Math.sin(i * Math.PI / 5) * 1.24, -1.05, { r: 0 });
    k.arch(1.9, 1.95, C.glass, -1.35, Y + .05, .21);
    k.block(1.2, .95, .05, C.ink, -1.35, Y, .28, { r: 0 });
    k.block(2.5, .12, .04, orange, -1.35, Y + 1.0, .21, { r: 0 });
    k.sign('PULS DEPOT', -1.35, Y + 1.12, .32, 1.2);
    glassFloors(k, 1.3, 1.3, 1.1, -1.4, Y, 4, .85, C.ivory, 4);
    for (let i = 0; i < 4; i++) k.block(1.34, .1, 1.34, orange, 1.1, Y + .4 + i * .85, -1.4, { r: 0 });
    k.block(1.3, .33, 1.3, C.ink, 1.1, Y + 3.42, -1.4);
    checker(k, .45, Y + 3.42, -.73, 8, .1625, 2);
    k.block(1.36, .07, 1.36, C.ink, 1.1, Y + 3.75, -1.4, { r: 0 });
    k.box(.5, .2, .3, C.taxi, 1.1, Y + 3.92, -1.4, { r: .04 }); k.beacon(1.1, Y + 4.1, -1.4);
    for (const x of [.65, 1.25, 1.85]) {
      k.block(.22, .62, .16, C.ivory, x, Y, .35, { r: .03 }); k.block(.16, .2, .02, '#5fd08a', x, Y + .38, .44, { r: 0 });
    }
    k.taxi(.95, 1.05); k.taxi(1.85, 1.05);
    k.taxi(-1.35, .95);
    return;
  }
  // A transport hub: a four-deck car park with a helipad, a vaulted glass terminal, a clock tower with a taxi light.
  const deck = (y: number) => k.block(2.55, .1, 2.3, C.concrete, -1.35, y, -1.25, { r: 0, bottom: true });
  for (let i = 0; i < 4; i++) {
    const y = Y + i * .78;
    deck(y);
    if (i < 3) for (const x of [-2.58, -1.78, -.92, -.12]) for (const z of [-2.35, -.15]) k.block(.09, .68, .09, C.concrete, x, y + .1, z, { r: 0 });
    k.block(2.55, .2, .04, i % 2 ? orange : C.white, -1.35, y + .1, -.1, { r: 0 });
  }
  const colours = [C.taxi, '#d9dee2', C.taxi, '#c9584f', C.taxi, '#5b8def'];
  for (let i = 0; i < 6; i++) k.taxi(-2.2 + (i % 3) * .85, -.9 - (i > 2 ? .9 : 0), Math.PI, colours[i], Y + .78 * (1 + (i % 2)) + .1);
  for (let i = 0; i < 3; i++) k.taxi(-2.2 + i * .85, -1.3, Math.PI, colours[i + 2], Y + .1);
  // The helipad on the roof deck.
  const roof = Y + 3 * .78 + .1;
  k.post(.78, .04, C.ink, -1.35, roof, -1.25, .78, 24); k.torus(.7, .03, C.taxi, -1.35, roof + .05, -1.25, { seg: 32 });
  for (const x of [-.18, .18]) k.block(.07, .02, .5, C.ivory, -1.35 + x, roof + .04, -1.25, { r: 0 });
  k.block(.36, .02, .07, C.ivory, -1.35, roof + .04, -1.25, { r: 0 });
  // The terminal.
  k.block(2.5, 1.0, 2.2, C.glass, 1.35, Y, -1.0, { win: { bay: .42, floor: 1.0 } }); piers(k, 2.5, 2.2, 1.35, -1.0, Y, 1.0);
  k.vault(1.28, 2.3, C.ivory, 1.35, Y + 1.0, -1.0, C.ivory);
  k.arch(2.0, 2.15, C.glass, 1.35, Y + .05, .17);
  for (let i = 1; i < 6; i++) k.block(.04, 1.2, .04, C.ivory, .35 + i * .33, Y + .9, .27, { r: 0 });
  k.sign('PULS TAXI HUB', 1.35, Y + 1.08, .3, 1.6);
  // The clock tower at the back corner, a taxi light on top.
  k.block(.8, 4.6, .8, C.ivory, 2.15, Y, -2.15, { r: .04 });
  for (let i = 1; i < 5; i++) k.block(.84, .08, .84, orange, 2.15, Y + i * .92, -2.15, { r: 0 });
  clock(k, 2.15, Y + 4.1, -1.72, .26);
  k.block(.8, .32, .8, C.ink, 2.15, Y + 4.6, -2.15, { r: 0 });
  checker(k, 1.75, Y + 4.6, -1.74, 5, .16, 2);
  k.block(.86, .08, .86, C.ink, 2.15, Y + 4.92, -2.15, { r: 0 });
  k.box(.55, .26, .3, C.taxi, 2.15, Y + 5.15, -2.15, { r: .05 }); k.beacon(2.15, Y + 5.4, -2.15, .08);
  // The taxi rank before the terminal.
  for (const x of [.6, 1.4, 2.2]) k.taxi(x, 1.05);
};

const crm: Model = (k, level) => {
  const violet = ACCENT.crm;
  /** The chat bubble: a rounded board with a tail, on two posts from y0. */
  const bubble = (x: number, y0: number, z: number, w: number) => {
    for (const sx of [-1, 1]) k.block(.05, .3, .05, C.ink, x + sx * w * .3, y0, z, { r: 0 });
    k.box(w, w * .55, .14, violet, x, y0 + .3 + w * .275, z, { r: .06 });
    k.rotated(x - w * .25, y0 + .3, z, 0, 0, .8, () => k.box(.18, .18, .1, violet, 0, 0, 0, { r: 0 }));
    k.sign('CRM', x, y0 + .3 + w * .275, z + .08, w * .8, violet);
  };
  if (level === 1) {
    // A small office: two glass storeys in a white frame, a canopy, a chat bubble on the roof.
    glassFloors(k, 2.4, 1.7, 0, -.9, Y, 2, .82, C.ivory);
    piers(k, 2.4, 1.7, 0, -.9, Y, 1.64);
    for (let i = 1; i < 5; i++) k.block(.04, 1.64, .05, C.ivory, -1.2 + i * .48, Y, -.03, { r: 0 });
    k.block(1.1, .06, .55, violet, 0, Y + .82, .2, { r: 0, bottom: true }); k.door(.5, .76, 0, Y, -.02, C.slate);
    k.block(.6, .32, .5, C.steel, .7, Y + 1.64, -1.3, { r: .03 });
    bubble(-.3, Y + 1.64, -.6, .95);
    k.sign('PULS / CRM', 0, Y + 1.05, .0, 1.1);
    for (const x of [-1.7, 1.7]) k.tree(x, .6, .75);
    k.bench(-1.55, -.2, Math.PI / 2);
    return;
  }
  if (level === 2) {
    // A glass office: three storeys with fins, a glass lobby, a roof terrace with a pergola.
    glassFloors(k, 3.0, 2.0, 0, -1.1, Y, 3, .85, C.ivory, 7);
    piers(k, 3.0, 2.0, 0, -1.1, Y, 2.55);
    k.block(1.3, .95, .6, C.glass, 0, Y, .2, { win: { bay: .43, floor: .95 } }); piers(k, 1.3, .6, 0, .2, Y, .95, C.ivory);
    k.block(1.45, .08, .75, violet, 0, Y + .95, .2, { r: 0, bottom: true });
    k.sign('PULS / CRM', 0, Y + 2.38, -.08, 1.3, violet);
    const roof = Y + 2.55;
    k.block(2.6, .06, 1.6, C.lawn, 0, roof, -1.1, { r: 0 });
    for (const [x, z] of [[-1.0, -1.6], [1.0, -1.6], [-1.0, -.6], [.2, -1.7]] as const) k.ball(.2, C.leaf, x, roof + .2, z, 10);
    for (const x of [.4, 1.2]) for (const z of [-1.0, -.4]) k.block(.05, .5, .05, C.wood, x, roof, z, { r: 0 });
    for (let i = 0; i < 5; i++) k.block(.05, .04, .7, C.wood, .4 + i * .2, roof + .5, -.7, { r: 0 });
    k.block(.55, .3, .45, C.steel, -.4, roof, -1.5, { r: .03 });
    trees(k, [-2.0, 2.0], .55, .8);
    return;
  }
  if (level === 3) {
    // A tower on a podium: six storeys of glass with fins over a stone and glass base, a crown and an aerial.
    k.block(3.8, .45, 2.2, C.stone, 0, Y, -1.2); k.block(3.7, .5, 2.1, C.glass, 0, Y + .45, -1.2, { ribbon: true }); k.block(3.9, .1, 2.3, C.ivory, 0, Y + .95, -1.2);
    k.block(1.4, .07, .6, violet, 0, Y + .95, .1, { r: 0, bottom: true });
    k.sign('PULS / CRM', 0, Y + .7, -.08, 1.3, violet);
    const top = glassFloors(k, 1.9, 1.5, 0, -1.3, Y + 1.05, 6, .6, C.ivory, 6);
    piers(k, 1.9, 1.5, 0, -1.3, Y + 1.05, 3.6);
    k.block(1.4, .42, 1.05, C.ivory, 0, top, -1.35); k.block(1.5, .06, 1.15, violet, 0, top + .3, -1.35, { r: 0 });
    k.post(.03, .7, C.ink, .4, top + .42, -1.5, .02, 6); k.beacon(.4, top + 1.13, -1.5, .05);
    for (const x of [-1.5, 1.5]) for (const z of [-1.9, -.6]) k.ball(.22, C.leaf, x, Y + 1.2, z, 10);
    trees(k, [-2.2, 2.2], .7, .8);
    return;
  }
  if (level === 4) {
    // A taller tower stepping back to a roof garden, beside a lower wing with a green roof.
    k.block(4.2, 1.0, 2.3, C.stone, 0, Y, -1.2); k.block(4.1, .55, 2.2, C.glass, 0, Y + .3, -1.2, { ribbon: true }); k.block(4.3, .1, 2.4, C.ivory, 0, Y + 1.0, -1.2);
    k.block(1.5, .07, .65, violet, -.6, Y + 1.0, .1, { r: 0, bottom: true });
    k.sign('PULS / CRM', -.6, Y + .62, -.03, 1.3, violet);
    const top = glassFloors(k, 2.0, 1.6, -.6, -1.3, Y + 1.1, 7, .6, C.ivory, 6);
    piers(k, 2.0, 1.6, -.6, -1.3, Y + 1.1, 4.2);
    const crown = glassFloors(k, 1.4, 1.1, -.75, -1.45, top, 1, .65, C.ivory, 4);
    k.block(2.04, .05, 1.64, C.lawn, -.6, top + .01, -1.3, { r: 0 });
    for (const [x, z] of [[.1, -.75], [-1.45, -.75], [.15, -1.95]] as const) k.tree(x, z, .5, top);
    k.block(1.5, .05, 1.15, C.lawn, -.75, crown + .01, -1.45, { r: 0 });
    for (const x of [-1.15, -.4]) k.tree(x, -1.45, .5, crown);
    k.block(1.44, .08, 1.14, violet, -.75, crown - .32, -1.45, { r: 0 });
    // The lower wing.
    const wing = glassFloors(k, 1.35, 1.5, 1.35, -1.25, Y + 1.1, 3, .55, C.ivory, 3);
    k.block(1.37, .06, 1.52, C.lawn, 1.35, wing, -1.25, { r: 0 });
    for (const z of [-1.7, -.85]) k.tree(1.35, z, .55, wing);
    trees(k, [1.7], .8, .8); k.bench(1.9, .1, -Math.PI / 2);
    return;
  }
  // Twin towers over a podium, joined by a skybridge, a glass crown, the chat bubble over the entrance.
  k.block(4.8, 1.0, 2.3, C.stone, 0, Y, -1.25); k.block(4.7, .55, 2.2, C.glass, 0, Y + .3, -1.25, { ribbon: true }); k.block(4.9, .1, 2.4, C.ivory, 0, Y + 1.0, -1.25);
  k.block(1.6, .07, .7, violet, 0, Y + 1.0, .1, { r: 0, bottom: true });
  k.sign('PULS / CRM', 0, Y + .62, -.03, 1.3, violet);
  for (const [x, floors] of [[-1.3, 9], [1.3, 10]] as const) {
    const top = glassFloors(k, 1.6, 1.5, x, -1.45, Y + 1.1, floors, .6, C.ivory, 4);
    piers(k, 1.6, 1.5, x, -1.45, Y + 1.1, floors * .6);
    k.block(1.62, .1, 1.52, violet, x, top - .35, -1.45, { r: 0 });
    if (floors === 10) {
      k.pyramid(1.5, 1.4, .65, C.glass, x, top, -1.45);
      k.post(.03, .8, C.ink, x, top + .6, -1.45, .02, 6); k.beacon(x, top + 1.42, -1.45, .05);
    } else {
      k.block(1.2, .3, 1.1, C.ivory, x, top, -1.45);
      k.block(1.62 * .7, .05, 1.52 * .7, C.lawn, x, top + .01, -1.45, { r: 0 });
      for (const sx of [-1, 1]) k.tree(x + sx * .55, -.85, .45, top);
    }
  }
  // The skybridge.
  k.block(1.2, .5, .8, C.glass, 0, Y + 4.1, -1.45, { ribbon: true }); k.block(1.2, .07, .86, C.ivory, 0, Y + 4.05, -1.45, { r: 0, bottom: true }); k.block(1.2, .07, .86, C.ivory, 0, Y + 4.6, -1.45, { r: 0 });
  bubble(0, Y + 1.1, -.55, 1.0);
  for (const x of [-2.2, 2.2]) k.tree(x, .7, .8);
  for (const x of [-1.0, 1.0]) k.ball(.25, C.leaf, x, Y + .35, .55, 10);
};

const dispatch: Model = (k, level) => {
  const teal = ACCENT.dispatch;
  if (level === 1) {
    // A radio hut: a booth glazed all round, a lattice mast with a warning light, a dish on the roof.
    k.block(1.7, .5, 1.4, C.ivory, -.65, Y, -.75); k.block(1.65, .62, 1.35, C.glass, -.65, Y + .5, -.75, { ribbon: true });
    piers(k, 1.7, 1.4, -.65, -.75, Y + .5, .62);
    k.block(1.85, .1, 1.55, C.ink, -.65, Y + 1.12, -.75); k.block(1.86, .06, 1.56, teal, -.65, Y + 1.06, -.75, { r: 0 });
    k.sign('CONTROL', -.65, Y + .28, -.04, .95);
    k.dish(.32, -.95, Y + 1.35, -.9, .7, .6);
    k.post(.025, .6, C.ink, -.2, Y + 1.22, -1.1, .02, 6);
    k.mast(.42, 3.0, 1.35, Y, -1.25, C.red);
    k.block(.62, .55, .5, C.concrete, 1.35, Y, -.4, { r: .03 }); k.door(.3, .45, 1.35, Y, -.14, C.slate);
    k.taxi(.9, .95, -.3, teal);
    trees(k, [-2.2, -1.5], -1.95, .75);
    return;
  }
  if (level === 2) {
    // A radio station: an operations building with a window band, dishes on the roof, a tall guyed mast.
    k.block(3.0, 1.35, 1.9, C.ivory, -.85, Y, -1.15, { r: .05 });
    k.block(3.04, .42, 1.94, C.glass, -.85, Y + .5, -1.15, { ribbon: true });
    k.block(3.12, .1, 2.02, C.ink, -.85, Y + 1.35, -1.15); k.block(3.1, .08, 2.0, teal, -.85, Y + 1.27, -1.15, { r: 0 });
    k.sign('CONTROL', -.85, Y + .25, -.18, 1.1);
    k.door(.65, .9, .3, Y, -.18, C.slate);
    k.dish(.42, -1.65, Y + 1.6, -1.35, .6, .4); k.dish(.3, -.6, Y + 1.55, -1.6, .8, -.5);
    const mx = 1.55, mz = -1.35, h = 4.1;
    k.mast(.5, h, mx, Y, mz, C.red);
    for (const [ax, az] of [[2.6, -2.35], [2.55, -.35], [.85, -2.45]] as const) k.rod([mx, Y + h * .78, mz], [ax, Y, az], .018, C.steel);
    k.dish(.25, mx, Y + h * .62, mz + .3, .2, 0);
    trees(k, [-2.3, -1.4], .7, .8);
    return;
  }
  if (level === 3) {
    // A control tower: a stone base, a round shaft with gold ribs, the glazed cab and its gallery, an aerial.
    k.block(2.8, .95, 2.0, C.stone, 0, Y, -.75, { r: .06 }); k.block(2.9, .1, 2.1, C.ivory, 0, Y + .95, -.75);
    k.panes('front', .25, Y + .3, [-1.05, -.6, .6, 1.05], .32, .45);
    k.panes('left', -1.4, Y + .3, [-1.3, -.2], .32, .45); k.panes('right', 1.4, Y + .3, [-1.3, -.2], .32, .45);
    k.sign('CONTROL', 0, Y + .55, .27, 1.0);
    const shaft = Y + 1.05, h = 2.7;
    k.post(.62, h, C.stone, 0, shaft, -.8, .55, 28);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; k.block(.05, h, .05, C.gold, Math.sin(a) * .6, shaft, -.8 + Math.cos(a) * .6, { r: 0 }); }
    const cab = shaft + h;
    k.post(1.3, .12, C.ivory, 0, cab, -.8, 1.3, 32);
    k.post(1.08, .7, C.glass, 0, cab + .12, -.8, 1.2, 24, { win: { bay: .45, floor: .7 }, ribbon: true });
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; k.block(.05, .7, .05, C.gold, Math.sin(a) * 1.15, cab + .12, -.8 + Math.cos(a) * 1.15, { r: 0 }); }
    k.post(1.38, .16, C.ink, 0, cab + .82, -.8, 1.3, 32); k.block(.5, .2, .5, C.ink, 0, cab + .98, -.8, { r: .03 });
    k.post(.03, 1.0, C.gold, 0, cab + 1.18, -.8, .02, 6); k.beacon(0, cab + 2.2, -.8);
    k.dish(.35, 1.05, Y + 1.3, -1.35, .6, .9);
    k.taxi(-1.9, .95, .2, teal);
    trees(k, [2.1], .8, .8);
    return;
  }
  if (level === 4) {
    // A taller control tower with a radar tower beside it and a wing either side.
    k.block(3.1, 1.05, 2.0, C.stone, 0, Y, -.85, { r: .06 }); k.block(3.2, .1, 2.1, C.ivory, 0, Y + 1.05, -.85);
    for (const sx of [-1, 1]) {
      k.block(.95, .85, 1.7, C.ivory, sx * 2.1, Y, -.75, { r: .04 }); k.block(1.0, .07, 1.75, C.ink, sx * 2.1, Y + .85, -.75);
      k.panes('front', .1, Y + .3, [sx * 2.1], .55, .38);
      k.panes(sx < 0 ? 'left' : 'right', sx * 2.575, Y + .3, [-1.2, -.4], .4, .38);
    }
    k.panes('front', .15, Y + .3, [-1.1, -.65, .65, 1.1], .32, .5);
    k.sign('CONTROL', 0, Y + .6, .17, 1.1);
    const shaft = Y + 1.15, h = 3.3;
    k.post(.68, h, C.stone, -.35, shaft, -.95, .58, 28);
    for (let i = 0; i < 3; i++) k.post(.7, .06, teal, -.35, shaft + .8 + i * .9, -.95, .66, 28);
    const cab = shaft + h;
    k.post(.7, .45, C.ivory, -.35, cab - .4, -.95, 1.15, 28);
    k.post(1.38, .12, C.ivory, -.35, cab + .05, -.95, 1.38, 32);
    k.post(1.15, .78, C.glass, -.35, cab + .17, -.95, 1.28, 24, { win: { bay: .45, floor: .78 }, ribbon: true });
    for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7; k.block(.05, .78, .05, C.gold, -.35 + Math.sin(a) * 1.22, cab + .17, -.95 + Math.cos(a) * 1.22, { r: 0 }); }
    k.post(1.45, .17, C.ink, -.35, cab + .95, -.95, 1.35, 32); k.block(.55, .25, .55, C.ink, -.35, cab + 1.12, -.95, { r: .03 });
    k.post(.03, 1.1, C.gold, -.35, cab + 1.37, -.95, .02, 6); k.beacon(-.35, cab + 2.5, -.95);
    // The radar on its own tower.
    k.post(.28, 1.7, C.ivory, 1.4, Y + 1.15, -1.6, .24, 16);
    k.post(.4, .1, C.ink, 1.4, Y + 2.85, -1.6, .4, 16);
    k.ball(.58, C.ivory, 1.4, Y + 3.48, -1.6, 20);
    k.dish(.3, 1.2, Y + 1.5, -.35, .5, .3);
    trees(k, [-2.2, 2.2], .75, .8);
    return;
  }
  // A TV tower: a round base with a glass band, a tapering shaft on four legs, a glazed pod, a striped spire.
  k.post(1.55, .95, C.ivory, 0, Y, -.8, 1.55, 40);
  k.post(1.58, .38, C.glass, 0, Y + .3, -.8, 1.58, 40, { win: { bay: .45, floor: .38 }, ribbon: true });
  k.post(1.62, .08, teal, 0, Y + .87, -.8, 1.62, 40); k.post(1.6, .1, C.white, 0, Y + .95, -.8, 1.45, 40);
  k.sign('CONTROL', 0, Y + .5, .8, 1.2);
  const foot = Y + 1.05, h = 5.4;
  k.post(.55, h, C.stone, 0, foot, -.8, .3, 28);
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; k.rod([Math.sin(a) * 1.25, foot, -.8 + Math.cos(a) * 1.25], [Math.sin(a) * .42, foot + 1.9, -.8 + Math.cos(a) * .42], .16, C.stone); }
  for (let i = 1; i < 4; i++) k.post(.55 - i * .065 + .03, .07, teal, 0, foot + i * 1.25, -.8, .55 - i * .065 + .03, 24);
  // The pod: a flared underside, the gallery, the glass and a teal roof ring; a smaller pod above.
  const pod = foot + 3.7;
  k.post(.42, .32, C.ivory, 0, pod - .32, -.8, 1.05, 32);
  k.post(1.08, .4, C.glass, 0, pod, -.8, 1.08, 32, { win: { bay: .4, floor: .4 }, ribbon: true });
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; k.block(.04, .4, .04, C.ivory, Math.sin(a) * 1.08, pod, -.8 + Math.cos(a) * 1.08, { r: 0 }); }
  k.post(1.15, .12, teal, 0, pod + .4, -.8, 1.15, 32); k.post(1.0, .14, C.ivory, 0, pod + .52, -.8, .55, 32);
  k.post(.5, .28, C.glass, 0, pod + 1.15, -.8, .5, 24, { win: { bay: .35, floor: .28 }, ribbon: true }); k.post(.55, .07, teal, 0, pod + 1.43, -.8, .55, 24);
  const spire = foot + h;
  for (let i = 0; i < 4; i++) k.post(.12 - i * .022, .5, i % 2 ? C.red : C.ivory, 0, spire + i * .5, -.8, .12 - (i + 1) * .022, 10);
  k.beacon(0, spire + 2.05, -.8);
  for (const x of [-2.2, 2.2]) k.flag(x, .9, 2.2, teal);
};

const oktell: Model = (k, level) => {
  const pink = ACCENT.oktell;
  if (level === 1) {
    // A telephone exchange: a small stone building with tall windows, an aerial, a phone box outside.
    k.block(2.4, 1.3, 1.6, C.stone, -.15, Y, -1.0, { r: .05 }); k.block(2.5, .12, 1.7, C.ivory, -.15, Y + 1.3, -1.0);
    k.panes('front', -.2, Y + .3, [-.95, -.5, .2, .65], .3, .75);
    k.panes('left', -1.35, Y + .3, [-1.4, -.6], .3, .75);
    k.door(.45, .9, -.15, Y, -.18, C.slate);
    k.sign('OKTELL', -.15, Y + 1.36, -.12, .9);
    k.post(.025, .8, C.ink, .55, Y + 1.42, -1.35, .02, 6); k.block(.5, .03, .03, C.ink, .55, Y + 2.0, -1.35, { r: 0 });
    // The phone box.
    k.block(.5, 1.05, .5, pink, 1.65, Y, .25, { r: .03 }); k.block(.56, .08, .56, pink, 1.65, Y + 1.05, .25, { r: 0 });
    k.panes('front', .5, Y + .35, [1.65], .3, .55, pink); k.panes('left', 1.4, Y + .35, [.25], .3, .55, pink);
    k.block(.4, .1, .03, C.ivory, 1.65, Y + .9, .51, { r: 0 });
    trees(k, [-2.1, 2.1], -1.9, .8); k.bench(-1.6, .75);
    return;
  }
  if (level === 2) {
    // The domed exchange: arched windows, a dome with a gold ring, a dish beside it.
    k.block(3.4, 1.35, 2.2, C.stone, 0, Y + .05, -.75, { r: .12 }); k.block(3.55, .15, 2.35, C.ivory, 0, Y + 1.4, -.75, { r: .1 });
    k.block(3.42, .05, 2.22, C.trim, 0, Y + .3, -.75, { r: 0 });
    for (const x of [-1.12, -.55, 0, .55, 1.12]) k.window(x, Y + .35, .35, .4, .72, true);
    k.dome(1.15, C.roof, 0, Y + 1.5, -.9, 1.15 * .78, 28, .9);
    k.torus(1.18, .06, C.gold, 0, Y + 1.56, -.9, { seg: 32 });
    k.ball(.08, C.gold, 0, Y + 2.45, -.9, 8);
    k.dish(.5, 1.2, Y + 1.75, -1.45, .6, -.5);
    k.sign('OKTELL', 0, Y + 1.2, .36, 1.2);
    trees(k, [-2.15, 2.15], -1.95, .8);
    return;
  }
  if (level === 3) {
    // A call centre: three storeys of ribbon windows under a giant headset, a glass lobby.
    k.block(3.6, 2.45, 1.85, C.stone, 0, Y, -1.25, { r: .05 });
    for (const y of [Y + .3, Y + 1.1, Y + 1.9]) k.block(3.64, .42, 1.89, C.glass, 0, y, -1.25, { ribbon: true });
    k.block(3.72, .1, 1.97, C.ivory, 0, Y + 2.45, -1.25);
    k.block(1.5, 1.2, .7, C.glass, 0, Y, .0, { win: { bay: .5, floor: 1.2 } }); piers(k, 1.5, .7, 0, .0, Y, 1.2);
    k.block(1.65, .1, .85, pink, 0, Y + 1.2, .0, { r: 0 });
    k.sign('OKTELL', 0, Y + 1.0, .36, 1.1, pink);
    // The headset: a band over the roof, ear cups and a microphone.
    const roof = Y + 2.55;
    k.torus(.95, .1, pink, 0, roof + .35, -1.3, { front: true, start: Math.PI / 2, arc: Math.PI, seg: 20 });
    for (const sx of [-1, 1]) { k.axle(.3, .22, C.ink, sx * .95, roof + .35, -1.3, 20); k.axle(.22, .24, pink, sx * .95, roof + .35, -1.3, 20); }
    for (const sx of [-1, 1]) k.block(.12, .35, .12, C.ink, sx * .95, roof, -1.3, { r: 0 });
    k.rod([.9, roof + .25, -1.15], [.35, roof + .05, -.6], .06, C.ink); k.ball(.1, pink, .33, roof + .05, -.58, 10);
    for (const x of [-1.5, 1.5]) { k.post(.025, .9, C.ink, x, roof, -1.95, .02, 6); k.beacon(x, roof + .92, -1.95, .045); }
    trees(k, [-2.15, 2.15], .55, .8);
    return;
  }
  if (level === 4) {
    // A communications centre: a two-storey block with a small dome, a glass atrium, a round tower of dishes.
    k.block(2.9, 2.0, 1.9, C.stone, -.8, Y, -1.2, { r: .05 });
    for (const y of [Y + .3, Y + 1.2]) k.block(2.94, .5, 1.94, C.glass, -.8, y, -1.2, { ribbon: true });
    k.block(3.0, .1, 2.0, C.ivory, -.8, Y + 2.0, -1.2);
    k.post(.55, .2, C.ivory, -1.3, Y + 2.1, -1.3, .55, 24); k.dome(.55, C.roof, -1.3, Y + 2.3, -1.3, .5);
    k.block(1.5, 1.4, .8, C.glass, -.8, Y, .1, { win: { bay: .5, floor: .7 } }); piers(k, 1.5, .8, -.8, .1, Y, 1.4);
    for (const x of [-1.3, -.8, -.3]) k.block(.05, 1.4, .05, C.ivory, x, Y, .51, { r: 0 });
    k.block(1.5, .05, .05, C.ivory, -.8, Y + .75, .51, { r: 0 }); k.block(.7, .06, .4, pink, -.8, Y + .7, .7, { r: 0, bottom: true });
    k.prism(1.5, .4, .8, C.glass, -.8, Y + 1.4, .1, C.glass); k.box(.08, .08, .86, C.ivory, -.8, Y + 1.8, .1, { r: 0 });
    k.sign('OKTELL', -.8, Y + 1.75, -.22, 1.1, pink);
    // The tower: glass rings, three dishes up its side, a lattice top.
    const tx = 1.55, tz = -1.15, h = 3.7;
    k.post(.72, h, C.ivory, tx, Y, tz, .62, 28);
    for (let i = 0; i < 4; i++) k.post(.7 - i * .025, .22, C.glass, tx, Y + .5 + i * .85, tz, .7 - i * .025, 28, { win: { bay: .4, floor: .22 }, ribbon: true });
    k.post(.7, .1, pink, tx, Y + h, tz, .7, 28);
    k.dish(.42, tx - .2, Y + h * .45, tz + .75, .3, .2); k.dish(.36, tx + .6, Y + h * .65, tz + .45, .4, 1.0); k.dish(.32, tx - .65, Y + h * .82, tz + .4, .5, -.8);
    k.mast(.26, 1.1, tx, Y + h + .1, tz, C.red);
    trees(k, [.6, 2.3], .7, .75);
    return;
  }
  // A satellite centre: a great dish on its pedestal, the tower of dishes, an observatory, a long glass front.
  k.block(4.6, 1.15, 1.2, C.stone, -.1, Y, .45, { r: .05 }); k.block(4.64, .5, 1.24, C.glass, -.1, Y + .35, .45, { ribbon: true });
  k.block(4.72, .1, 1.32, C.ivory, -.1, Y + 1.15, .45); k.block(4.7, .07, 1.3, pink, -.1, Y + 1.08, .45, { r: 0 });
  k.sign('OKTELL', -.1, Y + .2, 1.07, 1.2, pink);
  k.dome(.55, C.steel, 1.55, Y + 1.25, .45, .55); k.rotated(1.55, Y + 1.7, .55, .9, 0, 0, () => k.box(.12, .4, .5, C.ink, 0, 0, 0, { r: 0 }));
  // The great dish.
  const dx = .9, dz = -1.4;
  k.post(.5, 2.1, C.concrete, dx, Y, dz, .38, 20);
  for (const sx of [-1, 1]) k.block(.14, .7, .5, C.ivory, dx + sx * .35, Y + 2.1, dz, { r: .02 });
  k.dish(1.55, dx, Y + 2.65, dz, .75, -.35);
  // The tower of dishes.
  const tx = -1.85, tz = -1.6, h = 4.4;
  k.post(.58, h, C.ivory, tx, Y, tz, .48, 24);
  for (let i = 0; i < 4; i++) k.post(.57 - i * .025, .2, C.glass, tx, Y + 1.4 + i * .75, tz, .57 - i * .025, 24, { win: { bay: .4, floor: .2 }, ribbon: true });
  k.post(.55, .1, pink, tx, Y + h, tz, .55, 24);
  k.dish(.38, tx + .45, Y + 2.6, tz + .5, .4, .6); k.dish(.32, tx - .5, Y + 3.3, tz + .45, .5, -.7);
  k.mast(.24, 1.3, tx, Y + h + .1, tz, C.red);
  for (const x of [-2.3, 2.3]) k.ball(.25, C.leaf, x, Y + .35, 1.35, 10);
};

const scenarios: Model = (k, level) => {
  const blue = ACCENT.scenarios;
  if (level === 1) {
    // An open-air stage: a platform under a striped awning, a red backdrop, benches for the audience, a ticket booth.
    k.block(2.4, .32, 1.4, C.wood, -.4, Y, -1.15);
    k.block(2.2, 1.15, .06, C.red, -.4, Y + .32, -1.8, { r: 0 });
    for (const sx of [-1, 1]) for (const z of [-1.8, -.5]) k.block(.07, 1.45, .07, C.ink, -.4 + sx * 1.17, Y, z, { r: 0 });
    for (let i = 0; i < 6; i++) k.block(.42, .06, 1.6, i % 2 ? C.ivory : blue, -.4 - 1.05 + i * .42, Y + 1.45, -1.15, { r: 0, bottom: true });
    for (let i = 0; i < 6; i++) k.block(.42, .18, .03, i % 2 ? C.ivory : blue, -.4 - 1.05 + i * .42, Y + 1.3, -.34, { r: 0 });
    k.sign('SCENARIOS', -.4, Y + 1.66, -.3, 1.1, blue);
    for (const z of [.15, .65]) for (const x of [-1.0, .2]) k.bench(x, z, Math.PI);
    k.block(.75, 1.0, .65, C.ivory, 1.75, Y, -.6, { r: .04 }); k.panes('front', -.27, Y + .45, [1.75], .4, .3);
    for (let i = 0; i < 3; i++) k.block(.27, .05, .8, i % 2 ? C.ivory : blue, 1.48 + i * .27, Y + 1.0, -.6, { r: 0 });
    trees(k, [2.1, -2.2], -1.9, .8);
    return;
  }
  if (level === 2) {
    // A studio: a dark box with a great sliding door, a marquee of bulbs over the entrance, posters, spotlights.
    k.block(3.3, 1.75, 1.9, C.white, -.1, Y, -1.15, { r: .04 }); k.block(3.4, .1, 2.0, C.slate, -.1, Y + 1.75, -1.15);
    k.block(3.32, .12, 1.92, blue, -.1, Y + 1.5, -1.15, { r: 0 });
    k.block(1.35, 1.35, .05, C.ink, -.95, Y, -.18, { r: 0 }); for (let i = 1; i < 4; i++) k.block(.03, 1.35, .03, C.steel, -.95 - .675 + i * .34, Y, -.15, { r: 0 });
    k.block(1.5, .05, .06, C.steel, -.95, Y + 1.38, -.16, { r: 0 });
    k.block(.6, 1.0, .05, C.glass, .9, Y, -.17, { win: { bay: .3, floor: 1.0 } });
    k.block(1.3, .14, .65, C.gold, .9, Y + 1.12, .12, { r: 0, bottom: true }); bulbs(k, .3, 1.5, Y + 1.1, .46, 9);
    k.sign('SCENARIOS', .9, Y + 1.4, .45, 1.15, C.ink);
    for (const x of [-.05, 1.75]) { k.block(.48, .66, .03, blue, x, Y + .3, -.18, { r: 0 }); k.block(.38, .5, .02, C.ivory, x, Y + .38, -.16, { r: 0 }); }
    for (const x of [-1.4, .9]) k.rotated(x, Y + 2.0, -.6, .8, 0, 0, () => k.cone(.14, .3, C.ink, 0, -.15, 0, 10));
    trees(k, [-2.2, 2.2], .6, .8);
    return;
  }
  if (level === 3) {
    // A theatre: a portico with a marquee, the auditorium, the stage's fly tower behind, posters either side.
    k.block(3.3, 2.0, 1.7, C.stone, 0, Y, -1.2, { r: .06 }); k.block(3.4, .1, 1.8, C.ivory, 0, Y + 2.0, -1.2);
    k.block(3.32, .05, 1.72, C.trim, 0, Y + 1.0, -1.2, { r: 0 });
    k.block(1.7, 3.35, 1.0, C.slate, 0, Y, -1.85, { r: .04 }); k.block(1.8, .1, 1.1, C.ink, 0, Y + 3.35, -1.85);
    const top = portico(k, [-.9, -.3, .3, .9], 2.3, .8, -.05, Y, 1.75, 0);
    k.block(2.4, .35, .1, C.ivory, 0, top + .05, .33); k.sign('SCENARIOS', 0, top + .22, .39, 1.25);
    k.block(1.5, .1, .55, C.gold, 0, Y + 1.15, .45, { r: 0, bottom: true }); bulbs(k, -.7, .7, Y + 1.13, .73, 8);
    for (const x of [-.45, .45]) k.door(.5, .95, x, Y + .16, -.33, C.red);
    for (const sx of [-1, 1]) { k.block(.5, .75, .03, blue, sx * 1.42, Y + .45, -.34, { r: 0 }); k.block(.4, .6, .02, C.ivory, sx * 1.42, Y + .52, -.32, { r: 0 }); }
    for (const sx of [-1, 1]) k.panes(sx < 0 ? 'left' : 'right', sx * 1.65, Y + 1.2, [-1.7, -1.0], .3, .55);
    trees(k, [-2.2, 2.2], .5, .8);
    return;
  }
  if (level === 4) {
    // A film studio: two vaulted sound stages, an office in front, a water tower with the studio's band.
    for (const [x, n] of [[-1.7, 1], [-.1, 2]] as const) {
      k.block(1.5, 1.1, 2.6, C.concrete, x, Y, -1.1); k.vault(.75, 2.6, C.slate, x, Y + 1.1, -1.1, C.concrete);
      k.block(.95, .9, .05, C.ink, x, Y, .2, { r: 0 });
      k.block(.5, .5, .04, blue, x, Y + 1.25, .21, { r: 0 });
      for (let i = 0; i < n; i++) k.block(.08, .32, .03, C.ivory, x - (n - 1) * .07 + i * .14, Y + 1.34, .24, { r: 0 });
    }
    k.block(1.55, 1.6, 1.3, C.ivory, 1.85, Y, -.05, { r: .04 }); k.block(1.62, .08, 1.37, C.ink, 1.85, Y + 1.6, -.05);
    for (const y of [Y + .3, Y + .95]) k.panes('front', .6, y, [1.55, 2.15], .38, .42);
    for (const y of [Y + .3, Y + .95]) k.panes('right', 2.625, y, [-.4, .3], .38, .42);
    k.sign('SCENARIOS', 1.85, Y + 1.42, .62, 1.3, blue);
    // The water tower.
    const wx = 1.85, wz = -1.75, legs = 2.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rod([wx + sx * .55, Y, wz + sz * .5], [wx + sx * .4, Y + legs, wz + sz * .38], .07, C.wood);
    for (const y of [Y + .9, Y + 1.8]) { k.block(.95, .04, .04, C.wood, wx, y, wz - .44, { r: 0 }); k.block(.95, .04, .04, C.wood, wx, y, wz + .44, { r: 0 }); }
    k.post(.58, .85, C.wood, wx, Y + legs, wz, .58, 20); k.post(.6, .2, blue, wx, Y + legs + .32, wz, .6, 20);
    k.cone(.66, .4, C.slate, wx, Y + legs + .85, wz, 20);
    trees(k, [-2.3, .9], .9, .75);
    return;
  }
  // A grand theatre: eight columns under an attic with a gilded quadriga, a dome, the fly tower, two wings.
  k.block(3.6, 2.5, 1.7, C.stone, 0, Y, -1.25, { r: .06 }); k.block(3.7, .1, 1.8, C.ivory, 0, Y + 2.5, -1.25);
  k.block(2.0, 3.5, .8, C.slate, 0, Y, -2.05, { r: .04 }); k.block(2.1, .1, .9, C.ink, 0, Y + 3.5, -2.05);
  for (const sx of [-1, 1]) {
    k.block(.85, 2.0, 1.9, C.stone, sx * 2.3, Y, -1.05, { r: .05 }); k.block(.93, .08, 1.98, C.ivory, sx * 2.3, Y + 2.0, -1.05);
    k.pyramid(.93, 1.98, .3, C.roof, sx * 2.3, Y + 2.08, -1.05);
    for (const y of [Y + .35, Y + 1.2]) k.panes('front', -.1, y, [sx * 2.3], .38, .55);
    for (const y of [Y + .35, Y + 1.2]) k.panes(sx < 0 ? 'left' : 'right', sx * 2.725, y, [-1.6, -.6], .38, .55);
  }
  const top = portico(k, [-1.58, -1.13, -.68, -.23, .23, .68, 1.13, 1.58], 3.6, .9, -.05, Y, 2.2, 0);
  k.block(3.4, .45, .5, C.ivory, 0, top + .05, -.1);
  k.sign('SCENARIOS', 0, top + .27, .16, 1.4);
  // The quadriga: a plinth, four gilded horses and the chariot.
  k.block(1.0, .18, .4, C.stone, 0, top + .5, -.15, { r: .02 });
  for (let i = 0; i < 4; i++) { k.box(.12, .26, .32, C.gold, -.27 + i * .18, top + .81, -.08, { r: .03 }); k.box(.08, .12, .1, C.gold, -.27 + i * .18, top + .96, .08, { r: .02 }); }
  k.box(.5, .22, .18, C.gold, 0, top + .79, -.3, { r: .04 });
  // The dome over the auditorium.
  k.post(1.0, .5, C.ivory, 0, Y + 2.6, -1.3, 1.0, 32);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; k.block(.06, .42, .06, C.stone, Math.sin(a) * 1.02, Y + 2.64, -1.3 + Math.cos(a) * 1.02, { r: 0 }); }
  k.dome(1.02, C.roof, 0, Y + 3.1, -1.3, .95);
  k.post(.18, .3, C.ivory, 0, Y + 4.0, -1.3, .18, 12); k.ball(.13, C.gold, 0, Y + 4.42, -1.3, 10);
  for (const sx of [-1, 1]) k.flag(sx * 1.6, -.15, .9, blue, top + .5);
  k.block(1.8, .1, .5, C.gold, 0, Y + 1.25, .58, { r: 0, bottom: true }); bulbs(k, -.85, .85, Y + 1.23, .84, 10);
  for (const x of [-.6, .6]) k.door(.45, .95, x, Y + .16, -.38, C.red);
};

/** A speech bubble w × h facing the front at (x, y, z): a rounded slab, its tail below to the left, three dots. */
function bubble(k: Kit, x: number, y: number, z: number, w: number, h: number, c: string, dots: string = C.ivory) {
  k.box(w, h, .2, c, x, y, z, { r: Math.min(.12, h / 3) });
  const tx = x - w * .24, ty = y - h / 2 - h * .36 + h * .21;
  k.rotated(tx, ty, z, 0, 0, Math.PI + .45, () => k.cone(h * .2, h * .42, c, 0, -h * .21, 0, 6));
  for (const i of [-1, 0, 1]) k.ball(h * .1, dots, x + i * h * .3, y, z + .1, 8);
}
/** A studio microphone on y0, s its size: a foot, a stand, the ring of its shock mount, a capsule with grille rings. */
function microphone(k: Kit, x: number, y0: number, z: number, s: number, c: string) {
  k.post(.3 * s, .08 * s, C.ink, x, y0, z, .32 * s, 16);
  k.post(.05 * s, 1.1 * s, C.steel, x, y0 + .08 * s, z, .05 * s, 8);
  const mid = y0 + 1.6 * s;
  k.post(.2 * s, .08 * s, c, x, y0 + 1.16 * s, z, .2 * s, 16);
  k.torus(.36 * s, .035 * s, C.ink, x, mid, z, { front: true, seg: 24 });
  k.ball(.26 * s, C.white, x, mid, z, 16, .26 * s * 1.45);
  for (const [dy, r] of [[-.2, .235], [0, .265], [.2, .235]] as const) k.torus(r * s, .022 * s, C.ink, x, mid + dy * s, z, { seg: 24 });
  k.ball(.06 * s, c, x, mid + .4 * s, z, 8);
}

const voice: Model = (k, level) => {
  const green = ACCENT.voice;
  if (level === 1) {
    // A talking pavilion: a round kiosk under a green roof, a speech bubble on a pole, two benches facing each other.
    k.post(.95, 1.15, C.stone, -.7, Y, -1.0, .95, 24); k.post(.97, .5, C.glass, -.7, Y + .35, -1.0, .97, 24, { win: { bay: .45, floor: .5 }, ribbon: true });
    k.post(1.12, .12, green, -.7, Y + 1.15, -1.0, 1.12, 24); k.dome(.45, C.ivory, -.7, Y + 1.27, -1.0, .28);
    k.door(.45, .85, -.7, Y, -.04, C.slate);
    k.sign('РАЗГОВОР', -.7, Y + 1.5, -.35, 1.1, green);
    k.post(.04, 1.55, C.ink, 1.45, Y, -.9, .04, 8);
    bubble(k, 1.6, Y + 1.95, -.9, 1.0, .62, green);
    k.bench(.95, .75, Math.PI / 2); k.bench(2.05, .75, -Math.PI / 2);
    trees(k, [-2.2, 2.2], -1.95, .8);
    return;
  }
  if (level === 2) {
    // A recording studio: a white box with a round window and a red «ON AIR» lamp, a giant microphone on the roof.
    k.block(3.1, 1.6, 1.9, C.white, -.2, Y, -1.1, { r: .04 }); k.block(3.2, .1, 2.0, C.slate, -.2, Y + 1.6, -1.1);
    k.block(3.12, .12, 1.92, green, -.2, Y + 1.35, -1.1, { r: 0 });
    k.disc(.45, .06, C.glass, -1.05, Y + .78, -.13, 24);
    k.torus(.46, .06, green, -1.05, Y + .78, -.1, { front: true, seg: 28 });
    k.door(.7, 1.05, .55, Y, -.13); k.block(.9, .08, .5, green, .55, Y + 1.05, .05, { r: 0, bottom: true });
    k.sign('ON AIR', .55, Y + 1.24, -.1, .75, C.red);
    k.panes('front', -.12, Y + .45, [1.25], .35, .6);
    k.panes('right', 1.35, Y + .45, [-1.6, -.7], .35, .6);
    microphone(k, -.6, Y + 1.7, -1.3, .85, green);
    bubble(k, 1.95, Y + .95, .55, .8, .5, C.ivory, green);
    trees(k, [-2.25, 2.25], -2.0, .8);
    return;
  }
  if (level === 3) {
    // A house of talk: two storeys of ribbon windows, a glass lobby under a green canopy, a speech bubble on the roof.
    k.block(3.6, 2.4, 1.9, C.stone, 0, Y, -1.2, { r: .05 });
    for (const y of [Y + .3, Y + 1.3]) k.block(3.64, .62, 1.94, C.glass, 0, y, -1.2, { ribbon: true });
    k.block(3.72, .1, 2.02, C.ivory, 0, Y + 2.4, -1.2);
    k.block(1.6, 1.25, .75, C.glass, 0, Y, .1, { win: { bay: .4, floor: 1.25 } }); piers(k, 1.6, .75, 0, .1, Y, 1.25);
    k.block(1.8, .1, .95, green, 0, Y + 1.25, .15, { r: 0, bottom: true });
    k.sign('РАЗГОВОР', 0, Y + 1.04, .49, 1.15, green);
    k.sign('ON AIR', 1.25, Y + 2.15, -.24, .7, C.red);
    k.block(.14, .7, .14, C.ink, -.2, Y + 2.5, -1.3, { r: 0 });
    bubble(k, -.2, Y + 3.55, -1.3, 2.0, 1.05, green);
    for (const sx of [-1, 1]) k.bench(sx * 1.75, .65, Math.PI);
    trees(k, [-2.3, 2.3], -2.1, .8);
    return;
  }
  if (level === 4) {
    // A studio tower: a podcast hall with two bubbles on its front, a round glass tower crowned by a microphone.
    k.block(2.7, 1.9, 1.9, C.stone, -1.05, Y, -.9, { r: .05 });
    k.block(2.74, .7, 1.94, C.glass, -1.05, Y + .5, -.9, { ribbon: true });
    k.block(2.82, .1, 2.02, C.ivory, -1.05, Y + 1.9, -.9);
    k.door(.7, 1.0, -1.05, Y, .08); k.block(1.0, .08, .5, green, -1.05, Y + 1.0, .25, { r: 0, bottom: true });
    k.sign('РАЗГОВОР', -1.05, Y + 1.55, .07, 1.2, green);
    bubble(k, -1.85, Y + 2.45, -.3, .8, .5, green); bubble(k, -.4, Y + 2.65, -.3, .8, .5, C.ivory, green);
    const tx = 1.45, tz = -1.05, h = 3.6;
    k.post(.8, h, C.ivory, tx, Y, tz, .72, 28);
    for (let i = 0; i < 4; i++) k.post(.79 - i * .02, .45, C.glass, tx, Y + .45 + i * .78, tz, .79 - i * .02, 28, { win: { bay: .45, floor: .45 }, ribbon: true });
    k.post(.76, .12, green, tx, Y + h, tz, .76, 28);
    k.sign('ON AIR', tx, Y + .3, tz + .82, .7, C.red);
    microphone(k, tx, Y + h + .12, tz, 1.0, green);
    trees(k, [.35, 2.45], .85, .75);
    return;
  }
  // A palace of talk: a long glass hall, a tower of glass floors under a great microphone, two bubbles in dialogue.
  k.block(4.6, 1.3, 1.25, C.stone, 0, Y, .35, { r: .05 }); k.block(4.64, .62, 1.29, C.glass, 0, Y + .38, .35, { ribbon: true });
  k.block(4.72, .1, 1.37, C.ivory, 0, Y + 1.3, .35); k.block(4.7, .08, 1.35, green, 0, Y + 1.22, .35, { r: 0 });
  k.sign('РАЗГОВОР', 0, Y + .22, 1.0, 1.3, green);
  const top = glassFloors(k, 2.0, 1.8, 0, -1.35, Y, 5, .82, C.ivory, 5);
  piers(k, 2.0, 1.8, 0, -1.35, Y, 5 * .82);
  k.block(2.1, .14, 1.9, green, 0, top, -1.35, { r: 0 });
  k.sign('ON AIR', 0, top - .5, -.43, .8, C.red);
  microphone(k, 0, top + .14, -1.35, 1.25, green);
  for (const sx of [-1, 1]) {
    k.post(.045, 2.2, C.ink, sx * 2.15, Y + 1.4, .0, .045, 8);
    bubble(k, sx * 1.95, Y + 3.95, .0, 1.05, .62, sx < 0 ? green : C.ivory, sx < 0 ? C.ivory : green);
    k.flag(sx * 2.45, -1.9, 1.3, green);
  }
  for (const x of [-2.3, 2.3]) k.ball(.25, C.leaf, x, Y + .35, 1.35, 10);
};

/** Every district's five levels, drawn on a plinth by assets/landmarks.ts. */
export const LANDMARK_MODELS: Record<DistrictId, Model> = { academy, driver, crm, dispatch, oktell, scenarios, voice };
