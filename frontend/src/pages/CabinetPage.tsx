import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { cabinet } from "../api/endpoints";
import type { MetricProgress, NominationBrief, WeekMetricsBlock } from "../api/types";
import {
  Card,
  CoinValue,
  EmptyState,
  ErrorState,
  Meter,
  Pagination,
  Pill,
  Spinner,
  StatTile,
} from "../components/ui";
import {
  TX_LABELS,
  coins,
  coinsWithUnit,
  dateTime,
  percent,
  periodLabel,
  points,
  signed,
} from "../utils/format";

type HistoryKind = "" | "accrual" | "writeoff" | "purchase";

export function CabinetPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => cabinet.dashboard(),
  });

  if (dashboard.isLoading) return <Spinner label="Загружаем кабинет" />;
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  }

  const data = dashboard.data!;
  const { balance, week } = data;

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
        <Link to="/shop" className="btn btn--primary">
          В магазин бонусов
        </Link>
      </div>

      {/* Блок «Мой баланс» - п. 4.1.1 ТЗ */}
      <div className="kpi">
        <StatTile
          hero
          label="Баланс коинов"
          value={coins(balance.balance)}
          hint={
            balance.reserved > 0
              ? `${coins(balance.reserved)} в резерве под заявки · доступно ${coins(balance.available)}`
              : "Коины не сгорают и копятся без ограничения срока"
          }
        />
        <StatTile
          label="Начислено за неделю"
          value={signed(balance.earned_this_week)}
          hint={week.week_label ? `Неделя ${week.week_label}` : undefined}
        />
        <StatTile
          label="Место в рейтинге"
          value={balance.rank ? `#${balance.rank}` : "—"}
          delta={balance.rank_delta}
          deltaLabel="к прошлой неделе"
          hint={balance.participants ? `из ${balance.participants} участников` : undefined}
        />
        <StatTile
          label="Всего начислено"
          value={coins(balance.total_earned)}
          hint={`Потрачено ${coinsWithUnit(balance.total_spent)}`}
        />
      </div>

      <div className="grid grid--2-1">
        <WeekMetricsCard week={week} />
        <div className="stack">
          <WeekCoinsCard week={week} nominations={data.my_nominations} />
          <BadgesCard unlocked={data.badges_unlocked} total={data.badges_total} />
        </div>
      </div>

      <HistoryCard />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Блок «Показатели недели» - п. 4.1.2 ТЗ
 * -------------------------------------------------------------------------- */

