import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cityEstate, operationKey, type DecorCatalogue, type DistrictEstate, type MyEstate, type OperationResult, type OwnObject, type PlotCatalogue, type PlotFamily, type ProjectCatalogue, type ProjectFamily, type PublicObject } from "../../api/cityEstate";
import { PLOT_LEVELS, PROJECT_LEVELS, plotSize, projectFootprint } from "../../city3d/world/estateGrid";
import type { DecorShape, DecorTool, EstateTarget, PlotAddress } from "../../city3d/types";
import { plural } from "../../utils/format";
import { DistrictSwatch } from "./DistrictSwatch";
import { splitPlotCatalogue, readyBuildingLabel } from "./plotCatalogue";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";
import { DistrictBuildProgress } from "./DistrictBuildProgress";
import { DistrictLandmarkCard } from "./DistrictLandmarkCard";
import "./estate.css";

export type { EstateTarget };
/** A plot of 3 × 3 cells picked on the map for a purchase: its first cell, band, front and why it does not fit, if it does not. */
export interface PickedPlot extends PlotAddress { band: number; problem: string | null; rotation: number }
/**
 * Small things being laid (one kind) or taken away (one's own; in the test city `anyone`'s): the cells chosen, and how a
 * tap chooses them: one at a time, a line from the last one, or an area between two corners.
 */
export interface DecorChoice { tool: DecorTool; cells: PlotAddress[]; shape: DecorShape; anyone?: boolean }
/** How the cells are chosen at first: roads, footpaths and hedges by lines, everything else a cell at a time. */
export const decorShape = (tool: DecorTool): DecorShape => tool === "road" || tool === "path" || tool === "hedge" ? "line" : "cell";
const SHAPES: { value: DecorShape; label: string; hint: string }[] = [
  { value: "cell", label: "Клетка", hint: "Каждое нажатие — одна клетка." },
  { value: "line", label: "Линия", hint: "Каждое нажатие продолжает линию от прошлой клетки." },
  { value: "area", label: "Область", hint: "Нажми на один угол, потом на другой — выберется прямоугольник между ними: дорога в две-три клетки шириной, роща, площадь." },
];
/** Build mode as the page keeps it: the city scene gets everything but `spot` and `project` (city3d/types.ts CityBuildView). */
export interface BuildState {
  district: string; area: "plots" | "public";
  /** A building from the inventory going onto the land (`moving`), or a shared project onto the public square. */
  placing: { family: PlotFamily | ProjectFamily; rotation: number; moving: number | null } | null;
  selected: number | null;
  plot: PickedPlot | null;
  /** Where the preview stands now and why it does not fit, as the scene reports it. */
  spot: { module: number; u: number; v: number; rotation: number; problem: string | null } | null;
  /** Staff place a shared project on the public square instead of building on the land. */
  project: boolean;
  decor?: DecorChoice | null;
}

