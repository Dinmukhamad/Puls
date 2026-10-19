import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { team, teamError } from "../api/team";
import { learning } from "../api/learning";
import { progressApi } from "../api/progress";
import type { Role, UserOut } from "../api/types";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, EmptyState, ErrorState, Pagination, Progress, Skeleton } from "../components/ui";
import { AvatarEditor } from "../components/AvatarEditor";
import { ChevronRightIcon } from "../components/icons";
import { CHANNEL_LABELS, ROLE_LABELS, REQUEST_STATUS_LABELS, coins, dateOnly, dateTime, plural, points } from "../utils/format";
import { UserArchive, UserEditor } from "./UsersPage";
import { TraineeResults } from "./TraineeResults";
import { teamOf, teamTitles } from "./teamSection";
import "./team.css";
import "./employee.css";

/** The page of an employee (`/admin/users/:id`), for links from elsewhere: the same card as the window over a list. */
export function UserDetailPage() {
  const id = Number(useParams().userId);
  const { user: actor } = useAuth();
  return <div className="stack team-page employee-page">
    <Link className="secondary" to="/admin/users">← {teamTitles(actor?.role).users}</Link>
    {Number.isInteger(id) && id > 0 ? <EmployeeCard key={id} id={id} /> : <EmptyState title="Сотрудник не найден" />}
  </div>;
}

/**
 * The employee window over a list of «Команда» (docs/TEAM_SECTION.md): `?person=ID` opens it. Closing goes back to the
 * list as it was: one step back when the list opened it, otherwise the address simply loses the person.
 */
export function PersonWindow() {
  const [params, setParams] = useSearchParams();
  const location = useLocation(), navigate = useNavigate();
  const id = Number(params.get("person"));
  if (!Number.isInteger(id) || id <= 0) return null;
  function close() {
    if ((location.state as { person?: boolean } | null)?.person) { navigate(-1); return; }
    const next = new URLSearchParams(params); next.delete("person"); setParams(next, { replace: true });
  }
  return <EmployeeCard key={id} id={id} onClose={close} />;
}

/**
 * Everything about an employee on one screen, without tabs: what can be done with the account, this week's results, the
 * level, a trainee's preparation, training attempts, purchases and the employee's data. What other sections already show
 * for one person (the history of coins, the path in Driver Simulator) is a link there, not a copy.
 */
