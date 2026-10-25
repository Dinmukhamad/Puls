import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useAccess } from "../auth/AccessContext";
import { ApiError, downloadFile } from "../api/client";
import { admin } from "../api/endpoints";
import type { Channel, OperatorRowOut } from "../api/types";
import { ManualCoinsSheet } from "../components/ManualCoinsSheet";
import { ViolationSheet } from "../components/ViolationSheet";
import { useToast } from "../components/Toast";
import { DownloadIcon, SearchIcon } from "../components/icons";
import { GlassSurface } from "../components/GlassSurface";
import { DateRangePicker, type DateRange } from "../components/DateRangePicker";
import { formatDateRange, todayDateKey, validDateRange } from "../components/dateRange";
import { calendarDate, dateKey, shiftDays } from "../components/weekCalendar";
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
  SegmentedControl,
  StatusIcon,
} from "../components/ui";
import { CHANNEL_LABELS, coins, points } from "../utils/format";
import { operatorCount, personSearch, teamTitles } from "./teamSection";
import "./operators.css";

export function AdminOperatorsPage() {
  const toast = useToast();
  const location = useLocation();
  const { can } = useAccess(); const { atLeast } = useAuth();
  const canOverview = can("overview");
  const canCredit = can("motivation") && atLeast("supervisor");
  // Foreign sites are recorded the moment a supervisor notices them (docs/CHANNELS.md).
  const canRecord = atLeast("supervisor") && (can("team") || can("motivation") || can("performance"));
  const [period, setPeriod] = useState<DateRange>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // The line and chats rank separately: «Все» lists the line first, then chats (docs/CHANNELS.md).
  const [channel, setChannel] = useState<Channel | "all">("all");
  const only = channel === "all" ? undefined : channel;
  const [target, setTarget] = useState<OperatorRowOut | null>(null);
  const [offender, setOffender] = useState<OperatorRowOut | null>(null);
  const size = 25;

  const summary = useQuery({
    queryKey: ["admin-summary", undefined, period],
    queryFn: () => admin.summary(undefined, period), enabled: canOverview,
  });
  const operators = useQuery({
    queryKey: ["admin-operators", undefined, page, search, period, only],
    queryFn: () => admin.operators({ page, size, search: search || undefined, ...period, channel: only }),
    enabled: !!period,
  });
  const defaultRange = summary.data?.date_from && summary.data.date_to
    ? { date_from: summary.data.date_from, date_to: summary.data.date_to }
    : undefined;
  const shownRange = period ?? defaultRange;
  useEffect(() => {
    if (period || (canOverview && !summary.data && !summary.isError)) return;
    if (validDateRange(defaultRange)) { setPeriod(defaultRange); return; }
    const today = todayDateKey();
    setPeriod({ date_from: dateKey(shiftDays(calendarDate(today)!, -6)), date_to: today });
  }, [period, canOverview, summary.data, summary.isError]);

  async function exportCsv() {
    try {
      const filename = period ? `operators_${period.date_from}_${period.date_to}.csv` : "operators_current.csv";
      await downloadFile(admin.exportPath(undefined, { ...period, search: search || undefined, channel: only }), filename);
      toast.success("Файл выгружен");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Не удалось выгрузить файл");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">{teamTitles().metrics}</h1>
          <p className="page-subtitle">Баллы, коины и нарушения операторов за период{canCredit ? " · ручное начисление коинов" : ""}{canRecord ? " · отметка посторонних сайтов" : ""}</p>
        </div>
        <div className="page-head__actions">
          {can("reports") && <Button icon={<DownloadIcon size={17} />} disabled={!period} onClick={exportCsv}>
            Выгрузить CSV
          </Button>}
        </div>
      </div>

      <GlassSurface variant="regular" className="filterbar operators-filter">
        <label className="search">
          <span className="search__icon">
            <SearchIcon size={16} />
          </span>
          <input
            className="input"
            placeholder="Найти оператора"
            value={search}
            aria-label="Поиск по ФИО"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <DateRangePicker value={period} defaultRange={defaultRange} loading={!period && summary.isLoading}
          onChange={(value) => { setPeriod(value); setPage(1); }} />
        <div className="operators-channel"><SegmentedControl label="Направление" value={channel}
          options={[{ value: "all", label: "Все" }, { value: "line", label: "Линия" }, { value: "chat", label: "Чаты" }]}
          onChange={(value) => { setChannel(value); setPage(1); }} /></div>
      </GlassSurface>
      {period && <p className="operators-period-note ui-note">
        Коины — за выбранные даты. Баллы, место и нарушения — по завершённым неделям,
        которые целиком входят в период. Место — внутри направления: у линии и у чатов свои.
        Баланс кошелька — текущий.
      </p>}

      {/* Сводная статистика - п. 4.4.1 бизнес-ТЗ */}
      {canOverview && (!period || summary.isLoading) && <KPISkeleton />}
      {period && summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      {period && summary.data && (
        <div className="kpi-grid">
          <KPI
            label="Операторов"
            value={coins(summary.data.operators_total)}
            hint={`Активных ${summary.data.operators_active}`}
          />
          <KPI
            label="Начислено за период"
            value={coins(summary.data.coins_awarded_in_period ?? summary.data.coins_awarded_this_week)}
            tone="coin"
            hint={formatDateRange(period)}
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
            hint={period && !summary.data.metrics_available
              ? "Нет завершённых недель в периоде"
              : shownRange ? formatDateRange(shownRange) : undefined}
          />
        </div>
      )}

      <Card title="Операторы" subtitle={operators.data ? `${operatorCount(operators.data.total)}${search ? " по запросу" : ""}` : undefined} padded={false} className="operators-list">
        {(!period || operators.isLoading) && (
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
          <EmptyState title="Ничего не найдено" hint="Измените поисковый запрос" />
        )}

        {operators.data && operators.data.items.length > 0 && (
          <>
            <div className="table-wrap table-wrap--responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Место</th>
                    <th>Оператор</th>
                    <th>Команда</th>
                    {!only && <th>Направление</th>}
                    <th className="num">Баллы</th>
                    <th className="num">{period ? "Начислено" : "Коины"}</th>
                    <th className="num">Баланс</th>
                    <th className="num">Опоздания</th>
                    <th className="num">Сайты</th>
                    <th><span className="sr-only">Действия</span></th>
                  </tr>
                </thead>
                <tbody>
                  {operators.data.items.map((row) => (
                    <tr key={row.user_id}>
                      <td className="num">
                        <Rank row={row} available={!period || !!row.metrics_available} />
                      </td>
                      <td>
                        <Link className="cell-person operators-person" to={{ search: personSearch(location.search, row.user_id) }} state={{ person: true }}>
                          <Avatar name={row.full_name} id={row.user_id} size={32} />
                          <span className="cell-person__text">
                            <span className="cell-person__name">{row.full_name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{row.group_name ?? "Без команды"}</td>
                      {!only && <td className="muted">{CHANNEL_LABELS[row.channel ?? "line"]}</td>}
                      <td className="num">{!period || row.metrics_available ? points(row.points) : "—"}</td>
                      <td className="num">{coins(row.coins_week)}</td>
                      <td className="num">
                        {coins(row.balance)}
                        {row.reserved > 0 && (
                          <span className="muted micro block">резерв {coins(row.reserved)}</span>
                        )}
                      </td>
                      <AntiCell value={row.lateness} available={!period || !!row.metrics_available} />
                      <AntiCell value={row.forbidden_sites} available={!period || !!row.metrics_available} />
                      <td className="cell-actions">
                        {canRecord && <Button size="s" variant="plain" onClick={() => setOffender(row)} aria-label={`Отметить посторонние сайты: ${row.full_name}`}>
                          Сайты
                        </Button>}
                        {canCredit && <Button size="s" onClick={() => setTarget(row)}>
                          Начислить
                        </Button>}
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
                      <Link className="cell-person operators-person" to={{ search: personSearch(location.search, row.user_id) }} state={{ person: true }}>
                        <Avatar name={row.full_name} id={row.user_id} size={36} />
                        <span className="cell-person__text">
                          <span className="cell-person__name">{row.full_name}</span>
                          <span className="cell-person__meta">
                            {row.group_name ?? "Без команды"}{row.channel === "chat" ? " · Чаты" : ""}
                          </span>
                        </span>
                      </Link>
                      <Rank row={row} available={!period || !!row.metrics_available} />
                    </div>
                    <div className="list-card__metrics">
                      <span className="list-card__metric">
                        <span>Баллы</span>
                        <span>{!period || row.metrics_available ? points(row.points) : "—"}</span>
                      </span>
                      {period && <span className="list-card__metric">
                        <span>Начислено</span>
                        <span>{coins(row.coins_week)}</span>
                      </span>}
                      <span className="list-card__metric">
                        <span>Баланс</span>
                        <span>{coins(row.balance)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Опоздания</span>
                        <span>{period && !row.metrics_available ? "—" : row.lateness === 0 ? "нет" : points(row.lateness)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Сайты</span>
                        <span>
                          {period && !row.metrics_available ? "—" : row.forbidden_sites === 0 ? "нет" : points(row.forbidden_sites)}
                        </span>
                      </span>
                    </div>
                    {(canCredit || canRecord) && <div className="operators-card-actions">
                      {canRecord && <Button size="s" block onClick={() => setOffender(row)}>
                        Посторонние сайты
                      </Button>}
                      {canCredit && <Button size="s" block onClick={() => setTarget(row)}>
                        Начислить коины
                      </Button>}
                    </div>}
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

      {target && canCredit && <ManualCoinsSheet operator={target} onClose={() => setTarget(null)} />}
      {offender && canRecord && <ViolationSheet operator={offender} onClose={() => setOffender(null)} />}
    </div>
  );
}

/** Место в рейтинге — значком, когда оно есть; без завершённых недель — тихий прочерк. */
function Rank({ row, available }: { row: OperatorRowOut; available: boolean }) {
  return available && row.rank != null ? <span className="rank-badge">{row.rank}</span> : <span className="muted" title="Нет места за выбранный период">—</span>;
}

/** Антипоказатель: ноль помечен галочкой, нарушения — значком и цветом. */
function AntiCell({ value, available = true }: { value: number; available?: boolean }) {
  if (!available) return <td className="num muted" title="Нет завершённых недель в выбранном периоде">—</td>;
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
