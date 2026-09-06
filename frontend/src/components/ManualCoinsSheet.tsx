import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { lookups } from "../api/access";
import { admin } from "../api/endpoints";
import { configuration } from "../api/configuration";
import { ApiError } from "../api/client";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, ErrorState, SegmentedControl, Skeleton } from "./ui";
import { coins, signed } from "../utils/format";
import "../pages/wallet.css";

export function ManualCoinsSheet({ operator, onClose }: { operator?: { user_id: number; full_name: string }; onClose: () => void }) {
  const formId = useId();
  const requestId = useRef(crypto.randomUUID());
  const client = useQueryClient(); const toast = useToast();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(operator);
  const [direction, setDirection] = useState<"credit" | "debit" | "gratitude">("credit");
  const [driverRef, setDriverRef] = useState("");
  const [amount, setAmount] = useState("10"); const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules });
  const people = useQuery({ queryKey: ["wallet-people", search], queryFn: () => lookups.operators({ search, size: 100 }), enabled: !operator });
  const save = useMutation({
    mutationFn: () => direction === "gratitude"
      ? admin.gratitude(target!.user_id, driverRef.trim(), requestId.current)
      : admin.manualCoins(target!.user_id, Number(amount) * (direction === "credit" ? 1 : -1), reason.trim(), requestId.current),
    onSuccess: (tx) => {
      for (const key of ["wallet", "admin-operators", "admin-summary", "dashboard", "transactions", "team-transactions", "team-dashboard", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
      toast.success(`${target!.full_name}: ${signed(tx.amount)} коинов. Баланс ${coins(tx.balance_after)}.`);
      onClose();
    },
    onError: (error) => {
      // Definitive validation failures can be edited; uncertain network results retain the exact request.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.body.code !== "conflict") setSubmitted(false);
    },
  });
  const valid = target && rules.data && (direction === "gratitude" || (Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= rules.data.manual_max_abs_amount && reason.trim().length >= rules.data.manual_reason_min_length));
  const submit = (event: FormEvent) => { event.preventDefault(); if (valid && !save.isPending) { setSubmitted(true); save.mutate(); } };
  return <Sheet title="Операция с коинами" subtitle={target?.full_name} onClose={() => { if (!save.isPending) onClose(); }} footer={<Button type="submit" form={formId} variant={direction === "debit" ? "destructive" : "primary"} disabled={!valid || save.isPending}>{save.isPending ? "Проводим…" : submitted ? "Повторить запрос" : direction !== "debit" ? "Начислить" : "Списать"}</Button>}>
    {rules.isLoading && <Skeleton height={120} />}{rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
    <form id={formId} className="stack" onSubmit={submit}>
      <fieldset className="wallet-fieldset stack" disabled={save.isPending || submitted}>
        {!operator && <><label className="field"><span className="field__label">Поиск оператора</span><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Имя сотрудника" /></label>
          <label className="field"><span className="field__label">Оператор</span><select className="input" required value={target?.user_id ?? ""} onChange={(e) => setTarget(people.data?.items.find((p) => p.user_id === Number(e.target.value)))}><option value="">Выберите сотрудника</option>{target && !people.data?.items.some((p) => p.user_id === target.user_id) && <option value={target.user_id}>{target.full_name}</option>}{people.data?.items.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name} · {p.group_name ?? "Без группы"}</option>)}</select></label>
          {people.isLoading && <Skeleton height={32} />}{people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}{people.data?.total === 0 && <p className="small secondary">Операторы не найдены. Измените запрос.</p>}{(people.data?.total ?? 0) > 100 && <p className="small secondary">Показаны первые 100 сотрудников. Уточните имя для поиска.</p>}</>}
        <SegmentedControl value={direction} onChange={setDirection} label="Направление операции" options={[{ value: "credit", label: "Начислить" }, { value: "debit", label: "Списать" }, { value: "gratitude", label: "Благодарность" }]} />
        {direction === "gratitude" ? <><p className="small secondary">Благодарность водителя: +{coins(rules.data?.driver_gratitude_bonus ?? 0)} коинов.</p><label className="field"><span className="field__label">Номер водителя или заявки · необязательно</span><input className="input" maxLength={64} value={driverRef} onChange={(e) => setDriverRef(e.target.value)} /></label></> : <><label className="field"><span className="field__label">Количество коинов</span><input className="input" type="number" inputMode="numeric" required min={1} max={rules.data?.manual_max_abs_amount} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="field__note">{rules.data && `От 1 до ${coins(rules.data.manual_max_abs_amount)} за одну операцию`}</span></label>
        <label className="field"><span className="field__label">Причина · обязательно</span><textarea className="input" rows={3} required minLength={rules.data?.manual_reason_min_length} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="За что начисляем или списываем коины" /><span className="field__note">{rules.data && `Не менее ${rules.data.manual_reason_min_length} символов`}</span></label></>}
      </fieldset>
      <p className="small secondary">Операция сохранится в истории с причиной, датой и вашим именем.</p>
      {save.isError && <ErrorState error={save.error} />}
      {save.isError && submitted && <p role="status" className="small secondary">Ответ не подтверждён. Повторите этот запрос: повторная отправка не создаст вторую операцию.</p>}
    </form>
  </Sheet>;
}
