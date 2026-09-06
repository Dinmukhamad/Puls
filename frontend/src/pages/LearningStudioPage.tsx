import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { learning, DIFFICULTY, LEARNING_LABELS, type ContentInput, type LearningContent, type LearningKind, type LearningStep } from "../api/learning";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import "./learning.css";

const STATUS = { draft: "Черновик", published: "Опубликовано", archived: "В архиве" };
const newStep = (): LearningStep => ({ speaker: "", text: "", options: ["", ""], correct: 0, explanation: "" });
function initialContent(kind: LearningKind): ContentInput {
  return { kind, title: "", description: "", world: "Общее", difficulty: "basic", minutes: 10, status: "draft", is_required: false, deadline: null, allow_back: true, pass_percent: 80, xp_reward: 0, coins_reward: 0, steps: [newStep()] };
}
function inputFrom(content: LearningContent): ContentInput {
  const { kind, title, description, world, difficulty, minutes, status, is_required, deadline, allow_back, pass_percent, xp_reward, coins_reward, steps } = content;
  return { kind, title, description, world, difficulty, minutes, status, is_required, deadline, allow_back, pass_percent, xp_reward, coins_reward, steps: structuredClone(steps ?? []) };
}

export function LearningStudioPage() {
  const { atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<LearningContent | LearningKind | null>(null);
  const query = useQuery({ queryKey: ["learning-definitions"], queryFn: learning.definitions });
  const kind = params.get("kind") ?? "all", tab = params.get("tab") ?? "content";
  const visible = query.data?.filter((item) => kind === "all" || item.kind === kind);
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Студия обучения</h1><p className="page-subtitle">Тесты, миссии и сценарии водителя</p></div><Link className="btn btn--secondary" to="/training">Открыть обучение</Link></div>
    <div className="row"><Button variant={tab === "content" ? "primary" : "secondary"} onClick={() => setParams({ tab: "content" })}>Материалы</Button><Button variant={tab === "results" ? "primary" : "secondary"} onClick={() => setParams({ tab: "results" })}>Результаты команды</Button></div>
    {tab === "results" ? <LearningResults /> : <>
      <div className="training-filters"><label className="field"><span>Тип материала</span><select className="input" value={kind} onChange={(e) => setParams({ kind: e.target.value })}><option value="all">Все материалы</option>{Object.entries(LEARNING_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{atLeast("head") && <div className="row"><Button onClick={() => setEditor("test")}>+ Тест</Button><Button onClick={() => setEditor("mission")}>+ Миссия</Button><Button onClick={() => setEditor("simulator")}>+ Симуляция</Button></div>}</div>
      {query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {!visible?.length && !query.isLoading && !query.isError && <EmptyState title="Материалов пока нет" hint="Создайте задание, добавьте шаги и настройте условия прохождения." />}
      <div className="training-grid">{visible?.map((item) => <Card key={item.id} title={item.title} subtitle={`${LEARNING_LABELS[item.kind]} · версия ${item.revision}`} action={<Badge tone={item.status === "published" ? "success" : "neutral"}>{STATUS[item.status]}</Badge>}><div className="stack stack--tight"><p>{item.description}</p><p className="secondary small">{item.step_count} шагов · {item.pass_percent}% для прохождения · {item.xp_reward} XP · {item.coins_reward} коинов</p><Button onClick={() => setEditor(item)}>{atLeast("head") ? "Открыть редактор" : "Просмотреть"}</Button></div></Card>)}</div>
    </>}
    {editor && <ContentEditor target={typeof editor === "string" ? undefined : editor} kind={typeof editor === "string" ? editor : editor.kind} onClose={() => setEditor(null)} />}
  </div>;
}

function ContentEditor({ target, kind, onClose }: { target?: LearningContent; kind: LearningKind; onClose: () => void }) {
  const [value, setValue] = useState<ContentInput>(() => target ? inputFrom(target) : initialContent(kind));
  const [selected, setSelected] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<"settings" | "steps">("settings");
  const formId = useId(); const toast = useToast(); const client = useQueryClient();
  const { atLeast } = useAuth(); const readOnly = !atLeast("head");
  const save = useMutation({ mutationFn: () => learning.save(value, target?.id), onSuccess: () => {
    void client.invalidateQueries({ queryKey: ["learning-definitions"] }); void client.invalidateQueries({ queryKey: ["learning"] });
    toast.success(value.status === "published" ? "Материал опубликован" : "Материал сохранён"); onClose();
  } });
  function update<K extends keyof ContentInput>(key: K, next: ContentInput[K]) { setValue((current) => ({ ...current, [key]: next })); }
  const step = value.steps[selected];
  function editStep(next: Partial<LearningStep>) { update("steps", value.steps.map((item, index) => index === selected ? { ...item, ...next } : item)); }
  function removeStep(index: number) { update("steps", value.steps.filter((_, item) => item !== index)); setSelected(Math.max(0, selected - 1)); }
  function moveStep(delta: number) { const steps = [...value.steps], to = selected + delta; [steps[selected], steps[to]] = [steps[to], steps[selected]]; update("steps", steps); setSelected(to); }
  return <Sheet size="l" title={target ? target.title : `Новый материал · ${LEARNING_LABELS[kind]}`} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button onClick={onClose} disabled={save.isPending}>Закрыть</Button>{!readOnly && <Button type="submit" form={formId} variant="primary" disabled={save.isPending}>{save.isPending ? "Сохраняем…" : value.status === "published" ? "Проверить и опубликовать" : "Сохранить"}</Button>}</>}>
    <form id={formId} noValidate className="stack" onSubmit={(e) => { e.preventDefault(); if (readOnly || save.isPending) return; if (!value.title.trim() || !value.world.trim()) { setView("settings"); toast.error("Заполните название и тему материала"); return; } if (value.steps.some((s) => !s.text.trim() || s.options.some((o) => !o.trim()))) { setView("steps"); toast.error("Заполните текст и варианты ответов всех шагов"); return; } if (value.status === "published") setConfirm(true); else save.mutate(); }}>
      <div className="row"><Button variant={view === "settings" ? "primary" : "secondary"} onClick={() => setView("settings")}>Настройки</Button><Button variant={view === "steps" ? "primary" : "secondary"} onClick={() => setView("steps")}>Шаги ({value.steps.length})</Button></div>
      <fieldset className="learning-fieldset" disabled={readOnly || save.isPending}>
      <div className="stack" hidden={view !== "settings"}>
        <label className="field"><span>Название</span><input className="input" maxLength={180} required value={value.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label className="field"><span>Описание</span><textarea className="input" rows={3} maxLength={4000} value={value.description} onChange={(e) => update("description", e.target.value)} /></label>
        <div className="learning-form-grid"><label className="field"><span>Тема / мир</span><input className="input" required maxLength={80} value={value.world} onChange={(e) => update("world", e.target.value)} /></label><label className="field"><span>Сложность</span><select className="input" value={value.difficulty} onChange={(e) => update("difficulty", e.target.value as ContentInput["difficulty"])}>{Object.entries(DIFFICULTY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {([{ key: "minutes", label: "Ориентировочное время, мин", min: 1, max: 180 }, { key: "pass_percent", label: "Порог прохождения, %", min: 1, max: 100 }, { key: "xp_reward", label: "Награда XP", min: 0, max: 100000 }, { key: "coins_reward", label: "Награда в коинах", min: 0, max: 10000 }] as const).map((field) => <label className="field" key={field.key}><span>{field.label}</span><input className="input" type="number" required min={field.min} max={field.max} step={1} value={value[field.key]} onChange={(e) => update(field.key, Number(e.target.value))} /></label>)}
        <label className="field"><span>Статус</span><select className="input" value={value.status} onChange={(e) => update("status", e.target.value as ContentInput["status"])}>{Object.entries(STATUS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Пройти до (необязательно)</span><input className="input" type="date" value={value.deadline?.slice(0,10) ?? ""} onChange={(e) => update("deadline", e.target.value ? `${e.target.value}T23:59:59Z` : null)} /></label></div>
        <label className="learning-check"><input type="checkbox" checked={value.is_required} onChange={(e) => update("is_required", e.target.checked)} />Обязательное обучение</label><label className="learning-check"><input type="checkbox" checked={value.allow_back} onChange={(e) => update("allow_back", e.target.checked)} />Разрешить изменение предыдущих ответов</label>
        <p className="secondary small">Награда выдаётся за первое успешное прохождение материала. Уже начатые попытки сохраняют свою версию вопросов и условий.</p>
      </div>
      <div className="learning-studio" hidden={view !== "steps"}>
        <nav className="learning-studio__steps" aria-label="Шаги задания">{value.steps.map((item,index) => <button type="button" key={index} onClick={() => setSelected(index)} className={selected === index ? "is-selected" : ""} aria-current={selected === index ? "step" : undefined}><strong>{String(index + 1).padStart(2,"0")}</strong><span>{item.text || "Новый шаг"}</span></button>)}<Button disabled={value.steps.length >= 100} onClick={() => { update("steps", [...value.steps, newStep()]); setSelected(value.steps.length); }}>+ Добавить шаг</Button></nav>
        <div className="stack"><h3>Шаг {selected + 1}</h3><label className="field"><span>Кто говорит (необязательно)</span><input className="input" maxLength={100} value={step.speaker} onChange={(e) => editStep({ speaker: e.target.value })} /></label><label className="field"><span>Вопрос или ситуация</span><textarea className="input" rows={5} maxLength={4000} value={step.text} onChange={(e) => editStep({ text: e.target.value })} /></label>
          <fieldset className="learning-fieldset stack stack--tight"><legend>Варианты ответа · отметьте правильный</legend>{step.options.map((option,index) => <div className="learning-option-editor" key={index}><input aria-label={`Вариант ${index + 1} — правильный`} type="radio" name="correct" checked={step.correct === index} onChange={() => editStep({ correct: index })} /><input className="input" aria-label={`Текст варианта ${index + 1}`} maxLength={1000} value={option} onChange={(e) => editStep({ options: step.options.map((text,i) => i === index ? e.target.value : text) })} />{step.options.length > 2 && <Button aria-label={`Удалить вариант ${index + 1}`} onClick={() => editStep({ options: step.options.filter((_,i) => i !== index), correct: step.correct === index ? 0 : step.correct! > index ? step.correct! - 1 : step.correct })}>×</Button>}</div>)}<Button disabled={step.options.length >= 6} onClick={() => editStep({ options: [...step.options, ""] })}>+ Вариант</Button></fieldset>
          <label className="field"><span>Разбор после завершения</span><textarea className="input" rows={3} maxLength={2000} value={step.explanation} onChange={(e) => editStep({ explanation: e.target.value })} /></label><div className="row"><Button disabled={selected === 0} onClick={() => moveStep(-1)}>Выше</Button><Button disabled={selected === value.steps.length - 1} onClick={() => moveStep(1)}>Ниже</Button><Button variant="destructive" disabled={value.steps.length === 1} onClick={() => removeStep(selected)}>Удалить шаг</Button></div>
        </div>
        <aside className="learning-phone-preview" aria-label="Предпросмотр на телефоне"><span className="training-eyebrow">ПРЕДПРОСМОТР</span><p className="secondary small">Шаг {selected + 1} из {value.steps.length}</p>{step.speaker && <strong>{step.speaker}</strong>}<h3>{step.text || "Текст задания"}</h3>{step.options.map((option,index) => <div className="learning-preview-option" key={index}>○ {option || `Ответ ${index + 1}`}</div>)}<span className="btn btn--primary">Продолжить</span></aside>
      </div></fieldset>
      {save.isError && <ErrorState error={save.error} />}
    </form>
    {confirm && <Sheet title="Опубликовать обучение?" onClose={() => { if (!save.isPending) setConfirm(false); }} size="s" footer={<><Button onClick={() => setConfirm(false)} disabled={save.isPending}>Назад</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Публикуем…" : "Опубликовать"}</Button></>}><div className="stack"><strong>{value.title}</strong><p>{value.steps.length} шагов · порог {value.pass_percent}%</p><p>За первое прохождение: {value.xp_reward} XP и {value.coins_reward} коинов.</p><p>Материал появится в обучении сотрудников.</p>{save.isError && <ErrorState error={save.error} />}</div></Sheet>}
  </Sheet>;
}

export function LearningResults({ userId, kind }: { userId?: number; kind?: LearningKind }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["learning-results", userId, kind, page], queryFn: () => learning.results({ user_id: userId, kind, page }) });
  if (query.isLoading) return <RowsSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <div className="stack">{!query.data?.total && <EmptyState title="Попыток пока нет" hint="Результаты появятся, когда сотрудники начнут обучение." />}{query.data?.items.map((row) => <Card key={row.id} title={row.title} subtitle={row.full_name} action={<Badge tone={row.state === "passed" ? "success" : row.state === "failed" ? "warning" : "neutral"}>{row.state === "passed" ? "✓ Пройдено" : row.state === "failed" ? "Не пройдено" : "В процессе"}</Badge>}><p>{LEARNING_LABELS[row.kind]} · {row.answered} из {row.total} шагов{row.score !== null ? ` · ${row.score}%` : ""}</p>{row.finished_at && <p className="secondary small">{dateTime(row.finished_at)} · +{row.awarded_xp} XP · +{row.awarded_coins} коинов</p>}</Card>)}<Pagination page={page} size={20} total={query.data?.total ?? 0} onChange={setPage} /></div>;
}
