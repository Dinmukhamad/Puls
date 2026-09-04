import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { cabinet, shop } from "../api/endpoints";
import type { ShopItemForOperator, ShopRequestStatus } from "../api/types";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  Card,
  EmptyState,
  ErrorState,
  Meter,
  Pill,
  Spinner,
  StatTile,
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
  };

  const buy = useMutation({
    mutationFn: () => shop.buy(chosen!.id, comment),
    onSuccess: () => {
      toast.success(`Заявка на «${chosen!.title}» отправлена супервайзеру. Коины зарезервированы.`);
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

  if (catalog.isLoading) return <Spinner label="Загружаем каталог" />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

  const data = catalog.data!;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Магазин бонусов</h1>
          <p className="page-subtitle">Коины не сгорают — тратьте сразу или копите на крупный бонус</p>
        </div>
      </div>

      <div className="kpi kpi--2">
        <StatTile hero label="Доступно к трате" value={coins(data.available)} />
        <StatTile
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
          <ShopCard key={item.id} item={item} available={data.available} onBuy={() => setChosen(item)} />
        ))}
      </div>

      <Card title="Мои заявки" padded={false}>
        {myRequests.isLoading && <div className="card__body"><Spinner /></div>}
        {myRequests.data && myRequests.data.items.length === 0 && (
          <div className="card__body">
            <EmptyState title="Заявок пока нет" hint="Выберите бонус в каталоге выше" />
          </div>
        )}
        {myRequests.data && myRequests.data.items.length > 0 && (
          <div className="table-wrap">
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
                    <td className="nowrap">{dateTime(request.created_at)}</td>
                    <td>{request.item.title}</td>
                    <td className="num">{coins(request.price)}</td>
                    <td>
                      <Pill tone={STATUS_TONE[request.status]}>
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Pill>
                    </td>
                    <td className="muted">{request.decision_comment ?? "—"}</td>
                    <td className="num">
                      {request.status === "new" && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(request.id)}
                        >
                          Отозвать
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {chosen && (
        <Modal
          title={`Купить: ${chosen.title}`}
          onClose={() => setChosen(null)}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setChosen(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={buy.isPending}
                onClick={() => buy.mutate()}
              >
                {buy.isPending ? "Отправляем…" : `Купить за ${chosen.price} ◆`}
              </button>
            </>
          }
        >
          <p>{chosen.description}</p>
          <div className="confirm-row">
            <span>Спишется с баланса</span>
            <strong>{coins(chosen.price)} ◆</strong>
          </div>
          <div className="confirm-row">
            <span>Останется доступно</span>
            <strong>{coins(data.available - chosen.price)} ◆</strong>
          </div>
          <p className="muted small">
            Коины будут зарезервированы сразу, а списаны — после одобрения супервайзером.
            При отказе резерв вернётся на баланс.
          </p>
          <label className="field">
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
        </Modal>
      )}
    </div>
  );
}

function ShopCard({
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
    <article className={item.can_buy ? "shop-card shop-card--ready" : "shop-card"}>
      <header className="shop-card__head">
        <h3 className="shop-card__title">{item.title}</h3>
        <span className="shop-card__price">
          {coins(item.price)} <span aria-hidden="true">◆</span>
        </span>
      </header>
      <p className="shop-card__text">{item.description}</p>

      {!item.can_buy && item.missing_coins > 0 && (
        <div className="shop-card__progress">
          <Meter completion={progress} />
          <span className="muted small">
            Накоплено {coins(available)} из {coins(item.price)}
          </span>
        </div>
      )}

      <footer className="shop-card__foot">
        {item.can_buy ? (
          <button type="button" className="btn btn--primary btn--block" onClick={onBuy}>
            Купить
          </button>
        ) : (
          <div className="shop-card__blocked">
            <span className="icon-warn" aria-hidden="true">
              !
            </span>
            {item.blocked_reason}
          </div>
        )}
      </footer>
    </article>
  );
}
