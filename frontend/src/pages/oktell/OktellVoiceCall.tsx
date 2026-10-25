import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { OKTELL_QUERY, oktell, type OktellAction, type OktellCall, type OktellState } from "../../api/oktell";
import { voiceKeys, voiceTraining, type VoiceAttempt } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import { useVoiceSpeech } from "../voice/useVoiceSpeech";
import { resolveVoiceProvider } from "../voice/voiceProvider";
import { Ringtone } from "./oktellRingtone";
import { AUTO_ANSWER_MS, DRIVER_HANGS_UP_MS, answerReady, callsBlocked, formatCaller, nextRingDelay, readyForCall } from "./oktellVoice";
import "./oktell-call.css";

type Speech = ReturnType<typeof useVoiceSpeech>;
type Retry = { attempt_id: number; turn: number };
type Phase = "connecting" | "driver" | "listening" | "sending" | "failed" | "resolved";
/** What the softphone shows after a call: the review of a finished one, or a missed one. */
type After = { call: OktellCall; byDriver: boolean };

const reviewPath = (id: number) => `/training/voice/attempts/${id}`;
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие. Повторите попытку.";
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const clock = (seconds: number) => { const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; };

function Icon({ name }: { name: "phone" | "mic" | "muted" | "repeat" | "keyboard" | "end" | "spark" }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "phone" ? <path d="m5 3 4 4-2 3c2 3 4 5 7 7l3-2 4 4c-1 3-4 3-7 2C8 19 4 15 3 9c-1-3-1-5 2-6Z" />
      : name === "mic" ? <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" /></>
        : name === "muted" ? <path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 4.9M12 19v3" />
          : name === "repeat" ? <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
            : name === "keyboard" ? <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>
              : name === "spark" ? <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
                : <path d="M3 15c5-5 13-5 18 0l-3 3-3-2v-3c-2-1-4-1-6 0v3l-3 2Z" />}
  </svg>;
}

/**
 * The training Oktell's web phone: drivers of the voice trainer call the operator who takes calls.
 * The call rings (picked up by «Автоответ» or «Ответить»), the driver speaks in his voice, and the
 * microphone listens while he waits: a pause after the operator's words sends them. Hanging up
 * finishes the attempt; its review opens from here and from the journal.
 */
