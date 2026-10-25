import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cityEstate, operationKey, type DistrictEstate, type MyEstate, type OperationResult, type OwnObject, type PlotCatalogue, type PlotFamily, type ProjectCatalogue, type ProjectFamily, type PublicObject } from "../../api/cityEstate";
import { PLOT_LEVELS, PROJECT_LEVELS, isDecorFamily, plotFootprint, projectFootprint } from "../../city3d/world/estateGrid";
import type { EstateTarget } from "../../city3d/types";
import { DistrictSwatch } from "./DistrictSwatch";
import { SegmentedControl } from "../../components/ui";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";
import { DistrictBuildProgress } from "./DistrictBuildProgress";
import { DistrictLandmarkCard } from "./DistrictLandmarkCard";
import { CellShop, cellsText, coins, sizeText, type Arrange } from "./CityShop";
import { decorSpots, ownCells, type Choice } from "./cellChoice";
import { DEFAULT_SCREEN, arrowWay, shiftChosen, turnChosen, turnableChosen, type ScreenWays } from "./decorArrange";
import { districtLayout } from "../../city3d/world/estateGrid";
import { districtPlotGrid } from "./freeDistrictPlot";
import type { ChosenCell } from "../../city3d/types";
import "./estate.css";

export type { EstateTarget };
/** The dock's three parts: the shop, one's own buildings, the district's progress. */
type DockTab = "build" | "mine" | "district";
export type { Choice };
/** Build mode as the page keeps it: the city scene gets everything but `spot` and `project` (city3d/types.ts CityBuildView). */
export interface BuildState {
  district: string; area: "plots" | "public";
  /** A building from the inventory going onto the land (`moving`), or a shared project onto the public square. */
  placing: { family: PlotFamily | ProjectFamily; rotation: number; moving: number | null } | null;
  selected: number | null;
  /** The cells chosen on the map and what the shop chose for them. */
  choice: Choice | null;
  /** Where the preview stands now and why it does not fit, as the scene reports it. */
  spot: { module: number; u: number; v: number; rotation: number; problem: string | null } | null;
  /** Staff place a shared project on the public square instead of building on the land. */
  project: boolean;
}

/** `name`: the small thing laid, for the notice; `next`: the cells to choose once the small things moved there. */
type EstateOperation = { action: "purchase" | "place" | "upgrade" | "project" | "decor" | "undecor" | "turn" | "move" | "turnsmall"; run: () => Promise<OperationResult>; name?: string; next?: ChosenCell[] };
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
 * district is the operators' to lay out, cells first: a tap chooses a cell, a drag of the mouse's left button a line
 * of them, and the shop (CityShop.tsx) puts on them what is chosen there: a house or a ready house round the one cell
 * on 3 × 3, a square or an office on 2 × 2, roads, footpaths, alleys, trees, lamps and the other small things on the
 * cells of the line. A building is bought with its land, the band's price per cell. A building's card shows
 * «Сейчас / После» and the next stage's price; four squares of one's own side by side become a park, six a big park,
 * by themselves. Buildings from the inventory after a transfer go onto free cells for free. One's own small things on
 * the chosen cells move a cell along the screen (`screen`: which way of the cells is up it), lamps and benches turn.
 */
