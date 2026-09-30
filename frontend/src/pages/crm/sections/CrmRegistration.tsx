import { useState } from "react";
import { CAR_BRANDS, CAR_COLORS } from "../drivers/driverData";
import {
  ACCOUNT_LIMIT, LICENSE_COUNTRIES, PROFESSIONS, REG_PARKS, REG_STATUSES, REG_TYPES, checkDriver, checkKey, draftProblem, drives, emptyForm, normalizePhone, regErrors, registerDriver, walks,
  type RegErrors, type RegForm, type Registration,
} from "./registrationData";
import { Chip, Empty, FilterActions, Field, Reset, SectionCard, Select, ruDate, ruTime, today, useFilters, usePages, type SectionProps } from "./SectionUi";
import { resetGroup } from "./sectionsStore";

const STATUS_TONE: Record<string, string> = { "Зарегистрирован": "green", "Черновик": "grey", "Ошибка": "red" };
const typeLabel = (r: Pick<Registration, "type">) => r.type === "Регистрация нового СМЗ" ? "СМЗ" : r.type ? "Физическое лицо" : "—";
const fullName = (r: Pick<Registration, "lastName" | "firstName" | "middleName">) => [r.lastName, r.firstName, r.middleName].filter(Boolean).join(" ") || "—";
const LIST = { from: "", to: "", operator: "", park: "", status: "", result: "", profession: "", type: "", account: "", name: "", phone: "", license: "", size: "10" };

/** «Регистрация водителей»: everything the team registered, drafts and registrations that failed. */
export function RegistrationList({ state, update, drivers, go }: SectionProps) {
  const [open, setOpen] = useState(true);
  const f = useFilters(LIST), a = f.applied;
  const operators = [...new Set(state.registrations.map(r => r.operator))].sort();
  const digits = a.phone.replace(/\D/g, "");
  const rows = state.registrations.filter(r => (!a.from || r.createdAt.slice(0, 10) >= a.from) && (!a.to || r.createdAt.slice(0, 10) <= a.to) && (!a.operator || r.operator === a.operator) && (!a.park || r.park === a.park)
    && (!a.status || r.status === a.status) && (!a.result || r.result === a.result) && (!a.profession || r.profession === a.profession) && (!a.type || typeLabel(r) === a.type)
    && (!a.account || r.account.includes(a.account.trim().toLowerCase())) && (!a.name || fullName(r).toLowerCase().includes(a.name.trim().toLowerCase())) && (!digits || r.phone.replace(/\D/g, "").includes(digits))
    && (!a.license || r.license.includes(a.license.trim().toUpperCase()))).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const pages = usePages(rows, Number(a.size));
  return <SectionCard title="Регистрация водителей" icon="☰" wide coach="reg-list" actions={<div className="sec-head-actions"><Reset what="Регистрация водителей" onReset={() => update(s => resetGroup(s, "registration", drivers))} /><button className="crm-primary" data-coach="reg-new" onClick={() => go("view=registration-new")}>＋ Новый водитель</button></div>}>
    <button className="sec-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "⌄" : "›"} Фильтры</button>
    {open && <form className="sec-filters" data-coach="reg-filters" onSubmit={e => { e.preventDefault(); f.apply(); pages.reset(); }}>
      <Field label="Создано с"><input type="date" value={f.draft.from} onChange={e => f.set("from", e.target.value)} /></Field>
      <Field label="Создано по"><input type="date" value={f.draft.to} onChange={e => f.set("to", e.target.value)} /></Field>
      <Field label="Оператор"><Select value={f.draft.operator} onChange={v => f.set("operator", v)} options={operators} /></Field>
      <Field label="Парк"><Select value={f.draft.park} onChange={v => f.set("park", v)} options={REG_PARKS} /></Field>
      <Field label="Статус"><Select value={f.draft.status} onChange={v => f.set("status", v)} options={REG_STATUSES} /></Field>
      <Field label="Итог"><Select value={f.draft.result} onChange={v => f.set("result", v)} options={["Через CRM", "—"]} /></Field>
      <Field label="Профессия"><Select value={f.draft.profession} onChange={v => f.set("profession", v)} options={PROFESSIONS} /></Field>
      <Field label="Тип сотрудничества"><Select value={f.draft.type} onChange={v => f.set("type", v)} options={["Физическое лицо", "СМЗ"]} /></Field>
      <Field label="Аккаунт"><input value={f.draft.account} placeholder="ID в Яндексе" onChange={e => f.set("account", e.target.value)} /></Field>
      <Field label="ФИО водителя"><input value={f.draft.name} placeholder="Фамилия или имя" onChange={e => f.set("name", e.target.value)} /></Field>
      <Field label="Номер телефона"><input value={f.draft.phone} placeholder="Номер телефона" onChange={e => f.set("phone", e.target.value)} /></Field>
      <Field label="Номер В/У"><input value={f.draft.license} placeholder="Номер В/У" onChange={e => f.set("license", e.target.value)} /></Field>
      <Field label="На стр."><select value={f.draft.size} onChange={e => f.set("size", e.target.value)}>{["10", "25", "50"].map(n => <option key={n}>{n}</option>)}</select></Field>
      <FilterActions onApply={() => { f.apply(); pages.reset(); }} onReset={() => { f.reset(); pages.reset(); }} changed={f.changed} found={rows.length} />
    </form>}
    <div className="crm-table-scroll" data-coach="reg-table"><table className="crm-table sec-table"><thead><tr><th>ID</th><th>Дата последнего заказа</th><th>Водитель</th><th>Парк</th><th>Статус</th><th>Итог</th><th>Тип сотрудничества</th><th>Профессия</th><th>Номер телефона</th><th>Номер В/У</th><th>Оператор</th><th>Время создания</th><th>Последняя ошибка</th><th><span className="sec-sr">Действия</span></th></tr></thead>
      <tbody>{pages.shown.map(r => <tr key={r.id} className={r.status === "Ошибка" ? "is-error" : ""}>
        <td>{r.id}</td><td>{r.lastOrder ? ruTime(r.lastOrder) : ""}</td><td className="sec-name">{[r.lastName, r.firstName].filter(Boolean).join(" ") || "—"}</td><td>{r.park || "—"}</td>
        <td><Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip></td><td>{r.result === "Через CRM" ? <Chip tone="green">Через CRM</Chip> : "—"}</td><td>{typeLabel(r)}</td><td className="sec-small">{r.profession || "—"}</td>
        <td className="sec-link-like">{r.phone}</td><td>{r.license || "—"}</td><td>{r.operator}</td><td>{ruTime(r.createdAt)}</td><td className="sec-small sec-text-red">{r.error}</td>
        <td><button className="sec-more" onClick={() => go(`view=registration&reg=${r.id}`)}>👁 Подробнее</button></td>
      </tr>)}</tbody></table></div>
    {!rows.length && <Empty>Никого не нашли. Проверьте фильтры.</Empty>}
    {pages.pager}
  </SectionCard>;
}

