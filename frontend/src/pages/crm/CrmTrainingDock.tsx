import { useState } from "react";
import type { CrmTaskKey, CrmTrainingState, CrmTrainingTask } from "../../api/crmTraining";
import { useGuide } from "../../guide";
import { PulsarFace } from "./PulsarGuide";
import "./crm-training.css";

const STATES = { locked: "Сначала предыдущее", available: "Можно начать", in_progress: "В работе", passed: "Проверено" };

export function CrmTrainingDock({ data, loading, error, busy, actionError, onReload, onStart, onContinue, onEdit, onOpen, onInstructions, requestedTask }: {
  data?: CrmTrainingState; loading: boolean; error: unknown; busy: boolean; actionError: unknown;
  onReload: () => void; onStart: (key: CrmTaskKey) => void; onContinue: () => void;
  onEdit: (id: number) => void; onOpen: (id: number) => void; onInstructions: () => void; requestedTask?: string | null;
}) {
  const guide = useGuide();
  const [open, setOpen] = useState(false), [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<CrmTaskKey | null>(null);
  const active = data?.tasks.find(task => task.key === data.active_task && task.state === "in_progress");
  const requested = data?.tasks.find(task => task.key === requestedTask && task.state !== "locked");
  const preferred = selected ?? active?.key ?? requested?.key ?? data?.last_result?.task_key ?? data?.active_task;
  const current = data?.tasks.find(task => task.key === preferred)
    ?? data?.tasks.find(task => task.state === "available") ?? data?.tasks.at(-1);
  const next = data?.tasks.find(task => task.state === "available");
  const failed = current?.checks.some(check => !check.ok);
  const message = current?.state === "passed" ? "Задание проверено и сохранено"
    : failed ? "Обращение сохранено. Исправьте ошибки ниже"
    : current?.state === "in_progress" ? "Заполните обращение. Я проверю его после сохранения"
    : "Выберите задание и помогите водителю";
  const reveal = () => { setOpen(true); setCompact(false); };
  return <aside className={`pulsar-dock crm-training-dock${open ? " is-open" : ""}${compact ? " is-compact" : ""}`} aria-label="Задания учебной CRM">
    <header className="pulsar-hero">
      <div className="pulsar-hero-top"><span className="pulsar-name"><span className="pulsar-online" />{guide.name}<small>задания CRM</small></span><span className="pulsar-step-pill">{data?.completed ?? 0} из {data?.tasks.length ?? 3}</span>
        <button className="pulsar-collapse" aria-label={compact ? "Развернуть задания CRM" : "Свернуть задания CRM"} onClick={() => compact ? reveal() : setCompact(true)}>{compact ? "↗" : "−"}</button>
        <button className="pulsar-mobile-toggle" aria-label={open ? "Свернуть задания CRM" : "Открыть задания CRM"} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "⌄" : "⌃"}</button>
      </div>
      <div className="pulsar-stage"><button className="pulsar-avatar" onClick={reveal} aria-label="Открыть задания CRM"><PulsarFace mood={current?.state === "passed" ? "cheer" : failed ? "point" : "wave"} /></button><div className="pulsar-bubble" aria-live="polite"><p className="pulsar-speech">{message}</p><strong>{current?.title ?? "Учимся работать с обращениями"}</strong></div></div>
    </header>
    <div className="pulsar-dock-scroll">
      {loading && <p role="status" className="pulsar-muted">Восстанавливаем задания и прогресс…</p>}
      {!!error && <div role="alert" className="crm-training-error"><p>{error instanceof Error ? error.message : "Не удалось загрузить задания"}</p><button className="crm-secondary" onClick={onReload}>Повторить</button></div>}
      {data && <>
        <div className="pulsar-progress" role="progressbar" aria-label="Проверенные задания CRM" aria-valuemin={0} aria-valuemax={data.tasks.length} aria-valuenow={data.completed}><span style={{ width: `${data.tasks.length ? data.completed / data.tasks.length * 100 : 0}%` }} /></div>
        <details className="crm-training-list" open={!data.active_task && data.completed === 0}><summary>Все задания · {data.completed} из {data.tasks.length}</summary><ol className="crm-training-tasks">{data.tasks.map((task, index) => <li key={task.key}><button disabled={busy || task.state === "locked"} aria-current={task.key === current?.key ? "step" : undefined} className={`crm-training-task is-${task.state}`} onClick={() => setSelected(task.key)}><span aria-hidden="true">{task.state === "passed" ? "✓" : task.state === "locked" ? "🔒" : index + 1}</span><span><strong>{task.title}</strong><small>{STATES[task.state]}</small></span></button></li>)}</ol></details>
        {current && <TaskDetails task={current} />}
        {!!actionError && <p role="alert" className="crm-training-error">{actionError instanceof Error ? actionError.message : "Не удалось открыть задание. Повторите попытку."}</p>}
        {current?.state === "available" && <button className="crm-primary crm-training-main-action" disabled={busy} onClick={() => onStart(current.key)}>{busy ? "Открываем…" : "Начать задание →"}</button>}
        {current?.state === "in_progress" && <button className="crm-primary crm-training-main-action" disabled={busy} onClick={() => current.appeal_id ? onEdit(current.appeal_id) : onContinue()}>{current.appeal_id ? `Исправить обращение #${current.appeal_id}` : "Продолжить заполнение →"}</button>}
        {current?.appeal_id && <button className="pulsar-text-button" onClick={() => onOpen(current.appeal_id!)}>Открыть сохранённое обращение #{current.appeal_id}</button>}
        {current?.state === "passed" && next && <button className="crm-primary crm-training-main-action" disabled={busy} onClick={() => { setSelected(next.key); onStart(next.key); }}>Следующее задание →</button>}
        {data.completed === data.tasks.length && data.tasks.length > 0 && <p className="crm-training-complete" role="status">Все задания проверены. Прогресс сохранён — можно вернуться в город.</p>}
      </>}
    </div>
    <footer className="pulsar-dock-footer"><button className="pulsar-text-button" onClick={onInstructions}>Открыть инструкцию по обращению</button></footer>
  </aside>;
}

function TaskDetails({ task }: { task: CrmTrainingTask }) {
  const passed = task.steps.filter(step => step.status === "passed").length;
  const pending = task.steps.findIndex(step => step.status !== "passed");
  return <section className="crm-training-detail" aria-label={`Задание: ${task.title}`}>
    <blockquote><small>Обращается {task.driver.name}</small><p>«{task.speech}»</p></blockquote>
    <p className="pulsar-body">{task.goal}</p>
    <div className="crm-training-steps"><div className="pulsar-checklist-heading"><strong>{pending >= 0 ? `Этап ${pending + 1} из ${task.steps.length}` : "Все этапы проверены"}</strong><span>{passed} / {task.steps.length}</span></div>
      <ol>{task.steps.map((step, index) => <li className={`is-${step.status}`} key={step.key}><span aria-hidden="true">{step.status === "passed" ? "✓" : step.status === "failed" ? "!" : index + 1}</span><p>{step.label}</p></li>)}</ol><small>Этапы подтверждает система по сохранённому обращению.</small>
    </div>
    <details className="crm-training-source"><summary>Данные обращения: телефон, В/У, парк и город</summary><dl>
      {[["Телефон", task.driver.phone], ["В/У", task.driver.license], ["ID водителя", task.driver.id], ["Парк", task.driver.park], ["Город", task.driver.city], ...(task.driver.new_phone ? [["Новый номер", task.driver.new_phone]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      <div><dt>Аккаунт</dt><dd><code>{task.driver.link}</code></dd></div>
    </dl></details>
    <details className="crm-training-source"><summary>Подсказка по теме обращения</summary><p>{task.category_path.join(" → ")}</p></details>

    {task.checks.length > 0 && <div className="crm-training-verdict" role="status"><strong>{task.state === "passed" ? "Проверка пройдена" : "Что нужно исправить"}</strong>
      <ul>{task.checks.filter(check => !check.ok).map(check => <li key={check.key} className="is-bad"><span aria-hidden="true">✕</span><div><strong>{check.label}</strong><p>{check.message}</p></div></li>)}</ul>
      <details className="crm-training-all-checks"><summary>Все проверки · {task.checks.filter(check => check.ok).length} из {task.checks.length}</summary><ul>{task.checks.map(check => <li key={check.key} className={check.ok ? "is-ok" : "is-bad"}><span aria-hidden="true">{check.ok ? "✓" : "✕"}</span><div><strong>{check.label}</strong>{!check.ok && <p>{check.message}</p>}</div></li>)}</ul></details>
    </div>}
  </section>;
}