export function EmployeeCard({ id, onClose }: { id: number; onClose?: () => void }) {
  const { user: actor, atLeast } = useAuth();
  const { can } = useAccess();
  const trainer = actor?.role === "trainer";
  const [editor, setEditor] = useState(false), [archive, setArchive] = useState(false), [password, setPassword] = useState(false);
  const [loginEditor, setLoginEditor] = useState(false), [avatarEditor, setAvatarEditor] = useState(false);
  const user = useQuery({ queryKey: ["team-user", id], queryFn: () => team.user(id) });
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups, enabled: !trainer });
  const teams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal), enabled: !trainer });
  const data = user.data;
  const operator = data?.role === "operator", trainee = data?.role === "trainee";
  const show = {
    week: operator && !trainer,
    wallet: operator && !trainer && can("motivation"),
    learning: (operator || trainee) && (trainer || trainee || can("learning_admin")),
  };

  let body: ReactNode;
  if (user.isPending) body = <Skeleton height={240} />;
  else if (user.isError) body = <ErrorState error={user.error} onRetry={() => user.refetch()} />;
  else if (!data) body = <EmptyState title="Сотрудник не найден" />;
  else {
    const teamLabel = teamOf(data, groups.data ?? [], teams.data ?? [], actor?.role);
    const editable = atLeast("head") && (data.role !== "admin" || actor?.role === "admin") && (!data.is_developer || actor?.is_developer);
    const credentials = canManageCredentials(actor, data) && (!data.is_developer || Boolean(actor?.is_developer));
    const photo = editable && data.is_active && (operator || trainee);
    const links: [string, string, string][] = [
      ...(show.wallet ? [[`/admin/wallet?user=${id}`, "История коинов", "Все начисления и списания"] as [string, string, string]] : []),
      ...(show.learning && (trainer || can("learning_admin")) ? [[`/admin/learning-analytics?participant=${id}`, "Driver Simulator", "Смены, заказы и навыки"] as [string, string, string]] : []),
      ...(data.role === "supervisor" ? [[`/admin/users?role=operator&supervisor=${id}`, "Операторы команды", teamLabel] as [string, string, string]] : []),
    ];
    body = <div className="employee">
      <section className="employee__hero" aria-label="Сотрудник">
        <Avatar name={data.full_name} id={id} size={64} />
        <div className="employee__identity">
          {!onClose && <h1 className="page-title">{data.full_name}</h1>}
          <div className="employee__tags"><Badge tone="neutral">{ROLE_LABELS[data.role]}</Badge>{!data.is_active && <Badge tone="warning">В архиве</Badge>}</div>
          {!trainer && <p className="employee__team">{teamLabel}</p>}
        </div>
        {(editable || credentials || photo) && <div className="employee__actions">
          {editable && <Button size="s" variant="primary" onClick={() => setEditor(true)}>Изменить</Button>}
          {photo && <Button size="s" onClick={() => setAvatarEditor(true)}>Фото</Button>}
          {credentials && <Button size="s" onClick={() => setLoginEditor(true)}>Логин</Button>}
          {credentials && <Button size="s" onClick={() => setPassword(true)}>Пароль</Button>}
          {editable && actor?.id !== id && <Button size="s" variant="plain" onClick={() => setArchive(true)}>{data.is_active ? "В архив" : "Восстановить"}</Button>}
        </div>}
      </section>
      {show.week && <EmployeeWeek id={id} />}
      {show.wallet && <EmployeeLevel id={id} />}
      {trainee && <TraineeResults userId={id} />}
      {show.learning && <EmployeeLearning id={id} />}
      {show.wallet && <EmployeePurchases id={id} />}
      <section className="employee__section" aria-labelledby={`employee-data-${id}`}>
        <h3 id={`employee-data-${id}`}>Данные</h3>
        <dl className="employee-data">
          <div><dt>Логин</dt><dd>{data.login}</dd></div>
          {!trainer && <><div><dt>Телефон</dt><dd>{data.phone ?? "—"}</dd></div><div><dt>Email</dt><dd>{data.email ?? "—"}</dd></div>
            <div><dt>Дата приёма</dt><dd>{data.hired_on ? dateOnly(data.hired_on) : "—"}</dd></div>
            {data.role === "operator" && <div><dt>Направление</dt><dd>{CHANNEL_LABELS[data.channel ?? "line"]}</dd></div>}</>}
          <div><dt>В Puls с</dt><dd>{data.created_at ? dateOnly(data.created_at) : "—"}</dd></div>
        </dl>
      </section>
      {links.length > 0 && <nav className="employee__section employee-links" aria-label="Ещё о сотруднике">
        {links.map(([to, title, hint]) => <Link key={to} to={to}><span><strong>{title}</strong><small>{hint}</small></span><ChevronRightIcon size={16} /></Link>)}
      </nav>}
      {editor && <UserEditor target={data} groups={groups.data ?? []} groupsReady={groups.isSuccess} onClose={() => setEditor(false)} />}
      {avatarEditor && <AvatarEditor userId={id} name={data.full_name} staff onClose={() => setAvatarEditor(false)} />}
      {archive && <UserArchive target={data} onClose={() => setArchive(false)} />}
      {loginEditor && <ResetLogin id={id} current={data.login} onClose={() => setLoginEditor(false)} />}
      {password && <ResetPassword id={id} onClose={() => setPassword(false)} />}
    </div>;
  }
  if (!onClose) return body;
  return <Sheet title={data?.full_name ?? "Сотрудник"} size="l" onClose={onClose}>{body}</Sheet>;
}

