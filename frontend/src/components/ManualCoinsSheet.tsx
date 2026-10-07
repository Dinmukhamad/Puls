import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { configuration } from "../api/configuration";
import { canManageCoins, walletApi, type CoinRecipients } from "../api/wallet";
import { useAuth } from "../auth/AuthContext";
import { CoinOperatorPicker, type CoinOperatorIdentity } from "./CoinOperatorPicker";
import { validManualCoins } from "./manualCoinsValidation";
import { clearPendingCoins, confirmManualCoins, needsNewCoinCheck, readPendingCoins, savePendingCoins, type ManualCoinsConfirmation } from "./manualCoinsConfirmation";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, ErrorState, SegmentedControl, Skeleton } from "./ui";
import { coins, signed } from "../utils/format";
import "../pages/wallet.css";
import "./manualCoins.css";

type Direction = "credit" | "debit" | "gratitude";
type RecipientMode = "operators" | "groups" | "all";
interface ManualCoinsProps { operator?: CoinOperatorIdentity; onClose: () => void }

export function ManualCoinsSheet(props: ManualCoinsProps) {
  const { user } = useAuth();
  if (!canManageCoins(user?.role)) return <Sheet title="Операция с коинами" onClose={props.onClose}><p>Начислять и списывать коины могут супервайзер, руководитель и администратор.</p></Sheet>;
  return <AuthorizedManualCoinsSheet {...props} />;
}

