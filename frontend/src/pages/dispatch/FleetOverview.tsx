import { useState } from "react";
import { Avatar, FleetHead, Icon, parkDrivers, useFleet } from "./FleetUi";
import { STATUS, fullName, money } from "./fleetNav";

/** «Главная»: the park at a glance. Numbers come from the training park itself. */
export function HomePage() {
  const { state, park, go } = useFleet();
  const drivers = parkDrivers(state, park.id), working = drivers.filter(d => d.works);
  const online = working.filter(d => d.status !== "offline"), count = (s: string) => online.filter(d => d.status === s).length;
  const problems = working.filter(d => !d.diagnostics.ok), cars = working.filter(d => d.car);
  const rating = working.filter(d => d.rating).reduce((a, d, _, list) => a + (d.rating ?? 0) / list.length, 0);
  return <div className="fleet-page">
    <FleetHead title={<span className="fleet-brand">Про <b>для бизнеса</b></span>} />
    <div className="fleet-grid">
      <button className="fleet-card fleet-home-card" data-coach="home-drivers" onClick={() => go("contractors")}><h3><Icon name="people" /> Исполнители <Icon name="chevron" /></h3>
        <p className="fleet-big">{online.length} <small>на линии</small></p>
        <ul className="fleet-legend"><li className="is-free">{count("free")} свободны</li><li className="is-order">{count("order")} на заказе</li><li className="is-busy">{count("busy")} заняты</li></ul>
        <div className="fleet-home-stats"><span><small>Рейтинг парка</small>{rating ? rating.toFixed(2).replace(".", ",") : "—"}</span><span><small>Новые</small>{drivers.filter(d => d.segment === "new").length}</span><span><small>Отток</small>{drivers.filter(d => d.segment === "churn").length}</span><span><small>Всего</small>{drivers.length}</span></div>
      </button>
      <div className="fleet-card fleet-home-card"><h3><Icon name="cars" /> Автомобили</h3><p className="fleet-big">{cars.length} <small>автомобилей исполнителей</small></p>
        <div className="fleet-bars is-small" aria-hidden="true">{["Эконом", "Комфорт", "Курьер", "Доставка"].map(t => { const n = cars.filter(d => d.car?.tariffs.includes(t)).length; return <div key={t}><span style={{ height: `${cars.length ? n / cars.length * 100 : 0}%` }} /><small>{t}</small></div>; })}</div></div>
      <button className="fleet-card fleet-home-card" onClick={() => go("goals")}><h3><Icon name="check" /> Программа лояльности <Icon name="chevron" /></h3><div className="fleet-levels"><span className="is-bronze">Бронзовый</span><span className="is-silver">Серебряный</span><span className="is-gold">Золотой</span></div><p className="fleet-muted">Парк на серебряном уровне: −50% на Яндекс Про для бизнеса</p></button>
      <div className="fleet-card fleet-home-card"><h3 className="is-bad"><Icon name="info" /> Проблемы {problems.length}</h3>
        {problems.length ? <ul className="fleet-problems">{problems.map(d => <li key={d.id}><button className="fleet-link" onClick={() => go(`driver/${d.id}`)}>{fullName(d)}</button><small>{d.diagnostics.title}</small></li>)}</ul> : <p className="fleet-muted">У исполнителей нет проблем с выходом на линию</p>}</div>
      <div className="fleet-card fleet-home-card"><h3><Icon name="info" /> Возможности</h3><p>Пройти обучающий курс «Основы управления таксопарком»</p><p className="fleet-muted">В учебной копии курс недоступен</p></div>
    </div>
  </div>;
}

