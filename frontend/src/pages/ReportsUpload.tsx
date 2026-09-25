import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { reports, type ReportsResult } from "../api/periods";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, ErrorState, KPI } from "../components/ui";
import { coins, periodLabel, WEEK_STATUS_LABELS } from "../utils/format";

const KIND_LABELS = { team: "Отчёт команды", quality: "Оценки проверяющих", unknown: "Не распознан" } as const;
const KIND_TONES = { team: "accent", quality: "accent", unknown: "danger" } as const;

/** Monthly SZoV reports as exported: every day for analytics, full weeks for the contest. */
export function ReportsUpload({ onSaved }: { onSaved?: () => void }) {
  const { atLeast } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<ReportsResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const inspect = useMutation({
    mutationFn: async ({ list, chosen, revision }: { list: File[]; chosen: string; revision: number }) =>
      ({ data: await reports.inspect(list, chosen), revision }),
    onSuccess: ({ data, revision }) => { if (revision === generation.current) setResult(data); },
  });
  const save = useMutation({
    mutationFn: () => reports.save(files, month),
    onSuccess: (data) => {
      setResult(data); setSaved(true);
      for (const key of ["periods", "period-preview", "weeks", "dashboard", "rating", "admin-summary", "analytics"])
        void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(data.detail ?? "Отчёты загружены");
      onSaved?.();
    },
  });
  const busy = inspect.isPending || save.isPending;

  const choose = (list: File[], chosen = month) => {
    const xlsx = list.filter((file) => file.name.toLowerCase().endsWith(".xlsx"));
    generation.current += 1;
    setFiles(xlsx); setResult(null); setSaved(false); save.reset();
    if (xlsx.length) inspect.mutate({ list: xlsx, chosen, revision: generation.current });
    else inspect.reset();
  };
  const changeMonth = (value: string) => { setMonth(value); if (files.length) choose(files, value); };
  const clear = () => { choose([]); if (input.current) input.current.value = ""; };

  return <Card title="Месячные отчёты СЗоВ"
    subtitle="Загрузите отчёты команд (report_…) и оценки проверяющих (monthly_report_dates_…) — всё остальное сайт посчитает сам">
    <div className={`upload-zone${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) choose(Array.from(e.dataTransfer.files)); }}>
      <strong>{inspect.isPending ? "Читаем отчёты…" : files.length ? `Выбрано файлов: ${files.length}` : "Перетащите сюда все файлы за месяц"}</strong>
      <label className="field"><span className="field__label">или выберите на устройстве (можно несколько)</span>
        <input ref={input} type="file" multiple accept=".xlsx" disabled={busy} onChange={(e) => choose(Array.from(e.target.files ?? []))} /></label>
      <label className="field"><span className="field__label">Месяц — если не указан в названии файлов</span>
        <input type="month" className="input" value={month} disabled={busy} onChange={(e) => changeMonth(e.target.value)} /></label>
    </div>
    {inspect.isError && <ErrorState error={inspect.error} />}
    {result && <div className="stack" style={{ marginTop: "var(--sp-5)" }}>
      <ul className="workflow-issues">{result.files.map((file) => <li key={file.filename}>
        <Badge tone={KIND_TONES[file.kind]}>{KIND_LABELS[file.kind]}</Badge> {file.filename}{file.kind !== "unknown" && ` · ${coins(file.people)} чел.`}
      </li>)}</ul>
      <div className="kpi-grid"><KPI label="Месяц" value={result.month} /><KPI label="Операторов найдено" value={coins(result.matched)} />
        <KPI label="Не найдено на сайте" value={coins(result.unmatched.length)} /><KPI label="Дневных значений" value={coins(result.day_values)} /></div>
      {!!result.unmatched.length && <details className="workflow-note"><summary>Кого нет на сайте ({result.unmatched.length})</summary>
        <p>Их данные пропущены. Проверьте ФИО в карточке сотрудника: оно должно совпадать с отчётом.</p>
        <p>{result.unmatched.join(", ")}</p></details>}
      <div><h3 className="group-title">Недели месяца</h3>
        <ul className="workflow-issues">{result.weeks.map((week) => <li key={week.label}>
          {periodLabel(week.starts_on, week.ends_on)} · {coins(week.operators)} операторов · {week.status === "closed" ? "закрыта, не изменится" : week.status === "new" ? "будет открыта" : WEEK_STATUS_LABELS[week.status] ?? week.status}
        </li>)}</ul>
        <p className="workflow-note">Каждый день месяца попадёт в аналитику по дням и месяцам. Неполные недели на краях месяца идут только в дни. Коины не начисляются — итоги недели публикуются как обычно.
          {!atLeast("head") && " Рейтинг пересчитает руководитель."}</p>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className="workflow-actions">
        {saved ? <Badge tone="success">{result.detail ?? "Сохранено"}</Badge>
          : <Button variant="primary" disabled={busy || !result.matched} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Сохранить показатели"}</Button>}
        <Button disabled={busy} onClick={clear}>{saved ? "Загрузить другие" : "Сбросить"}</Button>
      </div>
    </div>}
  </Card>;
}
