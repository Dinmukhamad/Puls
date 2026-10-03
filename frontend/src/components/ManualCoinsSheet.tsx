import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { admin } from "../api/endpoints";
import { configuration } from "../api/configuration";
import { ApiError } from "../api/client";
import { canManageCoins, walletApi } from "../api/wallet";
import { useAuth } from "../auth/AuthContext";
import { CoinOperatorPicker, type CoinOperatorIdentity } from "./CoinOperatorPicker";
import { validManualCoins } from "./manualCoinsValidation";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, ErrorState, SegmentedControl, Skeleton } from "./ui";
import { coins, signed } from "../utils/format";
import "../pages/wallet.css";

type Direction = "credit" | "debit" | "gratitude";
interface ManualCommand {
  operator: CoinOperatorIdentity;
  direction: Direction;
  amount: number;
  reason: string;
  correction: boolean;
  driverRef: string;
  requestId: string;
}
interface ManualCoinsProps { operator?: CoinOperatorIdentity; onClose: () => void }

export function ManualCoinsSheet(props: ManualCoinsProps) {
  const { user } = useAuth();
  if (!canManageCoins(user?.role)) return <Sheet title="Операция с коинами" onClose={props.onClose}><p>Начислять и списывать коины могут супервайзер, руководитель и администратор.</p></Sheet>;
  return <AuthorizedManualCoinsSheet {...props} />;
}