export function GoalsPage() {
  const [month, setMonth] = useState(0);
  const conditions = ["2000 поездок в месяц", "Заполнен профиль партнёра", "Водители подтвердили занятость", "Не меньше 70% водителей с рейтингом выше 4,8"];
  return <div className="fleet-page"><FleetHead title="Цели" />
    <div className="fleet-card fleet-goals"><div className="fleet-goals-top"><div><h2>Ваши награды за серебряный уровень</h2><p>Удерживайте уровень, чтобы сохранить награды в следующем месяце</p></div>
      <div className="fleet-goal-rewards"><span><Icon name="cars" /> Скидка на Яндекс Про для бизнеса</span><span><Icon name="phone" /> Обратный звонок</span></div></div>
      <div className="fleet-segmented is-wide" role="tablist">{["Прогресс за этот месяц", "Прогресс за прошлый месяц"].map((label, i) => <button key={label} role="tab" aria-selected={month === i} className={month === i ? "is-on" : ""} onClick={() => setMonth(i)}>{label}</button>)}</div>
      <div className="fleet-levels is-large"><span className="is-bronze">Бронзовый<small>−25% на Яндекс Про для бизнеса</small></span><span className="is-silver">Серебряный<small>−50% и обратный звонок</small></span><span className="is-gold">Золотой<small>−60% и новые водители</small></span></div>
      <h3>Условия для серебряного уровня</h3><ul className="fleet-conditions">{conditions.map((c, i) => <li key={c} className={i < (month ? 4 : 3) ? "is-done" : ""}><Icon name={i < (month ? 4 : 3) ? "check" : "info"} />{c}</li>)}</ul>
    </div></div>;
}

const PROFILE_TABS = ["Общее", "Контакты", "Оплата кабинета", "Параметры"];
export function ProfilePage() {
  const { park } = useFleet();
  const [tab, setTab] = useState(0);
  return <div className="fleet-page"><FleetHead title="Профиль партнёра" />
    <nav className="fleet-tabs is-center" role="tablist">{PROFILE_TABS.map((label, i) => <button key={label} role="tab" aria-selected={tab === i} className={tab === i ? "is-active" : ""} onClick={() => setTab(i)}>{label}</button>)}</nav>
    <div className="fleet-card fleet-profile">
      {tab === 0 && <><h3>Данные партнёра</h3><p className="fleet-pill-row">CLID <u>400000{park.park_id.slice(0, 6).replace(/\D/g, "7")}</u> · ИНН <u>2303400{park.park_id.slice(6, 11).replace(/\D/g, "1")}</u></p>
        <h3>Счета для выплат</h3><p className="fleet-muted">Для поступлений от сервиса</p><div className="fleet-row-card"><span>Банковские реквизиты<small>БИК TRAINKZX · ИИК KZ00 0000 0000 0000 учебный</small></span><button className="fleet-btn" disabled>Изменить</button></div><p className="fleet-muted fleet-center">Изменение реквизитов доступно только в роли директора</p></>}
      {tab === 1 && <><h3>📍 {park.city}, учебный офис парка «{park.name}»</h3><ul className="fleet-contacts"><li>🎁 Зови друзей и получай 5 000 ₸ за каждого</li><li>☎ Для новых исполнителей: +7 700 000 00 01</li><li>✔ Сертифицированный партнёр</li><li>☎ Для активных исполнителей: +7 700 000 00 02</li><li>％ Базовая комиссия 2%</li><li>🔗 Ссылка на сайт провайдера «Сапар» для подключения ЭДО</li><li>🕘 Пн–Пт, 09:00–19:00</li></ul></>}
      {tab === 2 && <><h3>Оплата кабинета Яндекс Про для бизнеса</h3><p>Базовая ставка — 0,2% от суммы всех заказов за месяц + НДС. Скидка зависит от уровня в программе лояльности.</p><p className="fleet-big">{money(56152.94)}</p><p className="fleet-muted">Учебный расчёт за текущий месяц</p></>}
      {tab === 3 && <><h3>Контакты для новостей и пассажиров</h3><p className="fleet-muted">Телефон и почта парка для рассылок Яндекса</p><label className="fleet-check"><input type="checkbox" disabled /> Запретить исполнителям выключать тарифные категории в приложении</label><label className="fleet-check"><input type="checkbox" defaultChecked disabled /> Получать заявки от кандидатов со статусом СМЗ</label></>}
    </div></div>;
}

