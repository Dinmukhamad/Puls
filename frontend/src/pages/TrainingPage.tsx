import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { learning, learningKindFilter, VISIBLE_LEARNING_KINDS, attemptPath, DIFFICULTY, LEARNING_LABELS, type LearningContent } from "../api/learning";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, Progress, RowsSkeleton, SegmentedControl } from "../components/ui";
import { dateOnly } from "../utils/format";
import "./learning.css";
import { DriverEntry } from "./DriverEntry";
import { driverShift } from "../api/driverShift";

export function TrainingPage() {
  const [params, setParams] = useSearchParams();
  const { user, atLeast } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["learning"], queryFn: learning.catalog });
  const client = useQueryClient();
  const start = useMutation({ mutationFn: async (id: number) => {
    const content = query.data?.find(item => item.id === id);
    if (content?.is_driver) {
      const data = await driverShift.start({ id: crypto.randomUUID(), mode: "assessment", content_id: id });
      client.setQueryData(["driver-profile"], data); navigate("/simulator");
    } else navigate(attemptPath(await learning.start(id)));
  } });
  const kind = learningKindFilter(params.get("kind")), state = params.get("state") ?? "all";
  const items = query.data ?? [];
  const completed = items.filter((item) => item.completed).length;
  const assignments = [...items].sort((a, b) => Number(!!b.assigned) - Number(!!a.assigned));
  const next = assignments.find((item) => item.state === "in_progress") ?? assignments.find((item) => item.is_required && !item.completed) ?? assignments.find((item) => !item.completed);
  const visible = assignments.filter((item) => (kind === "all" || kind === item.kind) && (state === "all" || (state === "passed" ? item.completed : state === item.state)));
  function update(key: string, value: string) { const next = new URLSearchParams(params); next.set(key, value); setParams(next); }
  return <div className="stack training-page">
    <div className="page-head"><div><h1 className="page-title">Обучение</h1><p className="page-subtitle">{user?.role === "trainer" ? "Тестовые прохождения без наград и рабочей статистики" : "Знания, решения и практика — шаг за шагом"}</p></div>{(atLeast("supervisor") || user?.role === "trainer") && <Link className="btn btn--secondary" to="/admin/learning">Студия обучения</Link>}</div>
    {(kind === "all" || kind === "simulator") && <DriverEntry />}
    {kind === "all" && <Card title="Рабочие сайты" subtitle="Практика в интерфейсах, с которыми работает оператор" action={<Link className="btn btn--primary" to="/training/work-sites">Открыть рабочие сайты →</Link>}><p className="secondary">CRM-система: создание обращений, категории и общая история. Диспетчерская и другие сайты появятся позже.</p></Card>}
    <>{query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {query.data && <>
      <section className="training-hero"><div><span className="training-eyebrow">ВАШЕ РАЗВИТИЕ</span><h2>Следующий шаг<br />к уверенной работе.</h2><p>Проверяйте знания, разбирайте ситуации и проходите путь водителя.</p></div><div className="training-hero__progress"><strong>{items.length ? Math.round(completed / items.length * 100) : 0}<span>%</span></strong><span>Завершено {completed} из {items.length}</span><Progress value={items.length ? completed / items.length : 0} tone="accent" label="Общий прогресс обучения" /></div></section>
      {next && <Card title={next.state === "in_progress" ? "Продолжить обучение" : "Ваш следующий шаг"} subtitle={next.title} action={<Button variant="primary" disabled={start.isPending} onClick={() => start.mutate(next.id)}>{next.state === "in_progress" ? "Продолжить" : "Начать"}</Button>}><p className="secondary">{LEARNING_LABELS[next.kind]} · {next.minutes} мин · {next.answered ?? 0} из {next.step_count} шагов</p></Card>}
      <div className="training-categories">{VISIBLE_LEARNING_KINDS.map((type) => <button className={`training-category training-category--${type}`} key={type} onClick={() => update("kind", type)} aria-pressed={kind === type}><span>{LEARNING_LABELS[type]}</span><strong>{items.filter((item) => item.kind === type && item.completed).length}<small> / {items.filter((item) => item.kind === type).length}</small></strong></button>)}</div>
      <div className="training-filters"><label className="field"><span>Раздел</span><select className="input" value={kind} onChange={(e) => update("kind", e.target.value)}><option value="all">Всё обучение</option>{VISIBLE_LEARNING_KINDS.map(key => [key, LEARNING_LABELS[key]]).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><SegmentedControl label="Статус обучения" value={state} options={[{value:"all", label:"Все"},{value:"new",label:"Новые"},{value:"in_progress",label:"В процессе"},{value:"passed",label:"Пройденные"}]} onChange={(value) => update("state", value)} /></div>
      {!visible.length && <EmptyState title={items.length ? "Таких заданий пока нет" : "Обучение скоро появится"} hint={items.length ? "Выберите другой раздел или статус." : "Опубликованные руководителем тесты и сценарии появятся здесь."} />}
      <div className="training-grid">{visible.map((item) => <LearningCard key={item.id} item={item} pending={start.isPending} onStart={() => start.mutate(item.id)} />)}</div>
    </>}
    {start.isError && <ErrorState error={start.error} />}</>
  </div>;
}

function LearningCard({ item, pending, onStart }: { item: LearningContent; pending: boolean; onStart: () => void }) {
  return <Card className={`learning-card learning-card--${item.kind}`} title={item.title} subtitle={`${item.world} · ${LEARNING_LABELS[item.kind]}`}>
    <div className="stack stack--tight"><div className="row">{item.is_required && <Badge tone="warning">Обязательно</Badge>}{item.completed && <Badge tone="success">✓ Пройдено</Badge>}{item.state === "in_progress" && <Badge tone="accent">В процессе</Badge>}</div>
    <p className="learning-description">{item.description}</p><p className="secondary small">{DIFFICULTY[item.difficulty]} сложность · {item.minutes} мин · {item.step_count} {item.kind === "test" ? "вопросов" : "шагов"}</p>
    {item.deadline && <p className="small">Пройти до {dateOnly(item.deadline)}</p>}
    <div className="row">{item.coins_reward > 0 && <Badge tone="coin">{item.coins_reward} коинов</Badge>}</div>
    {item.state === "in_progress" && <Progress tone="accent" value={(item.answered ?? 0) / item.step_count} label="Прогресс задания" />}
    <Button block variant={item.completed ? "secondary" : "primary"} onClick={onStart} disabled={pending}>{item.state === "in_progress" ? "Продолжить" : item.completed ? "Повторить" : "Начать"}</Button>
    {item.attempt_id && item.state !== "in_progress" && <Link to={item.kind === "simulator" ? `/simulator/attempts/${item.attempt_id}` : `/training/attempts/${item.attempt_id}`} className="learning-result-link">Последний результат</Link>}</div>
  </Card>;
}
