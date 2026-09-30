import { useState } from "react";
import { driverName, type TrainingDriver } from "../drivers/driverData";
import {
  PARTICIPATION, PAYOUT, PROMOS, SOURCES, addToConditionPromo, availablePromos, backdatedErrors, backdatedStatus, connect, findDriver, payOut, profession, promoById, promoLabel, submitBackdated,
  type BackdatedInput, type Participant, type Payout,
} from "./promoData";
import { Chip, Dialog, Empty, FilePicker, FilterActions, Field, Reset, SectionCard, Select, money, ruDate, ruTime, today, useFilters, useNow, usePages, type SectionProps } from "./SectionUi";
import { resetGroup } from "./sectionsStore";

const PAYOUT_TONE: Record<Payout, string> = { waiting: "grey", ready: "green", review: "red", paid: "blue", auto: "navy", error: "pink", none: "lilac" };
const PARTICIPATION_TONE: Record<string, string> = { "Ожидает первой поездки": "amber", "Выполняет условия": "blue", "Условия выполнены": "green", "Не выполнено": "red", "Завершено": "grey" };
const title = (id: string) => promoById(id)?.title ?? id;
function progress(x: Participant) {
  const p = promoById(x.promo);
  if (!p || !p.target) return "—";
  return x.progress ? `${x.progress} / ${p.target}` : x.status === "Ожидает первой поездки" ? "ожидает первой поездки" : `0 / ${p.target}`;
}

/** «Подключение к акции»: find the driver by account, see his promotions and what can still be connected. */
export function PromoConnect({ state, update, drivers, employee, notify, openDriver }: SectionProps) {
  const [draft, setDraft] = useState(""), [account, setAccount] = useState(""), [error, setError] = useState(""), [joined, setJoined] = useState("");
  const now = useNow(30_000);
  const driver = account ? findDriver(drivers, account) : undefined;
  const history = driver ? state.participants.filter(x => x.account === driver.account).sort((a, b) => b.connectedAt.localeCompare(a.connectedAt)) : [];
  const available = driver ? availablePromos(driver, state.participants, now) : [];
  function join(d: TrainingDriver, promo: string) {
    try {
      const at = new Date().toISOString(), id = state.nextId;
      const row = connect(state.participants, d, promo, employee, at, id);
      update(s => ({ ...s, nextId: s.nextId + 1, participants: [row, ...s.participants] }));
      const text = `${driverName(d)} подключён(а) к акции «${title(promo)}» до ${ruDate(row.until)}.`;
      setError(""); setJoined(text); notify(text);
    } catch (e) { setError((e as Error).message); }
  }
  return <SectionCard title="Акции — подключение водителя" icon="★" coach="promo-connect">
    <form className="sec-inline" data-coach="promo-search" onSubmit={e => { e.preventDefault(); setAccount(draft.trim()); setError(""); setJoined(""); }}>
      <label className="sec-inline-label" htmlFor="promo-account">ID водителя (аккаунт)</label>
      <input id="promo-account" value={draft} onChange={e => setDraft(e.target.value)} placeholder="например, 49773269b0e043a7…" spellCheck={false} />
      <button className="crm-primary">🔍 Найти</button>
    </form>
    {account && !driver && <p className="crm-error" role="alert">Водитель с ID «{account}» не найден. Скопируйте account_id из карточки водителя или из Диспетчерской.</p>}
    {error && <p className="crm-error" role="alert">{error}</p>}
    {driver && <>
      <h3 className="sec-subtitle">Данные водителя</h3>
      <dl className="sec-facts" data-coach="promo-driver">
        <div><dt>ФИО</dt><dd><button className="crm-link" onClick={() => openDriver(driver.id)}>{driverName(driver)}</button></dd></div>
        <div><dt>Диспетчерская</dt><dd>{driver.park}</dd></div>
        <div><dt>Текущее условие работы</dt><dd>{driver.conditions}</dd></div>
        <div><dt>Blacklist</dt><dd>Нет</dd></div>
        <div><dt>Телефон</dt><dd>{driver.phone}</dd></div>
        <div><dt>Дата последнего заказа</dt><dd>{driver.orders[3] ? ruDate(driver.updatedAt) : "—"}</dd></div>
        <div><dt>Профессия</dt><dd>{profession(driver)}</dd></div>
        <div><dt>Платный найм</dt><dd>Нет</dd></div>
        <div><dt>Тип сотрудничества</dt><dd>{driver.type}</dd></div>
      </dl>
      <h3 className="sec-subtitle">Акции водителя (текущие и прошлые)</h3>
      <div className="crm-table-scroll" data-coach="promo-history"><table className="crm-table sec-table"><thead><tr><th>Акция</th><th>Условие</th><th>Дата подключения</th><th>Дата завершения</th><th>Прогресс</th><th>Статус участия</th><th>Статус выплаты</th><th>Причина</th></tr></thead>
        <tbody>{history.length ? history.map(x => <tr key={x.id} data-promo={x.promo}><td>{title(x.promo)}</td><td>{promoById(x.promo)?.condition}</td><td>{ruDate(x.connectedAt)}</td><td>{ruDate(x.until)}</td><td>{progress(x)}</td>
          <td><Chip tone={PARTICIPATION_TONE[x.status]}>{x.status}</Chip></td><td><Chip tone={PAYOUT_TONE[x.payout]}>{PAYOUT[x.payout].label}</Chip></td><td>{x.reason || "—"}</td></tr>)
          : <tr><td colSpan={8} className="sec-muted">Водитель ещё не участвовал в акциях.</td></tr>}</tbody></table></div>
      <h3 className="sec-subtitle">Доступные акции для этого водителя</h3>
      {available.length ? <ul className="sec-promos" data-coach="promo-available">{available.map(p => <li key={p.id}><div><strong>{p.title}</strong><span>{p.condition}</span></div>
        <button className="crm-primary" data-coach="promo-join" onClick={() => join(driver, p.id)}>＋ Подключить</button></li>)}</ul>
        : <p className="sec-note" data-coach="promo-none">Для диспетчерской этого водителя сейчас нет подходящих акций.</p>}
      {joined && <p className="sec-success" role="status" data-coach="promo-joined">✓ {joined}</p>}
    </>}
  </SectionCard>;
}

