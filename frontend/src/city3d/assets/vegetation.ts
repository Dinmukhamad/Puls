/** Smooth, irregular crowns and forked trunks, kept inside the established planting envelopes. */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type TreeSpecies = "cone" | "round" | "birch" | "oak";
type Vec = [number, number, number];
export const TREE_ENVELOPES: Record<TreeSpecies, [Vec, Vec]> = {
  cone: [[-.6, 0, -.6], [.6, 2.4, .6]], round: [[-.62, 0, -.62], [.62, 1.92, .62]],
  birch: [[-.46, 0, -.46], [.46, 2.65, .46]], oak: [[-.82, 0, -.72], [.9, 2.05, .68]],
};

/** `aProp` carries roughness and metalness so one shared material can distinguish timber, foliage and metal. */
export function paintProp(geometry: THREE.BufferGeometry, color: string, roughness = .78, metalness = 0, variation = .035) {
  const part = geometry.index ? geometry.toNonIndexed() : geometry, position = part.getAttribute("position"), normal = part.getAttribute("normal");
  const colors = new Float32Array(position.count * 3), surface = new Float32Array(position.count * 2), c = new THREE.Color(color);
  for (let i = 0; i < position.count; i++) {
    const grain = Math.sin(position.getX(i) * 47 + position.getY(i) * 19 + position.getZ(i) * 31) * variation;
    const shade = .91 + Math.max(-.6, normal.getY(i)) * .07 + grain;
    colors.set([c.r * shade, c.g * shade, c.b * shade], i * 3); surface.set([roughness, metalness], i * 2);
  }
  part.setAttribute("color", new THREE.BufferAttribute(colors, 3)); part.setAttribute("aProp", new THREE.BufferAttribute(surface, 2)); part.deleteAttribute("uv");
  if (part !== geometry) geometry.dispose();
  return part;
}

export function mergePropGeometries(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!; parts.forEach(part => part.dispose()); return geometry;
}

/** A leafy lobe has an uneven silhouette and smooth radial normals, with shaded undersides. */
export function foliageGeometry(center: Vec, size: Vec, color: string, seed = 1, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, detail), positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const ripple = .94 + .045 * Math.sin(x * 13 + z * 17 + seed) * Math.sin(y * 11 - z * 9 + seed * .7);
    positions.setXYZ(i, x * ripple, y * ripple, z * ripple);
    normals.setXYZ(i, x, y, z);
  }
  geometry.scale(...size).translate(...center);
  return paintProp(geometry, color, .94, 0, .065);
}

function branch(a: Vec, b: Vec, radius: number, color: string, sides = 7) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radius * .57, radius, length, sides);
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
  const wood = species === "birch" ? "#e9e5d5" : species === "cone" ? "#84583d" : "#8d6141";
  if (species === "cone") {
    parts.push(branch([0, 0, 0], [.015, 2.32, -.01], .095, wood));
    const greens = ["#286e48", "#338653", "#40965a", "#56a465", "#67b06f"];
    for (let tier = 0; tier < 5; tier++) {
      const y = .75 + tier * .31, radius = .57 - tier * .085;
      const geometry = new THREE.ConeGeometry(radius, .8 - tier * .065, 9, 2), p = geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), wave = 1 + .07 * Math.sin(a * 3 + tier * 1.7);
        p.setXYZ(i, x * wave, p.getY(i) + Math.hypot(x, z) * .07 * Math.sin(a * 5 + tier), z * wave);
      }
      geometry.rotateY(tier * .73).translate(Math.sin(tier * 2.1) * .025, y, Math.cos(tier * 1.3) * .025);
      parts.push(paintProp(geometry, greens[tier], .94, 0, .055));
      if (!far && tier < 3) for (const side of [-1, 1]) parts.push(branch([0, y - .15, 0], [side * radius * .75, y - .2, radius * .28], .018, wood, 5));
    }
  } else if (species === "birch") {
    parts.push(branch([0, 0, 0], [-.035, 2.2, .02], .065, wood));
    for (const y of [.38, .73, 1.08, 1.39]) parts.push(paintProp(new THREE.CylinderGeometry(.061, .065, .028, 7).translate(-.012, y, 0), "#5d5b50", .86));
    const lobes: [Vec, Vec, string][] = [
      [[-.14, 1.42, .08], [.33, .53, .3], "#78b45d"], [[.16, 1.65, -.11], [.33, .58, .29], "#8ac669"],
      [[-.14, 2.03, -.04], [.3, .5, .29], "#9bcf76"], [[.11, 2.28, .08], [.26, .42, .25], "#aed786"],
      [[.03, 1.93, .23], [.25, .44, .24], "#70ac58"],
    ];
    lobes.forEach(([center, size, color], i) => { if (!far) parts.push(branch([0, .85 + i * .17, 0], center, .024, wood, 5)); parts.push(foliageGeometry(center, size, color, 11 + i, detail)); });
  } else {
    const oak = species === "oak", trunkTop = oak ? 1.1 : 1.08;
    parts.push(branch([0, 0, 0], [.025, trunkTop, -.01], oak ? .135 : .105, wood));
    const lobes: [Vec, Vec, string][] = oak ? [
      [[-.42, 1.2, -.18], [.43, .43, .43], "#3b8147"], [[.4, 1.22, .14], [.5, .44, .44], "#48964e"],
      [[-.18, 1.6, .23], [.47, .43, .43], "#5ca657"], [[.25, 1.66, -.21], [.48, .43, .43], "#71b55f"],
      [[-.43, 1.52, -.32], [.38, .38, .39], "#438b49"], [[.03, 1.84, .02], [.43, .31, .4], "#7cbd68"],
    ] : [
      [[-.31, 1.06, -.1], [.38, .37, .38], "#4d9455"], [[.3, 1.1, .12], [.4, .38, .36], "#61a85e"],
      [[-.15, 1.48, .16], [.4, .42, .39], "#72b665"], [[.23, 1.45, -.2], [.37, .4, .38], "#589f58"],
      [[-.07, 1.72, -.05], [.37, .28, .36], "#87c46f"],
    ];
    lobes.forEach(([center, size, color], i) => { if (!far || i < 2) parts.push(branch([.015, .65 + i * .06, 0], center, oak ? .055 : .037, wood, 6)); parts.push(foliageGeometry(center, size, color, 23 + i, detail)); });
    if (!far) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .3; parts.push(branch([0, .16, 0], [Math.cos(a) * .22, .02, Math.sin(a) * .22], oak ? .045 : .032, wood, 5)); }
  }
  return fitPropEnvelope(mergePropGeometries(parts), TREE_ENVELOPES[species]);
}
