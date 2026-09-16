import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { driverShift, type ShiftActionName, type ShiftAct } from "../api/driverShift";
import { orderActive, type DriverState, type OrderAction, type OrderCreate } from "../api/driver";
import { DriverTripReviews } from "./DriverTripReviews";
import { DriverOrders } from "./DriverOrders";
import { DriverProfileViews, PROFILE_VIEWS } from "./DriverProfileViews";
import { DriverChats, DriverIntercity } from "./DriverWorkViews";
import { DriverMoney, MONEY_VIEWS } from "./DriverMoneyViews";
import { DCard, DForm, DInput, DRow, DToggle, type ShiftViewProps } from "./DriverShiftUI";
import { DAction, DCancel, DChoice } from "./DriverButtons";
import { CoinIcon, InboxIcon, TrophyIcon, UserIcon } from "../components/icons";
import { useDriverLocation } from "../hooks/useDriverLocation";
import { useDriverLocationConsent } from "../hooks/useDriverLocationConsent";
import { useDriverNavigation } from "../hooks/useDriverNavigation";
import { DriverNavigationOrders } from "./DriverNavigationOrders";
import { dateTime } from "../utils/format";
import "./driver-shift.css";

export const SHIFT_TABS = [{ id: "orders", title: "Заказы", Icon: RoadIcon }, { id: "intercity", title: "Межгород", Icon: TrophyIcon }, { id: "money", title: "Деньги", Icon: CoinIcon }, { id: "chats", title: "Чаты", Icon: InboxIcon }, { id: "profile", title: "Профиль", Icon: UserIcon }];
const titles: Record<string, string> = { intercity: "Межгород", money: "Деньги", chats: "Чаты", profile: "Профиль", rating: "Рейтинг", levels: "Уровни", priority: "Приоритет", park: "Парк и сервисы", tariffs: "Тарифы", payment: "Способы оплаты", cars: "Мои автомобили", diagnostics: "Диагностика", photo: "Фотоконтроль", garage: "Гараж", fuel: "Заправки", benefits: "Предложения", promo: "Промокоды", invite: "Пригласить водителя", learning: "Обучение", legal: "Юридические документы", provider: "Документооборот", documents: "Закрывающие документы", settings: "Настройки", privacy: "Конфиденциальность", license: "Правила тренажёра", support: "Поддержка", transaction: "Операция", balance: "Баланс", payments: "История платежей", requisites: "Ваши реквизиты", earnings: "Доход", car: "Транспорт", about: "О вас", "intercity-history": "Межгород", "intercity-alerts": "Межгород", "shift-result": "Моя смена", "work-modes": "Заказы по пути" };
export function shiftTab(view: string) { return ["orders", "work-modes"].includes(view) ? "orders" : view.startsWith("intercity") ? "intercity" : MONEY_VIEWS.includes(view) ? "money" : ["chats", "support"].includes(view) ? "chats" : "profile"; }
function RoadIcon({ size = 22 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m7 3-4 18m14-18 4 18M12 3v4m0 3v4m0 3v4" /></svg>; }

interface Props { state: DriverState; fullName: string; busy: boolean; error?: unknown; failed?: boolean; create: (value: OrderCreate) => void; orderAction: (action: OrderAction) => void; switchPark: () => void; refresh: () => void }
export function DriverWorkspace({ state, fullName, busy: parentBusy, error: parentError, failed, create, orderAction, switchPark, refresh }: Props) {
  const shift = state.shift!;
  const [params, setParams] = useSearchParams();
  const contentRef = useRef<HTMLElement>(null);
  const alias: Record<string, string> = { income: "money", messages: "chats", results: "shift-result" };
  const raw = params.get("view") ?? params.get("section") ?? "orders";
  const view = shift.finished_at ? "shift-result" : alias[raw] ?? (raw === "orders" || titles[raw] ? raw : "orders");
  const detail = params.get("detail") ?? "";
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [view, detail]);
  const client = useQueryClient();
  const save = (data: DriverState) => client.setQueryData(["driver-profile"], data);
  const mutation = useMutation({ mutationFn: driverShift.act, networkMode: "always", scope: { id: "driver-shift" }, onSuccess: save, onError: refresh });
  const support = useMutation({ mutationFn: driverShift.support, networkMode: "always", onSuccess: refresh });
  const [exit, setExit] = useState(false);
  const [layers, setLayers] = useState(false);
  const [hint, setHint] = useState(false);
  const [consent, setConsent] = useDriverLocationConsent();
  const location = useDriverLocation(consent === "enabled" && !shift.finished_at);
  useDriverNavigation(state, location);
  const legacy = orderActive(state.order) && !state.order?.details?.navigation;
  const busy = parentBusy || mutation.isPending || support.isPending;
  const command = useRef<{ key: string; request_id: string }>();
  const act: ShiftAct = (action, values = {}) => {
    if (busy || shift.finished_at) return;
    const key = JSON.stringify([shift.id, shift.version, action, values]);
    if (command.current?.key !== key) command.current = { key, request_id: crypto.randomUUID() };
    mutation.mutate({ id: shift.id, request_id: command.current.request_id, action, values });
  };
  function go(next: string, id?: string) { const tab = shiftTab(next); setParams({ section: tab, ...(next !== tab ? { view: next } : {}), ...(id ? { detail: id } : {}) }); }
  const visited = useRef("");
  useEffect(() => {
    const key = `${shift.id}:${view}:${detail}`;
    if (shift.finished_at || busy || visited.current === key) return;
    visited.current = key;
    mutation.mutate({ id: shift.id, request_id: crypto.randomUUID(), action: "visit", values: { view, ...(detail ? { id: detail } : {}) } });
  }, [view, detail, shift.id, shift.finished_at, busy, mutation.mutate]);
  const prefs = shift.data.settings;
  const [systemLight, setSystemLight] = useState(() => window.matchMedia("(prefers-color-scheme: light)").matches);
  useEffect(() => { const q = window.matchMedia("(prefers-color-scheme: light)"), change = () => setSystemLight(q.matches); q.addEventListener("change", change); return () => q.removeEventListener("change", change); }, []);
  // Смена темы раньше подменяла всю палитру одним кадром. Класс живёт полсекунды и
  // на это время включает переход цвета по всему приложению.
  const light = prefs.theme === "light" || (prefs.theme === "system" && systemLight);
  const [theming, setTheming] = useState(false);
  const knownTheme = useRef<boolean | null>(null);
  useEffect(() => {
    if (knownTheme.current === null || knownTheme.current === light) { knownTheme.current = light; return; }
    knownTheme.current = light;
    setTheming(true);
    const timer = window.setTimeout(() => setTheming(false), 520);
    return () => window.clearTimeout(timer);
  }, [light]);
  const error = mutation.error || support.error || parentError;
  const active = orderActive(state.order) && state.order?.shift_id === shift.id;
  const viewProps: ShiftViewProps = { shift, state, fullName, view, detail, busy, act, go, switchPark, support: () => { support.mutate({ shift_id: shift.id, id: crypto.randomUUID(), topic: "payment" }); } };
  return <div className={`driver-app driver-workspace${light ? " ds-light" : ""}${theming ? " ds-theming" : ""}${prefs.hide_income ? " ds-hide-income" : ""}`}>
    <header className="driver-header"><button className="driver-exit" onClick={() => setExit(true)}>‹ Puls</button><button className="ds-shift-name" onClick={() => go("shift-result")}>{shift.is_preview ? "Тестовая проверка" : shift.mode === "free" ? "Свободный режим" : "Учебная смена"} · {shift.data.completed}/{shift.config.target_orders}</button><span className="driver-environment">Учебный</span></header>
    <main ref={contentRef} className={`driver-content${view === "orders" ? legacy ? " driver-content--orders ds-orders" : " dn-content" : ""}`}>
      {view === "orders" && !legacy ? <DriverNavigationOrders state={state} location={location} consent={consent} allowLocation={() => setConsent("enabled")} declineLocation={() => setConsent("off")} busy={busy} create={create} shiftAct={act} go={go} /> : view === "orders" ? <><div className="ds-mapbar"><button onClick={() => go("priority")}>+{shift.data.priority} Приоритет</button><button onClick={() => setLayers(!layers)} aria-expanded={layers}>Слои схемы</button><button onClick={() => go("work-modes")}>{({ all: "Все заказы", home: "Домой", business: "По делам", area: "По району" })[shift.data.work_mode] ?? "Все заказы"}</button></div>
        {layers && <div className="ds-layer-panel"><p>Слои показаны в учебной схеме текущего заказа.</p>{[["demand", "Спрос"], ["traffic", "Пробки"], ["bonus_zones", "Бонусные зоны"], ["special_zones", "Специальные зоны"]].map(([key, title]) => <DToggle key={key} title={title} disabled={busy} checked={!!prefs[key as keyof typeof prefs]} onChange={() => act("setting", { key, value: !prefs[key as keyof typeof prefs] })} />)}</div>}
        <DriverOrders order={state.order?.shift_id === shift.id ? state.order : null} summary={{ count: shift.data.completed, gross: 0, commission: 0, net: shift.data.balance }} serverNow={state.server_now} position={location.fix} location={location} busy={busy} failed={failed || mutation.isError} onCreate={create} onAction={orderAction} onIncome={() => go("money")} shift={shift} shiftAct={act} go={go} />
      </> : <div className={`driver-section ds-section${MONEY_VIEWS.includes(view) ? " ds-money-section" : PROFILE_VIEWS.includes(view) ? " ds-profile-section" : ""}`}>{MONEY_VIEWS.includes(view) || PROFILE_VIEWS.includes(view) ? active && <button className="ds-resume-order" onClick={() => go("orders")}>Продолжить заказ →</button> : <div className="ds-page-heading">{!shift.finished_at && (!SHIFT_TABS.some(x => x.id === view) || detail) && <button className="driver-back" onClick={() => go(shiftTab(view))}>‹ Назад</button>}<h1>{titles[view] ?? "Профиль"}</h1>{active && <button className="ds-resume-order" onClick={() => go("orders")}>Продолжить заказ →</button>}</div>}
        {MONEY_VIEWS.includes(view) ? <DriverMoney {...viewProps} /> : ["chats", "support"].includes(view) ? <div className="du-screen" key={view}><DriverChats {...viewProps} /></div> : view.startsWith("intercity") ? <div className="du-screen" key={view}><DriverIntercity {...viewProps} /></div> : view === "shift-result" ? <div className="du-screen"><ShiftReview {...viewProps} hint={hint} onHint={() => { if (!hint) act("hint"); setHint(!hint); }} /></div> : view === "work-modes" ? <DCard title="Заказы по пути"><DForm busy={busy} label="Сохранить режим" onSubmit={values => act("work_mode", values)}><label>Режим<select name="mode" defaultValue={shift.data.work_mode}><option value="all">Все заказы</option><option value="home">Домой</option><option value="business">По делам</option><option value="area">По району</option></select></label><DInput label="Адрес или район" name="address" value={shift.data.mode_address || "Алматы"} /></DForm><p>Выбранное направление будет предложено как точка Б следующего заказа.</p><DChoice arrow onClick={() => go("orders")}>Вернуться на карту</DChoice></DCard> : <DriverProfileViews {...viewProps} />}
        {view === "support" && support.data?.url && <DCard title="Ссылка на ваше обращение"><a className="driver-primary" href={support.data.url} target="_blank" rel="noreferrer">Открыть Telegram →</a><DChoice onClick={refresh}>Я вернулся · проверить результат</DChoice></DCard>}
      </div>}
    </main>
    {error instanceof Error && <div className="ds-inline-error" role="alert"><span>{error.message}</span><button onClick={() => { mutation.reset(); support.reset(); refresh(); }}>Обновить</button></div>}
    <nav className="driver-nav" aria-label="Разделы водительского приложения">{SHIFT_TABS.map(({ id, title, Icon }) => <button key={id} disabled={!!shift.finished_at} title={shift.finished_at ? "Смена завершена. Новую можно начать из обучения." : undefined} aria-current={shiftTab(view) === id ? "page" : undefined} className={shiftTab(view) === id ? "is-active" : ""} onClick={() => go(id)}><Icon size={22} /><span>{title}</span></button>)}</nav>
    {exit && <div className="ds-dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ds-exit-title" className="driver-card ds-dialog"><h2 id="ds-exit-title">Вернуться в Puls?</h2><p>Смена и текущий этап заказа сохранены. Её можно продолжить из обучения.</p><Link className="driver-primary" to="/training?kind=simulator">Вернуться в Puls</Link><DChoice onClick={() => setExit(false)}>Остаться в симуляторе</DChoice></section></div>}
  </div>;
}

function ShiftReview({ shift, state, act, go, busy, hint, onHint }: ShiftViewProps & { hint: boolean; onHint: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const result = shift.result;
  const c = shift.config;
  return <>{shift.is_preview && <DCard title="Тестовая проверка"><p>Это прохождение не входит в статистику операторов и не выдаёт награды Puls.</p></DCard>}<DCard title={c.title}><strong className="ds-big">{result ? result.score === null ? "Свободная практика" : `${result.score}/100` : `${shift.data.completed}/${c.target_orders} заказов`}</strong><p>{result ? "Смена завершена. Ниже — результат и путь выполнения каждого пункта." : `Задание: выберите парк ${state.parks.find(x => x.id === c.required_park)?.name ?? c.required_park}, выполните ${c.target_orders} заказов, проверьте рейтинг и приоритет.`}</p>{!result && <p>{c.require_photo && "Пройдите фотоконтроль. "}{c.route_event && "Обработайте изменение адреса в первом заказе. "}{c.require_support && "Разберите проблему с выплатой: сначала детали операции, затем поддержка в Telegram. "}{c.require_documents && "Выберите ЭДО и подпишите учебный акт."}</p>}</DCard>
    {result ? <>{!!result.trips?.length && <DCard title="Поездки смены"><DriverTripReviews trips={result.trips} /></DCard>}<DCard title="Разбор задания">{result.checks.map(x => <div className="ds-check" key={x.key}><b className={x.done ? "ds-success" : ""}>{x.done ? "✓" : "○"}</b><div><strong>{x.title}</strong><p>{x.path}</p></div><span>{x.done ? x.weight : 0}/{x.weight}</span></div>)}</DCard><DCard title="Как прошла смена"><DRow title="Заказы" value={`${result.orders}/${result.target}`} /><DRow title="Время" value={`${Math.floor(result.seconds / 60)} мин ${result.seconds % 60} с`} /><DRow title="Ошибки" value={result.errors} /><DRow title="Подсказки" value={result.hints} /><DRow title="Снято баллов" value={result.penalties} /><DRow title="Лучший результат" value={state.shift_best === null ? "—" : `${state.shift_best}/100`} /></DCard><Link className="driver-primary" to="/training?kind=simulator">Новая смена в обучении</Link></> : <DCard title="Управление сменой"><DChoice disabled={busy} onClick={onHint}>{hint ? "Скрыть подсказку" : `Показать путь выполнения${shift.mode === "assessment" ? " · −1 балл" : ""}`}</DChoice>{hint && <p>Профиль → Фотоконтроль → Заказы → завершение и оплата. После задержки: Деньги → нужная выплата → Поддержка → Telegram → снова операция. Профиль → Рейтинг, Приоритет, Юридические документы → ЭДО → Подписать.</p>}<DAction label="Продолжить смену" onClick={() => go("orders")} readyNote="Вернётесь на карту к текущему этапу заказа." />{confirm ? <><p>Завершить с текущим результатом? Невыполненные пункты останутся в разборе.</p><DChoice className="du-danger" disabled={busy} onClick={() => act("finish")}>Да, завершить смену</DChoice><DChoice onClick={() => setConfirm(false)}>Продолжить работу</DChoice></> : <DCancel onClick={() => setConfirm(true)}>Завершить и посмотреть результат</DCancel>}</DCard>}
    <DCard title="История действий"><details><summary>Последние {shift.events.length} событий</summary><ol className="ds-event-log">{shift.events.slice().reverse().map(x => <li key={x.id}><time>{dateTime(x.at)}</time> · {eventLabel(x.action, x.details)}</li>)}</ol></details></DCard>
    {!!state.shift_history?.length && <DCard title="Последние смены">{state.shift_history.map(x => <details key={x.id}><summary>{dateTime(x.finished_at)} · {x.result.score === null ? "Свободный режим" : `${x.result.score}/100`}</summary>{x.result.checks.map(check => <DRow key={check.key} title={check.title} value={check.done ? "✓" : "Не выполнено"} note={check.path} />)}</details>)}</DCard>}
  </>;
}
function eventLabel(action: string, details: Record<string, unknown>) {
  if (action === "error") return `Ошибка действия: ${String(details.reason)}`;
  if (action === "visit") return `Открыт раздел «${titles[String(details.view)] ?? "Заказы"}»`;
  const labels: Partial<Record<ShiftActionName | "order_created" | "order_pay" | "order_cancel" | "order_missed" | "support_open" | "support_answer", string>> = { setting: "Изменена настройка", online: "Выход на линию", offline: "Уход с линии", order_created: "Начат заказ", order_pay: "Заказ оплачен", order_cancel: "Заказ отменён", order_missed: "Предложение пропущено", support_open: "Открыто обращение", support_answer: details.correct ? "Правильный ответ поддержке" : "Ошибка в ответе поддержке", photo_step: "Снят ракурс", photo_submit: "Пройден фотоконтроль", route_change: "Изменён маршрут", wallet: "Операция с балансом", doc_sign: "Подписан документ", provider: "Выбран ЭДО", finish: "Завершена смена", hint: "Использована подсказка", tariff: "Изменены тарифы", payment: "Выбрана оплата", car_add: "Добавлен автомобиль", car_select: "Выбран автомобиль", intercity_book: "Бронь межгорода", intercity_create: "Создано предложение", intercity_cancel: "Отмена брони", refuel: "Заправка", learning: "Изучен материал", work_mode: "Изменён режим заказов", passenger: "Связь с пассажиром", promo: "Применён промокод", rental: "Заявка на аренду", level_restore: "Восстановление уровня" };
  return labels[action as keyof typeof labels] ?? "Действие в смене";
}
