import { Link } from "react-router-dom";
import type { ScenarioAttempt } from "../../api/scenarios";
import "./scenario-workspace.css";

export type ScenarioInspection = { driver_id: string; park_id: string; section: "profile" | "car" };

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
export function ScenarioPracticePanel({ attempt, loading, error, onReload, inspectionPending, inspectionError, onRetryInspection, appealId, crmPending, crmError, onCheckAppeal }: {
  attempt?: ScenarioAttempt; loading: boolean; error?: unknown; onReload: () => void;
  inspectionPending?: boolean; inspectionError?: unknown; onRetryInspection?: () => void;
  appealId?: number; crmPending?: boolean; crmError?: unknown; onCheckAppeal?: () => void;
}) {
  if (error) return <section className="scenario-workspace-note scenario-workspace-note--error" role="alert"><p>{errorMessage(error)}</p><button type="button" onClick={onReload}>Повторить загрузку</button></section>;
  if (loading || !attempt) return <section className="scenario-workspace-note" role="status">Открываем задание…</section>;
  const legacy = attempt.revision < 2;
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
    {(inspectionPending || crmPending) && <p className="scenario-workspace-note__status" role="status">{crmPending ? "Проверяем сохранённое обращение…" : "Сохраняем просмотр карточки…"}</p>}
    {!!failure && <div className="scenario-workspace-note__error" role="alert"><p>{errorMessage(failure)}</p>{inspectionError && onRetryInspection ? <button type="button" onClick={onRetryInspection}>Повторить сохранение</button> : crmError && onCheckAppeal ? <button type="button" onClick={onCheckAppeal}>Проверить обращение ещё раз</button> : null}</div>}
    {!failure && !crmPending && canCheckScenarioAppeal(attempt, appealId) && onCheckAppeal && <button type="button" className="scenario-workspace-note__check" onClick={onCheckAppeal}>Проверить сохранённое обращение #{appealId}</button>}
  </section>;
}
