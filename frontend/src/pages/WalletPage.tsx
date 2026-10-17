import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

import { canManageCoins, walletApi, walletAuthor, type WalletKind, type WalletTransaction } from "../api/wallet";
import { CoinOperatorPicker } from "../components/CoinOperatorPicker";
import { DateRangePicker } from "../components/DateRangePicker";
import { ManualCoinsSheet } from "../components/ManualCoinsSheet";
import { validDateRange } from "../components/dateRange";
import { Button, Card, EmptyState, ErrorState, KPI, Pagination, Select, Skeleton } from "../components/ui";
import { ROLE_LABELS, TX_LABELS, coins, dateTime, plural, signed } from "../utils/format";
import "./wallet.css";

const KINDS: [WalletKind, string][] = [["", "Все операции"], ["accrual", "Начисления"], ["writeoff", "Списания"], ["purchase", "Покупки"], ["refund", "Возвраты"]];

function Amount({ tx }: { tx: WalletTransaction }) {
  return <span className={`wallet-amount${tx.amount > 0 ? " wallet-amount--up" : ""}`}>{signed(tx.amount)} <span className="wallet-amount__unit">{plural(tx.amount, "коин", "коина", "коинов")}</span></span>;
}

function Author({ tx }: { tx: WalletTransaction }) {
  return <>{walletAuthor(tx)}{tx.author_role ? ` · ${ROLE_LABELS[tx.author_role]}` : ""}</>;
}

/** Staff ledger: one row per operation, the same columns on every row. */
function WalletLedger({ items }: { items: WalletTransaction[] }) {
  return <>
    <div className="table-wrap table-wrap--responsive wallet-ledger">
      <table className="table">
        <thead><tr><th>Дата</th><th>Оператор</th><th>Операция</th><th>Провёл</th><th className="num">Сумма</th><th className="num">Баланс после</th></tr></thead>
        <tbody>{items.map((tx) => <tr key={tx.id}>
            <td className="nowrap secondary">{dateTime(tx.created_at)}</td>
            <td className="wallet-ledger__person"><Link to={`/admin/wallet?user=${tx.user_id}`}>{tx.full_name}</Link></td>
            <td className="wallet-ledger__operation">
              <span className="wallet-ledger__reason">{tx.reason}</span>
              <span className="wallet-ledger__meta"><span className="wallet-ledger__type">{TX_LABELS[tx.tx_type] ?? "Операция с коинами"}</span>Операция №{tx.id}{tx.shop_request_id && <Link to="/admin/requests">Покупка №{tx.shop_request_id}</Link>}</span>
            </td>
            <td className="wallet-ledger__author"><span>{walletAuthor(tx)}</span>{tx.author_role && <span className="wallet-ledger__role">{ROLE_LABELS[tx.author_role]}</span>}</td>
            <td className="num nowrap"><Amount tx={tx} /></td>
            <td className="num nowrap secondary">{coins(tx.balance_after)}</td>
          </tr>)}</tbody>
      </table>
    </div>
    <ul className="card-list wallet-ledger-cards">{items.map((tx) => <li className="list-card" key={tx.id}>
        <div className="list-card__head"><Link to={`/admin/wallet?user=${tx.user_id}`}>{tx.full_name}</Link><Amount tx={tx} /></div>
        <p className="wallet-ledger__reason">{tx.reason}</p>
        <div className="wallet-ledger__meta"><span className="wallet-ledger__type">{TX_LABELS[tx.tx_type] ?? "Операция с коинами"}</span></div>
        <dl className="list-card__metrics">
          <div className="list-card__metric"><dt>Дата</dt><dd>{dateTime(tx.created_at)}</dd></div>
          <div className="list-card__metric"><dt>Баланс после</dt><dd>{coins(tx.balance_after)}</dd></div>
          <div className="list-card__metric"><dt>Провёл</dt><dd><Author tx={tx} /></dd></div>
          <div className="list-card__metric"><dt>Операция</dt><dd>№{tx.id}</dd></div>
        </dl>
        {tx.shop_request_id && <Link className="small" to="/admin/requests">Покупка №{tx.shop_request_id}</Link>}
      </li>)}</ul>
  </>;
}

