import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  nextStepId, removeStep, scenarioKeys, splitKeywords, voiceScenarios,
  type ScenarioContent, type ScenarioDetail, type ScenarioForbidden, type ScenarioReply, type ScenarioRun, type ScenarioStatus, type ScenarioStep, type ScenarioSummary,
} from "../../api/voiceScenarios";
import type { VoiceLanguage } from "../../api/voiceTraining";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, SegmentedControl, Skeleton, type Tone } from "../../components/ui";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import "./voice-scenarios.css";

const LIST = "/admin/learning/voice-scenarios";
const STATUS: Record<ScenarioStatus, [string, Tone]> = {
  draft: ["Черновик", "neutral"], published: ["Опубликован", "success"],
  changed: ["Есть неопубликованные правки", "warning"], withdrawn: ["Снят с публикации", "neutral"],
};
const LANGUAGE: Record<VoiceLanguage, string> = { ru: "Русский", kk: "Қазақша" };
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось сохранить. Повторите попытку.";
const when = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" }).format(new Date(value)) : "";
const stepWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? "шаг" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "шага" : "шагов";
const emptyReply = (): ScenarioReply => ({ keywords: [], driver: "", next: "end" });

/** «Обучение → Сценарии звонков»: trainers, supervisors, heads and admins write the calls of the voice trainer. */
export function VoiceScenariosPage() {
  const { scenarioId } = useParams();
  return scenarioId ? <ScenarioEditor id={scenarioId} key={scenarioId} /> : <ScenarioList />;
}

function ScenarioList() {
  const navigate = useNavigate(), client = useQueryClient(), toast = useToast();
  const list = useQuery({ queryKey: scenarioKeys.list, queryFn: ({ signal }) => voiceScenarios.list(signal), retry: false });
  const create = useMutation({
    mutationFn: voiceScenarios.create,
    onSuccess: data => { client.setQueryData(scenarioKeys.detail(data.id), data); void client.invalidateQueries({ queryKey: scenarioKeys.list }); navigate(`${LIST}/${data.id}`); },
    onError: error => toast.error(errorText(error)),
  });
  return <div className="stack vs-page">
    <header className="page-head">
      <div><h1 className="page-title">Сценарии звонков</h1><p className="page-subtitle">Разговоры для голосового тренажёра: что говорит водитель, какие слова ждём от оператора и как водитель на них отвечает.</p></div>
      <div className="page-head__actions"><Link className="btn btn--secondary btn--m" to="/training/voice">Звонки на проверку</Link><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()} icon={<Plus />}>{create.isPending ? "Создаём…" : "Новый сценарий"}</Button></div>
    </header>
    <section className="vs-how" aria-label="Как это работает">
      {[["1", "Опишите звонок", "Ситуацию, водителя, его первую реплику и правильное решение."],
        ["2", "Соберите шаги", "На каждом шаге — ключевые слова оператора и ответ водителя на них."],
        ["3", "Проиграйте и опубликуйте", "Проверьте звонок сами. Опубликованный сценарий сразу увидят операторы ТП и стажёры."]].map(([n, title, text]) =>
        <div key={n}><span>{n}</span><p><strong>{title}</strong>{text}</p></div>)}
    </section>
    {list.isPending && <Skeleton height={220} />}
    {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
    {list.data && (list.data.scenarios.length
      ? <Card title="Все сценарии" subtitle={`Всего: ${list.data.scenarios.length}`} padded={false}><ul className="vs-list">{list.data.scenarios.map(item => <ScenarioRow key={item.id} item={item} />)}</ul></Card>
      : <Card><EmptyState title="Сценариев пока нет" hint="Создайте первый: например, «Не приходят заказы» или «Списание за отмену»." /></Card>)}
  </div>;
}

function ScenarioRow({ item }: { item: ScenarioSummary }) {
  const [label, tone] = STATUS[item.status];
  return <li><Link className="vs-row" to={`${LIST}/${item.id}`}>
    <span className="vs-row__icon" aria-hidden="true"><Mic /></span>
    <span className="vs-row__text"><strong>{item.title}</strong><small>{LANGUAGE[item.language]} · {item.steps} {stepWord(item.steps)}{item.updated_at && ` · изменён ${when(item.updated_at)}${item.updated_by ? `, ${item.updated_by}` : ""}`}</small></span>
    <Badge tone={tone} dot={item.status === "published"}>{label}{item.revision > 0 && item.status !== "draft" ? ` · версия ${item.revision}` : ""}</Badge>
  </Link></li>;
}

