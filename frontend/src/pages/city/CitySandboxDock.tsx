import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { citySandbox, type CityEstates, type DistrictEstate, type MyEstate, type PlotCatalogue, type PlotFamily, type ProjectCatalogue, type ProjectFamily, type PublicObject, type SandboxResult } from "../../api/cityEstate";
import type { DepartmentId } from "../../api/cityWorld";
import { projectFootprint } from "../../city3d/world/estateGrid";
import type { BuildState, EstateTarget } from "./CityEstateDock";
import "./estate.css";

const coins = (n: number) => n.toLocaleString("ru-RU");
const cellText = ([w, h]: [number, number]) => `${w} × ${h} ${w * h === 1 ? "клетка" : "клетки"} площади`;
/** One change of the test city: what to send, what to say when it is done, and where the dock goes next. */
interface Step { run: () => Promise<SandboxResult>; text: (result: SandboxResult) => string; next?: (result: SandboxResult) => BuildState }

/**
 * The administrators' test city beside the map (api/cityEstate.ts citySandbox): the same three districts, land and
 * rules as the real city, kept apart from it. A tap on a plot builds a square or a house for free, a tap on a building
 * opens its card, where its stage goes up or down or the building goes away; bands and the headquarters' stage are set
 * by hand, shared projects on the square are built or cancelled at once, and the whole test city can be cleared.
 */