export function CityEstateDock({ mine, land, build, setBuild, onClose, onFocus, onChooseFree, mapStatus = "ready", loadingLand = false, landError = null, onRetryLand, onRetryMap, screen = DEFAULT_SCREEN }: {
  mine: MyEstate; land: DistrictEstate | null; build: BuildState; setBuild: (next: BuildState | null) => void; onClose: () => void; onFocus: (target: EstateTarget) => void;
  /** Chooses free cells for a house in the operator's district; the page checks current land and what stands on it. */
  onChooseFree?: () => void;
  mapStatus?: "loading" | "ready" | "failed"; loadingLand?: boolean; landError?: Error | null;
  onRetryLand?: () => void; onRetryMap?: () => void;
  screen?: ScreenWays;
}) {
  const client = useQueryClient(), keys = useOperationKey();
  const mounted = useRef(true), latest = useRef(build);
  latest.current = build;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** While the city refreshed after a save, the operator may already have tapped the next cell: that tap wins. */
  const current = () => mounted.current && latest.current === build;
  const [notice, setNotice] = useState<string | null>(null), [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<DockTab>("build");
  // Why the arrows could not move the things chosen holds only for those cells; cells tapped on the map open the shop.
  const chosenKey = JSON.stringify(build.choice?.cells.map(c => [c.block, c.col, c.row]) ?? []);
  useEffect(() => { setProblem(null); if (build.choice?.cells.length) setTab("build"); }, [chosenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const plots = new Map(mine.catalogue.map(c => [c.family, c])), projects = new Map(mine.projects.map(c => [c.family, c])), decor = new Map((mine.decor ?? []).map(c => [c.family, c]));
  const own = mine.objects, placed = own.filter(o => o.state === "placed"), stored = own.filter(o => o.state === "stored");
  const ready = mine.status === "ready" && !build.project && build.district === mine.district?.id;
  const mapDataReady = mapStatus === "ready" && !!land?.land && !loadingLand && !landError;
  const activeComplex = land?.landmark?.status === "active";
  const showComplex = activeComplex && (build.project || build.area === "public");
  const refresh = async (text: string) => { keys.done(); setNotice(text); await client.invalidateQueries(); };
  /** The cells chosen are spent: the next thing goes on new ones, the thing chosen in the shop stays. */
  const spent = (b: BuildState): Choice | null => b.choice && { ...b.choice, cells: [], at: null };
  const act = useMutation({
    mutationFn: async ({ run }: EstateOperation) => run(),
    onSuccess: async (result, operation) => {
      if (result.project) {
        await refresh(`Сбор открыт: ${result.project.target_id ? `${result.project.name} → ${result.project.level_name}` : result.project.name}, смета ◈ ${coins(result.project.cost)}. Операторы района увидят его в карточке района.`);
        if (!current()) return;
        setBuild({ ...build, placing: null, spot: null, selected: null });
        return;
      }
      if (operation.action === "move" || operation.action === "turnsmall") {
        await refresh(operation.action === "move" ? `Подвинуто: ${cellsText(result.moved ?? 0)}.` : `Повёрнуто: ${cellsText(result.turned ?? 0)}.`);
        if (!current()) return;
        // The cells chosen go with what moved, so the next arrow moves them on.
        if (operation.next) setBuild({ ...build, choice: build.choice && { ...build.choice, cells: operation.next, at: null } });
        return;
      }
      if (operation.action === "decor" || operation.action === "undecor") {
        await refresh(operation.action === "decor"
          ? `Построено: ${operation.name?.toLowerCase() ?? "мелкие постройки"} — ${cellsText(result.laid ?? 0)}${result.price ? ` · −${coins(result.price)} коинов` : ""}.`
          : `Убрано: ${cellsText(result.removed ?? 0)}${result.refunded ? ` · вернулось ${coins(result.refunded)} коинов` : ""}.`);
        if (!current()) return;
        setBuild({ ...build, choice: spent(build) });
        return;
      }
      const obj = result.object, family = obj && plots.get(obj.family as PlotFamily), name = family?.levels[(obj?.level ?? 1) - 1]?.name;
      const action = operation.action === "purchase" ? "Построено" : operation.action === "place" ? "Постройка размещена" : operation.action === "upgrade" ? "Улучшено" : operation.action === "turn" ? "Фасад повёрнут" : "Готово";
      const text = result.merged ? obj?.family === "bigpark" ? "Построено: большой парк! Шесть твоих скверов объединились." : "Построено: парк! Четыре твоих сквера объединились."
        : `${action}: ${name ?? "постройка"}${result.price ? ` · −${coins(result.price)} коинов` : ""}.`;
      await refresh(text);
      if (!current()) return;
      setBuild({ ...build, placing: null, spot: null, choice: operation.action === "purchase" ? spent(build) : build.choice, selected: obj && "state" in obj && obj.state === "placed" ? obj.id : build.selected });
      if (obj && "state" in obj && obj.state === "placed" && operation.action !== "turn") onFocus({ district: obj.district_id, kind: "object", object: obj.id });
    },
  });
  const pending = act.isPending;
  const place = (o: OwnObject) => { act.reset(); setNotice(null); setBuild({ ...build, area: "plots", placing: { family: o.family, rotation: 0, moving: o.id }, choice: spent(build), spot: null, selected: null }); };
  /** Buys what the shop chose: a building round the one cell chosen, or a small thing on the free cells of the line. */
  const buy = () => {
    const choice = build.choice, family = choice?.family;
    if (!ready || pending || !choice || !family) return;
    if (isDecorFamily(family)) {
      const cells = decorSpots(choice).free.map(c => [c.block, c.col, c.row] as [number, number, number]);
      if (!cells.length) return;
      const body = { district_id: build.district, family, cells, economy_revision: mine.economy_revision };
      act.mutate({ action: "decor", name: decor.get(family)?.name, run: () => cityEstate.lay({ key: keys.key(body), ...body }) });
      return;
    }
    const cell = choice.cells.length === 1 ? choice.cells[0] : null, at = choice.at;
    if (!cell || !at || at.problem) return;
    const body = { district_id: build.district, family, block: cell.block, col: at.col, row: at.row, rotation: choice.rotation, economy_revision: mine.economy_revision };
    act.mutate({ action: "purchase", run: () => cityEstate.purchase({ key: keys.key(body), ...body }) });
  };
  /** Takes away one's own small things (and the district's) on the cells chosen, for their coins back. */
  const takeAway = () => {
    const cells = ownCells(build.choice).map(c => [c.block, c.col, c.row] as [number, number, number]);
    if (!ready || pending || !cells.length) return;
    const body = { district_id: build.district, cells };
    act.mutate({ action: "undecor", run: () => cityEstate.takeAway({ key: keys.key({ undecor: true, ...body }), ...body }) });
  };
  /** One's own small things on the chosen cells a cell along the screen, and the lamps and benches among them turned. */
  const grid = land ? districtPlotGrid(land.id.startsWith("sales") ? "sales" : "support", districtLayout(land.id)) : null;
  const arrange: Arrange = {
    turnable: turnableChosen(land, build.choice?.cells ?? []).length, problem,
    onMove: arrow => {
      if (!ready || pending || !land || !grid || !build.choice) return;
      act.reset(); setNotice(null);
      const shift = shiftChosen(grid, land, build.choice.cells, arrowWay(screen, arrow));
      setProblem(shift.problem);
      if (shift.problem || !shift.moves.length) return;
      const body = { district_id: build.district, moves: shift.moves };
      act.mutate({ action: "move", next: shift.cells, run: () => cityEstate.moveDecor({ key: keys.key({ move: true, ...body }), ...body }) });
    },
    onTurn: step => {
      if (!ready || pending || !land || !grid || !build.choice) return;
      act.reset(); setNotice(null); setProblem(null);
      const cells = turnChosen(grid, land, build.choice.cells, step);
      if (!cells.length) return;
      const body = { district_id: build.district, cells };
      act.mutate({ action: "turnsmall", run: () => cityEstate.turnDecor({ key: keys.key({ turn: true, ...body }), ...body }) });
    },
  };

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
  } else body = <>
    <SegmentedControl block label="Разделы стройки" value={tab} onChange={setTab}
      options={[{ value: "build", label: "Строить" }, { value: "mine", label: own.length ? `Мои · ${own.length}` : "Мои постройки" }, { value: "district", label: "Район" }]} />
    {mine.status !== "ready" && <p className="estate-note">{mine.message}</p>}
    {tab === "build" ? <>
      {mapDataReady && ready && land!.land!.taken >= land!.land!.cells && <p className="estate-note">Вся земля района занята. Открой свою постройку во вкладке «Мои постройки», чтобы посмотреть доступные улучшения.</p>}
      {mapDataReady && <CellShop choice={build.choice} plots={mine.catalogue} decor={mine.decor ?? []} landPrices={mine.land_prices} available={mine.available} batch={mine.decor_batch}
        ready={ready} message={mine.message} pending={pending} error={act.error} onBuy={buy} onRemove={takeAway} arrange={arrange}
        onChoice={choice => { act.reset(); setProblem(null); setBuild({ ...build, choice }); }}
        onChooseFree={onChooseFree && (() => { if (!ready || pending) return; act.reset(); setNotice(null); onChooseFree(); })} />}
    </> : tab === "mine" ? <>
      {stored.length > 0 && <section className="estate-section"><h3>Ждут места · {stored.length}</h3><p className="secondary small">Постройки после перевода в другой район или после перестройки клеток: уровень и всё вложенное сохранились. Поставь их на свободные клетки — бесплатно, вместе с землёй.</p>
        <ul className="estate-list">{stored.map(o => { const c = plots.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name} · {sizeText(plotFootprint(o.family, 0))}</small></span><button type="button" className="city-secondary" disabled={!ready} onClick={() => place(o)}>Поставить</button></li>; })}</ul></section>}
      {placed.length > 0 ? <section className="estate-section"><h3>На земле района · {placed.length}</h3>
        <ul className="estate-list">{placed.map(o => { const c = plots.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name}{c.levels.length > 1 ? ` · ступень ${o.level} из ${c.levels.length}` : ""}</small></span><button type="button" className="city-secondary" onClick={() => { setBuild({ ...build, selected: o.id, choice: spent(build) }); onFocus({ district: o.district_id, kind: "object", object: o.id }); }}>Открыть</button></li>; })}</ul></section>
        : !stored.length && <div className="estate-empty"><p>Здесь появятся твои дома, офисы и скверы. Дороги, деревья и фонари видны прямо на карте.</p><button type="button" className="city-action" onClick={() => setTab("build")}>Выбрать, что построить</button></div>}
      {mine.legacy.count > 0 && <p className="estate-note">Прежние постройки ({mine.legacy.count}) остаются на участках у учебных центров.</p>}
    </> : <DistrictTab land={mapDataReady ? land : null} onShow={() => onFocus({ district: build.district, kind: "district" })} />}
  </>;

  return <aside className="estate-dock glass glass--regular" aria-label="Стройка в районе">
    <header className="estate-dock__head">
      <div><span className="city-eyebrow"><DistrictSwatch district={build.district} />{showComplex ? "ГЛАВНОЕ ЗДАНИЕ РАЙОНА" : build.project ? "ПЛОЩАДЬ КОМАНДЫ" : "СТРОЙКА"} · {land?.name ?? mine.district?.name ?? "район"}</span>
        {!build.project && !showComplex && <p>На счёте <strong>◈ {coins(mine.available)}</strong>{mine.available < mine.balance ? " · часть в резерве магазина" : ""}</p>}</div>
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
      {build.project && !showComplex && <p className="city-fine">Операторы видят общий прогресс сбора, но не чужие взносы.</p>}
    </div>
  </aside>;
}

