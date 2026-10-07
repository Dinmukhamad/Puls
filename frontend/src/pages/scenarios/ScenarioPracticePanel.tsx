import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { scenarioKeys, scenarios, type ScenarioAttempt, type ScenarioDispatchInput } from "../../api/scenarios";
import "./scenarios.css";

export function ScenarioPracticePanel({ attemptId, appealId, onFleet, onCreate }: { attemptId: string; appealId?: number; onFleet: (attempt: ScenarioAttempt) => void; onCreate: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: scenarioKeys.attempt(attemptId), queryFn: ({ signal }) => scenarios.attempt(attemptId, signal), retry: false, refetchOnWindowFocus: true });
  const checked = useMutation({ mutationFn: () => scenarios.crmCheck(attemptId, appealId!), onSuccess: value => { client.setQueryData(scenarioKeys.attempt(attemptId), value); } });
  const attempt = query.data;
  if (query.isError) return <section className="scenario-practice scenario-practice-body" role="alert"><p>{query.error.message}</p><button className="scenario-button" onClick={() => query.refetch()}>Повторить загрузку сценария</button></section>;
  if (!attempt) return <section className="scenario-practice scenario-practice-body" role="status">Восстанавливаем практику сценария…</section>;
  return <details className="scenario-practice" open={attempt.phase === "dispatch" || attempt.phase === "crm"} key={attempt.phase}>
    <summary><span>🎓 Business через парк · практика</span><span className="scenario-muted">{attempt.practice.dispatch ? "✓ Диспетчерская" : "Диспетчерская"} · {attempt.practice.crm ? "✓ CRM" : "CRM"}</span></summary>
    <div className="scenario-practice-body"><p>Учебный водитель: <strong>{attempt.driver.name}</strong> · {attempt.driver.phone}. {attempt.is_preview && "Предпросмотр сотрудника: без коинов."}</p>
      {attempt.phase === "crm" && <><p className="scenario-muted">Для обращения: ID {attempt.driver.id} · ВУ {attempt.driver.license_number} · парк {attempt.driver.park} · {attempt.driver.city}</p><button className="scenario-button" onClick={() => onFleet(attempt)}>Карточка этого же водителя</button></>}
      {attempt.phase === "dispatch" && <><p>Откройте <strong>«Детали»</strong> и <strong>«Автомобиль»</strong> в карточке водителя. Запишите увиденные данные. Не меняйте тариф или профиль: здесь нужно проверить данные и границы допуска.</p><button className="scenario-button" onClick={() => onFleet(attempt)}>Карточка водителя в диспетчерской</button><ScenarioDispatchForm key={attempt.id} attempt={attempt} onChecked={value => client.setQueryData(scenarioKeys.attempt(attemptId), value)} /></>}
      {attempt.phase === "crm" && !attempt.practice.crm && <><p>Создайте <strong>консультацию по тарифам</strong> для этого же водителя, парка и города. Заполните обычные поля обращения и блок «Практика сценария». Укажите осмысленный комментарий с результатом проверки и следующим действием.</p><ul>{attempt.crm_requirements.map(item => <li key={item.key}>{item.label}</li>)}</ul><div className="scenario-actions"><button className="scenario-button" onClick={onCreate}>Создать обращение</button>{appealId && <button className="scenario-button scenario-button--primary" disabled={checked.isPending} onClick={() => checked.mutate()}>{checked.isPending ? "Проверяем…" : `Проверить обращение #${appealId}`}</button>}</div>{!appealId && <p className="scenario-muted">После сохранения откройте созданное обращение и нажмите «Проверить обращение».</p>}{checked.isError && <p className="scenario-error" role="alert">{checked.error.message}</p>}</>}
      {attempt.phase === "dialogue" && <p>Проверка диспетчерской сохранена. Продолжите разговор с водителем на странице сценария.</p>}
      {(attempt.phase === "complete" || attempt.phase === "crm" && attempt.practice.crm) && <p>Оба практических задания проверены. Вернитесь в сценарий и завершите попытку, чтобы увидеть результат.</p>}
      {attempt.state !== "in_progress" && <p>Результат попытки сохранён. Повторное открытие рабочих сайтов не начисляет коины.</p>}
      <div className="scenario-actions"><Link className="scenario-button scenario-button--primary" to={`/training/scenarios/attempts/${encodeURIComponent(attempt.id)}`}>Вернуться к сценарию</Link></div>
    </div>
  </details>;
}

