import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { OKTELL_QUERY, oktell, type OktellAction, type OktellCall, type OktellCommand, type OktellScreen, type PauseReason } from "../../api/oktell";
import { useAuth } from "../../auth/AuthContext";
import { checkDial, formatNumber, looksLikeNumber } from "./oktellDial";
import { callsBlocked, formatCaller } from "./oktellVoice";
import "./oktell.css";

const SCREENS: { id: OktellScreen; title: string; icon: string }[] = [
  { id: "phone", title: "Телефон", icon: "phone" }, { id: "cabinet", title: "Кабинет", icon: "headset" },
  { id: "messages", title: "Сообщения", icon: "message" }, { id: "journal", title: "Журнал", icon: "book" },
];
const PAUSES: { id: PauseReason; title: string }[] = [
  { id: "technical", title: "Тех.причина" }, { id: "callback", title: "Перезвон" }, { id: "training", title: "Тренинг" }, { id: "break", title: "Перерыв" },
];
const OFFICE = { available: "На связи", forward: "Переадресация", dnd: "Не беспокоить" };
const CONTACT_STATUS = { available: "Без звонка", busy: "На звонке", paused: "Пауза: тех.причина, тренинг или перерыв" };
const JOURNAL = ["Мои звонки", "Голосовая почта", "Уведомления", "Звонки коллег"] as const;
const VOICE_LANGUAGES = [{ id: "ru", title: "Русский" }, { id: "kk", title: "Қазақша" }] as const;

function Icon({ name }: { name: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "phone" ? <path d="m5 3 4 4-2 3c2 3 4 5 7 7l3-2 4 4c-1 3-4 3-7 2C8 19 4 15 3 9c-1-3-1-5 2-6Z" />
      : name === "headset" ? <><path d="M4 14v-3a8 8 0 0 1 16 0v3M20 15v2c0 3-3 4-6 4" /><rect x="2" y="11" width="4" height="7" rx="2" /><rect x="18" y="11" width="4" height="7" rx="2" /></>
        : name === "message" ? <path d="M20 4H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4v4l5-4h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" />
          : name === "coffee" ? <><path d="M4 7h12v12H4zM16 9h2a3 3 0 0 1 0 6h-2M7 3v2M11 3v2" /></>
            : name === "person" ? <><circle cx="12" cy="8" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3" /></>
              : name === "search" ? <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>
                : name === "voicemail" ? <><circle cx="6" cy="12" r="4" /><circle cx="18" cy="12" r="4" /><path d="M6 16h12" /></>
                  : name === "info" ? <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>
                    : name === "people" ? <><circle cx="9" cy="7" r="3" /><path d="M2 20v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6M18 12a6 6 0 0 1 4 6v2" /></>
                      : <><rect x="5" y="3" width="15" height="18" rx="1" /><path d="M3 6h4M3 10h4M3 14h4M3 18h4M11 8h5M11 12h5M11 16h3" /></>}
  </svg>;
}
function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function clock(seconds: number) { const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
function time(value: string) { return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function day(value: string) { return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }); }
function dateInput(value: string | Date) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(n => n[0]).join(""); }
function ContactName({ name }: { name: string }) { const [first, ...rest] = name.split(" "); return <><strong>{first}</strong>{rest.length ? ` ${rest.join(" ")}` : ""}</>; }

