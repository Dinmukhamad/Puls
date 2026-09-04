import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, downloadFile } from "../api/client";
import { admin, rating } from "../api/endpoints";
import type { OperatorRowOut } from "../api/types";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  Spinner,
  StatTile,
} from "../components/ui";
import { WEEK_STATUS_LABELS, coins, points, signed } from "../utils/format";

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
          <p className="page-subtitle">
            Показатели недели, балансы и ручное начисление коинов
          </p>
        </div>
        <div className="page-head__controls">
          <select
            className="input input--sm"
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
          <button type="button" className="btn btn--ghost" onClick={exportCsv}>
            Выгрузить CSV
          </button>
        </div>
      </div>

      {/* Сводная статистика - п. 4.4.1 ТЗ */}
      {summary.data && (
        <div className="kpi">
          <StatTile
            label="Операторов в системе"
            value={coins(summary.data.operators_total)}
            hint={`Активных ${summary.data.operators_active}`}
          />
          <StatTile
            label="Начислено за неделю"
            value={coins(summary.data.coins_awarded_this_week)}
            hint="Сумма всех положительных операций за 7 дней"
          />
          <StatTile
            label="Новых заявок"
            value={coins(summary.data.new_shop_requests)}
            hint="Ожидают решения"
          />
          <StatTile
            label="Средняя позиция"
            value={summary.data.average_rank !== null ? summary.data.average_rank.toFixed(1) : "—"}
            hint={summary.data.week_label ? `Неделя ${summary.data.week_label}` : undefined}
          />
        </div>
      )}

      <Card
        title="Таблица операторов"
        action={
          <input
            className="input input--sm"
            placeholder="Поиск по ФИО"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        }
        padded={false}
      >
        {operators.isLoading && <div className="card__body"><Spinner /></div>}
        {operators.isError && (
          <div className="card__body">
            <ErrorState error={operators.error} onRetry={() => operators.refetch()} />
          </div>
        )}
        {operators.data && operators.data.items.length === 0 && (
          <div className="card__body">
            <EmptyState title="Операторов не найдено" />
          </div>
        )}
        {operators.data && operators.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Место</th>
                  <th>ФИО</th>
                  <th>Группа</th>
                  <th className="num">Баллы</th>
                  <th className="num">Коины за неделю</th>
                  <th className="num">Баланс</th>
                  <th className="num">Опоздания</th>
                  <th className="num">Сайты</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {operators.data.items.map((row) => (
                  <tr key={row.user_id}>
                    <td className="num">{row.rank ?? "—"}</td>
                    <td>
                      {row.full_name}
                      <span className="muted small block">{row.login}</span>
                    </td>
                    <td className="muted">{row.group_name ?? "—"}</td>
                    <td className="num">{points(row.points)}</td>
                    <td className="num">{coins(row.coins_week)}</td>
                    <td className="num">
                      {coins(row.balance)}
                      {row.reserved > 0 && (
                        <span className="muted small block">резерв {coins(row.reserved)}</span>
                      )}
                    </td>
                    <AntiCell value={row.lateness} />
                    <AntiCell value={row.forbidden_sites} />
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setTarget(row)}
                      >
                        Начислить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {operators.data && (
          <div className="card__body card__body--tight">
            <Pagination page={page} size={size} total={operators.data.total} onChange={setPage} />
          </div>
        )}
      </Card>

      {target && <ManualCoinsModal operator={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

/** Антипоказатель: ноль помечен галочкой, нарушения - значком и цветом. */
function AntiCell({ value }: { value: number }) {
  if (value === 0) {
    return (
      <td className="num">
        <span className="icon-ok" aria-hidden="true">
          ✓
        </span>
        <span className="muted"> нет</span>
      </td>
    );
  }
  return (
    <td className="num cell--bad">
      <span className="icon-warn" aria-hidden="true">
        !
      </span>{" "}
      {points(value)}
    </td>
  );
}

/* --------------------------------------------------------------------------
 * Ручное начисление - п. 4.4.3 ТЗ. Комментарий обязателен.
 * -------------------------------------------------------------------------- */

const PRESETS = [
  { amount: 10, reason: "Попадание на доску почёта" },
  { amount: 5, reason: "Помощь новому сотруднику" },
  { amount: 7, reason: "Активность вне основного конкурса" },
];

function ManualCoinsModal({
  operator,
  onClose,
}: {
  operator: OperatorRowOut;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState("");
  const [driverRef, setDriverRef] = useState("");
  const [mode, setMode] = useState<"manual" | "gratitude">("manual");

  const mutation = useMutation({
    mutationFn: () =>
      mode === "gratitude"
        ? admin.gratitude(operator.user_id, driverRef)
        : admin.manualCoins(operator.user_id, amount, reason.trim()),
    onSuccess: (tx) => {
      toast.success(
        `${operator.full_name}: ${signed(tx.amount)} ◆. Баланс ${coins(tx.balance_after)}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Операция не выполнена");
    },
  });

  const reasonTooShort = mode === "manual" && reason.trim().length < 5;

  return (
    <Modal
      title={`Начисление: ${operator.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={mutation.isPending || reasonTooShort}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Сохраняем…" : "Провести"}
          </button>
        </>
      }
    >
      <div className="tabs tabs--block" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          className={mode === "manual" ? "tab tab--active" : "tab"}
          onClick={() => setMode("manual")}
        >
          Начисление или списание
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "gratitude"}
          className={mode === "gratitude" ? "tab tab--active" : "tab"}
          onClick={() => setMode("gratitude")}
        >
          Благодарность водителя
        </button>
      </div>

      {mode === "manual" ? (
        <>
          <label className="field">
            <span className="field__label">
              Количество коинов
              <span className="field__note">
                положительное — начисление, отрицательное — списание
              </span>
            </span>
            <input
              className="input"
              type="number"
              value={amount}
              min={-100}
              max={100}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
          </label>

          <div className="presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.reason}
                type="button"
                className="chip"
                onClick={() => {
                  setAmount(preset.amount);
                  setReason(preset.reason);
                }}
              >
                +{preset.amount} · {preset.reason}
              </button>
            ))}
          </div>

          <label className="field">
            <span className="field__label">
              Причина <span className="field__req">обязательно</span>
            </span>
            <textarea
              className="input"
              rows={2}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Например: помощь новому сотруднику"
            />
          </label>
          {reasonTooShort && (
            <p className="field__error">Комментарий должен содержать не менее 5 символов</p>
          )}
          <p className="muted small">
            Операция попадёт в неизменяемую историю с вашим именем и датой. Отредактировать
            или удалить её потом нельзя — только провести обратную.
          </p>
        </>
      ) : (
        <>
          <p>Начислит фиксированный бонус за благодарность от водителя.</p>
          <label className="field">
            <span className="field__label">Номер водителя или заявки (необязательно)</span>
            <input
              className="input"
              value={driverRef}
              maxLength={64}
              onChange={(event) => setDriverRef(event.target.value)}
              placeholder="1247"
            />
          </label>
        </>
      )}
    </Modal>
  );
}
