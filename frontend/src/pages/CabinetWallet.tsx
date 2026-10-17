import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { walletApi } from "../api/wallet";
import type { BalanceBlock } from "../api/types";
import { AccessLink as Link } from "../components/AccessLink";
import { ArrowDownIcon, ArrowUpIcon, CoinIcon } from "../components/icons";
import { Card, EmptyState, ErrorState, RowsSkeleton } from "../components/ui";
import { coins, dateTime, plural, signed, TX_LABELS } from "../utils/format";

export function WalletCard({ balance }: { balance: BalanceBlock }) {
  useEffect(() => {
    if (window.location.hash === "#wallet") document.getElementById("wallet")?.scrollIntoView({ block: "start" });
  }, []);
  return <Card id="wallet" title={<span className="cabinet-wallet__title"><CoinIcon size={20} />Кошелёк</span>} className="cabinet-wallet" tour="cabinet-wallet">
    <div className="cabinet-wallet__content">
      <div><p className="cabinet-wallet__amount">{coins(balance.available)}</p><p className="small secondary">{plural(balance.available, "коин доступен", "коина доступны", "коинов доступно")}</p></div>
      {balance.reserved > 0 && <p className="cabinet-wallet__reserve">В резерве на покупки: <strong>{coins(balance.reserved)}</strong> коинов. Общий баланс: {coins(balance.balance)}.</p>}
      <p className="small secondary">Обменивайте коины на награды в магазине.</p>
      <div className="cabinet-wallet__actions">
        <Link hideWhenDenied className="btn btn--primary btn--m" to="/shop">В магазин</Link>
        <Link hideWhenDenied className="btn btn--secondary btn--m" to="/wallet">История операций</Link>
      </div>
    </div>
  </Card>;
}

export function RecentTransactions() {
  const filters = { page: 1, kind: "" as const, date_from: "", date_to: "", user_id: undefined };
  const query = useQuery({ queryKey: ["wallet", false, filters], queryFn: () => walletApi.report(false, filters) });
  const items = query.data?.history.items.slice(0, 3);
  return <Card title="Последние операции" className="cabinet-recent" action={<Link hideWhenDenied className="cabinet-text-link" to="/wallet">Все операции →</Link>}>
    {query.isLoading && <RowsSkeleton rows={3} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {items && (items.length > 0 ? <ul className="cabinet-transactions">{items.map(tx => <li className="cabinet-transaction" key={tx.id}>
      <span className={`cabinet-transaction__icon${tx.amount > 0 ? " is-credit" : ""}`} aria-hidden="true">{tx.amount > 0 ? <ArrowDownIcon size={18} /> : <ArrowUpIcon size={18} />}</span>
      <div className="cabinet-transaction__text"><strong>{tx.reason}</strong><span>{TX_LABELS[tx.tx_type] ?? "Операция с коинами"} · {dateTime(tx.created_at)}</span></div>
      <span className={`cabinet-transaction__amount${tx.amount > 0 ? " is-credit" : ""}`}>{signed(tx.amount)}<span>{plural(tx.amount, "коин", "коина", "коинов")}</span></span>
    </li>)}</ul> : <EmptyState title="Здесь появятся ваши операции" hint="Начисления за работу и обучение, покупки и возвраты будут собраны в одной истории." />)}
  </Card>;
}