function ScenarioEditor({ id }: { id: string }) {
  const navigate = useNavigate(), client = useQueryClient(), toast = useToast();
  const detail = useQuery({ queryKey: scenarioKeys.detail(id), queryFn: ({ signal }) => voiceScenarios.get(id, signal), retry: false, refetchOnWindowFocus: false });
  const [content, setContent] = useState<ScenarioContent | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (detail.data && !dirty) { setContent(detail.data.draft); setVersion(detail.data.draft_version); } }, [detail.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const update = (patch: Partial<ScenarioContent>) => { setContent(current => current && { ...current, ...patch }); setDirty(true); };
  const stored = (data: ScenarioDetail) => {
    client.setQueryData(scenarioKeys.detail(id), data); void client.invalidateQueries({ queryKey: scenarioKeys.list });
    setVersion(data.draft_version);
  };
  const save = useMutation({
    mutationFn: async () => voiceScenarios.save(id, version, content!),
    onSuccess: data => { stored(data); setDirty(false); toast.success("Черновик сохранён"); },
    onError: error => toast.error(errorText(error)),
  });
  const publish = useMutation({
    mutationFn: async () => {
      let current = version;
      if (dirty) { const saved = await voiceScenarios.save(id, version, content!); stored(saved); setDirty(false); current = saved.draft_version; }
      return voiceScenarios.publish(id, current);
    },
    onSuccess: data => { stored(data); toast.success(`Сценарий опубликован, версия ${data.revision}`); },
    onError: error => toast.error(errorText(error)),
  });
  const withdraw = useMutation({ mutationFn: () => voiceScenarios.withdraw(id), onSuccess: data => { stored(data); toast.info("Сценарий снят с публикации"); }, onError: error => toast.error(errorText(error)) });
  const remove = useMutation({ mutationFn: () => voiceScenarios.remove(id), onSuccess: () => { setDirty(false); void client.invalidateQueries({ queryKey: scenarioKeys.list }); navigate(LIST); }, onError: error => toast.error(errorText(error)) });
  const busy = save.isPending || publish.isPending || withdraw.isPending || remove.isPending;

  if (detail.isPending) return <div className="stack"><Skeleton height={60} /><Skeleton height={400} /></div>;
  if (detail.isError) return <div className="stack"><Link className="vs-back" to={LIST}><Back />Все сценарии</Link><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></div>;
  const data = detail.data, value = content ?? data.draft;
  const [label, tone] = STATUS[dirty && data.published ? "changed" : data.status];
  const setStep = (index: number, step: ScenarioStep) => update({ steps: value.steps.map((item, i) => i === index ? step : item) });
  const setForbidden = (index: number, item: ScenarioForbidden) => update({ forbidden: value.forbidden.map((current, i) => i === index ? item : current) });
  return <div className="stack vs-page">
    <header className="page-head vs-head">
      <div className="vs-head__titles">
        <Link className="vs-back" to={LIST}><Back />Все сценарии</Link>
        <h1 className="page-title">{value.title.trim() || "Новый сценарий"}</h1>
        <p className="page-subtitle">{data.published_at ? `Опубликован ${when(data.published_at)}${data.published_by ? `, ${data.published_by}` : ""}` : "Ещё не опубликован: операторы его не видят"}{dirty ? " · есть несохранённые правки" : ""}</p>
      </div>
      <div className="page-head__actions">
        <Badge tone={tone}>{label}</Badge>
        <Button disabled={!dirty || busy} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button>
        <Button variant="primary" disabled={busy || (!dirty && data.status === "published")} onClick={() => publish.mutate()}>{publish.isPending ? "Публикуем…" : data.status === "published" && !dirty ? "Опубликовано" : data.published ? "Опубликовать правки" : "Опубликовать"}</Button>
      </div>
    </header>
    <div className="vs-grid">
      <div className="vs-main">
        <Card title="О звонке" subtitle="Это оператор видит до начала разговора">
          <Field label="Название" value={value.title} max={140} placeholder="Например: Не приходят заказы" onChange={title => update({ title })} />
          <Field label="Ситуация для оператора" multiline value={value.description} max={1000} placeholder="Кто звонит и с чем. Решение здесь не пишите." onChange={description => update({ description })} />
          <div className="vs-row2">
            <div className="field"><span className="field__label">Язык звонка</span><SegmentedControl block label="Язык звонка" value={value.language} onChange={language => update({ language })} options={[{ value: "ru", label: "Русский" }, { value: "kk", label: "Қазақша" }]} /></div>
            <label className="field"><span className="field__label">Длительность, минут</span><input className="input" type="number" min={1} max={30} value={value.minutes} onChange={event => update({ minutes: Math.min(30, Math.max(1, Number(event.target.value) || 1)) })} /></label>
          </div>
        </Card>
        <Card title="Водитель" subtitle="Учебные данные: имя, номер и парк показываются оператору во время звонка">
          <div className="vs-row3">
            <Field label="Имя" value={value.driver.name} max={80} placeholder="Аскар Нурланов" onChange={name => update({ driver: { ...value.driver, name } })} />
            <Field label="Номер звонящего" value={value.driver.phone} max={30} placeholder="+7 701 111 22 33" onChange={phone => update({ driver: { ...value.driver, phone } })} />
            <Field label="Парк" value={value.driver.park} max={80} placeholder="iTaxi" onChange={park => update({ driver: { ...value.driver, park } })} />
          </div>
          <Field label="Подсказка оператору" note="Необязательно. Что оператор «видит» в системах: статус аккаунта, баланс, причина блокировки." multiline value={value.notes} max={1500} onChange={notes => update({ notes })} />
        </Card>
        <Card title="Разговор" subtitle="Водитель начинает, дальше — шаги. На каждом шаге первый подошедший вариант решает, что водитель скажет">
          <Field label="Первая реплика водителя" multiline value={value.opening} max={600} placeholder="Здравствуйте, я на линии, а заказов нет. Что случилось?" onChange={opening => update({ opening })} />
          <ol className="vs-steps">{value.steps.map((step, index) => <StepCard key={step.id} step={step} index={index} steps={value.steps}
            onChange={next => setStep(index, next)} onRemove={value.steps.length > 1 ? () => update(removeStep(value, step.id)) : undefined} />)}</ol>
          <Button variant="secondary" icon={<Plus />} disabled={value.steps.length >= 30} onClick={() => update({ steps: [...value.steps, { id: nextStepId(value.steps), name: "", replies: [emptyReply()], fallback: "" }] })}>Добавить шаг</Button>
        </Card>
        <Card title="Запрещённые фразы" subtitle="Если оператор их скажет, в разборе будет критическая ошибка. Водитель может на них отреагировать">
          {value.forbidden.length === 0 && <p className="vs-muted">Пока нет. Например: «удалить аккаунт», «сменю номер сам».</p>}
          <ol className="vs-forbidden">{value.forbidden.map((item, index) => <li key={index} className="vs-block">
            <div className="vs-block__head"><strong>Фраза {index + 1}</strong><Button size="s" variant="plain" onClick={() => update({ forbidden: value.forbidden.filter((_, i) => i !== index) })}>Убрать</Button></div>
            <KeywordInput label="Если оператор скажет" value={item.keywords} onChange={keywords => setForbidden(index, { ...item, keywords })} />
            <Field label="Что не так" note="Увидят оператор и наставник в разборе." value={item.text} max={200} placeholder="Предложено удалить аккаунт" onChange={text => setForbidden(index, { ...item, text })} />
            <Field label="Реакция водителя" note="Необязательно. Без неё разговор идёт дальше, а ошибка видна в разборе." multiline value={item.driver} max={600} placeholder="Удалить? Нет, мне нужно работать!" onChange={driver => setForbidden(index, { ...item, driver })} />
          </li>)}</ol>
          <Button variant="secondary" icon={<Plus />} disabled={value.forbidden.length >= 20} onClick={() => update({ forbidden: [...value.forbidden, { keywords: [], text: "", driver: "" }] })}>Добавить запрещённую фразу</Button>
        </Card>
        <Card title="Правильное решение" subtitle="Оператор увидит его в разборе после звонка, наставник — при оценке">
          <Field label="Решение" multiline value={value.solution} max={2000} placeholder="Пройти фотоконтроль в Такси Про. После проверки заказы начнут приходить." onChange={solution => update({ solution })} />
        </Card>
        <Card title="Управление" subtitle="Опубликованный сценарий нельзя удалить: начатые звонки доводятся по своей версии">
          <div className="vs-danger">
            {data.status !== "draft" && data.status !== "withdrawn" && <Button disabled={busy} onClick={() => withdraw.mutate()}>Снять с публикации</Button>}
            {!data.published && (confirmDelete
              ? <><span>Удалить черновик навсегда?</span><Button variant="destructive" disabled={busy} onClick={() => remove.mutate()}>Удалить</Button><Button variant="plain" onClick={() => setConfirmDelete(false)}>Отмена</Button></>
              : <Button variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить черновик</Button>)}
          </div>
        </Card>
      </div>
      <aside className="vs-aside"><TestCall content={value} /></aside>
    </div>
  </div>;
}

