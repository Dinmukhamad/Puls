/**
 * The cells chosen on the map and what the shop chose for them, as the page keeps them (city3d/types.ts CellChoice):
 * with what the map says stands on each cell now, and for a building on the one cell chosen, where its cells go and
 * why they do not fit (`at`, null until the map shows them). Pure helpers of the shop (CityShop.tsx): where a small
 * thing goes on the cells, which of them hold one's own small things, the shop's tabs and pictures.
 */
import type { CellChoice, ChoiceShape, ChosenCell } from "../../city3d/types";
import { isDecorFamily, type DecorFamily, type PlotFamily } from "../../city3d/world/estateGrid";
import { isReadyHouse } from "../../city3d/world/familyHouses";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";

export interface Choice extends Omit<CellChoice, "cells"> {
  cells: ChosenCell[];
  at: { col: number; row: number; problem: string | null } | null;
}
/** Nothing chosen yet: no cells, nothing from the shop, a small thing on every cell. */
export const NO_CHOICE: Choice = { cells: [], shape: "cell", family: null, rotation: 0, every: 1, at: null };

/** The key held to choose many cells at once: Cmd on a Mac, Ctrl elsewhere (the map takes either). */
export const MULTI_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
/** What a tap does with the cells, for phones (with a mouse a drag draws the line or the area). */
export const SHAPES: readonly { value: ChoiceShape; label: string; hint: string }[] = [
  { value: "cell", label: "Клетка", hint: "Нажатие выбирает одну клетку." },
  { value: "line", label: "Линия", hint: "Каждое нажатие продолжает линию от прошлой клетки." },
  { value: "area", label: "Область", hint: "Нажми на один угол, потом на другой — добавится прямоугольник между ними: дорога в две-три клетки шириной, роща, площадь." },
];

/** Small things that stand apart (trees, lamps, benches, bushes, flowerbeds): they can go on every second or third cell. */
export const SPACED: readonly DecorFamily[] = ["tree", "pine", "birch", "oak", "lamp", "bench", "bush", "flowers"];
export const isSpaced = (family: PlotFamily | DecorFamily | null): family is DecorFamily => !!family && (SPACED as readonly string[]).includes(family);
/** How often the chosen small thing goes along the line: as chosen for those that stand apart, else on every cell. */
export const spacing = (choice: Pick<Choice, "family" | "every">) => isSpaced(choice.family) ? Math.max(1, Math.floor(choice.every) || 1) : 1;

/** Where a small thing goes on the cells chosen: every `every`-th of them along the line, and those of them that are free. */
export function decorSpots(choice: Pick<Choice, "cells" | "family" | "every">) {
  const every = spacing(choice), spots = choice.cells.filter((_, i) => i % every === 0);
  return { spots, free: spots.filter(c => c.state === "free") };
}
/** The chosen cells holding a small thing the viewer may take away. */
export const ownCells = (choice: Pick<Choice, "cells"> | null) => (choice?.cells ?? []).filter(c => c.state === "own");
/** A building takes the one cell chosen and its neighbours. */
export const isBuilding = (family: PlotFamily | DecorFamily | null): family is PlotFamily => !!family && !isDecorFamily(family);

export type ShopTab = "houses" | "offices" | "squares" | "roads" | "trees" | "lamps" | "bushes";
export const SHOP_TABS: readonly { id: ShopTab; name: string; icon: string }[] = [
  { id: "houses", name: "Дома", icon: "🏡" },
  { id: "offices", name: "Офисы", icon: "🏢" },
  { id: "squares", name: "Скверы", icon: "🌳" },
  { id: "roads", name: "Дороги", icon: "🛣️" },
  { id: "trees", name: "Деревья", icon: "🌲" },
  { id: "lamps", name: "Фонари и скамейки", icon: "💡" },
  { id: "bushes", name: "Кусты и клумбы", icon: "🌷" },
];
const DECOR_TABS: Record<DecorFamily, ShopTab> = {
  road: "roads", path: "roads", alley: "roads", tree: "trees", pine: "trees", birch: "trees", oak: "trees",
  lamp: "lamps", bench: "lamps", bush: "bushes", flowers: "bushes", hedge: "bushes",
};
/** The tab a thing of the shop is in. */
export function shopTab(family: PlotFamily | DecorFamily): ShopTab {
  if (isDecorFamily(family)) return DECOR_TABS[family];
  if (family === "house" || isReadyHouse(family)) return "houses";
  return isOfficeBuilding(family) ? "offices" : "squares";
}
/** The tab to open first: the chosen thing's, else roads for a line of cells, else houses. */
export const firstTab = (choice: Pick<Choice, "cells" | "family"> | null): ShopTab =>
  choice?.family ? shopTab(choice.family) : (choice?.cells.length ?? 0) > 1 ? "roads" : "houses";

/** The picture of a thing in the shop: a snapshot of its model (scripts/shop-pictures.mjs), loaded when it shows. */
export const shopPicture = (family: string) => `${import.meta.env?.BASE_URL ?? "/"}city/shop/v1/${family}.webp`;