/** A simulated Oktell workspace matching the screens supplied in the document. */
export function OktellSite({ screen, go, active = true }: { screen: OktellScreen; go: (screen: OktellScreen) => void; active?: boolean }) {
  const client = useQueryClient(), { user } = useAuth();
  const queryKey = [...OKTELL_QUERY, user?.id] as const;
  const query = useQuery({ queryKey, queryFn: ({ signal }) => oktell.state(signal), enabled: active && !!user, refetchInterval: q => active && !!user && q.state.data?.logged_in && q.state.data?.center_joined ? 20000 : false });
  const [statusOpen, setStatusOpen] = useState(false), [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState<{ command: OktellCommand; message: string; success: string; after?: () => void } | null>(null);
  const [login, setLogin] = useState(""), [password, setPassword] = useState("");
  const rememberKey = `oktell-demo-remember:${user?.id}`;
  const [remember, setRemember] = useState(() => { try { return sessionStorage.getItem(rememberKey) === "1"; } catch { return false; } });
  const [phoneSearch, setPhoneSearch] = useState(""), [contactId, setContactId] = useState("");
  const [phoneTab, setPhoneTab] = useState<"contacts" | "call">("contacts");
  const [recipientSearch, setRecipientSearch] = useState(""), [recipientId, setRecipientId] = useState("");
  const [dialogSearch, setDialogSearch] = useState(""), [searchDialogs, setSearchDialogs] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [journalTab, setJournalTab] = useState<(typeof JOURNAL)[number]>("Мои звонки");
  const [callSearch, setCallSearch] = useState(""), [noteSearch, setNoteSearch] = useState(""), [callDate, setCallDate] = useState("");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { comment: string; tags: string }>>({});
  const [forward, setForward] = useState(""), [now, setNow] = useState(Date.now());
  // A recording being listened to in «Мои звонки»: training calls have no sound, only their length.
  const [player, setPlayer] = useState<{ id: string; at: number; length: number; playing: boolean } | null>(null);
  const sending = useRef(false), mounted = useRef(true), activeRef = useRef(active), goRef = useRef(go), remembered = useRef(false);
  const overlay = useRef<HTMLDivElement>(null), statusButton = useRef<HTMLButtonElement>(null);
  activeRef.current = active; goRef.current = go;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!active) setStatusOpen(false); }, [active]);
  useEffect(() => { setStatusOpen(false); if (screen !== "journal") setPlayer(p => p?.playing ? { ...p, playing: false } : p); }, [screen]);
  useEffect(() => {
    if (remembered.current || !query.data) return;
    remembered.current = true;
    if (remember && !query.data.logged_in) { setLogin(query.data.demo_credentials.login); setPassword(query.data.demo_credentials.password); }
  }, [query.data, remember]);
  useEffect(() => {
    if (!active || !query.data?.center_joined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, query.data?.center_joined]);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(""), 6000); return () => window.clearTimeout(timer); }, [feedback]);
  useEffect(() => {
    if (!active || !player?.playing) return;
    const timer = window.setInterval(() => setPlayer(p => !p?.playing ? p : p.at + .25 >= p.length ? { ...p, at: p.length, playing: false } : { ...p, at: p.at + .25 }), 250);
    return () => window.clearInterval(timer);
  }, [active, player?.id, player?.playing]);
  // «Перезвон» longer than its limit ends the session on the server: look again the moment it runs out.
  const callbackLeft = query.data?.pause_reason === "callback" && !query.data.active_call ? query.data.callback_limit_seconds - query.data.pause_seconds : null;
  useEffect(() => {
    if (!active || callbackLeft === null) return;
    const timer = window.setTimeout(() => void query.refetch(), Math.max(0, query.dataUpdatedAt + callbackLeft * 1000 - Date.now()) + 700);
    return () => window.clearTimeout(timer);
  }, [active, callbackLeft, query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutation = useMutation({
    mutationFn: (command: OktellCommand) => { if (!mounted.current) throw new DOMException("Кабинет закрыт", "AbortError"); return oktell.action(command); },
    onMutate: () => client.cancelQueries({ queryKey }),
    retry: (count, error) => mounted.current && count < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 4000),
    onSuccess: state => { if (!mounted.current) return; client.setQueryData(queryKey, state); setFailed(null); },
  });
  const pending = mutation.isPending;
  async function execute(command: OktellCommand, success: string, after?: () => void) {
    if (sending.current || !mounted.current) return;
    sending.current = true; setFailed(null);
    try { await mutation.mutateAsync(command); if (mounted.current) { setFeedback(success); after?.(); } }
    catch (error) { if (mounted.current) setFailed({ command, success, after, message: error instanceof Error ? error.message : "Не удалось сохранить действие. Повторите попытку." }); }
    finally { sending.current = false; }
  }
  function run(action: OktellAction, success: string, after?: () => void) { return execute({ ...action, request_id: crypto.randomUUID() }, success, after); }
  function navigate(target: OktellScreen) { if (!mounted.current || !activeRef.current) return; setStatusOpen(false); goRef.current(target); }
  function form(event: FormEvent, action: OktellAction, success: string, after?: () => void) { event.preventDefault(); void run(action, success, after); }
  const state = query.data;
  const overlayOpen = active && !!state?.logged_in && (statusOpen || screen === "phone");
  useEffect(() => {
    if (!overlayOpen) return;
    const panel = overlay.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(node => node.getClientRects().length > 0);
    (controls()[0] ?? panel).focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (statusOpen) setStatusOpen(false); else navigate("cabinet"); }
      if (event.key === "Tab") {
        const list = controls(), first = list[0], last = list.at(-1);
        if (!first || !last) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (activeRef.current && previous?.isConnected && !previous.closest("[hidden]")) previous.focus({ preventScroll: true });
    };
  }, [overlayOpen, statusOpen, screen]);
  const alerts = <>{failed && <div className="oktell-error" role="alert"><span>{failed.message}</span><button className="oktell-btn" disabled={pending} onClick={() => void execute(failed.command, failed.success, failed.after)}>Повторить</button></div>}{pending && <p className="oktell-saving" role="status">Сохраняем…</p>}</>;
  if (query.isPending) return <div className="oktell oktell-loading" role="status"><p>Загрузка Oktell…</p></div>;
  if (query.isError || !state) return <div className="oktell oktell-loading" role="alert"><p>{query.error?.message ?? "Кабинет недоступен"}</p><button className="oktell-btn" onClick={() => query.refetch()}>Повторить</button></div>;
  const contact = state.contacts.find(c => c.id === contactId), recipient = state.contacts.find(c => c.id === recipientId);
  const pause = PAUSES.find(p => p.id === state.pause_reason)?.title;
  const status = pause ?? OFFICE[state.office_status];
  const delta = state.center_joined ? Math.max(0, Math.floor((now - query.dataUpdatedAt) / 1000)) : 0;
  const metrics = {
    center: state.metrics.center_seconds + delta,
    break: state.metrics.break_seconds + (state.pause_reason === "break" ? delta : 0),
    talk: state.metrics.talk_seconds + (state.active_call ? delta : 0),
    busy: state.metrics.busy_seconds + (state.active_call || state.pause_reason ? delta : 0),
  };
  const phoneList = state.contacts.filter(c => `${c.name} ${c.number} ${c.department}`.toLocaleLowerCase("ru").includes(phoneSearch.trim().toLocaleLowerCase("ru")));
  const departments = [...new Set(phoneList.map(c => c.department))];
  const recipientList = state.contacts.filter(c => `${c.name} ${c.number} ${c.department}`.toLocaleLowerCase("ru").includes(recipientSearch.trim().toLocaleLowerCase("ru")));
  const dialogs = state.contacts.filter(c => state.messages.some(m => m.contact_id === c.id) && `${c.name} ${c.number}`.toLocaleLowerCase("ru").includes(dialogSearch.trim().toLocaleLowerCase("ru")));
  const filteredCalls = state.calls.filter(c => `${c.number} ${c.name} ${c.department}`.toLocaleLowerCase("ru").includes(callSearch.trim().toLocaleLowerCase("ru")) && `${c.comment} ${c.tags.join(" ")}`.toLocaleLowerCase("ru").includes(noteSearch.trim().toLocaleLowerCase("ru")) && (!callDate || dateInput(c.started_at) === callDate));
  const callDays = [...new Set(filteredCalls.map(c => dateInput(c.started_at)))];
  const calendarStart = new Date(month.getFullYear(), month.getMonth(), 1 - ((month.getDay() + 6) % 7));
  const canCall = state.center_joined && state.web_phone && !state.pause_reason && state.office_status === "available";
  const callBlock = !state.center_joined ? "Войдите в call-центр в кабинете." : !state.web_phone ? "Включите веб-телефон в меню статусов." : state.pause_reason ? "Коллеге звонят без паузы: вернитесь к работе." : "Выберите статус «На связи».";
  const pauseNow = state.pause_seconds + delta, limitLeft = state.callback_limit_seconds - pauseNow;
  // Digits typed into «имя или номер» call a driver through his park: code, then the number from 7.
  const numberMode = looksLikeNumber(phoneSearch, state.contacts.map(c => c.number)), dialCheck = checkDial(phoneSearch.trim(), state.park_codes);
  const dialBlock = !state.center_joined ? "Сначала войдите в call-центр в кабинете"
    : !state.web_phone ? "Включите веб-телефон в меню статусов"
      : state.active_call ? "Сначала завершите текущий звонок"
        : state.pause_reason && state.pause_reason !== "callback" ? `Сейчас пауза «${pause}». Для звонка водителю вернитесь к работе и поставьте «Перезвон»`
          : !state.pause_reason && state.center_mode !== "manual" ? "Сначала поставьте статус «Перезвон»: тогда вам не будут поступать звонки" : "";
  function listen(call: OktellCall) {
    setPlayer(p => p?.id === call.id ? { ...p, playing: !p.playing, at: !p.playing && p.at >= p.length ? 0 : p.at } : { id: call.id, at: 0, length: Math.max(1, call.duration_seconds), playing: true });
  }
  function selectRecipient(id: string) {
    setRecipientId(id);
    setMessages(previous => previous.new && !previous[id] ? { ...previous, [id]: previous.new, new: "" } : previous);
  }
  function dial() {
    if (!state) return;
    if (numberMode) {
      if (!dialCheck.ok) { setFeedback(dialCheck.hint); return; }
      if (dialBlock) { setFeedback(dialBlock); return; }
      void run({ action: "dial", number: dialCheck.digits }, `Звонок водителю ${dialCheck.park}`, () => setPhoneSearch(""));
      return;
    }
    const selected = state.contacts.find(c => c.number === phoneSearch.trim()) ?? contact;
    if (!selected) { setFeedback("Выберите сотрудника или введите внутренний номер."); return; }
    setContactId(selected.id); setPhoneTab("call");
    if (!canCall) { setFeedback(callBlock); return; }
    void run({ action: "call_start", contact_id: selected.id }, "Звонок начат");
  }
  // Drivers of the voice trainer call here: whether they do now, and in which language.
  const voiceBlocked = callsBlocked(state);
  const voicePanel = state.voice_calls && <div className="oktell-voice" data-coach="oktell-voice">
    <header className="oktell-section-head"><h1>Звонки водителей</h1></header>
    <p className={`oktell-voice-state${voiceBlocked ? "" : " is-on"}`} role="status"><i aria-hidden="true" />{voiceBlocked ? `Звонки не поступают: ${voiceBlocked.charAt(0).toLowerCase()}${voiceBlocked.slice(1)}` : state.active_call?.voice_attempt_id ? "Идёт звонок водителя" : state.ringing ? "Звонит водитель" : "Звонки поступают: водитель позвонит сам"}</p>
    <div className="oktell-voice-language" role="group" aria-label="Язык звонков"><span>Язык звонков</span>{VOICE_LANGUAGES.map(item => <button key={item.id} className={`oktell-btn${state.voice_language === item.id ? " is-current" : ""}`} aria-pressed={state.voice_language === item.id} disabled={pending || state.voice_language === item.id} onClick={() => void run({ action: "voice_language", language: item.id }, `Водители будут говорить: ${item.title}`)}>{item.title}</button>)}</div>
    <p className={`oktell-voice-ai${state.voice_ai ? " is-on" : ""}`}>{state.voice_ai ? <><strong>ИИ (Claude)</strong> играет водителя и оценивает звонки: понимает ответ по смыслу, а не по ключевым словам.</> : <><strong>ИИ не подключён:</strong> водитель говорит заготовленными фразами, звонок оценивают правила тренажёра.</>}</p>
    <p className="oktell-voice-hint">Отвечайте голосом в гарнитуру: после короткой паузы водитель слышит ответ. Разбор каждого звонка — в «Журнале»{user?.role === "operator" || user?.role === "trainee" ? <> и в разделе <Link to="/training/voice">«Голосовой тренажёр»</Link></> : null}.</p>
  </div>;
  const cabinet = <div className="oktell-cabinet"><section className="oktell-stats"><header className="oktell-section-head"><h1>Показатели</h1><button className="oktell-btn" disabled={query.isFetching} onClick={() => query.refetch()}><span aria-hidden="true">⟳</span> {query.isFetching ? "Обновляем…" : "Обновить"}</button></header>
    {state.center_joined && state.pause_reason && <div className="oktell-stat-row is-paused" data-coach="oktell-resume"><div><span>{state.pause_reason === "break" ? "В перерыве" : pause}</span><strong>{duration(pauseNow)}</strong>{state.pause_reason === "callback" && <small className={`oktell-limit${limitLeft <= 60 ? " is-near" : ""}`}>{limitLeft > 0 ? `Не дольше ${clock(state.callback_limit_seconds)} · осталось ${clock(limitLeft)}` : state.active_call ? "Время вышло: после звонка Oktell завершит сеанс" : "Время вышло"}</small>}</div><div><button className="oktell-btn oktell-btn--green" disabled={pending || !!state.active_call} title={state.active_call ? "Сначала завершите звонок" : undefined} onClick={() => void run({ action: "resume" }, "Вы вернулись к работе")}>Вернуться к работе</button></div></div>}
    <div className="oktell-stat-row" data-coach="oktell-center" data-joined={state.center_joined}><div><span>В call-центре</span><strong>{duration(metrics.center)}</strong></div><div><button data-coach={state.center_joined ? "oktell-leave" : "oktell-join"} className={`oktell-btn${state.center_joined ? "" : " oktell-btn--green"}`} disabled={pending || !!state.active_call} onClick={() => void run({ action: state.center_joined ? "leave" : "join" }, state.center_joined ? "Вы вышли из call-центра" : "Вы вошли в call-центр")}>{state.center_joined ? "Выйти из call-центра" : "Войти в call-центр"}</button></div></div>
    {state.center_joined && <><div className="oktell-stat-row"><div><span>В перерыве</span><strong>{duration(metrics.break)}</strong></div><div><span>Последний в</span><strong>—</strong></div></div><div className="oktell-stat-row"><div><span>В разговоре</span><strong>{duration(metrics.talk)}</strong></div><div><strong title="Показатель не предоставлен">—</strong></div></div><div className="oktell-stat-row"><div><span>Занятость</span><strong>{duration(metrics.busy)}</strong></div><div><strong title="Показатель не предоставлен">—</strong></div></div><div className="oktell-stat-row"><div><span>Звонков</span><strong>{state.metrics.calls}</strong></div><div><span>Успешных</span><strong>{state.metrics.successful}</strong></div></div></>}
  </section><section className="oktell-native-tasks">{voicePanel}<header className="oktell-section-head"><h1>Мои задачи</h1></header><p className="oktell-empty-text">Нет назначенных задач</p></section></div>;

  const dialHint = dialCheck.ok ? dialBlock : dialCheck.hint;
  const dialCard = <div className="oktell-dial-card" data-coach="oktell-dial-card" data-valid={dialCheck.ok}><small>Звонок водителю</small><strong>{dialCheck.ok ? `Водитель · ${dialCheck.park}` : "Код таксопарка и номер"}</strong>{dialCheck.ok && <span>{formatNumber(dialCheck.digits, state.park_codes)}</span>}{dialHint && <p id="oktell-dial-hint" className={`oktell-dial-hint${dialCheck.ok ? "" : " is-format"}`}>{dialHint}</p>}<button data-coach="oktell-dial-call" className="oktell-btn oktell-btn--green" disabled={pending || !dialCheck.ok || !!dialBlock} onClick={dial}>Позвонить</button></div>;
  return <div className="oktell" data-screen={screen} data-coach="oktell" data-pause={state.logged_in ? state.pause_reason ?? "none" : "out"} data-call={state.active_call ? "active" : "none"} data-journal={state.calls.length ? "calls" : "empty"}>
    {!state.logged_in ? <div className={`oktell-login-canvas${state.notice ? " has-notice" : ""}`}><section className="oktell-login" data-coach="oktell-login"><div className="oktell-wordmark" aria-label="Oktell"><i aria-hidden="true" /><span><b>ok</b>tell</span></div>{state.notice?.kind === "callback_timeout" && <div className="oktell-kicked" role="alert" data-coach="oktell-kicked"><strong>Oktell завершил сеанс в {time(state.notice.at)}</strong><p>Статус «Перезвон» длился больше {Math.round(state.callback_limit_seconds / 60)} минут. Войдите снова и после перезвона сразу возвращайтесь к работе.</p></div>}<form onSubmit={e => form(e, { action: "login", login, password }, "Вход выполнен", () => { try { sessionStorage.setItem(rememberKey, remember ? "1" : "0"); } catch { /* Optional preference. */ } if (!remember) setPassword(""); navigate("phone"); })}>
      <label>Логин<input name="oktell-login" className={failed?.command.action === "login" ? "has-error" : ""} value={login} onChange={e => setLogin(e.target.value)} autoComplete="off" required maxLength={80} disabled={pending} /></label><label>Пароль<input name="oktell-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" required maxLength={100} disabled={pending} /></label>
      <div className="oktell-login-actions"><button className="oktell-btn" type="submit" disabled={pending}>Войти</button><label className="oktell-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} title="Сохранить демонстрационный вход на этой вкладке" disabled={pending} />Сохранить пароль</label></div></form>{alerts}<button className="oktell-demo-entry" onClick={() => { setLogin(state.demo_credentials.login); setPassword(state.demo_credentials.password); }} disabled={pending}>Демо-вход: {state.demo_credentials.login} / {state.demo_credentials.password}</button></section><p className="oktell-forgot">Если вы забыли пароль, обратитесь к вашему системному администратору.</p></div>
      : <><nav className="oktell-sidebar" aria-label="Разделы Oktell" data-coach="oktell-workspace"><div className="oktell-sidebar-logo"><i aria-hidden="true" /><span>Okapp</span></div><div className="oktell-nav-items">{SCREENS.map(item => <button key={item.id} data-coach={`oktell-nav-${item.id}`} aria-label={item.title} aria-current={screen === item.id ? "page" : undefined} className={screen === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.title}</span></button>)}</div><div className="oktell-status-cells"><span className="oktell-avatar-cell" title={`${state.operator.name} · ${state.operator.number}`}><span>{initials(state.operator.name)}</span></span><button ref={statusButton} data-coach="oktell-status" className={`oktell-status-cell${state.pause_reason || state.office_status === "dnd" ? " is-paused" : ""}`} aria-label={`Режимы и статусы: ${status}`} aria-haspopup="dialog" aria-expanded={statusOpen} onClick={() => { setForward(state.forward_number || ""); setStatusOpen(current => !current); }}>{state.pause_reason ? <Icon name="coffee" /> : <span aria-hidden="true">✓</span>}<small aria-hidden="true">▸</small></button></div></nav>
      <div className="oktell-workarea" aria-hidden={overlayOpen || undefined}>
        {(screen === "cabinet" || screen === "phone") && cabinet}
        {screen === "messages" && <div className="oktell-messages"><section className="oktell-dialogs"><header className="oktell-section-head"><h1>Диалоги</h1><div><button className="oktell-icon-btn" aria-label="Поиск диалогов" aria-expanded={searchDialogs} onClick={() => setSearchDialogs(value => !value)}><Icon name="search" /></button><button className="oktell-btn oktell-btn--green" onClick={() => { setRecipientId(""); setRecipientSearch(""); }}>Новый</button></div></header>{searchDialogs && <input className="oktell-dialog-search" aria-label="Поиск диалогов по имени или номеру" type="search" value={dialogSearch} onChange={e => setDialogSearch(e.target.value)} placeholder="Имя или номер" />}<div className="oktell-dialog-list">{dialogs.map(c => <button key={c.id} className={recipientId === c.id ? "is-selected" : ""} onClick={() => selectRecipient(c.id)}><Icon name="person" /><span><ContactName name={c.name} /><small>{state.messages.filter(m => m.contact_id === c.id).at(-1)?.text}</small></span></button>)}</div></section>
          <section className="oktell-conversation"><header className="oktell-section-head"><h1>{recipient ? recipient.name : "Новый диалог"}</h1><div className="oktell-message-modes"><button className="oktell-btn" onClick={() => { setRecipientId(""); setRecipientSearch(""); }}>Личное сообщение</button><button className="oktell-btn" disabled title="Пока недоступно">Конференция</button>{recipient && <button className="oktell-icon-btn" aria-label="Закрыть диалог" onClick={() => setRecipientId("")}>×</button>}</div></header>
            <div className="oktell-conversation-content">{!recipient ? <><div className="oktell-recipient-search"><Icon name="search" /><input aria-label="Поиск получателя" type="search" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)} placeholder="поиск по сотрудникам" /></div><div className="oktell-recipient-list">{recipientList.map(c => <button key={c.id} onClick={() => selectRecipient(c.id)}><Icon name="person" /><span><ContactName name={c.name} /> <em>{c.number}</em></span></button>)}{!recipientList.length && <p className="oktell-empty-text">Сотрудники не найдены</p>}</div></> : <div className="oktell-message-history">{state.messages.filter(m => m.contact_id === recipient.id).map(m => <article key={m.id}><header>Вы <time>{day(m.sent_at)}, {time(m.sent_at)}</time></header><p>{m.text}</p></article>)}</div>}</div>
            <form className="oktell-compose" onSubmit={e => { if (!recipient) { e.preventDefault(); setFeedback("Выберите получателя сообщения."); return; } form(e, { action: "message", contact_id: recipient.id, text: messages[recipient.id] ?? "" }, "Сообщение отправлено", () => setMessages(previous => previous[recipient.id] === messages[recipient.id] ? { ...previous, [recipient.id]: "" } : previous)); }}><Icon name="person" /><div><textarea aria-label="Сообщение" value={messages[recipientId || "new"] ?? ""} onChange={e => setMessages(previous => ({ ...previous, [recipientId || "new"]: e.target.value }))} disabled={pending} required maxLength={2000} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><div className="oktell-compose-actions"><button className="oktell-btn" type="submit" disabled={pending || !messages[recipientId || "new"]?.trim()}>Написать</button><span>Ctrl+Enter</span><button className="oktell-attach" type="button" disabled title="Пока недоступно">♧ Прикрепить</button></div></div></form>
          </section></div>}
        {screen === "journal" && <div className="oktell-journal"><section className="oktell-journal-sidebar"><header className="oktell-section-head"><h1>Журнал</h1></header><nav aria-label="Разделы журнала">{JOURNAL.map((item, index) => <button key={item} className={journalTab === item ? "is-active" : ""} aria-current={journalTab === item ? "page" : undefined} onClick={() => setJournalTab(item)}><span aria-hidden="true"><Icon name={["phone", "voicemail", "info", "people"][index]} /></span>{item}</button>)}</nav><div className="oktell-calendar"><header><button aria-label="Предыдущий месяц" onClick={() => setMonth(previous => new Date(previous.getFullYear(), previous.getMonth() - 1, 1))}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m7 1-5 4 5 4Z" fill="currentColor" /></svg></button><strong>{month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", "")}</strong><button aria-label="Следующий месяц" onClick={() => setMonth(previous => new Date(previous.getFullYear(), previous.getMonth() + 1, 1))}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m3 1 5 4-5 4Z" fill="currentColor" /></svg></button></header><div className="oktell-calendar-grid">{["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map(label => <strong key={label}>{label}</strong>)}{Array.from({ length: 42 }, (_, index) => { const date = new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index), value = dateInput(date); return <button key={value} className={`${date.getMonth() !== month.getMonth() ? "is-other-month" : ""}${callDate === value ? " is-selected" : ""}`} aria-label={date.toLocaleDateString("ru-RU")} aria-pressed={callDate === value} onClick={() => setCallDate(previous => previous === value ? "" : value)}>{date.getDate()}</button>; })}</div>{callDate && <button className="oktell-calendar-reset" onClick={() => setCallDate("")}>Показать все дни</button>}</div></section>
          <section className="oktell-journal-content"><header className="oktell-section-head"><h1>{journalTab}</h1></header>{journalTab === "Мои звонки" ? <><div className="oktell-journal-search"><Icon name="search" /><input type="search" aria-label="Номер, имя или отдел" value={callSearch} onChange={e => setCallSearch(e.target.value)} placeholder="Номер, имя или отдел" /><input type="search" aria-label="Комментарий или тег" value={noteSearch} onChange={e => setNoteSearch(e.target.value)} placeholder="Комментарий или тег" /></div><div className="oktell-call-list">{callDays.map(date => <section key={date}><h2>{day(filteredCalls.find(c => dateInput(c.started_at) === date)!.started_at)}</h2>{filteredCalls.filter(c => dateInput(c.started_at) === date).map(call => <article key={call.id}><div className="oktell-call-line"><button className="oktell-call-row" aria-expanded={expandedCall === call.id} aria-controls={`oktell-note-${call.id}`} onClick={() => { setExpandedCall(previous => previous === call.id ? null : call.id); setNotes(previous => previous[call.id] ? previous : { ...previous, [call.id]: { comment: call.comment, tags: call.tags.join(", ") } }); }}><time>{time(call.started_at)}</time><span className={`oktell-direction${call.status === "missed" ? " is-missed" : ""}`} aria-label={call.direction === "outbound" ? "Исходящий" : call.status === "missed" ? "Пропущенный" : "Входящий"}>{call.direction === "outbound" ? "→" : "←"}</span><span className="oktell-call-number">{call.direction === "inbound" ? formatCaller(call.number) : formatNumber(call.number, state.park_codes)}<small>{call.name}{call.direction === "inbound" && call.department ? ` · ${call.department}` : ""}{call.status === "missed" ? " · пропущен" : ""}{call.comment ? ` · ${call.comment}` : ""}{call.tags.length ? ` · ${call.tags.map(tag => `#${tag}`).join(" ")}` : ""}</small></span><span className="oktell-call-duration">{call.duration_seconds < 60 ? `${call.duration_seconds} сек` : `${Math.floor(call.duration_seconds / 60)} мин`}</span></button>{call.status !== "missed" && <button className="oktell-play" data-coach="oktell-play" aria-label={`Прослушать запись звонка в ${time(call.started_at)}`} aria-pressed={player?.id === call.id} title="Прослушать запись" onClick={() => listen(call)}>{player?.id === call.id && player.playing ? "❚❚" : "▶"}</button>}{call.voice_attempt_id ? <Link className="oktell-review" to={`/training/voice/attempts/${call.voice_attempt_id}`} aria-label={`Разбор звонка в ${time(call.started_at)}`}>Разбор</Link> : null}</div>{player?.id === call.id && <div className="oktell-player" data-coach="oktell-player" role="group" aria-label="Запись разговора"><button className="oktell-player-toggle" aria-label={player.playing ? "Пауза" : "Слушать"} onClick={() => listen(call)}>{player.playing ? "❚❚" : "▶"}</button><input type="range" min={0} max={player.length} step={1} value={Math.floor(player.at)} aria-label="Позиция в записи" onChange={e => setPlayer(previous => previous && { ...previous, at: Number(e.target.value) })} /><time>{clock(player.at)} / {clock(player.length)}</time><small>Учебная запись без звука</small><button className="oktell-icon-btn" aria-label="Закрыть запись" onClick={() => setPlayer(null)}>×</button></div>}{expandedCall === call.id && <form id={`oktell-note-${call.id}`} className="oktell-call-note" onSubmit={e => form(e, { action: "call_comment", call_id: call.id, comment: notes[call.id]?.comment ?? "", tags: (notes[call.id]?.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean) }, "Комментарий сохранён")}><label>Комментарий<textarea value={notes[call.id]?.comment ?? ""} onChange={e => setNotes(previous => ({ ...previous, [call.id]: { ...previous[call.id], comment: e.target.value } }))} maxLength={2000} required disabled={pending} /></label><label>Теги через запятую<input value={notes[call.id]?.tags ?? ""} onChange={e => setNotes(previous => ({ ...previous, [call.id]: { ...previous[call.id], tags: e.target.value } }))} maxLength={200} disabled={pending} /></label><button className="oktell-btn" type="submit" disabled={pending || !notes[call.id]?.comment.trim()}>Сохранить</button></form>}</article>)}</section>)}{!filteredCalls.length && <p className="oktell-empty-text">{state.calls.length ? "Звонки не найдены" : "Звонков пока нет"}</p>}</div></> : <p className="oktell-empty-text">{journalTab === "Голосовая почта" ? "Новых голосовых сообщений нет" : journalTab === "Уведомления" ? "Новых уведомлений нет" : "Звонков коллег пока нет"}</p>}</section>
        </div>}
      </div>
      {active && (screen === "phone" || statusOpen) && <><button className="oktell-shade" aria-label={statusOpen ? "Закрыть меню статусов" : "Закрыть телефон"} tabIndex={-1} onClick={() => statusOpen ? setStatusOpen(false) : navigate("cabinet")} />{statusOpen ? <div ref={overlay} className="oktell-status-popup" data-coach="oktell-statuses" role="dialog" aria-modal="true" aria-label="Режимы и статусы" tabIndex={-1}>{alerts}<section><h2>Офисная телефония</h2><button className={`oktell-menu-row${state.office_status === "available" ? " is-current" : ""}`} disabled={pending || !!state.active_call} onClick={() => void run({ action: "office_status", status: "available" }, "Статус: На связи")}><span className="oktell-menu-symbol is-green">✓</span>На связи</button><form className="oktell-forward-row" onSubmit={e => form(e, { action: "office_status", status: "forward", number: forward }, "Переадресация включена")}><button className="oktell-menu-row" type="submit" disabled={pending || !!state.active_call || !forward.trim()}><span className="oktell-menu-symbol">▣</span>Переадресация</button><input aria-label="Номер переадресации" value={forward} onChange={e => setForward(e.target.value)} placeholder="Введите номер" title={`Внутренний номер: ${state.contacts[0]?.number}–${state.contacts.at(-1)?.number}`} list="oktell-forward-contacts" inputMode="numeric" pattern="[0-9]+" required minLength={3} maxLength={20} disabled={pending || !!state.active_call} /><datalist id="oktell-forward-contacts">{state.contacts.map(c => <option key={c.id} value={c.number}>{c.name}</option>)}</datalist></form><button className={`oktell-menu-row${state.office_status === "dnd" ? " is-current" : ""}`} disabled={pending || !!state.active_call} onClick={() => void run({ action: "office_status", status: "dnd" }, "Статус: Не беспокоить")}><span className="oktell-menu-symbol is-yellow">▣</span>Не беспокоить</button><button className="oktell-menu-row" disabled={pending || !!state.active_call} onClick={() => void run({ action: "logout" }, "Вы вышли из Oktell", () => { setStatusOpen(false); if (!remember) setPassword(""); })}><span className="oktell-menu-symbol">⇥</span>Выйти</button></section><section><h2>Call-центр</h2>{(["automatic", "manual"] as const).map(mode => <button key={mode} data-coach={`oktell-${mode}`} data-current={state.center_mode === mode && !state.pause_reason} className={`oktell-menu-row${state.center_mode === mode && !state.pause_reason ? " is-current" : ""}`} disabled={pending || !!state.active_call} title={state.pause_reason ? "Вернуться к работе в этом режиме" : undefined} onClick={() => void run({ action: "center_mode", mode }, `${state.pause_reason ? "Вы вернулись к работе: " : ""}${mode === "automatic" ? "автоматический режим" : "ручной режим"}`)}><Icon name="headset" />{mode === "automatic" ? "Автоматический режим" : "Ручной режим"}</button>)}<div data-coach="oktell-pauses">{PAUSES.map(option => <button key={option.id} data-coach={`oktell-pause-${option.id}`} className={`oktell-menu-row${state.pause_reason === option.id ? " is-current" : ""}`} disabled={pending || !state.center_joined || !!state.active_call || !!state.pause_reason} title={state.pause_reason ? "Сначала вернитесь к работе" : undefined} onClick={() => void run({ action: "pause", reason: option.id }, option.title)}><Icon name="coffee" />{option.title}</button>)}</div></section><footer data-coach="oktell-phone-settings" data-ready={state.web_phone && state.auto_answer}><label><input type="checkbox" checked={state.web_phone} disabled={pending || !!state.active_call} onChange={e => void run({ action: "phone_settings", web_phone: e.target.checked, auto_answer: state.auto_answer }, e.target.checked ? "Веб-телефон включён" : "Веб-телефон выключен")} /><span>Веб-телефон<small>Звонки из браузера<br />через гарнитуру</small></span></label><label><input type="checkbox" checked={state.auto_answer} disabled={pending || !!state.active_call} onChange={e => void run({ action: "phone_settings", web_phone: state.web_phone, auto_answer: e.target.checked }, e.target.checked ? "Автоответ включён" : "Автоответ выключен")} /><span>Автоответ<small>Автоматически<br />отвечать на звонки</small></span></label></footer><button className="oktell-popup-close" aria-label="Закрыть меню статусов" onClick={() => setStatusOpen(false)}>×</button></div>
        : <div ref={overlay} className="oktell-phone-popup" data-coach="oktell-phone" role="dialog" aria-modal="true" aria-label="Телефон" tabIndex={-1}><header><span className="oktell-tiny-logo" /><div><button aria-label="Сотрудники" aria-pressed={phoneTab === "contacts"} onClick={() => setPhoneTab("contacts")}><Icon name="person" /></button><button aria-label="Звонок" aria-pressed={phoneTab === "call"} onClick={() => setPhoneTab("call")}><Icon name="phone" /></button><button aria-label="Закрыть телефон" onClick={() => navigate("cabinet")}>×</button></div></header><form className="oktell-phone-search" onSubmit={e => { e.preventDefault(); dial(); }}><Icon name="phone" /><input aria-label="Имя или номер" data-coach="oktell-dial" aria-describedby={numberMode ? "oktell-dial-hint" : undefined} type="search" value={phoneSearch} onChange={e => { setPhoneSearch(e.target.value); setContactId(""); }} placeholder="введите имя или номер" /><button aria-label="Позвонить по номеру" disabled={pending || !!state.active_call} type="submit">↵</button></form>{alerts}<div className="oktell-phone-content" data-coach="oktell-people">{numberMode ? dialCard : <>{phoneTab === "contacts" && departments.map(department => <section key={department}><h2>{department}</h2>{phoneList.filter(c => c.department === department).map(c => <button key={c.id} className={`oktell-phone-person is-${c.status}${contactId === c.id ? " is-selected" : ""}`} aria-pressed={contactId === c.id} onClick={() => setContactId(c.id)}><small>{c.name[0]}</small><span><ContactName name={c.name} /> <em>{c.number}</em><i title={CONTACT_STATUS[c.status]} aria-label={CONTACT_STATUS[c.status]} /></span></button>)}</section>)}{phoneTab === "contacts" && !phoneList.length && <p className="oktell-empty-text">Сотрудники не найдены</p>}{phoneTab === "call" && !state.active_call && !contact && <p className="oktell-empty-text">Введите внутренний номер, выберите сотрудника или наберите код таксопарка и номер водителя.</p>}</>}</div>{(state.active_call || contact) && <div className="oktell-phone-call" data-coach={state.active_call ? "oktell-active-call" : undefined}><strong>{state.active_call?.name ?? contact?.name}</strong><span>{state.active_call ? state.active_call.direction === "inbound" ? formatCaller(state.active_call.number) : formatNumber(state.active_call.number, state.park_codes) : contact?.number}</span>{state.active_call ? <><time>{duration((now - new Date(state.active_call.started_at).getTime()) / 1000)}</time>{state.pause_reason === "callback" && <small className={`oktell-limit${limitLeft <= 60 ? " is-near" : ""}`}>{limitLeft > 0 ? `«Перезвон»: осталось ${clock(limitLeft)}` : "Время «Перезвона» вышло: после звонка Oktell завершит сеанс"}</small>}<button data-coach="oktell-hangup" className="oktell-btn oktell-btn--red" disabled={pending} onClick={() => void run({ action: "call_end" }, "Звонок завершён")}>Завершить звонок</button></> : <><small>{contact && CONTACT_STATUS[contact.status]}</small><button className="oktell-btn oktell-btn--green" disabled={pending || !canCall || contact?.status !== "available"} onClick={dial}>Позвонить</button>{!canCall && <small>{callBlock}</small>}</>}</div>}</div>}</>}
      {!overlayOpen && <div className="oktell-global-alerts">{alerts}</div>}
      <span className="oktell-version">Oktell 1.0.33</span>
    </>}
    {feedback && <div className="oktell-toast" role="status"><strong>{feedback.includes("call-центр") ? "Call-центр" : "Oktell"}</strong><p>{feedback}</p><button aria-label="Закрыть уведомление" onClick={() => setFeedback("")}>×</button></div>}
  </div>;
}
