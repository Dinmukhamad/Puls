import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_LOCATIONS, DISTRICT_ISLAND_HEIGHT, DISTRICT_ISLAND_OUTLINE, type Point } from './cityLayout';

/** Landscaped, individually raised plots around the five training landmarks.
 * Everything is static and batched by material; the scene owns the resulting GPU resources. */
export function createDistrictIslands(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'district-islands';
  const batches = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const floor = .2 + DISTRICT_ISLAND_HEIGHT;
  let transform = new THREE.Matrix4();

  function material(color: string) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .84 }));
    return materials.get(color)!;
  }
  function add(geometry: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, ry = 0) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    // Only positions and normals are needed for these untextured meshes.
    part.deleteAttribute('uv');
    part.applyMatrix4(transform.clone().multiply(local));
    const mat = material(color);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(part);
  }
  function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, ry = 0) {
    add(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry);
  }
  function cylinder(r: number, h: number, color: string, x: number, y: number, z: number, top = r) {
    add(new THREE.CylinderGeometry(top, r, h, 12), color, x, y, z);
  }
  function sphere(r: number, color: string, x: number, y: number, z: number, sy = 1) {
    const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, sy, 1); add(g, color, x, y, z);
  }
  function outline(scale: number, h: number, color: string, y: number) {
    const points = DISTRICT_ISLAND_OUTLINE.map(p => ({ x: p.x * scale, z: p.z * scale }));
    const toward = (p: Point, q: Point) => {
      const k = .24 / Math.hypot(q.x - p.x, q.z - p.z);
      return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k };
    };
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const a = toward(p, points[(i + points.length - 1) % points.length]);
      const b = toward(p, points[(i + 1) % points.length]);
      if (i === 0) shape.moveTo(a.x, -a.z); else shape.lineTo(a.x, -a.z);
      shape.quadraticCurveTo(p.x, -p.z, b.x, -b.z);
    });
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 3 });
    g.rotateX(-Math.PI / 2);
    add(g, color, 0, y);
  }
  function tree(x: number, z: number, accent: string) {
    cylinder(.65, .16, '#d5c6a9', x, floor + .13, z);
    cylinder(.52, .05, '#70865a', x, floor + .23, z);
    cylinder(.09, 1.25, '#846247', x, floor + .77, z, .065);
    sphere(.68, '#577b48', x, floor + 1.53, z, 1.18);
    sphere(.5, '#8da860', x - .18, floor + 1.91, z - .12);
    for (const [dx, dz] of [[-.3, .23], [.26, .26], [.3, -.21]]) sphere(.1, accent, x + dx, floor + .3, z + dz, .65);
  }
  function bench(x: number, z: number) {
    for (const side of [-1, 1]) {
      box(.09, .38, .38, '#3e5153', x + side * .46, floor + .26, z);
      box(.08, .65, .08, '#3e5153', x + side * .46, floor + .48, z - .17);
    }
    for (const dz of [-.12, .02, .16]) box(1.18, .07, .1, '#ab7f50', x, floor + .47, z + dz);
    for (const y of [.67, .81]) box(1.18, .09, .08, '#ab7f50', x, floor + y, z - .17);
  }

  CITY_LOCATIONS.forEach(d => {
    transform = new THREE.Matrix4().compose(new THREE.Vector3(d.x, 0, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-d.x, -d.z)), new THREE.Vector3(1, 1, 1));
    // The masonry edge makes each landmark a separate island without hiding the streets in water.
    outline(1, DISTRICT_ISLAND_HEIGHT, '#a8a18a', .2);
    outline(1.001, .05, d.color, floor - .14);
    outline(1, .065, '#e2d8be', floor);
    outline(.973, .025, '#90ad73', floor + .065);
    // A paved entrance, two low steps and individual paving joints connect to the plaza spoke.
    box(2.35, .055, 2.58, '#c9bb9e', 0, floor + .12, 6.57);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) {
      box(.71, .025, .39, (row + col) % 3 ? '#eee2c9' : '#e0d1b4', (col - 1) * .76, floor + .161, 5.54 + row * .43);
    }
    box(2.36, .16, .42, '#ddd0b3', 0, floor + .11, 7.8);
    for (let step = 0; step < 3; step++) {
      const height = .16 + step * .18;
      box(2.36, height, .28, step % 2 ? '#ddd0b3' : '#cdbd9e', 0, .2 + height / 2, 8.69 - step * .26);
    }
    for (const side of [-1, 1]) {
      tree(side * 2.85, 6.75, d.color);
      bench(side * 4.5, 5.84);
      // Slim clipped hedges fit between the architecture's existing plinth and the stone boundary.
      for (let i = 0; i < 7; i++) sphere(.21, i % 2 ? '#6c934d' : '#527849', side * 6.02, floor + .26, -4.75 + i * 1.37, 1.05);
      for (let i = 0; i < 5; i++) sphere(.2, '#60874d', side * (.6 + i * 1.08), floor + .27, -5.55, .85);
      cylinder(.045, .74, '#3e5153', side * 1.55, floor + .46, 7.26);
      cylinder(.095, .1, '#ffe5aa', side * 1.55, floor + .86, 7.26);
    }
    // Fine masonry joints remain visible in the retaining wall as the view rotates.
    for (let i = 0; i < 10; i++) box(.018, .29, .018, '#8c8978', -5.72 + i * 1.27, floor - .245, -5.905);
  });

  for (const [mat, parts] of batches) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!geometry) { mat.dispose(); continue; }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  root.userData.districtCount = CITY_LOCATIONS.length;
  return root;
}
