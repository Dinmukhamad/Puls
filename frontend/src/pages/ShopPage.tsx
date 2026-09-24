import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";

import { ApiError } from "../api/client";
import { cabinet, shop } from "../api/endpoints";
import type { ShopItemForOperator, ShopRequestStatus } from "../api/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { AlertIcon } from "../components/icons";
import "./shop.css";
import {
  Badge,
  Button,
  Card,
  CoinAmount,
  EmptyState,
  ErrorState,
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


/**
 * Картинок товара сервер не отдаёт, поэтому витрина подбирает понятный
 * значок по коду и названию бонуса — так приз узнаётся с одного взгляда.
 */
const SHOP_ICONS: [RegExp, string, string][] = [
  [/коф|coffee/i, "☕", "#8b5e3c"],
  [/пицц|pizza/i, "🍕", "#e8743b"],
  [/обед|lunch|питан/i, "🍽️", "#3fa46a"],
  [/розыгр|raffle|ticket|билет/i, "🎟️", "#f0522e"],
  [/звезд|star|бейдж/i, "⭐", "#f0a23a"],
  [/перерыв|break|отдых/i, "⏸️", "#35b6a6"],
  [/смен|shift|аукцион|доступ/i, "⏰", "#5b8def"],
  [/мерч|merch|худи|кружк/i, "👕", "#e86aa6"],
  [/маркет|market|kaspi|wildberr|сертиф/i, "🛍️", "#d9486b"],
  [/выходн|day ?off|отгул/i, "🏖️", "#2aa7c9"],
];

export function shopIcon(item: { code: string; title: string; description?: string | null }): { icon: string; color: string } {
  const text = `${item.code} ${item.title} ${item.description ?? ""}`;
  const found = SHOP_ICONS.find(([pattern]) => pattern.test(text));
  return found ? { icon: found[1], color: found[2] } : { icon: "🎁", color: "#f0522e" };
}

export function ShopPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<ShopItemForOperator | null>(null);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ShopSort>("smart");
  const [view, setView] = useState<"all" | "ready" | "saving" | "blocked">("all");

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
        <Skeleton height={150} radius="var(--radius-xl)" />
        <Skeleton height={280} radius="var(--radius-xl)" />
      </div>
    );
  }
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

  const data = catalog.data!;
  const reserved = data.balance - data.available;
  const all = filterShop(data.items, { search, sort, onlyReady: false });
  const counts = { all: all.length, ready: 0, saving: 0, blocked: 0 };
  for (const item of all) counts[shopGroup(item)] += 1;
  const visible = view === "all" ? all : all.filter((item) => shopGroup(item) === view);
  // The nearest goal: the cheapest bonus the operator is still saving for.
  const goal = data.items.filter((item) => shopGroup(item) === "saving").sort((a, b) => a.missing_coins - b.missing_coins)[0];
  const groups: [string, string, ShopItemForOperator[]][] = view === "all"
    ? [["ready", "Можно купить сейчас", visible.filter((item) => shopGroup(item) === "ready")],
      ["saving", "Копим", visible.filter((item) => shopGroup(item) === "saving")],
      ["blocked", "Сейчас недоступно", visible.filter((item) => shopGroup(item) === "blocked")]]
    : [[view, "", visible]];
  const tabs: [typeof view, string][] = [["all", "Все"], ["ready", "Можно купить"], ["saving", "Копим"], ["blocked", "Недоступно"]];

  return (
    <div className="stack shop">
      <div className="page-head">
        <div>
          <h1 className="page-title">Магазин бонусов</h1>
          <p className="page-subtitle">Коины не сгорают — тратьте сразу или копите на крупный бонус</p>
        </div>
      </div>

      <section className="shop-wallet" aria-label="Мой баланс">
        <div className="shop-wallet__balance">
          <span className="shop-wallet__label">Мой баланс</span>
          <strong><span className="shop-coin" aria-hidden="true">◈</span>{coins(data.available)}<small>{plural(data.available, "коин", "коина", "коинов")}</small></strong>
          <span className="shop-wallet__note">{reserved > 0 ? `Ещё ${coins(reserved)} в резерве под заявки` : "Доступно к трате · коины не сгорают"}</span>
        </div>
        <div className="shop-wallet__stat">
          <strong>{counts.ready}<small> из {data.items.length}</small></strong>
          <span>бонусов можно купить сейчас</span>
        </div>
        {goal ? (
          <div className="shop-wallet__goal">
            <span className="shop-wallet__label">Ближайшая цель</span>
            <strong>{shopIcon(goal).icon} {goal.title}</strong>
            <div className="shop-meter" role="progressbar" aria-label={`Накоплено на «${goal.title}»`} aria-valuemin={0} aria-valuemax={goal.price} aria-valuenow={Math.min(data.available, goal.price)}><span style={{ width: `${Math.min(100, (data.available / goal.price) * 100)}%` }} /></div>
            <span className="shop-wallet__note">Не хватает <b>{coins(goal.missing_coins)} ◈</b> · {coins(data.available)} из {coins(goal.price)}</span>
          </div>
        ) : (
          <div className="shop-wallet__goal">
            <span className="shop-wallet__label">Ближайшая цель</span>
            <strong>🎉 Хватает на все бонусы</strong>
            <span className="shop-wallet__note">Выбирайте любой из каталога</span>
          </div>
        )}
      </section>

      <div className="shop-toolbar">
        <div className="segmented shop-tabs" role="tablist" aria-label="Какие бонусы показать">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "segmented__item is-active" : "segmented__item"} onClick={() => setView(key)}>
              {label} <span className="shop-tabs__count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <input className="input shop-search" type="search" value={search} aria-label="Поиск бонуса" placeholder="Поиск бонуса" onChange={(event) => setSearch(event.target.value)} />
        <select className="input shop-sort" aria-label="Порядок" value={sort} onChange={(event) => setSort(event.target.value as ShopSort)}>
          <option value="smart">Сначала доступные</option>
          <option value="closest">Ближе всего к покупке</option>
          <option value="cheap">Сначала дешёвые</option>
          <option value="expensive">Сначала дорогие</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={view === "ready" ? "Пока нечего купить" : "Ничего не нашлось"}
          hint={view === "ready" ? "Загляните во вкладку «Копим» — там видно, сколько осталось накопить." : "Попробуйте другое слово — поиск идёт по названию и описанию."}
          action={<Button onClick={() => { setSearch(""); setView("all"); }}>Показать все</Button>}
        />
      ) : (
        groups.map(([group, label, items]) =>
          items.length ? (
            <section key={group} className="shop-group">
              {label && <header className="shop-group__head"><h2 className="shop-group__title">{label}</h2><span className="shop-group__hint">{items.length} {plural(items.length, "бонус", "бонуса", "бонусов")}</span></header>}
              <div className="shop-grid">
                {items.map((item) => <ProductCard key={item.id} item={item} available={data.available} onBuy={() => setChosen(item)} />)}
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
                      <td>{shopIcon(request.item).icon} {request.item.title}</td>
                      <td className="num">{coins(request.price)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[request.status]}>{REQUEST_STATUS_LABELS[request.status]}</Badge>
                      </td>
                      <td className="muted">{request.decision_comment ?? "—"}</td>
                      <td className="cell-actions">
                        {request.status === "new" && (
                          <Button size="s" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>Отозвать</Button>
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
                        <span className="cell-person__name">{shopIcon(request.item).icon} {request.item.title}</span>
                        <span className="cell-person__meta">{dateTime(request.created_at)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[request.status]}>{REQUEST_STATUS_LABELS[request.status]}</Badge>
                    </div>
                    <div className="list-card__head">
                      <CoinAmount value={request.price} size="s" />
                      {request.status === "new" && (
                        <Button size="s" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>Отозвать</Button>
                      )}
                    </div>
                    {request.decision_comment && <p className="small secondary">{request.decision_comment}</p>}
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
                {buy.isPending ? "Отправляем…" : `Купить за ${coins(chosen.price)} ◈`}
              </Button>
            </>
          }
        >
          <div className="shop-confirm">
            <span className="shop-confirm__icon" style={{ background: `color-mix(in srgb, ${shopIcon(chosen).color} 16%, var(--surface-primary))` }} aria-hidden="true">{shopIcon(chosen).icon}</span>
            <p className="secondary">{chosen.description}</p>
          </div>
          <div className="shop-receipt">
            <div><span>Сейчас на балансе</span><strong>{coins(data.available)} ◈</strong></div>
            <div><span>Цена бонуса</span><strong>− {coins(chosen.price)} ◈</strong></div>
            <div className="shop-receipt__total"><span>Останется</span><strong>{coins(data.available - chosen.price)} ◈</strong></div>
          </div>
          <p className="muted micro" style={{ marginTop: "var(--sp-4)" }}>
            {chosen.requires_approval
              ? "Коины зарезервируются сразу, а спишутся после одобрения супервайзером. При отказе резерв вернётся на баланс."
              : "Бонус выдаётся без одобрения: коины спишутся сразу после оформления."}
          </p>
          <label className="field" style={{ marginTop: "var(--sp-4)" }}>
            <span className="field__label">Комментарий (необязательно)</span>
            <textarea className="input" rows={2} value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} placeholder="Например, желаемый размер мерча" />
          </label>
        </Sheet>
      )}
    </div>
  );
}

