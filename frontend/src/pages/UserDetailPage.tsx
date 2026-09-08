import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { team, teamError } from "../api/team";
import type { Role, UserOut } from "../api/types";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Button, Card, EmptyState, ErrorState, KPI, Pagination, Skeleton } from "../components/ui";
import { ROLE_LABELS, REQUEST_STATUS_LABELS, coins, dateOnly, dateTime, points, signed } from "../utils/format";
import { UserArchive, UserEditor, UserStatus } from "./UsersPage";
import { LearningResults } from "./LearningStudioPage";
import { XpHistory, XpProgress } from "../components/XpProgress";
import "./team.css";

export function UserDetailPage() {
  const id = Number(useParams().userId);
  const { user: actor, atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const { can } = useAccess();
  const tabAllowed = (key: string) => ["xp", "coins", "purchases"].includes(key) ? can("motivation") : ["test", "mission", "simulator"].includes(key) ? can("learning_admin") : true;
  const requestedTab = params.get("tab") ?? "profile";
  const tab = tabAllowed(requestedTab) ? requestedTab : "profile";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [editor, setEditor] = useState(false);
  const [archive, setArchive] = useState(false);
  const [password, setPassword] = useState(false);
  const [loginEditor, setLoginEditor] = useState(false);
  const user = useQuery({ queryKey: ["team-user", id], queryFn: () => team.user(id), enabled: Number.isInteger(id) && id > 0 });
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups });
  const dashboard = useQuery({ queryKey: ["team-dashboard", id], queryFn: () => team.dashboard(id), enabled: user.isSuccess });
  const transactions = useQuery({ queryKey: ["team-transactions", id, page], queryFn: () => team.transactions(id, page), enabled: user.isSuccess && tab === "coins" });
  const purchases = useQuery({ queryKey: ["team-purchases", id, page], queryFn: () => team.purchases(id, page), enabled: user.isSuccess && tab === "purchases" });
  if (user.isLoading) return <Skeleton height={240} />;
  if (user.isError) return <ErrorState error={user.error} onRetry={() => user.refetch()} />;
  if (!user.data) return <EmptyState title="Сотрудник не найден" />;
  const data = user.data;
  const editable = atLeast("head") && (data.role !== "admin" || actor?.role === "admin") && (!data.is_developer || actor?.is_developer);
  const manageCredentials = canManageCredentials(actor, data) && (!data.is_developer || Boolean(actor?.is_developer));
  return <div className="stack team-page">
    <Link className="secondary" to="/admin/users">← Пользователи</Link>
    <Card><div className="team-detail-hero"><Avatar name={data.full_name} id={id} size={64} /><div className="team-detail-hero__body"><h1 className="page-title">{data.full_name}</h1><div className="team-meta"><span>{ROLE_LABELS[data.role]}</span><span>{data.group?.name ?? "Без группы"}</span><UserStatus active={data.is_active} /></div></div>
      <div className="team-actions">{editable && <Button onClick={() => setEditor(true)}>Изменить</Button>}{editable && actor?.id !== id && <Button onClick={() => setArchive(true)}>{data.is_active ? "Архивировать" : "Восстановить"}</Button>}{manageCredentials && <Button onClick={() => setLoginEditor(true)}>Сменить логин</Button>}{manageCredentials && <Button onClick={() => setPassword(true)}>Сбросить пароль</Button>}</div></div></Card>
    <nav className="team-section-nav" aria-label="Разделы карточки">{[["profile", "Профиль"], ["results", "Результаты"], ["coins", "Коины"], ["xp", "XP"], ["test", "Тесты"], ["mission", "Миссии"], ["simulator", "Симулятор"], ["purchases", "Покупки"]].filter(([key]) => tabAllowed(key)).map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} aria-current={tab === key ? "page" : undefined} onClick={() => setParams({ tab: key })}>{label}</Button>)}</nav>
    {tab === "xp" && <><XpProgress key={id} userId={id} showLevels /><XpHistory userId={id} page={page} onPage={(p) => setParams({ tab, page: String(p) })} /></>}
    {(tab === "test" || tab === "mission" || tab === "simulator") && <LearningResults key={`${id}-${tab}`} userId={id} kind={tab} />}
    {tab === "profile" && <Card title="Личные данные"><dl className="team-definition-list"><dt>Логин</dt><dd>{data.login}</dd><dt>ID сотрудника</dt><dd>{id}</dd><dt>Телефон</dt><dd>{data.phone ?? "—"}</dd><dt>Email</dt><dd>{data.email ?? "—"}</dd><dt>Дата приёма</dt><dd>{data.hired_on ? dateOnly(data.hired_on) : "—"}</dd><dt>Группа</dt><dd>{data.group?.name ?? "Не назначена"}</dd></dl></Card>}
    {tab === "results" && <>{dashboard.isLoading && <Skeleton height={240} />}{dashboard.isError && <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />}{dashboard.data && <Card title="Результаты недели" subtitle={dashboard.data.week.week_label ?? "Текущий период"}><div className="kpi-grid"><KPI label="Баллы" value={points(dashboard.data.week.final_points)} /><KPI label="Место" value={dashboard.data.balance.rank ?? "—"} /><KPI label="Коины за неделю" value={coins(dashboard.data.balance.earned_this_week)} /><KPI label="Достижения" value={dashboard.data.badges_unlocked} /></div>{!dashboard.data.week.metrics.length && <EmptyState title="Показатели ещё не загружены" />}{dashboard.data.week.metrics.map((m) => <div className="team-metric-row" key={m.code}><span>{m.title}</span><span className="team-metric-row__value">{m.value == null ? "Нет данных" : `${points(m.value)} ${m.unit ?? ""}`}<span className="muted micro block">Цель {points(m.target)}</span></span></div>)}</Card>}</>}
    {tab === "coins" && <Card title="История коинов">{transactions.isLoading && <Skeleton height={180} />}{transactions.isError && <ErrorState error={transactions.error} onRetry={() => transactions.refetch()} />}{transactions.data?.items.length === 0 && <EmptyState title="Операций пока нет" />}{transactions.data?.items.map((tx) => <div className="team-timeline__row" key={tx.id}><div className="team-timeline__body"><strong>{tx.reason}</strong><span className="small secondary">{dateTime(tx.created_at)} · {tx.author_name ?? "Система"}</span></div><div className="team-timeline__amount"><strong>{signed(tx.amount)}</strong><span className="micro muted block">Баланс {coins(tx.balance_after)}</span></div></div>)}{transactions.data && <Pagination page={page} size={20} total={transactions.data.total} onChange={(p) => setParams({ tab, page: String(p) })} />}</Card>}
    {tab === "purchases" && <Card title="Покупки">{purchases.isLoading && <Skeleton height={180} />}{purchases.isError && <ErrorState error={purchases.error} onRetry={() => purchases.refetch()} />}{purchases.data?.items.length === 0 && <EmptyState title="Покупок пока нет" />}{purchases.data?.items.map((order) => <div className="team-timeline__row" key={order.id}><div className="team-timeline__body"><strong>{order.item.title}</strong><span className="small secondary">№{order.id} · {REQUEST_STATUS_LABELS[order.status]} · {dateTime(order.created_at)}</span>{order.decision_comment && <p>{order.decision_comment}</p>}</div><strong>{coins(order.price)} коинов</strong></div>)}{purchases.data && <Pagination page={page} size={20} total={purchases.data.total} onChange={(p) => setParams({ tab, page: String(p) })} />}</Card>}
    {editor && <UserEditor target={data} groups={groups.data ?? []} groupsReady={groups.isSuccess} onClose={() => setEditor(false)} />}
    {archive && <UserArchive target={data} onClose={() => setArchive(false)} />}
    {loginEditor && <ResetLogin id={id} current={data.login} onClose={() => setLoginEditor(false)} />}
    {password && <ResetPassword id={id} onClose={() => setPassword(false)} />}
  </div>;
}

const ROLE_ORDER: Record<Role, number> = { operator: 0, supervisor: 1, head: 2, admin: 3 };

/**
 * Повторяет серверное правило: администратор меняет учётные данные любому,
 * остальные - только тем, чья должность строго ниже. Свои логин и пароль
 * меняются в профиле, с подтверждением текущим паролем.
 *
 * Зону ответственности проверяет сервер: карточку сотрудника чужой группы
 * супервайзер всё равно не откроет.
 */
function canManageCredentials(actor: UserOut | null, target: UserOut): boolean {
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
