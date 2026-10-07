import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { scenarioKeys, scenarios, scenarioWorkSite, type ScenarioAttempt, type ScenarioSummary } from "../../api/scenarios";
import "./scenarios.css";

const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие. Повторите попытку.";

export function ScenarioPage() {
  const { key = "business_park", attemptId } = useParams(), navigate = useNavigate(), client = useQueryClient();
  const catalog = useQuery({ queryKey: scenarioKeys.catalog, queryFn: ({ signal }) => scenarios.catalog(signal), enabled: !attemptId, retry: false, staleTime: 0, refetchOnMount: "always" });
  const attempt = useQuery({ queryKey: scenarioKeys.attempt(attemptId ?? ""), queryFn: ({ signal }) => scenarios.attempt(attemptId!, signal), enabled: !!attemptId, retry: false, refetchOnWindowFocus: true });
  const saveAttempt = (value: ScenarioAttempt) => { client.setQueryData(scenarioKeys.attempt(value.id), value); void client.invalidateQueries({ queryKey: scenarioKeys.catalog }); };
  const start = useMutation({ mutationFn: () => scenarios.start(key), onSuccess: value => { saveAttempt(value); navigate(`/training/scenarios/attempts/${encodeURIComponent(value.id)}`); } });
  const answer = useMutation({ mutationFn: ({ step, choice }: { step: number; choice: number }) => scenarios.answer(attemptId!, step, choice), onSuccess: saveAttempt });
  const finish = useMutation({ mutationFn: () => scenarios.finish(attemptId!), onSuccess: value => { saveAttempt(value); for (const prefix of ["wallet", "coin-progress", "notifications", "city", "city-world", "city-estate", "city-estates", "city-groups", "city-participants", "dashboard", "summary"]) void client.invalidateQueries({ queryKey: [prefix] }); } });
  const query = attemptId ? attempt : catalog;
  const summary = catalog.data?.items.find(item => item.key === key);
  return <main className="scenario-page">
    <Link className="scenario-back" to="/training/city?city=support&district=scenarios">← Город ТП</Link>
    {query.isPending && <section className="scenario-card" role="status">Загружаем сценарий…</section>}
    {query.isError && <section className="scenario-card scenario-error" role="alert"><h1>Сценарий пока недоступен</h1><p>{message(query.error)}</p><button className="scenario-button" onClick={() => query.refetch()}>Повторить</button><p>Район сценариев предназначен для операторов ТП. Доступ и учебная группа проверяются сервером.</p></section>}
    {!attemptId && catalog.data && (summary ? <ScenarioIntroduction scenario={summary} preview={catalog.data.is_preview} pending={start.isPending} error={start.isError ? message(start.error) : undefined} onStart={() => start.mutate()} /> : <section className="scenario-card"><h1>Сценарий не найден</h1><p>Вернитесь в город ТП и выберите доступный сценарий.</p></section>)}
    {attempt.data && <ScenarioAttemptView key={attempt.data.id} attempt={attempt.data} pending={answer.isPending || finish.isPending} error={answer.isError ? message(answer.error) : finish.isError ? message(finish.error) : undefined} onAnswer={(step, choice) => answer.mutate({ step, choice })} onFinish={() => finish.mutate()} onRepeat={() => navigate(`/training/scenarios/${attempt.data.scenario_key}`)} onReload={() => { answer.reset(); finish.reset(); void attempt.refetch(); }} />}
  </main>;
}

