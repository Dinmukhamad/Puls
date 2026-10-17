import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { team, teamError, type SupervisorTeam, type TeamGroup } from "../api/team";
import type { UserOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, RowsSkeleton, Select, Skeleton } from "../components/ui";
import { ChevronRightIcon, UsersIcon } from "../components/icons";
import { plural } from "../utils/format";
import { activeTeamGroups, assignmentTransferUsers, destinationGroupId, userTeamLabel } from "./supervisorTeams";
import { groupsWorthShowing, operatorCount, teamTitles } from "./teamSection";
import { TeamPersonRow, UserEditor } from "./UsersPage";
import "./team.css";

/**
 * «Супервайзеры» for heads and admins, «Моя команда» for a supervisor (docs/TEAM_SECTION.md). Who leads whom and how many
 * operators are still without a team; a row opens the team's operators.
 */
export function GroupsPage() {
  const { user: actor } = useAuth();
  return actor?.role === "head" || actor?.role === "admin" ? <Supervisors /> : <MyTeam />;
}

function Supervisors() {
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups });
  const teams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal) });
  const free = useQuery({ queryKey: ["team-users", "unassigned-operators"], queryFn: ({ signal }) => team.users({ role: "operator", unassigned: true, is_active: true, page: 1, size: 1 }, signal) });
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = ["active", "archived", "all"].includes(params.get("status") ?? "") ? params.get("status")! : "active";
  const [editor, setEditor] = useState<TeamGroup | null>(null);
  const [newSupervisor, setNewSupervisor] = useState(false);
  const [assignment, setAssignment] = useState<{ team: SupervisorTeam; remove: boolean } | null>(null);
  const filtered = teams.data?.filter((item) => `${item.supervisor.full_name} ${item.supervisor.login} ${item.groups.map(g => g.name).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || item.supervisor.is_active === (status === "active")));
  const unowned = groups.data?.filter(g => !g.supervisor && `${g.name} ${g.code}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || g.is_active === (status === "active"))) ?? [];
  const active = teams.data?.filter(item => item.supervisor.is_active) ?? [];
  const archived = (teams.data?.length ?? 0) - active.length;
  const unassigned = free.data?.total ?? 0;
  const titles = teamTitles("head");

  return <div className="stack team-page">
    <div className="page-head"><div><h1 className="page-title">{titles.groups}</h1><p className="page-subtitle">Супервайзеры и их команды. Назначьте супервайзеру операторов — команда создастся сама.</p></div><Button variant="primary" onClick={() => setNewSupervisor(true)}>Создать супервайзера</Button></div>
    {teams.data && <div className="kpi-grid team-kpis">
      <KPI label="Супервайзеров" value={active.length} hint={archived ? `Ещё ${archived} в архиве` : "Все активны"} />
      <KPI label="Операторов в командах" value={active.reduce((sum, item) => sum + item.operator_count, 0)} hint="У активных супервайзеров" />
      <KPI label="Без команды" value={free.data ? unassigned : "—"} tone={unassigned > 0 ? "accent" : "neutral"}
        hint={unassigned > 0 ? <Link to="/admin/users?role=operator&supervisor=unassigned&status=active">Показать операторов</Link> : free.data ? "Все операторы в командах" : undefined} />
    </div>}
    <GlassSurface variant="regular" className="team-filterbar"><label className="field team-search"><span className="field__label">Поиск</span><input className="input" type="search" placeholder="Имя, логин или название команды" value={search} onChange={(e) => setParams({ status, search: e.target.value }, { replace: true })} /></label>
      <label className="field team-status-filter"><span className="field__label">Статус</span><Select aria-label="Статус супервайзера" value={status} onChange={(value) => setParams({ search, status: value })} options={[{ value: "active", label: "Активные" }, { value: "archived", label: "Архивные" }, { value: "all", label: "Все" }]} /></label></GlassSurface>
    {teams.isLoading && <Skeleton height={200} />}{teams.isError && <ErrorState error={new Error(teamError(teams.error, "Не удалось загрузить команды супервайзеров"))} onRetry={() => teams.refetch()} />}
    {filtered?.length === 0 && <EmptyState title="Супервайзеры не найдены" hint="Измените фильтры или создайте супервайзера." />}
    {filtered && filtered.length > 0 && <Card title="Команды" subtitle="Нажмите на строку — откроется состав команды." padded={false} className="team-list">
      <ul className="team-rows team-rows--teams" aria-label="Команды супервайзеров">{filtered.map((item) => {
        const shown = groupsWorthShowing(item);
        const single = item.groups.length === 1 && shown.length === 0 ? item.groups[0] : null;
        return <li key={item.supervisor.id} className={`team-row${item.supervisor.is_active ? "" : " is-archived"}`}>
          <Link className="team-row__person" to={`/admin/users?role=operator&supervisor=${item.supervisor.id}`}>
            <Avatar name={item.supervisor.full_name} id={item.supervisor.id} size={40} />
            <span className="team-row__text"><span className="team-row__name">{item.supervisor.full_name}{!item.supervisor.is_active && <Badge tone="neutral">В архиве</Badge>}</span><span className="team-row__meta">{item.supervisor.login} · Супервайзер</span></span>
          </Link>
          <span className="team-row__count"><strong>{item.operator_count}</strong> {plural(item.operator_count, "оператор", "оператора", "операторов")}</span>
          <span className="team-row__actions">
            {item.supervisor.is_active && <Button size="s" onClick={() => setAssignment({ team: item, remove: false })}>Назначить операторов</Button>}
            {item.operator_count > 0 && <Button size="s" variant="plain" onClick={() => setAssignment({ team: item, remove: true })}>Снять из команды</Button>}
            {single && <Button size="s" variant="plain" aria-label={`Настройки команды: ${single.name}`} onClick={() => setEditor(single)}>Настройки</Button>}
          </span>
          <span className="team-row__go" aria-hidden="true"><ChevronRightIcon size={16} /></span>
          {shown.length > 0 && <ul className="team-subrows" aria-label={`Группы команды: ${item.supervisor.full_name}`}>{shown.map(group => <li key={group.id} className="team-subrow">
            <span><strong>{group.name}</strong><small>{operatorCount(group.operator_count)}{group.is_active ? "" : " · архив"}</small></span>
            <Button size="s" variant="plain" aria-label={`Настройки команды: ${group.name}`} onClick={() => setEditor(group)}>Настройки</Button>
          </li>)}</ul>}
          {item.groups.length === 0 && <p className="team-row__note">Команда создастся при первом назначении операторов.</p>}
          {activeTeamGroups(item).length > 1 && <p className="team-row__note">При назначении выберите одну из групп: их состав и районы сохранены.</p>}
        </li>;
      })}</ul>
    </Card>}
    {groups.isError && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
    {unowned.length > 0 && <Card title="Группы без супервайзера" subtitle="Назначьте группе супервайзера: её операторы получат доступ к его району." padded={false} className="team-list">
      <ul className="team-rows team-rows--teams" aria-label="Группы без супервайзера">{unowned.map(group => <li key={group.id} className={`team-row${group.is_active ? "" : " is-archived"}`}>
        <Link className="team-row__person" to={`/admin/users?group=${group.id}`}>
          <span className="team-row__icon" aria-hidden="true"><UsersIcon size={18} /></span>
          <span className="team-row__text"><span className="team-row__name">{group.name}{!group.is_active && <Badge tone="neutral">В архиве</Badge>}</span><span className="team-row__meta">Супервайзер не назначен</span></span>
        </Link>
        <span className="team-row__count"><strong>{group.operator_count}</strong> {plural(group.operator_count, "оператор", "оператора", "операторов")}</span>
        <span className="team-row__actions"><Button size="s" onClick={() => setEditor(group)}>Назначить супервайзера</Button></span>
        <span className="team-row__go" aria-hidden="true"><ChevronRightIcon size={16} /></span>
      </li>)}</ul>
    </Card>}
    {newSupervisor && <UserEditor initialRole="supervisor" groups={groups.data ?? []} groupsReady={groups.isSuccess} onClose={() => setNewSupervisor(false)} />}
    {editor && <GroupEditor target={editor} onClose={() => setEditor(null)} />}
    {assignment && <OperatorAssignment target={assignment.team} remove={assignment.remove} groups={groups.data ?? []} onClose={() => setAssignment(null)} />}
  </div>;
}

