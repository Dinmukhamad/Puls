/**
 * Public contract of the city v3 scene. It matches the old `pages/city/cityScene.ts` API, so
 * `CityMap.tsx` switches engines without changes to the page (TZ §9.1). `onProgress` is new.
 */
import type { DistrictId } from "../api/city";

export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean; level: number }
export interface CityMascot { gender: "male" | "female" | null; name: string }

export interface CityOptions {
  levels: Record<string, number>; selected: DistrictId; view?: CityView; labels: CityLabelInfo[];
  /** Districts that levelled up since the last visit: they grow in with a burst of confetti. */
  grown?: DistrictId[];
  mascot?: CityMascot;
  /** The part of the screen the panels leave free; the city is centred there. */
  frame?: HTMLElement;
  /** Which world to build: the current city or the ×4 test city (staff only, `?world=x4`). */
  world?: "v1" | "x4";
  /** Force the WebGL2 backend (`?backend=webgl`), for tests and comparison. */
  forceWebGL?: boolean;
  /** Show the stats overlay (`?stats=1`, staff only). */
  stats?: boolean;
  onSelect: (id: DistrictId) => void; onView: (view: CityView) => void; onReady: () => void; onLost: () => void;
  onRestored?: () => void;
  /** Loading progress, 0…1, for the loading screen. */
  onProgress?: (share: number) => void;
}

export interface CityControl {
  focusMascot: () => void; setMascot: (mascot: CityMascot) => void; setTraffic: (enabled: boolean) => void;
  select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void;
  zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void;
  dispose: () => void;
}
