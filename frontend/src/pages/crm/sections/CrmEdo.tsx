import { useState, type ReactNode } from "react";
import {
  CALL_STATUSES, DOC_STATUSES, OFFICE, OUTCOMES, PERIODS, REACH, REQUEST_IDS, allSigned, edoDashboard, logEdoCall, logProviderCall, managerRating, providerDashboard, refreshEdo,
  type EdoCall, type EdoRow, type ProviderCall, type ProviderRow,
} from "./edoData";
import { Chip, Dialog, Empty, FilterActions, Field, Reset, SectionCard, Select, ruDate, ruTime, today, useFilters, usePages, type SectionProps } from "./SectionUi";
import { resetGroup } from "./sectionsStore";
import type { TrainingEvent } from "./promoData";

const DOC_TONE: Record<string, string> = { "Подписано": "text-green", "Ожидает подписания": "text-amber", "Не сформировано": "text-grey", "Срок подписания истёк": "text-red" };
const Doc = ({ value }: { value: string }) => <span className={`sec-doc sec-${DOC_TONE[value] ?? "text-grey"}`}>{value}</span>;
const period = (value: string) => `${value.slice(5, 7)}.${value.slice(2, 4)}`;

function History({ title, events, onClose }: { title: string; events: TrainingEvent[]; onClose: () => void }) {
  return <Dialog title={`История: ${title}`} onClose={onClose} coach="edo-history-dialog">
    {events.length ? <ol className="sec-history">{events.map((e, i) => <li key={i}><time>{ruTime(e.at)}</time><p>{e.text}</p></li>)}</ol> : <p className="sec-muted">Изменений ещё не было.</p>}
  </Dialog>;
}

const EDO = { period: PERIODS[0], account: "", iin: "", park: "", city: "", provider: "", ecpYes: false, ecpNo: false, ecpExpired: false, docs: "", avrYandex: "", avrPark: "", tripFrom: "", tripTo: "", works: "Работает", calledFrom: "", calledTo: "", callStatus: "", reach: "", office: "", manager: "", priority: "", search: "", size: "25", smz: false, corporate: false, hideUnissued: false };

