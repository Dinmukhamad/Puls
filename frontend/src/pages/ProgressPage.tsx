import { CoinProgress } from "../components/CoinProgress";

export function ProgressPage() {
  return <div className="stack coin-progress-page">
    <header className="page-head"><div><h1 className="page-title">Мой прогресс</h1><p className="page-subtitle">Зарабатывайте коины, повышайте уровень и получайте достижения.</p></div></header>
    <CoinProgress showDetails />
  </div>;
}
