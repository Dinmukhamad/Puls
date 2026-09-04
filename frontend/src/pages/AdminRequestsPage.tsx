import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { admin } from "../api/endpoints";
import type { ShopRequestOut, ShopRequestStatus } from "../api/types";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  Pill,
  Spinner,
  type Tone,
} from "../components/ui";
import { REQUEST_STATUS_LABELS, coins, dateTime } from "../utils/format";

const STATUS_TONE: Record<ShopRequestStatus, Tone> = {
  new: "accent",
  approved: "good",
  fulfilled: "good",
  rejected: "critical",
  cancelled: "neutral",
};

const TABS: { value: ShopRequestStatus | ""; label: string }[] = [
  { value: "new", label: "Новые" },
  { value: "approved", label: "Одобренные" },
  { value: "fulfilled", label: "Выполненные" },
  { value: "rejected", label: "Отклонённые" },
  { value: "", label: "Все" },
];

export function AdminRequestsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ShopRequestStatus | "">("new");
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<ShopRequestOut | null>(null);
  const size = 20;

  const requests = useQuery({
    queryKey: ["admin-requests", status, page],
    queryFn: () => admin.shopRequests({ status: status || undefined, page, size }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
  };

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "fulfill" }) =>
      action === "approve" ? admin.approve(id) : admin.fulfill(id),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.action === "approve"
          ? "Заявка одобрена, коины списаны с баланса оператора"
          : "Отмечено как выданное",
      );
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Не удалось обработать заявку");
    },
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Заявки из магазина</h1>
          <p className="page-subtitle">
            Одобрение списывает зарезервированные коины, отказ возвращает их оператору
          </p>
        </div>
      </div>

      <Card
        title="Очередь"
        action={
          <div className="tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.value || "all"}
                type="button"
                role="tab"
                aria-selected={status === tab.value}
                className={status === tab.value ? "tab tab--active" : "tab"}
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
        padded={false}
      >
        {requests.isLoading && <div className="card__body"><Spinner /></div>}
        {requests.isError && (
          <div className="card__body">
            <ErrorState error={requests.error} onRetry={() => requests.refetch()} />
          </div>
        )}
        {requests.data && requests.data.items.length === 0 && (
          <div className="card__body">
            <EmptyState
              title="Заявок нет"
              hint={status === "new" ? "Всё разобрано" : "Попробуйте другой фильтр"}
            />
          </div>
        )}
        {requests.data && requests.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Оператор</th>
                  <th>Бонус</th>
                  <th className="num">Коины</th>
                  <th>Статус</th>
                  <th>Комментарий</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requests.data.items.map((request) => (
                  <tr key={request.id}>
                    <td className="nowrap">{dateTime(request.created_at)}</td>
                    <td>
                      {request.user?.full_name ?? "—"}
                      {request.user?.group && (
                        <span className="muted small block">{request.user.group.name}</span>
                      )}
                    </td>
                    <td>{request.item.title}</td>
                    <td className="num">{coins(request.price)}</td>
                    <td>
                      <Pill tone={STATUS_TONE[request.status]}>
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Pill>
                    </td>
                    <td className="muted table__reason">
                      {request.comment ?? request.decision_comment ?? "—"}
                    </td>
                    <td className="actions">
                      {request.status === "new" && (
                        <>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: request.id, action: "approve" })}
                          >
                            Одобрить
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => setRejecting(request)}
                          >
                            Отклонить
                          </button>
                        </>
                      )}
                      {request.status === "approved" && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: request.id, action: "fulfill" })}
                        >
                          Отметить выданным
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {requests.data && (
          <div className="card__body card__body--tight">
            <Pagination page={page} size={size} total={requests.data.total} onChange={setPage} />
          </div>
        )}
      </Card>

      {rejecting && (
        <RejectModal
          request={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RejectModal({
  request,
  onClose,
  onDone,
}: {
  request: ShopRequestOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: () => admin.reject(request.id, comment.trim()),
    onSuccess: () => {
      toast.info(`Заявка отклонена, ${coins(request.price)} ◆ вернулись оператору`);
      onDone();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Не удалось отклонить заявку");
    },
  });

  const tooShort = comment.trim().length < 3;

  return (
    <Modal
      title={`Отклонить заявку №${request.id}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={mutation.isPending || tooShort}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Отклоняем…" : "Отклонить"}
          </button>
        </>
      }
    >
      <p>
        {request.user?.full_name} — «{request.item.title}» за {coins(request.price)} ◆
      </p>
      <label className="field">
        <span className="field__label">
          Причина отказа <span className="field__req">обязательно</span>
        </span>
        <textarea
          className="input"
          rows={3}
          value={comment}
          maxLength={500}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Например: бонус временно недоступен"
        />
      </label>
      {tooShort && <p className="field__error">Оператор увидит эту причину, опишите её</p>}
      <p className="muted small">Зарезервированные коины сразу вернутся на баланс.</p>
    </Modal>
  );
}