const coins = (n: number) => n.toLocaleString("ru-RU");
const cellsText = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "клетка", "клетки", "клеток")}`;
type EstateOperation = { action: "purchase" | "place" | "upgrade" | "project" | "decor" | "undecor" | "turn"; run: () => Promise<OperationResult> };
/** One idempotency key per action: a retry or a double click sends the same key, a new action a new one. */
function useOperationKey() {
  const last = useRef<{ print: string; key: string } | null>(null);
  return {
    key(request: unknown) { const print = JSON.stringify(request); if (last.current?.print !== print) last.current = { print, key: operationKey() }; return last.current.key; },
    done() { last.current = null; },
  };
}

/**
 * Building in the operator's own district: a dock beside the map, not a modal, so the map stays reachable. The
 * district is the operators' to lay out: roads, footpaths, trees, lamps and the other small things go a cell at a
 * time (drawn along the map or tapped), and a building, a square, a house that grows by stages, a ready house or an
 * office, takes 3 × 3 cells wherever it fits, at the land price of its band plus the building's. A building's card
 * shows «Сейчас / После» and the next stage's price; four squares of one's own side by side become a park, six a big
 * park, by themselves. Buildings from the inventory after a transfer go onto free cells for free.
 */
export function CityEstateDock({ mine, land, build, setBuild, onClose, onFocus, onChooseFree, mapStatus = "ready", loadingLand = false, landError = null, onRetryLand, onRetryMap }: {
  mine: MyEstate; land: DistrictEstate | null; build: BuildState; setBuild: (next: BuildState | null) => void; onClose: () => void; onFocus: (target: EstateTarget) => void;
  /** Selects free cells for a building in the operator's district; the page checks current land and what stands on it. */
  onChooseFree?: () => void;
  mapStatus?: "loading" | "ready" | "failed"; loadingLand?: boolean; landError?: Error | null;
  onRetryLand?: () => void; onRetryMap?: () => void;
}) {
  const client = useQueryClient(), keys = useOperationKey();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const plots = new Map(mine.catalogue.map(c => [c.family, c])), projects = new Map(mine.projects.map(c => [c.family, c])), decor = new Map((mine.decor ?? []).map(c => [c.family, c]));
  const own = mine.objects, placed = own.filter(o => o.state === "placed"), stored = own.filter(o => o.state === "stored");
  const ready = mine.status === "ready" && !build.project && build.district === mine.district?.id;
  const mapDataReady = mapStatus === "ready" && !!land?.land && !loadingLand && !landError;
  const activeComplex = land?.landmark?.status === "active";
  const showComplex = activeComplex && (build.project || build.area === "public");
  const ownDecor = Object.values(land?.decor ?? {}).reduce((n, cells) => n + (cells ?? []).filter(c => c[3]).length, 0);
  const refresh = async (text: string) => { keys.done(); setNotice(text); await client.invalidateQueries(); };
  const act = useMutation({
    mutationFn: async ({ run }: EstateOperation) => run(),
    onSuccess: async (result, operation) => {
      if (result.project) {
        await refresh(`Сбор открыт: ${result.project.target_id ? `${result.project.name} → ${result.project.level_name}` : result.project.name}, смета ◈ ${coins(result.project.cost)}. Операторы района увидят его в карточке района.`);
        if (!mounted.current) return;
        setBuild({ ...build, placing: null, spot: null, selected: null });
        return;
      }
      if (operation.action === "decor" || operation.action === "undecor") {
        const item = build.decor && build.decor.tool !== "remove" ? decor.get(build.decor.tool) : undefined;
        await refresh(operation.action === "decor"
          ? `Построено: ${item?.name.toLowerCase() ?? "мелкие постройки"} — ${cellsText(result.laid ?? 0)}${result.price ? ` · −${coins(result.price)} коинов` : ""}.`
          : `Убрано: ${cellsText(result.removed ?? 0)}${result.refunded ? ` · вернулось ${coins(result.refunded)} коинов` : ""}.`);
        if (!mounted.current) return;
        setBuild({ ...build, decor: build.decor ? { ...build.decor, cells: [] } : null });
        return;
      }
      const obj = result.object, family = obj && plots.get(obj.family as PlotFamily), name = family?.levels[(obj?.level ?? 1) - 1]?.name;
      const action = operation.action === "purchase" ? "Построено" : operation.action === "place" ? "Постройка размещена" : operation.action === "upgrade" ? "Улучшено" : operation.action === "turn" ? "Фасад повёрнут" : "Готово";
      const text = result.merged ? obj?.family === "bigpark" ? "Построено: большой парк! Шесть твоих скверов объединились." : "Построено: парк! Четыре твоих сквера объединились."
        : `${action}: ${name ?? "постройка"}${result.price ? ` · −${coins(result.price)} коинов` : ""}.`;
      await refresh(text);
      if (!mounted.current) return;
      setBuild({ ...build, placing: null, spot: null, plot: null, selected: obj && "state" in obj && obj.state === "placed" ? obj.id : build.selected });
      if (obj && "state" in obj && obj.state === "placed" && operation.action !== "turn") onFocus({ district: obj.district_id, kind: "object", object: obj.id });
    },
  });
  const pending = act.isPending;
  const place = (o: OwnObject) => { act.reset(); setNotice(null); setBuild({ ...build, area: "plots", placing: { family: o.family, rotation: 0, moving: o.id }, plot: null, spot: null, selected: null, decor: null }); };
  const useTool = (tool: DecorTool) => { act.reset(); setNotice(null); setBuild({ ...build, area: "plots", placing: null, plot: null, spot: null, selected: null, decor: { tool, cells: [], shape: decorShape(tool) } }); };

  let body;
  if (showComplex) body = <DistrictLandmarkCard landmark={land!.landmark!} />;
  else if (build.placing) body = <Placing build={build} plots={plots} projects={projects} pending={pending} error={act.error}
    onRotate={() => setBuild({ ...build, placing: { ...build.placing!, rotation: (build.placing!.rotation + 1) % 4 } })}
    onCancel={() => { act.reset(); setBuild({ ...build, placing: null, spot: null, area: build.project ? "public" : "plots" }); }}
    onConfirm={() => {
      if (!build.project && !ready) return;
      const spot = build.spot!, placing = build.placing!;
      if (build.project) {
        const body = { district_id: build.district, family: placing.family as ProjectFamily, module: 0, u: spot.u, v: spot.v, rotation: spot.rotation, economy_revision: mine.economy_revision };
        act.mutate({ action: "project", run: () => cityEstate.openProject({ key: keys.key(body), ...body }) });
      } else {
        const obj = own.find(o => o.id === placing.moving)!, body = { district_id: build.district, version: obj.version, block: spot.module, col: spot.u, row: spot.v, rotation: spot.rotation };
        act.mutate({ action: "place", run: () => cityEstate.place(obj.id, { key: keys.key({ id: obj.id, ...body }), ...body }) });
      }
    }} />;
  else if (build.decor) {
    const choice = build.decor, item = choice.tool === "remove" ? null : decor.get(choice.tool) ?? null;
    body = <DecorPanel choice={choice} item={item} available={mine.available} batch={mine.decor_batch} message={mine.message} ready={ready} pending={pending} error={act.error}
      onShape={shape => setBuild({ ...build, decor: { ...choice, shape } })}
      onClear={() => { act.reset(); setBuild({ ...build, decor: { ...choice, cells: [] } }); }}
      onDone={() => { act.reset(); setBuild({ ...build, decor: null }); }}
      onConfirm={() => {
        if (!ready || pending || !choice.cells.length) return;
        const cells = choice.cells.map(c => [c.block, c.col, c.row] as [number, number, number]);
        if (choice.tool === "remove") {
          const body = { district_id: build.district, cells };
          act.mutate({ action: "undecor", run: () => cityEstate.takeAway({ key: keys.key({ undecor: true, ...body }), ...body }) });
        } else {
          const body = { district_id: build.district, family: choice.tool, cells, economy_revision: mine.economy_revision };
          act.mutate({ action: "decor", run: () => cityEstate.lay({ key: keys.key(body), ...body }) });
        }
      }} />;
  }
  else if (build.selected !== null) {
    const mineObject = own.find(o => o.id === build.selected), publicObject = land?.objects.find(o => o.id === build.selected);
    body = mineObject ? <OwnCard obj={mineObject} family={plots.get(mineObject.family)!} mine={mine} pending={pending} error={act.error} squares={placed.filter(o => o.family === "square").length}
      onUpgrade={() => { const body = { version: mineObject.version, economy_revision: mine.economy_revision }; act.mutate({ action: "upgrade", run: () => cityEstate.upgrade(mineObject.id, { key: keys.key({ up: mineObject.id, ...body }), ...body }) }); }}
      onTurn={() => { const body = { version: mineObject.version, rotation: (mineObject.rotation + 1) % 4 }; act.mutate({ action: "turn", run: () => cityEstate.turn(mineObject.id, { key: keys.key({ turn: mineObject.id, ...body }), ...body }) }); }}
      onBack={() => setBuild({ ...build, selected: null })} />
      : publicObject ? <PublicCard obj={publicObject} plots={plots} projects={projects} managed={!!land?.managed && land.construction} pending={pending} error={act.error}
        collecting={!!land?.projects.some(p => p.target_id === publicObject.id)} busy={!!land?.projects.some(p => projects.get(p.family)?.project === projects.get(publicObject.family as ProjectFamily)?.project)}
        onUpgrade={() => { const body = { district_id: build.district, family: publicObject.family as ProjectFamily, target_id: publicObject.id, economy_revision: mine.economy_revision }; act.mutate({ action: "project", run: () => cityEstate.openProject({ key: keys.key(body), ...body }) }); }}
        onBack={() => setBuild({ ...build, selected: null })} />
      : <p className="secondary small">Постройка уже изменилась. Обнови город.</p>;
  } else if (build.project) {
    // One main and one small project at a time (the server checks it too).
    const busy = new Set(land?.projects.map(p => projects.get(p.family)?.project).filter(Boolean));
    body = <ProjectList catalogue={mine.projects} busy={busy} onChoose={family => { act.reset(); setNotice(null); setBuild({ ...build, area: "public", placing: { family, rotation: 0, moving: null }, spot: null, selected: null }); }} />;
  } else if (build.plot) {
    const plot = build.plot, price = mine.land_prices[plot.band - 1] ?? 0;
    body = <PlotCard plot={plot} land={price} plots={plots} mine={mine} ready={ready} pending={pending} error={act.error}
      onTurn={() => setBuild({ ...build, plot: { ...plot, rotation: (plot.rotation + 1) % 4 } })}
      onBuy={family => { if (!ready || pending) return; const body = { district_id: build.district, family, block: plot.block, col: plot.col, row: plot.row, rotation: plot.rotation, economy_revision: mine.economy_revision }; act.mutate({ action: "purchase", run: () => cityEstate.purchase({ key: keys.key(body), ...body }) }); }}
      onBack={() => { act.reset(); setBuild({ ...build, plot: null }); }} />;
  } else body = <>
    {mine.status !== "ready" && <p className="estate-note">{mine.message}</p>}
    {mapDataReady && <Overview land={land} ready={ready} pending={pending} onChooseFree={onChooseFree && (() => {
      if (!ready || pending) return;
      act.reset(); setNotice(null); onChooseFree();
    })} />}
    {mapDataReady && <DecorPalette catalogue={mine.decor ?? []} available={mine.available} ready={ready} own={ownDecor} onTool={useTool} />}
    {stored.length > 0 && <section className="estate-section"><h3>Инвентарь</h3><p className="secondary small">Постройки после перевода в другой район: уровень и история сохранились. Поставь их на свободные клетки — бесплатно, вместе с землёй.</p>
      <ul className="estate-list">{stored.map(o => { const c = plots.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name} · {sizeText(plotSize(o.family, 0))}</small></span><button type="button" className="city-secondary" disabled={!ready} onClick={() => place(o)}>Поставить</button></li>; })}</ul></section>}
    {placed.length > 0 && <section className="estate-section"><h3>Мои постройки · {placed.length}</h3>
      <ul className="estate-list">{placed.map(o => { const c = plots.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name}{c.levels.length > 1 ? ` · ступень ${o.level} из ${c.levels.length}` : ""}</small></span><button type="button" className="city-secondary" onClick={() => { setBuild({ ...build, selected: o.id, plot: null }); onFocus({ district: o.district_id, kind: "object", object: o.id }); }}>Открыть</button></li>; })}</ul></section>}
    {mine.legacy.count > 0 && <p className="estate-note">Прежние постройки ({mine.legacy.count}) остаются на участках у учебных центров.</p>}
  </>;

  return <aside className="estate-dock glass glass--regular" aria-label="Стройка в районе">
    <header className="estate-dock__head">
      <div><span className="city-eyebrow"><DistrictSwatch district={build.district} />{showComplex ? "ГЛАВНОЕ ЗДАНИЕ РАЙОНА" : build.project ? "ПЛОЩАДЬ КОМАНДЫ" : "ЛИЧНЫЕ ПОСТРОЙКИ"} · {land?.name ?? mine.district?.name ?? "район"}</span>
        {!build.project && !showComplex && <p>Можно потратить <strong>◈ {coins(mine.available)}</strong>{mine.available < mine.balance ? " · часть в резерве магазина" : ""}</p>}</div>
      <button type="button" className="estate-dock__close" onClick={onClose} aria-label="Закрыть стройку">×</button>
    </header>
    <div className="estate-dock__body">
      {(mapStatus === "failed" || landError) ? <section className="estate-map-state" aria-label="Загрузка карты района">
        {mapStatus === "failed" && <>
          <p className="city-error" role="alert">Не удалось загрузить карту района.</p>
          <button type="button" className="city-secondary" disabled={!onRetryMap} onClick={onRetryMap}>Повторить загрузку карты</button>
        </>}
        {landError && <>
          <p className="city-error" role="alert">Не удалось загрузить свободные клетки района.</p>
          <button type="button" className="city-secondary" disabled={!onRetryLand} onClick={onRetryLand}>Повторить загрузку земли</button>
        </>}
      </section> : !mapDataReady && <p className="estate-note" role="status">Загружаем карту и свободные клетки района…</p>}
      {notice && <p className="estate-ok" role="status">{notice}</p>}
      {body}
      {!build.placing && !build.project && !build.decor && !showComplex && <button type="button" className="city-secondary" disabled={!mapDataReady} onClick={() => onFocus({ district: build.district, kind: "district" })}>Показать район на карте</button>}
      {!showComplex && <p className="city-fine">{build.project ? "Операторы видят общий прогресс сбора, но не чужие взносы." : "Соседи видят, что и какой ступени стоит на земле района, но не цену, баланс и имя."}</p>}
    </div>
  </aside>;
}

const sizeText = ([w, h]: [number, number]) => w * h === 1 ? "3 × 3 клетки" : `${w * 3} × ${h * 3} клеток`;
const cellText = ([w, h]: [number, number]) => `${w} × ${h} ${w * h === 1 ? "клетка" : "клетки"}`;

/** A short route from choosing land to buying, and the main building's progress. */
function Overview({ land, ready, pending, onChooseFree }: { land: DistrictEstate | null; ready: boolean; pending: boolean; onChooseFree?: () => void }) {
  const state = land?.land;
  const full = !!state && state.taken >= state.cells;
  return <>
    <section className="estate-claim"><h2 className="estate-step-title">{ready ? "Спланируй свой район" : "Как построить"}</h2>
      <ol className="estate-steps"><li>Проложи дороги и дорожки, посади деревья, поставь фонари — ниже, в «Дорогах и благоустройстве».</li><li>Для дома, офиса или сквера нажми на свободную клетку: постройка займёт 3 × 3 клетки вокруг неё.</li><li>Купи за коины: цена включает землю.</li></ol>
      {ready && <p>{full ? "Вся земля района занята. Открой свою постройку, чтобы посмотреть доступные улучшения." : "Свободные клетки района видны на карте светло-зелёными."}</p>}
      {ready && !full && onChooseFree && <button type="button" className="city-secondary estate-choose-free" disabled={pending} onClick={onChooseFree}>Подобрать место для дома</button>}
    </section>
    {state && <DistrictBuildProgress land={state} />}
    {land?.landmark && <DistrictLandmarkCard landmark={land.landmark} compact />}
  </>;
}

/**
 * The small things to lay, a tool each, and taking them away (`own` of them the viewer's; none, no button). In the
 * test city they are free (`available` null) and any can be taken away.
 */
export function DecorPalette({ catalogue, available, ready, own, onTool }: { catalogue: DecorCatalogue[]; available: number | null; ready: boolean; own: number; onTool: (tool: DecorTool) => void }) {
  if (!catalogue.length) return null;
  const free = available === null;
  return <section className="estate-section" aria-label="Дороги и благоустройство">
    <h3>Дороги и благоустройство</h3>
    <p className="secondary small">Каждая вещь занимает одну клетку. Дороги и дорожки сами соединяются с соседними, деревья, фонари и скамейки ставь вдоль них. {free ? "Здесь всё бесплатно." : "Цена включает землю, своё можно убрать — коины вернутся."}</p>
    <ul className="estate-tools">{catalogue.map(c => <li key={c.family}>
      <button type="button" disabled={!ready} onClick={() => onTool(c.family)} aria-label={free ? `${c.name}, бесплатно` : `${c.name}: ${c.price} коинов за клетку`} title={c.about}>
        <span className="estate-tools__icon" aria-hidden="true">{c.icon}</span><strong>{c.name}</strong><small>{free ? "бесплатно" : `◈ ${coins(c.price)}${available < c.price ? " · не хватает" : ""}`}</small>
      </button></li>)}</ul>
    {own > 0 && <button type="button" className="city-secondary" disabled={!ready} onClick={() => onTool("remove")}>{free ? "Убрать" : "Убрать своё"} · {cellsText(own)}</button>}
  </section>;
}

/**
 * Laying a small thing, or taking some away: how to choose cells, how many are chosen, what it costs (nothing in the
 * test city, `available` null).
 */
export function DecorPanel({ choice, item, available, batch, message, ready, pending, error, onShape, onClear, onDone, onConfirm }: { choice: DecorChoice; item: DecorCatalogue | null; available: number | null; batch: number; message: string | null; ready: boolean; pending: boolean; error: Error | null; onShape: (shape: DecorShape) => void; onClear: () => void; onDone: () => void; onConfirm: () => void }) {
  const free = available === null, removing = choice.tool === "remove", count = choice.cells.length, total = free ? 0 : (item?.price ?? 0) * count;
  const missing = removing || free ? 0 : total - available, limit = batch || 400, tooMany = count > limit;
  return <section className="estate-placing" aria-live="polite">
    <div className="estate-placing__title"><span aria-hidden="true">{removing ? "🧹" : item?.icon}</span><div><h2>{removing ? (choice.anyone ? "Убрать" : "Убрать своё") : item?.name}</h2><small>{removing ? (free ? "Дороги, деревья и другие мелкие постройки" : "Своё и общее района: за своё коины вернутся") : free ? "Бесплатно в тестовом городе" : `◈ ${coins(item?.price ?? 0)} за клетку · земля включена`}</small></div></div>
    {item && <p className="secondary small">{item.about}</p>}
    <p className="secondary small">{removing ? "Выбери клетки на карте — они подсвечены жёлтым. Проведи мышью — линия." : "Проведи по свободным клеткам левой кнопкой мыши — получится линия."} С зажатым <kbd>Ctrl</kbd> протяни мышью левой или правой кнопкой — выделится прямоугольник. Камера: правая кнопка мыши, колесо и WASD, на телефоне — двумя пальцами.</p>
    <div className="estate-shape" role="radiogroup" aria-label="Как выбирать клетки">{SHAPES.map(o => <button key={o.value} type="button" role="radio" aria-checked={choice.shape === o.value} onClick={() => onShape(o.value)}>{o.label}</button>)}</div>
    <p className="secondary small estate-shape__hint">{SHAPES.find(o => o.value === choice.shape)?.hint}</p>
    <p className={count ? "estate-ok" : "estate-note"}>{count ? `Выбрано: ${cellsText(count)}${removing || free ? "" : ` · ◈ ${coins(total)}`}` : "Клетки ещё не выбраны"}</p>
    {tooMany && <p className="estate-problem" role="alert">За раз можно выбрать не больше {limit} клеток.</p>}
    {!ready && <p className="estate-note">{message ?? "Стройка в районе пока закрыта."}</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    <div className="estate-placing__actions">
      <button type="button" className="city-action" disabled={!ready || pending || !count || tooMany || missing > 0} onClick={onConfirm}>
        {pending ? "Сохраняем…" : removing ? "Убрать выбранное" : missing > 0 ? `Не хватает ${coins(missing)}` : free ? "Поставить" : `Построить · ◈ ${coins(total)}`}
      </button>
      {count > 0 && <button type="button" className="city-secondary" onClick={onClear}>Сбросить выбор</button>}
      <button type="button" className="city-secondary" onClick={onDone}>Готово</button>
    </div>
    {/* The test city's own dock already says it is apart from the real one. */}
    {(removing || !free) && <p className="city-fine">{removing ? (choice.anyone ? "В тестовом городе можно убрать любую мелкую постройку." : "Убрать можно своё и общее района — то, что осталось от операторов, перешедших в другой район.") : "Выбор ничего не списывает: коины спишутся по кнопке «Построить», сервер проверит клетки ещё раз."}</p>}
  </section>;
}

/** A plot picked on the map: what can stand on its 3 × 3 cells, land and building together, or why it does not fit. */
function PlotCard({ plot, land, plots, mine, ready, pending, error, onBuy, onTurn, onBack }: { plot: PickedPlot; land: number; plots: Map<PlotFamily, PlotCatalogue>; mine: MyEstate; ready: boolean; pending: boolean; error: Error | null; onBuy: (family: PlotFamily) => void; onTurn: () => void; onBack: () => void }) {
  const { options, houses, offices } = splitPlotCatalogue([...plots.values()]);
  const item = (c: PlotCatalogue) => {
    const price = land + c.levels[0].price, missing = price - mine.available;
    return <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
      <span className="estate-catalogue__text"><strong>{c.levels[0].name}</strong><small>{c.levels[0].about}</small><small>Земля ◈ {coins(land)} + {c.ready ? readyBuildingLabel(c.family) : c.name.toLowerCase()} ◈ {coins(c.levels[0].price)}{c.levels.length > 1 ? ` · ${c.levels.length} ${plural(c.levels.length, "ступень", "ступени", "ступеней")}` : ""}</small></span>
      <button type="button" className="city-action" disabled={!ready || pending || !!plot.problem || missing > 0} onClick={() => onBuy(c.family)} aria-label={`${c.levels[0].name} за ${price} коинов`}>{pending ? "…" : missing > 0 ? `Не хватает ${coins(missing)}` : `Купить · ◈ ${coins(price)}`}</button></li>;
  };
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Весь район</button>
    <div className="estate-placing__title"><span aria-hidden="true">🟩</span><div><h2>{plot.problem ? "Выбранное место" : "Свободное место"}</h2><small>3 × 3 клетки · земля ◈ {coins(land)}, включена в цену</small></div></div>
    <h3 className="estate-step-title">Выбери здание</h3>
    <p className="secondary small">Можно выбрать другое место на карте. Жёлтая стрелка показывает, куда смотрит фасад: к дороге рядом дом повернётся сам.</p>
    <button type="button" className="city-secondary" onClick={onTurn}>Повернуть фасад</button>
    {plot.problem ? <p className="estate-problem" role="alert">{plot.problem}</p> : !ready ? <p className="estate-note">{mine.message ?? "Стройка в районе пока закрыта."}</p> : null}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    <ul className="estate-catalogue">{options.map(item)}</ul>
    {houses.length > 0 && <section className="estate-section"><h3>Готовые дома</h3><p className="secondary small">Дом покупается сразу целиком, без ступеней. Чем больше этажей и площадь, есть ли гараж и терраса — тем дороже.</p>
      <ul className="estate-catalogue">{houses.map(item)}</ul></section>}
    {offices.length > 0 && <section className="estate-section"><h3>Офисные здания</h3><p className="secondary small">Офисное здание покупается сразу целиком, по одной цене, без ступеней.</p>
      <ul className="estate-catalogue">{offices.map(item)}</ul></section>}
    <p className="city-fine">Нажми «Купить» у выбранного здания. На кнопке — полная цена земли и постройки. Покупка сразу списывает коины; продать постройку обратно нельзя.</p>
  </section>;
}

function ProjectList({ catalogue, busy, onChoose }: { catalogue: ProjectCatalogue[]; busy: Set<string | null | undefined>; onChoose: (family: ProjectFamily) => void }) {
  return <section className="estate-section"><h3>Что построить вместе</h3><p className="secondary small">На общественной площади района. Смета фиксируется при открытии. Операторы района вносят коины добровольно; при отмене взносы вернутся. Одновременно — один основной и один малый проект.</p>
    <ul className="estate-catalogue">{catalogue.map(c => <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
      <span className="estate-catalogue__text"><strong>{c.name}</strong><small>{cellText(projectFootprint(c.family, 0))} · {c.project === "main" ? "основной проект" : "малый проект"}</small></span>
      <button type="button" className="city-action" disabled={busy.has(c.project)} onClick={() => onChoose(c.family)}>{busy.has(c.project) ? (c.project === "main" ? "Идёт основной сбор" : "Идёт малый сбор") : `Смета ◈ ${coins(c.levels[0].cost)}`}</button></li>)}</ul></section>;
}

function Placing({ build, plots, projects, pending, error, onRotate, onCancel, onConfirm }: { build: BuildState; plots: Map<PlotFamily, PlotCatalogue>; projects: Map<ProjectFamily, ProjectCatalogue>; pending: boolean; error: Error | null; onRotate: () => void; onCancel: () => void; onConfirm: () => void }) {
  const placing = build.placing!, spot = build.spot;
  const item = build.project ? projects.get(placing.family as ProjectFamily) : plots.get(placing.family as PlotFamily);
  const size = build.project ? projectFootprint(placing.family as ProjectFamily, placing.rotation) : plotSize(placing.family as PlotFamily, placing.rotation);
  const cost = build.project ? (projects.get(placing.family as ProjectFamily)?.levels[0].cost ?? 0) : 0;
  // A building turns its front (a big park its shape); a project on the square turns only if it is not square.
  const turns = !build.project || size[0] !== size[1];
  return <section className="estate-placing" aria-live="polite">
    <div className="estate-placing__title"><span aria-hidden="true">{item?.icon}</span><div><h2>{item?.name}</h2><small>{build.project ? `${cellText(size)} · смета проекта` : `${sizeText(size)} · бесплатно, вместе с землёй`}</small></div></div>
    <p className="secondary small">{build.project ? "Выбери место на общественной площади района — нажми на клетку или наведи курсор." : "Выбери свободные клетки своего района — нажми на клетку или наведи курсор."}</p>
    {spot ? spot.problem ? <p className="estate-problem" role="alert">{spot.problem}</p> : <p className="estate-ok">Место подходит</p> : <p className="estate-note">Место ещё не выбрано</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    <div className="estate-placing__actions">
      {turns && <button type="button" className="city-secondary" onClick={onRotate}>Повернуть на 90°</button>}
      <button type="button" className="city-action" disabled={pending || !spot || !!spot.problem} onClick={onConfirm}>
        {pending ? "Сохраняем…" : build.project ? `Открыть сбор · ◈ ${coins(cost)}` : "Поставить сюда"}
      </button>
      <button type="button" className="city-secondary" onClick={onCancel}>Отмена</button>
    </div>
    <p className="city-fine">{build.project ? "Открытие сбора ничего не списывает. Если отменить проект, все взносы вернутся участникам." : "Предпросмотр ничего не меняет, сервер проверит место ещё раз."}</p>
  </section>;
}

function Stage({ level, total }: { level: number; total: number }) {
  return <span className="estate-stage" aria-label={`Ступень ${level} из ${total}`}>{Array.from({ length: total }, (_, i) => <i key={i} data-on={i < level || undefined} />)}</span>;
}

function OwnCard({ obj, family, mine, squares, pending, error, onUpgrade, onTurn, onBack }: { obj: OwnObject; family: PlotCatalogue; mine: MyEstate; squares: number; pending: boolean; error: Error | null; onUpgrade: () => void; onTurn: () => void; onBack: () => void }) {
  const now = family.levels[obj.level - 1], next = family.levels[obj.level], ready = mine.status === "ready";
  const missing = next ? next.price - mine.available : 0, park = obj.family === "park" || obj.family === "bigpark";
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Весь район</button>
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{now.name}</h2><small>{family.name} · твоя постройка</small></div></div>
    {PLOT_LEVELS[obj.family] > 1 && <Stage level={obj.level} total={PLOT_LEVELS[obj.family]} />}
    <dl className="estate-compare"><div><dt>Сейчас</dt><dd>{now.about}</dd></div>{next && <div><dt>После · {next.name}</dt><dd>{next.about}</dd></div>}</dl>
    {error && <p className="city-error" role="alert">{error.message}</p>}
    {next ? <button type="button" className="city-action" disabled={!ready || pending || missing > 0} onClick={onUpgrade}>{pending ? "Сохраняем…" : missing > 0 ? `Нужны ещё ${coins(missing)} коинов` : `Улучшить за ◈ ${coins(next.price)}`}</button>
      : PLOT_LEVELS[obj.family] > 1 ? <p className="estate-ok">Последняя ступень — постройка завершена.</p> : family.ready ? <p className="estate-ok">{isOfficeBuilding(obj.family) ? "Офисное здание построено целиком, ступеней нет." : "Готовый дом: он построен целиком, ступеней нет."}</p> : null}
    {!park && <><p className="secondary small">Фасад смотрит к дороге рядом. Если дороги нет — туда, куда ты его повернёшь.</p>
      <button type="button" className="city-secondary" disabled={!ready || pending} onClick={onTurn}>Повернуть фасад</button></>}
    {obj.family === "square" && <div className="estate-merge"><strong>Скверы собираются в парк</strong><p>Поставь свои скверы вплотную: четыре квадратом 2 × 2 станут парком, шесть прямоугольником 3 × 2 — большим парком. Сейчас у тебя скверов: {squares}.</p></div>}
    {obj.family === "park" && <div className="estate-merge"><strong>Парк может вырасти</strong><p>Ещё два своих сквера вплотную, чтобы вместе с парком получился прямоугольник 3 × 2, — и он станет большим парком, сохранив ступень.</p></div>}
    <p className="city-fine">Всего вложено ◈ {coins(obj.paid)}{obj.squares > 1 ? ` · из ${obj.squares} скверов` : ""}. Это видишь только ты.</p>
  </section>;
}

/** `collecting`: a project for this building's next stage is open; `busy`: another project of its size is (one main and one small at a time). */
function PublicCard({ obj, plots, projects, managed, collecting, busy, pending, error, onUpgrade, onBack }: { obj: PublicObject; plots: Map<PlotFamily, PlotCatalogue>; projects: Map<ProjectFamily, ProjectCatalogue>; managed: boolean; collecting: boolean; busy: boolean; pending: boolean; error: Error | null; onUpgrade: () => void; onBack: () => void }) {
  const district = obj.owner === "district", family = district ? projects.get(obj.family as ProjectFamily) : plots.get(obj.family as PlotFamily);
  if (!family) return null;
  const levels = district ? PROJECT_LEVELS[obj.family as ProjectFamily] : PLOT_LEVELS[obj.family as PlotFamily];
  const now = family.levels[obj.level - 1], next = district ? projects.get(obj.family as ProjectFamily)?.levels[obj.level] : undefined;
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Назад</button>
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{now.name}</h2><small>{family.name} · {district ? "построено районом" : obj.owner === "mine" ? "твоя постройка" : "постройка жителя"}</small></div></div>
    {levels > 1 && <Stage level={obj.level} total={levels} />}
    <p className="secondary small">{now.about}</p>
    {district && next && managed && <><p className="secondary small">Следующая ступень «{next.name}» — общий сбор района, смета ◈ {coins(next.cost)}.</p>
      {error && <p className="city-error" role="alert">{error.message}</p>}
      {collecting ? <p className="estate-note">Сбор на эту ступень уже идёт — он в карточке района.</p>
        : <button type="button" className="city-action" disabled={pending || busy} onClick={onUpgrade}>{busy ? `Сначала завершите ${projects.get(obj.family as ProjectFamily)?.project === "main" ? "основной" : "малый"} сбор` : "Открыть сбор на улучшение"}</button>}</>}
  </section>;
}
