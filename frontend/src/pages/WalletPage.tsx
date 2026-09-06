import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { useSearchParams } from "react-router-dom";
import { lookups } from "../api/access";
import { useAuth } from "../auth/AuthContext";

import { walletApi, type WalletKind } from "../api/wallet";
import { ManualCoinsSheet } from "../components/ManualCoinsSheet";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, Skeleton } from "../components/ui";
import { TX_LABELS, coins, dateTime, signed } from "../utils/format";
import "./wallet.css";

const KINDS: [WalletKind, string][] = [["", "Все операции"], ["accrual", "Начисления"], ["writeoff", "Списания"], ["purchase", "Покупки"], ["refund", "Возвраты"]];

export function WalletPage({ administrative = false }: { administrative?: boolean }) {
  const { atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [manual, setManual] = useState(false); const [search, setSearch] = useState("");
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const kind = KINDS.find(([value]) => value === params.get("kind"))?.[0] ?? "";
  const dateFrom = params.get("from") ?? ""; const dateTo = params.get("to") ?? "";
  const selected = Number(params.get("user")); const userId = administrative && Number.isInteger(selected) && selected > 0 ? selected : undefined;
  const people = useQuery({ queryKey: ["wallet-people", search], queryFn: () => lookups.operators({ search, size: 100 }), enabled: administrative });
  const filters = { page, kind, date_from: dateFrom, date_to: dateTo, user_id: userId };
  const data = useQuery({ queryKey: ["wallet", administrative, filters], queryFn: () => walletApi.report(administrative, filters) });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.delete("page"); if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const summary = data.data?.summary;
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">{administrative ? "Коины команды" : "Мой кошелёк"}</h1><p className="page-subtitle">{administrative ? "Баланс операторов и история операций в вашей области доступа" : "Баланс, начисления и покупки"}</p></div>{administrative ? atLeast("supervisor") && <Button variant="primary" onClick={() => setManual(true)}>Начислить / списать</Button> : <Link hideWhenDenied className="btn btn--primary btn--m" to="/shop">В магазин</Link>}</div>
    <Card title="Фильтры"><div className="wallet-filters">
      <label className="field"><span className="field__label">Начало периода</span><input className="input" type="date" value={dateFrom} max={dateTo || "9999-12-30"} onChange={(e) => update("from", e.target.value)} /></label>
      <label className="field"><span className="field__label">Конец периода</span><input className="input" type="date" value={dateTo} min={dateFrom || undefined} max="9999-12-30" onChange={(e) => update("to", e.target.value)} /></label>
      <label className="field"><span className="field__label">Тип операции</span><select className="input" value={kind} onChange={(e) => update("kind", e.target.value)}>{KINDS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      {administrative && <><label className="field"><span className="field__label">Поиск сотрудника</span><input className="input" value={search} placeholder="Имя оператора" onChange={(e) => setSearch(e.target.value)} /></label><label className="field"><span className="field__label">Сотрудник</span><select className="input" value={userId ?? ""} onChange={(e) => update("user", e.target.value)}><option value="">Все доступные операторы</option>{userId && !people.data?.items.some((p) => p.user_id === userId) && <option value={userId}>Сотрудник №{userId}</option>}{people.data?.items.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></label></>}
      <Button onClick={() => { setParams({}); setSearch(""); }}>Сбросить</Button>
    </div><p className="small secondary">Границы периода — по UTC; время в истории — в вашем часовом поясе. Начисления, списания и возвраты посчитаны за выбранные даты; баланс и резерв — на текущий момент.</p>{administrative && people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}{administrative && (people.data?.total ?? 0) > 100 && <p className="small secondary">В списке первые 100 сотрудников. Уточните имя для поиска.</p>}</Card>
    {data.isLoading && <Skeleton height={200} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {summary && <><div className="kpi-grid"><KPI label={administrative ? "Коины в обращении" : "Текущий баланс"} value={coins(summary.balance)} tone="coin" hint={`Доступно ${coins(summary.available)} · в резерве ${coins(summary.reserved)}`} /><KPI label="Начислено" value={`+${coins(summary.awarded)}`} hint="За выбранные даты" /><KPI label="Потрачено и списано" value={coins(summary.spent)} hint="Покупки и другие списания" /><KPI label="Возвращено" value={`+${coins(summary.refunded)}`} hint="Возвраты из магазина" /></div>
      <Card title="История операций" subtitle={`${data.data!.history.total} операций`}><div className="wallet-ledger">{data.data!.history.items.map((tx) => <article className="wallet-entry" key={tx.id}><div className="wallet-entry__body"><div className="row"><Badge tone={tx.tx_type === "purchase_refund" ? "accent" : tx.amount > 0 ? "success" : "neutral"}>{tx.tx_type === "purchase_refund" ? "Возврат" : tx.amount > 0 ? "Начисление" : "Списание"}</Badge><span className="small secondary">{TX_LABELS[tx.tx_type] ?? tx.tx_type}</span></div>{administrative && <Link to={`/admin/users/${tx.user_id}?tab=coins`}>{tx.full_name}</Link>}<strong>{tx.reason}</strong><span className="small secondary">{dateTime(tx.created_at)} · {tx.author_name ?? "Система"}</span></div><div className="wallet-entry__amount"><strong>{signed(tx.amount)} <span className="small">коинов</span></strong><span className="small secondary">Баланс после {coins(tx.balance_after)}</span>{tx.shop_request_id && <Link className="small" to={administrative ? "/admin/requests" : "/shop"}>Покупка №{tx.shop_request_id}</Link>}</div></article>)}</div>
        {data.data!.history.items.length === 0 && <EmptyState title="Операций не найдено" hint="Измените фильтры или дождитесь первого начисления" />}
        <Pagination page={page} size={20} total={data.data!.history.total} onChange={(p) => { const next = new URLSearchParams(params); next.set("page", String(p)); setParams(next); }} />
      </Card></>}
    {manual && <ManualCoinsSheet onClose={() => setManual(false)} />}
  </div>;
}