function WeekMetricsCard({ week }: { week: WeekMetricsBlock }) {
  if (!week.week_id) {
    return (
      <Card title="Показатели недели">
        <EmptyState title="Неделя ещё не заведена" hint="Данные появятся после выгрузки показателей" />
      </Card>
    );
  }

  const positive = week.metrics.filter((metric) => metric.kind === "positive");
  const anti = week.metrics.filter((metric) => metric.kind === "anti");

  return (
    <Card
      title="Показатели недели"
      action={
        <div className="card__meta">
          {week.starts_on && week.ends_on && (
            <span className="muted">{periodLabel(week.starts_on, week.ends_on)}</span>
          )}
          <Pill tone={week.is_final ? "good" : "accent"}>
            {week.is_final ? "Итог подведён" : "Неделя идёт"}
          </Pill>
        </div>
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
              <h3 className="metrics__group">Антипоказатели</h3>
              <p className="metrics__note">
                Снижают итоговый балл до перевода в коины
              </p>
              <ul className="metrics">
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
                  <span className="icon-warn" aria-hidden="true">
                    !
                  </span>
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
      <Meter completion={metric.completion} />
      <div className="metric__foot">
        <span className="muted">{percent(metric.completion)} плана</span>
        <span className="muted">
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
      <div className="metric__head">
        <span className="metric__title">
          {/* Значок и подпись дублируют цвет: красный и зелёный различимы не для всех. */}
          <span className={clean ? "icon-ok" : "icon-warn"} aria-hidden="true">
            {clean ? "✓" : "!"}
          </span>
          {metric.title}
        </span>
        <span className={clean ? "metric__value metric__value--ok" : "metric__value metric__value--bad"}>
          {clean ? "Нарушений нет" : `${points(metric.value)}${unit}`}
        </span>
      </div>
      {!clean && <div className="metric__penalty">Штраф −{points(metric.penalty)} балла(ов)</div>}
    </li>
  );
}

/* --------------------------------------------------------------------------
 * Из чего сложатся коины за неделю
 * -------------------------------------------------------------------------- */

function WeekCoinsCard({
  week,
  nominations,
}: {
  week: WeekMetricsBlock;
  nominations: NominationBrief[];
}) {
  const rows = [
    { label: "За баллы конкурса", value: week.coins_from_points },
    { label: "Призовое место", value: week.coins_rank_bonus },
    { label: "Дисциплина", value: week.coins_discipline_bonus },
    { label: "Номинации", value: week.coins_nomination_bonus },
  ].filter((row) => row.value > 0);

  return (
    <Card
      title={`${week.is_final ? "Итог недели" : "Ожидается за неделю"} ${week.week_label ?? ""}`.trim()}
    >
      {week.coins_total === 0 ? (
        <EmptyState title="Пока ноль коинов" hint="Показатели ещё набираются" />
      ) : (
        <>
          <div className="coins-total">
            <CoinValue value={week.coins_total} />
          </div>
          <ul className="breakdown">
            {rows.map((row) => (
              <li key={row.label} className="breakdown__row">
                <span>{row.label}</span>
                <strong>{signed(row.value)}</strong>
              </li>
            ))}
          </ul>
          {!week.is_final && (
            <p className="muted small">
              Значение предварительное: коины зачислятся после закрытия недели.
            </p>
          )}
          {nominations.length > 0 && (
            <div className="nominations-mine">
              <h3 className="metrics__group">Мои номинации</h3>
              {nominations.map((nomination) => (
                <div key={nomination.code} className="nomination-chip">
                  <span aria-hidden="true">★</span>
                  {nomination.title}
                  <strong>{signed(nomination.coins_awarded)}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Блок «Мои достижения» - п. 4.1.4 ТЗ
 * -------------------------------------------------------------------------- */

function BadgesCard({ unlocked, total }: { unlocked: number; total: number }) {
  const badges = useQuery({ queryKey: ["badges"], queryFn: cabinet.badges });

  return (
    <Card title="Мои достижения" action={<span className="muted">{unlocked} из {total}</span>}>
      {badges.isLoading && <Spinner />}
      {badges.isError && <ErrorState error={badges.error} onRetry={() => badges.refetch()} />}
      {badges.data && (
        <ul className="badges">
          {badges.data.map((badge) => (
            <li key={badge.code} className={badge.unlocked ? "badge badge--on" : "badge"}>
              <span className="badge__icon" aria-hidden="true">
                {badge.unlocked ? "★" : "☆"}
              </span>
              <div className="badge__text">
                <span className="badge__title">{badge.title}</span>
                <span className="badge__hint">{badge.hint || badge.description}</span>
                {!badge.unlocked && badge.progress_target > 0 && (
                  <Meter completion={badge.progress_percent / 100} />
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
 * Блок «История начислений и списаний» - п. 4.1.3 ТЗ
 * -------------------------------------------------------------------------- */

const KIND_TABS: { value: HistoryKind; label: string }[] = [
  { value: "", label: "Все" },
  { value: "accrual", label: "Начисления" },
  { value: "writeoff", label: "Списания" },
  { value: "purchase", label: "Покупки" },
];

function HistoryCard() {
  const [kind, setKind] = useState<HistoryKind>("");
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const size = 15;
  const history = useQuery({
    queryKey: ["transactions", kind, page, from, to],
    queryFn: () =>
      cabinet.transactions({
        kind: kind || undefined,
        page,
        size,
        date_from: from ? `${from}T00:00:00` : undefined,
        date_to: to ? `${to}T23:59:59` : undefined,
      }),
  });

  return (
    <Card
      title="История операций"
      action={
        <div className="filters">
          <div className="tabs" role="tablist">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={kind === tab.value}
                className={kind === tab.value ? "tab tab--active" : "tab"}
                onClick={() => {
                  setKind(tab.value);
                  setPage(1);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            className="input input--sm"
            value={from}
            aria-label="Начало периода"
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
          <input
            type="date"
            className="input input--sm"
            value={to}
            aria-label="Конец периода"
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </div>
      }
      padded={false}
    >
      {history.isLoading && <div className="card__body"><Spinner /></div>}
      {history.isError && (
        <div className="card__body">
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        </div>
      )}
      {history.data && (
        <>
          {history.data.items.length === 0 ? (
            <div className="card__body">
              <EmptyState title="Операций за выбранный период нет" />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Операция</th>
                    <th>Причина</th>
                    <th>Автор</th>
                    <th className="num">Коины</th>
                    <th className="num">Баланс после</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((tx) => (
                    <tr key={tx.id}>
                      <td className="nowrap">{dateTime(tx.created_at)}</td>
                      <td>{TX_LABELS[tx.tx_type] ?? tx.tx_type}</td>
                      <td className="table__reason">{tx.reason}</td>
                      <td className="muted">{tx.author_name ?? "Система"}</td>
                      <td className="num">
                        <CoinValue value={tx.amount} signed />
                      </td>
                      <td className="num muted">{coins(tx.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card__body card__body--tight">
            <Pagination
              page={page}
              size={size}
              total={history.data.total}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </Card>
  );
}
