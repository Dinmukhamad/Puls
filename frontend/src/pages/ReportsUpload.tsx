import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { reports, type ReportsResult } from "../api/periods";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, ErrorState, Select } from "../components/ui";
import { coins, periodLabel, plural, WEEK_STATUS_LABELS } from "../utils/format";

const KIND_LABELS = { team: "Отчёт команды", quality: "Оценки проверяющих", unknown: "Не распознан" } as const;
const KIND_TONES = { team: "accent", quality: "accent", unknown: "danger" } as const;

/** «Октябрь 2026» for "2026-10". */
export function monthName(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const name = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** The month field's list: the files' own month first, then this month and eleven before it. */
export function reportMonths(today = new Date()): { value: string; label: string }[] {
  return [{ value: "", label: "Из названий файлов" }, ...Array.from({ length: 12 }, (_, back) => {
    const date = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { value, label: monthName(value) };
  })];
}

/** Monthly SZoV reports as exported: every day for analytics, full weeks for the contest. */
export function ReportsUpload({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { atLeast } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<ReportsResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
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

  return <Sheet title="Отчёты за месяц" subtitle="Месячные отчёты СЗоВ" size="l" onClose={() => { if (!busy) onClose(); }} footer={saved ? <>
    <Button disabled={busy} onClick={clear}>Загрузить другие</Button>
    <Button variant="primary" onClick={onClose}>Готово</Button>
  </> : result ? <>
    <Button disabled={busy} onClick={clear}>Сбросить</Button>
    <Button variant="primary" disabled={busy || !result.matched} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Сохранить показатели"}</Button>
  </> : <Button disabled={busy} onClick={onClose}>Закрыть</Button>}>
    <div className="stack reports-upload">
      <p className="secondary">Загрузите отчёты команд (report_…) и оценки проверяющих (monthly_report_dates_…) — всё остальное сайт посчитает сам.</p>
      <div className={`upload-zone periods-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) choose(Array.from(e.dataTransfer.files)); }}>
        <strong>{inspect.isPending ? "Читаем отчёты…" : files.length ? `Выбрано ${files.length} ${plural(files.length, "файл", "файла", "файлов")}` : "Перетащите сюда все файлы за месяц"}</strong>
        <span className="secondary small">или</span>
        <input id={inputId} ref={input} className="periods-file-input" type="file" multiple accept=".xlsx" disabled={busy} onChange={(e) => choose(Array.from(e.target.files ?? []))} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--m${busy ? " is-disabled" : ""}`}>{files.length ? "Выбрать другие файлы" : "Выбрать файлы"}</label>
      </div>
      <label className="field reports-upload__month"><span className="field__label">Месяц</span>
        <Select aria-label="Месяц отчётов" value={month} disabled={busy} options={reportMonths()} onChange={changeMonth} />
        <span className="muted micro">Укажите, если месяца нет в названиях файлов</span></label>
      {inspect.isError && <ErrorState error={inspect.error} />}
      {result && <>
        <ul className="periods-check" aria-label="Итог чтения отчётов">
          <li>{monthName(result.month)}</li>
          <li className={result.matched ? "is-ok" : "is-danger"}>{coins(result.matched)} {plural(result.matched, "оператор найден", "оператора найдено", "операторов найдено")}</li>
          {!!result.unmatched.length && <li className="is-warning">{coins(result.unmatched.length)} нет на сайте</li>}
          <li>{coins(result.day_values)} {plural(result.day_values, "дневное значение", "дневных значения", "дневных значений")}</li>
        </ul>
        <section className="reports-upload__group"><h3 className="group-title">Файлы</h3>
          <ul className="reports-upload__rows">{result.files.map((file) => <li key={file.filename}>
            <span className="reports-upload__name">{file.filename}</span>
            <span className="reports-upload__meta">{file.kind !== "unknown" && `${coins(file.people)} чел.`}<Badge tone={KIND_TONES[file.kind]}>{KIND_LABELS[file.kind]}</Badge></span>
          </li>)}</ul></section>
        {!!result.unmatched.length && <details className="workflow-note ui-note"><summary>Кого нет на сайте ({result.unmatched.length})</summary>
          <p>Их данные пропущены. Проверьте ФИО в карточке сотрудника: оно должно совпадать с отчётом.</p>
          <p>{result.unmatched.join(", ")}</p></details>}
        <section className="reports-upload__group"><h3 className="group-title">Недели месяца</h3>
          <ul className="reports-upload__rows">{result.weeks.map((week) => <li key={week.label}>
            <span className="reports-upload__name">{periodLabel(week.starts_on, week.ends_on)}</span>
            <span className="reports-upload__meta">{coins(week.operators)} {plural(week.operators, "оператор", "оператора", "операторов")} · {week.status === "closed" ? "закрыта, не изменится" : week.status === "new" ? "будет открыта" : (WEEK_STATUS_LABELS[week.status] ?? week.status).toLocaleLowerCase()}</span>
          </li>)}</ul>
          <p className="secondary small">Каждый день месяца попадёт в аналитику по дням и месяцам. Неполные недели на краях месяца идут только в дни. Коины не начисляются — итоги недели публикуются как обычно.
            {!atLeast("head") && " Рейтинг пересчитает руководитель."}</p>
        </section>
        {saved && <Badge tone="success">{result.detail ?? "Сохранено"}</Badge>}
        {save.isError && <ErrorState error={save.error} />}
      </>}
    </div>
  </Sheet>;
}
