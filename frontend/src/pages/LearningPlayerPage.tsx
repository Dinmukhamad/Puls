import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { learning, attemptPath, type LearningAttempt, type LearningStep } from "../api/learning";
import { Badge, Button, Card, ErrorState, Progress, RowsSkeleton } from "../components/ui";
import "./learning.css";

export function LearningPlayerPage() {
  const { attemptId } = useParams();
  return <AttemptPlayer key={attemptId} id={Number(attemptId)} />;
}
function AttemptPlayer({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["learning-attempt", id], queryFn: () => learning.attempt(id), refetchOnWindowFocus: false });
  const [index, setIndex] = useState<number | null>(null);
  const client = useQueryClient();
  const save = useMutation({ mutationFn: async ({ step, answer }: { step: number; answer: number }) => {
    const attempt = await learning.answer(id, step, answer);
    return step === attempt.content.steps.length - 1 ? learning.finish(id) : attempt;
  }, onSuccess: (attempt, { step }) => {
    client.setQueryData(["learning-attempt", id], attempt);
    for (const key of ["learning", "learning-results", "coin-progress", "badges", "dashboard", "wallet", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
    if (attempt.state === "in_progress") setIndex(step + 1);
  } });
  if (query.isLoading) return <RowsSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const attempt = query.data!;
  if (attempt.state !== "in_progress") return <LearningResult attempt={attempt} />;
  if (attempt.content.kind === "simulator") return <Card title="Практический сценарий"><Link className="btn btn--primary" to={attemptPath(attempt)}>Открыть симулятор</Link></Card>;
  const step = index ?? Math.min(Object.keys(attempt.answers).length, attempt.content.steps.length - 1);
  return <div className="learning-player stack"><Link to="/training" className="learning-back">‹ Обучение</Link><header>{attempt.is_preview && <p role="status">Тестовое прохождение · без наград и рабочей статистики</p>}<Badge tone="accent">{attempt.content.kind === "test" ? "Проверка знаний" : attempt.content.world}</Badge><h1 className="page-title">{attempt.content.title}</h1></header>
    <div className="stack stack--tight"><p className="secondary">{attempt.content.kind === "test" ? "Вопрос" : "Шаг"} {step + 1} из {attempt.content.steps.length}</p><Progress value={step / attempt.content.steps.length} tone="accent" label="Прогресс задания" /></div>
    <Question key={step} step={attempt.content.steps[step]} saved={attempt.answers[String(step)]} locked={!attempt.content.allow_back && String(step) in attempt.answers} pending={save.isPending} onSave={(answer) => save.mutate({ step, answer })} last={step === attempt.content.steps.length - 1} />
    {save.isError && <ErrorState error={save.error} />}
    {attempt.content.allow_back && step > 0 && <Button disabled={save.isPending} onClick={() => setIndex(step - 1)}>Предыдущий вопрос</Button>}
    <p className="secondary small">Ответ сохраняется при переходе к следующему шагу. Для прохождения нужно {attempt.content.pass_percent}% правильных ответов.</p>
  </div>;
}

export function Question({ step, saved, locked = false, pending, onSave, last = false }: { step: LearningStep; saved?: number; locked?: boolean; pending: boolean; onSave: (answer: number) => void; last?: boolean }) {
  const [selected, setSelected] = useState(saved);
  return <Card><form className="stack" onSubmit={(e) => { e.preventDefault(); if (selected !== undefined && !pending) onSave(selected); }}>
    {step.speaker && <span className="learning-speaker">{step.speaker}</span>}<h2 className="learning-question">{step.text}</h2>
    <fieldset className="learning-options" disabled={pending || locked}><legend className="sr-only">Выберите ответ</legend>{step.options.map((option, index) => <label className={`learning-option${selected === index ? " is-selected" : ""}`} key={index}><input type="radio" name="answer" checked={selected === index} onChange={() => setSelected(index)} required /><span>{option}</span></label>)}</fieldset>
    <Button type="submit" variant="primary" disabled={pending || selected === undefined}>{pending ? "Сохраняем…" : last ? "Завершить" : "Продолжить"}</Button>
  </form></Card>;
}

export function LearningResult({ attempt }: { attempt: LearningAttempt }) {
  const [review, setReview] = useState(false);
  const navigate = useNavigate();
  const repeat = useMutation({ mutationFn: () => learning.start(attempt.content_id), onSuccess: (item) => navigate(attemptPath(item)) });
  const passed = attempt.state === "passed";
  return <div className="learning-player stack"><Link className="learning-back" to="/training">‹ Обучение</Link><Card className="learning-result"><span className="training-eyebrow">{attempt.content.title}</span><h1>{attempt.is_preview ? "Тестовая проверка завершена" : "Задание завершено"}</h1><div className="learning-result__score">{attempt.score}%</div><Badge tone={passed ? "success" : "warning"}>{passed ? "✓ Пройдено" : "Попробуйте ещё раз"}</Badge><p>{attempt.correct} из {attempt.content.steps.length} правильных решений</p><div className="row learning-result__rewards">{attempt.awarded_coins > 0 && <Badge tone="coin">+{attempt.awarded_coins} коинов</Badge>}</div><p className="secondary small">{attempt.is_preview ? "Результат не включён в статистику операторов. Награда не начисляется." : passed ? "Награда за этот материал выдаётся один раз. Повторение помогает закрепить знания." : `Для прохождения необходимо ${attempt.content.pass_percent}% правильных ответов.`}</p></Card>
    <div className="row"><Button onClick={() => setReview(!review)}>{review ? "Скрыть разбор" : "Посмотреть разбор"}</Button><Button variant="primary" disabled={repeat.isPending} onClick={() => repeat.mutate()}>Повторить</Button></div>
    {repeat.isError && <ErrorState error={repeat.error} />}
    {review && attempt.content.steps.map((step, index) => <Card key={index} title={`${index + 1}. ${step.text}`} action={<Badge tone={attempt.answers[String(index)] === step.correct ? "success" : "warning"}>{attempt.answers[String(index)] === step.correct ? "✓ Верно" : "Ошибка"}</Badge>}><div className="stack stack--tight"><p>Ваш ответ: {step.options[attempt.answers[String(index)]]}</p><p><strong>Верное решение:</strong> {step.options[step.correct!]}</p>{step.explanation && <p className="secondary">{step.explanation}</p>}</div></Card>)}
  </div>;
}
