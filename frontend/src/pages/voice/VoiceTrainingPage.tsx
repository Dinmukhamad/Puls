import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { voiceKeys, voiceTraining, voiceWorkSite, type VoiceAttempt, type VoiceAttemptSummary, type VoiceLanguage, type VoicePersona, type VoiceProvider, type VoiceSpeechConfig, type VoiceSpeechProvider } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, IconButton, SegmentedControl } from "../../components/ui";
import { useVoiceSpeech } from "./useVoiceSpeech";
import { resolveVoiceProvider } from "./voiceProvider";
import { VoiceMentorReviews } from "./VoiceMentorReviews";
import "./voice.css";

const personas: { key: VoicePersona; label: string; hint: string; symbol: string }[] = [
  { key: "calm", label: "Спокойный", hint: "Слушает и уточняет", symbol: "◡" },
  { key: "confused", label: "Растерянный", hint: "Нуждается в ясности", symbol: "?" },
  { key: "hurried", label: "Торопящийся", hint: "Хочет решить быстрее", symbol: "↗" },
  { key: "irritated", label: "Раздражённый", hint: "Возражает и спорит", symbol: "!" },
];
const languages: { key: VoiceLanguage; label: string; hint: string; symbol: string }[] = [
  { key: "ru", label: "Русский", hint: "Водитель говорит по-русски", symbol: "Ру" },
  { key: "kk", label: "Қазақша", hint: "Водитель говорит по-казахски", symbol: "Қа" },
];
const previewText: Record<VoiceLanguage, string> = {
  ru: "Здравствуйте. Мне нужно поменять номер телефона. Подскажите, как это сделать?",
  kk: "Сәлеметсіз бе. Маған телефон нөмірін ауыстыру керек. Мұны қалай істеуге болады?",
};
const languageNote = (language?: VoiceLanguage) => language === "kk" ? " · Қазақша" : "";
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось сохранить действие. Повторите попытку.";
const personaLabel = (key: VoicePersona) => personas.find(item => item.key === key)?.label ?? key;
const attemptRoute = (id: number) => `/training/voice/attempts/${id}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" }).format(new Date(value));
type DraftRequest = { request_id: string; turn: number; text: string };
type IconName = "mic" | "muted" | "play" | "repeat" | "arrow" | "back" | "check" | "stop" | "headphones" | "external";

function VoiceIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    muted: <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.3 2M12 19v3M8 22h8" /></>,
    play: <path d="m9 5 11 7-11 7Z" />,
    repeat: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    back: <><path d="M20 12H4m6-6-6 6 6 6" /></>,
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
  const [language, setLanguage] = useState<VoiceLanguage>("ru");
  const [draft, setDraft] = useState(""), [textMode, setTextMode] = useState(false), [reviewing, setReviewing] = useState(false);
  const [reviewComment, setReviewComment] = useState(""), [reviewOpen, setReviewOpen] = useState(false);
  const requestRef = useRef<DraftRequest | null>(null), actionLock = useRef(false), spokenRef = useRef("");
  const activeAttemptRef = useRef(attemptId), inputKeyRef = useRef("");
  activeAttemptRef.current = attemptId;
  const catalog = useQuery({ queryKey: voiceKeys.catalog, queryFn: ({ signal }) => voiceTraining.catalog(signal), enabled: !attemptId, retry: false, staleTime: 0, refetchOnMount: "always" });
  const attempt = useQuery({ queryKey: voiceKeys.attempt(attemptId ?? ""), queryFn: ({ signal }) => voiceTraining.attempt(attemptId!, signal), enabled: !!attemptId, retry: false, refetchOnWindowFocus: true });
  const current = attempt.data;
  // A scenario from the editor is written in one language: the call is in it.
  const chosenScenario = catalog.data?.scenarios.find(item => item.key === scenarioKey);
  const callLanguage: VoiceLanguage = chosenScenario?.custom ? chosenScenario.languages?.[0]?.key ?? "ru" : language;
  const speechConfig = useQuery({ queryKey: voiceKeys.speechConfig(user?.id ?? "account"), queryFn: ({ signal }) => voiceTraining.speechConfig(signal), retry: false, staleTime: 60000 });
  // Yandex SpeechKit when the server has it, otherwise the browser's own voice: the operator chooses nothing.
  const provider = resolveVoiceProvider(speechConfig.data);
  const selectedCloud = speechConfig.data?.providers.find(item => item.id === provider) ?? null;
  const providerRef = useRef<VoiceSpeechProvider | null>(selectedCloud);
  providerRef.current = selectedCloud;
  const draftKey = current ? `voice-draft:${user?.id ?? "account"}:${current.id}:${current.turn}` : "";
  const saveDraft = useCallback((text: string) => {
    setDraft(text);
    if (requestRef.current?.text !== text.trim()) requestRef.current = null;
    if (draftKey) try { sessionStorage.setItem(draftKey, JSON.stringify({ text, request: requestRef.current })); } catch { /* The conversation still works with browser storage disabled. */ }
  }, [draftKey]);
  const onTranscript = useCallback((text: string) => { if (inputKeyRef.current === draftKey) saveDraft(text); }, [draftKey, saveDraft]);
  // A fresh key: a browser voice picked in the old settings no longer overrides the recommended one.
  const speech = useVoiceSpeech({ onTranscript, voicePreferenceKey: `puls:voice-output-auto:${user?.id ?? "account"}` });
  const { speak, stopSpeaking, stopRecording, cancel } = speech;
  const outputAvailable = speech.support.synthesis || Boolean(selectedCloud);
  const playDriver = useCallback((text: string, driverPersona: VoicePersona, id: number, turn: number, callLanguage: VoiceLanguage = "ru") => {
    const selected = providerRef.current;
    return speak(text, driverPersona, selected ? { label: selected.label, cacheKey: `${selected.id}:${selected.voice}:attempt:${id}:${turn}`, load: signal => voiceTraining.speech(id, selected.id, turn, signal) } : undefined,
      { language: callLanguage });
  }, [speak]);
  const previewVoice = () => {
    const selected = providerRef.current;
    speech.unlockAudio();
    void speak(previewText[callLanguage], persona,
      selected ? { label: selected.label, cacheKey: `${selected.id}:${selected.voice}:preview:${callLanguage}:${persona}`, load: signal => voiceTraining.speechPreview(selected.id, persona, callLanguage, signal) } : undefined,
      { language: callLanguage });
  };
  const voiceOutputProps = { speech, provider, config: speechConfig.data, configLoading: speechConfig.isPending };
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
  const start = useMutation({ mutationFn: () => voiceTraining.start(scenarioKey, persona, callLanguage), onSuccess: value => { saveAttempt(value); navigate(attemptRoute(value.id)); }, onSettled: () => { actionLock.current = false; } });
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
  const replayDriver = () => { if (current && lastDriver) { speech.unlockAudio(); void playDriver(lastDriver.text, current.persona, current.id, lastDriver.turn, current.language); } };

  useEffect(() => {
    inputKeyRef.current = ""; cancel(); actionLock.current = false;
    start.reset(); answer.reset(); finish.reset(); retry.reset(); review.reset();
  }, [attemptId, cancel]);
  useEffect(() => {
    if (!current || current.state !== "in_progress" || !lastDriver || speechConfig.isPending || spokenRef.current === spokenKey) return;
    spokenRef.current = spokenKey;
    void playDriver(lastDriver.text, current.persona, current.id, lastDriver.turn, current.language);
    return () => { spokenRef.current = ""; stopSpeaking(); };
  }, [spokenKey, current?.state, current?.persona, speechConfig.isPending, playDriver, stopSpeaking]); // Saved inspections and voice selection do not replay the same driver line.

  const beginRecording = async () => {
    if (pending || current?.can_finish || speech.speaking || speech.recording || speech.muted) return;
    inputKeyRef.current = draftKey;
    setReviewing(false); speech.clearError(); speech.unlockAudio();
    const started = await speech.startRecording(current?.language ?? "ru");
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
  const status = answer.isPending || finish.isPending ? "Обрабатываем ответ" : speech.loadingAudio ? "Готовим голос водителя…" : speech.speaking ? "Водитель говорит" : speech.recording ? "Твой ответ · идёт запись" : reviewing && draft ? "Твой ответ · проверь текст" : "Твой ответ";

  const startCall = () => { if (!actionLock.current) { actionLock.current = true; cancel(); speech.unlockAudio(); start.mutate(); } };

  return <div className="stack voice-page">
    <header className="page-head voice-head">
      <div className="voice-head__titles">
        <Link className="voice-back" to={attemptId ? "/training/voice" : "/training/city?city=support&district=voice"}><VoiceIcon name="back" size={16} />{attemptId ? "Все тренировки" : "Район «Разговор»"}</Link>
        <h1 className="page-title">{attemptId && current ? current.title : "Голосовой тренажёр"}</h1>
        <p className="page-subtitle">{attemptId ? current?.state === "completed" ? "Разбор учебного звонка: что получилось и что улучшить" : "Учебный звонок: слушай водителя, проверяй данные и отвечай своими словами" : "Водитель звонит голосом. Ты отвечаешь своими словами, проверяешь данные и помогаешь с решением."}</p>
      </div>
      <div className="page-head__actions">
        {attemptId && current ? <><Badge>{personaLabel(current.persona)} водитель</Badge>{current.language === "kk" && <Badge>Қазақша</Badge>}</> : <Badge tone="success" dot>Пилот</Badge>}
      </div>
    </header>
    {query.isPending && <section className="card voice-loading" role="status"><VoiceOrb compact /><p>Готовим пространство для разговора…</p></section>}
    {query.isError && <section className="card voice-error" role="alert"><h2>Не удалось открыть тренировку</h2><p>{errorText(query.error)}</p><Button onClick={() => void query.refetch()}>Попробовать снова</Button></section>}
    {!attemptId && catalog.data && <>
      <div className="voice-setup-grid">
        <section className="card voice-setup" aria-label="Подготовка звонка">
          <div className="voice-step-block">
            <StepTitle step={1} title="Ситуация" hint="Решение появится в разборе после разговора" />
            <fieldset className="voice-choices"><legend className="voice-sr-only">Сценарий тренировки</legend>{catalog.data.scenarios.map(item => <label className={`voice-choice voice-scenario ${scenarioKey === item.key ? "is-selected" : ""}`} key={item.key}><input type="radio" name="voice-scenario" checked={scenarioKey === item.key} onChange={() => setScenarioKey(item.key)} /><span className="voice-choice__icon"><VoiceIcon name="mic" /></span><span className="voice-choice__text"><strong>{item.title}</strong><small>{item.description}</small><span className="voice-choice__meta">Около {item.minutes} минут{item.custom && item.languages?.[0]?.key === "kk" ? " · Қазақша" : ""}</span></span><span className="voice-choice__mark" aria-hidden="true">{scenarioKey === item.key && <VoiceIcon name="check" size={14} />}</span></label>)}</fieldset>
          </div>
          <div className="voice-step-block">
            <StepTitle step={2} title="Характер водителя" hint="Одна ситуация, разные характеры" />
            <fieldset className="voice-personas"><legend className="voice-sr-only">Характер водителя</legend>{personas.map(item => <label className={`voice-choice voice-persona ${persona === item.key ? "is-selected" : ""}`} key={item.key}><input type="radio" name="voice-persona" checked={persona === item.key} onChange={() => setPersona(item.key)} /><span className="voice-persona__symbol" aria-hidden="true">{item.symbol}</span><span className="voice-choice__text"><strong>{item.label}</strong><small>{item.hint}</small></span></label>)}</fieldset>
          </div>
          <div className="voice-step-block">
            <StepTitle step={3} title="Язык звонка" hint="Отвечай на языке водителя, можно вперемешку с русскими словами" />
            {chosenScenario?.custom
              ? <p className="voice-caption">Сценарий написан на языке «{languages.find(item => item.key === callLanguage)?.label}»: водитель говорит на нём.</p>
              : <SegmentedControl block label="Язык звонка" value={language} onChange={setLanguage} options={languages.map(item => ({ value: item.key, label: item.label }))} />}
          </div>
        </section>
        <aside className="card voice-ready" aria-label="Перед звонком">
          <h2 className="card__title">Перед звонком</h2>
          <ol className="voice-ready-list"><li><span>1</span><p>Найди тихое место<small>В наушниках водителя слышно лучше.</small></p></li><li><span>2</span><p>Проверь микрофон<small>Ответ можно просмотреть до отправки.</small></p></li><li><span>3</span><p>Отвечай своими словами<small>Данные водителя есть в учебных системах.</small></p></li></ol>
          <div className="voice-ready-actions">
            <Button block variant="secondary" className={speech.micChecked ? "voice-mic-ok" : ""} disabled={speech.checkingMic || !speech.support.microphone} onClick={() => void speech.checkMicrophone()} icon={<VoiceIcon name={speech.micChecked ? "check" : "mic"} size={18} />}>{speech.checkingMic ? "Проверяем микрофон…" : speech.micChecked ? "Микрофон доступен" : "Проверить микрофон"}</Button>
            {speech.micChecked && <p className="voice-caption" role="status">{speech.micSignal === "quiet" ? "Сигнал тихий. Проверь громкость или говори ближе к микрофону." : speech.micSignal === "detected" ? "Слышим тебя. Можно начинать." : "Доступ получен. Если распознавание не сработает, введи ответ текстом."}</p>}
            {!speech.support.recognition && <p className="voice-caption">В этом браузере нет распознавания речи. Тренировку можно пройти с текстовыми ответами.</p>}
            <VoiceSettings {...voiceOutputProps} language={callLanguage} disabled={pending || speech.checkingMic} onPreview={previewVoice} />
            {speechConfig.isError && <p className="voice-caption" role="status">Не удалось проверить облачный голос, сейчас звучит голос браузера. <button type="button" className="voice-link" onClick={() => void speechConfig.refetch()}>Проверить снова</button></p>}
          </div>
          <Button block size="l" variant="primary" className="voice-start" disabled={pending || !selectedScenario} onClick={startCall} icon={<VoiceIcon name="play" size={18} />}>{start.isPending ? "Начинаем…" : "Начать разговор"}</Button>
          <p className="voice-privacy">Речь распознаёт браузер. На сервер тренажёра уходит только проверенный текст ответа, а облачный голос получает только учебные реплики водителя.</p>
        </aside>
      </div>
      <VoiceHistory attempts={catalog.data.attempts} />
      {user && user.role !== "operator" && user.role !== "trainee" && <VoiceMentorReviews />}
      <p className="voice-note"><VoiceIcon name="headphones" size={18} /><span><strong>Учимся объяснять, а не читать скрипт.</strong> Пилот проверяет содержание ответов по правилам учебного сценария. Интонация и темп речи не оцениваются.</span></p>
    </>}
    {attemptId && current && <>
      {current.state === "in_progress" && current.revision < 2 && <section className="card voice-update-notice"><div><strong>Доступен обновлённый сценарий</strong><p>Начни новую тренировку, чтобы водитель учитывал выбранный способ решения. Эта попытка сохранится в истории.</p></div><Link className="btn btn--secondary btn--m" to="/training/voice">Начать новую тренировку</Link></section>}
      {current.state === "in_progress" ? <div className="voice-call-grid"><section className="card voice-conversation" aria-label="Разговор с водителем">
        <div className="voice-conversation__top"><Badge tone="success" dot>Учебная линия</Badge><span>Реплика {current.turn + 1}</span></div>
        <div className="voice-speaker"><VoiceOrb active={speech.speaking || speech.recording} recording={speech.recording} /><span className="voice-speaker__role">{speech.recording ? "Оператор" : "Водитель"}</span><h2>{speech.recording ? "Слушаем тебя" : current.driver.name.split(" ").slice(0, 2).join(" ")}</h2><p className={`voice-status ${speech.recording ? "is-recording" : speech.speaking ? "is-speaking" : ""}`} role="status" aria-live="polite">{status}</p></div>
        {current.can_finish && <div className="voice-resolved" role="status"><VoiceIcon name="check" /><p>Водителю понятен следующий шаг.<small>Заверши тренировку, чтобы посмотреть разбор.</small></p></div>}
        <div className="voice-call-controls">
          <Button size="l" variant={speech.recording ? "destructive" : "primary"} className="voice-answer" disabled={pending || speech.speaking || (!speech.recording && (current.can_finish || speech.muted || !speech.support.recognition))} onClick={() => speech.recording ? endRecording() : void beginRecording()} icon={<VoiceIcon name={speech.recording ? "stop" : "mic"} size={18} />}>{speech.recording ? "Завершить запись" : draft ? "Перезаписать ответ" : "Ответить"}</Button>
          <IconButton className="voice-icon-button" label={speech.speaking ? "Остановить озвучку" : "Повторить реплику"} disabled={pending || speech.recording || !lastDriver || !outputAvailable || speechConfig.isPending} onClick={() => speech.speaking ? stopSpeaking() : replayDriver()}><VoiceIcon name={speech.speaking ? "stop" : "repeat"} /></IconButton>
          <IconButton className={`voice-icon-button ${speech.muted ? "is-muted" : ""}`} label={speech.muted ? "Включить микрофон" : "Выключить микрофон"} aria-pressed={speech.muted} disabled={pending || !speech.support.recognition} onClick={() => { speech.setMuted(!speech.muted); if (speech.recording) setReviewing(true); }}><VoiceIcon name={speech.muted ? "muted" : "mic"} /></IconButton>
        </div>
        {speech.recording && <p className="voice-record-hint" role="status">{speech.interimTranscript || "Говори, затем нажми «Завершить запись»."}</p>}
        {speech.muted && <p className="voice-caption voice-center">Микрофон выключен. Включи его или введи ответ текстом.</p>}
        {!outputAvailable && !speechConfig.isPending && <p className="voice-caption voice-center">Озвучка недоступна. Реплика водителя есть в расшифровке ниже.</p>}
        {!current.can_finish && (draft || reviewing || textMode || !speech.support.recognition) && <form className="voice-answer-review" onSubmit={event => { event.preventDefault(); submitAnswer(); }}><div className="voice-review-heading"><label htmlFor="voice-answer-text">{speech.recording ? "Распознаём ответ" : "Проверь ответ перед отправкой"}</label><span>Водитель ещё не слышит этот текст</span></div><textarea id="voice-answer-text" className="input" value={draft} maxLength={4000} rows={4} disabled={pending || speech.recording} onChange={event => saveDraft(event.target.value)} placeholder="Напиши, что ты скажешь водителю…" /><div className="voice-review-actions"><span>{draft.length}/4000</span><Button type="submit" variant="primary" disabled={pending || speech.recording || speech.speaking || !draft.trim()}>{answer.isPending ? "Обрабатываем…" : "Отправить ответ"}<VoiceIcon name="arrow" size={17} /></Button></div></form>}
        {!current.can_finish && !speech.recording && !textMode && speech.support.recognition && !draft && <div className="voice-center"><Button size="s" variant="plain" onClick={() => { setTextMode(true); setReviewing(true); }}>Ввести ответ текстом</Button></div>}
        <VoiceTranscriptView attempt={current} forceOpen={!outputAvailable || Boolean(speech.error)} />
        <div className="voice-finish-row"><p>Прогресс и отправленные ответы сохраняются в аккаунте.{draft && <small>Неотправленный черновик не попадёт в разбор.</small>}</p><Button variant={current.can_finish ? "primary" : "secondary"} disabled={pending || speech.recording} onClick={finishAttempt}>{finish.isPending ? "Сохраняем…" : "Завершить тренировку"}</Button></div>
      </section><VoiceSituation attempt={current} /></div> : <VoiceResults attempt={current} pending={pending} onRetry={retryTurn} reviewOpen={reviewOpen} onReviewOpen={() => setReviewOpen(true)} reviewComment={reviewComment} onReviewComment={setReviewComment} reviewing={review.isPending} onReview={() => review.mutate()} onReviewCancel={() => setReviewOpen(false)} />}
      <p className="voice-caption">Учебный пилот: содержание ответов оценивается по правилам сценария, действия — по сохранённым событиям. Интонация и темп речи не оцениваются.</p>
    </>}
    {speech.playbackNotice && <p className="voice-playback-notice" role="status">{speech.playbackNotice}</p>}
    {speech.error && <section className="card voice-speech-error" role="alert"><strong>Не удалось использовать голос</strong><p>{speech.error}</p><div className="voice-inline-actions">{outputAvailable && <Button disabled={pending || speech.recording || speech.speaking || speechConfig.isPending} onClick={() => { if (current && lastDriver) replayDriver(); else previewVoice(); }}>{current && lastDriver ? "Повторить реплику" : "Прослушать голос"}</Button>}<Button disabled={pending || speech.recording || speech.checkingMic || !speech.support.microphone} onClick={() => void speech.checkMicrophone()}>Проверить микрофон снова</Button>{attemptId && current?.state === "in_progress" && <Button onClick={() => { setTextMode(true); setReviewing(true); speech.clearError(); }}>Продолжить текстом</Button>}<Button variant="plain" onClick={speech.clearError}>Закрыть</Button></div><small>Текущий этап разговора сохранён.</small></section>}
    {mutationError && <section className="card voice-error" role="alert"><strong>Действие не подтверждено</strong><p>{errorText(mutationError)}</p><p>Отправленный ответ мог сохраниться. Проверь прогресс перед повторной отправкой, черновик останется доступен.</p>{attemptId && <Button disabled={attempt.isFetching} onClick={() => void attempt.refetch()}>Проверить сохранённый прогресс</Button>}</section>}
  </div>;
}

function StepTitle({ step, title, hint }: { step: number; title: string; hint: string }) {
  return <div className="voice-step-title"><span className="voice-step" aria-hidden="true">{step}</span><div><h2>{title}</h2><p>{hint}</p></div></div>;
}

/** The driver's voice: nothing to choose, only a sample to hear before the call. */
export function VoiceSettings({ speech, disabled, onPreview, previewLabel = "Прослушать голос водителя", provider, config, configLoading, language = "ru" }: {
  speech: ReturnType<typeof useVoiceSpeech>; disabled: boolean; onPreview: () => void; previewLabel?: string;
  provider: VoiceProvider; config?: VoiceSpeechConfig; configLoading: boolean; language?: VoiceLanguage;
}) {
  const cloud = config?.providers.find(item => item.id === provider);
  return <div className="voice-output">
    <Button block variant="secondary" disabled={disabled || configLoading || (!cloud && !speech.support.synthesis)} onClick={() => speech.speaking ? speech.stopSpeaking() : onPreview()} icon={<VoiceIcon name={speech.speaking ? "stop" : "play"} size={18} />}>{speech.speaking ? "Остановить" : configLoading ? "Проверяем голос…" : previewLabel}</Button>
    <p className="voice-caption">{configLoading ? "Проверяем голос водителя." : cloud ? `Голос ${cloud.label}${cloud.id === "yandex" ? ": у каждого характера свой голос и манера" : ""}.` : language === "kk" ? "Сейчас реплики читает голос браузера. Казахский голос зазвучит естественно, когда подключат Yandex SpeechKit." : "Сейчас реплики читает голос браузера: темп и паузы зависят от характера водителя."}</p>
  </div>;
}

export function VoiceHistory({ attempts }: { attempts: VoiceAttemptSummary[] }) {
  if (!attempts.length) return <section className="card voice-empty-history"><span className="voice-history-icon"><VoiceIcon name="repeat" /></span><div><h2 className="card__title">Здесь будет твой опыт</h2><p>Разговоры и результаты сохранятся в аккаунте. Незавершённую тренировку можно продолжить.</p></div></section>;
  return <section className="card voice-history"><header className="card__head"><div className="card__titles"><h2 className="card__title">Мои попытки</h2><p className="card__subtitle">Всего: {attempts.length}</p></div></header><div className="voice-history-list">{attempts.map(item => <Link key={item.id} to={attemptRoute(item.id)} className="voice-history-item"><span className={`voice-history-icon ${item.state === "completed" ? "is-done" : ""}`}><VoiceIcon name={item.state === "completed" ? "check" : "play"} /></span><span className="voice-history-name"><strong>{item.title}</strong><small>{personaLabel(item.persona)}{languageNote(item.language)} · {dateLabel(item.created_at)}</small></span><span className="voice-history-state">{item.state !== "completed" ? <Badge tone="info">Продолжить</Badge> : item.score === null ? <Badge tone="warning">Ждёт оценки</Badge> : <Badge tone={item.score >= 80 ? "success" : "neutral"}>{`${item.score}%`}</Badge>}{item.review_status && item.review_status !== "awaiting_grade" && <small>{item.review_status === "reviewed" ? "Наставник ответил" : "Запрос на пересмотр"}</small>}</span><VoiceIcon name="arrow" size={18} /></Link>)}</div></section>;
}

export function VoiceSituation({ attempt }: { attempt: VoiceAttempt }) {
  if (attempt.custom) return <aside className="voice-context"><section className="card voice-situation"><h2 className="card__title">Входящий звонок</h2><p>{attempt.description}</p><dl><div><dt>Водитель</dt><dd>{attempt.driver.name}</dd></div>{attempt.incoming_phone && <div><dt>Номер звонящего</dt><dd className="voice-phone">{attempt.incoming_phone}</dd></div>}{attempt.driver.park && <div><dt>Парк</dt><dd>{attempt.driver.park}</dd></div>}</dl></section>
    {attempt.notes && <section className="card voice-situation"><h2 className="card__title">Что видно в системах</h2><p className="voice-notes">{attempt.notes}</p></section>}
    <p className="voice-context-note">Не торопись: можно повторить реплику водителя перед ответом.</p></aside>;
  return <aside className="voice-context"><section className="card voice-situation"><h2 className="card__title">Входящий звонок</h2><p>{attempt.description}</p><dl><div><dt>Водитель</dt><dd>{attempt.driver.name}</dd></div><div><dt>Номер звонящего</dt><dd className="voice-phone">{attempt.incoming_phone}</dd></div><div><dt>Парк</dt><dd>{attempt.driver.park}</dd></div>{attempt.practice.dispatch && <div><dt>Номер в открытом аккаунте</dt><dd className="voice-phone">{attempt.driver.phone}</dd></div>}</dl>
    {attempt.practice.dispatch && attempt.practice.oktell && <div className="voice-compare">{attempt.practice.compared ? <p><VoiceIcon name="check" size={17} /> Сравнение номеров сохранено</p> : <><p>Данные из обеих систем открыты. Сверь их и зафиксируй сравнение.</p><Link className="btn btn--secondary btn--m btn--block" to={voiceWorkSite(attempt, "oktell")}>Сверить номера в системе</Link></>}</div>}
  </section><section className="card voice-systems"><h2 className="card__title">Данные для разговора</h2><p>Открой нужную систему. Вернуться к звонку можно без потери этапа.</p>{([{ key: "dispatch", label: "Диспетчерская", hint: "Найти аккаунт водителя", done: attempt.practice.dispatch }, { key: "oktell", label: "OKTEL", hint: "Проверить данные звонка", done: attempt.practice.oktell }, { key: "crm", label: "CRM", hint: "Учебные обращения", done: false }] as const).map(item => <Link className="voice-system-link" to={voiceWorkSite(attempt, item.key)} key={item.key}><span className={`voice-system-icon ${item.done ? "is-done" : ""}`}><VoiceIcon name={item.done ? "check" : item.key === "oktell" ? "headphones" : "external"} size={18} /></span><span><strong>{item.label}</strong><small>{item.done ? "Просмотр сохранён" : item.hint}</small></span><VoiceIcon name="arrow" size={16} /></Link>)}<p className="voice-caption">Действия засчитываются после просмотра нужных данных в системе. Для рабочих сайтов нужен действующий учебный доступ.</p></section><p className="voice-context-note">Не торопись: можно повторить реплику и собрать данные до ответа.</p></aside>;
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
  if (!result) return <section className="card voice-error"><h2>Разговор сохранён</h2><p>Результат пока недоступен. Обнови страницу, чтобы проверить его.</p></section>;
  if (result.manual) return <ManualResults attempt={attempt} pending={pending} onRetry={onRetry} />;
  const passed = result.criteria.filter(item => item.passed).length;
  const firstOperator = attempt.transcript.find(item => item.role === "operator");
  const tone = result.critical_errors.length ? "danger" : passed === result.criteria.length ? "success" : "warning";
  return <div className="voice-results"><section className="card voice-result-hero" data-tone={tone}><div><Badge tone={tone}>Разбор разговора</Badge><h2>{result.critical_errors.length ? "Есть важный момент для разбора" : passed === result.criteria.length ? "Разговор получился" : "Хорошая основа для следующей попытки"}</h2><p>{passed} из {result.criteria.length} критериев выполнено. Оценка относится к содержанию ответов и проверенным действиям.</p><div className="voice-inline-actions"><Link className="btn btn--primary btn--m" to="/training/voice">Новая тренировка<VoiceIcon name="arrow" size={17} /></Link>{firstOperator ? <Button disabled={pending} onClick={() => onRetry(firstOperator.turn)}>Повторить разговор</Button> : null}</div></div><div className="voice-score"><strong>{result.score}<span>%</span></strong><small>Результат попытки</small></div></section>
    {result.critical_errors.length > 0 && <section className="card voice-critical"><Badge tone="danger">Критические ошибки · {result.critical_errors.length}</Badge><h2>Это нужно исправить в первую очередь</h2>{result.critical_errors.map((item, index) => <article key={index}><h3>{item.text}</h3><blockquote>«{item.quote}»<cite>Твой ответ · реплика {item.turn + 1}</cite></blockquote><Button size="s" disabled={pending} onClick={() => onRetry(item.turn)} icon={<VoiceIcon name="repeat" size={16} />}>Повторить этот момент</Button></article>)}</section>}
    <section className="voice-feedback"><div className="voice-feedback__title"><h2 className="section-title">Что получилось и что улучшить</h2><p className="page-subtitle">По сохранённым событиям и репликам</p></div><div className="voice-criteria">{result.criteria.map(item => <article className={`card voice-criterion ${item.passed ? "is-passed" : ""}`} key={item.key}><div className="voice-criterion-title"><span className="voice-criterion-mark">{item.passed ? <VoiceIcon name="check" size={17} /> : "↗"}</span><h3>{item.label}</h3><Badge tone={item.passed ? "success" : "warning"}>{item.passed ? "Получилось" : "Стоит улучшить"}</Badge></div><p>{item.feedback}</p>{item.quote ? <blockquote>«{item.quote}»<cite>{item.turn === null ? "Сохранённые данные тренировки" : `${item.role === "driver" ? "Водитель" : "Твой ответ"} · реплика ${item.turn + 1}`}</cite></blockquote> : <p className="voice-evidence-missing">В сохранённых ответах или действиях нет подтверждения этого шага.</p>}{!item.passed && item.example && <div className="voice-example"><span>Можно сказать так</span><p>{item.example}</p></div>}{!item.passed && firstOperator && <Button size="s" variant="plain" disabled={pending} onClick={() => onRetry(item.role === "driver" ? firstOperator.turn : item.turn ?? firstOperator.turn)} icon={<VoiceIcon name="repeat" size={15} />}>Повторить момент</Button>}</article>)}</div></section>
    <section className="card voice-review-request"><div><h2 className="card__title">Есть вопрос к оценке?</h2><p>Опиши спорный момент и сохрани запрос для разбора с наставником.</p></div>{result.review_status ? <Badge tone="success" icon={<VoiceIcon name="check" size={14} />}>{result.review_status === "reviewed" ? "Наставник рассмотрел запрос" : "Запрос на пересмотр сохранён"}</Badge> : !reviewOpen ? <Button onClick={onReviewOpen}>Оспорить оценку</Button> : null}{result.review_status === "reviewed" && result.mentor_comment && <div className="voice-mentor-reply"><strong>Комментарий наставника</strong><p>{result.mentor_comment}</p></div>}{reviewOpen && !result.review_status && <form onSubmit={event => { event.preventDefault(); if (reviewComment.trim() && !reviewing) onReview(); }}><label className="field__label" htmlFor="voice-review-comment">Что стоит пересмотреть?</label><textarea id="voice-review-comment" className="input" rows={3} maxLength={2000} required value={reviewComment} onChange={event => onReviewComment(event.target.value)} disabled={reviewing} placeholder="Укажи реплику или действие и объясни, с чем ты не согласен…" /><div className="voice-inline-actions"><Button type="submit" variant="primary" disabled={reviewing || !reviewComment.trim()}>{reviewing ? "Сохраняем…" : "Сохранить для наставника"}</Button><Button disabled={reviewing} onClick={onReviewCancel}>Отмена</Button></div></form>}</section>
    <section className="card voice-result-transcript"><VoiceTranscriptView attempt={attempt} /></section><p className="voice-caption">Исходная попытка остаётся в истории. Повтор проблемного момента создаёт отдельную тренировку с сохранённым началом разговора.</p>
  </div>;
}

/** A call from the scenario editor: the trainer shows what it understood, a mentor gives the score. */
function ManualResults({ attempt, pending, onRetry }: { attempt: VoiceAttempt; pending: boolean; onRetry: (turn: number) => void }) {
  const result = attempt.result!;
  const score = result.review_status === "reviewed" ? result.score : null;
  const firstOperator = attempt.transcript.find(item => item.role === "operator");
  const recognized = result.criteria.filter(item => item.passed).length;
  const tone = score === null ? "warning" : score >= 80 ? "success" : "warning";
  return <div className="voice-results">
    <section className="card voice-result-hero" data-tone={tone}><div><Badge tone={score === null ? "warning" : "success"}>{score === null ? "Ждёт оценки наставника" : "Оценка наставника"}</Badge><h2>{score === null ? "Звонок отправлен наставнику" : score >= 80 ? "Разговор получился" : "Есть что улучшить"}</h2><p>{score === null ? "Супервайзер, тренер или руководитель прочитает разговор и поставит оценку. Она появится здесь и в истории попыток." : `${result.mentor_name ? `Наставник: ${result.mentor_name}. ` : ""}Ниже — комментарий наставника и что тренажёр узнал в твоих ответах.`}</p><div className="voice-inline-actions"><Link className="btn btn--primary btn--m" to="/training/voice">Новая тренировка<VoiceIcon name="arrow" size={17} /></Link>{firstOperator ? <Button disabled={pending} onClick={() => onRetry(firstOperator.turn)}>Повторить разговор</Button> : null}</div></div><div className="voice-score"><strong>{score === null ? "—" : <>{score}<span>%</span></>}</strong><small>{score === null ? "Оценка появится позже" : "Оценка наставника"}</small></div></section>
    {score !== null && result.mentor_comment && <section className="card voice-mentor-card"><h2 className="card__title">Комментарий наставника</h2><p>{result.mentor_comment}</p></section>}
    {result.critical_errors.length > 0 && <section className="card voice-critical"><Badge tone="danger">Критические ошибки · {result.critical_errors.length}</Badge><h2>Это нужно исправить в первую очередь</h2>{result.critical_errors.map((item, index) => <article key={index}><h3>{item.text}</h3><blockquote>«{item.quote}»<cite>Твой ответ · реплика {item.turn + 1}</cite></blockquote><Button size="s" disabled={pending} onClick={() => onRetry(item.turn)} icon={<VoiceIcon name="repeat" size={16} />}>Повторить этот момент</Button></article>)}</section>}
    {result.solution && <section className="card voice-solution"><h2 className="card__title">Правильное решение</h2><p>{result.solution}</p></section>}
    <section className="voice-feedback"><div className="voice-feedback__title"><h2 className="section-title">Что узнал тренажёр</h2><p className="page-subtitle">{recognized} из {result.criteria.length} шагов по ключевым словам сценария{result.reached_end ? " · водитель получил ответ" : ""}</p></div><div className="voice-criteria">{result.criteria.map(item => <article className={`card voice-criterion ${item.passed ? "is-passed" : ""}`} key={item.key}><div className="voice-criterion-title"><span className="voice-criterion-mark">{item.passed ? <VoiceIcon name="check" size={17} /> : "?"}</span><h3>{item.label}</h3><Badge tone={item.passed ? "success" : "warning"}>{item.passed ? "Узнано" : "Не узнано"}</Badge></div><p>{item.feedback}</p>{item.quote && <blockquote>«{item.quote}»<cite>Твой ответ · реплика {(item.turn ?? 0) + 1}</cite></blockquote>}</article>)}</div></section>
    <section className="card voice-result-transcript"><VoiceTranscriptView attempt={attempt} /></section>
  </div>;
}
