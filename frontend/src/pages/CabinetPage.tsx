import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { cabinet } from "../api/endpoints";
import type { BadgeOut } from "../api/types";
import { progressApi } from "../api/progress";
import { MedalIcon, SparkIcon } from "../components/icons";
import { Button, Card, Delta, ErrorState, Progress, RowsSkeleton, Skeleton } from "../components/ui";
import { coins } from "../utils/format";
import { WeekMetricsCard } from "./WeekMetricsCard";
import { RecentTransactions, WalletCard } from "./CabinetWallet";
import { CabinetLearning } from "./CabinetLearning";
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

      <p className="cabinet-greeting">{greeting()}, {firstName}. Каждый шаг — ваш прогресс.</p>
      <div className="cabinet-overview">
        <ProgressCard balance={balance} />
        <WalletCard balance={balance} />
      </div>
      <div className="cabinet-activity">
        <RecentTransactions />
        <CabinetLearning />
      </div>
      <WeekMetricsCard week={week} />
      <BadgesCard />
    </div>
  );
}

function ProgressCard({ balance }: {
  balance: import("../api/types").BalanceBlock;
}) {
  const progress = useQuery({ queryKey: ["coin-progress", "me"], queryFn: () => progressApi.summary() });
  return (
    <Card title="Мой прогресс" className="cabinet-progress" tour="cabinet-progress" action={<Link hideWhenDenied className="cabinet-text-link" to="/progress">Подробнее →</Link>}>
      {progress.isLoading && <Skeleton height={150} />}
      {progress.isError && <ErrorState error={progress.error} onRetry={() => progress.refetch()} />}
      {progress.data && <div className="cabinet-progress__content">
        <div className="cabinet-progress__heading">
          <div className="cabinet-progress__level"><span className="cabinet-progress__icon"><SparkIcon size={24} /></span><div><p className="small secondary">{progress.data.current ? `Уровень ${progress.data.level_number}` : "Ваш путь в Puls"}</p><h3>{progress.data.current?.title ?? "Начало пути"}</h3></div></div>
          <div className="cabinet-progress__earned"><strong>{coins(progress.data.total)}</strong><span>коинов за всё время</span></div>
        </div>
        <Progress value={progress.data.progress} tone="accent" label="До следующего уровня" />
        <p className="level__hint">{progress.data.next ? `${coins(progress.data.remaining)} коинов до уровня «${progress.data.next.title}»` : progress.data.current ? "Высший уровень достигнут" : "Уровни ещё не настроены"}</p>
        <p className="small secondary">Покупки не уменьшают уровень. Возвраты не прибавляют прогресс.</p>
      </div>}
      <div className="cabinet-progress__stats">
        <div><span className="small secondary">Заработано за неделю</span><strong>{coins(balance.earned_this_week ?? 0)} <span className="small secondary">коинов</span></strong></div>
        <div>
          <span className="small secondary">Место в недельном рейтинге</span>
          <strong>
            {balance.rank ? `#${balance.rank}` : "—"}
            {balance.rank_delta !== null && balance.rank_delta !== 0 && (
              <Delta value={balance.rank_delta} />
            )}
          </strong>
          {balance.rank ? <Link className="small cabinet-progress__race" to="/race">Гонка недели →</Link> : null}
        </div>
      </div>
    </Card>
  );
}

/** How many achievements the cabinet shows before the full list is expanded. */
export const NEAREST_BADGES = 3;

/**
 * The achievements an operator is closest to: the largest share of the
 * condition already done goes first. Achievements without a measurable
 * condition (a place in the rating) have no share and come last; equal
 * shares keep the server order.
 */
export function nearestBadges(badges: BadgeOut[], count = NEAREST_BADGES): BadgeOut[] {
  return badges
    .map((badge, index) => ({ badge, index, share: badge.progress_target > 0 ? badge.progress_percent : -1 }))
    .filter(({ badge }) => !badge.unlocked)
    .sort((a, b) => b.share - a.share || a.index - b.index)
    .slice(0, count)
    .map(({ badge }) => badge);
}

function BadgeItem({ badge }: { badge: BadgeOut }) {
  return (
    <li className={badge.unlocked ? "badge-card is-unlocked" : "badge-card"}>
      <span className="badge-card__icon">
        {badge.unlocked ? <MedalIcon size={20} /> : <SparkIcon size={20} />}
      </span>
      <div className="badge-card__text">
        <span className="badge-card__title">{badge.title}</span>
        <span className="badge-card__hint">{badge.hint || badge.description}</span>
        {badge.coins_reward > 0 && <span className="badge-card__hint">{badge.unlocked ? badge.coins_awarded > 0 ? `Начислено: ${badge.coins_awarded} коинов` : "Достижение получено" : `Награда: ${badge.coins_reward} коинов один раз`}</span>}
        {/* Заблокированный бейдж показывает критерий, а не серую заглушку. */}
        {!badge.unlocked && badge.progress_target > 0 && (
          <Progress value={badge.progress_percent / 100} size="s" label={`Прогресс: ${badge.title}`} />
        )}
      </div>
      {!badge.unlocked && badge.progress_target > 0 && <span className="badge-card__percent">{Math.round(badge.progress_percent)}%</span>}
    </li>
  );
}

function BadgesCard() {
  const badges = useQuery({ queryKey: ["badges"], queryFn: cabinet.badges });
  const [expanded, setExpanded] = useState(false);
  const all = badges.data ?? [];
  const nearest = nearestBadges(all);
  const unlocked = all.filter((badge) => badge.unlocked).length;
  const hidden = all.length - nearest.length;
  const listId = "cabinet-badges-all";

  return (
    <Card
      title="Мои достижения"
      subtitle={badges.data ? `Получено ${unlocked} из ${all.length}${nearest.length ? " · ближе всего к получению" : ""}` : undefined}
      action={hidden > 0 ? <Button size="s" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} onClick={() => setExpanded((value) => !value)}>{expanded ? "Свернуть" : `Все достижения · ${all.length}`}</Button> : undefined}
    >
      {badges.isLoading && <RowsSkeleton rows={3} />}
      {badges.isError && <ErrorState error={badges.error} onRetry={() => badges.refetch()} />}
      {badges.data && !expanded && (nearest.length
        ? <ul className="badges-list">{nearest.map((badge) => <BadgeItem key={badge.code} badge={badge} />)}</ul>
        : <p className="small secondary">{all.length ? "Все достижения получены. Отличная работа!" : "Достижения ещё не настроены."}</p>)}
      {badges.data && expanded && <ul className="badges-list" id={listId}>{all.map((badge) => <BadgeItem key={badge.code} badge={badge} />)}</ul>}
    </Card>
  );
}
