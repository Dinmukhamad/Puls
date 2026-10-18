import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { city, type CityData, type CityMission } from "../api/city";
import { economy } from "../api/economy";
import { cabinet, rating } from "../api/endpoints";
import { games } from "../api/games";
import type { BalanceBlock, DashboardOut, RaceOut, RacePlace } from "../api/types";
import { useAccess } from "../auth/AccessContext";
import { AccessLink as Link } from "../components/AccessLink";
import { Card, Delta, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { weekRange } from "../components/weekCalendar";
import { coins, plural, points } from "../utils/format";
import { MetricRow, OptionList, PlanText, pointsLabel } from "./RacePage";
import "./rating.css";
import "./race.css";
import "./home.css";

const CITY_PATH = "/training/city";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

/**
 * The operator's home is the week's race (docs/OPERATOR_HOME.md): the place among everyone, who is just ahead and
 * behind, what exactly to improve, the month's contest that pays the prizes, and what can be done today.
 */
export function CabinetPage() {
  // The same keys as «Гонка недели» and «Конкурс месяца»: opening them after the home reads the cache.
  const race = useQuery({ queryKey: ["race", undefined], queryFn: () => rating.race() });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard() });

  if (race.isLoading) return <div className="page-skeleton">
    <Skeleton height={44} width="55%" radius="var(--radius-s)" />
    <Skeleton height={230} radius="var(--radius-xl)" />
    <Skeleton height={200} radius="var(--radius-xl)" />
  </div>;
  if (race.isError) return <ErrorState error={race.error} onRetry={() => race.refetch()} />;

  const data = race.data!;
  const balance = dashboard.data?.balance;
  return <div className="stack home-race" data-tour="home">
    <HomeHead data={data} dashboard={dashboard.data} />
    {!data.week ? <Card><EmptyState title="Гонка ещё не началась" hint="Места появятся, когда загрузят показатели недели" /></Card> : <>
      {data.standings.length > 0 && <RaceTrackCard data={data} />}
      {data.me && data.advice && <HomeMoves data={data} />}
    </>}
    <div className="home-race__split">
      {data.week && data.me && <Card className="home-losses" title="Где теряются баллы"
        subtitle={data.advice && data.advice.room > 0 ? `Можно добрать ещё ${pointsLabel(data.advice.room)}` : "Все баллы недели набраны"}
        action={<Link hideWhenDenied className="home-link" to="/progress">Показатели и расчёт коинов →</Link>}>
        <ul className="race-metrics">{data.metrics.map((metric) => <MetricRow key={metric.code} metric={metric} />)}</ul>
      </Card>}
      <aside className="home-race__aside" aria-label="Месяц и сегодня">
        {data.period !== "week" && <MonthCard />}
        <TodayCard balance={balance} />
      </aside>
    </div>
  </div>;
}

/** «8-м месте»: the ordinal of a place in the prepositional case. */
const placeIn = (rank: number) => `${rank}-м`;
/** A name closes a sentence: «Арман И.» already ends with its full stop. */
const closing = (name: string) => name.endsWith(".") ? name : `${name}.`;

function HomeHead({ data, dashboard }: { data: RaceOut; dashboard?: DashboardOut }) {
  const name = dashboard?.full_name.trim().split(/\s+/)[0];
  const me = data.me;
  const week = data.week;
  const status = !week ? "" : data.live ? "места по загруженным показателям" : week.status === "closed" ? "итог опубликован" : "предварительный расчёт";
  // The forecast belongs to the same week as the places, or it is not shown.
  const forecast = dashboard && week && dashboard.week.week_id === week.id && dashboard.week.coins_total > 0 ? dashboard.week : null;
  return <header className="page-head home-head">
    <div>
      <h1 className="page-title">{me ? `${name ? `${name}, в` : "В"}ы на ${placeIn(me.rank)} месте из ${data.participants}` : `${greeting()}${name ? `, ${name}` : ""}`}</h1>
      <p className="page-subtitle">{week
        ? me ? `Гонка недели · ${weekRange(week)} · ${status}` : `Вас пока нет в гонке ${weekRange(week)}: места появятся, когда загрузят ваши показатели`
        : "Гонка недели начнётся, когда загрузят показатели"}</p>
    </div>
    {me && <div className="page-head__actions home-head__chips">
      <span className="home-chip">{points(me.points)} из {points(data.max_points || 100)} баллов</span>
      {forecast && <span className="home-chip home-chip--coin">{forecast.is_final ? "" : "≈"}{coins(forecast.coins_total)} {plural(forecast.coins_total, "коин", "коина", "коинов")} за неделю</span>}
    </div>}
  </header>;
}