/** «Подробнее»: what was sent; a draft goes back into the form, a registered driver opens his account. */
export function RegistrationDetails({ state, drivers, go, openDriver, id }: SectionProps & { id: number }) {
  const r = state.registrations.find(x => x.id === id);
  if (!r) return <div className="crm-empty" role="alert"><p>Регистрация №{id} не найдена.</p><button className="crm-secondary" onClick={() => go("view=registration")}>К списку</button></div>;
  const driver = r.driverId ? drivers.find(d => d.id === r.driverId) : undefined;
  const rows: [string, string][] = [["Тип сотрудничества", r.type || "—"], ...(r.address ? [["Адрес", r.address] as [string, string]] : []), ["Парк", r.park || "—"], ["Профессия", r.profession || "—"], ["ФИО", fullName(r)], ["Номер телефона", r.phone],
    ...(drives(r) ? [["Номер В/У", r.license], ["Страна выдачи", r.licenseCountry], ["Дата выдачи В/У", ruDate(r.licenseIssued)], ["Действует до", ruDate(r.licenseExpires)], ["Автомобиль", [r.car.brand, r.car.model, r.car.color, r.car.year || "", r.car.plate].filter(Boolean).join(", ") || "—"]] as [string, string][] : []),
    ...(walks(r) ? [["День рождения", ruDate(r.birthday)] as [string, string]] : []), ["ИИН", r.iin || "—"], ["Оператор", r.operator], ["Время создания", ruTime(r.createdAt)], ["Аккаунт", r.account || "—"]];
  return <SectionCard title={`Регистрация №${r.id}`} icon="👤" coach="reg-details" actions={<Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip>}>
    {r.error && <p className="crm-error" role="alert">Последняя ошибка: {r.error}</p>}
    <dl className="sec-facts sec-facts--two">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <div className="sec-actions">
      {r.status !== "Зарегистрирован" && <button className="crm-primary" onClick={() => go(`view=registration-new&draft=${r.id}`)}>Продолжить регистрацию</button>}
      {driver && <button className="crm-primary" onClick={() => openDriver(driver.id)}>Открыть учётную запись</button>}
      <button className="crm-secondary" onClick={() => go("view=registration")}>← К списку</button>
    </div>
  </SectionCard>;
}

