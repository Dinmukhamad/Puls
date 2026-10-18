import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { city, type CityData, type CityMission } from "../api/city";
import { economy } from "../api/economy";
import { cabinet, rating } from "../api/endpoints";
import { games } from "../api/games";
import type { BalanceBlock, RaceOut } from "../api/types";
import { useAccess } from "../auth/AccessContext";
import { AccessLink as Link } from "../components/AccessLink";
import { Card, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { weekRange } from "../components/weekCalendar";
import { coins, plural } from "../utils/format";
import { pointsLabel, RaceAdvice, RaceHero, RaceTable } from "./RacePage";
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

const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The line under «Ваше место»: which week the places come from. Until this week's metrics are loaded the race shows the
 * latest calculated week, and the home says so instead of passing an old week off as the current one.
 */
export function weekCaption(data: Pick<RaceOut, "week" | "live">, today = dateKey()): string {
  const week = data.week;
  if (!week) return "";
  if (week.ends_on < today) return `Последняя рассчитанная неделя: ${weekRange(week)}. Показатели этой недели ещё не загружены`;
  return `Гонка недели · ${weekRange(week)} · ${data.live ? "места по загруженным показателям" : week.status === "closed" ? "итог опубликован" : "предварительный расчёт"}`;
}

/**
 * The operator's home (docs/OPERATOR_HOME.md), built from the site's own blocks: the place and gaps of «Гонка недели»,
 * what to improve, the table around you, and beside them the month's contest and what can be done today.
 */
export function CabinetPage() {
  // The same keys as «Гонка недели» and «Конкурс месяца»: opening them after the home reads the cache.
  const race = useQuery({ queryKey: ["race", undefined], queryFn: () => rating.race() });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard() });
  const name = dashboard.data?.full_name.trim().split(/\s+/)[0];
  const group = dashboard.data?.group_name;
  const data = race.data;
  return <div className="stack home-race" data-tour="home">
    <header className="page-head"><div>
      <h1 className="page-title">Мой кабинет</h1>
      <p className="page-subtitle">{greeting()}{name ? `, ${name}` : ""}{group ? ` · ${group}` : ""}</p>
    </div></header>
    <div className="home-grid">
      <div className="home-main">
        <div className="home-slot home-slot--hero" data-tour="home-race">
          {race.isLoading ? <Skeleton height={240} radius="var(--radius-xl)" />
            : race.isError ? <ErrorState error={race.error} onRetry={() => race.refetch()} />
            : !data?.week ? <Card title="Ваше место" variant="highlight"><EmptyState title="Гонка ещё не началась" hint="Места появятся, когда загрузят показатели недели" /></Card>
            : <RaceHero data={data} subtitle={weekCaption(data)} action={<Link hideWhenDenied className="home-link" to="/race">Гонка недели →</Link>} />}
        </div>
        {data?.week && data.me && data.advice && <div className="home-slot home-slot--advice" data-tour="home-moves"><RaceAdvice data={data} compact /></div>}
        {data?.week && data.standings.length > 0 && <div className="home-slot home-slot--table"><RaceTable data={data} /></div>}
      </div>
      <aside className="home-side" aria-label="Месяц и сегодня">
        {data?.period !== "week" && <div className="home-slot home-slot--month"><MonthCard /></div>}
        <div className="home-slot home-slot--today"><TodayCard balance={dashboard.data?.balance} /></div>
      </aside>
    </div>
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
    </div> : <p className="secondary home-month__empty">{data.standings.length ? "Вас пока нет в таблице месяца: она считается по закрытым неделям." : "Итогов месяца пока нет: места появятся после первой закрытой недели."}</p>}
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
  return <Card className="home-today" tour="home-today" title="Сегодня" action={<Link hideWhenDenied className="home-link" to="/wallet">История коинов →</Link>}>
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
