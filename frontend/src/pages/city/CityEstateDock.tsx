import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cityEstate, operationKey, type CatalogueFamily, type DistrictEstate, type EstateFamily, type MyEstate, type OperationResult, type OwnObject, type PublicObject } from "../../api/cityEstate";
import { FAMILY_LEVELS, footprint } from "../../city3d/world/estateGrid";
import { plural } from "../../utils/format";
import "./estate.css";

/** Build mode as the page keeps it: the city scene gets everything but `spot` and `project` (city3d/types.ts CityBuildView). */
export interface BuildState {
  district: string; area: "estate" | "lot" | "public";
  placing: { family: EstateFamily; rotation: number; moving: number | null } | null;
  selected: number | null;
  /** Where the preview stands now and why it does not fit, as the scene reports it. */
  spot: { module: number; u: number; v: number; rotation: number; problem: string | null } | null;
  /** Staff place a shared project on the public square instead of a personal building. */
  project: boolean;
}
export type EstateTarget = { district: string; kind: "estate" | "lot" | "public" | "object"; object?: number };

const coins = (n: number) => n.toLocaleString("ru-RU");
/** One idempotency key per action: a retry or a double click sends the same key, a new action a new one. */
function useOperationKey() {
  const last = useRef<{ print: string; key: string } | null>(null);
  return {
    key(request: unknown) { const print = JSON.stringify(request); if (last.current?.print !== print) last.current = { print, key: operationKey() }; return last.current.key; },
    done() { last.current = null; },
  };
}

/**
 * Building in the operator's own district: a dock beside the map, not a modal, so the preview on the map stays
 * reachable. The catalogue with prices of the current revision, the preview's reason, rotate and confirm;
 * a building's card with «Сейчас / После», moving, the inventory and the six squares' merge.
 */