export function ScenarioIntroduction({ scenario, preview, pending, error, onStart }: { scenario: ScenarioSummary; preview: boolean; pending: boolean; error?: string; onStart: () => void }) {
  return <section className="scenario-card scenario-introduction">
    <span className="scenario-eyebrow">СЦЕНАРИИ · ТЕХПОДДЕРЖКА</span><h1>{scenario.title}</h1><p>{scenario.description}</p>
    <div className="scenario-facts"><span>≈ {scenario.minutes} минут</span><span>Проходной результат {scenario.pass_percent}%</span><span className="scenario-coins">{scenario.coins_reward} коинов за первое успешное прохождение</span></div>
    {preview && <p className="scenario-notice">Предпросмотр для сотрудника — без начисления коинов.</p>}
    {scenario.completed && <p className="scenario-notice">Награда за этот сценарий уже получена. Можно пройти его повторно для тренировки.</p>}
    <ol className="scenario-route"><li><strong>Диалог с водителем</strong><span>Выберите корректные ответы без обещаний допуска и дохода.</span></li><li><strong>Практика в диспетчерской</strong><span>Найдите водителя и проверьте его профиль и автомобиль.</span></li><li><strong>Обращение в CRM</strong><span>Зафиксируйте консультацию и конкретное следующее действие.</span></li></ol>
    <p>Для зачёта нужны оба практических задания, не менее {scenario.pass_percent}% и корректные ответы на критические вопросы. Ответы сохраняются; после завершения можно начать новую тренировку. Все данные водителя учебные.</p>
    <div className="scenario-actions">{scenario.state === "in_progress" && scenario.attempt_id ? <Link className="scenario-button scenario-button--primary" to={`/training/scenarios/attempts/${encodeURIComponent(scenario.attempt_id)}`}>Продолжить сценарий</Link> : <button className="scenario-button scenario-button--primary" disabled={pending || !preview && scenario.enabled === false} onClick={onStart}>{pending ? "Открываем…" : !preview && scenario.enabled === false ? "Сценарий временно выключен" : scenario.completed ? "Пройти для тренировки" : preview ? "Открыть предпросмотр" : "Начать сценарий"}</button>}</div>
    {error && <p className="scenario-error" role="alert">{error}</p>}
  </section>;
}

export function ScenarioAttemptView({ attempt, pending, error, onAnswer, onFinish, onRepeat, onReload }: { attempt: ScenarioAttempt; pending: boolean; error?: string; onAnswer: (step: number, choice: number) => void; onFinish: () => void; onRepeat: () => void; onReload?: () => void }) {
  const [choice, setChoice] = useState<number | null>(null), [chosenStep, setChosenStep] = useState(attempt.current_step);
  const selected = chosenStep === attempt.current_step ? choice : null;
  const step = attempt.steps[attempt.current_step], answered = Object.keys(attempt.answers).length;
  const done = attempt.state !== "in_progress";
  return <>
    <header className="scenario-card scenario-heading"><span className="scenario-eyebrow">СЦЕНАРИИ · ТП{attempt.is_preview ? " · ПРЕДПРОСМОТР" : ""}</span><h1>{attempt.title}</h1><ScenarioProgress attempt={attempt} /><div className="scenario-facts"><span>{answered} из {attempt.steps.length} ответов</span><span>Зачёт от {attempt.pass_percent}%</span><span className="scenario-coins">{attempt.coins_reward} коинов{attempt.is_preview || attempt.reward_already_claimed ? " · тренировка без награды" : " · за успешное прохождение"}</span></div></header>
    {!done && attempt.feedback && <div className={`scenario-feedback ${attempt.feedback.correct ? "is-correct" : "is-incorrect"}`} role="status"><strong>{attempt.feedback.correct ? "Ответ принят" : "Разберём ответ"}</strong><p>{attempt.feedback.explanation}</p></div>}
    {!done && attempt.phase === "dialogue" && step && <section className="scenario-card scenario-dialogue">
      <p className="scenario-eyebrow">ВОПРОС {attempt.current_step + 1} / {attempt.steps.length}{step.critical && " · КРИТИЧЕСКИЙ"}</p>
      <div className="scenario-speech"><strong>{step.speaker}</strong><p>{step.text}</p></div>
      <form onSubmit={event => { event.preventDefault(); if (selected !== null && !pending) onAnswer(attempt.current_step, selected); }}><fieldset disabled={pending} className="scenario-options"><legend>Ваш ответ водителю</legend>{step.options.map((option, index) => <label key={index} className={selected === index ? "is-selected" : undefined}><input type="radio" name={`step-${attempt.current_step}`} value={index} checked={selected === index} onChange={() => { setChosenStep(attempt.current_step); setChoice(index); }} /><span>{option}</span></label>)}</fieldset><button className="scenario-button scenario-button--primary" disabled={selected === null || pending}>{pending ? "Проверяем…" : "Ответить"}</button></form>
    </section>}
    {!done && attempt.phase === "dispatch" && <section className="scenario-card"><h2>Проверьте профиль и автомобиль</h2><p>Водитель: <strong>{attempt.driver.name}</strong>. Откройте его карточку в учебной диспетчерской и запишите увиденные данные в панели сценария. Кнопка открытия сайта сама по себе не засчитывает задание.</p><p>Проверка классификатора относится к указанному городу. Окончательный допуск в реальной работе определяет сервис.</p><Link className="scenario-button scenario-button--primary" to={scenarioWorkSite(attempt, "dispatch")}>Открыть диспетчерскую</Link><p className="scenario-muted">Рабочие сайты требуют подтверждения QR для оператора. После подтверждения продолжится эта же попытка.</p></section>}
    {!done && attempt.phase === "crm" && !attempt.practice.crm && <section className="scenario-card"><h2>Зафиксируйте консультацию в CRM</h2><p>Создайте обращение по тарифам для этого же учебного водителя. Укажите проверенные данные, ограничения и конкретное следующее действие. Затем проверьте сохранённое обращение в панели сценария.</p><Link className="scenario-button scenario-button--primary" to={scenarioWorkSite(attempt, "crm")}>Создать обращение в CRM</Link></section>}
    {!done && (attempt.phase === "complete" || attempt.phase === "crm" && attempt.practice.crm) && <section className="scenario-card"><h2>Практика завершена</h2><p>Ответы и оба практических задания сохранены. Завершите сценарий, чтобы получить результат и возможную награду.</p><button className="scenario-button scenario-button--primary" disabled={pending} onClick={onFinish}>{pending ? "Сохраняем результат…" : "Завершить сценарий"}</button></section>}
    {done && <ScenarioResult attempt={attempt} onRepeat={onRepeat} />}
    {error && <section className="scenario-card scenario-error" role="alert"><p>{error}</p><p>Проверьте сохранённый прогресс или повторите последнее действие. Повторное завершение не начислит награду дважды.</p>{onReload && <button className="scenario-button" onClick={onReload}>Проверить сохранённый прогресс</button>}</section>}
  </>;
}