/** «Район»: how much of the land is taken, the main building's growth, and the whole district on the map once it is loaded. */
export function DistrictTab({ land, onShow }: { land: DistrictEstate | null; onShow: () => void }) {
  return <>
    {land?.land && <DistrictBuildProgress land={land.land} />}
    {land?.landmark && <DistrictLandmarkCard landmark={land.landmark} compact />}
    <button type="button" className="city-secondary" disabled={!land?.land} onClick={onShow}>Показать весь район на карте</button>
    <p className="city-fine">Соседи видят, что и какой ступени стоит на земле района, но не цену, баланс и имя.</p>
  </>;
}

const cellText = ([w, h]: [number, number]) => `${w} × ${h} ${w * h === 1 ? "клетка" : "клетки"}`;

function ProjectList({ catalogue, busy, onChoose }: { catalogue: ProjectCatalogue[]; busy: Set<string | null | undefined>; onChoose: (family: ProjectFamily) => void }) {
  return <section className="estate-section"><h3>Что построить вместе</h3><p className="secondary small">На общественной площади района. Смета фиксируется при открытии. Операторы района вносят коины добровольно; при отмене взносы вернутся. Одновременно — один основной и один малый проект.</p>
    <ul className="estate-catalogue">{catalogue.map(c => <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
      <span className="estate-catalogue__text"><strong>{c.name}</strong><small>{cellText(projectFootprint(c.family, 0))} · {c.project === "main" ? "основной проект" : "малый проект"}</small></span>
      <button type="button" className="city-action" disabled={busy.has(c.project)} onClick={() => onChoose(c.family)}>{busy.has(c.project) ? (c.project === "main" ? "Идёт основной сбор" : "Идёт малый сбор") : `Смета ◈ ${coins(c.levels[0].cost)}`}</button></li>)}</ul></section>;
}

