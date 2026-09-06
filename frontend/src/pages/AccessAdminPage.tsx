import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi, type AccessPolicy, type AccessSubject, type Effect, type SectionCode, type TargetType } from "../api/access";
import type { Role } from "../api/types";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, Skeleton } from "../components/ui";
import { ROLE_LABELS } from "../utils/format";
import "./access.css";

const kinds: [TargetType, string][] = [["all", "Все сотрудники"], ["role", "Роли"], ["group", "Группы"], ["user", "Аккаунты"]];
const effects: Record<Effect, string> = { allow: "Разрешить", deny: "Запретить", inherit: "Наследовать" };
const sources = { default: "По роли по умолчанию", all: "Общее правило", role: "Правило роли", group: "Правило группы", user: "Личное правило", admin_only: "Только администраторы" };

export function AccessAdminPage() {
  const policy = useQuery({ queryKey: ["access-policy"], queryFn: ({ signal }) => accessApi.policy(signal), refetchOnWindowFocus: false });
  return <div className="stack access-page">
    <header className="page-head"><div><h1 className="page-title">Доступ к разделам</h1><p className="page-subtitle">Настройте рабочее пространство для ролей, групп и отдельных сотрудников.</p></div></header>
    <Card title="Как работают правила"><p>Приоритет: аккаунт → группа → роль → все сотрудники → настройки по умолчанию. Личное правило может разрешить доступ, закрытый для всей роли. «Наследовать» убирает выбранное исключение.</p><p className="small secondary">Доступ открывает раздел и его просмотр. Видимость сотрудников и возможность изменять данные определяются рабочей ролью. Профиль, пароль, уведомления и собственные устройства доступны всегда. Управление правами и системный аудит доступны только администраторам.</p></Card>
    {policy.isPending && <Skeleton height={300} />}
    {policy.isError && <ErrorState error={policy.error} onRetry={() => policy.refetch()} />}
    {policy.data && <><PolicyEditor policy={policy.data} /><AccessPreview policy={policy.data} /></>}
  </div>;
}

