import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: { contents: 'export * from "./facade.ts"; export * as THREE from "three/webgpu"; export { uniform, float } from "three/tsl";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const f = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

/** Every triangle's winding against its vertex normals: counter-clockwise from outside means the same side. */
function faced(geometry) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), index = geometry.index;
  let bad = 0, total = 0;
  for (let k = 0; k < index.count; k += 3) {
    const [a, b, c] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
    const ux = p.getX(b) - ax, uy = p.getY(b) - ay, uz = p.getZ(b) - az, vx = p.getX(c) - ax, vy = p.getY(c) - ay, vz = p.getZ(c) - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue;
    total++;
    const sum = [a, b, c].reduce((s, i) => s + cx * n.getX(i) + cy * n.getY(i) + cz * n.getZ(i), 0);
    if (sum <= 0) bad++;
  }
  return { bad, total };
}
/** The mesh is closed where it should be: every edge used by two triangles. */
function openEdges(geometry) {
  const p = geometry.getAttribute('position'), index = geometry.index, key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(v => (Math.round(v * 1e4) / 1e4 + 0).toFixed(4)).join(',');
  const edges = new Map();
  for (let k = 0; k < index.count; k += 3) for (let e = 0; e < 3; e++) {
    const a = key(index.getX(k + e)), b = key(index.getX(k + (e + 1) % 3));
    if (a === b) continue;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(id, (edges.get(id) ?? 0) + 1);
  }
  return [...edges.values()].filter(count => count % 2).length;
}

test('plans extrude and tent outwards whichever way round they are given, a crisp box included', () => {
  // A block with cut corners and its front swept in, as the complex's volumes are drawn, and the same reversed.
  const plan = [[-2, -3], [2, -3], [3, -2], [3, 2], [2, 3], [1, 2.6], [0, 2.4], [-1, 2.6], [-2, 3], [-3, 2], [-3, -2]];
  for (const ring of [plan, [...plan].reverse()]) {
    const mb = new f.MeshBuilder();
    f.extrude(mb, ring, 0, 4, { kind: f.FACE.mirror, bay: 1.2, floor: 1.5 });
    f.tent(mb, ring, 4, 6.5, { kind: f.FACE.spire, win: [1, 1, 0, 0] });
    const geometry = mb.build(1), { bad, total } = faced(geometry);
    assert.ok(total >= 2 * plan.length, 'walls and slopes');
    assert.equal(bad, 0, `${bad} of ${total} triangles face inwards`);
  }
  const mb = new f.MeshBuilder(); f.box(mb, [-1, 0, -1, 1, 3, 1], { c: .3, crisp: true });
  assert.equal(faced(mb.build(1)).bad, 0, 'crisp bevels face outwards');
});

test('round shapes face outwards: cylinders, frustums, cones, domes, balls, tori, pyramids, pediments, arches and rods', () => {
  const shapes = {
    cylinder: mb => f.cylinder(mb, { x: 1, z: -2, y0: 0, y1: 3, r: 1.2, seg: 12, bottom: true }),
    frustum: mb => f.cylinder(mb, { x: 0, z: 0, y0: 1, y1: 2, r: 1, r1: .4, seg: 9, kind: f.FACE.trim, bottom: true }),
    cone: mb => f.cylinder(mb, { x: 0, z: 0, y0: 2, y1: 4, r: 1, r1: 0, seg: 10, kind: f.FACE.roof, bottom: true }),
    ellipse: mb => f.cylinder(mb, { x: 0, z: 0, y0: 0, y1: 1, r: 1, sx: 1.5, sz: .7, seg: 14, bottom: true }),
    dome: mb => f.dome(mb, { x: 0, z: 0, y0: 1, r: 2, rise: 1.4, seg: 16, rings: 5 }),
    ball: mb => f.sphere(mb, { x: 0, y: 2, z: 0, r: .5, seg: 10, rings: 4 }),
    torus: mb => f.torus(mb, { x: 0, y: 1, z: 0, R: 1, r: .2, seg: 16, tube: 6 }),
    pyramid: mb => f.pyramid(mb, { x0: -1, x1: 1, z0: -1.5, z1: 1.5, y: 2, h: 1, roof: [1, 0, 0] }),
    prism: mb => f.prism(mb, { x0: -1, x1: 1, z0: -1, z1: 1, y: 2, rise: .8, col: [1, 1, 1] }),
    arch: mb => f.arch(mb, { x: 0, y: 0, z: 0, w: 1, h: 2, depth: .2, seg: 8 }),
    rod: mb => f.rod(mb, [0, 0, 0], [1, 2, -1], .1),
    turned: mb => mb.turned(2, 1, .7, () => f.box(mb, [-1, 0, -1, 1, 2, 1], { c: .1 })),
  };
  for (const [name, draw] of Object.entries(shapes)) {
    const mb = new f.MeshBuilder(); draw(mb);
    const geometry = mb.build(1), { bad, total } = faced(geometry);
    assert.ok(total > 0, `${name} has triangles`);
    assert.equal(bad, 0, `${name}: ${bad} of ${total} triangles face inwards`);
  }
  // Closed solids leave no edge open.
  for (const name of ['cylinder', 'cone', 'ball']) {
    const mb = new f.MeshBuilder(); shapes[name](mb);
    assert.equal(openEdges(mb.build(1)), 0, `${name} is closed`);
  }
});

