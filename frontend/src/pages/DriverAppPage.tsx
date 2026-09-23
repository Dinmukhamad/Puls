import { useDriverLocation } from "../hooks/useDriverLocation";
import { useDriverLocationConsent } from "../hooks/useDriverLocationConsent";
import { useDriverNavigation } from "../hooks/useDriverNavigation";
import { DriverNavigationOrders } from "./DriverNavigationOrders";
import type { LocationState } from "../utils/driverLocation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { driver, orderActive, type DriverAction, type DriverAuthentication, type DriverPark, type DriverProfile, type DriverState, type OrderAction, type OrderCommand, type OrderCreate } from "../api/driver";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { type Position } from "../components/SimulatorMap";
import { DriverOrders, money } from "./DriverOrders";
import { ChevronRightIcon, CoinIcon, InboxIcon, SparkIcon, TrophyIcon, UserIcon } from "../components/icons";
import { ErrorState } from "../components/ui";
import { DAction, DChoice, DInfo, DLegend } from "./DriverButtons";
import { dateTime } from "../utils/format";
import "./simulator.css";
import "./driver-app.css";
import "./driver-orders.css";
import { DriverWorkspace } from "./DriverWorkspace";

export const DRIVER_SECTIONS = [
  { id: "orders", title: "Заказы", Icon: DriverArrow },
  { id: "results", title: "Результаты", Icon: TrophyIcon },
  { id: "income", title: "Доход", Icon: CoinIcon },
  { id: "messages", title: "Сообщения", Icon: InboxIcon },
  { id: "profile", title: "Профиль", Icon: UserIcon },
] as const;
export type DriverSection = typeof DRIVER_SECTIONS[number]["id"] | "learning";
export function driverSection(value: string | null): DriverSection {
  return value === "learning" || DRIVER_SECTIONS.some((item) => item.id === value) ? value as DriverSection : "orders";
}

