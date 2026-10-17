import { useState } from "react";
import { Link } from "react-router-dom";
import type { VoiceAttempt, VoiceInspection } from "../../api/voiceTraining";
import "./voice-workspace.css";

/** Selecting an account is part of the exercise; only its visible details can count. */
export function voiceDispatchInspection(attempt: VoiceAttempt | undefined, driverId: string | undefined, parkId: string, tab: string | undefined): VoiceInspection | null {
  if (!attempt || attempt.state !== "in_progress" || attempt.practice.dispatch
    || driverId !== attempt.driver.id || parkId !== attempt.driver.park_id || (tab ?? "details") !== "details") return null;
  return { system: "dispatch", driver_id: driverId, park_id: parkId };
}

const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось сохранить действие. Повторите попытку.";

export function VoicePracticePanel({ attempt, loading = false, error, onReload, mode = "context", active = false, pending = false, actionError, onRetryInspection, onInspect }: {
  attempt?: VoiceAttempt; loading?: boolean; error?: unknown; onReload?: () => void;
  mode?: "context" | "oktell"; active?: boolean; pending?: boolean; actionError?: unknown;
  onRetryInspection?: () => void; onInspect?: (input: VoiceInspection) => void;
}) {
  const [registrationPhone, setRegistrationPhone] = useState("");
  if (error) return <section className="voice-workspace-note voice-workspace-note--error" role="alert"><p>{message(error)}</p><button type="button" onClick={onReload}>Повторить загрузку</button></section>;
  if (loading || !attempt) return <section className="voice-workspace-note" role="status">Открываем голосовую тренировку…</section>;
  const done = attempt.state !== "in_progress";
  const canCompare = attempt.practice.dispatch && attempt.practice.oktell && !attempt.practice.compared && !done;
  const returnLink = <Link to={`/training/voice/attempts/${attempt.id}`}>{done ? "К результату" : "К разговору"} <span aria-hidden="true">→</span></Link>;
  if (mode === "oktell") return <section className="voice-workspace-note voice-workspace-note--call" aria-label="Входящий звонок голосовой тренировки" data-voice-call={attempt.id}>
    <div className="voice-workspace-call"><span className="voice-workspace-call__icon" aria-hidden="true">↙</span><div><span className="voice-workspace-note__eyebrow">OKTEL · Учебный входящий звонок №{attempt.id}</span><h2>{attempt.driver.name}</h2><p>Номер звонящего: <strong>{attempt.incoming_phone}</strong></p></div>
      {attempt.practice.oktell ? <span className="voice-workspace-note__saved">Данные звонка просмотрены ✓</span> : !done && <button type="button" disabled={!active || pending} onClick={() => { if (active && !pending) onInspect?.({ system: "oktell", incoming_phone: attempt.incoming_phone }); }}>Просмотрел данные звонка</button>}
    </div>
    {done ? <p className="voice-workspace-note__status">Попытка завершена. Сохранённые действия доступны в результате.</p>
      : attempt.practice.compared ? <p className="voice-workspace-note__saved" role="status">Сверка сохранена: номер звонка отличается от регистрационного.</p>
      : canCompare ? <form className="voice-workspace-compare" onSubmit={event => { event.preventDefault(); if (active && !pending && registrationPhone.trim()) onInspect?.({ system: "compare", driver_id: attempt.driver.id, park_id: attempt.driver.park_id, registration_phone: registrationPhone, incoming_phone: attempt.incoming_phone }); }}>
        <label htmlFor={`voice-registration-${attempt.id}`}>Номер регистрации из открытой карточки Диспетчерской<input id={`voice-registration-${attempt.id}`} type="tel" inputMode="tel" autoComplete="off" required maxLength={40} value={registrationPhone} disabled={!active || pending} onChange={event => setRegistrationPhone(event.target.value)} placeholder="Введите номер из карточки водителя" /></label>
        <button type="submit" disabled={!active || pending || !registrationPhone.trim()}>Сверить с номером звонка</button>
      </form> : <p className="voice-workspace-note__status">Для сверки просмотрите нужную учётную запись в Диспетчерской и данные этого звонка.</p>}
    {pending && <p className="voice-workspace-note__status" role="status">Сохраняем действие…</p>}
    {!!actionError && <p className="voice-workspace-note__error" role="alert">{message(actionError)} Повторите действие; введённый номер сохранён в поле.</p>}
  </section>;
  return <section className="voice-workspace-note" aria-label="Голосовая тренировка">
    <div className="voice-workspace-note__heading"><div><span className="voice-workspace-note__eyebrow">Голосовая тренировка · {attempt.driver.name}</span><h2>{attempt.title}</h2><p>{done ? "Попытка завершена. Просмотр рабочих сайтов не меняет результат." : "Разговор сохранён. Найдите учётную запись водителя и проверьте данные обращения в рабочих сайтах."}</p></div>{returnLink}</div>
    <ul className="voice-workspace-progress" aria-label="Сохранённые действия"><li className={attempt.practice.dispatch ? "is-done" : ""}>{attempt.practice.dispatch ? "✓" : "○"} Учётная запись просмотрена</li><li className={attempt.practice.oktell ? "is-done" : ""}>{attempt.practice.oktell ? "✓" : "○"} Данные OKTEL просмотрены</li><li className={attempt.practice.compared ? "is-done" : ""}>{attempt.practice.compared ? "✓" : "○"} Номера сверены</li></ul>
    {pending && <p className="voice-workspace-note__status" role="status">Сохраняем просмотр учётной записи…</p>}
    {!!actionError && <div className="voice-workspace-note__error" role="alert"><p>{message(actionError)}</p>{onRetryInspection && !done && <button type="button" disabled={pending} onClick={onRetryInspection}>Повторить сохранение</button>}</div>}
  </section>;
}