function ProductCard({ item, available, onBuy }: { item: ShopItemForOperator; available: number; onBuy: () => void }) {
  const group = shopGroup(item), { icon, color } = shopIcon(item);
  const progress = item.price > 0 ? Math.min(1, available / item.price) : 1;
  const status = group === "ready" ? "✓ Можно купить" : group === "saving" ? `Не хватает ${coins(item.missing_coins)} ◈` : "Недоступно";
  return (
    <article className={`shop-card shop-card--${group}`} style={{ "--prize": color } as CSSProperties}>
      <div className="shop-card__art" aria-hidden="true"><span>{icon}</span></div>
      <span className={`shop-card__status shop-card__status--${group}`}>{status}</span>
      <div className="shop-card__body">
        <h3 className="shop-card__title">{item.title}</h3>
        {item.description && <p className="shop-card__text">{item.description}</p>}
        <div className="shop-card__price"><span className="shop-coin" aria-hidden="true">◈</span>{coins(item.price)}<small>{plural(item.price, "коин", "коина", "коинов")}</small></div>
        <ul className="shop-card__meta">
          <li>{item.requires_approval ? "👤 С одобрением" : "⚡ Сразу"}</li>
          {item.stock_limit !== null && <li>📦 Осталось {item.stock_limit}</li>}
          {item.per_user_monthly_limit !== null && <li>🗓 {item.per_user_monthly_limit} в месяц</li>}
        </ul>
        {group === "ready" && <p className="shop-card__after">После покупки останется <b>{coins(available - item.price)} ◈</b></p>}
        {group === "saving" && (
          <div className="shop-card__saving">
            <div className="shop-meter" role="progressbar" aria-label="Накоплено" aria-valuemin={0} aria-valuemax={item.price} aria-valuenow={available}><span style={{ width: `${progress * 100}%` }} /></div>
            <span>{coins(available)} из {coins(item.price)} · {Math.round(progress * 100)}%</span>
          </div>
        )}
        {group === "blocked" && <p className="shop-card__blocked"><AlertIcon size={15} /> {item.blocked_reason ?? "Сейчас недоступно"}</p>}
        {group === "ready"
          ? <Button variant="primary" block onClick={onBuy}>Купить за {coins(item.price)} ◈</Button>
          : <div className="shop-card__locked">{group === "saving" ? `Накопите ещё ${coins(item.missing_coins)} ◈` : "Пока нельзя купить"}</div>}
      </div>
    </article>
  );
}