export function DriverAppPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["driver-profile"], queryFn: driver.state, refetchOnWindowFocus: "always", refetchInterval: 60000 });
  const [params, setParams] = useSearchParams();
  const [booting, setBooting] = useState(true);
  const [phone, setPhone] = useState("+7");
  const saveState = (data: Awaited<ReturnType<typeof driver.state>>) => client.setQueryData(["driver-profile"], data);
  const sendCode = useMutation({ mutationFn: driver.code, onSuccess: saveState });
  const verify = useMutation({ mutationFn: driver.verify, onSuccess: saveState, onError: () => { void query.refetch(); } });
  const forget = useMutation({ mutationFn: driver.forget, onSuccess: saveState });
  const createOrder = useMutation({ mutationFn: driver.createOrder, networkMode: "always", onSuccess: saveState, onError: () => { void query.refetch(); } });
  const orderAction = useMutation({ mutationFn: driver.orderAction, networkMode: "always", onSuccess: saveState, onError: () => { void query.refetch(); } });
  const lastCommand = useRef<{ key: string; payload: OrderCommand }>();
  const action = useMutation({ mutationFn: driver.action, onSuccess: (data) => {
    client.setQueryData(["driver-profile"], data);
    if (data.profile?.stage === "offline") setParams({}, { replace: true });
  } });
  const { mutate } = action;
  const stage = query.data?.profile?.stage;
  const [consent, setConsent] = useDriverLocationConsent();
  const location = useDriverLocation(consent === "enabled" && stage === "offline" && !query.data?.shift);
  useDriverNavigation(query.data?.shift ? undefined : query.data, location);
  useEffect(() => { const timer = window.setTimeout(() => setBooting(false), 1200); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (stage !== "loading" || booting) return;
    const timer = window.setTimeout(() => mutate({ action: "enter" }), 1000);
    return () => window.clearTimeout(timer);
  }, [stage, booting, mutate]);

  if (query.isError && !query.data) return <div className="driver-app"><DriverHeader /><div className="driver-content driver-content--center"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div></div>;
  if (booting || query.isLoading) return <DriverSplash />;
  const profile = query.data?.profile;
  if (!profile) return <div className="driver-app"><DriverHeader /><div className="driver-content driver-content--center"><h1>Driver Simulator</h1><p>Запустите учебный профиль из раздела обучения.</p><Link className="driver-primary" to="/training?kind=simulator">Открыть обучение</Link></div></div>;
  if (profile.stage === "phone" || profile.stage === "otp") return <div className="driver-app"><DriverHeader /><DriverLogin
    stage={profile.stage} authentication={query.data!.authentication} parkName={profile.park?.name ?? ""}
    phone={phone} onPhone={setPhone} busy={sendCode.isPending || verify.isPending || action.isPending}
    error={verify.error || sendCode.error || action.error}
    onSend={() => { verify.reset(); sendCode.mutate(phone || user?.phone || ""); }}
    onVerify={(code) => { sendCode.reset(); verify.mutate(code); }}
    onBack={() => { sendCode.reset(); verify.reset(); mutate({ action: "services" }); }}
    onRefresh={() => query.refetch()}
  /></div>;
  if (profile.stage === "offline" && query.data?.shift) return <DriverWorkspace
    state={query.data} fullName={user?.full_name ?? ""}
    busy={action.isPending || createOrder.isPending || orderAction.isPending}
    failed={createOrder.isError || orderAction.isError} error={action.error || createOrder.error || orderAction.error}
    create={payload => { orderAction.reset(); createOrder.mutate(payload); }}
    orderAction={name => {
      const order = query.data?.order; if (!order) return;
      const key = `${order.id}:${order.version}:${name}`;
      if (lastCommand.current?.key !== key) lastCommand.current = { key, payload: { id: order.id, action: name, request_id: crypto.randomUUID() } };
      createOrder.reset(); orderAction.mutate(lastCommand.current.payload);
    }}
    switchPark={() => mutate({ action: "services" })} refresh={() => { void query.refetch(); }}
  />;
  return <DriverScreen
    navigation={query.data && !(orderActive(query.data.order) && !query.data.order?.details?.navigation) ? <DriverNavigationOrders state={query.data} location={location} consent={consent} allowLocation={() => setConsent("enabled")} declineLocation={() => setConsent("off")} busy={createOrder.isPending || action.isPending} create={payload => createOrder.mutate(payload)} go={view => setParams({ section: view === "money" ? "income" : view })} /> : undefined}
    profile={profile} parks={query.data!.parks} fullName={user?.full_name ?? ""}
    section={driverSection(params.get("section"))} position={location.fix} location={location} busy={action.isPending || forget.isPending || createOrder.isPending || orderAction.isPending}
    orderState={query.data} orderFailed={createOrder.isError || orderAction.isError}
    onCreateOrder={(payload) => { orderAction.reset(); createOrder.mutate(payload); }}
    onOrderAction={(name) => {
      const order = query.data?.order;
      if (!order) return;
      const key = `${order.id}:${order.version}:${name}`;
      if (lastCommand.current?.key !== key) lastCommand.current = { key, payload: { id: order.id, action: name, request_id: crypto.randomUUID() } };
      createOrder.reset(); orderAction.mutate(lastCommand.current.payload);
    }}
    onSection={(section) => setParams(section === "orders" ? {} : { section })}
    onAction={(payload) => { action.reset(); mutate(payload); }}
    error={action.error || forget.error || createOrder.error || orderAction.error || query.error} onRefresh={() => { createOrder.reset(); orderAction.reset(); void query.refetch(); }} onForget={() => forget.mutate()}
  />;
}

