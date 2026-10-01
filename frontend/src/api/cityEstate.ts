/**
 * Team district land (docs/CITY_ESTATES.md). The client names a building and its cells; the server owns the
 * price, the rules and the order of operations. Every change carries an idempotency key made once per user
 * action: a retry with the same key never pays twice, and a lost answer is looked up by that key.
 */
import { ApiError, request } from "./client";
import type { DepartmentId } from "./cityWorld";

export type EstateFamily = "square" | "gazebo" | "fountain" | "sports" | "park" | "house" | "tower";
export type ModuleKind = "public" | "business" | "residential";
export interface Footprint { module: number | null; u: number | null; v: number | null; w: number; h: number; rotation: number }
/** A building as everyone sees it: shape and stage, never what it cost or whose it is, except "mine". */
export interface PublicObject extends Footprint { id: number; family: EstateFamily; level: number; owner: "mine" | "resident" | "district" }
export interface DistrictProject extends Footprint {
  id: number; family: EstateFamily; name: string; level: number; level_name: string; target_id: number | null;
  cost: number; status: "open" | "built" | "cancelled"; mine: number; version: number;
  /** Coarse quarters; null when the team is too small to show it without giving away one person's sum. */
  progress: number | null;
  /** Staff only. */
  funded?: number;
}
export interface DistrictEstate {
  id: string; name: string; number: number; construction: boolean; mine: boolean; managed: boolean;
  modules: { slot: number; kind: ModuleKind }[];
  estates: { total: number; taken: number };
  hq: { level: number; name: string; built: number; next: { level: number; name: string; need: number } | null };
  objects: PublicObject[]; projects: DistrictProject[]; version: number;
}
export interface CityEstates { city: DepartmentId; districts: DistrictEstate[] }

export interface OwnObject extends Footprint {
  id: number; family: EstateFamily; level: number; state: "placed" | "stored"; district_id: string;
  source: "purchase" | "merge" | "project" | "legacy"; paid: number; version: number; created_at: string; components: number;
}
export interface CatalogueLevel { level: number; name: string; about: string; price: number; project_cost: number | null }
export interface CatalogueFamily { family: EstateFamily; name: string; icon: string; size: [number, number]; zone: "garden" | "house" | "lot"; project: "main" | "small" | null; recipe: boolean; levels: CatalogueLevel[] }
export interface Lot { district_id: string; module: number; index: number; u: number; v: number }
export type EstateStatus = "ready" | "closed" | "no_team" | "no_land" | "staff";
export interface MyEstate {
  status: EstateStatus; message: string | null;
  district: { id: string; city: DepartmentId; name: string } | null;
  estate: Lot | null; tower_lot: Lot | null; objects: OwnObject[]; catalogue: CatalogueFamily[];
  economy_revision: number; balance: number; available: number;
  legacy: { count: number; paid: number }; managed: string[];
}
export interface OperationResult { replayed: boolean; object?: OwnObject | PublicObject; price?: number; balance?: number; available?: number; accepted?: number; completed?: boolean; project?: DistrictProject; refunded?: number }
export interface EstateReport {
  districts: { id: string; city: DepartmentId; name: string; construction: boolean; modules: number; operators: number; estates: { total: number; taken: number }; needs_expansion: boolean; buildings: number; inventory: number; open_projects: number; hq_level: number; built_projects: number }[];
  operators_without_district: number; inventory: number;
  legacy: { buildings: number; operators: number; paid: number };
  coins: { buildings: number; contributions: number };
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
  claim: () => request<Lot>("/api/v1/learning/city/estate", { method: "POST" }),
  purchase: (json: { key: string; family: EstateFamily; module: number; u: number; v: number; rotation: number; economy_revision: number }) => post("/buildings", json),
  upgrade: (id: number, json: { key: string; version: number; economy_revision: number }) => post(`/buildings/${id}/upgrade`, json),
  move: (id: number, json: { key: string; version: number; module: number; u: number; v: number; rotation: number }) => post(`/buildings/${id}/move`, json),
  store: (id: number, json: { key: string; version: number }) => post(`/buildings/${id}/store`, json),
  merge: (json: { key: string; ids: number[]; economy_revision: number }) => post("/buildings/merge", json),
  openProject: (json: { key: string; district_id: string; family: EstateFamily; economy_revision: number; target_id?: number; module?: number; u?: number; v?: number; rotation?: number }) => post("/projects", json),
  contribute: (id: number, json: { key: string; amount: number; up_to: boolean }) => post(`/projects/${id}/contributions`, json),
  cancel: (id: number, json: { key: string }) => post(`/projects/${id}/cancel`, json),
  report: () => request<EstateReport>("/api/v1/admin/learning/city/estates"),
};
