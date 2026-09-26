/**
 * The renderer (TZ §6.1): WebGPURenderer, which falls back to its WebGL2 backend by itself when WebGPU
 * is missing (Safari before iOS 26, Firefox ESR). Antialiasing is left to the post pipeline.
 */
import * as THREE from "three/webgpu";

export type Backend = "webgpu" | "webgl2";

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
  /** GPU name for quality tiers and telemetry: the WebGPU adapter info or WEBGL_debug_renderer_info; "" if hidden. */
  gpu: string;
  /**
   * The GPU device or WebGL context was lost: the renderer draws nothing from now on. Fires once; also
   * right away for a listener added after the loss.
   */
  onLost(cb: () => void): () => void;
  /**
   * The GPU is usable again (WebGL2: `webglcontextrestored`; WebGPU: a new adapter can be requested). three
   * does not rebuild a lost backend, so the caller disposes this handle and creates a new renderer on a new
   * canvas, reusing the scene's geometries, materials and textures (TZ §6.1: "Восстанавливаем город…").
   */
  onRestored(cb: () => void): () => void;
  /** Frees the renderer and its GPU device or context. */
  dispose(): void;
}

type LossInfo = Parameters<THREE.WebGPURenderer["onDeviceLost"]>[0];
interface BackendInternals { isWebGPUBackend?: boolean; device?: GPUDevice; gl?: WebGL2RenderingContext }

/** Device pixel ratio (TZ §6.1): at most 2 on desktop and 1.5 on phones, never below 1; quality scales it by 0.8…1. */
export function pixelRatio(mobile: boolean, resolution = 1) {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.max(1, Math.min(dpr, mobile ? 1.5 : 2)) * resolution;
}

export async function createRenderer(canvas: HTMLCanvasElement, { forceWebGL = false, mobile = false } = {}): Promise<RendererHandle> {
  // Laptops with two GPUs get the fast one; phones have one anyway.
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: true, forceWebGL, powerPreference: mobile ? "low-power" : "high-performance" });
  const lostListeners = new Set<() => void>(), restoredListeners = new Set<() => void>();
  let lost = false, restored = false, disposed = false, timer = 0;

  const restore = () => {
    if (disposed || !lost || restored) return;
    restored = true; restoredListeners.forEach(cb => cb());
  };
  /** A lost WebGPU device never comes back; the GPU is usable again once an adapter can be had. */
  const waitForAdapter = (attempt = 0) => {
    if (disposed || attempt > 6) return;
    timer = window.setTimeout(async () => {
      let adapter: GPUAdapter | null = null;
      try { adapter = await navigator.gpu?.requestAdapter() ?? null; } catch { /* Try again later. */ }
      if (adapter) restore(); else waitForAdapter(attempt + 1);
    }, 500 * 2 ** attempt);
  };
  const defaultLost = renderer.onDeviceLost;
  renderer.onDeviceLost = (info: LossInfo) => {
    // dispose() destroys the device on purpose: that is not a loss.
    if (disposed || lost) return;
    defaultLost.call(renderer, info);
    lost = true; lostListeners.forEach(cb => cb());
    if (info.api === "WebGPU") waitForAdapter();
  };
  // WebGLBackend already calls preventDefault() on `webglcontextlost`, which lets the browser restore it.
  canvas.addEventListener("webglcontextrestored", restore);

  try {
    await renderer.init();
  } catch (error) {
    // Neither backend started (no GPU at all): the page shows its fallback. dispose() is not called here,
    // it would await init() again and reject a second time.
    disposed = true;
    canvas.removeEventListener("webglcontextrestored", restore);
    throw error;
  }
  const internals = renderer.backend as unknown as BackendInternals;
  const backend: Backend = internals.isWebGPUBackend ? "webgpu" : "webgl2";

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(pixelRatio(mobile));

  const subscribe = (set: Set<() => void>, cb: () => void, fired: boolean) => {
    set.add(cb);
    if (fired) queueMicrotask(() => { if (set.has(cb) && !disposed) cb(); });
    return () => { set.delete(cb); };
  };
  return {
    renderer, backend, gpu: await gpuName(internals),
    onLost: cb => subscribe(lostListeners, cb, lost),
    onRestored: cb => subscribe(restoredListeners, cb, restored),
    dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer);
      lostListeners.clear(); restoredListeners.clear();
      canvas.removeEventListener("webglcontextrestored", restore);
      renderer.dispose();
      // three's WebGPU backend never destroys its device, which would keep GPU memory until garbage collection.
      internals.device?.destroy();
    },
  };
}

async function gpuName(backend: BackendInternals): Promise<string> {
  try {
    if (backend.isWebGPUBackend) {
      const info = backend.device?.adapterInfo ?? (await navigator.gpu?.requestAdapter())?.info;
      return info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" ") : "";
    }
    const gl = backend.gl;
    if (!gl) return "";
    // Firefox gives the real name here; Chrome and Safari say "WebKit WebGL" and need the extension.
    const plain = String(gl.getParameter(gl.RENDERER) ?? "");
    if (!/^(webkit|mozilla)/i.test(plain)) return plain;
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : plain;
  } catch {
    return "";
  }
}

/**
 * Static shadows in WebGPURenderer (three r180), the same on both backends. What the source shows:
 * - WebGPURenderer.shadowMap is only `{ enabled, type }`: the WebGLRenderer flags `shadowMap.autoUpdate` /
 *   `shadowMap.needsUpdate` the old city relied on do not exist there and are silently ignored.
 * - Each light's map is drawn in ShadowNode.updateBefore() (src/nodes/lighting/ShadowNode.js) when
 *   `light.shadow.autoUpdate || light.shadow.needsUpdate`, at most once per frame and camera. After the draw
 *   `needsUpdate` goes back to false, unless the map was resized during it (then it draws again next frame).
 * - The WebGPU and WebGL2 backends share this node code, so the per-light LightShadow flags work on both.
 * - The draw is `renderer.render(scene, shadow.camera)` with the scene as it is at that moment: casters
 *   hidden, culled out of an InstancedMesh count or not yet loaded are missing until the next redraw.
 * - A map that was never drawn holds no depth, so switching to static mode also asks for a redraw.
 */
export function setStaticShadows(light: THREE.Light & { shadow: THREE.LightShadow }, enabled: boolean) {
  light.shadow.autoUpdate = !enabled;
  if (enabled) requestShadowRedraw(light);
}

/** Redraws a static shadow map once, in the next rendered frame (casters arrived, moved or grew). */
export function requestShadowRedraw(light: THREE.Light & { shadow: THREE.LightShadow }) {
  light.shadow.needsUpdate = true;
}
