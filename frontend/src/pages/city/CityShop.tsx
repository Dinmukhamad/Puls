import { useState } from "react";
import type { DecorCatalogue, PlotCatalogue } from "../../api/cityEstate";
import { itemFootprint, type DecorFamily, type PlotFamily } from "../../city3d/world/estateGrid";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";
import { plural } from "../../utils/format";
import { MULTI_KEY, SHAPES, SHOP_TABS, decorSpots, firstTab, isBuilding, isSpaced, ownCells, shopPicture, shopTab, spacing, NO_CHOICE, type Choice, type ShopTab } from "./cellChoice";
import { readyBuildingLabel } from "./plotCatalogue";
import type { Arrow } from "./decorArrange";

export const coins = (n: number) => n.toLocaleString("ru-RU");
export const cellsText = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "клетка", "клетки", "клеток")}`;
/** The cells something takes on the land: "3 × 3 клетки", "1 клетка". */
export const sizeText = ([w, h]: [number, number]) => w * h === 1 ? "1 клетка" : `${w} × ${h} клетки`;
const EVERY = [[1, "На каждую клетку"], [2, "Через одну"], [3, "Через две"]] as const;
/** «на 1 клетку», «на 3 клетки», «на 5 клеток». */
const onCells = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "клетку", "клетки", "клеток")}`;
/** «1 занята — на неё не ставится», «4 заняты — на них не ставится». */
const takenText = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "занята — на неё", "заняты — на них", "заняты — на них")} не ставится`;

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
 * The district's shop beside the map (docs/CITY_ESTATES.md, «Магазин»). The cells are chosen first, on the map: a tap
 * chooses one, a drag of the mouse's left button a line of them, Ctrl (Cmd) adds an area; on a phone taps go on with a
 * line or an area as «Клетка / Линия / Область» says. Then what goes on them, by tabs, each thing with a picture of its model, its size and price: a building
 * stands round the one cell chosen (its cells show on the map, green where free and red where not), a small thing on
 * the cells of the line, lamps, trees, benches, bushes and flowerbeds also on every second or third. One's own small
 * things on the chosen cells go away for their coins, move a cell along the screen by the arrows (`arrange`), and the
 * lamps and benches among them turn. In the test city (`free`) all is free and anyone's things go.
 */
export function CellShop({ choice, plots, decor, landPrices, available, batch, ready, message, pending, error, free = false, arrange, onChoice, onBuy, onRemove, onChooseFree }: {
  choice: Choice | null; plots: readonly PlotCatalogue[]; decor: readonly DecorCatalogue[]; landPrices: readonly number[];
  /** Coins that can be spent; null in the test city. */
  available: number | null; batch: number; ready: boolean; message: string | null; pending: boolean; error: Error | null; free?: boolean;
  onChoice: (next: Choice) => void; onBuy: () => void; onRemove: () => void;
  arrange?: Arrange;
  /** Chooses free cells for a house by itself. */
  onChooseFree?: () => void;
}) {
  const now = choice ?? NO_CHOICE, count = now.cells.length;
  const [tab, setTab] = useState<ShopTab>(() => firstTab(now));
  const set = (patch: Partial<Choice>) => onChoice({ ...now, ...patch });
  const own = ownCells(now), states = { free: 0, own: 0, taken: 0 };
  for (const c of now.cells) states[c.state]++;
  const plot = new Map(plots.map(c => [c.family, c])), small = new Map(decor.map(c => [c.family, c]));
  const cheapest = landPrices.length ? Math.min(...landPrices) : 0;
  /** A building's price on the one cell chosen (its band's land), or from the cheapest land. */
  const buildingPrice = (family: PlotFamily, band: number | null) => {
    const c = plot.get(family), [w, h] = itemFootprint(family);
    return free ? 0 : (band === null ? cheapest : landPrices[band - 1] ?? cheapest) * w * h + (c?.levels[0].price ?? 0);
  };
  const priceText = (item: Item) => {
    if (free) return "бесплатно";
    if (isBuilding(item.family)) return count === 1 ? `◈ ${coins(buildingPrice(item.family, now.cells[0].band))}` : `от ◈ ${coins(buildingPrice(item.family, null))}`;
    return `◈ ${coins(small.get(item.family)?.price ?? 0)} за клетку`;
  };
  const items = itemsOf(tab, plots, decor), chosen = now.family ? itemsOf(shopTab(now.family), plots, decor).find(i => i.family === now.family) ?? null : null;
  const breakdown = [states.free && `свободно ${states.free}`, states.own && `${free ? "с мелкими постройками" : "своё"} ${states.own}`, states.taken && `занято ${states.taken}`].filter(Boolean).join(" · ");

  return <section className="estate-shop" aria-label="Магазин района">
    <div className="estate-selection" aria-live="polite">
      {count ? <>
        <p><strong>Выбрано: {cellsText(count)}</strong>{breakdown && <small>{breakdown}</small>}</p>
        <div className="estate-placing__actions">
          <button type="button" className="city-secondary" onClick={() => set({ cells: [], at: null })}>Сбросить выбор</button>
          {own.length > 0 && <button type="button" className="city-secondary" disabled={!ready || pending} onClick={onRemove}>{free ? "Убрать" : "Убрать своё"} · {cellsText(own.length)}</button>}
        </div>
        {own.length > 0 && arrange && <Arranging count={own.length} arrange={arrange} free={free} disabled={!ready || pending} />}
      </> : <p className="secondary small">Выбери место на карте: нажми на клетку или проведи по клеткам левой кнопкой мыши — получится линия. Камера: правая кнопка мыши, колесо и WASD, на телефоне — двумя пальцами.</p>}
      <p className="estate-tip estate-tip--mouse"><kbd>{MULTI_KEY}</kbd> + протянуть мышью — добавить прямоугольник: дорогу в две-три клетки шириной, рощу; <kbd>{MULTI_KEY}</kbd> + клик — добавить или убрать клетку; <kbd>Shift</kbd> + протянуть — добавить ещё линию.</p>
      <div className="estate-shape" role="radiogroup" aria-label="Что делает нажатие">{SHAPES.map(o =>
        <button key={o.value} type="button" role="radio" aria-checked={now.shape === o.value} onClick={() => set({ shape: o.value })}>{o.label}</button>)}</div>
      <p className="secondary small estate-shape__hint">{SHAPES.find(o => o.value === now.shape)?.hint}</p>
      {!count && ready && onChooseFree && <button type="button" className="city-secondary estate-choose-free" disabled={pending} onClick={onChooseFree}>Подобрать место для дома</button>}
    </div>
    {!ready && <p className="estate-note">{message ?? "Стройка в районе пока закрыта."}</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    <div className="estate-shop__tabs" role="tablist" aria-label="Разделы магазина">{SHOP_TABS.map(t =>
      <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}><span aria-hidden="true">{t.icon}</span>{t.name}</button>)}</div>
    <ul className="estate-shop__items" role="tabpanel" aria-label={SHOP_TABS.find(t => t.id === tab)?.name}>{items.map(item =>
      <li key={item.family}><button type="button" className="estate-shop__item" aria-pressed={now.family === item.family} title={item.about}
        onClick={() => set({ family: item.family, at: null })} aria-label={`${item.name}: ${sizeText(item.size)}, ${priceText(item)}`}>
        <img src={shopPicture(item.family)} alt="" loading="lazy" decoding="async" width={160} height={120} />
        <strong>{item.name}</strong>
        <small>{sizeText(item.size)} · {priceText(item)}</small>
        {item.note && <small>{item.note}</small>}
      </button></li>)}</ul>
    {tab === "squares" && <p className="secondary small">Четыре своих сквера вплотную квадратом (4 × 4 клетки) сами станут парком, шесть прямоугольником (6 × 4 клетки) — большим парком.</p>}
    {chosen && (isBuilding(chosen.family) ? <BuildingBuy item={chosen} catalogue={plot.get(chosen.family)!} choice={now} land={count === 1 ? free ? 0 : landPrices[now.cells[0].band - 1] ?? 0 : null}
      price={buildingPrice(chosen.family, count === 1 ? now.cells[0].band : null)} available={available} free={free} ready={ready} pending={pending} onTurn={() => set({ rotation: (now.rotation + 1) % 4 })} onBuy={onBuy} />
      : <DecorBuy item={chosen} price={free ? 0 : small.get(chosen.family as DecorFamily)?.price ?? 0} choice={now} available={available} batch={batch} free={free} ready={ready} pending={pending}
        onEvery={every => set({ every })} onBuy={onBuy} />)}
    <p className="city-fine">{free ? "Тестовый город отдельный: настоящий район не меняется." : "Выбор ничего не списывает: коины спишутся по кнопке «Купить», сервер ещё раз проверит клетки. Цена включает землю под каждой клеткой."}</p>
  </section>;
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

/** Buying a building round the one cell chosen: where it goes, its price with the land, its front. */
function BuildingBuy({ item, catalogue, choice, land, price, available, free, ready, pending, onTurn, onBuy }: {
  item: Item; catalogue: PlotCatalogue; choice: Choice; land: number | null; price: number; available: number | null; free: boolean; ready: boolean; pending: boolean; onTurn: () => void; onBuy: () => void;
}) {
  const count = choice.cells.length, at = choice.at, [w, h] = item.size, missing = free || available === null ? 0 : price - available;
  const own = catalogue.levels[0].price, turns = item.family !== "square";
  return <div className="estate-shop__buy" aria-live="polite">
    <div className="estate-placing__title"><span aria-hidden="true">{item.icon}</span><div><h3>{item.name}</h3><small>{sizeText(item.size)}{item.note ? ` · ${item.note}` : ""}</small></div></div>
    <p className="secondary small">{item.about}</p>
    {count === 0 ? <p className="estate-note">Нажми на клетку на карте — постройка встанет вокруг неё.</p>
      : count > 1 ? <p className="estate-note">Для здания нужна одна клетка: нажми на неё на карте. Сейчас выбрано {cellsText(count)}.</p>
      : !at ? <p className="estate-note">Показываем место на карте…</p>
      : at.problem ? <p className="estate-problem" role="alert">{at.problem}</p>
      : <p className="estate-ok">Место свободно: клетки на карте зелёные.</p>}
    {count === 1 && land !== null && !free && <small className="secondary">Земля {w * h} × ◈ {coins(land)} = ◈ {coins(land * w * h)} + {catalogue.ready ? readyBuildingLabel(item.family) : item.name.toLowerCase()} ◈ {coins(own)}</small>}
    <div className="estate-placing__actions">
      {turns && count === 1 && <button type="button" className="city-secondary" onClick={onTurn}>Повернуть фасад</button>}
      <button type="button" className="city-action" disabled={!ready || pending || count !== 1 || !at || !!at.problem || missing > 0} onClick={onBuy}>
        {pending ? "Сохраняем…" : missing > 0 && count === 1 ? `Не хватает ${coins(missing)}` : free ? "Построить бесплатно" : count === 1 ? `Купить · ◈ ${coins(price)}` : "Купить"}
      </button>
    </div>
  </div>;
}

/** Buying a small thing on the cells chosen: how often along the line, on how many free cells, the price. */
function DecorBuy({ item, price, choice, available, batch, free, ready, pending, onEvery, onBuy }: {
  item: Item; price: number; choice: Choice; available: number | null; batch: number; free: boolean; ready: boolean; pending: boolean; onEvery: (every: number) => void; onBuy: () => void;
}) {
  const { spots, free: open } = decorSpots(choice), total = price * open.length, missing = free || available === null ? 0 : total - available;
  const limit = batch || 400, tooMany = open.length > limit, every = spacing(choice);
  return <div className="estate-shop__buy" aria-live="polite">
    <div className="estate-placing__title"><span aria-hidden="true">{item.icon}</span><div><h3>{item.name}</h3><small>{free ? "бесплатно" : `◈ ${coins(price)} за клетку · земля включена`}</small></div></div>
    <p className="secondary small">{item.about}</p>
    {isSpaced(item.family) && <div className="estate-every" role="group" aria-label="Как часто ставить вдоль линии">{EVERY.map(([n, label]) =>
      <button type="button" key={n} aria-pressed={every === n} onClick={() => onEvery(n)}>{label}</button>)}</div>}
    {!choice.cells.length ? <p className="estate-note">Выбери клетки на карте: проведи по ним левой кнопкой мыши или нажми на клетку.</p>
      : open.length ? <p className="estate-ok">Встанет на {onCells(open.length)}{spots.length > open.length ? ` · ${takenText(spots.length - open.length)}` : ""}</p>
      : <p className="estate-problem" role="alert">На выбранных клетках нет свободного места.</p>}
    {tooMany && <p className="estate-problem" role="alert">За раз можно поставить не больше {limit} клеток.</p>}
    <div className="estate-placing__actions">
      <button type="button" className="city-action" disabled={!ready || pending || !open.length || tooMany || missing > 0} onClick={onBuy}>
        {pending ? "Сохраняем…" : missing > 0 ? `Не хватает ${coins(missing)}` : free ? "Поставить бесплатно" : `Купить · ◈ ${coins(total)}`}
      </button>
    </div>
  </div>;
}
