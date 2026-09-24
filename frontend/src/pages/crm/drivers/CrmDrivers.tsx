import { useState, type ReactNode } from "react";
import { crmDate } from "../CrmAppealList";
import {
  CAR_BRANDS, CAR_COLORS, CASH_LIMIT, CONDITIONS, TARIFFS, carTitle, changeCar, driverName, matchesDriver, returnToIndividual, sendCode, setCashLimit,
  transferToSmz, validateCar, validateSmz, type TrainingCar, type TrainingDriver,
} from "./driverData";

export type DriverScreen = "details" | "smz" | "limit" | "car";
type Update = (id: number, change: (driver: TrainingDriver) => TrainingDriver) => void;
interface Shared { drivers: TrainingDriver[]; update: Update; open: (id?: number, screen?: DriverScreen) => void; notify: (text: string) => void }

const moneyFormat = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const fleetLink = (d: TrainingDriver) => `https://fleet.yandex.kz/contractors/${d.account}/details?park_id=e5d80625ccef48bd92f677511109e019&lang=ru`;

export function CrmDrivers({ screen, driverId, onReset, ...shared }: Shared & { screen?: DriverScreen; driverId?: number; onReset: () => void }) {
  const driver = shared.drivers.find(d => d.id === driverId);
  if (driverId && !driver) return <div className="crm-empty" role="alert"><p>Водитель #{driverId} не найден в учебной базе.</p><button className="crm-secondary" onClick={() => shared.open()}>К списку водителей</button></div>;
  if (!driver) return <DriverList {...shared} onReset={onReset} />;
  if (screen === "smz") return <SmzTransfer driver={driver} {...shared} />;
  if (screen === "limit") return <CashLimit driver={driver} {...shared} />;
  if (screen === "car") return <CarEditor driver={driver} {...shared} />;
  return <DriverDetails driver={driver} {...shared} />;
}

function DriverActions({ driver, open, update, notify, compact }: Shared & { driver: TrainingDriver; compact?: boolean }) {
  const [code, setCode] = useState(false);
  return <div className={`drv-actions${compact ? " is-compact" : ""}`}>
    <button className="drv-btn drv-btn--details" onClick={() => open(driver.id, "details")}>👁 Подробнее</button>
    {driver.type === "Физлицо"
      ? <button className="drv-btn drv-btn--smz" onClick={() => open(driver.id, "smz")}>СМЗ</button>
      : <button className="drv-btn drv-btn--individual" title="Учебный сброс: вернуть водителя в физлицо" onClick={() => { if (window.confirm(`Вернуть ${driverName(driver)} в физлицо? Это учебный сброс, чтобы повторить перевод в СМЗ.`)) { update(driver.id, returnToIndividual); notify(`${driverName(driver)} снова физлицо — можно повторить перевод в СМЗ.`); } }}>Физлицо</button>}
    <button className="drv-btn drv-btn--limit" onClick={() => open(driver.id, "limit")}>▣ Лимит</button>
    <button className="drv-btn drv-btn--car" onClick={() => open(driver.id, "car")}>Автомобиль</button>
    <button className="drv-btn drv-btn--code" onClick={() => setCode(true)}>🔑 Код</button>
    {code && <div className="drv-modal" role="dialog" aria-modal="true" aria-labelledby={`code-${driver.id}`} onClick={e => { if (e.target === e.currentTarget) setCode(false); }} onKeyDown={e => { if (e.key === "Escape") setCode(false); }}>
      <div className="drv-modal-card"><h3 id={`code-${driver.id}`}>Отправить код подтверждения</h3>
        <p>Водитель <strong>{driverName(driver)}</strong> получит код для входа в приложение <strong>Такси Про</strong> на номер <strong>{driver.phone}</strong>.</p>
        <p className="drv-muted">Перед отправкой уточните у водителя, что телефон с этим номером у него под рукой.</p>
        <div className="drv-modal-actions"><button className="crm-primary" autoFocus onClick={() => { update(driver.id, d => sendCode(d)); setCode(false); notify(`Код подтверждения отправлен водителю ${driverName(driver)} на ${driver.phone}.`); }}>Отправить код</button><button className="crm-secondary" onClick={() => setCode(false)}>Отмена</button></div>
      </div>
    </div>}
  </div>;
}

