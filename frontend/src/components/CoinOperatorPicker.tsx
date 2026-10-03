import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { walletApi, type WalletOperator } from "../api/wallet";
import { ErrorState } from "./ui";

export type CoinOperatorIdentity = Pick<WalletOperator, "user_id" | "full_name">;

export interface CoinOperatorPickerProps {
  selected?: CoinOperatorIdentity;
  onChange?: (operator: WalletOperator | undefined) => void;
  allowAll?: boolean;
  selectedOperators?: CoinOperatorIdentity[];
  onAdd?: (operator: WalletOperator) => void;
  onRemove?: (userId: number) => void;
  label?: string;
  disabled?: boolean;
}

/** Searching is restricted to the viewer's coin-management scope by the server. */
export function CoinOperatorPicker({ selected, onChange, allowAll = false, selectedOperators, onAdd, onRemove, label = "Поиск оператора", disabled = false }: CoinOperatorPickerProps) {
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listId = `${inputId}-results`;
  const size = 10;
  const trimmedSearch = search.trim();
  const multiple = selectedOperators !== undefined;

  useEffect(() => {
    const timeout = window.setTimeout(() => setSettledSearch(trimmedSearch), 180);
    return () => window.clearTimeout(timeout);
  }, [trimmedSearch]);

  const searchReady = Boolean(trimmedSearch) && settledSearch === trimmedSearch;
  const people = useQuery({
    queryKey: ["wallet-people", settledSearch, page],
    queryFn: ({ signal }) => walletApi.operators({ search: settledSearch, page, size }, signal),
    enabled: open && searchReady && !disabled,
  });
  const selectedIds = useMemo(() => new Set((multiple ? selectedOperators ?? [] : selected ? [selected] : []).map((operator) => operator.user_id)), [multiple, selected, selectedOperators]);
  // Never show a previous query while the next search is waiting for its debounce.
  const options = useMemo(() => searchReady ? (people.data?.items ?? []).filter((operator) => !selectedIds.has(operator.user_id)) : [], [searchReady, people.data?.items, selectedIds]);
  const expanded = open && Boolean(trimmedSearch) && !disabled;
  const activeOperator = expanded ? options[activeIndex] : undefined;

  useEffect(() => { setActiveIndex(-1); }, [settledSearch, page, people.data]);

  const selectOperator = (operator: WalletOperator) => {
    if (multiple) onAdd?.(operator);
    else onChange?.(operator);
    setSearch("");
    setSettledSearch("");
    setPage(1);
    setActiveIndex(-1);
    setOpen(false);
  };

  return <div className="wallet-operator-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label className="field" htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <input
        id={inputId}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={activeOperator ? `${listId}-${activeOperator.user_id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={search}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const value = event.target.value;
          setSearch(value);
          if (!value.trim()) setSettledSearch("");
          setPage(1);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActiveIndex(-1);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (options.length) setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1));
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            if (activeOperator) selectOperator(activeOperator);
          }
        }}
        placeholder="Начните вводить имя или логин"
      />
    </label>
    {expanded && <div className="wallet-operator-picker__results">
      {(!searchReady || people.isLoading) && <p className="small secondary" role="status">Поиск операторов…</p>}
      {searchReady && people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}
      <div id={listId} role="listbox" aria-label="Найденные операторы">
        {options.map((operator, index) => <button
          key={operator.user_id}
          id={`${listId}-${operator.user_id}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`wallet-operator-picker__option${index === activeIndex ? " is-active" : ""}`}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => selectOperator(operator)}
        >
          <span>{operator.full_name}</span>
          <span className="small secondary">{operator.group_name ?? "Без группы"}{!operator.is_active ? " · Неактивен" : ""}</span>
        </button>)}
      </div>
      {searchReady && people.data && options.length === 0 && <p className="small secondary" role="status">{people.data.total > 0 ? "Найденные операторы уже выбраны." : "Операторы не найдены. Измените поиск."}</p>}
      {searchReady && people.data && people.data.total > size && <div className="wallet-operator-picker__pagination">
        <button className="btn btn--secondary" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Назад</button>
        <span className="small secondary">{page} / {Math.ceil(people.data.total / size)}</span>
        <button className="btn btn--secondary" type="button" disabled={page * size >= people.data.total} onClick={() => setPage((current) => current + 1)}>Ещё результаты</button>
      </div>}
    </div>}
    {(multiple ? selectedOperators ?? [] : selected ? [selected] : []).map((operator) => <div className="wallet-operator-picker__selected" key={operator.user_id}>
      <span>{operator.full_name}</span>
      <button type="button" className="wallet-operator-picker__remove" disabled={disabled} aria-label={`Убрать оператора ${operator.full_name}`} onClick={() => multiple ? onRemove?.(operator.user_id) : onChange?.(undefined)}>×</button>
    </div>)}
    {!multiple && !selected && allowAll && <p className="small secondary wallet-operator-picker__hint">История всех доступных операторов. Найдите оператора, чтобы отфильтровать её.</p>}
  </div>;
}