function StepCard({ step, index, steps, onChange, onRemove }: { step: ScenarioStep; index: number; steps: ScenarioStep[]; onChange: (step: ScenarioStep) => void; onRemove?: () => void }) {
  const setReply = (i: number, reply: ScenarioReply) => onChange({ ...step, replies: step.replies.map((item, j) => j === i ? reply : item) });
  const options = [
    ...steps.map((item, i) => ({ value: item.id, label: `Шаг ${i + 1}${item.name.trim() ? ` · ${item.name.trim()}` : ""}` })),
    { value: "end", label: "Завершить звонок ✓" },
  ];
  return <li className="vs-step" id={`step-${step.id}`}>
    <div className="vs-step__head">
      <span className="vs-step__number" aria-hidden="true">{index + 1}</span>
      <input className="input" aria-label={`Название шага ${index + 1}`} value={step.name} maxLength={80} placeholder="Название шага, например «Причина»" onChange={event => onChange({ ...step, name: event.target.value })} />
      {onRemove && <IconButton label={`Удалить шаг ${index + 1}`} onClick={onRemove}><Cross /></IconButton>}
    </div>
    <ol className="vs-replies">{step.replies.map((reply, i) => <li key={i} className="vs-block">
      <div className="vs-block__head"><strong>Вариант {i + 1}</strong>{step.replies.length > 1 && <Button size="s" variant="plain" onClick={() => onChange({ ...step, replies: step.replies.filter((_, j) => j !== i) })}>Убрать</Button>}</div>
      <KeywordInput label="Если оператор скажет" value={reply.keywords} onChange={keywords => setReply(i, { ...reply, keywords })} />
      <Field label="Водитель ответит" multiline value={reply.driver} max={600} placeholder="А где его пройти?" onChange={driver => setReply(i, { ...reply, driver })} />
      <div className="field"><span className="field__label">Дальше</span><Select aria-label={`Куда ведёт вариант ${i + 1}`} value={reply.next} placeholder="Выберите шаг" onChange={next => setReply(i, { ...reply, next })} options={options} /></div>
    </li>)}</ol>
    <Button size="s" variant="secondary" icon={<Plus />} disabled={step.replies.length >= 12} onClick={() => onChange({ ...step, replies: [...step.replies, emptyReply()] })}>Добавить вариант</Button>
    <Field label="Если водитель не понял оператора" note="Ни один вариант не подошёл: водитель говорит это и ждёт новый ответ." multiline value={step.fallback} max={600} placeholder="Так почему заказов нет?" onChange={fallback => onChange({ ...step, fallback })} />
  </li>;
}

