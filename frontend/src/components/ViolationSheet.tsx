import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { configuration } from "../api/configuration";
import { violations, type Violation } from "../api/violations";
import { coins, plural } from "../utils/format";
import { todayDateKey } from "./dateRange";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Badge, Button, ErrorState, RowsSkeleton, Select } from "./ui";
import { calendarDate, dateKey, shiftDays, weekRange } from "./weekCalendar";
import "./violations.css";

/** How far back a day may be: the current and the previous week (app/services/violations.py). */
const DAYS_BACK = 14;
const MAX_COUNT = 50;
const QUERIES = ["violations", "admin-operators", "admin-summary", "period-preview", "weeks", "rating", "race", "dashboard"];

const sites = (count: number) => `${count} ${plural(count, "сайт", "сайта", "сайтов")}`;
const dayLabel = (key: string, today: string) => {
  const date = calendarDate(key)!;
  const label = date.toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const back = Math.round((calendarDate(today)!.getTime() - date.getTime()) / 86_400_000);
  return back === 0 ? `Сегодня, ${label}` : back === 1 ? `Вчера, ${label}` : label;
};
/** The Monday–Sunday week of a day. */
function weekOf(key: string) {
  const date = calendarDate(key)!;
  const monday = shiftDays(date, -((date.getUTCDay() + 6) % 7));
  return { starts_on: dateKey(monday), ends_on: dateKey(shiftDays(monday, 6)) };
}

/**
 * «Посторонние сайты» (docs/CHANNELS.md): a supervisor records the sites the moment they notice them. The count goes
 * to the week of the day as its metric — at the week's publication each site costs the rules' fine and takes away the
 * «без посторонних сайтов» bonus. A record made by mistake is cancelled while its week is not published.
 */
export function ViolationSheet({ operator, onClose }: { operator: { user_id: number; full_name: string }; onClose: () => void }) {
  const today = todayDateKey();
  const days = Array.from({ length: DAYS_BACK + 1 }, (_, n) => dateKey(shiftDays(calendarDate(today)!, -n)));
  const [count, setCount] = useState("1");
  const [day, setDay] = useState(today);
  const [comment, setComment] = useState("");
  const client = useQueryClient(); const toast = useToast();
  const rules = useQuery({ queryKey: ["configuration-rules"], queryFn: configuration.rules });
  const history = useQuery({ queryKey: ["violations", operator.user_id], queryFn: () => violations.list({ user_id: operator.user_id, limit: 10 }) });
  const refresh = () => { for (const key of QUERIES) void client.invalidateQueries({ queryKey: [key] }); };
  const save = useMutation({
    mutationFn: () => violations.record({ user_id: operator.user_id, count: Number(count), noticed_on: day, comment: comment.trim() }),
    onSuccess: (item) => {
      refresh();
      toast.success(`Отмечено: ${sites(item.count)} · итоги недели ${weekRange({ starts_on: item.week_starts_on, ends_on: item.week_ends_on })}`);
      onClose();
    },
  });
  const cancel = useMutation({ mutationFn: (id: number) => violations.cancel(id), onSuccess: () => { refresh(); toast.success("Отметка отменена"); } });
  const number = Number(count);
  const valid = Number.isInteger(number) && number >= 1 && number <= MAX_COUNT && comment.trim().length >= 3;
  const fine = rules.data?.forbidden_site_fine ?? 0, bonus = rules.data?.no_forbidden_sites_bonus ?? 0;
  const busy = save.isPending || cancel.isPending;
  function submit(event: FormEvent) { event.preventDefault(); if (valid && !busy) save.mutate(); }

  return <Sheet title="Посторонние сайты" subtitle={operator.full_name} onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" form="violation-form" variant="primary" disabled={!valid || busy}>{save.isPending ? "Сохраняем…" : "Отметить"}</Button></>}>
    <form id="violation-form" className="stack" onSubmit={submit}>
      <div className="violation-form__row">
        <label className="field"><span className="field__label">Сколько сайтов</span>
          <input className="input" type="number" inputMode="numeric" min={1} max={MAX_COUNT} step={1} required value={count} disabled={busy} onChange={(event) => setCount(event.target.value)} /></label>
        <label className="field"><span className="field__label">Когда обнаружено</span>
          <Select aria-label="День, когда обнаружено" value={day} disabled={busy} onChange={setDay} options={days.map((key) => ({ value: key, label: dayLabel(key, today) }))} /></label>
      </div>
      <label className="field"><span className="field__label">Что обнаружено</span>
        <textarea className="input" rows={3} maxLength={500} required value={comment} disabled={busy} placeholder="Например: YouTube и два новостных сайта во время смены" onChange={(event) => setComment(event.target.value)} />
        <span className="field__note">Оператор увидит отметку и комментарий в уведомлениях.</span></label>
      <p className="violation-form__effect">
        Попадёт в итоги недели {weekRange(weekOf(day))}{fine > 0 && Number.isInteger(number) && number > 0 ? <>: штраф <strong>{coins(number * fine)} коинов</strong> при публикации</> : ""}{bonus > 0 ? `, без бонуса «без посторонних сайтов» (${coins(bonus)})` : ""}. Если неделя уже опубликована — в текущую.
      </p>
      {save.isError && <ErrorState error={save.error} />}
    </form>
    <section className="violation-history" aria-label="Последние отметки">
      <h3 className="group-title">Последние отметки</h3>
      {history.isLoading && <RowsSkeleton rows={2} />}
      {history.isError && <ErrorState error={history.error} onRetry={() => history.refetch()} />}
      {history.data && !history.data.length && <p className="small secondary">Отметок ещё не было. Неделя без отметок — бонус «без посторонних сайтов».</p>}
      {history.data && history.data.length > 0 && <ul className="violation-history__list">{history.data.map((item) => <ViolationLine key={item.id} item={item} busy={busy} onCancel={() => cancel.mutate(item.id)} />)}</ul>}
      {cancel.isError && <ErrorState error={cancel.error} />}
    </section>
  </Sheet>;
}

function ViolationLine({ item, busy, onCancel }: { item: Violation; busy: boolean; onCancel: () => void }) {
  const published = item.week_status === "closed";
  return <li className={`violation-history__item${item.cancelled ? " is-cancelled" : ""}`}>
    <div className="violation-history__main">
      <strong>{sites(item.count)}</strong>
      <span className="small secondary">{calendarDate(item.noticed_on)!.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" })} · неделя {weekRange({ starts_on: item.week_starts_on, ends_on: item.week_ends_on })}{item.author_name ? ` · ${item.author_name}` : ""}</span>
      {item.comment && <span className="small">{item.comment}</span>}
    </div>
    {item.cancelled ? <Badge tone="neutral">Отменена</Badge>
      : published ? <Badge tone="success">В итогах недели</Badge>
        : <Button size="s" variant="plain" disabled={busy} onClick={onCancel} aria-label={`Отменить отметку: ${sites(item.count)}`}>Отменить</Button>}
  </li>;
}
