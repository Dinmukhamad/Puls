/**
 * The model files the city loads, and their early download. The engine asks for them only after the page's data,
 * its own download and its landscape (world, renderer, systems); on a first visit that is about a second later than
 * the moment the city page opens, so the page starts the downloads itself (prefetchModels) and the loader
 * (loader.ts) takes a started one over instead of fetching the file again. Nothing here needs three.js: the page
 * imports it without the engine.
 */
import modelsUrl from "../../pages/city/models/city-models.glb?url";

/**
 * The generated building kit (public/city/v1), preferred over the source bundled with the code. The vehicles are
 * built in code (assets/vehicles.ts): no download for them.
 */
export const lodFiles = () => ["city/v1/city-models.glb"].map(path => `${import.meta.env.BASE_URL}${path}`);

/**
 * The catalogue's files, in the order it loads them, and the bundled source to try when a generated file fails.
 * `kits: false` leaves out the building kit (houses, offices, industry): only the five-island map places those, and
 * a world without them downloads nothing.
 */
export function catalogueFiles(lodUrls: readonly string[] = [], kits = true) {
  const preferredModels = lodUrls.find(url => /(?:^|\/)city-models\.glb(?:[?#].*)?$/.test(url));
  const fallbacks = new Map<string, string>();
  if (preferredModels && preferredModels !== modelsUrl) fallbacks.set(preferredModels, modelsUrl);
  const urls = [...new Set([...(kits ? [preferredModels ?? modelsUrl] : []), ...lodUrls.filter(url => kits || url !== preferredModels)])];
  return { urls, fallbacks };
}

/** A started download waits this long for the engine; a visit left early must not keep the bytes. */
const KEEP_MS = 60_000;
const started = new Map<string, Promise<ArrayBuffer>>();

/**
 * Starts downloading `urls` (once each) for the loader to take over. At low priority: the page's own code and data,
 * and the engine's, come first wherever they compete for the connection.
 */
export function prefetchModels(urls: readonly string[]) {
  if (typeof fetch === "undefined") return;
  for (const url of urls) {
    if (started.has(url)) continue;
    const bytes = fetch(url, { priority: "low" }).then(response => {
      if (!response.ok) throw new Error(`Model download failed (${response.status})`);
      return response.arrayBuffer();
    });
    const forget = () => { if (started.get(url) === bytes) started.delete(url); };
    bytes.catch(forget);
    (setTimeout(forget, KEEP_MS) as unknown as { unref?: () => void }).unref?.();
    started.set(url, bytes);
  }
}

/** The started download of `url`, handed over once: the caller owns the bytes. */
export function takePrefetched(url: string): Promise<ArrayBuffer> | undefined {
  const bytes = started.get(url);
  started.delete(url);
  return bytes;
}
