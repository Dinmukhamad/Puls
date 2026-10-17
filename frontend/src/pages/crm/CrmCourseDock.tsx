import { useState } from "react";
import type { CrmTaskKey, CrmTrainingState } from "../../api/crmTraining";
import "./crm-training.css";

const aliases: Record<string, CrmTaskKey> = { crm_first: "crm_intro_v2", crm_phone: "crm_phone_v2", crm_closed: "crm_rework_v2" };
export function CrmCourseDock({ data, loading, error, busy, actionError, onReload, onStart, onContinue, onEdit, onOpen, onInstructions, onCity }: {
  data?: CrmTrainingState; loading: boolean; error: unknown; busy: boolean; actionError: unknown;
  onReload: () => void; onStart: (key: CrmTaskKey) => void; onContinue: () => void;
  onEdit: (id: number) => void; onOpen: (id: number) => void; onInstructions: () => void; onCity: () => void; requestedTask?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = data?.tasks.find(t => t.key === data.active_task);
  const next = data?.tasks.find(t => t.state === "available");
  const task = active ?? next;
  const step = task?.steps.find(s => s.status !== "passed");
  const index = task?.steps.findIndex(s => s.status !== "passed") ?? -1;
  const failure = task?.checks.find(c => !c.ok);
  return <aside className={`crm-course-dock${expanded ? " is-open" : ""}`} aria-label="Обучение CRM">
    <header><div><strong>Практика CRM</strong><small>{data?.completed ?? 0} из {data?.tasks.length ?? 5} уроков</small></div><button onClick={() => setExpanded(v => !v)} aria-label={expanded ? "Свернуть обучение" : "Развернуть обучение"} aria-expanded={expanded}>{expanded ? "−" : "+"}</button></header>
    {expanded && <div className="crm-course-dock__body">
      {loading && <p role="status">Восстанавливаем обучение…</p>}
      {!!error && <div role="alert"><p>Не удалось загрузить обучение. Проверь соединение и повтори.</p><button className="crm-secondary" onClick={onReload}>Повторить</button></div>}
      {data && <>
        <details className="crm-course-program"><summary>Программа обучения</summary><ol>{data.tasks.map(t => <li key={t.key} data-state={t.state}><span>{t.state === "passed" ? "✓" : t.state === "locked" ? "○" : "→"}</span>{t.title}</li>)}</ol></details>
        {task ? <>
          <h2>{task.title}</h2>
          {task.state === "available" ? <><p>{task.goal}</p><button className="crm-primary" disabled={busy} onClick={() => onStart(task.key)}>{busy ? "Открываем…" : "Начать урок"}</button></> : <>
            {task.key !== "crm_practice_v2" && <div className="crm-course-current" role="status"><small>Шаг {Math.max(1, index + 1)} из {task.steps.length}</small><strong>{step?.label ?? "Проверяем результат"}</strong></div>}
            {task.key === "crm_practice_v2" && <p>Самостоятельно оформи смену номера. Все рабочие данные доступны в учебных окнах.</p>}
            {failure && <p className="crm-course-feedback" role="alert">{failure.message}</p>}
            <button className="crm-primary" disabled={busy} onClick={() => failure && task.appeal_id ? onEdit(task.appeal_id) : onContinue()}>{failure ? "Исправить обращение" : "Продолжить"}</button>
            {task.appeal_id && <button className="pulsar-text-button" onClick={() => onOpen(task.appeal_id!)}>Открыть обращение №{task.appeal_id}</button>}
            <details><summary>Условие задания</summary><p>{task.speech || task.goal}</p></details>
            {task.key !== "crm_practice_v2" && <details><summary>Все шаги</summary><ol className="crm-course-step-list">{task.steps.map(s => <li key={s.key} data-done={s.status === "passed"}>{s.status === "passed" ? "✓ " : ""}{s.label}</li>)}</ol></details>}
          </>}
        </> : <div role="status"><h2>Обучение пройдено</h2><p>Результаты сохранены. К урокам можно вернуться через обращения в истории.</p><button className="crm-primary" onClick={onCity}>Вернуться в город</button></div>}
        {!!actionError && <p role="alert" className="crm-course-feedback">{actionError instanceof Error ? actionError.message : "Не удалось открыть урок. Повтори попытку."}</p>}
      </>}
      <button className="pulsar-text-button" onClick={onInstructions}>Открыть справку CRM</button>
    </div>}
  </aside>;
}

export function courseAlias(key: string | null): CrmTaskKey | null { return key ? aliases[key] ?? key as CrmTaskKey : null; }
