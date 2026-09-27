import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * A small city taxi, facing +Z, with its wheels resting at Y=0. At scale=.5
 * it is 0.88 units wide (including mirrors), 1.59 long and 0.80 high. This fits
 * the existing one-unit lanes. Four merged meshes give four instanced draw
 * calls for the entire fleet; there are no textures or per-car lights.
 */
function createTaxiPrototype(): THREE.Group {
  const taxi = new THREE.Group();
  taxi.name = "pulse-taxi";
  const paint = new THREE.MeshStandardNodeMaterial({ color: "#ffc52b", roughness: .36, metalness: .18 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: "#315b72", roughness: .18, metalness: .42 });
  const trim = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .62, metalness: .12 });
  const lights = new THREE.MeshStandardNodeMaterial({ vertexColors: true, emissive: "#ffffff", emissiveIntensity: .16, roughness: .3 });
  const parts = new Map<THREE.MeshStandardNodeMaterial, THREE.BufferGeometry[]>();
  const black = "#263244", silver = "#b6c4ce", white = "#fff7dc";

  function add(geometry: THREE.BufferGeometry, material: THREE.MeshStandardNodeMaterial, x = 0, y = 0, z = 0, rotation?: THREE.Quaternion, color?: string) {
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
  function box(w: number, h: number, d: number, material: THREE.MeshStandardNodeMaterial, x: number, y: number, z: number, color?: string) {
    add(new THREE.BoxGeometry(w, h, d), material, x, y, z, undefined, color);
  }
  function bevelBox(w: number, h: number, d: number, bevel: number, material: THREE.MeshStandardNodeMaterial, x: number, y: number, z: number, color?: string) {
    const shape = new THREE.Shape(), a = w / 2 - bevel, b = h / 2 - bevel;
    shape.moveTo(-a, -b); shape.lineTo(a, -b); shape.lineTo(a, b); shape.lineTo(-a, b); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    geometry.translate(0, 0, -d / 2 + bevel);
    add(geometry, material, x, y, z, undefined, color);
  }
  function beam(a: [number, number, number], b: [number, number, number], width: number, material: THREE.MeshStandardNodeMaterial, color?: string) {
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

const TAXI_COUNT = 10;
const TAXI_RADIUS = 13.8;
const TAXI_SCALE = .82;
const TAXI_SPEED = 2.25;
const WALKER_COUNT = 18;
const WALKER_RADIUS = 10.4;
const WALKER_SPEED = .62;
const ROAD_Y = .11;
const PROMENADE_Y = .083;
const TAU = Math.PI * 2;

/**
 * Life for the first City V3 island. All transforms are analytic functions of
 * the caller's simulation time: freezing time freezes limbs and traffic too.
 *
 * This pilot deliberately uses a small CPU-driven, instanced population, not
 * the final GPU crowd from the city brief. Standard instance matrices also
 * drive the shadow pass on both WebGPU and its WebGL2 fallback; there is no
 * second animation clock or displaced-vertex shadow mismatch.
 */
export function createLife(): {
  group: THREE.Group;
  update(timeSeconds: number): void;
  setNight(night: boolean): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = 'city-v3-life';
  group.userData.population = { taxis: TAXI_COUNT, pedestrians: WALKER_COUNT };
  group.userData.animation = 'CPU instance matrices; caller-owned simulation clock';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const batches: THREE.InstancedMesh[] = [];
  const root = new THREE.Object3D();
  const local = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let disposed = false;

  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances circle the island; avoid stale bounds from their initial
    // positions without recomputing a fleet AABB on every frame.
    mesh.frustumCulled = false;
    group.add(mesh);
    geometries.add(geometry);
    materials.add(material);
    batches.push(mesh);
    return mesh;
  }

  const taxiPrototype = createTaxiPrototype();
  const taxis = taxiPrototype.children.map(part => {
    const mesh = part as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
    return batch(`${mesh.name}-fleet`, mesh.geometry, mesh.material, TAXI_COUNT);
  });
  const taxiLights = (taxiPrototype.children.find(part => part.name === 'taxi-lights') as THREE.Mesh).material as THREE.MeshStandardNodeMaterial;
  // Geometries and materials now belong to the fleet; discard the empty
  // prototype graph without disposing their shared resources.
  taxiPrototype.clear();

  const shirtMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .88 });
  const skinMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .9 });
  const trousersMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .94 });
  const hairMaterial = new THREE.MeshStandardNodeMaterial({ color: '#263143', roughness: .98 });
  const shoeMaterial = new THREE.MeshStandardNodeMaterial({ color: '#eef1e6', roughness: .8 });
  const shirts = ['#ef9270', '#5e91be', '#8a78c8', '#4eaa98', '#eec768', '#647cba'];
  const skinTones = ['#efbc96', '#bc845f', '#dfaa83', '#986849', '#f4c8a8', '#cd946e'];
  const trouserColors = ['#34445a', '#586270', '#5b4e49', '#293d50'];

  function joined(parts: THREE.BufferGeometry[]) {
    const normalized = parts.map(geometry => {
      geometry.deleteAttribute('uv');
      return geometry.index ? geometry.toNonIndexed() : geometry;
    });
    const geometry = mergeGeometries(normalized)!;
    normalized.forEach((part, index) => {
      part.dispose();
      if (part !== parts[index]) parts[index].dispose();
    });
    return geometry;
  }

  // A shaped jacket, rounded head with nose and eyes, hair cap, hips and
  // articulated legs keep silhouettes readable at the island's camera scale.
  const jacket = new THREE.LatheGeometry([
    new THREE.Vector2(.145, -.205), new THREE.Vector2(.16, -.19),
    new THREE.Vector2(.205, .10), new THREE.Vector2(.19, .17),
    new THREE.Vector2(.095, .215), new THREE.Vector2(0, .215),
  ], 10);
  jacket.scale(1, 1, .68); jacket.translate(0, 1.02, 0);
  const torso = batch('walker-jackets', jacket, shirtMaterial, WALKER_COUNT);

  const head = new THREE.SphereGeometry(.153, 10, 8);
  head.scale(.93, 1.1, .9); head.translate(0, 1.423, 0);
  const neck = new THREE.CylinderGeometry(.064, .068, .12, 8);
  neck.translate(0, 1.26, 0);
  const nose = new THREE.SphereGeometry(.032, 6, 4);
  nose.scale(.8, .95, 1.15); nose.translate(0, 1.405, .136);
  const heads = batch('walker-heads', joined([head, neck, nose]), skinMaterial, WALKER_COUNT);

  const hair = new THREE.SphereGeometry(.155, 10, 6, 0, TAU, 0, Math.PI * .51);
  hair.scale(.96, 1.07, .93); hair.translate(0, 1.444, -.008);
  const eyes = [-1, 1].map(side => {
    const eye = new THREE.SphereGeometry(.012, 5, 4);
    eye.translate(side * .053, 1.441, .127);
    return eye;
  });
  const hairstyles = batch('walker-hair-eyes', joined([hair, ...eyes]), hairMaterial, WALKER_COUNT);
  const hips = new THREE.CapsuleGeometry(.125, .13, 2, 8);
  hips.rotateZ(Math.PI / 2); hips.scale(1, .66, .82); hips.translate(0, .769, 0);
  const waists = batch('walker-waists', hips, trousersMaterial, WALKER_COUNT);

  // Reuse each capsule geometry across a whole population; matrix scale
  // supplies limb length while keeping the original rounded end caps.
  const sleeveGeometry = new THREE.CapsuleGeometry(.068, .204, 2, 8);
  const forearmGeometry = new THREE.CapsuleGeometry(.047, .166, 2, 8);
  const legGeometry = new THREE.CapsuleGeometry(.064, .192, 2, 8);
  const handGeometry = new THREE.SphereGeometry(.052, 8, 6);
  const shoeGeometry = new THREE.CapsuleGeometry(.063, .11, 2, 8);
  shoeGeometry.rotateX(Math.PI / 2); shoeGeometry.scale(1, .7, 1);
  const upperArms = batch('walker-sleeves', sleeveGeometry, shirtMaterial, WALKER_COUNT * 2);
  const forearms = batch('walker-forearms', forearmGeometry, skinMaterial, WALKER_COUNT * 2);
  const hands = batch('walker-hands', handGeometry, skinMaterial, WALKER_COUNT * 2);
  const legs = batch('walker-legs', legGeometry, trousersMaterial, WALKER_COUNT * 4);
  const shoes = batch('walker-shoes', shoeGeometry, shoeMaterial, WALKER_COUNT * 2);
  const staticBodies = [torso, heads, hairstyles, waists];

  for (let index = 0; index < WALKER_COUNT; index++) {
    const shirt = shirts[index % shirts.length];
    const skin = skinTones[(index * 5) % skinTones.length];
    const trouser = trouserColors[index % trouserColors.length];
    torso.setColorAt(index, color.set(shirt));
    heads.setColorAt(index, color.set(skin));
    waists.setColorAt(index, color.set(trouser));
    for (let side = 0; side < 2; side++) {
      upperArms.setColorAt(index * 2 + side, color.set(shirt));
      forearms.setColorAt(index * 2 + side, color.set(skin));
      hands.setColorAt(index * 2 + side, color.set(skin));
      legs.setColorAt(index * 4 + side * 2, color.set(trouser));
      legs.setColorAt(index * 4 + side * 2 + 1, color.set(trouser));
    }
  }

  function place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, pitch = 0, lengthScale = 1) {
    local.position.set(x, y, z);
    local.rotation.set(pitch, 0, 0);
    local.scale.set(1, lengthScale, 1);
    local.updateMatrix();
    matrix.multiplyMatrices(root.matrix, local.matrix);
    mesh.setMatrixAt(index, matrix);
  }

  function update(timeSeconds: number) {
    if (disposed) return;
    const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
    root.scale.setScalar(TAXI_SCALE);
    for (let index = 0; index < TAXI_COUNT; index++) {
      const angle = (index / TAXI_COUNT * TAU + time * TAXI_SPEED / TAXI_RADIUS) % TAU;
      root.position.set(Math.cos(angle) * TAXI_RADIUS, ROAD_Y + .005, Math.sin(angle) * TAXI_RADIUS);
      // Model front is +Z; the increasing-angle tangent is (-sin a, cos a).
      root.rotation.set(0, -angle, 0);
      root.updateMatrix();
      for (const taxi of taxis) taxi.setMatrixAt(index, root.matrix);
    }

    for (let index = 0; index < WALKER_COUNT; index++) {
      const angle = (index / WALKER_COUNT * TAU + .085 + time * WALKER_SPEED / WALKER_RADIUS) % TAU;
      const phase = time * 5.4 + index * 2.399;
      const height = .94 + (index % 5) * .028;
      root.scale.setScalar(height);
      root.position.set(Math.cos(angle) * WALKER_RADIUS, PROMENADE_Y + Math.abs(Math.sin(phase)) * .012, Math.sin(angle) * WALKER_RADIUS);
      root.rotation.set(0, -angle, 0);
      root.updateMatrix();
      for (const body of staticBodies) body.setMatrixAt(index, root.matrix);

      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        const swing = Math.sin(phase + side * Math.PI);
        const hipAngle = swing * .37;
        const kneeAngle = hipAngle - Math.max(0, -swing) * .58;
        const hipX = sign * .095;
        const hipY = .71;
        const upperLength = .3;
        const lowerLength = .32;
        const kneeY = hipY - Math.cos(hipAngle) * upperLength;
        const kneeZ = -Math.sin(hipAngle) * upperLength;
        const ankleY = kneeY - Math.cos(kneeAngle) * lowerLength;
        const ankleZ = kneeZ - Math.sin(kneeAngle) * lowerLength;
        place(legs, index * 4 + side * 2, hipX, hipY - Math.cos(hipAngle) * upperLength / 2, -Math.sin(hipAngle) * upperLength / 2, hipAngle, upperLength / .32);
        place(legs, index * 4 + side * 2 + 1, hipX, kneeY - Math.cos(kneeAngle) * lowerLength / 2, kneeZ - Math.sin(kneeAngle) * lowerLength / 2, kneeAngle);
        place(shoes, index * 2 + side, hipX, ankleY - .045, ankleZ + .033, 0);

        const armAngle = -swing * .32;
        const elbowAngle = armAngle - .17;
        const shoulderX = sign * .224;
        const shoulderY = 1.166;
        const upperArmLength = .245;
        const forearmLength = .225;
        const elbowY = shoulderY - Math.cos(armAngle) * upperArmLength;
        const elbowZ = -Math.sin(armAngle) * upperArmLength;
        place(upperArms, index * 2 + side, shoulderX, shoulderY - Math.cos(armAngle) * upperArmLength / 2, -Math.sin(armAngle) * upperArmLength / 2, armAngle, upperArmLength / .34);
        place(forearms, index * 2 + side, shoulderX, elbowY - Math.cos(elbowAngle) * forearmLength / 2, elbowZ - Math.sin(elbowAngle) * forearmLength / 2, elbowAngle, forearmLength / .26);
        place(hands, index * 2 + side, shoulderX, elbowY - Math.cos(elbowAngle) * (forearmLength + .013), elbowZ - Math.sin(elbowAngle) * (forearmLength + .013));
      }
    }
    for (const mesh of batches) mesh.instanceMatrix.needsUpdate = true;
  }

  function setNight(night: boolean) {
    if (disposed) return;
    taxiLights.emissiveIntensity = night ? 2.2 : .16;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const mesh of batches) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
  }

  update(0);
  return { group, update, setNight, dispose };
}

