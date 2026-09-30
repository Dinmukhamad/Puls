import { useMemo, useState, type ReactNode } from "react";
import { fleet as api, type FleetDriver } from "../../api/dispatch";
import { PhotoThumb, type PhotoKind } from "../DriverPhotoArt";
import { Avatar, Drawer, FleetHead, Icon, Modal, useFleet } from "./FleetUi";
import { DRIVER_TABS, STATUS, dayDate, duration, fullName, money, orderTransactions, shortDate, type DriverTab } from "./fleetNav";

/** A contractor's account: the summary bar, then the tabs from the document. */
export function DriverPage() {
  const { state, park, route, go } = useFleet();
  const d = state.drivers.find(x => x.id === route.id);
  const [panel, setPanel] = useState<"diagnostics" | "priority" | null>(null);
  if (!d || d.park !== park.id) return <div className="fleet-page"><FleetHead title="Исполнитель не найден" crumbs={[{ label: "Исполнители", path: "contractors" }]} />
    <div className="fleet-card fleet-empty-hint">В парке «{park.name}, {park.city}» нет такого исполнителя. Проверьте парк в правом верхнем углу.</div></div>;
  const tab = route.tab ?? "details";
  return <div className="fleet-page fleet-driver" data-driver={d.id} data-panel={panel ?? ""}>
    <FleetHead title={fullName(d)} crumbs={[{ label: "Исполнители", path: "contractors" }]} />
    <div className="fleet-card fleet-driver-card">
      <p className="fleet-driver-line">{[d.employment, d.profession, d.car?.plate, d.car?.model].filter(Boolean).join(" • ")}</p>
      <div className="fleet-summary" data-coach="summary">
        <div className="fleet-summary-cell fleet-summary-who"><Avatar name={fullName(d)} status={d.status} /><strong className={d.works ? "" : "is-bad"}>{d.works ? "Работает" : "Не работает"}</strong></div>
        <div className="fleet-summary-cell"><small>Статус</small><strong>{STATUS[d.status].label}</strong></div>
        <div className="fleet-summary-cell fleet-summary-money" data-coach="balance"><small>Состояние счёта</small>
          <span><button className="fleet-mini" disabled title="В обучении списания не проводятся" aria-label="Списать">−</button>
            <strong className={d.balance < 0 ? "is-bad" : "is-good"}>{money(d.balance)}</strong>
            {d.withdraw_limit > 0 && <button className="fleet-withdraw" data-coach="withdraw-limit" title="Лимит на вывод: эту сумму водитель не может вывести" onClick={() => go(`antifraud/${d.id}`)}>({money(d.withdraw_limit)} <Icon name="lock" />)</button>}
            <button className="fleet-mini" disabled title="В обучении пополнения не проводятся" aria-label="Пополнить">+</button></span></div>
        <div className="fleet-summary-cell"><small>Рейтинг</small><strong>{d.rating ? d.rating.toFixed(2).replace(".", ",") : "—"}</strong></div>
        <button className="fleet-summary-cell fleet-summary-link" data-coach="diagnostics" onClick={() => setPanel("diagnostics")}><small>Диагностика <Icon name="chevron" /></small><strong className={d.diagnostics.ok ? "" : "is-bad"}>{!d.diagnostics.ok && <Icon name="info" />}{d.diagnostics.title}</strong></button>
        <button className="fleet-summary-cell fleet-summary-link" data-coach="priority" onClick={() => setPanel("priority")}><small>Приоритет <Icon name="chevron" /></small><strong>{d.priority.label}, {d.priority.value} балл</strong></button>
        <div className="fleet-summary-cell"><small>Термокороб</small><strong>{d.thermobox ? "Есть" : "Нет"}</strong></div>
      </div>
      <nav className="fleet-tabs" aria-label="Разделы карточки" data-coach="driver-tabs">{DRIVER_TABS.map(([id, label]) => <button key={id} className={tab === id ? "is-active" : ""} aria-current={tab === id ? "page" : undefined} data-coach={`tab-${id}`} onClick={() => go(`driver/${d.id}${id === "details" ? "" : `/${id}`}`)}>{label}</button>)}
        <button disabled title="В обучении этот раздел не нужен">Документы</button></nav>
      <DriverTabView d={d} tab={tab} />
    </div>
    {panel === "diagnostics" && <Drawer title="Диагностика" subtitle={d.diagnostics.title} coach="diagnostics-panel" onClose={() => setPanel(null)}>
      {d.diagnostics.ok ? <p className="fleet-diag is-ok"><Icon name="check" /> Ничего не мешает выйти на линию</p>
        : <ul className="fleet-diag-list">{d.diagnostics.reasons.map(r => <li key={r} className="fleet-diag"><span aria-hidden="true">✕</span>{r}</li>)}</ul>}
      <p className="fleet-muted">Здесь видно всё, что мешает исполнителю выйти на линию.</p>
    </Drawer>}
    {panel === "priority" && <PriorityModal d={d} onClose={() => setPanel(null)} />}
  </div>;
}

