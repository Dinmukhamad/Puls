import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { voiceKeys, voiceTraining, voiceWorkSite, type VoiceAttempt, type VoiceAttemptSummary, type VoicePersona } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import { useVoiceSpeech } from "./useVoiceSpeech";
import { VoiceMentorReviews } from "./VoiceMentorReviews";
import "./voice.css";

const personas: { key: VoicePersona; label: string; hint: string; symbol: string }[] = [
  { key: "calm", label: "Спокойный", hint: "Слушает и уточняет", symbol: "◡" },
  { key: "confused", label: "Растерянный", hint: "Нуждается в ясности", symbol: "?" },
  { key: "hurried", label: "Торопящийся", hint: "Хочет решить быстрее", symbol: "↗" },
  { key: "irritated", label: "Раздражённый", hint: "Возражает и спорит", symbol: "!" },
];
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось сохранить действие. Повторите попытку.";
const personaLabel = (key: VoicePersona) => personas.find(item => item.key === key)?.label ?? key;
const attemptRoute = (id: number) => `/training/voice/attempts/${id}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" }).format(new Date(value));
type DraftRequest = { request_id: string; turn: number; text: string };
type IconName = "mic" | "muted" | "play" | "repeat" | "arrow" | "check" | "stop" | "headphones" | "external";

function VoiceIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    muted: <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.3 2M12 19v3M8 22h8" /></>,
    play: <path d="m9 5 11 7-11 7Z" />,
    repeat: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="2" y="12" width="5" height="9" rx="2" /><rect x="17" y="12" width="5" height="9" rx="2" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function VoiceOrb({ active = false, recording = false, compact = false }: { active?: boolean; recording?: boolean; compact?: boolean }) {
  return <div className={`voice-orb ${active ? "is-active" : ""} ${recording ? "is-recording" : ""} ${compact ? "is-compact" : ""}`} aria-hidden="true">
    <div className="voice-orb-ring" /><div className="voice-orb-core"><div className="voice-wave">{[12, 24, 37, 51, 29, 62, 43, 25, 13].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -.13}s` }} />)}</div></div>
  </div>;
}

