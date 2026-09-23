import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { team, teamError, type TeamGroup } from "../api/team";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "../components/ui";
import "./team.css";

export function GroupsPage() {
  const { atLeast } = useAuth();
  const groups = useQuery({ queryKey: ["team-groups"], queryFn: team.groups });
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "active";
  const [editor, setEditor] = useState<TeamGroup | "new" | null>(null);
  const filtered = groups.data?.filter((g) => `${g.name} ${g.code}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || g.is_active === (status === "active")));
  return <div className="stack team-page">
    <div className="page-head"><div><h1 className="page-title">Группы</h1><p className="page-subtitle">Команды операторов и их супервайзеры</p></div>{atLeast("head") && <Button variant="primary" onClick={() => setEditor("new")}>Создать группу</Button>}</div>
    <GlassSurface variant="regular" className="team-filterbar"><label className="field team-search"><span className="field__label">Поиск</span><input className="input" type="search" placeholder="Название или код группы" value={search} onChange={(e) => setParams({ status, search: e.target.value }, { replace: true })} /></label>
      <label className="field"><span className="field__label">Статус</span><select className="input" value={status} onChange={(e) => setParams({ search, status: e.target.value })}><option value="active">Активные</option><option value="archived">Архивные</option><option value="all">Все</option></select></label></GlassSurface>
    {groups.isLoading && <Skeleton height={200} />}{groups.isError && <ErrorState error={groups.error} onRetry={() => groups.refetch()} />}
    {filtered?.length === 0 && <EmptyState title="Группы не найдены" hint="Измените фильтры или создайте группу" />}
    <div className="team-group-grid">{filtered?.map((group) => <Card key={group.id} title={group.name} subtitle={group.code} className="team-group-card" action={<Badge tone={group.is_active ? "success" : "neutral"}>{group.is_active ? "Активна" : "Архив"}</Badge>}>
      <div><strong className="team-group-card__count">{group.operator_count}</strong><p className="secondary">операторов · {group.member_count} сотрудников</p></div>
      <div className="team-group-card__supervisor">{group.supervisor && <Avatar name={group.supervisor.full_name} id={group.supervisor.id} size={36} />}<span>{group.supervisor?.full_name ?? "Супервайзер не назначен"}</span></div>
      <div className="team-actions"><Link className="btn btn--secondary btn--m" to={`/admin/users?group=${group.id}`}>Сотрудники</Link>{atLeast("head") && <Button variant="plain" onClick={() => setEditor(group)}>Изменить</Button>}</div>
    </Card>)}</div>
    {editor && <GroupEditor target={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
  </div>;
}

function GroupEditor({ target, onClose }: { target?: TeamGroup; onClose: () => void }) {
  const [name, setName] = useState(target?.name ?? "");
  const [code, setCode] = useState(target?.code ?? "");
  const [supervisor, setSupervisor] = useState(target?.supervisor ? String(target.supervisor.id) : "");
  const [active, setActive] = useState(target?.is_active ?? true);
  const people = useQuery({ queryKey: ["team-supervisors"], queryFn: team.supervisors });
  const client = useQueryClient(); const toast = useToast();
  const save = useMutation({ mutationFn: () => target ? team.updateGroup(target.id, { name, supervisor_id: Number(supervisor) || null, is_active: active }) : team.createGroup({ code, name, supervisor_id: Number(supervisor) || null }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["team-groups"] }); toast.success("Группа сохранена"); onClose(); } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!save.isPending) save.mutate(); };
  return <Sheet title={target ? "Изменить группу" : "Новая группа"} onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button form="group-form" type="submit" variant="primary" disabled={save.isPending || !people.isSuccess}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="group-form" className="stack" onSubmit={submit}>
      {save.isError && <p role="alert" className="team-form-error">{teamError(save.error)}</p>}
      {!target && <label className="field"><span className="field__label">Код группы</span><input className="input" required maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} /></label>}
      <label className="field"><span className="field__label">Название</span><input className="input" required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span className="field__label">Супервайзер</span><select className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)}><option value="">Не назначен</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      {people.isError && <ErrorState error={people.error} onRetry={() => people.refetch()} />}
      {target && <label className="field"><span className="field__label">Статус группы</span><select className="input" value={active ? "active" : "archived"} onChange={(e) => setActive(e.target.value === "active")}><option value="active">Активна</option><option value="archived">Архив</option></select><span className="muted small">Перед архивированием переведите активных сотрудников в другую группу.</span></label>}
    </form>
  </Sheet>;
}
