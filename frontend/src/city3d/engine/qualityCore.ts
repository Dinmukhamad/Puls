/**
 * Quality tiers and the adaptive controller (TZ §8), as plain logic with no three.js or DOM, so Node
 * tests can simulate devices. `engine/quality.ts` wires it to the browser.
 */
import type { QualitySettings, QualityTier } from "./qualityTypes";

export const TIERS: QualityTier[] = ["low", "medium", "high", "ultra"];

/** What the first guess is made from (TZ §8.1). */
export interface DeviceInfo {
  backend: "webgpu" | "webgl2";
  mobile: boolean;
  /** iPhone or iPad: "medium" by default, 60 frames a second on it (TZ §1.2). */
  ios: boolean;
  cores: number;
  /** Screen size in CSS pixels and the device pixel ratio. */
  width: number; height: number; dpr: number;
  /** WEBGL_debug_renderer_info ("ANGLE (Intel, Intel(R) UHD Graphics 620 …)") or the WebGPU adapter ("intel gen-9"). */
  gpu: string;
}

const lower = (tier: QualityTier) => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)];
const atMost = (tier: QualityTier, cap: QualityTier) => TIERS[Math.min(TIERS.indexOf(tier), TIERS.indexOf(cap))];

/** Software rasterisers: the city still opens, on the lightest settings. */
const SOFTWARE = /swiftshader|llvmpipe|lavapipe|softpipe|software|basic render/;
/**
 * Known weak GPUs and the highest tier they start at; the first match wins. Intel before Skylake (HD 4000–6000,
 * WebGPU "gen-7/8"), old Mali, Adreno up to 5xx, PowerVR and pre-2015 discrete cards start low; other integrated
 * graphics (Intel UHD / Iris, AMD APUs, GeForce MX) start medium. Intel Arc is discrete and is not capped.
 */
const GPU_CAPS: [RegExp, QualityTier][] = [
  [/\bgma\b|hd graphics( [2-6]\d{3})?\b(?! [5-6]\d\d)|gen-[4-8]\b|mali-(t|4|g5[0-2])|adreno[^\d]{0,6}([1-4]\d\d|50\d)\b|powervr|\bsgx|radeon hd [2-7]\d{3}|geforce (gt )?[1-7]\d\d\b/, "low"],
  [/intel.*\barc\b|xe-hpg|alchemist/, "ultra"],
  [/intel|mali|adreno|radeon[^,]*?(graphics|vega)|geforce mx|\d{3}mx\b|apple a1[0-3]\b/, "medium"],
];
/** Cards that take planar reflections at 60 frames a second: "ultra" on desktop WebGPU. */
const STRONG = /rtx [2-9]0[6-9]0|rtx [4-9]0[5-9]0|radeon rx [6-9][6-9]\d\d|apple m\d+ (pro|max|ultra)|\b(ampere|ada|lovelace|blackwell)\b|rdna-[34]/;
/** Screens above this many device pixels (4K, 5K) cost a tier: 1440p is 3.7 M. */
const BIG_SCREEN = 6e6;

/** The first guess of the tier (TZ §8.1): phones "medium", desktops "high", adjusted by GPU, cores and screen. */
export function initialTier(device: DeviceInfo): QualityTier {
  const gpu = device.gpu.toLowerCase();
  if (SOFTWARE.test(gpu)) return "low";
  const cap = GPU_CAPS.find(([pattern]) => pattern.test(gpu))?.[1] ?? "ultra";
  if (device.ios) return atMost("medium", cap);
  if (device.mobile) return device.cores <= 4 ? "low" : atMost("medium", cap);
  let tier: QualityTier = STRONG.test(gpu) && device.backend === "webgpu" && device.cores >= 8 ? "ultra" : "high";
  tier = atMost(tier, device.cores <= 2 ? "low" : device.cores <= 4 ? "medium" : cap);
  if (device.width * device.height * Math.min(device.dpr, 2) ** 2 > BIG_SCREEN) tier = lower(tier);
  // The WebGL2 fallback has no compute and slower draws: at most "high" (TZ §1.3.5 allows "medium").
  return device.backend === "webgl2" ? atMost(tier, "high") : tier;
}

