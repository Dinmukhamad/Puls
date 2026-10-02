/**
 * The borders between the team districts on the ground (world/land.ts districtBorders), each side in the colour of
 * the district on that side: down a footpath or a boulevard a band whose halves are the two colours; along a street,
 * whose surface stands higher, a stripe on each kerb. Low posts in those colours run along both edges, so a border
 * reads from above and from the street alike. One mesh and one instanced post pool for a whole city.
 */
import * as THREE from "three/webgpu";
import type { DistrictBorder } from "../world/land";

/** Over the kerbs, the ring roads' markings and the yards' paving (render/terrain.ts), under streets and buildings. */
const BAND_Y = .232, HALF = .75;
/** A street's surface (render/terrain.ts street): kerb stripes run from its edge to the plots. */
const ROAD_HALF = 1;
/** Posts: every POST_STEP along a border, on both of its edges. */
const POST_STEP = 7, POST_HEIGHT = .75, POST_RADIUS = .085;

export interface Borders { band: THREE.Mesh; posts: THREE.InstancedMesh; dispose(): void }

export function createBorders(borders: readonly DistrictBorder[], colourOf: (district: number) => string): Borders {
  const positions: number[] = [], colours: number[] = [], index: number[] = [], colour = new THREE.Color();
  const quad = (points: { x: number; z: number }[], hex: string) => {
    const base = positions.length / 3;
    colour.set(hex);
    for (const p of points) { positions.push(p.x, BAND_Y, p.z); colours.push(colour.r, colour.g, colour.b); }
    // Facing up whichever way round the corners go.
    const [a, b, c] = points, up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  };
  const posts: { x: number; z: number; district: number }[] = [];
  for (const border of borders) {
    const { a, b, normal: n, gaps } = border;
    const off = (p: { x: number; z: number }, k: number) => ({ x: p.x + n.x * k, z: p.z + n.z * k });
    // How far from the middle line each side's colour runs, for the gap there: short of the plots' ground, which starts
    // .24 in from their edges (systems/estates.ts INSET).
    const span = (gap: number) => border.street ? [ROAD_HALF, gap / 2 + .15] : [0, Math.min(HALF, gap / 2 - .03)];
    const [fa, ta] = span(gaps[0]), [fb, tb] = span(gaps[1]);
    quad([off(a, fa), off(b, fb), off(b, tb), off(a, ta)], colourOf(border.toward));
    quad([off(a, -fa), off(b, -fb), off(b, -tb), off(a, -ta)], colourOf(border.away));
    // The posts at the colour's outer edge, but off the plots themselves; one at each end and evenly between.
    const length = Math.hypot(b.x - a.x, b.z - a.z), count = Math.max(1, Math.floor(length / POST_STEP));
    for (let i = 0; i <= count; i++) {
      const t = (.5 + i * (length - 1) / count) / length, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const gap = gaps[0] + (gaps[1] - gaps[0]) * t, edge = Math.min(span(gap)[1], gap / 2 - POST_RADIUS - .02);
      posts.push({ ...off(p, edge), district: border.toward }, { ...off(p, -edge), district: border.away });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  const band = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .7, metalness: 0 }));
  band.receiveShadow = true; band.matrixAutoUpdate = false; band.name = "district-borders";
  const post = new THREE.CylinderGeometry(POST_RADIUS * .8, POST_RADIUS, POST_HEIGHT, 6).translate(0, .2 + POST_HEIGHT / 2, 0);
  const pool = new THREE.InstancedMesh(post, new THREE.MeshStandardNodeMaterial({ roughness: .55, metalness: .05 }), Math.max(1, posts.length));
  const matrix = new THREE.Matrix4();
  posts.forEach((p, i) => { pool.setMatrixAt(i, matrix.makeTranslation(p.x, 0, p.z)); pool.setColorAt(i, colour.set(colourOf(p.district))); });
  pool.count = posts.length; pool.castShadow = true; pool.receiveShadow = true; pool.name = "district-border-posts";
  pool.instanceMatrix.needsUpdate = true; if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
  pool.computeBoundingSphere();
  return {
    band, posts: pool,
    dispose() { geometry.dispose(); (band.material as THREE.Material).dispose(); post.dispose(); (pool.material as THREE.Material).dispose(); pool.dispose(); },
  };
}
