import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { OKTELL_CALLS, oktellRetry, voiceKeys, voiceTraining, type VoiceAttempt, type VoiceAttemptSummary, type VoiceLanguage, type VoicePersona, type VoiceProvider, type VoiceSpeechConfig, type VoiceSpeechProvider } from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button } from "../../components/ui";
import { useVoiceSpeech } from "./useVoiceSpeech";
import { resolveVoiceProvider } from "./voiceProvider";
import { VoiceMentorReviews } from "./VoiceMentorReviews";
import "./voice.css";

const personas: { key: VoicePersona; label: string }[] = [
  { key: "calm", label: "Спокойный" }, { key: "confused", label: "Растерянный" }, { key: "hurried", label: "Торопящийся" },
  { key: "irritated", label: "Раздражённый" }, { key: "aggressive", label: "Агрессивный" },
];
const previewText = "Здравствуйте. Мне нужно поменять номер телефона. Подскажите, как это сделать?";
const languageNote = (language?: VoiceLanguage) => language === "kk" ? " · Қазақша" : "";
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось сохранить действие. Повторите попытку.";
const personaLabel = (key: VoicePersona) => personas.find(item => item.key === key)?.label ?? key;
const attemptRoute = (id: number) => `/training/voice/attempts/${id}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" }).format(new Date(value));
type IconName = "mic" | "play" | "repeat" | "arrow" | "back" | "check" | "stop" | "headphones" | "phone";

function VoiceIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    play: <path d="m9 5 11 7-11 7Z" />,
    repeat: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    back: <><path d="M20 12H4m6-6-6 6 6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="2" y="12" width="5" height="9" rx="2" /><rect x="17" y="12" width="5" height="9" rx="2" /></>,
    phone: <path d="m5 3 4 4-2 3c2 3 4 5 7 7l3-2 4 4c-1 3-4 3-7 2C8 19 4 15 3 9c-1-3-1-5 2-6Z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/**
 * Drivers call the operator in the training Oktell (pages/oktell/OktellVoiceCall.tsx). This page keeps
 * what comes after: the review of each call, the history, a disputed score, the mentors' queue, and
 * a check of the microphone and the driver's voice before the shift.
 */
export function VoiceTrainingPage() {
  const { attemptId } = useParams(), navigate = useNavigate(), client = useQueryClient(), { user } = useAuth();
  const [reviewComment, setReviewComment] = useState(""), [reviewOpen, setReviewOpen] = useState(false);
  const catalog = useQuery({ queryKey: voiceKeys.catalog, queryFn: ({ signal }) => voiceTraining.catalog(signal), enabled: !attemptId, retry: false, staleTime: 0, refetchOnMount: "always" });
  const attempt = useQuery({ queryKey: voiceKeys.attempt(attemptId ?? ""), queryFn: ({ signal }) => voiceTraining.attempt(attemptId!, signal), enabled: !!attemptId, retry: false, refetchOnWindowFocus: true });
  const current = attempt.data;
  const speechConfig = useQuery({ queryKey: voiceKeys.speechConfig(user?.id ?? "account"), queryFn: ({ signal }) => voiceTraining.speechConfig(signal), retry: false, staleTime: 60000, enabled: !attemptId });
  // Yandex SpeechKit when the server has it, otherwise the browser's own voice: the operator chooses nothing.
  const provider = resolveVoiceProvider(speechConfig.data);
  const selectedCloud = speechConfig.data?.providers.find(item => item.id === provider) ?? null;
  const providerRef = useRef<VoiceSpeechProvider | null>(selectedCloud);
  providerRef.current = selectedCloud;
  const speech = useVoiceSpeech({ voicePreferenceKey: `puls:voice-output-auto:${user?.id ?? "account"}` });
  const previewVoice = () => {
    const selected = providerRef.current;
    speech.unlockAudio();
    void speech.speak(previewText, "calm",
      selected ? { label: selected.label, cacheKey: `${selected.id}:${selected.voice}:preview:ru:calm`, load: signal => voiceTraining.speechPreview(selected.id, "calm", "ru", signal) } : undefined);
  };
  const saveAttempt = (value: VoiceAttempt) => {
    client.setQueryData(voiceKeys.attempt(value.id), value);
    void client.invalidateQueries({ queryKey: voiceKeys.catalog });
  };
  // A call started on this page before the calls moved to Oktell: it can only be finished now.
  const finish = useMutation({ mutationFn: () => voiceTraining.finish(attemptId!), onSuccess: saveAttempt });
  const review = useMutation({ mutationFn: () => voiceTraining.review(attemptId!, reviewComment.trim()), onSuccess: value => { saveAttempt(value); setReviewOpen(false); setReviewComment(""); } });
  useEffect(() => { setReviewOpen(false); setReviewComment(""); finish.reset(); review.reset(); }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  // «Повторить момент»: the same driver calls again in Oktell, from that answer on.
  const retryTurn = (turn: number) => { if (current) navigate(oktellRetry(current.id, turn)); };
  const query = attemptId ? attempt : catalog;
  const mutationError = finish.error || review.error;

  return <div className="stack voice-page">
    <header className="page-head voice-head">
      <div className="voice-head__titles">
        <Link className="voice-back" to={attemptId ? "/training/voice" : "/training/city?city=support&district=voice"}><VoiceIcon name="back" size={16} />{attemptId ? "Все звонки" : "Район «Разговор»"}</Link>
        <h1 className="page-title">{attemptId && current ? current.title : "Голосовой тренажёр"}</h1>
        <p className="page-subtitle">{attemptId ? current?.state === "in_progress" ? "Звонок ещё не завершён" : "Разбор учебного звонка: что получилось и что улучшить" : "Водители звонят в учебный Oktell. Здесь — разборы звонков, история и проверка звука."}</p>
      </div>
      <div className="page-head__actions">
        {attemptId && current ? <><Badge>{personaLabel(current.persona)} водитель</Badge>{current.language === "kk" && <Badge>Қазақша</Badge>}</> : <Link className="btn btn--primary btn--m" to={OKTELL_CALLS}><VoiceIcon name="phone" size={17} />Принимать звонки</Link>}
      </div>
    </header>
    {query.isPending && <section className="card voice-loading" role="status"><p>Загружаем звонки…</p></section>}
    {query.isError && <section className="card voice-error" role="alert"><h2>Не удалось открыть звонки</h2><p>{errorText(query.error)}</p><Button onClick={() => void query.refetch()}>Попробовать снова</Button></section>}
    {!attemptId && catalog.data && <>
      <div className="voice-setup-grid">
        <section className="card voice-calls" aria-label="Как поступают звонки">
          <h2 className="card__title">Звонки поступают в Oktell</h2>
          <ol className="voice-ready-list">
            <li><span>1</span><p>Откройте учебный Oktell<small>Рабочие сайты → Oktell. Операторам нужен QR-допуск.</small></p></li>
            <li><span>2</span><p>Войдите в call-центр<small>Автоматический режим, без паузы, статус «На связи», «Веб-телефон» и «Автоответ» включены.</small></p></li>
            <li><span>3</span><p>Ответьте водителю голосом<small>Кто позвонит и какой у него характер — заранее неизвестно. Язык звонков выбирается в кабинете Oktell.</small></p></li>
            <li><span>4</span><p>Завершите звонок<small>Разбор откроется из окна звонка и из «Журнала» Oktell, а все разборы — здесь.</small></p></li>
          </ol>
          <Link className="btn btn--primary btn--l btn--block voice-start" to={OKTELL_CALLS}><VoiceIcon name="phone" size={18} />Открыть Oktell и принимать звонки</Link>
        </section>
        <aside className="card voice-ready" aria-label="Перед сменой">
          <h2 className="card__title">Перед сменой</h2>
          <p className="voice-caption">В звонке микрофон включается сам, когда водитель замолкает, а ответ уходит после короткой паузы. Лучше в наушниках или гарнитуре.</p>
          <div className="voice-ready-actions">
            <Button block variant="secondary" className={speech.micChecked ? "voice-mic-ok" : ""} disabled={speech.checkingMic || !speech.support.microphone} onClick={() => void speech.checkMicrophone()} icon={<VoiceIcon name={speech.micChecked ? "check" : "mic"} size={18} />}>{speech.checkingMic ? "Проверяем микрофон…" : speech.micChecked ? "Микрофон доступен" : "Проверить микрофон"}</Button>
            {speech.micChecked && <p className="voice-caption" role="status">{speech.micSignal === "quiet" ? "Сигнал тихий. Проверь громкость или говори ближе к микрофону." : speech.micSignal === "detected" ? "Слышим тебя. Можно принимать звонки." : "Доступ получен. Если распознавание не сработает, в звонке можно ответить текстом."}</p>}
            {!speech.support.recognition && <p className="voice-caption">В этом браузере нет распознавания речи: в звонке придётся отвечать текстом. Голосом — в Google Chrome.</p>}
            <VoiceSettings speech={speech} provider={provider} config={speechConfig.data} configLoading={speechConfig.isPending} disabled={speech.checkingMic} onPreview={previewVoice} />
            {speechConfig.isError && <p className="voice-caption" role="status">Не удалось проверить облачный голос, сейчас звучит голос браузера. <button type="button" className="voice-link" onClick={() => void speechConfig.refetch()}>Проверить снова</button></p>}
          </div>
          <p className="voice-privacy">Речь распознаёт браузер. На сервер тренажёра уходит только текст ответа, а облачный голос получает только учебные реплики водителя.</p>
        </aside>
      </div>
      <VoiceHistory attempts={catalog.data.attempts} />
      {user && user.role !== "operator" && user.role !== "trainee" && <VoiceMentorReviews />}
      <p className="voice-note"><VoiceIcon name="headphones" size={18} /><span><strong>Учимся объяснять, а не читать скрипт.</strong> Пилот проверяет содержание ответов по правилам учебного сценария. Интонация и темп речи не оцениваются.</span></p>
    </>}
    {attemptId && current && <>
      {current.state === "in_progress" ? current.channel === "oktell"
        ? <section className="card voice-update-notice"><div><strong>Звонок идёт в Oktell</strong><p>Вернитесь к звонку в Oktell и завершите его — разбор появится здесь.</p></div><Link className="btn btn--primary btn--m" to={OKTELL_CALLS}>Вернуться к звонку</Link></section>
        : <section className="card voice-update-notice"><div><strong>Звонок не завершён</strong><p>Звонки теперь проходят в Oktell. Этот разговор можно только завершить и посмотреть разбор.</p></div><Button variant="primary" disabled={finish.isPending} onClick={() => finish.mutate()}>{finish.isPending ? "Завершаем…" : "Завершить и открыть разбор"}</Button></section>
        : <VoiceResults attempt={current} pending={false} onRetry={retryTurn} reviewOpen={reviewOpen} onReviewOpen={() => setReviewOpen(true)} reviewComment={reviewComment} onReviewComment={setReviewComment} reviewing={review.isPending} onReview={() => review.mutate()} onReviewCancel={() => setReviewOpen(false)} />}
      <p className="voice-caption">Учебный пилот: содержание ответов оценивается по правилам сценария, действия — по сохранённым событиям. Интонация и темп речи не оцениваются.</p>
    </>}
    {speech.playbackNotice && <p className="voice-playback-notice" role="status">{speech.playbackNotice}</p>}
    {speech.error && !attemptId && <section className="card voice-speech-error" role="alert"><strong>Не удалось использовать голос</strong><p>{speech.error}</p></section>}
    {mutationError && <section className="card voice-error" role="alert"><strong>Действие не подтверждено</strong><p>{errorText(mutationError)}</p>{attemptId && <Button disabled={attempt.isFetching} onClick={() => void attempt.refetch()}>Проверить сохранённое</Button>}</section>}
  </div>;
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
  if (!attempts.length) return <section className="card voice-empty-history"><span className="voice-history-icon"><VoiceIcon name="repeat" /></span><div><h2 className="card__title">Здесь будет твой опыт</h2><p>Звонки из Oktell и их разборы сохранятся в аккаунте.</p></div></section>;
  return <section className="card voice-history"><header className="card__head"><div className="card__titles"><h2 className="card__title">Мои звонки</h2><p className="card__subtitle">Всего: {attempts.length}</p></div></header><div className="voice-history-list">{attempts.map(item => <Link key={item.id} to={attemptRoute(item.id)} className="voice-history-item"><span className={`voice-history-icon ${item.state === "completed" ? "is-done" : ""}`}><VoiceIcon name={item.state === "completed" ? "check" : "play"} /></span><span className="voice-history-name"><strong>{item.title}</strong><small>{personaLabel(item.persona)}{languageNote(item.language)} · {dateLabel(item.created_at)}</small></span><span className="voice-history-state">{item.state !== "completed" ? <Badge tone="info">{item.channel === "oktell" ? "Идёт в Oktell" : "Не завершён"}</Badge> : item.score === null ? <Badge tone="warning">Ждёт оценки</Badge> : <Badge tone={item.score >= 80 ? "success" : "neutral"}>{`${item.score}%`}</Badge>}{item.review_status && item.review_status !== "awaiting_grade" && <small>{item.review_status === "reviewed" ? "Наставник ответил" : "Запрос на пересмотр"}</small>}</span><VoiceIcon name="arrow" size={18} /></Link>)}</div></section>;
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
  return <div className="voice-results"><section className="card voice-result-hero" data-tone={tone}><div><Badge tone={tone}>Разбор разговора</Badge><h2>{result.critical_errors.length ? "Есть важный момент для разбора" : passed === result.criteria.length ? "Разговор получился" : "Хорошая основа для следующей попытки"}</h2><p>{passed} из {result.criteria.length} критериев выполнено. Оценка относится к содержанию ответов и проверенным действиям.</p><div className="voice-inline-actions"><Link className="btn btn--primary btn--m" to={OKTELL_CALLS}>Принять новый звонок<VoiceIcon name="arrow" size={17} /></Link>{firstOperator ? <Button disabled={pending} onClick={() => onRetry(firstOperator.turn)}>Повторить разговор</Button> : null}</div></div><div className="voice-score"><strong>{result.score}<span>%</span></strong><small>Результат попытки</small></div></section>
    {result.critical_errors.length > 0 && <section className="card voice-critical"><Badge tone="danger">Критические ошибки · {result.critical_errors.length}</Badge><h2>Это нужно исправить в первую очередь</h2>{result.critical_errors.map((item, index) => <article key={index}><h3>{item.text}</h3><blockquote>«{item.quote}»<cite>Твой ответ · реплика {item.turn + 1}</cite></blockquote><Button size="s" disabled={pending} onClick={() => onRetry(item.turn)} icon={<VoiceIcon name="repeat" size={16} />}>Повторить этот момент</Button></article>)}</section>}
    <section className="voice-feedback"><div className="voice-feedback__title"><h2 className="section-title">Что получилось и что улучшить</h2><p className="page-subtitle">По сохранённым событиям и репликам</p></div><div className="voice-criteria">{result.criteria.map(item => <article className={`card voice-criterion ${item.passed ? "is-passed" : ""}`} key={item.key}><div className="voice-criterion-title"><span className="voice-criterion-mark">{item.passed ? <VoiceIcon name="check" size={17} /> : "↗"}</span><h3>{item.label}</h3><Badge tone={item.passed ? "success" : "warning"}>{item.passed ? "Получилось" : "Стоит улучшить"}</Badge></div><p>{item.feedback}</p>{item.quote ? <blockquote>«{item.quote}»<cite>{item.turn === null ? "Сохранённые данные тренировки" : `${item.role === "driver" ? "Водитель" : "Твой ответ"} · реплика ${item.turn + 1}`}</cite></blockquote> : <p className="voice-evidence-missing">В сохранённых ответах или действиях нет подтверждения этого шага.</p>}{!item.passed && item.example && <div className="voice-example"><span>Можно сказать так</span><p>{item.example}</p></div>}{!item.passed && firstOperator && <Button size="s" variant="plain" disabled={pending} onClick={() => onRetry(item.role === "driver" ? firstOperator.turn : item.turn ?? firstOperator.turn)} icon={<VoiceIcon name="repeat" size={15} />}>Повторить момент</Button>}</article>)}</div></section>
    <section className="card voice-review-request"><div><h2 className="card__title">Есть вопрос к оценке?</h2><p>Опиши спорный момент и сохрани запрос для разбора с наставником.</p></div>{result.review_status ? <Badge tone="success" icon={<VoiceIcon name="check" size={14} />}>{result.review_status === "reviewed" ? "Наставник рассмотрел запрос" : "Запрос на пересмотр сохранён"}</Badge> : !reviewOpen ? <Button onClick={onReviewOpen}>Оспорить оценку</Button> : null}{result.review_status === "reviewed" && result.mentor_comment && <div className="voice-mentor-reply"><strong>Комментарий наставника</strong><p>{result.mentor_comment}</p></div>}{reviewOpen && !result.review_status && <form onSubmit={event => { event.preventDefault(); if (reviewComment.trim() && !reviewing) onReview(); }}><label className="field__label" htmlFor="voice-review-comment">Что стоит пересмотреть?</label><textarea id="voice-review-comment" className="input" rows={3} maxLength={2000} required value={reviewComment} onChange={event => onReviewComment(event.target.value)} disabled={reviewing} placeholder="Укажи реплику или действие и объясни, с чем ты не согласен…" /><div className="voice-inline-actions"><Button type="submit" variant="primary" disabled={reviewing || !reviewComment.trim()}>{reviewing ? "Сохраняем…" : "Сохранить для наставника"}</Button><Button disabled={reviewing} onClick={onReviewCancel}>Отмена</Button></div></form>}</section>
    <section className="card voice-result-transcript"><VoiceTranscriptView attempt={attempt} /></section><p className="voice-caption">Повтор момента: этот водитель снова позвонит в Oktell и продолжит с того же места. Исходный звонок остаётся в истории.</p>
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
    <section className="card voice-result-hero" data-tone={tone}><div><Badge tone={score === null ? "warning" : "success"}>{score === null ? "Ждёт оценки наставника" : "Оценка наставника"}</Badge><h2>{score === null ? "Звонок отправлен наставнику" : score >= 80 ? "Разговор получился" : "Есть что улучшить"}</h2><p>{score === null ? "Супервайзер, тренер или руководитель прочитает разговор и поставит оценку. Она появится здесь и в истории попыток." : `${result.mentor_name ? `Наставник: ${result.mentor_name}. ` : ""}Ниже — комментарий наставника и что тренажёр узнал в твоих ответах.`}</p><div className="voice-inline-actions"><Link className="btn btn--primary btn--m" to={OKTELL_CALLS}>Принять новый звонок<VoiceIcon name="arrow" size={17} /></Link>{firstOperator ? <Button disabled={pending} onClick={() => onRetry(firstOperator.turn)}>Повторить разговор</Button> : null}</div></div><div className="voice-score"><strong>{score === null ? "—" : <>{score}<span>%</span></>}</strong><small>{score === null ? "Оценка появится позже" : "Оценка наставника"}</small></div></section>
    {score !== null && result.mentor_comment && <section className="card voice-mentor-card"><h2 className="card__title">Комментарий наставника</h2><p>{result.mentor_comment}</p></section>}
    {result.critical_errors.length > 0 && <section className="card voice-critical"><Badge tone="danger">Критические ошибки · {result.critical_errors.length}</Badge><h2>Это нужно исправить в первую очередь</h2>{result.critical_errors.map((item, index) => <article key={index}><h3>{item.text}</h3><blockquote>«{item.quote}»<cite>Твой ответ · реплика {item.turn + 1}</cite></blockquote><Button size="s" disabled={pending} onClick={() => onRetry(item.turn)} icon={<VoiceIcon name="repeat" size={16} />}>Повторить этот момент</Button></article>)}</section>}
    {result.solution && <section className="card voice-solution"><h2 className="card__title">Правильное решение</h2><p>{result.solution}</p></section>}
    <section className="voice-feedback"><div className="voice-feedback__title"><h2 className="section-title">Что узнал тренажёр</h2><p className="page-subtitle">{recognized} из {result.criteria.length} шагов по ключевым словам сценария{result.reached_end ? " · водитель получил ответ" : ""}</p></div><div className="voice-criteria">{result.criteria.map(item => <article className={`card voice-criterion ${item.passed ? "is-passed" : ""}`} key={item.key}><div className="voice-criterion-title"><span className="voice-criterion-mark">{item.passed ? <VoiceIcon name="check" size={17} /> : "?"}</span><h3>{item.label}</h3><Badge tone={item.passed ? "success" : "warning"}>{item.passed ? "Узнано" : "Не узнано"}</Badge></div><p>{item.feedback}</p>{item.quote && <blockquote>«{item.quote}»<cite>Твой ответ · реплика {(item.turn ?? 0) + 1}</cite></blockquote>}</article>)}</div></section>
    <section className="card voice-result-transcript"><VoiceTranscriptView attempt={attempt} /></section>
  </div>;
}
