/**
 * Public contract of the city v3 scene. It matches the old `pages/city/cityScene.ts` API, so
 * `CityMap.tsx` switches engines without changes to the page (TZ §9.1). `onProgress` is new.
 */
import type { DistrictId } from "../api/city";
import type { BuildingKey } from "./world/plots";
import type { SiteStage } from "./world/sites";

export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean; level: number }
export interface CityMascot { gender: "male" | "female" | null; name: string }
export type TimeOfDay = "day" | "night";
/** An operator's plot as the server reports it (api/city.ts CityPlot). */
/** A group quarter as the server reports it; no list at all means no group, and every quarter stands built. */
export interface CitySiteInfo { key: string; name: string; stage: SiteStage }
/** A daily situation as the server reports it (api/city.ts CityQuest): only whether it waits on the map matters here. */
export interface CityQuestInfo { slot: number; giver: string; answered: boolean }
export interface CityPlotInfo { key: string; unlocked: boolean; item: BuildingKey | null }

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
  timeOfDay?: TimeOfDay;
  /** The operator's plots; `onPlot` (only when the viewer may build) opens the catalogue for an empty open plot. */
  plots?: CityPlotInfo[];
  onPlot?: (key: string) => void;
  /** The group city's quarters (null: no group); `onSite` opens the group panel from the sign over the one being built. */
  sites?: CitySiteInfo[] | null;
  onSite?: (key: string) => void;
  /** Today's situations; `onQuest` (only for the operator themself) opens one from its "!" on the map. */
  quests?: CityQuestInfo[];
  onQuest?: (slot: number) => void;
  onSelect: (id: DistrictId) => void; onView: (view: CityView) => void; onReady: () => void; onLost: () => void;
  onRestored?: () => void;
  /** Loading progress, 0…1, for the loading screen. */
  onProgress?: (share: number) => void;
}

export interface CityControl {
  setTimeOfDay(mode: TimeOfDay): void;
  focusMascot: () => void; setMascot: (mascot: CityMascot) => void; setTraffic: (enabled: boolean) => void;
  select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void;
  setPlots: (plots: CityPlotInfo[]) => void;
  /** Flies to a plot, e.g. to show what was just built there. */
  focusPlot: (key: string) => void;
  setSites: (sites: CitySiteInfo[] | null) => void;
  focusSite: (key: string) => void;
  setQuests: (quests: CityQuestInfo[]) => void;
  focusQuest: (slot: number) => void;
  zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void;
  dispose: () => void;
}