export function CityEstateDock({ mine, land, build, setBuild, onClose, onFocus }: {
  mine: MyEstate; land: DistrictEstate | null; build: BuildState; setBuild: (next: BuildState | null) => void; onClose: () => void; onFocus: (target: EstateTarget) => void;
}) {
  const client = useQueryClient(), keys = useOperationKey();
  const [notice, setNotice] = useState<string | null>(null);
  const catalogue = new Map(mine.catalogue.map(c => [c.family, c]));
  const own = mine.objects, placed = own.filter(o => o.state === "placed"), stored = own.filter(o => o.state === "stored");
  const ready = mine.status === "ready" && !build.project;
  const refresh = async (text: string) => { keys.done(); setNotice(text); await client.invalidateQueries(); };
  const claim = useMutation({ mutationFn: cityEstate.claim, onSuccess: async lot => { await refresh("Усадьба твоя. Можно строить."); onFocus({ district: lot.district_id, kind: "estate" }); } });
  const act = useMutation({
    mutationFn: async (run: () => Promise<OperationResult>) => run(),
    onSuccess: async (result, run) => {
      void run;
      if (result.project) {
        await refresh(`Сбор открыт: ${result.project.target_id ? `${result.project.name} → ${result.project.level_name}` : result.project.name}, смета ◈ ${coins(result.project.cost)}. Операторы района увидят его в карточке района.`);
        setBuild({ ...build, placing: null, spot: null, selected: null });
        return;
      }
      const name = result.object ? catalogue.get(result.object.family)?.levels[result.object.level - 1]?.name : null;
      await refresh(result.price ? `Готово: ${name ?? "постройка"} · −${coins(result.price)} коинов` : `Готово${name ? `: ${name}` : ""}`);
      setBuild({ ...build, placing: null, spot: null, selected: result.object && "state" in result.object && result.object.state === "placed" ? result.object.id : build.selected });
    },
  });
  const pending = act.isPending || claim.isPending;
  const choose = (family: EstateFamily, moving: number | null = null) => {
    act.reset(); setNotice(null);
    setBuild({ ...build, area: family === "tower" ? "lot" : build.project ? "public" : "estate", placing: { family, rotation: 0, moving }, spot: null, selected: null });
    // Towers stand in the business quarter, away from the estate: fly there so its free lots are in view.
    if (family === "tower") onFocus({ district: build.district, kind: "lot" });
  };

  let body;
  if (build.placing) body = <Placing family={catalogue.get(build.placing.family)!} build={build} mine={mine} pending={pending} error={act.error}
    onRotate={() => setBuild({ ...build, placing: { ...build.placing!, rotation: (build.placing!.rotation + 1) % 4 } })}
    onCancel={() => { act.reset(); setBuild({ ...build, placing: null, spot: null, area: build.project ? "public" : "estate" }); }}
    onConfirm={() => {
      const spot = build.spot!, placing = build.placing!;
      if (build.project) {
        const body = { district_id: build.district, family: placing.family, module: spot.module, u: spot.u, v: spot.v, rotation: spot.rotation, economy_revision: mine.economy_revision };
        act.mutate(() => cityEstate.openProject({ key: keys.key(body), ...body }));
      } else if (placing.moving !== null) {
        const obj = own.find(o => o.id === placing.moving)!, body = { version: obj.version, module: spot.module, u: spot.u, v: spot.v, rotation: spot.rotation };
        act.mutate(() => cityEstate.move(obj.id, { key: keys.key({ id: obj.id, ...body }), ...body }));
      } else {
        const body = { family: placing.family, module: spot.module, u: spot.u, v: spot.v, rotation: spot.rotation, economy_revision: mine.economy_revision };
        act.mutate(() => cityEstate.purchase({ key: keys.key(body), ...body }));
      }
    }} />;
  else if (build.selected !== null) {
    const mineObject = own.find(o => o.id === build.selected), publicObject = land?.objects.find(o => o.id === build.selected);
    body = mineObject ? <OwnCard obj={mineObject} family={catalogue.get(mineObject.family)!} mine={mine} pending={pending} error={act.error} squares={placed.filter(o => o.family === "square")}
      onUpgrade={() => { const body = { version: mineObject.version, economy_revision: mine.economy_revision }; act.mutate(() => cityEstate.upgrade(mineObject.id, { key: keys.key({ up: mineObject.id, ...body }), ...body })); }}
      onMove={() => choose(mineObject.family, mineObject.id)}
      onStore={() => { const body = { version: mineObject.version }; act.mutate(() => cityEstate.store(mineObject.id, { key: keys.key({ store: mineObject.id, ...body }), ...body })); }}
      onMerge={ids => { const body = { ids, economy_revision: mine.economy_revision }; act.mutate(() => cityEstate.merge({ key: keys.key(body), ...body })); }}
      onBack={() => setBuild({ ...build, selected: null })} />
      : publicObject ? <PublicCard obj={publicObject} family={catalogue.get(publicObject.family)!} managed={!!land?.managed && land.construction} pending={pending} error={act.error}
        collecting={!!land?.projects.some(p => p.target_id === publicObject.id)} busy={!!land?.projects.some(p => catalogue.get(p.family)?.project === catalogue.get(publicObject.family)?.project)}
        onUpgrade={() => { const body = { district_id: build.district, family: publicObject.family, target_id: publicObject.id, economy_revision: mine.economy_revision }; act.mutate(() => cityEstate.openProject({ key: keys.key(body), ...body })); }}
        onBack={() => setBuild({ ...build, selected: null })} />
      : <p className="secondary">Постройка уже изменилась. Обнови город.</p>;
  } else if (build.project) {
    // One main and one small project at a time (the server checks it too).
    const busy = new Set(land?.projects.map(p => catalogue.get(p.family)?.project).filter(Boolean));
    body = <ProjectCatalogue catalogue={mine.catalogue} busy={busy} onChoose={family => choose(family)} />;
  }
  else body = <>
    {mine.status !== "ready" && <p className="estate-note">{mine.message}</p>}
    {mine.status === "ready" && !mine.estate && <div className="estate-claim"><strong>Твоя усадьба ждёт</strong><p>Участок 4 × 4 клетки в районе команды выдаётся бесплатно. Дом стоит в задней половине, сад — в передней.</p><button type="button" className="city-action" disabled={claim.isPending} onClick={() => claim.mutate()}>{claim.isPending ? "Выбираем участок…" : "Получить усадьбу →"}</button>{claim.isError && <p className="city-error" role="alert">{claim.error.message}</p>}</div>}
    <Catalogue catalogue={mine.catalogue} available={mine.available} enabled={ready && !!mine.estate} own={own} onChoose={family => choose(family)} />
    {stored.length > 0 && <section className="estate-section"><h3>Инвентарь</h3><p className="secondary small">Постройки сохранили уровень и историю. Поставь их на свободное место — бесплатно.</p>
      <ul className="estate-list">{stored.map(o => { const c = catalogue.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name}</small></span><button type="button" className="city-secondary" disabled={!ready || !mine.estate} onClick={() => choose(o.family, o.id)}>Поставить</button></li>; })}</ul></section>}
    {placed.length > 0 && <section className="estate-section"><h3>Мои постройки</h3>
      <ul className="estate-list">{placed.map(o => { const c = catalogue.get(o.family)!; return <li key={o.id}><span aria-hidden="true">{c.icon}</span><span><strong>{c.levels[o.level - 1].name}</strong><small>{c.name} · ступень {o.level} из {c.levels.length}</small></span><button type="button" className="city-secondary" onClick={() => { setBuild({ ...build, selected: o.id }); onFocus({ district: o.district_id, kind: "object", object: o.id }); }}>Открыть</button></li>; })}</ul></section>}
    {mine.legacy.count > 0 && <p className="estate-note">Прежние постройки ({mine.legacy.count}) остаются на участках у учебных центров. Перенос в район подготовим отдельно и без повторной оплаты.</p>}
  </>;

  return <aside className="estate-dock glass glass--regular" aria-label="Стройка в районе">
    <header className="estate-dock__head">
      <div><span className="city-eyebrow">{build.project ? "ОБЩИЙ ПРОЕКТ" : "МОЙ РАЙОН"} · {land?.name ?? mine.district?.name ?? "район"}</span>
        {!build.project && <p>Можно потратить <strong>◈ {coins(mine.available)}</strong>{mine.available < mine.balance ? " · часть в резерве магазина" : ""}</p>}</div>
      <button type="button" className="estate-dock__close" onClick={onClose} aria-label="Закрыть стройку">×</button>
    </header>
    <div className="estate-dock__body">
      {notice && <p className="estate-ok" role="status">{notice}</p>}
      {body}
      {!build.placing && !build.project && mine.estate && <button type="button" className="city-secondary" onClick={() => onFocus({ district: mine.estate!.district_id, kind: "estate" })}>Показать мою усадьбу</button>}
      <p className="city-fine">{build.project ? "Операторы видят общий прогресс сбора, но не чужие взносы." : "Соседи видят вид и ступень твоих построек, но не цену, баланс и имя. Сетка видна только во время стройки."}</p>
    </div>
  </aside>;
}

