import details from "./release.json";

export interface Release {
  buildId: string;
  version: string;
  builtAt: string;
  changes: string[];
}
declare const __PULS_RELEASE__: Release;
export const CURRENT_RELEASE: Release = typeof __PULS_RELEASE__ === "undefined"
  ? { ...details, buildId: "development", builtAt: "" }
  : __PULS_RELEASE__;

export function readRelease(value: unknown): Release {
  const item = value as Partial<Release> | null;
  if (!item || typeof item.buildId !== "string" || !/^[a-f0-9]{20}$/.test(item.buildId)
    || typeof item.version !== "string" || !/^\d+\.\d+\.\d+$/.test(item.version)
    || typeof item.builtAt !== "string" || !Number.isFinite(Date.parse(item.builtAt))
    || !Array.isArray(item.changes) || item.changes.length > 20
    || !item.changes.every((line) => typeof line === "string" && line.length <= 500)) {
    throw new Error("Не удалось проверить версию приложения. Попробуйте позже.");
  }
  return item as Release;
}
