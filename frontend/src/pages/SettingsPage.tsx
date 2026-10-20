import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { configuration, configurationError, type Definition, type DefinitionInput, type DefinitionKind, type DefinitionValue, type FieldValue, type MetricBand, type Rules } from "../api/configuration";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { ChevronRightIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton, Select } from "../components/ui";
import { visibleNavigation } from "../navigation";
import { coins, plural, points } from "../utils/format";
import { createInternalCode } from "../utils/internalCode";
import { badgeIcon, definitionPresentation, definitionRow } from "./definitionPresentation";
import "./configuration.css";

type Option = { value: string; label: string };
type FieldSpec = { key: string; label: string; type?: "number" | "textarea" | "boolean" | "select"; hint?: string; required?: boolean; min?: number; step?: number | "any"; maxLength?: number; options?: Option[]; unit?: string };
const directions: Option[] = [{ value: "higher_is_better", label: "Больше — лучше" }, { value: "lower_is_better", label: "Меньше — лучше" }];
const badgeRules: Option[] = [
  { value: "learning_count", label: "Пройти разные учебные задания" },
  { value: "top_rank", label: "Место в рейтинге" },
  { value: "zero_metric_streak", label: "Серия недель без нарушений" },
  { value: "metric_threshold_streak", label: "Серия недель выше порога" },
  { value: "metric_total", label: "Накопленное значение показателя" },
  { value: "total_earned", label: "Всего заработано коинов" },
  { value: "nomination_count", label: "Количество номинаций" },
];
const sectionTitles: Record<DefinitionKind, string> = { metrics: "Рабочие показатели", nominations: "Номинации", badges: "Достижения" };
const sectionSubtitles: Record<DefinitionKind, string> = {
  metrics: "Цели, баллы за результат и штрафы за нарушения",
  nominations: "За какие результаты оператор получает дополнительную награду",
  badges: "Условия получения достижений и награды за них",
};
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
  const { can, allowed, isDeveloper } = useAccess();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get("tab");
  const tab = selected && ["metrics", "nominations", "badges"].includes(selected) ? selected as DefinitionKind : "rules";
  const views = [["rules", "Правила расчёта"], ["metrics", "Рабочие показатели"], ["nominations", "Номинации"], ["badges", "Достижения"]].filter(([key]) => can(key === "badges" ? "motivation" : "performance"));
  const destinations = user ? visibleNavigation(user.role, allowed, isDeveloper, user.channel).flatMap((item) => item.tabs.map((link) => link.to)) : [];
  const hasOuterNavigation = views.every(([key]) => destinations.includes(`/admin/settings?tab=${key}`));
  const navigation = !hasOuterNavigation && <nav className="configuration-nav" aria-label="Разделы показателей и наград">{views.map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} aria-current={tab === key ? "page" : undefined} onClick={() => setParams({ tab: key })}>{label}</Button>)}</nav>;
  return <div className={`stack configuration-page${tab !== "rules" ? " configuration-definitions-page" : ""}`}>
    {tab === "rules" ? <><div className="page-head"><div><h1 className="page-title">Правила расчёта</h1><p className="page-subtitle">Перевод баллов в коины, штрафы, бонусы и ограничения начислений</p></div></div>{navigation}<RulesSection /></> : <DefinitionSection key={tab} kind={tab} navigation={navigation} />}
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

