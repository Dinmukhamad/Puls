import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { walletApi, type WalletOperator } from "../api/wallet";
import { ErrorState, Pagination, Skeleton } from "./ui";

export type CoinOperatorIdentity = Pick<WalletOperator, "user_id" | "full_name">;

/** The server applies the coin-management scope before searching and paginating. */
export function CoinOperatorPicker({ selected, onChange, allowAll = false }: {
  selected?: CoinOperatorIdentity;
  onChange: (operator: WalletOperator | undefined) => void;
  allowAll?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const size = 20;
  const people = useQuery({
    queryKey: ["wallet-people", search, page],
    queryFn: ({ signal }) => walletApi.operators({ search, page, size }, signal),
  });
  return <div className="wallet-operator-picker">
    <label className="field"><span className="field__label">Поиск оператора</span><input className="input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Имя или логин" /></label>
    <label className="field"><span className="field__label">Оператор</span><select className="input" required={!allowAll} value={selected?.user_id ?? ""} onChange={(event) => onChange(people.data?.items.find((operator) => operator.user_id === Number(event.target.value)))}>
      <option value="">{allowAll ? "Все доступные операторы" : "Выберите оператора"}</option>
      {selected && !people.data?.items.some((operator) => operator.user_id === selected.user_id) && <option value={selected.user_id}>{selected.full_name}</option>}
      {people.data?.items.map((operator) => <option key={operator.user_id} value={operator.user_id}>{operator.full_name} · {operator.group_name ?? "Без группы"}{!operator.is_active ? " · Неактивен" : ""}</option>)}
    </select></label>
    {people.isLoading && <Skeleton height={32} />}
    {people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}
    {people.data?.total === 0 && <p className="small secondary">Операторы не найдены. Измените поиск.</p>}
    {people.data && <Pagination page={page} size={size} total={people.data.total} onChange={setPage} />}
  </div>;
}
