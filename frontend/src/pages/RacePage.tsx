import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { rating } from "../api/endpoints";
import type { RaceMetric, RaceOption, RaceOut, RacePlace, RacePlan } from "../api/types";
import { MedalIcon } from "../components/icons";
import { Badge, Card, Delta, EmptyState, ErrorState, Progress, Skeleton } from "../components/ui";
import { WeekPicker } from "../components/WeekPicker";
import { coins, plural, points } from "../utils/format";
import "./rating.css";
import "./race.css";

/** «2,5 балла», «3 балла», «8 баллов»: a fractional number takes «балла». */
export function pointsLabel(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const word = Number.isInteger(rounded) ? plural(rounded, "балл", "балла", "баллов") : "балла";
  return `${points(rounded)} ${word}`;
}

const withUnit = (value: number | null, unit: string | null) => value == null ? "—" : `${points(value)}${unit ? ` ${unit}` : ""}`;

/** The table shows the top three and the places around the operator; everyone on request. */
export function visibleRows(standings: RacePlace[], all: boolean): (RacePlace | "gap")[] {
  const mine = standings.findIndex((row) => row.is_me);
  if (all || standings.length <= 12) return standings;
  const keep = new Set<number>([0, 1, 2]);
  const centre = mine < 0 ? 3 : mine;
  for (let i = centre - 3; i <= centre + 3; i++) if (i >= 0 && i < standings.length) keep.add(i);
  const out: (RacePlace | "gap")[] = [];
  let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1) out.push("gap");
    out.push(standings[i]);
    last = i;
  }
  if (last < standings.length - 1) out.push("gap");
  return out;
}

export function RacePage() {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("week"));
  const weekId = Number.isInteger(selected) && selected > 0 ? selected : undefined;
  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks(104) });
  const race = useQuery({ queryKey: ["race", weekId], queryFn: () => rating.race(weekId), placeholderData: keepPreviousData });
  // The week and how final its places are sit beside the title as one small row, as on «Рейтинг».
  const heading = (filters?: ReactNode) => <header className="page-head page-head--filters"><div><h1 className="page-title">Гонка недели</h1>
    <p className="page-subtitle">Ваше место среди всех операторов: кого догнать и что подтянуть</p></div>{filters}</header>;

  if (race.isLoading) return <div className="stack">{heading()}<div className="page-skeleton">
    <Skeleton height={60} radius="var(--radius-l)" /><Skeleton height={190} radius="var(--radius-xl)" /><Skeleton height={320} radius="var(--radius-xl)" />
  </div></div>;
  if (race.isError) return <div className="stack">{heading()}<ErrorState error={race.error} onRetry={() => race.refetch()} /></div>;
  const data = race.data!;
  if (!data.week) return <div className="stack">{heading()}<Card><EmptyState title="Гонка ещё не началась" hint="Места появятся, когда загрузят показатели недели" /></Card></div>;

  const status = data.live ? "Неделя идёт · по загруженным данным" : data.week.status === "closed" ? "Итог опубликован" : "Предварительный расчёт";
  return (
    <div className="stack race-page">
      {heading(<div className="head-filters">
        <WeekPicker label="Неделя" weeks={weeks.data ?? []} value={weekId} resolvedWeekId={data.week.id}
          latestLabel="Текущая неделя" latestPreference="latest" loading={weeks.isLoading}
          onChange={(value) => { const next = new URLSearchParams(params); if (value === undefined) next.delete("week"); else next.set("week", String(value)); setParams(next); }} />
        <Badge tone={data.week.status === "closed" ? "success" : data.live ? "info" : "warning"}>{status}</Badge>
      </div>)}
      <RaceHero data={data} />
      {data.standings.length > 0 && <RaceTopThree data={data} />}
      {data.me && data.advice && <RaceAdvice data={data} />}
      {data.standings.length > 0 && <RaceTable data={data} />}
      <RaceNote data={data} />
    </div>
  );
}

