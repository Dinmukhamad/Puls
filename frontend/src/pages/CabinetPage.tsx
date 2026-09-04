import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { cabinet } from "../api/endpoints";
import type { MetricProgress, NominationBrief, WeekMetricsBlock } from "../api/types";
import {
  AlertIcon,
  CoinIcon,
  MedalIcon,
  SparkIcon,
  StoreIcon,
  TrophyIcon,
} from "../components/icons";
import {
  Badge,
  Button,
  Card,
  CoinAmount,
  Delta,
  EmptyState,
  ErrorState,
  KPI,
  KPISkeleton,
  Pagination,
  Progress,
  RowsSkeleton,
  SegmentedControl,
  Skeleton,
  StatusIcon,
} from "../components/ui";
import {
  TX_LABELS,
  coins,
  dateTime,
  percent,
  periodLabel,
  points,
  signed,
} from "../utils/format";

type HistoryKind = "" | "accrual" | "writeoff" | "purchase";

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
        <KPISkeleton />
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
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Мой кабинет</h1>
          <p className="page-subtitle">
            {data.full_name}
            {data.group_name ? ` · ${data.group_name}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid--2-1">
        <Hero
          greetingName={firstName}
          balance={balance}
          week={week}
          nominations={data.my_nominations}
        />
        <QuickActions available={balance.available} pending={data.pending_shop_requests} />
      </div>

      {/* Блок «Мой баланс» - п. 4.1.1 бизнес-ТЗ */}
      <div className="kpi-grid">
        <KPI
          label="Начислено за неделю"
          value={signed(balance.earned_this_week)}
          hint={week.week_label ? `Неделя ${week.week_label}` : undefined}
        />
        <KPI
          label="Место в рейтинге"
          value={balance.rank ? `#${balance.rank}` : "—"}
          delta={balance.rank_delta}
          deltaLabel="к прошлой неделе"
          hint={balance.participants ? `из ${balance.participants} участников` : undefined}
        />
        <KPI
          label="Всего начислено"
          value={coins(balance.total_earned)}
          hint={`Потрачено ${coins(balance.total_spent)}`}
        />
        <KPI
          label="Достижения"
          value={`${data.badges_unlocked}`}
          unit={`из ${data.badges_total}`}
          hint="Открыто бейджей"
        />
      </div>

      <div className="grid grid--2-1">
        <WeekMetricsCard week={week} />
        <div className="stack stack--tight">
          <WeekCoinsCard week={week} />
          <BadgesCard />
        </div>
      </div>

      <HistoryCard />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Ведущий блок кабинета. Ровно одна крупная цифра на экране - баланс.
 * -------------------------------------------------------------------------- */

function Hero({
  greetingName,
  balance,
  week,
  nominations,
}: {
  greetingName: string;
  balance: import("../api/types").BalanceBlock;
  week: WeekMetricsBlock;
  nominations: NominationBrief[];
}) {
  return (
    <section className="hero">
      <p className="hero__greeting">
        {greeting()}, {greetingName}
      </p>

      <div className="hero__balance">
        <span className="hero__amount">{coins(balance.balance)}</span>
        <span className="hero__coin" aria-hidden="true" />
      </div>
      <p className="hero__caption">
        {balance.reserved > 0
          ? `${coins(balance.reserved)} зарезервировано под заявки · доступно ${coins(balance.available)}`
          : "Коины не сгорают и копятся без ограничения срока"}
      </p>

      <div className="hero__stats">
        <div className="hero__stat">
          <span className="hero__stat-label">Место</span>
          <span className="hero__stat-value">
            {balance.rank ? `#${balance.rank}` : "—"}
            {balance.rank_delta !== null && balance.rank_delta !== 0 && (
              <Delta value={balance.rank_delta} />
            )}
          </span>
        </div>
        <div className="hero__stat">
          <span className="hero__stat-label">За неделю</span>
          <span className="hero__stat-value">{signed(balance.earned_this_week)}</span>
        </div>
        <div className="hero__stat">
          <span className="hero__stat-label">Итог недели</span>
          <span className="hero__stat-value">
            {points(week.final_points)}
            <span className="muted small">баллов</span>
          </span>
        </div>
        {nominations.length > 0 && (
          <div className="hero__stat">
            <span className="hero__stat-label">Номинации</span>
            <span className="hero__stat-value">
              <MedalIcon size={18} />
              {nominations.length}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function QuickActions({ available, pending }: { available: number; pending: number }) {
  const navigate = useNavigate();
  return (
    <Card title="Быстрые действия">
      <div className="quick-actions">
        <button type="button" className="quick-action" onClick={() => navigate("/shop")}>
          <span className="quick-action__icon">
            <StoreIcon size={20} />
          </span>
          <span className="quick-action__text">
            <span className="quick-action__title">Магазин бонусов</span>
            <span className="quick-action__hint">Доступно {coins(available)} коинов</span>
          </span>
        </button>

        <button type="button" className="quick-action" onClick={() => navigate("/rating")}>
          <span className="quick-action__icon">
            <TrophyIcon size={20} />
          </span>
          <span className="quick-action__text">
            <span className="quick-action__title">Рейтинг недели</span>
            <span className="quick-action__hint">Пьедестал и номинации</span>
          </span>
        </button>

        {pending > 0 && (
          <button type="button" className="quick-action" onClick={() => navigate("/shop")}>
            <span className="quick-action__icon">
              <CoinIcon size={20} />
            </span>
            <span className="quick-action__text">
              <span className="quick-action__title">Заявки на рассмотрении</span>
              <span className="quick-action__hint">{pending} шт. ждут решения</span>
            </span>
          </button>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Показатели недели - п. 4.1.2 бизнес-ТЗ
 * -------------------------------------------------------------------------- */

function WeekMetricsCard({ week }: { week: WeekMetricsBlock }) {
  if (!week.week_id) {
    return (
      <Card title="Показатели недели">
        <EmptyState
          title="Неделя ещё не заведена"
          hint="Данные появятся после выгрузки показателей"
        />
      </Card>
    );
  }

  const positive = week.metrics.filter((metric) => metric.kind === "positive");
  const anti = week.metrics.filter((metric) => metric.kind === "anti");

  return (
    <Card
      title="Показатели недели"
      subtitle={
        week.starts_on && week.ends_on ? periodLabel(week.starts_on, week.ends_on) : undefined
      }
      action={
        <Badge tone={week.is_final ? "success" : "accent"} dot>
          {week.is_final ? "Итог подведён" : "Неделя идёт"}
        </Badge>
      }
    >
      {positive.length === 0 && anti.length === 0 ? (
        <EmptyState title="Показатели за эту неделю ещё не выгружены" />
      ) : (
        <>
          <ul className="metrics">
            {positive.map((metric) => (
              <MetricRow key={metric.code} metric={metric} />
            ))}
          </ul>

          {anti.length > 0 && (
            <>
              <h3 className="group-title">Антипоказатели</h3>
              <p className="group-note">Снижают итоговый балл до перевода в коины</p>
              <ul className="metrics stack--tight">
                {anti.map((metric) => (
                  <AntiMetricRow key={metric.code} metric={metric} />
                ))}
              </ul>
            </>
          )}

          <div className="totals">
            <div className="totals__row">
              <span>Баллы за показатели</span>
              <strong>{points(week.base_points)}</strong>
            </div>
            {week.penalty_points > 0 && (
              <div className="totals__row totals__row--penalty">
                <span>
                  <AlertIcon size={15} />
                  Штраф за антипоказатели
                </span>
                <strong>−{points(week.penalty_points)}</strong>
              </div>
            )}
            <div className="totals__row totals__row--final">
              <span>Итоговый балл</span>
              <strong>{points(week.final_points)}</strong>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function MetricRow({ metric }: { metric: MetricProgress }) {
  const unit = metric.unit ? ` ${metric.unit}` : "";
  // Приближение к плану окрашивает шкалу: заполнено, но ещё не дотянуто.
  const tone = metric.completion >= 0.95 ? "success" : metric.completion >= 0.7 ? "accent" : "warning";

  return (
    <li className="metric">
      <div className="metric__head">
        <span className="metric__title">{metric.title}</span>
        <span className="metric__value">
          {points(metric.value)}
          {unit}
          <span className="metric__target">
            {" "}
            из {points(metric.target)}
            {unit}
          </span>
        </span>
      </div>
      <Progress value={metric.completion} tone={tone} label={metric.title} />
      <div className="metric__foot">
        <span>{percent(metric.completion)} плана</span>
        <span>
          {points(metric.points)} из {points(metric.max_points)} баллов
        </span>
      </div>
    </li>
  );
}

function AntiMetricRow({ metric }: { metric: MetricProgress }) {
  const clean = metric.value === 0;
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return (
    <li className="metric metric--anti">
      <span className="metric__title">
        {/* Значок и подпись дублируют цвет: красный и зелёный различимы не для всех. */}
        <StatusIcon ok={clean} />
        {metric.title}
      </span>
      <span className="metric__value">
        {clean ? (
          <span className="secondary">Нарушений нет</span>
        ) : (
          <>
            {points(metric.value)}
            {unit}
            <span className="metric__target"> · штраф −{points(metric.penalty)}</span>
          </>
        )}
      </span>
    </li>
  );
}

/* --------------------------------------------------------------------------
 * Из чего складываются коины недели
 * -------------------------------------------------------------------------- */

function WeekCoinsCard({ week }: { week: WeekMetricsBlock }) {
  const rows = [
    { label: "За баллы конкурса", value: week.coins_from_points },
    { label: "Призовое место", value: week.coins_rank_bonus },
    { label: "Дисциплина", value: week.coins_discipline_bonus },
    { label: "Номинации", value: week.coins_nomination_bonus },
  ].filter((row) => row.value > 0);

  const title = `${week.is_final ? "Итог недели" : "Ожидается за неделю"} ${week.week_label ?? ""}`.trim();

  return (
    <Card title={title}>
      {week.coins_total === 0 ? (
        <EmptyState title="Пока ноль коинов" hint="Показатели ещё набираются" />
      ) : (
        <>
          <CoinAmount value={week.coins_total} size="l" />
          <ul className="breakdown">
            {rows.map((row) => (
              <li key={row.label} className="breakdown__row">
                <span>{row.label}</span>
                <strong>{signed(row.value)}</strong>
              </li>
            ))}
          </ul>
          {!week.is_final && (
            <p className="muted micro">
              Значение предварительное: коины зачислятся после закрытия недели.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Достижения - п. 4.1.4 бизнес-ТЗ
 * -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
 * История операций - п. 4.1.3 бизнес-ТЗ
 * -------------------------------------------------------------------------- */

const KIND_OPTIONS: { value: HistoryKind; label: string }[] = [
  { value: "", label: "Все" },
  { value: "accrual", label: "Начисления" },
  { value: "writeoff", label: "Списания" },
  { value: "purchase", label: "Покупки" },
];

function HistoryCard() {
  const [kind, setKind] = useState<HistoryKind>("");
  const [page, setPage] = useState(1);
  const size = 12;

  const history = useQuery({
    queryKey: ["transactions", kind, page],
    queryFn: () => cabinet.transactions({ kind: kind || undefined, page, size }),
  });

  return (
    <Card
      title="История операций"
      action={
        <SegmentedControl
          options={KIND_OPTIONS}
          value={kind}
          label="Тип операции"
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
        />
      }
      padded={false}
    >
      {history.isLoading && (
        <div className="card__body">
          <RowsSkeleton />
        </div>
      )}
      {history.isError && (
        <div className="card__body">
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        </div>
      )}

      {history.data && history.data.items.length === 0 && (
        <EmptyState
          title="Операций за выбранный период нет"
          hint="Измените фильтр или дождитесь итогов недели"
          action={
            kind ? (
              <Button onClick={() => setKind("")}>Показать все</Button>
            ) : undefined
          }
        />
      )}

      {history.data && history.data.items.length > 0 && (
        <>
          <div className="table-wrap table-wrap--responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Операция</th>
                  <th>Причина</th>
                  <th>Автор</th>
                  <th className="num">Коины</th>
                  <th className="num">Баланс</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((tx) => (
                  <tr key={tx.id}>
                    <td className="nowrap secondary">{dateTime(tx.created_at)}</td>
                    <td>{TX_LABELS[tx.tx_type] ?? tx.tx_type}</td>
                    <td className="secondary">{tx.reason}</td>
                    <td className="muted">{tx.author_name ?? "Система"}</td>
                    <td className="num">
                      <CoinAmount value={tx.amount} signed />
                    </td>
                    <td className="num muted">{coins(tx.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* На телефоне таблица превращается в список карточек. */}
          <div className="card__body">
            <ul className="card-list">
              {history.data.items.map((tx) => (
                <li key={tx.id} className="list-card">
                  <div className="list-card__head">
                    <span className="cell-person__text">
                      <span className="cell-person__name">
                        {TX_LABELS[tx.tx_type] ?? tx.tx_type}
                      </span>
                      <span className="cell-person__meta">{dateTime(tx.created_at)}</span>
                    </span>
                    <CoinAmount value={tx.amount} signed />
                  </div>
                  <p className="small secondary">{tx.reason}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="card__body--flush">
            <Pagination page={page} size={size} total={history.data.total} onChange={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}
