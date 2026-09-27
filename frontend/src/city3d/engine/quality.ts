/**
 * Quality for this browser (TZ §8): the first tier from the device, the adaptive controller from
 * qualityCore.ts, and the manual choice from the "Ещё → Качество города" menu, which is remembered
 * per device and switches adaptation off.
 */
import type { QualitySettings, QualityTier } from "./qualityTypes";
import { TIERS, baseSettings, createAdapter, initialTier, type Adapter, type DeviceInfo } from "./qualityCore";

export const QUALITY_KEY = "city3d.quality";

export interface QualityOptions {
  backend: "webgpu" | "webgl2";
  mobile: boolean;
  /** GPU name from createRenderer(). */
  gpu: string;
  /** True while frames are not the device's pace (loading chunks, compiling shaders): they are not measured. */
  busy?: () => boolean;
  /** Overrides for tests; missing fields are read from the browser. */
  device?: Partial<DeviceInfo>;
  /** localStorage by default; null keeps the manual choice for this visit only. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export interface QualityControl {
  readonly settings: QualitySettings;
  /** Concessions the adaptation made, for the stats overlay and telemetry (e.g. ["ao", "water:sky"]). */
  readonly concessions: string[];
  /** The tier picked for this device, and the manual choice if there is one. */
  readonly auto: QualityTier;
  readonly manual: QualityTier | null;
  onChange(cb: (settings: QualitySettings) => void): () => void;
  /** One drawn frame: the time since the previous one (Infinity after a pause), and now, in ms. */
  frame(gap: number, now: number): void;
  setManual(tier: QualityTier | null): void;
  dispose(): void;
}

/** Reads the device facts of TZ §8.1 from the browser. */
export function detectDevice(backend: DeviceInfo["backend"], mobile: boolean, gpu: string): DeviceInfo {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const ua = nav?.userAgent ?? "";
  // iPadOS reports itself as a Mac; touch gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  const screen = typeof window === "undefined" ? undefined : window.screen;
  return {
    backend, mobile: mobile || ios, ios, cores: nav?.hardwareConcurrency || 4, gpu,
    width: screen?.width ?? 1920, height: screen?.height ?? 1080, dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  };
}

function defaultStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function createQuality(options: QualityOptions): QualityControl {
  const device = { ...detectDevice(options.backend, options.mobile, options.gpu), ...options.device };
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const auto = initialTier(device);
  const listeners = new Set<(settings: QualitySettings) => void>();
  let manual = readManual(), adapter: Adapter | null = null, settings: QualitySettings;
  let concessions: string[] = [];

  function readManual(): QualityTier | null {
    try { const value = storage?.getItem(QUALITY_KEY); return TIERS.includes(value as QualityTier) ? value as QualityTier : null; } catch { return null; }
  }
  function configure() {
    adapter = manual ? null : createAdapter(baseSettings(auto, device));
    settings = adapter ? adapter.settings : baseSettings(manual!, device);
    concessions = [];
  }
  const emit = () => listeners.forEach(cb => cb(settings));
  configure();

  return {
    get settings() { return settings; },
    get concessions() { return concessions; },
    auto,
    get manual() { return manual; },
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    frame(gap, now) {
      if (!adapter || !adapter.frame(gap, now, options.busy?.() ?? false)) return;
      settings = adapter.settings; concessions = adapter.concessions;
      emit();
    },
    setManual(tier) {
      if (tier === manual) return;
      manual = tier;
      try { if (tier) storage?.setItem(QUALITY_KEY, tier); else storage?.removeItem(QUALITY_KEY); } catch { /* Private mode: this visit only. */ }
      configure(); emit();
    },
    dispose() { listeners.clear(); adapter = null; },
  };
}