/** Settings of each tier (TZ §8.1 table; LOD distances from TZ §5.3). */
export function settingsFor(tier: QualityTier): QualitySettings {
  const top = tier === "ultra" || tier === "high";
  return {
    tier, resolution: 1, fps: 60,
    dynamicShadowSize: top ? 2048 : tier === "medium" ? 1024 : 0,
    staticShadowSize: top ? 4096 : tier === "medium" ? 2048 : 1024,
    ao: top, bloom: tier !== "low", tiltShift: top,
    waterReflections: tier === "ultra" ? "planar" : tier === "high" ? "ssr" : "sky",
    lodDistances: tier === "ultra" ? [50, 150, 300] : tier === "high" ? [40, 120, 250] : tier === "medium" ? [32, 100, 220] : [25, 80, 180],
    crowd: tier === "low" ? .5 : 1,
  };
}

/** Tier settings for this device: Android phones aim at 30 frames a second, iPhones at 60 on "medium" (TZ §1.2). */
export function baseSettings(tier: QualityTier, device: Pick<DeviceInfo, "mobile" | "ios">): QualitySettings {
  const settings = settingsFor(tier);
  if (device.mobile && (!device.ios || tier === "high" || tier === "ultra")) settings.fps = 30;
  return settings;
}

/** One concession of TZ §8.2. Each sets a ceiling, so nested steps (2048 → 1024 → 0) combine in any order. */
export interface Step { id: string; apply: (s: QualitySettings) => void }
export const STEPS: Step[] = [
  { id: "ao", apply: s => { s.ao = false; } },
  { id: "water:sky", apply: s => { s.waterReflections = "sky"; } },
  { id: "shadows:1024", apply: s => { s.dynamicShadowSize = Math.min(s.dynamicShadowSize, 1024) as 0 | 1024; } },
  { id: "shadows:0", apply: s => { s.dynamicShadowSize = 0; } },
  { id: "crowd:0.5", apply: s => { s.crowd = Math.min(s.crowd, .5); } },
  { id: "fps:30", apply: s => { s.fps = 30; } },
  { id: "resolution:0.9", apply: s => { s.resolution = Math.min(s.resolution, .9); } },
  { id: "resolution:0.8", apply: s => { s.resolution = Math.min(s.resolution, .8); } },
];

/** Measuring window, thresholds and retry pauses of TZ §8.2. */
export const WINDOW = 1000, SLOW = 1.45, SMOOTH = 1.12, CALM_WINDOWS = 3, RETRY = 30000, RETRY_MAX = 300000;

export interface Adapter {
  readonly settings: QualitySettings;
  /** Concessions in effect, in table order (e.g. ["ao", "water:sky"]). */
  readonly concessions: string[];
  /** Feeds one drawn frame; returns true when the settings changed. */
  frame(gap: number, now: number, busy?: boolean): boolean;
}

/**
 * The adaptive controller. Frame gaps are averaged over 1 s windows. A window slower than 1.45 × the budget
 * takes the next concession of the table; three windows under 1.12 × the budget give the last one back, but
 * not a step whose absence was too slow in the last 30 s.
 *
 * Refinements over the old city's stack of steps:
 * - 30 frames a second may stay while earlier steps come back: it changes smoothness, not the picture. So a
 *   device whose rate is capped elsewhere (Safari Low Power Mode, Chrome Energy Saver, a 30 Hz screen) or a
 *   GPU that fits a full frame into 33 ms ends at 30 fps with everything else restored. Pixels stay the last
 *   resort: nothing earlier in the table returns while resolution is lowered.
 * - A concession that did not make frames faster is not blocked for 30 s, so it can come back soon.
 * - A step given back that makes frames slow again is taken back at once and blocked for 60 s, doubling with
 *   each failure up to 5 min; a failed retry also pauses all retries for 30 s, doubling in a row. Retries are
 *   the only thing that can make quality blink, so in steady state they thin out to one every few minutes.
 */