export function CitySandboxDock({ city, state, mine, build, setBuild, onClose, onFocus }: {
  city: DepartmentId; state: CityEstates | undefined; mine: MyEstate | undefined; build: BuildState;
  setBuild: (next: BuildState | null) => void; onClose: () => void; onFocus: (target: EstateTarget) => void;
}) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const land = state?.districts.find(d => d.id === build.district) ?? null;
  const plots = new Map((mine?.catalogue ?? []).map(c => [c.family, c])), projects = new Map((mine?.projects ?? []).map(c => [c.family, c]));
  const act = useMutation({
    mutationFn: (step: Step) => step.run(),
    onSuccess: async (result, step) => {
      // The dock moves on once the city shows the change, so a new building's card finds it.
      await client.invalidateQueries({ queryKey: ["city-sandbox", city] });
      setNotice(step.text(result));
      if (step.next) setBuild(step.next(result));
    },
  });
  const run = (step: Step) => { setNotice(null); act.mutate(step); };
  const pending = act.isPending, error = act.error;
  const go = (next: Partial<BuildState>) => { act.reset(); setNotice(null); setBuild({ ...build, ...next }); };
  const area = (square: boolean) => { go({ area: square ? "public" : "plots", project: square, placing: null, spot: null, plot: null, selected: null }); onFocus({ district: build.district, kind: square ? "public" : "district" }); };
  const switchTo = (district: string) => { go({ district, placing: null, spot: null, plot: null, selected: null }); onFocus({ district, kind: build.project ? "public" : "district" }); };
  const setDistrict = (body: { open_band?: number; hq_level?: number }, text: string) => run({ run: () => citySandbox.district(build.district, body), text: () => text });
  const nameOf = (o: PublicObject) => (o.owner === "district" ? projects.get(o.family as ProjectFamily) : plots.get(o.family as PlotFamily))?.levels[o.level - 1]?.name ?? o.family;

  let body;
  if (!state || !mine) body = <p className="estate-note">Загружаем тестовый город…</p>;
  else if (!land?.land) body = <p className="estate-note">У этого района нет земли.</p>;
  else if (build.placing) {
    const family = build.placing.family as ProjectFamily, item = projects.get(family), spot = build.spot, size = projectFootprint(family, build.placing.rotation);
    body = <section className="estate-placing" aria-live="polite">
      <div className="estate-placing__title"><span aria-hidden="true">{item?.icon}</span><div><h2>{item?.name}</h2><small>{cellText(size)} · общий проект</small></div></div>
      <p className="secondary small">Выбери место на площади района — нажми на клетку или наведи курсор.</p>
      {spot ? spot.problem ? <p className="estate-problem" role="alert">{spot.problem}</p> : <p className="estate-ok">Место подходит</p> : <p className="estate-note">Место ещё не выбрано</p>}
      {error && <p className="city-error" role="alert">{error.message}</p>}
      <div className="estate-placing__actions">
        {size[0] !== size[1] && <button type="button" className="city-secondary" onClick={() => go({ placing: { ...build.placing!, rotation: (build.placing!.rotation + 1) % 4 } })}>Повернуть на 90°</button>}
        <button type="button" className="city-action" disabled={pending || !spot || !!spot.problem} onClick={() => run({
          run: () => citySandbox.openProject({ district_id: build.district, family, u: spot!.u, v: spot!.v, rotation: spot!.rotation }),
          text: () => `Проект «${item?.name}» открыт. Постройте его сразу или отмените.`,
          next: () => ({ ...build, placing: null, spot: null }),
        })}>{pending ? "Сохраняем…" : "Открыть проект"}</button>
        <button type="button" className="city-secondary" onClick={() => go({ placing: null, spot: null })}>Отмена</button>
      </div>
    </section>;
  } else if (build.selected !== null) {
    const obj = land.objects.find(o => o.id === build.selected);
    body = obj ? <ObjectCard obj={obj} plots={plots} projects={projects} land={land} pending={pending} error={error} onBack={() => go({ selected: null })}
      onLevel={level => run({ run: () => citySandbox.level(obj.id, level), text: r => `Ступень ${level}: ${r.object ? nameOf(r.object) : ""}` })}
      onRemove={() => run({ run: () => citySandbox.remove(obj.id), text: () => `Постройка «${nameOf(obj)}» убрана, участок свободен.`, next: () => ({ ...build, selected: null }) })}
      onProject={() => run({
        run: () => citySandbox.openProject({ district_id: build.district, family: obj.family as ProjectFamily, target_id: obj.id }),
        text: () => "Проект на следующую ступень открыт: постройте его сразу или отмените.",
        next: () => ({ ...build, area: "public", project: true, selected: null }),
      })} />
      : <p className="estate-note">Постройки уже нет. <button type="button" className="estate-back" onClick={() => go({ selected: null })}>← Весь район</button></p>;
  } else if (build.project) {
    const busy = new Set(land.projects.map(p => projects.get(p.family)?.project));
    body = <>
      <section className="estate-section"><h3>Общие проекты на площади</h3>
        {land.projects.length ? land.projects.map(p => <article className="estate-project" key={p.id}>
          <header><strong>{p.name}{p.target_id ? ` → ${p.level_name}` : ""}</strong><span>смета ◈ {coins(p.cost)}</span></header>
          <div className="estate-placing__actions">
            <button type="button" className="city-action" disabled={pending} onClick={() => run({ run: () => citySandbox.complete(p.id), text: () => `Построено: ${p.name}${p.target_id ? ` → ${p.level_name}` : ""}. Проект засчитан штабу.` })}>Построить сразу</button>
            <button type="button" className="city-secondary" disabled={pending} onClick={() => run({ run: () => citySandbox.cancel(p.id), text: () => `Проект «${p.name}» отменён.` })}>Отменить</button>
          </div>
        </article>) : <p className="secondary small">Открытых проектов нет.</p>}
      </section>
      {error && <p className="city-error" role="alert">{error.message}</p>}
      <section className="estate-section"><h3>Открыть проект</h3><p className="secondary small">Как в настоящем районе: на свободных клетках площади, одновременно один основной и один малый проект. Сбор не нужен — проект строится одной кнопкой.</p>
        <ul className="estate-catalogue">{(mine.projects).map(c => <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
          <span className="estate-catalogue__text"><strong>{c.name}</strong><small>{cellText(projectFootprint(c.family, 0))} · {c.project === "main" ? "основной" : "малый"} · {c.levels.length} {c.levels.length === 1 ? "ступень" : c.levels.length < 5 ? "ступени" : "ступеней"}</small></span>
          <button type="button" className="city-action" disabled={busy.has(c.project)} onClick={() => go({ area: "public", placing: { family: c.family, rotation: 0, moving: null }, spot: null, selected: null })}>{busy.has(c.project) ? "Уже открыт" : "Выбрать место"}</button></li>)}</ul></section>
    </>;
  } else if (build.plot) {
    const plot = build.plot, closed = plot.band > land.land.open_band;
    body = <section className="estate-card">
      <button type="button" className="estate-back" onClick={() => go({ plot: null })}>← Весь район</button>
      <div className="estate-placing__title"><span aria-hidden="true">🟩</span><div><h2>Участок · пояс {plot.band}</h2><small>Квартал {plot.block} · столбец {plot.col + 1}, ряд {plot.row + 1}</small></div></div>
      {plot.problem && <p className="estate-problem" role="alert">{plot.problem}</p>}
      {closed && <button type="button" className="city-secondary" disabled={pending} onClick={() => setDistrict({ open_band: plot.band }, `Открыты пояса до ${plot.band}-го.`)}>Открыть пояс {plot.band}</button>}
      {error && <p className="city-error" role="alert">{error.message}</p>}
      {[(["square", "house"] as const).map(f => plots.get(f)).filter((c): c is PlotCatalogue => !!c), [...plots.values()].filter(c => c.ready)].map((list, i) => list.length > 0 && <section className="estate-section" key={i}>
        {i > 0 && <h3>Готовые дома</h3>}
        <ul className="estate-catalogue">{list.map(c => <li key={c.family}><span className="estate-catalogue__icon" aria-hidden="true">{c.icon}</span>
          <span className="estate-catalogue__text"><strong>{c.levels[0].name}</strong><small>{c.levels[0].about}</small>{c.ready && <small>В настоящем районе ◈ {coins(c.levels[0].price)} + земля</small>}</span>
          <button type="button" className="city-action" disabled={pending || !!plot.problem} aria-label={`${c.levels[0].name} на участке бесплатно`} onClick={() => run({
            run: () => citySandbox.build({ district_id: build.district, family: c.family, block: plot.block, col: plot.col, row: plot.row }),
            text: r => r.merged ? r.object?.family === "bigpark" ? "Шесть скверов стали большим парком!" : "Четыре сквера стали парком!" : `Построено: ${c.levels[0].name}`,
            next: r => ({ ...build, plot: null, selected: r.object?.id ?? null }),
          })}>{pending ? "…" : "Бесплатно"}</button></li>)}</ul>
      </section>)}
      <p className="city-fine">Парк не строят: четыре своих сквера квадратом сами станут парком, шесть прямоугольником — большим парком.</p>
    </section>;
  } else {
    const bands = land.land.bands.length, hq = land.hq;
    const listed = [...land.objects].sort((a, b) => Number(a.owner === "district") - Number(b.owner === "district") || a.id - b.id);
    body = <>
      <section className="estate-claim"><strong>Нажми на участок или постройку</strong><p>Светло-зелёные участки открытых поясов — для стройки: сквер или дом ставятся бесплатно. В карточке постройки её ступень поднимается и снижается, а саму постройку можно убрать.</p></section>
      {error && <p className="city-error" role="alert">{error.message}</p>}
      <section className="estate-section"><h3>Пояса района</h3>
        <Stepper label="Открытые пояса" value={land.land.open_band} max={bands} pending={pending} text={`Открыт ${land.land.open_band === bands ? "весь район" : `пояс ${land.land.open_band} из ${bands}`}`}
          onChange={band => setDistrict({ open_band: band }, band > land.land!.open_band ? `Открыты пояса до ${band}-го.` : `Пояса после ${band}-го закрыты.`)} />
        <ul className="estate-bands">{land.land.bands.map(b => <li key={b.band} data-open={b.band <= land.land!.open_band || undefined}>
          <span>Пояс {b.band}</span><span>{b.band <= land.land!.open_band ? "открыт" : "закрыт"}</span>
          <span className="estate-bands__meter" aria-label={`Занято ${b.taken} из ${b.plots}`}><i style={{ width: `${b.plots ? Math.round(b.taken / b.plots * 100) : 0}%` }} /></span><small>{b.taken} / {b.plots}</small>
        </li>)}</ul>
        <p className="secondary small">В настоящем районе пояс открывается сам, когда в открытых занято 70 % участков, и больше не закрывается.</p></section>
      <section className="estate-section"><h3>Штаб района</h3>
        <Stepper label="Ступень штаба" value={hq.level} max={5} pending={pending} text={`${hq.name} · ступень ${hq.level} из 5`} onChange={level => setDistrict({ hq_level: level }, `Штаб: ступень ${level}.`)} />
        <p className="secondary small">Построено общих проектов: {hq.built}. В настоящем районе штаб растёт от общих проектов и не снижается.</p></section>
      <section className="estate-section"><h3>Постройки района · {listed.length}</h3>
        {listed.length ? <ul className="estate-list">{listed.map(o => { const c = o.owner === "district" ? projects.get(o.family as ProjectFamily) : plots.get(o.family as PlotFamily); return <li key={o.id}><span aria-hidden="true">{c?.icon}</span>
          <span><strong>{nameOf(o)}</strong><small>{c?.name}{(c?.levels.length ?? 1) > 1 ? ` · ступень ${o.level} из ${c!.levels.length}` : ""}{o.owner === "district" ? " · на площади" : ""}</small></span>
          <button type="button" className="city-secondary" onClick={() => { go({ selected: o.id, plot: null, area: o.owner === "district" ? "public" : "plots", project: false }); onFocus({ district: build.district, kind: "object", object: o.id }); }}>Открыть</button></li>; })}</ul>
          : <p className="secondary small">Пока пусто.</p>}</section>
      <button type="button" className="city-secondary sandbox-reset" disabled={pending} onClick={() => {
        if (window.confirm("Очистить тестовый город? Все его постройки и проекты исчезнут, пояса и штабы вернутся к началу. Настоящий город не изменится.")) run({ run: () => citySandbox.reset(city), text: () => "Тестовый город очищен.", next: () => ({ ...build, plot: null, selected: null, placing: null, spot: null }) });
      }}>Очистить тестовый город</button>
    </>;
  }

  return <aside className="estate-dock sandbox-dock glass glass--regular" aria-label="Тестовый город">
    <header className="estate-dock__head">
      <div><span className="city-eyebrow">🧪 ТЕСТОВЫЙ ГОРОД · {land?.name ?? "район"}</span><p>Бесплатно · видят только администраторы</p></div>
      <button type="button" className="estate-dock__close" onClick={onClose} aria-label="Закрыть панель тестового города">×</button>
    </header>
    <div className="estate-dock__body">
      <div className="sandbox-switch" role="group" aria-label="Район тестового города">{(state?.districts ?? []).filter(d => d.land).map(d =>
        <button type="button" key={d.id} aria-pressed={d.id === build.district} onClick={() => switchTo(d.id)}><strong>{d.number}</strong><small>{d.name}</small></button>)}</div>
      <div className="sandbox-switch sandbox-switch--tabs" role="group" aria-label="Что строить">
        <button type="button" aria-pressed={!build.project} onClick={() => area(false)}>Участки</button>
        <button type="button" aria-pressed={build.project} onClick={() => area(true)}>Площадь и проекты</button>
      </div>
      {notice && <p className="estate-ok" role="status">{notice}</p>}
      {body}
      {!build.placing && <button type="button" className="city-secondary" onClick={() => onFocus({ district: build.district, kind: build.project ? "public" : "district" })}>Показать центр района</button>}
      <p className="city-fine">Тестовый город отдельный: операторы и сотрудники его не видят, коины не списываются, настоящие районы не меняются.</p>
    </div>
  </aside>;
}

