import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DCard, DForm, DInput, DRow, DToggle, CarArt, type ShiftViewProps } from "./DriverShiftUI";
import { DAction, DChoice, DExplain, DInfo } from "./DriverButtons";
import { money } from "./DriverOrders";
import { dateTime } from "../utils/format";
import { useEdgeBack } from "../hooks/useEdgeBack";
import "./driver-profile.css";

/* Строение раздела повторяет приложение парка: карточка водителя с плитками, тарифы с
   вкладками и свёрнутым блоком недоступного, фотоконтроль списком с группами, приоритет
   дугой, уровни лояльности с темой на уровень и рейтинг с историей оценок.
   Данные и правила остаются учебными и подписаны как учебные. */

export const PROFILE_VIEWS = [
  "profile", "rating", "rating-info", "levels", "level-history", "priority", "park", "tariffs", "payment",
  "cars", "car", "diagnostics", "photo", "about", "garage", "fuel", "benefits", "offers", "promo", "invite",
  "learning", "legal", "provider", "documents", "settings", "privacy", "license",
];
const LEVEL_THEMES = ["master", "pro", "expert", "champion", "legend"];
const PAYMENTS = [
  { value: "any", title: "Наличными или картой", note: "Доступно всегда" },
  { value: "card", title: "Картой", note: "Оплата подтверждается автоматически" },
  { value: "cash", title: "Наличными", note: "Подтверждайте получение после поездки" },
];
const PHOTO_STEPS = ["Автомобиль спереди", "Автомобиль сбоку", "Чистота салона", "Учебный документ", "Селфи водителя"];
const lessons = [
  { id: "tariffs", title: "Тарифы и условия", text: "Перед выходом на линию проверьте доступные тарифы в профиле. Причина ограничения указана рядом с тарифом. Смена автомобиля может потребовать нового фотоконтроля." },
  { id: "standards", title: "Стандарты поездки", text: "Подтвердите прибытие у точки А, дождитесь пассажира и сверяйте адрес Б. Изменение маршрута оформляется в активном заказе. При оплате наличными подтвердите получение." },
];

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    camera: <><path d="M4 8h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.6" /></>,
    taxi: <><path d="M3 11h18v7H3z" /><path d="M6 11V7h12v4M9 7V4h6v3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4m8-4v4" /></>,
    pencil: <path d="M4 20h4L20 8l-4-4L4 16z" />,
    trash: <><path d="M5 7h14M9 7V4h6v3m-8 0 1 14h8l1-14" /></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12h3" /></>,
    shield: <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />,
    chart: <><path d="M4 20V10m5 10V4m5 16v-7m5 7V8" /></>,
    star: <path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-9.5v.5" /></>,
    percent: <><path d="m6 18 12-12" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>,
    spark: <path d="m13 3-7 10h5l-1 8 7-10h-5z" />,
    chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
    car: <><path d="M4 16h16M5 16v2m14-2v2" /><path d="M4.5 16 6 9.5A2 2 0 0 1 8 8h8a2 2 0 0 1 2 1.5L19.5 16" /></>,
    back: <path d="M15 19 8 12l7-7" strokeWidth="2.2" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="dp-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="dp-round dp-sheet-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
    <section className="dp-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  </div>;
}

/** Полукруглая дуга приоритета: заполнение показывает, сколько набрано из максимума. */
function Gauge({ value, max }: { value: number; max: number }) {
  const length = Math.PI * 120, filled = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return <div className="dp-gauge">
    <svg viewBox="0 0 300 178" role="img" aria-label={`Приоритет ${value} из ${max}`}>
      <path className="dp-gauge-track" d="M30 158a120 120 0 0 1 240 0" fill="none" strokeWidth="26" strokeLinecap="round" />
      <path className="dp-gauge-fill" d="M30 158a120 120 0 0 1 240 0" fill="none" strokeWidth="26" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - filled)} />
      <text className="dp-gauge-value" x="150" y="146" textAnchor="middle">{value}</text>
      <text className="dp-gauge-edge" x="24" y="176" textAnchor="middle">0</text>
      <text className="dp-gauge-edge" x="276" y="176" textAnchor="middle">{max}</text>
    </svg>
  </div>;
}

