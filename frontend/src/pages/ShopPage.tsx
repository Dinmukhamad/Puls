import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { cabinet, shop } from "../api/endpoints";
import type { ShopItemForOperator, ShopRequestStatus } from "../api/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { AlertIcon, StoreIcon } from "../components/icons";
import {
  Badge,
  Button,
  Card,
  CoinAmount,
  EmptyState,
  ErrorState,
  KPI,
  Progress,
  RowsSkeleton,
  Skeleton,
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

export function ShopPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<ShopItemForOperator | null>(null);
  const [comment, setComment] = useState("");

  const catalog = useQuery({ queryKey: ["shop-catalog"], queryFn: shop.catalog });
  const myRequests = useQuery({ queryKey: ["my-requests"], queryFn: () => cabinet.myRequests() });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shop-catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
  };

  const buy = useMutation({
    mutationFn: () => shop.buy(chosen!.id, comment),
    onSuccess: () => {
      toast.success(`Заявка на «${chosen!.title}» отправлена. Коины зарезервированы.`);
      setChosen(null);
      setComment("");
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Не удалось создать заявку");
    },
  });

  const cancel = useMutation({
    mutationFn: (id: number) => shop.cancel(id),
    onSuccess: () => {
      toast.info("Заявка отозвана, коины вернулись на баланс");
      refresh();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : "Не удалось отозвать заявку");
    },
  });

  if (catalog.isLoading) {
    return (
      <div className="page-skeleton">
        <Skeleton height={36} width="34%" radius="var(--radius-s)" />
        <Skeleton height={90} radius="var(--radius-xl)" />
        <Skeleton height={280} radius="var(--radius-xl)" />
      </div>
    );
  }
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

  const data = catalog.data!;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Магазин бонусов</h1>
          <p className="page-subtitle">
            Коины не сгорают — тратьте сразу или копите на крупный бонус
          </p>
        </div>
      </div>

      <div className="kpi-grid kpi-grid--2">
        <KPI
          label="Доступно к трате"
          value={coins(data.available)}
          tone="coin"
          hint="Можно потратить прямо сейчас"
        />
        <KPI
          label="Всего на балансе"
          value={coins(data.balance)}
          hint={
            data.balance - data.available > 0
              ? `${coins(data.balance - data.available)} зарезервировано под заявки`
              : "Резерва нет"
          }
        />
      </div>

      <div className="catalog">
        {data.items.map((item) => (
          <ProductCard
            key={item.id}
            item={item}
            available={data.available}
            onBuy={() => setChosen(item)}
          />
        ))}
      </div>

      <Card title="Мои заявки" padded={false}>
        {myRequests.isLoading && (
          <div className="card__body">
            <RowsSkeleton rows={3} />
          </div>
        )}
        {myRequests.data && myRequests.data.items.length === 0 && (
          <EmptyState title="Заявок пока нет" hint="Выберите бонус в каталоге выше" />
        )}
        {myRequests.data && myRequests.data.items.length > 0 && (
          <>
            <div className="table-wrap table-wrap--responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Бонус</th>
                    <th className="num">Цена</th>
                    <th>Статус</th>
                    <th>Комментарий решения</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {myRequests.data.items.map((request) => (
                    <tr key={request.id}>
                      <td className="nowrap secondary">{dateTime(request.created_at)}</td>
                      <td>{request.item.title}</td>
                      <td className="num">{coins(request.price)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[request.status]}>
                          {REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      </td>
                      <td className="muted">{request.decision_comment ?? "—"}</td>
                      <td className="cell-actions">
                        {request.status === "new" && (
                          <Button
                            size="s"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(request.id)}
                          >
                            Отозвать
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
                {myRequests.data.items.map((request) => (
                  <li key={request.id} className="list-card">
                    <div className="list-card__head">
                      <span className="cell-person__text">
                        <span className="cell-person__name">{request.item.title}</span>
                        <span className="cell-person__meta">{dateTime(request.created_at)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[request.status]}>
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Badge>
                    </div>
                    <div className="list-card__head">
                      <CoinAmount value={request.price} size="s" />
                      {request.status === "new" && (
                        <Button
                          size="s"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(request.id)}
                        >
                          Отозвать
                        </Button>
                      )}
                    </div>
                    {request.decision_comment && (
                      <p className="small secondary">{request.decision_comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </Card>

      {chosen && (
        <Sheet
          title={chosen.title}
          subtitle={`${coins(chosen.price)} коинов`}
          onClose={() => setChosen(null)}
          size="s"
          footer={
            <>
              <Button onClick={() => setChosen(null)}>Отмена</Button>
              <Button variant="primary" disabled={buy.isPending} onClick={() => buy.mutate()}>
                {buy.isPending ? "Отправляем…" : `Купить за ${chosen.price}`}
              </Button>
            </>
          }
        >
          <p className="secondary">{chosen.description}</p>

          <div style={{ marginTop: "var(--sp-4)" }}>
            <div className="confirm-row">
              <span>Спишется с баланса</span>
              <strong>{coins(chosen.price)}</strong>
            </div>
            <div className="confirm-row">
              <span>Останется доступно</span>
              <strong>{coins((catalog.data?.available ?? 0) - chosen.price)}</strong>
            </div>
          </div>

          <p className="muted micro" style={{ marginTop: "var(--sp-4)" }}>
            Коины будут зарезервированы сразу, а списаны — после одобрения супервайзером.
            При отказе резерв вернётся на баланс.
          </p>

          <label className="field" style={{ marginTop: "var(--sp-4)" }}>
            <span className="field__label">Комментарий (необязательно)</span>
            <textarea
              className="input"
              rows={2}
              value={comment}
              maxLength={500}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Например, желаемый размер мерча"
            />
          </label>
        </Sheet>
      )}
    </div>
  );
}

function ProductCard({
  item,
  available,
  onBuy,
}: {
  item: ShopItemForOperator;
  available: number;
  onBuy: () => void;
}) {
  const progress = item.price > 0 ? Math.min(1, available / item.price) : 1;

  return (
    <article className={item.can_buy ? "product product--ready" : "product"}>
      <div className="product__art">
        <StoreIcon size={28} />
      </div>

      <h3 className="product__title">{item.title}</h3>
      <p className="product__text">{item.description}</p>

      <div className="product__price">
        <CoinAmount value={item.price} />
        {item.stock_limit !== null && (
          <span className="muted micro">осталось {item.stock_limit}</span>
        )}
      </div>

      {!item.can_buy && item.missing_coins > 0 && (
        <div className="product__progress">
          <Progress value={progress} size="s" />
          <span className="muted micro">
            Накоплено {coins(available)} из {coins(item.price)}
          </span>
        </div>
      )}

      {item.can_buy ? (
        <Button variant="primary" block onClick={onBuy}>
          Купить
        </Button>
      ) : (
        <div className="product__blocked">
          <AlertIcon size={15} />
          {item.blocked_reason}
        </div>
      )}
    </article>
  );
}
