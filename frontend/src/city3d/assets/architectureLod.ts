/** Keep structural faces and their facade coordinates; subpixel bevels, rails and fittings stay in LOD0. */
import * as THREE from "three/webgpu";

export function architectureLod(source: THREE.BufferGeometry, level: 1 | 2): THREE.BufferGeometry {
  source.computeBoundingBox();
  const size = source.boundingBox!.getSize(new THREE.Vector3());
  const area = Math.max(size.x * size.y, size.x * size.z, size.y * size.z);
  const threshold = area * (level === 1 ? .0006 : .004);
  const p = source.getAttribute("position"), index = source.index, selected: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0, count = index?.count ?? p.count; t < count; t += 3) {
    const ids = [index ? index.getX(t) : t, index ? index.getX(t + 1) : t + 1, index ? index.getX(t + 2) : t + 2];
    a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
    const triangleArea = b.sub(a).cross(c.sub(a)).length() * .5;
    if (triangleArea >= threshold) selected.push(...ids);
  }
  // Very thin structures (e.g. cranes) must retain a usable silhouette rather than disappear.
  if (selected.length < 18) return source.clone();
  const names = Object.keys(source.attributes), stride = names.reduce((n, name) => n + source.getAttribute(name).itemSize, 0);
  const vertices = [...new Set(selected)], remap = new Map(vertices.map((v, i) => [v, i]));
  const data = new Float32Array(vertices.length * stride), buffer = new THREE.InterleavedBuffer(data, stride), geometry = new THREE.BufferGeometry();
  let offset = 0;
  for (const name of names) {
    const attr = source.getAttribute(name);
    vertices.forEach((v, i) => { for (let k = 0; k < attr.itemSize; k++) data[i * stride + offset + k] = attr.getComponent(v, k); });
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, attr.itemSize, offset, attr.normalized));
    offset += attr.itemSize;
  }
  geometry.setIndex(selected.map(v => remap.get(v)!));
  // Placement/culling envelopes belong to the detailed model, including aerials and railings.
  geometry.boundingBox = source.boundingBox!.clone();
  source.computeBoundingSphere(); geometry.boundingSphere = source.boundingSphere!.clone();
  return geometry;
}
