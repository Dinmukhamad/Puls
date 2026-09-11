import { useState, type ReactNode } from "react";
import { DForm, DInput, type ShiftViewProps } from "./DriverShiftUI";
import { DAction, DExplain, DInfo } from "./DriverButtons";
import { money } from "./DriverOrders";
import { dateTime } from "../utils/format";
import type { LedgerEntry } from "../api/driverShift";
import "./driver-money.css";

/* Строение раздела повторяет приложение парка: сводка за день, отдельный экран баланса
   с круглыми действиями, нижние шторки вместо форм посреди страницы, доход со сравнением
   и детализацией. Суммы и правила при этом остаются учебными и подписаны как учебные. */

export const MONEY_VIEWS = ["money", "balance", "transaction", "payments", "requisites", "earnings"];
/** Минимальный баланс, ниже которого тренажёр перестаёт выдавать заказы. В парке его задаёт сам парк. */
export const BALANCE_LIMIT = -50;
const statuses = { complete: "Завершена", pending: "В обработке", failed: "Не выполнена" };
const DAY = 86400000;
const monthShort = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const stamp = (value: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();

/** Суммы по дням за последнюю неделю: последний столбец — сегодня. */
export function weekBuckets(ledger: LedgerEntry[], now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const from = midnight.getTime() - (6 - index) * DAY;
    const day = ledger.filter(x => { const t = stamp(x.at); return t >= from && t < from + DAY; });
    return {
      from, now: index === 6, date: new Date(from),
      income: day.filter(x => x.amount > 0).reduce((sum, x) => sum + x.amount, 0),
      spent: day.filter(x => x.amount < 0).reduce((sum, x) => sum - x.amount, 0),
    };
  });
}

