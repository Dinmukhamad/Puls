import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  voiceKeys, voiceTraining,
  type VoiceGrader, type VoicePeriod, type VoiceSkill, type VoiceTeam, type VoiceTeamCall, type VoiceTeamCallDetail, type VoiceTeamOperator,
} from "../../api/voiceTraining";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Card, Delta, EmptyState, ErrorState, KPI, KPISkeleton, Progress, RowsSkeleton, SegmentedControl } from "../../components/ui";
import { Select } from "../../components/Select";
import { AI_PLACES, AIMark, VoiceIcon, VoiceResults, VoiceTrainingPage, dateLabel, personaLabel } from "./VoiceTrainingPage";
import "./voice.css";
import "./voice-team.css";

type Tab = "overview" | "calls" | "review" | "ai";
type CallFilter = "all" | "waiting" | "low" | "ai" | "critical";
type Sort = "help" | "calls" | "name";
const PERIODS: { value: `${VoicePeriod}`; label: string }[] = [{ value: "7", label: "7 дней" }, { value: "30", label: "30 дней" }, { value: "90", label: "90 дней" }];
const LOW = 50;
const errorText = (value: unknown) => value instanceof Error ? value.message : "Не удалось выполнить действие. Повторите попытку.";
const periodWord = (days: number) => days === 7 ? "неделю" : `${days} дней`;
export const callRoute = (id: number) => `/training/voice/calls/${id}`;
const dayLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Qyzylorda" }).format(new Date(value));

/** A score in the site's colours: good from 80, worth reading with the operator below 50. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <Badge tone="warning">Ждёт оценки</Badge>;
  return <Badge tone={score >= 80 ? "success" : score < LOW ? "danger" : "neutral"}>{`${score}%`}</Badge>;
}

/** Who gave the score. */
export function GraderMark({ grader, aiReview }: { grader: VoiceGrader | null; aiReview?: number | null }) {
  if (grader === "ai") return <AIMark title="Звонок оценил ИИ (Claude)" label="ИИ" />;
  const label = grader === "mentor" ? "Наставник" : grader === "awaiting" ? "Ждёт наставника" : grader === "rules" ? "Правила" : "Идёт звонок";
  return <span className="voice-team-grader">{label}{aiReview !== null && aiReview !== undefined && <AIMark title={`Оценка ИИ рядом: ${aiReview}%`} label={`ИИ ${aiReview}%`} />}</span>;
}

/** Leaders look at their operators' calls; operators and trainees take calls and read their own. */
const LEADERS = ["trainer", "supervisor", "head", "admin"];
export function VoiceHome() {
  const { user } = useAuth();
  return user && LEADERS.includes(user.role) ? <VoiceTeamPage /> : <VoiceTrainingPage />;
}

/**
 * The voice trainer for trainers, supervisors, heads and the administrator: how their operators
 * train calls with drivers. «Обзор» — totals, who needs help and what waits for them; «Звонки» —
 * every call of the team; «Проверка» — calls waiting for a mentor; «ИИ и сценарии» — Claude and the
 * situations the drivers call with. Each call opens with its review (VoiceTeamCallPage).
 */
