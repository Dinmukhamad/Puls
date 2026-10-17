import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { configuration, configurationError, type Definition, type DefinitionInput, type DefinitionKind, type FieldValue, type Rules } from "../api/configuration";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { SparkIcon } from "../components/icons";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton, SegmentedControl, Select } from "../components/ui";
import { visibleNavigation } from "../navigation";
import { coins, coinsWithUnit, plural, points } from "../utils/format";
import { createInternalCode } from "../utils/internalCode";
import { definitionPresentation } from "./definitionPresentation";
import "./configuration.css";
import "./performance.css";

type Option = { value: string; label: string };
type FieldSpec = { key: string; label: string; type?: "number" | "textarea" | "boolean" | "select"; hint?: string; required?: boolean; min?: number; step?: number | "any"; maxLength?: number; options?: Option[] };
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
  const views = ([["rules", "Правила расчёта"], ["metrics", "Рабочие показатели"], ["nominations", "Номинации"], ["badges", "Достижения"]] as const).filter(([key]) => can(key === "badges" ? "motivation" : "performance"));
  const destinations = user ? visibleNavigation(user.role, allowed, isDeveloper).flatMap((item) => item.tabs.map((link) => link.to)) : [];
  const hasOuterNavigation = views.every(([key]) => destinations.includes(`/admin/settings?tab=${key}`));
  // A supervisor reaches these pages through one tab of «Аналитика»: they switch like the site's other sub-pages.
  const navigation = !hasOuterNavigation && views.length > 1 && <SegmentedControl label="Разделы показателей и наград" value={tab} options={views.map(([value, label]) => ({ value, label }))} onChange={(key) => setParams({ tab: key })} />;
  return <div className={`stack configuration-page${tab !== "rules" ? " configuration-definitions-page" : ""}`}>
    {tab === "rules" ? <><div className="page-head"><div><h1 className="page-title">Правила расчёта</h1><p className="page-subtitle">Как баллы недели становятся коинами: курс, призы, дисциплина и ограничения</p></div></div>{navigation}<RulesSection /></> : <DefinitionSection key={tab} kind={tab} navigation={navigation} />}
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

/** Every numeric rule; the form keeps what was typed and converts on save. */
const numericRules: (keyof Rules)[] = [
  "points_per_coin", "rank1_bonus", "rank2_bonus", "rank3_bonus", "lateness_fine", "forbidden_site_fine", "no_lateness_bonus",
  "no_forbidden_sites_bonus", "nomination_bonus_default", "driver_gratitude_bonus", "gratitude_monthly_limit", "nomination_min_participants",
  "manual_max_abs_amount", "manual_reason_min_length", "manual_monthly_limit", "coin_rate_tenge", "shop_monthly_budget_tenge",
];