function Placing({ build, plots, projects, pending, error, onRotate, onCancel, onConfirm }: { build: BuildState; plots: Map<PlotFamily, PlotCatalogue>; projects: Map<ProjectFamily, ProjectCatalogue>; pending: boolean; error: Error | null; onRotate: () => void; onCancel: () => void; onConfirm: () => void }) {
  const placing = build.placing!, spot = build.spot;
  const item = build.project ? projects.get(placing.family as ProjectFamily) : plots.get(placing.family as PlotFamily);
  const size = build.project ? projectFootprint(placing.family as ProjectFamily, placing.rotation) : plotFootprint(placing.family as PlotFamily, placing.rotation);
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
  return <span className="estate-stage" role="img" aria-label={`Ступень ${level} из ${total}`}>{Array.from({ length: total }, (_, i) => <i key={i} data-on={i < level || undefined} />)}</span>;
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
    {obj.family === "square" && <div className="estate-merge"><strong>Скверы собираются в парк</strong><p>Поставь свои скверы вплотную: четыре квадратом (4 × 4 клетки) станут парком, шесть прямоугольником (6 × 4 клетки) — большим парком. Сейчас у тебя скверов: {squares}.</p></div>}
    {obj.family === "park" && <div className="estate-merge"><strong>Парк может вырасти</strong><p>Ещё два своих сквера вплотную, чтобы вместе с парком получился прямоугольник 6 × 4 клетки, — и он станет большим парком, сохранив ступень.</p></div>}
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
