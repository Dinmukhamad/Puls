import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { economy } from "../api/economy";
import { rating } from "../api/endpoints";
import type { CompareMetric, CompareOut, CompareRow, CompareTeam } from "../api/types";
import { Chart } from "../components/Chart";
import { ChevronLeftIcon, ChevronRightIcon, MedalIcon } from "../components/icons";
import { Select } from "../components/Select";
import { Sheet } from "../components/Sheet";
import { Badge, Card, Delta, EmptyState, ErrorState, SegmentedControl, Skeleton } from "../components/ui";
import { WeekPicker } from "../components/WeekPicker";
import { weekRange } from "../components/weekCalendar";
import { CHANNEL_LABELS, coins, plural, points } from "../utils/format";
import { pointsLabel } from "./RacePage";
import "./rating.css";
import "./race.css";
import "./analytics.css";
import "./rating-compare.css";

type Period = "week" | "month";

const positive = (value: string | null) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : undefined; };
/** «12.10» — the Monday of a week, for the chart and the chips. */
export const shortWeek = (startsOn: string) => `${startsOn.slice(8, 10)}.${startsOn.slice(5, 7)}`;
/** «+10,51», «−0,8»: the gap between two operators' points. */
export const signedPoints = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${points(Math.abs(Math.round(value * 100) / 100))}`;
/** «балл», «балла», «баллов» after a number; a fractional one takes «балла». */
const pointsWord = (value: number) => { const rounded = Math.round(value * 100) / 100; return Number.isInteger(rounded) ? plural(rounded, "балл", "балла", "баллов") : "балла"; };
const place = (rank: number | null | undefined) => rank ? `${rank}-е` : "—";
const withUnit = (value: number | null, unit: string | null) => value == null ? "—" : `${points(value)}${unit ? ` ${unit}` : ""}`;

/** The page's state lives in the address: the period, the week or month and the colleague compared with. */
export function useCompare() {
  const [params, setParams] = useSearchParams();
  // Older links (?view=weeks, ?week=17) open the week as well.
  const period: Period = params.get("period") === "week" || params.get("view") === "weeks" || params.has("week") ? "week" : "month";
  const weekId = positive(params.get("week"));
  const [year, month] = (params.get("month") ?? "").split("-").map(Number);
  const query = useQuery({
    queryKey: ["rating-compare", period, weekId, year || null, month || null],
    queryFn: () => rating.compare(period === "week" ? { period, week_id: weekId } : { period, year: year || undefined, month: month || undefined }),
    placeholderData: keepPreviousData,
  });
  const set = (values: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace });
  };
  const data = query.data;
  const colleague = chosenColleague(data, positive(params.get("with")));
  return { params, set, period, weekId, query, data, colleague };
}
export type CompareState = ReturnType<typeof useCompare>;

/** The operator a row of the table picked; never yourself, and nobody once they are not in the period's table. */
export function chosenColleague(data: CompareOut | undefined, chosen?: number): CompareRow | undefined {
  return chosen ? data?.operators.find((row) => row.user_id === chosen && !row.is_me) : undefined;
}

/** «Вы впереди на 1,64 балла», «Асель Н. впереди на 2,4 балла», «Поровну: 87,88 балла» — names are not declined. */
export function leadLine(me: CompareRow, colleague: CompareRow): { who: string; points: string } {
  const diff = Math.round((me.points - colleague.points) * 100) / 100;
  if (diff > 0) return { who: "Вы впереди на", points: pointsLabel(diff) };
  if (diff < 0) return { who: `${colleague.name} впереди на`, points: pointsLabel(-diff) };
  return { who: "Поровну:", points: pointsLabel(me.points) };
}

/** Weeks both operators have a place in, and in how many of them you were higher. */
export function weeksAhead(me: CompareRow, colleague: CompareRow): { ahead: number; both: number } {
  const both = me.trail.map((mark, index) => [mark, colleague.trail[index]] as const).filter(([a, b]) => a?.rank && b?.rank);
  return { ahead: both.filter(([a, b]) => a!.rank! < b!.rank!).length, both: both.length };
}

/** Where a value sits on a metric's scale, in percent; better is always to the right, whatever the direction. */
export function scale(metric: Pick<CompareMetric, "me" | "average" | "best" | "target" | "direction">) {
  const lower = metric.direction === "lower_is_better";
  const marks = [metric.average, metric.best, metric.target, ...(metric.me == null ? [] : [metric.me])];
  const low = Math.min(...marks), high = Math.max(...marks);
  const pad = Math.max((high - low) * 0.12, Math.abs(high) * 0.02, 0.5);
  const from = Math.max(0, low - pad), to = high + pad;
  return (value: number) => Math.max(0, Math.min(100, ((lower ? to - value : value - from) / (to - from)) * 100));
}

export function RatingHead({ children }: { children?: ReactNode }) {
  return <header className="page-head page-head--filters"><div><h1 className="page-title">Рейтинг</h1>
    <p className="page-subtitle">Ваше место среди всех операторов</p></div>{children}</header>;
}

export function CompareLoading() {
  return <div className="page-skeleton"><Skeleton height={220} radius="var(--radius-xl)" /><Skeleton height={420} radius="var(--radius-xl)" /></div>;
}

/** «Октябрь 2026» for the month's stepper. */
const monthTitle = (name: string) => name.charAt(0).toLocaleUpperCase("ru-RU") + name.slice(1);

/** One small row in the page's head: month or week, which one (arrows step through them), and how final its places are. */
export function CompareFilters({ state }: { state: CompareState }) {
  const { data, period, set, weekId } = state;
  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks(104), enabled: period === "week" });
  const months = useQuery({ queryKey: ["contest-months"], queryFn: economy.months, enabled: period === "month" });
  const shown = data?.month;
  const order = (m: { year: number; month: number }) => m.year * 12 + m.month;
  const choices = [...(months.data ?? [])];
  if (shown && !choices.some((m) => order(m) === order(shown))) choices.push({ year: shown.year, month: shown.month, label: "", name: shown.name, status: data.status });
  choices.sort((a, b) => order(a) - order(b));
  const index = shown ? choices.findIndex((m) => order(m) === order(shown)) : -1;
  const step = (m: { year: number; month: number } | undefined) => m && set({ month: `${m.year}-${m.month}`, with: undefined });
  const closed = data?.weeks.filter((week) => week.status === "closed").length ?? 0;
  const status = !data ? "" : period === "week"
    ? data.live ? "Неделя идёт" : data.status === "closed" ? "Итог опубликован" : "Предварительный расчёт"
    : data.status === "closed" ? "Итоги опубликованы" : `Закрыто недель: ${closed} из ${data.month?.weeks_planned ?? closed}`;
  return <div className="head-filters" data-tour="rating-views">
    <SegmentedControl label="Период рейтинга" value={period} options={[{ value: "month", label: "Месяц" }, { value: "week", label: "Неделя" }]}
      onChange={(value) => set({ period: value === "week" ? "week" : undefined, view: undefined, week: undefined, month: undefined, with: undefined })} />
    {period === "week"
      ? <WeekPicker label="Неделя" weeks={weeks.data ?? []} value={weekId} resolvedWeekId={data?.week?.id} latestLabel="Текущая неделя" latestPreference="latest" loading={weeks.isLoading}
        onChange={(value) => set({ week: value === undefined ? undefined : String(value), with: undefined })} />
      : <div className="head-step" role="group" aria-label="Месяц рейтинга">
        <button type="button" className="head-step__arrow" aria-label="Предыдущий месяц" disabled={index <= 0} onClick={() => step(choices[index - 1])}><ChevronLeftIcon size={16} /></button>
        {/* The month's name opens the list of all contest months, newest first: no stepping to a far one. */}
        <Select className="head-step__select" aria-label="Выбрать месяц рейтинга" placeholder="…" disabled={!choices.length}
          value={shown ? `${shown.year}-${shown.month}` : ""} onChange={(value) => set({ month: value, with: undefined })}
          options={[...choices].reverse().map((m) => ({ value: `${m.year}-${m.month}`, label: monthTitle(m.name) }))} />
        <button type="button" className="head-step__arrow" aria-label="Следующий месяц" disabled={index < 0 || index >= choices.length - 1} onClick={() => step(choices[index + 1])}><ChevronRightIcon size={16} /></button>
      </div>}
    {status && <Badge tone={data?.status === "closed" ? "success" : data?.live ? "info" : "warning"}>{status}</Badge>}
  </div>;
}

/** Places week by week as small chips: the top three in gold, a week without results yet outlined. */
export function TrailChips({ data, row }: { data: CompareOut; row: CompareRow }) {
  return <span className="compare-trail" aria-label={`Места по неделям: ${row.trail.map((mark, index) => `${shortWeek(data.weeks[index].starts_on)} — ${mark?.rank ? `${mark.rank}-е` : "нет"}`).join(", ")}`}>
    {row.trail.map((mark, index) => <span key={data.weeks[index].id} title={`${weekRange(data.weeks[index])}: ${mark?.rank ? `${mark.rank}-е место · ${pointsLabel(mark.points)}` : "нет результата"}${data.weeks[index].live ? " · итогов ещё нет" : ""}`}
      className={`compare-chip${mark?.rank && mark.rank <= 3 ? " is-top" : ""}${data.weeks[index].live ? " is-live" : ""}${!mark ? " is-empty" : ""}`} aria-hidden="true">{mark?.rank ?? "·"}</span>)}
  </span>;
}

/** «Ваше место»: the place, the points, the gaps up and down, the team's place and the month's prize. */
export function CompareSummary({ data }: { data: CompareOut }) {
  const rows = data.operators;
  const index = rows.findIndex((row) => row.is_me);
  const me = rows[index];
  if (!me) return <Card title="Ваше место" variant="highlight"><EmptyState title={data.period === "week" ? "Вас нет в таблице этой недели" : "Вас пока нет в таблице месяца"}
    hint={data.period === "week" ? "Место появится, когда загрузят ваши показатели." : "Месяц считается по закрытым неделям."} /></Card>;
  const above = rows.slice(0, index).reverse().find((row) => row.points > me.points);
  const below = rows.slice(index + 1).find((row) => row.points < me.points);
  const team = data.teams.find((item) => item.is_mine);
  const moved = data.period === "week" ? me.rank_delta : null;
  return <Card title="Ваше место" variant="highlight" className="compare-summary" subtitle={data.period === "week" ? `Неделя ${data.week ? weekRange(data.week) : ""}` : `Конкурс месяца · ${data.title}`}>
    <div className="race-hero">
      <div className="race-hero__place"><strong>{me.rank ?? "—"}</strong><span>место из {data.participants}</span>
        {moved ? <span className="compare-summary__delta"><Delta value={moved} label="к прошлой неделе" /></span> : null}</div>
      <div className="race-hero__points">
        <p><strong>{points(me.points)}</strong> {pointsWord(me.points)}{data.period === "month" && me.weeks ? ` за ${me.weeks} ${plural(me.weeks, "неделю", "недели", "недель")}` : ""}</p>
        {me.trail.filter(Boolean).length > 1 && <p className="compare-summary__trail"><span className="secondary small">По неделям</span><TrailChips data={data} row={me} /></p>}
      </div>
      <div className="race-gaps">
        {above ? <div className="race-gap race-gap--up"><span>До {above.rank}-го места</span><strong>{pointsLabel(above.points - me.points)}</strong><small>{above.name}</small></div>
          : <div className="race-gap race-gap--lead"><span>Вы впереди всех</span><strong>{below ? pointsLabel(me.points - below.points) : "—"}</strong><small>{below ? `отрыв от: ${below.name}` : "один в таблице"}</small></div>}
        {above && below && <div className="race-gap race-gap--down"><span>Отрыв от {below.rank}-го места</span><strong>{pointsLabel(me.points - below.points)}</strong><small>{below.name}</small></div>}
        {team && <div className="race-gap"><span>Ваша команда</span><strong>{team.rank}-е из {data.teams.length}</strong><small>{team.name} · в среднем {points(team.points)}</small></div>}
        {data.period === "month" && (me.prize ?? 0) > 0 && <div className="race-gap race-gap--podium"><span>{data.status === "closed" ? "Начислено" : "Приз сейчас"}</span><strong>{coins(me.prize!)} {plural(me.prize!, "коин", "коина", "коинов")}</strong><small>за место и номинации</small></div>}
      </div>
    </div>
  </Card>;
}

/** Every operator of the period: place, places by week, points and the gap to you; a row opens the comparison. */
export function CompareTable({ data, colleague, onPick }: { data: CompareOut; colleague?: CompareRow; onPick: (row: CompareRow) => void }) {
  const me = data.operators.find((row) => row.is_me);
  const month = data.period === "month";
  const title = "Все операторы";
  if (!data.operators.length) return <Card title={title}><EmptyState title={month ? "Итогов месяца пока нет" : "Мест этой недели пока нет"} hint={month ? "Места появятся после первой закрытой недели месяца." : "Места появятся, когда загрузят показатели недели."} /></Card>;
  const gap = (row: CompareRow) => !me || row.is_me ? "—" : signedPoints(row.points - me.points);
  // The name is the row's button, so the keyboard reaches the comparison too; a click anywhere on the row opens it.
  const name = (row: CompareRow) => row.is_me ? <>Вы<span className="tag-me">это вы</span></>
    : <button type="button" className="compare-name" onClick={(event) => { event.stopPropagation(); onPick(row); }} aria-label={`Сравнить с: ${row.name}`}>{row.name}</button>;
  return <Card title={title} subtitle={`${data.participants} ${plural(data.participants, "оператор", "оператора", "операторов")} · нажмите на оператора, чтобы сравнить`} padded={false} className="compare-table-card">
    <div className="table-wrap table-wrap--responsive">
      <table className="table compare-table">
        <thead><tr>
          <th className="num">Место</th><th>Оператор</th>{data.weeks.length > 1 && <th>По неделям</th>}
          <th className="num">Баллы</th>{me && <th className="num">От вас</th>}{month && <th className="num">Приз</th>}
        </tr></thead>
        <tbody>{data.operators.map((row) => <tr key={row.user_id}
          className={`${row.is_me ? "row--me" : "is-clickable"}${colleague?.user_id === row.user_id ? " is-picked" : ""}`}
          onClick={row.is_me ? undefined : () => onPick(row)}>
          <td className="num"><span className={`rank-badge${row.rank && row.rank <= 3 ? " compare-rank--top" : ""}`}>{row.rank ?? "—"}</span></td>
          <td><span className="cell-person"><span className="cell-person__text">
            <span className="cell-person__name">{name(row)}{row.rank_delta ? <span className="race-table__delta"><Delta value={row.rank_delta} /></span> : null}</span>
            <span className="cell-person__meta">{row.group ?? "Без команды"}</span></span></span></td>
          {data.weeks.length > 1 && <td><TrailChips data={data} row={row} /></td>}
          <td className="num"><strong className="compare-points">{points(row.points)}</strong></td>
          {me && <td className={`num compare-gap${row.is_me ? "" : row.points > me.points ? " is-ahead" : " is-behind"}`}>{gap(row)}</td>}
          {month && <td className="num">{row.prize ? <span className="compare-prize">+{coins(row.prize)}</span> : <span className="muted">—</span>}</td>}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="card__body"><ul className="card-list">{data.operators.map((row) => <li key={row.user_id}
      className={`list-card compare-list-card${row.is_me ? " is-me" : ""}${colleague?.user_id === row.user_id ? " is-picked" : ""}`}
      onClick={row.is_me ? undefined : () => onPick(row)}>
      <div className="list-card__head"><span className="cell-person"><span className={`rank-badge${row.rank && row.rank <= 3 ? " compare-rank--top" : ""}`}>{row.rank ?? "—"}</span>
        <span className="cell-person__text"><span className="cell-person__name">{name(row)}</span>
          <span className="cell-person__meta">{row.group ?? "Без команды"}</span></span></span>
        <span className="compare-list-card__points"><strong>{points(row.points)}</strong>{me && !row.is_me && <small className={row.points > me.points ? "is-ahead" : "is-behind"}>{gap(row)}</small>}</span></div>
      {data.weeks.length > 1 && <div className="compare-list-card__trail"><span className="secondary small">По неделям</span><TrailChips data={data} row={row} /></div>}
    </li>)}</ul></div>
    {data.weeks.some((week) => week.live) && <p className="compare-note">В рамке — неделя без итогов: место по загруженным показателям.{month ? " В баллы месяца входят только закрытые недели." : ""}</p>}
  </Card>;
}

/** You and the colleague side by side: place, points, the best and the usual place, weeks ahead. */
export function HeadToHead({ data, colleague }: { data: CompareOut; colleague: CompareRow }) {
  const me = data.operators.find((row) => row.is_me);
  if (!me) return <EmptyState title="Вас нет в этой таблице" hint="Сравнение появится, когда у вас будет результат за этот период." />;
  const { ahead, both } = weeksAhead(me, colleague);
  const lead = leadLine(me, colleague);
  const ranks = (row: CompareRow) => row.trail.flatMap((mark) => mark?.rank ? [mark.rank] : []);
  const best = (row: CompareRow) => ranks(row).length ? Math.min(...ranks(row)) : null;
  const usual = (row: CompareRow) => ranks(row).length ? Math.round(ranks(row).reduce((sum, rank) => sum + rank, 0) / ranks(row).length * 10) / 10 : null;
  const lines: { label: string; mine: string; theirs: string; better: -1 | 0 | 1 }[] = [
    { label: data.period === "week" ? "Место недели" : "Место месяца", mine: place(me.rank), theirs: place(colleague.rank), better: cmp(colleague.rank, me.rank) },
    { label: "Баллы", mine: points(me.points), theirs: points(colleague.points), better: cmp(me.points, colleague.points) },
    { label: "Лучшее место", mine: place(best(me)), theirs: place(best(colleague)), better: cmp(best(colleague), best(me)) },
    { label: "Обычно на месте", mine: usual(me) == null ? "—" : points(usual(me)), theirs: usual(colleague) == null ? "—" : points(usual(colleague)), better: cmp(usual(colleague), usual(me)) },
  ];
  return <div className="compare-h2h">
    <p className="compare-h2h__lead">{lead.who} <strong>{lead.points}</strong>
      {both > 0 && <span className="secondary"> · выше в {ahead} {plural(ahead, "неделе", "неделях", "неделях")} из {both}</span>}</p>
    <table className="compare-h2h__table">
      <thead><tr><th><span className="sr-only">Показатель</span></th><th>Вы</th><th>{colleague.name}</th></tr></thead>
      <tbody>{lines.map((line) => <tr key={line.label}><th scope="row">{line.label}</th>
        <td className={line.better > 0 ? "is-better" : undefined}>{line.mine}</td><td className={line.better < 0 ? "is-better" : undefined}>{line.theirs}</td></tr>)}</tbody>
    </table>
  </div>;
}

/** 1 when the first is larger (callers order their arguments so that larger is better for you), -1 when smaller. */
function cmp(a: number | null | undefined, b: number | null | undefined): -1 | 0 | 1 {
  if (a == null || b == null || Math.abs(a - b) < 1e-9) return 0;
  return a > b ? 1 : -1;
}

/** Places or points week by week: you, the colleague, and in points also the average and the best of all. */
export function WeeksChart({ data, colleague }: { data: CompareOut; colleague: CompareRow }) {
  const [mode, setMode] = useState<"rank" | "points">("rank");
  const me = data.operators.find((row) => row.is_me);
  if (data.weeks.length < 2) return <EmptyState title="Пока одна неделя" hint="Динамика появится со второй недели периода." />;
  const labels = data.weeks.map((week) => `${shortWeek(week.starts_on)}${week.live ? " ·" : ""}`);
  const values = (row: CompareRow | undefined) => data.weeks.map((_, index) => { const mark = row?.trail[index]; return mark ? (mode === "rank" ? mark.rank : mark.points) : null; });
  const column = (index: number) => data.operators.flatMap((row) => row.trail[index] ? [row.trail[index]!.points] : []);
  const series = [
    ...(me ? [{ id: "me", name: "Вы", values: values(me) }] : []),
    { id: "them", name: colleague.name, values: values(colleague) },
    ...(mode === "points" ? [
      { id: "avg", name: "Среднее по всем", values: data.weeks.map((_, index) => { const all = column(index); return all.length ? Math.round(all.reduce((s, v) => s + v, 0) / all.length * 100) / 100 : null; }) },
      { id: "best", name: "Лучший результат", values: data.weeks.map((_, index) => { const all = column(index); return all.length ? Math.max(...all) : null; }) },
    ] : []),
  ];
  return <div className="compare-chart">
    <SegmentedControl label="Что показать" value={mode} options={[{ value: "rank", label: "Места" }, { value: "points", label: "Баллы" }]} onChange={setMode} />
    <Chart title={mode === "rank" ? "Места по неделям" : "Баллы по неделям"} labels={labels} series={series} compact lowerAtTop={mode === "rank"} integerAxis={mode === "rank"} />
  </div>;
}

/** Each metric: your value, the average and the best of everyone who reported it — never another one's value. */
export function MetricsCompare({ data }: { data: CompareOut }) {
  const reported = Math.max(0, ...data.metrics.map((metric) => metric.reported));
  return <Card title="Показатели: вы и все" className="compare-metrics-card"
    subtitle={data.metrics.length ? `${data.period === "month" ? "Средние за месяц" : "За неделю"} · среднее и лучший среди ${reported} ${plural(reported, "оператора", "операторов", "операторов")} · чужие значения без имён` : undefined}>
    {data.metrics.length === 0 ? <EmptyState title="Показателей пока нет" hint={data.period === "month" ? "Средние появятся после первой закрытой недели месяца." : "Появятся, когда загрузят показатели недели."} />
      : <>
        <ul className="compare-metrics">{data.metrics.map((metric) => <MetricLine key={metric.code} metric={metric} />)}</ul>
        <div className="compare-legend" aria-hidden="true"><span><i className="is-me" />Вы</span><span><i className="is-avg" />Среднее</span><span><i className="is-best" />Лучший</span><span><i className="is-target" />Цель</span></div>
      </>}
  </Card>;
}

function MetricLine({ metric }: { metric: CompareMetric }) {
  const lower = metric.direction === "lower_is_better";
  const at = scale(metric);
  const left = (value: number) => `${at(value)}%`;
  const diff = metric.me == null ? null : Math.round((metric.me - metric.average) * 100) / 100;
  const good = diff != null && (lower ? diff < 0 : diff > 0);
  return <li className="compare-metric">
    <div className="compare-metric__head">
      <span className="compare-metric__title">{metric.title}{metric.bonus && <> <Badge tone="accent">бонус</Badge></>}</span>
      {metric.place != null ? <span className={`compare-metric__place${metric.place === 1 ? " is-best" : ""}`}>{metric.place === 1 ? <><MedalIcon size={14} />лучший результат</> : `${metric.place}-е из ${metric.reported}`}</span>
        : <span className="compare-metric__place muted">нет данных</span>}
    </div>
    <div className="compare-scale" role="img" aria-label={`${metric.title}: вы ${withUnit(metric.me, metric.unit)}, среднее ${withUnit(metric.average, metric.unit)}, лучший ${withUnit(metric.best, metric.unit)}, цель ${withUnit(metric.target, metric.unit)}`}>
      <span className="compare-scale__track" />
      {metric.me != null && <span className="compare-scale__fill" style={{ width: left(metric.me) }} />}
      <span className="compare-scale__mark is-target" style={{ left: left(metric.target) }} />
      <span className="compare-scale__mark is-avg" style={{ left: left(metric.average) }} />
      <span className="compare-scale__mark is-best" style={{ left: left(metric.best) }} />
      {metric.me != null && <span className="compare-scale__mark is-me" style={{ left: left(metric.me) }} />}
    </div>
    <p className="compare-metric__values">
      <span>Вы <strong>{withUnit(metric.me, metric.unit)}</strong></span>
      <span>Среднее {withUnit(metric.average, metric.unit)}</span>
      <span>Лучший {withUnit(metric.best, metric.unit)}</span>
      {diff != null && Math.abs(diff) >= 0.01 && <span className={good ? "is-good" : "is-bad"}>{signedPoints(diff)} к среднему</span>}
    </p>
  </li>;
}

/**
 * The line and the chats side by side (docs/CHANNELS.md). Each channel races on its own, scores its own metrics on 100
 * points and is paid at one rate, so the average week of an operator compares fairly. Shown once both have results.
 */
export function ChannelsCard({ data }: { data: CompareOut }) {
  const channels = data.channels ?? [];
  if (channels.filter((item) => item.participants > 0).length < 2) return null;
  return <Card title="Направления" className="compare-channels-card"
    subtitle="Линия и чаты соревнуются отдельно. У каждого свои показатели на 100 баллов и бонус за переработки сверх них, один курс коинов, поэтому средняя неделя сравнима">
    <ul className="compare-channels">{channels.map((item) => <li key={item.channel} className={`compare-channel${item.is_mine ? " is-mine" : ""}`}>
      <span className="compare-channel__name">{CHANNEL_LABELS[item.channel]}{item.is_mine && <span className="tag-me">ваше</span>}</span>
      <span className="compare-channel__average"><strong>{item.average == null ? "—" : points(item.average)}</strong><small>средняя неделя оператора{data.period === "month" ? " за месяц" : ""}</small></span>
      <span className="compare-channel__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, item.average ?? 0))}%` }} /></span>
      <span className="compare-channel__meta">{item.participants} {plural(item.participants, "оператор", "оператора", "операторов")}{item.best ? ` · лучший — ${item.best.is_me ? "вы" : item.best.name}, ${points(item.best.points)}` : ""}</span>
      <span className="compare-channel__scale">{item.metrics.map((metric) => metric.bonus ? `${metric.title} — бонус до +${points(metric.max_points)}` : `${metric.title} — ${points(metric.max_points)}`).join(" · ")}</span>
    </li>)}</ul>
  </Card>;
}