/** This week: the four numbers an operator is judged by, then each metric against its target. */
function EmployeeWeek({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["team-dashboard", id], queryFn: () => team.dashboard(id) });
  return <section className="employee__section" aria-labelledby={`employee-week-${id}`}>
    <h3 id={`employee-week-${id}`}>Неделя{query.data?.week.week_label ? <small> · {query.data.week.week_label}</small> : null}</h3>
    {query.isPending ? <Skeleton height={96} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <>
      <div className="employee-stats">
        <div><span>Баллы</span><strong>{points(query.data.week.final_points)}</strong></div>
        <div><span>Место</span><strong>{query.data.balance.rank ?? "—"}</strong></div>
        <div><span>Коины за неделю</span><strong>{coins(query.data.balance.earned_this_week)}</strong></div>
        <div><span>Баланс</span><strong>{coins(query.data.balance.balance)}</strong>{query.data.balance.reserved > 0 && <small>резерв {coins(query.data.balance.reserved)}</small>}</div>
      </div>
      {query.data.week.metrics.length ? <ul className="employee-metrics">{query.data.week.metrics.map(m => <li key={m.code}>
        <span>{m.title}</span><strong>{m.value == null ? "нет данных" : `${points(m.value)}${m.unit ? ` ${m.unit}` : ""}`}</strong><small>цель {points(m.target)}</small>
      </li>)}</ul> : <p className="employee__empty">Показатели недели ещё не загружены.</p>}
    </>}
  </section>;
}

/** The level in one line and a bar; the levels and achievements themselves live in «Мотивация». */
function EmployeeLevel({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["coin-progress", id], queryFn: () => progressApi.summary(id) });
  if (query.isError) return null;
  const data = query.data;
  const earned = data?.achievements.filter(item => item.unlocked).length ?? 0;
  return <section className="employee__section" aria-labelledby={`employee-level-${id}`}>
    <h3 id={`employee-level-${id}`}>Уровень</h3>
    {!data ? <Skeleton height={56} /> : <div className="employee-level">
      <p><strong>{data.level_number} · {data.current?.title ?? "Начало пути"}</strong><span>{coins(data.total)} коинов за всё время · {earned} {plural(earned, "достижение", "достижения", "достижений")}</span></p>
      <Progress value={data.progress} tone="accent" label="До следующего уровня" />
      <small>{data.next ? `До «${data.next.title}» — ${coins(data.remaining)} коинов` : "Все уровни пройдены"}</small>
    </div>}
  </section>;
}

/** Training attempts, newest first; shown only when there are any. */
function EmployeeLearning({ id }: { id: number }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["learning-results", id, "simulator", page], queryFn: () => learning.results({ user_id: id, kind: "simulator", page }) });
  if (!query.data?.total) return null;
  return <section className="employee__section" aria-labelledby={`employee-learning-${id}`}>
    <h3 id={`employee-learning-${id}`}>Тренажёры <small>· {query.data.total}</small></h3>
    <ul className="employee-list">{query.data.items.map(row => <li key={row.id}>
      <span><strong>{row.title}</strong><small>{row.answered} из {row.total} шагов{row.score !== null ? ` · ${row.score}%` : ""}{row.finished_at ? ` · ${dateTime(row.finished_at)}` : ""}</small></span>
      <Badge tone={row.state === "passed" ? "success" : row.state === "failed" ? "warning" : "neutral"}>{row.state === "passed" ? "Пройдено" : row.state === "failed" ? "Не пройдено" : "В процессе"}</Badge>
    </li>)}</ul>
    <Pagination page={page} size={20} total={query.data.total} onChange={setPage} />
  </section>;
}

