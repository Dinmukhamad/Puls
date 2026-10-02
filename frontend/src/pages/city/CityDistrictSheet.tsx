import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { cityEstate, operationKey, type DistrictEstate, type DistrictProject, type MyEstate } from "../../api/cityEstate";
import type { TeamDistrict } from "../../api/cityWorld";
import { DistrictSwatch } from "./DistrictSwatch";
import { districtBuildProgress } from "./districtProgress";
import { DistrictLandmarkCard } from "./DistrictLandmarkCard";
import "./estate.css";

const coins = (n: number) => n.toLocaleString("ru-RU");

/**
 * A team district's card: personal plots, its growing main building and preserved shared projects still collecting
 * with coarse progress, the viewer's own contribution, and voluntary contributions. The district's supervisor and
 * the head open and cancel projects here; nothing shows another person's sum.
 */
export function CityDistrictSheet({ district, team, cityName, mine, onMyEstate, onOpenProject, canManageAssignments = false }: {
  district: DistrictEstate | undefined; team: TeamDistrict; cityName: string; mine: MyEstate | undefined;
  onMyEstate?: () => void; onOpenProject?: () => void; canManageAssignments?: boolean;
}) {
  const home = mine?.district?.id === team.id, canGive = home && mine?.status === "ready";
  const activeComplex = district?.landmark?.status === "active";
  const progress = district?.land && districtBuildProgress(district.land);
  return <div className="stack estate-district">
    <span className="city-eyebrow"><DistrictSwatch district={team.id} />РАЙОН КОМАНДЫ · {cityName}</span>
    <p className="estate-district__intro">Район — территория команды супервайзера. Вся земля доступна сразу: операторы команды выбирают любые свободные участки и строят за свои коины.</p>
    <p>{team.supervisor ? `Супервайзер: ${team.supervisor}` : "Команда пока не назначена: руководитель назначает супервайзера района в настройках города."}</p>
    {team.mine && <p className="city-world-badge">Твой район</p>}
    <div className="estate-areas">
      <section className="estate-area"><span aria-hidden="true">🏡</span><div><h3>Личные постройки</h3><p>Договоритесь с командой, где будут дома, офисы и парки. Выбери свободный участок и купи постройку — она принадлежит тебе.</p></div>
        {home && onMyEstate && <button type="button" className="city-action" onClick={onMyEstate}>Выбрать участок →</button>}
        {!home && <small>Строить можно в районе своей команды.</small>}
      </section>
      {!activeComplex && <section className="estate-area"><span aria-hidden="true">⛲</span><div><h3>Площадь команды</h3><p>Место для общих проектов. Супервайзер открывает сбор, операторы добровольно вносят коины.</p></div>
        {district?.managed && district.construction && onOpenProject && <button type="button" className="city-secondary" onClick={onOpenProject}>Создать общий проект →</button>}
      </section>}
    </div>
    {district?.landmark && <DistrictLandmarkCard landmark={district.landmark} />}
    {district?.landmark?.status === "legacy_occupied" && <p className="estate-note">На площади остаются прежние общие постройки и сборы команды.</p>}
    {progress ? <p className="secondary small">Для стройки свободно {coins(progress.available)} участков. {district!.construction ? "Стройка открыта." : "Стройка пока закрыта руководителем."}</p>
      : district ? <p className="secondary small">У района нет земли: город делится на три района.</p> : null}
    {!activeComplex && (district?.projects.length ? <section className="estate-section"><h3>Общие проекты</h3>
      {district.projects.map(p => <ProjectCard key={p.id} project={p} canGive={!!canGive} available={mine?.available ?? 0} managed={district.managed} />)}
    </section> : district ? <p className="secondary small">Сейчас нет открытых сборов.{district.managed && district.construction ? " Откройте первый проект на площади района — сквер, площадь с фонтаном или парк." : ""}</p> : null)}
    {canManageAssignments && <Link className="city-secondary" to="/admin/learning/city?tab=world">Управлять районами →</Link>}
    {!activeComplex && <p className="secondary small">Взносы добровольные и видны только тебе. Завершённые общие постройки остаются в районе и при переводах сотрудников.</p>}
  </div>;
}

function ProjectCard({ project, canGive, available, managed }: { project: DistrictProject; canGive: boolean; available: number; managed: boolean }) {
  const client = useQueryClient();
  const [amount, setAmount] = useState(20), [upTo, setUpTo] = useState(false), [done, setDone] = useState<string | null>(null);
  const last = useRef<{ print: string; key: string } | null>(null);
  const key = (request: unknown) => { const print = JSON.stringify(request); if (last.current?.print !== print) last.current = { print, key: operationKey() }; return last.current.key; };
  const give = useMutation({
    mutationFn: () => { const body = { amount, up_to: upTo }; return cityEstate.contribute(project.id, { key: key({ id: project.id, ...body }), ...body }); },
    onSuccess: async result => { last.current = null; setDone(result.completed ? `Проект построен! Твой взнос ◈ ${coins(result.accepted ?? 0)} закрыл сбор.` : `Взнос ◈ ${coins(result.accepted ?? 0)} принят.`); await client.invalidateQueries(); },
  });
  const cancel = useMutation({
    mutationFn: () => cityEstate.cancel(project.id, { key: key({ cancel: project.id }) }),
    onSuccess: async result => { last.current = null; setDone(`Проект отменён, взносы вернулись участникам: ◈ ${coins(result.refunded ?? 0)}.`); await client.invalidateQueries(); },
  });
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= Math.min(100000, available);
  return <article className="estate-project">
    <header><strong>{project.name}{project.target_id ? ` → ${project.level_name}` : ""}</strong><span>смета ◈ {coins(project.cost)}</span></header>
    {project.progress === null ? <p className="secondary small">Сбор идёт. В небольшой команде общий прогресс скрыт, чтобы не раскрывать чужие взносы.</p>
      : <div className="city-meter" role="progressbar" aria-label={`${project.name}: собрано не меньше ${project.progress}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress}><span style={{ width: `${project.progress}%` }} /></div>}
    {project.funded !== undefined && <p className="secondary small">Собрано ◈ {coins(project.funded)} из {coins(project.cost)} (видят руководители района).</p>}
    {project.mine > 0 && <p className="small">Твой вклад: ◈ {coins(project.mine)}</p>}
    {done && <p className="estate-ok" role="status">{done}</p>}
    {canGive && <form className="estate-give" onSubmit={e => { e.preventDefault(); if (valid) give.mutate(); }}>
      <label className="field"><span className="field__label">Сколько внести (доступно ◈ {coins(available)})</span><input className="input" type="number" inputMode="numeric" min={1} max={Math.min(100000, available)} value={amount} onChange={e => setAmount(Math.floor(Number(e.target.value)))} /></label>
      <label className="row small"><input type="checkbox" checked={upTo} onChange={e => setUpTo(e.target.checked)} /> Если осталось собрать меньше — внести только остаток</label>
      {give.isError && <p className="city-error" role="alert">{give.error.message}</p>}
      <button className="city-action" disabled={!valid || give.isPending}>{give.isPending ? "Вносим…" : `Внести ◈ ${coins(Number.isFinite(amount) ? amount : 0)}`}</button>
    </form>}
    {managed && <>{cancel.isError && <p className="city-error" role="alert">{cancel.error.message}</p>}
      <button type="button" className="city-secondary" disabled={cancel.isPending} onClick={() => { if (window.confirm("Отменить проект? Все взносы вернутся участникам.")) cancel.mutate(); }}>Отменить сбор и вернуть взносы</button></>}
  </article>;
}