function DriverTabView({ d, tab }: { d: FleetDriver; tab: DriverTab }) {
  if (tab === "car") return <CarTab key={JSON.stringify(d.car)} d={d} />;
  if (tab === "income") return <IncomeTab d={d} />;
  if (tab === "transactions") return <TransactionsTab d={d} />;
  if (tab === "orders") return <OrdersTab d={d} />;
  if (tab === "bonuses") return <BonusesTab d={d} />;
  if (tab === "balance") return <BalanceTab d={d} />;
  if (tab === "gps") return <GpsTab d={d} />;
  if (tab === "photo") return <PhotoTab d={d} />;
  if (tab === "history") return <HistoryTab d={d} />;
  return <DetailsTab key={d.provider} d={d} />;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <div className="fleet-field"><span>{label}</span><div>{children}{hint}</div></div>;
}
const Fixed = ({ value, date = false }: { value: string; date?: boolean }) => <input className="fleet-input" value={value || (date ? "дд.мм.гггг" : "")} readOnly disabled aria-readonly="true" />;

function DetailsTab({ d }: { d: FleetDriver }) {
  const { state, run } = useFleet();
  const [provider, setProvider] = useState(d.provider), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = provider !== d.provider;
  async function save() {
    setBusy(true); setError("");
    try { await run(() => api.details(d.id, provider), "Изменения сохранены"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="fleet-tab-body" aria-label="Детали">
    <h2 className="fleet-section">Детали</h2>
    <p className="fleet-note">Некоторые поля недоступны для редактирования, для внесения изменений обратитесь в поддержку</p>
    <div className="fleet-form-grid">
      <div>
        <Field label="Фамилия"><Fixed value={d.last_name} /></Field><Field label="Имя"><Fixed value={d.first_name} /></Field><Field label="Отчество"><Fixed value={d.middle_name || "-"} /></Field>
        <Field label="Телефон"><Fixed value={d.phone} /></Field><Field label="Адрес"><Fixed value={d.address || "Укажите адрес"} /></Field>
        <Field label="ИИН" hint={<small className="fleet-field-hint">Есть у самозанятых и ИП</small>}><Fixed value={d.iin} /></Field>
        <Field label="Источник"><Fixed value={d.source} /></Field><Field label="Статус"><Fixed value={d.works ? "Работает" : "Не работает"} /></Field>
        <Field label="Провайдер ЭДО"><select className="fleet-input fleet-select" data-coach="provider" data-value={provider} value={provider} onChange={e => setProvider(e.target.value)} aria-label="Провайдер ЭДО">{state.catalog.providers.map(p => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Дополнительно"><div className="fleet-mini-card"><strong>Инвентарь</strong><span>{d.thermobox ? `${state.catalog.inventory[d.thermobox.type]} № ${d.thermobox.number}` : "Инвентарь пока не выдан"}</span></div></Field>
      </div>
      <div>
        <Field label="Водительский стаж с"><Fixed value={dayDate(d.experience_since)} date /></Field>
        <Field label="Серия и номер ВУ" hint={<small className="fleet-field-hint fleet-link-like">Проверить водителя</small>}><input className="fleet-input" data-coach="license" value={d.license} readOnly aria-readonly="true" /></Field>
        <Field label="Страна выдачи ВУ"><Fixed value={d.license_country} /></Field><Field label="Дата выдачи ВУ"><Fixed value={dayDate(d.license_issued)} date /></Field>
        <Field label="Действует до"><Fixed value={dayDate(d.license_expires)} date /></Field>
      </div>
    </div>
    <h2 className="fleet-section">Условия работы</h2>
    <div className="fleet-form-grid"><div>
      <Field label="Условие работы"><Fixed value={d.rule} /></Field><Field label="Лимит по счёту"><Fixed value={String(d.account_limit)} /></Field>
      <Field label="Дата принятия"><Fixed value={dayDate(d.created)} /></Field><Field label="Модель устройства"><span className="fleet-plain">{d.device}</span></Field>
      <Field label="Версия Яндекс Про"><span className="fleet-plain">{d.app_version}</span></Field>
    </div><div><Field label="Выбранные водителем категории"><span className="fleet-plain">{d.car?.tariffs.join(", ") || "Курьер, Доставка"}</span></Field></div></div>
    {(dirty || error) && <div className="fleet-savebar" role="region" aria-label="Сохранение">
      {error && <p className="fleet-error" role="alert">{error}</p>}
      <button className="fleet-btn fleet-btn--yellow" data-coach="details-save" disabled={busy || !dirty} onClick={save}>{busy ? "Сохраняем…" : "Сохранить"}</button>
      <button className="fleet-btn" disabled={busy} onClick={() => { setProvider(d.provider); setError(""); }}>Отменить</button>
    </div>}
  </section>;
}

function CarTab({ d }: { d: FleetDriver }) {
  const { state, run } = useFleet();
  const car = d.car;
  const [tariffs, setTariffs] = useState(car?.tariffs ?? []), [wrap, setWrap] = useState(car?.wrap ?? false), [lightbox, setLightbox] = useState(car?.lightbox ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!car) return <section className="fleet-tab-body"><p className="fleet-empty-hint">У курьера нет автомобиля — он работает пешком или на велосипеде.</p></section>;
  const dirty = wrap !== car.wrap || lightbox !== car.lightbox || tariffs.join() !== car.tariffs.join();
  const missing = state.catalog.tariffs.filter(t => !tariffs.includes(t));
  async function save() {
    setBusy(true); setError("");
    try { await run(() => api.car(d.id, { tariffs, wrap, lightbox }), "Автомобиль сохранён"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="fleet-tab-body" aria-label="Автомобиль">
    <h2 className="fleet-section fleet-caps">Выбор автомобиля</h2>
    <div className="fleet-segmented" role="group" aria-label="Автомобиль"><button className="is-on" aria-pressed="true">Существующий</button><button disabled title="В обучении новый автомобиль не добавляют">Новый</button></div>
    <p><input className="fleet-input fleet-wide" readOnly disabled value={`${car.plate} • ${car.brand} ${car.model} ${car.year} ${car.color} • ${car.status ?? "Работает"}`} aria-label="Автомобиль" /></p>
    <h2 className="fleet-section">Детали</h2>
    <div className="fleet-form-grid"><div>
      <Field label="Марка"><Fixed value={car.brand} /></Field><Field label="Модель"><Fixed value={car.model} /></Field><Field label="Цвет"><Fixed value={car.color} /></Field><Field label="Год"><Fixed value={String(car.year)} /></Field>
    </div><div>
      <Field label="Госномер"><Fixed value={car.plate} /></Field><Field label="VIN"><Fixed value={car.vin} /></Field><Field label="СТС"><Fixed value={car.sts ?? ""} /></Field>
    </div></div>
    <h2 className="fleet-section">Комплектация и брендинг</h2>
    <div className="fleet-form-grid"><div><Field label="КПП"><Fixed value={car.transmission} /></Field></div>
      <div className="fleet-checks">
        <label className="fleet-check" data-coach="wrap"><input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} /><span>Оклейка</span>
          {car.wrap && wrap && <b className={car.wrap_checked ? "is-yes" : "is-no"} data-coach="wrap-badge" title={car.wrap_checked ? "Фотоконтроль брендинга пройден" : "Фотоконтроль брендинга не пройден"}>{car.wrap_checked ? "✓" : "✕"}</b>}</label>
        <label className="fleet-check"><input type="checkbox" checked={lightbox} onChange={e => setLightbox(e.target.checked)} /><span>Lightbox</span></label>
        <small className="fleet-field-hint">Оклейка — брендинг Яндекса на машине. ✓ — водитель прошёл фотоконтроль брендинга, ✕ — ещё нет.</small>
      </div></div>
    <h2 className="fleet-section">Параметры</h2>
    <div className="fleet-form-grid"><div><Field label="Вид топлива"><Fixed value={car.fuel} /></Field><Field label="Позывной"><Fixed value={car.callsign} /></Field></div><div /></div>
    <h2 className="fleet-section">Тарифы</h2>
    <div className="fleet-tariffs" data-coach="tariffs" data-tariffs={tariffs.join(" ")}>
      {tariffs.map(t => <span key={t} className="fleet-tariff">{t}<button aria-label={`Убрать тариф ${t}`} onClick={() => setTariffs(list => list.filter(x => x !== t))}><Icon name="close" /></button></span>)}
      <select className="fleet-tariff-add" data-coach="tariff-add" value="" aria-label="Добавить тариф" onChange={e => { const value = e.target.value; if (value) setTariffs(list => [...list, value]); }}><option value="">＋ Добавить</option>{missing.map(t => <option key={t}>{t}</option>)}</select>
    </div>
    {(dirty || error) && <div className="fleet-savebar" role="region" aria-label="Сохранение">
      {error && <p className="fleet-error" role="alert">{error}</p>}
      <button className="fleet-btn fleet-btn--yellow" data-coach="fleet-car-save" disabled={busy || !dirty} onClick={save}>{busy ? "Сохраняем…" : "Сохранить"}</button>
      <button className="fleet-btn" disabled={busy} onClick={() => { setTariffs(car.tariffs); setWrap(car.wrap); setLightbox(car.lightbox); setError(""); }}>Отменить</button>
    </div>}
  </section>;
}

/** Operations of «Ведомость», newest first, with the balance after each. */
export function ledger(d: FleetDriver) {
  let balance = d.balance;
  return d.orders.filter(o => o.price).flatMap(o => orderTransactions(o).map(t => ({ ...t, order: o.id, at: o.finished_at }))).map(row => {
    const after = balance; balance = Math.round((balance - row.amount) * 100) / 100; return { ...row, balance: after };
  });
}

function Chip({ children }: { children: ReactNode }) { return <span className="fleet-chip is-static">{children}</span>; }
const period = (d: FleetDriver) => { const days = d.orders.map(o => o.created_at.slice(0, 10)).sort(); return days.length ? `${shortDate(days[0], false)} – ${shortDate(days.at(-1)!, false)}` : "Сегодня"; };

function IncomeTab({ d }: { d: FleetDriver }) {
  const done = d.orders.filter(o => o.status === "complete"), rows = ledger(d);
  const sum = (filter: (c: string) => boolean) => rows.filter(r => filter(r.category)).reduce((a, r) => a + r.amount, 0);
  const cash = done.filter(o => o.payment === "cash").reduce((a, o) => a + o.price, 0), card = done.filter(o => o.payment === "card").reduce((a, o) => a + o.price, 0);
  const report: [string, number][] = [["Наличные", cash], ["Безналичная оплата", card], ["Чаевые", sum(c => c === "Чаевые")], ["Бонус", d.bonus && d.bonus.done >= d.bonus.target ? d.bonus.amount : 0],
    ["Комиссии сервиса", sum(c => c.startsWith("Комиссия сервиса"))], ["Налоги и сборы", sum(c => c.startsWith("Удержание"))], ["Комиссии партнёра", sum(c => c.startsWith("Комиссия партнёра"))]];
  const days = [...new Set(done.map(o => o.created_at.slice(0, 10)))].sort();
  return <section className="fleet-tab-body" aria-label="Заработок">
    <div className="fleet-chips"><Chip>📅 {period(d)}</Chip><Chip>Время начала: 00:00</Chip><Chip>Время окончания: 23:59</Chip></div>
    <div className="fleet-income">
      <div className="fleet-card fleet-report"><h3>Отчёт</h3>
        <dl><div><dt>Завершённые поездки</dt><dd>{done.length}</dd></div><div><dt>Сумма с таксометра</dt><dd className="is-good">{money(cash + card)}</dd></div><div><dt>Пробег</dt><dd>{done.reduce((a, o) => a + o.distance, 0).toFixed(1).replace(".", ",")} км</dd></div></dl>
        <dl>{report.map(([label, value]) => <div key={label}><dt className="fleet-link-like">{label}</dt><dd className={value < 0 ? "is-bad" : value > 0 ? "is-good" : ""}>{money(value)}</dd></div>)}</dl>
        <dl><div><dt><strong>ИТОГО</strong></dt><dd className="is-good"><strong>{money(report.reduce((a, [, v]) => a + v, 0))}</strong></dd></div></dl>
      </div>
      <div className="fleet-card fleet-chart"><h3>Заказы</h3>
        <div className="fleet-bars" role="img" aria-label={`Заказы по дням: ${days.map(day => `${shortDate(day, false)} — ${done.filter(o => o.created_at.startsWith(day)).length}`).join(", ")}`}>
          {days.map(day => { const n = done.filter(o => o.created_at.startsWith(day)).length; return <div key={day}><span style={{ height: `${Math.max(8, n / Math.max(1, done.length) * 100)}%` }}><b>{n}</b></span><small>{shortDate(day, false)}</small></div>; })}
          {!days.length && <p className="fleet-muted">Заказов за период нет</p>}
        </div><p className="fleet-muted">Всего заказов: {d.orders.length}</p>
      </div>
    </div>
  </section>;
}

function TransactionsTab({ d }: { d: FleetDriver }) {
  const [query, setQuery] = useState("");
  const rows = ledger(d).filter(r => !query.trim() || r.order.includes(query.trim()));
  return <section className="fleet-tab-body" aria-label="Ведомость">
    <div className="fleet-chips"><label className="fleet-inline-search is-small"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Заказ" aria-label="Номер заказа" /></label><Chip>Период: {period(d)}</Chip><Chip>＋ Фильтры</Chip></div>
    <p className="fleet-note">В ведомости все операции исполнителя: оплаты, комиссии, удержания и пополнения.</p>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table">
      <thead><tr><th>Дата</th><th>Событие</th><th>Категория</th><th className="fleet-num">Баланс</th><th className="fleet-num">Сумма</th><th>Комментарий</th><th>Инициатор</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{shortDate(r.at)}</td><td>Заказ {r.order}</td><td>{r.category}</td><td className="fleet-num is-good">{r.balance.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td><td className={`fleet-num ${r.amount < 0 ? "is-bad" : "is-good"}`}>{r.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td><td>{r.comment}</td><td>Платформа</td></tr>)}</tbody>
    </table>{!rows.length && <p className="fleet-empty-hint">Операций не найдено</p>}</div>
  </section>;
}

export function Address({ from, to }: { from: string; to: string }) {
  return <span className="fleet-route"><span><i />{from} <small>· откуда</small></span><span><i />{to} <small>· куда</small></span></span>;
}

function OrdersTab({ d }: { d: FleetDriver }) {
  const { go } = useFleet();
  return <section className="fleet-tab-body" aria-label="Заказы">
    <div className="fleet-chips"><Chip>Дата подачи</Chip><Chip>Период: {period(d)}</Chip><Chip>＋ Фильтры</Chip></div>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table">
      <thead><tr><th>Статус</th><th>Код заказа</th><th>Автомобиль</th><th>Дата подачи</th><th>Дата завершения</th><th>Причина отмены</th><th>Адрес</th><th>Категория</th><th className="fleet-num">Пробег, км</th><th className="fleet-num">Стоимость, ₸</th></tr></thead>
      <tbody>{d.orders.map(o => <tr key={o.id}>
        <td><span className={`fleet-pill ${o.status === "complete" ? "is-done" : "is-cancel"}`}><i />{o.status === "complete" ? "Выполнен" : "Отменён"}</span></td>
        <td><button className="fleet-link" data-coach="order-link" data-order={o.id} onClick={() => go(`order/${o.id}`)}>{o.id}</button></td>
        <td>{d.car ? <>{d.car.brand} {d.car.model}<small className="fleet-sub">{d.car.plate}</small></> : "—"}</td>
        <td>{shortDate(o.created_at)}</td><td>{shortDate(o.finished_at)}</td><td className="fleet-cut">{o.cancel_reason}</td>
        <td><Address from={o.from} to={o.to} /></td><td>{o.tariff}</td><td className="fleet-num">{o.distance ? o.distance.toFixed(2).replace(".", ",") : ""}</td><td className="fleet-num is-good">{o.price.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td>
      </tr>)}</tbody>
    </table>{!d.orders.length && <p className="fleet-empty-hint">Заказов за период нет</p>}</div>
  </section>;
}

function BonusesTab({ d }: { d: FleetDriver }) {
  const [open, setOpen] = useState(false), b = d.bonus;
  if (!b) return <section className="fleet-tab-body"><p className="fleet-empty-hint">Нет активных бонусов. Целевые бонусы от Яндекса бывают дневными и недельными.</p></section>;
  const title = `${shortDate(b.from, false)} – ${shortDate(b.to, false)}`, paid = b.done >= b.target;
  return <section className="fleet-tab-body" aria-label="Бонусы">
    <h2 className="fleet-section">Прошедшие за неделю</h2>
    <div className="fleet-bonus fleet-card"><header><span className={paid ? "is-good" : ""}>{paid ? "✓" : "○"} {title}</span><button className="fleet-link" onClick={() => setOpen(o => !o)}>Детали <Icon name={open ? "down" : "chevron"} /></button></header>
      <div className="fleet-progress"><span style={{ width: `${Math.min(100, b.done / b.target * 100)}%` }} /></div>
      <p><strong>{b.done} из {b.target} заказов</strong><strong>{money(b.amount, 0)}</strong></p></div>
    {open && <div className="fleet-card fleet-bonus-details"><h3>Требования</h3><p className="fleet-muted">{title}, каждый день 00:00–23:59</p><p><small>Место работы</small>{b.place}</p><p><small>Тарифы</small>{b.tariffs}</p>
      <p className="fleet-muted">{paid ? `Цель выполнена: ${money(b.amount, 0)} начислены на баланс.` : `Осталось ${b.target - b.done} заказов, чтобы получить ${money(b.amount, 0)}.`}</p></div>}
  </section>;
}

function BalanceTab({ d }: { d: FleetDriver }) {
  const rows = ledger(d);
  const hours = useMemo(() => {
    const points: { at: string; balance: number; change: number }[] = [];
    let current = d.balance;
    const ends = [...new Set(rows.map(r => r.at.slice(0, 13)))];
    for (const hour of ends) {
      const change = rows.filter(r => r.at.startsWith(hour)).reduce((a, r) => a + r.amount, 0);
      points.push({ at: `${hour}:59`, balance: current, change }); current = Math.round((current - change) * 100) / 100;
    }
    return points;
  }, [d.balance, rows]);
  return <section className="fleet-tab-body" aria-label="История баланса"><div className="fleet-table-card fleet-narrow"><table className="fleet-table">
    <thead><tr><th>Дата</th><th className="fleet-num">Баланс, ₸</th><th className="fleet-num">Изменение, ₸</th></tr></thead>
    <tbody>{hours.map(h => <tr key={h.at}><td>{shortDate(h.at)}</td><td className="fleet-num is-good">{h.balance.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td><td className={`fleet-num ${h.change < 0 ? "is-bad" : "is-good"}`}>{h.change.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td></tr>)}</tbody>
  </table>{!hours.length && <p className="fleet-empty-hint">Баланс за период не менялся</p>}</div></section>;
}

function GpsTab({ d }: { d: FleetDriver }) {
  const done = d.orders.filter(o => o.status === "complete");
  const onOrder = done.reduce((a, o) => a + o.distance, 0), idle = Math.round(onOrder * 0.14 * 10) / 10;
  const tiles: [string, number][] = [["Общий пробег", onOrder + idle], ["На заказе", onOrder], ["Холостой пробег", idle], ["Офлайн", 0]];
  return <section className="fleet-tab-body" aria-label="GPS">
    <p className="fleet-note">Где был исполнитель и сколько проехал: на заказе, без заказа и офлайн.</p>
    <div className="fleet-tiles">{tiles.map(([label, km]) => <div key={label} className="fleet-card"><span>{label}</span><strong>{Math.round(km)} км</strong></div>)}</div>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table">
      <thead><tr><th>Статус</th><th>Дата и время</th><th>Время</th><th className="fleet-num">Пробег</th><th /></tr></thead>
      <tbody>{done.map(o => <tr key={o.id}><td><span className="fleet-status fleet-status--order"><i />На заказе</span></td><td>{shortDate(o.created_at)}</td><td>{duration(o.duration)}</td><td className="fleet-num">{o.distance.toFixed(1).replace(".", ",")} км</td><td>Заказ {o.id}</td></tr>)}</tbody>
    </table>{!done.length && <p className="fleet-empty-hint">{d.gps ? "За период нет поездок" : "Нет сигнала GPS — трек не записывается"}</p>}</div>
  </section>;
}

const PHOTO_TILES: [PhotoKind, string][] = [["left", "Машина слева"], ["front", "Машина спереди"], ["right", "Машина справа"], ["rear", "Машина сзади"], ["trunk", "Открытый багажник"], ["seats-rear", "Задний ряд сидений"], ["seats-front", "Передний ряд сидений"]];
/** Changes of the account on both work sites: CRM and «Диспетчерская» keep one history. */
function HistoryTab({ d }: { d: FleetDriver }) {
  return <section className="fleet-tab-body" aria-label="История изменений">
    <p className="fleet-muted">Здесь всё, что меняли в учётной записи — в Диспетчерской и в CRM.</p>
    <ol className="fleet-history">{d.history.map((item, i) => <li key={i}><time>{item.at.includes("T") ? shortDate(item.at) : dayDate(item.at)}</time><span>{item.text}</span></li>)}</ol>
  </section>;
}

function PhotoTab({ d }: { d: FleetDriver }) {
  const [open, setOpen] = useState(0), car = d.car;
  if (!car) return <section className="fleet-tab-body"><p className="fleet-empty-hint">Фотоконтроль автомобиля не нужен: курьер без машины. Термокороб проходит свой фотоконтроль в Яндекс Про.</p></section>;
  const art = { plate: car.plate, car: `${car.brand} ${car.model}`, year: car.year };
  return <section className="fleet-tab-body" aria-label="Фотоконтроль">
    {d.photo_control === "Требуется" && <p className="fleet-empty-hint">Автомобиль сменили: водитель ещё не прошёл фотоконтроль автомобиля и техпаспорта.</p>}
    {d.photo_checks.map((date, i) => <div key={date} className="fleet-photo-day">
      <button className="fleet-section fleet-photo-toggle" aria-expanded={open === i} onClick={() => setOpen(o => o === i ? -1 : i)}>🚘 {shortDate(date, false)} <Icon name={open === i ? "down" : "chevron"} /></button>
      {open === i && <div className="fleet-photos">{PHOTO_TILES.map(([kind, label]) => <figure key={kind} className="fleet-card"><figcaption>{label}</figcaption><PhotoThumb kind={kind} data={art} wide className="fleet-photo" /></figure>)}</div>}
    </div>)}
  </section>;
}

function PriorityModal({ d, onClose }: { d: FleetDriver; onClose: () => void }) {
  const p = d.priority, share = p.max ? p.value / p.max : 0;
  const arc = (from: number, to: number) => { const a = (t: number) => Math.PI * (1.15 - t * 1.3); const [x1, y1, x2, y2] = [100 + 70 * Math.cos(a(from)), 100 - 70 * Math.sin(a(from)), 100 + 70 * Math.cos(a(to)), 100 - 70 * Math.sin(a(to))]; return `M${x1} ${y1}A70 70 0 ${to - from > 0.77 ? 1 : 0} 1 ${x2} ${y2}`; };
  return <Modal title="Приоритет" onClose={onClose} className="fleet-priority">
    <svg className="fleet-gauge" viewBox="0 0 200 162" role="img" aria-label={`Приоритет ${p.value} из ${p.max}`}>
      <path d={arc(0, 1)} className="fleet-gauge-track" /><path d={arc(0, Math.max(0.01, share))} className="fleet-gauge-value" />
      <text x="100" y="108" className="fleet-gauge-number">{p.value}</text><text x="36" y="160" textAnchor="middle">0</text><text x="164" y="160" textAnchor="middle">{p.max}</text>
    </svg>
    <p className="fleet-center"><strong>{share >= 0.8 ? "Отличный результат!" : "Вы почти у цели!"}</strong><br /><span className="fleet-muted">Выполните пункты ниже, чтобы получать больше заказов</span></p>
    {p.can.length > 0 && <><h3 className="fleet-priority-head"><Icon name="lock" /> Можно получить</h3><ul className="fleet-priority-list">{p.can.map(i => <li key={i.label}><span>{i.label}{i.hint && <small>{i.hint}</small>}</span><b>+{i.points}</b></li>)}</ul></>}
    {p.got.length > 0 && <><h3 className="fleet-priority-head is-good"><Icon name="check" /> Получено</h3><ul className="fleet-priority-list">{p.got.map(i => <li key={i.label}><span>{i.label}</span><b className="is-good">+{i.points}{i.points < i.max ? ` из ${i.max}` : ""}</b></li>)}</ul></>}
  </Modal>;
}