export function VoiceTrainingPage() {
  const { attemptId } = useParams(), navigate = useNavigate(), client = useQueryClient(), { user } = useAuth();
  const [persona, setPersona] = useState<VoicePersona>("irritated"), [scenarioKey, setScenarioKey] = useState("phone_change");
  const [draft, setDraft] = useState(""), [textMode, setTextMode] = useState(false), [reviewing, setReviewing] = useState(false);
  const [reviewComment, setReviewComment] = useState(""), [reviewOpen, setReviewOpen] = useState(false);
  const requestRef = useRef<DraftRequest | null>(null), actionLock = useRef(false), spokenRef = useRef("");
  const activeAttemptRef = useRef(attemptId), inputKeyRef = useRef("");
  activeAttemptRef.current = attemptId;
  const catalog = useQuery({ queryKey: voiceKeys.catalog, queryFn: ({ signal }) => voiceTraining.catalog(signal), enabled: !attemptId, retry: false, staleTime: 0, refetchOnMount: "always" });
  const attempt = useQuery({ queryKey: voiceKeys.attempt(attemptId ?? ""), queryFn: ({ signal }) => voiceTraining.attempt(attemptId!, signal), enabled: !!attemptId, retry: false, refetchOnWindowFocus: true });
  const current = attempt.data;
  const draftKey = current ? `voice-draft:${user?.id ?? "account"}:${current.id}:${current.turn}` : "";
  const saveDraft = useCallback((text: string) => {
    setDraft(text);
    if (requestRef.current?.text !== text.trim()) requestRef.current = null;
    if (draftKey) try { sessionStorage.setItem(draftKey, JSON.stringify({ text, request: requestRef.current })); } catch { /* The conversation still works with browser storage disabled. */ }
  }, [draftKey]);
  const onTranscript = useCallback((text: string) => { if (inputKeyRef.current === draftKey) saveDraft(text); }, [draftKey, saveDraft]);
  const speech = useVoiceSpeech({ onTranscript });
  const { speak, stopSpeaking, stopRecording, cancel } = speech;
  useEffect(() => {
    let text = "";
    requestRef.current = null;
    if (draftKey) try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as { text?: string; request?: DraftRequest } | null;
      text = typeof saved?.text === "string" ? saved.text : "";
      const savedRequest = saved?.request;
      if (savedRequest && savedRequest.turn === current?.turn && savedRequest.text === text.trim()) requestRef.current = savedRequest;
    } catch { /* An unavailable draft never prevents restoring the server attempt. */ }
    setDraft(text); setReviewing(!!text); setReviewOpen(false); setReviewComment("");
  }, [draftKey, current?.turn]);

  const saveAttempt = (value: VoiceAttempt) => {
    client.setQueryData(voiceKeys.attempt(value.id), value);
    void client.invalidateQueries({ queryKey: voiceKeys.catalog });
  };
  const start = useMutation({ mutationFn: () => voiceTraining.start(scenarioKey, persona), onSuccess: value => { saveAttempt(value); navigate(attemptRoute(value.id)); }, onSettled: () => { actionLock.current = false; } });
  const answer = useMutation({ mutationFn: (input: DraftRequest) => voiceTraining.answer(attemptId!, input), onSuccess: (value, input) => {
    try { sessionStorage.removeItem(`voice-draft:${user?.id ?? "account"}:${value.id}:${input.turn}`); } catch { /* Optional draft. */ }
    if (activeAttemptRef.current === String(value.id)) {
      requestRef.current = null; setDraft(""); setReviewing(false); speech.resetTranscript();
    }
    saveAttempt(value);
  }, onSettled: () => { actionLock.current = false; } });
  const finish = useMutation({ mutationFn: () => voiceTraining.finish(attemptId!), onSuccess: saveAttempt, onSettled: () => { actionLock.current = false; } });
  const retry = useMutation({ mutationFn: (turn: number) => voiceTraining.retry(attemptId!, turn), onSuccess: value => { cancel(); saveAttempt(value); spokenRef.current = ""; navigate(attemptRoute(value.id)); }, onSettled: () => { actionLock.current = false; } });
  const review = useMutation({ mutationFn: () => voiceTraining.review(attemptId!, reviewComment.trim()), onSuccess: value => { saveAttempt(value); setReviewOpen(false); setReviewComment(""); } });
  const pending = start.isPending || answer.isPending || finish.isPending || retry.isPending;
  const mutationError = start.error || answer.error || finish.error || retry.error || review.error;
  const lastDriver = current?.transcript.filter(item => item.role === "driver").at(-1);
  const spokenKey = current && lastDriver ? `${current.id}:${lastDriver.turn}:${lastDriver.text}` : "";

  useEffect(() => {
    inputKeyRef.current = ""; cancel(); actionLock.current = false;
    start.reset(); answer.reset(); finish.reset(); retry.reset(); review.reset();
  }, [attemptId, cancel]);
  useEffect(() => {
    if (!current || current.state !== "in_progress" || !lastDriver || !speech.support.synthesis || spokenRef.current === spokenKey) return;
    spokenRef.current = spokenKey;
    void speak(lastDriver.text);
    return () => { spokenRef.current = ""; stopSpeaking(); };
  }, [spokenKey, current?.state, speech.support.synthesis, speak, stopSpeaking]); // Saved inspections do not replay the same driver line.

  const beginRecording = async () => {
    if (pending || current?.can_finish || speech.speaking || speech.recording || speech.muted) return;
    inputKeyRef.current = draftKey;
    setReviewing(false); speech.clearError();
    const started = await speech.startRecording();
    if (!started) setReviewing(!!draft);
  };
  const endRecording = () => { stopRecording(); setReviewing(true); };
  const submitAnswer = () => {
    if (!current || current.can_finish || actionLock.current || pending || speech.recording || !draft.trim()) return;
    const input = requestRef.current?.turn === current.turn && requestRef.current.text === draft.trim()
      ? requestRef.current : { request_id: crypto.randomUUID(), turn: current.turn, text: draft.trim() };
    requestRef.current = input;
    if (draftKey) try { sessionStorage.setItem(draftKey, JSON.stringify({ text: draft, request: input })); } catch { /* Server request IDs still protect double submission. */ }
    actionLock.current = true; stopSpeaking(); answer.mutate(input);
  };
  const finishAttempt = () => {
    if (actionLock.current || pending || speech.recording) return;
    actionLock.current = true; cancel(); speech.clearError(); finish.mutate();
  };
  const retryTurn = (turn: number) => {
    if (actionLock.current || pending) return;
    actionLock.current = true; retry.mutate(turn);
  };
  const query = attemptId ? attempt : catalog;
  const selectedScenario = catalog.data?.scenarios.find(item => item.key === scenarioKey);
  const status = answer.isPending || finish.isPending ? "Обрабатываем ответ" : speech.speaking ? "Водитель говорит" : speech.recording ? "Твой ответ · идёт запись" : reviewing && draft ? "Твой ответ · проверь текст" : "Твой ответ";

  return <main className="voice-page">
    <header className="voice-page-top"><Link className="voice-back" to={attemptId ? "/training/voice" : "/training/city?city=support&district=scenarios"}>← {attemptId ? "Все тренировки" : "Обучение"}</Link><span className="voice-pilot"><i /> Голосовой тренажёр · пилот</span></header>
    {query.isPending && <section className="voice-panel voice-loading" role="status"><VoiceOrb compact /><p>Готовим пространство для разговора…</p></section>}
    {query.isError && <section className="voice-panel voice-error" role="alert"><h1>Не удалось открыть тренировку</h1><p>{errorText(query.error)}</p><button className="voice-button" onClick={() => void query.refetch()}>Попробовать снова</button></section>}
    {!attemptId && catalog.data && <>
      <section className="voice-intro"><div><span className="voice-eyebrow">ПРАКТИКА ПОДДЕРЖКИ</span><h1>Сложный разговор.<br /><span>Спокойный ответ.</span></h1><p>Водитель говорит голосом. Ты отвечаешь своими словами, проверяешь данные и помогаешь выбрать следующий шаг.</p><div className="voice-intro-pills"><span><VoiceIcon name="headphones" size={16} /> В своём темпе</span><span>По очереди</span><span>Разбор после звонка</span></div></div><div className="voice-intro-art"><VoiceOrb active /><span className="voice-art-caption">Место, где можно ошибаться<br />и пробовать снова</span></div></section>
      <div className="voice-setup-grid"><section className="voice-panel voice-setup"><div className="voice-section-heading"><span className="voice-step">01</span><div><h2>Выбери ситуацию</h2><p>Решение появится в разборе после разговора</p></div></div>
        <fieldset className="voice-scenarios"><legend className="voice-sr-only">Сценарий тренировки</legend>{catalog.data.scenarios.map(item => <label className={`voice-scenario ${scenarioKey === item.key ? "is-selected" : ""}`} key={item.key}><input type="radio" name="voice-scenario" checked={scenarioKey === item.key} onChange={() => setScenarioKey(item.key)} /><span className="voice-scenario-symbol"><VoiceIcon name="mic" /></span><span><strong>{item.title}</strong><small>{item.description}</small><span className="voice-tag">Около {item.minutes} минут</span></span><span className="voice-radio-mark" aria-hidden="true">{scenarioKey === item.key && <VoiceIcon name="check" size={14} />}</span></label>)}</fieldset>
        <div className="voice-section-heading voice-persona-heading"><span className="voice-step">02</span><div><h2>Каким будет водитель?</h2><p>Одна ситуация, разные характеры</p></div></div><fieldset className="voice-personas"><legend className="voice-sr-only">Характер водителя</legend>{personas.map(item => <label className={`voice-persona ${persona === item.key ? "is-selected" : ""}`} key={item.key}><input type="radio" name="voice-persona" checked={persona === item.key} onChange={() => setPersona(item.key)} /><span className="voice-persona-symbol" aria-hidden="true">{item.symbol}</span><strong>{item.label}</strong><small>{item.hint}</small></label>)}</fieldset>
      </section><aside className="voice-panel voice-ready"><span className="voice-eyebrow">ПЕРЕД ЗВОНКОМ</span><h2>Настройся на разговор</h2><ol className="voice-ready-list"><li><span>1</span><p>Найди тихое место.<small>Наушники помогут слышать водителя.</small></p></li><li><span>2</span><p>Проверь микрофон.<small>Ответ можно просмотреть до отправки.</small></p></li><li><span>3</span><p>Отвечай своими словами.<small>Данные доступны в учебных системах.</small></p></li></ol>
        <button className={`voice-button voice-mic-check ${speech.micChecked ? "is-checked" : ""}`} disabled={speech.checkingMic || !speech.support.microphone} onClick={() => void speech.checkMicrophone()}><VoiceIcon name={speech.micChecked ? "check" : "mic"} />{speech.checkingMic ? "Проверяем микрофон…" : speech.micChecked ? "Микрофон доступен" : "Проверить микрофон"}</button>
        {speech.micChecked && <p className="voice-caption" role="status">{speech.micSignal === "quiet" ? "Сигнал тихий. Проверь громкость или попробуй говорить ближе к микрофону." : speech.micSignal === "detected" ? "Слышим тебя. Можно начинать." : "Доступ получен. Если распознавание не сработает, введи ответ текстом."}</p>}
        {!speech.support.recognition && <p className="voice-caption">В этом браузере нет распознавания речи. Тренировку можно пройти с текстовыми ответами.</p>}
        <button className="voice-button voice-button--primary voice-start" disabled={pending || !selectedScenario} onClick={() => { if (!actionLock.current) { actionLock.current = true; start.mutate(); } }}><VoiceIcon name="play" />{start.isPending ? "Начинаем…" : "Начать разговор"}<VoiceIcon name="arrow" size={18} /></button>
        <p className="voice-privacy">Распознавание выполняет браузер и его голосовой сервис. На сервер тренажёра отправляется проверенный текст ответа.</p>
      </aside></div>
      <VoiceHistory attempts={catalog.data.attempts} />
      {user && user.role !== "operator" && user.role !== "trainee" && <VoiceMentorReviews />}
      <div className="voice-pilot-note"><VoiceIcon name="headphones" /><p><strong>Учимся объяснять, а не читать скрипт.</strong> Пилот проверяет содержание ответов по правилам учебного сценария. Интонация и темп речи не оцениваются.</p></div>
    </>}
    {attemptId && current && <>
      <div className="voice-attempt-heading"><div><span className="voice-eyebrow">УЧЕБНЫЙ ЗВОНОК</span><h1>{current.title}</h1></div><span className="voice-tag">{personaLabel(current.persona)} водитель</span></div>
      {current.state === "in_progress" ? <div className="voice-call-grid"><section className="voice-panel voice-conversation" aria-label="Разговор с водителем"><div className="voice-conversation-top"><span className="voice-live-dot" /> Учебная линия <span>Реплика {current.turn + 1}</span></div><div className="voice-speaker"><VoiceOrb active={speech.speaking || speech.recording} recording={speech.recording} /><span className="voice-eyebrow">{speech.recording ? "ОПЕРАТОР" : "ВОДИТЕЛЬ"}</span><h2>{speech.recording ? "Слушаем тебя" : current.driver.name.split(" ").slice(0, 2).join(" ")}</h2><p className={`voice-status ${speech.recording ? "is-recording" : ""}`} role="status" aria-live="polite">{status}</p></div>
        {current.can_finish && <div className="voice-resolved" role="status"><VoiceIcon name="check" /><p>Водителю понятен следующий шаг.<br /><small>Заверши тренировку, чтобы посмотреть разбор.</small></p></div>}
        <div className="voice-call-controls"><button className={`voice-button voice-answer ${speech.recording ? "is-recording" : "voice-button--primary"}`} disabled={pending || speech.speaking || (!speech.recording && (current.can_finish || speech.muted || !speech.support.recognition))} onClick={() => speech.recording ? endRecording() : void beginRecording()}><VoiceIcon name={speech.recording ? "stop" : "mic"} />{speech.recording ? "Завершить запись" : draft ? "Перезаписать ответ" : "Ответить"}</button><div className="voice-secondary-controls"><button className="voice-icon-button" title={speech.speaking ? "Остановить озвучку" : "Повторить реплику"} aria-label={speech.speaking ? "Остановить озвучку" : "Повторить реплику"} disabled={pending || speech.recording || !lastDriver || !speech.support.synthesis} onClick={() => speech.speaking ? stopSpeaking() : lastDriver && void speak(lastDriver.text)}><VoiceIcon name={speech.speaking ? "stop" : "repeat"} /></button><button className={`voice-icon-button ${speech.muted ? "is-muted" : ""}`} title={speech.muted ? "Включить микрофон" : "Выключить микрофон"} aria-label={speech.muted ? "Включить микрофон" : "Выключить микрофон"} aria-pressed={speech.muted} disabled={pending || !speech.support.recognition} onClick={() => { speech.setMuted(!speech.muted); if (speech.recording) setReviewing(true); }}><VoiceIcon name={speech.muted ? "muted" : "mic"} /></button></div></div>
        {speech.recording && <p className="voice-record-hint" role="status">{speech.interimTranscript || "Говори, затем нажми «Завершить запись»."}</p>}
        {speech.muted && <p className="voice-caption voice-center">Микрофон выключен. Включи его или введи ответ текстом.</p>}
        {!speech.support.synthesis && <p className="voice-caption voice-center">Озвучка недоступна. Реплика водителя есть в расшифровке ниже.</p>}
        {!current.can_finish && (draft || reviewing || textMode || !speech.support.recognition) && <form className="voice-answer-review" onSubmit={event => { event.preventDefault(); submitAnswer(); }}><div className="voice-review-heading"><label htmlFor="voice-answer-text">{speech.recording ? "Распознаём ответ" : "Проверь ответ перед отправкой"}</label><span>Водитель ещё не слышит этот текст</span></div><textarea id="voice-answer-text" value={draft} maxLength={4000} rows={4} disabled={pending || speech.recording} onChange={event => saveDraft(event.target.value)} placeholder="Напиши, что ты скажешь водителю…" /><div className="voice-review-actions"><span>{draft.length}/4000</span><button className="voice-button voice-button--primary" type="submit" disabled={pending || speech.recording || speech.speaking || !draft.trim()}>{answer.isPending ? "Обрабатываем…" : "Отправить ответ"}<VoiceIcon name="arrow" size={17} /></button></div></form>}
        {!current.can_finish && !speech.recording && !textMode && speech.support.recognition && !draft && <button className="voice-text-toggle" onClick={() => { setTextMode(true); setReviewing(true); }}>Ввести ответ текстом</button>}
        <VoiceTranscriptView attempt={current} forceOpen={!speech.support.synthesis} />
        <div className="voice-finish-row"><p>Прогресс и отправленные ответы сохраняются в аккаунте.{draft && <small>Неотправленный черновик не попадёт в разбор.</small>}</p><button className="voice-finish" disabled={pending || speech.recording} onClick={finishAttempt}>{finish.isPending ? "Сохраняем…" : "Завершить тренировку"}</button></div>
      </section><VoiceSituation attempt={current} /></div> : <VoiceResults attempt={current} pending={pending} onRetry={retryTurn} reviewOpen={reviewOpen} onReviewOpen={() => setReviewOpen(true)} reviewComment={reviewComment} onReviewComment={setReviewComment} reviewing={review.isPending} onReview={() => review.mutate()} onReviewCancel={() => setReviewOpen(false)} />}
      <p className="voice-assessment-note">Учебный пилот: содержание ответов оценивается по правилам сценария, действия — по сохранённым событиям. Интонация и темп речи не оцениваются.</p>
    </>}
    {speech.error && <section className="voice-panel voice-speech-error" role="alert"><strong>Не удалось использовать голос</strong><p>{speech.error}</p><div className="voice-inline-actions"><button className="voice-button" disabled={pending || speech.recording || speech.checkingMic || !speech.support.microphone} onClick={() => void speech.checkMicrophone()}>Проверить микрофон снова</button>{attemptId && current?.state === "in_progress" && <button className="voice-button" onClick={() => { setTextMode(true); setReviewing(true); speech.clearError(); }}>Продолжить текстом</button>}<button className="voice-text-toggle" onClick={speech.clearError}>Закрыть</button></div><small>Текущий этап разговора сохранён.</small></section>}
    {mutationError && <section className="voice-panel voice-error" role="alert"><strong>Действие не подтверждено</strong><p>{errorText(mutationError)}</p><p>Отправленный ответ мог сохраниться. Проверь прогресс перед повторной отправкой; черновик останется доступен.</p>{attemptId && <button className="voice-button" disabled={attempt.isFetching} onClick={() => void attempt.refetch()}>Проверить сохранённый прогресс</button>}</section>}
  </main>;
}