type Draft = Omit<ScenarioDispatchInput, "year" | "classification_result"> & { year: string; classification_result: "" | ScenarioDispatchInput["classification_result"] };
const initialDraft = (): Draft => ({ driver_id: "", license_number: "", brand: "", model: "", year: "", color: "", employment: "", park: "", city: "", classification_result: "" });
export function dispatchObservation(draft: Draft): ScenarioDispatchInput {
  const text = (key: keyof Omit<Draft, "classification_result">) => draft[key].trim();
  if (!Object.values(draft).every(value => value.trim()) || !Number.isInteger(Number(draft.year)) || Number(draft.year) < 1980 || Number(draft.year) > 2100 || !["not_confirmed", "confirmed"].includes(draft.classification_result)) throw new Error("Заполните все наблюдения и выберите результат проверки классификатора.");
  return { driver_id: text("driver_id"), license_number: text("license_number"), brand: text("brand"), model: text("model"), year: Number(draft.year), color: text("color"), employment: text("employment"), park: text("park"), city: text("city"), classification_result: draft.classification_result as ScenarioDispatchInput["classification_result"] };
}

export function ScenarioDispatchForm({ attempt, onChecked }: { attempt: ScenarioAttempt; onChecked: (attempt: ScenarioAttempt) => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...initialDraft(), driver_id: attempt.driver.id })), [localError, setLocalError] = useState("");
  const check = useMutation({ mutationFn: () => scenarios.dispatchCheck(attempt.id, dispatchObservation(draft)), onSuccess: onChecked });
  const fields: [keyof Omit<Draft, "classification_result">, string][] = [["driver_id", "Учебная карточка водителя (ID)"], ["license_number", "Номер водительского удостоверения"], ["park", "Название парка"], ["city", "Город парка"], ["employment", "Статус сотрудничества"], ["brand", "Марка автомобиля"], ["model", "Модель автомобиля"], ["year", "Год выпуска"], ["color", "Цвет автомобиля"]];
  return <form onSubmit={event => { event.preventDefault(); setLocalError(""); try { dispatchObservation(draft); check.mutate(); } catch (error) { setLocalError((error as Error).message); } }}>
    <fieldset className="scenario-practice-fields" disabled={check.isPending}><legend className="sr-only">Данные, проверенные в диспетчерской</legend>{fields.map(([key, label]) => <label key={key}><span>{label}</span><input required name={key} readOnly={key === "driver_id"} maxLength={100} min={key === "year" ? 1980 : undefined} max={key === "year" ? 2100 : undefined} type={key === "year" ? "number" : "text"} step={key === "year" ? 1 : undefined} value={draft[key]} onChange={event => { setDraft(value => ({ ...value, [key]: event.target.value })); setLocalError(""); check.reset(); }} /></label>)}<label><span>Результат проверки классификатора</span><select required value={draft.classification_result} onChange={event => { setDraft(value => ({ ...value, classification_result: event.target.value as Draft["classification_result"] })); check.reset(); }}><option value="">Выберите результат</option><option value="not_confirmed">Допуск к Business не подтверждён</option><option value="confirmed">Допуск к Business подтверждён</option></select></label></fieldset>
    <details className="scenario-classifier"><summary>{attempt.classifier.title}</summary><p className="scenario-muted">Учебный пример · зафиксирован {attempt.classifier.checked_on}</p><p>{attempt.classifier.notice}</p>{attempt.classifier.entries.length > 0 && <ul>{attempt.classifier.entries.map((entry, index) => <li key={index}>{entry.brand} {entry.model} · от {entry.min_year} года · {entry.colors.join(", ")}</li>)}</ul>}<a href={attempt.classifier.source_url} target="_blank" rel="noopener noreferrer">Официальный классификатор города ↗</a></details>
    <button className="scenario-button scenario-button--primary" disabled={check.isPending}>{check.isPending ? "Проверяем наблюдения…" : "Проверить данные"}</button>{(localError || check.isError) && <p className="scenario-error" role="alert">{localError || check.error?.message}</p>}
  </form>;
}