function AuthorizedManualCoinsSheet({ operator, onClose }: ManualCoinsProps) {
  const { user } = useAuth();
  const formId = useId();
  const [confirmation, setConfirmation] = useState<ManualCoinsConfirmation | null>(() => readPendingCoins(user!.id));
  const command = useRef<ManualCoinsConfirmation | null>(confirmation);
  const inFlight = useRef(false);
  const client = useQueryClient(); const toast = useToast();
  const [mode, setMode] = useState<RecipientMode>("operators");
  const [targets, setTargets] = useState<CoinOperatorIdentity[]>(operator ? [operator] : []);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("credit");
  const [driverRef, setDriverRef] = useState("");
  const [amount, setAmount] = useState(""); const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(Boolean(confirmation));
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<Error | null>(null);
  const [recipientPage, setRecipientPage] = useState(1);
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
    enabled: !confirmation && !submitted && hasSelection && direction !== "gratitude" && amountValid && Boolean(rules.data),
    staleTime: 0,
  });
  const summary = preview.data;
  const canGratitude = Boolean(target);
  const save = useMutation({
    mutationFn: () => {
      const sent = command.current!.command;
      return sent.direction === "gratitude"
        ? walletApi.gratitude(sent.operator.user_id, sent.driverRef, sent.requestId, command.current!.amount).then((tx) => ({ count: 1, total_amount: tx.amount, transaction_ids: [tx.id] }))
        : walletApi.manualBatch(sent.batch);
    },
    onSuccess: (result) => {
      for (const key of ["coin-progress", "badges", "wallet", "wallet-people", "wallet-person", "wallet-preview", "wallet-groups", "admin-operators", "admin-summary", "dashboard", "transactions", "team-transactions", "team-dashboard", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
      const sent = command.current!;
      clearPendingCoins(user!.id);
      if (result.count === 1) toast.success(`${sent.recipients[0].full_name}: ${signed(result.total_amount)} коинов.`);
      else toast.success(`Операция выполнена для ${result.count} операторов: ${signed(result.total_amount / result.count)} коинов каждому.`);
      onClose();
    },
    onError: (error) => {
      // An uncertain result retains the exact signed selection token and idempotency key.
      if (needsNewCoinCheck(error)) {
        clearPendingCoins(user!.id);
        restoreDraft(command.current!);
        setCheckError(error instanceof Error ? error : new Error("Операция отклонена. Проверьте параметры ещё раз."));
        void rules.refetch();
      }
      if (target) void person.refetch();
    },
    onSettled: () => { inFlight.current = false; },
  });
  const valid = confirmation ? Boolean(command.current) : Boolean(rules.data && (direction === "gratitude"
    ? target && balance && rules.data.driver_gratitude_bonus > 0 && rules.data.driver_gratitude_bonus <= maxAmount
    : summary && summary.count > 0 && summary.can_submit && !preview.isFetching && amountValid && validManualCoins(amount, reason, direction, rules.data, summary.min_available ?? undefined)));
  const reasonMin = Math.max(1, rules.data?.manual_reason_min_length ?? 1);
  const changeMode = (next: RecipientMode) => { setMode(next); if (next !== "operators" && direction === "gratitude") setDirection("credit"); };
  function restoreDraft(checked: ManualCoinsConfirmation) {
    const sent = checked.command;
    setDirection(sent.direction);
    if (sent.direction === "gratitude") {
      setMode("operators"); setTargets([sent.operator]); setDriverRef(sent.driverRef);
    } else {
      setAmount(String(Math.abs(sent.batch.amount))); setReason(sent.batch.reason);
      if ("all_operators" in sent.batch) setMode("all");
      else if ("group_ids" in sent.batch) { setMode("groups"); setGroupIds([...sent.batch.group_ids]); }
      else { setMode("operators"); setTargets(checked.recipients.map((person) => ({ ...person }))); }
    }
    command.current = null; setConfirmation(null); setSubmitted(false); setRecipientPage(1);
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || inFlight.current || save.isPending || checking) return;
    if (!confirmation) {
      inFlight.current = true; setChecking(true); setCheckError(null); save.reset();
      try {
        let checked: ManualCoinsConfirmation;
        if (direction === "gratitude") {
          const result = await rules.refetch({ throwOnError: true });
          const currentRules = result.data!;
          const bonus = currentRules.driver_gratitude_bonus;
          if (!Number.isSafeInteger(bonus) || bonus <= 0 || bonus > Math.min(9999, currentRules.manual_max_abs_amount)) {
            throw new Error("Бонус за благодарность недоступен по текущим правилам. Проверьте настройки начислений.");
          }
          checked = { command: { direction, operator: { ...target! }, driverRef: driverRef.trim(), requestId: crypto.randomUUID() },
            recipients: [{ ...target! }], count: 1, amount: bonus, totalAmount: bonus,
            reason: `Благодарность от водителя${driverRef.trim() ? ` #${driverRef.trim()}` : ""}` };
        } else {
          const result = await preview.refetch({ throwOnError: true });
          checked = confirmManualCoins(selection, reason, result.data!, crypto.randomUUID());
        }
        command.current = checked; setConfirmation(checked); setRecipientPage(1);
      } catch (error) { setCheckError(error instanceof Error ? error : new Error("Не удалось проверить операцию.")); }
      finally { inFlight.current = false; setChecking(false); }
      return;
    }
    if (!submitted && confirmation.expiresAt && Date.parse(confirmation.expiresAt) <= Date.now()) {
      restoreDraft(confirmation); setCheckError(new Error("Подтверждение истекло. Ничего не отправлено. Проверьте операцию ещё раз.")); return;
    }
    inFlight.current = true;
    savePendingCoins(user!.id, confirmation);
    setSubmitted(true);
    save.mutate();
  };
  const footerCount = confirmation?.count ?? (direction === "gratitude" && target ? 1 : amountValid ? summary?.count : undefined);
  const footerAmount = confirmation?.totalAmount ?? (direction === "gratitude" && target ? rules.data?.driver_gratitude_bonus : amountValid ? summary?.total_amount : undefined);
  const finalDirection = confirmation?.command.direction ?? direction;
  const frozenNames = confirmation?.recipients.slice((recipientPage - 1) * 20, recipientPage * 20) ?? [];
  return <Sheet title="Операция с коинами" subtitle={confirmation ? "Шаг 2 из 2 · Подтверждение" : "Шаг 1 из 2 · Параметры"} onClose={() => { if (!inFlight.current && !save.isPending) onClose(); }} footer={<div className="manual-coins-footer">
    <div className="manual-coins-footer__total" aria-live="polite"><span className="small secondary">{footerCount !== undefined ? `${footerCount} операторов` : "Выберите получателей"} · общий итог</span><strong>{footerAmount !== undefined ? `${signed(footerAmount)} коинов` : "—"}</strong></div>
    <div className="manual-coins-footer__actions">
      {confirmation && !submitted && <Button onClick={() => { if (inFlight.current || save.isPending) return; restoreDraft(confirmation); setCheckError(null); save.reset(); }}>Изменить параметры</Button>}
      <Button type="submit" form={formId} variant={confirmation && finalDirection === "debit" ? "destructive" : "primary"} disabled={!valid || checking} aria-disabled={save.isPending || checking || undefined}>
        {save.isPending ? "Проводим…" : checking ? "Проверяем…" : !confirmation ? "Проверить" : `${submitted ? "Повторить: " : ""}${finalDirection === "debit" ? "Списать" : "Начислить"} ${coins(Math.abs(confirmation.totalAmount))} коинов`}
      </Button>
    </div>
  </div>}>
    {rules.isLoading && <Skeleton height={120} />}{rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
    <form id={formId} className="stack" onSubmit={submit}>
      {confirmation ? <section className="manual-coins-confirmation stack" aria-label="Подтверждение операции с коинами">
        <h3>{finalDirection === "debit" ? "Подтвердите списание" : "Подтвердите начисление"}</h3>
        <dl className="manual-coins-confirmation__numbers"><div><dt>Получателей</dt><dd>{confirmation.count}</dd></div><div><dt>Каждому</dt><dd>{signed(confirmation.amount)} коинов</dd></div><div><dt>Общая сумма</dt><dd className="manual-coins-total">{signed(confirmation.totalAmount)} коинов</dd></div></dl>
        <div className="stack"><strong>Причина</strong><p className="manual-coins-confirmation__reason">{confirmation.reason}</p></div>
        <div className="stack"><strong>Операторы · {confirmation.count}</strong><ol className="manual-coins-confirmation__names" start={(recipientPage - 1) * 20 + 1}>{frozenNames.map((person) => <li key={person.user_id}>{person.full_name}</li>)}</ol>
          {confirmation.count > 20 && <div className="manual-coins-confirmation__pagination"><Button disabled={recipientPage === 1} onClick={() => setRecipientPage((page) => page - 1)}>Предыдущие</Button><span className="small secondary">{recipientPage} / {Math.ceil(confirmation.count / 20)}</span><Button disabled={recipientPage * 20 >= confirmation.count} onClick={() => setRecipientPage((page) => page + 1)}>Следующие</Button></div>}
        </div>
        {!submitted && <p className="small secondary">Проверка не изменила кошельки. Операция выполнится после подтверждения. Чтобы изменить сумму, причину или получателей, вернитесь к параметрам и проверьте их снова.</p>}
        {submitted && !save.isPending && <p role="status" className="small secondary">Ответ не подтверждён. Повторите сохранённый запрос: получатели, сумма и причина зафиксированы; повтор не создаст вторую операцию.</p>}
      </section> : <fieldset className="wallet-fieldset stack" disabled={save.isPending || submitted || checking}>
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
        {direction === "gratitude" ? <><p className="small secondary">Благодарность водителя: +{coins(rules.data?.driver_gratitude_bonus ?? 0)} коинов.</p>{rules.data && (rules.data.driver_gratitude_bonus <= 0 || rules.data.driver_gratitude_bonus > maxAmount) && <p className="field__error">Бонус за благодарность недоступен: проверьте настройки бонуса и лимит операции.</p>}<label className="field"><span className="field__label">Номер водителя или заявки · необязательно</span><input className="input" maxLength={64} value={driverRef} onChange={(event) => setDriverRef(event.target.value)} /></label></> : <>
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
      </fieldset>}
      <p className="small secondary">У каждого оператора операция сохранится в истории с причиной, датой и вашим именем.</p>
      {checkError && <div role="alert"><ErrorState error={checkError} /></div>}
      {save.isError && confirmation && <div role="alert"><ErrorState error={save.error} /></div>}
    </form>
  </Sheet>;
}