const C = "коинов";
/** A new bonus gives 40 % of its main metric's points, as overtime does (docs/CHANNELS.md). */
const BONUS_SHARE = .4;
const ruleGroups: { title: string; subtitle: string; fields: FieldSpec[] }[] = [
  { title: "Баллы и коины", subtitle: "Баллы конкурса переводятся в коины после закрытия периода", fields: [
    { key: "points_per_coin", label: "Баллов за 1 коин", type: "number", required: true, min: .000001, step: "any", unit: "баллов" },
    { key: "rank1_bonus", label: "Бонус за 1 место конкурса", type: "number", required: true, min: 0, unit: C },
    { key: "rank2_bonus", label: "Бонус за 2 место конкурса", type: "number", required: true, min: 0, unit: C },
    { key: "rank3_bonus", label: "Бонус за 3 место конкурса", type: "number", required: true, min: 0, unit: C },
    { key: "prize_min_points", label: "Минимум для приза за место", type: "number", required: true, min: 0, step: "any", unit: "баллов", hint: "Средняя неделя оператора за период. Ниже — место остаётся, приз не платится." },
  ] },
  { title: "Штрафы", subtitle: "Списываются при закрытии недели, после её начислений. Если коинов не хватает, остаток спишется при следующем закрытии", fields: [
    { key: "lateness_fine", label: "За каждое опоздание", type: "number", required: true, min: 0, unit: C },
    { key: "forbidden_site_fine", label: "За каждый посторонний сайт", type: "number", required: true, min: 0, unit: C },
  ] },
  { title: "Бонусы", subtitle: "Дополнительные начисления в коинах", fields: [
    { key: "no_lateness_bonus", label: "Неделя без опозданий", type: "number", required: true, min: 0, unit: C },
    { key: "no_forbidden_sites_bonus", label: "Без посторонних сайтов", type: "number", required: true, min: 0, unit: C },
    { key: "nomination_bonus_default", label: "Бонус номинации по умолчанию", type: "number", required: true, min: 0, unit: C },
    { key: "nomination_min_participants", label: "Минимум участников для номинаций", type: "number", required: true, min: 0, hint: "В каждом направлении: у номинации линии — среди операторов линии.", unit: "чел." },
  ] },
  { title: "Ручные операции", subtitle: "Ограничения для начислений и списаний сотрудниками", fields: [
    { key: "manual_max_abs_amount", label: "Максимум за одну операцию", type: "number", required: true, min: 1, unit: C },
    { key: "manual_reason_min_length", label: "Минимальная длина комментария", type: "number", required: true, min: 0, hint: "Причина операции остаётся обязательной.", unit: "симв." },
    { key: "manual_monthly_limit", label: "Начислений супервайзера в месяц", type: "number", required: true, min: 0, hint: "Сумма ручных начислений всем операторам. 0 — без ограничения. Руководитель не ограничен.", unit: C },
  ] },
  { title: "Магазин", subtitle: "Бонусы с денежной стоимостью продаются, пока не исчерпан бюджет месяца", fields: [
    { key: "coin_rate_tenge", label: "Стоимость 1 коина", type: "number", required: true, min: .01, step: "any", hint: "Для пересчёта цен и отчёта «Экономика месяца»", unit: "₸" },
    { key: "shop_monthly_budget_tenge", label: "Бюджет магазина на месяц", type: "number", required: true, min: 0, hint: "0 — без бюджета", unit: "₸" },
  ] },
];
const ruleNumbers = ruleGroups.flatMap((group) => group.fields).map((field) => field.key);
/** The rules as they would be saved: numbers as numbers, so a retyped «50» is not a change. */
const normalizedRules = (values: DefinitionInput) => JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, ruleNumbers.includes(key) ? Number(value) : value]).sort()));

/**
 * «Правила расчёта» (docs/PERFORMANCE_SECTION.md): the groups side by side, every number with its unit, the course
 * checked right under the rate. The save panel appears with the first change and stays at the bottom of the screen
 * until the rules are saved or the changes are dropped.
 */
