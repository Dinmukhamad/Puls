import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { team, teamError, type TeamGroup, type TeamUserSaved, type TeamUserInput } from "../api/team";
import type { TelegramInvitation } from "../api/telegram";
import type { Gender, Role, UserOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton, Select } from "../components/ui";
import { dateOnly, dateTime, ROLE_LABELS } from "../utils/format";
import { loadTelegramDraft, normalizeTelegramUsername, telegramUpdate, type TeamTelegramDraft } from "./teamTelegram";
import { activeTeamGroups, destinationGroupId, userTeamLabel } from "./supervisorTeams";
import "./team.css";
import "./users.css";

const roles: Role[] = ["operator", "trainer", "supervisor", "head", "admin"];
export function visibleRoles(role: Role = "operator"): Role[] {
  return role === "admin" ? roles : role === "head" ? ["operator", "trainer", "supervisor"] : role === "supervisor" ? ["operator", "supervisor"] : role === "trainer" ? ["operator"] : [];
}

export function UsersPage() {
  const { user: actor, atLeast } = useAuth();
  const trainer = actor?.role === "trainer";
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<UserOut | "new" | null>(null);
  const [archiving, setArchiving] = useState<UserOut | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const search = params.get("search") ?? "";
  const role = roles.includes(params.get("role") as Role) ? params.get("role")! : "";
  const group = params.get("group") ?? "";
  const supervisor = params.get("supervisor") ?? "";
  const status = ["active", "archived"].includes(params.get("status") ?? "") ? params.get("status")! : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = 25;
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups, enabled: !trainer });
  const teams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal), enabled: !trainer });
  const users = useQuery({
    queryKey: ["team-users", search, role, group, supervisor, status, page],
    queryFn: ({ signal }) => team.users({ search, role, group_id: group || undefined, supervisor_id: supervisor && supervisor !== "unassigned" ? supervisor : undefined, unassigned: supervisor === "unassigned" ? true : undefined, is_active: status ? status === "active" : undefined, page, size }, signal),
  });
  const activeFilters = [role, group, supervisor, status].filter(Boolean).length;
  const teamLabel = (user: UserOut) => {
    if (user.role !== "supervisor") {
      const assignedGroup = groups.data?.find(item => item.id === user.group?.id);
      const owner = assignedGroup?.supervisor;
      if (owner && assignedGroup.name.trim().toLocaleLowerCase("ru") === owner.full_name.trim().toLocaleLowerCase("ru")) {
        return `${owner.full_name}${assignedGroup.is_active ? "" : " · команда в архиве"}`;
      }
      return userTeamLabel(user, groups.data ?? []);
    }
    const ownTeam = teams.data?.find(item => item.supervisor.id === user.id);
    return ownTeam ? `Своя команда · ${ownTeam.operator_count} операторов` : "Своя команда";
  };

  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key === "supervisor") next.delete("group");
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: key === "search" });
  }

  function filterFields() {
    return <>
      {!trainer && <label className="field"><span className="field__label">Супервайзер</span><Select aria-label="Фильтр по супервайзеру" value={supervisor} onChange={(value) => filter("supervisor", value)} options={[
        { value: "", label: "Все команды" }, { value: "unassigned", label: "Без команды" },
        ...(teams.data ?? []).map(item => ({ value: item.supervisor.id, label: `${item.supervisor.full_name}${item.supervisor.is_active ? "" : " · архив"}` })),
      ]} /></label>}
      {!trainer && group && <label className="field"><span className="field__label">Прежняя группа</span><Select aria-label="Фильтр по прежней группе" value={group} onChange={(value) => filter("group", value)} options={[{ value: "", label: "Все группы" }, ...(groups.data ?? []).map(g => ({ value: g.id, label: `${g.name}${g.is_active ? "" : " · архив"}` }))]} /></label>}
      <label className="field"><span className="field__label">Роль</span><Select aria-label="Фильтр по роли" value={role} onChange={(value) => filter("role", value)} options={[{ value: "", label: "Все роли" }, ...visibleRoles(actor?.role).map(r => ({ value: r, label: ROLE_LABELS[r] }))]} /></label>
      <label className="field"><span className="field__label">Статус</span><Select aria-label="Фильтр по статусу" value={status} onChange={(value) => filter("status", value)} options={[{ value: "", label: "Все сотрудники" }, { value: "active", label: "Активные" }, { value: "archived", label: "Архивные" }]} /></label>
    </>;
  }

  const canEdit = (target: UserOut) => atLeast("head") && (target.role !== "admin" || actor?.role === "admin") && (!target.is_developer || actor?.is_developer);
  const actions = (target: UserOut) => <div className="team-actions user-row-actions">
    <Link className="btn btn--secondary btn--s" to={`/admin/users/${target.id}`}>Открыть</Link>
    {canEdit(target) && <Button size="s" onClick={() => setEditor(target)}>Изменить</Button>}
    {canEdit(target) && actor?.id !== target.id && <Button className="user-row-actions__archive" size="s" variant="plain" onClick={() => setArchiving(target)}>{target.is_active ? "В архив" : "Восстановить"}</Button>}
  </div>;

  return <div className="stack team-page users-page">
    <div className="page-head"><div><h1 className="page-title">Пользователи</h1><p className="page-subtitle">{users.data ? `${users.data.total} сотрудников по выбранным фильтрам` : "Сотрудники и доступы"}{trainer ? " · Только операторы" : ""}</p></div>
      {(atLeast("head") || trainer) && <div className="page-head__actions"><Button variant="primary" onClick={() => setEditor("new")}>{trainer ? "Создать оператора" : "Создать пользователя"}</Button></div>}
    </div>
    <GlassSurface variant="regular" className="team-filterbar users-filterbar">
      <label className="field team-search"><span className="field__label">Поиск</span><input className="input" type="search" placeholder="ФИО или логин" value={search} onChange={(e) => filter("search", e.target.value)} /></label>
      <div className="team-desktop-filters users-filterbar__fields">{filterFields()}</div>
      <Button className="team-mobile-filter-button" onClick={() => setFiltersOpen(true)}>Фильтры{activeFilters ? ` · ${activeFilters}` : ""}</Button>
      {(search || activeFilters > 0) && <Button className="users-filterbar__reset" variant="plain" size="s" onClick={() => setParams({})}>Сбросить фильтры</Button>}
    </GlassSurface>
    {teams.isError && <ErrorState error={new Error("Не удалось загрузить команды супервайзеров")} onRetry={() => teams.refetch()} />}
    {groups.isError && <ErrorState error={new Error("Не удалось загрузить команды")} onRetry={() => groups.refetch()} />}
    <Card title="Команда" padded={false}>
      {users.isLoading && <div className="card__body"><RowsSkeleton /></div>}
      {users.isError && <ErrorState error={new Error(teamError(users.error, "Не удалось загрузить сотрудников"))} onRetry={() => users.refetch()} />}
      {users.data && users.data.items.length === 0 && <EmptyState title="Сотрудники не найдены" hint="Попробуйте изменить фильтры или создайте первую учётную запись." action={page > 1 ? <Button onClick={() => filter("page", "1")}>На первую страницу</Button> : undefined} />}
      {users.data && users.data.items.length > 0 && <>
        <div className="table-wrap team-desktop-table"><table className="table users-table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>{trainer ? "Создан" : "Супервайзер · команда"}</th><th>Статус</th><th className="users-table__actions-heading">Действия</th></tr></thead><tbody>
          {users.data.items.map((u) => <tr key={u.id}><td><Link className="cell-person team-person-link" to={`/admin/users/${u.id}`}><Avatar name={u.full_name} id={u.id} size={36} /><span className="cell-person__text"><span className="cell-person__name">{u.full_name}</span>{u.hired_on && <span className="cell-person__meta">Дата приёма: {dateOnly(u.hired_on)}</span>}</span></Link></td><td>{ROLE_LABELS[u.role]}</td><td>{trainer ? u.created_at ? new Date(u.created_at).toLocaleDateString("ru") : "—" : teamLabel(u)}</td><td><UserStatus active={u.is_active} /></td><td>{actions(u)}</td></tr>)}
        </tbody></table></div>
        <div className="team-mobile-list">{users.data.items.map((u) => <article className="team-person-card" key={u.id}><div className="team-person-card__head"><Avatar name={u.full_name} id={u.id} /><div><Link className="team-person-link" to={`/admin/users/${u.id}`}><strong>{u.full_name}</strong></Link>{u.hired_on && <p className="muted micro">Дата приёма: {dateOnly(u.hired_on)}</p>}</div></div><div className="team-meta"><span>{ROLE_LABELS[u.role]}</span>{!trainer && <span>{teamLabel(u)}</span>}<UserStatus active={u.is_active} /></div>{actions(u)}</article>)}</div>
        <Pagination page={page} size={size} total={users.data.total} onChange={(p) => filter("page", String(p))} />
      </>}
    </Card>
    {editor && <UserEditor target={editor === "new" ? undefined : editor} groups={groups.data ?? []} groupsReady={trainer || groups.isSuccess} onClose={() => setEditor(null)} />}
    {archiving && <UserArchive target={archiving} onClose={() => setArchiving(null)} />}
    {filtersOpen && <Sheet title="Фильтры пользователей" onClose={() => setFiltersOpen(false)} footer={<Button variant="primary" onClick={() => setFiltersOpen(false)}>Показать сотрудников</Button>}><div className="users-mobile-filters">{filterFields()}</div></Sheet>}
  </div>;
}

