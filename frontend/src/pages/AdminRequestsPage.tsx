import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { admin } from "../api/endpoints";
import type { ShopRequestOut, ShopRequestStatus } from "../api/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CoinAmount,
  EmptyState,
  ErrorState,
  Pagination,
  RowsSkeleton,
  SegmentedControl,
  type Tone,
} from "../components/ui";
import { REQUEST_STATUS_LABELS, coins, dateTime } from "../utils/format";

const STATUS_TONE: Record<ShopRequestStatus, Tone> = {
  new: "accent",
  approved: "success",
  fulfilled: "success",
  rejected: "danger",
  cancelled: "neutral",
};

type StatusFilter = ShopRequestStatus | "";

const TABS: { value: StatusFilter; label: string }[] = [
  { value: "new", label: "Новые" },
  { value: "approved", label: "Одобренные" },
  { value: "fulfilled", label: "Выполненные" },
  { value: "rejected", label: "Отклонённые" },
  { value: "", label: "Все" },
];

export function AdminRequestsPage() {
  const { atLeast } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("new");
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
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["team-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["team-purchases"] });
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
          <SegmentedControl
            options={TABS}
            value={status}
            label="Статус заявки"
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        }
        padded={false}
      >
        {requests.isLoading && (
          <div className="card__body">
            <RowsSkeleton />
          </div>
        )}
        {requests.isError && (
          <div className="card__body">
            <ErrorState error={requests.error} onRetry={() => requests.refetch()} />
          </div>
        )}
        {requests.data && requests.data.items.length === 0 && (
          <EmptyState
            title="Заявок нет"
            hint={status === "new" ? "Всё разобрано" : "Попробуйте другой фильтр"}
          />
        )}

        {requests.data && requests.data.items.length > 0 && (
          <>
            <div className="table-wrap table-wrap--responsive">
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
                      <td className="nowrap secondary">{dateTime(request.created_at)}</td>
                      <td>
                        <span className="cell-person">
                          {request.user && (
                            <Avatar
                              name={request.user.full_name}
                              id={request.user.id}
                              size={32}
                            />
                          )}
                          <span className="cell-person__text">
                            <span className="cell-person__name">
                              {request.user?.full_name ?? "—"}
                            </span>
                            <span className="cell-person__meta">
                              {request.user?.group?.name ?? ""}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>{request.item.title}</td>
                      <td className="num">{coins(request.price)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[request.status]}>
                          {REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      </td>
                      <td className="muted">
                        {request.comment ?? request.decision_comment ?? "—"}
                      </td>
                      <td className="cell-actions">
                        {atLeast("supervisor") && request.status === "new" && (
                          <>
                            <Button
                              size="s"
                              variant="primary"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ id: request.id, action: "approve" })}
                            >
                              Одобрить
                            </Button>
                            <Button
                              size="s"
                              variant="destructive"
                              onClick={() => setRejecting(request)}
                            >
                              Отклонить
                            </Button>
                          </>
                        )}
                        {atLeast("supervisor") && request.status === "approved" && (
                          <Button
                            size="s"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: request.id, action: "fulfill" })}
                          >
                            Отметить выданным
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card__body">
              <ul className="card-list">
                {requests.data.items.map((request) => (
                  <li key={request.id} className="list-card">
                    <div className="list-card__head">
                      <span className="cell-person">
                        {request.user && (
                          <Avatar name={request.user.full_name} id={request.user.id} size={36} />
                        )}
                        <span className="cell-person__text">
                          <span className="cell-person__name">
                            {request.user?.full_name ?? "—"}
                          </span>
                          <span className="cell-person__meta">
                            {dateTime(request.created_at)}
                          </span>
                        </span>
                      </span>
                      <Badge tone={STATUS_TONE[request.status]}>
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Badge>
                    </div>
                    <div className="list-card__head">
                      <span>{request.item.title}</span>
                      <CoinAmount value={request.price} size="s" />
                    </div>
                    {atLeast("supervisor") && request.status === "new" && (
                      <div className="row">
                        <Button
                          size="s"
                          variant="primary"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: request.id, action: "approve" })}
                        >
                          Одобрить
                        </Button>
                        <Button
                          size="s"
                          variant="destructive"
                          onClick={() => setRejecting(request)}
                        >
                          Отклонить
                        </Button>
                      </div>
                    )}
                    {atLeast("supervisor") && request.status === "approved" && (
                      <Button
                        size="s"
                        block
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: request.id, action: "fulfill" })}
                      >
                        Отметить выданным
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="card__body--flush">
              <Pagination
                page={page}
                size={size}
                total={requests.data.total}
                onChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      {rejecting && atLeast("supervisor") && (
        <RejectSheet
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

function RejectSheet({
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
      toast.info(`Заявка отклонена, ${coins(request.price)} коинов вернулись оператору`);
      onDone();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Не удалось отклонить заявку");
    },
  });

  const tooShort = comment.trim().length < 3;

  return (
    <Sheet
      title="Отклонить заявку"
      subtitle={`${request.user?.full_name ?? ""} · ${request.item.title}`}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || tooShort}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Отклоняем…" : "Отклонить"}
          </Button>
        </>
      }
    >
      <div className="confirm-row">
        <span>Вернётся оператору</span>
        <strong>{coins(request.price)} коинов</strong>
      </div>

      <label className="field" style={{ marginTop: "var(--sp-4)" }}>
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
    </Sheet>
  );
}
