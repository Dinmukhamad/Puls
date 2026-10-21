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
/** ``section`` groups the editor's fields under a heading; ``wide`` takes the whole row of the two columns. */
type FieldSpec = { key: string; label: string; type?: "number" | "textarea" | "boolean" | "select"; hint?: string; required?: boolean; min?: number; step?: number | "any"; maxLength?: number; options?: Option[]; unit?: string; section?: string; wide?: boolean; placeholder?: string };
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
const MAIN = "Основное", SHOWN = "Показ", COUNT = "Как считается", WIN = "Кто побеждает", COND = "Условие";
const commonFields: FieldSpec[] = [
  { key: "title", label: "Название", required: true, maxLength: 255, section: MAIN, wide: true },
  { key: "description", label: "Описание", type: "textarea", maxLength: 5000, section: MAIN, wide: true, placeholder: "Необязательно" },
];
const finalFields: FieldSpec[] = [
  { key: "sort_order", label: "Порядок в списке", type: "number", required: true, step: 1, hint: "Меньше — выше.", section: SHOWN },
  { key: "is_active", label: "Активно", type: "boolean", hint: "Выключенные не участвуют в новых расчётах.", section: SHOWN },
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
/**
 * The rules in pairs of cards of the same height, each field one line of label and its unit; only what is not
 * evident from the label gets a short hint (docs/PERFORMANCE_SECTION.md).
 */
const ruleGroups: { title: string; fields: FieldSpec[]; className?: string }[] = [
  { title: "Баллы и коины", fields: [
    { key: "points_per_coin", label: "Баллов за 1 коин", type: "number", required: true, min: .000001, step: "any", unit: "баллов" },
    { key: "prize_min_points", label: "Минимум для приза", type: "number", required: true, min: 0, step: "any", unit: "баллов", hint: "Средняя неделя оператора" },
  ] },
  { title: "Призы за места", className: "rules-three", fields: [
    { key: "rank1_bonus", label: "1 место", type: "number", required: true, min: 0, unit: C },
    { key: "rank2_bonus", label: "2 место", type: "number", required: true, min: 0, unit: C },
    { key: "rank3_bonus", label: "3 место", type: "number", required: true, min: 0, unit: C },
  ] },
  { title: "Штрафы и бонусы", fields: [
    { key: "lateness_fine", label: "Штраф за опоздание", type: "number", required: true, min: 0, unit: C },
    { key: "forbidden_site_fine", label: "Штраф за посторонний сайт", type: "number", required: true, min: 0, unit: C },
    { key: "no_lateness_bonus", label: "Неделя без опозданий", type: "number", required: true, min: 0, unit: C },
    { key: "no_forbidden_sites_bonus", label: "Неделя без сайтов", type: "number", required: true, min: 0, unit: C },
  ] },
  { title: "Номинации", fields: [
    { key: "nomination_bonus_default", label: "Награда по умолчанию", type: "number", required: true, min: 0, unit: C },
    { key: "nomination_min_participants", label: "Минимум участников", type: "number", required: true, min: 0, unit: "чел." },
  ] },
  { title: "Ручные операции", fields: [
    { key: "manual_max_abs_amount", label: "Максимум за операцию", type: "number", required: true, min: 1, unit: C },
    { key: "manual_reason_min_length", label: "Комментарий от", type: "number", required: true, min: 0, unit: "симв." },
    { key: "manual_monthly_limit", label: "Лимит супервайзера в месяц", type: "number", required: true, min: 0, hint: "0 — без лимита", unit: C },
  ] },
  { title: "Магазин", fields: [
    { key: "coin_rate_tenge", label: "Стоимость 1 коина", type: "number", required: true, min: .01, step: "any", unit: "₸" },
    { key: "shop_monthly_budget_tenge", label: "Бюджет на месяц", type: "number", required: true, min: 0, hint: "0 — без лимита", unit: "₸" },
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
      {ruleGroups.map((group, index) => <Card key={group.title} title={group.title} className={group.className}><div className="configuration-form-grid">{group.fields.map(field)}
        {group.title === "Номинации" && field({ key: "contest_period", label: "Места и номинации", type: "select", required: true, wide: true, options: [{ value: "month", label: "Раз в месяц, внутри направления" }, { value: "week", label: "Каждую неделю" }] })}</div>
        {index === 0 && <div className="configuration-example" aria-label="Проверка курса"><label className="field"><span className="field__label">Пример: баллов</span><input className="input" type="number" min={0} step="any" value={sample} onChange={(e) => setSample(e.target.value)} /></label><span className="configuration-example__equals" aria-hidden="true">=</span><output className="configuration-example__result" aria-live="polite"><strong>{Number.isFinite(rate) && rate > 0 && Number.isFinite(Number(sample)) ? coins(Math.floor(Math.max(0, Number(sample)) / rate)) : "—"}</strong> коинов</output>{Number.isFinite(rate) && rate > 0 && <span className="configuration-example__rate">Без призов и бонусов, дробная часть отбрасывается.</span>}</div>}
      </Card>)}
      <Card title="Дисциплина и видимость" className="rules-wide"><div className="configuration-form-grid">
        {field({ key: "lateness_metric_code", label: "Показатель опозданий", type: "select", options: metricOptions, required: true })}
        {field({ key: "forbidden_sites_metric_code", label: "Показатель посторонних сайтов", type: "select", options: metricOptions, required: true })}
      </div><div className="configuration-toggles">
        {field({ key: "discipline_requires_reported", label: "Бонус за дисциплину только при загруженных данных", type: "boolean", hint: "Выключено — бонус дают и без отчёта о нарушениях." })}
        {field({ key: "rating_show_balance_to_operators", label: "Показывать операторам баланс коллег в рейтинге", type: "boolean" })}
      </div></Card>
    </div>
    {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
    {editable && <div className={`configuration-save rules-save${dirty ? " is-dirty" : ""}`} role={dirty ? "region" : undefined} aria-label={dirty ? "Несохранённые изменения" : undefined}>
      <span>{dirty ? "Есть несохранённые изменения. Они применятся к следующим расчётам." : "Изменения действуют со следующего расчёта, опубликованные итоги не меняются."}</span>
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
    {items && items.length > 0 && groups(kind, items).map(group => ({ ...group, items: [...group.items.filter(row => row.is_active), ...group.items.filter(row => !row.is_active)] })).map(group => <Card key={group.title} title={group.title} subtitle={group.subtitle} padded={false} className="definition-list">
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
  // The inactive ones are kept for history: counted apart, so «7 показателей» means seven that work.
  const count = (list: Definition[], one: string, few: string, many: string) => {
    const off = list.filter(row => !row.is_active).length, on = list.length - off;
    return `${on} ${plural(on, one, few, many)}${off ? ` · неактивных: ${off}` : ""}`;
  };
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
    { key: "channel", label: "Направление", type: "select", options: [{ value: "line", label: "Линия" }, { value: "chat", label: "Чаты" }, { value: "all", label: "Общий для линии и чатов" }], section: MAIN },
    { key: "unit", label: "Единица измерения", maxLength: 32, placeholder: "%, мин, шт", section: MAIN },
    { key: "kind", label: "Тип показателя", type: "select", options: [{ value: "positive", label: "Рабочий результат" }, { value: "anti", label: "Штрафной показатель" }], section: COUNT },
    { key: "direction", label: "Какой результат лучше", type: "select", options: directions, section: COUNT },
    ...(values.kind === "positive" ? [{ key: "bonus_for", label: "Как даёт баллы", type: "select", options: [{ value: "", label: "Баллы за выполнение цели" }, ...bases.map((m) => ({ value: m.code, label: `Бонус к «${m.title}» сверх 100 баллов` }))], hint: "Бонус платится сверх 100 баллов, когда основной показатель выполнен.", section: COUNT, wide: true } as FieldSpec] : []),
    { key: "target_value", label: bonus ? "Значение для всего бонуса" : "Цель", type: "number", required: true, min: values.kind === "positive" ? .000001 : 0, step: "any", unit: String(values.unit ?? "") || undefined, section: COUNT },
    ...(bonus ? [{ key: "bonus_percent", label: "Доля баллов основного", type: "number", required: true, min: 1, step: "any", unit: "%", hint: `Сейчас это до ${points(Number(bases.find((m) => m.code === values.bonus_for)?.max_points ?? 0) * Number(values.bonus_percent || 0) / 100)} баллов.`, section: COUNT } as FieldSpec]
      : stepped ? [] : [{ key: "max_points", label: "Баллы за цель", type: "number", required: true, min: 0, step: "any", unit: "баллов", hint: "0 — только в аналитике, без баллов.", section: COUNT } as FieldSpec]),
    { key: "penalty_per_unit", label: "Штраф за единицу", type: "number", required: true, min: 0, step: "any", unit: "баллов", section: COUNT },
    { key: "allow_overachievement", label: "Перевыполнение цели", type: "boolean", hint: "Выключено — баллов не больше, чем за цель.", section: COUNT },
  );
  if (kind === "nominations") fields.push(
    { key: "channel", label: "Среди кого", type: "select", section: WIN, options: [{ value: "all", label: "Все операторы" }, { value: "line", label: "Операторы линии" }, { value: "chat", label: "Операторы чатов" }] },
    { key: "metric_code", label: "Показатель", type: "select", required: true, section: WIN, options: [...options, { value: "__progress__", label: "Прирост баллов к прошлой неделе" }] },
    { key: "direction", label: "Лучший результат", type: "select", options: directions, section: WIN },
    { key: "min_value", label: "Минимум для участия", type: "number", step: "any", placeholder: "Без порога", section: WIN },
    { key: "require_zero", label: "Только с нулевым значением", type: "boolean", hint: "Например, без опозданий.", section: WIN },
    { key: "coins_reward", label: "Награда победителю", type: "number", min: 0, required: true, unit: "коинов", section: WIN },
  );
  if (kind === "badges") fields.push(
    { key: "icon", label: "Значок", maxLength: 64, placeholder: "Эмодзи, например 🏆", section: MAIN },
    { key: "rule_type", label: "Условие получения", type: "select", options: badgeRules, section: COND, wide: true },
    { key: "is_repeatable", label: "Можно получать повторно", type: "boolean", hint: "Коины — только за первое получение.", section: COND },
  );
  if (kind === "badges" && !["top_rank", "total_earned", "nomination_count"].includes(String(values.rule_type))) fields.push({ key: "coins_reward", label: "Коины за первое получение", type: "number", min: 0, required: true, unit: "коинов", section: COND });
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
    <form id="configuration-definition" className="stack configuration-editor" onSubmit={submit}>
      {kind === "badges" && <p className="muted">При сохранении достижение сразу проверяется у операторов; награда платится один раз.</p>}
      {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
      {metrics.isError && <ErrorState error={new Error(configurationError(metrics.error))} onRetry={() => metrics.refetch()} />}
      {[...new Set(fields.map((spec) => spec.section ?? MAIN))].map((name) => {
        const own = fields.filter((spec) => (spec.section ?? MAIN) === name);
        const plain = own.filter((spec) => spec.type !== "boolean"), toggles = own.filter((spec) => spec.type === "boolean");
        const input = (spec: FieldSpec) => <ConfigurationField key={spec.key} spec={spec} value={values[spec.key]} disabled={save.isPending} onChange={(v) => change(spec.key, v)} />;
        return <section key={name} className="configuration-section" aria-label={name}>
          <h3 className="configuration-section__title">{name}</h3>
          {plain.length > 0 && <div className="configuration-form-grid">{plain.map(input)}</div>}
          {name === COND && kind === "badges" && badgeFields.length > 0 && <div className="configuration-form-grid">{badgeFields.map((spec) => <ConfigurationField key={`${rule}-${spec.key}`} spec={spec} value={ruleParams[spec.key] ?? badgeDefault(spec.key, rule)} disabled={save.isPending} onChange={(v) => setValues((current) => ({ ...current, rule_params: { ...ruleParams, [spec.key]: typeof v === "number" ? v : String(v ?? "") } }))} />)}</div>}
          {toggles.length > 0 && <div className="configuration-toggles">{toggles.map(input)}</div>}
          {name === COUNT && kind === "metrics" && !bonus && values.kind === "positive" && values.direction === "higher_is_better" && <BandsEditor unit={String(values.unit ?? "")} bands={stepped ? values.bands as MetricBand[] : null} disabled={save.isPending} onChange={(bands) => change("bands", bands)} />}
        </section>;
      })}
    </form>
  </Sheet>;
}

/**
 * Points by steps instead of a share of the target (docs/CHANNELS.md): from each threshold up the metric gives its points,
 * the top step is the most it gives. As in the chats' KPI: «80–85 % — 5, 86–89 % — 10 …».
 */
function BandsEditor({ unit, bands, disabled, onChange }: { unit: string; bands: MetricBand[] | null; disabled?: boolean; onChange: (bands: MetricBand[] | null) => void }) {
  const set = (index: number, key: keyof MetricBand, value: string) => onChange((bands ?? []).map((band, i) => i === index ? { ...band, [key]: value === "" ? 0 : Number(value) } : band));
  return <div className="configuration-bands">
    <label className="configuration-toggle"><span><strong>Баллы по ступеням</strong><span>От порога и выше — баллы ступени, ниже первого — 0.</span></span>
      <input type="checkbox" role="switch" checked={!!bands} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [{ from: 80, points: 20 }, { from: 90, points: 60 }, { from: 97, points: 100 }] : null)} /></label>
    {bands && <>
      <ol className="configuration-bands__list">{bands.map((band, index) => <li key={index}>
        <label className="field"><span className="field__label">От{unit ? `, ${unit}` : ""}</span><input className="input" type="number" inputMode="decimal" step="any" min={0} required value={String(band.from)} disabled={disabled} onChange={(event) => set(index, "from", event.target.value)} /></label>
        <label className="field"><span className="field__label">Баллов</span><input className="input" type="number" inputMode="decimal" step="any" min={0} required value={String(band.points)} disabled={disabled} onChange={(event) => set(index, "points", event.target.value)} /></label>
        <Button size="s" variant="plain" disabled={disabled || bands.length < 2} aria-label={`Убрать ступень от ${band.from}`} onClick={() => onChange(bands.filter((_, i) => i !== index))}>Убрать</Button>
      </li>)}</ol>
      <Button size="s" disabled={disabled} onClick={() => { const last = bands[bands.length - 1]; onChange([...bands, { from: (last?.from ?? 0) + 1, points: last?.points ?? 0 }]); }}>Добавить ступень</Button>
    </>}
  </div>;
}

function badgeDefault(key: string, rule: string): string | number {
  if (key === "metric") return "";
  if (key === "max_rank") return 3;
  if (key === "weeks") return rule === "zero_metric_streak" ? 3 : 1;
  return rule === "total_earned" ? 100 : 1;
}

function ConfigurationField({ spec, value, disabled, onChange }: { spec: FieldSpec; value: DefinitionValue | undefined; disabled?: boolean; onChange: (value: FieldValue) => void }) {
  // A yes/no setting is a row with a switch, as elsewhere on the site.
  if (spec.type === "boolean") return <label className="configuration-toggle"><span><strong>{spec.label}</strong>{spec.hint && <span>{spec.hint}</span>}</span><input type="checkbox" role="switch" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /></label>;
  return <label className={`field${spec.wide ? " configuration-wide" : ""}`}><span className="field__label">{spec.label}</span>
    {spec.type === "select" ? <Select aria-label={spec.label} value={String(value ?? "")} disabled={disabled} required={spec.required} options={spec.options ?? []} onChange={onChange} />
      : spec.type === "textarea" ? <textarea className="input" rows={2} value={String(value ?? "")} disabled={disabled} maxLength={spec.maxLength} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />
      : spec.unit ? <span className="input-unit"><input className="input" type="number" inputMode="decimal" value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} /><span aria-hidden="true">{spec.unit}</span></span>
      : <input className="input" type={spec.type === "number" ? "number" : "text"} value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} maxLength={spec.maxLength} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />}
    {spec.hint && <span className="muted micro">{spec.hint}</span>}
  </label>;
}