const cells = (w: number, h: number) => `${w} × ${h} ${w * h === 1 ? "клетка" : "клетки"}`;
function sizeText(c: CatalogueFamily) { return cells(c.size[0], c.size[1]); }

function Catalogue({ catalogue, available, enabled, own, onChoose }: { catalogue: CatalogueFamily[]; available: number; enabled: boolean; own: OwnObject[]; onChoose: (family: EstateFamily) => void }) {
  const has = (family: EstateFamily) => own.some(o => o.family === family);
  const groups: [string, string, CatalogueFamily[]][] = [
    ["Дом", "Задняя половина усадьбы. Пять ступеней: от первого дома до усадьбы.", catalogue.filter(c => c.zone === "house")],
    ["Сад усадьбы", "Передняя половина, 4 × 2 клетки. Шесть скверов прямоугольником 3 × 2 объединяются в большой парк.", catalogue.filter(c => c.zone === "garden" && !c.recipe)],
    ["Деловой квартал", "Один небоскрёб на оператора, на своём участке 4 × 4: от 50 до 200 этажей.", catalogue.filter(c => c.zone === "lot")],
  ];
  return <>{groups.map(([title, about, items]) => <section className="estate-section" key={title}><h3>{title}</h3><p className="secondary small">{about}</p>
    <ul className="estate-catalogue">{items.map(c => {
      const price = c.levels[0].price, missing = price - available, taken = (c.zone === "house" || c.zone === "lot") && has(c.family);
      return <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
        <span className="estate-catalogue__text"><strong>{c.name}</strong><small>{sizeText(c)} · {c.levels.length > 1 ? `${c.levels.length} ${plural(c.levels.length, "ступень", "ступени", "ступеней")}` : "одна ступень"}</small><small>{c.levels[0].about}</small></span>
        <button type="button" className="city-action" disabled={!enabled || taken || missing > 0} onClick={() => onChoose(c.family)} aria-label={`${c.name} за ${price} коинов`}>{taken ? "Уже есть" : missing > 0 ? `Не хватает ${coins(missing)}` : `◈ ${coins(price)}`}</button></li>;
    })}</ul></section>)}</>;
}

