import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { periods, type ImportIssue, type ImportPreview } from "../api/periods";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Skeleton } from "../components/ui";
import { coins, points, periodLabel, WEEK_STATUS_LABELS } from "../utils/format";
import "./workflow.css";

const steps = ["Файл", "Проверка", "Предпросмотр", "Расчёт", "Публикация"];

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
  const preview = useQuery({ queryKey: ["period-preview", selected],
    queryFn: () => periods.preview(selected!), enabled: !!selected });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [inspected, setInspected] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const step = closed ? 4 : calculate.isPending ? 3 : applied || week?.status === "calculated" ? 3 : inspected ? 2 : inspect.isPending ? 1 : 0;
  const error = create.error || inspect.error || apply.error || calculate.error;

  return <div className="stack">
    <div className="page-head"><div><h1 className="page-title">Расчёт периода</h1>
      <p className="page-subtitle">Загрузите показатели, проверьте результат и опубликуйте итоги недели</p></div></div>
    <Card title="Отчётная неделя">
      <div className="workflow-toolbar">
        <label className="field"><span className="field__label">Период</span>
          <select className="input" value={selected ?? ""} disabled={busy} onChange={(e) => selectWeek(Number(e.target.value) || undefined)}>
            <option value="">Выберите неделю</option>
            {weeks.data?.map((item) => <option key={item.id} value={item.id}>{item.label} · {WEEK_STATUS_LABELS[item.status]}</option>)}
          </select></label>
        {canImport && <><label className="field"><span className="field__label">Дата внутри новой недели</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} disabled={create.isPending || busy} /></label>
        <Button disabled={!date || create.isPending || busy} onClick={() => create.mutate()}>{create.isPending ? "Открываем…" : "Открыть неделю"}</Button></>}
      </div>
      {weeks.isLoading && <Skeleton height={44} />}
      {weeks.isError && <ErrorState error={weeks.error} onRetry={() => weeks.refetch()} />}
      {week && <p className="workflow-note">{periodLabel(week.starts_on, week.ends_on)} · <Badge tone={closed ? "success" : "accent"}>{WEEK_STATUS_LABELS[week.status]}</Badge></p>}
    </Card>
    {error && <ErrorState error={error} />}
    {!selected ? <EmptyState title="Выберите период для работы" hint="Можно открыть новую неделю или продолжить ранее созданную" /> : <>
      <ol className="workflow-steps" aria-label="Этапы расчёта">{steps.map((label, index) => <li key={label} className="workflow-step" aria-current={index === step ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      {!closed && canImport && <Card title="1. Загрузка показателей" subtitle="CSV или XLSX. Повторная загрузка обновляет только переданные значения.">
        <div className={`upload-zone${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); inspectFile(e.dataTransfer.files[0]); }}>
          <strong>{inspect.isPending ? "Проверяем строки и сотрудников…" : "Перетащите файл сюда"}</strong>
          <label className="field"><span className="field__label">или выберите на устройстве</span>
            <input ref={fileInput} type="file" accept=".csv,.xlsx" disabled={busy} onChange={(e) => inspectFile(e.target.files?.[0])} /></label>
        </div>
        <details className="workflow-note"><summary>Как подготовить файл</summary>
          <p>Первая строка — названия колонок. Укажите логин сотрудника в колонке login или его числовой идентификатор в user_id.</p>
          <p>Длинный формат: login, metric_code, value. Широкий формат: login и отдельная колонка для каждого кода показателя. Пустая ячейка означает отсутствие данных.</p>
          <p>Перед сохранением система покажет ошибки. Проверка файла не изменяет показатели.</p>
        </details>
      </Card>}
      {inspected && <Card title="2. Проверка файла" subtitle={inspected.filename}>
        <div className="kpi-grid"><KPI label="Строк" value={coins(inspected.total_rows)} /><KPI label="Операторов" value={coins(inspected.operator_count)} />
          <KPI label="Ошибок" value={coins(inspected.errors.length)} /><KPI label="Предупреждений" value={coins(inspected.warnings.length)} /></div>
        <Issues title="Исправьте ошибки в файле" issues={inspected.errors} />
        <Issues title="Обратите внимание" issues={inspected.warnings} />
        <p className="workflow-note">Готово к загрузке: {coins(inspected.valid_values)} значений.</p>
        {applied ? <Badge tone="success">Показатели сохранены</Badge> : <Button variant="primary" disabled={!inspected.can_apply || busy || closed} onClick={() => apply.mutate()}>{apply.isPending ? "Сохраняем…" : "Сохранить показатели"}</Button>}
      </Card>}
      <Card title={closed ? "Опубликованные итоги" : "3. Предварительные итоги"} subtitle="До публикации коины не начисляются">
        {preview.isLoading && <Skeleton height={120} />}
        {preview.isError && <ErrorState error={preview.error} onRetry={() => preview.refetch()} />}
        {preview.data && <>
          <div className="kpi-grid kpi-grid--2"><KPI label="Участников" value={coins(preview.data.participants)} /><KPI label={closed ? "Коины по итогам" : "Будет начислено"} value={coins(preview.data.coins_total)} tone="coin" /></div>
          {!!preview.data.missing_metrics.length && <p className="workflow-error">Не загружены показатели: {preview.data.missing_metrics.join(", ")}. Проверьте полноту исходных данных.</p>}
          {!preview.data.rows.length && <EmptyState title="Расчёт ещё не подготовлен" hint="Сохраните показатели и нажмите «Рассчитать»" />}
          <div className="workflow-results">{preview.data.rows.map((row) => <article key={row.user_id} className="workflow-result">
            <div><strong>{row.full_name}</strong><p className="small secondary">Место: {row.rank ?? "—"}</p>
              {!!row.missing_metrics?.length && <p className="small">Нет данных: {row.missing_metrics.join(", ")}</p>}</div>
            <div className="workflow-stats"><span>{points(row.final_points)} баллов</span><strong>{coins(row.coins_total)} коинов</strong></div>
          </article>)}</div>
        </>}
        {!closed && (canPublish ? <div className="workflow-actions" style={{ marginTop: "var(--sp-5)" }}>
          <Button disabled={busy || (!!inspected && !applied)} onClick={() => calculate.mutate()}>{calculate.isPending ? "Рассчитываем…" : "Рассчитать"}</Button>
          <Button variant="primary" disabled={busy || week?.status !== "calculated" || !preview.data?.rows.length || (!!inspected && !applied)} onClick={() => setConfirmPublish(true)}>Опубликовать итоги</Button>
        </div> : <p className="workflow-note">После загрузки передайте период руководителю: он выполнит расчёт и публикацию.</p>)}
      </Card>
    </>}
    {confirmPublish && <Sheet title="Опубликовать итоги?" onClose={() => { if (!publish.isPending) setConfirmPublish(false); }} footer={<>
      <Button disabled={publish.isPending} onClick={() => setConfirmPublish(false)}>Отмена</Button>
      <Button variant="primary" disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? "Публикуем…" : "Подтвердить публикацию"}</Button></>}>
      <p>Период {week?.label} будет закрыт. {preview.data?.participants} участникам будут начислены {coins(preview.data?.coins_total ?? 0)} коинов. Изменить показатели закрытой недели нельзя.</p>
      {preview.data?.rows.some((row) => row.missing_metrics?.length) && <p className="workflow-error">У части сотрудников не хватает показателей. Вернитесь к проверке, если загрузка ещё не закончена.</p>}
      {publish.isError && <ErrorState error={publish.error} />}
    </Sheet>}
  </div>;
}

function Issues({ title, issues }: { title: string; issues: ImportIssue[] }) {
  if (!issues.length) return null;
  return <div><h3 className="group-title">{title}</h3><ul className="workflow-issues">{issues.map((issue, i) => <li key={i}>{issue.row !== null ? `Строка ${issue.row}: ` : ""}{issue.message}</li>)}</ul></div>;
}