export function VoiceTeamPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "calls", "review", "ai"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const days = (Number(params.get("days")) || 30) as VoicePeriod;
  const group = params.get("group") ? Number(params.get("group")) : null;
  const update = (patch: Record<string, string | null>) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key, value); }
    return next;
  }, { replace: true });
  const team = useQuery({
    queryKey: voiceKeys.team(user?.id ?? "account", days, group),
    queryFn: ({ signal }) => voiceTraining.team(days, group, signal),
    enabled: !!user, retry: false, refetchOnWindowFocus: true,
  });
  const data = team.data;
  const waiting = data ? data.summary.awaiting_grade + data.summary.disputes : 0;
  const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: "Обзор" }, { value: "calls", label: "Звонки" },
    { value: "review", label: waiting ? `Проверка · ${waiting}` : "Проверка" }, { value: "ai", label: "ИИ и сценарии" },
  ];
  const showCalls = (patch: Record<string, string | null>) => update({ tab: "calls", ...patch });
  return <div className="stack voice-page voice-team">
    <header className="page-head voice-head">
      <div className="voice-head__titles">
        <h1 className="page-title">Голосовой тренажёр</h1>
        <p className="page-subtitle">Как ваши операторы тренируют звонки с водителями: результаты, кому нужна помощь и что ждёт вашего ответа.</p>
      </div>
      <div className="page-head__actions voice-team-filters">
        <SegmentedControl label="Период" options={PERIODS} value={`${days}` as `${VoicePeriod}`} onChange={value => update({ days: value })} />
        {data && data.groups.length > 1 && <Select aria-label="Группа" value={group ?? "all"} onChange={value => update({ group: value === "all" ? null : value })} options={[{ value: "all", label: "Все группы" }, ...data.groups.map(item => ({ value: item.id, label: item.name }))]} />}
      </div>
    </header>
    <nav className="voice-team-tabs" aria-label="Разделы голосового тренажёра"><SegmentedControl label="Раздел" options={tabs} value={tab} onChange={value => update({ tab: value })} /></nav>
    {team.isPending && <><KPISkeleton count={4} /><section className="card"><RowsSkeleton rows={6} /></section></>}
    {team.isError && <section className="card"><ErrorState error={team.error} onRetry={() => void team.refetch()} /></section>}
    {data && tab === "overview" && <TeamOverview team={data} onCalls={showCalls} onReview={() => update({ tab: "review" })} />}
    {data && tab === "calls" && <TeamCalls team={data} filter={(params.get("status") as CallFilter) || "all"} operator={params.get("op") ? Number(params.get("op")) : null} onFilter={value => update({ status: value === "all" ? null : value })} onOperator={value => update({ op: value === null ? null : String(value) })} />}
    {data && tab === "review" && <TeamQueue team={data} />}
    {data && tab === "ai" && <TeamAI team={data} />}
  </div>;
}

export function TeamOverview({ team, onCalls, onReview }: { team: VoiceTeam; onCalls: (patch: Record<string, string | null>) => void; onReview: () => void }) {
  const { summary, period } = team;
  const idle = team.operators.filter(item => item.calls === 0);
  return <>
    <div className="kpi-grid voice-team-kpis">
      <KPI label="Звонков" value={summary.calls} delta={summary.calls - summary.calls_before} deltaLabel="к прошлому периоду" hint={`за ${periodWord(period.days)}`} />
      <KPI label="Средний балл" value={summary.average ?? "—"} unit={summary.average === null ? undefined : "%"} delta={summary.average !== null && summary.average_before !== null ? summary.average - summary.average_before : undefined} deltaLabel="к прошлому периоду" hint={summary.average === null ? "оценённых звонков нет" : undefined} />
      <KPI label="Тренировались" value={`${summary.practiced} из ${summary.operators}`} hint="операторов и стажёров" />
      <KPI label="Оценил ИИ" value={summary.ai_graded} hint={`из ${summary.calls} звонков`} />
    </div>
    <Card title="Требует внимания" subtitle="Что ждёт вашего ответа и кому нужна помощь" className="voice-team-attention">
      <ul>
        <AttentionItem count={summary.awaiting_grade} title="Ждут вашей оценки" hint="Звонки по сценариям из конструктора, когда ИИ был недоступен" onClick={onReview} />
        <AttentionItem count={summary.disputes} title="Спорные оценки" hint="Оператор не согласен с оценкой и ждёт ответа" onClick={onReview} />
        <AttentionItem count={summary.low} title={`Звонки ниже ${LOW}%`} hint="Стоит разобрать с оператором" onClick={() => onCalls({ status: "low", op: null })} />
        <AttentionItem count={idle.length} title="Не тренировались" hint={idle.length ? `${idle.slice(0, 3).map(item => item.name).join(", ")}${idle.length > 3 ? ` и ещё ${idle.length - 3}` : ""}` : `За ${periodWord(period.days)} тренировались все`} />
      </ul>
    </Card>
    <TeamOperators team={team} onCalls={onCalls} />
    <TeamSkills skills={team.skills} />
  </>;
}

