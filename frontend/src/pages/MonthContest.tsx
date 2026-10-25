import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { economy, type ContestMonth, type MonthStanding } from "../api/economy";
import { useAuth } from "../auth/AuthContext";
import { MedalIcon, SparkIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton, SegmentedControl, Select } from "../components/ui";
import { coins, coinsWithUnit, plural, points, pointsWord } from "../utils/format";
import "./race.css";

const MEDALS = ["gold", "silver", "bronze"] as const;

/**
 * The monthly contest (docs/COIN_ECONOMY.md): places by the month's points of all operators, nominations
 * by their monthly averages. The weeks pay points and discipline; the month pays places and nominations
 * once, when its last week is closed or a head closes it.
 */
export function MonthContest() {
  const { user, atLeast } = useAuth();
  // An operator sees their own channel only; the server sends nothing else (docs/RATING_COMPARE.md).
  const operator = user?.role === "operator";
  const [picked, setPicked] = useState<{ year: number; month: number } | null>(null);
  const options = useQuery({ queryKey: ["contest-months"], queryFn: economy.months });
  const query = useQuery({ queryKey: ["contest-month", picked?.year, picked?.month], queryFn: () => economy.month(picked?.year, picked?.month) });
  const [confirm, setConfirm] = useState(false);
  // Places are within a channel (docs/CHANNELS.md): one channel's table at a time.
  // An operator starts on their own channel.
  const [channel, setChannel] = useState<"line" | "chat">(user?.role === "operator" && user.channel === "chat" ? "chat" : "line");
  const client = useQueryClient(); const toast = useToast();
  const refresh = (data: ContestMonth) => { client.setQueryData(["contest-month", picked?.year, picked?.month], data); void client.invalidateQueries({ queryKey: ["contest-months"] }); };
  const calculate = useMutation({ mutationFn: () => economy.calculate(query.data!.year, query.data!.month), onSuccess: (data) => { refresh(data); toast.success("Места месяца пересчитаны"); } });
  const close = useMutation({ mutationFn: () => economy.close(query.data!.year, query.data!.month), onSuccess: (data) => {
    refresh(data.month); setConfirm(false);
    for (const key of ["wallet", "dashboard", "coin-progress", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
    toast.success(`Месяц закрыт: начислено ${coinsWithUnit(data.report.coins_awarded)}`);
  } });

  if (query.isLoading) return <RowsSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data!;
  const closedWeeks = data.weeks.filter((w) => w.status === "closed").length;
  const canClose = !!data.weeks.length && closedWeeks === data.weeks.length;
  const standings = data.standings.filter((row) => operator || (row.channel ?? "line") === channel);
  const top = standings.filter((row) => row.rank !== null && row.rank <= 3);
  const mine = standings.find((row) => row.mine);
  const nominations = data.nominations.filter((n) => operator || !n.channel || n.channel === "all" || n.channel === channel);
  const channelName = (operator ? user?.channel === "chat" : channel === "chat") ? "чатов" : "линии";
  const choices = [...(options.data ?? [])];
  if (!choices.some((m) => m.year === data.year && m.month === data.month)) choices.unshift({ year: data.year, month: data.month, label: data.label, name: data.name, status: data.status });

  return <div className="stack month-contest">
    <Card title={`Конкурс месяца · ${data.name}`} subtitle={operator ? `Среди операторов ${channelName}: места — по сумме баллов недель месяца, номинации — по средним показателям. Призы начисляются, когда месяц закрыт.` : "Места — по сумме баллов недель месяца, внутри направления; номинации — по средним показателям. Призы начисляются, когда месяц закрыт."}
      action={<Badge tone={data.status === "closed" ? "success" : "warning"}>{data.status === "closed" ? "Итоги опубликованы" : "Месяц идёт"}</Badge>}>
      <div className="month-contest__head">
        <div className="month-contest__pick">
          <label className="field"><span className="field__label">Месяц</span>
            <Select aria-label="Месяц конкурса" value={`${data.year}-${data.month}`} onChange={(value) => { const [y, m] = value.split("-").map(Number); setPicked({ year: y, month: m }); }}
              options={choices.map((m) => ({ value: `${m.year}-${m.month}`, label: `${m.name}${m.status === "closed" ? " · итоги" : ""}` }))} /></label>
          {!operator && <div className="field"><span className="field__label">Направление</span><SegmentedControl label="Направление" value={channel} options={[{ value: "line", label: "Линия" }, { value: "chat", label: "Чаты" }]} onChange={setChannel} /></div>}
        </div>
        <div className="month-contest__status">
          <p className="secondary small">Опубликовано недель: {closedWeeks} из {data.weeks_planned}. Неделя относится к месяцу своего четверга.{canClose || data.status === "closed" || !atLeast("head") ? "" : " Закрыть месяц можно, когда опубликованы все его недели."}</p>
          {atLeast("supervisor") && data.status !== "closed" && <div className="row">
            <Button size="s" disabled={calculate.isPending} onClick={() => calculate.mutate()}>{calculate.isPending ? "Считаем…" : "Пересчитать"}</Button>
            {atLeast("head") && <Button size="s" variant="primary" disabled={!canClose} onClick={() => setConfirm(true)}>Закрыть месяц</Button>}
          </div>}
        </div>
      </div>
      {(calculate.isError || close.isError) && <ErrorState error={calculate.error ?? close.error} />}
    </Card>

    {mine && <YourMonth mine={mine} standings={standings} closed={data.status === "closed"} won={nominations.filter((n) => n.user_id === mine.user_id).map((n) => n.title)} />}

    {!standings.length ? <Card><EmptyState title={data.standings.length ? `Операторов направления «${channel === "chat" ? "Чаты" : "Линия"}» в итогах нет` : "Итогов месяца пока нет"} hint={data.standings.length ? "Места разыгрываются внутри направления." : "Места появятся после первой закрытой недели месяца."} /></Card> : <>
      {top.length > 0 && <Card title="Топ-3 месяца"><ol className="podium">{top.map((row) => <li key={row.user_id} className={`podium__place podium__place--${MEDALS[(row.rank ?? 1) - 1]}`}>
        <span className="podium__rank" aria-hidden="true">{row.rank}</span>
        <span className="podium__medal"><MedalIcon size={14} />{row.rank} место</span>
        <span className="podium__name">{row.name ?? "Оператор"}{row.mine && <span className="tag-me">это вы</span>}</span>
        <span className="podium__group">{points(row.points)} {pointsWord(row.points)}</span>
        {row.coins_rank_bonus > 0 && <span className="podium__coins">+{coinsWithUnit(row.coins_rank_bonus)}</span>}
      </li>)}</ol></Card>}
      {nominations.length > 0 && <Card title="Номинации месяца"><ul className="nominations">{nominations.map((n) => <li key={n.nomination_id} className={`nomination${n.user_id === mine?.user_id ? " is-me" : ""}`}>
        <span className="nomination__icon"><SparkIcon size={17} /></span>
        <div className="nomination__body"><span className="nomination__title">{n.title}</span><span className="nomination__winner">{n.name ?? "Оператор"}{n.user_id === mine?.user_id && <span className="tag-me">это вы</span>}</span>{n.coins > 0 && <span className="nomination__meta">+{coinsWithUnit(n.coins)}</span>}</div>
      </li>)}</ul></Card>}
      {operator ? <OperatorStandings standings={standings} channelName={channelName} /> : <Card title="Таблица месяца" padded={false}><div className="table-wrap table-wrap--responsive"><table className="table">
        <thead><tr><th className="num">Место</th><th>Оператор</th><th className="num">Баллы</th><th className="num">Недель</th><th className="num">Приз</th></tr></thead>
        <tbody>{standings.map((row) => <tr key={row.user_id} className={row.mine ? "is-me" : undefined}>
          <td className="num">{row.rank}</td><td>{row.name ?? "Оператор"}{row.mine && <span className="tag-me">это вы</span>}</td>
          <td className="num">{points(row.points)}</td><td className="num">{row.weeks}</td>
          <td className="num">{row.coins_rank_bonus + row.coins_nomination_bonus ? `+${coins(row.coins_rank_bonus + row.coins_nomination_bonus)}` : "—"}</td>
        </tr>)}</tbody></table></div>
        {/* On a phone the table gives way to cards (app.css). */}
        <ul className="card-list month-contest__cards">{standings.map((row) => <li key={row.user_id} className="list-card">
          <div className="list-card__head"><span className="cell-person"><span className="rank-badge">{row.rank ?? "—"}</span><span className="cell-person__text"><span className="cell-person__name">{row.name ?? "Оператор"}</span></span></span>
            <strong>{points(row.points)}</strong></div>
          <div className="list-card__metrics"><span className="list-card__metric"><span>Недель</span><span>{row.weeks}</span></span>
            <span className="list-card__metric"><span>Приз</span><span>{row.coins_rank_bonus + row.coins_nomination_bonus ? `+${coins(row.coins_rank_bonus + row.coins_nomination_bonus)}` : "—"}</span></span></div>
        </li>)}</ul></Card>}
    </>}

    {confirm && <Sheet title={`Закрыть ${data.name}?`} size="s" onClose={() => { if (!close.isPending) setConfirm(false); }} footer={<><Button disabled={close.isPending} onClick={() => setConfirm(false)}>Отмена</Button><Button variant="primary" disabled={close.isPending} onClick={() => close.mutate()}>{close.isPending ? "Начисляем…" : "Закрыть и начислить"}</Button></>}>
      <p>Места и номинации месяца будут начислены один раз. Пересчитать закрытый месяц нельзя. Обычно месяц закрывается сам вместе с его последней неделей.</p>
    </Sheet>}
  </div>;
}

const weeksWord = (n: number) => plural(n, "неделю", "недели", "недель");

/** The operator's month at a glance: the place, the points, how far the next places are and the prize. */
function YourMonth({ mine, standings, closed, won }: { mine: MonthStanding; standings: MonthStanding[]; closed: boolean; won: string[] }) {
  const rank = mine.rank ?? standings.length;
  const above = standings.filter((row) => row.rank !== null && row.rank < rank).at(-1);
  const below = standings.find((row) => row.rank !== null && row.rank > rank);
  const third = standings.find((row) => row.rank === 3);
  const paid = standings.filter((row) => row.coins_rank_bonus > 0);
  const lastPaid = paid.at(-1);
  const prize = mine.coins_rank_bonus + mine.coins_nomination_bonus;
  const gaps: { tone: string; label: string; value: string; note: string }[] = [];
  if (above) gaps.push({ tone: "up", label: `До ${above.rank}-го места`, value: `${points(above.points - mine.points)}`, note: above.name ?? "Оператор" });
  else if (below) gaps.push({ tone: "lead", label: "Отрыв от 2-го места", value: `+${points(mine.points - below.points)}`, note: below.name ?? "Оператор" });
  if (rank > 3 && third && third !== above) gaps.push({ tone: "podium", label: "До топ-3", value: `${points(third.points - mine.points)}`, note: `3 место — ${third.name ?? "Оператор"}` });
  if (below && above) gaps.push({ tone: "down", label: `Запас над ${below.rank}-м местом`, value: `${points(mine.points - below.points)}`, note: below.name ?? "Оператор" });
  if (prize > 0) gaps.push({ tone: "lead", label: closed ? "Начислено" : "Приз сейчас", value: `+${coins(prize)}`, note: `${plural(prize, "коин", "коина", "коинов")} за место и номинации` });
  else if (!closed && lastPaid?.rank && rank > lastPaid.rank) gaps.push({ tone: "podium", label: "До призового места", value: points(lastPaid.points - mine.points), note: `приз платят до ${lastPaid.rank}-го места` });
  return <Card title="Ваш результат месяца">
    <div className="race-hero">
      <div className="race-hero__place"><strong>{rank}</strong><span>место из {standings.length}</span></div>
      <div className="race-hero__points"><strong>{points(mine.points)} {pointsWord(mine.points)}</strong>
        <p className="secondary">за {mine.weeks} {weeksWord(mine.weeks)}{won.length ? ` · номинация: ${won.join(", ")}` : ""}</p></div>
      {gaps.length > 0 && <div className="race-gaps">{gaps.slice(0, 3).map((gap) => <div key={gap.label} className={`race-gap race-gap--${gap.tone}`}>
        <span>{gap.label}</span><strong>{gap.value}</strong><small>{gap.note}</small>
      </div>)}</div>}
    </div>
  </Card>;
}

/** One place: the bar spans the channel's lowest to highest points, so close results still look apart. */
function StandingRow({ row, mine, low, high }: { row: MonthStanding; mine?: MonthStanding; low: number; high: number }) {
  const width = high > low ? 12 + 88 * (row.points - low) / (high - low) : 100;
  const diff = mine && !row.mine ? row.points - mine.points : null;
  return <li className={`contest-row${row.mine ? " is-me" : ""}${row.rank !== null && row.rank <= 3 ? " is-top" : ""}`}>
    <span className="contest-row__rank">{row.rank ?? "—"}</span>
    <span className="contest-row__name">{row.mine ? "Вы" : row.name ?? "Оператор"}</span>
    <span className="contest-row__bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></span>
    <span className="contest-row__points">{points(row.points)}</span>
    <span className={`contest-row__diff${diff === null ? "" : diff > 0 ? " is-ahead" : " is-behind"}`}>{diff === null ? "" : `${diff > 0 ? "+" : "−"}${points(Math.abs(diff))}`}</span>
  </li>;
}

/** Instead of the long table: the places around the operator, everyone one tap away. */
function OperatorStandings({ standings, channelName }: { standings: MonthStanding[]; channelName: string }) {
  const [all, setAll] = useState(false);
  const mine = standings.find((row) => row.mine);
  const values = standings.map((row) => row.points);
  const low = Math.min(...values), high = Math.max(...values);
  const at = mine ? standings.indexOf(mine) : -1;
  // Two places above and two below; at the edges the window shifts so it stays five places.
  const start = Math.max(0, Math.min(at - 2, standings.length - 5));
  const near = mine ? standings.slice(start, start + 5) : standings.slice(0, 5);
  const count = standings.length;
  const people = plural(count, "участник", "участника", "участников");
  return <Card title={mine ? "Рядом с вами" : "Места месяца"} subtitle={`Операторы ${channelName} · ${count} ${people}`}>
    <ol className="contest-rows">{(all ? standings : near).map((row) => <StandingRow key={row.user_id} row={row} mine={mine} low={low} high={high} />)}</ol>
    {count > near.length && <div className="contest-more"><Button size="s" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Свернуть" : `Все операторы (${count})`}</Button></div>}
  </Card>;
}
