import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CityControls } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { guideName, guideText } from "../../guide";
import { DriverEntry } from "../DriverEntry";
import { currentTrainingMission, trainingSummary, useTraineeLearning } from "../traineeLearning";
import { PulsarFace } from "../crm/PulsarGuide";
import { CityControlsSetup } from "./CityControlsSetup";
import { GUIDE_AVATAR } from "./CityGuideSetup";
import { CityMap } from "./CityMap";
import { CityPeekPanel } from "./CityPeekPanel";
import { CitySkillsPanel } from "./CitySkillsPanel";
import { CityToolbar, CityToolbarProvider, useCityToolbarState } from "./CityToolbar";
import { districtLabels } from "./cityDistricts";
import "../crm/pulsar.css";
import "./city.css";
import "./cityPanelLayout.css";

/** Where each district's trainer opens: the same tools as the operators', reached the same way. */
const TOOLS: Partial<Record<DistrictId, [string, string]>> = {
  crm: ["/training/work-sites", "Открыть CRM · рабочие сайты →"],
  dispatch: ["/training/work-sites?site=dispatch", "Открыть Диспетчерскую →"],
  oktell: ["/training/work-sites?site=oktell", "Открыть Oktell →"],
  voice: ["/training/work-sites?site=oktell", "Принимать звонки в Oktell →"],
};
const actionable = (m: CityMission) => !["locked", "unavailable"].includes(m.state);

/**
 * A trainee's «Обучение» (docs/TRAINEE.md): the same city the operators learn in, full screen, with its learning districts,
 * their buildings and signs and the guide in the middle. The toolbar keeps what a trainee has: «Прогресс» of their
 * preparation, «Навыки» (districts, missions and the button to each trainer) and the map's own tools. Building, the wallet,
 * today's situations and the other cities are not part of a trainee's site, and nothing here asks for them.
 */
