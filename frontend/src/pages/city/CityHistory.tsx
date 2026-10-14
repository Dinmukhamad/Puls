import type { CitySeasons, PastSeason, SeasonDistrict } from "../../api/citySeasons";
import type { DepartmentId } from "../../api/cityWorld";
import { Sheet } from "../../components/Sheet";
import { plural } from "../../utils/format";
import "./cityHistory.css";
import { daysText, PERIOD_EVERY, resetMoment, resetsText, seasonDates, seasonWarning, totalsLine } from "./seasonText";

const CITY_NAMES: Record<DepartmentId, string> = { support: "Техподдержка", sales: "ОП" };

/**
 * The city's history: the season going on and the past ones the viewer may see, each with its dates, what was built
 * and who built most. «Смотреть город» opens the past city in 3D as it stood on its last day.
 */
export function CityHistory({ seasons, department, viewing, onView, onLeave, onClose }: { seasons: CitySeasons; department: DepartmentId; viewing: number | null; onView: (season: PastSeason) => void; onLeave: () => void; onClose: () => void }) {
  const { current } = seasons;
  const schedule = current.ends_at ? `Следующий сброс — ${resetMoment(current.ends_at)}${current.period ? `, дальше ${PERIOD_EVERY[current.period]}` : ""}` : "Дата следующего сброса пока не назначена";
  return <Sheet title="История города" subtitle={`Сейчас идёт сезон ${current.number}. ${schedule}.`} onClose={onClose} size="l">
    <HistoryContent seasons={seasons} department={department} viewing={viewing} onView={onView} onLeave={onLeave} />
  </Sheet>;
}

/** What the history sheet holds: what is on the map now, the warning, and the past seasons. */
export function HistoryContent({ seasons, department, viewing, onView, onLeave }: { seasons: CitySeasons; department: DepartmentId; viewing: number | null; onView: (season: PastSeason) => void; onLeave: () => void }) {
  const { current, history } = seasons, shown = history.find(season => season.id === viewing);
  return <div className="city-history">
      {viewing !== null && <p className="city-history__viewing"><span>{shown ? `Сейчас на карте — город сезона ${shown.number}, каким он был в день сброса.` : "Сейчас на карте — прошлый город."}</span><button type="button" className="btn btn--secondary btn--s" onClick={onLeave}>Вернуться в нынешний город</button></p>}
      {current.warning && current.ends_at && <p className="city-history__warning" role="status">⏳ {seasonWarning(current)}</p>}
      <p className="city-history__about">Город строится сезонами. Когда сезон заканчивается, постройки районов уходят в историю и земля снова свободна. Обучение, опыт и коины остаются.
        {seasons.can_manage ? ` Город сбрасывался ${resetsText(seasons.resets)}.` : ` Прошлый город виден здесь ${daysText(seasons.visible_days)} после сброса.`}</p>
      {history.length ? <ol className="city-history__list">{history.map(season => <Season key={season.id} season={season} department={department} shown={season.id === viewing} onView={() => onView(season)} />)}</ol>
        : <p className="city-history__empty">Прошлых сезонов пока нет.</p>}
  </div>;
}

function Season({ season, department, shown, onView }: { season: PastSeason; department: DepartmentId; shown: boolean; onView: () => void }) {
  const { totals } = season;
  const districts = totals.districts.filter(d => d.city === department && (d.buildings || d.small));
  return <li className="city-history__season">
    <header>
      <div><strong>Сезон {season.number}</strong><span>{seasonDates(season.started_at, season.ended_at)} · {daysText(season.days)}</span></div>
      {shown ? <span className="city-history__shown">На карте</span> : <button type="button" className="btn btn--primary btn--s city-history__view" onClick={onView}>Смотреть город</button>}
    </header>
    <p className="city-history__totals">{totalsLine(totals)}</p>
    <p className="city-history__meta">{season.scheduled ? "Сброшен по расписанию" : `Сбросил(а): ${season.ended_by ?? "руководитель"}`}{season.visible_until ? ` · в истории до ${resetMoment(season.visible_until)}` : ""}</p>
    {totals.mine && <p className="city-history__mine">Ваш вклад: {totalsLine({ ...totals.mine, builders: 0 })}</p>}
    {districts.length > 0 && <ul className="city-history__districts" aria-label={`Районы города «${CITY_NAMES[department]}»`}>{districts.map(d => <District key={d.id} district={d} />)}</ul>}
  </li>;
}

function District({ district }: { district: SeasonDistrict }) {
  return <li>
    <strong>{district.name}</strong>
    <span>{totalsLine(district)} · главное здание {district.landmark_level} уровня</span>
    {district.top.length > 0 && <span className="city-history__top">Больше всех построили: {district.top.map(person => `${person.name} (${person.cells} ${plural(person.cells, "клетка", "клетки", "клеток")})`).join(", ")}</span>}
  </li>;
}