const REGISTRY = { account: "", park: "", promo: "", status: "", payout: "", size: "10", from: "", to: "", endFrom: "", endTo: "", paidFrom: "", paidTo: "", employee: "", reason: "", source: "" };
/** «Реестр участников акций»: the payout statuses decide whether «Пополнить» is pressed. */
export function PromoRegistry({ state, update, drivers, notify }: SectionProps) {
  const f = useFilters(REGISTRY), a = f.applied;
  const parks = [...new Set(state.participants.map(x => x.park))].sort(), employees = [...new Set(state.participants.map(x => x.employee))].sort();
  const inRange = (value: string, from: string, to: string) => (!from || (value && value.slice(0, 10) >= from)) && (!to || (value && value.slice(0, 10) <= to));
  const rows = state.participants.filter(x => (!a.account || x.account.includes(a.account.trim().toLowerCase())) && (!a.park || x.park === a.park) && (!a.promo || x.promo === a.promo) && (!a.status || x.status === a.status)
    && (!a.payout || PAYOUT[x.payout as Payout].label === a.payout) && inRange(x.connectedAt, a.from, a.to) && inRange(x.until, a.endFrom, a.endTo) && inRange(x.paidAt, a.paidFrom, a.paidTo)
    && (!a.employee || x.employee === a.employee) && (!a.reason || (a.reason === "Есть причина" ? !!x.reason : !x.reason)) && (!a.source || x.source === a.source))
    .sort((x, y) => y.connectedAt.localeCompare(x.connectedAt));
  const pages = usePages(rows, Number(a.size));
  const [confirm, setConfirm] = useState<Participant | null>(null);
  function pay(x: Participant) {
    try { const paid = payOut(x, new Date().toISOString()); update(s => ({ ...s, participants: s.participants.map(p => p.id === x.id ? paid : p) })); notify(`${x.name}: начислено ${money(paid.amount)} по акции «${title(x.promo)}».`); }
    catch (e) { notify((e as Error).message); }
    setConfirm(null);
  }
  return <SectionCard title="Реестр участников акций" icon="👥" wide coach="promo-registry" actions={<Reset what="Акции" onReset={() => update(s => resetGroup(s, "promo", drivers))} />}>
    <p className="sec-banner" data-coach="registry-banner">ⓘ Автоматическое начисление по акциям приостановлено: деньги уходят только по кнопке «Пополнить» в строке участия. Доступна она, когда система сама подтвердила, что выплата положена. Исключение — акции, где начисление технически уже надёжно (например, «Тенге 2000 при регистрации»): по ним деньги по-прежнему уходят сами, без кнопки.</p>
    <ul className="sec-legend" data-coach="registry-legend">{(Object.keys(PAYOUT) as Payout[]).map(k => <li key={k}><Chip tone={PAYOUT_TONE[k]}>{PAYOUT[k].label}</Chip> {PAYOUT[k].hint}</li>)}</ul>
    <form className="sec-filters" data-coach="registry-filters" onSubmit={e => { e.preventDefault(); f.apply(); pages.reset(); }}>
      <Field label="ID водителя"><input value={f.draft.account} placeholder="account_id" onChange={e => f.set("account", e.target.value)} /></Field>
      <Field label="Диспетчерская"><Select value={f.draft.park} onChange={v => f.set("park", v)} options={parks} /></Field>
      <Field label="Акция"><select value={f.draft.promo} onChange={e => f.set("promo", e.target.value)}><option value="">Все акции</option>{PROMOS.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
      <Field label="Статус участия"><Select value={f.draft.status} onChange={v => f.set("status", v)} options={PARTICIPATION} /></Field>
      <Field label="Статус выплаты"><Select value={f.draft.payout} onChange={v => f.set("payout", v)} options={Object.values(PAYOUT).map(p => p.label)} /></Field>
      <Field label="На стр."><select value={f.draft.size} onChange={e => f.set("size", e.target.value)}>{["10", "25", "50"].map(n => <option key={n}>{n}</option>)}</select></Field>
      <Field label="Подключены с"><input type="date" value={f.draft.from} onChange={e => f.set("from", e.target.value)} /></Field>
      <Field label="по"><input type="date" value={f.draft.to} onChange={e => f.set("to", e.target.value)} /></Field>
      <Field label="Завершены с"><input type="date" value={f.draft.endFrom} onChange={e => f.set("endFrom", e.target.value)} /></Field>
      <Field label="по"><input type="date" value={f.draft.endTo} onChange={e => f.set("endTo", e.target.value)} /></Field>
      <Field label="Начисление с"><input type="date" value={f.draft.paidFrom} onChange={e => f.set("paidFrom", e.target.value)} /></Field>
      <Field label="по"><input type="date" value={f.draft.paidTo} onChange={e => f.set("paidTo", e.target.value)} /></Field>
      <Field label="Сотрудник"><Select value={f.draft.employee} onChange={v => f.set("employee", v)} options={employees} /></Field>
      <Field label="Причина / ошибка"><Select value={f.draft.reason} onChange={v => f.set("reason", v)} options={["Есть причина", "Без причины"]} /></Field>
      <Field label="Источник"><Select value={f.draft.source} onChange={v => f.set("source", v)} options={SOURCES} /></Field>
      <FilterActions onApply={() => { f.apply(); pages.reset(); }} onReset={() => { f.reset(); pages.reset(); }} changed={f.changed} found={rows.length} />
    </form>
    <div className="crm-table-scroll" data-coach="registry-table"><table className="crm-table sec-table sec-registry"><thead><tr><th>ID водителя</th><th>ФИО</th><th>Пригласивший</th><th>Акция</th><th>Условие акции</th><th>Подключён</th><th>Срок до</th><th>Прогресс</th><th>Начисление</th><th>Статус участия</th><th>Причина</th><th>Сумма</th><th>Дата выплаты</th><th>Условие до</th><th>Условие сейчас</th><th>Условие после</th><th>Сотрудник</th><th>Источник</th></tr></thead>
      <tbody>{pages.shown.map(x => { const legend = PAYOUT[x.payout]; return <tr key={x.id} data-payout={x.payout}>
        <td className="sec-mono">{x.account}</td><td className="sec-name">{x.name}</td><td>{x.inviter || "—"}</td><td>{title(x.promo)}</td><td className="sec-small">{promoById(x.promo)?.condition}</td><td>{ruDate(x.connectedAt)}</td><td>{ruDate(x.until)}</td><td>{progress(x)}</td>
        <td className="sec-payout"><Chip tone={PAYOUT_TONE[x.payout]}>{legend.label}</Chip>{legend.button && <button className="sec-pay" data-coach="registry-pay" disabled={legend.button === "off"} title={legend.hint} onClick={() => setConfirm(x)}>⊕ Пополнить</button>}</td>
        <td><Chip tone={PARTICIPATION_TONE[x.status]}>{x.status}</Chip></td><td className="sec-small">{x.reason || "—"}</td><td>{money(x.amount)}</td><td>{ruDate(x.paidAt)}</td><td>{x.before || "—"}</td><td>{x.now || "—"}</td><td>{x.after || "—"}</td><td>{x.employee}</td><td>{x.source}</td>
      </tr>; })}</tbody></table></div>
    {!rows.length && <Empty>Никого не нашли. Проверьте фильтры.</Empty>}
    {pages.pager}
    {confirm && <Dialog title="Начислить выплату по акции?" onClose={() => setConfirm(null)} coach="registry-confirm" footer={<><button className="crm-primary" autoFocus onClick={() => pay(confirm)}>Пополнить {money(promoById(confirm.promo)?.amount ?? 0)}</button><button className="crm-secondary" onClick={() => setConfirm(null)}>Отмена</button></>}>
      <p><strong>{confirm.name}</strong> · {title(confirm.promo)} · {progress(confirm)}</p>
      <p className="sec-muted">{confirm.payout === "error" ? `Прошлое начисление не дошло: ${confirm.reason || "ошибка платёжного шлюза"}. Отправим деньги ещё раз.` : "Система подтвердила выполнение условий. Деньги уйдут водителю сразу."}</p>
    </Dialog>}
  </SectionCard>;
}

const EMPTY_REQUEST: BackdatedInput = { promo: "", account: "", since: "", reason: "", files: [] };
/** «Заявки на добавление задним числом»: the head confirms, then the driver appears in the registry. */
export function PromoBackdated({ state, update, drivers, employee, notify }: SectionProps) {
  const [form, setDraft] = useState(EMPTY_REQUEST), [tried, setTried] = useState(false), [sent, setSent] = useState<number | null>(null);
  const setForm = (next: BackdatedInput) => { setDraft(next); setSent(null); };
  const now = useNow(5000);
  const errors = tried ? backdatedErrors(form, drivers, state.participants, now) : {};
  const f = useFilters({ status: "", promo: "", from: "", to: "" }), a = f.applied;
  const mine = state.backdated.filter(b => b.author === employee && (!a.status || backdatedStatus(b, now) === a.status) && (!a.promo || b.promo === a.promo) && (!a.from || b.submittedAt.slice(0, 10) >= a.from) && (!a.to || b.submittedAt.slice(0, 10) <= a.to));
  const cash = PROMOS.filter(p => p.kind === "money" || p.kind === "auto");
  function send() {
    setTried(true);
    const at = new Date().toISOString(), problems = backdatedErrors(form, drivers, state.participants, at);
    if (Object.keys(problems).length) { setSent(null); return; }
    const driver = findDriver(drivers, form.account)!, id = state.nextId;
    update(s => ({ ...s, nextId: s.nextId + 1, backdated: [submitBackdated(form, driver, employee, at, id), ...s.backdated] }));
    setDraft(EMPTY_REQUEST); setTried(false); setSent(id);
    notify(`Заявка №${id} отправлена руководителю. Ответ придёт в «Мои заявки».`);
  }
  return <SectionCard title="Заявки на добавление задним числом" icon="🕓" wide coach="promo-backdated">
    <p className="sec-note" data-coach="backdated-note">Если водителя вовремя не добавили в акцию, оператор подаёт заявку с датой, с которой тот должен был участвовать, причиной и подтверждениями. Решает руководитель (или аналитик / администратор). После подтверждения водитель появляется в реестре участников — там запускается сверка условий с этой даты и, если они выполнены, начисление кнопкой «Пополнить». Пока только для денежных акций. В учебной CRM руководитель отвечает через две минуты.</p>
    <form className="sec-box" onSubmit={e => { e.preventDefault(); send(); }}>
      <h3>Новая заявка</h3>
      <div className="sec-grid-3">
        <Field label="Акция" error={errors.promo} coach="backdated-promo"><select value={form.promo} onChange={e => setForm({ ...form, promo: e.target.value })}><option value="">— выберите акцию —</option>{cash.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        <Field label="ID водителя" error={errors.account} coach="backdated-account"><input value={form.account} placeholder="account_id из карточки" spellCheck={false} onChange={e => setForm({ ...form, account: e.target.value })} /></Field>
        <Field label="Участник с" error={errors.since} coach="backdated-since"><input type="date" value={form.since} max={today()} onChange={e => setForm({ ...form, since: e.target.value })} /></Field>
      </div>
      <Field label="Причина позднего добавления" error={errors.reason} coach="backdated-reason" wide><textarea rows={2} value={form.reason} maxLength={1000} placeholder="например: водитель написал в WhatsApp 15.09 с просьбой подключить акцию, сообщение осталось необработанным" onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
      <div className="sec-field is-wide"><span>Вложения — скриншоты переписки, рассылки и другие подтверждения (изображения или PDF, до 5 МБ, не больше 10)</span><FilePicker files={form.files} limit={10} accept="image/*,application/pdf" coach="backdated-files" error={errors.files} onChange={files => setForm({ ...form, files })} /></div>
      <button className="crm-primary" data-coach="backdated-send">➤ Отправить на подтверждение руководителю</button>
      {sent && <p className="sec-success" role="status" data-coach="backdated-sent">✓ Заявка №{sent} отправлена. Статус — в таблице «Мои заявки».</p>}
    </form>
    <h3 className="sec-subtitle">Мои заявки</h3>
    <form className="sec-filters sec-filters--row" onSubmit={e => { e.preventDefault(); f.apply(); }}>
      <Field label="Статус"><Select value={f.draft.status} onChange={v => f.set("status", v)} options={["На рассмотрении", "Одобрена", "Отклонена"]} /></Field>
      <Field label="Акция"><select value={f.draft.promo} onChange={e => f.set("promo", e.target.value)}><option value="">Все акции</option>{cash.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
      <Field label="Дата подачи"><input type="date" value={f.draft.from} onChange={e => f.set("from", e.target.value)} /></Field>
      <Field label="по"><input type="date" value={f.draft.to} onChange={e => f.set("to", e.target.value)} /></Field>
      <FilterActions onApply={f.apply} onReset={f.reset} changed={f.changed} />
    </form>
    <div className="crm-table-scroll" data-coach="backdated-list"><table className="crm-table sec-table"><thead><tr><th>№</th><th>Водитель</th><th>Акция</th><th>Участник с</th><th>Причина</th><th>Кто подал</th><th>Подано</th><th>Вложения</th><th>Статус</th><th>Решение</th></tr></thead>
      <tbody>{mine.length ? mine.map(b => { const status = backdatedStatus(b, now); return <tr key={b.id}><td>{b.id}</td><td className="sec-name">{b.name}<small className="sec-mono">{b.account}</small></td><td>{title(b.promo)}</td><td>{ruDate(b.since)}</td><td className="sec-small">{b.reason}</td><td>{b.author}</td><td>{ruTime(b.submittedAt)}</td><td className="sec-small">{b.files.join(", ")}</td>
        <td><Chip tone={status === "Одобрена" ? "green" : status === "Отклонена" ? "red" : "amber"}>{status}</Chip></td><td className="sec-small">{status === "На рассмотрении" ? "Руководитель ещё не ответил" : b.answer}</td></tr>; })
        : <tr><td colSpan={10} className="sec-muted">Заявок нет.</td></tr>}</tbody></table></div>
  </SectionCard>;
}

/** «Смена условий работы»: adding a driver to a promotion that changes his working conditions. */
export function PromoConditions({ state, update, drivers, updateDriver, employee, notify }: SectionProps) {
  const promos = PROMOS.filter(p => p.kind === "condition");
  const [promo, setPromo] = useState(promos[0].id), [account, setAccount] = useState(""), [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const recent = state.conditionAdds.slice(0, 8);
  function add() {
    const driver = findDriver(drivers, account);
    if (!driver) { setResult({ ok: false, text: account.trim() ? `Водитель с ID «${account.trim()}» не найден.` : "Укажите ID аккаунта водителя." }); return; }
    try {
      const at = new Date().toISOString(), id = state.nextId;
      const { row, add: entry, terms } = addToConditionPromo(state.participants, driver, promo, employee, at, id);
      update(s => ({ ...s, nextId: s.nextId + 1, participants: [row, ...s.participants], conditionAdds: [entry, ...s.conditionAdds] }));
      updateDriver(driver.id, d => ({ ...d, conditions: terms, updatedAt: at, history: [{ at, text: `Условия работы: «${terms}» по акции «${title(promo)}» до ${ruDate(row.until)}` }, ...d.history] }));
      setResult({ ok: true, text: `${driverName(driver)} добавлен(а) в акцию «${title(promo)}» до ${ruDate(row.until)}. Условие работы: «${terms}».` });
      setAccount(""); notify(`Условия работы ${driverName(driver)} изменены на «${terms}».`);
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
  }
  return <div className="sec-pair" data-coach="promo-conditions">
    {result && <p className={result.ok ? "sec-success" : "crm-error"} role={result.ok ? "status" : "alert"} data-coach="conditions-result">{result.text}</p>}
    <SectionCard title="Добавление водителя в акцию" icon="🎁">
      <form onSubmit={e => { e.preventDefault(); add(); }} className="sec-stack">
        <Field label="Акция" coach="conditions-promo"><select value={promo} onChange={e => { setPromo(e.target.value); setResult(null); }}>{promos.map(p => <option key={p.id} value={p.id}>{promoLabel(p)}</option>)}</select></Field>
        <Field label="ID аккаунта водителя" coach="conditions-account"><input value={account} placeholder="Например, 9bf8c8cfacad4ba494fd8dd0ffd72bfb" spellCheck={false} onChange={e => { setAccount(e.target.value); setResult(null); }} /><small className="sec-hint">Идентификатор профиля водителя в Диспетчерской.</small></Field>
        <button className="crm-primary" data-coach="conditions-add">＋ Добавить</button>
      </form>
    </SectionCard>
    <SectionCard title="Ваши последние добавления" icon="↺" coach="conditions-recent">
      {recent.length ? <ul className="sec-recent">{recent.map(x => <li key={x.id}><strong>{x.name}</strong><span>{title(x.promo)} · до {ruDate(x.until)}</span><small>{ruTime(x.at)} · было «{x.before}»</small></li>)}</ul> : <p className="sec-muted">Вы ещё никого не добавляли.</p>}
    </SectionCard>
  </div>;
}
