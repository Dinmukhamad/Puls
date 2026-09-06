import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { team, teamError, type TeamGroup, type TeamUserInput } from "../api/team";
import type { Role, UserOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton } from "../components/ui";
import { ROLE_LABELS } from "../utils/format";
import "./team.css";

const roles: Role[] = ["operator", "supervisor", "head", "admin"];

export function UsersPage() {
  const { user: actor, atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<UserOut | "new" | null>(null);
  const [archiving, setArchiving] = useState<UserOut | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const search = params.get("search") ?? "";
  const role = roles.includes(params.get("role") as Role) ? params.get("role")! : "";
  const group = params.get("group") ?? "";
  const status = ["active", "archived"].includes(params.get("status") ?? "") ? params.get("status")! : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = 25;
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups });
  const users = useQuery({
    queryKey: ["team-users", search, role, group, status, page],
    queryFn: ({ signal }) => team.users({ search, role, group_id: group || undefined, is_active: status ? status === "active" : undefined, page, size }, signal),
  });
  const activeFilters = [role, group, status].filter(Boolean).length;

  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: key === "search" });
  }

  function filterFields() {
    return <>
      <label className="field"><span className="field__label">Группа</span><select className="input" value={group} onChange={(e) => filter("group", e.target.value)}>
        <option value="">Все доступные группы</option>
        {(groups.data ?? []).map((g) => <option value={g.id} key={g.id}>{g.name}{g.is_active ? "" : " · архив"}</option>)}
      </select></label>
      <label className="field"><span className="field__label">Роль</span><select className="input" value={role} onChange={(e) => filter("role", e.target.value)}>
        <option value="">Все роли</option>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select></label>
      <label className="field"><span className="field__label">Статус</span><select className="input" value={status} onChange={(e) => filter("status", e.target.value)}>
        <option value="">Все сотрудники</option><option value="active">Активные</option><option value="archived">Архивные</option>
      </select></label>
    </>;
  }

  const canEdit = (target: UserOut) => atLeast("head") && (target.role !== "admin" || actor?.role === "admin") && (!target.is_developer || actor?.is_developer);
  const actions = (target: UserOut) => <div className="team-actions">
    <Link className="btn btn--secondary btn--s" to={`/admin/users/${target.id}`}>Открыть</Link>
    {canEdit(target) && <Button size="s" variant="plain" onClick={() => setEditor(target)}>Изменить</Button>}
    {canEdit(target) && actor?.id !== target.id && <Button size="s" variant="plain" onClick={() => setArchiving(target)}>{target.is_active ? "В архив" : "Восстановить"}</Button>}
  </div>;

  return <div className="stack team-page">
    <div className="page-head"><div><h1 className="page-title">Пользователи</h1><p className="page-subtitle">{users.data ? `${users.data.total} сотрудников по выбранным фильтрам` : "Сотрудники и доступы"}{actor?.role === "supervisor" ? " · Ваша зона ответственности" : ""}</p></div>
      {atLeast("head") && <Button variant="primary" onClick={() => setEditor("new")}>Создать пользователя</Button>}
    </div>
    <GlassSurface variant="regular" className="team-filterbar">
      <label className="field team-search"><span className="field__label">Поиск</span><input className="input" type="search" placeholder="ФИО или логин" value={search} onChange={(e) => filter("search", e.target.value)} /></label>
      <div className="team-desktop-filters">{filterFields()}</div>
      <Button className="team-mobile-filter-button" onClick={() => setFiltersOpen(true)}>Фильтры{activeFilters ? ` · ${activeFilters}` : ""}</Button>
      {(search || activeFilters > 0) && <Button variant="plain" size="s" onClick={() => setParams({})}>Сбросить</Button>}
    </GlassSurface>
    {groups.isError && <ErrorState error={new Error("Не удалось загрузить список групп")} onRetry={() => groups.refetch()} />}
    <Card title="Команда" padded={false}>
      {users.isLoading && <div className="card__body"><RowsSkeleton /></div>}
      {users.isError && <ErrorState error={new Error(teamError(users.error, "Не удалось загрузить сотрудников"))} onRetry={() => users.refetch()} />}
      {users.data && users.data.items.length === 0 && <EmptyState title="Сотрудники не найдены" hint="Попробуйте изменить фильтры или создайте первую учётную запись." action={page > 1 ? <Button onClick={() => filter("page", "1")}>На первую страницу</Button> : undefined} />}
      {users.data && users.data.items.length > 0 && <>
        <div className="table-wrap team-desktop-table"><table className="table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Группа</th><th>Статус</th><th><span className="sr-only">Действия</span></th></tr></thead><tbody>
          {users.data.items.map((u) => <tr key={u.id}><td><Link className="cell-person team-person-link" to={`/admin/users/${u.id}`}><Avatar name={u.full_name} id={u.id} size={36} /><span className="cell-person__text"><span className="cell-person__name">{u.full_name}</span><span className="cell-person__meta">{u.login} · ID {u.id}</span></span></Link></td><td>{ROLE_LABELS[u.role]}</td><td>{u.group?.name ?? "Без группы"}</td><td><UserStatus active={u.is_active} /></td><td>{actions(u)}</td></tr>)}
        </tbody></table></div>
        <div className="team-mobile-list">{users.data.items.map((u) => <article className="team-person-card" key={u.id}><div className="team-person-card__head"><Avatar name={u.full_name} id={u.id} /><div><Link className="team-person-link" to={`/admin/users/${u.id}`}><strong>{u.full_name}</strong></Link><p className="muted micro">{u.login} · ID {u.id}</p></div></div><div className="team-meta"><span>{ROLE_LABELS[u.role]}</span><span>{u.group?.name ?? "Без группы"}</span><UserStatus active={u.is_active} /></div>{actions(u)}</article>)}</div>
        <Pagination page={page} size={size} total={users.data.total} onChange={(p) => filter("page", String(p))} />
      </>}
    </Card>
    {editor && <UserEditor target={editor === "new" ? undefined : editor} groups={groups.data ?? []} groupsReady={groups.isSuccess} onClose={() => setEditor(null)} />}
    {archiving && <UserArchive target={archiving} onClose={() => setArchiving(null)} />}
    {filtersOpen && <Sheet title="Фильтры пользователей" onClose={() => setFiltersOpen(false)} footer={<Button variant="primary" onClick={() => setFiltersOpen(false)}>Показать сотрудников</Button>}><div className="stack">{filterFields()}</div></Sheet>}
  </div>;
}