function Glyph({ name }: { name: "lock" | "plus" | "up" | "more" | "calendar" | "card" | "clock" | "hand" }) {
  const paths: Record<string, ReactNode> = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    up: <path d="M12 20V5m0 0-6 6m6-6 6 6" />,
    more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4m8-4v4" /></>,
    card: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** Пустое состояние: собственная иллюстрация тренажёра, не заимствованная у парка. */
function Empty({ title, text, page }: { title: string; text: string; page?: boolean }) {
  return <div className={`dm-empty${page ? " dm-empty--page" : ""}`}>
    <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <rect x="16" y="34" width="88" height="60" rx="14" stroke="currentColor" strokeWidth="4" opacity=".35" />
      <path d="M16 52h56a10 10 0 0 1 0 20H16" stroke="currentColor" strokeWidth="4" opacity=".35" />
      <circle cx="60" cy="62" r="9" fill="var(--driver-yellow)" />
      <path d="M31 34 46 17a10 10 0 0 1 13-2l24 15" stroke="currentColor" strokeWidth="4" opacity=".35" strokeLinecap="round" />
    </svg>
    <strong>{title}</strong>
    <p>{text}</p>
  </div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="dm-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="dm-sheet-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
    <section className="dm-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  </div>;
}

export function DriverMoney(p: ShiftViewProps) {
  // Ключ по экрану заставляет анимацию появления проигрываться заново при переходе.
  return <div className="du-screen" key={p.view}><MoneyScreen {...p} /></div>;
}

function MoneyScreen(p: ShiftViewProps) {
  const { shift, state, view, detail, go, act, busy } = p;
  const d = shift.data;
  const [sheet, setSheet] = useState<"topup" | "withdraw" | "more" | "period" | "card" | null>(null);
  const [tab, setTab] = useState<"complete" | "pending">("complete");
  const [earnTab, setEarnTab] = useState<"compare" | "detail">("compare");
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const hidden = d.settings.hide_income;
  const sum = (value: number) => hidden ? "••••" : money(value);
  const week = weekBuckets(d.ledger);
  const today = week[6];
  const back = (to: string) => <button className="dm-back" type="button" aria-label="Назад" onClick={() => go(to)}>←</button>;

  if (view === "transaction") {
    const entry = d.ledger.find(x => x.id === detail);
    if (!entry) return <><div className="dm-head">{back("balance")}</div><Empty page title="Операция не найдена" text="Вернитесь к списку и выберите её заново." /></>;
    return <>
      <div className="dm-head">{back("balance")}</div>
      <div className="dm-hero"><span>{entry.title}</span><strong>{entry.amount > 0 ? "+" : ""}{sum(entry.amount)}</strong></div>
      <div className="dm-card">
        <div className="dm-tile"><div><strong>Статус</strong></div><b>{statuses[entry.status]}</b></div>
        <div className="dm-tile"><div><strong>Время</strong></div><b>{dateTime(entry.at)}</b></div>
        {entry.order_id && <div className="dm-tile"><div><strong>Заказ</strong></div><b>{entry.order_id.slice(0, 8)}</b></div>}
      </div>
      {entry.note && <p className="driver-muted">{entry.note}</p>}
      <DInfo title="Не сходится сумма?"><p>Откройте поддержку: обращение уже связано с этой сменой и последним заказом.</p></DInfo>
      <DAction label="Разобрать в поддержке" busy={busy} onClick={() => go("support")} readyNote="Откроется учебная поддержка с обращением по этой смене." />
    </>;
  }

  if (view === "payments") {
    return <>
      <div className="dm-head">{back("balance")}</div>
      {d.fuel.length ? <div className="dm-card"><div className="dm-list">{[...d.fuel].reverse().map((x, i) => <div className="dm-entry" key={i}>
        <span className="dm-mark"><Glyph name="card" /></span>
        <div><strong>Заправка · {x.liters} л</strong><small>{dateTime(x.at)}</small></div>
        <b>−{sum(x.amount)}</b>
      </div>)}</div></div> : <Empty page title="Пока что тут ничего нет" text="Вы ещё не совершали платежей" />}
    </>;
  }

  if (view === "requisites") {
    return <>
      <div className="dm-head">{back("balance")}<h1>Ваши реквизиты</h1></div>
      <div className="dm-card">
        <button className="dm-tile" type="button" onClick={() => setSheet("card")}>
          <span className="dm-mark"><Glyph name="plus" /></span>
          <div><strong>Добавить карту</strong></div>
          <b aria-hidden="true">›</b>
        </button>
      </div>
      <DExplain real="карта привязывается к вашему счёту, на неё приходят выплаты парка." sim="реквизиты не сохраняются и не запрашиваются: номер карты вводить негде и не нужно." />
      {sheet === "card" && <Sheet title="Добавление карты" onClose={() => setSheet(null)}>
        <p>Тренажёр не принимает номера карт. В приложении парка здесь открывается форма банка, а выплаты уходят на привязанную карту.</p>
      </Sheet>}
    </>;
  }

  if (view === "earnings") {
    const income = week.reduce((s, x) => s + x.income, 0), spent = week.reduce((s, x) => s + x.spent, 0);
    const periods = { day: "По дням", week: "По неделям", month: "По месяцам" };
    const empty = !d.ledger.length;
    return <>
      <div className="dm-earn-head">
        {back("money")}
        <div className="dm-segments">
          <button type="button" aria-pressed={earnTab === "compare"} onClick={() => setEarnTab("compare")}>Сравнение</button>
          <button type="button" aria-pressed={earnTab === "detail"} onClick={() => setEarnTab("detail")}>Детализация</button>
        </div>
        <button className="dm-calendar" type="button" aria-label="Выбрать период" onClick={() => setSheet("period")}><Glyph name="calendar" /></button>
      </div>
      <div className="dm-hero"><span>Сегодня</span><strong>{sum(today.income)}</strong></div>
      {earnTab === "compare" ? <div className="dm-chart">{week.map(day => <div key={day.from} data-now={day.now}>
        <em>{hidden ? "•" : day.income}</em>
        <i style={{ height: `${6 + Math.round(Math.min(1, day.income / Math.max(1, ...week.map(x => x.income))) * 44)}px` }} />
        <span>{day.date.getDate()}</span>
        <small>{monthShort[day.date.getMonth()]}</small>
      </div>)}</div> : <div className="dm-breakdown">
        <div><i>поступления</i><b>{hidden ? "••" : income}</b></div>
        <div><i>списания</i><b>{hidden ? "••" : spent}</b></div>
        <div><i>доход</i><b>{hidden ? "••" : income - spent}</b></div>
      </div>}
      {empty && <Empty title="Нет данных о заработке" text="За выбранный период вы не выполняли заказы и никакие операции не проводились" />}
      <DInfo title={`Период: ${periods[period]}`}><p>Тренажёр показывает одну смену, поэтому столбцы за прошлые дни пустые. Переключатель периода оставлен, чтобы вы нашли его в приложении парка.</p></DInfo>
      {sheet === "period" && <Sheet title="Детализация" onClose={() => setSheet(null)}>
        <div>{(Object.keys(periods) as (keyof typeof periods)[]).map(key => <button className="dm-choice" type="button" key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>
          <span>{periods[key]}</span><i aria-hidden="true">✓</i>
        </button>)}</div>
        <DAction label="Выбрать" onClick={() => setSheet(null)} />
      </Sheet>}
    </>;
  }

  if (view === "balance") {
    const entries = d.ledger.filter(x => tab === "pending" ? x.status === "pending" : x.status !== "pending");
    const pending = d.ledger.filter(x => x.status === "pending").length;
    return <>
      <div className="dm-head">{back("money")}</div>
      <div className="dm-card">
        <div className="dm-hero"><span>Баланс</span><strong>{sum(d.balance)}</strong></div>
        <div className="dm-actions">
          <button type="button" onClick={() => setSheet("topup")}><i><Glyph name="plus" /></i><span>Пополнить</span></button>
          <button type="button" onClick={() => setSheet("withdraw")}><i><Glyph name="up" /></i><span>Вывести</span></button>
          <button type="button" onClick={() => setSheet("more")}><i><Glyph name="more" /></i><span>Ещё</span></button>
        </div>
      </div>
      <h2 className="dm-section-title">История транзакций</h2>
      <div className="dm-segments">
        <button type="button" aria-pressed={tab === "complete"} onClick={() => setTab("complete")}>Завершенные</button>
        <button type="button" aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>В процессе · {pending}</button>
      </div>
      {entries.length ? <div className="dm-card"><div className="dm-list">{[...entries].reverse().map(x => <button className="dm-entry" type="button" key={x.id} onClick={() => go("transaction", x.id)}>
        <span className="dm-mark"><Glyph name={x.status === "pending" ? "clock" : "card"} /></span>
        <div><strong>{x.title}</strong><small>{statuses[x.status]} · {dateTime(x.at)}</small></div>
        <b data-sign={x.amount > 0 ? "plus" : undefined}>{x.amount > 0 ? "+" : "−"}{sum(Math.abs(x.amount))}</b>
      </button>)}</div></div> : <Empty title="Тут пусто" text="Сейчас у вас нет таких операций" />}

      {sheet === "topup" && <Sheet title="Пополнение баланса" onClose={() => setSheet(null)}>
        <p>Для пополнения баланса выполните несколько заказов с безналичной оплатой.</p>
        <DExplain real="прямого пополнения нет: баланс растёт с безналичных заказов." sim="форма ниже двигает учебную сумму, чтобы вы увидели операцию в истории." />
        <DForm busy={busy} label="Пополнить учебный баланс" onSubmit={values => { act("wallet", { ...values, kind: "topup" }); setSheet(null); }}>
          <DInput label="Сумма, ₸" name="amount" type="number" min={100} max={100000} value={1000} />
        </DForm>
      </Sheet>}

      {sheet === "withdraw" && <Sheet title="Вывод средств" onClose={() => setSheet(null)}>
        <p>Доступно к выводу: {sum(d.available)}. Ожидает обработки: {sum(d.reserved)}.</p>
        <DExplain real="деньги уходят на привязанную карту, парк удерживает комиссию по своим правилам." sim="настоящих переводов нет: запрос появится в истории со статусом «В обработке»." />
        <DForm busy={busy} label="Запросить учебную выплату" onSubmit={values => { act("wallet", { ...values, kind: "withdraw" }); setSheet(null); }}>
          <DInput label="Сумма, ₸" name="amount" type="number" min={100} max={100000} value={1000} />
        </DForm>
      </Sheet>}

      {sheet === "more" && <Sheet title="Ещё" onClose={() => setSheet(null)}>
        <div className="dm-sheet-rows">
          <button type="button" onClick={() => { setSheet(null); go("payments"); }}><span><Glyph name="calendar" /></span><span>История платежей</span><b aria-hidden="true">›</b></button>
          <button type="button" onClick={() => { setSheet(null); go("requisites"); }}><span><Glyph name="card" /></span><span>Реквизиты</span><b aria-hidden="true">›</b></button>
        </div>
      </Sheet>}
    </>;
  }

  return <>
    <div className="dm-head">
      <h1>Деньги</h1>
      <button className="dm-support" type="button" onClick={() => go("support")}><Glyph name="hand" />Поддержка</button>
    </div>
    <button className="dm-card dm-today" type="button" onClick={() => go("earnings")}>
      <div><strong>{sum(today.income)}</strong><span>Сегодня</span></div>
      <div className="dm-week">{week.map(day => <div key={day.from} data-now={day.now}><i /><span>{day.date.getDate()}</span></div>)}</div>
    </button>
    <div className="dm-card">
      <div className="dm-tile">
        <span className="dm-mark"><Glyph name="lock" /></span>
        <div><strong>Лимит баланса</strong><small>{d.balance >= BALANCE_LIMIT ? "Всё в порядке" : "Баланс ниже лимита — заказы не приходят"}</small></div>
        <b>{money(BALANCE_LIMIT)}</b>
      </div>
      <button className="dm-tile dm-tile--stack" type="button" onClick={() => go("balance")}>
        <span className="dm-tile__row"><strong>Баланс</strong><b>{sum(d.balance)}</b></span>
        <span className="dm-tile__park"><small>Парк</small><strong>{state.profile?.park?.name ?? "—"}</strong></span>
      </button>
    </div>
    <DInfo title="Откуда берутся эти суммы">
      <p>Учебный доход зачисляется после каждого завершённого заказа: стоимость минус комиссии сервиса и парка.</p>
      <p><b>Лимит баланса</b> — минимум, ниже которого парк перестаёт выдавать заказы. В тренажёре он равен {money(BALANCE_LIMIT)}.</p>
      <p>Настоящие деньги не списываются и не переводятся.</p>
    </DInfo>
  </>;
}