/** The editor's own call: answers go to the server's engine with the unsaved draft. */
function TestCall({ content }: { content: ScenarioContent }) {
  const [answers, setAnswers] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chat = useRef<HTMLOListElement>(null);
  const serialized = JSON.stringify(content);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      voiceScenarios.test(JSON.parse(serialized) as ScenarioContent, answers, controller.signal)
        .then(result => { setRun(result); setError(null); })
        .catch(reason => { if (!controller.signal.aborted) setError(errorText(reason)); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [serialized, answers]);
  useEffect(() => { chat.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [run]);
  const send = () => { const value = text.trim(); if (!value || run?.resolved || answers.length >= 30) return; setAnswers([...answers, value]); setText(""); };
  const steps = new Map(content.steps.map((step, i) => [step.id, `Шаг ${i + 1}${step.name.trim() ? ` «${step.name.trim()}»` : ""}`]));
  return <div className="vs-side">
    <section className="card vs-test" aria-label="Проиграть звонок">
      <header className="card__head"><div className="card__titles"><h2 className="card__title">Проиграть звонок</h2><p className="card__subtitle">Отвечайте как оператор. Проверяется текущий черновик, даже несохранённый.</p></div></header>
      <ol className="vs-chat" ref={chat}>{(run?.turns ?? [{ role: "driver" as const, text: content.opening }]).map((turn, i) => <li key={i} className={`vs-bubble vs-bubble--${turn.role}`}>
        <span className="vs-bubble__who">{turn.role === "driver" ? "Водитель" : "Оператор"}{turn.role === "operator" && turn.step && steps.get(turn.step) ? ` · ${steps.get(turn.step)}` : ""}</span>
        <p>{turn.text || <em>Реплика не написана</em>}</p>
        {turn.role === "operator" && <span className="vs-bubble__notes">
          {turn.keyword && <Badge tone="success">Узнано: «{turn.keyword}»</Badge>}
          {turn.fallback && <Badge tone="warning">Не узнано: водитель переспросит</Badge>}
          {turn.forbidden?.map((item, j) => <Badge key={j} tone="danger">Запрещено: {item.text || item.keyword}</Badge>)}
        </span>}
      </li>)}</ol>
      {run?.resolved && <p className="vs-done" role="status"><Check />Звонок завершён: водителю понятен следующий шаг</p>}
      {error && <p className="vs-error" role="alert">{error}</p>}
      <div className="vs-test__input">
        <textarea className="input" rows={2} value={text} disabled={run?.resolved} maxLength={4000} placeholder={run?.resolved ? "Звонок завершён" : "Ответ оператора…"} onChange={event => setText(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
        <div className="vs-inline"><Button variant="primary" disabled={!text.trim() || run?.resolved} onClick={send}>Ответить</Button><Button variant="plain" disabled={!answers.length} onClick={() => { setAnswers([]); setText(""); }}>Начать заново</Button></div>
      </div>
    </section>
    <section className="card vs-checks" aria-label="Перед публикацией">
      <header className="card__head"><div className="card__titles"><h2 className="card__title">Перед публикацией</h2></div></header>
      <div className="card__body">
        {!run ? <p className="vs-muted">Проверяем черновик…</p> : run.problems.length === 0 ? <p className="vs-ready"><Check />Всё заполнено, можно публиковать</p>
          : <ul className="vs-problems">{run.problems.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {run?.unreachable.map(id => <p key={id} className="vs-warning">{steps.get(id) ?? id}: к нему не ведёт ни один вариант.</p>)}
      </div>
    </section>
  </div>;
}

function Field({ label, value, onChange, placeholder, note, multiline = false, max }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; note?: ReactNode; multiline?: boolean; max?: number }) {
  const id = useId(), noteId = `${id}-note`;
  const shared = { id, value, maxLength: max, placeholder, className: "input", "aria-describedby": note ? noteId : undefined };
  return <div className="field">
    <label className="field__label" htmlFor={id}>{label}</label>
    {multiline ? <textarea {...shared} rows={3} onChange={event => onChange(event.target.value)} /> : <input {...shared} onChange={event => onChange(event.target.value)} />}
    {note && <span className="field__note" id={noteId}>{note}</span>}
  </div>;
}

/** Keywords as chips: Enter or a comma adds one, Backspace on an empty field takes the last back. */
export function KeywordInput({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const words = splitKeywords(raw).filter(word => !value.some(item => item.toLowerCase() === word.toLowerCase())).map(word => word.slice(0, 80));
    if (words.length) onChange([...value, ...words].slice(0, 40));
    setText("");
  };
  return <div className="field">
    <span className="field__label">{label}</span>
    <div className="vs-keywords">
      {value.map((word, i) => <span key={`${word}:${i}`} className="vs-chip">{word}<button type="button" aria-label={`Убрать «${word}»`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Cross size={12} /></button></span>)}
      <input aria-label={label} value={text} placeholder={value.length ? "ещё слово…" : "такси про, приложение…"}
        onChange={event => { const next = event.target.value; if (/[,;\n]/.test(next)) add(next); else setText(next); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(text); } else if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }}
        onBlur={() => { if (text.trim()) add(text); }} />
    </div>
    <span className="field__note">Достаточно одного совпадения. Окончания не важны: «приложение» найдёт «в приложении». Фраза с «не» перед словом не засчитывается.</span>
  </div>;
}

const svg = (size: number, children: ReactNode) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const Plus = () => svg(18, <path d="M12 5v14M5 12h14" />);
const Cross = ({ size = 18 }: { size?: number }) => svg(size, <path d="M6 6l12 12M18 6 6 18" />);
const Check = () => svg(18, <path d="m5 12 4 4L19 6" />);
const Back = () => svg(16, <path d="M20 12H4m6-6-6 6 6 6" />);
const Mic = () => svg(20, <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>);