/** «Новый водитель»: the fields follow the type and profession; «Сохранить» needs a passed check. */
export function RegistrationForm({ state, update, drivers, addDriver, employee, notify, go, draft }: SectionProps & { draft?: number }) {
  const source = draft ? state.registrations.find(r => r.id === draft) : undefined;
  const [form, setForm] = useState<RegForm>(() => source ? { ...emptyForm(), ...source, car: { ...source.car } } : emptyForm());
  const [check, setCheck] = useState<ReturnType<typeof checkDriver> | null>(null), [errors, setErrors] = useState<RegErrors>({}), [problem, setProblem] = useState("");
  const set = <K extends keyof RegForm>(key: K, value: RegForm[K]) => setForm(f => ({ ...f, [key]: value }));
  const setCar = (key: keyof RegForm["car"], value: string | number) => setForm(f => ({ ...f, car: { ...f.car, [key]: value, ...(key === "brand" ? { model: "" } : {}) } }));
  const checked = !!check?.ok && check.key === checkKey(form);
  const years = Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - i);
  function save() {
    const found = regErrors(form, today());
    setErrors(found); setProblem("");
    if (Object.keys(found).length) { setProblem("Проверьте выделенные поля."); return; }
    if (!checked) { setProblem("Сначала нажмите «Проверить водителя»: без проверки водителя не регистрируют."); return; }
    const id = source?.id ?? state.nextId, { registration, driver } = registerDriver({ ...form, phone: normalizePhone(form.phone) }, drivers, employee, new Date().toISOString(), id);
    update(s => ({ ...s, nextId: source ? s.nextId : s.nextId + 1, registrations: [registration, ...s.registrations.filter(r => r.id !== id)] }));
    addDriver(driver);
    // Navigation clears the notice, so it is set after.
    go(`view=registration&reg=${id}`);
    notify(`${registration.lastName} ${registration.firstName} зарегистрирован(а). Учётная запись появилась в «Учётные записи водителей».`);
  }
  function saveDraft() {
    const wrong = draftProblem(form);
    if (wrong) { setProblem(wrong); return; }
    const id = source?.id ?? state.nextId, now = new Date().toISOString();
    const row: Registration = { ...form, phone: normalizePhone(form.phone), id, status: "Черновик", result: "—", operator: employee, createdAt: source?.createdAt ?? now, lastOrder: "", error: "", account: "" };
    update(s => ({ ...s, nextId: source ? s.nextId : s.nextId + 1, registrations: [row, ...s.registrations.filter(r => r.id !== id)] }));
    go("view=registration");
    notify(`Черновик №${id} сохранён. Продолжить можно из списка регистраций.`);
  }
  const input = (key: "lastName" | "firstName" | "middleName" | "address" | "license", label: string, placeholder = label) => <Field label={label} error={key === "middleName" ? undefined : errors[key]}><input value={form[key]} placeholder={placeholder} onChange={e => set(key, key === "license" ? e.target.value.toUpperCase() : e.target.value)} /></Field>;
  return <section className="crm-panel sec-card sec-reg" data-coach="reg-form">
    <div className="sec-head"><h2><span aria-hidden="true">＋</span> Новый водитель{source && <small> · черновик №{source.id}</small>}</h2></div>
    <form className="sec-body sec-reg-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <h3>Тип сотрудничества</h3>
      <Field label="Тип сотрудничества" error={errors.type} coach="reg-type"><select value={form.type} onChange={e => set("type", e.target.value as RegForm["type"])}><option value="">Выберите тип сотрудничества</option>{REG_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      {form.type === "Регистрация нового СМЗ" && <div data-coach="reg-address">{input("address", "Адрес")}</div>}
      <h3>Детали</h3>
      <Field label="Парк" error={errors.park} coach="reg-park"><select value={form.park} onChange={e => set("park", e.target.value)}><option value="">Парк</option>{REG_PARKS.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Профессия" error={errors.profession} coach="reg-profession"><select value={form.profession} onChange={e => set("profession", e.target.value as RegForm["profession"])}><option value="">Профессия</option>{PROFESSIONS.map(p => <option key={p}>{p}</option>)}</select></Field>
      <div data-coach="reg-names">{input("lastName", "Фамилия")}{input("firstName", "Имя")}{input("middleName", "Отчество")}</div>
      <div data-coach="reg-phone"><Field label="Номер телефона" error={errors.phone}><input value={form.phone} inputMode="tel" onChange={e => set("phone", e.target.value)} /></Field></div>
      <div data-coach="reg-docs">
        {drives(form) && <>{input("license", "Номер В/У")}
          <Field label="Страна выдачи"><select value={form.licenseCountry} onChange={e => set("licenseCountry", e.target.value)}>{LICENSE_COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Дата выдачи В/У" error={errors.licenseIssued}><input type="date" value={form.licenseIssued} onChange={e => set("licenseIssued", e.target.value)} /></Field>
          <Field label="Действует до" error={errors.licenseExpires}><input type="date" value={form.licenseExpires} onChange={e => set("licenseExpires", e.target.value)} /></Field></>}
        {walks(form) && <Field label="День рождения" error={errors.birthday}><input type="date" value={form.birthday} max={today()} onChange={e => set("birthday", e.target.value)} /></Field>}
        <Field label="ИИН" error={errors.iin}><input value={form.iin} inputMode="numeric" maxLength={12} placeholder="ИИН" onChange={e => set("iin", e.target.value.replace(/\D/g, ""))} /></Field>
        {drives(form) && <Field label="Лимит по счёту"><span className="sec-locked"><input value={ACCOUNT_LIMIT} readOnly disabled /><i aria-hidden="true">✓</i></span></Field>}
      </div>
      {drives(form) && <div data-coach="reg-car"><h3>Автомобиль</h3>
        <Field label="Марка авто" error={errors.brand}><select value={form.car.brand} onChange={e => setCar("brand", e.target.value)}><option value="">Марка авто</option>{Object.keys(CAR_BRANDS).map(b => <option key={b}>{b}</option>)}</select></Field>
        <Field label="Модель" error={errors.model}><select value={form.car.model} disabled={!form.car.brand} onChange={e => setCar("model", e.target.value)}><option value="">Модель</option>{(CAR_BRANDS[form.car.brand] ?? []).map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Цвет" error={errors.color}><select value={form.car.color} onChange={e => setCar("color", e.target.value)}><option value="">Цвет</option>{CAR_COLORS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Год выпуска" error={errors.year}><select value={form.car.year || ""} onChange={e => setCar("year", Number(e.target.value))}><option value="">Год</option>{years.map(y => <option key={y}>{y}</option>)}</select></Field>
        <Field label="Госномер" error={errors.plate}><input value={form.car.plate} placeholder="Например, 803ASD02" onChange={e => setCar("plate", e.target.value.toUpperCase().replace(/\s/g, ""))} /></Field>
      </div>}
      <div className="sec-check-row"><button type="button" className="crm-primary" data-coach="reg-check" onClick={() => setCheck(checkDriver(form, drivers, state.registrations))}>🔍 Проверить водителя</button>
        {check && <p className={check.ok && checked ? "sec-success" : "crm-error"} role="status" data-coach="reg-check-result">{check.ok && !checked ? "Данные изменились после проверки — проверьте водителя ещё раз." : check.text}</p>}</div>
      {problem && <p className="crm-error" role="alert">{problem}</p>}
      <div className="sec-reg-foot"><button type="button" className="crm-secondary" data-coach="reg-draft" onClick={saveDraft}>Сохранить черновик</button>
        <button className="crm-primary" data-coach="reg-save" aria-disabled={!checked} title={checked ? undefined : "Сначала проверьте водителя"}>⤓ Сохранить</button></div>
    </form>
  </section>;
}