function AuthorizedManualCoinsSheet({ operator, onClose }: ManualCoinsProps) {
  const formId = useId();
  const requestId = useRef(crypto.randomUUID());
  const command = useRef<ManualCommand | null>(null);
  const inFlight = useRef(false);
  const client = useQueryClient(); const toast = useToast();
  const [target, setTarget] = useState(operator);
  const [direction, setDirection] = useState<Direction>("credit");
  const [correction, setCorrection] = useState(false);
  const [driverRef, setDriverRef] = useState("");
  const [amount, setAmount] = useState("10"); const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules });
  const person = useQuery({
    queryKey: ["wallet-person", target?.user_id],
    queryFn: ({ signal }) => walletApi.operators({ user_id: target!.user_id, size: 1 }, signal),
    enabled: Boolean(target),
  });
  const balance = person.data?.items[0];
  const save = useMutation({
    mutationFn: () => {
      const sent = command.current!;
      return sent.direction === "gratitude"
        ? admin.gratitude(sent.operator.user_id, sent.driverRef, sent.requestId)
        : admin.manualCoins(sent.operator.user_id, sent.amount, sent.reason, sent.requestId, sent.correction);
    },
    onSuccess: (tx) => {
      for (const key of ["coin-progress", "badges", "wallet", "wallet-people", "wallet-person", "admin-operators", "admin-summary", "dashboard", "transactions", "team-transactions", "team-dashboard", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
      toast.success(`${command.current!.operator.full_name}: ${signed(tx.amount)} коинов. Баланс ${coins(tx.balance_after)}.`);
      onClose();
    },
    onError: (error) => {
      // Only a definitive rejection unlocks editing. An uncertain result retries the saved command.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.body.code !== "conflict") {
        command.current = null;
        requestId.current = crypto.randomUUID();
        setSubmitted(false);
      }
      void person.refetch();
    },
    onSettled: () => { inFlight.current = false; },
  });
  const valid = submitted ? Boolean(command.current) : Boolean(target && balance && rules.data && (direction === "gratitude" || validManualCoins(amount, reason, direction, rules.data, balance.available)));
  const value = Number(amount);
  const change = direction === "gratitude" ? rules.data?.driver_gratitude_bonus ?? 0 : value * (direction === "credit" ? 1 : -1);
  const canPreview = balance && Number.isSafeInteger(change) && (direction === "gratitude" || value > 0 && value <= (rules.data?.manual_max_abs_amount ?? 0)) && (direction !== "debit" || value <= balance.available);
  const reasonMin = Math.max(1, rules.data?.manual_reason_min_length ?? 1);
  const amountMax = direction === "debit" && balance ? Math.min(rules.data?.manual_max_abs_amount ?? 0, balance.available) : rules.data?.manual_max_abs_amount;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || inFlight.current || save.isPending) return;
    if (!submitted) command.current = { operator: { user_id: balance!.user_id, full_name: balance!.full_name }, direction, amount: change, reason: reason.trim(), correction, driverRef: driverRef.trim(), requestId: requestId.current };
    inFlight.current = true;
    setSubmitted(true);
    save.mutate();
  };
  return <Sheet title="Операция с коинами" subtitle={balance?.full_name ?? target?.full_name} onClose={() => { if (!inFlight.current && !save.isPending) onClose(); }} footer={<Button type="submit" form={formId} variant={direction === "debit" ? "destructive" : "primary"} disabled={!valid || save.isPending}>{save.isPending ? "Проводим…" : submitted ? "Повторить запрос" : direction !== "debit" ? "Начислить" : "Списать"}</Button>}>
    {rules.isLoading && <Skeleton height={120} />}{rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
    <form id={formId} className="stack" onSubmit={submit}>
      <fieldset className="wallet-fieldset stack" disabled={save.isPending || submitted}>
        {!operator && <CoinOperatorPicker selected={target} onChange={setTarget} />}
        {target && person.isLoading && <Skeleton height={72} />}
        {person.isError && <ErrorState error={person.error} onRetry={() => person.refetch()} />}
        {target && person.isSuccess && !balance && <p className="field__error">Этот оператор недоступен для операций с коинами. Выберите оператора из своих групп.</p>}
        {balance && <dl className="wallet-balance" aria-label="Баланс выбранного оператора"><div><dt>Текущий баланс</dt><dd>{coins(balance.balance)}</dd></div><div><dt>В резерве</dt><dd>{coins(balance.reserved)}</dd></div><div><dt>Доступно</dt><dd>{coins(balance.available)}</dd></div></dl>}
        <SegmentedControl value={direction} onChange={setDirection} label="Направление операции" options={[{ value: "credit", label: "Начислить" }, { value: "debit", label: "Списать" }, { value: "gratitude", label: "Благодарность" }]} />
        {direction === "gratitude" ? <><p className="small secondary">Благодарность водителя: +{coins(rules.data?.driver_gratitude_bonus ?? 0)} коинов.</p><label className="field"><span className="field__label">Номер водителя или заявки · необязательно</span><input className="input" maxLength={64} value={driverRef} onChange={(event) => setDriverRef(event.target.value)} /></label></> : <>
          <label className="field"><span className="field__label">Количество коинов</span><input className="input" type="number" inputMode="numeric" required min={1} max={amountMax} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} /><span className="field__note">{rules.data && `От 1 до ${coins(rules.data.manual_max_abs_amount)} за одну операцию`}{direction === "debit" && balance ? `; доступно для списания ${coins(balance.available)}` : ""}</span></label>
          {!submitted && direction === "debit" && balance && Number.isFinite(value) && value > balance.available && <p className="field__error" role="alert">Недостаточно доступных коинов. Можно списать не больше {coins(balance.available)}; резерв для покупок сохраняется.</p>}
          <label className="row"><input type="checkbox" checked={correction} onChange={(event) => setCorrection(event.target.checked)} />Исправление ошибочного начисления</label><p className="small secondary">{correction ? "Исправление изменит заработок для уровня и достижения за уровни." : direction === "debit" ? "Обычное списание уменьшит кошелёк. Уровень сохранится." : "Начисление прибавит коины в кошелёк и в прогресс уровня."}</p>
          <label className="field"><span className="field__label">Причина · обязательно</span><textarea className="input" rows={3} required minLength={reasonMin} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="За что начисляем или списываем коины" /><span className="field__note">Не менее {reasonMin} символов</span></label>
        </>}
        {!submitted && canPreview && <p className="wallet-preview" role="status">Изменение: <strong>{signed(change)} коинов</strong>. Баланс после операции: <strong>{coins(balance.balance + change)}</strong>; доступно: <strong>{coins(balance.available + change)}</strong>.</p>}
      </fieldset>
      <p className="small secondary">Операция сохранится в истории с причиной, датой и вашим именем.</p>
      {save.isError && <ErrorState error={save.error} />}
      {save.isError && submitted && <p role="status" className="small secondary">Ответ не подтверждён. Повторите этот запрос: повторная отправка не создаст вторую операцию.</p>}
    </form>
  </Sheet>;
}
