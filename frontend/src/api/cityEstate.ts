/**
 * Team district land (docs/CITY_ESTATES.md): every city is cut into three districts of plots, and operators buy
 * them one by one, each with a square or a house on it. The client names the plot and what stands on it; the
 * server owns the price, the rules and the order of operations. Every change carries an idempotency key made once
 * per user action: a retry with the same key never pays twice, and a lost answer is looked up by that key.
 */
import { ApiError, request } from "./client";
import type { DepartmentId } from "./cityWorld";
import type { PlotFamily, ProjectFamily } from "../city3d/world/estateGrid";

export type { PlotFamily, ProjectFamily };
/**
 * Where a building stands: on plots `module` is the block, `u` the column and `v` the row of its first plot, and
 * w × h are plots; on the public square (module 0) they are cells.
 */
export interface Footprint { module: number | null; u: number | null; v: number | null; w: number; h: number; rotation: number }
/** A building as everyone sees it: shape and stage, never what it cost or whose it is, except "mine". The district's own stand on its square. */
export interface PublicObject extends Footprint { id: number; family: PlotFamily | ProjectFamily; level: number; owner: "mine" | "resident" | "district" }
export interface DistrictProject extends Footprint {
  id: number; family: ProjectFamily; name: string; level: number; level_name: string; target_id: number | null;
  cost: number; status: "open" | "built" | "cancelled"; mine: number; version: number;
  /** Coarse quarters; null when the team is too small to show it without giving away one person's sum. */
  progress: number | null;
  /** Staff only. */
  funded?: number;
}
/** A district's land: plots for sale and taken, band by band from the centre; bands open outwards as they fill. */
export interface DistrictLandState { plots: number; taken: number; open_band: number; bands: { band: number; plots: number; taken: number }[] }
/** One complex occupying the district's entire central square; its level grows with personal building. */
export interface DistrictLandmark {
  status: "active" | "legacy_occupied";
  level: number; name: string;
  module: 0; u: 0; v: 0; w: 12; h: 12; rotation: 0;
  taken: number; plots: number; peak: number;
  next: { level: number; name: string; need: number; remaining: number; percent: number } | null;
}
export interface DistrictEstate {
  id: string; name: string; number: number; construction: boolean; mine: boolean; managed: boolean;
  /** Null where the district has no land (beyond the three of a city). */
  land: DistrictLandState | null;
  /** Null for unprepared land; previous shared buildings remain on legacy_occupied squares. */
  landmark: DistrictLandmark | null;
  hq: { level: number; name: string; built: number; next: { level: number; name: string; need: number } | null };
  objects: PublicObject[]; projects: DistrictProject[]; version: number;
}
export interface CityEstates {
  city: DepartmentId; districts: DistrictEstate[];
  /** The administrators' test city (citySandbox below), drawn on the same land under the same district ids. */
  sandbox?: true;
}

export interface OwnObject extends Footprint {
  id: number; family: PlotFamily; level: number; state: "placed" | "stored"; district_id: string;
  source: "purchase" | "merge" | "project" | "legacy"; paid: number; version: number; created_at: string;
  /** How many squares went into a park. */
  squares: number;
}
export interface PlotLevel { level: number; name: string; about: string; price: number }
/** `ready`: a house or office building bought finished at one price (world/familyHouses.ts, officeBuildings.ts). */
export interface PlotCatalogue { family: PlotFamily; name: string; icon: string; size: [number, number]; squares: number | null; ready: boolean; levels: PlotLevel[] }
export interface ProjectLevel { level: number; name: string; about: string; cost: number }
export interface ProjectCatalogue { family: ProjectFamily; name: string; icon: string; size: [number, number]; project: "main" | "small"; levels: ProjectLevel[] }
export type EstateStatus = "ready" | "closed" | "no_team" | "no_land" | "staff";
export interface MyEstate {
  status: EstateStatus; message: string | null;
  district: { id: string; city: DepartmentId; name: string } | null;
  objects: OwnObject[]; catalogue: PlotCatalogue[]; projects: ProjectCatalogue[];
  /** Coins for a plot of each band, from the centre outwards. */
  land_prices: number[];
  economy_revision: number; balance: number; available: number;
  legacy: { count: number; paid: number }; managed: string[];
}
export interface OperationResult { replayed: boolean; object?: OwnObject | PublicObject; merged?: boolean; price?: number; balance?: number; available?: number; accepted?: number; completed?: boolean; project?: DistrictProject; refunded?: number }
export interface EstateReport {
  districts: { id: string; city: DepartmentId; name: string; construction: boolean; operators: number; builders: number; land: { plots: number; taken: number; open_band: number } | null; buildings: number; open_projects: number; hq_level: number; built_projects: number }[];
  operators_without_district: number; inventory: number;
  legacy: { buildings: number; operators: number; paid: number };
  coins: { buildings: number; contributions: number; refunded: number };
}

