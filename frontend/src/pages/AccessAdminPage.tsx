import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi, type AccessPolicy, type AccessPreviewSection, type AccessSubject, type AccessUpdate, type Effect, type SectionCode, type TargetType } from "../api/access";
import type { Role } from "../api/types";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, Skeleton } from "../components/ui";
import { ROLE_LABELS } from "../utils/format";
import { applyAccessDraft, draftEffect, sourceDescription } from "./accessEditor";
import "./access.css";

const kinds: [TargetType, string][] = [["role", "Роли"], ["group", "Группы"], ["user", "Сотрудники"], ["all", "Все сразу"]];
const effectLabels: Record<Effect, string> = { allow: "Открыть доступ", deny: "Закрыть доступ", inherit: "Вернуть наследование" };
const roleSubjects = (Object.keys(ROLE_LABELS) as Role[]).map(role => ({ id: role, name: ROLE_LABELS[role], role, is_active: true }));
const categories: { title: string; codes: SectionCode[] }[] = [
  { title: "Личное пространство", codes: ["personal", "results", "training", "rewards"] },
  { title: "Работа с командой", codes: ["overview", "team", "analytics", "performance", "learning_admin", "motivation", "reports"] },
  { title: "Администрирование", codes: ["system"] },
];

export function AccessAdminPage() {
  const policy = useQuery({ queryKey: ["access-policy"], queryFn: ({ signal }) => accessApi.policy(signal), refetchOnWindowFocus: false });
  return <div className="stack access-page">
    <header className="page-head"><div><h1 className="page-title">Доступ к разделам</h1><p className="page-subtitle">Выберите получателей, настройте разделы и сохраните изменения.</p></div></header>
    {policy.isPending && <Skeleton height={400} />}
    {policy.isError && <ErrorState error={policy.error} onRetry={() => policy.refetch()} />}
    {policy.data && <PolicyEditor policy={policy.data} />}
    <details className="access-help"><summary>Как наследуются права и что нельзя изменить</summary><div>
      <p>Личная настройка сотрудника важнее группы, группа — роли, роль — общего правила для всех. Если исключений нет, действуют настройки роли по умолчанию.</p>
      <p>«Вернуть наследование» убирает правило только у выбранных получателей. Система покажет результат до сохранения. Изменение роли или группы сохраняет более точные личные исключения.</p>
      <p>Группы здесь — рабочие группы из раздела «Пользователи и структура». Правило роли или группы распространяется и на будущих участников.</p>
      <p>Доступ открывает раздел и его просмотр. Видимость сотрудников и право изменять данные по-прежнему зависят от рабочей роли. Профиль доступен всегда. Управление правами доступно администраторам, а сессии и устройства — только разработчику.</p>
    </div></details>
  </div>;
}

export function AccessSwitch({ title, state, disabled, onChange }: { title: string; state: "on" | "off" | "mixed"; disabled: boolean; onChange: (enabled: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = state === "mixed"; }, [state]);
  return <label className={`access-switch${state === "mixed" ? " is-mixed" : ""}`}>
    <input ref={input} type="checkbox" aria-label={`Доступ: ${title}`} aria-checked={state === "mixed" ? "mixed" : state === "on"} checked={state === "on"} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="access-switch__track" aria-hidden="true"><span /></span>
    <span className="access-switch__label">{state === "mixed" ? "Разный доступ" : state === "on" ? "Открыт" : "Закрыт"}</span>
  </label>;
}

