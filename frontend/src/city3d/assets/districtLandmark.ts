/**
 * Cached architectural meshes for the community centre (world/districtLandmark.ts): every part drawn in its box, the
 * shell in its finishes in one mesh, with the windows of its walls marked to light at night (LANDMARK_GLOW), and the
 * curtain-wall glass in another for the office facade. Each merges to one draw call.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { landmarkBoxes, type LandmarkBox, type LandmarkFinish } from "../world/districtLandmark";
import { SECTION_PART, SECTION_PARTS } from "./courtyard";

const FINISHES: Record<Exclude<LandmarkFinish, "glass">, string> = {
  stone: "#eee8dc", dark: "#374b52", green: "#748f6b", accent: "#6b55c8", roof: "#3f6670", white: "#f8f4ec", trim: "#d8cbb0",
  gold: "#cf9b4a", window: "#4a7480", wood: "#926b45", leaf: "#6f9466",
};
/** The shell's attribute for its windows: 0 elsewhere, a window's own value in (0, 1], which says whether and when it lights. */
export const LANDMARK_GLOW = "landmarkGlow";

/** A part's shape filling its box, the box's bottom at y = 0 and its middle at x = z = 0. */
function shapeOf(box: LandmarkBox): THREE.BufferGeometry {
  const { width: w, height: h, depth: d } = box;
  switch (box.shape ?? "box") {
    case "cylinder":
      return box.axis === "z" ? new THREE.CylinderGeometry(w / 2, w / 2, d, 20).rotateX(Math.PI / 2).translate(0, h / 2, 0)
        : new THREE.CylinderGeometry(w / 2, w / 2, h, 12).scale(1, 1, d / w).translate(0, h / 2, 0);
    case "cone": return new THREE.ConeGeometry(w / 2, h, 12).scale(1, 1, d / w).translate(0, h / 2, 0);
    case "ball": return new THREE.SphereGeometry(.5, 12, 8).scale(w, h, d).translate(0, h / 2, 0);
    case "dome": return new THREE.SphereGeometry(.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(w, h * 2, d);
    case "pyramid": return new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w, h, d).translate(0, h / 2, 0);
    case "roof": {
      // A gable with thick eaves, its ridge along z; turned when it runs along x.
      const across = box.along === "x" ? d : w, length = box.along === "x" ? w : d, eave = Math.min(.22, h / 4);
      const profile = new THREE.Shape([new THREE.Vector2(-across / 2, 0), new THREE.Vector2(across / 2, 0), new THREE.Vector2(across / 2, eave), new THREE.Vector2(0, h), new THREE.Vector2(-across / 2, eave)]);
      const roof = new THREE.ExtrudeGeometry(profile, { depth: length, bevelEnabled: false }).translate(0, 0, -length / 2);
      return box.along === "x" ? roof.rotateY(Math.PI / 2) : roof;
    }
    default: return new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  }
}

/** Every architectural part at this detail, as the shell and the glass. */
export function landmarkGeometry(level: number, detail: 0 | 1 | 2) {
  const shell: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  for (const box of landmarkBoxes(level, detail)) {
    const source = shapeOf(box).translate(box.x, box.y, box.z), geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.deleteAttribute("uv"); geometry.clearGroups();
    const vertices = geometry.getAttribute("position").count;
    if (box.finish === "glass") {
      geometry.setAttribute(SECTION_PART, new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(SECTION_PARTS.facade), 1));
      glass.push(geometry);
      continue;
    }
    const colour = new THREE.Color(FINISHES[box.finish]), values = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) colour.toArray(values, i * 3);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(values, 3));
    geometry.setAttribute(LANDMARK_GLOW, new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(box.finish === "window" ? box.glow ?? .5 : 0), 1));
    shell.push(geometry);
  }
  const merge = (parts: THREE.BufferGeometry[]) => { const merged = mergeGeometries(parts)!; parts.forEach(part => part.dispose()); return merged; };
  return { shell: merge(shell), glass: merge(glass) };
}