export function UserStatus({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"} dot={active}>{active ? "Активен" : "В архиве"}</Badge>;
}

export function UserEditor({ target, groups, groupsReady, initialRole = "operator", onClose }: { target?: UserOut; groups: TeamGroup[]; groupsReady: boolean; initialRole?: Role; onClose: () => void }) {
  const { user: actor } = useAuth();
  const trainer = actor?.role === "trainer";
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(target?.full_name ?? "");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState(target?.email ?? "");
  const [phone, setPhone] = useState(target?.phone ?? "");
  const [role, setRole] = useState<Role>(target?.role ?? (trainer ? "operator" : initialRole));
  const [groupId, setGroupId] = useState(target?.group ? String(target.group.id) : "");
  const [supervisorId, setSupervisorId] = useState(() => { const owner = groups.find(g => g.id === target?.group?.id)?.supervisor; return owner ? String(owner.id) : target?.group ? "legacy" : ""; });
  const [teamSelectionTouched, setTeamSelectionTouched] = useState(false);
  const supervisorTeams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal), enabled: !trainer });
  useEffect(() => {
    if (!teamSelectionTouched && groupsReady) {
      const owner = groups.find(g => g.id === target?.group?.id)?.supervisor;
      setSupervisorId(owner ? String(owner.id) : target?.group ? "legacy" : "");
    }
  }, [groups, groupsReady, target?.group?.id, teamSelectionTouched]);
  const selectedTeam = supervisorTeams.data?.find(item => String(item.supervisor.id) === supervisorId);
  const destinationGroups = selectedTeam ? activeTeamGroups(selectedTeam) : [];
  const keepCurrentTeam = !teamSelectionTouched && target?.role === "operator" && role === "operator";
  const selectedGroupId = keepCurrentTeam ? target.group?.id ?? null : selectedTeam ? destinationGroupId(selectedTeam, groupId) : supervisorId === "legacy" ? target?.group?.id ?? null : null;
  const operatorTeamReady = trainer || role !== "operator" || (groupsReady && supervisorTeams.isSuccess && (keepCurrentTeam || !supervisorId || supervisorId === "legacy" || Boolean(selectedTeam && selectedTeam.supervisor.is_active && (selectedGroupId != null || destinationGroups.length === 0))));
  function chooseSupervisor(value: string) {
    setTeamSelectionTouched(true);
    setSupervisorId(value);
    const chosen = supervisorTeams.data?.find(item => String(item.supervisor.id) === value);
    const destination = chosen ? destinationGroupId(chosen, "") : null;
    setGroupId(destination == null ? "" : String(destination));
  }
  const [hiredOn, setHiredOn] = useState(target?.hired_on ?? "");
  const [gender, setGender] = useState<Gender | "">(target?.gender ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const ownAccount = Boolean(target && target.id === actor?.id);
  const [telegramDraft, setTelegramDraft] = useState<TeamTelegramDraft | null>(target ? null : { value: "", original: "" });
  const telegramStatus = useQuery({ queryKey: ["team-user-telegram", target?.id], queryFn: ({ signal }) => team.userTelegram(target!.id, signal), enabled: Boolean(target) });
  useEffect(() => {
    if (telegramStatus.isSuccess && telegramStatus.isFetchedAfterMount) {
      setTelegramDraft((draft) => loadTelegramDraft(draft, telegramStatus.data));
    }
  }, [telegramStatus.data, telegramStatus.isSuccess, telegramStatus.isFetchedAfterMount]);
  const telegramUsername = telegramDraft?.value ?? "";
  const telegramReady = !target || ownAccount || telegramDraft !== null;
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [savedInvitation, setSavedInvitation] = useState<{ fullName: string; telegramUsername: string; invitation: TelegramInvitation } | null>(null);
  const [copyError, setCopyError] = useState(false);
  const normalizedTelegram = normalizeTelegramUsername(telegramUsername);
  const save = useMutation({
    mutationFn: (): Promise<TeamUserSaved> => {
      const groupChanged = !target || role !== target.role || teamSelectionTouched || (role !== "operator" && role !== "supervisor" && groupId !== String(target.group?.id ?? ""));
      const data: TeamUserInput = { full_name: fullName.trim(), email: email.trim() || null, phone: phone.trim() || null, role: trainer ? "operator" : role, ...(groupChanged ? { group_id: trainer || role === "supervisor" ? null : role === "operator" ? selectedGroupId : groupId ? Number(groupId) : null } : {}), ...(!trainer && role === "operator" && !keepCurrentTeam && supervisorId !== "legacy" ? { supervisor_id: Number(supervisorId) || null } : {}), hired_on: hiredOn || null, ...(gender ? { gender } : {}) };
      return target ? team.updateUser(target.id, { ...data, ...telegramUpdate(telegramDraft, ownAccount) }) : team.createUser({ ...data, login: login.trim(), password, telegram_username: normalizedTelegram || null });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["team-users"] });
      queryClient.invalidateQueries({ queryKey: ["team-groups"] });
      queryClient.invalidateQueries({ queryKey: ["team-supervisors"] });
      queryClient.invalidateQueries({ queryKey: ["team-supervisor-teams"] });
      queryClient.invalidateQueries({ queryKey: ["team-user", target?.id] });
      queryClient.invalidateQueries({ queryKey: ["team-user-telegram", target?.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      for (const key of ["team-assignment-users", "lookup-groups", "analytics", "city", "city-world", "city-estate", "city-estates"]) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(target ? "Данные сотрудника сохранены" : "Пользователь создан");
      setPassword("");
      setShowPassword(false);
      if (data.telegram_invitation) {
        setSavedInvitation({ fullName: data.full_name, telegramUsername: normalizedTelegram, invitation: data.telegram_invitation });
      } else onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || savedInvitation || !operatorTeamReady || !telegramReady) return;
    if (!ownAccount && telegramUsername.trim() && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(normalizedTelegram)) {
      setTelegramError("Укажите Telegram username: 5–32 символа, латинские буквы, цифры и _. Первый символ — буква.");
      return;
    }
    setTelegramError(null);
    save.mutate();
  }
  async function copyInvitation() {
    if (!savedInvitation) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(savedInvitation.invitation.url);
      toast.success("Личная ссылка скопирована");
    } catch {
      setCopyError(true);
    }
  }
  if (savedInvitation) return <Sheet title={target ? "Изменения сохранены" : "Пользователь создан"} subtitle={savedInvitation.fullName} onClose={onClose} footer={<><Button onClick={() => { void copyInvitation(); }}>Скопировать ссылку</Button><Button variant="primary" onClick={onClose}>Готово</Button></>}>
    <div className="stack">
      <p>Передайте сотруднику @{savedInvitation.telegramUsername} эту личную ссылку для подключения Telegram.</p>
      <label className="field"><span className="field__label">Личная ссылка на бота</span><input className="input" readOnly value={savedInvitation.invitation.url} onFocus={(event) => event.currentTarget.select()} /></label>
      <p>Сотруднику нужно открыть ссылку в своём Telegram и нажать «Запустить». Настраивать Telegram в профиле Puls не нужно.</p>
      <p className="muted">Ссылка одноразовая и действует до {dateTime(savedInvitation.invitation.expires_at)}. Подключение завершится после запуска бота.</p>
      {copyError && <p className="field__error" role="alert">Не удалось скопировать ссылку. Выделите её и скопируйте вручную.</p>}
    </div>
  </Sheet>;
  return <Sheet title={target ? "Изменить сотрудника" : "Новый пользователь"} subtitle={target ? target.full_name : "Создайте учётную запись и назначьте роль"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button form="team-user-form" type="submit" variant="primary" disabled={save.isPending || !operatorTeamReady || !telegramReady}>{save.isPending ? "Сохраняем…" : target ? "Сохранить" : "Создать пользователя"}</Button></>}>
    <form id="team-user-form" className="user-editor" onSubmit={submit}>
      {save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}
      {!trainer && role === "operator" && (!groupsReady || supervisorTeams.isPending) && <p role="status" className="muted">Загружаем команды супервайзеров…</p>}{!trainer && role === "operator" && supervisorTeams.isError && <ErrorState error={new Error(teamError(supervisorTeams.error, "Не удалось загрузить команды"))} onRetry={() => supervisorTeams.refetch()} />}
      <section className="user-editor__section user-editor__profile" aria-labelledby="user-editor-profile">
      <h3 id="user-editor-profile" className="user-editor__section-title">Данные сотрудника</h3>
      <label className="field"><span className="field__label">ФИО</span><input className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={3} maxLength={255} /></label>
      <fieldset className="field team-gender"><legend className="field__label">Пол персонажа</legend><div className="segmented" role="radiogroup">{([["female", "Женский"], ["male", "Мужской"]] as const).map(([value, label]) => <label key={value} className={gender === value ? "segmented__item is-active" : "segmented__item"}><input type="radio" name="team-gender" value={value} checked={gender === value} required={!target} onChange={() => setGender(value)} />{label}</label>)}</div></fieldset>
      <label className="field"><span className="field__label">Дата приёма · необязательно</span><input className="input" type="date" value={hiredOn} onChange={(e) => setHiredOn(e.target.value)} /></label>
      </section>
      <section className="user-editor__section" aria-labelledby="user-editor-contacts">
      <h3 id="user-editor-contacts" className="user-editor__section-title">Контакты</h3>
      <label className="field"><span className="field__label">Email · необязательно</span><input className="input" type="email" autoComplete="email" value={email} maxLength={255} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span className="field__label">Телефон</span><input className="input" type="tel" autoComplete="tel" placeholder="+7 700 123 45 67" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} /><span className="field__note">Нужен для входа в Driver Simulator. Один номер — один сотрудник. После смены номера потребуется новый код из Telegram.</span></label>
      <label className="field"><span className="field__label">Telegram · необязательно</span><input className="input" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="@username или https://t.me/username" value={telegramUsername} maxLength={100} disabled={save.isPending || ownAccount || !telegramDraft} aria-invalid={telegramError ? true : undefined} onChange={(event) => { const value = event.target.value; setTelegramDraft((draft) => draft ? { ...draft, value, clearBinding: false } : draft); setTelegramError(null); }} />
        <span className="field__note">{ownAccount ? <>Свой Telegram меняйте <Link to="/profile">в профиле</Link>.</> : <>Укажите username сотрудника, а не номер телефона. {target ? "Если укажете новый Telegram, после сохранения передайте сотруднику личную ссылку" : "После создания передайте сотруднику личную ссылку"}: останется только открыть её и запустить бота. {target && (telegramDraft?.original || telegramStatus.data?.connected) && "При смене или удалении Telegram прежнее подключение к боту, личные ссылки и коды входа станут недействительны. Чтобы удалить Telegram, очистите поле или нажмите «Отключить Telegram»."}</>}</span>
        {telegramError && <span className="field__error" role="alert">{telegramError}</span>}
      </label>
      {target && !ownAccount && telegramDraft && (telegramDraft.original || telegramStatus.data?.connected || telegramDraft.clearBinding) && <div className="stack">
        {telegramDraft.clearBinding ? <><p className="field__note" role="status">Telegram будет отключён после сохранения.</p><Button variant="plain" size="s" disabled={save.isPending} onClick={() => { setTelegramDraft((draft) => draft ? { ...draft, value: draft.original, clearBinding: false } : draft); }}>Отменить отключение</Button></> : <>
          {telegramStatus.data?.connected && !telegramDraft.original && <p className="field__note">Telegram подключён без username. Можно указать новый username или отключить подключение.</p>}
          <Button variant="plain" size="s" disabled={save.isPending} onClick={() => { setTelegramDraft((draft) => draft ? { ...draft, value: "", clearBinding: true } : draft); setTelegramError(null); }}>Отключить Telegram</Button>
        </>}
      </div>}
      {target && !telegramDraft && (telegramStatus.isError ? <ErrorState error={new Error(teamError(telegramStatus.error, "Не удалось загрузить Telegram сотрудника"))} onRetry={() => { void telegramStatus.refetch(); }} /> : <p role="status" className="muted">Загружаем Telegram сотрудника…</p>)}
      </section>
      <section className="user-editor__section" aria-labelledby="user-editor-access">
      <h3 id="user-editor-access" className="user-editor__section-title">Доступ и команда</h3>
      <label className="field"><span className="field__label">Логин для входа</span><input className="input" autoComplete="off" value={target ? target.login : login} readOnly={Boolean(target)} onChange={target ? undefined : (e) => setLogin(e.target.value)} required minLength={3} maxLength={150} />{target && <span className="field__note">{ownAccount ? <>Свой логин меняйте <Link to="/profile">в профиле</Link>.</> : "Для смены логина откройте карточку сотрудника."}</span>}</label>
      <div className="team-form-grid"><label className="field"><span className="field__label">Роль</span><Select aria-label="Роль сотрудника" value={role} disabled={target?.id === actor?.id} onChange={(value) => { setRole(value as Role); if (value === "operator" && target?.role !== "operator") chooseSupervisor(""); }} options={visibleRoles(actor?.role).map(r => ({ value: r, label: ROLE_LABELS[r] }))} /></label>
        {!trainer && role === "operator" && <label className="field"><span className="field__label">Супервайзер · необязательно</span><Select aria-label="Супервайзер сотрудника" value={supervisorId} disabled={!supervisorTeams.isSuccess} onChange={chooseSupervisor} options={[
          { value: "", label: "Пока без команды" },
          ...(supervisorId === "legacy" && target?.group ? [{ value: "legacy", label: `${target.group.name} · супервайзер не назначен` }] : []),
          ...(supervisorTeams.data ?? []).filter(item => item.supervisor.is_active || String(item.supervisor.id) === supervisorId).map(item => ({ value: item.supervisor.id, label: `${item.supervisor.full_name}${item.supervisor.is_active ? "" : " · архив"}`, disabled: !item.supervisor.is_active })),
        ]} /><span className="field__note">Операторов назначают руководитель и администратор. После назначения оператор получает доступ к команде и её району.</span></label>}
        {!trainer && role !== "operator" && role !== "supervisor" && <label className="field"><span className="field__label">Группа · необязательно</span><Select aria-label="Группа сотрудника" value={groupId} onChange={setGroupId} options={[{ value: "", label: "Без группы" }, ...groups.filter(g => g.is_active || g.id === target?.group?.id).map(g => ({ value: g.id, label: `${g.name}${g.is_active ? "" : " · архив"}`, disabled: !g.is_active }))]} /></label>}
      </div>
      {!trainer && role === "supervisor" && <p className="field__note">У супервайзера будет своя команда. {target?.role === "supervisor" ? "Операторов можно назначить в разделе «Супервайзеры»." : "Она создастся автоматически при сохранении. Затем назначьте операторов в разделе «Супервайзеры»."}</p>}
      {!trainer && role === "operator" && selectedTeam && destinationGroups.length > 1 && <label className="field"><span className="field__label">Группа назначения</span><Select required aria-label="Группа назначения" value={groupId} onChange={(value) => { setTeamSelectionTouched(true); setGroupId(value); }} options={[
        { value: "", label: "Выберите группу" },
        ...(keepCurrentTeam && target?.group && !destinationGroups.some(g => g.id === target.group!.id) ? [{ value: target.group.id, label: `${target.group.name} · текущая` }] : []),
        ...destinationGroups.map(g => ({ value: g.id, label: g.name })),
      ]} /><span className="field__note">У супервайзера несколько прежних групп с разными районами. Выберите, где будет работать оператор.</span></label>}
      {!trainer && role === "operator" && target?.group && selectedGroupId !== target.group.id && <label className="team-selection-toggle"><input type="checkbox" required key={`${supervisorId}:${selectedGroupId}`} /><span>Подтверждаю {selectedGroupId == null && !supervisorId ? "снятие оператора из команды" : "перевод оператора в выбранную команду"}. Доступ к командному району будет изменён.</span></label>}
      {!target && <label className="field"><span className="field__label">Первый пароль</span><div className="team-password"><input className="input" autoComplete="new-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} /><Button size="s" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Скрыть" : "Показать"}</Button></div><span className="muted micro">Не менее 8 символов. Передайте пароль сотруднику лично.</span></label>}
      </section>
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
      queryClient.invalidateQueries({ queryKey: ["team-supervisor-teams"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
      for (const key of ["team-assignment-users", "lookup-groups", "analytics", "city", "city-world", "city-estate", "city-estates"]) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(target.is_active ? "Сотрудник перенесён в архив" : "Доступ сотрудника восстановлен"); onClose();
    },
  });
  return <Sheet title={target.is_active ? "Архивировать сотрудника?" : "Восстановить сотрудника?"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button variant={target.is_active ? "destructive" : "primary"} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : target.is_active ? "Архивировать" : "Восстановить"}</Button></>}>
    <div className="stack"><strong>{target.full_name}</strong><p>{target.is_active ? "История сотрудника сохранится. Вход в Puls будет закрыт, новые начисления за периоды остановятся." : "Сотрудник снова сможет войти в Puls с прежним логином и паролем."}</p>{save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}</div>
  </Sheet>;
}
