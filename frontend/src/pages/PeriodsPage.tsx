import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { periods, type ImportIssue, type ImportPreview } from "../api/periods";
import { configuration } from "../api/configuration";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, KPI, Skeleton } from "../components/ui";
import { ChevronRightIcon } from "../components/icons";
import { weekRange } from "../components/weekCalendar";
import { DatePicker } from "../components/DateRangePicker";
import { todayDateKey } from "../components/dateRange";
import { FileDrop } from "../components/FileDrop";
import { coins, dateOnly, plural, points, periodLabel, WEEK_STATUS_LABELS } from "../utils/format";
import type { WeekOut } from "../api/types";
import { ReportsUpload } from "./ReportsUpload";
import "./workflow.css";

const steps = ["Загрузка", "Проверка", "Расчёт", "Публикация"];
const STATUS_TONES = { open: "accent", calculated: "warning", closed: "success" } as const;

/** What a period's status means for the one who opens it, and what to do next. */
export function periodNext(week: Pick<WeekOut, "status" | "calculated_at" | "closed_at">): string {
  if (week.status === "closed") return week.closed_at ? `Итоги опубликованы ${dateOnly(week.closed_at)}` : "Итоги опубликованы";
  if (week.status === "calculated") return `Рассчитана${week.calculated_at ? ` ${dateOnly(week.calculated_at)}` : ""} · проверьте итоги и опубликуйте`;
  return "Идёт · загрузите показатели и рассчитайте";
}

export function PeriodsPage() {
  const [params] = useSearchParams();
  return <PeriodWorkspace key={params.get("week") ?? "new"} />;
}