// A stable spot on the map for every driver, from the id.
const spot = (id: string) => { const n = parseInt(id.slice(0, 8), 16); return { x: 60 + n % 520, y: 50 + Math.floor(n / 600) % 300 }; };
export function MapPage() {
  const { state, park, go } = useFleet();
  const [filter, setFilter] = useState<string>(""), [hover, setHover] = useState("");
  const drivers = parkDrivers(state, park.id).filter(d => d.works);
  const chips: [string, string, number][] = [["free", "Свободно", drivers.filter(d => d.status === "free").length], ["order", "На заказе", drivers.filter(d => d.status === "order").length], ["busy", "Занято", drivers.filter(d => d.status === "busy").length], ["nogps", "Нет GPS", drivers.filter(d => !d.gps).length]];
  const shown = drivers.filter(d => !filter || (filter === "nogps" ? !d.gps : d.status === filter));
  return <div className="fleet-page fleet-map-page"><FleetHead title="На карте" />
    <div className="fleet-chips">{chips.map(([id, label, n]) => <button key={id} className={`fleet-chip is-count is-${id}${filter === id ? " is-on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(f => f === id ? "" : id)}><b>{n}</b>{label}</button>)}</div>
    <div className="fleet-map-layout">
      <ul className="fleet-map-list" aria-label="Исполнители на карте">{shown.map(d => <li key={d.id}><button className={hover === d.id ? "is-hover" : ""} onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover("")} onFocus={() => setHover(d.id)} onClick={() => go(`driver/${d.id}`)}>
        <Avatar name={fullName(d)} status={d.status} /><span><strong>{fullName(d)}</strong><small>{STATUS[d.status].label}{!d.gps && " · NO GPS"}</small><small>{money(d.balance)} · {d.car?.plate ?? "курьер"}</small></span></button></li>)}
        {!shown.length && <li className="fleet-muted">Никого нет в этом статусе</li>}</ul>
      <svg className="fleet-map" viewBox="0 0 640 400" role="img" aria-label={`Карта: ${park.city}, исполнители парка`}>
        <rect width="640" height="400" className="fleet-map-land" /><path d="M-10 300C120 250 220 330 330 290S520 190 650 230" className="fleet-map-river" />
        {[80, 170, 260, 350].map(y => <path key={y} d={`M0 ${y}H640`} className="fleet-map-road" />)}{[110, 250, 390, 520].map(x => <path key={x} d={`M${x} 0V400`} className="fleet-map-road" />)}
        <path d="M0 20L640 380M0 380 640 40" className="fleet-map-road is-main" /><text x="300" y="196" className="fleet-map-city">{park.city}</text>
        {shown.map(d => { const p = spot(d.id); return <g key={d.id} className={`fleet-map-pin is-${d.gps ? d.status : "nogps"}${hover === d.id ? " is-hover" : ""}`} transform={`translate(${p.x} ${p.y})`}><circle r={hover === d.id ? 10 : 7} /><title>{fullName(d)}</title></g>; })}
      </svg>
    </div></div>;
}

export function RulesPage() {
  const { state } = useFleet();
  const [query, setQuery] = useState(""), [archive, setArchive] = useState(false);
  const rules = archive ? [] : state.rules.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="fleet-page"><FleetHead title="Условия сотрудничества"><button className="fleet-add" disabled title="В обучении условия не создают" aria-label="Добавить условие"><Icon name="plus" /></button></FleetHead>
    <p className="fleet-note">Условия сотрудничества — это комиссии парка. Справа видно, у скольких исполнителей подключено условие.</p>
    <div className="fleet-segmented" role="tablist"><button role="tab" aria-selected={!archive} className={!archive ? "is-on" : ""} onClick={() => setArchive(false)}>Активные</button><button role="tab" aria-selected={archive} className={archive ? "is-on" : ""} onClick={() => setArchive(true)}>Архив</button></div>
    <label className="fleet-inline-search is-small"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Введите название" aria-label="Название условия" /></label>
    <div className="fleet-table-card"><table className="fleet-table"><thead><tr><th>Название</th><th /><th className="fleet-num">Количество исполнителей</th></tr></thead>
      <tbody>{rules.map(r => <tr key={r.name}><td>{r.name}</td><td className="fleet-muted">{r.default ? "По умолчанию" : ""}</td><td className="fleet-num"><u>{r.count}</u></td></tr>)}</tbody></table>
      {!rules.length && <p className="fleet-empty-hint">{archive ? "В архиве пусто" : "Ничего не нашли"}</p>}</div>
  </div>;
}