export interface TrackScale { min: number; max: number; ticks: number[]; at: (value: number) => number }

/** The points axis: a little room around the field and round ticks, no more than seven of them. */
export function trackScale(values: number[]): TrackScale {
  const low = Math.min(...values), high = Math.max(...values);
  let min = Math.floor(low - 1), max = Math.ceil(high + 1);
  if (low >= 0) min = Math.max(0, min);
  if (max - min < 4) max = min + 4;
  const step = [1, 2, 4, 5, 10, 20, 25, 50].find((size) => (max - min) / size <= 6) ?? 100;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + 1e-9; tick += step) ticks.push(tick);
  return { min, max, ticks, at: (value) => (value - min) / (max - min) * 100 };
}

export interface TrackLabel { key: string; at: number; text: string; value: string; row: "above" | "below"; align: "start" | "center" | "end"; tone: "me" | "near" | "lead" | "podium" }

/**
 * Names on the axis: you above, the leader above when far enough from you, the one just ahead below to the right and the
 * one just behind below to the left, the third place when it is clear of them. Labels at the edges grow inwards.
 */
export function trackLabels(data: Pick<RaceOut, "standings" | "next" | "behind">, scale: TrackScale): TrackLabel[] {
  const align = (at: number, wanted: TrackLabel["align"]): TrackLabel["align"] => at < 10 ? "start" : at > 90 ? "end" : wanted;
  const label = (key: string, row: RacePlace, text: string, line: TrackLabel["row"], wanted: TrackLabel["align"], tone: TrackLabel["tone"]): TrackLabel => {
    const at = scale.at(row.points);
    return { key, at, text, value: points(row.points), row: line, align: align(at, wanted), tone };
  };
  const labels: TrackLabel[] = [];
  const me = data.standings.find((row) => row.is_me);
  if (me) labels.push(label("me", me, "Вы", "above", "center", "me"));
  const leader = data.standings[0];
  if (leader && !leader.is_me && (!me || Math.abs(scale.at(leader.points) - scale.at(me.points)) > 16)) labels.push(label("lead", leader, `1 · ${leader.name}`, "above", "center", "lead"));
  if (data.next && !data.next.is_me) labels.push(label("next", data.next, `${data.next.rank} · ${data.next.name}`, "below", "start", "near"));
  if (data.behind) labels.push(label("behind", data.behind, `${data.behind.rank} · ${data.behind.name}`, "below", "end", "near"));
  const third = data.standings.find((row) => row.rank === 3);
  const below = labels.filter((item) => item.row === "below");
  if (me && third && me.rank > 3 && third.rank !== data.next?.rank && below.every((item) => Math.abs(item.at - scale.at(third.points)) > 18))
    labels.push(label("third", third, "3-е место", "below", "center", "podium"));
  return labels;
}

/** On a phone the axis gives way to a short ladder: the leader, then you with two places either side. */
export function ladderRows(standings: RacePlace[]): (RacePlace | "gap")[] {
  const mine = standings.findIndex((row) => row.is_me);
  if (mine < 0) return standings.slice(0, 5);
  const keep = new Set<number>([0]);
  for (let i = mine - 2; i <= mine + 2; i++) if (i >= 0 && i < standings.length) keep.add(i);
  const out: (RacePlace | "gap")[] = [];
  let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1) out.push("gap");
    out.push(standings[i]);
    last = i;
  }
  return out;
}