export function createAdapter(base: QualitySettings): Adapter {
  const steps = STEPS.filter(step => differs(base, compose(base, [step])));
  let applied: Step[] = [], settings = { ...base };
  const blocked = new Map<Step, number>(), fails = new Map<Step, number>();
  let spent = 0, frames = 0, calm = 0, streak = 0, quietUntil = 0;
  /** The step just given back, on trial for two windows; the last concession, judged by the next window. */
  let trial: { step: Step; windows: number } | null = null, judged: { step: Step; before: number } | null = null;

  const inTable = (list: Step[]) => steps.filter(step => list.includes(step));
  const set = (next: Step[]) => { applied = inTable(next); settings = compose(base, applied); return true; };
  const pause = (n: number) => Math.min(RETRY_MAX, RETRY * 2 ** n);

  function giveBackCandidate(now: number) {
    for (const step of [...applied].reverse()) {
      if ((blocked.get(step) ?? 0) <= now && differs(settings, compose(base, applied.filter(s => s !== step)))) return step;
      if (step.id !== "fps:30") return null;
    }
    return null;
  }

  function judge(average: number, now: number): boolean {
    const budget = 1000 / settings.fps;
    if (judged) {
      // 30 frames a second changes the budget, not the frame time, so it is never judged.
      if (judged.step.id !== "fps:30" && average >= judged.before * .95) blocked.delete(judged.step);
      judged = null;
    }
    if (average > budget * SLOW) {
      calm = 0;
      if (trial) {
        const { step } = trial, n = (fails.get(step) ?? 0) + 1;
        trial = null; fails.set(step, n); blocked.set(step, now + pause(n));
        quietUntil = now + pause(streak++);
        return set([...applied, step]);
      }
      const step = steps.find(s => !applied.includes(s) && differs(settings, compose(base, [...applied, s])));
      if (!step) return false;
      // The settings without it were too slow: not retried for 30 s unless it proves useless.
      blocked.set(step, now + RETRY); judged = { step, before: average };
      return set([...applied, step]);
    }
    if (trial && --trial.windows === 0) { fails.delete(trial.step); streak = 0; trial = null; }
    if (average >= budget * SMOOTH) { calm = 0; return false; }
    if (++calm < CALM_WINDOWS || now < quietUntil) return false;
    const step = giveBackCandidate(now);
    if (!step) return false;
    calm = 0; trial = { step, windows: 2 };
    return set(applied.filter(s => s !== step));
  }

  return {
    get settings() { return settings; },
    get concessions() { return applied.map(step => step.id); },
    frame(gap, now, busy = false) {
      // Loading and shader compiles are not the device's pace; pauses restart the window.
      if (busy) return false;
      if (gap > WINDOW) { spent = frames = 0; return false; }
      // A one-off hitch (a compile, a big upload) is skipped rather than averaged in.
      if (frames > 3 && gap > 250 && gap > 4 * spent / frames) return false;
      spent += gap; frames++;
      if (spent < WINDOW) return false;
      const average = spent / frames;
      spent = frames = 0;
      return judge(average, now);
    },
  };
}

function compose(base: QualitySettings, steps: Step[]): QualitySettings {
  const settings = { ...base, lodDistances: [...base.lodDistances] as QualitySettings["lodDistances"] };
  for (const step of steps) step.apply(settings);
  return settings;
}

function differs(a: QualitySettings, b: QualitySettings) {
  return a.ao !== b.ao || a.waterReflections !== b.waterReflections || a.dynamicShadowSize !== b.dynamicShadowSize ||
    a.crowd !== b.crowd || a.fps !== b.fps || a.resolution !== b.resolution;
}