export function ScenarioProgress({ attempt }: { attempt: ScenarioAttempt }) {
  const active = attempt.state !== "in_progress" ? 3 : attempt.phase === "dispatch" ? 1 : attempt.phase === "crm" ? 2 : attempt.phase === "complete" ? 3 : 0;
  return <ol className="scenario-progress" aria-label="Этапы сценария">{["Диалог", "Диспетчерская", "CRM", "Результат"].map((label, index) => <li key={label} className={index === active ? "is-active" : index < active || index === 1 && attempt.practice.dispatch || index === 2 && attempt.practice.crm ? "is-done" : undefined} aria-current={index === active ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>;
}

export function ScenarioResult({ attempt, onRepeat }: { attempt: ScenarioAttempt; onRepeat: () => void }) {
  const passed = attempt.state === "passed";
  return <section className={`scenario-card scenario-result ${passed ? "is-passed" : "is-failed"}`}><span className="scenario-eyebrow">РЕЗУЛЬТАТ</span><h2>{passed ? "Сценарий пройден" : "Нужна ещё одна тренировка"}</h2><strong className="scenario-score">{attempt.score}%</strong><p>{passed ? "Консультация и практика зачтены." : `Для зачёта нужны ${attempt.pass_percent}% и правильные ответы на критические вопросы.`}</p>
    <p className="scenario-coins">{attempt.awarded_coins > 0 ? `Начислено ${attempt.awarded_coins} коинов` : attempt.is_preview ? "Предпросмотр — коины не начисляются" : attempt.reward_already_claimed ? "Награда была получена ранее — повторное прохождение для тренировки" : passed && attempt.coins_reward === 0 ? "Для сценария настроена награда 0 коинов" : "Коины не начислены"}</p>
    <div className="scenario-actions"><button className="scenario-button" onClick={onRepeat}>Пройти ещё раз</button><Link className="scenario-button scenario-button--primary" to="/training/city?city=support&district=scenarios">Вернуться в город ТП</Link></div>
    <details className="scenario-review"><summary>Разбор ответов</summary><ol>{attempt.steps.map((step, index) => <li key={index}><p><strong>{step.text}</strong>{step.critical && <span className="scenario-muted"> · Критический вопрос</span>}</p><p>Ваш ответ: {step.options[attempt.answers[index]] ?? "Не отвечено"}</p>{step.explanation && <p className="scenario-muted">{step.explanation}</p>}</li>)}</ol></details>
  </section>;
}