/** A fresh idempotency key for one user action; the same key is reused when that action is retried. */
export function operationKey() {
  const random = globalThis.crypto?.randomUUID?.();
  return (random ?? Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("")).replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Sends a change; when the answer is lost (no connection, a gateway error), asks the server whether the
 * operation with this key was done before reporting a failure, so the interface never offers to pay twice.
 */
async function keyed<T extends OperationResult>(key: string, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 0 && error.status < 500)) throw error;
    const status = await request<{ status: "done" | "unknown"; result?: T }>(`/api/v1/learning/city/operations/${key}`).catch(() => null);
    if (status?.status === "done" && status.result) return { ...status.result, replayed: true };
    throw error;
  }
}

const post = <T extends OperationResult>(path: string, json: { key: string } & Record<string, unknown>) =>
  keyed(json.key, () => request<T>(`/api/v1/learning/city${path}`, { method: "POST", json }));

export const cityEstate = {
  city: (city: DepartmentId) => request<CityEstates>(`/api/v1/learning/city/cities/${city}`),
  mine: () => request<MyEstate>("/api/v1/learning/city/estate"),
  purchase: (json: { key: string; family: PlotFamily; block: number; col: number; row: number; economy_revision: number }) => post("/plots", json),
  upgrade: (id: number, json: { key: string; version: number; economy_revision: number }) => post(`/buildings/${id}/upgrade`, json),
  place: (id: number, json: { key: string; version: number; block: number; col: number; row: number; rotation: number }) => post(`/buildings/${id}/place`, json),
  openProject: (json: { key: string; district_id: string; family: ProjectFamily; economy_revision: number; target_id?: number; module?: number; u?: number; v?: number; rotation?: number }) => post("/projects", json),
  contribute: (id: number, json: { key: string; amount: number; up_to: boolean }) => post(`/projects/${id}/contributions`, json),
  cancel: (id: number, json: { key: string }) => post(`/projects/${id}/cancel`, json),
  report: () => request<EstateReport>("/api/v1/admin/learning/city/estates"),
};

/**
 * The administrators' test city (app/services/city_sandbox.py): a copy of a city's three districts that only
 * administrators see, on the same land and by the same rules, where they build for free, set any stage up or down,
 * take buildings away, open bands, set the headquarters' stage and build or cancel shared projects at once. It never
 * touches the real districts, operators or coins, so its changes need no idempotency key: none of them pays.
 */
export interface SandboxResult { object?: PublicObject; merged?: boolean; removed?: number; project?: number; cancelled?: number; open_band?: number; hq_level?: number; landmark_level?: number; reset?: boolean }
const SANDBOX = "/api/v1/admin/learning/city/sandbox";
export const citySandbox = {
  city: (city: DepartmentId) => request<CityEstates>(`${SANDBOX}/cities/${city}`),
  build: (json: { district_id: string; family: PlotFamily; block: number; col: number; row: number }) => request<SandboxResult>(`${SANDBOX}/plots`, { method: "POST", json }),
  level: (id: number, level: number) => request<SandboxResult>(`${SANDBOX}/buildings/${id}/level`, { method: "POST", json: { level } }),
  remove: (id: number) => request<SandboxResult>(`${SANDBOX}/buildings/${id}`, { method: "DELETE" }),
  district: (id: string, json: { open_band?: number; hq_level?: number; landmark_level?: number }) => request<SandboxResult>(`${SANDBOX}/districts/${id}`, { method: "PUT", json }),
  openProject: (json: { district_id: string; family: ProjectFamily; target_id?: number; u?: number; v?: number; rotation?: number }) => request<SandboxResult>(`${SANDBOX}/projects`, { method: "POST", json }),
  complete: (id: number) => request<SandboxResult>(`${SANDBOX}/projects/${id}/complete`, { method: "POST" }),
  cancel: (id: number) => request<SandboxResult>(`${SANDBOX}/projects/${id}`, { method: "DELETE" }),
  reset: (city: DepartmentId) => request<SandboxResult>(`${SANDBOX}/cities/${city}/reset`, { method: "POST" }),
};
