import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { team, teamError, type SupervisorTeam, type TeamGroup } from "../api/team";
import type { UserOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Pagination, Select, Skeleton } from "../components/ui";
import { activeTeamGroups, assignmentTransferUsers, destinationGroupId, userTeamLabel } from "./supervisorTeams";
import { UserEditor } from "./UsersPage";
import "./team.css";

export function GroupsPage() {
  const { user: actor } = useAuth();
  const canManage = actor?.role === "head" || actor?.role === "admin";
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups });
  const teams = useQuery({ queryKey: ["team-supervisor-teams", true], queryFn: ({ signal }) => team.supervisorTeams(true, signal) });
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = ["active", "archived", "all"].includes(params.get("status") ?? "") ? params.get("status")! : "active";
  const [editor, setEditor] = useState<TeamGroup | null>(null);
  const [newSupervisor, setNewSupervisor] = useState(false);
  const [assignment, setAssignment] = useState<{ team: SupervisorTeam; remove: boolean } | null>(null);
  const filtered = teams.data?.filter((item) => `${item.supervisor.full_name} ${item.supervisor.login} ${item.groups.map(g => g.name).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || item.supervisor.is_active === (status === "active")));
  const unowned = groups.data?.filter(g => !g.supervisor && `${g.name} ${g.code}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || g.is_active === (status === "active"))) ?? [];
  return <div className="stack team-page">
    <div className="page-head"><div><h1 className="page-title">{canManage ? "Супервайзеры и команды" : "Моя команда"}</h1><p className="page-subtitle">{canManage ? "Создайте супервайзера и назначьте ему операторов. Команда создаётся автоматически." : "Ваши операторы. Состав команды назначает руководитель или администратор."}</p></div>{canManage && <Button variant="primary" onClick={() => setNewSupervisor(true)}>Создать супервайзера</Button>}</div>
    {canManage && <GlassSurface variant="regular" className="team-filterbar"><label className="field team-search"><span className="field__label">Поиск супервайзера</span><input className="input" type="search" placeholder="Имя, логин или название команды" value={search} onChange={(e) => setParams({ status, search: e.target.value }, { replace: true })} /></label>
      <label className="field team-status-filter"><span className="field__label">Статус</span><Select aria-label="Статус супервайзера" value={status} onChange={(value) => setParams({ search, status: value })} options={[{ value: "active", label: "Активные" }, { value: "archived", label: "Архивные" }, { value: "all", label: "Все" }]} /></label></GlassSurface>}
    {teams.isLoading && <Skeleton height={200} />}{teams.isError && <ErrorState error={new Error(teamError(teams.error, "Не удалось загрузить команды супервайзеров"))} onRetry={() => teams.refetch()} />}
    {filtered?.length === 0 && <EmptyState title={canManage ? "Супервайзеры не найдены" : "Команда не найдена"} hint={canManage ? "Измените фильтры или создайте супервайзера." : "Попросите руководителя или администратора проверить вашу команду."} />}
    <div className="team-group-grid">{filtered?.map((item) => <Card key={item.supervisor.id} className="team-group-card">
      <header className="team-group-card__head">
        <Avatar name={item.supervisor.full_name} id={item.supervisor.id} size={44} />
        <div className="team-group-card__identity"><h2 className="card__title">{item.supervisor.full_name}</h2><p className="card__subtitle">{item.supervisor.login} · Супервайзер</p></div>
        <Badge dot tone={item.supervisor.is_active ? "success" : "neutral"}>{item.supervisor.is_active ? "Активен" : "Архив"}</Badge>
      </header>
      <div className="team-group-card__summary"><strong className="team-group-card__count">{item.operator_count}</strong><span className="secondary">операторов в команде</span></div>
      {item.groups.length > 0 ? <div className="team-group-card__groups"><div className="team-group-card__section-label">{item.groups.length === 1 ? "Команда" : `Группы команды · ${item.groups.length}`}</div><div className="team-owned-groups">{item.groups.map(group => <div key={group.id} className="team-owned-group"><div><strong>{group.name}</strong><span className="muted small block">{group.operator_count} операторов{group.is_active ? "" : " · архив"}</span></div>{canManage && <Button size="s" variant="secondary" aria-label={`Настройки команды: ${group.name}`} onClick={() => setEditor(group)}>Настройки</Button>}</div>)}</div></div> : <p className="muted">Операторов пока нет. При назначении команда создастся автоматически.</p>}
      {activeTeamGroups(item).length > 1 && <p className="field__note">При назначении выберите одну из групп команды. Их состав и районы сохранены.</p>}
      <footer className="team-group-card__actions">
        {canManage && item.supervisor.is_active && <Button variant="primary" block onClick={() => setAssignment({ team: item, remove: false })}>Назначить операторов</Button>}
        <div className="team-group-card__secondary-actions"><Link className="btn btn--secondary btn--m" to={`/admin/users?role=operator&supervisor=${item.supervisor.id}`}>Операторы</Link>{canManage && item.operator_count > 0 && <Button variant="plain" onClick={() => setAssignment({ team: item, remove: true })}>Снять из команды</Button>}</div>
      </footer>
    </Card>)}</div>
    {canManage && groups.isError && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
    {canManage && unowned.length > 0 && <Card title="Группы без супервайзера" subtitle="Назначьте владельца в настройках группы. Операторы получат доступ к его району."><div className="team-owned-groups">{unowned.map(group => <div key={group.id} className="team-owned-group"><div><strong>{group.name}</strong><p className="muted small">{group.operator_count} операторов{group.is_active ? "" : " · архив"}</p></div><div className="team-actions"><Link className="btn btn--secondary btn--s" to={`/admin/users?group=${group.id}`}>Открыть</Link><Button variant="plain" size="s" onClick={() => setEditor(group)}>Назначить супервайзера</Button></div></div>)}</div></Card>}
    {newSupervisor && <UserEditor initialRole="supervisor" groups={groups.data ?? []} groupsReady={groups.isSuccess} onClose={() => setNewSupervisor(false)} />}
    {editor && <GroupEditor target={editor} onClose={() => setEditor(null)} />}
    {assignment && <OperatorAssignment target={assignment.team} remove={assignment.remove} groups={groups.data ?? []} onClose={() => setAssignment(null)} />}
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
        {enabled && people.data && people.data.items.length > 0 && <><div className="team-assignment-list">{people.data.items.map(user => { const alreadyAssigned = !remove && destination != null && user.group?.id === destination; return <label className={`team-assignment-option${alreadyAssigned ? " is-disabled" : ""}`} key={user.id}><input type="checkbox" checked={selected.has(user.id)} disabled={alreadyAssigned || (!selected.has(user.id) && selection.length >= selectionLimit)} onChange={() => toggle(user)} /><Avatar name={user.full_name} id={user.id} size={36} /><span><strong>{user.full_name}</strong><span className="muted small block">{user.login} · {userTeamLabel(user, groups)}</span>{alreadyAssigned && <span className="field__note">Уже в выбранной команде</span>}</span></label>; })}</div><Pagination page={page} size={20} total={people.data.total} onChange={setPage} /></>}
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
