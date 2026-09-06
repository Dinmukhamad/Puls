import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { configuration, configurationError, type Definition, type DefinitionInput, type DefinitionKind, type FieldValue, type Rules } from "../api/configuration";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton } from "../components/ui";
import { coins, points } from "../utils/format";
import "./configuration.css";

type Option = { value: string; label: string };
type FieldSpec = { key: string; label: string; type?: "number" | "textarea" | "boolean" | "select"; hint?: string; required?: boolean; min?: number; step?: number | "any"; maxLength?: number; options?: Option[] };
const directions: Option[] = [{ value: "higher_is_better", label: "Больше — лучше" }, { value: "lower_is_better", label: "Меньше — лучше" }];
const badgeRules: Option[] = [
  { value: "top_rank", label: "Место в рейтинге" },
  { value: "zero_metric_streak", label: "Серия недель без нарушений" },
  { value: "metric_threshold_streak", label: "Серия недель выше порога" },
  { value: "metric_total", label: "Накопленное значение показателя" },
  { value: "total_earned", label: "Всего заработано коинов" },
  { value: "nomination_count", label: "Количество номинаций" },
];
const sectionTitles: Record<DefinitionKind, string> = { metrics: "Показатели", nominations: "Номинации", badges: "Достижения" };
const createTitles: Record<DefinitionKind, string> = { metrics: "Добавить показатель", nominations: "Добавить номинацию", badges: "Добавить достижение" };
const commonFields: FieldSpec[] = [
  { key: "title", label: "Название", required: true, maxLength: 255 },
  { key: "description", label: "Описание", type: "textarea", maxLength: 5000 },
];
const finalFields: FieldSpec[] = [
  { key: "sort_order", label: "Порядок отображения", type: "number", required: true, step: 1, hint: "Меньшее число показывается выше." },
  { key: "is_active", label: "Активно", type: "boolean", hint: "Неактивные записи сохраняются в истории и не участвуют в новых расчётах." },
];

export function SettingsPage() {
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const selected = params.get("tab");
  const tab = selected && ["metrics", "nominations", "badges"].includes(selected) ? selected as DefinitionKind : "rules";
  return <div className="stack configuration-page">
    <div className="page-head"><div><h1 className="page-title">Настройки</h1><p className="page-subtitle">Правила начисления, показатели и условия достижений</p></div></div>
    <nav className="configuration-nav" aria-label="Разделы настроек">{[["rules", "Правила"], ["metrics", "Показатели"], ["nominations", "Номинации"], ["badges", "Достижения"]].filter(([key]) => can(key === "badges" ? "motivation" : "performance")).map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} aria-current={tab === key ? "page" : undefined} onClick={() => setParams({ tab: key })}>{label}</Button>)}</nav>
    {tab === "rules" ? <RulesSection /> : <DefinitionSection key={tab} kind={tab} />}
  </div>;
}

function RulesSection() {
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules, refetchOnWindowFocus: false });
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics") });
  if (rules.isLoading || metrics.isLoading) return <RowsSkeleton />;
  if (rules.isError || metrics.isError) return <ErrorState error={new Error(configurationError(rules.error ?? metrics.error))} onRetry={() => { void rules.refetch(); void metrics.refetch(); }} />;
  if (!rules.data || !metrics.data) return null;
  return <RulesEditor initial={rules.data} metrics={metrics.data} key={JSON.stringify(rules.data)} />;
}

