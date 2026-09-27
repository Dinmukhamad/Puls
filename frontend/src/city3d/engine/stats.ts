/**
 * The frame counter (TZ §8.4): an overlay for staff (`?stats=1`) and telemetry for everyone, an
 * aggregate POSTed every 60 s and when the page or the city closes (TZ §10), with no personal data.
 */
import type * as THREE from "three/webgpu";
import { request } from "../../api/client";
import type { QualitySettings } from "./qualityTypes";

export const TELEMETRY_PATH = "/api/v1/telemetry/city";
const REPORT_EVERY = 60000, OVERLAY_EVERY = 1000, MAX_GAP = 1000;
/** Fewer frames than this say nothing about the device: no report. */
const MIN_FRAMES = 30;

export interface StatsOptions {
  renderer: THREE.WebGPURenderer;
  backend: "webgpu" | "webgl2";
  /** The city host: the overlay goes inside it, and `data-fps`, `data-draw-calls`… are set on it for tests. */
  host: HTMLElement;
  /** Show the overlay (`?stats=1`, staff only). */
  visible: boolean;
  quality: { readonly settings: QualitySettings; readonly concessions: string[] };
  /** Telemetry is sent only for a signed-in user: the server takes user_id from the session. */
  userIdKnown: boolean;
  /** GPU name from createRenderer(). */
  gpu?: string;
  /** When the city started loading (performance.now()), for first_frame_ms; the creation time by default. */
  start?: number;
  /** More overlay lines, e.g. loaded chunks. */
  extra?: () => string;
}

export interface Stats { beginFrame(): void; endFrame(): void; markFirstFrame(): void; dispose(): void }

/** Frame gaps in 1 ms bins: percentiles with no per-frame allocation. */
class Tally {
  bins = new Uint32Array(MAX_GAP + 1); frames = 0; time = 0; cpu = 0;
  add(gap: number) { this.bins[Math.min(MAX_GAP, Math.round(gap))]++; this.frames++; this.time += gap; }
  get fps() { return this.time ? this.frames * 1000 / this.time : 0; }
  /** 1st-percentile frame rate: the rate of the frame slower than 99 % of the others. */
  get fpsLow() {
    if (!this.frames) return 0;
    let rest = Math.ceil(this.frames * .01);
    for (let ms = MAX_GAP; ms > 0; ms--) if ((rest -= this.bins[ms]) <= 0) return 1000 / ms;
    return this.fps;
  }
  reset() { this.bins.fill(0); this.frames = this.time = this.cpu = 0; }
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const compact = (value: number) => value >= 1e6 ? `${round(value / 1e6, 2)} M` : value >= 1e3 ? `${round(value / 1e3)} k` : String(value);

export function createStats({ renderer, backend, host, visible, quality, userIdKnown, gpu = "", start = performance.now(), extra }: StatsOptions): Stats {
  const recent = new Tally(), period = new Tally();
  let began = 0, previous = 0, firstFrame: number | null = null, calls = 0, triangles = 0, disposed = false;
  let overlay: HTMLDivElement | null = null;
  if (visible) {
    overlay = document.createElement("div");
    overlay.className = "city3d-stats";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, { position: "fixed", left: "calc(var(--city-left, 0px) + 8px)", top: "calc(var(--city-free-top, 0px) + 8px)", zIndex: "30", padding: "6px 8px", borderRadius: "6px", background: "rgba(10, 20, 30, .72)", color: "#e8f1f7", font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre", pointerEvents: "none" });
    host.append(overlay);
  }

  /** Every second: frame rate of that second, 1st percentile since the last report (it needs a hundred frames or more). */
  function refresh() {
    const s = quality.settings, memory = renderer.info.memory;
    Object.assign(host.dataset, { fps: String(round(recent.fps)), drawCalls: String(calls), triangles: String(triangles), quality: `${s.tier}/${quality.concessions.length}` });
    if (overlay) {
      overlay.textContent = [
        `${backend === "webgpu" ? "WebGPU" : "WebGL2"} · ${s.tier}${gpu ? ` · ${gpu.slice(0, 40)}` : ""}`,
        `${round(recent.fps)} fps · 1% ${round(period.fpsLow)} · CPU ${recent.frames ? round(recent.cpu / recent.frames, 2) : 0} ms`,
        `${calls} calls · ${compact(triangles)} tris · ${memory.geometries} geo · ${memory.textures} tex`,
        `×${round(renderer.getPixelRatio(), 2)} px · ${s.fps} fps cap · ${quality.concessions.join(", ") || "no concessions"}`,
        ...(firstFrame === null ? [] : [`first frame ${Math.round(firstFrame)} ms`]),
        ...(extra ? [extra()] : []),
      ].join("\n");
    }
    recent.reset();
  }

  function report() {
    if (!userIdKnown || period.frames < MIN_FRAMES) return;
    const body = {
      backend, gpu: gpu.slice(0, 160), width: host.clientWidth, height: host.clientHeight, dpr: round(renderer.getPixelRatio(), 2),
      tier: quality.settings.tier, fps_avg: round(period.fps), fps_p1: round(period.fpsLow),
      first_frame_ms: firstFrame === null ? null : Math.round(firstFrame), concessions: quality.concessions.slice(0, 12),
    };
    period.reset();
    // Telemetry never gets in the way: a missing endpoint or a network error is ignored.
    try { void request(TELEMETRY_PATH, { method: "POST", json: body }).catch(() => undefined); } catch { /* ignored */ }
  }

  const refreshTimer = window.setInterval(refresh, OVERLAY_EVERY), reportTimer = window.setInterval(report, REPORT_EVERY);
  const onHidden = () => { if (document.visibilityState === "hidden") report(); };
  window.addEventListener("pagehide", report);
  document.addEventListener("visibilitychange", onHidden);

  return {
    beginFrame() {
      began = performance.now();
      const gap = previous ? began - previous : 0;
      previous = began;
      // Pauses (hidden tab, scrolled away) are not frames.
      if (gap > 0 && gap <= MAX_GAP) { recent.add(gap); period.add(gap); }
    },
    endFrame() {
      const cpu = performance.now() - began;
      recent.cpu += cpu; period.cpu += cpu;
      calls = renderer.info.render.drawCalls; triangles = renderer.info.render.triangles;
    },
    markFirstFrame() {
      if (firstFrame !== null) return;
      firstFrame = performance.now() - start;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Leaving the city inside the app is the common way out: the last report goes now.
      report();
      clearInterval(refreshTimer); clearInterval(reportTimer);
      window.removeEventListener("pagehide", report);
      document.removeEventListener("visibilitychange", onHidden);
      overlay?.remove();
      for (const key of ["fps", "drawCalls", "triangles", "quality"]) delete host.dataset[key];
    },
  };
}
