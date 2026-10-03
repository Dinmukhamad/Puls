import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { admin } from "../api/endpoints";
import { configuration } from "../api/configuration";
import { ApiError } from "../api/client";
import { canManageCoins, walletApi, type CoinRecipients, type ManualCoinsBatch } from "../api/wallet";
import { useAuth } from "../auth/AuthContext";
import { CoinOperatorPicker, type CoinOperatorIdentity } from "./CoinOperatorPicker";
import { validManualCoins } from "./manualCoinsValidation";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, ErrorState, SegmentedControl, Skeleton } from "./ui";
import { coins, signed } from "../utils/format";
import "../pages/wallet.css";

type Direction = "credit" | "debit" | "gratitude";
type RecipientMode = "operators" | "groups" | "all";
type ManualCommand = { direction: "credit" | "debit"; batch: ManualCoinsBatch; count: number; name?: string }
  | { direction: "gratitude"; operator: CoinOperatorIdentity; driverRef: string; requestId: string };
interface ManualCoinsProps { operator?: CoinOperatorIdentity; onClose: () => void }

export function ManualCoinsSheet(props: ManualCoinsProps) {
  const { user } = useAuth();
  if (!canManageCoins(user?.role)) return <Sheet title="Операция с коинами" onClose={props.onClose}><p>Начислять и списывать коины могут супервайзер, руководитель и администратор.</p></Sheet>;
  return <AuthorizedManualCoinsSheet {...props} />;
}