/** Purchases with their status: the only place that lists them for one person. */
function EmployeePurchases({ id }: { id: number }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["team-purchases", id, page], queryFn: () => team.purchases(id, page) });
  return <section className="employee__section" aria-labelledby={`employee-purchases-${id}`}>
    <h3 id={`employee-purchases-${id}`}>Покупки{query.data?.total ? <small> · {query.data.total}</small> : null}</h3>
    {query.isPending ? <Skeleton height={56} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : !query.data.total ? <p className="employee__empty">Покупок пока нет.</p> : <>
      <ul className="employee-list">{query.data.items.map(order => <li key={order.id}>
        <span><strong>{order.item.title}</strong><small>№{order.id} · {REQUEST_STATUS_LABELS[order.status]} · {dateOnly(order.created_at)}{order.decision_comment ? ` · ${order.decision_comment}` : ""}</small></span>
        <strong className="employee-list__value">{coins(order.price)}</strong>
      </li>)}</ul>
      <Pagination page={page} size={20} total={query.data.total} onChange={setPage} />
    </>}
  </section>;
}

const ROLE_ORDER: Record<Role, number> = { trainee: -1, operator: 0, trainer: 0, supervisor: 1, head: 2, admin: 3 };

/**
 * Повторяет серверное правило: администратор меняет учётные данные любому,
 * остальные - только тем, чья должность строго ниже. Свои логин и пароль
 * меняются в профиле, с подтверждением текущим паролем.
 *
 * Зону ответственности проверяет сервер: карточку сотрудника чужой группы
 * супервайзер всё равно не откроет.
 */
function canManageCredentials(actor: UserOut | null, target: UserOut): boolean {
  if (target.can_manage_credentials !== undefined) return target.can_manage_credentials;
  if (!actor || actor.id === target.id) return false;
  if (actor.role === "admin") return true;
  return ROLE_ORDER[actor.role] > ROLE_ORDER[target.role];
}

function ResetLogin({ id, current, onClose }: { id: number; current: string; onClose: () => void }) {
  const [value, setValue] = useState(current);
  const toast = useToast();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => team.resetLogin(id, value.trim()),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["team-user", id] });
      void queryClient.invalidateQueries({ queryKey: ["team-users"] });
      toast.success(`Логин сотрудника изменён на «${updated.login}»`);
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!save.isPending && value.trim() && value.trim() !== current) save.mutate();
  }

  return (
    <Sheet
      title="Логин сотрудника"
      subtitle="Сотрудник будет входить под новым логином. Открытые сеансы не прерываются."
      size="s"
      onClose={() => { if (!save.isPending) onClose(); }}
      footer={
        <Button form="reset-login" type="submit" variant="primary" disabled={save.isPending || !value.trim() || value.trim() === current}>
          {save.isPending ? "Сохраняем…" : "Сохранить логин"}
        </Button>
      }
    >
      <form id="reset-login" onSubmit={submit} className="stack">
        <label className="field">
          <span className="field__label">Новый логин</span>
          <input
            className="input"
            autoComplete="off"
            minLength={3}
            maxLength={150}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="field__note">Латиница, цифры и символы . _ - @ Без пробелов.</span>
        </label>
        {save.isError && <p className="field__error" role="alert">{teamError(save.error)}</p>}
      </form>
    </Sheet>
  );
}

function ResetPassword({ id, onClose }: { id: number; onClose: () => void }) {
  const [value, setValue] = useState(""); const [visible, setVisible] = useState(false); const toast = useToast();
  const save = useMutation({ mutationFn: () => team.resetPassword(id, value), onSuccess: () => { toast.success("Пароль изменён, сессии сотрудника завершены"); onClose(); } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!save.isPending) save.mutate(); };
  return <Sheet title="Новый пароль сотрудника" onClose={() => { if (!save.isPending) onClose(); }} footer={<Button form="reset-password" type="submit" variant="primary" disabled={save.isPending}>Сохранить пароль</Button>}><form id="reset-password" onSubmit={submit} className="stack"><p>Все текущие сеансы сотрудника будут завершены.</p><label className="field"><span className="field__label">Новый пароль</span><input type={visible ? "text" : "password"} className="input" autoComplete="new-password" minLength={8} maxLength={72} required value={value} onChange={(e) => setValue(e.target.value)} /></label><Button aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Скрыть" : "Показать"}</Button>{save.isError && <p role="alert">{teamError(save.error)}</p>}</form></Sheet>;
}
