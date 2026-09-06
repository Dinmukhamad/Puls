import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, downloadFile } from "../api/client";
import { admin, rating } from "../api/endpoints";
import type { OperatorRowOut } from "../api/types";
import { ManualCoinsSheet } from "../components/ManualCoinsSheet";
import { useToast } from "../components/Toast";
import { DownloadIcon, SearchIcon } from "../components/icons";
import { GlassSurface } from "../components/GlassSurface";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KPI,
  KPISkeleton,
  Pagination,
  RowsSkeleton,
  StatusIcon,
} from "../components/ui";
import { WEEK_STATUS_LABELS, coins, points } from "../utils/format";

export function AdminOperatorsPage() {
  const toast = useToast();
  const [weekId, setWeekId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<OperatorRowOut | null>(null);
  const size = 25;

  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks() });
  const summary = useQuery({
    queryKey: ["admin-summary", weekId],
    queryFn: () => admin.summary(weekId),
  });
  const operators = useQuery({
    queryKey: ["admin-operators", weekId, page, search],
    queryFn: () => admin.operators({ week_id: weekId, page, size, search: search || undefined }),
  });

  async function exportCsv() {
    try {
      await downloadFile(admin.exportPath(weekId), `operators_${weekId ?? "current"}.csv`);
      toast.success("Файл выгружен");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Не удалось выгрузить файл");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Операторы</h1>
          <p className="page-subtitle">Показатели недели, балансы и ручное начисление коинов</p>
        </div>
        <div className="page-head__actions">
          <Button icon={<DownloadIcon size={17} />} onClick={exportCsv}>
            Выгрузить CSV
          </Button>
        </div>
      </div>

      <GlassSurface variant="regular" className="filterbar">
        <label className="search">
          <span className="search__icon">
            <SearchIcon size={16} />
          </span>
          <input
            className="input input--s"
            style={{ width: 220 }}
            placeholder="Найти оператора"
            value={search}
            aria-label="Поиск по ФИО"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <span className="filterbar__spacer" />
        <select
          className="input input--s"
          aria-label="Неделя"
          value={weekId ?? ""}
          onChange={(event) => {
            setWeekId(event.target.value ? Number(event.target.value) : undefined);
            setPage(1);
          }}
        >
          <option value="">Последняя рассчитанная</option>
          {(weeks.data ?? []).map((week) => (
            <option key={week.id} value={week.id}>
              {week.label} · {WEEK_STATUS_LABELS[week.status] ?? week.status}
            </option>
          ))}
        </select>
      </GlassSurface>

      {/* Сводная статистика - п. 4.4.1 бизнес-ТЗ */}
      {summary.isLoading && <KPISkeleton />}
      {summary.data && (
        <div className="kpi-grid">
          <KPI
            label="Операторов"
            value={coins(summary.data.operators_total)}
            hint={`Активных ${summary.data.operators_active}`}
          />
          <KPI
            label="Начислено за неделю"
            value={coins(summary.data.coins_awarded_this_week)}
            tone="coin"
            hint="Все положительные операции за 7 дней"
          />
          <KPI
            label="Новых заявок"
            value={coins(summary.data.new_shop_requests)}
            tone={summary.data.new_shop_requests > 0 ? "accent" : "neutral"}
            hint="Ожидают решения"
          />
          <KPI
            label="Средняя позиция"
            value={summary.data.average_rank !== null ? summary.data.average_rank.toFixed(1) : "—"}
            hint={summary.data.week_label ? `Неделя ${summary.data.week_label}` : undefined}
          />
        </div>
      )}

      <Card title="Таблица операторов" padded={false}>
        {operators.isLoading && (
          <div className="card__body">
            <RowsSkeleton />
          </div>
        )}
        {operators.isError && (
          <div className="card__body">
            <ErrorState error={operators.error} onRetry={() => operators.refetch()} />
          </div>
        )}
        {operators.data && operators.data.items.length === 0 && (
          <EmptyState title="Ничего не найдено" hint="Измените фильтры или поисковый запрос" />
        )}

        {operators.data && operators.data.items.length > 0 && (
          <>
            <div className="table-wrap table-wrap--responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Место</th>
                    <th>Оператор</th>
                    <th>Группа</th>
                    <th className="num">Баллы</th>
                    <th className="num">Коины</th>
                    <th className="num">Баланс</th>
                    <th className="num">Опоздания</th>
                    <th className="num">Сайты</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {operators.data.items.map((row) => (
                    <tr key={row.user_id}>
                      <td className="num">
                        <span className="rank-badge">{row.rank ?? "—"}</span>
                      </td>
                      <td>
                        <span className="cell-person">
                          <Avatar name={row.full_name} id={row.user_id} size={32} />
                          <span className="cell-person__text">
                            <span className="cell-person__name">{row.full_name}</span>
                            <span className="cell-person__meta">{row.login}</span>
                          </span>
                        </span>
                      </td>
                      <td className="muted">{row.group_name ?? "—"}</td>
                      <td className="num">{points(row.points)}</td>
                      <td className="num">{coins(row.coins_week)}</td>
                      <td className="num">
                        {coins(row.balance)}
                        {row.reserved > 0 && (
                          <span className="muted micro block">резерв {coins(row.reserved)}</span>
                        )}
                      </td>
                      <AntiCell value={row.lateness} />
                      <AntiCell value={row.forbidden_sites} />
                      <td className="cell-actions">
                        <Button size="s" onClick={() => setTarget(row)}>
                          Начислить
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card__body">
              <ul className="card-list">
                {operators.data.items.map((row) => (
                  <li key={row.user_id} className="list-card">
                    <div className="list-card__head">
                      <span className="cell-person">
                        <Avatar name={row.full_name} id={row.user_id} size={36} />
                        <span className="cell-person__text">
                          <span className="cell-person__name">{row.full_name}</span>
                          <span className="cell-person__meta">
                            {row.group_name ?? row.login}
                          </span>
                        </span>
                      </span>
                      <span className="rank-badge">{row.rank ?? "—"}</span>
                    </div>
                    <div className="list-card__metrics">
                      <span className="list-card__metric">
                        <span>Баллы</span>
                        <span>{points(row.points)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Баланс</span>
                        <span>{coins(row.balance)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Опоздания</span>
                        <span>{row.lateness === 0 ? "нет" : points(row.lateness)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Сайты</span>
                        <span>
                          {row.forbidden_sites === 0 ? "нет" : points(row.forbidden_sites)}
                        </span>
                      </span>
                    </div>
                    <Button size="s" block onClick={() => setTarget(row)}>
                      Начислить коины
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card__body--flush">
              <Pagination
                page={page}
                size={size}
                total={operators.data.total}
                onChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      {target && <ManualCoinsSheet operator={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

/** Антипоказатель: ноль помечен галочкой, нарушения — значком и цветом. */
function AntiCell({ value }: { value: number }) {
  return (
    <td className="num">
      <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
        <StatusIcon ok={value === 0} />
        <span className={value === 0 ? "muted" : undefined}>
          {value === 0 ? "нет" : points(value)}
        </span>
      </span>
    </td>
  );
}
