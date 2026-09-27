/**
 * What every render module and system receives (TZ §3.2). Modules register per-frame work with
 * `onFrame` and release their GPU resources in the function they return from `create…`.
 */
import type * as THREE from "three/webgpu";
import type { WorldData } from "../world/types";
import type { QualitySettings } from "./qualityTypes";

export interface CityContext {
  renderer: THREE.WebGPURenderer;
  /** "webgpu" or "webgl2" (the automatic fallback). */
  backend: "webgpu" | "webgl2";
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: WorldData;
  /** Current quality settings; `onQuality` fires when they change. */
  quality: QualitySettings;
  mobile: boolean;
  reducedMotion: boolean;
  /** Per-frame callback: dt in seconds (clamped), now in ms. Returns an unsubscribe function. */
  onFrame(cb: (dt: number, now: number) => void): () => void;
  /** Fires after the camera moved (at most once per frame). */
  onCameraMove(cb: () => void): () => void;
  onQuality(cb: (q: QualitySettings) => void): () => void;
  /** Static shadow casters changed (models arrived, a district grew): redraw the static shadow map. */
  requestShadowUpdate(): void;
  /** The HTML layer above the canvas, for labels (TZ §9.2). */
  overlay: HTMLElement;
}