function DriverList({ onReset, ...shared }: Shared & { onReset: () => void }) {
  const { drivers } = shared;
  const [draft, setDraft] = useState(""), [search, setSearch] = useState("");
  const [park, setPark] = useState(""), [status, setStatus] = useState(""), [type, setType] = useState(""), [photo, setPhoto] = useState("");
  const parks = [...new Set(drivers.map(d => d.park))].sort();
  const rows = drivers.filter(d => matchesDriver(d, search) && (!park || d.park === park) && (!status || d.status === status) && (!type || d.type === type) && (!photo || d.photoControl === photo));
  const filtered = !!(search || park || status || type || photo);
  const clear = () => { setDraft(""); setSearch(""); setPark(""); setStatus(""); setType(""); setPhoto(""); };
  return <section className="crm-panel drv-panel">
    <div className="crm-panel-heading"><div><h2>☰ Учётные записи водителей</h2><p>Учебная база · {drivers.length} тестовых водителей · изменения видите только вы</p></div><button className="crm-secondary" data-coach="drv-reset" onClick={() => { if (window.confirm("Вернуть всех учебных водителей в исходное состояние?")) { onReset(); clear(); } }}>⟲ Сбросить учебные данные</button></div>
    <form className="drv-filters" onSubmit={e => { e.preventDefault(); setSearch(draft); }}>
      <label><span>Парк</span><select value={park} onChange={e => setPark(e.target.value)}><option value="">—</option>{parks.map(p => <option key={p}>{p}</option>)}</select></label>
      <label><span>Статус</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">—</option>{["Свободен", "Занят", "Офлайн", "Нет данных"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label><span>Тип занятости</span><select value={type} onChange={e => setType(e.target.value)}><option value="">—</option><option>Физлицо</option><option>СМЗ</option></select></label>
      <label><span>Фотоконтроль</span><select value={photo} onChange={e => setPhoto(e.target.value)}><option value="">—</option>{["Пройден", "Требуется", "Нет данных"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="drv-search" data-coach="drv-search"><span>Поиск</span><span className="drv-search-row"><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="ФИО, телефон, аккаунт, авто, позывной или ссылка на водителя" /><button type="submit" aria-label="Найти">🔍</button></span></label>
      <div className="drv-filter-actions"><button type="submit" className="crm-primary">▼ Применить</button><button type="button" className="crm-secondary" disabled={!filtered && !draft} onClick={clear}>Сбросить</button><span>Найдено: <strong>{rows.length}</strong></span></div>
    </form>
    <p className="drv-tip">💡 Быстрее всего искать по ID из ссылки на водителя — это часть адреса между «/contractors/» и «/details». Можно вставить ссылку целиком.</p>
    {rows.length ? <div className="crm-table-scroll"><table className="crm-table drv-table"><thead><tr><th>ID / водитель</th><th>Аккаунт</th><th>Название парка</th><th>Статус</th><th>Тип сотрудничества</th><th><span className="drv-sr">Действия</span></th></tr></thead>
      <tbody>{rows.map(d => <tr key={d.id}>
        <td><button className="crm-ticket-link" onClick={() => shared.open(d.id, "details")}>{d.id}</button><small className="drv-no">№ {d.driverNo}</small></td>
        <td><button className="crm-link drv-account" title={d.account} onClick={() => shared.open(d.id, "details")}>{d.account}</button><small>{driverName(d)}</small></td>
        <td>{d.park}</td>
        <td><span className="drv-state"><span className={`drv-works${d.works ? "" : " is-off"}`} title="Работает">{d.works ? "Да" : "Нет"}</span><DriverStatusBadge status={d.status} /></span><small className="drv-updated">{d.status === "Нет данных" ? "—" : crmDate(d.updatedAt)}</small></td>
        <td>{d.type}{d.cashLimit && <small className="drv-flag">Лимит наличных</small>}{d.photoControl === "Требуется" && <small className="drv-flag drv-flag--warn">Нужен фотоконтроль</small>}</td>
        <td><DriverActions driver={d} {...shared} compact /></td>
      </tr>)}</tbody></table></div>
      : <div className="crm-empty"><span className="crm-empty-icon">⌕</span><h3>Водители не найдены</h3><p>Проверьте запрос: ФИО, телефон, госномер, позывной, ID или ссылку на водителя.</p><button className="crm-secondary" onClick={clear}>Сбросить фильтры</button></div>}
  </section>;
}

function DriverStatusBadge({ status }: { status: TrainingDriver["status"] }) {
  return <span className={`drv-status drv-status--${{ "Офлайн": "offline", "Свободен": "free", "Занят": "busy", "Нет данных": "none" }[status]}`}>{status === "Нет данных" ? status : `● ${status}`}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) { return <div className="drv-row"><span>{label}</span><strong>{children}</strong></div>; }

function DriverDetails({ driver: d, ...shared }: Shared & { driver: TrainingDriver }) {
  const [tab, setTab] = useState<"main" | "history">("main");
  return <div className="drv-details">
    <section className="crm-panel drv-card" data-coach="drv-card">
      <div className="drv-card-head"><h2>👤 {driverName(d)} <small>{d.account}</small></h2><div><button className="crm-secondary" disabled title="В учебной среде диспетчерская недоступна">↗ В Диспетчерской</button><button className="drv-support" onClick={() => shared.notify("В учебной CRM обращение в поддержку Яндекса не отправляется. В работе используйте эту кнопку для связи с поддержкой.")}>✉ Написать в поддержку Яндекса</button></div></div>
      <div className="drv-summary" data-coach="drv-summary"><div><Row label="Телефон">{d.phone}</Row><Row label="Парк">{d.park}</Row></div><div><Row label="Тип сотрудничества">{d.type === "СМЗ" ? "Самозанятый" : "Физическое лицо"}</Row><Row label="Условия работы">{d.conditions}</Row></div><div><Row label="Статус в CRM"><span className={`drv-works${d.works ? "" : " is-off"}`}>{d.works ? "Работает" : "Не работает"}</span></Row><Row label="Дата создания">{crmDate(d.createdAt)}</Row></div></div>
      <div className="drv-tabs" role="tablist"><button role="tab" aria-selected={tab === "main"} onClick={() => setTab("main")}>Общее</button><button role="tab" data-coach="drv-history-tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>История <span>{d.history.length}</span></button></div>
      {tab === "main" ? <>
        <h3 className="drv-section-title">Данные из Диспетчерской <small>Обновлено: {crmDate(d.updatedAt)}</small></h3>
        <div className="drv-tiles" data-coach="drv-tiles">{[["Работает", d.works ? "Да" : "Нет", d.works ? "is-good" : ""], ["Статус", d.status, d.status === "Занят" || d.status === "Свободен" ? "is-good" : ""], ["Состояние счёта", moneyFormat(d.balance), ""], ["Рейтинг", d.rating, d.rating === "Нет данных" ? "is-empty" : ""], ["Наличные заказы", d.cashLimit ? `Лимит ${moneyFormat(CASH_LIMIT)}` : "Поступают", d.cashLimit ? "is-warn" : ""], ["Фотоконтроль", d.photoControl, d.photoControl === "Требуется" ? "is-warn" : d.photoControl === "Пройден" ? "is-good" : "is-empty"]].map(([label, value, tone]) => <div key={label} className={`drv-tile ${tone}`}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="drv-columns">
          <div data-coach="drv-car"><h4>🚗 Автомобиль</h4><Row label="Марка / модель">{carTitle(d.car)}</Row><Row label="Гос. номер">{d.car.plate}</Row><Row label="Год выпуска">{d.car.year}</Row><Row label="Цвет">{d.car.color}</Row><Row label="Тарифы">{d.car.tariffs.join(", ") || "—"}</Row><button className="crm-link" onClick={() => shared.open(d.id, "car")}>Сменить автомобиль</button></div>
          <div data-coach="drv-contacts"><h4>☎ Контакты</h4><Row label="Номер телефона">{d.phone}</Row><Row label="Номер В/У">{d.license}</Row><Row label="Позывной">{d.callsign}</Row><Row label="ИИН">{d.iin || "—"}</Row><Row label="Адрес">{d.address || "—"}</Row></div>
          <div data-coach="drv-extra"><h4>ⓘ Дополнительно</h4><Row label="Лимит по счёту">{moneyFormat(d.balanceLimit)}</Row><Row label="Отправлено кодов">{d.codes}</Row><Row label="Последнее изменение">{crmDate(d.updatedAt)}</Row><Row label="Ссылка на водителя"><a className="drv-link" href={fleetLink(d)} onClick={e => { e.preventDefault(); void navigator.clipboard?.writeText(fleetLink(d)).then(() => shared.notify("Ссылка на водителя скопирована."), () => shared.notify(fleetLink(d))); }}>Копировать</a></Row></div>
        </div>
        <h4 className="drv-orders-title">☰ Заказы</h4><div className="drv-orders">{["за сегодня", "за 7 дней", "за 30 дней", "всего"].map((label, i) => <div key={label}><strong>{d.orders[i]}</strong><span>{label}</span></div>)}</div>
      </> : <ol className="drv-history">{d.history.map((event, i) => <li key={i}><time>{crmDate(event.at)}</time><p>{event.text}</p></li>)}</ol>}
      <div className="drv-card-actions"><DriverActions driver={d} {...shared} /></div>
    </section>
    <aside className="crm-panel drv-photo"><h3>📷 Фотоконтроль</h3><Row label="Статус">{d.photoControl}</Row>
      {d.photoControl === "Требуется" ? <p className="drv-warning">После смены автомобиля водитель должен пройти фотоконтроль автомобиля и техпаспорта в Яндекс Про.</p> : <p className="drv-muted">Фото автомобиля появятся после обновления данных в Диспетчерской.</p>}
      {d.photoControl === "Требуется" && <button className="crm-secondary" onClick={() => { shared.update(d.id, x => ({ ...x, photoControl: "Пройден", history: [{ at: new Date().toISOString(), text: "Фотоконтроль пройден (учебная отметка)" }, ...x.history] })); shared.notify("Фотоконтроль отмечен как пройденный."); }}>Отметить: водитель прошёл фотоконтроль</button>}
    </aside>
  </div>;
}

function FormShell({ title, driver, children, open }: { title: string; driver: TrainingDriver; children: ReactNode; open: Shared["open"] }) {
  return <section className="crm-panel drv-form"><div className="crm-panel-heading"><div><h2>{title}: {driver.account}</h2><p>{driverName(driver)} · ID {driver.id} · {driver.park}</p></div><button className="crm-link" onClick={() => open(driver.id, "details")}>← К карточке водителя</button></div><div className="drv-form-body">{children}</div></section>;
}
function Field({ label, error, children, wide, coach }: { label: string; error?: string; children: ReactNode; wide?: boolean; coach?: string }) {
  return <label className={`drv-field${error ? " has-error" : ""}${wide ? " is-wide" : ""}`} data-coach={coach}><span>{label}</span><div>{children}{error && <small role="alert">{error}</small>}</div></label>;
}

function SmzTransfer({ driver: d, update, open, notify }: Shared & { driver: TrainingDriver }) {
  const [form, setForm] = useState({ lastName: d.lastName, firstName: d.firstName, middleName: d.middleName, address: d.address, iin: d.iin, conditions: "Для всех 2%", balanceLimit: d.balanceLimit });
  const [tried, setTried] = useState(false);
  const errors = tried ? validateSmz(form) : {};
  if (d.type === "СМЗ") return <FormShell title="Перевод водителя в СМЗ" driver={d} open={open}><div className="drv-done"><strong>✓ Водитель уже самозанятый</strong><p>Напомните водителю выйти из аккаунта и снова войти в профиль Яндекс Про, если он ещё этого не сделал.</p><button className="crm-primary" onClick={() => open()}>К списку водителей</button></div></FormShell>;
  const set = (key: keyof typeof form, value: string | number) => setForm(f => ({ ...f, [key]: value }));
  return <FormShell title="Перевод водителя в СМЗ" driver={d} open={open}>
    <form noValidate onSubmit={e => { e.preventDefault(); setTried(true); if (Object.keys(validateSmz(form)).length) return; update(d.id, x => transferToSmz(x, form)); open(); notify(`${driverName(d)} переведён в СМЗ. Скажите водителю выйти из аккаунта и снова войти в профиль Яндекс Про.`); }}>
      <h3 className="drv-form-title">Детали</h3>
      <div className="drv-grid">
        <Field label="Фамилия"><input value={form.lastName} onChange={e => set("lastName", e.target.value)} /></Field>
        <Field label="Водительский стаж с"><input type="date" defaultValue={d.experienceSince} /></Field>
        <Field label="Имя"><input value={form.firstName} onChange={e => set("firstName", e.target.value)} /></Field>
        <Field label="Серия и номер ВУ"><input defaultValue={d.license} /></Field>
        <Field label="Отчество"><input value={form.middleName} onChange={e => set("middleName", e.target.value)} /></Field>
        <Field label="Страна выдачи ВУ"><input defaultValue={d.licenseCountry} /></Field>
        <Field label="Телефон"><input value={d.phone} readOnly disabled /></Field>
        <Field label="Дата выдачи ВУ"><input type="date" defaultValue={d.licenseIssued} /></Field>
        <Field label="Адрес *" error={errors.address}><input value={form.address} placeholder="Укажите адрес прописки" onChange={e => set("address", e.target.value)} autoFocus /></Field>
        <Field label="Действует до"><input type="date" defaultValue={d.licenseExpires} /></Field>
        <Field label="ИИН *" error={errors.iin}><input value={form.iin} inputMode="numeric" maxLength={12} placeholder="12 цифр" onChange={e => set("iin", e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <h3 className="drv-form-title">Условия работы</h3>
      <div className="drv-grid drv-grid--single">
        <Field label="Условия работы" wide><select value={form.conditions} onChange={e => set("conditions", e.target.value)}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Лимит баланса" wide><input type="number" value={form.balanceLimit} onChange={e => set("balanceLimit", Number(e.target.value))} /></Field>
      </div>
      <h3 className="drv-form-title">Выбор автомобиля</h3>
      <div className="drv-car-chip">{d.car.plate} • {carTitle(d.car)} • {d.car.year} • {d.car.color}</div>
      <dl className="drv-car-list">{[["Госномер", d.car.plate], ["Марка", d.car.brand], ["Модель", d.car.model], ["Цвет", d.car.color], ["Год", d.car.year], ["Коробка", d.car.transmission], ["Позывной", d.callsign]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="drv-form-footer"><button className="crm-primary">✓ Перевести в СМЗ</button><button type="button" className="crm-secondary" onClick={() => open()}>Отмена</button><span>После перевода водитель должен выйти из аккаунта и снова зайти в Яндекс Про.</span></div>
    </form>
  </FormShell>;
}

function CashLimit({ driver: d, update, open, notify }: Shared & { driver: TrainingDriver }) {
  return <section className="crm-panel drv-form" data-coach="limit-screen"><div className="crm-panel-heading"><div><h2>▣ Управление наличными заказами</h2><p>{driverName(d)} · ID {d.id}</p></div></div>
    <div className="drv-form-body"><h3 className="drv-form-title">Детали аккаунта</h3>
      <table className="drv-limit-table"><tbody><tr><th>ID аккаунта</th><td>{d.account}</td></tr><tr><th>Диспетчерская (Парк)</th><td>{d.park}</td></tr><tr data-coach="limit-status"><th>Текущий статус лимита</th><td><span className={`drv-limit-badge${d.cashLimit ? " is-on" : ""}`}>{d.cashLimit ? `Включён · ${moneyFormat(CASH_LIMIT)}` : "Отключён"}</span><small>{d.cashLimit ? "Водитель не получает наличные заказы" : "Наличные заказы поступают в обычном режиме"}</small></td></tr></tbody></table>
      <div className="drv-form-footer"><button className="drv-limit-on" data-coach="limit-on" disabled={d.cashLimit} onClick={() => { update(d.id, x => setCashLimit(x, true)); notify(`Лимит ${moneyFormat(CASH_LIMIT)} включён: ${driverName(d)} не получает наличные заказы.`); }}>✓ Включить лимит</button><button className="drv-limit-off" data-coach="limit-off" disabled={!d.cashLimit} onClick={() => { update(d.id, x => setCashLimit(x, false)); notify(`Лимит отключён: ${driverName(d)} снова получает наличные заказы.`); }}>✕ Отключить лимит</button><button className="crm-link" data-coach="limit-back" onClick={() => open()}>Вернуться к поиску</button></div>
    </div></section>;
}

const emptyCar = (): TrainingCar => ({ status: "Работает", brand: "", model: "", color: "", year: 0, owner: "Другое", plate: "", vin: "", body: "", sts: "", callsign: "", transmission: "Неизвестный", wrap: false, lightbox: false, fuel: "Бензин", tariffs: [] });

function CarEditor({ driver: d, update, open, notify }: Shared & { driver: TrainingDriver }) {
  const [mode, setMode] = useState<"current" | "new">("current");
  const [car, setCar] = useState<TrainingCar>({ ...d.car, callsign: d.callsign });
  const [tried, setTried] = useState(false);
  const strict = mode === "new" || car.plate !== d.car.plate, errors = tried ? validateCar(car, strict) : {};
  const set = <K extends keyof TrainingCar>(key: K, value: TrainingCar[K]) => setCar(c => ({ ...c, [key]: value }));
  const switchMode = (next: "current" | "new") => { setMode(next); setTried(false); setCar(next === "new" ? emptyCar() : { ...d.car, callsign: d.callsign }); };
  const years = Array.from({ length: 2026 - 1994 }, (_, i) => 2026 - i);
  return <section className="crm-panel drv-form" data-coach="car-editor"><div className="crm-panel-heading"><div><h2>🚗 Редактор автомобиля водителя: {d.account}</h2><p>{driverName(d)} · сейчас {carTitle(d.car)}, {d.car.plate}</p></div><button className="crm-link" data-coach="car-back" onClick={() => open(d.id, "details")}>← К карточке водителя</button></div>
    <form className="drv-form-body" noValidate onSubmit={e => { e.preventDefault(); setTried(true); if (Object.keys(validateCar(car, strict)).length) return; const replaced = car.plate !== d.car.plate; update(d.id, x => changeCar(x, car)); open(d.id, "details"); notify(replaced ? `Автомобиль ${driverName(d)} изменён на ${carTitle(car)} ${car.plate}. Скажите водителю пройти фотоконтроль автомобиля и техпаспорта.` : "Данные автомобиля сохранены."); }}>
      <h3 className="drv-form-title">Выбор автомобиля</h3>
      <div className="drv-toggle" role="group" aria-label="Автомобиль" data-coach="car-mode" data-mode={mode}><button type="button" aria-pressed={mode === "current"} onClick={() => switchMode("current")}>Существующий</button><button type="button" aria-pressed={mode === "new"} onClick={() => switchMode("new")}>Новый</button></div>
      {mode === "current" ? <p className="drv-info">ⓘ Вы редактируете текущий автомобиль ({d.car.plate}). При сохранении данные обновятся в Диспетчерской Яндекса. Чтобы сменить машину, нажмите «Новый».</p>
        : <p className="drv-info">ⓘ Заполните марку, модель, цвет, год и госномер. Госномер скопируйте в поле «Позывной». После сохранения автомобиль сразу сменится в профиле водителя.</p>}
      <h3 className="drv-form-title">Детали автомобиля</h3>
      <div className="drv-grid">
        <Field label="Статус *"><select value={car.status} onChange={e => set("status", e.target.value)}><option>Работает</option><option>Не работает</option></select></Field>
        <Field label="Госномер *" error={errors.plate} coach="car-plate"><input value={car.plate} placeholder="Например, 803ASD02" onChange={e => set("plate", e.target.value.toUpperCase().replace(/\s/g, ""))} /></Field>
        <Field label="Марка *" error={errors.brand} coach="car-brand"><select value={car.brand} onChange={e => setCar(c => ({ ...c, brand: e.target.value, model: "" }))}><option value="">Выберите марку</option>{Object.keys(CAR_BRANDS).map(b => <option key={b}>{b}</option>)}</select></Field>
        <Field label="VIN"><input value={car.vin} onChange={e => set("vin", e.target.value.toUpperCase())} /></Field>
        <Field label="Модель *" error={errors.model} coach="car-model"><select value={car.model} disabled={!car.brand} onChange={e => set("model", e.target.value)}><option value="">Выберите модель</option>{(CAR_BRANDS[car.brand] ?? []).map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Номер кузова"><input value={car.body} onChange={e => set("body", e.target.value)} /></Field>
        <Field label="Цвет *" error={errors.color} coach="car-color"><select value={car.color} onChange={e => set("color", e.target.value)}><option value="">Выберите цвет</option>{CAR_COLORS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="СТС"><input value={car.sts} onChange={e => set("sts", e.target.value)} /></Field>
        <Field label="Год *" error={errors.year} coach="car-year"><select value={car.year || ""} onChange={e => set("year", Number(e.target.value))}><option value="">Выберите год</option>{years.map(y => <option key={y}>{y}</option>)}</select></Field>
        <Field label={strict ? "Позывной *" : "Позывной"} error={errors.callsign} coach="car-callsign"><span className="drv-inline"><input value={car.callsign} onChange={e => set("callsign", e.target.value)} /><button type="button" className="crm-secondary" disabled={!car.plate} onClick={() => set("callsign", car.plate)}>⧉ Скопировать госномер</button></span></Field>
        <Field label="Владелец *"><select value={car.owner} onChange={e => set("owner", e.target.value)}><option>Другое</option><option>Водитель</option><option>Парк</option></select></Field>
      </div>
      <div className="drv-grid">
        <div><h3 className="drv-form-title">Комплектация и брендинг</h3><Field label="КПП"><select value={car.transmission} onChange={e => set("transmission", e.target.value)}>{["Неизвестный", "Автомат", "Механика", "Робот", "Вариатор"].map(t => <option key={t}>{t}</option>)}</select></Field>
          <label className="drv-check"><input type="checkbox" checked={car.wrap} onChange={e => set("wrap", e.target.checked)} /> Оклейка</label><label className="drv-check"><input type="checkbox" checked={car.lightbox} onChange={e => set("lightbox", e.target.checked)} /> Lightbox</label></div>
        <div><h3 className="drv-form-title">Параметры и тарифы</h3><Field label="Вид топлива"><select value={car.fuel} onChange={e => set("fuel", e.target.value)}>{["Бензин", "Газ", "Гибрид", "Электро", "Дизель"].map(f => <option key={f}>{f}</option>)}</select></Field>
          <fieldset className="drv-tariffs" data-coach="car-tariffs"><legend>Тариф / Класс</legend>{TARIFFS.map(t => <label key={t} className={car.tariffs.includes(t) ? "is-on" : ""}><input type="checkbox" checked={car.tariffs.includes(t)} onChange={() => set("tariffs", car.tariffs.includes(t) ? car.tariffs.filter(x => x !== t) : [...car.tariffs, t])} />{t}</label>)}</fieldset></div>
      </div>
      <div className="drv-form-footer"><button className="crm-primary" data-coach="car-save">✓ Сохранить</button><button type="button" className="crm-secondary" onClick={() => open(d.id, "details")}>Отмена</button>{mode === "new" && <span>После смены автомобиля водителю нужно пройти фотоконтроль автомобиля и техпаспорта.</span>}</div>
    </form></section>;
}
