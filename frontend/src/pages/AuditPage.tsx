import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { systemApi, type AuditEntry } from "../api/system";
import { useAuth } from "../auth/AuthContext";
import { DateRangePicker } from "../components/DateRangePicker";
import { Sheet } from "../components/Sheet";
import { validDateRange } from "../components/dateRange";
import { Button, Card, EmptyState, ErrorState, Pagination, Select, Skeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import { AUDIT_ACTIONS, auditActionLabel, auditBusinessChanges, auditEntityLabel } from "./auditPresentation";
import "./workflow.css";

export function AuditChanges({ entry, developer }: { entry: AuditEntry; developer: boolean }) {
  const changes = auditBusinessChanges(entry.changes);
  return <>
    {entry.comment && <p className="workflow-note">{entry.comment}</p>}
    {changes.length ? <dl>{changes.map((item, index) => <div className="workflow-result" key={index}><dt>{item.label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{item.value}</dd></div>)}</dl> : <p className="secondary">{entry.changes && Object.keys(entry.changes).length ? "Изменения сохранены." : "Событие зарегистрировано без изменения полей."}</p>}
    {developer && <details className="workflow-note"><summary>Технические сведения</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(entry, null, 2)}</pre></details>}
  </>;
}
export function AuditPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const action = params.get("action") ?? "";
  // A single day from an older link opens as a one-day period.
  const day = params.get("date") ?? "";
  const chosen = { date_from: params.get("from") ?? day, date_to: params.get("to") ?? day };
  const period = validDateRange(chosen) ? chosen : undefined;
  const filter = (values: Record<string, string>) => {
    const next: Record<string, string> = { action, ...(period ? { from: period.date_from, to: period.date_to } : {}), ...values };
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };
  const entries = useQuery({ queryKey: ["audit", page, action, period?.date_from, period?.date_to], queryFn: () => systemApi.audit({ page, size: 25, action,
    date_from: period ? `${period.date_from}T00:00:00` : undefined, date_to: period ? `${period.date_to}T23:59:59.999` : undefined }) });
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Аудит</h1><p className="page-subtitle">Кто и когда изменял данные Puls</p></div></div>
    <Card><div className="workflow-toolbar"><label className="field"><span className="field__label">Действие</span><Select aria-label="Действие" value={action} options={[{ value: "", label: "Все действия" }, ...Object.entries(AUDIT_ACTIONS).map(([key, label]) => ({ value: key, label }))]} onChange={(value) => filter({ action: value })} /></label><div className="field"><span className="field__label">Период</span><DateRangePicker ariaLabel="Период событий" value={period} onChange={(next) => filter({ from: next.date_from, to: next.date_to })} /></div><Button disabled={!action && !period} onClick={() => setParams({})}>Сбросить</Button></div></Card>
    {entries.isLoading && <Skeleton height={240} />}{entries.isError && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
    {entries.data?.items.length === 0 && <EmptyState title="События не найдены" hint="Попробуйте изменить фильтры" />}
    <Card title="События"><div className="workflow-results">{entries.data?.items.map((entry) => <article className="workflow-result" key={entry.id}><div><strong>{auditActionLabel(entry.action)}</strong><p className="small secondary">{entry.actor_name ?? "Система"} · {dateTime(entry.created_at)}</p><p className="small secondary">{auditEntityLabel(entry.entity_type)}</p></div><Button size="s" onClick={() => setSelected(entry)}>Изменения</Button></article>)}</div>{entries.data && <Pagination page={page} size={25} total={entries.data.total} onChange={(p) => filter({ page: String(p) })} />}</Card>
    {selected && <Sheet title={auditActionLabel(selected.action)} subtitle={`${selected.actor_name ?? "Система"} · ${dateTime(selected.created_at)}`} onClose={() => setSelected(null)}>
      <AuditChanges entry={selected} developer={user?.is_developer === true} />
    </Sheet>}
  </div>;
}