/** Teams by the average points of their operators, with their best operator. */
export function TeamsCard({ data }: { data: CompareOut }) {
  if (!data.teams.length) return <Card title="Команды"><EmptyState title="Команд пока нет" hint="Команды появятся, когда у операторов будут результаты." /></Card>;
  return <Card title="Команды" subtitle="По средним баллам оператора команды" className="compare-teams-card">
    <ol className="compare-teams">{data.teams.map((team) => <TeamLine key={team.group_id} team={team} />)}</ol>
  </Card>;
}

function TeamLine({ team }: { team: CompareTeam }) {
  return <li className={`compare-team${team.is_mine ? " is-mine" : ""}`}>
    <span className={`rank-badge${team.rank === 1 ? " compare-rank--top" : ""}`}>{team.rank}</span>
    <span className="compare-team__body">
      <span className="compare-team__name">{team.name}{team.is_mine && <span className="tag-me">ваша</span>}</span>
      <span className="compare-team__meta">{team.members} {plural(team.members, "оператор", "оператора", "операторов")} · лучший — {team.best.is_me ? "вы" : team.best.name}, {points(team.best.points)}</span>
    </span>
    <span className="compare-team__points"><strong>{points(team.points)}</strong><small>в среднем</small></span>
  </li>;
}

/** The comparison with one colleague in a sheet, opened from a row of the table. */
export function CompareSheet({ data, colleague, onClose }: { data: CompareOut; colleague: CompareRow; onClose: () => void }) {
  return <Sheet title={`Вы и ${colleague.name}`} subtitle={data.period === "month" ? `Конкурс месяца · ${data.title}` : `Неделя ${data.week ? weekRange(data.week) : ""}`} onClose={onClose}>
    <div className="stack compare-sheet"><HeadToHead data={data} colleague={colleague} /><WeeksChart data={data} colleague={colleague} /></div>
  </Sheet>;
}

export function CompareError({ state }: { state: CompareState }) {
  return <ErrorState error={state.query.error} onRetry={() => state.query.refetch()} />;
}