export function TraineeCity() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const toolbar = useCityToolbarState(params.has("district") ? "skills" : null);
  const [mapAttempt, setMapAttempt] = useState(0), [focusRequest, requestFocus] = useState(0);
  const [controlsEditing, setControlsEditing] = useState(false), [controlsPreview, setControlsPreview] = useState<CityControls | null>(null);
  const [driverLaunch, setDriverLaunch] = useState(false);
  const query = useTraineeLearning();
  // A trainee comes here to learn: their missions open once the city is shown, unless a link chose a district.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !query.data) return;
    opened.current = true;
    if (!params.has("district")) toolbar.setActive("skills");
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!query.data) return <div className="city-immersive city-immersive--empty">
    {query.isError ? <div className="city-empty-card glass glass--prominent"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
      : <div className="city-loading" role="status"><span>Загружаем учебный город…</span></div>}
  </div>;

  const data = query.data, summary = trainingSummary(data);
  const labels = districtLabels(data.districts, data.missions);
  const chosen = data.districts.find(d => d.id === params.get("district")) ?? null;
  const selected = chosen?.id ?? currentTrainingMission(summary.missions)?.district ?? data.districts[0]?.id ?? "academy";
  const controls: CityControls = controlsPreview ?? user?.city_controls ?? "orbit";
  const mascot = { gender: user?.gender ?? null, name: guideName(user) };
  function selectDistrict(id: DistrictId, key?: string) {
    const next = new URLSearchParams(params); next.set("district", id);
    if (key) next.set("mission", key); else next.delete("mission");
    setParams(next, { replace: true }); requestFocus(value => value + 1); toolbar.setActive("skills");
  }
  function allDistricts() { const next = new URLSearchParams(params); next.delete("district"); next.delete("mission"); setParams(next, { replace: true }); }
  function selectMission(key: string) { const next = new URLSearchParams(params); next.set("mission", key); setParams(next, { replace: true }); }
  const refresh = () => void query.refetch();

  /** The mission's main button: its trainer, practice again, or why it waits. A trainee never takes a reward. */
  function action(m: CityMission, d: CityDistrict) {
    if (m.state === "locked") return <button type="button" className="city-action" disabled>Сначала предыдущая миссия</button>;
    if (m.state === "unavailable") return <button type="button" className="city-action" disabled>Миссия на паузе</button>;
    // The trainer has recorded the result: reading the progress again counts the mission.
    if (m.state === "ready") return <button type="button" className="city-action" disabled={query.isFetching} onClick={refresh}>{query.isFetching ? "Засчитываем…" : "Засчитать миссию →"}</button>;
    if (m.key === "welcome") return <button type="button" className="city-action" disabled>{m.state === "completed" ? "Миссия пройдена" : "Засчитывается сама"}</button>;
    const text = m.state === "completed" ? "Повторить для практики →" : m.state === "in_progress" ? "Продолжить задание →" : d.id === "scenarios" ? "Пройти сценарий →" : "Перейти к заданию →";
    return d.id === "driver" ? <button type="button" className="city-action" onClick={() => setDriverLaunch(true)}>{text}</button> : <Link className="city-action" to={m.path}>{text}</Link>;
  }
  const opensTool = (m: CityMission, d: CityDistrict) => !d.soon && d.id !== "scenarios" && actionable(m) && m.key !== "welcome" && m.state !== "ready";
  function tool(d: CityDistrict, primary: boolean) {
    const look = primary ? "city-action" : "city-secondary";
    if (d.id === "driver") return <button type="button" className={look} onClick={() => setDriverLaunch(true)}>Открыть автопарк →</button>;
    const site = TOOLS[d.id];
    return site && <Link className={look} to={site[0]}>{site[1]}</Link>;
  }
  const guide = (m: CityMission) => <div className="city-guide">
    {mascot.gender ? <span className="city-guide-avatar" aria-hidden="true">{GUIDE_AVATAR[mascot.gender]}</span> : <PulsarFace />}
    <p><b>{mascot.name}:</b> {guideText(m.pulsar, mascot.name)}</p>
  </div>;
  const fine = (d: CityDistrict) => ["crm", "dispatch", "oktell"].includes(d.id) ? "Рабочие сайты открываются через QR: покажи его наставнику." : "Миссия засчитается сама, когда тренажёр сохранит результат.";

  return <CityToolbarProvider state={toolbar}><div className="city-immersive trainee-city" data-department="support">
    <CityToolbar />
    <CityMap key={mapAttempt} learningOnly sceneIdentity={`trainee:${data.user_id}`} districts={data.districts} missions={data.missions} labels={labels} selected={selected}
      onSelect={id => selectDistrict(id)} focusRequest={focusRequest} mascot={mascot} controls={controls} onControls={() => setControlsEditing(true)} controlsOpen={controlsEditing}
      onRetry={() => setMapAttempt(attempt => attempt + 1)} forceWebGL={params.get("backend") === "webgl"} />

    <CityPeekPanel className="city-hud-peek" toolbarSlot="level" label="Подготовка к работе: прогресс" compactLabel="Прогресс" icon={`${summary.percent}%`}>
      <header className="city-hud glass glass--regular">
        <div className="city-hud__level">
          <span className="city-hud__badge" aria-hidden="true">🎓</span>
          <div className="city-hud__xp">
            <span><b>Подготовка к работе</b><span className="city-hud__wide"> · стажёр</span></span>
            <div className="city-meter" role="progressbar" aria-label="Пройдено миссий подготовки" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.completed}><span style={{ width: `${summary.percent}%` }} /></div>
          </div>
        </div>
        <div className="city-hud__stat"><strong>{summary.completed}<small> / {summary.total}</small></strong><span className="city-hud__label">миссий пройдено</span></div>
        <nav className="city-hud__links" aria-label="Подготовка">
          <button type="button" className="city-group-button" disabled={query.isFetching} onClick={refresh}><span aria-hidden="true">↻</span><span className="city-hud__wide">{query.isFetching ? "Обновляем…" : "Обновить"}</span></button>
          <Link to="/trainee"><span aria-hidden="true">⌂</span><span className="city-hud__wide">Мой кабинет</span></Link>
        </nav>
      </header>
      <div className="city-hud__notices">
        <p className="city-note glass glass--regular">Прогресс видит наставник. Миссии засчитываются сами по результатам тренажёров.</p>
        {query.isError && <p className="city-note glass glass--regular" role="alert">Не удалось обновить прогресс.<button type="button" onClick={refresh}>Повторить</button></p>}
      </div>
    </CityPeekPanel>

    <CityPeekPanel className="city-skills-peek" toolbarSlot="skills" label="Навыки: районы и миссии подготовки" compactLabel="Навыки" icon="🎓">
      <CitySkillsPanel data={data} labels={labels} district={chosen} missionKey={params.get("mission")} completed={summary.completed} total={summary.total} rewards={false}
        onDistrict={(id, key) => id ? selectDistrict(id, key) : allDistricts()} onMission={selectMission} error={null}
        action={action} opensTool={opensTool} tool={tool} guide={guide} fine={fine} />
    </CityPeekPanel>

    <div className="city-notes">
      {controlsEditing && <CityControlsSetup value={controls} onPick={setControlsPreview} onClose={() => setControlsEditing(false)} cancellable />}
    </div>
    {driverLaunch && <Sheet title="Автопарк · Driver Simulator" onClose={() => setDriverLaunch(false)}><DriverEntry /></Sheet>}
  </div></CityToolbarProvider>;
}
