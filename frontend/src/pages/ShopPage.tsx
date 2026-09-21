import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { cabinet, shop } from "../api/endpoints";
import type { ShopItemForOperator, ShopRequestStatus } from "../api/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { AlertIcon } from "../components/icons";
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
import { REQUEST_STATUS_LABELS, coins, dateTime, plural } from "../utils/format";

const STATUS_TONE: Record<ShopRequestStatus, Tone> = {
  new: "accent",
  approved: "success",
  fulfilled: "success",
  rejected: "danger",
  cancelled: "neutral",
};


export type ShopSort = "smart" | "cheap" | "expensive" | "closest";

export interface ShopFilters {
  search: string;
  sort: ShopSort;
  onlyReady: boolean;
}

/**
 * Витрина делится по тому единственному, что оператору важно в первую
 * очередь: можно купить прямо сейчас, копится или закрыто по другой
 * причине. Категорий товара сервер не отдаёт, поэтому выдумывать их нельзя —
 * деление берётся из настоящих полей can_buy и missing_coins.
 *
 * Порядок проверок здесь несущий. По blocked_reason судить нельзя: при
 * нехватке коинов сервер сам кладёт туда строку «Нужно ещё N коинов», и
 * копящееся уезжало в «недоступно» вместе с тем, что закрыто по-настоящему.
 * Настоящая блокировка — это когда коинов хватает, а купить всё равно
 * нельзя: кончился запас или выбран месячный лимит.
 */
export function shopGroup(item: ShopItemForOperator): "ready" | "saving" | "blocked" {
  if (item.can_buy) return "ready";
  if (item.missing_coins > 0) return "saving";
  return "blocked";
}

export function filterShop(items: ShopItemForOperator[], f: ShopFilters): ShopItemForOperator[] {
  const needle = f.search.trim().toLowerCase();
  const rows = items.filter((item) => {
    if (f.onlyReady && !item.can_buy) return false;
    if (!needle) return true;
    return `${item.title} ${item.description ?? ""}`.toLowerCase().includes(needle);
  });
  const order = { ready: 0, saving: 1, blocked: 2 } as const;
  return rows.sort((a, b) => {
    if (f.sort === "cheap") return a.price - b.price;
    if (f.sort === "expensive") return b.price - a.price;
    if (f.sort === "closest") {
      // «Ближе всего» — сколько осталось добрать. Купленное сейчас считаем
      // нулём, иначе доступное провалилось бы в конец списка.
      const left = (x: ShopItemForOperator) => (x.can_buy ? 0 : x.missing_coins);
      return left(a) - left(b);
    }
    // По умолчанию: сначала то, что можно взять, потом то, на что копится,
    // и внутри группы — от дешёвого к дорогому. Порядок сортировки товара
    // с сервера при этом сохраняется как последний признак.
    const group = order[shopGroup(a)] - order[shopGroup(b)];
    if (group !== 0) return group;
    if (a.price !== b.price) return a.price - b.price;
    return a.sort_order - b.sort_order;
  });
}

export function ShopPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<ShopItemForOperator | null>(null);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ShopSort>("smart");
  const [onlyReady, setOnlyReady] = useState(false);

  const catalog = useQuery({ queryKey: ["shop-catalog"], queryFn: shop.catalog });
  const myRequests = useQuery({ queryKey: ["my-requests"], queryFn: () => cabinet.myRequests() });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shop-catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["coin-progress"] });
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
  const reserved = data.balance - data.available;
  const ready = data.items.filter((item) => item.can_buy);
  const visible = filterShop(data.items, { search, sort, onlyReady });
  // Группы показываются в порядке полезности. При явной сортировке по цене
  // деление сохраняется: иначе «сначала дешёвые» смешало бы доступное с тем,
  // на что ещё копить, и список снова стал бы нечитаемым.
  const groups: [string, string, (n: number) => string, ShopItemForOperator[]][] = [
    ["ready", "Можно взять сейчас", (n) => `${n} ${plural(n, "бонус", "бонуса", "бонусов")}`,
      visible.filter((item) => shopGroup(item) === "ready")],
    ["saving", "Копим", (n) => `${n} ${plural(n, "бонус", "бонуса", "бонусов")} по карману позже`,
      visible.filter((item) => shopGroup(item) === "saving")],
    ["blocked", "Сейчас недоступно", (n) => `${n} ${plural(n, "бонус", "бонуса", "бонусов")}`,
      visible.filter((item) => shopGroup(item) === "blocked")],
  ];

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

      {/* Показателей было два, и при пустом резерве они показывали одно и то
          же число дважды. Остаток под заявками — редкий случай, поэтому он
          и упоминается только когда есть. */}
      <div className="kpi-grid kpi-grid--2">
        <KPI
          label="Доступно к трате"
          value={coins(data.available)}
          tone="coin"
          hint={
            reserved > 0
              ? `Ещё ${coins(reserved)} зарезервировано под заявки`
              : "Коины не сгорают"
          }
        />
        <KPI
          label="Можно взять сейчас"
          value={`${ready.length} из ${data.items.length}`}
          hint={ready.length ? "Остальное копится" : "Пока копим на первый бонус"}
        />
      </div>

      <Card>
        <div className="workflow-toolbar">
          <label className="field" style={{ flex: "2 1 220px" }}>
            <span className="field__label">Поиск</span>
            <input
              className="input"
              type="search"
              value={search}
              placeholder="Название или описание бонуса"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Порядок</span>
            <select className="input" value={sort} onChange={(event) => setSort(event.target.value as ShopSort)}>
              <option value="smart">Сначала доступные</option>
              <option value="closest">Ближе всего к покупке</option>
              <option value="cheap">Сначала дешёвые</option>
              <option value="expensive">Сначала дорогие</option>
            </select>
          </label>
          <label className="field" style={{ flex: "0 0 auto" }}>
            <span className="field__label">Что показывать</span>
            <button
              type="button"
              className={onlyReady ? "shop-toggle is-on" : "shop-toggle"}
              aria-pressed={onlyReady}
              onClick={() => setOnlyReady((on) => !on)}
            >
              Только доступные
            </button>
          </label>
        </div>
      </Card>

      {visible.length === 0 ? (
        <EmptyState
          title={onlyReady ? "Пока нечего купить" : "Ничего не нашлось"}
          hint={
            onlyReady
              ? "Снимите фильтр, чтобы посмотреть, на что копить."
              : "Попробуйте другое слово — поиск идёт по названию и описанию."
          }
          action={
            <Button onClick={() => { setSearch(""); setOnlyReady(false); }}>Показать все</Button>
          }
        />
      ) : (
        groups.map(([group, label, hint, items]) =>
          items.length ? (
            <section key={group} className="shop-group">
              <header className="shop-group__head">
                <h2 className="shop-group__title">{label}</h2>
                <span className="shop-group__hint">{hint(items.length)}</span>
              </header>
              <div className="catalog">
                {items.map((item) => (
                  <ProductCard
                    key={item.id}
                    item={item}
                    available={data.available}
                    onBuy={() => setChosen(item)}
                  />
                ))}
              </div>
            </section>
          ) : null,
        )
      )}

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
      {/* Блок с иконкой-заглушкой убран: девять одинаковых картинок съедали
          по сто двадцать пикселей каждая и не сообщали ничего. Картинок
          товара сервер не отдаёт, а рисовать вместо них один и тот же
          значок — это занимать место, не давая взамен смысла. */}
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
