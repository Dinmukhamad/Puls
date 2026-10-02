/** Cached architectural meshes for the community centre. Shell and lit glass each merge to one draw call. */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { landmarkBoxes, type LandmarkFinish } from "../world/districtLandmark";
import { SECTION_PART, SECTION_PARTS } from "./courtyard";

const FINISHES: Record<LandmarkFinish, string> = { stone: "#eee8dc", glass: "#92b9c3", dark: "#374b52", green: "#748f6b", accent: "#6b55c8" };

/** Full stepped architecture remains at every distance; only the small mullions and terrace planting disappear. */
export function landmarkGeometry(level: number, detail: 0 | 1 | 2) {
  const shell: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  for (const box of landmarkBoxes(level, detail)) {
    const source = new THREE.BoxGeometry(box.width, box.height, box.depth).translate(box.x, box.y + box.height / 2, box.z);
    const geometry = source.toNonIndexed(); source.dispose();
    geometry.deleteAttribute("uv");
    const vertices = geometry.getAttribute("position").count;
    if (box.finish === "glass") {
      geometry.setAttribute(SECTION_PART, new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(SECTION_PARTS.facade), 1));
      glass.push(geometry);
    } else {
      const colour = new THREE.Color(FINISHES[box.finish]), values = new Float32Array(vertices * 3);
      for (let i = 0; i < vertices; i++) colour.toArray(values, i * 3);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(values, 3)); shell.push(geometry);
    }
  }
  const merge = (parts: THREE.BufferGeometry[]) => { const merged = mergeGeometries(parts)!; parts.forEach(part => part.dispose()); return merged; };
  return { shell: merge(shell), glass: merge(glass) };
}
