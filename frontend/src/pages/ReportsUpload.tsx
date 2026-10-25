import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileDrop } from "../components/FileDrop";
import { monthOptions } from "../components/dateRange";
import { reports, type ReportsResult } from "../api/periods";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, ErrorState, KPI, Select } from "../components/ui";
import { coins, periodLabel, plural } from "../utils/format";

const KIND_LABELS = { line: "Линия · отчёт команды", chat: "Чаты · отчёт команды", quality: "Оценки проверяющих", unknown: "Не распознан" } as const;
const KIND_TONES = { line: "accent", chat: "accent", quality: "accent", unknown: "danger" } as const;

/** «весь месяц», «по 16.10» or «линия по 19.10 · чаты по 15.10»: how far the team reports go. */
/** «Октябрь 2026» for «2026-10». */
export const monthName = (key: string) => { const [year, month] = key.split("-").map(Number); const name = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""); return name.charAt(0).toUpperCase() + name.slice(1); };
const operatorsWord = (count: number) => `${coins(count)} ${plural(count, "оператор", "оператора", "операторов")}`;

/** The month's weeks in order: written now, waiting for days, or published and left as they are. */
export function monthWeeks(result: Pick<ReportsResult, "weeks" | "pending">) {
  return [
    ...result.weeks.map((week) => ({ ...week, state: week.status === "closed" ? "closed" as const : "saved" as const, reason: "" })),
    ...(result.pending ?? []).map((week) => ({ ...week, status: "pending", state: "pending" as const })),
  ].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}
const WEEK_STATES = {
  saved: { label: "Запишется", tone: "accent" },
  pending: { label: "Ждёт", tone: "neutral" },
  closed: { label: "Опубликована", tone: "success" },
} as const;

export function reportedTo(result: Pick<ReportsResult, "month" | "reported_to">): string {
  const entries = Object.entries(result.reported_to ?? {}) as ["line" | "chat", string][];
  if (!entries.length) return "нет отчёта команды";
  const [year, month] = result.month.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  if (entries.every(([, day]) => day === end)) return "весь месяц";
  const date = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  if (entries.every(([, day]) => day === entries[0][1])) return `по ${date(entries[0][1])}`;
  return entries.map(([channel, day]) => `${channel === "line" ? "линия" : "чаты"} ${day === end ? "весь месяц" : `по ${date(day)}`}`).join(" · ");
}

/** Monthly SZoV reports as exported: every reported day for analytics, each week once all its days are in. */
export function ReportsUpload({ onSaved }: { onSaved?: () => void }) {
  const { atLeast } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<ReportsResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
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
    // Перетаскивание обходит accept: о чужих файлах говорим, а выбранные не сбрасываем.
    setRejected(list.filter((file) => !xlsx.includes(file)).map((file) => file.name));
    if (list.length && !xlsx.length) return;
    generation.current += 1;
    setFiles(xlsx); setResult(null); setSaved(false); save.reset();
    if (xlsx.length) inspect.mutate({ list: xlsx, chosen, revision: generation.current });
    else inspect.reset();
  };
  const changeMonth = (value: string) => { setMonth(value); if (files.length) choose(files, value); };
  const clear = () => choose([]);

  return <Card title="Месячные отчёты СЗоВ"
    subtitle="Отчёты команд (report_…) и оценки проверяющих (monthly_report_dates_…) — остальное сайт посчитает сам">
    <div className="reports-upload">
      <FileDrop accept=".xlsx" multiple disabled={busy} files={files} onFiles={list => choose(list)}
        title={files.length ? `Выбрано файлов: ${files.length}` : "Перетащите сюда все файлы за месяц"} busy={inspect.isPending && "Читаем отчёты…"}
        hint="Файлы XLSX из СЗоВ, можно сразу несколько." />
      {rejected.length > 0 && <p className="field__note" role="alert">Пропущены файлы не в формате XLSX: {rejected.join(", ")}</p>}
      <label className="field reports-upload__month"><span className="field__label">Месяц</span>
        <Select aria-label="Месяц отчётов" value={month} disabled={busy} onChange={changeMonth} options={[{ value: "", label: "Из названий файлов" }, ...monthOptions()]} />
        <span className="field__note">Укажите, если месяца нет в названии файлов.</span></label>
    </div>
    {inspect.isError && <ErrorState error={inspect.error} />}
    {result && <div className="stack" style={{ marginTop: "var(--sp-5)" }}>
      <ul className="workflow-issues">{result.files.map((file) => <li key={file.filename}>
        <Badge tone={KIND_TONES[file.kind]}>{KIND_LABELS[file.kind]}</Badge> {file.filename}{file.kind !== "unknown" && ` · ${coins(file.people)} чел.`}
      </li>)}</ul>
      <div className="kpi-grid reports-upload__kpis"><KPI label="Месяц" value={monthName(result.month)} /><KPI label="Данные команд" value={reportedTo(result)} /><KPI label="Операторов найдено" value={coins(result.matched)} />
        <KPI label="Не найдено на сайте" value={coins(result.unmatched.length)} /><KPI label="Дневных значений" value={coins(result.day_values)} /></div>
      {!!result.unmatched.length && <details className="workflow-note ui-note"><summary>Кого нет на сайте ({result.unmatched.length})</summary>
        <p>Их данные пропущены. Проверьте ФИО в карточке сотрудника: оно должно совпадать с отчётом.</p>
        <p>{result.unmatched.join(", ")}</p></details>}
      {result.notes?.map((note) => <details key={note.code} className="workflow-note ui-note"><summary>{note.title} ({note.names.length})</summary>
        <p>{note.names.join(", ")}</p></details>)}
      <div><h3 className="group-title reports-upload__weeks-title">Недели месяца</h3>
        {!result.weeks.length && !result.pending?.length && <p className="small secondary">Ни одна неделя ещё не собрана целиком.</p>}
        <ul className="reports-upload__weeks">{monthWeeks(result).map((week) => <li key={`${week.state}-${week.label}`}>
          <Badge tone={WEEK_STATES[week.state].tone}>{saved && week.state === "saved" ? "Записана" : WEEK_STATES[week.state].label}</Badge>
          <strong>{periodLabel(week.starts_on, week.ends_on)}</strong>
          <span className="secondary">{week.state === "closed" ? "итоги опубликованы, не изменится" : week.state === "pending" ? `${week.reason} · ${operatorsWord(week.operators)}` : operatorsWord(week.operators)}</span>
        </li>)}</ul>
        <p className="workflow-note">Линия: норма часов (с тренингами, тех. сбоями и офлайн-активностью, против нормы из отчёта), переработки, эффективность, звонки в час. Чаты: норма часов, переработки, среднее время ответа, чатов в час. Качество — из оценок проверяющих, опоздания — из «Штрафов».</p>
        <p className="workflow-note">Каждый выгруженный день попадёт в аналитику. Неделя на стыке месяцев запишется, когда загрузят отчёт соседнего месяца; дни после выгрузки — со следующей выгрузкой. Коины не начисляются — итоги недели публикуются, когда она закончится.
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