function AuthorizedManualCoinsSheet({ operator, onClose }: ManualCoinsProps) {
  const { user } = useAuth();
  const formId = useId();
  const requestId = useRef(crypto.randomUUID());
  const command = useRef<ManualCommand | null>(null);
  const inFlight = useRef(false);
  const client = useQueryClient(); const toast = useToast();
  const [mode, setMode] = useState<RecipientMode>("operators");
  const [targets, setTargets] = useState<CoinOperatorIdentity[]>(operator ? [operator] : []);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("credit");
  const [driverRef, setDriverRef] = useState("");
  const [amount, setAmount] = useState("10"); const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules });
  const groups = useQuery({ queryKey: ["wallet-groups"], queryFn: ({ signal }) => walletApi.groups(signal), enabled: mode === "groups" && !submitted });
  const target = mode === "operators" && targets.length === 1 ? targets[0] : undefined;
  const person = useQuery({
    queryKey: ["wallet-person", target?.user_id],
    queryFn: ({ signal }) => walletApi.operators({ user_id: target!.user_id, size: 1 }, signal),
    enabled: Boolean(target) && !submitted,
  });
  const balance = person.data?.items[0];
  const selection: CoinRecipients = mode === "all" ? { all_operators: true } : mode === "groups" ? { group_ids: [...groupIds].sort((a, b) => a - b) } : { user_ids: targets.map((item) => item.user_id).sort((a, b) => a - b) };
  const hasSelection = mode === "all" || (mode === "groups" ? groupIds.length > 0 : targets.length > 0);
  const value = Number(amount);
  const maxAmount = Math.min(9999, rules.data?.manual_max_abs_amount ?? 9999);
  const amountValid = Number.isSafeInteger(value) && value > 0 && value <= maxAmount;
  const change = direction === "debit" ? -value : value;
  const preview = useQuery({
    queryKey: ["wallet-preview", selection, change],
    queryFn: ({ signal }) => walletApi.preview(selection, change, signal),
    enabled: !submitted && hasSelection && direction !== "gratitude" && amountValid && Boolean(rules.data),
    staleTime: 0,
  });
  const summary = preview.data;
  const canGratitude = Boolean(target);
  const save = useMutation({
    mutationFn: () => {
      const sent = command.current!;
      return sent.direction === "gratitude"
        ? admin.gratitude(sent.operator.user_id, sent.driverRef, sent.requestId).then((tx) => ({ count: 1, total_amount: tx.amount, transaction_ids: [tx.id] }))
        : walletApi.manualBatch(sent.batch);
    },
    onSuccess: (result) => {
      for (const key of ["coin-progress", "badges", "wallet", "wallet-people", "wallet-person", "wallet-preview", "wallet-groups", "admin-operators", "admin-summary", "dashboard", "transactions", "team-transactions", "team-dashboard", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
      const sent = command.current!;
      if (result.count === 1) toast.success(`${sent.direction === "gratitude" ? sent.operator.full_name : sent.name ?? "Оператор"}: ${signed(result.total_amount)} коинов.`);
      else toast.success(`Операция выполнена для ${result.count} операторов: ${signed(result.total_amount / result.count)} коинов каждому.`);
      onClose();
    },
    onError: (error) => {
      // An uncertain result retains the exact signed selection token and idempotency key.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.body.code !== "conflict") {
        command.current = null;
        requestId.current = crypto.randomUUID();
        setSubmitted(false);
        void preview.refetch();
      }
      if (target) void person.refetch();
    },
    onSettled: () => { inFlight.current = false; },
  });
  const valid = submitted ? Boolean(command.current) : Boolean(rules.data && (direction === "gratitude"
    ? target && balance
    : summary && summary.count > 0 && summary.can_submit && !preview.isFetching && amountValid && validManualCoins(amount, reason, direction, rules.data, summary.min_available ?? undefined)));
  const reasonMin = Math.max(1, rules.data?.manual_reason_min_length ?? 1);
  const changeMode = (next: RecipientMode) => { setMode(next); if (next !== "operators" && direction === "gratitude") setDirection("credit"); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || inFlight.current || save.isPending) return;
    if (!submitted) {
      command.current = direction === "gratitude"
        ? { direction, operator: { ...target! }, driverRef: driverRef.trim(), requestId: requestId.current }
        : { direction, batch: { ...selection, amount: change, reason: reason.trim(), request_id: requestId.current, selection_token: summary!.selection_token }, count: summary!.count, name: target?.full_name };
    }
    inFlight.current = true;
    setSubmitted(true);
    save.mutate();
  };
  return <Sheet title="Операция с коинами" subtitle={target?.full_name} onClose={() => { if (!inFlight.current && !save.isPending) onClose(); }} footer={<Button type="submit" form={formId} variant={direction === "debit" ? "destructive" : "primary"} disabled={!valid || save.isPending}>{save.isPending ? "Проводим…" : submitted ? "Повторить запрос" : direction !== "debit" ? "Начислить" : "Списать"}</Button>}>
    {rules.isLoading && <Skeleton height={120} />}{rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
    <form id={formId} className="stack" onSubmit={submit}>
      <fieldset className="wallet-fieldset stack" disabled={save.isPending || submitted}>
        <SegmentedControl value={mode} onChange={changeMode} label="Получатели коинов" options={[{ value: "operators", label: "Операторы" }, { value: "groups", label: "Группы" }, { value: "all", label: "Все операторы" }]} />
        {mode === "operators" && <CoinOperatorPicker selectedOperators={targets} disabled={save.isPending || submitted} onAdd={(person) => { setTargets((items) => items.some((item) => item.user_id === person.user_id) ? items : [...items, person]); if (direction === "gratitude") setDirection("credit"); }} onRemove={(id) => { setTargets((items) => items.filter((item) => item.user_id !== id)); if (direction === "gratitude") setDirection("credit"); }} />}
        {mode === "groups" && <div className="stack">
          <label className="field"><span className="field__label">Поиск группы</span><input className="input" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Название группы" /></label>
          {groups.isLoading && <Skeleton height={64} />}{groups.isError && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
          <div className="wallet-group-options" role="group" aria-label="Группы операторов">{groups.data?.filter((group) => group.name.toLocaleLowerCase().includes(groupSearch.trim().toLocaleLowerCase())).map((group) => <label className="wallet-group-option" key={group.group_id}><input type="checkbox" checked={groupIds.includes(group.group_id)} onChange={(event) => setGroupIds((ids) => event.target.checked ? [...ids, group.group_id] : ids.filter((id) => id !== group.group_id))} /><span><strong>{group.name}</strong><span className="small secondary">{group.operators_count} операторов</span></span></label>)}</div>
          {groups.isSuccess && groups.data?.length === 0 && <p className="small secondary">Нет доступных групп операторов.</p>}
          <p className="small secondary">Выберите одну или несколько групп. Оператор получит одну операцию, даже если входит в несколько выбранных групп.</p>
        </div>}
        {mode === "all" && <p className="wallet-preview">{user?.role === "supervisor" ? "Выбраны все операторы ваших групп." : "Выбраны все операторы."} Количество и общая сумма показаны ниже перед подтверждением.</p>}
        {target && person.isLoading && <Skeleton height={72} />}
        {person.isError && <ErrorState error={person.error} onRetry={() => person.refetch()} />}
        {target && person.isSuccess && !balance && <p className="field__error">Этот оператор недоступен для операций с коинами. Выберите оператора из своих групп.</p>}
        {balance && target && <dl className="wallet-balance" aria-label="Баланс выбранного оператора"><div><dt>Текущий баланс</dt><dd>{coins(balance.balance)}</dd></div><div><dt>В резерве</dt><dd>{coins(balance.reserved)}</dd></div><div><dt>Доступно</dt><dd>{coins(balance.available)}</dd></div></dl>}
        <SegmentedControl value={direction} onChange={setDirection} label="Направление операции" options={[{ value: "credit", label: "Начислить" }, { value: "debit", label: "Списать" }, ...(canGratitude ? [{ value: "gratitude" as const, label: "Благодарность" }] : [])]} />
        {direction === "gratitude" ? <><p className="small secondary">Благодарность водителя: +{coins(rules.data?.driver_gratitude_bonus ?? 0)} коинов.</p><label className="field"><span className="field__label">Номер водителя или заявки · необязательно</span><input className="input" maxLength={64} value={driverRef} onChange={(event) => setDriverRef(event.target.value)} /></label></> : <>
          <label className="field"><span className="field__label">Количество коинов каждому оператору</span><input className="input" type="number" inputMode="numeric" required min={1} max={maxAmount} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} /><span className="field__note">От 1 до {coins(maxAmount)} каждому оператору за одну операцию</span></label>
          {!submitted && amount !== "" && !amountValid && <p className="field__error">Введите целое число от 1 до {coins(maxAmount)}.</p>}
          <p className="small secondary">{direction === "debit" ? "Списание уменьшит кошелёк. Уровень сохранится; зарезервированные для покупок коины защищены." : "Начисление прибавит коины в кошелёк и в прогресс уровня."}</p>
          <label className="field"><span className="field__label">Причина · обязательно</span><textarea className="input" rows={3} required minLength={reasonMin} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="За что начисляем или списываем коины" /><span className="field__note">Не менее {reasonMin} символов</span></label>
          {!submitted && hasSelection && amountValid && preview.isFetching && <p className="small secondary" role="status">Проверяем получателей и балансы…</p>}
          {!submitted && preview.isError && <ErrorState error={preview.error} onRetry={() => preview.refetch()} />}
          {!submitted && amountValid && summary && !preview.isFetching && <div className="wallet-preview" role="status" aria-label="Предварительный итог операции">
            <p>Получателей: <strong>{summary.count}</strong>. Каждому: <strong>{signed(change)} коинов</strong>. Общая сумма: <strong>{signed(summary.total_amount)} коинов</strong>.</p>
            {summary.count > 0 && <p>{summary.count === 1 ? "Баланс после операции" : "Общий баланс после операции"}: <strong>{coins(summary.balance + summary.total_amount)}</strong>; доступно: <strong>{coins(summary.available + summary.total_amount)}</strong>.</p>}
            {summary.count === 0 && <p className="field__error">В выбранных группах нет доступных операторов.</p>}
            {summary.insufficient_count > 0 && <p className="field__error" role="alert">Недостаточно доступных коинов у {summary.insufficient_count} операторов. У всех выбранных операторов должно быть не менее {coins(value)} доступных коинов. Ничего не будет списано, пока баланс не позволяет выполнить операцию всем.</p>}
          </div>}
        </>}
      </fieldset>
      <p className="small secondary">У каждого оператора операция сохранится в истории с причиной, датой и вашим именем.</p>
      {save.isError && <ErrorState error={save.error} />}
      {save.isError && submitted && <p role="status" className="small secondary">Ответ не подтверждён. Повторите этот запрос: получатели и сумма сохранены, повторная отправка не создаст вторую операцию.</p>}
    </form>
  </Sheet>;
}
