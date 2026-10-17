import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { CityData, CityMission, DistrictId } from "../api/city";
import { Badge, Card, ErrorState, Progress, Skeleton } from "../components/ui";
import { CheckIcon, ChevronRightIcon } from "../components/icons";
import { plural } from "../utils/format";
import { DISTRICT_COLORS, DISTRICT_ICONS } from "./city/cityDistricts";
import { currentTrainingMission, trainingSummary, useTraineeLearning } from "./traineeLearning";
import "./trainee.css";

export { currentTrainingMission, trainingSummary } from "./traineeLearning";

/** What each district of the city teaches, in the words of the job. */
const TEACHES: Record<DistrictId, string> = { academy: "Знакомство с городом и подготовкой", driver: "Работа в приложении со стороны водителя", crm: "Обращения и тикеты в CRM", dispatch: "Аккаунт водителя в Диспетчерской", oktell: "Звонки и сообщения в Oktell", scenarios: "Разговор с водителем от начала до конца" };
const STATES: Record<CityMission["state"], string> = { completed: "Пройдено", available: "Можно начать", in_progress: "В процессе", ready: "Результат проверен", locked: "Позже", unavailable: "На паузе" };
const tint = (id: DistrictId) => ({ "--district": DISTRICT_COLORS[id] }) as CSSProperties;
/** A district or one of its missions in the trainee's city. */
const inCity = (district: DistrictId, mission?: string) => `/training/city?district=${district}${mission ? `&mission=${mission}` : ""}`;

export function TraineeProgress({ data }: { data: Pick<CityData, "missions"> }) {
  const summary = trainingSummary(data);
  return <div className="trainee-progress">
    <div className="trainee-progress__value"><strong>{summary.percent}%</strong><span>{summary.total ? `Пройдено ${summary.completed} из ${summary.total} ${plural(summary.total, "миссии", "миссий", "миссий")}` : "Программа появится после назначения обучения"}</span></div>
    <Progress value={summary.total ? summary.completed / summary.total : 0} label="Прогресс подготовки" />
    <p className="small secondary">Миссии засчитываются сами по результатам тренажёров. Прогресс видит наставник.</p>
  </div>;
}

/**
 * The trainee's cabinet (docs/TRAINEE.md): what to do next, how far the preparation is, and the districts of the learning
 * city — named, drawn and coloured as in the city itself, each opening there with its missions.
 */
export function TraineePage() {
  const query = useTraineeLearning();
  if (query.isPending) return <div className="page-skeleton"><Skeleton height={44} width="45%" /><Skeleton height={200} /><Skeleton height={320} /></div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data) return null;
  const summary = trainingSummary(data);
  const districts = data.districts.filter(district => !district.soon);
  const current = currentTrainingMission(summary.missions.filter(mission => districts.some(district => district.id === mission.district)));
  const home = current && districts.find(district => district.id === current.district);
  const finished = summary.total > 0 && summary.completed === summary.total;

  return <div className="stack trainee-page">
    <div className="page-head"><div><h1 className="page-title">Мой кабинет</h1><p className="page-subtitle">{data.full_name} · Стажёр</p></div></div>
    <div className="trainee-overview">
      <Card title={finished ? "Подготовка пройдена" : current ? "Продолжить обучение" : "Подготовка к работе"} className="trainee-current">
        {current && home ? <>
          <div className="trainee-current__meta"><span className="trainee-district-chip" style={tint(home.id)}><span aria-hidden="true">{DISTRICT_ICONS[home.id]}</span>{home.name}</span><Badge tone="neutral">{STATES[current.state]}</Badge></div>
          <h3>{current.title}</h3><p className="secondary">{current.description || current.objective}</p>
          <div className="trainee-current__actions">
            <Link className="btn btn--primary btn--m" to={current.path}>{current.state === "in_progress" ? "Продолжить задание" : "Открыть задание"}<ChevronRightIcon size={16} /></Link>
            <Link className="btn btn--plain btn--m" to={inCity(current.district, current.key)}>Показать в городе</Link>
          </div>
        </> : <>
          <h3>{finished ? "Все миссии пройдены" : summary.total ? "Доступных миссий пока нет" : "Программа ещё не назначена"}</h3>
          <p className="secondary">{finished ? "Результаты сохранены. Следующий шаг обсуди с наставником; тренажёры в городе доступны для повторения." : "Обратись к наставнику, чтобы уточнить следующий шаг подготовки."}</p>
          <div className="trainee-current__actions"><Link className="btn btn--secondary btn--m" to="/training/city">Открыть учебный город<ChevronRightIcon size={16} /></Link></div>
        </>}
      </Card>
      <Card title="Мой прогресс"><TraineeProgress data={data} /></Card>
    </div>
    <Card title="Учебный город" subtitle="Каждый район учит своему рабочему инструменту. Открой район — его миссии и тренажёр ждут в городе." padded={false} className="trainee-program-card"
      action={<Link className="btn btn--secondary btn--s" to="/training/city">Открыть город<ChevronRightIcon size={14} /></Link>}>
      <ol className="trainee-program" aria-label="Районы учебного города">{districts.map(district => {
        const rows = summary.missions.filter(mission => mission.district === district.id);
        const done = rows.filter(mission => mission.state === "completed").length;
        const complete = rows.length > 0 && done === rows.length;
        const accessible = rows.length === 0 || Boolean(currentTrainingMission(rows));
        return <li key={district.id}><Link to={inCity(district.id)} style={tint(district.id)}>
          <span className={`trainee-program__icon${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <CheckIcon /> : DISTRICT_ICONS[district.id]}</span>
          <span className="trainee-program__text"><strong>{district.name}</strong><span>{TEACHES[district.id]}</span></span>
          <span className="trainee-program__status"><Badge tone={complete ? "success" : "neutral"}>{complete ? "Пройдено" : current?.district === district.id ? "Сейчас" : accessible ? rows.length ? "Можно начать" : "Практика" : "Позже"}</Badge>{rows.length > 0 && <small>{done} из {rows.length} {plural(rows.length, "миссии", "миссий", "миссий")}</small>}</span>
          <ChevronRightIcon size={16} />
        </Link></li>;
      })}</ol>
    </Card>
  </div>;
}
