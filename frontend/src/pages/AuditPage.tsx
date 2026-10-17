import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { systemApi, type AuditEntry } from "../api/system";
import { useAuth } from "../auth/AuthContext";
import { DateRangePicker } from "../components/DateRangePicker";
import { GlassSurface } from "../components/GlassSurface";
import { validDateRange } from "../components/dateRange";
import { Avatar, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton, Select } from "../components/ui";
import { parseTimestamp, plural } from "../utils/format";
import { AUDIT_GROUPS, auditActionLabel, auditActionsOf, auditBusinessChanges, auditDay, auditEntityLabel, auditSummary } from "./auditPresentation";
import "./workflow.css";
import "./audit.css";

export function AuditChanges({ entry, developer }: { entry: AuditEntry; developer: boolean }) {
  const changes = auditBusinessChanges(entry.changes);
  return <>
    {entry.comment && <p className="workflow-note">{entry.comment}</p>}
    {changes.length ? <dl>{changes.map((item, index) => <div className="workflow-result" key={index}><dt>{item.label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{item.value}</dd></div>)}</dl> : <p className="secondary">{entry.changes && Object.keys(entry.changes).length ? "Изменения сохранены." : "Событие зарегистрировано без изменения полей."}</p>}
    {developer && <details className="workflow-note"><summary>Технические сведения</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(entry, null, 2)}</pre></details>}
  </>;
}

