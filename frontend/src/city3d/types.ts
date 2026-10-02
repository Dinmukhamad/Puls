/**
 * Public contract of the city scene for `pages/city/CityMap.tsx` (TZ §9.1).
 */
import type { DistrictId } from "../api/city";
import type { BuildingKey } from "./world/plots";
import type { SiteStage } from "./world/sites";
import type { CityWorld, DepartmentId } from "../api/cityWorld";
import type { CityEstates } from "../api/cityEstate";
import type { PlotFamily, ProjectFamily } from "./world/estateGrid";
export type JourneyPhase = "departing" | "tunnel" | "arriving" | null;

/** Team district land of the city on screen (api/cityEstate.ts): plots, buildings, projects, open bands. */
export interface CityEstateView { state: CityEstates }
/** A plot of a district's land: block, column and row (world/land.ts). */
export interface PlotAddress { block: number; col: number; row: number }
/**
 * Build mode in a district: its plots light up (those for sale in its open bands), or for staff the cells of its
 * public square; a building from the inventory (`moving`) or a shared project being placed; the building
 * selected; the plot picked for a purchase.
 */
export interface CityBuildView {
  district: string; area: "plots" | "public";
  placing: { family: PlotFamily | ProjectFamily; rotation: number; moving: number | null } | null;
  selected: number | null;
  plot: PlotAddress | null;
}
/** What the operator touched on district land, or where the preview stands now and why it does not fit. */
export type EstatePick =
  | { kind: "public"; district: string }
  | { kind: "plot"; district: string; block: number; col: number; row: number; band: number; problem: string | null }
  | { kind: "place"; district: string; module: number; u: number; v: number; rotation: number; problem: string | null }
  | { kind: "object"; district: string; object: number }
  | { kind: "project"; district: string; project: number };
/** What the camera flies to: a district's centre or public square, a plot, a building. */
export interface EstateTarget { district: string; kind: "district" | "public" | "plot" | "object"; object?: number; plot?: PlotAddress }

export interface CityView { azimuth: number; polar: number; distance: number; target: [number, number, number] }
export interface CityLabelInfo { id: DistrictId; name: string; status: string; icon: string; soon: boolean; reward: boolean; level: number }
export interface CityMascot { gender: "male" | "female" | null; name: string }
export type TimeOfDay = "day" | "night";
/** How the mouse and one finger move the camera: "orbit" — as before (drag turns, right button moves), "map" — like a map. */
export type CityControlScheme = "orbit" | "map";
/** An operator's plot as the server reports it (api/city.ts CityPlot). */
/** A group quarter as the server reports it; no list at all means no group, and every quarter stands built. */
export interface CitySiteInfo { key: string; name: string; stage: SiteStage }
/** A daily situation as the server reports it (api/city.ts CityQuest): only whether it waits on the map matters here. */
export interface CityQuestInfo { slot: number; giver: string; answered: boolean }
export interface CityPlotInfo { key: string; unlocked: boolean; item: BuildingKey | null }

export interface CityOptions {
  department?: DepartmentId;
  departmentWorld?: CityWorld;
  /** Team district land of both cities; `onEstate` reports taps on it and the build preview. */
  estates?: Partial<Record<DepartmentId, CityEstateView>>;
  build?: CityBuildView | null;
  onEstate?: (pick: EstatePick) => void;
  onWorldPick?: (id: string) => void;
  onArrival?: (id: DepartmentId) => void;
  onJourney?: (phase: JourneyPhase) => void;
  levels: Record<string, number>; selected: DistrictId; view?: CityView; labels: CityLabelInfo[];
  /** Initial activity while the renderer is being prepared asynchronously. */
  active?: boolean;
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
  /** The camera scheme the operator chose; "orbit" if not given. */
  controls?: CityControlScheme;
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
  setDepartment(id: DepartmentId): void;
  setDepartmentWorld(config: CityWorld): void;
  setEstates(city: DepartmentId, view: CityEstateView | null): void;
  setBuild(view: CityBuildView | null): void;
  /** Flies to a district's centre or square, a plot or a building. */
  focusEstate(target: EstateTarget): void;
  focusWorld(id: string): void;
  travelTo(id: DepartmentId): void;
  skipTravel(): void;
  setTimeOfDay(mode: TimeOfDay): void;
  /** Pauses a retained scene while its page is hidden. */
  setActive(active: boolean): void;
  focusMascot: () => void; setMascot: (mascot: CityMascot) => void; setTraffic: (enabled: boolean) => void;
  select: (id: DistrictId) => void; setLabels: (labels: CityLabelInfo[]) => void;
  /** Refreshes changed district buildings while retaining the live city and camera. */
  setLevels: (levels: Record<string, number>, grown?: DistrictId[]) => void;
  setPlots: (plots: CityPlotInfo[]) => void;
  /** Flies to a plot, e.g. to show what was just built there. */
  focusPlot: (key: string) => void;
  setSites: (sites: CitySiteInfo[] | null) => void;
  focusSite: (key: string) => void;
  setQuests: (quests: CityQuestInfo[]) => void;
  focusQuest: (slot: number) => void;
  zoom: (factor: number) => void; rotate: (radians: number) => void; tilt: (radians: number) => void; reset: () => void;
  setControls: (scheme: CityControlScheme) => void;
  dispose: () => void;
}