function ProjectCatalogue({ catalogue, busy, onChoose }: { catalogue: CatalogueFamily[]; busy: Set<string | null | undefined>; onChoose: (family: EstateFamily) => void }) {
  return <section className="estate-section"><h3>Что построить вместе</h3><p className="secondary small">Смета фиксируется при открытии. Операторы района вносят коины добровольно; при отмене взносы вернутся. Одновременно — один основной и один малый проект.</p>
    <ul className="estate-catalogue">{catalogue.filter(c => c.project).map(c => <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
      <span className="estate-catalogue__text"><strong>{c.name}</strong><small>{sizeText(c)} · {c.project === "main" ? "основной проект" : "малый проект"}</small></span>
      <button type="button" className="city-action" disabled={busy.has(c.project)} onClick={() => onChoose(c.family)}>{busy.has(c.project) ? (c.project === "main" ? "Идёт основной сбор" : "Идёт малый сбор") : `Смета ◈ ${coins(c.levels[0].project_cost ?? 0)}`}</button></li>)}</ul></section>;
}

function Placing({ family, build, mine, pending, error, onRotate, onCancel, onConfirm }: { family: CatalogueFamily; build: BuildState; mine: MyEstate; pending: boolean; error: Error | null; onRotate: () => void; onCancel: () => void; onConfirm: () => void }) {
  const moving = build.placing!.moving !== null, price = build.project ? family.levels[0].project_cost ?? 0 : moving ? 0 : family.levels[0].price;
  const [w, h] = footprint(family.family, build.placing!.rotation), spot = build.spot, fixed = family.zone === "house";
  return <section className="estate-placing" aria-live="polite">
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{family.name}</h2><small>{cells(w, h)}{moving ? " · перенос бесплатный" : build.project ? " · смета проекта" : ""}</small></div></div>
    <p className="secondary small">{fixed ? "Дом занимает заднюю половину усадьбы: его место уже подсвечено." : family.zone === "lot" ? "Выбери свободный деловой участок 4 × 4 — нажми на него или наведи курсор." : build.project ? "Выбери место на общественной земле района." : "Выбери клетку сада — нажми на неё или наведи курсор."}</p>
    {spot ? spot.problem ? <p className="estate-problem" role="alert">{spot.problem}</p> : <p className="estate-ok">Место подходит</p> : <p className="estate-note">Место ещё не выбрано</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    <div className="estate-placing__actions">
      {!fixed && family.zone !== "lot" && family.size[0] !== family.size[1] && <button type="button" className="city-secondary" onClick={onRotate}>Повернуть на 90°</button>}
      <button type="button" className="city-action" disabled={pending || !spot || !!spot.problem || (!moving && !build.project && price > mine.available)} onClick={onConfirm}>
        {pending ? "Сохраняем…" : build.project ? `Открыть сбор · ◈ ${coins(price)}` : moving ? "Поставить сюда" : price > mine.available ? `Не хватает ${coins(price - mine.available)}` : `Построить за ◈ ${coins(price)}`}
      </button>
      <button type="button" className="city-secondary" onClick={onCancel}>Отмена</button>
    </div>
    <p className="city-fine">{build.project ? "Открытие сбора ничего не списывает. Если отменить проект, все взносы вернутся участникам." : "Предпросмотр ничего не списывает. Отмена после подтверждения не отменяет покупку."}</p>
  </section>;
}

/** The 3 × 2 or 2 × 3 group of the operator's own squares this square can merge with, if any. */
function recipeFor(square: OwnObject, squares: OwnObject[]) {
  const at = new Map(squares.filter(o => o.module === square.module).map(o => [`${o.u}:${o.v}`, o]));
  for (const [w, h] of [[3, 2], [2, 3]]) for (let du = 0; du < w; du++) for (let dv = 0; dv < h; dv++) {
    const u0 = square.u! - du, v0 = square.v! - dv, group: OwnObject[] = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) { const o = at.get(`${u0 + i}:${v0 + j}`); if (o) group.push(o); }
    if (group.length === 6) return group;
  }
  return null;
}