/** A supervisor's own team: their operators, each opening the operator's card. Membership is set by a head or an admin. */
function MyTeam() {
  const { user: actor } = useAuth();
  const teams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal) });
  const own = teams.data?.find(item => item.supervisor.id === actor?.id) ?? teams.data?.[0];
  const [page, setPage] = useState(1);
  const size = 25;
  const people = useQuery({ queryKey: ["team-users", "my-team", own?.supervisor.id, page], queryFn: ({ signal }) => team.users({ role: "operator", supervisor_id: own!.supervisor.id, is_active: true, page, size }, signal), enabled: Boolean(own) });
  const groups = own ? activeTeamGroups(own) : [];
  const titles = teamTitles("supervisor");

  return <div className="stack team-page">
    <div className="page-head"><div><h1 className="page-title">{titles.groups}</h1><p className="page-subtitle">Ваши операторы. Состав команды назначает руководитель или администратор.</p></div></div>
    {teams.isLoading && <Skeleton height={200} />}{teams.isError && <ErrorState error={new Error(teamError(teams.error, "Не удалось загрузить команду"))} onRetry={() => teams.refetch()} />}
    {teams.data && !own && <EmptyState title="Команда не найдена" hint="Попросите руководителя или администратора проверить вашу команду." />}
    {own && <Card title="Операторы" subtitle={`${operatorCount(own.operator_count)}${groups.length > 1 ? ` · ${groups.length} ${plural(groups.length, "группа", "группы", "групп")}` : ""}`} padded={false} className="team-list"
      action={<Link className="btn btn--secondary btn--s" to="/admin/operators">Показатели команды</Link>}>
      {people.isLoading && <div className="card__body"><RowsSkeleton /></div>}
      {people.isError && <ErrorState error={new Error(teamError(people.error, "Не удалось загрузить операторов"))} onRetry={() => people.refetch()} />}
      {people.data && people.data.items.length === 0 && <EmptyState title="Операторов пока нет" hint="Состав команды назначает руководитель или администратор." />}
      {people.data && people.data.items.length > 0 && <>
        <ul className="team-rows team-rows--people" aria-label="Операторы команды">{people.data.items.map(user => <TeamPersonRow key={user.id} person={user} role={false} team={groups.length > 1 ? user.group?.name : undefined} />)}</ul>
        <Pagination page={page} size={size} total={people.data.total} onChange={setPage} />
      </>}
    </Card>}
  </div>;
}