/** − value + for a number from 1 to `max`. */
function Stepper({ label, value, max, text, pending, onChange }: { label: string; value: number; max: number; text: string; pending: boolean; onChange: (value: number) => void }) {
  return <div className="sandbox-stepper" role="group" aria-label={label}>
    <button type="button" disabled={pending || value <= 1} onClick={() => onChange(value - 1)} aria-label={`${label}: меньше`}>−</button>
    <span aria-live="polite">{text}</span>
    <button type="button" disabled={pending || value >= max} onClick={() => onChange(value + 1)} aria-label={`${label}: больше`}>+</button>
  </div>;
}

/** A test building: any stage up or down, the next stage as a shared project for the district's own, or away. */
function ObjectCard({ obj, plots, projects, land, pending, error, onLevel, onRemove, onProject, onBack }: {
  obj: PublicObject; plots: Map<PlotFamily, PlotCatalogue>; projects: Map<ProjectFamily, ProjectCatalogue>; land: DistrictEstate;
  pending: boolean; error: Error | null; onLevel: (level: number) => void; onRemove: () => void; onProject: () => void; onBack: () => void;
}) {
  const district = obj.owner === "district", family = district ? projects.get(obj.family as ProjectFamily) : plots.get(obj.family as PlotFamily);
  if (!family) return null;
  const levels = family.levels, now = levels[obj.level - 1], total = levels.length;
  const size = district ? projects.get(obj.family as ProjectFamily)?.project : undefined;
  const collecting = land.projects.some(p => p.target_id === obj.id), busy = land.projects.some(p => projects.get(p.family)?.project === size);
  return <section className="estate-card">
    <button type="button" className="estate-back" onClick={onBack}>← Весь район</button>
    <div className="estate-placing__title"><span aria-hidden="true">{family.icon}</span><div><h2>{now?.name ?? family.name}</h2><small>{family.name} · {district ? "постройка района на площади" : obj.owner === "mine" ? "твоя постройка" : "постройка другого администратора"}</small></div></div>
    {total > 1 ? <>
      <Stepper label="Ступень постройки" value={obj.level} max={total} pending={pending} text={`Ступень ${obj.level} из ${total}`} onChange={onLevel} />
      <div className="sandbox-levels" role="group" aria-label="Выбрать ступень">{levels.map((l, i) => <button type="button" key={l.level} aria-pressed={obj.level === i + 1} disabled={pending} onClick={() => obj.level !== i + 1 && onLevel(i + 1)} title={l.name}><strong>{i + 1}</strong><small>{l.name}</small></button>)}</div>
    </> : <p className="secondary small">У этой постройки одна ступень.</p>}
    {now && <p className="secondary small">{now.about}</p>}
    {error && <p className="city-error" role="alert">{error.message}</p>}
    {district && obj.level < total && (collecting ? <p className="estate-note">Проект на следующую ступень уже открыт — он во вкладке «Площадь и проекты».</p>
      : <button type="button" className="city-secondary" disabled={pending || busy} onClick={onProject}>{busy ? `Сначала постройте или отмените ${size === "main" ? "основной" : "малый"} проект` : "Открыть проект на следующую ступень"}</button>)}
    {obj.family === "square" && !district && <div className="estate-merge"><strong>Скверы собираются в парк</strong><p>Четыре своих сквера квадратом 2 × 2 сами станут парком, шесть прямоугольником 3 × 2 — большим парком.</p></div>}
    <button type="button" className="city-secondary sandbox-remove" disabled={pending} onClick={onRemove}>Убрать постройку</button>
  </section>;
}