function RaceTrackCard({ data }: { data: RaceOut }) {
  const scale = trackScale(data.standings.map((row) => row.points));
  const labels = trackLabels(data, scale);
  const me = data.me;
  const third = data.standings.find((row) => row.rank === 3);
  const near = new Set([data.next?.rank, data.behind?.rank]);
  const summary = me
    ? `Шкала баллов от ${points(scale.min)} до ${points(scale.max)}. Вы — ${points(me.points)}, ${me.rank}-е место из ${data.participants}.${data.next ? ` Впереди ${data.next.name} с ${points(data.next.points)}.` : " Вы впереди всех."}${data.behind ? ` Позади ${data.behind.name} с ${points(data.behind.points)}.` : ""}`
    : `Шкала баллов от ${points(scale.min)} до ${points(scale.max)}. Первое место — ${data.standings[0].name} с ${points(data.standings[0].points)}.`;
  return <Card className="home-track-card" tour="home-race" title={`Все ${data.participants} ${plural(data.participants, "оператор", "оператора", "операторов")} по баллам недели`}
    subtitle={me?.rank_delta ? <Delta value={me.rank_delta} label={plural(Math.abs(me.rank_delta), "место к прошлой неделе", "места к прошлой неделе", "мест к прошлой неделе")} /> : undefined}
    action={<Link hideWhenDenied className="home-link" to="/race">Вся таблица →</Link>}>
    <div className="home-track" role="img" aria-label={summary}>
      {third && <span className="home-track__podium" style={{ left: `${scale.at(third.points)}%` }} aria-hidden="true"><span>Тройка лидеров</span></span>}
      <span className="home-track__line" aria-hidden="true" />
      {data.standings.map((row) => <span key={`${row.rank}-${row.name}`} aria-hidden="true" style={{ left: `${scale.at(row.points)}%` }}
        className={`home-track__dot${row.is_me ? " is-me" : near.has(row.rank) ? " is-near" : row.rank <= 3 ? " is-podium" : ""}`} />)}
      {labels.map((item) => <span key={item.key} aria-hidden="true" style={{ left: `${item.at}%` }}
        className={`home-track__label is-${item.row} is-${item.align} is-${item.tone}`}>{item.tone === "me" ? `${item.text} · ${item.value}` : <><b>{item.text}</b> {item.value}</>}</span>)}
      {scale.ticks.map((tick, index) => <span key={tick} aria-hidden="true" style={{ left: `${scale.at(tick)}%` }}
        className={`home-track__tick${index === 0 ? " is-first" : index === scale.ticks.length - 1 ? " is-last" : ""}`}>{index === scale.ticks.length - 1 ? `${points(tick)} баллов` : points(tick)}</span>)}
    </div>
    <ol className="home-ladder" aria-label="Вы и соседи по гонке">{ladderRows(data.standings).map((row, index) => row === "gap"
      ? <li key={`gap-${index}`} className="home-ladder__gap" aria-hidden="true">…</li>
      : <li key={`${row.rank}-${row.name}`} className={`home-ladder__row${row.is_me ? " is-me" : row.rank === data.next?.rank ? " is-next" : row.rank <= 3 ? " is-podium" : ""}`}>
        <b>{row.rank}</b><span>{row.is_me ? "Вы" : row.name} · {points(row.points)}</span>
        <span className="home-ladder__gap-value">{row.is_me || row.gap == null ? "" : row.gap === 0 ? "поровну" : row.gap > 0 ? `+${points(row.gap)}` : `−${points(-row.gap)}`}</span>
      </li>)}</ol>
  </Card>;
}

/** The moves: the place above and what is enough for it, the cushion over the one behind, the way to the top three. */
function HomeMoves({ data }: { data: RaceOut }) {
  const me = data.me!, advice = data.advice!;
  const closed = data.week?.status === "closed";
  const { next, podium } = advice;
  const behind = data.behind;
  const full = data.metrics.filter((metric) => metric.reported && metric.lost <= 0 && metric.max_points > 0).map((metric) => metric.title);
  return <div className="home-moves" data-tour="home-moves">
    {next ? <article className="home-move home-move--up">
      <p className="home-move__label">Подняться на {next.rank}-е место</p>
      <p className="home-move__value">+{pointsLabel(next.gap)}</p>
      <p className="small secondary">Впереди — {closing(next.name)}{next.options.length > 0 ? " Хватит одного из этого:" : ""}</p>
      {next.options.length > 0 ? <OptionList items={next.options.slice(0, 3)} /> : <PlanText plan={next.plan} closed={closed} />}
    </article> : <article className="home-move home-move--up">
      <p className="home-move__label">Вы лидер недели</p>
      <p className="home-move__value">{behind ? `+${pointsLabel(behind.lead)}` : "1-е место"}</p>
      <p className="small secondary">{behind ? `Следом — ${closing(behind.name)} ` : ""}Чтобы удержать место, не теряйте баллы там, где они уходят.</p>
    </article>}
    {next && behind && <article className="home-move">
      <p className="home-move__label">Удержать {me.rank}-е место</p>
      <p className="home-move__value">{pointsLabel(behind.lead)}</p>
      <p className="small secondary">Позади — {closing(behind.name)} {full.length ? `${full.join(", ")}: на максимуме — держите.` : "Баллы недели ещё могут измениться."}</p>
    </article>}
    {podium && me.rank > 3 && podium.gap !== next?.gap && <article className="home-move home-move--podium">
      <p className="home-move__label">До тройки лидеров</p>
      <p className="home-move__value">+{pointsLabel(podium.gap)}</p>
      <PlanText plan={podium.plan} closed={closed} />
    </article>}
  </div>;
}