export function OktellVoiceCall({ quiet, retry, onRetryTaken }: { quiet: boolean; retry: Retry | null; onRetryTaken: () => void }) {
  const { user } = useAuth(), client = useQueryClient();
  const queryKey = [...OKTELL_QUERY, user?.id] as const;
  const query = useQuery({ queryKey, queryFn: ({ signal }) => oktell.state(signal), enabled: !!user, refetchInterval: q => q.state.data?.center_joined ? 20000 : false });
  const state = query.data;
  const sink = useRef<((text: string) => void) | null>(null);
  const onTranscript = useCallback((text: string) => sink.current?.(text), []);
  const speech = useVoiceSpeech({ onTranscript, voicePreferenceKey: `puls:voice-output-auto:${user?.id ?? "account"}` });
  const ringtone = useRef<Ringtone | null>(null);
  const tone = () => (ringtone.current ??= new Ringtone());
  const [notice, setNotice] = useState("");
  const [after, setAfter] = useState<After | null>(null);
  // Folded, the call leaves the work sites visible: only who, how long and the hang-up stay.
  const [folded, setFolded] = useState(false);
  // A refused ring waits until the operator changes something about the line.
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null);
  const sending = useRef(false), first = useRef(true), inCall = useRef(false);
  const voiceCall = state?.active_call?.voice_attempt_id ? state.active_call : null;
  inCall.current = !!voiceCall;

  const command = useCallback(async (action: OktellAction) => {
    const next = await oktell.action({ ...action, request_id: crypto.randomUUID() });
    client.setQueryData(queryKey, next);
    return next;
  }, [client, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browsers play sound only after a gesture: any tap before a call readies the ring and the voice.
  useEffect(() => {
    const unlock = () => { if (inCall.current) return; speech.unlockAudio(); tone().unlock(); };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => { document.removeEventListener("pointerdown", unlock, true); document.removeEventListener("keydown", unlock, true); };
  }, [speech.unlockAudio]);
  useEffect(() => () => ringtone.current?.close(), []);

  const lineKey = state ? [state.center_joined, state.web_phone, state.pause_reason, state.center_mode, state.office_status, state.voice_language].join(":") : "";
  const ready = !!state && readyForCall(state) && !quiet && refused?.key !== lineKey;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(async () => {
      if (sending.current) return;
      sending.current = true;
      try {
        await command(retry ? { action: "ring", retry } : { action: "ring" });
        first.current = false;
        if (retry) onRetryTaken();
      } catch (error) {
        if (retry) { onRetryTaken(); setNotice(`Не удалось повторить момент: ${message(error)}`); }
        else setRefused({ key: lineKey, text: message(error) });
        void query.refetch();
      } finally { sending.current = false; }
    }, retry ? 2500 : nextRingDelay(first.current));
    return () => window.clearTimeout(timer);
  }, [ready, retry?.attempt_id, retry?.turn]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    tone().stop();
    try { await command({ action: "answer" }); tone().beep(); }
    catch (error) { setNotice(message(error)); void query.refetch(); }
    finally { sending.current = false; }
  }, [command]); // eslint-disable-line react-hooks/exhaustive-deps

  // The call rings until it is picked up; the server lets it go to the missed ones in time.
  const ringing = state?.ringing;
  // A call this page heard ring starts with the driver's words; one found going on is resumed.
  const rangHere = useRef<string | null>(null);
  if (ringing) rangHere.current = ringing.id;
  useEffect(() => {
    if (!ringing || !state) return;
    setAfter(null); setNotice("");
    tone().ring();
    const left = Math.min(state.ring_seconds, Math.max(1, (Date.parse(ringing.started_at) + state.ring_seconds * 1000 - Date.now()) / 1000));
    const lapse = window.setTimeout(() => void query.refetch(), left * 1000 + 800);
    const auto = state.auto_answer ? window.setTimeout(() => void answer(), AUTO_ANSWER_MS) : null;
    return () => { tone().stop(); window.clearTimeout(lapse); if (auto !== null) window.clearTimeout(auto); };
  }, [ringing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A call that left the line, answered or not, stays on the softphone with its outcome.
  const line = useRef<string | null>(null);
  const hungUpByDriver = useRef(false);
  useEffect(() => {
    if (!state) return;
    const current = voiceCall?.id ?? ringing?.id ?? null, previous = line.current;
    line.current = current;
    if (!previous || previous === current) return;
    const call = state.calls.find(item => item.id === previous);
    if (!call) return;
    setAfter({ call, byDriver: hungUpByDriver.current });
    hungUpByDriver.current = false;
    if (call.voice_attempt_id) {
      void client.invalidateQueries({ queryKey: voiceKeys.attempt(call.voice_attempt_id) });
      void client.invalidateQueries({ queryKey: voiceKeys.catalog });
      void client.invalidateQueries({ queryKey: ["city"] });
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const hangUp = useCallback(async (byDriver: boolean) => {
    if (sending.current) return;
    sending.current = true;
    hungUpByDriver.current = byDriver;
    speech.cancel();
    try { await command({ action: "call_end" }); }
    catch (error) { hungUpByDriver.current = false; setNotice(message(error)); void query.refetch(); }
    finally { sending.current = false; }
  }, [command, speech.cancel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state?.voice_calls) return null;
  const caller = (call: { number: string; department: string }) => <><strong>Водитель · {call.department}</strong><span className="oktell-call-from">{formatCaller(call.number)}</span></>;
  const ai = !!state.voice_ai;
  const chip = ai && <span className="oktell-call-chip" title="Водителя играет ИИ (Claude)"><Icon name="spark" />ИИ</span>;
  const head = (title: string) => <header><span className="oktell-tiny-logo" aria-hidden="true" /><span>Oktell · {title}</span>{chip}</header>;
  if (voiceCall) return <section className={`oktell-call${folded ? " is-folded" : ""}`} aria-label="Звонок водителя" data-call="voice" data-ai={ai || undefined}>
    <header><span className="oktell-tiny-logo" aria-hidden="true" /><span>Oktell · Входящий звонок</span>{chip}<button type="button" className="oktell-call-fold" aria-expanded={!folded} aria-label={folded ? "Развернуть окно звонка" : "Свернуть окно звонка"} title={folded ? "Развернуть" : "Свернуть"} onClick={() => setFolded(value => !value)}>{folded ? "▴" : "▾"}</button></header>
    <LiveCall key={voiceCall.voice_attempt_id} attemptId={voiceCall.voice_attempt_id!} call={voiceCall} speech={speech} sink={sink} onHangUp={hangUp} caller={caller(voiceCall)} folded={folded} fresh={rangHere.current === voiceCall.id} ai={ai} />
    {notice && <p className="oktell-call-alert" role="alert">{notice}</p>}
  </section>;
  if (ringing) return <section className="oktell-call is-ringing" aria-label="Входящий звонок" data-call="ringing">
    {head("Входящий звонок")}
    <div className="oktell-call-body"><span className="oktell-call-bell" aria-hidden="true"><Icon name="phone" /></span><div className="oktell-call-caller" role="status" aria-live="assertive">{caller(ringing)}<small>{state.auto_answer ? "Автоответ: соединяем…" : "Звонит…"}</small></div></div>
    {ai && <p className="oktell-call-ai"><Icon name="spark" />Водителя играет ИИ (Claude): он поймёт ответ по смыслу и оценит звонок.</p>}
    {!state.auto_answer && <div className="oktell-call-actions"><button type="button" className="oktell-btn oktell-btn--green" data-coach="oktell-answer" onClick={() => void answer()}><Icon name="phone" />Ответить</button></div>}
    {notice && <p className="oktell-call-alert" role="alert">{notice}</p>}
  </section>;
  if (after) {
    const missed = after.call.status === "missed";
    return <section className="oktell-call is-after" aria-label={missed ? "Пропущенный звонок" : "Звонок завершён"} data-call={missed ? "missed" : "ended"}>
      {head(missed ? "Пропущенный звонок" : after.byDriver ? "Водитель завершил звонок" : "Звонок завершён")}
      <div className="oktell-call-body"><div className="oktell-call-caller">{caller(after.call)}<small>{missed ? "Вы не ответили, звонок ушёл другому оператору." : `Разговор ${clock(after.call.duration_seconds)}`}</small></div></div>
      <div className="oktell-call-actions">{after.call.voice_attempt_id && <Link className="oktell-btn oktell-btn--green" to={reviewPath(after.call.voice_attempt_id)}>Разбор звонка →</Link>}<button type="button" className="oktell-btn" onClick={() => setAfter(null)}>Закрыть</button></div>
      <p className="oktell-call-note">{callsBlocked(state) ? `Звонки не поступают: ${lower(callsBlocked(state))}.` : "Следующий водитель позвонит сам. Чтобы звонки не поступали, поставьте паузу."}</p>
    </section>;
  }
  const blocked = callsBlocked(state) || (refused?.key === lineKey ? refused.text : "");
  if (retry) return <section className="oktell-call is-after" aria-label="Повтор момента" data-call="retry">
    {head("Повтор момента")}
    <p className="oktell-call-note">{blocked ? `Водитель позвонит снова, когда звонки начнут поступать. Сейчас: ${lower(blocked)}.` : "Водитель сейчас позвонит снова — с того же места разговора."}</p>
    <div className="oktell-call-actions"><button type="button" className="oktell-btn" onClick={onRetryTaken}>Отменить повтор</button></div>
  </section>;
  if (notice || refused?.key === lineKey) return <section className="oktell-call is-after" aria-label="Звонки водителей" data-call="notice">
    {head("Звонки водителей")}<p className="oktell-call-alert" role="alert">{notice || refused?.text}</p>
    <div className="oktell-call-actions"><button type="button" className="oktell-btn" onClick={() => { setNotice(""); setRefused(null); }}>Понятно</button></div>
  </section>;
  return null;
}

/** One driver on the line: he speaks, then the microphone listens until the operator pauses. */
function LiveCall({ attemptId, call, speech, sink, onHangUp, caller, folded, fresh, ai }: {
  attemptId: number; call: NonNullable<OktellState["active_call"]>; speech: Speech;
  sink: MutableRefObject<((text: string) => void) | null>; onHangUp: (byDriver: boolean) => Promise<void>; caller: React.ReactNode; folded: boolean; fresh: boolean;
  /** Claude takes part in calls now: it speaks for the driver and grades the call. */
  ai: boolean;
}) {
  const client = useQueryClient(), { user } = useAuth();
  const attempt = useQuery({ queryKey: voiceKeys.attempt(attemptId), queryFn: ({ signal }) => voiceTraining.attempt(attemptId, signal), retry: 1 });
  const config = useQuery({ queryKey: voiceKeys.speechConfig(user?.id ?? "account"), queryFn: ({ signal }) => voiceTraining.speechConfig(signal), retry: false, staleTime: 60000 });
  const provider = resolveVoiceProvider(config.data), cloud = config.data?.providers.find(item => item.id === provider) ?? null;
  const current = attempt.data;
  const [phase, setPhase] = useState<Phase>("connecting");
  const [heard, setHeard] = useState(""), [typed, setTyped] = useState(""), [textMode, setTextMode] = useState(!speech.support.recognition);
  const [failed, setFailed] = useState<{ request_id: string; turn: number; text: string; problem: string } | null>(null);
  const [tries, setTries] = useState(0);
  const [now, setNow] = useState(Date.now()), [registration, setRegistration] = useState(""), [checking, setChecking] = useState(""), [ending, setEnding] = useState(false);
  const heardRef = useRef(""), lastWord = useRef(0), spoken = useRef(""), generation = useRef(0), misses = useRef(0), wasRecording = useRef(false), closing = useRef(false);
  // A call already going on when the page opens again: the driver is not made to repeat himself.
  const resumed = useRef(!fresh);
  sink.current = text => { heardRef.current = text; lastWord.current = Date.now(); setHeard(text); };
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { generation.current += 1; sink.current = null; speech.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastDriver = current?.transcript.filter(item => item.role === "driver").at(-1);
  const spokenKey = current && lastDriver ? `${current.id}:${lastDriver.turn}:${current.transcript.length}` : "";
  const settled = (value: VoiceAttempt): Phase => value.can_finish || value.turn >= 24 ? "resolved" : "listening";
  const playDriver = useCallback((value: VoiceAttempt, turn: number, text: string) => speech.speak(text, value.persona,
    cloud ? { label: cloud.label, cacheKey: `${cloud.id}:${cloud.voice}:attempt:${value.id}:${turn}`, load: signal => voiceTraining.speech(value.id, cloud.id, turn, signal) } : undefined,
    { language: value.language }), [speech.speak, cloud?.id, cloud?.voice]); // eslint-disable-line react-hooks/exhaustive-deps

  // The driver speaks each new line once; then the operator's turn (or the end of the call).
  useEffect(() => {
    if (!current || current.state !== "in_progress" || !lastDriver || config.isPending || spoken.current === spokenKey) return;
    spoken.current = spokenKey;
    // Водитель ответил: значит, ответ, который казался неотправленным, дошёл.
    setFailed(null);
    if (resumed.current) { resumed.current = false; setPhase(settled(current)); return; }
    const mine = ++generation.current;
    setPhase("driver");
    void playDriver(current, lastDriver.turn, lastDriver.text).then(() => { if (generation.current === mine) setPhase(settled(current)); });
  }, [spokenKey, config.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text: string, again?: { request_id: string; turn: number }) => {
    if (!current || closing.current) return;
    // Сервер не принимает лишних полей: из прошлой попытки берём только её номер и ход.
    const input = again ? { request_id: again.request_id, turn: again.turn, text } : { request_id: crypto.randomUUID(), turn: current.turn, text };
    setPhase("sending"); setFailed(null);
    try {
      const next = await voiceTraining.answer(current.id, input);
      client.setQueryData(voiceKeys.attempt(next.id), next);
      heardRef.current = ""; setHeard(""); setTyped(""); speech.resetTranscript();
    } catch (error) {
      setFailed({ ...input, problem: message(error) }); setPhase("failed");
      void attempt.refetch();
    }
  }, [current, client, speech.resetTranscript]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live listening: the microphone opens after the driver and reopens after silence without words.
  const listening = phase === "listening" && !textMode && !speech.muted && !ending;
  useEffect(() => {
    if (!listening || speech.recording || !current) return;
    const timer = window.setTimeout(async () => {
      heardRef.current = ""; setHeard("");
      const started = await speech.startRecording(current.language ?? "ru");
      misses.current = started ? 0 : misses.current + 1;
      // No microphone, no permission or no recognition: the answer is typed instead.
      if (!started && (!speech.support.recognition || misses.current >= 3)) setTextMode(true);
      else if (!started) setTries(value => value + 1);
    }, misses.current ? 900 : 250);
    return () => window.clearTimeout(timer);
  }, [listening, speech.recording, current?.id, tries]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== "listening" || !speech.recording) return;
    const timer = window.setInterval(() => { if (answerReady(heardRef.current, lastWord.current, Date.now())) speech.stopRecording(); }, 250);
    return () => window.clearInterval(timer);
  }, [phase, speech.recording, speech.stopRecording]);
  useEffect(() => {
    if (speech.recording) { wasRecording.current = true; return; }
    if (!wasRecording.current) return;
    wasRecording.current = false;
    const text = heardRef.current.trim();
    if (phase === "listening" && text.length >= 2 && !closing.current) void send(text);
  }, [speech.recording]); // eslint-disable-line react-hooks/exhaustive-deps

  // The driver who got his answer says goodbye and hangs up if the operator keeps the line.
  useEffect(() => {
    if (phase !== "resolved") return;
    const timer = window.setTimeout(() => { closing.current = true; setEnding(true); void onHangUp(true).finally(() => setEnding(false)); }, DRIVER_HANGS_UP_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onHangUp]);

  const hangUp = () => { if (ending) return; closing.current = true; heardRef.current = ""; setEnding(true); void onHangUp(false).finally(() => { closing.current = false; setEnding(false); }); };
  const repeat = () => {
    if (!current || !lastDriver || phase === "sending" || ending) return;
    heardRef.current = ""; setHeard("");
    const mine = ++generation.current;
    setPhase("driver");
    void playDriver(current, lastDriver.turn, lastDriver.text).then(() => { if (generation.current === mine) setPhase(settled(current)); });
  };
  // Сначала выключаем микрофон, потом стираем услышанное: выключение само дописывает
  // недоговорённую фразу, и иначе она ушла бы водителю.
  const mute = () => { speech.setMuted(!speech.muted); heardRef.current = ""; setHeard(""); };
  const typedAnswer = (event: FormEvent) => { event.preventDefault(); const text = typed.trim(); if (text.length >= 2 && (phase === "listening" || phase === "failed")) void send(text); };
  const compare = async (event: FormEvent) => {
    event.preventDefault();
    if (!current || !registration.trim() || checking === "…") return;
    setChecking("…");
    try {
      const next = await voiceTraining.inspect(current.id, { system: "compare", driver_id: current.driver.id, park_id: current.driver.park_id, incoming_phone: current.incoming_phone, registration_phone: registration });
      client.setQueryData(voiceKeys.attempt(next.id), next); setChecking("");
    } catch (error) { setChecking(message(error)); }
  };

  const aiOn = ai || !!current?.ai_driver;
  // The driver answered with a prepared line although Claude was expected: it did not answer in time.
  const prepared = aiOn && !!lastDriver && lastDriver.turn > 0 && !lastDriver.ai;
  const status = ending ? aiOn ? "ИИ оценивает звонок…" : "Завершаем звонок…" : phase === "connecting" ? "Соединение…" : phase === "driver" ? speech.loadingAudio ? "Водитель на линии…" : "Говорит водитель"
    : phase === "sending" ? aiOn ? "ИИ готовит ответ водителя…" : "Водитель слушает…" : phase === "failed" ? "Ответ не отправлен"
      : phase === "resolved" ? "Водитель всё понял. Завершите звонок"
        : textMode ? "Напишите ответ водителю" : speech.muted ? "Микрофон выключен" : speech.recording ? "Говорите — водитель слушает" : "Включаем микрофон…";
  return <>
    <div className="oktell-call-body">
      <span className={`oktell-call-bell${phase === "driver" ? " is-speaking" : speech.recording ? " is-listening" : ""}`} aria-hidden="true"><Icon name={speech.recording ? "mic" : "phone"} /></span>
      <div className="oktell-call-caller">{caller}<small className="oktell-call-status" role="status" aria-live="polite">{status}</small></div>
      <time className="oktell-call-time">{clock((now - Date.parse(call.started_at)) / 1000)}</time>
    </div>
    {attempt.isError && <p className="oktell-call-alert" role="alert">{message(attempt.error)} <button type="button" className="oktell-link" onClick={() => void attempt.refetch()}>Повторить</button></p>}
    {!folded && <>
    {aiOn && <p className="oktell-call-ai"><Icon name="spark" />{prepared ? "ИИ не успел ответить — водитель сказал заготовленную фразу. Продолжайте разговор." : "Водителя играет ИИ (Claude): отвечайте своими словами, он поймёт по смыслу и оценит звонок."}</p>}
    {phase === "listening" && !textMode && heard && <p className="oktell-call-heard"><span>Вы:</span> {heard}</p>}
    {failed && <p className="oktell-call-alert" role="alert">{failed.problem} <button type="button" className="oktell-link" onClick={() => void send(failed.text, failed)}>Отправить ещё раз</button></p>}
    {textMode && (phase === "listening" || phase === "failed") && <form className="oktell-call-text" onSubmit={typedAnswer}>
      <label htmlFor="oktell-call-answer">Ответ водителю</label>
      <div><input id="oktell-call-answer" value={typed} onChange={event => setTyped(event.target.value)} maxLength={4000} autoComplete="off" placeholder="Что вы говорите водителю" /><button type="submit" className="oktell-btn oktell-btn--green" disabled={typed.trim().length < 2}>Сказать</button></div>
      {!speech.support.recognition ? <small>В этом браузере нет распознавания речи — отвечайте текстом.</small> : speech.error && <small>{speech.error}</small>}
    </form>}
    <div className="oktell-call-tools">
      <button type="button" className="oktell-btn" aria-pressed={speech.muted} disabled={textMode || !speech.support.recognition} onClick={mute}><Icon name={speech.muted ? "muted" : "mic"} />{speech.muted ? "Включить микрофон" : "Микрофон"}</button>
      <button type="button" className="oktell-btn" disabled={!lastDriver || phase === "sending" || ending} onClick={repeat}><Icon name="repeat" />Повторить</button>
      {speech.support.recognition && <button type="button" className="oktell-btn" aria-pressed={textMode} onClick={() => { if (!textMode) speech.cancel(); heardRef.current = ""; setHeard(""); setTextMode(!textMode); }}><Icon name="keyboard" />{textMode ? "Голосом" : "Текстом"}</button>}
    </div>
    {current && !current.custom && <details className="oktell-call-check" open={current.practice.dispatch && !current.practice.compared || undefined}>
      <summary>Сверка номеров{current.practice.compared ? " ✓" : ""}</summary>
      {current.practice.compared ? <p>Сверка сохранена: номер звонка отличается от регистрационного.</p>
        : current.practice.dispatch ? <form onSubmit={compare}><label htmlFor="oktell-call-registration">Номер регистрации из карточки водителя</label><div><input id="oktell-call-registration" type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={registration} onChange={event => setRegistration(event.target.value)} placeholder="+7…" /><button type="submit" className="oktell-btn" disabled={!registration.trim() || checking === "…"}>Сверить</button></div>{checking && checking !== "…" && <small role="alert">{checking}</small>}</form>
          : <p>Найдите водителя в «Диспетчерской» и откройте его карточку: номер регистрации — там.</p>}
    </details>}
    {current && <details className="oktell-call-transcript" open={(!cloud && !speech.support.synthesis) || undefined}>
      <summary>Текст разговора</summary>
      <ol>{current.transcript.map((item, index) => <li key={`${index}:${item.turn}`} className={item.role === "operator" ? "is-operator" : undefined}><span>{item.role === "driver" ? item.ai ? "Водитель · ИИ" : "Водитель" : "Вы"}</span>{item.text}</li>)}</ol>
    </details>}
    </>}
    <div className="oktell-call-actions"><button type="button" className="oktell-btn oktell-btn--red" data-coach="oktell-voice-hangup" disabled={ending} onClick={hangUp}><Icon name="end" />Завершить звонок</button></div>
    {phase === "resolved" && !folded && <p className="oktell-call-note">Если вы не завершите звонок, водитель положит трубку сам.</p>}
  </>;
}
