import { useState } from "react";
import type { FleetDriver } from "../../api/dispatch";
import { Avatar, FleetHead, Icon, StatusChip, parkDrivers, useFleet } from "./FleetUi";
import { SEGMENTS, STATUS, fullName, matchesQuery, money, phone } from "./fleetNav";

/** «Исполнители»: accounts of the chosen park; a row opens the preview, the name — the account. */
export function ContractorsPage() {
  const { state, park, route, go, notify } = useFleet();
  const [segment, setSegment] = useState<FleetDriver["segment"] | "">(""), [query, setQuery] = useState("");
  const all = parkDrivers(state, park.id);
  const warnings = all.filter(d => d.works && !d.diagnostics.ok).length;
  const rows = all.filter(d => (!segment || d.segment === segment) && (query.trim().length < 3 || matchesQuery(d, query)));
  const open = all.find(d => d.id === route.id);
  return <div className={`fleet-page fleet-contractors${open ? " has-preview" : ""}`}>
    <FleetHead title="Исполнители"><button className="fleet-add" disabled title="В обучении новых исполнителей не добавляют" aria-label="Добавить исполнителя"><Icon name="plus" /></button></FleetHead>
    <div className="fleet-chips" role="toolbar" aria-label="Сегменты исполнителей">
      <span className="fleet-chip is-warn"><b>{warnings}</b> Предупреждения</span>
      <span className="fleet-chip is-blue"><b>{all.filter(d => d.priority.can.length).length}</b> Возможности</span>
      <span className="fleet-chip-sep" aria-hidden="true">•</span>
      {SEGMENTS.map(([id, label]) => <button key={id} className={`fleet-chip${segment === id ? " is-on" : ""}`} aria-pressed={segment === id} data-coach={`segment-${id}`} onClick={() => setSegment(s => s === id ? "" : id)}>{label} <small>{all.filter(d => d.segment === id).length}</small>{segment === id && <Icon name="close" />}</button>)}
    </div>
    <div className="fleet-toolbar">
      <label className="fleet-inline-search" data-coach="list-search"><span className="fleet-count"><Icon name="people" />{rows.length}</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по имени, ВУ или позывному" aria-label="Поиск по имени, ВУ или позывному" /></label>
      <button className="fleet-chip" disabled title="Фильтры в обучении не нужны"><Icon name="plus" /> Фильтры</button>
      <button className="fleet-chip fleet-toolbar-end" onClick={() => notify("Список уже отсортирован по фамилии.")}>Сортировка ⇅</button>
    </div>
    <div className="fleet-split">
      <div className="fleet-table-card">
        <table className="fleet-table fleet-drivers" data-coach="drivers-table">
          <thead><tr><th>ФИО</th><th>Телефон</th><th className="fleet-num">Баланс и лимит</th></tr></thead>
          <tbody>{rows.map(d => <tr key={d.id} className={d.id === route.id ? "is-selected" : ""} data-driver={d.id} onClick={() => go(`contractors/${d.id}`)}>
            <td><button className="fleet-person" data-coach="driver-row" onClick={e => { e.stopPropagation(); go(`contractors/${d.id}`); }}><Avatar name={fullName(d)} /><span><strong>{fullName(d)}</strong><StatusChip d={d} /></span></button></td>
            <td>{phone(d.phone)}</td>
            <td className="fleet-num"><span className="fleet-balance">{money(d.balance, 0)}</span> <span className="fleet-limit-grey">{money(d.account_limit, 0)}</span></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <p className="fleet-empty-hint">{all.length ? "Никого не нашли — сбросьте фильтр или проверьте запрос." : `В парке «${park.name}, ${park.city}» пока нет исполнителей.`}</p>}
      </div>
      {open && <Preview d={open} />}
    </div>
  </div>;
}

/** The card beside the list: the name leads to the whole account. */
function Preview({ d }: { d: FleetDriver }) {
  const { go, state } = useFleet();
  const tags = [d.car ? "Свой автомобиль" : "Без автомобиля", d.profession, d.employment, STATUS[d.status].label, d.rating ? `Рейтинг ${d.rating.toLocaleString("ru-RU")}` : "", d.priority.label].filter(Boolean);
  return <aside className="fleet-preview" data-coach="preview" data-driver={d.id} aria-label={`Исполнитель ${fullName(d)}`}>
    <button className="fleet-close fleet-preview-close" aria-label="Закрыть карточку" onClick={() => go("contractors")}><Icon name="close" /></button>
    <div className="fleet-preview-top"><Avatar name={fullName(d)} size="l" status={d.status} />
      <div><button className="fleet-preview-name" data-coach="preview-name" onClick={() => go(`driver/${d.id}`)}>{fullName(d)} <Icon name="chevron" /></button>
        <div className="fleet-tags">{tags.map(t => <span key={t}>{t}</span>)}</div></div></div>
    <dl className="fleet-preview-facts">
      <div><dt>Телефон</dt><dd>{phone(d.phone)}</dd></div><div><dt>Статус</dt><dd className={d.works ? "is-good" : "is-bad"}>{d.works ? "Работает" : "Не работает"}</dd></div>
      <div><dt>ВУ</dt><dd>{d.license || "—"}</dd></div><div><dt>Условия</dt><dd>{d.rule}</dd></div>
      <div><dt>Автомобиль</dt><dd>{d.car ? `${d.car.plate} ${d.car.brand} ${d.car.model}` : "—"}</dd></div><div><dt>Лимит</dt><dd>{money(d.account_limit, 0)}</dd></div>
    </dl>
    <div className="fleet-preview-tiles">
      <div><span>Баланс</span><strong>{money(d.balance)}</strong></div>
      <div><span>Бонусы</span><strong>{d.bonus ? `${d.bonus.done} из ${d.bonus.target}` : "Нет активных бонусов"}</strong></div>
      <div><span>Инвентарь</span><strong>{d.thermobox ? `${state.catalog.inventory[d.thermobox.type]} № ${d.thermobox.number}` : "Инвентарь пока не выдан"}</strong></div>
      <div><span>Диагностика</span><strong className={d.diagnostics.ok ? "is-good" : "is-bad"}>{d.diagnostics.title}</strong></div>
    </div>
    <button className="fleet-btn fleet-btn--yellow" onClick={() => go(`driver/${d.id}`)}>Открыть карточку исполнителя</button>
  </aside>;
}