function AttentionItem({ count, title, hint, onClick }: { count: number; title: string; hint: string; onClick?: () => void }) {
  const body = <><strong className={count ? "is-on" : ""}>{count}</strong><span><b>{title}</b><small>{hint}</small></span>{onClick && count > 0 && <VoiceIcon name="arrow" size={16} />}</>;
  return <li>{onClick && count > 0 ? <button type="button" onClick={onClick}>{body}</button> : <div>{body}</div>}</li>;
}

/** Criteria the team misses most: what to train together. */
function TeamSkills({ skills }: { skills: VoiceSkill[] }) {
  return <Card title="Чему учить команду" subtitle="Критерии, которые чаще всего не выполнены в оценённых звонках" className="voice-team-skills">
    {skills.length === 0 ? <p className="voice-caption">Пока нечего подсказать: оценённых звонков с недочётами за период нет.</p>
      : <ul>{skills.map(item => <li key={item.label}>
        <div className="voice-team-skill-head"><strong>{item.label}</strong><span>выполнено в {item.passed} из {item.total}</span></div>
        <Progress value={item.passed / item.total} tone={item.passed / item.total < 0.5 ? "danger" : "warning"} size="s" label={`${item.label}: выполнено в ${item.passed} из ${item.total} звонков`} />
        {item.example && <p className="voice-team-skill-example"><span>Можно сказать так</span>{item.example}</p>}
      </li>)}</ul>}
  </Card>;
}

export function sortOperators(rows: VoiceTeamOperator[], sort: Sort) {
  const list = [...rows];
  if (sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (sort === "calls") return list.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "ru"));
  // Who needs help first: waiting answers, then the lowest average, then those who did not train.
  return list.sort((a, b) => b.waiting - a.waiting || (a.average ?? 101) - (b.average ?? 101) || a.name.localeCompare(b.name, "ru"));
}

