import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { OKTELL_QUERY, oktell, type OktellAction, type OktellCommand, type OktellScreen, type PauseReason } from "../../api/oktell";
import { useAuth } from "../../auth/AuthContext";
import { Sheet } from "../../components/Sheet";
import { useGuide } from "../../guide";
import { PulsarFace } from "../crm/PulsarGuide";
import "./oktell.css";

const SCREENS: { id: OktellScreen; title: string; icon: string }[] = [
  { id: "phone", title: "Телефон", icon: "phone" }, { id: "cabinet", title: "Кабинет", icon: "headset" },
  { id: "messages", title: "Сообщения", icon: "message" }, { id: "journal", title: "Журнал", icon: "book" },
];
const PAUSES: { id: PauseReason; title: string }[] = [
  { id: "technical", title: "Тех. причина" }, { id: "callback", title: "Перезвон" }, { id: "training", title: "Тренинг" }, { id: "break", title: "Перерыв" },
];
const OFFICE = { available: "На связи", forward: "Переадресация", dnd: "Не беспокоить" };
const CONTACT_STATUS = { available: "На связи", busy: "Занят", offline: "Не в сети" };
const HELP: Record<OktellScreen, { title: string; steps: string[] }> = {
  cabinet: { title: "Начало и завершение работы", steps: ["Вход в Oktell и вход в call-центр — два отдельных действия. После учебного входа нажмите «Войти в call-центр».", "Нажмите на статус внизу меню. Здесь находятся режимы call-центра, причины паузы и настройки веб-телефона.", "Для первого задания включите автоматический режим и веб-телефон. Для завершения смены попробуйте перерыв, вернитесь к работе и выйдите из call-центра."] },
  phone: { title: "Поиск сотрудника и учебный звонок", steps: ["Найдите коллегу по имени, внутреннему номеру или отделу. Все контакты в тренажёре вымышленные.", "Войдите в call-центр, включите веб-телефон и вернитесь к работе из паузы. Выберите доступного коллегу и нажмите «Позвонить».", "Завершите учебный звонок. Затем откройте журнал и сохраните комментарий к звонку. Тренажёр проверяет действия с интерфейсом; сценарий разговора в исходном материале не задан."] },
  messages: { title: "Личное сообщение", steps: ["Нажмите «Новый диалог» и найдите получателя по имени или номеру.", "Выберите учебного супервайзера, введите сообщение и нажмите «Написать». Можно использовать Ctrl+Enter или ⌘+Enter.", "Сообщение появится в истории выбранного диалога. Отправка работает только внутри тренажёра."] },
  journal: { title: "Мои звонки", steps: ["В журнал попадают завершённые учебные звонки. Фильтры позволяют искать по номеру, имени, отделу, комментарию, тегу и дате.", "Откройте нужный звонок, добавьте комментарий и при необходимости теги через запятую. Нажмите «Сохранить».", "Если список пуст, сбросьте фильтры или сделайте первый звонок в разделе «Телефон»."] },
};

function Icon({ name }: { name: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "phone" ? <path d="m5 3 4 4-2 3c2 3 4 5 7 7l3-2 4 4c-1 3-4 3-7 2C8 19 4 15 3 9c-1-3-1-5 2-6Z" />
      : name === "headset" ? <><path d="M4 14v-3a8 8 0 0 1 16 0v3M20 15v2c0 3-3 4-6 4" /><rect x="2" y="11" width="4" height="7" rx="2" /><rect x="18" y="11" width="4" height="7" rx="2" /></>
        : name === "message" ? <path d="M20 4H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4v4l5-4h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" />
          : <><rect x="5" y="3" width="15" height="18" rx="1" /><path d="M3 6h4M3 10h4M3 14h4M3 18h4M11 8h5M11 12h5M11 16h3" /></>}
  </svg>;
}
function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function time(value: string) { return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function day(value: string) { return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
function dateInput(value: string) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(n => n[0]).join(""); }
function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="oktell-panel"><header className="oktell-panel-head"><h2>{title}</h2>{action}</header>{children}</section>;
}

