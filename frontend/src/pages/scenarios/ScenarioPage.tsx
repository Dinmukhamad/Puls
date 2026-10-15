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
  const finish = useMutation({ mutationFn: () => scenarios.finish(attemptId!), onSuccess: value => { saveAttempt(value); for (const prefix of ["wallet", "coin-progress", "notifications", "city", "city-world", "city-estate", "city-estates", "city-participants", "dashboard", "summary"]) void client.invalidateQueries({ queryKey: [prefix] }); } });
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
    <div className="scenario-brief"><h2>Вам поступит обращение водителя</h2><p>Водитель хочет подключить тариф Бизнес. Проведите обращение от первого сообщения до согласованного следующего действия: выбирайте, что сказать и что сделать.</p><p>В вашем распоряжении диспетчерская и CRM. Работайте в них с учебной карточкой водителя — действия и сохранённое обращение проверяются в ходе сценария.</p></div>
    <p className="scenario-muted">Прогресс сохраняется. Если ошибётесь, можно исправить действие; в результате учитывается первый выбор. Для зачёта нужны выполненные действия, не менее {scenario.pass_percent}% и отсутствие критических ошибок. Все данные водителя учебные.</p>
    <div className="scenario-actions">{scenario.state === "in_progress" && scenario.attempt_id ? <Link className="scenario-button scenario-button--primary" to={`/training/scenarios/attempts/${encodeURIComponent(scenario.attempt_id)}`}>Продолжить сценарий</Link> : <button className="scenario-button scenario-button--primary" disabled={pending || !preview && scenario.enabled === false} onClick={onStart}>{pending ? "Открываем…" : !preview && scenario.enabled === false ? "Сценарий временно выключен" : scenario.completed ? "Пройти для тренировки" : preview ? "Открыть предпросмотр" : "Начать сценарий"}</button>}</div>
    {error && <p className="scenario-error" role="alert">{error}</p>}
  </section>;
}

export function ScenarioAttemptView({ attempt, pending, error, onAnswer, onFinish, onRepeat, onReload }: { attempt: ScenarioAttempt; pending: boolean; error?: string; onAnswer: (step: number, choice: number) => void; onFinish: () => void; onRepeat: () => void; onReload?: () => void }) {
  const [choice, setChoice] = useState<number | null>(null), [chosenStep, setChosenStep] = useState(attempt.current_step);
  const selected = chosenStep === attempt.current_step ? choice : null;
  const step = attempt.steps[attempt.current_step];
  const done = attempt.state !== "in_progress";
  const legacy = attempt.revision < 2 && !done;
  return <>
    <header className="scenario-card scenario-heading"><span className="scenario-eyebrow">ОБРАЩЕНИЕ ВОДИТЕЛЯ{attempt.is_preview ? " · ПРЕДПРОСМОТР" : ""}</span><h1>{attempt.title}</h1><ScenarioProgress attempt={attempt} /><div className="scenario-case-context"><strong>{attempt.driver.name}</strong><span>{attempt.driver.phone}</span><span>{attempt.driver.park} · {attempt.driver.city}</span></div></header>
    {legacy ? <section className="scenario-card"><h2>Сценарий обновлён</h2><p>Теперь вы сами выбираете реплики и рабочие действия. Начните новую версию сценария.</p><Link className="scenario-button scenario-button--primary" to={`/training/scenarios/${attempt.scenario_key}`}>Открыть новый сценарий</Link></section> : <>
      {!done && attempt.opening_message && (attempt.current_step === 0 ? <section className="scenario-card scenario-incoming"><span className="scenario-eyebrow">НОВОЕ СООБЩЕНИЕ · ВОДИТЕЛЬ</span><p>{attempt.opening_message}</p></section> : <details className="scenario-original"><summary>Первое сообщение водителя</summary><p>{attempt.opening_message}</p></details>)}
      {!done && attempt.feedback && <div className={`scenario-feedback ${attempt.feedback.correct ? "is-correct" : "is-incorrect"}`} role="status"><strong>{attempt.feedback.correct ? "Принято" : "Попробуйте иначе"}</strong><p>{attempt.feedback.explanation}</p></div>}
      {!done && attempt.phase === "dialogue" && step && <section className="scenario-card scenario-dialogue">
        <p className="scenario-eyebrow">{step.kind === "action" ? "РАБОЧЕЕ ДЕЙСТВИЕ" : "ДИАЛОГ С ВОДИТЕЛЕМ"}</p>
        <div className="scenario-speech"><strong>{step.speaker}</strong><p>{step.text}</p></div>
        {step.resource === "classifier" && <details className="scenario-reference"><summary>Материалы обращения · классификатор</summary><p><strong>{attempt.classifier.title}</strong></p><p className="scenario-muted">Учебный пример от {attempt.classifier.checked_on}. {attempt.classifier.notice}</p><ul>{attempt.classifier.entries.map((entry, index) => <li key={index}>{entry.brand} {entry.model} · от {entry.min_year} г. · {entry.colors.join(", ")}</li>)}</ul><a href={attempt.classifier.source_url} target="_blank" rel="noreferrer">Официальный классификатор города ↗</a></details>}
        <form onSubmit={event => { event.preventDefault(); if (selected !== null && !pending) onAnswer(attempt.current_step, selected); }}><fieldset disabled={pending} className="scenario-options"><legend>{step.prompt || (step.kind === "action" ? "Что сделаете дальше?" : "Что ответите водителю?")}</legend>{step.options.map((option, index) => <label key={index} className={selected === index ? "is-selected" : undefined}><input type="radio" name={`step-${attempt.current_step}`} value={index} checked={selected === index} onChange={() => { setChosenStep(attempt.current_step); setChoice(index); }} /><span>{option}</span></label>)}</fieldset><button className="scenario-button scenario-button--primary" disabled={selected === null || pending}>{pending ? "Проверяем…" : step.kind === "action" ? "Выполнить действие" : "Отправить ответ"}</button></form>
      </section>}
      {!done && (attempt.phase === "dispatch" || attempt.phase === "crm") && <section className="scenario-card scenario-workspace-entry"><span className="scenario-eyebrow">РАБОТА С ОБРАЩЕНИЕМ</span><h2>Продолжите в рабочих сайтах</h2><p>Диспетчерская и CRM доступны в учебной среде. Выполните выбранное действие и вернитесь к разговору.</p><Link className="scenario-button scenario-button--primary" to={scenarioWorkSite(attempt, attempt.phase)}>Открыть рабочие сайты</Link><p className="scenario-muted">Открытие сайта само по себе не засчитывает действие. Прогресс сохраняется после проверки данных или сохранённого обращения. Для оператора нужен действующий доступ по QR.</p></section>}
      {!done && attempt.phase === "complete" && <section className="scenario-card"><h2>Обращение завершено</h2><p>Действия в рабочих сайтах и заключительный ответ водителю сохранены. Можно посмотреть результат.</p><button className="scenario-button scenario-button--primary" disabled={pending} onClick={onFinish}>{pending ? "Сохраняем результат…" : "Завершить сценарий"}</button></section>}
    </>}
    {done && <ScenarioResult attempt={attempt} onRepeat={onRepeat} />}
    {error && <section className="scenario-card scenario-error" role="alert"><p>{error}</p><p>Проверьте сохранённый прогресс или повторите последнее действие.</p>{onReload && <button className="scenario-button" onClick={onReload}>Проверить сохранённый прогресс</button>}</section>}
  </>;
}

