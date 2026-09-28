/**
 * The city's night level shared by every light (TZ §6.7): 0 in the day, 1 at night, eased over about
 * 1.5 s when the mode switches. Materials read `level` in TSL (e.g. emissiveNode = glow.mul(level)), so
 * turning the lights on or off costs no draw calls, no rebuilt materials and no per-frame CPU work;
 * CPU code that needs it (visibility of light pools, bloom strength) reads `level.value`.
 */
import { uniform } from "three/tsl";

export interface Night {
  /** TSL uniform, 0…1. */
  readonly level: ReturnType<typeof uniform<number>>;
  /** Target: night or day. `instant` skips the easing (first frame, reduced motion). */
  set(night: boolean, instant?: boolean): void;
  /** Eases towards the target; call once per frame. Returns true while it is still changing. */
  step(dt: number): boolean;
}

export function createNight(initial = false): Night {
  const level = uniform(initial ? 1 : 0);
  let target = initial ? 1 : 0;
  return {
    level,
    set(night, instant = false) { target = night ? 1 : 0; if (instant) level.value = target; },
    step(dt) {
      const value = level.value as number;
      if (value === target) return false;
      const next = value + Math.sign(target - value) * dt / 1.5;
      level.value = target > value ? Math.min(target, next) : Math.max(target, next);
      return true;
    },
  };
}