export function UserStatus({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"} dot={active}>{active ? "Активен" : "В архиве"}</Badge>;
}

export function UserEditor({ target, groups, groupsReady, onClose }: { target?: UserOut; groups: TeamGroup[]; groupsReady: boolean; onClose: () => void }) {
  const { user: actor } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(target?.full_name ?? "");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState(target?.email ?? "");
  const [role, setRole] = useState<Role>(target?.role ?? "operator");
  const [groupId, setGroupId] = useState(target?.group ? String(target.group.id) : "");
  const [hiredOn, setHiredOn] = useState(target?.hired_on ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const data: TeamUserInput = { full_name: fullName.trim(), email: email.trim() || null, role, group_id: groupId ? Number(groupId) : null, hired_on: hiredOn || null };
      return target ? team.updateUser(target.id, data) : team.createUser({ ...data, login: login.trim(), password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-users"] });
      queryClient.invalidateQueries({ queryKey: ["team-groups"] });
      queryClient.invalidateQueries({ queryKey: ["team-supervisors"] });
      queryClient.invalidateQueries({ queryKey: ["team-user", target?.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      toast.success(target ? "Данные сотрудника сохранены" : "Пользователь создан");
      onClose();
    },
  });
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Sheet title={target ? "Изменить сотрудника" : "Новый пользователь"} subtitle={target ? `${target.login} · ID ${target.id}` : "Создайте учётную запись и назначьте роль"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button form="team-user-form" type="submit" variant="primary" disabled={save.isPending || !groupsReady}>{save.isPending ? "Сохраняем…" : target ? "Сохранить" : "Создать пользователя"}</Button></>}>
    <form id="team-user-form" className="stack" onSubmit={submit}>
      {save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}
      {!groupsReady && <p role="status" className="muted">Дождитесь загрузки групп. При ошибке закройте форму и повторите загрузку.</p>}
      <label className="field"><span className="field__label">ФИО</span><input className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={3} maxLength={255} /></label>
      {!target && <label className="field"><span className="field__label">Логин</span><input className="input" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} maxLength={150} /></label>}
      <label className="field"><span className="field__label">Email · необязательно</span><input className="input" type="email" autoComplete="email" value={email} maxLength={255} onChange={(e) => setEmail(e.target.value)} /></label>
      <div className="team-form-grid"><label className="field"><span className="field__label">Роль</span><select className="input" value={role} disabled={target?.id === actor?.id} onChange={(e) => setRole(e.target.value as Role)}>{roles.filter((r) => r !== "admin" || actor?.role === "admin").map((r) => <option value={r} key={r}>{ROLE_LABELS[r]}</option>)}</select></label>
        <label className="field"><span className="field__label">Группа</span><select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Без группы</option>{groups.filter((g) => g.is_active || g.id === target?.group?.id).map((g) => <option key={g.id} value={g.id} disabled={!g.is_active}>{g.name}{g.is_active ? "" : " · архив"}</option>)}</select></label></div>
      <label className="field"><span className="field__label">Дата приёма · необязательно</span><input className="input" type="date" value={hiredOn} onChange={(e) => setHiredOn(e.target.value)} /></label>
      {!target && <label className="field"><span className="field__label">Первый пароль</span><div className="team-password"><input className="input" autoComplete="new-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} /><Button size="s" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Скрыть" : "Показать"}</Button></div><span className="muted micro">Не менее 8 символов. Передайте пароль сотруднику лично.</span></label>}
    </form>
  </Sheet>;
}

export function UserArchive({ target, onClose }: { target: UserOut; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => team.updateUser(target.id, { is_active: !target.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-users"] });
      queryClient.invalidateQueries({ queryKey: ["team-user", target.id] });
      queryClient.invalidateQueries({ queryKey: ["team-groups"] });
      queryClient.invalidateQueries({ queryKey: ["team-supervisors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
      toast.success(target.is_active ? "Сотрудник перенесён в архив" : "Доступ сотрудника восстановлен"); onClose();
    },
  });
  return <Sheet title={target.is_active ? "Архивировать сотрудника?" : "Восстановить сотрудника?"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button variant={target.is_active ? "destructive" : "primary"} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : target.is_active ? "Архивировать" : "Восстановить"}</Button></>}>
    <div className="stack"><strong>{target.full_name}</strong><p>{target.is_active ? "История сотрудника сохранится. Вход в Puls будет закрыт, новые начисления за периоды остановятся." : "Сотрудник снова сможет войти в Puls с прежним логином и паролем."}</p>{save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}</div>
  </Sheet>;
}