function RulesEditor({ initial, metrics }: { initial: Rules; metrics: Definition[] }) {
  const { atLeast } = useAuth(); const editable = atLeast("head");
  const [values, setValues] = useState<DefinitionInput>({ ...initial });
  const [sample, setSample] = useState("100");
  const toast = useToast(); const client = useQueryClient();
  const save = useMutation({ mutationFn: () => {
    const data = { ...values };
    numericRules.forEach((key) => { data[key] = Number(data[key]); });
    return configuration.updateRules(data as unknown as Rules);
  }, onSuccess: (data) => { client.setQueryData(["configuration-rules"], data); void client.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Правила сохранены"); } });
  const changed = (Object.keys(initial) as (keyof Rules)[]).some((key) => String(values[key] ?? "") !== String(initial[key] ?? ""));
  const disabled = !editable || save.isPending;
  const set = (key: keyof Rules, value: FieldValue) => setValues((current) => ({ ...current, [key]: value }));
  const number = (key: keyof Rules, label: string, unit: string, options: { hint?: string; min?: number; step?: number | "any" } = {}) =>
    <RuleRow key={key} id={`rule-${key}`} label={label} hint={options.hint}><RuleNumber id={`rule-${key}`} hinted={!!options.hint} value={values[key]} unit={unit} min={options.min ?? 0} step={options.step} disabled={disabled} onChange={(value) => set(key, value)} /></RuleRow>;
  const choice = (key: keyof Rules, label: string, options: Option[], hint?: string) =>
    <RuleRow key={key} id={`rule-${key}`} label={label} hint={hint}><Select id={`rule-${key}`} aria-describedby={hint ? `rule-${key}-hint` : undefined} value={String(values[key] ?? "")} disabled={disabled} required options={options} onChange={(value) => set(key, value)} /></RuleRow>;
  const toggle = (key: keyof Rules, label: string, hint: string) =>
    <label key={key} className="rules-row rules-row--switch"><span className="rules-row__text"><span className="rules-row__label">{label}</span><span className="rules-row__hint">{hint}</span></span>
      <span className="rules-switch"><input type="checkbox" role="switch" checked={!!values[key]} disabled={disabled} onChange={(e) => set(key, e.target.checked)} /><span className="rules-switch__track" aria-hidden="true"><span /></span></span></label>;
  const metricOptions = metrics.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` }));
  const rate = Number(values.points_per_coin);
  const sampleCoins = Number.isFinite(rate) && rate > 0 && Number.isFinite(Number(sample)) ? Math.floor(Math.max(0, Number(sample)) / rate) : null;
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending && changed) save.mutate(); }
  return <form className="stack rules-page" onSubmit={submit}>
    {!editable && <p className="rules-readonly">Только просмотр: менять правила могут руководитель и администратор.</p>}
    <Card className="rules-card" padded={false} title="Баллы и коины" subtitle="Баллы недели переводятся в коины, когда период закрыт">
      {number("points_per_coin", "Баллов за 1 коин", "баллов", { min: .000001, step: "any" })}
      <RuleRow id="rule-sample" label="Проверка курса" hint="Пример без бонусов, дробная часть отбрасывается">
        <span className="rules-example"><RuleNumber id="rule-sample" hinted value={sample} unit="баллов" min={0} step="any" required={false} onChange={setSample} />
          <span className="rules-example__equals" aria-hidden="true">=</span>
          <output className="rules-example__result" htmlFor="rule-sample rule-points_per_coin" aria-live="polite"><strong>{sampleCoins === null ? "—" : coins(sampleCoins)}</strong> {plural(sampleCoins ?? 0, "коин", "коина", "коинов")}</output></span>
      </RuleRow>
    </Card>
    <Card className="rules-card" padded={false} title="Конкурс" subtitle="Места и номинации разыгрываются среди всех операторов; баллы и дисциплина начисляются каждую неделю">
      {choice("contest_period", "Места и номинации", [{ value: "month", label: "Раз в месяц" }, { value: "week", label: "Каждую неделю" }], "Неделя относится к месяцу своего четверга. Месяц закрывается вместе с его последней неделей.")}
      <RuleRow label="Призы за места" hint="Коины трём лучшим по баллам конкурса">
        <span className="rules-places">{([1, 2, 3] as const).map((rank) => <label key={rank} className="rules-place"><span>{rank} место</span>
          <input className="input" type="number" inputMode="numeric" min={0} step={1} required value={String(values[`rank${rank}_bonus`] ?? "")} disabled={disabled} aria-label={`Бонус за ${rank} место конкурса, коинов`} onChange={(e) => set(`rank${rank}_bonus`, e.target.value)} /></label>)}</span>
      </RuleRow>
      {number("nomination_bonus_default", "Бонус номинации по умолчанию", "коинов")}
      {number("nomination_min_participants", "Минимум участников для номинаций", "чел.")}
      {toggle("rating_show_balance_to_operators", "Показывать операторам баланс коллег в рейтинге", "Индивидуальная история операций остаётся доступна по правам.")}
    </Card>
    <Card className="rules-card" padded={false} title="Дисциплина" subtitle="Штрафы списываются при закрытии недели, после её начислений. Если коинов не хватает, остаток спишется при следующем закрытии">
      <h3 className="rules-subhead">Опоздания</h3>
      {choice("lateness_metric_code", "Показатель опозданий", metricOptions)}
      {number("lateness_fine", "Штраф за каждое опоздание", "коинов")}
      {number("no_lateness_bonus", "Бонус за неделю без опозданий", "коинов")}
      <h3 className="rules-subhead">Посторонние сайты</h3>
      {choice("forbidden_sites_metric_code", "Показатель посторонних сайтов", metricOptions)}
      {number("forbidden_site_fine", "Штраф за каждый посторонний сайт", "коинов")}
      {number("no_forbidden_sites_bonus", "Бонус за неделю без посторонних сайтов", "коинов")}
      <h3 className="rules-subhead">Данные</h3>
      {toggle("discipline_requires_reported", "Бонус за дисциплину только при загруженных данных", "Если выключить, отсутствие отчёта о нарушениях разрешает бонус.")}
    </Card>
    <Card className="rules-card" padded={false} title="Благодарности водителей">
      {number("driver_gratitude_bonus", "Коинов за благодарность", "коинов")}
      {number("gratitude_monthly_limit", "Благодарностей в месяц на оператора", "шт.", { hint: "0 — без ограничения" })}
    </Card>
    <Card className="rules-card" padded={false} title="Ручные операции" subtitle="Ограничения для начислений и списаний сотрудниками">
      {number("manual_max_abs_amount", "Максимум за одну операцию", "коинов", { min: 1 })}
      {number("manual_reason_min_length", "Минимальная длина комментария", "символов", { hint: "Причина операции остаётся обязательной." })}
      {number("manual_monthly_limit", "Начислений супервайзера в месяц", "коинов", { hint: "Сумма ручных начислений всем операторам. 0 — без ограничения. Руководитель не ограничен." })}
    </Card>
    <Card className="rules-card" padded={false} title="Магазин" subtitle="Бонусы с денежной стоимостью продаются, пока не исчерпан бюджет месяца">
      {number("coin_rate_tenge", "Тенге за 1 коин", "₸", { min: .01, step: "any", hint: "Для пересчёта цен и отчёта «Экономика коинов»" })}
      {number("shop_monthly_budget_tenge", "Бюджет магазина на месяц", "₸", { hint: "0 — без бюджета" })}
    </Card>
    {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
    {editable && <div className={`rules-save${changed ? " is-dirty" : ""}`}><span className="secondary small">{changed ? "Есть несохранённые изменения. Они применятся к следующим расчётам и попадут в журнал аудита" : "Изменений нет. Опубликованные итоги и начисленные коины правила не меняют"}</span>
      {changed && <Button disabled={save.isPending} onClick={() => setValues({ ...initial })}>Отменить</Button>}
      <Button type="submit" variant="primary" disabled={!changed || save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить правила"}</Button></div>}
  </form>;
}

/** One setting per line: what it is on the left, a short field with its unit on the right. */
function RuleRow({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="rules-row"><div className="rules-row__text">{id ? <label className="rules-row__label" htmlFor={id}>{label}</label> : <span className="rules-row__label">{label}</span>}
    {hint && <span className="rules-row__hint" id={id ? `${id}-hint` : undefined}>{hint}</span>}</div><div className="rules-row__control">{children}</div></div>;
}

function RuleNumber({ id, hinted, value, unit, min, step, required = true, disabled, onChange }: { id: string; hinted?: boolean; value: FieldValue | undefined; unit: string; min: number; step?: number | "any"; required?: boolean; disabled?: boolean; onChange: (value: string) => void }) {
  return <span className="rules-number"><input id={id} className="input" type="number" inputMode={step === "any" ? "decimal" : "numeric"} aria-describedby={hinted ? `${id}-hint` : undefined} value={String(value ?? "")} min={min} step={step ?? 1} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    <span className="rules-number__unit">{unit}</span></span>;
}

const listSubtitles: Record<Exclude<DefinitionKind, "metrics">, string> = {
  nominations: "Как выбирают победителя и сколько он получает",
  badges: "Достижение открывается при первом выполнении условия, коины начисляются один раз",
};

function DefinitionSection({ kind, navigation }: { kind: DefinitionKind; navigation: ReactNode }) {
  const { atLeast } = useAuth();
  const editable = atLeast("head");
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<Definition | "new" | null>(null);
  const query = useQuery({ queryKey: ["configuration", kind], queryFn: () => configuration.definitions(kind) });
  const metricQuery = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: kind !== "metrics" });
  // Fines in coins live in the rules; a penalty row names them, and simply leaves them out if the rules are unavailable.
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules, enabled: kind === "metrics", refetchOnWindowFocus: false });
  const metrics = kind === "metrics" ? query.data ?? [] : metricQuery.data ?? [];
  const search = params.get("search") ?? "";
  const selectedStatus = params.get("status") ?? "all";
  const status = ["all", "active", "archived"].includes(selectedStatus) ? selectedStatus : "all";
  const items = query.data?.filter((row) => `${row.title} ${row.description ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (status === "all" || row.is_active === (status === "active")));
  const pointsTotal = weekPoints(query.data ?? []);
  const row = (item: Definition) => <DefinitionRow key={item.id} kind={kind} row={item} metrics={metrics} rules={rules.data} pointsTotal={pointsTotal} onEdit={editable ? setEditor : undefined} />;
  const results = items?.filter((item) => item.kind !== "anti") ?? [];
  const penalties = items?.filter((item) => item.kind === "anti") ?? [];
  return <div className="stack">
    <div className="page-head"><div><h1 className="page-title">{sectionTitles[kind]}</h1><p className="page-subtitle">{query.data ? definitionSummary(kind, query.data) : sectionSubtitles[kind]}</p></div>{editable && <div className="page-head__actions"><Button variant="primary" onClick={() => setEditor("new")}>{createTitles[kind]}</Button></div>}</div>
    {navigation}
    <GlassSurface variant="regular" className="configuration-filters"><label className="field configuration-search"><span className="field__label">Поиск</span><input className="input" type="search" value={search} placeholder="Название или описание" onChange={(e) => setParams({ tab: kind, search: e.target.value, status }, { replace: true })} /></label><label className="field"><span className="field__label">Статус</span><Select aria-label="Статус записей" value={status} options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "archived", label: "Неактивные" }]} onChange={(value) => setParams({ tab: kind, search, status: value })} /></label></GlassSurface>
    {query.isLoading && <RowsSkeleton />}{query.isError && <ErrorState error={new Error(configurationError(query.error))} onRetry={() => query.refetch()} />}
    {items?.length === 0 && <EmptyState title="Записи не найдены" hint="Измените фильтры или добавьте новую запись." />}
    {kind === "metrics" ? <>
      {results.length > 0 && <Card className="definition-list-card" padded={false} title="Показатели конкурса" subtitle="Баллы начисляются по степени выполнения цели; полоска — доля показателя в баллах недели"><ul className="definition-list">{results.map(row)}</ul></Card>}
      {penalties.length > 0 && <Card className="definition-list-card" padded={false} title="Штрафные показатели" subtitle={<>Штраф в коинах и бонус за неделю без нарушений задаются в <Link to="/admin/settings?tab=rules">«Правилах расчёта»</Link></>}><ul className="definition-list">{penalties.map(row)}</ul></Card>}
    </> : !!items?.length && <Card className="definition-list-card" padded={false} title="Условия и награды" subtitle={listSubtitles[kind]}><ul className="definition-list">{items.map(row)}</ul></Card>}
    {editor && <DefinitionEditor kind={kind} target={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
  </div>;
}

function amount(value: FieldValue | undefined): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase() + value.slice(1);

/** The most an operator can score in a week: the points for meeting every active target. */
export function weekPoints(rows: readonly Definition[]): number {
  return rows.filter((row) => row.is_active && row.kind !== "anti").reduce((sum, row) => sum + amount(row.max_points), 0);
}

/** The page's subtitle: what is active and what it is worth. */
export function definitionSummary(kind: DefinitionKind, rows: readonly Definition[]): string {
  const active = rows.filter((row) => row.is_active);
  const inactive = rows.length - active.length;
  const parts: string[] = [];
  if (kind === "metrics") {
    const results = active.filter((row) => row.kind !== "anti");
    const penalties = active.length - results.length;
    const total = weekPoints(rows);
    parts.push(`${results.length} ${plural(results.length, "показатель", "показателя", "показателей")} конкурса`);
    if (results.length) parts.push(`до ${points(total)} ${plural(total, "балла", "баллов", "баллов")} за неделю`);
    if (penalties) parts.push(`${penalties} ${plural(penalties, "штрафной", "штрафных", "штрафных")}`);
  } else if (kind === "nominations") {
    parts.push(`${active.length} ${plural(active.length, "активная номинация", "активные номинации", "активных номинаций")}`);
    const rewards = active.map((row) => amount(row.coins_reward));
    const low = Math.min(...rewards), high = Math.max(...rewards);
    if (rewards.length && high > 0) parts.push(low === high ? `по ${coinsWithUnit(high)} победителю` : `от ${coins(low)} до ${coinsWithUnit(high)} победителю`);
  } else {
    parts.push(`${active.length} ${plural(active.length, "активное достижение", "активных достижения", "активных достижений")}`);
    const paid = active.filter((row) => amount(row.coins_reward) > 0).length;
    if (paid) parts.push(`${paid} с наградой в коинах`);
  }
  if (inactive) parts.push(`${inactive} ${plural(inactive, "неактивная запись", "неактивные записи", "неактивных записей")}`);
  return parts.join(" · ");
}

interface RowValue { amount: string; unit: string; coin?: boolean; share?: number }

/** What a row is worth, on its right: points for a target, a fine, or a reward in coins. */
export function definitionValue(kind: DefinitionKind, row: Definition, rules: Rules | undefined, pointsTotal: number): RowValue {
  if (kind === "metrics" && row.kind !== "anti") {
    const value = amount(row.max_points);
    return { amount: points(value), unit: plural(value, "балл", "балла", "баллов"), share: row.is_active && pointsTotal > 0 ? value / pointsTotal * 100 : undefined };
  }
  if (kind === "metrics") {
    const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : "нарушение";
    const fine = disciplineRule(row, rules)?.fine;
    if (fine) return { amount: `−${coins(fine)}`, unit: `${plural(fine, "коин", "коина", "коинов")} за 1 ${unit}` };
    const penalty = amount(row.penalty_per_unit);
    if (penalty > 0) return { amount: `−${points(penalty)}`, unit: `${plural(penalty, "балл", "балла", "баллов")} за 1 ${unit}` };
    return { amount: "—", unit: "штраф не задан" };
  }
  const reward = amount(row.coins_reward);
  return reward > 0 ? { amount: `+${coins(reward)}`, unit: plural(reward, "коин", "коина", "коинов"), coin: true } : { amount: "—", unit: "без коинов" };
}

/** A penalty metric chosen in the rules as lateness or forbidden sites carries that rule's fine and bonus. */
function disciplineRule(row: Definition, rules: Rules | undefined): { fine: number; bonus: number } | null {
  if (!rules) return null;
  if (row.code === rules.lateness_metric_code) return { fine: rules.lateness_fine, bonus: rules.no_lateness_bonus };
  if (row.code === rules.forbidden_sites_metric_code) return { fine: rules.forbidden_site_fine, bonus: rules.no_forbidden_sites_bonus };
  return null;
}

/** The line under a row's title: its target, the way a winner is chosen, or the condition. */
export function definitionMeta(kind: DefinitionKind, row: Definition, metrics: readonly Definition[], rules: Rules | undefined): string {
  const { facts } = definitionPresentation(kind, row, metrics);
  if (kind === "metrics" && row.kind !== "anti") return `Цель ${facts[0].value} · ${lowerFirst(facts[2].value)}`;
  if (kind === "metrics") {
    const discipline = disciplineRule(row, rules);
    const penalty = amount(row.penalty_per_unit);
    const parts: string[] = [];
    if (discipline?.fine) parts.push("Списывается при закрытии недели");
    if (penalty > 0 && discipline?.fine) parts.push(`снижает итог на ${points(penalty)} ${plural(penalty, "балл", "балла", "баллов")}`);
    else if (penalty > 0) parts.push("Снижает итоговый балл до перевода в коины");
    if (discipline?.bonus) parts.push(`неделя без нарушений: +${coinsWithUnit(discipline.bonus)}`);
    if (!parts.length) parts.push(rules ? "Не выбран в «Правилах расчёта» как опоздания или посторонние сайты" : "Штраф в коинах задаётся в «Правилах расчёта»");
    return parts.join(" · ");
  }
  if (kind === "nominations") return `${facts[1].value} · ${lowerFirst(facts[2].value)}`;
  return `${facts[0].value}${row.is_repeatable ? " · можно получать повторно" : ""}`;
}

function DefinitionRow({ kind, row, metrics, rules, pointsTotal, onEdit }: { kind: DefinitionKind; row: Definition; metrics: readonly Definition[]; rules?: Rules; pointsTotal: number; onEdit?: (row: Definition) => void }) {
  const value = definitionValue(kind, row, rules, pointsTotal);
  // Only a description someone wrote: the stock ones repeat the line above.
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const icon = typeof row.icon === "string" ? row.icon.trim() : "";
  return <li className={`definition-row${row.is_active ? "" : " is-inactive"}${kind === "badges" ? " definition-row--icon" : ""}`}>
    {kind === "badges" && <span className="definition-row__icon" aria-hidden="true">{icon || <SparkIcon size={16} />}</span>}
    <div className="definition-row__main">
      <p className="definition-row__title"><strong>{row.title}</strong>{!row.is_active && <Badge tone="neutral">Неактивно</Badge>}</p>
      <p className="definition-row__meta">{definitionMeta(kind, row, metrics, rules)}</p>
      {description && <p className="definition-row__description">{description}</p>}
    </div>
    <div className="definition-row__value">
      <span className={`definition-row__amount${value.coin ? " is-coin" : ""}`}>{value.amount}<span className="definition-row__unit">{value.unit}</span></span>
      {value.share !== undefined && <span className="definition-row__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, value.share)}%` }} /></span>}
    </div>
    {onEdit && <Button size="s" variant="plain" className="definition-row__edit" aria-label={`Изменить «${row.title}»`} onClick={() => onEdit(row)}>Изменить</Button>}
  </li>;
}

function defaultDefinition(kind: DefinitionKind): DefinitionInput {
  const common = { code: createInternalCode(kind), title: "", description: "", is_active: true, sort_order: 100 };
  if (kind === "metrics") return { ...common, unit: "", kind: "positive", direction: "higher_is_better", target_value: 1, max_points: 20, penalty_per_unit: 0, allow_overachievement: false };
  if (kind === "nominations") return { ...common, metric_code: "", direction: "higher_is_better", require_zero: false, min_value: null, coins_reward: 5 };
  return { ...common, icon: "", rule_type: "top_rank", rule_params: { max_rank: 3 }, coins_reward: 0, is_repeatable: false };
}

function DefinitionEditor({ kind, target, onClose }: { kind: DefinitionKind; target?: Definition; onClose: () => void }) {
  const [values, setValues] = useState<DefinitionInput>(() => target ? { ...target } : defaultDefinition(kind));
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: kind !== "metrics" });
  const client = useQueryClient(); const toast = useToast();
  const options = metrics.data?.map((m) => ({ value: m.code, label: `${m.title}${m.is_active ? "" : " · неактивен"}` })) ?? [];
  const fields: FieldSpec[] = [...commonFields];
  if (kind === "metrics") fields.push(
    { key: "unit", label: "Единица измерения", maxLength: 32, hint: "Например %, мин или шт." },
    { key: "kind", label: "Тип показателя", type: "select", options: [{ value: "positive", label: "Рабочий результат" }, { value: "anti", label: "Штрафной показатель" }] },
    { key: "direction", label: "Какой результат лучше", type: "select", options: directions },
    { key: "target_value", label: "Целевое значение", type: "number", required: true, min: values.kind === "positive" ? .000001 : 0, step: "any" },
    { key: "max_points", label: "Баллы за выполнение цели", type: "number", required: true, min: 0, step: "any" },
    { key: "penalty_per_unit", label: "Штраф в баллах за единицу нарушения", type: "number", required: true, min: 0, step: "any" },
    { key: "allow_overachievement", label: "Разрешить перевыполнение цели", type: "boolean", hint: "В текущем расчёте баллы ограничены наградой за выполнение цели." },
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
    { key: "is_repeatable", label: "Можно получать повторно", type: "boolean", hint: "Повторно выдаётся только достижение. Бонус коинов — один раз." },
  );
  if (kind === "badges" && !["top_rank", "total_earned", "nomination_count"].includes(String(values.rule_type))) fields.push({ key: "coins_reward", label: "Коины за первое получение", type: "number", min: 0, required: true, hint: "Бонус входит в заработок для повышения уровня." });
  fields.push(...finalFields);
  const rawParams = values.rule_params;
  const ruleParams = typeof rawParams === "object" && rawParams ? rawParams : {};
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
  function change(key: string, value: FieldValue) {
    setValues((current) => {
      if (key === "rule_type") return { ...current, rule_type: value, rule_params: {} };
      return { ...current, [key]: value };
    });
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!save.isPending) save.mutate(); }
  return <Sheet title={target ? `Изменить: ${target.title}` : createTitles[kind]} size="l" onClose={() => { if (!save.isPending) onClose(); }} footer={<><Button disabled={save.isPending} onClick={onClose}>Отмена</Button><Button type="submit" form="configuration-definition" variant="primary" disabled={save.isPending || (kind !== "metrics" && !metrics.isSuccess)}>{save.isPending ? "Сохраняем…" : "Сохранить"}</Button></>}>
    <form id="configuration-definition" className="stack" onSubmit={submit}>
      {kind === "badges" && <p className="muted">При сохранении проверяются подтверждённые результаты активных операторов. Первое выполненное условие открывает достижение и начисляет бонус. Полученные награды повторно не оплачиваются.</p>}
      {save.isError && <p role="alert" className="configuration-error">{configurationError(save.error)}</p>}
      {metrics.isError && <ErrorState error={new Error(configurationError(metrics.error))} onRetry={() => metrics.refetch()} />}
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
    {spec.type === "select" ? <Select aria-label={spec.label} value={String(value ?? "")} disabled={disabled} required={spec.required} options={spec.options ?? []} onChange={onChange} />
      : spec.type === "textarea" ? <textarea className="input" rows={3} value={String(value ?? "")} disabled={disabled} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />
      : <input className="input" type={spec.type === "number" ? "number" : "text"} value={String(value ?? "")} disabled={disabled} min={spec.min} step={spec.step ?? 1} required={spec.required} maxLength={spec.maxLength} onChange={(e) => onChange(e.target.value)} />}
    {spec.hint && <span className="muted micro">{spec.hint}</span>}
  </label>;
}
