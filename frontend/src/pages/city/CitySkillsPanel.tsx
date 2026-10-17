import type { CSSProperties, ReactNode } from "react";
import type { CityData, CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CityLabelInfo } from "../../city3d/types";
import { DISTRICT_COLORS } from "./cityDistricts";
import { DISTRICT_LEVEL_NAMES, MAX_DISTRICT_LEVEL, districtLevel } from "./cityLevels";
import { continueMission, districtProgress, missionNote, openMission, type DistrictProgress } from "./citySkills";
import "./citySkills.css";

export interface SkillsActions {
  /** The mission's main button: start, go to the task, take the reward, practise again, or why it cannot. */
  action: (mission: CityMission, district: CityDistrict) => ReactNode;
  /** Whether that button already leads to the district's tool, so no second link to it is shown. */
  opensTool: (mission: CityMission, district: CityDistrict) => boolean;
  /** The district's tool (автопарк, CRM, Диспетчерская, Oktell): `primary` when it is the only way on. */
  tool: (district: CityDistrict, primary: boolean) => ReactNode;
  /** Pulsar's (or the operator's guide's) hint for the mission. */
  guide: (mission: CityMission) => ReactNode;
  /** A line under the button: how the district's tools open or rewards come. */
  fine: (district: CityDistrict) => string;
}

/**
 * «Навыки»: without a district chosen, the overview — the whole way's progress, the next mission with its button and
 * every district with how far it is; with one, the district — its missions by name, the chosen one open with what to
 * do, and the button for it always in view at the bottom.
 */
export function CitySkillsPanel({ data, labels, district, missionKey, completed, total, onDistrict, onMission, error, ...actions }: {
  data: CityData; labels: CityLabelInfo[]; district: CityDistrict | null; missionKey: string | null; completed: number; total: number;
  /** Opens a district, with one of its missions open, or (null) all of them. */
  onDistrict: (id: DistrictId | null, mission?: string) => void; onMission: (key: string) => void; error: ReactNode;
} & SkillsActions) {
  return <section className="skills glass glass--prominent" style={district ? tint(district.id) : undefined} aria-label={district ? `Навыки · ${district.name}` : "Навыки"}>
    {district ? <DistrictView data={data} label={labels.find(l => l.id === district.id)} district={district} missionKey={missionKey} onBack={() => onDistrict(null)} onMission={onMission} error={error} {...actions} />
      : <Overview data={data} labels={labels} completed={completed} total={total} onDistrict={onDistrict} error={error} action={actions.action} />}
  </section>;
}

const tint = (id: DistrictId) => ({ "--district": DISTRICT_COLORS[id] }) as CSSProperties;
const Meter = ({ done, total, label }: { done: number; total: number; label: string }) =>
  <span className="skills-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${total ? done / total * 100 : 0}%` }} /></span>;

function Overview({ data, labels, completed, total, onDistrict, error, action }: {
  data: CityData; labels: CityLabelInfo[]; completed: number; total: number; onDistrict: (id: DistrictId, mission?: string) => void; error: ReactNode;
  action: SkillsActions["action"];
}) {
  const next = continueMission(data.districts, data.missions), home = next && data.districts.find(d => d.id === next.district);
  const label = home && labels.find(l => l.id === home.id);
  return <>
    <header className="skills-head">
      <div className="skills-head__title"><h2>Навыки</h2><span className="skills-count">{completed} из {total} миссий</span></div>
      <p>Каждый район учит своему рабочему инструменту. Пройденные миссии дают опыт и коины и улучшают здание района.</p>
      <Meter done={completed} total={total} label="Пройдено миссий во всех районах" />
    </header>
    <div className="skills-scroll">
      {next && home ? <article className="skills-next" style={tint(home.id)} data-reward={next.state === "ready" || undefined}>
        <span className="skills-next__eyebrow">{next.state === "ready" ? "✦ Награда ждёт" : "Следующая миссия"}</span>
        <button type="button" className="skills-next__where" onClick={() => onDistrict(home.id, next.key)}><span aria-hidden="true">{label?.icon}</span>{home.name}<span aria-hidden="true">›</span></button>
        <h3>{next.title}</h3>
        <p>{next.objective}{next.target > 1 || next.current ? ` · ${next.current} из ${next.target}` : ""}</p>
        {error}
        <div className="skills-next__action">{action(next, home)}</div>
      </article> : total > 0 && <article className="skills-next skills-next--done"><span className="skills-next__eyebrow">🏆 Всё пройдено</span><h3>Все открытые миссии пройдены</h3><p>Возвращайся к практике в любом районе — новые миссии появятся здесь.</p></article>}
      <h3 className="skills-section">Районы</h3>
      <ul className="skills-districts">{labels.map(l => {
        const d = data.districts.find(item => item.id === l.id)!, p = districtProgress(d, data.missions);
        return <li key={l.id}><button type="button" className="skills-district" style={tint(l.id)} data-soon={l.soon || undefined} onClick={() => onDistrict(l.id)}>
          <span className="skills-district__icon" aria-hidden="true">{l.icon}</span>
          <span className="skills-district__text"><strong>{l.name}</strong><DistrictStatus district={d} progress={p} /></span>
          {!l.soon && p.total > 0 && <Meter done={p.done} total={p.total} label={`${l.name}: пройдено ${p.done} из ${p.total}`} />}
          <span className="skills-chevron" aria-hidden="true">›</span>
        </button></li>;
      })}</ul>
    </div>
  </>;
}

