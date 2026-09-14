import { useQuery } from "@tanstack/react-query";
import { AccessLink as Link } from "../components/AccessLink";
import { cabinet } from "../api/endpoints";
import { progressApi } from "../api/progress";
import { CoinIcon, MedalIcon, SparkIcon } from "../components/icons";
import { Card, Delta, ErrorState, Progress, RowsSkeleton, Skeleton } from "../components/ui";
import { coins } from "../utils/format";
import { WeekMetricsCard } from "./WeekMetricsCard";
import "./cabinet.css";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export function CabinetPage() {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard() });

  if (dashboard.isLoading) {
    return (
      <div className="page-skeleton">
        <Skeleton height={36} width="40%" radius="var(--radius-s)" />
        <Skeleton height={180} radius="var(--radius-xl)" />
        <Skeleton height={150} />
      </div>
    );
  }

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  }

  const data = dashboard.data!;
  const { balance, week } = data;
  const firstName = data.full_name.trim().split(/\s+/)[0];

  return (
    <div className="stack cabinet-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Мой кабинет</h1>
          <p className="page-subtitle">
            {data.full_name}
            {data.group_name ? ` · ${data.group_name}` : ""}
          </p>
        </div>
      </div>

      <Hero greetingName={firstName} balance={balance} />
      <WeekMetricsCard week={week} />
      <BadgesCard />
    </div>
  );
}

function Hero({
  greetingName,
  balance,
}: {
  greetingName: string;
  balance: import("../api/types").BalanceBlock;
}) {
  const progress = useQuery({ queryKey: ["coin-progress", "me"], queryFn: () => progressApi.summary() });
  return (
    <section className="hero">
      <p className="hero__greeting">
        {greeting()}, {greetingName}
      </p>

      {progress.isLoading && <Skeleton height={150} />}
      {progress.isError && <ErrorState error={progress.error} onRetry={() => progress.refetch()} />}
      {progress.data && <div className="level">
        <Link className="level__title" to="/progress"><SparkIcon size={20} />{progress.data.current?.title ?? "Ваш путь в Puls"}</Link>
        <div className="hero__balance"><span className="hero__amount">{coins(progress.data.total)}</span><span className="hero__coin-unit">коинов заработано</span></div>
        <Progress value={progress.data.progress} tone="accent" label="До следующего уровня" />
        <p className="level__hint">{progress.data.next ? `${coins(progress.data.remaining)} коинов до уровня «${progress.data.next.title}»` : progress.data.current ? "Высший уровень достигнут" : "Уровни ещё не настроены"}</p>
      </div>}
      <div className="hero__stats">
        <div className="hero__stat"><span className="hero__stat-label">Кошелёк</span><Link className="hero__stat-value" to="/wallet"><CoinIcon size={18} />{coins(balance.available)}</Link></div>
        <div className="hero__stat">
          <span className="hero__stat-label">Место</span>
          <span className="hero__stat-value">
            {balance.rank ? `#${balance.rank}` : "—"}
            {balance.rank_delta !== null && balance.rank_delta !== 0 && (
              <Delta value={balance.rank_delta} />
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

function BadgesCard() {
  const badges = useQuery({ queryKey: ["badges"], queryFn: cabinet.badges });

  return (
    <Card title="Мои достижения">
      {badges.isLoading && <RowsSkeleton rows={3} />}
      {badges.isError && <ErrorState error={badges.error} onRetry={() => badges.refetch()} />}
      {badges.data && (
        <ul className="badges-list">
          {badges.data.map((badge) => (
            <li
              key={badge.code}
              className={badge.unlocked ? "badge-card is-unlocked" : "badge-card"}
            >
              <span className="badge-card__icon">
                {badge.unlocked ? <MedalIcon size={20} /> : <SparkIcon size={20} />}
              </span>
              <div className="badge-card__text">
                <span className="badge-card__title">{badge.title}</span>
                <span className="badge-card__hint">{badge.hint || badge.description}</span>
                {badge.coins_reward > 0 && <span className="badge-card__hint">{badge.unlocked ? badge.coins_awarded > 0 ? `Начислено: ${badge.coins_awarded} коинов` : "Достижение получено" : `Награда: ${badge.coins_reward} коинов один раз`}</span>}
                {/* Заблокированный бейдж показывает критерий, а не серую заглушку. */}
                {!badge.unlocked && badge.progress_target > 0 && (
                  <Progress value={badge.progress_percent / 100} size="s" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