/** A separate training cabinet: commands never dial or send messages outside Puls. */
export function OktellSite({ screen, go, helpRequest, active = true }: { screen: OktellScreen; go: (screen: OktellScreen) => void; helpRequest: number; active?: boolean }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const mentor = useGuide();
  const queryKey = [...OKTELL_QUERY, user?.id] as const;
  const query = useQuery({ queryKey, queryFn: ({ signal }) => oktell.state(signal), enabled: active && !!user, refetchInterval: q => active && !!user && q.state.data?.logged_in && q.state.data?.center_joined ? 20000 : false });
  const [dialog, setDialog] = useState<"status" | "help" | "reset" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState<{ command: OktellCommand; message: string; success: string; after?: () => void } | null>(null);
  const [login, setLogin] = useState(""), [password, setPassword] = useState("");
  const [phoneSearch, setPhoneSearch] = useState(""), [contactId, setContactId] = useState("");
  const [recipientSearch, setRecipientSearch] = useState(""), [recipientId, setRecipientId] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [callSearch, setCallSearch] = useState(""), [noteSearch, setNoteSearch] = useState(""), [callDate, setCallDate] = useState("");
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { comment: string; tags: string }>>({});
  const [forward, setForward] = useState("");
  const [now, setNow] = useState(Date.now());
  const sending = useRef(false);
  const mounted = useRef(true), activeRef = useRef(active), goRef = useRef(go), lastHelpRequest = useRef(0);
  activeRef.current = active;
  goRef.current = go;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!active) setDialog(null); }, [active]);
  useEffect(() => {
    if (helpRequest !== lastHelpRequest.current && helpRequest && active) setDialog("help");
    lastHelpRequest.current = helpRequest;
  }, [helpRequest, active]);
  useEffect(() => {
    if (!active || !query.data?.active_call) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, query.data?.active_call?.id]);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(""), 6000); return () => window.clearTimeout(timer); }, [feedback]);
  const mutation = useMutation({
    mutationFn: (command: OktellCommand) => {
      // A scheduled retry must not read another account's token after this page closes.
      if (!mounted.current) throw new DOMException("Учебный кабинет закрыт", "AbortError");
      return oktell.action(command);
    },
    onMutate: () => client.cancelQueries({ queryKey }),
    retry: (count, error) => mounted.current && count < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 4000),
    onSuccess: state => {
      if (!mounted.current) return;
      client.setQueryData(queryKey, state);
      void client.invalidateQueries({ queryKey: ["city"] });
      setFailed(null);
    },
  });
  const pending = mutation.isPending;
  async function execute(command: OktellCommand, success: string, after?: () => void) {
    if (sending.current || !mounted.current) return;
    sending.current = true;
    setFailed(null);
    try {
      await mutation.mutateAsync(command);
      if (mounted.current) { setFeedback(success); after?.(); }
    }
    catch (error) { if (mounted.current) setFailed({ command, success, after, message: error instanceof Error ? error.message : "Не удалось сохранить действие. Повторите попытку." }); }
    finally { sending.current = false; }
  }
  function run(action: OktellAction, success: string, after?: () => void) {
    return execute({ ...action, request_id: crypto.randomUUID() }, success, after);
  }
  const state = query.data;
  const contact = state?.contacts.find(c => c.id === contactId);
  const recipient = state?.contacts.find(c => c.id === recipientId);
  const pause = PAUSES.find(p => p.id === state?.pause_reason)?.title;
  const status = !state?.logged_in ? "Вход не выполнен" : state.pause_reason ? pause : state.center_joined ? "В call-центре" : OFFICE[state.office_status];
  const phoneList = (state?.contacts ?? []).filter(c => `${c.name} ${c.number} ${c.department}`.toLocaleLowerCase("ru").includes(phoneSearch.trim().toLocaleLowerCase("ru")));
  const recipientList = (state?.contacts ?? []).filter(c => `${c.name} ${c.number} ${c.department}`.toLocaleLowerCase("ru").includes(recipientSearch.trim().toLocaleLowerCase("ru")));
  const filteredCalls = (state?.calls ?? []).filter(c =>
    `${c.number} ${c.name} ${c.department}`.toLocaleLowerCase("ru").includes(callSearch.trim().toLocaleLowerCase("ru")) &&
    `${c.comment} ${c.tags.join(" ")}`.toLocaleLowerCase("ru").includes(noteSearch.trim().toLocaleLowerCase("ru")) &&
    (!callDate || dateInput(c.started_at) === callDate),
  );
  const completed = state?.exercises.filter(e => e.done).length ?? 0;
  function navigate(target: OktellScreen) { if (!mounted.current || !activeRef.current) return; setDialog(null); goRef.current(target); }
  function form(event: FormEvent, action: OktellAction, success: string, after?: () => void) { event.preventDefault(); void run(action, success, after); }
  const alerts = <>
    {failed && <div className="oktell-error" role="alert"><span>{failed.message}</span><button className="oktell-btn" disabled={pending} onClick={() => void execute(failed.command, failed.success, failed.after)}>Повторить действие</button></div>}
    {feedback && <div className="oktell-feedback" role="status">{feedback}</div>}
    {pending && <p className="oktell-saving" role="status">Сохраняем действие…</p>}
  </>;

  if (query.isPending) return <div className="oktell oktell-loading" role="status"><span className="oktell-wordmark">Oktell</span><p>Открываем учебный кабинет…</p></div>;
  if (query.isError || !state) return <div className="oktell oktell-loading" role="alert"><span className="oktell-wordmark">Oktell</span><p>{query.error?.message ?? "Кабинет недоступен"}</p><button className="oktell-btn" onClick={() => query.refetch()}>Повторить</button></div>;

  const guide = <aside className="oktell-guide" aria-label="Учебные задания">
    <header><PulsarFace mood={completed === state.exercises.length ? "cheer" : "point"} /><div><strong>{mentor.text("Пульсар рядом")}</strong><span>{completed} из {state.exercises.length} заданий выполнено</span></div></header>
    <p>Освойте основные экраны Oktell. Звонки и сообщения остаются в учебном кабинете.</p>
    <button className="oktell-btn" onClick={() => setDialog("help")}>Помощь по этому экрану</button>
    <h2>Мои задачи</h2><ol>{state.exercises.map(exercise => <li key={exercise.id} className={exercise.done ? "is-done" : ""}>
      <button onClick={() => navigate(exercise.screen)}><span className="oktell-task-check" aria-hidden="true">{exercise.done ? "✓" : "○"}</span><span><strong>{exercise.title}</strong><small>{exercise.description}</small><em>{exercise.done ? "Выполнено" : "Открыть задание"}</em></span></button>
    </li>)}</ol>
    <p className="oktell-source-note">По экранам из материала «Октелл». Правила работы и выбора статусов уточняйте у руководителя.</p>
    <button className="oktell-text-btn" disabled={pending || !!state.active_call} onClick={() => setDialog("reset")}>Начать практику заново</button>
  </aside>;

  return <div className="oktell" data-screen={screen}>
    {!state.logged_in ? <div className="oktell-login-layout">
      <section className="oktell-login"><span className="oktell-wordmark"><i aria-hidden="true" />Oktell</span><h1>Вход в учебный кабинет</h1><p className="oktell-muted">Личный кабинет оператора</p>{alerts}
        <form onSubmit={e => form(e, { action: "login", login, password }, "Вы вошли в Oktell", () => { setPassword(""); navigate("cabinet"); })}>
          <label>Логин<input name="oktell-login" value={login} onChange={e => setLogin(e.target.value)} autoComplete="off" required maxLength={80} disabled={pending} /></label>
          <label>Пароль<input name="oktell-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" required maxLength={100} disabled={pending} /></label>
          <button className="oktell-btn oktell-btn--green" disabled={pending} type="submit">{pending ? "Входим…" : "Войти"}</button>
        </form>
        <div className="oktell-demo-credentials"><strong>Данные для тренировки</strong><span>Логин: <code>{state.demo_credentials.login}</code> · Пароль: <code>{state.demo_credentials.password}</code></span><button className="oktell-text-btn" disabled={pending} onClick={() => { setLogin(state.demo_credentials.login); setPassword(state.demo_credentials.password); }}>Подставить учебные данные</button></div>
        <p className="oktell-muted oktell-login-note">В рабочем Oktell данные выдаёт администратор. Если вы забыли рабочий пароль, обратитесь к системному администратору.</p>
      </section>{guide}
    </div> : <>
      <nav className="oktell-sidebar" aria-label="Разделы Oktell"><span className="oktell-sidebar-logo"><i aria-hidden="true" /><span>Okapp</span></span>
        <div className="oktell-nav-items">{SCREENS.map(item => <button key={item.id} className={screen === item.id ? "is-active" : ""} aria-current={screen === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.title}</span></button>)}</div>
        <button className={`oktell-status${state.pause_reason ? " is-paused" : ""}`} aria-label={`Режимы и статусы: ${status}`} aria-haspopup="dialog" aria-expanded={dialog === "status"} onClick={() => { setForward(state.forward_number || ""); setDialog("status"); }}><span className="oktell-operator-badge">{initials(state.operator.name)}</span><span className="oktell-status-text"><strong>{state.operator.number}</strong><small>{status}</small></span><span aria-hidden="true">▸</span></button>
      </nav>
      <div className="oktell-body"><header className="oktell-topbar"><span><strong>{SCREENS.find(item => item.id === screen)?.title}</strong><small>Учебный Oktell</small></span><span className="oktell-current-operator">{state.operator.name} · {state.operator.number}</span></header>
        <div className="oktell-alerts">{alerts}</div>
        <div className="oktell-workspace"><main className="oktell-main">
          {screen === "cabinet" && <Panel title="Показатели" action={<button className="oktell-btn" disabled={query.isFetching} onClick={() => query.refetch()}>{query.isFetching ? "Обновляем…" : "↻ Обновить"}</button>}>
            <div className={`oktell-work-status${state.pause_reason ? " is-paused" : ""}`}><div><span>{state.pause_reason ? "В перерыве" : state.center_joined ? "Готов к работе" : "Вне call-центра"}</span><strong>{state.pause_reason ? pause : OFFICE[state.office_status]}</strong></div>
              {state.pause_reason ? <button className="oktell-btn oktell-btn--green" disabled={pending} onClick={() => void run({ action: "resume" }, "Вы вернулись к работе")}>Вернуться к работе</button> : <button className="oktell-btn" onClick={() => { setForward(state.forward_number || ""); setDialog("status"); }}>Режимы и статусы</button>}
            </div>
            <div className="oktell-center-row"><div><span>В call-центре</span><strong>{duration(state.metrics.center_seconds)}</strong></div><button className={`oktell-btn${state.center_joined ? "" : " oktell-btn--green"}`} disabled={pending || !!state.active_call} onClick={() => void run({ action: state.center_joined ? "leave" : "join" }, state.center_joined ? "Вы вышли из call-центра" : "Вы вошли в call-центр")}>{state.center_joined ? "Выйти из call-центра" : "Войти в call-центр"}</button></div>
            {state.active_call && <div className="oktell-inline-notice">Идёт звонок с {state.active_call.name}. <button className="oktell-text-btn" onClick={() => navigate("phone")}>Открыть телефон</button></div>}
            <div className="oktell-metrics">{[
              ["В перерыве", duration(state.metrics.break_seconds)], ["В разговоре", duration(state.metrics.talk_seconds)],
              ["Занятость", duration(state.metrics.busy_seconds)], ["Звонков", String(state.metrics.calls)], ["Успешных", String(state.metrics.successful)],
              ["Режим", state.center_mode === "automatic" ? "Автоматический" : "Ручной"],
            ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <div className="oktell-cabinet-footer"><span>{state.web_phone ? "Веб-телефон включён" : "Веб-телефон выключен"} · {state.auto_answer ? "Автоответ включён" : "Автоответ выключен"}</span><button className="oktell-text-btn" disabled={pending || !!state.active_call} onClick={() => void run({ action: "logout" }, "Вы вышли из Oktell", () => setPassword(""))}>Выйти из Oktell</button></div>
          </Panel>}

          {screen === "phone" && <Panel title="Телефон"><div className="oktell-split">
            <section className="oktell-directory" aria-label="Справочник сотрудников"><label className="oktell-search-label">Поиск сотрудника<input type="search" value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)} placeholder="Введите имя, номер или отдел" /></label><div className="oktell-contact-list">{phoneList.map(c => <button key={c.id} className={contactId === c.id ? "is-selected" : ""} aria-pressed={contactId === c.id} onClick={() => setContactId(c.id)}><span className={`oktell-contact-dot is-${c.status}`} aria-hidden="true" /><span><strong>{c.name}</strong><small>{c.department} · {CONTACT_STATUS[c.status]}</small></span><em>{c.number}</em></button>)}{!phoneList.length && <p className="oktell-empty">Сотрудник не найден. Попробуйте другое имя или номер.</p>}</div></section>
            <section className="oktell-phone-card" aria-label="Учебный звонок">{state.active_call ? <><span className="oktell-call-label">Учебный разговор</span><span className="oktell-contact-avatar">{initials(state.active_call.name)}</span><h3>{state.active_call.name}</h3><p>{state.active_call.number}</p><strong className="oktell-call-timer">{duration((now - new Date(state.active_call.started_at).getTime()) / 1000)}</strong><button className="oktell-btn oktell-btn--red" disabled={pending} onClick={() => void run({ action: "call_end" }, "Звонок завершён. Добавьте комментарий в журнале.")}>Завершить звонок</button></>
              : contact ? <><span className="oktell-contact-avatar">{initials(contact.name)}</span><h3>{contact.name}</h3><p>{contact.department} · {contact.number}</p><span className="oktell-muted">{CONTACT_STATUS[contact.status]}</span><button className="oktell-btn oktell-btn--green" disabled={pending || !state.center_joined || !state.web_phone || !!state.pause_reason || state.office_status !== "available" || contact.status !== "available"} onClick={() => void run({ action: "call_start", contact_id: contact.id }, "Учебный звонок начат")}>Позвонить</button>{(!state.center_joined || !state.web_phone || state.pause_reason || state.office_status !== "available") && <p className="oktell-inline-notice">Для звонка войдите в call-центр, выберите «На связи», включите веб-телефон и вернитесь к работе. <button className="oktell-text-btn" onClick={() => navigate("cabinet")}>Открыть кабинет</button></p>}</>
                : <div className="oktell-empty"><Icon name="phone" /><h3>Выберите сотрудника</h3><p>Найдите контакт в справочнике и попробуйте учебный звонок.</p></div>}</section>
          </div></Panel>}

          {screen === "messages" && <Panel title="Сообщения"><div className="oktell-split oktell-split--messages">
            <section className="oktell-directory" aria-label="Диалоги"><div className="oktell-directory-head"><h3>Диалоги</h3><button className="oktell-btn" onClick={() => { setRecipientId(""); setRecipientSearch(""); }}>Новый диалог</button></div><label className="oktell-search-label">Поиск получателя<input type="search" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)} placeholder="Поиск по сотрудникам" /></label><div className="oktell-contact-list">{recipientList.map(c => <button key={c.id} className={recipientId === c.id ? "is-selected" : ""} aria-pressed={recipientId === c.id} onClick={() => setRecipientId(c.id)}><span className={`oktell-contact-dot is-${c.status}`} aria-hidden="true" /><span><strong>{c.name}</strong><small>{c.department} · {c.number}</small></span>{state.messages.some(m => m.contact_id === c.id) && <em aria-label="Есть сообщения">●</em>}</button>)}{!recipientList.length && <p className="oktell-empty">Получатель не найден.</p>}</div></section>
            <section className="oktell-conversation" aria-label="Личное сообщение"><header><h3>{recipient?.name ?? "Новый диалог"}</h3><span>{recipient ? `${recipient.department} · ${recipient.number}` : "Выберите получателя слева"}</span><small>Личное сообщение</small></header>
              <div className="oktell-message-history" aria-label="История сообщений">{recipient ? <>{state.messages.filter(m => m.contact_id === recipient.id).map(m => <article key={m.id} className="oktell-message"><span>Вы · {day(m.sent_at)}, {time(m.sent_at)}</span><p>{m.text}</p></article>)}{!state.messages.some(m => m.contact_id === recipient.id) && <p className="oktell-empty">Здесь появится история вашего диалога.</p>}</> : <p className="oktell-empty">Для задания найдите учебного супервайзера в списке сотрудников.</p>}</div>
              <form className="oktell-message-form" onSubmit={e => { if (!recipient) { e.preventDefault(); return; } form(e, { action: "message", contact_id: recipient.id, text: messages[recipient.id] ?? "" }, "Учебное сообщение отправлено", () => setMessages(previous => previous[recipient.id] === messages[recipient.id] ? { ...previous, [recipient.id]: "" } : previous)); }}>
                <label>Сообщение<textarea value={recipient ? messages[recipient.id] ?? "" : ""} onChange={e => recipient && setMessages(previous => ({ ...previous, [recipient.id]: e.target.value }))} placeholder={recipient ? "Введите сообщение…" : "Сначала выберите получателя"} disabled={!recipient || pending} required maxLength={2000} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /></label><div><span>Ctrl+Enter / ⌘+Enter</span><button className="oktell-btn oktell-btn--green" type="submit" disabled={!recipient || pending || !messages[recipient.id]?.trim()}>Написать</button></div>
              </form></section>
          </div></Panel>}

          {screen === "journal" && <Panel title="Мои звонки"><div className="oktell-journal-filters"><label>Номер, имя или отдел<input type="search" value={callSearch} onChange={e => setCallSearch(e.target.value)} placeholder="Поиск звонка" /></label><label>Комментарий или тег<input type="search" value={noteSearch} onChange={e => setNoteSearch(e.target.value)} placeholder="Поиск по заметкам" /></label><label>Дата<input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} /></label><button className="oktell-btn" onClick={() => { setCallSearch(""); setNoteSearch(""); setCallDate(""); }}>Сбросить</button></div>
            <div className="oktell-call-list">{filteredCalls.map(call => <article key={call.id} className="oktell-call-entry"><button className="oktell-call-heading" aria-expanded={expandedCall === call.id} aria-controls={`oktell-note-${call.id}`} onClick={() => { setExpandedCall(previous => previous === call.id ? null : call.id); setNotes(previous => previous[call.id] ? previous : { ...previous, [call.id]: { comment: call.comment, tags: call.tags.join(", ") } }); }}><span className="oktell-call-direction" aria-label={call.direction === "outbound" ? "Исходящий звонок" : "Входящий звонок"}>{call.direction === "outbound" ? "↗" : "↙"}</span><span><strong>{call.name} · {call.number}</strong><small>{day(call.started_at)}, {time(call.started_at)} · {call.department}</small><em>{call.comment || "Без комментария"}{call.tags.length ? ` · ${call.tags.map(tag => `#${tag}`).join(" ")}` : ""}</em></span><span className="oktell-call-length">{duration(call.duration_seconds)}<small>{expandedCall === call.id ? "Свернуть" : "Комментарий"}</small></span></button>
              {expandedCall === call.id && <form id={`oktell-note-${call.id}`} className="oktell-call-note" onSubmit={e => form(e, { action: "call_comment", call_id: call.id, comment: notes[call.id]?.comment ?? "", tags: (notes[call.id]?.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean) }, "Комментарий к звонку сохранён")}><label>Комментарий<textarea value={notes[call.id]?.comment ?? ""} onChange={e => setNotes(previous => ({ ...previous, [call.id]: { ...previous[call.id], comment: e.target.value } }))} maxLength={2000} required disabled={pending} /></label><label>Теги через запятую<input value={notes[call.id]?.tags ?? ""} onChange={e => setNotes(previous => ({ ...previous, [call.id]: { ...previous[call.id], tags: e.target.value } }))} placeholder="Например: учебный звонок, помощь" maxLength={200} disabled={pending} /></label><button className="oktell-btn oktell-btn--green" type="submit" disabled={pending || !notes[call.id]?.comment.trim()}>Сохранить</button></form>}
            </article>)}{!filteredCalls.length && <div className="oktell-empty"><Icon name="book" /><h3>{state.calls.length ? "Звонки не найдены" : "В журнале пока нет звонков"}</h3><p>{state.calls.length ? "Измените условия поиска или сбросьте фильтры." : "Завершите учебный звонок, чтобы добавить к нему комментарий."}</p>{!state.calls.length && <button className="oktell-btn" onClick={() => navigate("phone")}>Открыть телефон</button>}</div>}</div>
          </Panel>}
        </main>{guide}</div><footer className="oktell-version">Учебная копия интерфейса · по материалу Oktell 1.0.33</footer>
      </div>
    </>}

    {active && dialog === "status" && <Sheet title="Режимы и статусы" subtitle="Oktell · настройки оператора" size="s" onClose={() => setDialog(null)}><div className="oktell-dialog">{alerts}<fieldset disabled={pending}><legend>Офисная телефония</legend><div className="oktell-status-options">{(["available", "dnd"] as const).map(value => <button key={value} className={`oktell-btn${state.office_status === value ? " is-selected" : ""}`} aria-pressed={state.office_status === value} disabled={!!state.active_call} onClick={() => void run({ action: "office_status", status: value }, `Статус: ${OFFICE[value]}`)}>{OFFICE[value]}</button>)}</div><form className="oktell-forward" onSubmit={e => form(e, { action: "office_status", status: "forward", number: forward }, "Переадресация включена")}><label>Переадресация на номер<input value={forward} onChange={e => setForward(e.target.value)} placeholder="6601–6604" list="oktell-forward-contacts" inputMode="numeric" required minLength={3} maxLength={20} pattern="[0-9]+" disabled={!!state.active_call} /></label><datalist id="oktell-forward-contacts">{state.contacts.map(c => <option key={c.id} value={c.number}>{c.name}</option>)}</datalist><button className="oktell-btn" disabled={!!state.active_call} type="submit">{state.office_status === "forward" ? "Сохранить номер" : "Включить"}</button></form><p className="oktell-muted">Используйте внутренний номер учебного контакта: 6601–6604.</p></fieldset>
      <fieldset disabled={pending}><legend>Call-центр</legend><div className="oktell-status-options">{(["automatic", "manual"] as const).map(mode => <button key={mode} className={`oktell-btn${state.center_mode === mode ? " is-selected" : ""}`} aria-pressed={state.center_mode === mode} disabled={!!state.active_call} onClick={() => void run({ action: "center_mode", mode }, mode === "automatic" ? "Автоматический режим включён" : "Ручной режим включён")}>{mode === "automatic" ? "Автоматический режим" : "Ручной режим"}</button>)}</div><span className="oktell-muted">Причина паузы</span><div className="oktell-pause-options">{PAUSES.map(option => <button key={option.id} className={`oktell-btn${state.pause_reason === option.id ? " is-selected" : ""}`} aria-pressed={state.pause_reason === option.id} disabled={!state.center_joined || !!state.active_call} onClick={() => void run({ action: "pause", reason: option.id }, `Пауза: ${option.title}`)}>{option.title}</button>)}</div>{!state.center_joined && <p className="oktell-muted">Для паузы сначала войдите в call-центр в кабинете.</p>}{state.pause_reason && <button className="oktell-btn oktell-btn--green" onClick={() => void run({ action: "resume" }, "Вы вернулись к работе")}>Вернуться к работе</button>}</fieldset>
      <fieldset disabled={pending || !!state.active_call}><legend>Телефон</legend><label className="oktell-checkbox"><input type="checkbox" checked={state.web_phone} onChange={e => void run({ action: "phone_settings", web_phone: e.target.checked, auto_answer: state.auto_answer }, e.target.checked ? "Веб-телефон включён" : "Веб-телефон выключен")} /><span><strong>Веб-телефон</strong><small>Звонки из браузера через гарнитуру</small></span></label><label className="oktell-checkbox"><input type="checkbox" checked={state.auto_answer} onChange={e => void run({ action: "phone_settings", web_phone: state.web_phone, auto_answer: e.target.checked }, e.target.checked ? "Автоответ включён" : "Автоответ выключен")} /><span><strong>Автоответ</strong><small>Автоматически отвечать на звонки</small></span></label></fieldset><p className="oktell-muted">В тренажёре доступны только учебные звонки. Причину паузы в работе выбирают по правилам вашей команды.</p><button className="oktell-btn" onClick={() => setDialog(null)}>Готово</button></div></Sheet>}
    {active && dialog === "help" && <Sheet title={`${mentor.text("Помощь Пульсара")} · ${HELP[screen].title}`} size="m" onClose={() => setDialog(null)}><div className="oktell-dialog oktell-help"><PulsarFace mood="wave" /><p>{state.logged_in ? "Пройдём экран вместе." : `Начните с учебного входа: логин ${state.demo_credentials.login}, пароль ${state.demo_credentials.password}. Затем войдите в call-центр в кабинете.`}</p><ol>{HELP[screen].steps.map(step => <li key={step}>{step}</li>)}</ol><p className="oktell-muted">Материал содержит примеры экранов. Учебные задания помогают освоить интерфейс; порядок обслуживания и правила статусов определяет ваша команда.</p><button className="oktell-btn oktell-btn--green" onClick={() => setDialog(null)}>Продолжить практику</button></div></Sheet>}
    {active && dialog === "reset" && <Sheet title="Начать практику заново?" size="s" onClose={() => setDialog(null)}><div className="oktell-dialog">{alerts}<p>Звонки, диалоги и настройки учебного кабинета будут сброшены. Выполненные задания останутся в прогрессе обучения.</p><div className="oktell-status-options"><button className="oktell-btn" disabled={pending} onClick={() => setDialog(null)}>Отмена</button><button className="oktell-btn oktell-btn--red" disabled={pending} onClick={() => void run({ action: "reset" }, "Учебный кабинет сброшен", () => { setDialog(null); setPassword(""); setMessages({}); setNotes({}); setContactId(""); setRecipientId(""); setExpandedCall(null); navigate("cabinet"); })}>Сбросить кабинет</button></div></div></Sheet>}
  </div>;
}