function TeamOperators({ team, onCalls }: { team: VoiceTeam; onCalls: (patch: Record<string, string | null>) => void }) {
  const [sort, setSort] = useState<Sort>("help");
  const rows = useMemo(() => sortOperators(team.operators, sort), [team.operators, sort]);
  const open = (row: VoiceTeamOperator) => onCalls({ op: String(row.id), status: null });
  return <Card title="Операторы" subtitle={`${team.summary.practiced} из ${team.summary.operators} тренировались за ${periodWord(team.period.days)}`} padded={false} className="voice-team-operators"
    action={<SegmentedControl label="Порядок" options={[{ value: "help", label: "Нужна помощь" }, { value: "calls", label: "По звонкам" }, { value: "name", label: "По имени" }]} value={sort} onChange={setSort} />}>
    {rows.length === 0 ? <div className="card__body"><EmptyState title="Операторов пока нет" hint="Здесь появятся операторы и стажёры ваших групп." /></div> : <>
      <div className="table-wrap table-wrap--responsive">
        <table className="table">
          <thead><tr><th>Оператор</th><th className="num">Звонков</th><th className="num">Средний балл</th><th>Последний звонок</th><th>Слабое место</th><th aria-label="Звонки оператора" /></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td><div className="voice-team-person"><strong>{row.name}</strong><small>{[row.group_name, row.role === "trainee" ? "стажёр" : null].filter(Boolean).join(" · ") || "Без группы"}</small></div></td>
            <td className="num">{row.calls || <span className="voice-team-muted">—</span>}</td>
            <td className="num"><div className="voice-team-score">{row.average === null ? <span className="voice-team-muted">нет оценок</span> : <ScoreBadge score={row.average} />}{row.change !== null && <Delta value={row.change} />}</div></td>
            <td>{row.last ? <Link className="voice-team-link" to={callRoute(row.last.id)}>{dayLabel(row.last.at)} · {row.last.score === null ? "ждёт оценки" : `${row.last.score}%`}</Link> : <span className="voice-team-muted">не звонил за период</span>}</td>
            <td>{row.weak[0] ?? <span className="voice-team-muted">—</span>}{row.waiting > 0 && <Badge tone="warning">{`Ждёт ответа · ${row.waiting}`}</Badge>}</td>
            <td className="num">{row.calls > 0 && <Button size="s" variant="plain" onClick={() => open(row)}>Звонки</Button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ul className="card-list voice-team-cards">{rows.map(row => <li key={row.id} className="list-card">
        <div className="voice-team-card-head"><div className="voice-team-person"><strong>{row.name}</strong><small>{row.group_name ?? "Без группы"}{row.role === "trainee" ? " · стажёр" : ""}</small></div>{row.average === null ? <span className="voice-team-muted">нет оценок</span> : <ScoreBadge score={row.average} />}</div>
        <p className="voice-team-card-line">{row.calls ? `${row.calls} звонк${row.calls === 1 ? "" : row.calls < 5 ? "а" : "ов"}` : "Не звонил за период"}{row.last ? ` · последний ${dayLabel(row.last.at)}` : ""}{row.weak[0] ? ` · слабое место: ${row.weak[0]}` : ""}</p>
        {row.calls > 0 && <Button size="s" variant="secondary" onClick={() => open(row)}>Звонки оператора</Button>}
      </li>)}</ul>
    </>}
  </Card>;
}

function matches(call: VoiceTeamCall, filter: CallFilter) {
  if (filter === "waiting") return call.review_status === "pending" || call.review_status === "awaiting_grade";
  if (filter === "low") return call.score !== null && call.score < LOW;
  if (filter === "ai") return call.grader === "ai" || call.ai_review !== null;
  if (filter === "critical") return call.critical;
  return true;
}

export function TeamCalls({ team, filter, operator, onFilter, onOperator }: { team: VoiceTeam; filter: CallFilter; operator: number | null; onFilter: (value: CallFilter) => void; onOperator: (value: number | null) => void }) {
  const [search, setSearch] = useState("");
  const person = operator === null ? null : team.operators.find(item => item.id === operator) ?? null;
  const needle = search.trim().toLocaleLowerCase("ru");
  const calls = team.calls.filter(call => matches(call, filter) && (operator === null || call.user_id === operator) && (!needle || call.user_name.toLocaleLowerCase("ru").includes(needle)));
  return <Card title="Звонки команды" subtitle={`За ${periodWord(team.period.days)}: ${team.calls.length}. Откройте звонок, чтобы прочитать разговор и разбор.`} padded={false} className="voice-team-calls">
    <div className="voice-team-toolbar">
      <input className="input" type="search" placeholder="Найти оператора" aria-label="Найти оператора" value={search} onChange={event => setSearch(event.target.value)} />
      <SegmentedControl label="Какие звонки" value={filter} onChange={onFilter} options={[{ value: "all", label: "Все" }, { value: "waiting", label: "Ждут ответа" }, { value: "low", label: `Ниже ${LOW}%` }, { value: "critical", label: "С ошибками" }, { value: "ai", label: "Оценка ИИ" }]} />
      {person && <button type="button" className="voice-team-chip" onClick={() => onOperator(null)}>{person.name}<span aria-hidden="true">×</span><span className="sr-only">Показать всех операторов</span></button>}
    </div>
    {calls.length === 0 ? <div className="card__body"><EmptyState title="Звонков нет" hint={filter === "all" && !person && !needle ? `За ${periodWord(team.period.days)} операторы не принимали звонков.` : "Измените фильтр или период."} /></div> : <>
      <div className="table-wrap table-wrap--responsive">
        <table className="table">
          <thead><tr><th>Когда</th><th>Оператор</th><th>Звонок</th><th className="num">Балл</th><th>Кто оценил</th><th aria-label="Открыть" /></tr></thead>
          <tbody>{calls.map(call => <tr key={call.id}>
            <td className="voice-team-nowrap">{dateLabel(call.created_at)}</td>
            <td><div className="voice-team-person"><strong>{call.user_name}</strong><small>{call.group_name ?? "Без группы"}</small></div></td>
            <td><div className="voice-team-person"><strong>{call.title}{call.ai_driver && <AIMark title="Водителя играл ИИ (Claude)" />}</strong><small>{personaLabel(call.persona)}{call.language === "kk" ? " · Қазақша" : ""}{call.critical ? " · критическая ошибка" : ""}</small></div></td>
            <td className="num">{call.state === "completed" ? <ScoreBadge score={call.score} /> : <Badge tone="info">Идёт</Badge>}</td>
            <td><GraderMark grader={call.grader} aiReview={call.ai_review} />{call.review_status === "pending" && <Badge tone="warning">Спор</Badge>}</td>
            <td className="num"><Link className="btn btn--plain btn--s" to={callRoute(call.id)}>Открыть</Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      <ul className="card-list voice-team-cards">{calls.map(call => <li key={call.id} className="list-card"><Link className="voice-team-call-card" to={callRoute(call.id)}>
        <div className="voice-team-card-head"><div className="voice-team-person"><strong>{call.user_name}</strong><small>{dateLabel(call.created_at)}</small></div>{call.state === "completed" ? <ScoreBadge score={call.score} /> : <Badge tone="info">Идёт</Badge>}</div>
        <p className="voice-team-card-line">{call.title} · {personaLabel(call.persona)}</p>
        <p className="voice-team-card-line"><GraderMark grader={call.grader} aiReview={call.ai_review} />{call.review_status === "pending" && <Badge tone="warning">Спор</Badge>}</p>
      </Link></li>)}</ul>
    </>}
  </Card>;
}

/** Calls waiting for a mentor: the editor's calls to grade and disputed scores, oldest first. */
export function TeamQueue({ team }: { team: VoiceTeam }) {
  const queue = [...team.queue].reverse();
  return <Card title="Проверка" subtitle="Звонки, которые ждут вашего ответа. Ответ и оценка появятся у оператора в разборе." className="voice-team-queue">
    {queue.length === 0 ? <EmptyState title="Ничего не ждёт вашего ответа" hint="Сюда приходят спорные оценки и звонки по сценариям из конструктора, если ИИ не смог их оценить." />
      : <ul>{queue.map(item => <li key={item.id}>
        <div className="voice-team-queue-head">
          <div className="voice-team-person"><strong>{item.user_name}</strong><small>{item.title} · {personaLabel(item.persona)} · {dateLabel(item.created_at)}</small></div>
          <Badge tone="warning">{item.review_status === "awaiting_grade" ? "Поставить оценку" : "Спор об оценке"}</Badge>
        </div>
        {item.review_status === "pending" && item.comment && <blockquote>«{item.comment}»<cite>Оператор{item.requested_at ? ` · ${dateLabel(item.requested_at)}` : ""}</cite></blockquote>}
        <div className="voice-team-queue-foot"><span>{item.review_status === "pending" ? <>Оценка: <ScoreBadge score={item.score} /> <GraderMark grader={item.grader} /></> : "ИИ был недоступен — оценку ставит наставник"}</span><Link className="btn btn--primary btn--s" to={callRoute(item.id)}>Открыть и ответить</Link></div>
      </li>)}</ul>}
  </Card>;
}

export function TeamAI({ team }: { team: VoiceTeam }) {
  const { ai } = team;
  const money = (value: number) => `$${value.toFixed(value < 1 ? 2 : 0)}`;
  return <div className="voice-team-grid voice-team-grid--even">
    <Card title="ИИ (Claude)" subtitle="Играет водителя и оценивает звонки" className="voice-team-ai" action={<Badge tone={ai.active ? "success" : "neutral"}>{ai.active ? "Включён" : ai.configured ? "Лимит исчерпан" : "Не подключён"}</Badge>}>
      <div className="voice-team-budget">
        <div><strong>{money(ai.spent_usd)}</strong><span>из {money(ai.budget_usd)} за месяц</span></div>
        <Progress value={ai.budget_usd ? ai.spent_usd / ai.budget_usd : 0} tone={ai.spent_usd >= ai.budget_usd * 0.8 ? "warning" : "accent"} size="s" label="Расход ИИ за месяц" />
        <small>Обращений к ИИ в этом месяце: {ai.calls}. Звонок обходится примерно в $0,003–0,004.</small>
      </div>
      {!ai.active && <p className="voice-caption">{ai.configured ? "Лимит месяца исчерпан: до 1-го числа водитель говорит заготовленными фразами, звонки оценивают правила, а сценарии из конструктора — наставник." : "Ключ ИИ не подключён: водитель говорит заготовленными фразами, звонки оценивают правила, а сценарии из конструктора — наставник."}</p>}
      <ul className="voice-ai-places__list voice-team-places">{AI_PLACES.map(item => <li key={item.title}><strong>{item.title}</strong><p><span>Водитель</span>{item.driver}</p><p><span>Оценка</span>{item.grade}</p></li>)}</ul>
    </Card>
    <div className="voice-team-side">
      <Card title="Сценарии звонков" subtitle="С какими ситуациями звонят водители" action={<Link className="btn btn--secondary btn--s" to="/admin/learning/voice-scenarios">Конструктор</Link>}>
        <ul className="voice-team-scenarios">
          <li><strong>«Смена номера телефона»</strong><span>Встроенный сценарий, русский и казахский</span></li>
          <li><strong>{team.scenarios ? `${team.scenarios} из конструктора` : "Из конструктора — пока нет"}</strong><span>{team.scenarios ? "Опубликованные сценарии звонят наравне со встроенным" : "Опубликуйте сценарий — водители начнут звонить с ним"}</span></li>
        </ul>
      </Card>
      <Card title="Как оператор принимает звонки" subtitle="Что видит оператор">
        <ol className="voice-ready-list">
          <li><span>1</span><p>Открывает учебный Oktell<small>Рабочие сайты → Oktell, нужен QR-допуск.</small></p></li>
          <li><span>2</span><p>Входит в call-центр<small>Без паузы, «На связи», «Веб-телефон» и «Автоответ» включены — водитель позвонит сам.</small></p></li>
          <li><span>3</span><p>Отвечает голосом<small>Характер водителя и сценарий выбираются случайно. Пока идёт звонок, можно открыть аккаунт водителя в Диспетчерской.</small></p></li>
          <li><span>4</span><p>Завершает звонок<small>Разбор с оценкой появляется сразу, а все звонки — здесь, у вас.</small></p></li>
        </ol>
      </Card>
    </div>
  </div>;
}

/** An operator's call as a leader reads it, and the mentor's answer when the call waits for it. */
export function VoiceTeamCallPage() {
  const { attemptId } = useParams(), client = useQueryClient();
  const call = useQuery({ queryKey: voiceKeys.teamCall(attemptId ?? ""), queryFn: ({ signal }) => voiceTraining.teamCall(attemptId!, signal), enabled: !!attemptId, retry: false, refetchOnWindowFocus: true });
  const saved = (value: VoiceTeamCallDetail) => {
    client.setQueryData(voiceKeys.teamCall(value.id), value);
    void client.invalidateQueries({ queryKey: ["learning-voice-team"] });
  };
  const aiReview = useMutation({ mutationFn: () => voiceTraining.teamAiReview(attemptId!), onSuccess: saved });
  useEffect(() => { aiReview.reset(); }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = call.data;
  return <div className="stack voice-page voice-team">
    <header className="page-head voice-head">
      <div className="voice-head__titles">
        <Link className="voice-back" to="/training/voice?tab=calls"><VoiceIcon name="back" size={16} />Звонки команды</Link>
        <h1 className="page-title">{current ? current.learner.name : "Звонок оператора"}</h1>
        {current && <p className="page-subtitle">{current.title} · {personaLabel(current.persona)} водитель · {dateLabel(current.created_at)}</p>}
      </div>
      {current && <div className="page-head__actions">{current.learner.group_name && <Badge>{current.learner.group_name}</Badge>}{current.language === "kk" && <Badge>Қазақша</Badge>}</div>}
    </header>
    {call.isPending && <section className="card"><RowsSkeleton rows={5} /></section>}
    {call.isError && <section className="card"><ErrorState error={call.error} onRetry={() => void call.refetch()} /></section>}
    {current && <>
      {current.result?.review_status === "reviewed" && current.result.mentor_comment && !current.result.manual && <section className="card voice-mentor-card"><h2 className="card__title">Ответ наставника{current.result.mentor_name ? ` · ${current.result.mentor_name}` : ""}</h2>{current.review?.comment && <blockquote>«{current.review.comment}»<cite>Оператор</cite></blockquote>}<p>{current.result.mentor_comment}</p></section>}
      {current.needs_answer && <MentorAnswer call={current} onSaved={() => void call.refetch().then(() => client.invalidateQueries({ queryKey: ["learning-voice-team"] }))} />}
      {current.state === "in_progress" ? <section className="card voice-update-notice"><div><strong>Звонок ещё идёт</strong><p>Оператор разговаривает с водителем в Oktell. Разбор появится, когда звонок завершится.</p></div><Button onClick={() => void call.refetch()}>Обновить</Button></section>
        : <VoiceResults attempt={current} pending={false} viewer aiReview={{ run: () => aiReview.mutate(), pending: aiReview.isPending, error: aiReview.error ? errorText(aiReview.error) : "" }} />}
    </>}
  </div>;
}

/** The mentor's answer: a score for a call from the editor, or a reply to a disputed score. */
export function MentorAnswer({ call, onSaved }: { call: VoiceTeamCallDetail; onSaved: () => void }) {
  const grading = call.result?.review_status === "awaiting_grade";
  const [comment, setComment] = useState(""), [score, setScore] = useState("");
  const validScore = /^\d{1,3}$/.test(score) && Number(score) <= 100;
  const resolve = useMutation({ mutationFn: () => voiceTraining.resolve(call.id, comment.trim(), grading ? Number(score) : null), onSuccess: onSaved });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (comment.trim().length < 3 || resolve.isPending || (grading && !validScore)) return;
    resolve.mutate();
  };
  return <section className="card voice-team-answer" aria-labelledby="voice-team-answer-title">
    <div className="voice-team-answer__head"><Badge tone="warning">{grading ? "Ждёт вашей оценки" : "Спор об оценке"}</Badge><h2 className="card__title" id="voice-team-answer-title">{grading ? "Поставьте оценку звонку" : "Оператор не согласен с оценкой"}</h2><p className="card__subtitle">{grading ? "Звонок по сценарию из конструктора: ИИ был недоступен, оценку ставит наставник. Ниже — что узнал тренажёр и весь разговор." : "Прочитайте разговор и разбор ниже и ответьте оператору. Ответ появится у него в разборе."}</p></div>
    {!grading && call.review?.comment && <blockquote>«{call.review.comment}»<cite>Оператор · {dateLabel(call.review.created_at)}</cite></blockquote>}
    <form onSubmit={submit}>
      {grading && <label className="voice-team-answer__score"><span className="field__label">Оценка, %</span><input className="input" inputMode="numeric" value={score} onChange={event => setScore(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="0–100" required aria-invalid={score !== "" && !validScore} /></label>}
      <label><span className="field__label">{grading ? "Комментарий для оператора" : "Ответ оператору"}</span><textarea className="input" rows={3} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} required placeholder={grading ? "Что получилось и что улучшить" : "Согласны ли вы с оценкой и почему"} /></label>
      {resolve.isError && <p className="voice-ai-review__error" role="alert">{errorText(resolve.error)}</p>}
      <div className="voice-inline-actions"><Button type="submit" variant="primary" disabled={resolve.isPending || comment.trim().length < 3 || (grading && !validScore)}>{resolve.isPending ? "Сохраняем…" : grading ? "Сохранить оценку" : "Ответить оператору"}</Button></div>
    </form>
  </section>;
}
