import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { orderActive, type DriverOrder, type DriverOrderSummary, type OrderAction, type OrderCreate } from "../api/driver";
import { SimulatorMap, type Position } from "../components/SimulatorMap";
import { freshFix, pickupAllowed, pointOf, distanceMeters, type GeoPoint, type LocationState } from "../utils/driverLocation";
import { dateTime } from "../utils/format";
import type { DriverShift, ShiftAct } from "../api/driverShift";
import { DForm, DInput } from "./DriverShiftUI";
import { DAction, DCancel, DChoice, DExplain } from "./DriverButtons";
import { DriverOrderMap } from "./DriverOrderMap";

export const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
export const orderStageLabel = { searching: "Поиск заказа", offer: "Новый заказ", pickup: "Едем к пассажиру", waiting: "Ожидаем пассажира", trip: "В поездке", payment: "Оплата поездки", complete: "Заказ выполнен", cancelled: "Заказ отменён" };
const utc = (value: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();
export function orderTiming(order: DriverOrder, serverNow: string, sinceResponse = 0) {
  const elapsed = Math.max(0, (utc(serverNow) - utc(order.stage_started_at)) / 1000 + sinceResponse);
  const remaining = Math.max(0, order.duration_seconds - elapsed);
  return { elapsed, remaining, progress: order.duration_seconds ? Math.min(1, elapsed / order.duration_seconds) : 0, ready: remaining <= 0 };
}
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const zeroSummary = { count: 0, gross: 0, commission: 0, net: 0 };

interface Props {
  location?: LocationState & { retry: () => void };
  shift?: DriverShift; shiftAct?: ShiftAct; go?: (view: string) => void;
  order?: DriverOrder | null; summary?: DriverOrderSummary; serverNow?: string; position: Position | null;
  busy: boolean; failed?: boolean; onCreate?: (payload: OrderCreate) => void; onAction?: (action: OrderAction) => void; onIncome: () => void;
}
export function DriverOrders({ order, summary = zeroSummary, serverNow, position, busy, failed, onCreate, onAction, onIncome, shift, shiftAct, go, location }: Props) {
  const [manualPickup, setManualPickup] = useState<GeoPoint | null>(null);
  const fix = freshFix(position) ? position : null;
  const pickup = manualPickup ?? (fix ? pointOf(fix) : null);
  const canStart = pickupAllowed(fix, pickup);
  const geoStatus = <div className="driver-geo-status"><strong>{fix ? "Геопозиция определена" : "Для нового заказа нужна геопозиция"}</strong><p>{location?.message ?? (fix ? "Обновление каждые 10 секунд" : "Разрешите доступ к местоположению в браузере.")}</p>{fix && <small>Обновлено {new Date(fix.captured_at).toLocaleTimeString("ru-RU")} · ±{Math.round(fix.accuracy)} м</small>}{location && location.status !== "requesting" && <DChoice onClick={location.retry}>Обновить геопозицию</DChoice>}</div>;
  const [editing, setEditing] = useState(false);
  const [origin, setOrigin] = useState(order?.origin ?? "");
  const [destination, setDestination] = useState(order?.destination ?? "");
  const clockKey = `${order?.id}:${order?.stage}:${serverNow}`;
  const [tick, setTick] = useState({ key: clockKey, seconds: 0 });
  const sinceResponse = tick.key === clockKey ? tick.seconds : 0;
  const [help, setHelp] = useState<"passenger" | "payment" | "cancel" | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const creation = useRef<{ key: string; id: string }>();
  const autoSent = useRef("");
  const active = orderActive(order);
  const timing = order ? orderTiming(order, serverNow ?? order.stage_started_at, sinceResponse) : { elapsed: 0, remaining: 0, progress: 0, ready: false };
  useEffect(() => {
    const started = performance.now(); setTick({ key: clockKey, seconds: 0 });
    const timer = window.setInterval(() => setTick({ key: clockKey, seconds: (performance.now() - started) / 1000 }), 200);
    return () => window.clearInterval(timer);
  }, [clockKey]);
  useEffect(() => { setHelp(null); setTopic(null); if (active) setEditing(false); }, [order?.id, order?.stage, active]);
  useEffect(() => {
    if (!order || busy || failed || !timing.ready || document.visibilityState === "hidden") return;
    const action = order.stage === "searching" ? "offer" : order.stage === "payment" && order.payment === "card" ? "pay" : order.stage === "offer" && order.shift_id ? "missed" : order.stage === "pickup" && shift?.data.settings.auto_arrive ? "arrive" : order.stage === "waiting" && shift?.data.settings.auto_start ? "start_trip" : null;
    const key = `${order.id}:${order.stage}`;
    if (action && autoSent.current !== key) { autoSent.current = key; onAction?.(action); }
  }, [order, busy, failed, timing.ready, sinceResponse, onAction, shift]);
  const sounded = useRef("");
  useEffect(() => {
    if (!order || order.stage !== "offer" || sounded.current === order.id || !shift) return;
    sounded.current = order.id;
    if (shift.data.settings.vibration) navigator.vibrate?.([120, 80, 120]);
    if (shift.data.settings.volume && typeof AudioContext !== "undefined") {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 640; gain.gain.value = shift.data.settings.volume / 100 * .06;
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .25);
      oscillator.onended = () => { void context.close(); };
    }
  }, [order?.stage, order?.id, shift]);
  // Повторная проверка после явного повтора запроса доступна и при сбое автоэтапа.
  useEffect(() => { if (failed) autoSent.current = ""; }, [failed]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !freshFix(position) || !pickupAllowed(position, pickup) || !pickup) return;
    const from = origin.trim().replace(/\s+/g, " "), to = destination.trim().replace(/\s+/g, " ");
    if (from.length < 3 || to.length < 3 || from.toLocaleLowerCase() === to.toLocaleLowerCase()) return;
    const key = JSON.stringify([order?.id, from, to, pickup]);
    if (creation.current?.key !== key) creation.current = { key, id: crypto.randomUUID() };
    onCreate?.({ id: creation.current.id, origin: from, destination: to, location: position, pickup });
  };
  const startNew = () => { setManualPickup(null); setOrigin(order?.origin ?? ""); setDestination(shift?.data.work_mode !== "all" && shift?.data.mode_address ? shift.data.mode_address : order?.destination ?? ""); setEditing(true); };
  if (!active && (!order || order.stage === "cancelled" || editing)) return <>
    <div className="driver-map"><SimulatorMap position={fix} pickup={pickup} onPickup={editing && fix ? setManualPickup : undefined} progress={0} ready={false} idle realOnly /></div>
    <section className="driver-orders-panel driver-order-panel" aria-label="Подготовка учебного заказа">
      {geoStatus}
      {(!shift || shift.data.settings.widgets) && <div className="driver-stats"><div><span>Выполнено заказов</span><strong>{summary.count}</strong></div><button onClick={onIncome}><span>Учебный доход</span><strong>{money(summary.net)} ›</strong></button></div>}
      {!editing ? <><div className="driver-card driver-goals"><strong>{shift ? shift.data.online ? "Вы на линии" : "Подготовка к смене" : "Офлайн · Один заказ от начала до конца"}</strong><span>{shift?.data.photo_status !== undefined && shift.data.photo_status !== "passed" ? "Для выхода на линию нужен фотоконтроль" : "Подача, пассажир, поездка и оплата"}</span></div>{shift && !shift.data.online ? <><button className="driver-online" disabled={busy} onClick={() => shiftAct?.("online")}>На линию</button>{shift.data.photo_status !== "passed" && <DChoice arrow onClick={() => go?.("photo")}>Пройти фотоконтроль</DChoice>}</> : <button className="driver-online" onClick={startNew}>{shift ? "Подготовить следующий заказ" : "Выйти на линию"}</button>}{shift?.data.online && <DCancel disabled={busy} onClick={() => shiftAct?.("offline")}>Уйти с линии</DCancel>}</> : <form className="driver-route-form" onSubmit={submit}>
        <div><p className="driver-order-eyebrow">Подготовка маршрута</p><h1>Куда поедем?</h1></div>
        <label><span><b>А</b> Адрес подачи · подпись метки</span><input name="origin" value={origin} onChange={(event) => setOrigin(event.target.value)} minLength={3} maxLength={160} required placeholder="Улица и номер дома" autoComplete="off" /></label>
        <label><span><b>Б</b> Куда отвезти</span><input name="destination" value={destination} onChange={(event) => setDestination(event.target.value)} minLength={3} maxLength={160} required placeholder="Адрес назначения" autoComplete="off" /></label>
        <p className="driver-muted">Метка А находится у вас. Нажмите на карту, чтобы уточнить подачу в радиусе 500 м с учётом точности GPS. Введённый адрес — подпись метки, он не перемещает её.</p>
        {manualPickup && <DChoice onClick={() => setManualPickup(null)}>Вернуть подачу ко мне</DChoice>}
        {fix && !canStart && <p className="driver-geo-warning" role="alert">Переместите метку А ближе к себе — подача допускается в пределах 500 м с учётом точности GPS.</p>}
        <p className="driver-muted"> Оплата соответствует выбору в профиле. По умолчанию — случайно наличные или карта.</p>
        {origin.trim() && origin.trim().replace(/\s+/g, " ").toLocaleLowerCase() === destination.trim().replace(/\s+/g, " ").toLocaleLowerCase() && <p role="alert">Укажите разные адреса.</p>}
        <DAction type="submit" label="Начать поиск заказа" busy={busy} busyLabel="Выходим на линию…" blocked={!canStart || origin.trim().length < 3 || destination.trim().length < 3 || origin.trim().toLocaleLowerCase() === destination.trim().toLocaleLowerCase()} progress={((canStart ? 1 : 0) + (origin.trim().length >= 3 ? 1 : 0) + (destination.trim().length >= 3 && origin.trim().toLocaleLowerCase() !== destination.trim().toLocaleLowerCase() ? 1 : 0)) / 3} reason={!canStart ? "Метка А слишком далеко от вас — подача допускается в пределах 500 м." : origin.trim().length < 3 ? "Заполните адрес подачи." : destination.trim().length < 3 ? "Заполните адрес назначения." : "Адреса А и Б должны различаться."} readyNote="Вы выйдете на линию, и предложение придёт автоматически." />
        <DCancel disabled={busy} onClick={() => setEditing(false)}>Отменить подготовку заказа</DCancel>
      </form>}
    </section>
  </>;
  if (!order) return null;
  const canCancel = ["searching", "offer", "pickup", "waiting"].includes(order.stage);
  const stage = order.stage;
  const step = ({ searching: 0, offer: 0, pickup: 1, waiting: 2, trip: 3, payment: 4, complete: 5, cancelled: 0 })[stage];
  return <>
    <div className="driver-map"><SimulatorMap position={fix} pickup={order.details?.pickup} progress={0} ready={false} idle realOnly /></div>
    <section className={`driver-orders-panel driver-order-panel driver-order-panel--${stage}${collapsed ? " ds-collapsed" : ""}`} aria-label="Текущий учебный заказ">
      {geoStatus}
      <button className="ds-sheet-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Развернуть детали ∧" : "Свернуть детали ∨"}</button>
      <details className="driver-order-details"><summary>Учебная схема поездки</summary><div className="driver-training-route"><DriverOrderMap stage={stage} progress={timing.progress} origin={order.origin} destination={order.destination} preferences={shift?.data.settings} /><MapLayers shift={shift} /></div><p>Адрес Б — подпись в сценарии. Движение машины и маршрут на схеме учебные; синяя точка на основной карте показывает ваше реальное местоположение.</p></details>
      <div className="driver-order-heading"><div><p className="driver-order-eyebrow">{stage === "complete" ? "Учебная поездка" : `Шаг ${step + 1} из 5`}</p><h1>{orderStageLabel[stage]}</h1></div><span className={`driver-order-status${stage === "complete" ? " is-complete" : ""}`}>{stage === "complete" ? "✓" : "●"}</span></div>
      <div className="driver-order-steps" aria-label={`Пройдено этапов: ${step} из 5`}>{[0, 1, 2, 3, 4].map((item) => <span key={item} className={item <= step ? "is-done" : ""} />)}</div>
      {stage === "searching" && <><div className="driver-order-search" role="status"><span /><strong>Подбираем поездку рядом</strong><p>Вы на линии. Предложение появится автоматически.</p></div><Route order={order} /></>}
      {stage === "offer" && <>{order.shift_id && <p className="ds-countdown" role="timer">Принять за {Math.ceil(timing.remaining)} с</p>}<div className="driver-order-distance"><strong>{fix && order.details?.pickup ? `${Math.round(distanceMeters(fix, order.details.pickup))} м до подачи` : "Подача у точки А"}</strong><span>Расстояние по прямой · подача в учебном режиме</span></div><Route order={order} /><div className="driver-order-passenger"><span>Пассажир</span><strong>★ 4,88</strong></div><Payment order={order} /><Action label="Принять заказ" busy={busy} disabled={!!order.shift_id && timing.ready} progress={1 - timing.progress} reason="Время на ответ вышло — заказ ушёл другому водителю." readyNote="Нажатие примет заказ и построит подачу к точке А." onClick={() => onAction?.("accept")} /></>}
      {stage === "pickup" && <><Route order={order} single="origin" /><Travel progress={timing.progress} remaining={timing.remaining} readyText="Вы у точки А. Подтвердите прибытие." /><Action label="На месте" busy={busy} disabled={!timing.ready} progress={timing.progress} reason="Машина едет к точке А. Кнопка откроется по прибытии." readyNote="Вы у точки А. Нажатие начнёт ожидание пассажира." onClick={() => onAction?.("arrive")} /></>}
      {stage === "waiting" && <><div className="driver-order-wait"><span>{timing.ready ? "Платное ожидание" : "Бесплатное ожидание"}</span><strong>{clock(timing.ready ? (timing.elapsed - 4) * 30 : 120 - timing.elapsed * 30)}</strong>{timing.ready && shift && <small>{shift.config.wait_per_minute} ₸ / учебная минута · {money(Math.floor((timing.elapsed - 4) / 2) * shift.config.wait_per_minute)}</small>}</div><Route order={order} /><Payment order={order} /><p className="driver-order-hint" role="status">{timing.ready ? "Пассажир подошёл. Сверьте адрес назначения и начните поездку." : "Пассажир выходит к машине…"}</p><Action label="Начать поездку" busy={busy} disabled={!timing.ready} progress={timing.progress} reason="Пассажир выходит к машине. Кнопка откроется, когда он сядет." readyNote="Пассажир сел. Сверьте адрес Б и начинайте поездку." onClick={() => onAction?.("start_trip")} /></>}
      {stage === "trip" && <><Route order={order} single="destination" /><Travel progress={timing.progress} remaining={timing.remaining} readyText="Вы у точки Б. Завершите поездку." /><Payment order={order} /><details className="driver-order-details"><summary>Детали заказа</summary><Route order={order} /><p>Поездка: 10,3 км · 19 мин учебного времени.</p></details><Action label="Завершить поездку" busy={busy} disabled={!timing.ready} progress={timing.progress} reason="Едем к точке Б. Кнопка откроется по прибытии." readyNote="Вы у точки Б. Нажатие завершит поездку и откроет оплату." onClick={() => onAction?.("finish")} /></>}
      {stage === "payment" && <><div className="driver-order-total"><span>{order.payment === "cash" ? "Получите от пассажира" : "Оплата картой"}</span><strong>{money(order.fare)}</strong></div><p className="driver-order-hint" role="status">{order.payment === "cash" ? "В учебном сценарии пассажир передаёт точную сумму. Подтвердите получение наличных." : "Подтверждаем учебную оплату. Наличные с пассажира брать не нужно."}</p>{order.payment === "cash" ? <Action label="Деньги получены" busy={busy} disabled={!timing.ready} progress={timing.progress} reason="Пассажир достаёт деньги. Подождите пару секунд." readyNote="Подтвердите получение наличных — доход зачислится в учебный баланс." onClick={() => onAction?.("pay")} /> : <div className="driver-order-processing" role="status">{busy ? "Сохраняем результат…" : "Подтверждение оплаты…"}</div>}</>}
      {stage === "complete" && <><div className="driver-order-total"><span>Ваш учебный доход</span><strong>{money(order.net)}</strong></div><div className="driver-order-receipt"><div><span>Стоимость поездки</span><b>{money(order.fare)}</b></div>{order.details?.service_fee !== undefined && <><div><span>Комиссия сервиса</span><b>−{money(order.details.service_fee)}</b></div><div><span>НДС с комиссии сервиса</span><b>−{money(order.details.service_tax ?? 0)}</b></div>{(order.details.waiting_fee ?? 0) > 0 && <div><span>В том числе ожидание</span><b>{money(order.details.waiting_fee ?? 0)}</b></div>}</>}<div><span>Комиссия {order.park.name} · {order.park.commission}%</span><b>−{money(order.commission)}</b></div><div><span>Оплата</span><b>{order.payment === "cash" ? "Наличные получены" : "Карта · оплачено"}</b></div></div><details className="driver-order-details"><summary>Маршрут и пройденные этапы</summary><Route order={order} /><ol>{order.events.filter(event => !["offer", "cancel"].includes(event.action)).map(event => <li key={event.request_id}><span>{({ accept: "Заказ принят", arrive: "Прибытие на подачу", start_trip: "Поездка начата", finish: "Прибытие и завершение", pay: "Оплата подтверждена", offer: "Предложение", cancel: "Отмена", missed: "Пропущен" })[event.action]}</span><time>{dateTime(event.at)}</time></li>)}</ol></details><Action label="Следующий заказ" busy={busy} readyNote="Заказ закрыт. Можно готовить следующий маршрут." onClick={startNew} /><DChoice arrow onClick={onIncome}>Посмотреть доход</DChoice>{shift ? <DChoice arrow onClick={() => go?.("shift-result")}>Моя смена и результат</DChoice> : <Link className="driver-order-return" to="/training?kind=simulator">Завершить тренировку</Link>}</>}
      {shift && stage === "trip" && <details className="ds-order-extra" open={order.details?.route_event && !order.details.route_changed}><summary>{order.details?.route_event && !order.details.route_changed ? "Пассажир просит изменить адрес" : "Изменить точку Б"}</summary><DForm busy={busy} label="Обновить маршрут" onSubmit={values => shiftAct?.("route_change", values)}><DInput label="Новый адрес назначения" name="destination" /></DForm></details>}
      {shift && ["pickup", "waiting", "trip"].includes(stage) && <details className="ds-order-extra"><summary>Связь с пассажиром</summary><div className="ds-passenger-thread">{shift.data.passenger_messages.map((x, i) => <div key={i}><p>Вы: {x.text}</p><p>Пассажир: {x.reply}</p></div>)}</div><DForm busy={busy} label="Отправить учебное сообщение" onSubmit={values => shiftAct?.("passenger", values)}><DInput label="Сообщение пассажиру" name="text" /></DForm><DChoice disabled={busy} onClick={() => shiftAct?.("passenger", { text: "Учебный звонок пассажиру", call: true })}>Позвонить пассажиру</DChoice><DExplain real="открывается защищённый номер — ваш телефон пассажир не видит." sim="звонок не выполняется. Пассажир отвечает текстом, ответ появится в переписке выше." /><DChoice arrow onClick={() => go?.("support")}>Поддержка</DChoice></details>}
      {active && <div className="driver-order-tools">{!shift && !["searching", "offer"].includes(stage) && <DChoice onClick={() => { setHelp("passenger"); setTopic(null); }}>Пассажир и помощь</DChoice>}{canCancel && <DCancel disabled={busy} onClick={() => setHelp("cancel")}>{stage === "offer" ? "Пропустить заказ" : stage === "searching" ? "Уйти с линии" : "Отменить заказ"}</DCancel>}</div>}
      {help && <div className="driver-order-help" role="region" aria-label="Помощь по заказу"><div className="driver-order-help__heading"><h2>{help === "cancel" ? "Отменить учебный заказ?" : "Учебная связь"}</h2><button aria-label="Закрыть помощь" onClick={() => setHelp(null)}>×</button></div>{help === "cancel" ? <><p>Текущий заказ завершится без дохода. Затем можно начать новый.</p><DChoice className="du-danger" disabled={busy} onClick={() => onAction?.("cancel")}>Да, отменить заказ</DChoice><DChoice onClick={() => setHelp(null)}>Продолжить заказ</DChoice></> : <><p className="driver-muted">Ответы разыгрываются в симуляторе.</p><div className="driver-order-help__actions"><DChoice onClick={() => setTopic(stage === "waiting" ? "Пассажир: «Уже выхожу. Встретимся у точки А»." : `Пассажир: «Адрес назначения верный: ${order.destination}».`)}>Позвонить пассажиру</DChoice><DChoice onClick={() => setTopic(order.payment === "cash" ? `Поддержка: «В заказе наличная оплата. После завершения получите ${money(order.fare)} и подтвердите получение».` : "Поддержка: «В заказе оплата картой. Завершите поездку и дождитесь подтверждения. Наличные брать не нужно».")}>Вопрос об оплате</DChoice></div>{topic && <p className="driver-order-chat" role="status">{topic}</p>}</>}</div>}
    </section>
  </>;
}

