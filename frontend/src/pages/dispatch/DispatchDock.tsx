import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGuide } from "../../guide";
import { fleet as api, type FleetCall, type FleetResult, type FleetState } from "../../api/dispatch";
import { PulsarFace, type PulsarMood } from "../crm/PulsarGuide";
import { countdown, fleetLink } from "./fleetNav";
import { FLEET_QUERY } from "./DispatchSite";

export type FleetFeedback = FleetResult & { at: number };
const MISSIONS: Record<string, string> = { dispatch_driver: "Найти водителя", dispatch_car: "Тарифы и оклейка", dispatch_inventory: "Термокороб", dispatch_support: "Поддержка Яндекса", dispatch_limit: "Лимит на вывод" };

/**
 * Pulsar's panel beside the cabinet: he plays the driver of each call, reads out the courier's
 * code and reacts to what the server decided about the operator's last change.
 */
export function DispatchDock({ feedback, onFeedback, onGo, onTour, onCrm }: {
  feedback: FleetFeedback | null; onFeedback: (value: FleetFeedback | null) => void;
  onGo: (path: string, park: string) => void; onTour: (tour: string) => void; onCrm: () => void;
}) {
  const guide = useGuide(), client = useQueryClient();
  const query = useQuery({ queryKey: FLEET_QUERY, queryFn: api.state });
  const [active, setActive] = useState<string | null>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [cheer, setCheer] = useState<FleetCall | null>(null);
  const solvedBefore = useRef<Set<string> | null>(null);
  const state = query.data, calls = state?.calls ?? [], call = calls.find(c => c.id === active);
  // A call that became solved since the last answer from the server gets its own celebration.
  useEffect(() => {
    if (!state) return;
    const solved = new Set(state.calls.filter(c => c.state === "solved").map(c => c.id));
    const fresh = solvedBefore.current && state.calls.find(c => c.state === "solved" && !solvedBefore.current!.has(c.id));
    solvedBefore.current = solved;
    if (fresh) { setCheer(fresh); setActive(fresh.id); setOpen(true); }
  }, [state]);
  useEffect(() => { setError(""); setCheer(c => c?.id === active ? c : null); }, [active]);
  async function send(action: () => ReturnType<typeof api.code>) {
    setBusy(true); setError("");
    try { const response = await action(); client.setQueryData(FLEET_QUERY, response.state); client.invalidateQueries({ queryKey: ["city"] }); onFeedback({ ...response.result, at: Date.now() }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const done = calls.filter(c => c.state === "solved").length;
  const recent = feedback && Date.now() - feedback.at < 60_000 ? feedback : null;
  const mood: PulsarMood = cheer ? "cheer" : recent?.note || recent?.checks?.some(c => !c.ok) || recent?.correct === false ? "point" : call ? "wave" : "idle";
  const bubble = speech(cheer, recent, call, guide.text);
  return <aside className={`pulsar-dock fleet-dock${open ? " is-open" : ""}`} aria-label={guide.text("Пульсар — звонки Диспетчерской")} data-coach="dock-calls">
    <header className="pulsar-hero">
      <div className="pulsar-hero-top"><span className="pulsar-name"><span className="pulsar-online" />{guide.name}<small>звонки водителей</small></span><span className="pulsar-step-pill">{done} из {calls.length}</span>
        <button className="pulsar-mobile-toggle" aria-label={open ? "Свернуть звонки" : "Открыть звонки"} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "⌄" : "⌃"}</button></div>
      <div className="pulsar-stage">
        <button className="pulsar-avatar" onClick={() => setOpen(true)} aria-label={guide.text("Открыть панель Пульсара")}><PulsarFace mood={mood} /></button>
        <div className="pulsar-bubble" aria-live="polite"><p className="pulsar-speech">{bubble.label}</p><strong>{bubble.text}</strong></div>
      </div>
    </header>
    <div className="pulsar-dock-scroll">
      {!state ? <p className="pulsar-muted">{query.isError ? query.error.message : "Загружаем звонки…"}</p>
        : call ? <CallView call={call} state={state} busy={busy} error={error} feedback={recent} onBack={() => { setActive(null); onFeedback(null); }} onTour={() => onTour(`call:${call.id}`)} onGo={onGo} onCrm={onCrm}
          onCode={() => void send(() => api.code(call.driver))} onAnswer={option => void send(() => api.answer(call.id, option))} />
        : <CallList calls={calls} onOpen={id => { setActive(id); onFeedback(null); }} />}
    </div>
    <footer className="pulsar-dock-footer">
      <button className="pulsar-text-button" onClick={() => onTour("fleet")}>🚀 Знакомство с кабинетом</button>
      <button className="pulsar-text-button" disabled={busy} onClick={() => { if (window.confirm("Вернуть учебную Диспетчерскую в исходное состояние? Решённые звонки останутся решёнными.")) void send(api.reset); }}>⟲ Сбросить</button>
    </footer>
  </aside>;
}

function speech(cheer: FleetCall | null, recent: FleetFeedback | null, call: FleetCall | undefined, text: (value: string) => string) {
  if (cheer) return { label: "Звонок решён! 🎉", text: cheer.title };
  if (recent?.note) return { label: "Смотри, что не так:", text: recent.note };
  if (recent?.checks?.length) return recent.solved ? { label: "Проверил обращение:", text: "Всё по правилам ✓" } : { label: "Проверил обращение:", text: "Есть ошибки — смотри ниже" };
  if (recent?.correct === false) return { label: "Не совсем так.", text: "Посмотри подсказку ниже и попробуй ещё раз" };
  if (recent?.correct) return { label: "Верно!", text: call?.state === "crm" ? "Теперь запрос в CRM" : "Так и отвечаем водителю" };
  if (recent?.code) return { label: "Курьер диктует код:", text: `Мой код — ${recent.code}` };
  if (call?.state === "solved") return { label: "Этот звонок уже решён.", text: "Выбери следующий в списке" };
  if (call) return { label: `☎ На линии ${call.driver_name}`, text: call.title };
  return { label: text("Я Пульсар и сыграю водителей."), text: "Выбери звонок и помоги водителю в Диспетчерской" };
}

function CallList({ calls, onOpen }: { calls: FleetCall[]; onOpen: (id: string) => void }) {
  const done = calls.filter(c => c.state === "solved").length;
  return <div className="fleet-calls">
    <div className="pulsar-checklist-heading"><strong>Звонки</strong><span>{done} из {calls.length}</span></div>
    <div className="pulsar-progress" role="progressbar" aria-label="Решённые звонки" aria-valuenow={done} aria-valuemin={0} aria-valuemax={calls.length}><span style={{ width: `${calls.length ? done / calls.length * 100 : 0}%` }} /></div>
    <ol>{calls.map((c, i) => <li key={c.id}><button className={`fleet-call is-${c.state}`} data-coach={`call-${c.id}`} onClick={() => onOpen(c.id)}>
      <span className="fleet-call-mark" aria-hidden="true">{c.state === "solved" ? "✓" : c.state === "crm" ? "…" : i + 1}</span>
      <span><strong>{c.title}</strong><small>{c.driver_name} · {MISSIONS[c.mission]}</small></span>
      <em>{c.state === "solved" ? "Решён" : c.state === "crm" ? "Нужен CRM" : "Ждёт"}</em>
    </button></li>)}</ol>
    <p className="pulsar-muted">Звонки засчитываются по твоим действиям в кабинете — проверяю их я на сервере. Решённые звонки двигают миссии района «Диспетчерская» в городе.</p>
  </div>;
}

function CallView({ call, state, busy, error, feedback, onBack, onTour, onGo, onCrm, onCode, onAnswer }: {
  call: FleetCall; state: FleetState; busy: boolean; error: string; feedback: FleetFeedback | null;
  onBack: () => void; onTour: () => void; onGo: (path: string, park: string) => void; onCrm: () => void; onCode: () => void; onAnswer: (option: string) => void;
}) {
  const [ticks, setTicks] = useState<number[]>([]), [copied, setCopied] = useState(false);
  const park = state.parks.find(p => p.id === call.park), driver = state.drivers.find(d => d.id === call.driver);
  return <div className="fleet-call-view" data-call={call.id}>
    <button className="pulsar-text-button" onClick={onBack}>← Все звонки</button>
    <div className={`fleet-call-card is-${call.state}`}><small>☎ Звонит {call.driver_name}{park ? ` · ${park.name}, ${park.city}` : ""}</small><p>«{call.speech}»</p></div>
    {call.state === "solved" ? <div className="fleet-call-done" role="status"><strong>✓ Звонок решён</strong><p>{call.done}</p></div> : <p className="pulsar-body">{call.goal}</p>}
    {call.state === "crm" && <div className="fleet-call-crm" data-coach="dock-crm"><strong>Осталось: запрос в CRM</strong><p>{call.done}</p>
      <p className="pulsar-muted">Категория: Водитель → … → Запрос → Таксопарк → Обработка запросов/ООЗ → Снятие лимита. В комментарии — ссылка на аккаунт.</p>
      <div className="fleet-call-actions"><button className="crm-secondary" onClick={() => { if (!driver) return; void navigator.clipboard?.writeText(fleetLink(driver, park)).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Ссылка скопирована ✓" : "Скопировать ссылку на аккаунт"}</button><button className="crm-primary" onClick={onCrm}>Открыть CRM →</button></div>
      {driver && !copied && <code className="fleet-call-link">{fleetLink(driver, park)}</code>}</div>}
    {call.code && call.state !== "solved" && <CourierCode call={call} busy={busy} onCode={onCode} fresh={feedback?.code ? feedback : null} />}
    {call.kind === "answer" && call.state === "new" && <div className="fleet-answers" data-coach="dock-answers"><strong>{call.question}</strong>
      {call.options.map(([id, label]) => <button key={id} disabled={busy} onClick={() => onAnswer(id)}>{label}</button>)}
      {feedback?.correct === false && feedback.text && <p className="fleet-answer-hint" role="alert">{feedback.text}</p>}</div>}
    {feedback?.checks && call.id === "support" && <ul className="fleet-checks-list" aria-label="Проверка обращения">{feedback.checks.map(c => <li key={c.label} className={c.ok ? "is-ok" : "is-bad"}>{c.ok ? "✓" : "✕"} {c.label}</li>)}</ul>}
    {error && <p className="fleet-answer-hint" role="alert">{error}</p>}
    {call.state !== "solved" && <>
      <div className={`pulsar-checklist${ticks.length === call.steps.length ? " is-finished" : ""}`}>
        <div className="pulsar-checklist-heading"><strong>Что сделать</strong><span>{ticks.length} из {call.steps.length}</span></div>
        {call.steps.map((text, i) => <label key={i} className={ticks.includes(i) ? "is-done" : ""}><input type="checkbox" checked={ticks.includes(i)} onChange={() => setTicks(t => t.includes(i) ? t.filter(n => n !== i) : [...t, i])} /><span>{ticks.includes(i) ? "✓" : i + 1}</span><p>{text}</p></label>)}
      </div>
      <div className="fleet-call-actions"><button className="crm-primary" onClick={onTour}>👉 Покажи, как</button><button className="crm-secondary" onClick={() => onGo("contractors", call.park)}>Открыть парк водителя</button></div>
    </>}
  </div>;
}

/** The courier's code from Яндекс Про: five characters that live two minutes. */
function CourierCode({ call, busy, onCode, fresh }: { call: FleetCall; busy: boolean; onCode: () => void; fresh: FleetFeedback | null }) {
  const source = fresh?.code ? { value: fresh.code, expires: fresh.at + (fresh.expires_in ?? 0) * 1000 } : call.active_code ? { value: call.active_code.value, expires: Date.now() + call.active_code.expires_in * 1000 } : null;
  const [deadline, setDeadline] = useState(source), [now, setNow] = useState(Date.now());
  useEffect(() => { if (source && source.value !== deadline?.value) setDeadline(source); }, [source?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const left = deadline ? Math.max(0, Math.round((deadline.expires - now) / 1000)) : 0;
  return <div className="fleet-code" data-coach="dock-code">
    <strong>Код курьера</strong>
    {deadline && left > 0 ? <>
      <p className="fleet-code-value" aria-label={`Код ${deadline.value.split("").join(" ")}`}>{deadline.value.split("").map((ch, i) => <span key={i}>{ch}</span>)}</p>
      <div className="fleet-code-timer"><span style={{ width: `${left / 120 * 100}%` }} /></div>
      <small>Код обновится через {countdown(left)} — успей вписать его в «Код для получения».</small>
    </> : <>
      <p className="pulsar-muted">{deadline ? "Код устарел: в Яндекс Про он обновляется каждые 2 минуты." : "Попроси курьера продиктовать код: Яндекс Про → Профиль → Инвентарь → Получить код."}</p>
      <button className="crm-primary" disabled={busy} onClick={onCode}>{deadline ? "Попросить новый код" : "Попросить код у курьера"}</button>
    </>}
  </div>;
}
