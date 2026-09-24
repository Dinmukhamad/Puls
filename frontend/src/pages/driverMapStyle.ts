/* Навигационная карта Driver Simulator: векторные тайлы OpenFreeMap (OpenMapTiles, данные OpenStreetMap).
   Бесплатно, без ключа. Здесь — чистые функции: выбор стиля, доводка слоёв, курс машины. */

export const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;
export type MapTheme = keyof typeof MAP_STYLES;

/** Цвета доводки для каждой темы: дороги читаются, здания объёмные, маршрут светится. */
export const MAP_PALETTE: Record<MapTheme, { buildings: string; minor: string; major: string; motorway: string; routeCasing: string; route: string }> = {
  dark: { buildings: "#232838", minor: "#2c3140", major: "#454b61", motorway: "#5a5f78", routeCasing: "#0a1a3d", route: "#4d9bff" },
  light: { buildings: "#e2e0da", minor: "#ffffff", major: "#fbe7a1", motorway: "#f7cf6b", routeCasing: "#1b4fb4", route: "#3d8bff" },
};

/** Подписи на русском, если в данных есть русское название. */
export const RUSSIAN_LABEL = ["coalesce", ["get", "name:ru"], ["get", "name"]] as const;

interface StyleLayer { id: string; type: string; layout?: Record<string, unknown> }
interface StyleApi {
  getStyle(): { layers?: StyleLayer[] } | undefined;
  getLayer(id: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
  setPaintProperty(id: string, name: string, value: unknown): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addLayer(layer: any, before?: string): unknown;
}

/** Первый слой подписей: маршрут и здания кладутся под него, чтобы названия улиц оставались сверху. */
export function firstLabelLayer(layers: StyleLayer[]) {
  return layers.find(layer => layer.type === "symbol")?.id;
}

/** Доводит загруженный стиль: русские подписи, контрастные дороги и объёмные здания. */
export function tuneStyle(map: StyleApi, theme: MapTheme) {
  const layers = map.getStyle()?.layers ?? [], colors = MAP_PALETTE[theme];
  for (const layer of layers) {
    if (layer.type === "symbol" && layer.layout && "text-field" in layer.layout) map.setLayoutProperty(layer.id, "text-field", RUSSIAN_LABEL);
  }
  const paint = (ids: string[], color: string) => ids.forEach(id => { if (map.getLayer(id)) map.setPaintProperty(id, "line-color", color); });
  const fill = (ids: string[], color: string) => ids.forEach(id => { if (map.getLayer(id)) map.setPaintProperty(id, "fill-color", color); });
  if (theme === "dark") {
    // Ночная палитра навигатора: вода и парки различимы, кварталы не сливаются с дорогами.
    if (map.getLayer("background")) map.setPaintProperty("background", "background-color", "#0d0f14");
    fill(["water"], "#0b2231");
    fill(["landuse_park", "landcover_wood"], "#12261c");
    fill(["landuse_residential"], "#11131a");
    fill(["building"], "#1a1e2a");
    for (const layer of layers) if (layer.type === "symbol") {
      map.setPaintProperty(layer.id, "text-color", layer.id.startsWith("place") ? "#e9ebf0" : "#b9bfcc");
      map.setPaintProperty(layer.id, "text-halo-color", "#0d0f14");
    }
    paint(["highway_minor"], colors.minor);
    paint(["highway_major_inner", "highway_major_subtle"], colors.major);
    paint(["highway_motorway_inner", "highway_motorway_subtle"], colors.motorway);
  }
  if (!map.getLayer("dx-buildings-3d")) map.addLayer({
    id: "dx-buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
    paint: {
      "fill-extrusion-color": colors.buildings,
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, ["coalesce", ["get", "render_height"], 10]],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.85,
    },
  }, firstLabelLayer(layers));
}

/** Слои маршрута: тёмная обводка и яркая линия, толщина растёт с приближением. */
export function routeLayers(theme: MapTheme) {
  const colors = MAP_PALETTE[theme];
  const width = (low: number, high: number) => ["interpolate", ["linear"], ["zoom"], 10, low, 18, high];
  return [
    { id: "dx-route-glow", type: "line", source: "dx-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colors.route, "line-width": width(14, 34), "line-blur": 10, "line-opacity": theme === "dark" ? 0.35 : 0.2 } },
    { id: "dx-route-casing", type: "line", source: "dx-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colors.routeCasing, "line-width": width(8, 18), "line-opacity": 0.95 } },
    { id: "dx-route", type: "line", source: "dx-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colors.route, "line-width": width(5, 11) } },
  ];
}

/** Курс от прежней точки к новой, в градусах от севера по часовой. null — машина почти не сдвинулась. */
export function bearing(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }, minMeters = 3) {
  const rad = Math.PI / 180, lat1 = from.latitude * rad, lat2 = to.latitude * rad, dLon = (to.longitude - from.longitude) * rad;
  const dLat = lat2 - lat1, a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  if (6371000 * 2 * Math.asin(Math.sqrt(a)) < minMeters) return null;
  const y = Math.sin(dLon) * Math.cos(lat2), x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
