import { useEffect, useRef, useState } from "react";
import type { CrmTaskKey, CrmTrainingState, CrmTrainingTask } from "../../api/crmTraining";
import { ADVICE_OPTIONS, COURSE_GUIDE, COURSE_MISTAKES, COURSE_RULES, courseStep, PHONE_FIELDS, PRACTICE_CHECKLIST, type CoursePlace } from "./crmCourseGuide";
import "./crm-training.css";

const aliases: Record<string, CrmTaskKey> = { crm_first: "crm_intro_v2", crm_phone: "crm_phone_v2", crm_closed: "crm_rework_v2" };
/** Where the operator is now: the dock offers to go to the step's screen only from elsewhere. */
export interface CourseLocation { place: CoursePlace; id?: number }

/**
 * The course beside the work sites, written as the agreed instruction: the lesson, the step it waits for with
 * where to click and what to check, every check that failed, and a confirmation once a lesson passed.
 */
export function CrmCourseDock({ data, loading, error, busy, actionError, location, passed, onReload, onStart, onRestart, onReset, onShow, onInstructions, onCity, onDismissPassed }: {
  data?: CrmTrainingState; loading: boolean; error: unknown; busy: boolean; actionError: unknown;
  location?: CourseLocation | null; passed?: CrmTrainingTask | null;
  onReload: () => void; onStart: (key: CrmTaskKey) => void; onShow: (task: CrmTrainingTask, place: CoursePlace) => void;
  /** Starts the unfinished lesson over; `onReset`, for staff only, the whole course. */
  onRestart?: (key: CrmTaskKey) => void; onReset?: () => void;
  onInstructions: () => void; onCity: () => void; onDismissPassed?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = data?.tasks.find(t => t.key === data.active_task);
  const next = data?.tasks.find(t => t.state === "available");
  const task = active ?? next;
  const number = (key?: CrmTaskKey) => (data?.tasks.findIndex(t => t.key === key) ?? -1) + 1;
  const total = data?.tasks.length ?? 5;
  return <aside className={`crm-course-dock${expanded ? " is-open" : ""}`} aria-label="Обучение CRM">
    <header><div><strong>Практика CRM</strong><small>{data?.completed ?? 0} из {total} уроков пройдено</small>
      <span className="crm-course-progress" role="progressbar" aria-label="Пройденные уроки" aria-valuemin={0} aria-valuemax={total} aria-valuenow={data?.completed ?? 0}><span style={{ width: `${(data?.completed ?? 0) / total * 100}%` }} /></span></div>
      <button onClick={() => setExpanded(v => !v)} aria-label={expanded ? "Свернуть обучение" : "Развернуть обучение"} aria-expanded={expanded}>{expanded ? "−" : "+"}</button></header>
    {expanded && <div className="crm-course-dock__body">
      {loading && <p role="status">Восстанавливаем обучение…</p>}
      {!!error && <div role="alert"><p>Не удалось загрузить обучение. Проверь соединение и повтори.</p><button className="crm-secondary" onClick={onReload}>Повторить</button></div>}
      {data && <>
        {passed && !active ? <Passed task={passed} number={number(passed.key)} next={next} nextNumber={number(next?.key)} busy={busy} onStart={key => { onDismissPassed?.(); onStart(key); }} onCity={onCity} />
        : task ? <>
          <div className="crm-course-lesson"><small>Урок {number(task.key)} из {total}</small><h2>{task.title}</h2><p>{COURSE_GUIDE[task.key]?.lead ?? task.goal}</p>
            {COURSE_GUIDE[task.key]?.terms && <dl className="crm-course-terms">{COURSE_GUIDE[task.key]!.terms!.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>}</div>
          {task.state === "available" ? <button className="crm-primary" disabled={busy} onClick={() => onStart(task.key)}>{busy ? "Открываем…" : `Начать урок ${number(task.key)}`}</button>
            : <Current task={task} location={location} busy={busy} onShow={onShow} onRestart={onRestart} />}
        </> : <div role="status"><h2>Обучение пройдено</h2><p>Все пять уроков подтверждены системой, результаты сохранены.</p><button className="crm-primary" onClick={onCity}>Вернуться в город</button></div>}
        {!!actionError && <p role="alert" className="crm-course-feedback">{actionError instanceof Error ? actionError.message : "Не удалось открыть урок. Повтори попытку."}</p>}
        <div className="crm-course-more">
          {task?.state === "in_progress" && <details><summary>Когда урок засчитан</summary><p>{COURSE_GUIDE[task.key]?.done}</p></details>}
          <details><summary>Памятка по ошибкам</summary><dl className="crm-course-memo">{COURSE_MISTAKES.map(([what, fix]) => <div key={what}><dt>{what}</dt><dd>{fix}</dd></div>)}</dl></details>
          <details open={!data.completed && !active}><summary>Как проходить курс</summary><ul className="crm-course-rules">{COURSE_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul></details>
          <details><summary>Программа обучения</summary><ol className="crm-course-program">{data.tasks.map(t => <li key={t.key} data-state={t.state}><span aria-hidden="true">{t.state === "passed" ? "✓" : t.state === "locked" ? "○" : "→"}</span>{t.title}</li>)}</ol></details>
        </div>
      </>}
      {onReset && !!data && (data.completed > 0 || !!data.active_task) && <Confirmed label="Пройти курс заново" question="Все уроки начнутся с первого. Прежние обращения и тикеты останутся в истории." confirm="Сбросить курс" busy={busy} onConfirm={onReset} />}
      <button className="pulsar-text-button" onClick={onInstructions}>Открыть справку CRM</button>
    </div>}
  </aside>;
}

/** The step the lesson waits for: what to do and where, any failed checks, and the way to the step's screen. */
function Current({ task, location, busy, onShow, onRestart }: { task: CrmTrainingTask; location?: CourseLocation | null; busy: boolean; onShow: (task: CrmTrainingTask, place: CoursePlace) => void; onRestart?: (key: CrmTaskKey) => void }) {
  const lesson = COURSE_GUIDE[task.key];
  const current = courseStep(task);
  const practice = task.key === "crm_practice_v2";
  const failures = task.checks.filter(check => !check.ok);
  const guide = current?.guide;
  const here = !!guide && !!location && location.place === guide.place
    && (guide.place === "appeal" ? location.id === task.appeal_id : guide.place === "ticket" ? location.id === task.ticket_id : true);
  const go = guide && !here ? ({ list: "Открыть список обращений", appeal: `Открыть обращение №${task.appeal_id}`, ticket: `Открыть тикет №${task.ticket_id}`, lesson: "Вернуться к учебному звонку", form: task.appeal_id ? `Исправить обращение №${task.appeal_id}` : "Перейти к оформлению обращения" })[guide.place] : null;
  return <>
    {failures.length > 0 && <section className="crm-course-failures" role="alert"><strong>Система нашла ошибки: {failures.length}</strong><ul>{failures.map(check => <li key={check.key}><b>{check.label}.</b> {check.message}</li>)}</ul><small>Исправь это же обращение и отправь его снова.</small></section>}
    {go && <button className="crm-primary crm-course-go" onClick={() => onShow(task, guide!.place)}>{go}</button>}
    <section className="crm-course-step" aria-live="polite">
      <small>Шаг {(current?.index ?? task.steps.length - 1) + 1} из {task.steps.length}</small>
      <strong>{practice ? "Оформи смену номера самостоятельно" : current?.step.label ?? "Проверяем результат"}</strong>
      {!practice && !!guide?.how.length && <ol>{guide.how.map(line => <li key={line}>{line}</li>)}</ol>}
      {!practice && guide?.note && <p className="crm-course-note">{guide.note}</p>}
      {!practice && here && guide?.target && <p className="crm-course-here">Нужное место на странице выделено синей рамкой.</p>}
    </section>
    {task.key === "crm_mismatch_v2" && current?.step.key === "advice" && <table className="crm-course-table"><caption>Что можно предложить</caption><tbody>{ADVICE_OPTIONS.map(([n, text]) => <tr key={n}><th scope="row">{n}</th><td>{text}</td></tr>)}</tbody></table>}
    {!practice && lesson?.example && ["form", "advice", "comment"].includes(current?.step.key ?? "") && <Example title={lesson.example.title} text={lesson.example.text.replace("[новый номер из задания]", task.driver?.new_phone ?? "[новый номер из задания]")} />}
    {practice && <CoursePracticeTask task={task} />}
    {practice ? <details className="crm-course-checklist" open><summary>Как пройти урок</summary><ol>{PRACTICE_CHECKLIST.map(item => <li key={item}>{item}</li>)}</ol></details>
      : <details><summary>Все шаги урока</summary><ol className="crm-course-step-list">{task.steps.map(s => <li key={s.key} data-done={s.status === "passed"}>{s.status === "passed" ? "✓ " : ""}{s.label}</li>)}</ol></details>}
    {onRestart && <Confirmed label="Начать урок заново" question={restartQuestion(task.key)} confirm="Начать заново" busy={busy} onConfirm={() => onRestart(task.key)} />}
  </>;
}

/** What starting a lesson over does: the lessons with a prepared appeal get a new appeal and ticket. */
export function restartQuestion(key: CrmTaskKey) {
  if (key === "crm_intro_v2" || key === "crm_rework_v2") return "Урок начнётся сначала: будут новое обращение и тикет. Прежние останутся в истории.";
  if (key === "crm_mismatch_v2") return "Урок начнётся сначала с того же звонка: шаги сбросятся.";
  return "Урок начнётся сначала: шаги и снимок сбросятся. Сохранённое обращение останется в истории.";
}

/** A button that asks once more in place: the first click says what will happen. */
function Confirmed({ label, question, confirm, busy, onConfirm }: { label: string; question: string; confirm: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className="crm-secondary crm-course-again" disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  return <div className="crm-course-confirm" role="group" aria-label={label}><p>{question}</p><div><button className="crm-primary" disabled={busy} onClick={() => { setAsking(false); onConfirm(); }}>{confirm}</button><button className="crm-secondary" disabled={busy} onClick={() => setAsking(false)}>Отмена</button></div></div>;
}

function Example({ title, text }: { title: string; text: string }) {
  return <div className="crm-course-example"><small>{title}</small><p>{text}</p></div>;
}

function Passed({ task, number, next, nextNumber, busy, onStart, onCity }: { task: CrmTrainingTask; number: number; next?: CrmTrainingTask; nextNumber: number; busy: boolean; onStart: (key: CrmTaskKey) => void; onCity: () => void }) {
  return <section className="crm-course-passed" role="status"><small>✓ Урок {number} пройден</small><h2>{task.title}</h2>
    <ul>{(COURSE_GUIDE[task.key]?.recap ?? []).map(line => <li key={line}>{line}</li>)}</ul>
    {next ? <button className="crm-primary" disabled={busy} onClick={() => onStart(next.key)}>{busy ? "Открываем…" : `Начать урок ${nextNumber}: ${next.title}`}</button> : <><p>Это был последний урок курса: все пять уроков подтверждены системой.</p><button className="crm-primary" onClick={onCity}>Вернуться в город</button></>}
  </section>;
}

/** The lesson a learner has just finished here, kept until the next one starts. */
export function useJustPassed(data?: CrmTrainingState) {
  const states = useRef<Record<string, string>>();
  const [key, setKey] = useState<CrmTaskKey | null>(null);
  useEffect(() => {
    if (!data) return;
    const before = states.current;
    states.current = Object.fromEntries(data.tasks.map(t => [t.key, t.state]));
    const fresh = before && data.tasks.find(t => t.state === "passed" && before[t.key] === "in_progress");
    if (fresh) setKey(fresh.key);
    else if (data.active_task) setKey(null);
  }, [data]);
  return [data?.tasks.find(t => t.key === key) ?? null, () => setKey(null)] as const;
}

/** The lesson page after a call lesson passed: the result and what to say, then the next lesson. */
export function CourseLessonDone({ task, next, busy, onStart, onList }: { task?: CrmTrainingTask | null; next?: CrmTrainingTask; busy: boolean; onStart: (key: CrmTaskKey) => void; onList: () => void }) {
  const lesson = task ? COURSE_GUIDE[task.key] : undefined;
  return <section className="crm-panel crm-training-start crm-course-done">
    <h2>{task ? `✓ Урок «${task.title}» пройден` : "Задание завершено"}</h2>
    {lesson ? <ul>{lesson.recap.map(line => <li key={line}>{line}</li>)}</ul> : <p>Выбери следующий урок в панели обучения.</p>}
    {lesson?.example && task?.key === "crm_mismatch_v2" && <Example title={lesson.example.title} text={lesson.example.text} />}
    <div className="crm-training-start-actions">{next && <button className="crm-primary" disabled={busy} onClick={() => onStart(next.key)}>{busy ? "Открываем…" : `Начать урок: ${next.title}`}</button>}<button className="crm-secondary" onClick={onList}>К обращениям</button></div>
  </section>;
}

/** The practice's data: whom to find and what the driver asks for; the rest is in the driver's card. */
export function CoursePracticeTask({ task, className = "" }: { task: CrmTrainingTask; className?: string }) {
  const d = task.driver;
  return <section className={`crm-course-practice ${className}`.trim()} aria-label="Данные задания">
    <strong>Данные задания</strong>
    <dl><div><dt>Водитель</dt><dd>{d.name}</dd></div><div><dt>Звонит с номера</dt><dd>{task.incoming_phone ?? d.phone}</dd></div><div><dt>Просит новый номер</dt><dd>{d.new_phone}</dd></div></dl>
    <p>Найди водителя во вкладке «Диспетчерская»: ВУ, таксопарк, город и ссылка на аккаунт — в его карточке. Скриншот добавится внизу формы сам, когда обращение будет заполнено.</p>
  </section>;
}

/** Above the phone-change form of the guided lesson: what goes into each field, and the task's own data. */
export function CourseFormHint({ task }: { task: CrmTrainingTask }) {
  const d = task.driver;
  return <section className="crm-course-form-hint" aria-label="Как заполнить обращение">
    <strong>Как заполнить обращение о смене номера</strong>
    <table className="crm-course-table"><tbody>{PHONE_FIELDS.map(([field, what]) => <tr key={field}><th scope="row">{field}</th><td>{what}</td></tr>)}</tbody></table>
    <p>Из задания: таксопарк <b>{d.park}</b>, город <b>{d.city}</b>, {d.type ? <>тип водителя <b>{d.type}</b>, </> : null}новый номер <b>{d.new_phone}</b>. Текущий телефон и ВУ сверь с карточкой водителя — они видны на снимке ниже.</p>
  </section>;
}

export function courseAlias(key: string | null): CrmTaskKey | null { return key ? aliases[key] ?? key as CrmTaskKey : null; }