function RulesEditor({ initial, metrics }: { initial: Rules; metrics: Definition[] }) {
  const { atLeast } = useAuth(); const editable = atLeast("head");
  const [values, setValues] = useState<DefinitionInput>({ ...initial });
  const [sample, setSample] = useState("100");
  const toast = useToast(); const client = useQueryClient();
  const save = useMutation({ mutationFn: () => {
    const data = { ...values };
    ruleNumbers.forEach((key) => { data[key] = Number(data[key]); });
    return configuration.updateRules(data as unknown as Rules);
  }, onSuccess: (data) => { client.setQueryData(["configuration-rules"], data); void client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Правила сохранены"); } });
  const dirty = normalizedRules(values) !== normalizedRules({ ...initial });
  const field = (spec: FieldSpec) => <ConfigurationField key={spec.key} spec={spec} value={values[spec.key]} disabled={!editable || save.isPending} onChange={(value) => setValues((current) => ({ ...current, [spec.key]: value }))} />;
  const metricOptions = metrics.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` }));
  const rate = Number(values.points_per_coin);
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending && dirty) save.mutate(); }
  return <form className="stack rules-form" onSubmit={submit}>
    {!editable && <p className="configuration-note">Просмотр настроек. Изменять правила могут руководитель и администратор.</p>}
    <div className="rules-grid">
      {ruleGroups.map((group, index) => <Card key={group.title} title={group.title} subtitle={group.subtitle}><div className="configuration-form-grid">{group.fields.map(field)}</div>
        {index === 0 && <div className="configuration-example" aria-label="Проверка курса"><label className="field"><span className="field__label">Пример: баллы конкурса</span><input className="input" type="number" min={0} step="any" value={sample} onChange={(e) => setSample(e.target.value)} /></label><span className="configuration-example__equals" aria-hidden="true">=</span><output className="configuration-example__result" aria-live="polite"><strong>{Number.isFinite(rate) && rate > 0 && Number.isFinite(Number(sample)) ? coins(Math.floor(Math.max(0, Number(sample)) / rate)) : "—"}</strong> коинов</output>{Number.isFinite(rate) && rate > 0 && <span className="configuration-example__rate">Курс: {coins(rate)} {plural(rate, "балл", "балла", "баллов")} = 1 коин, дробная часть отбрасывается. Без бонусов за места и дисциплину.</span>}</div>}
      </Card>)}
      <Card title="Конкурс" subtitle="Баллы, дисциплина и штрафы начисляются каждую неделю"><div className="configuration-form-grid configuration-form-grid--single">
        {field({ key: "contest_period", label: "Места и номинации", type: "select", required: true, options: [{ value: "month", label: "Раз в месяц, среди всех операторов" }, { value: "week", label: "Каждую неделю" }], hint: "Неделя относится к месяцу своего четверга. Месяц закрывается вместе с его последней неделей." })}
      </div></Card>
      <Card title="Дисциплина и видимость"><div className="configuration-form-grid">
        {field({ key: "lateness_metric_code", label: "Показатель опозданий", type: "select", options: metricOptions, required: true })}
        {field({ key: "forbidden_sites_metric_code", label: "Показатель посторонних сайтов", type: "select", options: metricOptions, required: true })}
      </div><div className="configuration-toggles">
        {field({ key: "discipline_requires_reported", label: "Бонус за дисциплину только при загруженных данных", type: "boolean", hint: "Если выключить, отсутствие отчёта о нарушениях разрешает бонус." })}
        {field({ key: "rating_show_balance_to_operators", label: "Показывать операторам баланс коллег в рейтинге", type: "boolean", hint: "Индивидуальная история операций остаётся доступна по правам." })}
      </div></Card>
    </div>
    {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
    {editable && <div className={`configuration-save rules-save${dirty ? " is-dirty" : ""}`} role={dirty ? "region" : undefined} aria-label={dirty ? "Несохранённые изменения" : undefined}>
      <span>{dirty ? "Есть несохранённые изменения. Они применятся к следующим расчётам." : "Изменения применяются к следующим расчётам; опубликованные итоги не меняются. Каждое сохранение попадает в журнал аудита."}</span>
      {dirty && <Button disabled={save.isPending} onClick={() => { setValues({ ...initial }); save.reset(); }}>Отменить</Button>}
      {dirty && <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить правила"}</Button>}
    </div>}
  </form>;
}

function DefinitionSection({ kind, navigation }: { kind: DefinitionKind; navigation: ReactNode }) {
  const { atLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<Definition | "new" | null>(null);
  const [details, setDetails] = useState<Definition | null>(null);
  const query = useQuery({ queryKey: ["configuration", kind], queryFn: () => configuration.definitions(kind) });
  const metricQuery = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: kind !== "metrics" });
  const metrics = kind === "metrics" ? query.data ?? [] : metricQuery.data ?? [];
  const search = params.get("search") ?? "";
  const selectedStatus = params.get("status") ?? "all";
  const status = ["all", "active", "archived"].includes(selectedStatus) ? selectedStatus : "all";
  const items = query.data?.filter((row) => `${row.title} ${row.description ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (status === "all" || row.is_active === (status === "active")));
  return <div className="stack">
    <div className="page-head"><div><h1 className="page-title">{sectionTitles[kind]}</h1><p className="page-subtitle">{sectionSubtitles[kind]}</p></div>{atLeast("head") && <Button variant="primary" onClick={() => setEditor("new")}>{createTitles[kind]}</Button>}</div>
    {navigation}
    <GlassSurface variant="regular" className="configuration-filters"><label className="field configuration-search"><span className="field__label">Поиск</span><input className="input" type="search" value={search} placeholder="Название или описание" onChange={(e) => setParams({ tab: kind, search: e.target.value, status }, { replace: true })} /></label><label className="field"><span className="field__label">Статус</span><Select aria-label="Статус записей" value={status} options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "archived", label: "Неактивные" }]} onChange={(value) => setParams({ tab: kind, search, status: value })} /></label></GlassSurface>
    {query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={new Error(configurationError(query.error))} onRetry={() => query.refetch()} />}
    {items?.length === 0 && <EmptyState title="Записи не найдены" hint="Измените фильтры или добавьте новую запись." />}
    {items && items.length > 0 && groups(kind, items).map(group => <Card key={group.title} title={group.title} subtitle={group.subtitle} padded={false} className="definition-list">
      <ul className="definition-rows">{group.items.map((row) => {
        const line = definitionRow(kind, row, metrics);
        return <li key={row.id}><button type="button" className={`definition-row${row.is_active ? "" : " is-inactive"}`} onClick={() => atLeast("head") ? setEditor(row) : setDetails(row)}
          aria-label={`${atLeast("head") ? "Изменить" : "Подробнее"}: ${row.title}`}>
          {kind === "badges" && <span className="definition-row__icon" aria-hidden="true">{badgeIcon(row.icon)}</span>}
          <span className="definition-row__main"><span className="definition-row__title"><strong>{row.title}</strong>{!row.is_active && <Badge tone="neutral">Неактивно</Badge>}</span><span className="definition-row__meta">{line.meta}</span></span>
          <span className="definition-row__value"><strong className={line.coin ? "is-coin" : undefined}>{line.value}</strong><small>{line.hint}</small></span>
          <ChevronRightIcon size={16} />
        </button></li>;
      })}</ul>
    </Card>)}
    {editor && <DefinitionEditor kind={kind} target={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
    {details && <DefinitionDetails kind={kind} row={details} metrics={metrics} onClose={() => setDetails(null)} onEdit={atLeast("head") ? () => { setDetails(null); setEditor(details); } : undefined} />}
  </div>;
}

/**
 * Metrics fall in lists by channel — the line's results, the chats' results, and the penalties common to both — the rest
 * is one list. Each channel's results add up to 100 points, so a perfect week pays the same coins (docs/CHANNELS.md).
 */
function groups(kind: DefinitionKind, items: Definition[]): { title: string; subtitle: string; items: Definition[] }[] {
  const count = (list: Definition[], one: string, few: string, many: string) => `${list.length} ${plural(list.length, one, few, many)}`;
  if (kind === "metrics") {
    const channelOf = (row: Definition) => String(row.channel || "line");
    const results = (channel: string) => items.filter(row => row.kind !== "anti" && channelOf(row) === channel);
    const active = (channel: string, bonus: boolean) => items.filter(row => row.kind !== "anti" && row.is_active && Boolean(row.bonus_for) === bonus && [channel, "all"].includes(channelOf(row)))
      .reduce((sum, row) => sum + Number(row.max_points || 0), 0);
    const sum = (channel: string) => {
      const value = active(channel, false), bonus = active(channel, true);
      return `${Math.abs(value - 100) < 1e-6 ? "в сумме 100 баллов" : `в сумме ${points(value)} — должно быть 100, чтобы неделя линии и чатов стоила одинаково`}${bonus > 0 ? ` · бонус сверх — до ${points(bonus)}` : ""}`;
    };
    const penalties = items.filter(row => row.kind === "anti");
    return [
      { title: "Линия · рабочие результаты", subtitle: `${count(results("line"), "показатель", "показателя", "показателей")} · ${sum("line")}`, items: results("line") },
      { title: "Чаты · рабочие результаты", subtitle: `${count(results("chat"), "показатель", "показателя", "показателей")} · ${sum("chat")}`, items: results("chat") },
      { title: "Общие рабочие результаты", subtitle: `${count(results("all"), "показатель", "показателя", "показателей")} · входят в баллы линии и чатов`, items: results("all") },
      { title: "Штрафные показатели", subtitle: `${count(penalties, "показатель", "показателя", "показателей")} · снижают итоговый балл до перевода в коины`, items: penalties },
    ].filter(group => group.items.length);
  }
  if (kind === "nominations") {
    // Each one is played among the operators it can describe (docs/CHANNELS.md).
    const among = (channel: string) => items.filter(row => String(row.channel || "all") === channel);
    const subtitle = (list: Definition[], who: string) => `${count(list, "номинация", "номинации", "номинаций")} · ${who}, награда — когда закрываются итоги конкурса`;
    return [
      { title: "Линия", subtitle: subtitle(among("line"), "среди операторов линии"), items: among("line") },
      { title: "Чаты", subtitle: subtitle(among("chat"), "среди операторов чатов"), items: among("chat") },
      { title: "Все операторы", subtitle: subtitle(among("all"), "линия и чаты вместе"), items: among("all") },
    ].filter(group => group.items.length);
  }
  return [{ title: "Достижения", subtitle: `${count(items, "достижение", "достижения", "достижений")} · открываются сами по подтверждённым результатам`, items }];
}

function DefinitionDetails({ kind, row, metrics, onClose, onEdit }: { kind: DefinitionKind; row: Definition; metrics: Definition[]; onClose: () => void; onEdit?: () => void }) {
  const presentation = definitionPresentation(kind, row, metrics);
  return <Sheet title={row.title} subtitle={sectionTitles[kind]} onClose={onClose} footer={<><Button onClick={onClose}>Закрыть</Button>{onEdit && <Button variant="primary" onClick={onEdit}>Изменить</Button>}</>}>
    <div className="stack definition-details"><Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Активно" : "Неактивно"}</Badge><p className="configuration-description">{presentation.description}</p><dl className="definition-details__facts">{presentation.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div>
  </Sheet>;
}

function defaultDefinition(kind: DefinitionKind): DefinitionInput {
  const common = { code: createInternalCode(kind), title: "", description: "", is_active: true, sort_order: 100 };
  if (kind === "metrics") return { ...common, unit: "", kind: "positive", direction: "higher_is_better", target_value: 1, max_points: 20, penalty_per_unit: 0, allow_overachievement: false, channel: "line", bands: null, bonus_for: null, bonus_share: null };
  if (kind === "nominations") return { ...common, metric_code: "", direction: "higher_is_better", require_zero: false, min_value: null, coins_reward: 5, channel: "all" };
  return { ...common, icon: "", rule_type: "top_rank", rule_params: { max_rank: 3 }, coins_reward: 0, is_repeatable: false };
}

function DefinitionEditor({ kind, target, onClose }: { kind: DefinitionKind; target?: Definition; onClose: () => void }) {
  const [values, setValues] = useState<DefinitionInput>(() => {
    const initial = target ? { ...target } : defaultDefinition(kind);
    return kind === "metrics" ? { ...initial, bonus_percent: Math.round(Number(initial.bonus_share || BONUS_SHARE) * 1000) / 10 } : initial;
  });
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics") });
  const client = useQueryClient(); const toast = useToast();
  const options = metrics.data?.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` })) ?? [];
  const fields: FieldSpec[] = [...commonFields];
  const bonus = kind === "metrics" && values.kind === "positive" && Boolean(values.bonus_for);
  const stepped = kind === "metrics" && !bonus && Array.isArray(values.bands);
  // A bonus over the 100 points builds on a metric of its channel that gives points itself (docs/CHANNELS.md).
  const bases = (metrics.data ?? []).filter((m) => m.code !== values.code && m.kind === "positive" && !m.bonus_for && Number(m.max_points) > 0
    && String(m.channel || "line") === String(values.channel || "line"));
  if (kind === "metrics") fields.push(
    { key: "channel", label: "Направление", type: "select", options: [{ value: "line", label: "Линия" }, { value: "chat", label: "Чаты" }, { value: "all", label: "Общий для линии и чатов" }], hint: "Линия и чаты соревнуются отдельно, у каждого свои показатели на 100 баллов. Общий — например, дисциплина." },
    { key: "unit", label: "Единица измерения", maxLength: 32, hint: "Например %, мин или шт." },
    { key: "kind", label: "Тип показателя", type: "select", options: [{ value: "positive", label: "Рабочий результат" }, { value: "anti", label: "Штрафной показатель" }] },
    { key: "direction", label: "Какой результат лучше", type: "select", options: directions },
    ...(values.kind === "positive" ? [{ key: "bonus_for", label: "Как даёт баллы", type: "select", options: [{ value: "", label: "Баллы за выполнение цели" }, ...bases.map((m) => ({ value: m.code, label: `Бонус к «${m.title}» сверх 100 баллов` }))], hint: "Бонус — как переработки: платится, только когда основной показатель выполнен на 100 %, и не входит в 100 баллов недели." } as FieldSpec] : []),
    { key: "target_value", label: bonus ? "Значение для всего бонуса" : "Целевое значение", type: "number", required: true, min: values.kind === "positive" ? .000001 : 0, step: "any" },
    ...(bonus ? [{ key: "bonus_percent", label: "Бонус — доля баллов основного показателя", type: "number", required: true, min: 1, step: "any", unit: "%", hint: `Сейчас это до ${points(Number(bases.find((m) => m.code === values.bonus_for)?.max_points ?? 0) * Number(values.bonus_percent || 0) / 100)} баллов; меньше значения — доля бонуса.` } as FieldSpec]
      : stepped ? [] : [{ key: "max_points", label: "Баллы за выполнение цели", type: "number", required: true, min: 0, step: "any", hint: "0 — показатель без баллов: виден в аналитике, в рейтинг не идёт." } as FieldSpec]),
    { key: "penalty_per_unit", label: "Штраф в баллах за единицу нарушения", type: "number", required: true, min: 0, step: "any" },
    { key: "allow_overachievement", label: "Разрешить перевыполнение цели", type: "boolean", hint: "В текущем расчёте баллы ограничены наградой за выполнение цели." },
  );
  if (kind === "nominations") fields.push(
    { key: "channel", label: "Среди кого", type: "select", options: [{ value: "all", label: "Все операторы" }, { value: "line", label: "Операторы линии" }, { value: "chat", label: "Операторы чатов" }], hint: "Номинация разыгрывается среди операторов направления: показатель чатов — у чатов, звонков — у линии." },
    { key: "metric_code", label: "Показатель для выбора победителя", type: "select", required: true, options: [...options, { value: "__progress__", label: "Прирост баллов к прошлой неделе" }] },
    { key: "direction", label: "Выбирать результат", type: "select", options: directions },
    { key: "require_zero", label: "Требовать нулевое значение", type: "boolean", hint: "Например, отсутствие опозданий." },
    { key: "min_value", label: "Минимальное значение для участия", type: "number", step: "any", hint: "Пусто — без минимального порога." },
    { key: "coins_reward", label: "Награда в коинах", type: "number", min: 0, required: true },
  );
  if (kind === "badges") fields.push(
    { key: "icon", label: "Значок", maxLength: 64, hint: "Короткое обозначение или эмодзи, например 🏆." },
    { key: "rule_type", label: "Условие получения", type: "select", options: badgeRules },
    { key: "is_repeatable", label: "Можно получать повторно", type: "boolean", hint: "Повторно выдаётся только достижение. Бонус коинов — один раз." },
  );
  if (kind === "badges" && !["top_rank", "total_earned", "nomination_count"].includes(String(values.rule_type))) fields.push({ key: "coins_reward", label: "Коины за первое получение", type: "number", min: 0, required: true, hint: "Бонус входит в заработок для повышения уровня." });
  fields.push(...finalFields);
  const rawParams = values.rule_params;
  const ruleParams = typeof rawParams === "object" && rawParams && !Array.isArray(rawParams) ? rawParams : {};
  const rule = String(values.rule_type ?? "");
  const badgeFields: FieldSpec[] = [];
  if (kind === "badges") {
    if (["zero_metric_streak", "metric_threshold_streak", "metric_total"].includes(rule)) badgeFields.push({ key: "metric", label: "Показатель достижения", type: "select", required: true, options });
    if (rule === "top_rank") badgeFields.push({ key: "max_rank", label: "Место не ниже", type: "number", required: true, min: 1 });
    if (["zero_metric_streak", "metric_threshold_streak"].includes(rule)) badgeFields.push({ key: "weeks", label: "Недель подряд", type: "number", required: true, min: 1 });
    if (["metric_threshold_streak", "metric_total", "total_earned", "nomination_count", "learning_count"].includes(rule)) badgeFields.push({ key: "gte", label: rule === "learning_count" ? "Разных заданий успешно пройти" : rule === "total_earned" ? "Заработать коинов" : rule === "nomination_count" ? "Получить номинаций" : "Значение не ниже", type: "number", required: true, min: ["nomination_count", "total_earned", "learning_count"].includes(rule) ? 1 : .000001, step: ["nomination_count", "total_earned", "learning_count"].includes(rule) ? 1 : "any" });
  }
  const save = useMutation({ mutationFn: () => {
    const data = { ...values }; delete data.id;
    if (target) delete data.code;
    fields.forEach((field) => {
      if (field.type === "number") data[field.key] = data[field.key] === "" || data[field.key] == null ? null : Number(data[field.key]);
      if (["description", "unit", "icon"].includes(field.key) && !data[field.key]) data[field.key] = null;
    });
    if (kind === "metrics") {
      // Steps only for a result where more is better; the server takes the top step's points as the maximum.
      data.bands = stepped && values.kind === "positive" && values.direction === "higher_is_better"
        ? (values.bands as MetricBand[]).map((band) => ({ from: Number(band.from), points: Number(band.points) })).sort((a, b) => a.from - b.from)
        : null;
      // A bonus's points are its share of the main metric's: the server keeps them in step.
      data.bonus_for = bonus ? values.bonus_for : null;
      data.bonus_share = bonus ? Number(values.bonus_percent) / 100 : null;
      delete data.bonus_percent;
    }
    if (kind === "badges") {
      if (["top_rank", "total_earned", "nomination_count"].includes(String(data.rule_type))) data.coins_reward = 0;
      const params: Record<string, string | number> = {};
      badgeFields.forEach((f) => { params[f.key] = f.type === "number" ? Number(ruleParams[f.key] ?? badgeDefault(f.key, rule)) : String(ruleParams[f.key] ?? ""); });
      data.rule_params = params;
    }
    return configuration.saveDefinition(kind, data, target?.id);
  }, onSuccess: () => {
    void client.invalidateQueries({ queryKey: ["configuration", kind] });
    void client.invalidateQueries({ queryKey: ["dashboard"] });
    void client.invalidateQueries({ queryKey: ["badges"] }); void client.invalidateQueries({ queryKey: ["coin-progress"] });
    if (kind === "badges") void client.invalidateQueries({ queryKey: ["wallet"] });
    void client.invalidateQueries({ queryKey: ["metrics"] });
    toast.success("Настройки сохранены"); onClose();
  } });
  function change(key: string, value: DefinitionValue) {
    setValues((current) => {
      if (key === "rule_type") return { ...current, rule_type: value, rule_params: {} };
      return { ...current, [key]: value };
    });
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Sheet title={target ? `Изменить: ${target.title}` : createTitles[kind]} size="l" onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button type="submit" form="configuration-definition" variant="primary" disabled={save.isPending || !metrics.isSuccess}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="configuration-definition" className="stack" onSubmit={submit}>
      {kind === "badges" && <p className="muted">При сохранении проверяются подтверждённые результаты активных операторов. Первое выполненное условие открывает достижение и начисляет бонус. Полученные награды повторно не оплачиваются.</p>}
      {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
      {metrics.isError && <ErrorState error={new Error(configurationError(metrics.error))} onRetry={() => metrics.refetch()} />}
      {fields.map((spec) => <ConfigurationField key={spec.key} spec={spec} value={values[spec.key]} disabled={save.isPending} onChange={(v) => change(spec.key, v)} />)}
      {kind === "metrics" && !bonus && values.kind === "positive" && values.direction === "higher_is_better" && <BandsEditor unit={String(values.unit ?? "")} bands={stepped ? values.bands as MetricBand[] : null} disabled={save.isPending} onChange={(bands) => change("bands", bands)} />}
      {kind === "badges" && <fieldset className="configuration-condition"><legend>Условия достижения</legend><div className="configuration-form-grid">{badgeFields.map((spec) => <ConfigurationField key={`${rule}-${spec.key}`} spec={spec} value={ruleParams[spec.key] ?? badgeDefault(spec.key, rule)} disabled={save.isPending} onChange={(v) => setValues((current) => ({ ...current, rule_params: { ...ruleParams, [spec.key]: typeof v === "number" ? v : String(v ?? "") } }))} />)}</div></fieldset>}
    </form>
  </Sheet>;
}

/**
 * Points by steps instead of a share of the target (docs/CHANNELS.md): from each threshold up the metric gives its points,
 * the top step is the most it gives. As in the chats' KPI: «80–85 % — 5, 86–89 % — 10 …».
 */
function BandsEditor({ unit, bands, disabled, onChange }: { unit: string; bands: MetricBand[] | null; disabled?: boolean; onChange: (bands: MetricBand[] | null) => void }) {
  const set = (index: number, key: keyof MetricBand, value: string) => onChange((bands ?? []).map((band, i) => i === index ? { ...band, [key]: value === "" ? 0 : Number(value) } : band));
  return <fieldset className="configuration-condition configuration-bands"><legend>Баллы по ступеням</legend>
    <label className="configuration-toggle"><input type="checkbox" checked={!!bands} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [{ from: 80, points: 20 }, { from: 90, points: 60 }, { from: 97, points: 100 }] : null)} />
      <span><strong>Начислять баллы по порогам</strong><span>Значение от порога и выше даёт баллы этой ступени, ниже первого порога — 0. Максимум — баллы верхней ступени.</span></span></label>
    {bands && <>
      <ol className="configuration-bands__list">{bands.map((band, index) => <li key={index}>
        <label className="field"><span className="field__label">От{unit ? `, ${unit}` : ""}</span><input className="input" type="number" inputMode="decimal" step="any" min={0} required value={String(band.from)} disabled={disabled} onChange={(event) => set(index, "from", event.target.value)} /></label>
        <label className="field"><span className="field__label">Баллов</span><input className="input" type="number" inputMode="decimal" step="any" min={0} required value={String(band.points)} disabled={disabled} onChange={(event) => set(index, "points", event.target.value)} /></label>
        <Button size="s" variant="plain" disabled={disabled || bands.length < 2} aria-label={`Убрать ступень от ${band.from}`} onClick={() => onChange(bands.filter((_, i) => i !== index))}>Убрать</Button>
      </li>)}</ol>
      <Button size="s" disabled={disabled} onClick={() => { const last = bands[bands.length - 1]; onChange([...bands, { from: (last?.from ?? 0) + 1, points: last?.points ?? 0 }]); }}>Добавить ступень</Button>
    </>}
  </fieldset>;
}

function badgeDefault(key: string, rule: string): string | number {
  if (key === "metric") return "";
  if (key === "max_rank") return 3;
  if (key === "weeks") return rule === "zero_metric_streak" ? 3 : 1;
  return rule === "total_earned" ? 100 : 1;
}

function ConfigurationField({ spec, value, disabled, onChange }: { spec: FieldSpec; value: DefinitionValue | undefined; disabled?: boolean; onChange: (value: FieldValue) => void }) {
  if (spec.type === "boolean") return <label className="configuration-toggle"><input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span><strong>{spec.label}</strong>{spec.hint && <span>{spec.hint}</span>}</span></label>;
  return <label className="field"><span className="field__label">{spec.label}</span>
    {spec.type === "select" ? <Select aria-label={spec.label} value={String(value ?? "")} disabled={disabled} required={spec.required} options={spec.options ?? []} onChange={onChange} />
      : spec.type === "textarea" ? <textarea className="input" rows={3} value={String(value ?? "")} disabled={disabled} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />
      : spec.unit ? <span className="input-unit"><input className="input" type="number" inputMode="decimal" value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} onChange={(e) => onChange(e.target.value)} /><span aria-hidden="true">{spec.unit}</span></span>
      : <input className="input" type={spec.type === "number" ? "number" : "text"} value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />}
    {spec.hint && <span className="muted micro">{spec.hint}</span>}
  </label>;
}