export function ScenarioProgress({ attempt }: { attempt: ScenarioAttempt }) {
  const answered = Object.keys(attempt.answers).length;
  return <div className="scenario-completion"><label htmlFor="scenario-completion">Выполнено {answered} из {attempt.steps.length} шагов</label><progress id="scenario-completion" value={answered} max={attempt.steps.length} /></div>;
}

export function ScenarioResult({ attempt, onRepeat }: { attempt: ScenarioAttempt; onRepeat: () => void }) {
  const passed = attempt.state === "passed", firstAnswers = attempt.first_answers ?? attempt.answers;
  return <section className={`scenario-card scenario-result ${passed ? "is-passed" : "is-failed"}`}><span className="scenario-eyebrow">РЕЗУЛЬТАТ</span><h2>{passed ? "Сценарий пройден" : "Нужна ещё одна тренировка"}</h2><strong className="scenario-score">{attempt.score}%</strong><p>{passed ? "Обращение и рабочие действия зачтены." : `Для зачёта нужны ${attempt.pass_percent}% и отсутствие критических ошибок.`}</p>
    <p className="scenario-coins">{attempt.awarded_coins > 0 ? `Начислено ${attempt.awarded_coins} коинов` : attempt.is_preview ? "Предпросмотр — коины не начисляются" : attempt.reward_already_claimed ? "Награда была получена ранее — повторное прохождение для тренировки" : passed && attempt.coins_reward === 0 ? "Для сценария настроена награда 0 коинов" : "Коины не начислены"}</p>
    <div className="scenario-actions"><button className="scenario-button" onClick={onRepeat}>Пройти ещё раз</button><Link className="scenario-button scenario-button--primary" to="/training/city?city=support&district=scenarios">Вернуться в город ТП</Link></div>
    <details className="scenario-review"><summary>Разбор решений</summary><p className="scenario-muted">Результат учитывает первый выбор на каждом шаге.</p><ol>{attempt.steps.map((step, index) => <li key={index}><p><strong>{step.text}</strong>{step.critical && <span className="scenario-muted"> · Критическое решение</span>}</p><p>Первый выбор: {step.options[firstAnswers[index]] ?? "Не выполнено"}</p>{attempt.answers[index] !== undefined && attempt.answers[index] !== firstAnswers[index] && <p>После исправления: {step.options[attempt.answers[index]]}</p>}{step.explanation && <p className="scenario-muted">{step.explanation}</p>}</li>)}</ol></details>
  </section>;
}