export function VoiceHistory({ attempts }: { attempts: VoiceAttemptSummary[] }) {
  if (!attempts.length) return <section className="voice-empty-history"><span className="voice-history-icon"><VoiceIcon name="repeat" /></span><div><h2>Здесь будет твой опыт</h2><p>Разговоры и результаты сохранятся в аккаунте. Незавершённую тренировку можно продолжить.</p></div></section>;
  return <section className="voice-history"><div className="voice-history-title"><h2>Мои попытки</h2><span>{attempts.length}</span></div><div className="voice-history-list">{attempts.map(item => <Link key={item.id} to={attemptRoute(item.id)} className="voice-history-item"><span className={`voice-history-icon ${item.state === "completed" ? "is-done" : ""}`}><VoiceIcon name={item.state === "completed" ? "check" : "play"} /></span><span className="voice-history-name"><strong>{item.title}</strong><small>{personaLabel(item.persona)} · {dateLabel(item.created_at)}</small></span><span className="voice-history-state">{item.state === "completed" ? `${item.score ?? 0}%` : "Продолжить"}{item.review_status && <small>{item.review_status === "reviewed" ? "Наставник ответил" : "Запрос на пересмотр"}</small>}</span><VoiceIcon name="arrow" size={18} /></Link>)}</div></section>;
}