/** Кнопка этапа. Пока этап не пройден, жёлтая дуга по краю показывает прогресс, а причина написана рядом. */
function Action({ label, busy, disabled, progress, reason, readyNote, onClick }: { label: string; busy: boolean; disabled?: boolean; progress?: number; reason?: string; readyNote?: string; onClick: () => void }) {
  const state = busy ? "busy" : disabled ? "blocked" : "ready", note = busy ? null : disabled ? reason : readyNote;
  return <div className="driver-order-act" data-state={state}>
    <button className="driver-order-action" disabled={busy || disabled} style={{ "--du-progress": disabled && !busy ? Math.max(0, Math.min(1, progress ?? 0)) : 1 } as CSSProperties} onClick={onClick}><span aria-hidden="true">→</span><strong>{busy ? "Сохраняем…" : label}</strong></button>
    {note && <p className="du-reason" data-tone={state}>{note}</p>}
  </div>;
}
function Route({ order, single }: { order: DriverOrder; single?: "origin" | "destination" }) {
  return <div className="driver-order-route">{(!single || single === "origin") && <div><b>А</b><span>{order.origin}</span></div>}{(!single || single === "destination") && <div><b>Б</b><span>{order.destination}</span></div>}</div>;
}
function Payment({ order }: { order: DriverOrder }) {
  return <div className="driver-order-payment"><span>{order.payment === "cash" ? "▣ Наличные" : "▤ Карта"}</span><strong>{money(order.fare)}</strong></div>;
}
function Travel({ progress, remaining, readyText }: { progress: number; remaining: number; readyText: string }) {
  return <div className="driver-order-travel"><div><span>{progress >= 1 ? "Прибыли" : "Движение по маршруту"}</span><b>{clock(remaining * 30)}</b></div><progress value={progress} max="1" aria-label="Пройденная часть маршрута" /><p role="status">{progress >= 1 ? readyText : "Машина движется автоматически. Дождитесь прибытия."}</p></div>;
}

function MapLayers({ shift }: { shift?: DriverShift }) {
  if (!shift) return null;
  const s = shift.data.settings;
  return <svg className="ds-map-layers" viewBox="0 0 640 700" preserveAspectRatio="none" aria-label="Слои учебной карты">
    {s.demand && <path className="ds-demand-zone" d="M380 80h140v170H380z" />}
    {s.traffic && <path className="ds-traffic" d="M250 200v130M420 420v90" />}
    {s.bonus_zones && <circle className="ds-bonus-zone" cx="185" cy="475" r="75" />}
    {s.special_zones && <path className="ds-special-zone" d="M70 60h110v110H70z" />}
  </svg>;
}