function RaceHero({ data }: { data: RaceOut }) {
  const { me, next, behind } = data;
  if (!me) return <Card title="Ваше место" variant="highlight">
    <div className="race-hero race-hero--out">
      <p className="race-hero__lead">Вас пока нет в гонке этой недели</p>
      <p className="secondary small">Ваши показатели за эту неделю ещё не загружены. Участников: {data.participants}.</p>
    </div>
  </Card>;
  const top = data.max_points || 100;
  const third = data.podium[2];
  return <Card title="Ваше место" variant="highlight" tour="race-place">
    <div className="race-hero">
      <div className="race-hero__place">
        <strong>{me.rank}</strong>
        <span>место из {data.participants}</span>
        {me.rank_delta != null && <Delta value={me.rank_delta} label="к прошлой неделе" />}
      </div>
      <div className="race-hero__points">
        <p><strong>{points(me.points)}</strong> из {points(top)} баллов</p>
        <Progress value={Math.min(1, me.points / top)} label="Баллы недели" tone="accent" />
        {me.shared_with.length > 0 && <p className="small secondary">Место поровну с: {me.shared_with.join(", ")}</p>}
      </div>
      <div className="race-gaps">
        {next ? <div className="race-gap race-gap--up">
          <span>До {next.rank}-го места</span><strong>{pointsLabel(next.gap ?? 0)}</strong><small>{next.name}</small>
        </div> : <div className="race-gap race-gap--lead">
          <span><MedalIcon size={16} /> Вы лидер недели</span><strong>1-е место</strong><small>{behind ? `Отрыв ${pointsLabel(behind.lead)}` : "Вы впереди всех"}</small>
        </div>}
        {behind && next && <div className="race-gap race-gap--down">
          <span>Отрыв от {behind.rank}-го места</span><strong>{pointsLabel(behind.lead)}</strong><small>{behind.name}</small>
        </div>}
        {me.rank > 3 && third && third.gap != null && <div className="race-gap race-gap--podium">
          <span>До призовой тройки</span><strong>{pointsLabel(third.gap)}</strong><small>3-е место сейчас: {third.name}</small>
        </div>}
      </div>
    </div>
  </Card>;
}

function RaceTopThree({ data }: { data: RaceOut }) {
  const top = data.standings.slice(0, 3);
  return <Card title="Тройка лидеров" subtitle="Сколько им уступаете вы">
    <ol className="race-top">
      {top.map((row) => <li key={`${row.rank}-${row.name}`} className={`race-top__place race-top__place--${row.rank}${row.is_me ? " is-me" : ""}`}>
        <span className="race-top__medal"><MedalIcon size={18} /> {row.rank}</span>
        <span className="race-top__name">{row.is_me ? <>Вы<span className="tag-me">это вы</span></> : row.name}</span>
        <span className="race-top__points">{points(row.points)}</span>
        <span className="race-top__gap">{row.is_me || row.gap == null ? "" : row.gap > 0 ? `впереди на ${pointsLabel(row.gap)}` : "вы впереди"}</span>
      </li>)}
    </ol>
  </Card>;
}

function OptionList({ items }: { items: RaceOption[] }) {
  return <ul className="race-options">
    {items.map((o) => <li key={o.code}>
      <span className="race-options__title">{o.title}</span>
      <span className="race-options__move">{withUnit(o.value, o.unit)} → <strong>{withUnit(o.need, o.unit)}</strong></span>
      <span className="race-options__gain">+{pointsLabel(o.gain)}</span>
    </li>)}
  </ul>;
}

function PlanText({ plan, closed }: { plan: RacePlan; closed: boolean }) {
  if (plan.reachable) return <><p className="small">Одного показателя не хватит — подтяните вместе:</p><OptionList items={plan.steps} /></>;
  return <p className="small secondary">{closed ? "Этот разрыв за неделю было не закрыть" : "За эту неделю разрыв не закрыть"}: по загруженным показателям можно добрать только {pointsLabel(plan.gain)}. Держите темп — баллы недели идут в конкурс месяца.</p>;
}

function RaceAdvice({ data }: { data: RaceOut }) {
  const advice = data.advice!;
  const closed = data.week?.status === "closed";
  const next = advice.next, podium = advice.podium;
  return <Card title="Что подтянуть" subtitle={closed ? "Неделя закрыта: это подсказки на следующую неделю" : "По вашим показателям этой недели"} tour="race-advice">
    <div className="race-advice">
      {next && <section className="race-advice__goal">
        <h3>Подняться на {next.rank}-е место ({next.name}): нужно +{pointsLabel(next.gap)}</h3>
        {next.options.length > 0 ? <><p className="small">Хватит одного из этого:</p><OptionList items={next.options} /></> : <PlanText plan={next.plan} closed={closed} />}
      </section>}
      {podium && podium.gap !== next?.gap && <section className="race-advice__goal">
        <h3>До призовой тройки: +{pointsLabel(podium.gap)}</h3>
        <PlanText plan={podium.plan} closed={closed} />
      </section>}
      {!next && <p className="race-advice__lead">Вы на первом месте. Чтобы удержать его, не теряйте баллы там, где они уходят.</p>}
      <section>
        <h3>Где вы теряете баллы</h3>
        <ul className="race-metrics">{data.metrics.map((m) => <MetricRow key={m.code} metric={m} />)}</ul>
        {advice.room > 0 && <p className="small secondary">Всего можно добрать ещё {pointsLabel(advice.room)}.</p>}
      </section>
    </div>
  </Card>;
}

