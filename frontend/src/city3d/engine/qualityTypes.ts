/** Quality tiers (TZ §8.1). The adaptive controller (engine/quality.ts) moves between these settings. */
export type QualityTier = "ultra" | "high" | "medium" | "low";

export interface QualitySettings {
  tier: QualityTier;
  /** Pixel ratio multiplier on top of the device ratio cap; never below 0.8 (TZ §8.2). */
  resolution: number;
  /** 60 or 30 frames a second. */
  fps: 60 | 30;
  /** Real-time shadow map size for moving objects; 0 = blob shadows only. */
  dynamicShadowSize: 0 | 1024 | 2048;
  /** Static shadow map size (drawn once, TZ §6.4, until baked lightmaps arrive in stage 3). */
  staticShadowSize: 1024 | 2048 | 4096;
  /** Post effects. */
  ao: boolean; bloom: boolean; tiltShift: boolean; waterReflections: "planar" | "ssr" | "sky";
  /** Distances (world units) where LOD levels switch: LOD0 → LOD1 → LOD2 → hidden (impostor in stage 3). */
  lodDistances: [number, number, number];
  /** Traffic and pedestrians density share, 0…1. */
  crowd: number;
}
