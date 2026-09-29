import { useState } from "react";
import { Avatar, Drawer, FleetHead, Icon, useFleet } from "./FleetUi";
import { Address } from "./FleetDriver";
import { clock, fullName, money, orderTransactions, phone, shortDate } from "./fleetNav";

/** «Антифрод»: why part of a balance is held. Opened from the grey amount on an account. */
export function AntifraudPage() {
  const { state, park, route, go } = useFleet();
  const [rule, setRule] = useState("");
  const driver = state.drivers.find(d => d.id === route.id);
  const rows = state.antifraud.filter(r => (driver ? r.driver === driver.id : r.park === park.id) && (!rule || r.rule === rule));
  return <div className="fleet-page"><FleetHead title="Антифрод" />
    <p className="fleet-note">Серая сумма на балансе — лимит на вывод. Здесь видно, по какому правилу и за какой заказ удержаны деньги.</p>
    <div className="fleet-chips">
      {driver ? <span className="fleet-chip is-on">{fullName(driver)}<button aria-label="Показать всех исполнителей" onClick={() => go("antifraud")}><Icon name="close" /></button></span> : <span className="fleet-chip is-static">ФИО водителя</span>}
      <label className="fleet-chip fleet-chip-select" data-coach="antifraud-rule"><select value={rule} onChange={e => setRule(e.target.value)} aria-label="Правило"><option value="">Правило</option>{state.antifraud_rules.map(r => <option key={r}>{r}</option>)}</select></label>
    </div>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table" data-coach="antifraud-table">
      <thead><tr><th>Водитель</th><th className="fleet-num">Сумма транзакции, ₸</th><th>Правило</th><th>Значение и лимит</th><th>Дата транзакции</th><th>Заказ</th><th>Адрес</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>
        <td>{r.driver_name}</td><td className="fleet-num">{r.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}</td>
        <td data-coach={i === 0 ? "antifraud-rule-cell" : undefined}><strong>{r.rule}</strong></td><td>{r.value} <span className="fleet-limit-grey">{r.limit}</span></td>
        <td>{shortDate(r.at)}</td>
        <td>{r.order ? <button className="fleet-link" data-coach="antifraud-order" data-order={r.order} onClick={() => go(`order/${r.order}`)}>{r.order}</button> : ""}</td>
        <td>{r.order ? <Address from={r.from} to={r.to} /> : ""}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <p className="fleet-empty-hint">{driver ? "У исполнителя нет удержаний" : `В парке «${park.name}, ${park.city}» нет удержаний`}</p>}</div>
  </div>;
}

/** An order's page: who drove, what it cost and — for a withdrawal limit — the tariff. */
export function OrderPage() {
  const { state, route, go } = useFleet();
  const [transactions, setTransactions] = useState(false);
  const driver = state.drivers.find(d => d.orders.some(o => o.id === route.id)), order = driver?.orders.find(o => o.id === route.id);
  if (!driver || !order) return <div className="fleet-page"><FleetHead title="Заказ не найден" /></div>;
  const lines = orderTransactions(order), income = order.payment === "card" ? order.price : 0;
  const commission = lines.filter(l => l.category.startsWith("Комиссия сервиса")).reduce((a, l) => a + l.amount, 0);
  const partner = lines.filter(l => l.category.startsWith("Комиссия партнёра")).reduce((a, l) => a + l.amount, 0);
  const other = lines.filter(l => l.category.startsWith("Удержание")).reduce((a, l) => a + l.amount, 0);
  const total = order.price + commission + partner + other;
  return <div className="fleet-page fleet-order"><FleetHead title={<>Заказ <u>{order.id}</u></>} />
    <div className="fleet-order-grid">
      <div className="fleet-card fleet-order-card"><h3 className={order.status === "complete" ? "is-good" : "is-bad"}><Icon name={order.status === "complete" ? "check" : "close"} /> {order.status === "complete" ? "Выполнен" : "Отменён"}</h3>
        <button className="fleet-person" onClick={() => go(`driver/${driver.id}`)}><Avatar name={fullName(driver)} /><span><strong>{fullName(driver)}</strong><small>{driver.car ? `${driver.car.brand} ${driver.car.model} · ${driver.car.plate}` : driver.profession}</small></span></button>
        <dl className="fleet-facts"><div><dt>ВУ</dt><dd>{driver.license || "—"}</dd></div><div><dt>Телефон</dt><dd>{phone(driver.phone)}</dd></div><div><dt>Условия работы</dt><dd>{driver.rule}</dd></div><div><dt>Номер заказа в парке</dt><dd>{order.id}</dd></div><div><dt>Дата подачи заказа</dt><dd>{shortDate(order.created_at)}</dd></div><div><dt>Тип заказа</dt><dd>Платформа</dd></div></dl>
        <Address from={order.from} to={order.to} />
      </div>
      <div className="fleet-card fleet-order-main">
        <header><h3>Детализация</h3><button className="fleet-btn" data-coach="order-transactions" onClick={() => setTransactions(true)}>Транзакции</button></header>
        <dl className="fleet-lines"><div><dt>Заказ</dt><dd>{money(order.price, 0)}</dd></div><div><dt>Комиссии сервиса</dt><dd>{money(commission)}</dd></div><div><dt>Комиссия парка</dt><dd>{money(partner)}</dd></div><div><dt>Другие удержания</dt><dd>{money(other)}</dd></div><div><dt>Итого</dt><dd><strong>{money(total)}</strong></dd></div></dl>
        <h3>Описание</h3>
        <dl className="fleet-lines"><div><dt>Статус</dt><dd>{order.status === "complete" ? "Завершён" : "Отменён"}</dd></div><div data-coach="order-tariff"><dt>Тариф</dt><dd><strong>{order.tariff}</strong></dd></div><div><dt>Номер заказа</dt><dd>{order.id}</dd></div><div><dt>Длительность поездки</dt><dd>{clock(order.duration)}</dd></div><div><dt>Пробег</dt><dd>{order.distance.toLocaleString("ru-RU")} км</dd></div><div><dt>Оплата</dt><dd>{order.payment === "card" ? "Безналичные" : "Наличные"}</dd></div><div><dt>Чей заказ</dt><dd>Яндекс Такси</dd></div></dl>
      </div>
      <button className="fleet-btn fleet-order-support" disabled title="Поддержка по заказу в обучении не нужна"><Icon name="chat" /> Поддержка</button>
    </div>
    {transactions && <Drawer title="Транзакции" subtitle={`Заказ ${order.id}`} onClose={() => setTransactions(false)}>
      <dl className="fleet-lines"><div><dt>Приход</dt><dd>{money(income)}</dd></div><div><dt>Расход</dt><dd>{money(commission + partner + other)}</dd></div><div><dt>Начислено на баланс</dt><dd>{money(income + commission + partner + other)}</dd></div></dl>
      {[["Оплата", lines.filter(l => l.amount > 0)], ["Комиссия", lines.filter(l => l.category.startsWith("Комиссия"))], ["Прочее", lines.filter(l => l.category.startsWith("Удержание"))]].map(([title, list]) => (list as typeof lines).length > 0 && <section key={title as string}><h3>{title as string}</h3>
        <dl className="fleet-lines">{(list as typeof lines).map(l => <div key={l.category}><dt>{l.category}<small>{shortDate(order.finished_at)}</small></dt><dd>{money(l.amount)}</dd></div>)}</dl></section>)}
    </Drawer>}
  </div>;
}
