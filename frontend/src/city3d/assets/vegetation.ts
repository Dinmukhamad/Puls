/** Rounded storybook crowns and sturdy trunks, kept inside the established planting envelopes. */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type TreeSpecies = "cone" | "round" | "birch" | "oak";
type Vec = [number, number, number];
export const TREE_ENVELOPES: Record<TreeSpecies, [Vec, Vec]> = {
  cone: [[-.6, 0, -.6], [.6, 2.4, .6]], round: [[-.62, 0, -.62], [.62, 1.92, .62]],
  birch: [[-.46, 0, -.46], [.46, 2.65, .46]], oak: [[-.82, 0, -.72], [.9, 2.05, .68]],
};

/** A few closed volumes at distance: the same species, height and planting envelope, without hidden branches. */
export function distantTreeGeometry(species: TreeSpecies) {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = paintProp(new THREE.CylinderGeometry(.045, .075, .85, 4).translate(0, .425, 0), species === "birch" ? "#fff5d9" : "#a86e43", .86);
  parts.push(trunk);
  if (species === "cone") {
    parts.push(paintProp(new THREE.ConeGeometry(.6, 1.45, 6).translate(0, 1.1, 0), "#299d60", .94));
    parts.push(paintProp(new THREE.ConeGeometry(.4, 1.3, 6).translate(0, 1.75, 0), "#69c55b", .94));
  } else {
    const tall = species === "birch";
    const lobe = (x: number, y: number, z: number, w: number, h: number, d: number, tint: string) =>
      paintProp(new THREE.SphereGeometry(1, 5, 3).scale(w, h, d).translate(x, y, z), tint, .94);
    parts.push(lobe(-.15, tall ? 1.5 : 1.15, .03, tall ? .38 : .66, tall ? .8 : .62, tall ? .34 : .6, tall ? "#8dd75b" : "#48b85b"));
    parts.push(lobe(.2, tall ? 2.05 : 1.5, -.04, tall ? .3 : .56, tall ? .6 : .55, tall ? .3 : .54, tall ? "#b4e66c" : "#98d94f"));
  }
  return fitPropEnvelope(mergePropGeometries(parts), TREE_ENVELOPES[species]);
}

/** `aProp` carries roughness and metalness so one shared material can distinguish timber, foliage and metal. */
export function paintProp(geometry: THREE.BufferGeometry, color: string, roughness = .78, metalness = 0, variation = .012) {
  const part = geometry.index ? geometry.toNonIndexed() : geometry, position = part.getAttribute("position"), normal = part.getAttribute("normal");
  const colors = new Float32Array(position.count * 3), surface = new Float32Array(position.count * 2), c = new THREE.Color(color);
  for (let i = 0; i < position.count; i++) {
    // Broad colour planes read like painted toys; no speckled leaf/wood grain.
    const wash = Math.sin(position.getY(i) * 1.7) * variation;
    const shade = .96 + Math.max(-.6, normal.getY(i)) * .035 + wash;
    colors.set([c.r * shade, c.g * shade, c.b * shade], i * 3); surface.set([roughness, metalness], i * 2);
  }
  part.setAttribute("color", new THREE.BufferAttribute(colors, 3)); part.setAttribute("aProp", new THREE.BufferAttribute(surface, 2)); part.deleteAttribute("uv");
  if (part !== geometry) geometry.dispose();
  return part;
}

export function mergePropGeometries(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!; parts.forEach(part => part.dispose()); return geometry;
}

/** Smooth, plump leaf clusters: an authored squash instead of a noisy rock silhouette. */
export function foliageGeometry(center: Vec, size: Vec, color: string, seed = 1, detail = 1) {
  const geometry = new THREE.SphereGeometry(1, detail ? 8 : 6, detail ? 5 : 3), positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const lean = Math.sin(seed * 1.3) * .075;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    // Just a gentle pear/squash shape, retaining the sphere's smooth shared normals.
    const full = 1 + (1 - y * y) * .035;
    positions.setXYZ(i, x * full + y * lean, y, z * full);
    normals.setXYZ(i, x, y, z);
  }
  geometry.scale(...size).translate(...center);
  return paintProp(geometry, color, .94, 0, .012);
}

function branch(a: Vec, b: Vec, radius: number, color: string, sides = 7) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radius * .72, radius, length, sides);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize()));
  geometry.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return paintProp(geometry, color, .86, 0, .055);
}