export function DriverProfileViews(p: ShiftViewProps) {
  const { shift, state, view, detail, fullName, act, go, busy } = p;
  const d = shift.data, c = shift.config;
  const car = d.cars.find(x => x.id === d.car_id) ?? d.cars[0];
  const level = [...c.levels].reverse().find(x => d.points >= x.threshold) ?? c.levels[0];
  const next = c.levels.find(x => x.threshold > d.points);
  const votes = d.rating_votes.reduce((a, b) => a + b, 0);
  const rating = votes ? (d.rating_votes.reduce((a, b, i) => a + b * (i + 1), 0) / votes).toFixed(2) : "—";
  const photoDone = d.photo_status === "passed";
  const parkName = state.profile?.park?.name ?? "—";
  const paymentLabel = PAYMENTS.find(x => x.value === d.payment)?.title ?? "Наличными или картой";
  const problems = (photoDone ? 0 : 1) + (car && car.status === "available" ? 0 : 1) + (d.tariffs.length ? 0 : 1);
  const [sheet, setSheet] = useState<string | null>(null);
  // Кнопка, жест и шеврон ведут в одно место: сначала закрываем шторку, потом уходим с экрана.
  const backTo = ({ car: "cars", provider: "legal", documents: "legal" } as Record<string, string>)[view] ?? "profile";
  const overlay = !!sheet || view === "payment";
  const goBack = useCallback(() => { if (sheet) { setSheet(null); return; } go(backTo); }, [sheet, backTo, go]);
  const { offset, dragging } = useEdgeBack(view === "profile" || overlay ? null : goBack);
  const [tariffTab, setTariffTab] = useState<"driver" | "courier">("driver");
  const [parkTab, setParkTab] = useState<"cars" | "offers" | "contacts">("contacts");
  const [unavailable, setUnavailable] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const head = (title: string, big = false, action?: ReactNode) => <header className={`dp-head${big ? " dp-head--big" : " dp-head--center"}`}>
    <button className="dp-back" type="button" aria-label="Назад" onClick={goBack}><Icon name="back" /></button>
    <h1>{title}</h1>
    {action ?? (big ? null : <span className="dp-spacer" />)}
  </header>;
  const bigHead = (title: string) => head(title, true);
  const row = (title: string, opts: { note?: string; tone?: string; value?: ReactNode; sub?: string; onClick?: () => void; icon?: string; locked?: boolean; right?: ReactNode } = {}) => {
    const body = <>
      {opts.icon && <span className="dp-row-icon"><Icon name={opts.icon} /></span>}
      <div><strong>{title}</strong>{opts.note && <small data-tone={opts.tone}>{opts.note}</small>}</div>
      {opts.value !== undefined && <b>{opts.value}{opts.sub && <><br /><small>{opts.sub}</small></>}</b>}
      {opts.right}
      {opts.onClick && <i aria-hidden="true">›</i>}
    </>;
    return opts.onClick
      ? <button className="dp-row" type="button" key={title} data-locked={opts.locked} onClick={opts.onClick}>{body}</button>
      : <div className="dp-row" key={title} data-locked={opts.locked}>{body}</div>;
  };

  // ── главный экран профиля ───────────────────────────────────────────
  const main = <>
    <div className="dp-identity">
      <span className="dp-avatar-large">{fullName.split(" ").map(s => s[0]).slice(0, 2).join("")}</span>
      <button type="button" onClick={() => go("about")}><h1>{fullName.split(" ")[0] || fullName}</h1><i aria-hidden="true">›</i></button>
    </div>
    <div className="dp-card">
      <div className="dp-brand">
        <span className="dp-logo" aria-hidden="true"><span /></span>
        <strong>Водитель</strong>
        <button className="dp-pill" type="button" disabled={busy} onClick={p.switchPark}>Сменить парк</button>
      </div>
      <div className="dp-tiles">
        <button type="button" onClick={() => go("rating")}><strong>{rating}</strong><span>Рейтинг</span>
          <svg viewBox="0 0 24 24" fill="#d8a32c" aria-hidden="true"><path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z" /></svg></button>
        <button type="button" onClick={() => go("levels")}><strong>{d.points.toLocaleString("ru")}</strong><span>Баллы</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#4a4a46" /></svg></button>
        <button type="button" onClick={() => go("priority")}><strong>+{d.priority}</strong><span>Приоритет</span>
          <svg viewBox="0 0 24 24" fill="var(--driver-yellow)" aria-hidden="true"><path d="M12 2c1.6 4.4 3.6 6.4 8 8-4.4 1.6-6.4 3.6-8 8-1.6-4.4-3.6-6.4-8-8 4.4-1.6 6.4-3.6 8-8z" /></svg></button>
      </div>
      <div className="dp-card dp-card--flat">
        {row("Парк", { value: parkName, onClick: () => go("park") })}
        {row("Тарифы и опции", { value: `${d.tariffs.length} из ${c.tariffs.length}`, onClick: () => go("tariffs") })}
        {row("Оплата", { value: paymentLabel, onClick: () => go("payment") })}
      </div>
    </div>
    <h2 className="dp-section-title">Мой транспорт</h2>
    {car ? <button className="dp-vehicle" type="button" onClick={() => go("car", car.id)}>
      <strong>{car.brand} {car.model} · 1 транспортное средство</strong>
      <span className="dp-vehicle-foot"><span className="dp-plate">{car.plate}</span><CarArt /></span>
    </button> : <div className="dp-card">{row("Автомобиль не выбран", { note: "Добавьте учебный автомобиль", onClick: () => go("cars") })}</div>}
    <div className="dp-card dp-card--flat">
      {row("Диагностика", { icon: "camera", onClick: () => go("diagnostics"), right: problems ? <b className="dp-badge">{problems}</b> : undefined })}
      {row("Фотоконтроль", { icon: "shield", note: photoDone ? "Пройден" : "Нужна проверка", tone: photoDone ? undefined : "danger", onClick: () => go("photo") })}
      {row("Мои автомобили", { icon: "car", onClick: () => go("cars") })}
    </div>
    <div className="dp-card dp-card--flat">
      {row("Гараж", { icon: "car", onClick: () => go("garage") })}
      {row("Заправки", { icon: "spark", onClick: () => go("fuel") })}
      {row("Выгодные предложения", { icon: "percent", onClick: () => go("benefits") })}
      {row("Промокоды", { icon: "percent", onClick: () => go("promo") })}
      {row("Пригласить водителя", { icon: "chat", onClick: () => go("invite") })}
      {row("Обучение", { icon: "info", onClick: () => go("learning") })}
      {row("Юридические документы", { icon: "wallet", onClick: () => go("legal") })}
      {row("Настройки", { icon: "info", onClick: () => go("settings") })}
    </div>
    <div className="dp-card dp-card--flat">
      {row("Моё задание и результат смены", { onClick: () => go("shift-result") })}
      {row("Правила тренажёра", { onClick: () => go("license") })}
      {row("Конфиденциальность", { onClick: () => go("privacy") })}
    </div>
  </>;

  const body = (() => {
  if (view === "profile") return main;

  if (view === "payment") return <>{main}
    <Sheet title="Оплата" onClose={() => go("profile")}>
      <div className="dp-sheet-note"><i aria-hidden="true">⚡</i><span>Способ оплаты решает, чем закончится заказ: наличные нужно подтвердить, карта подтверждается сама.</span></div>
      <div className="dp-sheet-group">
        {PAYMENTS.map(x => <button className="dp-pick" type="button" key={x.value} aria-pressed={d.payment === x.value} disabled={busy} onClick={() => act("payment", { value: x.value })}>
          <div><strong>{x.title}</strong><small>{x.note}</small></div><u aria-hidden="true">✓</u>
        </button>)}
      </div>
      <DExplain real="способ оплаты можно менять ограниченное число раз за сутки, а в зоне повышенного спроса часть способов закрыта." sim="ограничений нет: переключайте сколько нужно, чтобы разобрать оба финала заказа." />
      <DAction label="Выбрать" onClick={() => go("profile")} />
    </Sheet>
  </>;

  // ── тарифы и опции ──────────────────────────────────────────────────
  if (view === "tariffs") {
    const open = c.tariffs.filter(x => x.available), closed = c.tariffs.filter(x => !x.available);
    return <>
      {bigHead("Тарифы и опции")}
      <div className="dp-tabs">
        <button type="button" aria-pressed={tariffTab === "courier"} onClick={() => setTariffTab("courier")}><i className="dp-tab-courier" aria-hidden="true">▣</i>Курьер</button>
        <button type="button" aria-pressed={tariffTab === "driver"} onClick={() => setTariffTab("driver")}><i className="dp-tab-driver" aria-hidden="true" />Водитель</button>
      </div>
      {tariffTab === "courier" ? <>
        <div className="dp-card dp-card--flat">{row("Доставка", { note: "Сервис не входит в тренажёр", tone: "danger", locked: true })}</div>
        <DExplain real="курьерские тарифы включаются отдельно, для части из них нужен тест, термокороб или медкнижка." sim="тренажёр отрабатывает работу водителя такси, поэтому вкладка оставлена только для узнавания экрана." />
      </> : <>
        <div className="dp-card dp-card--flat">
          {open.map(x => photoDone
            ? <div className="dp-row" key={x.id}><div><strong>{x.name}</strong><small>{x.reason || "Доступен для учебного автомобиля"}</small></div>
                <DToggle title="" checked={d.tariffs.includes(x.id)} disabled={busy} onChange={() => act("tariff", { id: x.id })} /></div>
            : row(x.name, { note: "Пройдите фотоконтроль машины", tone: "danger", onClick: () => go("photo") }))}
        </div>
        <p className="driver-muted">Оставьте включённым хотя бы один тариф. Менять выбор можно между заказами.</p>
        {!!closed.length && <div className="dp-group" data-open={unavailable}>
          <button type="button" aria-expanded={unavailable} onClick={() => setUnavailable(!unavailable)}><span>Недоступные тарифы и опции</span><span className="dp-group-chevron" aria-hidden="true" /></button>
          {unavailable && <div className="dp-card dp-card--flat">{closed.map(x => row(x.name, { note: x.reason || "Машина не подходит", tone: "danger", locked: true, onClick: () => go("cars") }))}</div>}
        </div>}
      </>}
    </>;
  }

  // ── парк ────────────────────────────────────────────────────────────
  if (view === "park") return <>
    {bigHead(parkName)}
    <button className="dp-park-rating" type="button" onClick={() => go("rating")}><Icon name="star" /> {rating} <small>{votes} оценок</small><i aria-hidden="true">›</i></button>
    <h2 className="dp-section-title">Комиссии в парке</h2>
    <div className="dp-card dp-card--flat">
      {row("Комиссия с заказа", { value: `${state.profile?.park?.commission ?? 0}%` })}
      {row("Комиссия сервиса", { value: `${c.service_percent}%` })}
      {row("НДС с комиссии сервиса", { value: `${c.service_tax_percent}%` })}
      {row("Ожидание", { value: `${money(c.wait_per_minute)} / мин` })}
    </div>
    <div className="dp-tabs-plain">
      <button type="button" aria-pressed={parkTab === "cars"} onClick={() => setParkTab("cars")}>Машины</button>
      <button type="button" aria-pressed={parkTab === "offers"} onClick={() => setParkTab("offers")}>Акции</button>
      <button type="button" aria-pressed={parkTab === "contacts"} onClick={() => setParkTab("contacts")}>Контакты</button>
    </div>
    <div className="dp-card dp-card--flat">
      {parkTab === "cars" ? <>
        {d.cars.map(x => row(`${x.brand} ${x.model}`, { note: x.plate, icon: "car", onClick: () => go("car", x.id) }))}
        {row("Гараж парка", { icon: "car", onClick: () => go("garage") })}
      </> : parkTab === "offers" ? <>
        {row("Выгодные предложения", { icon: "percent", onClick: () => go("benefits") })}
        {row("Промокоды", { icon: "percent", onClick: () => go("promo") })}
      </> : <>
        {row("Сообщения парка", { icon: "chat", onClick: () => go("chats", "park") })}
        {row("Поддержка", { icon: "info", onClick: () => go("support") })}
        {row("Учебный парк", { note: "Телефон и мессенджеры в тренажёре не подключены", icon: "taxi", locked: true })}
      </>}
    </div>
    <DExplain real="здесь видно рейтинг парка, условия выплат и его контакты — телефон, мессенджер, новости." sim="показаны условия из сценария руководителя: комиссии влияют на доход в разборе смены." />
    <div className="dp-bottom"><button className="dp-bottom-button" type="button" disabled={busy} onClick={p.switchPark}>Выбрать другой парк</button></div>
  </>;

  // ── рейтинг ─────────────────────────────────────────────────────────
  if (view === "rating" || view === "rating-info") return <>
    {head("Рейтинг")}
    <div className="dp-rating-hero">
      <strong>{rating}</strong>
      <i aria-hidden="true">☺</i>
      <span>Вы здесь</span>
    </div>
    <h2 className="dp-section-title">История</h2>
    <div className="dp-rating-rows">{[5, 4, 3, 2, 1].map(stars => <div key={stars}>
      <span>{[1, 2, 3, 4, 5].map(i => <b key={i} className={i <= stars ? "dp-star-on" : "dp-star-off"} data-tone={stars === 5 ? "good" : stars >= 3 ? "mid" : "low"}>★</b>)}</span>
      <b>{d.rating_votes[stars - 1]}</b>
    </div>)}</div>
    <DInfo title="Как устроен рейтинг">
      <p>Среднее по оценкам этой учебной смены. За выполненный заказ сценарий добавляет оценку 5, начальное распределение задаёт руководитель.</p>
      <p>В реальной работе рейтинг считается за последние поездки и влияет на доступ к тарифам.</p>
    </DInfo>
  </>;

  // ── уровни лояльности ───────────────────────────────────────────────
  if (view === "levels" || view === "level-history") {
    const target = next ?? level, index = Math.max(0, c.levels.indexOf(target));
    const theme = LEVEL_THEMES[Math.min(index, LEVEL_THEMES.length - 1)];
    const floor = next ? level.threshold : 0, span = Math.max(1, target.threshold - floor);
    const gained = Math.max(0, Math.min(span, d.points - floor));
    return <>
      <div className="dp-level" data-theme={theme}>
        {head("Уровень", false, <button className="dp-back" type="button" aria-label="О программе лояльности" onClick={() => setSheet("loyalty")}><Icon name="info" /></button>)}
        <p className="dp-level-lead">{next ? "Копите баллы и получите уровень" : "Ваш текущий уровень"}</p>
        <div className="dp-level-name">{next && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>}<strong>{target.name}</strong></div>
        <div className="dp-orbs" aria-hidden="true"><i /><i /><i /></div>
        <div className="dp-card">
          <h2>{next ? `Как получить «${target.name}»` : `Уровень «${level.name}»`}</h2>
          <p>{next ? `Наберите ${target.threshold.toLocaleString("ru")} баллов за смену. Баллы начисляются за выполненные заказы.` : "Это максимальный учебный уровень сценария."}</p>
          <div className="dp-progress-line">
            <div><span>{d.points.toLocaleString("ru")}</span><span>{target.threshold.toLocaleString("ru")}</span></div>
            <i><b style={{ width: `${Math.round(gained / span * 100)}%` }} /></i>
          </div>
          {row("Смотреть историю баллов", { onClick: () => setSheet("points") })}
          {row(d.level_restored ? "Уровень восстановлен" : "Восстановить уровень", { onClick: d.level_restored || busy ? undefined : () => act("level_restore") })}
        </div>
        <div className="dp-card">
          <h2>Преимущества уровня «{target.name}»</h2>
          <p>{target.benefits}</p>
        </div>
      </div>
      <div className="dp-card dp-card--flat">{c.levels.map(x => row(x.name, { note: x.benefits, value: x === level ? "Текущий" : `От ${x.threshold.toLocaleString("ru")}` }))}</div>
      {sheet === "loyalty" && <Sheet title="О программе лояльности" onClose={() => setSheet(null)}>
        <div className="dp-sheet-group dp-sheet-text">
          <p><b>Получение баллов и уровней.</b> Баллы начисляются за выполненные учебные заказы. Чем больше баллов за смену, тем выше уровень и преимущества.</p>
        </div>
        <div className="dp-sheet-group dp-sheet-text">
          <p><b>Восстановление уровня.</b> Один раз за смену можно вернуть утраченный уровень — в реальной работе запасные баллы дают раз в календарный год.</p>
        </div>
        <div className="dp-sheet-group">{c.levels.map(x => row(x.name, { value: x.threshold.toLocaleString("ru") }))}</div>
        <DExplain real="баллы начисляются за километры пробега с пассажирами, у каждого тарифа свой коэффициент." sim="шкалу уровней и порогов задаёт руководитель в сценарии смены." />
      </Sheet>}
      {sheet === "points" && <Sheet title="История баллов" onClose={() => setSheet(null)}>
        {d.points_history.length
          ? <div className="dp-sheet-group">{d.points_history.map(x => row(`Заказ ${x.order_id.slice(0, 8)}`, { note: dateTime(x.at), value: `+${x.points}` }))}</div>
          : <p className="driver-muted">Баллы появятся после первого выполненного заказа.</p>}
      </Sheet>}
    </>;
  }

  // ── приоритет ───────────────────────────────────────────────────────
  if (view === "priority") {
    const max = c.priority_base + c.target_orders * c.priority_complete;
    return <>
      {head("Приоритет")}
      <Gauge value={d.priority} max={max} />
      <div className="dp-gauge-caption">
        <strong>{d.priority >= max ? "Так держать!" : "Приоритет растёт за заказы"}</strong>
        <span>{d.priority >= max ? "У вас максимальный учебный приоритет" : `До максимума ещё ${max - d.priority}`}</span>
      </div>
      <div className="dp-card dp-card--flat">{row("История изменений приоритета", { onClick: () => setSheet("priority") })}</div>
      <h2 className="dp-section-title">Полученные</h2>
      <div className="dp-card dp-card--flat">
        <div className="dp-row"><span className="dp-status" data-tone="warn">✓</span><div><strong>Базовое значение</strong></div><b>+{c.priority_base}</b></div>
        <div className="dp-row"><span className="dp-status" data-tone={d.completed ? "warn" : "idle"}>✓</span><div><strong>Принятые заказы</strong><small>Выполнено: {d.completed}</small></div><b>+{d.completed * c.priority_complete}<br /><small>из {c.target_orders * c.priority_complete}</small></b></div>
      </div>
      <h2 className="dp-section-title">Снято</h2>
      <div className="dp-card dp-card--flat">
        {row("Пропущенные предложения", { note: `Пропущено: ${d.missed}`, value: shift.mode === "free" ? "Без штрафа" : `−${d.missed * c.priority_missed}`, locked: true })}
        {row("Отменённые заказы", { note: `Отменено: ${d.cancelled}`, value: shift.mode === "free" ? "Без штрафа" : `−${d.cancelled * c.priority_cancelled}`, locked: true })}
      </div>
      <DExplain real="приоритет поднимают брендирование, год выпуска машины, тип сотрудничества и высокий рейтинг." sim="приоритет считается по сценарию: база плюс выполненные заказы, минус пропуски и отмены в зачётной смене." />
      {sheet === "priority" && <Sheet title="История изменений" onClose={() => setSheet(null)}>
        <div className="dp-sheet-group">
          {row("Начало смены", { value: `+${c.priority_base}` })}
          {row("Выполненные заказы", { value: `+${d.completed * c.priority_complete}` })}
          {row("Пропуски и отмены", { value: shift.mode === "free" ? "0" : `−${d.missed * c.priority_missed + d.cancelled * c.priority_cancelled}` })}
          {row("Сейчас", { value: `+${d.priority}` })}
        </div>
      </Sheet>}
    </>;
  }

  // ── транспорт ───────────────────────────────────────────────────────
  if (view === "cars") return <>
    {head("Транспорт")}
    <button className="dp-add" type="button" onClick={() => setSheet("car-add")}>
      <span>Добавить транспорт</span><i aria-hidden="true">+</i>
    </button>
    {d.cars.map(x => <button className="dp-vehicle" key={x.id} type="button" onClick={() => go("car", x.id)}>
      <strong>{x.brand} {x.model}{x.id === d.car_id ? " · Основной" : ""}</strong>
      <span className="dp-vehicle-foot"><span className="dp-plate">{x.plate}</span><CarArt /></span>
    </button>)}
    {sheet === "car-add" && <Sheet title="Добавить автомобиль" onClose={() => setSheet(null)}>
      <DForm busy={busy} label="Добавить в учебный профиль" onSubmit={values => { act("car_add", values); setSheet(null); }}>
        <DInput label="Марка" name="brand" value="Kia" />
        <DInput label="Модель" name="model" value="Rio" />
        <DInput label="Госномер" name="plate" value="000AAA00" />
        <DInput label="Год выпуска" name="year" type="number" min={2000} max={2030} value={2021} />
      </DForm>
      <DExplain real="машину добавляет парк, водителю остаётся пройти фотоконтроль." sim="автомобиль появится сразу и потребует учебного фотоконтроля." />
    </Sheet>}
  </>;

  if (view === "car") {
    const item = d.cars.find(x => x.id === detail) ?? car;
    if (!item) return <>{head("Транспорт")}<p className="driver-muted">Автомобиль не найден.</p></>;
    return <>
      {head(`${item.brand} ${item.model}`)}
      <div className="dp-car-hero"><span className="dp-plate">{item.plate}</span><CarArt color={item.id === d.car_id ? "#c2c6cc" : "#9aa0a8"} /></div>
      <div className="dp-card dp-card--flat">
        {row("Брендинг", { icon: "lock", note: "Нужно обратиться в ваш парк", locked: true })}
        {row("Фотоконтроль", { icon: "camera", note: `Пройдено ${d.photo_steps.length} из ${PHOTO_STEPS.length}`, onClick: () => go("photo") })}
      </div>
      <h2 className="dp-section-title">Информация о машине</h2>
      <div className="dp-card dp-card--flat">
        {row("Добавлена парком", { icon: "taxi", note: parkName })}
        {row("Год выпуска", { icon: "calendar", value: item.year })}
        {row("Состояние", { icon: "shield", value: item.status === "available" ? "Допущен" : "Нужна проверка" })}
        {row("Редактировать", { icon: "pencil", note: "Нужно обратиться в парк", locked: true })}
        {row("Удалить", { icon: "trash", note: "Нужно обратиться в парк", locked: true })}
      </div>
      {item.id !== d.car_id && <DAction label="Сделать основным" busy={busy} onClick={() => act("car_select", { id: item.id })} readyNote="Смена автомобиля может потребовать нового фотоконтроля." />}
      <DExplain real="редактирование и удаление машины закрыты водителю: их делает парк." sim="то же ограничение оставлено, чтобы вы знали, к кому идти с этим вопросом." />
    </>;
  }

  // ── подготовка к заказам ────────────────────────────────────────────
  if (view === "diagnostics") {
    const steps = [
      { key: "photo", title: "Пройдите фотоконтроль", done: photoDone, to: "photo" },
      { key: "car", title: "Заполните информацию о машине", done: !!car && car.status === "available", to: "cars" },
      { key: "tariffs", title: "Включите хотя бы один тариф", done: !!d.tariffs.length, to: "tariffs" },
      { key: "payment", title: "Выберите способ оплаты", done: true, to: "payment" },
    ];
    const nextStep = steps.find(x => !x.done);
    return <>
      {bigHead("Завершите подготовку к заказам")}
      <button className="dp-help-link" type="button" onClick={() => go("license")}>Помощь <span aria-hidden="true">›</span></button>
      <p className="driver-muted">Совсем скоро вы сможете выйти на линию и получить первые заказы.</p>
      <div className="dp-card dp-card--flat">{steps.map(x => <button className="dp-check" type="button" key={x.key} data-done={x.done} data-now={x === nextStep} onClick={() => go(x.to)}>
        <i aria-hidden="true">{x.done ? "✓" : x === nextStep ? "" : "·"}</i>
        <span>{x.title}</span>
        {x === nextStep && <em className="dp-check-go" aria-hidden="true">›</em>}
      </button>)}</div>
      <div className="dp-bottom"><DAction label={nextStep ? "Далее" : "Перейти к заказам"} busy={busy} onClick={() => go(nextStep ? nextStep.to : "orders")} readyNote={nextStep ? `Следующий шаг: ${nextStep.title.toLowerCase()}.` : "Всё готово — можно выходить на линию."} /></div>
    </>;
  }

  // ── фотоконтроль ────────────────────────────────────────────────────
  if (view === "photo") {
    const index = d.photo_steps.length;
    return <>
      {head("Фотоконтроль")}
      <div className="dp-bar">{photoDone ? "Проверка пройдена" : "Блокирует работу"}</div>
      <div className="dp-card dp-card--flat">{PHOTO_STEPS.map((title, i) => <div className="dp-row" key={title}>
        <span className="dp-status" data-tone={i < index ? "done" : i === index && !photoDone ? "danger" : "idle"}>{i < index ? "✓" : i === index && !photoDone ? "✕" : i + 1}</span>
        <div><strong>{title}</strong><small data-tone={i < index ? undefined : i === index && !photoDone ? "danger" : undefined}>{i < index ? "Пройдено" : i === index && !photoDone ? "Не пройдено" : "Ожидает"}</small></div>
      </div>)}</div>
      {photoDone ? <>
        <DChoice arrow onClick={() => go("orders")}>Перейти к заказам</DChoice>
        <DChoice disabled={busy} onClick={() => act("photo_restart")}>Пройти фотоконтроль ещё раз</DChoice>
      </> : index < PHOTO_STEPS.length ? <>
        <h2 className="dp-section-title">{PHOTO_STEPS[index]}</h2>
        <div className="ds-photo-frame">{preview ? <img src={preview} alt="Учебный снимок" /> : <span className="driver-muted">Снимок появится здесь</span>}</div>
        <label className="driver-secondary ds-file">Сделать снимок<input type="file" accept="image/*" capture="environment" onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          const reader = new FileReader(); reader.onload = () => setPreview(String(reader.result)); reader.readAsDataURL(file);
        }} /></label>
        <DAction label={preview ? "Снимок подходит · Далее" : "Использовать учебный пример"} busy={busy}
          onClick={() => { act("photo_step", { step: index }); setPreview(null); }}
          readyNote={preview ? `Ракурс ${index + 1} из ${PHOTO_STEPS.length} будет засчитан.` : "Камера не нужна: пример засчитается как этот ракурс."} />
      </> : <DAction label="Отправить учебную проверку" busy={busy} busyLabel="Отправляем…" onClick={() => act("photo_submit")} readyNote="Пять ракурсов готовы. Проверка пройдёт мгновенно, снимки на сервер не уходят." />}
      <DExplain real="фотоконтроль проверяет человек или автоматика, до результата заказы не приходят." sim="снимки остаются в браузере и не загружаются: проверка засчитывается сразу." />
    </>;
  }

  // ── о вас ───────────────────────────────────────────────────────────
  if (view === "about") return <>
    {bigHead("О вас")}
    <div className="dp-card dp-card--flat">{row("Парк", { icon: "taxi", note: parkName, onClick: () => go("park") })}</div>
    <div className="dp-card dp-card--flat">
      {row("Карточка качества", { icon: "chart", onClick: () => go("rating") })}
      {row("Моё задание и результат смены", { icon: "info", onClick: () => go("shift-result") })}
    </div>
    <div className="dp-card dp-card--flat">
      {row("Имя в тренажёре", { value: fullName })}
      {row("Профиль создан", { value: state.profile ? dateTime(state.profile.created_at) : "—" })}
    </div>
    <DExplain real="здесь же меняется фотография профиля и настройки аккаунта." sim="учебный профиль берётся из Puls: имя и парк меняет руководитель." />
    <div className="dp-bottom"><Link className="dp-bottom-button" to="/training/city?district=driver">Выйти из симулятора</Link></div>
  </>;

  // ── остальные экраны профиля ────────────────────────────────────────
  if (view === "garage") return <>{head("Гараж")}
    {[{ id: "elantra", name: "Hyundai Elantra", price: 14000 }, { id: "emgrand", name: "Geely Emgrand", price: 12000 }, { id: "sonata", name: "Hyundai Sonata", price: 18000 }].map((x, i) => <DCard key={x.id} title={x.name}>
      <CarArt color={["#a6bbc8", "#d1c8bb", "#b6b8c2"][i]} />
      <DRow title="Учебная аренда в сутки" value={money(x.price)} />
      {d.rentals.some(r => r.car === x.id) ? <p className="ds-success">✓ Учебная заявка принята</p> : <DForm busy={busy} label="Оставить учебную заявку" onSubmit={values => act("rental", { ...values, id: x.id })}><DInput label="Как к вам обращаться" name="contact" value={fullName} /></DForm>}
    </DCard>)}
    <DExplain real="заявка уходит в парк, с вами связывается менеджер и подписывается договор аренды." sim="заявка остаётся внутри тренажёра: никто не звонит, деньги не списываются." />
  </>;

  if (view === "fuel") return <>{head("Заправки")}
    <DCard title="Заправка">
      <DRow title="АИ-92 · учебная АЗС" value="245 ₸/л" />
      <DRow title="Доступно" value={money(d.available)} />
      <DForm busy={busy} label="Оплатить из учебного баланса" onSubmit={values => act("refuel", values)}><DInput label="Количество литров" name="liters" type="number" min={1} max={80} value={10} /></DForm>
      <DRow title="Пополнить баланс" onClick={() => go("money")} />
    </DCard>
    <DCard title="История заправок">{d.fuel.length ? d.fuel.map((x, i) => <DRow key={i} title={`${x.liters} л`} value={money(x.amount)} note={dateTime(x.at)} />) : <p>После заправки операция появится здесь и в разделе «Деньги».</p>}</DCard>
    <DExplain real="оплата проходит с баланса в парке, топливо наливают на выбранной колонке." sim="сумма уходит из учебного баланса и появляется в истории операций. Настоящей заправки нет." />
  </>;

  if (view === "benefits" || view === "offers") return <>{head("Предложения")}
    <div className="dp-card dp-card--flat">
      {row("Бонус в учебном городе", { note: "Промокод PULS500 · один раз за смену", value: "500 ₸", onClick: () => go("promo") })}
      {row("Цель смены", { note: "Выполняйте заказы, затем откройте разбор", value: `${d.completed}/${c.target_orders}`, onClick: () => go("shift-result") })}
      {row("Привилегии уровня", { note: level.benefits, value: level.name, onClick: () => go("levels") })}
    </div>
  </>;

  if (view === "promo") return <>{head("Промокоды")}
    <DCard title="Учебный промокод">
      <p>Введите PULS500, чтобы увидеть начисление бонуса в операциях.</p>
      <DForm busy={busy} label="Применить" onSubmit={values => act("promo", values)}><DInput label="Промокод" name="code" /></DForm>
      {d.promos.map(x => <p className="ds-success" key={x}>✓ {x} использован · +500 ₸</p>)}
    </DCard>
    <DExplain real="промокод меняет условия заказов и бонусов по реальным правилам парка." sim="код PULS500 нужен, чтобы увидеть начисление бонуса в разделе «Деньги»." />
  </>;

  if (view === "invite") {
    const code = `PULS-${shift.id.slice(0, 6).toUpperCase()}`;
    return <>{head("Пригласить водителя")}
      <DCard title="Ваш учебный код">
        <strong className="ds-big">{code}</strong>
        <DAction label={copied ? "Код скопирован" : "Скопировать код"} onClick={() => { setCopyFailed(false); void Promise.resolve().then(() => navigator.clipboard.writeText(code)).then(() => setCopied(true)).catch(() => { setCopied(false); setCopyFailed(true); }); }} readyNote="Код скопируется в буфер обмена." />
        {copyFailed && <p role="alert">Скопируйте код вручную: браузер не дал доступ к буферу обмена.</p>}
      </DCard>
      <DExplain real="по вашей ссылке новый водитель регистрируется в парке, а вам начисляется вознаграждение." sim="код можно скопировать, но приглашения не отправляются и вознаграждение не начисляется." />
    </>;
  }

  if (view === "learning") return <>{head("Обучение")}
    {lessons.map(x => <DCard key={x.id} title={x.title}>
      <p>{x.text}</p>
      <DChoice disabled={busy || d.lessons.includes(x.id)} onClick={() => act("learning", { id: x.id })}>{d.lessons.includes(x.id) ? "✓ Изучено" : "Материал изучен"}</DChoice>
    </DCard>)}
  </>;

  if (view === "legal") return <>{head("Юридические документы")}
    <div className="dp-card dp-card--flat">
      {row("Провайдер документооборота", { value: d.provider ?? "Выбрать", onClick: () => go("provider") })}
      {row("Закрывающие документы", { value: `${d.documents.filter(x => x.status === "signed").length}/${d.documents.length}`, onClick: () => go("documents") })}
    </div>
    <p className="driver-muted">Учебные документы: подпись демонстрирует процесс и не создаёт юридических обязательств.</p>
  </>;

  if (view === "provider") return <>{head("Документооборот")}
    <div className="dp-sheet-group">{["Sapar", "ЦНТ", "Payda", "Бумажный документооборот"].map(value => <button className="dp-pick" type="button" key={value} aria-pressed={value === d.provider} disabled={busy} onClick={() => act("provider", { value })}>
      <div><strong>{value}</strong></div><u aria-hidden="true">✓</u>
    </button>)}</div>
    <DChoice arrow onClick={() => go("documents")}>Открыть документы</DChoice>
  </>;

  if (view === "documents") return <>{head("Закрывающие документы")}
    {d.documents.map(x => <DCard key={x.id} title={x.title}>
      <DRow title="Период" value={x.period} />
      <DRow title="Провайдер" value={d.provider ?? "Не выбран"} onClick={() => go("provider")} />
      <p>Учебный акт: выполнено заказов — {d.completed}. Суммы и комиссии доступны в истории операций этой смены.</p>
      {x.signed_at ? <p className="ds-success">✓ Подписано в тренажёре · {dateTime(x.signed_at)}</p> : <>
        <DAction label="Подписать учебный документ" busy={busy} busyLabel="Подписываем…" onClick={() => act("doc_sign", { id: x.id })} readyNote="Подпись отметит пункт задания «Юридические документы»." />
        <DExplain real="акт подписывается электронной подписью через оператора ЭДО и имеет юридическую силу." sim="подпись показывает порядок действий и никаких обязательств не создаёт." />
      </>}
    </DCard>)}
  </>;

  if (view === "settings") return <>{head("Настройки")}
    <DCard title="Внешний вид">
      <div className="ds-segments">{[["dark", "Тёмная"], ["light", "Светлая"], ["system", "Система"]].map(([value, title]) => <button key={value} type="button" disabled={busy} aria-pressed={d.settings.theme === value} onClick={() => act("setting", { key: "theme", value })}>{title}</button>)}</div>
      <DToggle title="Скрывать доход на главных экранах" checked={d.settings.hide_income} disabled={busy} onChange={() => act("setting", { key: "hide_income", value: !d.settings.hide_income })} />
      <DToggle title="Показывать виджеты на карте" checked={d.settings.widgets} disabled={busy} onChange={() => act("setting", { key: "widgets", value: !d.settings.widgets })} />
    </DCard>
    <DCard title="Звук и вибрация">
      <DToggle title="Вибрация при новом заказе" checked={d.settings.vibration} disabled={busy} onChange={() => act("setting", { key: "vibration", value: !d.settings.vibration })} />
    </DCard>
    <DCard title="Помощь в заказе">
      <DToggle title="Подтверждать прибытие автоматически" checked={d.settings.auto_arrive} disabled={busy} onChange={() => act("setting", { key: "auto_arrive", value: !d.settings.auto_arrive })} />
      <DToggle title="Начинать поездку автоматически" checked={d.settings.auto_start} disabled={busy} onChange={() => act("setting", { key: "auto_start", value: !d.settings.auto_start })} />
    </DCard>
    <DChoice arrow onClick={() => go("orders")}>Открыть карту и разрешения</DChoice>
  </>;

  if (view === "privacy") return <>{head("Конфиденциальность")}
    <DCard title="Данные учебной смены">
      <p>Puls сохраняет действия, результаты, учебные операции и обращение в поддержку. Текущая геопозиция обновляется в памяти открытого симулятора. При создании заказа она передаётся для проверки близости; в заказе сохраняется только точка подачи А. История передвижений не создаётся.</p>
      <p>Карта загружается из OpenStreetMap: сервис получает запросы на плитки и адреса.</p>
      <p>Согласие на геолокацию запоминается в браузере, чтобы не спрашивать при каждом входе. Сами координаты там не хранятся.</p>
    </DCard>
  </>;

  return <>{head("Правила тренажёра")}
    <DCard title="Driver Simulator">
      <p>Учебная среда Puls. Она воспроизводит последовательность работы водителя на основе предоставленных примеров. Все поездки, суммы, статусы и документы относятся к тренировке.</p>
      <p>Регион, комиссии, тарифы и правила оценки определяются сценарием руководителя. В свободном режиме штрафы не применяются. В зачётной смене действия, подсказки и ошибки входят в итоговый разбор.</p>
    </DCard>
  </>;
  })();

  return <div className="dp-swipe du-screen" key={view === "payment" ? "profile" : view} data-dragging={dragging} style={{ transform: offset ? `translateX(${offset}px)` : "none" } as CSSProperties}>{body}</div>;
}