/** The month's contest: places pay once a month, every point of the week goes into its sum. */
function MonthCard() {
  const query = useQuery({ queryKey: ["contest-month", undefined, undefined], queryFn: () => economy.month() });
  if (query.isLoading) return <Card title="Конкурс месяца"><Skeleton height={120} /></Card>;
  if (query.isError) return <Card title="Конкурс месяца"><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>;
  const data = query.data!;
  const mine = data.standings.find((row) => row.mine);
  const closedWeeks = data.weeks.filter((week) => week.status === "closed").length;
  const planned = Math.max(data.weeks_planned, data.weeks.length);
  const prize = mine ? mine.coins_rank_bonus + mine.coins_nomination_bonus : 0;
  return <Card className="home-month" tour="home-month" title="Конкурс месяца" subtitle={data.name.charAt(0).toLocaleUpperCase() + data.name.slice(1)}
    action={<Link hideWhenDenied className="home-link" to="/rating">Таблица →</Link>}>
    {mine?.rank ? <div className="home-month__body">
      <p className="home-month__place">{mine.rank}-е место</p>
      <p className="small secondary">{pointsLabel(mine.points)} за {mine.weeks} {plural(mine.weeks, "неделю", "недели", "недель")}</p>
      <p className="home-month__gap">{monthGap(data.standings, mine)}</p>
      {prize > 0 && <p className="home-month__prize">{data.status === "closed" ? "Начислено" : "Приз сейчас"} — {coins(prize)} {plural(prize, "коин", "коина", "коинов")}{data.status !== "closed" && <small>Начислится, когда месяц закроется</small>}</p>}
    </div> : <p className="secondary">{data.standings.length ? "Вас пока нет в таблице месяца: она считается по закрытым неделям." : "Итогов месяца пока нет: места появятся после первой закрытой недели."}</p>}
    {planned > 0 && <div className="home-month__weeks">
      <span className="home-month__bar" aria-hidden="true">{Array.from({ length: planned }, (_, index) =>
        <span key={index} className={index < closedWeeks ? "is-closed" : index === closedWeeks && data.status !== "closed" ? "is-current" : undefined} />)}</span>
      <span className="small secondary">Закрыто {closedWeeks} из {planned} {plural(planned, "недели", "недель", "недель")}</span>
    </div>}
  </Card>;
}

/** «Отрыв 0,39 балла · следом Данияр А.» for the leader, «До 1-го места — 2,1 балла» for the rest. */
export function monthGap(standings: { name: string | null; rank: number | null; points: number; mine: boolean }[], mine: { rank: number | null; points: number }): string {
  if (mine.rank === 1) {
    const second = standings.find((row) => !row.mine && row.rank !== null);
    if (!second) return "Вы впереди всех";
    const lead = Math.round((mine.points - second.points) * 100) / 100;
    // Names are not declined: «Отрыв 0,39 балла · следом Данияр А.».
    return lead > 0 ? `Отрыв ${pointsLabel(lead)} · следом ${second.name ?? "второе место"}` : `Поровну с: ${second.name ?? "соседом"}`;
  }
  const leader = standings.find((row) => row.rank === 1);
  return leader ? `До 1-го места — ${pointsLabel(Math.round((leader.points - mine.points) * 100) / 100)}` : "";
}

/** The city's next mission, in the city's own order; never a locked or paused one. */
export function nextMission(data: CityData | undefined): CityMission | undefined {
  const missions = data?.missions.filter((mission) => mission.enabled && data.districts.some((district) => district.id === mission.district && !district.soon)) ?? [];
  return missions.find((mission) => mission.state === "ready")
    ?? missions.find((mission) => mission.state === "in_progress")
    ?? missions.find((mission) => mission.state === "available");
}