export function VoiceSituation({ attempt }: { attempt: VoiceAttempt }) {
  return <aside className="voice-context"><section className="voice-panel voice-situation"><span className="voice-eyebrow">СИТУАЦИЯ</span><h2>Входящий звонок</h2><p>{attempt.description}</p><dl><div><dt>Водитель</dt><dd>{attempt.driver.name}</dd></div><div><dt>Номер звонящего</dt><dd className="voice-phone">{attempt.incoming_phone}</dd></div><div><dt>Парк</dt><dd>{attempt.driver.park}</dd></div>{attempt.practice.dispatch && <div><dt>Номер в открытом аккаунте</dt><dd className="voice-phone">{attempt.driver.phone}</dd></div>}</dl>
    {attempt.practice.dispatch && attempt.practice.oktell && <div className="voice-compare">{attempt.practice.compared ? <p><VoiceIcon name="check" size={17} /> Сравнение номеров сохранено</p> : <><p>Данные из обеих систем открыты. Сверь их и зафиксируй сравнение.</p><Link className="voice-button" to={voiceWorkSite(attempt, "oktell")}>Сверить номера в системе</Link></>}</div>}
  </section><section className="voice-panel voice-systems"><span className="voice-eyebrow">УЧЕБНЫЕ СИСТЕМЫ</span><h2>Данные для разговора</h2><p>Открой нужную систему. Вернуться к звонку можно без потери этапа.</p>{([{ key: "dispatch", label: "Диспетчерская", hint: "Найти аккаунт водителя", done: attempt.practice.dispatch }, { key: "oktell", label: "OKTEL", hint: "Проверить данные звонка", done: attempt.practice.oktell }, { key: "crm", label: "CRM", hint: "Учебные обращения", done: false }] as const).map(item => <Link className="voice-system-link" to={voiceWorkSite(attempt, item.key)} key={item.key}><span className={`voice-system-icon ${item.done ? "is-done" : ""}`}><VoiceIcon name={item.done ? "check" : item.key === "oktell" ? "headphones" : "external"} size={18} /></span><span><strong>{item.label}</strong><small>{item.done ? "Просмотр сохранён" : item.hint}</small></span><VoiceIcon name="arrow" size={16} /></Link>)}<small className="voice-caption">Действия засчитываются после просмотра нужных данных в системе. Для рабочих сайтов нужен действующий учебный доступ.</small></section><div className="voice-context-note"><span>↳</span><p>Не торопись. Можно повторить реплику и собрать данные до ответа.</p></div></aside>;
}

