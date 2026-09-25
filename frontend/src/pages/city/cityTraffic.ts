import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * A small city taxi, facing +Z, with its wheels resting at Y=0. At CAR_SCALE=.5
 * it is 0.88 units wide (including mirrors), 1.59 long and 0.80 high. This fits
 * the existing one-unit lanes. Four merged meshes give four instanced draw
 * calls for the entire fleet; there are no textures or per-car lights.
 */
export function createTaxiModel(): THREE.Group {
  const taxi = new THREE.Group();
  taxi.name = "pulse-taxi";
  const paint = new THREE.MeshStandardMaterial({ color: "#ffc52b", roughness: .36, metalness: .18 });
  const glass = new THREE.MeshStandardMaterial({ color: "#315b72", roughness: .18, metalness: .42 });
  const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: .12 });
  const lights = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: "#ffffff", emissiveIntensity: .16, roughness: .3 });
  const parts = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  const black = "#263244", silver = "#b6c4ce", white = "#fff7dc";

  function add(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, x = 0, y = 0, z = 0, rotation?: THREE.Quaternion, color?: string) {
    if (rotation) geometry.applyQuaternion(rotation);
    geometry.translate(x, y, z);
    // A shared set of attributes lets tiny details merge into the same part.
    geometry.deleteAttribute("uv");
    if (color) {
      const c = new THREE.Color(color), values = new Float32Array(geometry.getAttribute("position").count * 3);
      for (let i = 0; i < values.length; i += 3) values.set([c.r, c.g, c.b], i);
      geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    }
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material)!.push(geometry);
  }
  function box(w: number, h: number, d: number, material: THREE.MeshStandardMaterial, x: number, y: number, z: number, color?: string) {
    add(new THREE.BoxGeometry(w, h, d), material, x, y, z, undefined, color);
  }
  function bevelBox(w: number, h: number, d: number, bevel: number, material: THREE.MeshStandardMaterial, x: number, y: number, z: number, color?: string) {
    const shape = new THREE.Shape(), a = w / 2 - bevel, b = h / 2 - bevel;
    shape.moveTo(-a, -b); shape.lineTo(a, -b); shape.lineTo(a, b); shape.lineTo(-a, b); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    geometry.translate(0, 0, -d / 2 + bevel);
    add(geometry, material, x, y, z, undefined, color);
  }
  function beam(a: [number, number, number], b: [number, number, number], width: number, material: THREE.MeshStandardMaterial, color?: string) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start), center = start.add(end).multiplyScalar(.5);
    add(new THREE.BoxGeometry(width, direction.length(), width), material, center.x, center.y, center.z, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()), color);
  }

  // A bevelled body, a low bonnet and a separate boot make the silhouette read
  // as a passenger car even from the distant, elevated city camera.
  bevelBox(1.54, .49, 3.1, .075, paint, 0, .56, 0);
  bevelBox(1.4, .17, .93, .045, paint, 0, .83, 1.05);
  bevelBox(1.39, .16, .57, .04, paint, 0, .85, -1.23);
  box(1.35, .09, 2.7, trim, 0, .29, 0, black);

  const cabin = new THREE.BoxGeometry(1, 1, 1), positions = cabin.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const top = positions.getY(i) > 0, front = positions.getZ(i) > 0;
    positions.setXYZ(i, positions.getX(i) * (top ? 1.08 : 1.36), top ? 1.35 : .8, top ? (front ? .34 : -.61) : (front ? .72 : -1.03));
  }
  cabin.computeVertexNormals(); add(cabin, glass);
  bevelBox(1.14, .09, 1.05, .025, paint, 0, 1.38, -.135);
  for (const side of [-1, 1]) {
    beam([side * .68, .81, .73], [side * .55, 1.37, .34], .065, paint);
    beam([side * .68, .81, -1.03], [side * .55, 1.37, -.61], .075, paint);
    beam([side * .689, .82, -.14], [side * .557, 1.35, -.14], .046, trim, black);
    box(.026, .06, 1.72, trim, side * .695, .83, -.15, black);
    box(.035, .025, .16, trim, side * .781, .73, .37, silver);
    box(.035, .025, .16, trim, side * .781, .73, -.59, silver);
    bevelBox(.19, .105, .19, .023, paint, side * .785, .91, .61);

    // Two rows of raised, alternating chequers need no image or font loading.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 8; col++) {
      box(.017, .087, .13, trim, side * .773, .55 + row * .087, -.72 + col * .13, (row + col) % 2 ? black : white);
    }
  }

  const axle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  for (const side of [-1, 1]) for (const z of [-.99, .99]) {
    add(new THREE.CylinderGeometry(.285, .285, .17, 16), trim, side * .72, .285, z, axle, black);
    add(new THREE.CylinderGeometry(.166, .166, .014, 10), trim, side * .812, .285, z, axle, silver);
    add(new THREE.CylinderGeometry(.07, .07, .02, 8), trim, side * .823, .285, z, axle, black);
  }

  // Front grille, paired headlights, red rear lamps and small licence plates.
  bevelBox(.68, .135, .04, .01, trim, 0, .48, 1.558, black);
  box(.46, .02, .025, trim, 0, .485, 1.583, silver);
  box(.4, .09, .023, trim, 0, .355, 1.553, white);
  box(.4, .09, .023, trim, 0, .4, -1.554, white);
  for (const side of [-1, 1]) {
    bevelBox(.37, .15, .053, .02, lights, side * .52, .68, 1.53, "#fff6c6");
    bevelBox(.32, .14, .054, .018, lights, side * .52, .65, -1.535, "#ef5e4c");
  }

  // The roof sign has actual geometric lettering, so it remains crisp and
  // works with the scene's existing model-parts merger without canvas assets.
  bevelBox(.66, .19, .27, .025, trim, 0, 1.505, -.13, white);
  box(.73, .035, .31, trim, 0, 1.423, -.13, black);
  const strokes: [number, number, number, number][] = [
    [-.264, .051, -.164, .051], [-.214, .051, -.214, -.054], // T
    [-.125, -.054, -.087, .051], [-.087, .051, -.049, -.054], [-.11, -.016, -.065, -.016], // A
    [0, -.054, .08, .051], [0, .051, .08, -.054], // X
    [.145, .051, .221, .051], [.183, .051, .183, -.054], [.145, -.054, .221, -.054], // I
  ];
  for (const side of [-1, 1]) for (const [ax, ay, bx, by] of strokes) {
    beam([ax * side, 1.505 + ay, -.13 + side * .137], [bx * side, 1.505 + by, -.13 + side * .137], .018, trim, black);
  }

  parts.forEach((geometries, material) => {
    // Extrusions have non-indexed vertices; normalize the other primitives.
    const normalized = geometries.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(normalized)!;
    normalized.forEach((g, i) => { g.dispose(); if (g !== geometries[i]) geometries[i].dispose(); });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material === paint ? "taxi-body" : material === glass ? "taxi-windows" : material === lights ? "taxi-lights" : "taxi-details";
    mesh.castShadow = true; mesh.receiveShadow = true; taxi.add(mesh);
  });
  return taxi;
}