const time = (iso: string) => parseTimestamp(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
/** One person, one avatar colour: the colour comes from the name, not from the event. */
const tint = (name: string) => [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);

export function AuditPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<number[]>([]);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const group = AUDIT_GROUPS.some(item => item.key === params.get("group")) ? params.get("group")! : "";
  const actions = auditActionsOf(group);
  const action = actions.some(([key]) => key === params.get("action")) ? params.get("action")! : "";
  const actor = params.get("actor") ?? "";
  const [typed, setTyped] = useState(actor);
  // A single day from an older link opens as a one-day period.
  const day = params.get("date") ?? "";
  const chosen = { date_from: params.get("from") ?? day, date_to: params.get("to") ?? day };
  const period = validDateRange(chosen) ? chosen : undefined;
  const filter = (values: Record<string, string>) => {
    const next: Record<string, string> = { group, action, actor, ...(period ? { from: period.date_from, to: period.date_to } : {}), ...values };
    setOpen([]);
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };
  // The name is looked up once typing pauses, not on every letter.
  useEffect(() => {
    const value = typed.trim();
    if (value === actor) return;
    const timer = window.setTimeout(() => filter({ actor: value, page: "" }), 350);
    return () => window.clearTimeout(timer);
  });
  const prefixes = AUDIT_GROUPS.find(item => item.key === group)?.prefixes;
  const entries = useQuery({ queryKey: ["audit", page, group, action, actor, period?.date_from, period?.date_to], queryFn: () => systemApi.audit({ page, size: 25, action, actor, prefix: prefixes,
    date_from: period ? `${period.date_from}T00:00:00` : undefined, date_to: period ? `${period.date_to}T23:59:59.999` : undefined }) });
  const filtered = Boolean(group || action || actor || period);
  const total = entries.data?.total ?? 0;
  const days: { title: string; items: AuditEntry[] }[] = [];
  for (const entry of entries.data?.items ?? []) {
    const title = auditDay(entry.created_at);
    if (days.at(-1)?.title === title) days.at(-1)!.items.push(entry); else days.push({ title, items: [entry] });
  }
  const developer = user?.is_developer === true;
  return <div className="stack audit-page">
    <div className="page-head"><div><h1 className="page-title">Журнал аудита</h1><p className="page-subtitle">{entries.data ? `${total} ${plural(total, "событие", "события", "событий")}${filtered ? " по выбранным фильтрам" : ""} · кто и когда менял данные Puls` : "Кто и когда менял данные Puls"}</p></div></div>
    <GlassSurface variant="regular" className="team-filterbar audit-filterbar">
      <label className="field team-search"><span className="field__label">Сотрудник</span><input className="input" type="search" placeholder="Имя или логин" value={typed} maxLength={150} onChange={event => setTyped(event.target.value)} /></label>
      <label className="field"><span className="field__label">Раздел</span><Select aria-label="Раздел" value={group} options={[{ value: "", label: "Все разделы" }, ...AUDIT_GROUPS.map(item => ({ value: item.key, label: item.label }))]} onChange={value => filter({ group: value, action: "", page: "" })} /></label>
      <label className="field"><span className="field__label">Действие</span><Select aria-label="Действие" value={action} options={[{ value: "", label: "Все действия" }, ...actions.map(([key, label]) => ({ value: key, label }))]} onChange={value => filter({ action: value, page: "" })} /></label>
      <div className="field audit-filterbar__period"><span className="field__label">Период</span><DateRangePicker ariaLabel="Период событий" value={period} onChange={next => filter({ from: next.date_from, to: next.date_to, page: "" })} /></div>
      {filtered && <Button className="audit-filterbar__reset" variant="plain" size="s" onClick={() => { setTyped(""); setOpen([]); setParams({}); }}>Сбросить фильтры</Button>}
    </GlassSurface>
    <Card className="audit-list" padded={false} title="События" subtitle={entries.data && total > 0 ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} из ${total}, сначала новые` : undefined}>
      {entries.isLoading && <div className="card__body"><RowsSkeleton /></div>}
      {entries.isError && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
      {entries.data?.items.length === 0 && <EmptyState title="События не найдены" hint={filtered ? "Попробуйте изменить фильтры." : "Журнал пока пуст."} action={filtered ? <Button onClick={() => { setTyped(""); setParams({}); }}>Сбросить фильтры</Button> : undefined} />}
      {days.map(dayGroup => <section key={dayGroup.title} className="audit-day" aria-label={dayGroup.title}>
        <h3 className="audit-day__title">{dayGroup.title}</h3>
        <ol className="audit-events">{dayGroup.items.map(entry => {
          const summary = auditSummary(entry.changes);
          const detailed = Boolean(entry.comment || auditBusinessChanges(entry.changes).length > 2 || (!summary && entry.changes && Object.keys(entry.changes).length) || developer);
          const expanded = open.includes(entry.id);
          return <li key={entry.id} className={`audit-event${expanded ? " is-open" : ""}`}>
            <time className="audit-event__time" dateTime={parseTimestamp(entry.created_at).toISOString()}>{time(entry.created_at)}</time>
            <Avatar name={entry.actor_name ?? "Система"} id={tint(entry.actor_name ?? "Система")} size={32} photo={false} />
            <div className="audit-event__main">
              <p className="audit-event__title"><strong>{auditActionLabel(entry.action)}</strong><span>{auditEntityLabel(entry.entity_type)}</span></p>
              <p className="audit-event__meta"><span className="audit-event__time-inline">{time(entry.created_at)} · </span>{entry.actor_name ?? "Система"}{entry.ip_address ? ` · IP ${entry.ip_address}` : ""}</p>
              {summary && <p className="audit-event__summary">{summary}</p>}
              {expanded && <div className="audit-event__details"><AuditChanges entry={entry} developer={developer} /></div>}
            </div>
            {detailed && <Button size="s" variant="plain" className="audit-event__toggle" aria-expanded={expanded} onClick={() => setOpen(list => expanded ? list.filter(id => id !== entry.id) : [...list, entry.id])}>{expanded ? "Скрыть" : "Подробнее"}</Button>}
          </li>;
        })}</ol>
      </section>)}
      {entries.data && <div className="audit-pagination"><Pagination page={page} size={25} total={total} onChange={next => filter({ page: String(next) })} /></div>}
    </Card>
  </div>;
}
