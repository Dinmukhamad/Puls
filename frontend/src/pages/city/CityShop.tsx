import { useEffect, useRef, useState } from "react";
import type { DecorCatalogue, PlotCatalogue } from "../../api/cityEstate";
import type { ChoiceShape } from "../../city3d/types";
import { itemFootprint, type DecorFamily, type PlotFamily } from "../../city3d/world/estateGrid";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";
import { plural } from "../../utils/format";
import { MULTI_KEY, SHOP_TABS, decorSpots, firstTab, isBuilding, isSpaced, ownCells, shopPicture, shopTab, spacing, NO_CHOICE, type Choice, type ShopTab } from "./cellChoice";
import { readyBuildingLabel } from "./plotCatalogue";
import type { Arrow } from "./decorArrange";

export const coins = (n: number) => n.toLocaleString("ru-RU");
export const cellsText = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "клетка", "клетки", "клеток")}`;
/** The cells something takes on the land: "3 × 3 клетки", "1 клетка". */
export const sizeText = ([w, h]: [number, number]) => w * h === 1 ? "1 клетка" : `${w} × ${h} клетки`;
const EVERY = [[1, "Каждую клетку"], [2, "Через одну"], [3, "Через две"]] as const;
/** «на 1 клетку», «на 3 клетки», «на 5 клеток». */
const onCells = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "клетку", "клетки", "клеток")}`;
/** «1 занята — на неё не ставится», «4 заняты — на них не ставится». */
const takenText = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "занята — на неё", "заняты — на них", "заняты — на них")} не ставится`;
/** How the cells of a small thing are chosen on the map: a line from a tap to the next, a rectangle between two corners, or cell by cell. */
const WAYS: readonly { value: ChoiceShape; label: string; hint: string }[] = [
  { value: "line", label: "Линией", hint: "Нажми на начало и на конец — выберутся все клетки между ними. Мышью можно просто провести." },
  { value: "area", label: "Областью", hint: "Нажми на один угол и на противоположный — выберется прямоугольник: широкая дорога, роща, площадь." },
  { value: "cell", label: "По клетке", hint: "Каждое нажатие выбирает одну клетку." },
];

/**
 * Moving one's own small things on the chosen cells a cell along the screen, and turning the lamps and benches among them
 * (`turnable` of them), from the selection: the dock sends it (decorArrange.ts).
 */
export interface Arrange { turnable: number; problem: string | null; onMove: (arrow: Arrow) => void; onTurn: (step: 1 | -1) => void }
const ARROWS: readonly { arrow: Arrow; icon: string; label: string }[] = [
  { arrow: "up", icon: "↑", label: "Подвинуть вверх — от себя" }, { arrow: "left", icon: "←", label: "Подвинуть влево" },
  { arrow: "right", icon: "→", label: "Подвинуть вправо" }, { arrow: "down", icon: "↓", label: "Подвинуть вниз — к себе" },
];

/** A thing of the shop: a building or a small thing, with what the card shows of it. */
interface Item { family: PlotFamily | DecorFamily; name: string; icon: string; about: string; size: [number, number]; note: string | null }
function itemsOf(tab: ShopTab, plots: readonly PlotCatalogue[], decor: readonly DecorCatalogue[]): Item[] {
  // Parks are never bought: they gather themselves from squares.
  const buildings = plots.filter(c => c.family !== "park" && c.family !== "bigpark" && shopTab(c.family) === tab).map(c => ({
    family: c.family, name: c.name, icon: c.icon, about: c.levels[0].about, size: itemFootprint(c.family),
    note: c.levels.length > 1 ? `растёт до ${c.levels.length} ${plural(c.levels.length, "ступени", "ступеней", "ступеней")}` : c.ready ? isOfficeBuilding(c.family) ? "готовое здание" : "готовый дом" : null,
  }));
  const small = decor.filter(c => shopTab(c.family) === tab).map(c => ({ family: c.family, name: c.name, icon: c.icon, about: c.about, size: [1, 1] as [number, number], note: null }));
  return [...buildings, ...small];
}

/**
 * The district's shop beside the map (docs/CITY_ESTATES.md, «Магазин»), in three steps: what to build — a category and
 * a thing, each with a picture of its model, its size and price; where — a building round one cell tapped on the map
 * (its cells green where free, red where not), a small thing on a line, an area or cell by cell; and the purchase, its
 * total and button always in view below. Cells tapped before anything is chosen show what stands on them: one's own
 * small things there go away for their coins, move a cell along the screen by the arrows (`arrange`), the lamps and
 * benches among them turn. In the test city (`free`) all is free and anyone's things go.
 */
export function CellShop({ choice, plots, decor, landPrices, available, batch, ready, message, pending, error, free = false, arrange, onChoice, onBuy, onRemove, onChooseFree }: {
  choice: Choice | null; plots: readonly PlotCatalogue[]; decor: readonly DecorCatalogue[]; landPrices: readonly number[];
  /** Coins that can be spent; null in the test city. */
  available: number | null; batch: number; ready: boolean; message: string | null; pending: boolean; error: Error | null; free?: boolean;
  onChoice: (next: Choice) => void; onBuy: () => void; onRemove: () => void;
  arrange?: Arrange;
  /** Chooses free cells for the building chosen (a house when none is) by itself. */
  onChooseFree?: () => void;
}) {
  const now = choice ?? NO_CHOICE, count = now.cells.length;
  const [tab, setTab] = useState<ShopTab>(() => firstTab(now));
  const section = useRef<HTMLElement>(null);
  // Choosing or changing what to build starts the next step from its top, not where the catalogue was scrolled to.
  useEffect(() => { section.current?.closest(".estate-dock__body")?.scrollTo({ top: 0 }); }, [now.family]);
  const set = (patch: Partial<Choice>) => onChoice({ ...now, ...patch });
  const own = ownCells(now);
  const plot = new Map(plots.map(c => [c.family, c])), small = new Map(decor.map(c => [c.family, c]));
  const cheapest = landPrices.length ? Math.min(...landPrices) : 0;
  /** A building's price on the one cell chosen (its band's land), or from the cheapest land. */
  const buildingPrice = (family: PlotFamily, band: number | null) => {
    const c = plot.get(family), [w, h] = itemFootprint(family);
    return free ? 0 : (band === null ? cheapest : landPrices[band - 1] ?? cheapest) * w * h + (c?.levels[0].price ?? 0);
  };
  const priceText = (item: Item) => {
    if (free) return "бесплатно";
    if (isBuilding(item.family)) return count === 1 ? `◈\u00a0${coins(buildingPrice(item.family, now.cells[0].band))}` : `от\u00a0◈\u00a0${coins(buildingPrice(item.family, null))}`;
    return `◈\u00a0${coins(small.get(item.family)?.price ?? 0)} за\u00a0клетку`;
  };
  const chosen = now.family ? itemsOf(shopTab(now.family), plots, decor).find(i => i.family === now.family) ?? null : null;
  // A building takes the one cell tapped; a small thing goes along a line, or the way chosen for the small thing before.
  const choose = (item: Item) => set({ family: item.family, at: null, shape: isBuilding(item.family) ? "cell" : now.family && !isBuilding(now.family) ? now.shape : "line" });
  const change = () => { if (now.family) setTab(shopTab(now.family)); set({ family: null, at: null }); };

  return <section ref={section} className="estate-shop" aria-label="Магазин района">
    {!ready && <p className="estate-note">{message ?? "Стройка в районе пока закрыта."}</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    {chosen ? <>
      <div className="estate-chosen">
        <img src={shopPicture(chosen.family)} alt="" loading="lazy" decoding="async" width={72} height={54} />
        <div><small>Строим</small><strong>{chosen.name}</strong>{isBuilding(chosen.family) && <span>{sizeText(chosen.size)}</span>}<b>{priceText(chosen)}</b></div>
        <button type="button" className="estate-chosen__change" onClick={change}>Сменить</button>
      </div>
      <h3 className="estate-step"><span aria-hidden="true">2</span>Где поставить?</h3>
      {isBuilding(chosen.family)
        ? <BuildingWhere item={chosen} choice={now} catalogue={plot.get(chosen.family)!} free={free} land={count === 1 ? free ? 0 : landPrices[now.cells[0].band - 1] ?? 0 : null}
          onTurn={() => set({ rotation: (now.rotation + 1) % 4 })} onReset={() => set({ cells: [], at: null })} onChooseFree={ready ? onChooseFree : undefined} pending={pending} />
        : <DecorWhere item={chosen} choice={now} batch={batch} onShape={shape => set({ shape })} onEvery={every => set({ every })} onReset={() => set({ cells: [], at: null })} />}
      {own.length > 0 && <div className="estate-own-row"><span>На {own.length.toLocaleString("ru-RU")} {plural(own.length, "клетке", "клетках", "клетках")} уже стоит твоё</span>
        <button type="button" className="city-secondary" disabled={!ready || pending} onClick={onRemove}>{free ? "Убрать" : "Убрать своё"}</button></div>}
      <BuyBar item={chosen} choice={now} free={free} available={available} batch={batch} ready={ready} pending={pending} onBuy={onBuy}
        price={isBuilding(chosen.family) ? buildingPrice(chosen.family, count === 1 ? now.cells[0].band : null) : free ? 0 : small.get(chosen.family as DecorFamily)?.price ?? 0} />
    </> : <>
      {count > 0 && <Selection choice={now} free={free} ready={ready} pending={pending} arrange={arrange} onReset={() => set({ cells: [], at: null })} onRemove={onRemove} />}
      <ShopCatalogue tab={tab} onTab={setTab} plots={plots} decor={decor} priceText={priceText} onChoose={choose} />
    </>}
  </section>;
}

/** Step 1: what to build — the categories, then the things of the one open with their pictures, sizes and prices. */
export function ShopCatalogue({ tab, onTab, plots, decor, priceText, onChoose }: {
  tab: ShopTab; onTab: (tab: ShopTab) => void; plots: readonly PlotCatalogue[]; decor: readonly DecorCatalogue[];
  priceText: (item: Item) => string; onChoose: (item: Item) => void;
}) {
  const items = itemsOf(tab, plots, decor);
  return <div className="estate-catalog">
    <h3 className="estate-step"><span aria-hidden="true">1</span>Что построить?</h3>
    <div className="estate-shop__tabs" role="tablist" aria-label="Разделы магазина">{SHOP_TABS.map(t =>
      <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} onClick={() => onTab(t.id)}><span aria-hidden="true">{t.icon}</span>{t.name}</button>)}</div>
    <ul className="estate-shop__items" role="tabpanel" aria-label={SHOP_TABS.find(t => t.id === tab)?.name}>{items.map(item =>
      <li key={item.family}><button type="button" className="estate-shop__item" title={item.about}
        onClick={() => onChoose(item)} aria-label={`${item.name}: ${sizeText(item.size)}, ${priceText(item)}`}>
        <img src={shopPicture(item.family)} alt="" loading="lazy" decoding="async" width={160} height={120} />
        <strong>{item.name}</strong>
        <small>{sizeText(item.size)} · {priceText(item)}</small>
        {item.note && <small>{item.note}</small>}
      </button></li>)}</ul>
    {tab === "squares" && <p className="secondary small">{PARK_NOTE}</p>}
  </div>;
}

/** Cells tapped before anything is chosen: what stands on them, and one's own small things there to take away, move or turn. */
function Selection({ choice, free, ready, pending, arrange, onReset, onRemove }: {
  choice: Choice; free: boolean; ready: boolean; pending: boolean; arrange?: Arrange; onReset: () => void; onRemove: () => void;
}) {
  const states = { free: 0, own: 0, taken: 0 };
  for (const c of choice.cells) states[c.state]++;
  const own = ownCells(choice), breakdown = [states.free && `свободно ${states.free}`, states.own && `${free ? "с мелкими постройками" : "своё"} ${states.own}`, states.taken && `занято ${states.taken}`].filter(Boolean).join(" · ");
  return <div className="estate-selection" aria-live="polite">
    <p><strong>Выбрано: {cellsText(choice.cells.length)}</strong>{breakdown && <small>{breakdown}</small>}</p>
    {states.free > 0 && <p className="secondary small">Выбери ниже, что на них поставить.</p>}
    <div className="estate-placing__actions">
      <button type="button" className="city-secondary" onClick={onReset}>Сбросить выбор</button>
      {own.length > 0 && <button type="button" className="city-secondary" disabled={!ready || pending} onClick={onRemove}>{free ? "Убрать" : "Убрать своё"} · {cellsText(own.length)}</button>}
    </div>
    {own.length > 0 && arrange && <Arranging count={own.length} arrange={arrange} free={free} disabled={!ready || pending} />}
  </div>;
}

/** The arrows that move one's own small things on the chosen cells a cell along the screen, and the turn of lamps and benches. */
function Arranging({ count, arrange, free, disabled }: { count: number; arrange: Arrange; free: boolean; disabled: boolean }) {
  return <div className="estate-arrange" role="group" aria-label={free ? "Подвинуть и повернуть выбранное" : "Подвинуть и повернуть своё"}>
    <div className="estate-arrange__move">
      <p><strong>Подвинуть · {cellsText(count)}</strong><small>На клетку в сторону, как видно на экране: ↑ — от себя, ↓ — к себе. Бесплатно.</small></p>
      <div className="estate-arrange__pad">{ARROWS.map(a =>
        <button type="button" key={a.arrow} data-arrow={a.arrow} aria-label={a.label} title={a.label} disabled={disabled} onClick={() => arrange.onMove(a.arrow)}>{a.icon}</button>)}</div>
    </div>
    {arrange.problem && <p className="estate-problem" role="alert">{arrange.problem}</p>}
    {arrange.turnable > 0 && <div className="estate-arrange__turn">
      <p><strong>Повернуть</strong><small>Фонарь встанет у другого края клетки, скамейка развернётся. Жёлтая стрелка на карте — куда.</small></p>
      <div className="estate-placing__actions">
        <button type="button" className="city-secondary" disabled={disabled} onClick={() => arrange.onTurn(1)} aria-label="Повернуть влево">↺ Влево</button>
        <button type="button" className="city-secondary" disabled={disabled} onClick={() => arrange.onTurn(-1)} aria-label="Повернуть вправо">Вправо ↻</button>
      </div>
    </div>}
  </div>;
}

const PARK_NOTE = "Четыре своих сквера вплотную квадратом (4 × 4 клетки) сами станут парком, шесть прямоугольником (6 × 4 клетки) — большим парком.";

/** Step 2 for a building: one cell tapped on the map, where it goes (green or red there), its front, its price with the land. */
function BuildingWhere({ item, choice, catalogue, free, land, pending, onTurn, onReset, onChooseFree }: {
  item: Item; choice: Choice; catalogue: PlotCatalogue; free: boolean; land: number | null; pending: boolean; onTurn: () => void; onReset: () => void; onChooseFree?: () => void;
}) {
  const count = choice.cells.length, at = choice.at, [w, h] = item.size, turns = item.family !== "square";
  return <div className="estate-where" aria-live="polite">
    {count === 0 ? <>
      <p className="estate-hint">Нажми на карте клетку — {item.name.toLowerCase()} встанет вокруг неё и займёт {sizeText(item.size)}.</p>
      {onChooseFree && <button type="button" className="city-secondary estate-choose-free" disabled={pending} onClick={onChooseFree}>Подобрать свободное место</button>}
    </> : count > 1 ? <>
      <p className="estate-note">Для здания нужна одна клетка: нажми на неё на карте. Сейчас выбрано {cellsText(count)}.</p>
      <button type="button" className="city-secondary" onClick={onReset}>Сбросить выбор</button>
    </> : <>
      {!at ? <p className="estate-note">Показываем место на карте…</p>
        : at.problem ? <p className="estate-problem" role="alert">{at.problem}</p>
        : <p className="estate-ok">Место свободно: клетки на карте зелёные.</p>}
      {turns && <button type="button" className="city-secondary" onClick={onTurn}>↻ Повернуть фасад</button>}
      <small className="secondary">Другое место — нажми на другую клетку на карте.{land !== null && !free ? ` Земля ${w * h} × ◈ ${coins(land)} = ◈ ${coins(land * w * h)} + ${catalogue.ready ? readyBuildingLabel(item.family) : item.name.toLowerCase()} ◈ ${coins(catalogue.levels[0].price)}.` : ""}</small>
      {item.family === "square" && <small className="secondary">{PARK_NOTE}</small>}
    </>}
  </div>;
}

/** Step 2 for a small thing: how its cells are chosen, how often it stands along them, and where it goes now. */
function DecorWhere({ item, choice, batch, onShape, onEvery, onReset }: {
  item: Item; choice: Choice; batch: number; onShape: (shape: ChoiceShape) => void; onEvery: (every: number) => void; onReset: () => void;
}) {
  const { spots, free: open } = decorSpots(choice), every = spacing(choice), limit = batch || 400, way = WAYS.find(w => w.value === choice.shape) ?? WAYS[0];
  return <div className="estate-where" aria-live="polite">
    <div className="estate-shape" role="radiogroup" aria-label="Как выбирать клетки">{WAYS.map(o =>
      <button key={o.value} type="button" role="radio" aria-checked={way.value === o.value} onClick={() => onShape(o.value)}>{o.label}</button>)}</div>
    <p className="estate-hint">{way.hint}</p>
    {isSpaced(item.family) && <div className="estate-every" role="group" aria-label="Как часто ставить">{EVERY.map(([n, label]) =>
      <button type="button" key={n} aria-pressed={every === n} onClick={() => onEvery(n)}>{label}</button>)}</div>}
    {!choice.cells.length ? <p className="estate-note">Клетки ещё не выбраны.</p>
      : open.length ? <p className="estate-ok">Встанет на {onCells(open.length)}{spots.length > open.length ? ` · ${takenText(spots.length - open.length)}` : ""}</p>
      : <p className="estate-problem" role="alert">На выбранных клетках нет свободного места.</p>}
    {open.length > limit && <p className="estate-problem" role="alert">За раз можно поставить не больше {limit} клеток.</p>}
    {choice.cells.length > 0 && <button type="button" className="city-secondary" onClick={onReset}>Сбросить выбор</button>}
    <details className="estate-tips estate-tip--mouse"><summary>Подсказки для мыши</summary>
      <p><kbd>{MULTI_KEY}</kbd> + протянуть — добавить прямоугольник; <kbd>{MULTI_KEY}</kbd> + клик — добавить или убрать клетку; <kbd>Shift</kbd> + протянуть — добавить ещё линию. Камера: правая кнопка мыши, колесо и WASD.</p>
    </details>
  </div>;
}

/** Step 3: the total and the button, always in view at the bottom of the panel. */
function BuyBar({ item, choice, price, free, available, batch, ready, pending, onBuy }: {
  item: Item; choice: Choice; price: number; free: boolean; available: number | null; batch: number; ready: boolean; pending: boolean; onBuy: () => void;
}) {
  const building = isBuilding(item.family), count = choice.cells.length;
  const open = building ? [] : decorSpots(choice).free, total = building ? price : price * open.length;
  const missing = free || available === null ? 0 : total - available, at = choice.at;
  const canBuy = ready && !pending && missing <= 0 && (building ? count === 1 && !!at && !at.problem : open.length > 0 && open.length <= (batch || 400));
  const label = pending ? "Сохраняем…" : missing > 0 && (building ? count === 1 : open.length > 0) ? `Не хватает ${coins(missing)}`
    : free ? building ? "Построить бесплатно" : "Поставить бесплатно" : (building ? count === 1 : open.length > 0) ? `Купить · ◈ ${coins(total)}` : building ? "Сначала выбери место на карте" : "Сначала выбери клетки на карте";
  return <div className="estate-buybar">
    <h3 className="estate-step"><span aria-hidden="true">3</span>Купить</h3>
    <button type="button" className="city-action" disabled={!canBuy} onClick={onBuy}>{label}</button>
    <small>{free ? "Тестовый город отдельный: настоящий район не меняется." : "Коины спишутся только после «Купить». Цена включает землю под каждой клеткой."}</small>
  </div>;
}
