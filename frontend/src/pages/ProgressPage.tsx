import { useQuery } from "@tanstack/react-query";
import { cabinet } from "../api/endpoints";
import { CoinProgress } from "../components/CoinProgress";
import { Skeleton } from "../components/ui";
import { WeekMetricsCard } from "./WeekMetricsCard";

export function ProgressPage() {
  // The week in detail lives here: the home shows the race, «Мой прогресс» how its points become coins.
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard() });
  return <div className="stack coin-progress-page">
    <header className="page-head"><div><h1 className="page-title">Мой прогресс</h1><p className="page-subtitle">Показатели недели, уровень и достижения: как работа становится коинами.</p></div></header>
    {dashboard.isPending && <Skeleton height={220} radius="var(--radius-xl)" />}
    {dashboard.data && <WeekMetricsCard week={dashboard.data.week} />}
    <CoinProgress showDetails />
  </div>;
}
