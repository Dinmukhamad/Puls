import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { periods, type ImportIssue, type ImportPreview, type PeriodPreview } from "../api/periods";
import { configuration } from "../api/configuration";
import type { WeekOut } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { CheckIcon } from "../components/icons";
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from "../components/ui";
import { weekRange } from "../components/weekCalendar";
import { coins, plural, points, WEEK_STATUS_LABELS } from "../utils/format";
import { ReportsUpload } from "./ReportsUpload";
import "./workflow.css";
import "./performance.css";

const STEPS = [
  { title: "Показатели", hint: "Файл недели или отчёты месяца" },
  { title: "Расчёт", hint: "Итоги готовы, коины не начислены" },
  { title: "Публикация", hint: "Неделя закрыта, коины начислены" },
];
/** The history shows this many weeks until asked for all of them. */
const HISTORY_LIMIT = 8;
const STATUS_TONES = { open: "neutral", calculated: "warning", closed: "success" } as const;

export function PeriodsPage() {
  const [params] = useSearchParams();
  return <PeriodWorkspace key={params.get("week") ?? "new"} />;
}

function PeriodWorkspace() {
  const { atLeast } = useAuth();
  const canPublish = atLeast("head");
  const canImport = atLeast("supervisor");
  const [params, setParams] = useSearchParams();
  const weeks = useQuery({ queryKey: ["periods"], queryFn: periods.list });
  const history = sortedWeeks(weeks.data ?? []);
  // Without a week in the address the page opens the week in work: the newest one not closed, else the newest.
  const selected = Number(params.get("week")) || (history.find((item) => item.status !== "closed") ?? history[0])?.id;
  const week = history.find((item) => item.id === selected);
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: !!selected });
  const metricNames = new Map(metrics.data?.map(metric => [metric.code, metric.title]));
  const missingMetricsLabel = (codes: string[]) => codes.map(code => metricNames.get(code) ?? "Название показателя недоступно").join(", ");
  const preview = useQuery({ queryKey: ["period-preview", selected],
    queryFn: () => periods.preview(selected!), enabled: !!selected });
  const queryClient = useQueryClient();
  const toast = useToast();
  const choices = newWeekChoices(history);
  const [newWeek, setNewWeek] = useState("");
  const [inspected, setInspected] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [monthly, setMonthly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const generation = useRef(0);
  const closed = week?.status === "closed";

  const refresh = () => {
    for (const key of ["periods", "period-preview", "weeks", "dashboard", "rating", "admin-summary", "admin-operators", "analytics", "coin-progress", "badges", "wallet"])
      void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const selectWeek = (id?: number) => {
    generation.current += 1;
    setParams(id ? { week: String(id) } : {});
    setInspected(null); setApplied(false); setConfirmPublish(false);
    inspect.reset(); apply.reset(); calculate.reset(); publish.reset();
    if (fileInput.current) fileInput.current.value = "";
  };
  const create = useMutation({ mutationFn: (day: string) => periods.create(day), onSuccess: (created) => {
    refresh(); selectWeek(created.id); toast.success("Неделя открыта");
  } });
  const inspect = useMutation({
    mutationFn: async ({ id, file, revision }: { id: number; file: File; revision: number }) =>
      ({ result: await periods.inspect(id, file), revision }),
    onSuccess: ({ result, revision }) => {
      if (revision === generation.current) { setInspected(result); setApplied(false); }
    },
  });
  const apply = useMutation({ mutationFn: () => periods.apply(selected!, inspected!),
    onSuccess: () => { setApplied(true); refresh(); toast.success("Показатели сохранены. Можно проверить расчёт."); } });
  const calculate = useMutation({ mutationFn: () => periods.calculate(selected!), onSuccess: () => {
    refresh(); toast.success("Расчёт подготовлен. Коины ещё не начислены.");
  } });
  const publish = useMutation({ mutationFn: () => periods.publish(selected!), onSuccess: (report) => {
    setConfirmPublish(false); refresh();
    toast.success(report.already_closed ? "Период уже опубликован" : `Опубликовано. Начислено ${coins(report.coins_awarded)} коинов.`);
  } });
  const busy = inspect.isPending || apply.isPending || calculate.isPending || publish.isPending;
  const inspectFile = (file?: File) => {
    if (!canImport || !file || !selected || closed || busy) return;
    generation.current += 1; setInspected(null); setApplied(false); apply.reset();
    inspect.mutate({ id: selected, file, revision: generation.current });
  };
  const done = [applied || (!!week && week.status !== "open"), week?.status === "calculated" || closed, closed];
  const current = done.findIndex((step) => !step);
  const error = create.error || inspect.error || apply.error || calculate.error;
  const newWeekValue = choices.some((choice) => choice.value === newWeek) ? newWeek : choices[0]?.value ?? "";
  const visible = showAll || history.findIndex((item) => item.id === selected) >= HISTORY_LIMIT ? history : history.slice(0, HISTORY_LIMIT);

  return <div className="stack periods-page">
    <div className="page-head"><div><h1 className="page-title">Расчёт и история периодов</h1>
      <p className="page-subtitle">{weeks.data ? historySummary(history) : "Загрузите показатели, проверьте итоги недели и опубликуйте их"}</p></div>
      {canImport && <div className="page-head__actions"><Button onClick={() => setMonthly(true)}>Загрузить отчёты за месяц</Button></div>}</div>
    <div className="periods-layout">
      <Card className="periods-history" padded={false} title="Периоды" subtitle="Недели конкурса, новые сверху">
        {canImport && choices.length > 0 && <form className="periods-new" onSubmit={(e) => { e.preventDefault(); if (newWeekValue) create.mutate(newWeekValue); }}>
          <label className="field"><span className="field__label">Новая неделя</span>
            <Select aria-label="Новая неделя" value={newWeekValue} disabled={create.isPending || busy} options={choices} onChange={setNewWeek} /></label>
          <Button type="submit" disabled={!newWeekValue || create.isPending || busy}>{create.isPending ? "Открываем…" : "Открыть"}</Button>
        </form>}
        {weeks.isLoading && <div className="periods-history__state"><Skeleton height={44} /></div>}
        {weeks.isError && <ErrorState error={weeks.error} onRetry={() => weeks.refetch()} />}
        {weeks.data && !history.length && <EmptyState title="Периодов пока нет" hint={canImport ? "Откройте первую неделю из списка выше" : "Неделю откроет супервайзер или руководитель"} />}
        {history.length > 0 && <ul className="periods-list">{visible.map((item) => <li key={item.id}>
          <button type="button" className="periods-week" aria-current={item.id === selected ? "true" : undefined} disabled={busy} onClick={() => selectWeek(item.id)}>
            <span className="periods-week__text"><strong>{weekRange(item)}</strong><span>{weekNote(item)}</span></span>
            {item.status !== "closed" && <Badge tone={STATUS_TONES[item.status]}>{WEEK_STATUS_LABELS[item.status]}</Badge>}
          </button></li>)}</ul>}
        {history.length > HISTORY_LIMIT && visible.length < history.length && <button type="button" className="periods-more" onClick={() => setShowAll(true)}>Показать все {history.length}</button>}
      </Card>

      <div className="stack periods-detail">
        {error && <ErrorState error={error} />}
        {!week ? !weeks.isLoading && <Card><EmptyState title="Выберите неделю" hint={canImport ? "Откройте новую неделю или выберите неделю из истории" : "Выберите неделю из истории"} /></Card> : <>
          <Card className="periods-week-card" title={`Неделя ${weekRange(week)}`} subtitle={weekHint(week)} action={<Badge tone={STATUS_TONES[week.status]}>{WEEK_STATUS_LABELS[week.status]}</Badge>}>
            <ol className="periods-steps" aria-label="Этапы расчёта">{STEPS.map((step, index) => <li key={step.title} className={done[index] ? "is-done" : index === current ? "is-current" : undefined} aria-current={index === current ? "step" : undefined}>
              <span className="periods-steps__mark" aria-hidden="true">{done[index] ? <CheckIcon size={14} /> : index + 1}</span>
              <span className="periods-steps__text"><strong>{done[index] && <span className="sr-only">Выполнено: </span>}{step.title}</strong><small>{step.hint}</small></span>
            </li>)}</ol>
          </Card>

          {!closed && canImport && <Card title="Файл показателей недели" subtitle="CSV или XLSX. Повторная загрузка обновляет только переданные значения">
            <div className={`upload-zone periods-drop${dragging ? " is-dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); inspectFile(e.dataTransfer.files[0]); }}>
              <strong>{inspect.isPending ? "Проверяем строки и сотрудников…" : "Перетащите файл сюда"}</strong>
              <span className="secondary small">или</span>
              <input id={fileId} ref={fileInput} className="periods-file-input" type="file" accept=".csv,.xlsx" disabled={busy} onChange={(e) => inspectFile(e.target.files?.[0])} />
              <label htmlFor={fileId} className={`btn btn--secondary btn--m${busy ? " is-disabled" : ""}`}>Выбрать файл</label>
            </div>
            <details className="workflow-note ui-note"><summary>Как подготовить файл</summary>
              <p>Первая строка — названия колонок. Укажите логин сотрудника в колонке «Логин». Его можно посмотреть в карточке сотрудника.</p>
              <p>Можно использовать колонки «Логин», «Показатель», «Значение»: в показателе укажите его название из настроек. Или создайте отдельную колонку с названием каждого показателя. Пустая ячейка означает отсутствие данных.</p>
              <p>Перед сохранением система покажет ошибки. Проверка файла не изменяет показатели.</p>
            </details>
          </Card>}

          {inspected && <Card title="Проверка файла" subtitle={inspected.filename}>
            <ul className="periods-check" aria-label="Итог проверки">
              <li>{coins(inspected.total_rows)} {plural(inspected.total_rows, "строка", "строки", "строк")}</li>
              <li>{coins(inspected.operator_count)} {plural(inspected.operator_count, "оператор", "оператора", "операторов")}</li>
              <li className={inspected.errors.length ? "is-danger" : "is-ok"}>{inspected.errors.length ? `${coins(inspected.errors.length)} ${plural(inspected.errors.length, "ошибка", "ошибки", "ошибок")}` : "Ошибок нет"}</li>
              {!!inspected.warnings.length && <li className="is-warning">{coins(inspected.warnings.length)} {plural(inspected.warnings.length, "предупреждение", "предупреждения", "предупреждений")}</li>}
            </ul>
            <Issues title="Исправьте ошибки в файле" issues={inspected.errors} />
            <Issues title="Обратите внимание" issues={inspected.warnings} />
            <div className="periods-check__save"><span className="secondary small">Готово к загрузке: {coins(inspected.valid_values)} {plural(inspected.valid_values, "значение", "значения", "значений")}</span>
              {applied ? <Badge tone="success">Показатели сохранены</Badge> : <Button variant="primary" disabled={!inspected.can_apply || busy || closed} onClick={() => apply.mutate()}>{apply.isPending ? "Сохраняем…" : "Сохранить показатели"}</Button>}</div>
          </Card>}

          <Card className="periods-results-card" padded={false} title={closed ? "Опубликованные итоги" : "Предварительные итоги"} subtitle={resultsSummary(preview.data, closed)}
            action={!!preview.data?.rows.length && <p className="periods-total"><span><strong>{coins(preview.data.coins_total)}</strong> {plural(preview.data.coins_total, "коин", "коина", "коинов")}</span><small>{closed ? "начислено" : "будет начислено"}</small></p>}>
            {preview.isLoading && <div className="card__body"><Skeleton height={120} /></div>}
            {preview.isError && <ErrorState error={preview.error} onRetry={() => preview.refetch()} />}
            {preview.data && <PeriodResults data={preview.data} missingMetricsLabel={missingMetricsLabel} />}
            {!closed && <div className="periods-actions">{canPublish ? <>
              <span className="secondary small">{week.status === "calculated" ? "Расчёт готов. Проверьте итоги перед публикацией" : "Рассчитайте итоги, когда показатели загружены"}</span>
              <Button disabled={busy || (!!inspected && !applied)} onClick={() => calculate.mutate()}>{calculate.isPending ? "Рассчитываем…" : week.status === "calculated" ? "Пересчитать" : "Рассчитать"}</Button>
              <Button variant="primary" disabled={busy || week.status !== "calculated" || !preview.data?.rows.length || (!!inspected && !applied)} onClick={() => setConfirmPublish(true)}>Опубликовать итоги</Button>
            </> : <span className="secondary small">После загрузки передайте период руководителю: он выполнит расчёт и публикацию.</span>}</div>}
          </Card>
        </>}
      </div>
    </div>
    {monthly && <ReportsUpload onClose={() => setMonthly(false)} />}
    {confirmPublish && <Sheet title="Опубликовать итоги?" onClose={() => { if (!publish.isPending) setConfirmPublish(false); }} footer={<>
      <Button disabled={publish.isPending} onClick={() => setConfirmPublish(false)}>Отмена</Button>
      <Button variant="primary" disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? "Публикуем…" : "Подтвердить публикацию"}</Button></>}>
      <p>Период {week ? weekRange(week) : ""} будет закрыт. {preview.data?.participants} участникам будут начислены {coins(preview.data?.coins_total ?? 0)} коинов. Изменить показатели закрытой недели нельзя.</p>
      {preview.data?.rows.some((row) => row.missing_metrics?.length) && <p className="workflow-error">У части сотрудников не хватает показателей. Вернитесь к проверке, если загрузка ещё не закончена.</p>}
      {publish.isError && <ErrorState error={publish.error} />}
    </Sheet>}
  </div>;
}

/** The week's results: one line per operator with their place, points and what the coins are made of. */
function PeriodResults({ data, missingMetricsLabel }: { data: PeriodPreview; missingMetricsLabel: (codes: string[]) => string }) {
  return <>
    {!!data.missing_metrics.length && <p className="workflow-error periods-missing">Не загружены показатели: {missingMetricsLabel(data.missing_metrics)}. Проверьте полноту исходных данных.</p>}
    {!data.rows.length ? <EmptyState title="Расчёт ещё не подготовлен" hint="Сохраните показатели и нажмите «Рассчитать»" />
      : <ol className="periods-results">{data.rows.map((row) => <li key={row.user_id} className="periods-result">
        <span className={`periods-result__rank${row.rank !== null && row.rank <= 3 ? " is-top" : ""}`} aria-label={row.rank === null ? "Без места" : `${row.rank} место`}>{row.rank ?? "—"}</span>
        <div className="periods-result__main">
          <p className="periods-result__name"><strong>{row.full_name}</strong></p>
          <p className="periods-result__meta">{coinParts(row)}</p>
          {!!row.missing_metrics?.length && <p className="periods-result__missing">Нет данных: {missingMetricsLabel(row.missing_metrics)}</p>}
        </div>
        <span className="periods-result__points">{points(row.final_points)} {pointsWord(row.final_points)}</span>
        <span className="periods-result__coins">+{coins(row.coins_total)}<span>{plural(row.coins_total, "коин", "коина", "коинов")}</span></span>
      </li>)}</ol>}
  </>;
}

/** «12 участников · у 2 не хватает данных · до публикации коины не начисляются» */
export function resultsSummary(data: Pick<PeriodPreview, "participants" | "rows"> | undefined, closed: boolean): string {
  const note = closed ? "коины начислены при публикации" : "до публикации коины не начисляются";
  if (!data?.rows.length) return note.charAt(0).toLocaleUpperCase() + note.slice(1);
  const incomplete = data.rows.filter((row) => row.missing_metrics?.length).length;
  return [`${coins(data.participants)} ${plural(data.participants, "участник", "участника", "участников")}`, incomplete ? `у ${coins(incomplete)} не хватает данных` : "", note].filter(Boolean).join(" · ");
}

/** A score with a fraction is read «93,79 балла»; whole ones agree with the number. */
export function pointsWord(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? plural(rounded, "балл", "балла", "баллов") : "балла";
}

/** «за баллы 187 · дисциплина +40 · номинация +100»: only the parts that pay something. */
export function coinParts(row: Pick<PeriodPreview["rows"][number], "coins_from_points" | "coins_rank_bonus" | "coins_discipline_bonus" | "coins_nomination_bonus">): string {
  const parts = [`за баллы ${coins(row.coins_from_points)}`];
  if (row.coins_rank_bonus) parts.push(`место +${coins(row.coins_rank_bonus)}`);
  if (row.coins_discipline_bonus) parts.push(`дисциплина +${coins(row.coins_discipline_bonus)}`);
  if (row.coins_nomination_bonus) parts.push(`номинация +${coins(row.coins_nomination_bonus)}`);
  return parts.join(" · ");
}

function Issues({ title, issues }: { title: string; issues: ImportIssue[] }) {
  if (!issues.length) return null;
  return <div><h3 className="group-title">{title}</h3><ul className="workflow-issues">{issues.map((issue, i) => <li key={i}>{issue.row !== null ? `Строка ${issue.row}: ` : ""}{issue.message}</li>)}</ul></div>;
}

export function sortedWeeks(weeks: readonly WeekOut[]): WeekOut[] {
  return [...weeks].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
}

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shortDate = (value: string) => new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** Weeks that can be opened: from eight weeks back to two ahead, Monday to Sunday, without the ones already open; the current week first. */
export function newWeekChoices(weeks: readonly Pick<WeekOut, "starts_on">[], today = new Date()): { value: string; label: string }[] {
  const opened = new Set(weeks.map((week) => week.starts_on));
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
  const choices: { value: string; label: string; offset: number }[] = [];
  for (let offset = -8; offset <= 2; offset += 1) {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const value = dateKey(start);
    if (opened.has(value)) continue;
    const day = (date: Date) => `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
    const range = `${day(start)}–${day(end)}${end.getFullYear() !== today.getFullYear() ? `.${end.getFullYear()}` : ""}`;
    choices.push({ value, offset, label: offset === 0 ? `${range} · текущая` : offset === -1 ? `${range} · прошлая` : offset === 1 ? `${range} · следующая` : range });
  }
  // The current week, then the past ones back in time, then the weeks ahead.
  const rank = (offset: number) => offset <= 0 ? -offset : 100 + offset;
  return choices.sort((a, b) => rank(a.offset) - rank(b.offset)).map(({ value, label }) => ({ value, label }));
}

/** «12 недель · 10 закрыты · 2 в работе» */
export function historySummary(weeks: readonly Pick<WeekOut, "status">[]): string {
  if (!weeks.length) return "Недель пока нет: откройте первую, загрузите показатели и опубликуйте итоги";
  const closed = weeks.filter((week) => week.status === "closed").length;
  const active = weeks.length - closed;
  const parts = [`${weeks.length} ${plural(weeks.length, "неделя", "недели", "недель")}`];
  if (closed) parts.push(`${closed} ${plural(closed, "закрыта", "закрыты", "закрыто")}`);
  if (active) parts.push(`${active} в работе`);
  return parts.join(" · ");
}

/** The line under a week in the history: when its results were published or calculated. */
export function weekNote(week: Pick<WeekOut, "status" | "calculated_at" | "closed_at" | "starts_on" | "ends_on">, today = dateKey(new Date())): string {
  if (week.status === "closed") return week.closed_at ? `Итоги опубликованы ${shortDate(week.closed_at)}` : "Итоги опубликованы";
  if (week.status === "calculated") return week.calculated_at ? `Расчёт от ${shortDate(week.calculated_at)} ждёт публикации` : "Расчёт ждёт публикации";
  if (week.starts_on <= today && today <= week.ends_on) return "Текущая неделя";
  return week.ends_on < today ? "Ждёт расчёта" : "Ещё не началась";
}

function weekHint(week: WeekOut): string {
  if (week.status === "closed") return `Итоги опубликованы${week.closed_at ? ` ${shortDate(week.closed_at)}` : ""}. Изменить показатели закрытой недели нельзя`;
  if (week.status === "calculated") return "Проверьте итоги и опубликуйте их: тогда операторам начислятся коины";
  return "Загрузите показатели, затем рассчитайте итоги";
}
