import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { systemApi, type AuditEntry } from "../api/system";
import { Sheet } from "../components/Sheet";
import { Button, Card, EmptyState, ErrorState, Pagination, Skeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import "./workflow.css";

const actions: Record<string, string> = {
  "auth.login": "Вход в систему", "auth.logout": "Выход из системы",
  "user.create": "Создан сотрудник", "user.update": "Изменён сотрудник",
  "user.password_reset": "Сброшен пароль", "user.password_change": "Изменён пароль",
  "group.create": "Создана группа", "group.update": "Изменена группа",
  "week.create": "Открыта неделя", "week.metrics_upload": "Загружены показатели",
  "week.recalculate": "Подготовлен расчёт", "week.close": "Опубликованы итоги",
  "week.close_previous": "Закрыта прошлая неделя", "session.revoke": "Завершён сеанс",
  "session.revoke_others": "Завершены остальные сеансы",
};
const fields: Record<string, string> = {
  before: "Было", after: "Стало", full_name: "ФИО", group_id: "Группа", role: "Роль",
  is_active: "Активен", email: "Email", hired_on: "Дата приёма", supervisor_id: "Супервайзер",
  name: "Название", code: "Код", login: "Логин", created: "Создано значений", updated: "Обновлено значений",
  replace: "Замена показателей", participants: "Участников", coins_awarded: "Начислено коинов",
  amount: "Количество", reason: "Причина", price: "Цена", title: "Название", user_id: "Сотрудник",
};
function valueLabel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.map(valueLabel).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, v]) => `${fields[key] ?? key.replaceAll("_", " ")}: ${valueLabel(v)}`).join("; ");
  const labels: Record<string, string> = { operator: "Оператор", supervisor: "Супервайзер", head: "Руководитель", admin: "Администратор" };
  return labels[String(value)] ?? String(value);
}
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const action = params.get("action") ?? "";
  const date = params.get("date") ?? "";
  const entries = useQuery({ queryKey: ["audit", page, action, date], queryFn: () => systemApi.audit({ page, size: 25, action,
    date_from: date ? `${date}T00:00:00` : undefined, date_to: date ? `${date}T23:59:59.999` : undefined }) });
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Аудит</h1><p className="page-subtitle">Кто и когда изменял данные Puls</p></div></div>
    <Card><div className="workflow-toolbar"><label className="field"><span className="field__label">Действие</span><select className="input" value={action} onChange={(e) => setParams({ action: e.target.value, date })}><option value="">Все действия</option>{Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span className="field__label">Дата</span><input className="input" type="date" value={date} onChange={(e) => setParams({ action, date: e.target.value })} /></label><Button onClick={() => setParams({})}>Сбросить</Button></div></Card>
    {entries.isLoading && <Skeleton height={240} />}{entries.isError && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
    {entries.data?.items.length === 0 && <EmptyState title="События не найдены" hint="Попробуйте изменить фильтры" />}
    <Card title="События"><div className="workflow-results">{entries.data?.items.map((entry) => <article className="workflow-result" key={entry.id}><div><strong>{actions[entry.action] ?? entry.action.replaceAll("_", " ")}</strong><p className="small secondary">{entry.actor_name ?? "Система"} · {dateTime(entry.created_at)}</p><p className="small secondary">{entry.entity_type} {entry.entity_id ? `№${entry.entity_id}` : ""} · IP {entry.ip_address ?? "—"}</p></div><Button size="s" onClick={() => setSelected(entry)}>Изменения</Button></article>)}</div>{entries.data && <Pagination page={page} size={25} total={entries.data.total} onChange={(p) => setParams({ action, date, page: String(p) })} />}</Card>
    {selected && <Sheet title={actions[selected.action] ?? "Подробности события"} subtitle={`${selected.actor_name ?? "Система"} · ${dateTime(selected.created_at)}`} onClose={() => setSelected(null)}>
      {selected.comment && <p className="workflow-note">{selected.comment}</p>}
      {selected.changes && Object.keys(selected.changes).length ? <dl>{Object.entries(selected.changes).map(([key, value]) => <div className="workflow-result" key={key}><dt>{fields[key] ?? key.replaceAll("_", " ")}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{valueLabel(value)}</dd></div>)}</dl> : <p className="secondary">Событие зарегистрировано без изменения полей.</p>}
      <p className="workflow-note">IP: {selected.ip_address ?? "Не записан"}</p>
    </Sheet>}
  </div>;
}