/** What can be done right now: the day's situations or the open chest, the next mission, the coins on the account. */
function TodayCard({ balance }: { balance?: BalanceBlock }) {
  const access = useAccess();
  const cityAllowed = access.canPath(CITY_PATH);
  const wheelAllowed = access.canPath("/games");
  const cityQuery = useQuery({ queryKey: ["city", "self"], queryFn: ({ signal }) => city.own(signal), enabled: cityAllowed, staleTime: 30_000, retry: false });
  const wheel = useQuery({ queryKey: ["wheel"], queryFn: games.wheel, enabled: wheelAllowed });
  const data = cityQuery.data;
  const quests = data?.quests?.items ?? [];
  const answered = quests.filter((quest) => quest.answered).length;
  const chest = wheel.data?.enabled ? wheel.data.chest : undefined;
  const chestReady = !!chest?.unlocked && (wheel.data?.free_left ?? 0) > 0;
  const mission = nextMission(data);
  const canReward = !!data?.can_claim && !data.preview && !data.inspecting;
  const missionTo = mission ? `${CITY_PATH}?${new URLSearchParams({ district: mission.district, mission: mission.key })}` : CITY_PATH;
  // «Кошелёк в кабинете» links here (/cabinet#wallet): the balance row comes into view once it is drawn.
  useEffect(() => {
    if (balance && window.location.hash === "#wallet") document.getElementById("wallet")?.scrollIntoView({ block: "center" });
  }, [balance]);
  const reward = mission ? [mission.coins > 0 ? `+${coins(mission.coins)} ${plural(mission.coins, "коин", "коина", "коинов")}` : "", mission.xp > 0 ? `+${coins(mission.xp)} опыта` : ""].filter(Boolean).join(" · ") : "";
  return <Card className="home-today" tour="home-today" title="Сегодня ещё" action={<Link hideWhenDenied className="home-link" to="/wallet">История коинов →</Link>}>
    <ul className="home-today__list">
      {cityAllowed && cityQuery.isPending && cityQuery.fetchStatus !== "paused" && <li><Skeleton height={44} /></li>}
      {chestReady ? <li><Link hideWhenDenied className="home-today__row" to="/games?tab=wheel">
        <span><strong>Сундук дня открыт</strong><small>Ситуации дня отвечены — заберите приз</small></span><span className="home-today__value is-coin">Открыть →</span>
      </Link></li> : quests.length > 0 && <li><Link hideWhenDenied className={`home-today__row${answered >= quests.length ? " is-done" : ""}`} to={`${CITY_PATH}?open=quests`}>
        <span><strong>{answered >= quests.length ? "Ситуации дня отвечены" : `Ситуации дня · ${answered} из ${quests.length}`}</strong>
          <small>{answered >= quests.length ? "Новые — завтра" : chest ? "Ответьте на все — откроется сундук дня" : "Засчитывается каждый ответ"}</small></span>
        <span className="home-today__value is-coin">{answered >= quests.length ? "✓" : data?.quests && data.quests.coins > 0 ? `+${coins(data.quests.coins)} ${plural(data.quests.coins, "коин", "коина", "коинов")}` : "Ответить →"}</span>
      </Link></li>}
      {mission && <li><Link hideWhenDenied className="home-today__row" to={missionTo}>
        <span><strong>{mission.state === "ready" && canReward ? "Миссия готова" : mission.state === "in_progress" ? "Продолжить миссию" : "Новая миссия"}</strong>
          <small>{mission.title}{mission.state === "in_progress" && mission.target > 0 ? ` · ${coins(Math.min(mission.current, mission.target))} из ${coins(mission.target)}` : ""}</small></span>
        <span className="home-today__value is-xp">{mission.state === "ready" && canReward && reward ? reward : "Открыть →"}</span>
      </Link></li>}
      {balance && <li id="wallet"><Link hideWhenDenied className="home-today__row" to="/shop">
        <span><strong>На счету {coins(balance.available)} {plural(balance.available, "коин", "коина", "коинов")}</strong>
          <small>{balance.reserved > 0 ? `Ещё ${coins(balance.reserved)} в резерве на покупки` : "Обменивайте на награды в магазине"}</small></span>
        <span className="home-today__value">Магазин →</span>
      </Link></li>}
    </ul>
  </Card>;
}