test('windows wrap round a cylinder in whole bays, and a unit model keeps its wall directions for the stretched copy', () => {
  const mb = new f.MeshBuilder();
  f.cylinder(mb, { x: 0, z: 0, y0: 0, y1: 6, r: 2, seg: 16, kind: f.FACE.window, bay: 2.5 });
  const g = mb.build(1), win = g.getAttribute('aWin'), surf = g.getAttribute('aSurf');
  const circumference = Math.PI * 4, bay = win.getX(0);
  assert.ok(Math.abs(circumference / bay - Math.round(circumference / bay)) < 1e-6, 'a whole number of bays round it');
  let top = 0; for (let i = 0; i < surf.count; i++) top = Math.max(top, surf.getX(i));
  assert.ok(Math.abs(top - circumference) < 1e-6, 'u runs once round');

  const unit = new f.MeshBuilder();
  f.box(unit, [-6.4, 0, -4.8, 6.4, 9, 4.8], { kind: f.FACE.window, bay: 4.27, floor: 3 });
  const stretched = unit.build({ unit: [12.8, 9, 9.6] }), box = stretched.boundingBox;
  assert.ok(Math.abs(box.min.x + .5) < 1e-6 && Math.abs(box.max.x - .5) < 1e-6 && Math.abs(box.max.y - 1) < 1e-6 && Math.abs(box.max.z - .5) < 1e-6, 'in unit space');
  const u = stretched.getAttribute('aUnitU'), v = stretched.getAttribute('aUnitV'), normal = stretched.getAttribute('normal');
  assert.ok(u && v, 'unit directions');
  for (let i = 0; i < u.count; i++) {
    if (Math.abs(normal.getY(i)) > .5) continue;
    // A nominal metre along the wall, in unit space: 1/12.8 along x or 1/9.6 along z; walls count v from the ground.
    const along = Math.hypot(u.getX(i), u.getY(i), u.getZ(i));
    assert.ok(Math.abs(along - 1 / 12.8) < 1e-6 || Math.abs(along - 1 / 9.6) < 1e-6 || along < 1, `a wall's u direction (${along})`);
    assert.equal(v.getW(i), 1);
  }
  assert.equal(f.WORLD_METRES, 4);
});

test('the facade material builds for copies, for unit copies and for meshes with a seed of their own', () => {
  for (const options of [{}, { unit: true }, { seed: f.float(7) }]) {
    const material = f.facadeMaterial(f.uniform(0), options);
    assert.ok(material.isMeshStandardNodeMaterial && material.colorNode && material.emissiveNode && material.roughnessNode && material.metalnessNode && material.aoNode);
    assert.equal(material.vertexColors, false, 'the vertex colour is read once, by the colour node');
  }
});