function PolicyEditor({ policy }: { policy: AccessPolicy }) {
  const client = useQueryClient(); const toast = useToast();
  const [kind, setKind] = useState<TargetType>("role");
  const [selected, setSelected] = useState<AccessSubject[]>([]);
  const [changes, setChanges] = useState<Partial<Record<SectionCode, Effect>>>({});
  // Keep the revision of the rule set on which the draft was based.
  const [revision, setRevision] = useState(policy.revision);
  const dirty = Object.keys(changes).length > 0;
  const ids = kind === "all" ? ["*"] : selected.map((item) => item.id);
  const save = useMutation({
    mutationFn: () => accessApi.save({ revision, target_type: kind, target_ids: ids, changes: Object.entries(changes).map(([section, effect]) => ({ section: section as SectionCode, effect: effect! })) }),
    onSuccess: (result) => {
      setChanges({}); setRevision(result.revision); toast.success(result.detail);
      void client.invalidateQueries({ queryKey: ["access-policy"] });
      void client.invalidateQueries({ queryKey: ["access-preview"] });
      void client.invalidateQueries({ queryKey: ["my-access"] });
    },
  });
  useEffect(() => { if (!dirty) setRevision(policy.revision); }, [policy.revision, dirty]);
  function audience(next: TargetType) { setKind(next); setSelected([]); setChanges({}); save.reset(); setRevision(policy.revision); }
  function current(code: SectionCode) {
    const values = new Set(ids.map((id) => policy.rules.find((rule) => rule.target_type === kind && rule.target_id === id && rule.section === code)?.effect ?? "inherit"));
    return values.size > 1 ? "Разные правила" : ids.length ? effects[[...values][0]] : "Выберите получателей";
  }
  function reload() { setChanges({}); save.reset(); void client.invalidateQueries({ queryKey: ["access-policy"] }); }
  return <Card title="Назначить права" subtitle="Изменятся только отмеченные разделы у выбранных получателей">
    <fieldset className="access-fieldset stack" disabled={save.isPending}>
      <label className="field"><span className="field__label">Кому назначить</span><select className="input" value={kind} disabled={dirty} onChange={(event) => audience(event.target.value as TargetType)}>{kinds.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {kind === "all" && <p className="access-notice">Правило распространяется на всех существующих и будущих сотрудников. Более конкретные исключения сохранят приоритет.</p>}
      {kind === "role" && <div className="access-role-options">{(Object.keys(ROLE_LABELS) as Role[]).map((role) => <label key={role} className="access-check"><input type="checkbox" checked={ids.includes(role)} disabled={dirty} onChange={(event) => setSelected(event.target.checked ? [...selected, { id: role, name: ROLE_LABELS[role], role, is_active: true }] : selected.filter((item) => item.id !== role))} /><span>{ROLE_LABELS[role]}</span></label>)}</div>}
      {(kind === "group" || kind === "user") && <SubjectPicker key={kind} kind={kind} selected={selected} onChange={setSelected} disabled={dirty} />}
      {dirty && <p className="small secondary">Чтобы сменить получателей, сохраните или отмените подготовленные изменения.</p>}
      <div className="access-rule-list">{policy.sections.map((section) => <article className="access-rule" key={section.code}>
        <div><h3>{section.title}</h3><p className="small secondary">{section.description}</p><p className="micro secondary">По умолчанию: {section.defaults.map((role) => ROLE_LABELS[role]).join(", ")}. {section.admin_only && "Открыть другим ролям нельзя."}</p></div>
        <label className="field"><span className="field__label">{current(section.code)}</span><select className="input" aria-label={`Правило: ${section.title}`} disabled={!ids.length} value={changes[section.code] ?? "keep"} onChange={(event) => setChanges((previous) => { const next = { ...previous }; if (event.target.value === "keep") delete next[section.code]; else next[section.code] = event.target.value as Effect; return next; })}><option value="keep">Не менять</option><option value="allow">Разрешить{section.admin_only ? " администраторам" : ""}</option><option value="deny">Запретить</option><option value="inherit">Наследовать</option></select></label>
      </article>)}</div>
      {dirty && <div className="access-notice" role="status"><strong>Подготовлено изменений: {Object.keys(changes).length}. {kind === "all" ? "Для всех сотрудников." : `Получателей: ${ids.length}.`}</strong><p className="small">{policy.sections.filter((section) => changes[section.code]).map((section) => `${section.title}: ${effects[changes[section.code]!]}`).join("; ")}</p></div>}
      {save.isError && <ErrorState error={save.error} />}
      {save.isError && (save.error as { status?: number }).status === 409 && <Button onClick={reload}>Загрузить актуальные правила и сбросить черновик</Button>}
      <div className="access-actions"><Button variant="primary" disabled={!dirty || !ids.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Применить права"}</Button><Button disabled={!dirty || save.isPending} onClick={() => { setChanges({}); save.reset(); setRevision(policy.revision); }}>Отменить изменения</Button></div>
    </fieldset>
  </Card>;
}

function SubjectPicker({ kind, selected, onChange, single = false, disabled = false }: { kind: "user" | "group"; selected: AccessSubject[]; onChange: (value: AccessSubject[]) => void; single?: boolean; disabled?: boolean }) {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const data = useQuery({ queryKey: ["access-subjects", kind, search, page], queryFn: ({ signal }) => accessApi.subjects(kind, search, page, signal) });
  const toggle = (item: AccessSubject) => onChange(selected.some((row) => row.id === item.id) ? selected.filter((row) => row.id !== item.id) : single ? [item] : [...selected, item]);
  return <div className="stack stack--tight">
    <label className="field"><span className="field__label">{kind === "user" ? "Поиск сотрудников" : "Поиск групп"}</span><input className="input" type="search" value={search} maxLength={150} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    {!!selected.length && <div className="access-selection" aria-label="Выбранные получатели">{selected.map((item) => <Button key={item.id} size="s" disabled={disabled} onClick={() => toggle(item)} aria-label={`Убрать: ${item.name}`}>{item.name} ×</Button>)}</div>}
    {data.isPending && <Skeleton height={120} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {data.data?.total === 0 && <EmptyState title="Ничего не найдено" hint="Попробуйте другое имя." />}
    {data.data && <><div className="access-subject-list">{data.data.items.map((item) => <label className="access-check" key={item.id}><input type="checkbox" checked={selected.some((row) => row.id === item.id)} disabled={disabled || (!single && selected.length >= 200 && !selected.some((row) => row.id === item.id))} onChange={() => toggle(item)} /><span>{item.name}<span className="small secondary block">{item.role ? `${ROLE_LABELS[item.role]} · ` : ""}ID {item.id}{!item.is_active ? " · неактивен" : ""}</span></span></label>)}</div><Pagination page={page} size={20} total={data.data.total} onChange={setPage} /></>}
    {!single && <p className="micro secondary">Выбрано: {selected.length} из 200 за одно сохранение. Выбор сохраняется при поиске и смене страницы.</p>}
  </div>;
}

function AccessPreview({ policy }: { policy: AccessPolicy }) {
  const [selected, setSelected] = useState<AccessSubject[]>([]);
  const id = selected[0]?.id;
  const data = useQuery({ queryKey: ["access-preview", id, policy.revision], queryFn: ({ signal }) => accessApi.inspect(id!, signal), enabled: !!id });
  return <Card title="Проверить доступ сотрудника" subtitle="Итог с учётом всех правил и их приоритета">
    <SubjectPicker kind="user" selected={selected} onChange={setSelected} single />
    {id && data.isPending && <Skeleton height={180} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {data.data && <div className="access-rule-list">{policy.sections.map((section) => { const decision = data.data!.decisions[section.code]; return <div className="access-rule" key={section.code}><div><strong>{section.title}</strong><p className="small secondary">{sources[decision.source]}</p></div><Badge tone={decision.allowed ? "success" : "neutral"}>{decision.allowed ? "Доступ открыт" : "Доступ закрыт"}</Badge></div>; })}</div>}
  </Card>;
}