export function OperatorAssignment({ target, remove, groups, onClose }: { target: SupervisorTeam; remove: boolean; groups: TeamGroup[]; onClose: () => void }) {
  const { user: actor } = useAuth();
  const canManage = actor?.role === "head" || actor?.role === "admin";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(1);
  const [groupId, setGroupId] = useState(() => { const id = destinationGroupId(target, ""); return id == null ? "" : String(id); });
  const [selected, setSelected] = useState<Map<number, UserOut>>(() => new Map());
  const [reviewing, setReviewing] = useState(false);
  const client = useQueryClient(); const toast = useToast();
  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  const destination = destinationGroupId(target, groupId);
  const ownedGroups = activeTeamGroups(target);
  const selection = Array.from(selected.values());
  const transfers = ownedGroups.length === 0 ? selection.filter(user => user.group != null) : assignmentTransferUsers(selection, target, destination);
  const enabled = canManage && (remove || unassigned || debouncedSearch.length > 0);
  const selectionLimit = 500;
  const people = useQuery({ queryKey: ["team-assignment-users", target.supervisor.id, remove, unassigned, debouncedSearch, page], queryFn: ({ signal }) => team.users({ role: "operator", search: debouncedSearch || undefined, only_active: !remove || undefined, supervisor_id: remove ? target.supervisor.id : undefined, unassigned: !remove && unassigned ? true : undefined, page, size: 20 }, signal), enabled });
  const save = useMutation({ mutationFn: async () => {
    if (!canManage || selection.length === 0) throw new Error("Нет прав или не выбраны операторы");
    if (remove) return team.removeOperators(target.supervisor.id, selection.map(u => u.id));
    if ((destination == null && ownedGroups.length > 0) || !target.supervisor.is_active) throw new Error("Выберите действующую команду");
    return team.assignOperators(target.supervisor.id, selection.map(u => u.id), destination);
  }, onSuccess: (result) => {
    for (const key of ["team-supervisor-teams", "team-users", "team-groups", "team-user", "team-assignment-users", "admin-operators", "admin-summary", "lookup-groups", "analytics", "city", "city-world", "city-estate", "city-estates"]) void client.invalidateQueries({ queryKey: [key] });
    const changedCount = "removed_count" in result ? result.removed_count : result.assigned_count;
    toast.success(remove ? `Из команды снято операторов: ${changedCount}` : `Операторов назначено: ${changedCount}`); onClose();
  } });
  function toggle(user: UserOut) { if (!selected.has(user.id) && selected.size >= selectionLimit) { toast.info("За один раз можно назначить не более 500 операторов."); return; } setSelected(current => { const next = new Map(current); if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user); return next; }); }
  function submit(event: FormEvent) { event.preventDefault(); if (save.isPending || !canManage || selection.length === 0 || (!remove && destination == null && ownedGroups.length > 0)) return; if (!remove && transfers.length > 0 && !reviewing) setReviewing(true); else save.mutate(); }
  if (!canManage) return null;
  return <Sheet title={remove ? "Снять операторов из команды" : reviewing ? "Подтвердить перевод операторов" : "Назначить операторов"} subtitle={`Супервайзер: ${target.supervisor.full_name}`} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={reviewing ? () => setReviewing(false) : onClose}>{reviewing ? "Назад к выбору" : "Отмена"}</Button><Button form="team-assignment-form" type="submit" variant={remove ? "destructive" : "primary"} disabled={save.isPending || selection.length === 0 || (!remove && destination == null && ownedGroups.length > 0)}>{save.isPending ? "Сохраняем…" : remove ? `Снять из команды · ${selection.length}` : reviewing ? `Подтвердить перевод · ${selection.length}` : `Назначить · ${selection.length}`}</Button></>}>
    <form id="team-assignment-form" className="stack" onSubmit={submit}>
      {save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}
      {reviewing ? <><p>Будет назначено операторов: <strong>{selection.length}</strong>. Из другой группы переводится: <strong>{transfers.length}</strong>.</p><p>Новая команда: <strong>{target.supervisor.full_name}</strong>{ownedGroups.length > 1 && ` · ${ownedGroups.find(g => g.id === destination)?.name}`}.</p><p className="field__note">После перевода доступ к командному району и действиям супервайзера будет определяться новой командой. История работы оператора сохранится.</p><div className="team-assignment-list">{selection.map(user => <div key={user.id} className="team-assignment-summary"><strong>{user.full_name}</strong><span className="muted small">{userTeamLabel(user, groups)}</span></div>)}</div></> : <>
        {!remove && ownedGroups.length > 1 && <label className="field"><span className="field__label">Группа назначения</span><Select required aria-label="Группа назначения" value={groupId} onChange={setGroupId} options={[{ value: "", label: "Выберите группу и её район" }, ...ownedGroups.map(group => ({ value: group.id, label: group.name }))]} /><span className="field__note">У этого супервайзера несколько прежних групп. Операторы попадут только в выбранную группу.</span></label>}
        {!remove && ownedGroups.length === 0 && <p className="field__note">При назначении сервер создаст команду супервайзера.</p>}
        {remove && <p className="field__note">Выбранные операторы останутся без команды. Их аккаунты и история сохранятся. Доступ к командному району и действиям этого супервайзера прекратится.</p>}
        <label className="field"><span className="field__label">Поиск операторов</span><input autoFocus type="search" className="input" placeholder="Введите имя или логин" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {!remove && <label className="team-selection-toggle"><input type="checkbox" checked={unassigned} onChange={event => { setUnassigned(event.target.checked); setPage(1); }} /><span>Только операторы без команды</span></label>}
        {selection.length > 0 && <p className="field__note">Выбрано: {selection.length} · максимум {selectionLimit} за одно действие</p>}
        {selection.length > 0 && <div className="team-selected-operators" aria-label="Выбранные операторы">{selection.map(user => <button type="button" className="team-selected-operator" key={user.id} onClick={() => toggle(user)} aria-label={`Убрать из выбора: ${user.full_name}`}>{user.full_name}<span aria-hidden="true">×</span></button>)}</div>}
        {!enabled && <p className="muted">Начните вводить имя — совпадения появятся ниже. Можно выбрать несколько операторов.</p>}
        {enabled && people.isLoading && <Skeleton height={120} />}{people.isError && <ErrorState error={new Error(teamError(people.error, "Не удалось найти операторов"))} onRetry={() => people.refetch()} />}
        {enabled && people.data?.items.length === 0 && <EmptyState title="Операторы не найдены" hint="Измените поисковый запрос или фильтр." />}
        {enabled && people.data && people.data.items.length > 0 && <><div className="team-assignment-list">{people.data.items.map(user => { const alreadyAssigned = !remove && destination != null && user.group?.id === destination; return <label className={`team-assignment-option${alreadyAssigned ? " is-disabled" : ""}`} key={user.id}><input type="checkbox" checked={selected.has(user.id)} disabled={alreadyAssigned || (!selected.has(user.id) && selection.length >= selectionLimit)} onChange={() => toggle(user)} /><Avatar name={user.full_name} id={user.id} size={36} /><span><strong>{user.full_name}</strong><span className="muted small block">{userTeamLabel(user, groups)}</span>{alreadyAssigned && <span className="field__note">Уже в выбранной команде</span>}</span></label>; })}</div><Pagination page={page} size={20} total={people.data.total} onChange={setPage} /></>}
      </>}
    </form>
  </Sheet>;
}