/** «ЭДО водителей»: documents of the self-employed in Sapar, calls and status updates. */
export function EdoDrivers({ state, update, drivers, employee, notify, go }: SectionProps) {
  const f = useFilters(EDO), a = f.applied;
  const [call, setCall] = useState<EdoRow | null>(null), [history, setHistory] = useState<EdoRow | null>(null), [saved, setSaved] = useState("");
  const rows = state.edo;
  const parks = [...new Set(rows.map(r => r.park))].sort(), cities = [...new Set(rows.map(r => r.city))].sort(), managers = [...new Set(rows.map(r => r.manager).filter(Boolean))].sort();
  const ecp = [a.ecpYes && "Есть ЭЦП", a.ecpNo && "Нет ЭЦП", a.ecpExpired && "Срок действия истек"].filter(Boolean);
  const q = a.search.trim().toLowerCase(), digits = q.replace(/\D/g, "");
  const shown = rows.filter(r => r.period === a.period && (!a.account || r.account.includes(a.account.trim().toLowerCase())) && (!a.iin || r.iin.includes(a.iin.trim())) && (!a.park || r.park === a.park) && (!a.city || r.city === a.city)
    && (!a.provider || (a.provider === "sapar" ? r.provider === "sapar" : r.provider !== "sapar")) && (!ecp.length || ecp.includes(r.ecp)) && (!a.docs || (a.docs === "Все подписаны" ? allSigned(r) : !allSigned(r)))
    && (!a.avrYandex || r.avrYandex === a.avrYandex) && (!a.avrPark || r.avrPark === a.avrPark) && (!a.tripFrom || r.tripTo >= a.tripFrom) && (!a.tripTo || r.tripFrom <= a.tripTo)
    && (!a.works || (a.works === "Работает") === r.works) && (!a.calledFrom || (r.calledAt && r.calledAt.slice(0, 10) >= a.calledFrom)) && (!a.calledTo || (r.calledAt && r.calledAt.slice(0, 10) <= a.calledTo))
    && (!a.callStatus || r.callStatus === a.callStatus) && (!a.reach || r.reach === a.reach) && (!a.office || r.office === a.office) && (!a.manager || r.manager === a.manager) && (!a.priority || (a.priority === "Приоритетные") === r.priority)
    && (!q || r.name.toLowerCase().includes(q) || (digits.length >= 4 && r.phone.includes(digits))) && (!a.smz || r.smz) && (!a.corporate || r.corporate) && (!a.hideUnissued || r.docs === "Да"));
  const pages = usePages(shown, Number(a.size));
  const change = (id: number, next: EdoRow) => update(s => ({ ...s, edo: s.edo.map(r => r.id === id ? next : r) }));
  function refresh(r: EdoRow) {
    const result = refreshEdo(r, new Date().toISOString());
    change(r.id, result.row); notify(result.changed ? `${r.name}: документы подписаны, статус обновлён из Sapar.` : `${r.name}: ${result.row.history[0].text.toLowerCase()}.`);
  }
  const apply = () => { f.apply(); pages.reset(); };
  return <SectionCard title="Электронный документооборот водителей (ЭДО)" icon="☰" wide coach="edo-list" actions={<div className="sec-head-actions"><Reset what="ЭДО" onReset={() => update(s => resetGroup(s, "edo", drivers))} /><button className="crm-secondary" data-coach="edo-dashboard-link" onClick={() => go("view=edo-dashboard")}>📊 Дашборд</button></div>}>
    <form className="sec-filters" data-coach="edo-filters" onSubmit={e => { e.preventDefault(); apply(); }}>
      <Field label="Период (год-месяц)"><select value={f.draft.period} onChange={e => f.set("period", e.target.value)}>{PERIODS.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="ID водителя"><input value={f.draft.account} placeholder="account_id" onChange={e => f.set("account", e.target.value)} /></Field>
      <Field label="ИИН"><input value={f.draft.iin} placeholder="ИИН" inputMode="numeric" onChange={e => f.set("iin", e.target.value)} /></Field>
      <Field label="Парк"><Select value={f.draft.park} onChange={v => f.set("park", v)} options={parks} all="Все парки" /></Field>
      <Field label="Город"><Select value={f.draft.city} onChange={v => f.set("city", v)} options={cities} all="Все города" /></Field>
      <Field label="ЭДО провайдер"><select value={f.draft.provider} onChange={e => f.set("provider", e.target.value)}><option value="">Все</option><option value="sapar">sapar</option><option value="none">Не Sapar</option></select></Field>
      <fieldset className="sec-checks"><legend>Наличие ЭЦП</legend><label><input type="checkbox" checked={f.draft.ecpYes} onChange={e => f.set("ecpYes", e.target.checked)} /> Есть ЭЦП</label><label><input type="checkbox" checked={f.draft.ecpNo} onChange={e => f.set("ecpNo", e.target.checked)} /> Нет ЭЦП</label><label><input type="checkbox" checked={f.draft.ecpExpired} onChange={e => f.set("ecpExpired", e.target.checked)} /> Срок действия истек</label></fieldset>
      <Field label="Статус документов"><Select value={f.draft.docs} onChange={v => f.set("docs", v)} options={["Все подписаны", "Есть неподписанные"]} all="—" /></Field>
      <Field label="АВР Яндекс (Сапар)"><Select value={f.draft.avrYandex} onChange={v => f.set("avrYandex", v)} options={DOC_STATUSES} /></Field>
      <Field label="АВР парка (Сапар)"><Select value={f.draft.avrPark} onChange={v => f.set("avrPark", v)} options={DOC_STATUSES} /></Field>
      <Field label="Поездка с"><input type="date" value={f.draft.tripFrom} onChange={e => f.set("tripFrom", e.target.value)} /></Field>
      <Field label="Поездка по"><input type="date" value={f.draft.tripTo} onChange={e => f.set("tripTo", e.target.value)} /></Field>
      <Field label="Статус работы"><Select value={f.draft.works} onChange={v => f.set("works", v)} options={["Работает", "Не работает"]} /></Field>
      <Field label="Обзвон с"><input type="date" value={f.draft.calledFrom} onChange={e => f.set("calledFrom", e.target.value)} /></Field>
      <Field label="Обзвон по"><input type="date" value={f.draft.calledTo} onChange={e => f.set("calledTo", e.target.value)} /></Field>
      <Field label="Статус контакта"><Select value={f.draft.callStatus} onChange={v => f.set("callStatus", v)} options={CALL_STATUSES} all="—" /></Field>
      <Field label="Статус дозвона"><Select value={f.draft.reach} onChange={v => f.set("reach", v)} options={REACH} all="—" /></Field>
      <Field label="Явка в офис"><Select value={f.draft.office} onChange={v => f.set("office", v)} options={OFFICE.slice(1)} /></Field>
      <Field label="Ответственный"><Select value={f.draft.manager} onChange={v => f.set("manager", v)} options={managers} all="—" /></Field>
      <Field label="Приоритетность"><Select value={f.draft.priority} onChange={v => f.set("priority", v)} options={["Приоритетные", "Обычные"]} /></Field>
      <Field label="Поиск"><input value={f.draft.search} placeholder="ФИО, телефон…" onChange={e => f.set("search", e.target.value)} /></Field>
      <Field label="На стр."><select value={f.draft.size} onChange={e => f.set("size", e.target.value)}>{["10", "25", "50"].map(n => <option key={n}>{n}</option>)}</select></Field>
      <div className="sec-checks sec-checks--row"><label><input type="checkbox" checked={f.draft.smz} onChange={e => f.set("smz", e.target.checked)} /> Только самозанятые</label><label><input type="checkbox" checked={f.draft.corporate} onChange={e => f.set("corporate", e.target.checked)} /> Есть корп. поездки и бонусы</label><label><input type="checkbox" checked={f.draft.hideUnissued} onChange={e => f.set("hideUnissued", e.target.checked)} /> Скрыть невыставленные (Sapar)</label></div>
      <FilterActions onApply={apply} onReset={() => { f.reset(); pages.reset(); }} changed={f.changed} />
    </form>
    {saved && <p className="sec-success" role="status" data-coach="edo-call-saved">✓ {saved}</p>}
    <div className="crm-table-scroll" data-coach="edo-table"><table className="crm-table sec-table sec-edo"><thead><tr><th>Период</th><th>ИИН</th><th>Contractor ID</th><th>ФИО</th><th>Телефон</th><th>Название диспетчерской</th><th>Город</th><th>ЭДО провайдер</th><th>Доки выставлены</th><th>Наличие ЭЦП</th><th>Статус работы</th><th>Явка в офис</th><th>АВР Яндекс (Сапар)</th><th>Обновление статуса</th><th>АВР парка (Сапар)</th><th>Договор таксопарка</th><th>Комиссия таксопарка</th><th>Корп. поездки / Бонусы / Доставка</th><th>Дата обзвона</th><th>Ответственный менеджер</th><th>Статус звонка</th><th>Статус дозвона</th><th>Комментарий</th><th>Дата подписания</th><th><span className="sec-sr">Действия</span></th></tr></thead>
      <tbody>{pages.shown.map((r, i) => <tr key={r.id} data-coach={i === 0 ? "edo-row" : undefined}>
        <td>{period(r.period)}</td><td className="sec-link-like">{r.iin}</td><td className="sec-mono">{r.account}</td><td className="sec-name">{r.name}</td><td className="sec-link-like">{r.phone.replace("+", "")}</td><td>{r.park}</td><td>{r.city}</td>
        <td>{r.provider ? <span className="sec-badge">sapar</span> : "—"}</td><td className={r.docs === "Да" ? "sec-text-green" : r.docs === "Нет" ? "sec-text-red" : ""}>{r.docs}</td><td className="sec-text-grey">{r.ecp}</td><td className={r.works ? "sec-text-green" : "sec-text-red"}>{r.works ? "Работает" : "Не работает"}</td><td>{r.office}</td>
        <td><Doc value={r.avrYandex} /></td><td><button className="sec-refresh" data-coach={i === 0 ? "edo-refresh" : undefined} onClick={() => refresh(r)}>⟳ Обновить статус</button></td><td><Doc value={r.avrPark} /></td><td>{r.contract}</td><td>{r.commission}</td><td>{r.corporate ? <span className="sec-text-green">✓</span> : "—"}</td>
        <td>{r.calledAt ? ruDate(r.calledAt) : "-"}</td><td>{r.manager || "-"}</td><td>{r.callStatus}</td><td>{r.reach}</td><td className="sec-small">{r.comment || "—"}</td><td>{r.signedAt || "-"}</td>
        <td className="sec-row-actions"><button className="sec-icon" aria-label={`Позвонить: ${r.name}`} data-coach={i === 0 ? "edo-call" : undefined} onClick={() => { setSaved(""); setCall(r); }}>📞</button><button className="sec-icon" aria-label={`История: ${r.name}`} data-coach={i === 0 ? "edo-history" : undefined} onClick={() => setHistory(r)}>↺</button></td>
      </tr>)}</tbody></table></div>
    {!shown.length && <Empty>За выбранный период никого не нашли. Проверьте фильтры.</Empty>}
    {pages.pager ?? <div className="sec-pager"><span>{shown.length ? `1 to ${shown.length}` : "0"} of total {shown.length} items.</span></div>}
    {call && <EdoCallDialog row={call} onClose={() => setCall(null)} onSave={input => { const next = logEdoCall(call, input, employee, new Date().toISOString()); change(call.id, next); setCall(null); setSaved(`Звонок ${call.name} сохранён: ${input.reach.toLowerCase()}.`); }} />}
    {history && <History title={history.name} events={state.edo.find(r => r.id === history.id)?.history ?? []} onClose={() => setHistory(null)} />}
  </SectionCard>;
}

function EdoCallDialog({ row, onClose, onSave }: { row: EdoRow; onClose: () => void; onSave: (call: EdoCall) => void }) {
  const [input, setInput] = useState<EdoCall>({ reach: row.reach === "—" ? "—" : row.reach, office: row.office, comment: "" }), [error, setError] = useState("");
  const save = () => { try { logEdoCall(row, input, "", new Date().toISOString()); onSave(input); } catch (e) { setError((e as Error).message); } };
  return <Dialog title={`Звонок: ${row.name}`} onClose={onClose} coach="edo-call-dialog" footer={<><button className="crm-primary" data-coach="edo-call-save" onClick={save}>Сохранить</button><button className="crm-secondary" onClick={onClose}>Отмена</button></>}>
    <p className="sec-muted">{row.phone} · {row.park} · АВР Яндекса: {row.avrYandex}, АВР парка: {row.avrPark}, договор: {row.contract}.</p>
    <p className="sec-note">Напомните водителю подписать документы в Sapar. Без подписанных АВР и договора выплаты задерживаются.</p>
    <Field label="Статус дозвона"><Select value={input.reach === "—" ? "" : input.reach} onChange={v => setInput({ ...input, reach: (v || "—") as EdoCall["reach"] })} options={REACH} all="— выберите —" /></Field>
    <Field label="Явка в офис"><select value={input.office} onChange={e => setInput({ ...input, office: e.target.value as EdoCall["office"] })}>{OFFICE.map(o => <option key={o}>{o}</option>)}</select></Field>
    <Field label="Комментарий"><textarea rows={3} value={input.comment} maxLength={500} placeholder="О чём договорились с водителем" onChange={e => setInput({ ...input, comment: e.target.value })} /></Field>
    {error && <p className="crm-error" role="alert">{error}</p>}
  </Dialog>;
}

const PROVIDER = { period: PERIODS[0], account: "", iin: "", park: "", provider: "", office: "", search: "", callStatus: "", reach: "", outcome: "", requestId: "", changed: "", hideUnissued: false };
/** «Смена провайдера ЭДО»: the call campaign that moves drivers to Sapar. */
export function EdoProvider({ state, update, employee }: SectionProps) {
  const f = useFilters(PROVIDER), a = f.applied;
  const [call, setCall] = useState<ProviderRow | null>(null), [history, setHistory] = useState<ProviderRow | null>(null), [saved, setSaved] = useState("");
  const rows = state.provider, parks = [...new Set(rows.map(r => r.park))].sort(), q = a.search.trim().toLowerCase();
  const shown = rows.filter(r => r.period === a.period && (!a.account || r.account.includes(a.account.trim().toLowerCase())) && (!a.iin || r.iin.includes(a.iin.trim())) && (!a.park || r.park === a.park)
    && (!a.provider || (a.provider === "sapar" ? r.provider === "sapar" : r.provider !== "sapar")) && (!a.office || r.office === a.office) && (!q || r.name.toLowerCase().includes(q) || (q.replace(/\D/g, "").length >= 4 && r.phone.includes(q.replace(/\D/g, ""))))
    && (!a.callStatus || r.callStatus === a.callStatus) && (!a.reach || r.reach === a.reach) && (!a.outcome || r.outcome === a.outcome) && (!a.requestId || r.requestId === a.requestId) && (!a.changed || r.changed === a.changed) && (!a.hideUnissued || !!r.iin));
  const pages = usePages(shown, 25);
  return <SectionCard title="Смена провайдера ЭДО" icon="📞" wide coach="provider-list">
    <form className="sec-filters" data-coach="provider-filters" onSubmit={e => { e.preventDefault(); f.apply(); pages.reset(); }}>
      <Field label="Период (год-месяц)"><select value={f.draft.period} onChange={e => f.set("period", e.target.value)}>{PERIODS.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="ID водителя"><input value={f.draft.account} placeholder="account_id" onChange={e => f.set("account", e.target.value)} /></Field>
      <Field label="ИИН"><input value={f.draft.iin} placeholder="ИИН" onChange={e => f.set("iin", e.target.value)} /></Field>
      <Field label="Парк"><Select value={f.draft.park} onChange={v => f.set("park", v)} options={parks} all="Все парки" /></Field>
      <Field label="ЭДО провайдер"><select value={f.draft.provider} onChange={e => f.set("provider", e.target.value)}><option value="">Все</option><option value="sapar">sapar</option><option value="none">Не Sapar</option></select></Field>
      <Field label="Явка в офис"><Select value={f.draft.office} onChange={v => f.set("office", v)} options={OFFICE.slice(1)} /></Field>
      <Field label="Поиск"><input value={f.draft.search} placeholder="ФИО, телефон…" onChange={e => f.set("search", e.target.value)} /></Field>
      <Field label="Статус звонка"><Select value={f.draft.callStatus} onChange={v => f.set("callStatus", v)} options={CALL_STATUSES} /></Field>
      <Field label="Статус - Дозвон/недозвон"><Select value={f.draft.reach} onChange={v => f.set("reach", v)} options={["Дозвон", "Недозвон"]} /></Field>
      <Field label="Статус - Итог звонка"><Select value={f.draft.outcome} onChange={v => f.set("outcome", v)} options={OUTCOMES} /></Field>
      <Field label="Статус - Запрос ID"><Select value={f.draft.requestId} onChange={v => f.set("requestId", v)} options={REQUEST_IDS.slice(1)} /></Field>
      <Field label="Статус - Провайдер сменили"><Select value={f.draft.changed} onChange={v => f.set("changed", v)} options={["Да", "Нет"]} /></Field>
      <div className="sec-checks sec-checks--row"><label><input type="checkbox" checked={f.draft.hideUnissued} onChange={e => f.set("hideUnissued", e.target.checked)} /> Скрыть невыставленные (Sapar)</label></div>
      <FilterActions onApply={() => { f.apply(); pages.reset(); }} onReset={() => { f.reset(); pages.reset(); }} changed={f.changed} />
    </form>
    {saved && <p className="sec-success" role="status" data-coach="provider-call-saved">✓ {saved}</p>}
    <div className="crm-table-scroll" data-coach="provider-table"><table className="crm-table sec-table sec-edo"><thead><tr><th>Период</th><th>ИИН</th><th>Contractor ID</th><th>ФИО</th><th>Телефон</th><th>Парк</th><th>ЭДО провайдер</th><th>Наличие ЭЦП</th><th>Дата обзвона</th><th>Ответственный менеджер</th><th>Явка в офис</th><th>Статус звонка</th><th>Статус - Дозвон/недозвон</th><th>Статус - Итог звонка</th><th>Статус - Запрос ID</th><th>Статус - Провайдер сменили</th><th><span className="sec-sr">Действия</span></th></tr></thead>
      <tbody>{pages.shown.map(r => <tr key={r.id}>
        <td>{period(r.period)}</td><td className="sec-link-like">{r.iin || "-"}</td><td className="sec-mono">{r.account}</td><td className="sec-name">{r.name}</td><td className="sec-link-like">{r.phone ? r.phone.replace("+", "") : "-"}</td><td>{r.park}</td><td>{r.provider || "-"}</td><td className="sec-text-grey">{r.ecp}</td>
        <td>{r.calledAt ? ruDate(r.calledAt) : "-"}</td><td>{r.manager || "-"}</td><td>{r.office}</td><td>{r.callStatus}</td><td>{r.reach}</td><td>{r.outcome}</td><td>{r.requestId}</td><td className={r.changed === "Да" ? "sec-text-green" : ""}>{r.changed}</td>
        <td className="sec-row-actions"><button className="sec-icon" aria-label={`Позвонить: ${r.name}`} data-coach={r.phone ? "provider-call" : undefined} disabled={!r.phone} title={r.phone ? undefined : "Номер телефона неизвестен"} onClick={() => { setSaved(""); setCall(r); }}>📞</button><button className="sec-icon" aria-label={`История: ${r.name}`} onClick={() => setHistory(r)}>↺</button></td>
      </tr>)}</tbody></table></div>
    {!shown.length && <Empty>Никого не нашли. Проверьте фильтры.</Empty>}
    {pages.pager}
    {call && <ProviderCallDialog row={call} onClose={() => setCall(null)} onSave={input => { const next = logProviderCall(call, input, employee, new Date().toISOString()); update(s => ({ ...s, provider: s.provider.map(r => r.id === call.id ? next : r) })); setCall(null); setSaved(`Звонок ${call.name} сохранён${next.changed === "Да" ? ": провайдер сменили на Sapar" : ""}.`); }} />}
    {history && <History title={history.name} events={state.provider.find(r => r.id === history.id)?.history ?? []} onClose={() => setHistory(null)} />}
  </SectionCard>;
}

function ProviderCallDialog({ row, onClose, onSave }: { row: ProviderRow; onClose: () => void; onSave: (call: ProviderCall) => void }) {
  const [input, setInput] = useState<ProviderCall>({ reach: "Дозвон", outcome: row.outcome, requestId: row.requestId, office: row.office, comment: "" }), [error, setError] = useState("");
  const save = () => { try { logProviderCall(row, input, "", new Date().toISOString()); onSave(input); } catch (e) { setError((e as Error).message); } };
  return <Dialog title={`Звонок: ${row.name}`} onClose={onClose} coach="provider-call-dialog" footer={<><button className="crm-primary" data-coach="provider-call-save" onClick={save}>Сохранить</button><button className="crm-secondary" onClick={onClose}>Отмена</button></>}>
    <p className="sec-muted">{row.phone} · {row.park} · провайдер: {row.provider || "не Sapar"}, {row.ecp}.</p>
    <p className="sec-note">Предложите водителю перейти на Sapar. Если согласен — запросите его ID в Sapar; когда ID получен, провайдер считается сменённым.</p>
    <Field label="Дозвон / недозвон"><select value={input.reach} onChange={e => setInput({ ...input, reach: e.target.value as ProviderCall["reach"] })}><option>Дозвон</option><option>Недозвон</option></select></Field>
    {input.reach === "Дозвон" && <>
      <Field label="Итог звонка"><Select value={input.outcome === "—" ? "" : input.outcome} onChange={v => setInput({ ...input, outcome: (v || "—") as ProviderCall["outcome"] })} options={OUTCOMES} all="— выберите —" /></Field>
      <Field label="Запрос ID"><select value={input.requestId} onChange={e => setInput({ ...input, requestId: e.target.value as ProviderCall["requestId"] })}>{REQUEST_IDS.map(o => <option key={o}>{o}</option>)}</select></Field>
      <Field label="Явка в офис"><select value={input.office} onChange={e => setInput({ ...input, office: e.target.value as ProviderCall["office"] })}>{OFFICE.map(o => <option key={o}>{o}</option>)}</select></Field>
    </>}
    <Field label="Комментарий"><textarea rows={2} value={input.comment} maxLength={500} onChange={e => setInput({ ...input, comment: e.target.value })} /></Field>
    {error && <p className="crm-error" role="alert">{error}</p>}
  </Dialog>;
}

function StatusTable({ title, rows, empty = "Нет данных" }: { title: string; rows: [string, number][]; empty?: string }) {
  return <div className="sec-stat-table"><h4>{title}</h4><table><thead><tr><th>Статус</th><th>Кол-во</th></tr></thead><tbody>{rows.length ? rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>) : <tr><td colSpan={2} className="sec-muted">{empty}</td></tr>}</tbody></table></div>;
}
const Tile = ({ label, value, tone = "", children }: { label: string; value: string | number; tone?: string; children?: ReactNode }) => <div className={`sec-tile ${tone}`}><small>{label}</small><strong>{typeof value === "number" ? value.toLocaleString("en-US") : value}</strong>{children}</div>;
const Meter = ({ percent, tone }: { percent: number; tone: string }) => <span className={`sec-meter sec-meter--${tone}`} role="presentation"><span style={{ width: `${Math.min(100, percent)}%` }} /></span>;

/** «Дашборд смены провайдера»: how far the call campaign has got. */
export function EdoProviderDashboard({ state, go }: SectionProps) {
  const [p, setP] = useState(PERIODS[0]), board = providerDashboard(state.provider, p);
  return <div className="sec-dashboard" data-coach="provider-dashboard">
    <div className="sec-dashboard-head"><h2>Дашборд «Смена провайдера»</h2><label>Период: <select value={p} onChange={e => setP(e.target.value)}>{PERIODS.map(x => <option key={x}>{x}</option>)}</select></label></div>
    <section className="crm-panel sec-card"><div className="sec-head"><h2>📞 Общие метрики</h2></div><div className="sec-tiles" data-coach="provider-metrics">
      <Tile label="Всего контактов" value={board.total} /><Tile label="Кол-во обработанных контактов" value={board.done} tone="is-green" /><Tile label="% выполнения звонков" value={`${board.percent}%`} /></div></section>
    <div className="sec-stat-grid" data-coach="provider-tables">
      <StatusTable title="По статусу обработки" rows={board.byStatus} /><StatusTable title="По статусу дозвона" rows={board.byReach} />
      <StatusTable title="Статус итог звонка" rows={board.byOutcome} /><StatusTable title="Статус запрос ID" rows={board.byRequest} />
      <StatusTable title="Статус провайдер сменили" rows={board.byChanged} />
    </div>
    <button className="crm-secondary" onClick={() => go("view=edo-provider")}>← К списку смены провайдера</button>
  </div>;
}

/** «Дашборд ЭЦП и подписаний»: signed documents, the call campaign and the call centre rating. */
export function EdoDashboard({ state, go }: SectionProps) {
  const [p, setP] = useState(PERIODS[0]), [filters, setFilters] = useState({ corporate: false, priority: false, hideUnissued: false });
  const board = edoDashboard(state.edo, p, filters), rating = managerRating([...state.edo, ...state.provider], today());
  const toggle = (key: keyof typeof filters) => setFilters(f => ({ ...f, [key]: !f[key] }));
  return <div className="sec-dashboard" data-coach="edo-dashboard">
    <div className="sec-dashboard-head"><h2>Дашборд ЭЦП и подписаний</h2><div className="sec-dashboard-filters"><label>Период: <select value={p} onChange={e => setP(e.target.value)}>{PERIODS.map(x => <option key={x}>{x}</option>)}</select></label>
      <label><input type="checkbox" checked={filters.corporate} onChange={() => toggle("corporate")} /> Есть корп. поездки и бонусы</label><label><input type="checkbox" checked={filters.priority} onChange={() => toggle("priority")} /> В приоритете</label><label><input type="checkbox" checked={filters.hideUnissued} onChange={() => toggle("hideUnissued")} /> Скрыть невыставленные (Sapar)</label></div></div>
    <section className="crm-panel sec-card" data-coach="edo-signatures"><div className="sec-head"><h2>● ЭЦП и подписания</h2></div><div className="sec-body">
      <div className="sec-tiles sec-tiles--two"><Tile label="Самозанятых с поездками" value={board.total} /><Tile label="С валидной ЭЦП" value={board.ecp} /></div>
      <div className="sec-tiles">
        <Tile label="% подписания АВР от Яндекса" value={`${board.yandex.percent}%`}><u>{board.yandex.count} / {board.total}</u><Meter percent={board.yandex.percent} tone="blue" /></Tile>
        <Tile label="% подписания АВР от парка" value={`${board.park.percent}%`}><u>{board.park.count} / {board.total}</u><Meter percent={board.park.percent} tone="teal" /></Tile>
        <Tile label="% подписания договоров" value={`${board.contracts.percent}%`}><u>{board.contracts.count} / {board.total}</u><Meter percent={board.contracts.percent} tone="green" /></Tile>
      </div>
      <p className="sec-all"><strong>Все 3 документа подписаны:</strong> {board.all.percent}% ({board.all.count} / {board.total})</p>
      <div className="sec-bar" data-coach="edo-all" role="img" aria-label={`Все три документа подписаны у ${board.all.percent}% водителей, целевой уровень 50%`}><span className={board.all.percent >= 50 ? "is-good" : ""} style={{ width: `${Math.max(board.all.percent, 3)}%` }}>{board.all.percent}%</span><i style={{ left: "50%" }} /></div>
      <p className="sec-target"><Chip tone={board.all.percent >= 50 ? "green" : "pink"}>{board.all.percent >= 50 ? "≥50%" : "<50%"}</Chip> Целевой уровень — 50%</p>
    </div></section>
    <section className="crm-panel sec-card" data-coach="edo-calls"><div className="sec-head"><h2>📞 Обзвон</h2></div><div className="sec-body">
      <div className="sec-tiles"><Tile label="Необходимо прозвонить" value={board.toCall} tone="is-blue"><em>(нет ЭЦП или не Sapar)</em></Tile><Tile label="Обработано контактов" value={board.called} tone="is-green" /><Tile label="% выполнения обзвона" value={`${board.callPercent}%`} /></div>
      <div className="sec-stat-grid"><StatusTable title="По статусу обработки" rows={board.byStatus} /><StatusTable title="По статусу дозвона (обработанные)" rows={board.byReach} /></div>
    </div></section>
    <section className="crm-panel sec-card" data-coach="edo-rating"><div className="sec-head"><h2>👥 Рейтинг менеджеров КЦ</h2></div><div className="crm-table-scroll"><table className="crm-table sec-table sec-rating"><thead><tr><th>#</th><th>Менеджер</th>{rating.days.map(d => <th key={d}>{d.slice(8, 10)}.{d.slice(5, 7)}</th>)}<th className="is-total">Всего</th></tr></thead>
      <tbody>{rating.rows.length ? rating.rows.map((r, i) => <tr key={r.manager}><td>{i + 1}</td><td>{r.manager}</td>{r.perDay.map((n, j) => <td key={j}>{n || ""}</td>)}<td className="is-total">{r.total}</td></tr>) : <tr><td colSpan={10} className="sec-muted">Нет данных для отображения</td></tr>}</tbody></table></div></section>
    <button className="crm-secondary" onClick={() => go("view=edo")}>← К списку ЭДО</button>
  </div>;
}