const ruleGroups: { title: string; subtitle: string; fields: FieldSpec[] }[] = [
  { title: "Баллы и коины", subtitle: "Баллы конкурса переводятся в коины после закрытия периода", fields: [
    { key: "points_per_coin", label: "Баллов за 1 коин", type: "number", required: true, min: .000001, step: "any" },
    { key: "rank1_bonus", label: "Бонус за 1 место", type: "number", required: true, min: 0 },
    { key: "rank2_bonus", label: "Бонус за 2 место", type: "number", required: true, min: 0 },
    { key: "rank3_bonus", label: "Бонус за 3 место", type: "number", required: true, min: 0 },
  ] },
  { title: "Бонусы", subtitle: "Дополнительные начисления в коинах", fields: [
    { key: "no_lateness_bonus", label: "Неделя без опозданий", type: "number", required: true, min: 0 },
    { key: "no_forbidden_sites_bonus", label: "Без посторонних сайтов", type: "number", required: true, min: 0 },
    { key: "nomination_bonus_default", label: "Бонус номинации по умолчанию", type: "number", required: true, min: 0 },
    { key: "driver_gratitude_bonus", label: "Благодарность водителя", type: "number", required: true, min: 0 },
    { key: "nomination_min_participants", label: "Минимум участников для номинаций", type: "number", required: true, min: 0 },
  ] },
  { title: "Ручные операции", subtitle: "Ограничения для начислений и списаний сотрудниками", fields: [
    { key: "manual_max_abs_amount", label: "Максимум коинов за одну операцию", type: "number", required: true, min: 1 },
    { key: "manual_reason_min_length", label: "Минимальная длина комментария", type: "number", required: true, min: 0, hint: "Число символов. Причина операции остаётся обязательной." },
  ] },
];