function GroupEditor({ target, onClose }: { target: TeamGroup; onClose: () => void }) {
  const [name, setName] = useState(target.name);
  const [supervisor, setSupervisor] = useState(target.supervisor ? String(target.supervisor.id) : "");
  const [active, setActive] = useState(target.is_active);
  const people = useQuery({ queryKey: ["team-supervisors"], queryFn: team.supervisors });
  const client = useQueryClient(); const toast = useToast();
  const save = useMutation({ mutationFn: () => team.updateGroup(target.id, { name: name.trim(), ...((Number(supervisor) || null) !== (target.supervisor?.id ?? null) ? { supervisor_id: Number(supervisor) || null } : {}), is_active: active }),
    onSuccess: () => { for (const key of ["team-groups", "team-supervisor-teams", "team-users", "team-user", "lookup-groups", "analytics", "city", "city-world", "city-estate", "city-estates"]) void client.invalidateQueries({ queryKey: [key] }); toast.success("Команда сохранена"); onClose(); } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!save.isPending) save.mutate(); };
  return <Sheet title="Настройки команды" onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button form="group-form" type="submit" variant="primary" disabled={save.isPending || !people.isSuccess}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="group-form" className="stack" onSubmit={submit}>
      {save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}
      <p className="field__note">При смене супервайзера весь состав группы перейдёт под его управление и получит доступ к его району. Личные постройки операторов будут перенесены в новый район, история работы сохранится.</p>
      <label className="field"><span className="field__label">Название команды</span><input className="input" required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span className="field__label">Супервайзер</span><Select aria-label="Супервайзер команды" value={supervisor} onChange={setSupervisor} options={[{ value: "", label: "Не назначен" }, ...(target.supervisor && !people.data?.some(p => p.id === target.supervisor!.id) ? [{ value: target.supervisor.id, label: `${target.supervisor.full_name} · текущий` }] : []), ...(people.data ?? []).map(p => ({ value: p.id, label: p.full_name }))]} /></label>
      {people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}
      <label className="field"><span className="field__label">Статус команды</span><Select aria-label="Статус команды" value={active ? "active" : "archived"} onChange={(value) => setActive(value === "active")} options={[{ value: "active", label: "Активна" }, { value: "archived", label: "Архив" }]} /><span className="muted small">Перед архивированием переведите активных сотрудников в другую команду.</span></label>
    </form>
  </Sheet>;
}