/** «следующая ступень — от 94 %: 80 баллов»: what a metric with thresholds gives one step up. */
export function nextBand(metric: Pick<RaceMetric, "bands" | "points" | "unit">): string {
  const next = (metric.bands ?? []).filter((band) => band.points > metric.points).sort((a, b) => a.from - b.from)[0];
  return next ? `следующая ступень — от ${withUnit(next.from, metric.unit)}: ${pointsLabel(next.points)}` : "";
}

function MetricRow({ metric: m }: { metric: RaceMetric }) {
  return <li className="race-metric">
    <div className="race-metric__head">
      <strong>{m.title}</strong>
      <span className={`race-metric__lost${!m.reported ? " is-missing" : m.lost > 0 ? " is-lost" : " is-full"}`}>
        {!m.reported ? "нет данных" : m.lost > 0 ? `−${pointsLabel(m.lost)}` : "максимум"}
      </span>
    </div>
    <p className="small secondary">{m.reported
      ? m.bands?.length
        ? <>{withUnit(m.value, m.unit)} · {points(m.points)} из {points(m.max_points)}{m.lost > 0 ? ` · ${nextBand(m)}` : ""}</>
        : <>{withUnit(m.value, m.unit)} · цель {withUnit(m.target, m.unit)} · {points(m.points)} из {points(m.max_points)}{m.per_unit && m.lost > 0 ? ` · +1${m.unit ? ` ${m.unit}` : ""} = +${pointsLabel(m.per_unit)}` : ""}</>
      : "Показатель ещё не загружен — после загрузки места пересчитаются"}</p>
    <Progress value={m.reported && m.max_points ? m.points / m.max_points : 0} tone={!m.reported || m.lost > 0 ? "warning" : "success"} label={m.title} size="s" />
  </li>;
}

function RaceTable({ data }: { data: RaceOut }) {
  const [all, setAll] = useState(false);
  const rows = visibleRows(data.standings, all);
  const hidden = data.standings.length > 12;
  return <Card title="Таблица гонки" subtitle={`Все операторы недели · ${data.participants}`} padded={false}>
    <div className="table-wrap"><table className="table race-table">
      <thead><tr><th>Место</th><th>Оператор</th><th className="num">Баллы</th><th className="num">От вас</th></tr></thead>
      <tbody>{rows.map((row, i) => row === "gap"
        ? <tr key={`gap-${i}`} className="race-table__gap"><td colSpan={4}>…</td></tr>
        : <tr key={`${row.rank}-${row.name}`} className={row.is_me ? "row--me" : undefined}>
          <td><span className="rank-badge">{row.rank}</span></td>
          <td>{row.is_me ? <>Вы<span className="tag-me">это вы</span></> : row.name}{row.rank_delta != null && row.rank_delta !== 0 && <span className="race-table__delta"><Delta value={row.rank_delta} /></span>}</td>
          <td className="num">{points(row.points)}</td>
          <td className="num race-table__diff">{row.is_me || row.gap == null ? "—" : row.gap === 0 ? "поровну" : row.gap > 0 ? `+${points(row.gap)}` : `−${points(-row.gap)}`}</td>
        </tr>)}</tbody>
    </table></div>
    {hidden && <div className="race-table__more"><button type="button" className="btn btn--plain btn--s" onClick={() => setAll(!all)}>{all ? "Показать только рядом со мной" : `Показать всех (${data.standings.length})`}</button></div>}
  </Card>;
}

function RaceNote({ data }: { data: RaceOut }) {
  const prizes = data.prizes;
  return <div className="race-note small secondary">
    {data.period === "week" && prizes.length === 3
      ? <p>Призы недели: 1 место — {coins(prizes[0])}, 2 — {coins(prizes[1])}, 3 — {coins(prizes[2])} коинов.</p>
      : <p>Места недели не приносят призов: за 1–3 места платят раз в месяц, в «Конкурсе месяца». Но каждый балл недели идёт в его сумму. <Link to="/rating">Открыть конкурс месяца</Link></p>}
    {data.live && <p>Места меняются по мере загрузки показателей; итог — после закрытия недели.</p>}
  </div>;
}