function RulesEditor({ initial, metrics }: { initial: Rules; metrics: Definition[] }) {
  const { atLeast } = useAuth(); const editable = atLeast("head");
  const [values, setValues] = useState<DefinitionInput>({ ...initial });
  const [sample, setSample] = useState("100");
  const toast = useToast(); const client = useQueryClient();
  const save = useMutation({ mutationFn: () => {
    const data = { ...values };
    ruleGroups.flatMap((g) => g.fields).forEach((f) => { data[f.key] = Number(data[f.key]); });
    return configuration.updateRules(data as unknown as Rules);
  }, onSuccess: (data) => { client.setQueryData(["configuration-rules"], data); void client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Правила сохранены"); } });
  const field = (spec: FieldSpec) => <ConfigurationField key={spec.key} spec={spec} value={values[spec.key]} disabled={!editable || save.isPending} onChange={(value) => setValues((current) => ({ ...current, [spec.key]: value }))} />;
  const metricOptions = metrics.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` }));
  const rate = Number(values.points_per_coin);
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <form className="stack" onSubmit={submit}>
    <p className="configuration-note">Изменения применяются к следующим расчётам. Опубликованные итоги и начисленные коины сохраняются.</p>
    {!editable && <p className="configuration-note">Просмотр настроек. Изменять правила могут руководитель и администратор.</p>}
    {ruleGroups.map((group) => <Card key={group.title} title={group.title} subtitle={group.subtitle}><div className="configuration-form-grid">{group.fields.map(field)}</div></Card>)}
    <Card title="Дисциплина и видимость"><div className="configuration-form-grid">
      {field({ key: "lateness_metric_code", label: "Показатель опозданий", type: "select", options: metricOptions, required: true })}
      {field({ key: "forbidden_sites_metric_code", label: "Показатель посторонних сайтов", type: "select", options: metricOptions, required: true })}
    </div><div className="configuration-toggles">
      {field({ key: "discipline_requires_reported", label: "Бонус за дисциплину только при загруженных данных", type: "boolean", hint: "Если выключить, отсутствие отчёта о нарушениях разрешает бонус." })}
      {field({ key: "rating_show_balance_to_operators", label: "Показывать операторам баланс коллег в рейтинге", type: "boolean", hint: "Индивидуальная история операций остаётся доступна по правам." })}
    </div></Card>
    <Card title="Проверка курса" subtitle="Предварительный пример без дополнительных бонусов"><div className="configuration-example"><label className="field"><span className="field__label">Баллы конкурса</span><input className="input" type="number" min={0} step="any" value={sample} onChange={(e) => setSample(e.target.value)} /></label><span className="configuration-example__result">{Number.isFinite(rate) && rate > 0 && Number.isFinite(Number(sample)) ? coins(Math.floor(Math.max(0, Number(sample)) / rate)) : "—"} коинов</span></div></Card>
    {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
    {editable && <div className="configuration-save"><p className="muted small">Изменения сохраняются в журнале аудита.</p><Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить правила"}</Button></div>}
  </form>;
}

function DefinitionSection({ kind }: { kind: DefinitionKind }) {
  const { atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<Definition | "new" | null>(null);
  const query = useQuery({ queryKey: ["configuration", kind], queryFn: () => configuration.definitions(kind) });
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "all";
  const items = query.data?.filter((row) => `${row.title} ${row.code}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || row.is_active === (status === "active")));
  return <div className="stack">
    <div className="configuration-section-head"><h2>{sectionTitles[kind]}</h2>{atLeast("head") && <Button variant="primary" onClick={() => setEditor("new")}>{createTitles[kind]}</Button>}</div>
    <div className="configuration-filters"><label className="field configuration-search"><span className="field__label">Поиск</span><input className="input" type="search" value={search} placeholder="Название или код" onChange={(e) => setParams({ tab: kind, search: e.target.value, status }, { replace: true })} /></label><label className="field"><span className="field__label">Статус</span><select className="input" value={status} onChange={(e) => setParams({ tab: kind, search, status: e.target.value })}><option value="all">Все</option><option value="active">Активные</option><option value="archived">Неактивные</option></select></label></div>
    {query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={new Error(configurationError(query.error))} onRetry={() => query.refetch()} />}
    {items?.length === 0 && <EmptyState title="Записи не найдены" hint="Измените фильтры или добавьте новую запись." />}
    <div className="configuration-cards">{items?.map((row) => <Card key={row.id} title={row.title} subtitle={row.code} className="configuration-item" action={<Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Активно" : "Неактивно"}</Badge>}>
      {row.description && <p className="configuration-description">{row.description}</p>}
      <p className="configuration-rule-summary">{definitionSummary(kind, row)}</p>
      {atLeast("head") && <div className="configuration-actions"><Button onClick={() => setEditor(row)}>Изменить</Button></div>}
    </Card>)}</div>
    {editor && <DefinitionEditor kind={kind} target={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
  </div>;
}

function definitionSummary(kind: DefinitionKind, row: Definition) {
  if (kind === "metrics") return row.kind === "anti" ? `Антипоказатель · ${points(Number(row.penalty_per_unit))} штрафных баллов за единицу` : `Цель: ${points(Number(row.target_value))} ${row.unit ?? ""} · ${points(Number(row.max_points))} баллов · ${row.direction === "lower_is_better" ? "Меньше — лучше" : "Больше — лучше"}`;
  if (kind === "nominations") return `${coins(Number(row.coins_reward))} коинов · ${row.require_zero ? "При отсутствии нарушений" : row.direction === "lower_is_better" ? "За минимальный результат" : "За максимальный результат"}`;
  const params = typeof row.rule_params === "object" && row.rule_params ? row.rule_params : {};
  const rule = String(row.rule_type);
  if (rule === "top_rank") return `Войти в топ-${params.max_rank ?? 3} рейтинга`;
  if (rule === "zero_metric_streak") return `${params.weeks ?? 3} недель подряд без нарушений`;
  if (rule === "metric_threshold_streak") return `Не ниже ${params.gte ?? 0} · ${params.weeks ?? 1} недель подряд`;
  if (rule === "total_earned") return `Заработать ${coins(Number(params.gte ?? 100))} коинов за всё время`;
  if (rule === "nomination_count") return `Получить ${params.gte ?? 1} номинаций`;
  return `Накопить ${params.gte ?? 1} по выбранному показателю`;
}

function defaultDefinition(kind: DefinitionKind): DefinitionInput {
  const common = { code: "", title: "", description: "", is_active: true, sort_order: 100 };
  if (kind === "metrics") return { ...common, unit: "", kind: "positive", direction: "higher_is_better", target_value: 1, max_points: 20, penalty_per_unit: 0, allow_overachievement: false };
  if (kind === "nominations") return { ...common, metric_code: "", direction: "higher_is_better", require_zero: false, min_value: null, coins_reward: 5 };
  return { ...common, icon: "", rule_type: "top_rank", rule_params: { max_rank: 3 }, is_repeatable: false };
}

function DefinitionEditor({ kind, target, onClose }: { kind: DefinitionKind; target?: Definition; onClose: () => void }) {
  const [values, setValues] = useState<DefinitionInput>(target ? { ...target } : defaultDefinition(kind));
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: kind !== "metrics" });
  const client = useQueryClient(); const toast = useToast();
  const options = metrics.data?.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` })) ?? [];
  const fields: FieldSpec[] = [...commonFields];
  if (kind === "metrics") fields.push(
    { key: "unit", label: "Единица измерения", maxLength: 32, hint: "Например %, мин или шт." },
    { key: "kind", label: "Тип показателя", type: "select", options: [{ value: "positive", label: "Положительный показатель" }, { value: "anti", label: "Антипоказатель (штраф)" }] },
    { key: "direction", label: "Какой результат лучше", type: "select", options: directions },
    { key: "target_value", label: "Целевое значение", type: "number", required: true, min: values.kind === "positive" ? .000001 : 0, step: "any" },
    { key: "max_points", label: "Баллы за выполнение цели", type: "number", required: true, min: 0, step: "any" },
    { key: "penalty_per_unit", label: "Штраф за единицу антипоказателя", type: "number", required: true, min: 0, step: "any" },
    { key: "allow_overachievement", label: "Разрешить баллы за перевыполнение", type: "boolean", hint: "Положительный показатель может дать больше целевого количества баллов." },
  );
  if (kind === "nominations") fields.push(
    { key: "metric_code", label: "Показатель для выбора победителя", type: "select", required: true, options: [...options, { value: "__progress__", label: "Прирост баллов к прошлой неделе" }] },
    { key: "direction", label: "Выбирать результат", type: "select", options: directions },
    { key: "require_zero", label: "Требовать нулевое значение", type: "boolean", hint: "Например, отсутствие опозданий." },
    { key: "min_value", label: "Минимальное значение для участия", type: "number", step: "any", hint: "Пусто — без минимального порога." },
    { key: "coins_reward", label: "Награда в коинах", type: "number", min: 0, required: true },
  );
  if (kind === "badges") fields.push(
    { key: "icon", label: "Значок", maxLength: 64, hint: "Короткое обозначение или эмодзи, например 🏆." },
    { key: "rule_type", label: "Условие получения", type: "select", options: badgeRules },
    { key: "is_repeatable", label: "Можно получать повторно", type: "boolean" },
  );
  fields.push(...finalFields);
  const rawParams = values.rule_params;
  const ruleParams = typeof rawParams === "object" && rawParams ? rawParams : {};
  const rule = String(values.rule_type ?? "");
  const badgeFields: FieldSpec[] = [];
  if (kind === "badges") {
    if (["zero_metric_streak", "metric_threshold_streak", "metric_total"].includes(rule)) badgeFields.push({ key: "metric", label: "Показатель достижения", type: "select", required: true, options });
    if (rule === "top_rank") badgeFields.push({ key: "max_rank", label: "Место не ниже", type: "number", required: true, min: 1 });
    if (["zero_metric_streak", "metric_threshold_streak"].includes(rule)) badgeFields.push({ key: "weeks", label: "Недель подряд", type: "number", required: true, min: 1 });
    if (["metric_threshold_streak", "metric_total", "total_earned", "nomination_count"].includes(rule)) badgeFields.push({ key: "gte", label: rule === "total_earned" ? "Заработать коинов" : rule === "nomination_count" ? "Получить номинаций" : "Значение не ниже", type: "number", required: true, min: .000001, step: ["nomination_count", "total_earned"].includes(rule) ? 1 : "any" });
  }
  const save = useMutation({ mutationFn: () => {
    const data = { ...values }; delete data.id;
    if (target) delete data.code;
    fields.forEach((field) => {
      if (field.type === "number") data[field.key] = data[field.key] === "" || data[field.key] == null ? null : Number(data[field.key]);
      if (["description", "unit", "icon"].includes(field.key) && !data[field.key]) data[field.key] = null;
    });
    if (kind === "badges") {
      const params: Record<string, string | number> = {};
      badgeFields.forEach((f) => { params[f.key] = f.type === "number" ? Number(ruleParams[f.key] ?? badgeDefault(f.key, rule)) : String(ruleParams[f.key] ?? ""); });
      data.rule_params = params;
    }
    return configuration.saveDefinition(kind, data, target?.id);
  }, onSuccess: () => {
    void client.invalidateQueries({ queryKey: ["configuration", kind] });
    void client.invalidateQueries({ queryKey: ["dashboard"] });
    void client.invalidateQueries({ queryKey: ["badges"] });
    void client.invalidateQueries({ queryKey: ["metrics"] });
    toast.success("Настройки сохранены"); onClose();
  } });
  function change(key: string, value: FieldValue) {
    setValues((current) => {
      if (key === "rule_type") return { ...current, rule_type: value, rule_params: {} };
      return { ...current, [key]: value };
    });
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Sheet title={target ? `Изменить: ${target.title}` : createTitles[kind]} size="l" onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button type="submit" form="configuration-definition" variant="primary" disabled={save.isPending || (kind !== "metrics" && !metrics.isSuccess)}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="configuration-definition" className="stack" onSubmit={submit}>
      {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
      {metrics.isError && <ErrorState error={new Error(configurationError(metrics.error))} onRetry={() => metrics.refetch()} />}
      <ConfigurationField spec={{ key: "code", label: "Постоянный код", required: true, maxLength: 64 }} value={values.code} disabled={!!target || save.isPending} onChange={(v) => change("code", v)} />
      {fields.map((spec) => <ConfigurationField key={spec.key} spec={spec} value={values[spec.key]} disabled={save.isPending} onChange={(v) => change(spec.key, v)} />)}
      {kind === "badges" && <fieldset className="configuration-condition"><legend>Условия достижения</legend><div className="configuration-form-grid">{badgeFields.map((spec) => <ConfigurationField key={`${rule}-${spec.key}`} spec={spec} value={ruleParams[spec.key] ?? badgeDefault(spec.key, rule)} disabled={save.isPending} onChange={(v) => setValues((current) => ({ ...current, rule_params: { ...ruleParams, [spec.key]: typeof v === "number" ? v : String(v ?? "") } }))} />)}</div></fieldset>}
    </form>
  </Sheet>;
}

function badgeDefault(key: string, rule: string): string | number {
  if (key === "metric") return "";
  if (key === "max_rank") return 3;
  if (key === "weeks") return rule === "zero_metric_streak" ? 3 : 1;
  return rule === "total_earned" ? 100 : 1;
}

function ConfigurationField({ spec, value, disabled, onChange }: { spec: FieldSpec; value: FieldValue | undefined; disabled?: boolean; onChange: (value: FieldValue) => void }) {
  if (spec.type === "boolean") return <label className="configuration-toggle"><input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span><strong>{spec.label}</strong>{spec.hint && <span>{spec.hint}</span>}</span></label>;
  return <label className="field"><span className="field__label">{spec.label}</span>
    {spec.type === "select" ? <select className="input" value={String(value ?? "")} disabled={disabled} required={spec.required} onChange={(e) => onChange(e.target.value)}><option value="" disabled>Выберите значение</option>{spec.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : spec.type === "textarea" ? <textarea className="input" rows={3} value={String(value ?? "")} disabled={disabled} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />
      : <input className="input" type={spec.type === "number" ? "number" : "text"} value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />}
    {spec.hint && <span className="muted micro">{spec.hint}</span>}
  </label>;
}