function PolicyEditor({ policy }: { policy: AccessPolicy }) {
  const client = useQueryClient();
  const editor = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<TargetType>("role");
  const [selected, setSelected] = useState<AccessSubject[]>([roleSubjects.find(item => item.id === "operator")!]);
  const [changes, setChanges] = useState<Partial<Record<SectionCode, Effect>>>({});
  const [revision, setRevision] = useState(policy.revision);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const dirty = Object.keys(changes).length > 0;
  const ids = kind === "all" ? ["*"] : selected.map(item => item.id).sort();
  const payload: AccessUpdate = { revision, target_type: kind, target_ids: ids, changes: Object.entries(changes).map(([section, effect]) => ({ section: section as SectionCode, effect: effect! })) };
  const preview = useQuery({ queryKey: ["access-editor-preview", payload], queryFn: ({ signal }) => accessApi.preview(payload, signal), enabled: !!ids.length, refetchOnWindowFocus: false, retry: false,
    placeholderData: (previous, query) => {
      const old = query?.queryKey[1] as AccessUpdate | undefined;
      return old?.target_type === kind && old.target_ids.join(",") === ids.join(",") ? previous : undefined;
    },
  });
  const save = useMutation({ mutationFn: (draft: AccessUpdate) => accessApi.save(draft), onSuccess: (result, draft) => {
    client.setQueryData<AccessPolicy>(["access-policy"], old => old ? applyAccessDraft(old, draft, result.revision) : old);
    setChanges({}); setRevision(result.revision); setMessage("Права сохранены. Новые настройки уже действуют.");
    void client.invalidateQueries({ queryKey: ["access-editor-preview"] });
    void client.invalidateQueries({ queryKey: ["access-preview"] });
    void client.invalidateQueries({ queryKey: ["my-access"] });
  } });
  useEffect(() => { if (!dirty) setRevision(policy.revision); }, [policy.revision, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const locked = dirty || save.isPending;
  function chooseKind(next: TargetType) { if (locked) return; setKind(next); setSelected([]); setMessage(""); save.reset(); setRevision(policy.revision); }
  function chooseSubjects(next: AccessSubject[]) { if (locked) return; setSelected(next); setMessage(""); save.reset(); }
  function update(code: SectionCode, effect: Effect) {
    setChanges(previous => draftEffect(policy, kind, ids, previous, code, effect, preview.data?.sections[code].before_state));
    setMessage(""); save.reset();
  }
  function discard() { setChanges({}); setMessage(""); save.reset(); setRevision(policy.revision); }
  function reload() { discard(); void client.invalidateQueries({ queryKey: ["access-policy"] }); void client.invalidateQueries({ queryKey: ["access-editor-preview"] }); }
  const conflict = [preview.error, save.error].some(error => (error as { status?: number } | null)?.status === 409);
  const ready = !!preview.data && !preview.isFetching && !preview.isError && !conflict;
  const audience = kind === "all" ? "Все сотрудники" : selected.length === 1 ? selected[0].name : `Выбрано: ${selected.length}`;
  const visible = policy.sections.filter(section => `${section.title} ${section.description}`.toLocaleLowerCase("ru").includes(filter.trim().toLocaleLowerCase("ru")));
  const allSections = categories.map(category => ({ ...category, sections: visible.filter(section => category.codes.includes(section.code)) }));
  return <div className="access-layout">
    <aside className="access-audience" aria-label="Получатели доступа"><Card title="1. Кому настроить доступ">
      <div className="access-kind-options">{kinds.map(([key, title]) => <button type="button" key={key} aria-pressed={kind === key} disabled={locked} onClick={() => chooseKind(key)}>{title}</button>)}</div>
      {kind === "all" ? <p className="access-notice">Общее правило для всех текущих и будущих сотрудников. Настройки ролей, групп и личные исключения сохранят приоритет.</p> : kind === "role" ? <div className="access-subject-list">{roleSubjects.map(item => <SubjectOption key={item.id} item={item} checked={ids.includes(item.id)} disabled={locked} onChange={() => chooseSubjects(ids.includes(item.id) ? selected.filter(row => row.id !== item.id) : [...selected, item])} />)}</div> : <SubjectPicker key={kind} kind={kind} selected={selected} onChange={chooseSubjects} disabled={locked} />}
      <div className="access-audience-summary"><strong>{audience}</strong><p>{kind === "role" ? "Можно выбрать несколько ролей." : kind === "group" ? "Настройки применятся ко всем участникам выбранных рабочих групп." : kind === "user" ? "Личные настройки важнее правил роли и группы." : "Профиль и доступ разработчика не изменяются."}</p></div>
      {dirty && <p className="access-draft-note">Получатели закреплены, пока вы не сохраните или не отмените изменения.</p>}
      <Button className="access-jump" disabled={!ids.length} onClick={() => editor.current?.scrollIntoView({ block: "start" })}>Настроить разделы ↓</Button>
    </Card></aside>
    <div className="access-editor" ref={editor}><Card title="2. Какие разделы доступны" subtitle={audience}>
      {!ids.length ? <EmptyState title="Выберите получателей" hint="Можно настроить одну роль, несколько групп или отдельных сотрудников." /> : <>
        <div className="access-editor-toolbar"><label className="field"><span className="field__label">Найти раздел</span><input className="input" type="search" placeholder="Например, обучение" value={filter} onChange={event => setFilter(event.target.value)} /></label><p className="small secondary">Тумблеры готовят изменения.<br />Доступ изменится после сохранения.</p></div>
        {preview.isPending && <Skeleton height={250} />}
        {preview.isError && <ErrorState error={preview.error} onRetry={conflict ? undefined : () => preview.refetch()} />}
        {preview.data && <>
          <p className="access-impact" role="status">{preview.isFetching ? "Пересчитываем доступ…" : preview.data.total ? `В выбранной аудитории аккаунтов: ${preview.data.total}. Учитываются также неактивные аккаунты.` : "В этой аудитории пока нет сотрудников. Правила будут действовать для будущих участников."}</p>
          {!visible.length && <EmptyState title="Раздел не найден" hint="Измените поисковый запрос." />}
          {allSections.filter(category => category.sections.length).map(category => <section className="access-category" key={category.title} aria-label={category.title}><h2>{category.title}</h2><div className="access-rule-list">{category.sections.map(section => {
            const decision = preview.data!.sections[section.code];
            return <article className={`access-rule${changes[section.code] ? " is-changed" : ""}`} key={section.code}>
              <div className="access-rule-description"><div className="access-rule-title"><h3>{section.title}</h3>{changes[section.code] && <Badge tone="accent">Изменено</Badge>}</div><p>{section.description}</p>
                <p className="access-source">{sourceDescription(decision.sources)}</p>
                {section.admin_only && <p className="access-restriction">Только администраторы. Другим ролям открыть нельзя.</p>}
                <AccessImpact decision={decision} total={preview.data!.total} dirty={!!changes[section.code]} />
              </div>
              <div className="access-rule-controls">
                <AccessSwitch title={section.title} state={changes[section.code] === "allow" ? "on" : changes[section.code] === "deny" ? "off" : decision.state} disabled={save.isPending || !ready || decision.locked} onChange={enabled => update(section.code, enabled ? "allow" : "deny")} />
                <button type="button" className="access-inherit" disabled={save.isPending || !ready || !decision.has_override} onClick={() => update(section.code, "inherit")}>Вернуть наследование</button>
                {changes[section.code] && <button type="button" className="access-undo" disabled={save.isPending} onClick={() => setChanges(previous => { const next = { ...previous }; delete next[section.code]; return next; })}>Отменить для раздела</button>}
              </div>
            </article>;
          })}</div></section>)}
        </>}
      </>}
    </Card>
    <section className={`access-save-panel${dirty ? " is-dirty" : ""}`} aria-label="Сохранение прав">
      {dirty ? <><div className="access-save-heading"><strong>Изменений: {Object.keys(changes).length}</strong><span>{audience}</span></div><ul className="access-change-list">{policy.sections.filter(section => changes[section.code]).map(section => <li key={section.code}><span>{section.title}</span><strong>{effectLabels[changes[section.code]!]}</strong></li>)}</ul></> : <p className="secondary">Все изменения сохранены. Переключите доступ у нужного раздела.</p>}
      {save.isError && <ErrorState error={save.error} />}
      {conflict && <Button disabled={save.isPending} onClick={reload}>Загрузить актуальные правила и сбросить черновик</Button>}
      {message && <p className="access-saved" role="status">{message}</p>}
      <div className="access-actions"><Button variant="primary" disabled={!dirty || !ids.length || save.isPending || !ready} onClick={() => save.mutate(payload)}>{save.isPending ? "Сохраняем…" : "Сохранить изменения"}</Button><Button disabled={!dirty || save.isPending} onClick={discard}>Отменить изменения</Button></div>
    </section></div>
  </div>;
}

function AccessImpact({ decision, total, dirty }: { decision: AccessPreviewSection; total: number; dirty: boolean }) {
  return <div className="access-rule-impact">{total > 0 && <p>{dirty ? `Доступ сейчас: ${decision.before_allowed} из ${total} → после сохранения: ${decision.after_allowed} из ${total}. Изменится у ${decision.changed} аккаунтов.` : `Доступ открыт: ${decision.after_allowed} из ${total}.`}</p>}{decision.exceptions > 0 && <p>Более точные правила сохранятся у {decision.exceptions} аккаунтов. Для изменения выберите этих сотрудников или их группы.</p>}{decision.state === "mixed" && <p>У выбранных получателей разные настройки. Включение откроет раздел на выбранном уровне; выключение закроет его.</p>}</div>;
}

function SubjectOption({ item, checked, disabled, onChange }: { item: AccessSubject; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <label className={`access-check${checked ? " is-selected" : ""}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} /><span><strong>{item.name}</strong>{item.id !== item.role && <span className="small secondary block">{item.role ? `${ROLE_LABELS[item.role]} · ` : ""}ID {item.id}{!item.is_active ? " · неактивен" : ""}</span>}</span></label>;
}

function SubjectPicker({ kind, selected, onChange, disabled }: { kind: "user" | "group"; selected: AccessSubject[]; onChange: (value: AccessSubject[]) => void; disabled: boolean }) {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const data = useQuery({ queryKey: ["access-subjects", kind, search, page], queryFn: ({ signal }) => accessApi.subjects(kind, search, page, signal) });
  const toggle = (item: AccessSubject) => onChange(selected.some(row => row.id === item.id) ? selected.filter(row => row.id !== item.id) : [...selected, item]);
  return <div className="stack stack--tight">
    <label className="field"><span className="field__label">{kind === "user" ? "Поиск сотрудников" : "Поиск групп"}</span><input className="input" type="search" placeholder={kind === "user" ? "Имя сотрудника" : "Название группы"} value={search} maxLength={150} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {!!selected.length && <div className="access-selection" aria-label="Выбранные получатели">{selected.map(item => <Button key={item.id} size="s" disabled={disabled} onClick={() => toggle(item)} aria-label={`Убрать: ${item.name}`}>{item.name} ×</Button>)}</div>}
    {data.isPending && <Skeleton height={120} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {data.data?.total === 0 && <EmptyState title="Ничего не найдено" hint="Попробуйте другое имя." />}
    {data.data && <><div className="access-subject-list">{data.data.items.map(item => <SubjectOption key={item.id} item={item} checked={selected.some(row => row.id === item.id)} disabled={disabled || (selected.length >= 200 && !selected.some(row => row.id === item.id))} onChange={() => toggle(item)} />)}</div><Pagination page={page} size={20} total={data.data.total} onChange={setPage} /></>}
    <p className="micro secondary">Выбрано: {selected.length} из 200. Выбор сохраняется при поиске и смене страницы.</p>
  </div>;
}