function DistrictStatus({ district, progress }: { district: CityDistrict; progress: DistrictProgress }) {
  if (district.soon) return <small>Скоро откроется</small>;
  if (!progress.total) return <small>Рабочий кабинет</small>;
  if (progress.reward) return <small data-tone="reward">✦ Забери награду</small>;
  if (progress.mastered) return <small data-tone="done">✓ Район освоен</small>;
  return <small>{progress.done} из {progress.total} миссий</small>;
}

function DistrictView({ data, label, district, missionKey, onBack, onMission, error, action, opensTool, tool, guide, fine }: {
  data: CityData; label?: CityLabelInfo; district: CityDistrict; missionKey: string | null; onBack: () => void; onMission: (key: string) => void; error: ReactNode;
} & SkillsActions) {
  // Every mission of the district is listed, a paused one too; the progress counts the curriculum's.
  const missions = data.missions.filter(m => m.district === district.id);
  const progress = districtProgress(district, data.missions);
  const open = district.soon ? null : openMission(missions, missionKey, progress.mastered);
  const level = districtLevel(progress.done, district.soon);
  // Oktell's lessons wait in its workspace; the district keeps its building stages.
  const deferred = district.id === "oktell" && !missions.length;
  // A locked mission says why it waits; its button is the district's tool, where the earlier work is done.
  const lockedTool = open?.state === "locked" ? tool(district, true) : null;
  const extraTool = !district.soon && !data.inspecting && !lockedTool && (open ? !opensTool(open, district) : false);
  return <>
    <header className="skills-head skills-head--district">
      <button type="button" className="skills-back" onClick={onBack}><span aria-hidden="true">‹</span> Все районы</button>
      <div className="skills-district-title">
        <span className="skills-district__icon" aria-hidden="true">{label?.icon}</span>
        <div><h2>{district.name}</h2><p>{district.subtitle}</p></div>
      </div>
      <div className="skills-district-facts">
        <span><strong>{district.soon ? "Скоро" : progress.total ? `${progress.done} из ${progress.total}` : "—"}</strong><small>{progress.total ? "миссий пройдено" : "миссий"}</small></span>
        <span aria-label={`Здание ${level} из ${MAX_DISTRICT_LEVEL}: ${DISTRICT_LEVEL_NAMES[level - 1]}`}><strong className="skills-stars">{"★".repeat(level)}<em>{"★".repeat(MAX_DISTRICT_LEVEL - level)}</em></strong><small>Здание «{DISTRICT_LEVEL_NAMES[level - 1]}»</small></span>
      </div>
      {!district.soon && progress.total > 0 && <Meter done={progress.done} total={progress.total} label={`Пройдено миссий района: ${progress.done} из ${progress.total}`} />}
    </header>
    <div className="skills-scroll">
      {district.soon && <p className="skills-note">Район строится: здесь появятся новые учебные инструменты и миссии. Твой прогресс в других районах сохранится.</p>}
      {deferred && <p className="skills-note">При первом входе в Oktell обучение само проведёт по разделам, статусам и перезвону водителю. Достигнутый уровень здания сохраняется.</p>}
      {district.id === "scenarios" && <p className="skills-note">Учебные разговоры с водителем и практика в CRM и Диспетчерской. Коины — за первое успешное прохождение.</p>}
      {progress.mastered && <div className="skills-mastered" role="status"><span aria-hidden="true">🏆</span><div><strong>Район освоен</strong><small>Все миссии пройдены{level === MAX_DISTRICT_LEVEL ? " — здание стало легендой" : ""}. Практиковаться можно сколько угодно.</small></div></div>}
      {missions.length > 0 && <ol className="skills-missions" aria-label={`Миссии района «${district.name}»`}>{missions.map((m, i) => {
        const isOpen = open?.key === m.key, parent = data.missions.find(item => item.key === m.prerequisite);
        return <li key={m.key} className="skills-mission" data-state={m.state} data-open={isOpen || undefined}>
          <button type="button" className="skills-mission__row" aria-expanded={isOpen} onClick={() => onMission(m.key)}>
            <span className="skills-mission__mark" aria-hidden="true">{m.state === "completed" ? "✓" : m.state === "locked" ? "🔒" : m.state === "ready" ? "✦" : i + 1}</span>
            <span className="skills-mission__text"><strong>{m.title}</strong><small>{missionNote(m, data.missions)}</small></span>
            <span className="skills-chevron" aria-hidden="true">›</span>
          </button>
          {isOpen && <div className="skills-mission__detail">
            <p>{m.description}</p>
            {m.state !== "completed" && <div className="skills-objective"><span>{m.objective}</span><strong>{m.current} / {m.target}</strong><Meter done={m.current} total={m.target} label={`${m.objective}: ${m.current} из ${m.target}`} /></div>}
            {m.state === "locked" && parent && <p className="skills-locked">Откроется, когда будет пройдена миссия «{parent.title}» и получена награда.</p>}
            <div className="skills-rewards">{m.xp > 0 && <span>✦ {m.xp} XP</span>}{m.coins > 0 && <span>◈ {m.coins} коинов</span>}<small>{m.state === "completed" ? "получено" : "за прохождение"}</small></div>
            {guide(m)}
          </div>}
        </li>;
      })}</ol>}
    </div>
    <footer className="skills-foot">
      {error}
      {extraTool && tool(district, false)}
      {district.soon ? <button type="button" className="city-action" disabled>Район строится</button>
        : lockedTool ?? (open ? action(open, district) : (!data.inspecting && tool(district, true)) || (progress.mastered && <button type="button" className="city-action" disabled>Район освоен</button>))}
      {!district.soon && <p className="city-fine">{fine(district)}</p>}
    </footer>
  </>;
}