function Stage({ level, total }: { level: number; total: number }) {
  return <span className="estate-stage" aria-label={`Ступень ${level} из ${total}`}>{Array.from({ length: total }, (_, i) => <i key={i} data-on={i < level || undefined} />)}</span>;
}

function OwnCard({ obj, family, mine, squares, pending, error, onUpgrade, onMove, onStore, onMerge, onBack }: { obj: OwnObject; family: CatalogueFamily; mine: MyEstate; squares: OwnObject[]; pending: boolean; error: Error | null; onUpgrade: () => void; onMove: () => void; onStore: () => void; onMerge: (ids: number[]) => void; onBack: () => void }) {
  const now = family.levels[obj.level - 1], next = family.levels[obj.level], ready = mine.status === "ready";
  const missing = next ? next.price - mine.available : 0, group = obj.family === "square" ? recipeFor(obj, squares) : null;
  const fee = mine.catalogue.find(c => c.family === "park")?.levels[0].price ?? 0;
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Все постройки</button>
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{now.name}</h2><small>{family.name} · твоя постройка</small></div></div>
    <Stage level={obj.level} total={FAMILY_LEVELS[obj.family]} />
    <dl className="estate-compare"><div><dt>Сейчас</dt><dd>{now.about}</dd></div>{next && <div><dt>После · {next.name}</dt><dd>{next.about}</dd></div>}</dl>
    {error && <p className="city-error" role="alert">{error.message}</p>}
    {next ? <button type="button" className="city-action" disabled={!ready || pending || missing > 0} onClick={onUpgrade}>{pending ? "Сохраняем…" : missing > 0 ? `Нужны ещё ${coins(missing)} коинов` : `Улучшить за ◈ ${coins(next.price)}`}</button>
      : <p className="estate-ok">Последняя ступень — постройка завершена.</p>}
    {group && <div className="estate-merge"><strong>Шесть скверов рядом</strong><p>Они станут одним большим парком 3 × 2 на тех же клетках. Владелец — ты, стоимость и история скверов сохранятся{fee ? `, объединение стоит ◈ ${coins(fee)}` : ", объединение бесплатно"}.</p>
      <button type="button" className="city-action" disabled={!ready || pending || fee > mine.available} onClick={() => onMerge(group.map(o => o.id))}>Объединить в большой парк</button></div>}
    {obj.family !== "house" && <div className="estate-placing__actions"><button type="button" className="city-secondary" disabled={!ready || pending} onClick={onMove}>Переместить</button><button type="button" className="city-secondary" disabled={!ready || pending} onClick={onStore}>Убрать в инвентарь</button></div>}
    <p className="city-fine">Всего вложено ◈ {coins(obj.paid)}{obj.components ? ` · из ${obj.components} скверов` : ""}. Это видишь только ты.</p>
  </section>;
}

/** `collecting`: a project for this building's next stage is open; `busy`: another project of its size is (one main and one small at a time). */
function PublicCard({ obj, family, managed, collecting, busy, pending, error, onUpgrade, onBack }: { obj: PublicObject; family: CatalogueFamily; managed: boolean; collecting: boolean; busy: boolean; pending: boolean; error: Error | null; onUpgrade: () => void; onBack: () => void }) {
  const now = family.levels[obj.level - 1], next = family.levels[obj.level];
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Назад</button>
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{now.name}</h2><small>{family.name} · {obj.owner === "district" ? "построено районом" : "дом жителя"}</small></div></div>
    <Stage level={obj.level} total={FAMILY_LEVELS[obj.family]} />
    <p className="secondary small">{now.about}</p>
    {obj.owner === "district" && next && managed && <><p className="secondary small">Следующая ступень «{next.name}» — общий сбор района, смета ◈ {coins(next.project_cost ?? 0)}.</p>
      {error && <p className="city-error" role="alert">{error.message}</p>}
      {collecting ? <p className="estate-note">Сбор на эту ступень уже идёт — он в карточке района.</p>
        : <button type="button" className="city-action" disabled={pending || busy} onClick={onUpgrade}>{busy ? `Сначала завершите ${family.project === "main" ? "основной" : "малый"} сбор` : "Открыть сбор на улучшение"}</button>}</>}
  </section>;
}