interface DriverLoginProps {
  stage: "phone" | "otp"; authentication: DriverAuthentication; parkName: string;
  phone: string; onPhone: (value: string) => void; busy: boolean; error?: unknown;
  onSend: () => void; onVerify: (code: string) => void; onBack: () => void; onRefresh: () => void;
}
export function DriverLogin({ stage, authentication, parkName, phone, onPhone, busy, error, onSend, onVerify, onBack, onRefresh }: DriverLoginProps) {
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setCode(""); }, [authentication.code_expires_at]);
  const seconds = Math.min(60, Math.max(0, Math.ceil(((authentication.next_send_at ? Date.parse(authentication.next_send_at) : 0) - now) / 1000)));
  const expired = !!authentication.code_expires_at && Date.parse(authentication.code_expires_at) <= now;
  const ready = authentication.phone_set && authentication.telegram_connected && authentication.telegram_configured;
  const validPhone = /^\+?[\d ()-]+$/.test(phone) && phone.replace(/\D/g, "").length >= 11;
  function submit(event: FormEvent) { event.preventDefault(); if (!busy && ready) { if (stage === "otp") { if (/^\d{6}$/.test(code) && !expired) onVerify(code); } else if (validPhone && seconds === 0) onSend(); } }
  return <main className="driver-auth">
    <button className="driver-back" disabled={busy} onClick={onBack}>‹ Выбрать другой парк</button>
    <div className="driver-auth__intro"><DriverMark /><p className="driver-muted">{parkName}</p><h1>{stage === "otp" ? "Код из Telegram" : "Ваш номер телефона"}</h1><p className="driver-muted">{stage === "otp" ? "Введите 6 цифр из личного сообщения бота. Код действует 5 минут." : "Укажите номер, который руководитель записал в вашем профиле Puls."}</p></div>
    {!ready ? <section className="driver-card driver-auth__setup">
      {!authentication.phone_set && <p>В профиле пока нет номера телефона. Попросите руководителя добавить его в карточку сотрудника.</p>}
      {!authentication.telegram_configured ? <p>Бот ещё не подключён на сервере. Администратору нужно завершить настройку.</p> : !authentication.telegram_connected && <><p>Сначала подключите свой Telegram и запустите бота по личной ссылке.</p><Link className="driver-primary" to="/profile#telegram">Подключить Telegram</Link></>}
      <DChoice onClick={onRefresh}>Проверить ещё раз</DChoice>
    </section> : <form className="driver-auth__form" onSubmit={submit}>
      {stage === "phone" ? <label><span>Номер телефона</span><input type="tel" autoComplete="tel" placeholder="+7 700 123 45 67" required maxLength={40} value={phone} onChange={(event) => onPhone(event.target.value)} disabled={busy} /></label> : <label><span>Код подтверждения</span><input className="driver-auth__code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} /></label>}
      {expired && <p role="status">Срок действия кода закончился. Запросите новый.</p>}
      <DAction type="submit" busy={busy}
        label={stage === "otp" ? "Подтвердить и войти" : seconds ? `Новый код через ${seconds} с` : "Получить код в Telegram"}
        blocked={stage === "otp" ? code.length !== 6 || expired : !validPhone || seconds > 0}
        progress={stage === "otp" ? code.length / 6 : seconds > 0 ? (60 - seconds) / 60 : Math.min(1, phone.replace(/\D/g, "").length / 11)}
        meter={stage === "otp" ? `${code.length}/6` : seconds ? `${seconds} с` : undefined}
        reason={stage === "otp" ? expired ? "Срок кода истёк — запросите новый." : "Введите все шесть цифр из личного сообщения бота." : seconds ? "Новый код можно запрашивать раз в минуту." : "Укажите номер полностью, вместе с кодом страны."}
        readyNote={stage === "otp" ? "Код проверится на сервере, и этот браузер запомнится." : "Бот пришлёт код в личные сообщения Telegram."} />
      {stage === "otp" && <DChoice disabled={busy || seconds > 0} onClick={onSend}>{seconds ? `Отправить ещё раз через ${seconds} с` : "Отправить код ещё раз"}</DChoice>}
      <p className="driver-auth__note">Подтверждённый браузер запоминается на {authentication.remember_days} дней. После смены телефона, пароля или Telegram потребуется новый код.</p>
    </form>}
    {error instanceof Error && <p role="alert" className="driver-auth__error">{error.message}</p>}
  </main>;
}