function PeriodWorkspace() {
  const { atLeast } = useAuth();
  const canPublish = atLeast("head");
  const canImport = atLeast("supervisor");
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("week")) || undefined;
  const weeks = useQuery({ queryKey: ["periods"], queryFn: periods.list });
  const week = weeks.data?.find((item) => item.id === selected);
  const metrics = useQuery({ queryKey: ["configuration", "metrics"], queryFn: () => configuration.definitions("metrics"), enabled: !!selected });
  const metricNames = new Map(metrics.data?.map(metric => [metric.code, metric.title]));
  const missingMetricsLabel = (codes: string[]) => codes.map(code => metricNames.get(code) ?? "Название показателя недоступно").join(", ");
  const preview = useQuery({ queryKey: ["period-preview", selected],
    queryFn: () => periods.preview(selected!), enabled: !!selected });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(() => todayDateKey());
  const [inspected, setInspected] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [opening, setOpening] = useState(false);
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
  };
  const create = useMutation({ mutationFn: () => periods.create(date), onSuccess: (created) => {
    refresh(); selectWeek(created.id); toast.success("Период открыт");
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
  const step = closed ? 4 : week?.status === "calculated" && !(inspected && !applied) ? 3 : inspected && !applied ? 1 : applied ? 2 : 0;
  const error = create.error || inspect.error || apply.error || calculate.error;
  const history = [...(weeks.data ?? [])].sort((x, y) => y.starts_on.localeCompare(x.starts_on));
  const common = new Set(preview.data?.missing_metrics ?? []);

  return <div className="stack periods-page">
    <div className="page-head"><div><h1 className="page-title">Расчёт и история периодов</h1>
      <p className="page-subtitle">Недели конкурса: загрузите показатели, рассчитайте и опубликуйте итоги — тогда операторы получат коины.</p></div>
      {canImport && !selected && <div className="page-head__actions"><Button variant="primary" onClick={() => setOpening(true)}>Открыть неделю</Button></div>}</div>
    {error && <ErrorState error={error} />}
    {!selected ? <>
      <Card title="Периоды" subtitle={weeks.data ? `${history.length} ${plural(history.length, "неделя", "недели", "недель")} · новые сверху` : undefined} padded={false} className="periods-list">
        {weeks.isLoading && <div className="card__body"><Skeleton height={120} /></div>}
        {weeks.isError && <div className="card__body"><ErrorState error={weeks.error} onRetry={() => weeks.refetch()} /></div>}
        {weeks.data && !history.length && <EmptyState title="Недель пока нет" hint={canImport ? "Откройте неделю или загрузите месячные отчёты СЗоВ — недели появятся сами." : "Недели появятся, когда супервайзер загрузит показатели."} />}
        {history.length > 0 && <ul className="period-rows">{history.map(item => <li key={item.id}><button type="button" className="period-row" onClick={() => selectWeek(item.id)}>
          <span className="period-row__main"><strong>{periodLabel(item.starts_on, item.ends_on)}</strong><span>{periodNext(item)}</span></span>
          <Badge tone={STATUS_TONES[item.status as keyof typeof STATUS_TONES] ?? "neutral"}>{WEEK_STATUS_LABELS[item.status]}</Badge>
          <ChevronRightIcon size={16} />
        </button></li>)}</ul>}
      </Card>
      {canImport && <ReportsUpload />}
    </> : <>
      <button type="button" className="periods-back" onClick={() => selectWeek()}>← Все периоды</button>
      <Card className="period-head">
        <div className="period-head__main">
          <div className="period-head__title"><h2>{week ? periodLabel(week.starts_on, week.ends_on) : "Период"}</h2>{week && <Badge tone={STATUS_TONES[week.status as keyof typeof STATUS_TONES] ?? "neutral"}>{WEEK_STATUS_LABELS[week.status]}</Badge>}</div>
          <p>{week ? periodNext(week) : weeks.isLoading ? "Загружаем период…" : "Период не найден"}</p>
        </div>
        {!closed && week && (canPublish ? <div className="period-head__actions">
          <Button disabled={busy || (!!inspected && !applied)} onClick={() => calculate.mutate()}>{calculate.isPending ? "Рассчитываем…" : week.status === "calculated" ? "Пересчитать" : "Рассчитать"}</Button>
          <Button variant="primary" disabled={busy || week.status !== "calculated" || !preview.data?.rows.length || (!!inspected && !applied)} onClick={() => setConfirmPublish(true)}>Опубликовать итоги</Button>
        </div> : <p className="period-head__note">После загрузки передайте период руководителю: он рассчитает и опубликует итоги.</p>)}
      </Card>
      <ol className="workflow-steps" aria-label="Этапы расчёта">{steps.map((label, index) => <li key={label} className={`workflow-step${index < step ? " is-done" : ""}`} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : index + 1}</span>{label}</li>)}</ol>
      {!closed && canImport && <Card title="Загрузка показателей" subtitle="CSV или XLSX. Повторная загрузка обновляет только переданные значения.">
        <FileDrop accept=".csv,.xlsx" disabled={busy} onFiles={list => inspectFile(list[0])}
          title={inspected ? `Проверен файл «${inspected.filename}»` : "Перетащите файл сюда"} busy={inspect.isPending && "Проверяем строки и сотрудников…"} hint="CSV или XLSX с колонкой «Логин»." button={inspected ? "Выбрать другой файл" : undefined} />
        {inspected && <div className="period-check">
          <div className="kpi-grid"><KPI label="Строк" value={coins(inspected.total_rows)} /><KPI label="Операторов" value={coins(inspected.operator_count)} />
            <KPI label="Ошибок" value={coins(inspected.errors.length)} tone={inspected.errors.length ? "accent" : "neutral"} /><KPI label="Предупреждений" value={coins(inspected.warnings.length)} /></div>
          <Issues title="Исправьте ошибки в файле" issues={inspected.errors} />
          <Issues title="Обратите внимание" issues={inspected.warnings} />
          <div className="period-check__save"><span>Готово к загрузке: {coins(inspected.valid_values)} {plural(inspected.valid_values, "значение", "значения", "значений")}.</span>
            {applied ? <Badge tone="success">Показатели сохранены</Badge> : <Button variant="primary" disabled={!inspected.can_apply || busy || closed} onClick={() => apply.mutate()}>{apply.isPending ? "Сохраняем…" : "Сохранить показатели"}</Button>}</div>
        </div>}
        <details className="workflow-note ui-note"><summary>Как подготовить файл</summary>
          <p>Первая строка — названия колонок. Укажите логин сотрудника в колонке «Логин». Его можно посмотреть в окне сотрудника в «Команде».</p>
          <p>Можно использовать колонки «Логин», «Показатель», «Значение»: в показателе укажите его название из настроек. Или создайте отдельную колонку с названием каждого показателя. Пустая ячейка означает отсутствие данных.</p>
          <p>Перед сохранением система покажет ошибки. Проверка файла не изменяет показатели.</p>
        </details>
      </Card>}
      <Card title={closed ? "Опубликованные итоги" : "Предварительные итоги"} subtitle={closed ? "Коины начислены при публикации" : "До публикации коины не начисляются"} padded={false} className="period-results-card">
        {preview.isLoading && <div className="card__body"><Skeleton height={120} /></div>}
        {preview.isError && <div className="card__body"><ErrorState error={preview.error} onRetry={() => preview.refetch()} /></div>}
        {preview.data && <>
          <div className="card__body period-results-summary">
            <div className="kpi-grid kpi-grid--2"><KPI label="Участников" value={coins(preview.data.participants)} /><KPI label={closed ? "Начислено коинов" : "Будет начислено"} value={coins(preview.data.coins_total)} tone="coin" /></div>
            {!!preview.data.missing_metrics.length && <p className="workflow-error">Ни у кого нет данных: {missingMetricsLabel(preview.data.missing_metrics)}. Если они должны быть, загрузите их перед публикацией.</p>}
          </div>
          {!preview.data.rows.length ? <EmptyState title="Расчёт ещё не подготовлен" hint={canPublish ? "Сохраните показатели и нажмите «Рассчитать» вверху." : "Руководитель рассчитает период после загрузки показателей."} />
            : <ol className="period-results" aria-label="Итоги операторов">
              <li className="period-result period-result--head" aria-hidden="true"><span>Место</span><span>Оператор</span><span>Баллы</span><span>Коины</span></li>
              {preview.data.rows.map(row => {
                const own = (row.missing_metrics ?? []).filter(code => !common.has(code));
                const parts = [[row.coins_from_points, "за баллы"], [row.coins_rank_bonus, "за место"], [row.coins_discipline_bonus, "дисциплина"], [row.coins_nomination_bonus, "номинации"]].filter(([value]) => Number(value) !== 0).map(([value, label]) => `${label} ${coins(Number(value))}`);
                return <li key={row.user_id} className="period-result">
                  <span className={`period-result__rank${row.rank != null && row.rank <= 3 ? " is-top" : ""}`}>{row.rank ?? "—"}</span>
                  <span className="period-result__person"><Avatar name={row.full_name} id={row.user_id} size={32} /><span><strong>{row.full_name}</strong>{row.channel === "chat" && <Badge tone="info">Чаты · место среди чатов</Badge>}{own.length > 0 && <small className="period-result__missing">Нет данных: {missingMetricsLabel(own)}</small>}</span></span>
                  <span className="period-result__points">{points(row.final_points)}</span>
                  <span className="period-result__coins"><strong>{coins(row.coins_total)}</strong>{parts.length > 1 && <small>{parts.join(" · ")}</small>}</span>
                </li>;
              })}
            </ol>}
        </>}
      </Card>
    </>}
    {opening && <Sheet title="Открыть неделю" subtitle="Неделя конкурса — с понедельника по воскресенье" size="s" onClose={() => { if (!create.isPending) setOpening(false); }}
      footer={<><Button disabled={create.isPending} onClick={() => setOpening(false)}>Отмена</Button><Button variant="primary" disabled={!date || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Открываем…" : "Открыть неделю"}</Button></>}>
      <div className="stack"><label className="field"><span className="field__label">Любой день недели</span><DatePicker ariaLabel="Любой день недели" value={date} onChange={setDate} disabled={create.isPending} /></label>
        <p className="field__note">Если эта неделя уже открыта, откроется она — дубликат не создастся.</p>
        {create.isError && <ErrorState error={create.error} />}</div>
    </Sheet>}
    {confirmPublish && <Sheet title="Опубликовать итоги?" onClose={() => { if (!publish.isPending) setConfirmPublish(false); }} footer={<>
      <Button disabled={publish.isPending} onClick={() => setConfirmPublish(false)}>Отмена</Button>
      <Button variant="primary" disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? "Публикуем…" : "Подтвердить публикацию"}</Button></>}>
      <p>Период {week ? weekRange(week) : ""} будет закрыт. {preview.data?.participants} участникам будут начислены {coins(preview.data?.coins_total ?? 0)} коинов. Изменить показатели закрытой недели нельзя.</p>
      {preview.data?.rows.some((row) => row.missing_metrics?.length) && <p className="workflow-error">У части сотрудников не хватает показателей. Вернитесь к проверке, если загрузка ещё не закончена.</p>}
      {publish.isError && <ErrorState error={publish.error} />}
    </Sheet>}
  </div>;
}

function Issues({ title, issues }: { title: string; issues: ImportIssue[] }) {
  if (!issues.length) return null;
  return <div><h3 className="group-title">{title}</h3><ul className="workflow-issues">{issues.map((issue, i) => <li key={i}>{issue.row !== null ? `Строка ${issue.row}: ` : ""}{issue.message}</li>)}</ul></div>;
}