/** Personal history uses only the authenticated account and has no staff links. */
function OwnWalletLedger({ items }: { items: WalletTransaction[] }) {
  return <>
    <div className="table-wrap table-wrap--responsive wallet-ledger wallet-ledger--own">
      <table className="table">
        <thead><tr><th>Дата</th><th>Операция</th><th className="num">Сумма</th><th className="num">Баланс после</th></tr></thead>
        <tbody>{items.map(tx => <tr key={tx.id}>
          <td className="nowrap secondary"><time dateTime={tx.created_at}>{dateTime(tx.created_at)}</time></td>
          <td className="wallet-ledger__operation"><span className="wallet-ledger__reason">{tx.reason}</span><span className="wallet-ledger__meta"><span className="wallet-ledger__type">{TX_LABELS[tx.tx_type] ?? "Операция с коинами"}</span>Операция №{tx.id}{tx.shop_request_id && <span>Покупка №{tx.shop_request_id}</span>}</span></td>
          <td className="num nowrap"><Amount tx={tx} /></td>
          <td className="num nowrap secondary">{coins(tx.balance_after)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="card-list wallet-ledger-cards wallet-ledger-cards--own">{items.map(tx => <li className="list-card" key={tx.id}>
      <div className="list-card__head"><time className="small secondary" dateTime={tx.created_at}>{dateTime(tx.created_at)}</time><Amount tx={tx} /></div>
      <p className="wallet-ledger__reason">{tx.reason}</p>
      <div className="wallet-ledger__meta"><span className="wallet-ledger__type">{TX_LABELS[tx.tx_type] ?? "Операция с коинами"}</span>Операция №{tx.id}{tx.shop_request_id && <span>Покупка №{tx.shop_request_id}</span>}</div>
      <dl className="list-card__metrics"><div className="list-card__metric"><dt>Баланс после</dt><dd>{coins(tx.balance_after)}</dd></div></dl>
    </li>)}</ul>
  </>;
}

export function WalletPage({ administrative = false }: { administrative?: boolean }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [manual, setManual] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const canAdjust = administrative && canManageCoins(user?.role);
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const kind = administrative ? KINDS.find(([value]) => value === params.get("kind"))?.[0] ?? "" : "";
  const dateFrom = administrative ? params.get("from") ?? "" : ""; const dateTo = administrative ? params.get("to") ?? "" : "";
  const range = { date_from: dateFrom, date_to: dateTo };
  const selected = Number(params.get("user")); const userId = administrative && Number.isInteger(selected) && selected > 0 ? selected : undefined;
  const person = useQuery({ queryKey: ["wallet-person", userId], queryFn: ({ signal }) => walletApi.operators({ user_id: userId, size: 1 }, signal), enabled: administrative && Boolean(userId) });
  const selectedOperator = person.data?.items[0];
  const selectedIdentity = userId ? selectedOperator ?? { user_id: userId, full_name: "Выбранный оператор" } : undefined;
  const filters = { page, kind, date_from: dateFrom, date_to: dateTo, user_id: userId };
  const data = useQuery({ queryKey: ["wallet", administrative, filters], queryFn: () => walletApi.report(administrative, filters) });
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params); next.delete("page");
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  };
  const filtered = Boolean(kind || dateFrom || dateTo || userId);
  const summary = data.data?.summary;
  const scopeHint = user?.role === "supervisor" ? "Начисления, списания и полная история коинов операторов ваших групп" : user?.role === "head" || user?.role === "admin" ? "Начисления, списания и полная история коинов всех операторов" : "История доступных вам операций с коинами";
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">{administrative ? "История коинов" : "История операций"}</h1><p className="page-subtitle">{administrative ? scopeHint : "Ваши начисления, покупки, списания и возвраты"}</p></div>{administrative ? canAdjust && <Button variant="primary" onClick={() => setManual(true)}>Начислить / списать</Button> : <Link className="btn btn--m" to="/cabinet#wallet">Кошелёк в кабинете</Link>}</div>
    {administrative && <Card title="Фильтры" action={filtered ? <Button size="s" onClick={() => { setParams({}); setPickerKey((value) => value + 1); }}>Сбросить фильтры</Button> : undefined}><div className="wallet-filters">
      <div className="field"><span className="field__label">Период</span><DateRangePicker ariaLabel="Период операций" value={validDateRange(range) ? range : undefined} onChange={(next) => update({ from: next.date_from, to: next.date_to })} /></div>
      <label className="field"><span className="field__label">Тип операции</span><Select aria-label="Тип операции" value={kind} options={KINDS.map(([value, label]) => ({ value, label }))} onChange={(value) => update({ kind: value })} /></label>
      <CoinOperatorPicker key={pickerKey} selected={selectedIdentity} allowAll onChange={(operator) => update({ user: operator ? String(operator.user_id) : "" })} />
    </div><p className="small secondary wallet-filters__note">Даты периода считаются по UTC, время операций — в вашем часовом поясе. Начисления, списания и возвраты — за выбранные даты; баланс и резерв — на текущий момент.</p>{person.isError && <ErrorState error={person.error} onRetry={() => person.refetch()} />}</Card>}
    {data.isLoading && <Skeleton height={200} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {summary && <>{administrative && <div className="kpi-grid"><KPI label="Коины в обращении" value={coins(summary.balance)} tone="coin" hint={`Доступно ${coins(summary.available)} · в резерве ${coins(summary.reserved)}`} /><KPI label="Начислено" value={coins(summary.awarded)} hint="За выбранные даты" /><KPI label="Потрачено и списано" value={coins(summary.spent)} hint="Покупки и другие списания" /><KPI label="Возвращено" value={`+${coins(summary.refunded)}`} hint="Возвраты из магазина" /></div>}
      <Card title={administrative ? "История операций" : "Мои операции"} subtitle={`${data.data!.history.total} ${plural(data.data!.history.total, "операция", "операции", "операций")}`}>
        {!administrative && <dl className="wallet-history-summary" aria-label="Итоги операций за всё время"><div><dt>Потрачено и списано за всё время</dt><dd>{coins(summary.spent)}</dd></div><div><dt>Возвращено за всё время</dt><dd>+{coins(summary.refunded)}</dd></div></dl>}
        {data.data!.history.items.length > 0 && (administrative ? <WalletLedger items={data.data!.history.items} /> : <OwnWalletLedger items={data.data!.history.items} />)}
        {data.data!.history.items.length === 0 && <EmptyState title={administrative ? "Операций не найдено" : "Операций пока нет"} hint={administrative ? "Измените фильтры или дождитесь первого начисления" : "Здесь появятся ваши начисления, покупки, списания и возвраты"} />}
        <Pagination page={page} size={20} total={data.data!.history.total} onChange={(p) => { const next = new URLSearchParams(params); next.set("page", String(p)); setParams(next); }} />
      </Card></>}
    {canAdjust && manual && <ManualCoinsSheet operator={selectedIdentity} onClose={() => setManual(false)} />}
  </div>;
}