function DriverArrow({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 8 19-8-5-8 5z" /></svg>;
}
function DriverMark() {
  return <span className="driver-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M9 33h12l7-17 10 32 6-15h11" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}
function DriverHeader() {
  return <header className="driver-header"><Link to="/training?kind=simulator" className="driver-exit" aria-label="Выйти из симулятора в Puls">‹ Puls</Link><span>Driver Simulator</span><span className="driver-environment">Учебный</span></header>;
}
export function DriverSplash() {
  return <div className="driver-app"><DriverHeader /><main className="driver-splash"><DriverMark /><h1>Driver Simulator</h1><p role="status">Загрузка профиля…</p></main></div>;
}
export function DriverLoading() {
  return <main className="driver-loading" aria-busy="true" aria-label="Загрузка водительского профиля"><div className="driver-loading__map" /><div className="driver-loading__panel"><div className="driver-skeleton driver-skeleton--short" /><div className="driver-skeleton" /><div className="driver-skeleton" /><div className="driver-skeleton driver-skeleton--button" /><p role="status">Загрузка профиля…</p></div><div className="driver-loading__nav" aria-hidden="true">{DRIVER_SECTIONS.map((item) => <span className="driver-skeleton" key={item.id} />)}</div></main>;
}

interface ScreenProps {
  navigation?: ReactNode;
  profile: DriverProfile; parks: DriverPark[]; fullName: string; section: DriverSection;
  location?: LocationState & { retry: () => void };
  position: Position | null; busy: boolean; error?: unknown;
  onAction: (action: DriverAction) => void; onSection: (section: DriverSection) => void; onRefresh: () => void; onForget?: () => void;
  orderState?: Pick<DriverState, "order" | "order_summary" | "order_history" | "server_now">; orderFailed?: boolean;
  onCreateOrder?: (payload: OrderCreate) => void; onOrderAction?: (action: OrderAction) => void;
}
export function DriverScreen({ profile, parks, fullName, section, position, location, busy, error, onAction, onSection, onRefresh, onForget, orderState, orderFailed, onCreateOrder, onOrderAction, navigation }: ScreenProps) {
  const offline = profile.stage === "offline";
  const summary = orderState?.order_summary ?? { count: 0, gross: 0, commission: 0, net: 0 };
  const active = orderActive(orderState?.order);
  return <div className="driver-app">
    <DriverHeader />
    {profile.stage === "loading" ? <DriverLoading /> : !offline ? <main className="driver-services">
      <div className="driver-identity"><DriverMark /><div><h1>{fullName}</h1><p>Учебный профиль водителя</p></div></div>
      <div className="driver-card driver-balance"><CoinIcon size={28} /><div><strong>{money(summary.net)}</strong><span>Учебный баланс</span></div></div>
      <h2>Мои сервисы</h2>
      <button className="driver-card driver-service" disabled={busy} onClick={() => onAction({ action: "taxi" })}><span className="driver-taxi"><DriverArrow /></span><span><strong>Такси</strong><small>Учебная работа с заказами</small></span><ChevronRightIcon /></button>
    </main> : <main className={`driver-content${section === "orders" ? navigation ? " dn-content" : " driver-content--orders" : ""}`}>
      {section === "orders" && (navigation ?? <DriverOrders order={orderState?.order} summary={summary} serverNow={orderState?.server_now} position={position} location={location} busy={busy} failed={orderFailed} onCreate={onCreateOrder} onAction={onOrderAction} onIncome={() => onSection("income")} />)}
      {section === "results" && <div className="driver-section"><h1>Результаты</h1><div className="driver-card"><h2>Работа с заказами</h2><DriverRow title="Выполнено заказов" value={String(summary.count)} /><DriverRow title="Учебный доход" value={money(summary.net)} /><DriverRow title="Текущий заказ" value={active ? "В процессе" : "Нет активного заказа"} />{active && <DChoice arrow onClick={() => onSection("orders")}>Продолжить заказ</DChoice>}</div><div className="driver-card"><h2>Последние поездки</h2><OrderHistory orders={orderState?.order_history ?? []} /></div><div className="driver-card"><h2>Вход в приложение</h2><DriverRow title="Статус" value="Вход завершён" />{profile.last_login_at && <DriverRow title="Последний вход" value={dateTime(profile.last_login_at)} />}</div></div>}
      {section === "income" && <div className="driver-section"><h1>Доход</h1><div className="driver-card driver-money"><span>Учебный баланс</span><strong>{money(summary.net)}</strong></div><div className="driver-card"><DriverRow title="Стоимость выполненных поездок" value={money(summary.gross)} /><DriverRow title="Комиссии парков" value={money(summary.commission)} /><DriverRow title="Доход после комиссии" value={money(summary.net)} /></div><div className="driver-card"><h2>История операций</h2><OrderHistory orders={orderState?.order_history ?? []} /></div><p className="driver-muted">Учебные суммы симулятора. Выплаты и списания настоящих денег не выполняются.</p></div>}
      {section === "messages" && <div className="driver-section"><h1>Сообщения</h1><div className="driver-card driver-empty"><InboxIcon size={36} /><h2>Сообщений пока нет</h2></div></div>}
      {section === "profile" && <div className="driver-section"><h1>Профиль</h1><div className="driver-identity"><DriverMark /><div><h2>{fullName}</h2><p>Учебный профиль водителя</p></div></div><div className="driver-card"><DriverRow title="Состояние" value={active ? "На линии · учебный заказ" : "Офлайн"} /><DriverRow title="Сервис" value="Такси" /><DriverRow title="Парк" value={profile.park?.name ?? "—"} /><DriverRow title="Комиссия парка" value={`${profile.park?.commission ?? 0}%`} /><DriverRow title="Профиль создан" value={dateTime(profile.created_at)} /></div><div className="driver-card driver-menu"><button disabled={busy || active} onClick={() => onAction({ action: "services" })}><span>Мои сервисы и парк{active ? " · после заказа" : ""}</span><ChevronRightIcon /></button><button onClick={() => onSection("learning")}><span><SparkIcon /> Обучение</span><ChevronRightIcon /></button>{onForget && <button disabled={busy} onClick={onForget}><span>Сбросить подтверждение этого браузера</span><ChevronRightIcon /></button>}<Link to="/training/city?district=driver"><span>Мой город · миссии</span><ChevronRightIcon /></Link><Link to="/training?kind=simulator"><span>Выйти из симулятора</span><ChevronRightIcon /></Link></div></div>}
      {section === "learning" && <div className="driver-section"><button className="driver-back" onClick={() => onSection("profile")}>‹ Профиль</button><h1>Обучение</h1><div className="driver-card"><h2>Вход в приложение</h2><p>Запуск → Такси → выбор парка → номер и код из Telegram → загрузка профиля → карта.</p><DriverRow title="Статус" value="Вход завершён" /></div><div className="driver-card"><h2>Полный заказ</h2><p>Адреса → линия → принять заказ → на месте → начать поездку → завершить → подтвердить оплату.</p><DChoice arrow onClick={() => onSection("orders")}>{active ? "Продолжить заказ" : "Перейти к заказам"}</DChoice></div><div className="driver-card"><h2>Кнопки тренажёра</h2><p className="driver-muted">Роль кнопки видно до того, как прочитаешь подпись.</p><DLegend /><DInfo title="Почему кнопка бывает серой"><p>Серая кнопка действия ждёт условия: подъехать в радиус подачи, дождаться пассажира, восстановить геолокацию.</p><p>Причина всегда написана под кнопкой, а жёлтая дуга по её краю показывает, сколько осталось до разблокировки.</p></DInfo></div></div>}
    </main>}
    {!!error && <div className="driver-error"><ErrorState error={error} onRetry={profile.stage === "loading" ? () => onAction({ action: "enter" }) : onRefresh} /></div>}
    {offline && (navigation || !(active && section === "orders")) && <nav className="driver-nav" aria-label="Разделы водительского приложения">{DRIVER_SECTIONS.map(({ id, title, Icon }) => <button key={id} className={section === id || (id === "profile" && section === "learning") ? "is-active" : undefined} aria-current={section === id || (id === "profile" && section === "learning") ? "page" : undefined} onClick={() => onSection(id)}><Icon size={22} /><span>{title}</span></button>)}</nav>}
    {profile.stage === "cooperation" && <Sheet id="driver-parks" title="Выберите вариант сотрудничества" onClose={() => { if (!busy) onAction({ action: "services" }); }}>
      <div className="driver-park-list">{parks.map((park) => <button className="driver-park" disabled={busy} key={park.id} onClick={() => onAction({ action: "park", park_id: park.id })}><span><strong>{park.name}</strong><ChevronRightIcon /></span><small>Комиссия парка с заказа: {park.commission}%</small>{profile.park?.id === park.id && <em>Выбран при прошлом входе</em>}</button>)}</div>
      {!!error && <ErrorState error={error} onRetry={onRefresh} />}
    </Sheet>}
  </div>;
}

function DriverRow({ title, value }: { title: string; value: string }) {
  return <div className="driver-row"><span>{title}</span><strong>{value}</strong></div>;
}

function OrderHistory({ orders }: { orders: DriverState["order_history"] }) {
  if (!orders.length) return <p className="driver-muted">Операций пока нет</p>;
  return <div className="driver-history">{orders.map(order => <article key={order.id}><div><time>{dateTime(order.finished_at!)}</time><strong>+{money(order.net)}</strong></div><p>А · {order.origin}<br />Б · {order.destination}</p><p>{order.payment === "cash" ? "Наличные" : "Карта"} · {order.park.name} · комиссия {money(order.commission)}</p></article>)}<p className="driver-muted">Последние {orders.length} выполненных заказов</p></div>;
}