function VoiceTranscriptView({ attempt, forceOpen = false }: { attempt: VoiceAttempt; forceOpen?: boolean }) {
  return <details className="voice-transcript" open={forceOpen || undefined}><summary><span>Расшифровка разговора</span><span>{attempt.transcript.length} реплик</span></summary><ol>{attempt.transcript.map((item, index) => <li className={item.role === "operator" ? "is-operator" : ""} key={`${index}:${item.turn}`}><span>{item.role === "driver" ? "Водитель" : "Ты"}<small>Реплика {item.turn + 1}</small></span><p>{item.text}</p></li>)}</ol></details>;
}

export function VoiceResults({ attempt, pending, onRetry, reviewOpen, onReviewOpen, reviewComment, onReviewComment, reviewing, onReview, onReviewCancel }: {
  attempt: VoiceAttempt; pending: boolean; onRetry: (turn: number) => void;
  reviewOpen: boolean; onReviewOpen: () => void; reviewComment: string; onReviewComment: (value: string) => void;
  reviewing: boolean; onReview: () => void; onReviewCancel: () => void;
}) {
  const result = attempt.result;
  if (!result) return <section className="voice-panel"><h2>Разговор сохранён</h2><p>Результат пока недоступен. Обнови страницу, чтобы проверить его.</p></section>;
  const passed = result.criteria.filter(item => item.passed).length;
  const firstOperator = attempt.transcript.find(item => item.role === "operator");
  return <div className="voice-results"><section className="voice-panel voice-result-hero"><div><span className="voice-eyebrow">РАЗБОР РАЗГОВОРА</span><h2>{result.critical_errors.length ? "Есть важный момент для разбора" : passed === result.criteria.length ? "Разговор получился" : "Хорошая основа для следующей попытки"}</h2><p>{passed} из {result.criteria.length} критериев выполнено. Оценка относится к содержанию ответов и проверенным действиям.</p><div className="voice-inline-actions"><Link className="voice-button voice-button--primary" to="/training/voice">Новая тренировка<VoiceIcon name="arrow" size={17} /></Link>{firstOperator ? <button className="voice-button" disabled={pending} onClick={() => onRetry(firstOperator.turn)}>Повторить разговор</button> : null}</div></div><div className="voice-score"><strong>{result.score}<span>%</span></strong><small>Результат попытки</small></div></section>
    {result.critical_errors.length > 0 && <section className="voice-panel voice-critical"><span className="voice-eyebrow">КРИТИЧЕСКИЕ ОШИБКИ · {result.critical_errors.length}</span><h2>Это нужно исправить в первую очередь</h2>{result.critical_errors.map((item, index) => <article key={index}><h3>{item.text}</h3><blockquote>«{item.quote}»<cite>Твой ответ · реплика {item.turn + 1}</cite></blockquote><button className="voice-button" disabled={pending} onClick={() => onRetry(item.turn)}><VoiceIcon name="repeat" size={17} />Повторить этот момент</button></article>)}</section>}
    <section className="voice-feedback"><div className="voice-history-title"><h2>Что получилось и что улучшить</h2><span>По сохранённым событиям и репликам</span></div><div className="voice-criteria">{result.criteria.map(item => <article className={`voice-panel voice-criterion ${item.passed ? "is-passed" : ""}`} key={item.key}><div className="voice-criterion-title"><span className="voice-criterion-mark">{item.passed ? <VoiceIcon name="check" size={17} /> : "↗"}</span><h3>{item.label}</h3><span className="voice-criterion-status">{item.passed ? "Получилось" : "Стоит улучшить"}</span></div><p>{item.feedback}</p>{item.quote ? <blockquote>«{item.quote}»<cite>{item.turn === null ? "Сохранённые данные тренировки" : `${item.role === "driver" ? "Водитель" : "Твой ответ"} · реплика ${item.turn + 1}`}</cite></blockquote> : <p className="voice-evidence-missing">В сохранённых ответах или действиях нет подтверждения этого шага.</p>}{!item.passed && item.example && <div className="voice-example"><span>МОЖНО СКАЗАТЬ ТАК</span><p>{item.example}</p></div>}{!item.passed && firstOperator && <button className="voice-text-toggle" disabled={pending} onClick={() => onRetry(item.role === "driver" ? firstOperator.turn : item.turn ?? firstOperator.turn)}><VoiceIcon name="repeat" size={15} />Повторить момент</button>}</article>)}</div></section>
    <section className="voice-panel voice-review-request"><div><h2>Есть вопрос к оценке?</h2><p>Опиши спорный момент и сохрани запрос для разбора с наставником.</p></div>{result.review_status ? <span className="voice-review-saved" role="status"><VoiceIcon name="check" size={17} />{result.review_status === "reviewed" ? "Наставник рассмотрел запрос" : "Запрос на пересмотр сохранён"}</span> : !reviewOpen ? <button className="voice-button" onClick={onReviewOpen}>Оспорить оценку</button> : null}{result.review_status === "reviewed" && result.mentor_comment && <div className="voice-mentor-reply"><strong>Комментарий наставника</strong><p>{result.mentor_comment}</p></div>}{reviewOpen && !result.review_status && <form onSubmit={event => { event.preventDefault(); if (reviewComment.trim() && !reviewing) onReview(); }}><label htmlFor="voice-review-comment">Что стоит пересмотреть?</label><textarea id="voice-review-comment" rows={3} maxLength={2000} required value={reviewComment} onChange={event => onReviewComment(event.target.value)} disabled={reviewing} placeholder="Укажи реплику или действие и объясни, с чем ты не согласен…" /><div className="voice-inline-actions"><button className="voice-button voice-button--primary" disabled={reviewing || !reviewComment.trim()}>{reviewing ? "Сохраняем…" : "Сохранить для наставника"}</button><button className="voice-button" type="button" disabled={reviewing} onClick={onReviewCancel}>Отмена</button></div></form>}</section>
    <section className="voice-panel voice-result-transcript"><VoiceTranscriptView attempt={attempt} /></section><p className="voice-caption">Исходная попытка остаётся в истории. Повтор проблемного момента создаёт отдельную тренировку с сохранённым началом разговора.</p>
  </div>;
}

