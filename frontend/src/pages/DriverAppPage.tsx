import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { driver, type DriverAction, type DriverPark, type DriverProfile } from "../api/driver";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { SimulatorMap, type Position } from "../components/SimulatorMap";
import { ChevronRightIcon, CoinIcon, InboxIcon, SparkIcon, TrophyIcon, UserIcon } from "../components/icons";
import { ErrorState } from "../components/ui";
import { dateTime } from "../utils/format";
import "./simulator.css";
import "./driver-app.css";

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
  const query = useQuery({ queryKey: ["driver-profile"], queryFn: driver.state, refetchOnWindowFocus: false });
  const [params, setParams] = useSearchParams();
  const [booting, setBooting] = useState(true);
  const [position, setPosition] = useState<Position | null>(null);
  const action = useMutation({ mutationFn: driver.action, onSuccess: (data) => {
    client.setQueryData(["driver-profile"], data);
    if (data.profile?.stage === "offline") setParams({}, { replace: true });
  } });
  const { mutate } = action;
  const stage = query.data?.profile?.stage;
  useEffect(() => { const timer = window.setTimeout(() => setBooting(false), 1200); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (stage !== "loading" || booting) return;
    const timer = window.setTimeout(() => mutate({ action: "enter" }), 1000);
    return () => window.clearTimeout(timer);
  }, [stage, booting, mutate]);
  useEffect(() => {
    // Вход не запрашивает новое разрешение. При уже выданном разрешении
    // показываем текущую точку только в памяти открытого приложения.
    if (stage !== "offline" || !navigator.permissions || !navigator.geolocation) return;
    let disposed = false;
    void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
      if (disposed || permission.state !== "granted") return;
      navigator.geolocation.getCurrentPosition((value) => {
        if (!disposed) setPosition({ latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy });
      }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 6000 });
    }).catch(() => {});
    return () => { disposed = true; setPosition(null); };
  }, [stage]);

  if (query.isError) return <div className="driver-app"><DriverHeader /><div className="driver-content driver-content--center"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div></div>;
  if (booting || query.isLoading) return <DriverSplash />;
  const profile = query.data?.profile;
  if (!profile) return <div className="driver-app"><DriverHeader /><div className="driver-content driver-content--center"><h1>Driver Simulator</h1><p>Запустите учебный профиль из раздела обучения.</p><Link className="driver-primary" to="/training?kind=simulator">Открыть обучение</Link></div></div>;
  return <DriverScreen
    profile={profile} parks={query.data!.parks} fullName={user?.full_name ?? ""}
    section={driverSection(params.get("section"))} position={position} busy={action.isPending}
    onSection={(section) => setParams(section === "orders" ? {} : { section })}
    onAction={(payload) => { action.reset(); mutate(payload); }}
    error={action.error} onRefresh={() => query.refetch()}
  />;
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
  profile: DriverProfile; parks: DriverPark[]; fullName: string; section: DriverSection;
  position: Position | null; busy: boolean; error?: unknown;
  onAction: (action: DriverAction) => void; onSection: (section: DriverSection) => void; onRefresh: () => void;
}
export function DriverScreen({ profile, parks, fullName, section, position, busy, error, onAction, onSection, onRefresh }: ScreenProps) {
  const offline = profile.stage === "offline";
  return <div className="driver-app">
    <DriverHeader />
    {profile.stage === "loading" ? <DriverLoading /> : !offline ? <main className="driver-services">
      <div className="driver-identity"><DriverMark /><div><h1>{fullName}</h1><p>Учебный профиль водителя</p></div></div>
      <div className="driver-card driver-balance"><CoinIcon size={28} /><div><strong>0 ₸</strong><span>Учебный баланс</span></div></div>
      <h2>Мои сервисы</h2>
      <button className="driver-card driver-service" disabled={busy} onClick={() => onAction({ action: "taxi" })}><span className="driver-taxi"><DriverArrow /></span><span><strong>Такси</strong><small>Учебная работа с заказами</small></span><ChevronRightIcon /></button>
    </main> : <main className={`driver-content${section === "orders" ? " driver-content--orders" : ""}`}>
      {section === "orders" && <>
        <div className="driver-map"><SimulatorMap position={position} progress={0} ready={false} idle /></div>
        <section className="driver-orders-panel" aria-label="Заказы и состояние водителя">
          <div className="driver-stats"><div><span>Приоритет</span><strong>0</strong></div><button onClick={() => onSection("income")}><span>0 заказов</span><strong>0 ₸ <ChevronRightIcon size={16} /></strong></button></div>
          <div className="driver-card driver-goals"><strong>Цели и задания</strong><span>Активных заданий пока нет</span></div>
          <button className="driver-online" disabled aria-describedby="driver-preview-mode"><span className="driver-online__arrow">→</span><span><small>Офлайн</small><strong>Выйти на линию</strong></span></button>
          <p className="driver-note" id="driver-preview-mode">Сейчас доступны вход и просмотр разделов.</p>
        </section>
      </>}
      {section === "results" && <div className="driver-section"><h1>Результаты</h1><div className="driver-card"><h2>Работа в приложении</h2><DriverRow title="Выполнено заказов" value="0" /><DriverRow title="Приоритет" value="0" /><DriverRow title="Время на линии" value="0 ч" /></div><div className="driver-card"><h2>Вход в приложение</h2><DriverRow title="Статус" value="Вход завершён" />{profile.last_login_at && <DriverRow title="Последний вход" value={dateTime(profile.last_login_at)} />}</div></div>}
      {section === "income" && <div className="driver-section"><h1>Доход</h1><div className="driver-card driver-money"><span>Учебный баланс</span><strong>0 ₸</strong></div><div className="driver-card"><DriverRow title="Доход от заказов" value="0 ₸" /><DriverRow title="Комиссия выбранного парка" value={`${profile.park?.commission ?? 0}%`} /></div><div className="driver-card"><h2>История операций</h2><p className="driver-muted">Операций пока нет</p></div></div>}
      {section === "messages" && <div className="driver-section"><h1>Сообщения</h1><div className="driver-card driver-empty"><InboxIcon size={36} /><h2>Сообщений пока нет</h2></div></div>}
      {section === "profile" && <div className="driver-section"><h1>Профиль</h1><div className="driver-identity"><DriverMark /><div><h2>{fullName}</h2><p>Учебный профиль водителя</p></div></div><div className="driver-card"><DriverRow title="Состояние" value="Офлайн" /><DriverRow title="Сервис" value="Такси" /><DriverRow title="Парк" value={profile.park?.name ?? "—"} /><DriverRow title="Комиссия парка" value={`${profile.park?.commission ?? 0}%`} /><DriverRow title="Профиль создан" value={dateTime(profile.created_at)} /></div><div className="driver-card driver-menu"><button disabled={busy} onClick={() => onAction({ action: "services" })}><span>Мои сервисы и парк</span><ChevronRightIcon /></button><button onClick={() => onSection("learning")}><span><SparkIcon /> Обучение</span><ChevronRightIcon /></button><Link to="/training?kind=simulator"><span>Выйти из симулятора</span><ChevronRightIcon /></Link></div></div>}
      {section === "learning" && <div className="driver-section"><button className="driver-back" onClick={() => onSection("profile")}>‹ Профиль</button><h1>Обучение</h1><div className="driver-card"><h2>Вход в приложение</h2><p>Запуск → Такси → выбор парка → загрузка профиля → карта.</p><DriverRow title="Статус" value="Вход завершён" /></div></div>}
    </main>}
    {!!error && <div className="driver-error"><ErrorState error={error} onRetry={profile.stage === "loading" ? () => onAction({ action: "enter" }) : onRefresh} /></div>}
    {offline && <nav className="driver-nav" aria-label="Разделы водительского приложения">{DRIVER_SECTIONS.map(({ id, title, Icon }) => <button key={id} className={section === id || (id === "profile" && section === "learning") ? "is-active" : undefined} aria-current={section === id || (id === "profile" && section === "learning") ? "page" : undefined} onClick={() => onSection(id)}><Icon size={22} /><span>{title}</span></button>)}</nav>}
    {profile.stage === "cooperation" && <Sheet id="driver-parks" title="Выберите вариант сотрудничества" onClose={() => { if (!busy) onAction({ action: "services" }); }}>
      <div className="driver-park-list">{parks.map((park) => <button className="driver-park" disabled={busy} key={park.id} onClick={() => onAction({ action: "park", park_id: park.id })}><span><strong>{park.name}</strong><ChevronRightIcon /></span><small>Комиссия парка с заказа: {park.commission}%</small>{profile.park?.id === park.id && <em>Выбран при прошлом входе</em>}</button>)}</div>
      {!!error && <ErrorState error={error} onRetry={onRefresh} />}
    </Sheet>}
  </div>;
}

function DriverRow({ title, value }: { title: string; value: string }) {
  return <div className="driver-row"><span>{title}</span><strong>{value}</strong></div>;
}
