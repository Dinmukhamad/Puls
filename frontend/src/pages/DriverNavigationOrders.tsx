import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { driver, orderActive, type DriverState, type OrderAction, type OrderCreate } from "../api/driver";
import { driverNavigation, type RoutePoint, type TravelMode } from "../api/driverNavigation";
import { useAuth } from "../auth/AuthContext";
import { freshFix, pointOf, type GeoPoint, type LocationState } from "../utils/driverLocation";
import { DriverOrderSheet } from "./DriverOrderSheet";
import { approach, countdown, DAction, DCancel, DChip, DChoice, DExplain, DInfo, DLegend } from "./DriverButtons";
import { money } from "./DriverOrders";
import type { ShiftAct } from "../api/driverShift";
import "./driver-navigation.css";

const DriverRouteMap = lazy(() => import("./DriverRouteMap").then(m => ({ default: m.DriverRouteMap })));
export const distanceLabel = (meters: number | null | undefined) => meters == null ? "—" : meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".", ",")} км` : `${Math.round(meters)} м`;
const minutes = (seconds: number) => `~${Math.max(1, Math.round(seconds / 60))} мин`;
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;
const label = (p: GeoPoint, name: string): RoutePoint => ({ ...pointOf(p), label: name });
const statuses: Record<string, string> = { TO_PICKUP: "Едем к точке А", ARRIVED_AT_PICKUP: "Вы прибыли в точку подачи", WAITING_FREE: "Бесплатное ожидание", WAITING_PAID: "Платное ожидание", IN_RIDE: "В пути", ARRIVED_AT_DESTINATION: "Вы прибыли в точку назначения", GPS_LOST: "Нет сигнала GPS", PAUSED: "Поездка приостановлена" };
const modeNames: Record<string, string> = { real: "Реальная поездка", virtual: "Виртуальная практика", demo: "Demo Mode" };
export function DriverNavigationOrders({ state, location, consent, allowLocation, declineLocation, busy: parentBusy, create, shiftAct, go }: {
  state: DriverState; location: LocationState & { retry: () => void }; consent: "ask" | "enabled" | "off"; allowLocation: () => void; declineLocation: () => void;
  busy: boolean; create: (payload: OrderCreate) => void; shiftAct?: ShiftAct; go: (view: string) => void;
}) {
  const { atLeast } = useAuth(), client = useQueryClient();
  const order = state.order, active = orderActive(order), spec = order?.details?.navigation, nav = state.navigation;
  const fix = freshFix(location.fix) ? location.fix : null;
  const [height, setHeight] = useState(active ? 24 : 50), [editing, edit] = useState(false);
  const [a, setA] = useState<RoutePoint | null>(null), [b, setB] = useState<RoutePoint | null>(null);
  const [mode, setMode] = useState<TravelMode>("real"), [transport, setTransport] = useState<"car" | "foot">("car");
  const [picking, pick] = useState<"А" | "Б" | null>(null), [picked, setPicked] = useState<GeoPoint>({ latitude: 43.2389, longitude: 76.8897 });
  const [changing, change] = useState(false), [cancel, askCancel] = useState(false), [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const passengerMessages = state.shift?.data.passenger_messages;
  useEffect(() => { setMessage(""); }, [order?.id, passengerMessages?.length]);
  const [searchFor, setSearchFor] = useState<"А" | "Б">("Б");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const save = (data: DriverState) => client.setQueryData<DriverState>(["driver-profile"], old => old?.order?.id === data.order?.id && (old?.order?.version ?? 0) > (data.order?.version ?? 0) ? old : { ...data, ...(old?.shift?.id === data.shift?.id && (old?.shift?.version ?? 0) > (data.shift?.version ?? 0) ? { shift: old?.shift } : {}) });
  const search = useMutation({ mutationFn: () => driverNavigation.search(query, fix ? pointOf(fix) : a ?? undefined) });
  const reverseGeneration = useRef(0);
  const prepare = useMutation({ mutationFn: () => { reverseGeneration.current++; return driverNavigation.prepare({ pickup: a!, destination: b!, mode, transport, ...(mode === "real" && fix ? { location: fix } : {}) }); }, onSuccess: () => setHeight(24) });
  const command = useRef<{ key: string; id: string }>();
  function requestId(key: string) { if (command.current?.key !== key) command.current = { key, id: crypto.randomUUID() }; return command.current.id; }
  const action = useMutation({ mutationFn: (name: OrderAction) => driver.orderAction({ id: order!.id, action: name, request_id: requestId(`${order!.id}:${name}`), ...(fix ? { location: fix } : {}) }), onSuccess: save, onError: () => client.invalidateQueries({ queryKey: ["driver-profile"] }) });
  const controls = useMutation({ mutationFn: (name: "pause" | "resume" | "advance") => driverNavigation.demo(order!.id, name, requestId(`${order!.id}:${order!.version}:${name}`)), onSuccess: save });
  const destination = useMutation({ mutationFn: (point: RoutePoint) => driverNavigation.destination(order!.id, point, requestId(`${order!.id}:destination:${JSON.stringify(point)}`), fix ?? undefined), onSuccess: data => { save(data); change(false); pick(null); setHeight(24); search.reset(); } });
  const busy = parentBusy || action.isPending || prepare.isPending || destination.isPending || controls.isPending;
  const virtualAllowed = !state.shift || state.shift.mode === "free" || !state.shift.config.real_location_required;
  const creation = useRef<{ route: string; id: string }>();
  const route = active ? nav?.route : editing ? prepare.data?.route : null;
  const current = active && spec?.mode !== "real" ? nav?.current ?? null : fix ?? (active ? nav?.current ?? null : null);
  const marker = active && nav?.projection && nav.projection.off_route <= Math.min(35, current?.accuracy ?? 35) ? nav.projection.snapped : current;
  const realReady = !!fix && (nav?.gps_available ?? true);
  const controlsReady = spec?.mode !== "real" || realReady;
  useEffect(() => { if (active && !controlsReady) setHeight(h => Math.max(h, 50)); }, [active, controlsReady]);
  const received = useRef({ server: state.server_now, at: Date.now() });
  if (received.current.server !== state.server_now) received.current = { server: state.server_now, at: Date.now() };
  const responseAge = Math.max(0, (now - received.current.at) / 1000);
  const wait = (nav?.wait_seconds ?? 0) + Math.min(responseAge, 60);
  const error = action.error || controls.error || prepare.error || destination.error || search.error;
  const radius = nav?.arrival_radius ?? spec?.rules.arrival_radius ?? 75;
  const boarding = nav?.boarding_seconds ?? 30;
  const stage = order?.stage;
  const canAct = !active || !controlsReady ? false : stage === "pickup" ? !!nav?.can_arrive : stage === "waiting" ? !!nav?.can_start : stage === "trip" ? !!nav?.can_finish : false;
  // Разблокировка главного действия — короткая вибрация: водитель смотрит на дорогу, а не в экран.
  const readyPing = useRef("");
  useEffect(() => {
    const key = `${order?.id}:${stage}`;
    if (!canAct) { if (readyPing.current !== key) readyPing.current = ""; return; }
    if (readyPing.current === key) return;
    readyPing.current = key;
    if (state.shift?.data.settings.vibration !== false) navigator.vibrate?.([35, 55, 35]);
  }, [canAct, order?.id, stage, state.shift?.data.settings.vibration]);
  function invalidateRoute() { prepare.reset(); creation.current = undefined; }
  function selectPoint(side: "А" | "Б", point: RoutePoint) { reverseGeneration.current++; if (side === "А") setA(point); else setB(point); invalidateRoute(); search.reset(); setQuery(""); }
  function myLocation() {
    if (!fix) { allowLocation(); location.retry(); return; }
    const generation = ++reverseGeneration.current, point = label(fix, "Моё местоположение"); setA(point); invalidateRoute();
    void driverNavigation.reverse(pointOf(fix)).then(value => { if (generation === reverseGeneration.current && value.address) { setA({ ...point, label: value.address.label }); invalidateRoute(); } }).catch(() => {});
  }
  function newOrder() { edit(true); change(false); setHeight(50); setA(fix ? label(fix, "Моё местоположение") : null); setB(null); invalidateRoute(); if (fix) myLocation(); }
  useEffect(() => { if (active) { edit(false); setHeight(controlsReady ? 24 : 50); } else if (order?.stage === "complete") setHeight(50); }, [order?.id, active]);
  useEffect(() => { if (editing && !a && fix) myLocation(); }, [!!fix, editing]);
  const pickedPoint = label(picked, picking === "А" ? "Подача на карте" : "Назначение на карте");
  function chooseMapPoint() {
    if (changing) { destination.mutate(pickedPoint); return; }
    const side = picking!; selectPoint(side, pickedPoint); pick(null); setHeight(50);
    const generation = ++reverseGeneration.current;
    void driverNavigation.reverse(pointOf(pickedPoint)).then(value => {
      if (generation !== reverseGeneration.current || !value.address) return;
      if (side === "А") setA({ ...pickedPoint, label: value.address.label }); else setB({ ...pickedPoint, label: value.address.label });
      prepare.reset();
    }).catch(() => {});
  }
  function startOrder() {
    const draft = prepare.data; if (!draft || busy || (mode === "real" && !fix)) return;
    if (creation.current?.route !== draft.id) creation.current = { route: draft.id, id: crypto.randomUUID() };
    create({ id: creation.current.id, route_id: draft.id, origin: draft.pickup.label, destination: draft.destination.label, ...(mode === "real" && fix ? { location: fix } : {}) });
  }
  const staleRoute = !!prepare.data && Date.parse(prepare.data.expires_at) <= now;
  const phase = picking ? `pick-${picking}` : changing ? "change" : active ? `stage-${stage}` : editing ? prepare.data ? "route" : "edit" : stage === "complete" ? "done" : "idle";
  const permissionInfo = <div className="dn-location-note" role="status">
    <strong>{consent === "off" ? "Геолокация выключена" : location.status === "denied" ? "Разрешите доступ к геолокации" : location.status === "requesting" ? "Определяем местоположение…" : "Нужно обновить местоположение"}</strong>
    <p>{consent === "off" ? "Включите геолокацию, чтобы начать реальную поездку." : location.status === "denied" ? "Браузер запретил доступ. Разрешите его по инструкции ниже и повторите запрос." : "Прибытие и завершение доступны только с актуальной геопозицией. Проверьте, включена ли геолокация на устройстве."}</p>
    <DChoice onClick={() => { allowLocation(); location.retry(); }}>Повторить запрос геолокации</DChoice>
    <DInfo title="Как разрешить геолокацию?">
      <p>Сайт не может открыть настройки телефона автоматически. В браузере нажмите значок рядом с адресом сайта → <b>Разрешения</b> → <b>Местоположение</b>.</p>
      <p>Для установленного приложения проверьте также разрешения браузера в настройках телефона. Вернитесь сюда и повторите запрос.</p>
    </DInfo>
  </div>;
  const searchForm = <div className="dn-search">
    <label>{searchFor === "А" ? "Откуда" : changing ? "Новый адрес назначения" : "Куда"}<input value={query} onChange={e => { setQuery(e.target.value); search.reset(); }} onKeyDown={e => { if (e.key === "Enter" && !busy && !search.isPending && query.trim().length >= 3) { e.preventDefault(); search.mutate(); } }} placeholder="Улица, дом, город" maxLength={160} /></label>
    <DChoice disabled={busy || search.isPending || query.trim().length < 3} onClick={() => search.mutate()}>{search.isPending ? "Ищем…" : "Найти адрес"}</DChoice>
    {search.data && <div className="dn-search-results">{search.data.items.length ? search.data.items.map((p, i) => <button type="button" key={i} disabled={busy} onClick={() => changing ? destination.mutate(p) : selectPoint(searchFor, p)}>{p.label}</button>) : <p>Адрес не найден. Уточните город или выберите точку на карте.</p>}</div>}
  </div>;
  return <div className="driver-navigation-workspace">
    <Suspense fallback={<div className="dn-map-loading">Загрузка карты…</div>}><DriverRouteMap current={marker} stale={!!active && (!controlsReady || !nav?.gps_available)} pickup={active ? spec?.pickup : a} destination={active ? spec?.destination : b} route={route} picking={picking} onCenter={setPicked} focusKey={active ? `${order?.id}:${nav?.reroutes}` : prepare.data?.id ?? "draft"} active={active} sheetHeight={height} /></Suspense>
    <DriverOrderSheet height={height} setHeight={setHeight} phase={phase} title={active ? "Текущий учебный заказ" : "Создание маршрута"}>
      {picking ? <>
        <p className="driver-order-eyebrow">Точка {picking}</p><h2>Выберите место на карте</h2>
        <DAction label={changing ? "Сохранить адрес и перестроить маршрут" : "Выбрать эту точку"} busy={busy} busyLabel="Сохраняем…" onClick={chooseMapPoint} readyNote="Двигайте карту — метка остаётся в центре экрана." />
        <DCancel disabled={busy} onClick={() => { pick(null); setHeight(50); }}>Назад без выбора</DCancel>
      </> : changing ? <>
        <h2>Изменить точку Б</h2>
        <DInfo title="Как поменять адрес назначения" defaultOpen><p>Найдите адрес и выберите его в списке — точка Б сохранится сразу, маршрут перестроится. Или укажите место на карте.</p></DInfo>
        {searchForm}
        <DChoice disabled={busy} onClick={() => { pick("Б"); setHeight(24); }}>Выбрать на карте</DChoice>
        <DCancel disabled={busy} onClick={() => change(false)}>Вернуться к поездке</DCancel>
      </> : active && spec ? <>
        <p className="driver-order-eyebrow">{spec.mode === "real" ? "Реальная учебная поездка" : spec.mode === "demo" ? "Demo Mode · без зачётных баллов" : "Виртуальная практика"}</p>
        <h1>{statuses[!controlsReady ? "GPS_LOST" : nav?.status ?? "TO_PICKUP"] ?? "Поездка"}</h1><p className="dn-target">{stage === "pickup" || stage === "waiting" ? order!.origin : order!.destination}</p>
        {stage === "waiting" ? <div className="dn-route-meta"><strong>{clock(wait < (nav?.free_wait_seconds ?? 30) ? (nav?.free_wait_seconds ?? 30) - wait : wait - (nav?.free_wait_seconds ?? 30))}</strong><span>{wait < (nav?.free_wait_seconds ?? 30) ? "Бесплатное ожидание" : "Платное ожидание"}</span></div> : <div className="dn-route-meta"><strong>{distanceLabel(stage === "pickup" ? nav?.distance_to_target : nav?.projection?.remaining ?? nav?.distance_to_target)}</strong><span>{stage === "pickup" ? "до точки А" : nav?.projection ? minutes(nav.projection.eta) : "до точки Б"}</span></div>}
        {stage === "trip" && <progress className="dn-progress" value={nav?.projection?.progress ?? 0} max={1} aria-label="Прогресс маршрута" />}
        {!controlsReady && permissionInfo}
        {nav?.message && controlsReady && <p className="dn-inline-message">{nav.message}</p>}
        {stage === "pickup" && <DAction
          label="Подтвердить прибытие" busy={busy} busyLabel="Подтверждаем…"
          blocked={!controlsReady || !nav?.can_arrive}
          progress={controlsReady ? approach(nav?.distance_to_target, radius) : 0}
          meter={controlsReady ? distanceLabel(nav?.distance_to_target) : undefined}
          reason={!controlsReady ? "Сначала восстановите геолокацию — прибытие проверяется по ней." : `Подойдите к точке А в радиус ${radius} м. Дуга покажет, сколько осталось.`}
          readyNote="Вы рядом с точкой А. Нажатие начнёт ожидание пассажира."
          onClick={() => action.mutate("arrive")} />}
        {stage === "waiting" && <DAction
          label="Начать поездку" busy={busy} busyLabel="Начинаем…"
          blocked={!controlsReady || !nav?.can_start}
          progress={countdown(wait, boarding)}
          meter={wait < boarding ? `${Math.ceil(boarding - wait)} с` : undefined}
          reason={!controlsReady ? "Сначала восстановите геолокацию." : "Пассажир идёт к машине. Кнопка откроется, когда он сядет."}
          readyNote="Пассажир сел. Сверьте адрес Б и начинайте поездку к точке назначения."
          onClick={() => action.mutate("start_trip")} />}
        {stage === "trip" && <DAction
          label="Завершить заказ" busy={busy} busyLabel="Завершаем…"
          blocked={!controlsReady || !nav?.can_finish}
          progress={controlsReady ? approach(nav?.projection?.remaining ?? nav?.distance_to_target, radius) : 0}
          meter={controlsReady ? distanceLabel(nav?.projection?.remaining ?? nav?.distance_to_target) : undefined}
          reason={!controlsReady ? "Сначала восстановите геолокацию. Расстояние на карте может быть устаревшим." : `Доедьте до точки Б в радиус ${radius} м. Дуга покажет, сколько осталось.`}
          readyNote={order!.payment === "cash" ? `Вы у точки Б. Получите учебную оплату ${money(order!.fare)} — нажатие завершит заказ и зачислит доход.` : "Вы у точки Б. Нажатие завершит заказ и зачислит учебный доход в раздел «Деньги»."}
          onClick={() => action.mutate("finish")} />}
        {spec.mode !== "real" && stage === "trip" && <>
          <div className="dn-row">
            <DChoice disabled={busy} onClick={() => controls.mutate(nav?.status === "PAUSED" ? "resume" : "pause")}>{nav?.status === "PAUSED" ? "Продолжить движение" : "Пауза симуляции"}</DChoice>
            {spec.mode === "demo" && atLeast("admin") && <DChoice disabled={busy} onClick={() => controls.mutate("advance")}>Переместить на 100 м</DChoice>}
          </div>
          <DExplain title="Зачем пауза и перемотка" real="машину ведёте вы, останавливать и перематывать поездку нечем." sim={`движение считает сервер в режиме «${modeNames[spec.mode] ?? spec.mode}», поэтому этап можно остановить и разобрать без реальной поездки.`} />
        </>}
        <details className="dn-order-details"><summary>Детали заказа</summary><p><b>А</b> {order!.origin}</p><p><b>Б</b> {order!.destination}</p><p>Учебный пассажир · {order!.details?.tariff ?? "Эконом"}</p><p>{order!.payment === "cash" ? "Наличные" : "Безналичная оплата"} · {money(order!.fare)}</p><p>{distanceLabel(spec.planned_distance)} · {minutes(spec.planned_duration)}</p><p>Подача подтверждается в радиусе {spec.rules.arrival_radius} м. Бесплатное ожидание: {spec.rules.free_wait_seconds} с.</p></details>
        {stage === "trip" && <>
          {order!.details?.route_event && !order!.details.route_changed && <p className="dn-inline-message">Пассажир просит изменить адрес назначения.</p>}
          <DChoice arrow disabled={busy} onClick={() => { change(true); setSearchFor("Б"); setQuery(""); search.reset(); setHeight(88); }}>Выбрать новый адрес Б</DChoice>
        </>}
        {state.shift && <>
          <details className="dn-order-details"><summary>Связь с пассажиром</summary><div className="dn-passenger">
            <label>Сообщение пассажиру<input value={message} onChange={e => setMessage(e.target.value)} maxLength={160} placeholder="Напишите сообщение" disabled={busy} /></label>
            <DChoice disabled={busy || !shiftAct || !message.trim()} onClick={() => shiftAct?.("passenger", { text: message })}>Отправить сообщение</DChoice>
            <DChoice disabled={busy || !shiftAct} onClick={() => shiftAct?.("passenger", { text: "Учебный звонок пассажиру", call: true })}>Позвонить пассажиру</DChoice>
            <DExplain real="открывается защищённый номер — ваш телефон пассажир не видит." sim="звонок не выполняется. Пассажир отвечает текстом, ответ появится в диалоге ниже." />
            {state.shift.data.passenger_messages.filter(x => x.order_id === order!.id).map((x, i) => <p key={i}>Вы: {x.text}<br />Пассажир: {x.reply}</p>)}
          </div></details>
          <DChoice arrow disabled={busy} onClick={() => go("support")}>Открыть поддержку</DChoice>
        </>}
        {cancel ? <div className="dn-confirm">
          <p><strong>Отменить заказ без начисления дохода?</strong></p>
          <DChoice className="du-danger" disabled={busy} onClick={() => action.mutate("cancel")}>Да, отменить заказ</DChoice>
          <DChoice disabled={busy} onClick={() => askCancel(false)}>Остаться в заказе</DChoice>
        </div> : <DCancel disabled={busy} onClick={() => askCancel(true)}>Отменить заказ</DCancel>}
      </> : editing && prepare.data ? <>
        <p className="driver-order-eyebrow">Маршрут готов</p><h1>А → Б</h1><p className="dn-target">{prepare.data.pickup.label} → {prepare.data.destination.label}</p>
        <div className="dn-route-meta"><strong>{distanceLabel(prepare.data.route.distance)}</strong><span>{minutes(prepare.data.route.duration)} · {money(prepare.data.fare)}</span></div>
        {staleRoute && <p role="status" className="dn-inline-message">Маршрут устарел. Нажмите «Изменить адреса или режим» и постройте его заново.</p>}
        <DAction label="Начать заказ" busy={busy} busyLabel="Принимаем заказ…"
          blocked={(mode === "real" && !fix) || staleRoute}
          reason={staleRoute ? "Маршрут устарел — постройте его заново." : "Для реальной поездки нужна геопозиция."}
          readyNote="Нажатие примет учебный заказ. Затем нужно доехать до точки А и подтвердить прибытие."
          onClick={startOrder} />
        {mode === "real" && !fix && permissionInfo}
        <DChoice disabled={busy} onClick={() => { invalidateRoute(); setHeight(88); }}>Изменить адреса или режим</DChoice>
      </> : editing ? <>
        <p className="driver-order-eyebrow">Новый заказ</p><h1>Создание маршрута</h1>
        <div className="dn-mode"><label>Режим<select disabled={busy} value={mode} onChange={e => { setMode(e.target.value as TravelMode); invalidateRoute(); }}><option value="real">Реальная поездка</option>{virtualAllowed && <option value="virtual">Виртуальная практика</option>}{atLeast("admin") && <option value="demo">Demo Mode</option>}</select></label><label>Маршрут<select disabled={busy} value={transport} onChange={e => { setTransport(e.target.value as "car" | "foot"); invalidateRoute(); }}><option value="car">На автомобиле</option><option value="foot">Пешком</option></select></label></div>
        <DInfo title="Чем режимы отличаются">
          <p><b>Реальная поездка</b> — прибытие и завершение проверяются по вашей геопозиции. Нужно действительно доехать.</p>
          <p><b>Виртуальная практика</b> — машину ведёт сервер. Подходит, чтобы разобрать порядок действий за столом.</p>
          {atLeast("admin") && <p><b>Demo Mode</b> — как виртуальная, но без зачётных баллов, с паузой и перемоткой для показа.</p>}
        </DInfo>
        <div className="dn-point"><b>А</b><div><span>Откуда</span><strong>{a?.label ?? "Выберите подачу"}</strong><div className="du-chips">
          <DChip icon="◎" disabled={busy} onClick={myLocation}>Моё местоположение</DChip>
          <DChip icon="⌕" disabled={busy} pressed={searchFor === "А"} onClick={() => { setSearchFor("А"); search.reset(); setQuery(""); }}>Найти адрес</DChip>
          <DChip icon="✛" disabled={busy} onClick={() => { pick("А"); setHeight(24); }}>На карте</DChip>
        </div></div></div>
        <div className="dn-point"><b>Б</b><div><span>Куда</span><strong>{b?.label ?? "Выберите назначение"}</strong><div className="du-chips">
          <DChip icon="⌕" disabled={busy} pressed={searchFor === "Б"} onClick={() => { setSearchFor("Б"); search.reset(); setQuery(""); }}>Найти адрес</DChip>
          <DChip icon="✛" disabled={busy} onClick={() => { pick("Б"); setHeight(24); }}>На карте</DChip>
        </div></div></div>
        {searchForm}
        {mode === "real" && !fix && permissionInfo}
        {prepare.data ? <>
          <div className="dn-route-meta"><strong>{distanceLabel(prepare.data.route.distance)}</strong><span>{minutes(prepare.data.route.duration)}</span></div>
          <p>Учебная стоимость: {money(prepare.data.fare)}</p>
          <DAction label="Начать заказ" busy={busy} busyLabel="Принимаем заказ…" blocked={(mode === "real" && !fix) || staleRoute} reason={staleRoute ? "Маршрут устарел — постройте его заново." : "Для реальной поездки нужна геопозиция."} readyNote="Нажатие примет учебный заказ." onClick={startOrder} />
        </> : <DAction label="Построить маршрут" busy={busy} busyLabel="Строим маршрут…"
          blocked={!a || !b || (mode === "real" && !fix)}
          progress={((a ? 1 : 0) + (b ? 1 : 0) + (mode !== "real" || fix ? 1 : 0)) / 3}
          meter={`${(a ? 1 : 0) + (b ? 1 : 0) + (mode !== "real" || fix ? 1 : 0)}/3`}
          reason={!a ? "Укажите точку подачи А." : !b ? "Укажите точку назначения Б." : mode === "real" && !fix ? "Для реальной поездки нужна геопозиция." : "Готовим маршрут."}
          readyNote="Маршрут и учебная стоимость рассчитаются перед приёмом заказа."
          onClick={() => prepare.mutate()} />}
        <DCancel disabled={busy} onClick={() => { edit(false); setHeight(24); }}>Отменить создание заказа</DCancel>
      </> : <>
        {stage === "complete" && spec ? <>
          <p className="driver-order-eyebrow">Заказ выполнен</p><h1>{money(order!.net)}</h1><p>Доход добавлен в учебный баланс</p>
          <details className="dn-order-details"><summary>Итог поездки{spec.score != null ? ` · ${spec.score}/100` : ""}</summary><p>А: {order!.origin}<br />Б: {order!.destination}</p><p>Маршрут: {distanceLabel(spec.planned_distance)}<br />Пройдено: {distanceLabel(spec.actual_distance)}</p><p>Поездка: {clock(spec.trip_seconds ?? 0)} · ожидание {clock(spec.wait_seconds ?? 0)}</p><p>Стоимость: {money(order!.fare)}<br />Комиссии: {money(order!.fare - order!.net)}</p>{spec.result?.map(x => <p key={x.key}>{x.done ? "✓" : "○"} {x.title} · {x.done ? x.weight : 0}/{x.weight}</p>)}{spec.mode !== "real" && <p>Симуляция движения не является результатом реальной поездки.</p>}</details>
          <DChoice arrow disabled={busy} onClick={() => go("money")}>Посмотреть «Деньги»</DChoice>
        </> : <><p className="driver-order-eyebrow">Driver Simulator</p><h1>{state.shift?.data.online ? "Вы на линии" : "Готовы к поездке?"}</h1><p className="driver-muted">Постройте маршрут от своей позиции или выбранной точки.</p></>}
        {state.shift && !state.shift.data.online ? <>
          <DAction label="На линию" busy={busy} onClick={() => shiftAct?.("online")} readyNote="Выход на линию открывает создание учебных заказов." />
          {state.shift.data.photo_status !== "passed" && <DChoice arrow disabled={busy} onClick={() => go("photo")}>Пройти фотоконтроль</DChoice>}
        </> : <DAction label="Новый заказ" busy={busy} onClick={newOrder} readyNote="Выберите точки А и Б, постройте маршрут и примите заказ." />}
        {state.shift?.data.online && <DCancel disabled={busy} onClick={() => shiftAct?.("offline")}>Уйти с линии</DCancel>}
        <DInfo title="Как читать кнопки тренажёра"><DLegend /></DInfo>
      </>}
      {error instanceof Error && <p role="alert" className="dn-inline-error">{error.message}</p>}
    </DriverOrderSheet>
    {consent === "ask" && <div className="dn-consent"><section role="dialog" aria-modal="true" aria-labelledby="dn-consent-title"><span aria-hidden="true">◎</span><h1 id="dn-consent-title">Разрешить использование геолокации во время учебной поездки?</h1><p>Геолокация используется только во время активной учебной сессии для отображения вашего положения и проверки прибытия. История перемещений не сохраняется.</p><p className="driver-muted">Для поиска адресов и маршрута выбранные точки передаются картографическим сервисам.</p><DAction label="Разрешить" onClick={allowLocation} /><DCancel onClick={declineLocation}>Продолжить без геолокации</DCancel></section></div>}
  </div>;
}