/** Fit once after assembly: new branch/crown detail cannot enter an adjacent road or change planted heights. */
export function fitPropEnvelope(geometry: THREE.BufferGeometry, [min, max]: [Vec, Vec]) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3());
  geometry.translate(-bounds.min.x, -bounds.min.y, -bounds.min.z);
  geometry.scale((max[0] - min[0]) / size.x, (max[1] - min[1]) / size.y, (max[2] - min[2]) / size.z).translate(...min);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

export function vegetationGeometry(species: TreeSpecies, far = false) {
  const parts: THREE.BufferGeometry[] = [], detail = far ? 0 : 1;
  const wood = species === "birch" ? "#fff5d9" : species === "cone" ? "#a86e43" : "#b47948";
  if (species === "cone") {
    parts.push(branch([0, 0, 0], [.015, 2.32, -.01], .095, wood));
    const greens = ["#29935c", "#38b064", "#65c75b", "#93d65b"];
    for (let tier = 0; tier < 4; tier++) {
      const y = .72 + tier * .43, radius = .59 - tier * .115, height = .88 - tier * .08;
      // Bell-shaped tiers replace straight pointed cones: soft lips and a rounded taper.
      const profile = [[0, -.5], [.74, -.5], [1, -.34], [.96, -.12], [.64, .23], [.25, .45], [0, .5]]
        .map(([r, h]) => new THREE.Vector2(r * radius, h * height));
      const geometry = new THREE.LatheGeometry(profile, far ? 6 : 8);
      geometry.rotateY(tier * .35).translate(Math.sin(tier * 2.1) * .015, y, Math.cos(tier * 1.3) * .015);
      parts.push(paintProp(geometry, greens[tier], .94, 0, .012));
    }
  } else if (species === "birch") {
    parts.push(branch([0, 0, 0], [-.035, 2.2, .02], .065, wood));
    for (const y of [.38, .73, 1.08, 1.39]) parts.push(paintProp(new THREE.CylinderGeometry(.061, .065, .028, 7).translate(-.012, y, 0), "#5d5b50", .86));
    const lobes: [Vec, Vec, string][] = [
      [[-.14, 1.42, .08], [.33, .53, .3], "#68bd59"], [[.16, 1.65, -.11], [.33, .58, .29], "#8dd75b"],
      [[-.14, 2.03, -.04], [.3, .5, .29], "#9cdd64"], [[.11, 2.28, .08], [.26, .42, .25], "#b4e66c"],
      [[.03, 1.93, .23], [.25, .44, .24], "#56af50"],
    ];
    lobes.forEach(([center, size, color], i) => { if (!far) parts.push(branch([0, .85 + i * .17, 0], center, .024, wood, 5)); parts.push(foliageGeometry(center, size, color, 11 + i, detail)); });
  } else {
    const oak = species === "oak", trunkTop = oak ? 1.1 : 1.08;
    parts.push(branch([0, 0, 0], [.025, trunkTop, -.01], oak ? .135 : .105, wood));
    const lobes: [Vec, Vec, string][] = oak ? [
      [[-.42, 1.2, -.18], [.43, .43, .43], "#359d54"], [[.4, 1.22, .14], [.5, .44, .44], "#48b85b"],
      [[-.18, 1.6, .23], [.47, .43, .43], "#6ac94e"], [[.25, 1.66, -.21], [.48, .43, .43], "#89d65b"],
      [[-.43, 1.52, -.32], [.38, .38, .39], "#48ad53"], [[.03, 1.84, .02], [.43, .31, .4], "#98d94f"],
    ] : [
      [[-.31, 1.06, -.1], [.38, .37, .38], "#41af5b"], [[.3, 1.1, .12], [.4, .38, .36], "#68c34e"],
      [[-.15, 1.48, .16], [.4, .42, .39], "#8cd455"], [[.23, 1.45, -.2], [.37, .4, .38], "#4fb954"],
      [[-.07, 1.72, -.05], [.37, .28, .36], "#ade35f"],
    ];
    lobes.forEach(([center, size, color], i) => { if (!far || i < 2) parts.push(branch([.015, .65 + i * .06, 0], center, oak ? .055 : .037, wood, 6)); parts.push(foliageGeometry(center, size, color, 23 + i, detail)); });
    if (!far) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .3; parts.push(branch([0, .16, 0], [Math.cos(a) * .22, .02, Math.sin(a) * .22], oak ? .045 : .032, wood, 5)); }
  }
  return fitPropEnvelope(mergePropGeometries(parts), TREE_ENVELOPES[species]);
}
