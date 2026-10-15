import { useState } from "react";
import { Link } from "react-router-dom";
import type { ScenarioAttempt, ScenarioInspectionInput } from "../../api/scenarios";
import "./scenario-workspace.css";

export type ScenarioInspection = ScenarioInspectionInput;

/** Only the current, visible exercise can produce an inspection request. */
export function scenarioInspection(attempt: ScenarioAttempt | undefined, driverId: string | undefined, parkId: string, tab: string | undefined): ScenarioInspection | null {
  if (!attempt || attempt.revision < 2 || attempt.state !== "in_progress" || attempt.phase !== "dispatch"
    || driverId !== attempt.driver.id || parkId !== attempt.driver.park_id) return null;
  const inspected = attempt.practice.inspections;
  const section = !inspected?.profile ? "profile" : !inspected.car ? "car" : null;
  if (!section || (section === "profile" ? (tab ?? "details") !== "details" : tab !== "car")) return null;
  return { driver_id: driverId, park_id: parkId, section };
}

export function canCheckScenarioAppeal(attempt: ScenarioAttempt | undefined, appealId: number | undefined) {
  return !!appealId && !!attempt && attempt.revision >= 2 && attempt.state === "in_progress" && attempt.phase === "crm" && !attempt.practice.crm;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Не удалось сохранить действие. Повторите попытку.";

/** The work remains in the real training sites; this strip keeps the incoming request at hand. */
export function ScenarioPracticePanel({ attempt, loading, error, onReload, inspectionPending, inspectionError, onRetryInspection, appealId, crmPending, crmError, onCheckAppeal, onCheckClassifier }: {
  attempt?: ScenarioAttempt; loading: boolean; error?: unknown; onReload: () => void;
  inspectionPending?: boolean; inspectionError?: unknown; onRetryInspection?: () => void;
  onCheckClassifier?: (result: "eligible" | "not_eligible") => void;
  appealId?: number; crmPending?: boolean; crmError?: unknown; onCheckAppeal?: () => void;
}) {
  if (error) return <section className="scenario-workspace-note scenario-workspace-note--error" role="alert"><p>{errorMessage(error)}</p><button type="button" onClick={onReload}>Повторить загрузку</button></section>;
  if (loading || !attempt) return <section className="scenario-workspace-note" role="status">Открываем задание…</section>;
  const legacy = attempt.revision < 3;
  const done = attempt.state !== "in_progress";
  const profile = !!attempt.practice.inspections?.profile, car = !!attempt.practice.inspections?.car;
  const instruction = legacy ? "Эта попытка использует предыдущую версию. Вернитесь к сценарию, чтобы открыть новое задание."
    : done ? "Результат попытки сохранён."
    : attempt.phase === "dispatch" ? "Выполните выбранное действие в рабочих сайтах. Прогресс сохраняется автоматически."
    : attempt.phase === "crm" && !attempt.practice.crm ? "Зафиксируйте консультацию в CRM. После сохранения обращение будет проверено."
    : attempt.phase === "complete" || attempt.practice.crm ? "Обращение проверено. Вернитесь к диалогу, чтобы завершить сценарий."
    : "Действие сохранено. Продолжите диалог с водителем.";
  const failure = inspectionError ?? crmError;
  return <section className="scenario-workspace-note" aria-label="Задание сценария">
    <div className="scenario-workspace-note__message"><span className="scenario-workspace-note__avatar" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3A7.5 7.5 0 0 1 20 11.5Z" /><path d="M7 10h8M7 14h5" /></svg></span><div><span className="scenario-workspace-note__eyebrow">Входящее сообщение · {attempt.driver.name}</span><p>{attempt.opening_message ?? attempt.steps[0]?.text ?? attempt.description}</p></div></div>
    <div className="scenario-workspace-note__task"><p>{instruction}</p><div className="scenario-workspace-note__actions">
      {!legacy && (profile || car) && <span className="scenario-workspace-note__saved">{profile && "Профиль проверен"}{profile && car && " · "}{car && "Автомобиль проверен"}</span>}
      <Link to={`/training/scenarios/attempts/${encodeURIComponent(attempt.id)}`}>К диалогу <span aria-hidden="true">→</span></Link>
    </div></div>
    {!legacy && attempt.practice.required_section === "classifier" && onCheckClassifier && <ScenarioClassifierCheck attempt={attempt} pending={!!inspectionPending} onCheck={onCheckClassifier} />}
    {(inspectionPending || crmPending) && <p className="scenario-workspace-note__status" role="status">{crmPending ? "Проверяем сохранённое обращение…" : "Сохраняем просмотр карточки…"}</p>}
    {!!failure && <div className="scenario-workspace-note__error" role="alert"><p>{errorMessage(failure)}</p>{inspectionError && onRetryInspection ? <button type="button" onClick={onRetryInspection}>Повторить сохранение</button> : crmError && onCheckAppeal ? <button type="button" onClick={onCheckAppeal}>Проверить обращение ещё раз</button> : null}</div>}
    {!failure && !crmPending && canCheckScenarioAppeal(attempt, appealId) && onCheckAppeal && <button type="button" className="scenario-workspace-note__check" onClick={onCheckAppeal}>Проверить сохранённое обращение #{appealId}</button>}
  </section>;
}

export function ScenarioClassifierCheck({ attempt, pending, onCheck }: { attempt: ScenarioAttempt; pending: boolean; onCheck: (result: "eligible" | "not_eligible") => void }) {
  const [opened, setOpened] = useState(false), [result, setResult] = useState<"eligible" | "not_eligible" | "">("");
  return <div className="scenario-workspace-classifier">
    <details onToggle={event => setOpened(event.currentTarget.open)}><summary>Учебный классификатор Яндекса · Бизнес</summary>
      <p>{attempt.classifier.notice}</p><div className="scenario-classifier-table"><table><thead><tr><th>Марка и модель</th><th>Год от</th><th>Цвет</th></tr></thead><tbody>{attempt.classifier.entries.map(entry => <tr key={`${entry.brand}:${entry.model}`}><td>{entry.brand} {entry.model}</td><td>{entry.min_year}</td><td>{entry.colors.join(", ")}</td></tr>)}</tbody></table></div>
      <p>Рейтинг водителя должен быть строго выше {String(attempt.classifier.min_rating ?? 4.95).replace(".", ",")}.</p><a href={attempt.classifier.source_url} target="_blank" rel="noreferrer">Источник: классификатор Яндекса ↗</a>
    </details>
    <form onSubmit={event => { event.preventDefault(); if (opened && result && !pending) onCheck(result); }}><label>Ваш вывод по рейтингу и автомобилю<select required value={result} disabled={pending} onChange={event => setResult(event.target.value as typeof result)}><option value="">Выберите после проверки</option><option value="eligible">Требования для следующего этапа Бизнес выполнены</option><option value="not_eligible">Требования не выполнены</option></select></label><button disabled={!opened || !result || pending}>Проверить вывод</button></form>
  </div>;
}
