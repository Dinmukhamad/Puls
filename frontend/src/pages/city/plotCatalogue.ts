import type { PlotCatalogue } from "../../api/cityEstate";
import { isReadyHouse } from "../../city3d/world/familyHouses";
import { isOfficeBuilding, OFFICE_BUILDINGS } from "../../city3d/world/officeBuildings";

/** Ready offices and ready houses share purchase rules, but have separate catalogue sections. */
export function splitPlotCatalogue(catalogue: readonly PlotCatalogue[]) {
  return {
    options: (["square", "house"] as const).flatMap(family => catalogue.filter(c => c.family === family)),
    houses: catalogue.filter(c => c.ready && !isOfficeBuilding(c.family)),
    offices: catalogue.filter(c => c.ready && isOfficeBuilding(c.family)),
  };
}

/** Keep staged buildings in their own rows and collect the single-price families by category. */
export function estateRows(estate: Record<string, number[]>) {
  const rows = new Map<string, { key: string; title?: string; families: string[] }>();
  for (const family of Object.keys(estate)) {
    const key = isOfficeBuilding(family) ? "offices" : isReadyHouse(family) ? "houses" : family;
    const title = key === "offices" ? "Офисные здания" : key === "houses" ? "Готовые дома" : undefined;
    if (!rows.has(key)) rows.set(key, { key, title, families: [] });
    rows.get(key)!.families.push(family);
  }
  return [...rows.values()];
}

const PLOT_NAMES: Record<string, string> = {
  square: "🌳 Сквер", house: "🏡 Дом", carport: "🏠 Коттедж с навесом", bungalow: "🏠 Бунгало",
  attic: "🏠 Дом с мансардой", modern: "🏠 Модерн с гаражом", bayhouse: "🏠 Дом с эркером",
  terrace: "🏠 Модерн с террасой", park: "🌲 Парк", bigpark: "🏞️ Большой парк",
};

export const plotEconomyName = (family: string) => isOfficeBuilding(family) ? `🏢 ${OFFICE_BUILDINGS[family].name}` : PLOT_NAMES[family] ?? family;
export const readyBuildingLabel = (family: string) => isOfficeBuilding(family) ? "офисное здание" : "готовый дом";
