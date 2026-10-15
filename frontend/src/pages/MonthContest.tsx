import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { economy, type ContestMonth } from "../api/economy";
import { useAuth } from "../auth/AuthContext";
import { MedalIcon, SparkIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton } from "../components/ui";
import { coins, points } from "../utils/format";

const MEDALS = ["gold", "silver", "bronze"] as const;

/**
 * The monthly contest (docs/COIN_ECONOMY.md): places by the month's points of all operators, nominations
 * by their monthly averages. The weeks pay points and discipline; the month pays places and nominations
 * once, when its last week is closed or a head closes it.
 */
export function MonthContest() {
  const { atLeast } = useAuth();
  const [picked, setPicked] = useState<{ year: number; month: number } | null>(null);
  const options = useQuery({ queryKey: ["contest-months"], queryFn: economy.months });
  const query = useQuery({ queryKey: ["contest-month", picked?.year, picked?.month], queryFn: () => economy.month(picked?.year, picked?.month) });
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient(); const toast = useToast();
  const refresh = (data: ContestMonth) => { client.setQueryData(["contest-month", picked?.year, picked?.month], data); void client.invalidateQueries({ queryKey: ["contest-months"] }); };
  const calculate = useMutation({ mutationFn: () => economy.calculate(query.data!.year, query.data!.month), onSuccess: (data) => { refresh(data); toast.success("Места месяца пересчитаны"); } });
  const close = useMutation({ mutationFn: () => economy.close(query.data!.year, query.data!.month), onSuccess: (data) => {
    refresh(data.month); setConfirm(false);
    for (const key of ["wallet", "dashboard", "coin-progress", "notifications"]) void client.invalidateQueries({ queryKey: [key] });
    toast.success(`Месяц закрыт: начислено ${coins(data.report.coins_awarded)} коинов`);
  } });

  if (query.isLoading) return <RowsSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data!;
  const closedWeeks = data.weeks.filter((w) => w.status === "closed").length;
  const top = data.standings.filter((row) => row.rank !== null && row.rank <= 3);
  const mine = data.standings.find((row) => row.mine);
  const choices = [...(options.data ?? [])];
  if (!choices.some((m) => m.year === data.year && m.month === data.month)) choices.unshift({ year: data.year, month: data.month, label: data.label, name: data.name, status: data.status });

  return <div className="stack month-contest">
    <Card title={`Конкурс месяца · ${data.name}`} subtitle="Места — по сумме баллов всех недель месяца, номинации — по средним показателям. Призы начисляются, когда месяц закрыт."
      action={<Badge tone={data.status === "closed" ? "success" : "warning"}>{data.status === "closed" ? "Итоги опубликованы" : "Месяц идёт"}</Badge>}>
      <div className="month-contest__head">
        <label className="field"><span className="field__label">Месяц</span>
          <select className="input" value={`${data.year}-${data.month}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setPicked({ year: y, month: m }); }}>
            {choices.map((m) => <option key={m.label} value={`${m.year}-${m.month}`}>{m.name}{m.status === "closed" ? " · итоги" : ""}</option>)}
          </select></label>
        <p className="secondary small">Закрыто недель: {closedWeeks} из {data.weeks_planned}. Неделя относится к месяцу своего четверга.</p>
        {atLeast("supervisor") && data.status !== "closed" && <div className="row">
          <Button size="s" disabled={calculate.isPending} onClick={() => calculate.mutate()}>{calculate.isPending ? "Считаем…" : "Пересчитать"}</Button>
          {atLeast("head") && <Button size="s" variant="primary" disabled={closedWeeks < data.weeks.length || !data.weeks.length} onClick={() => setConfirm(true)}>Закрыть месяц</Button>}
        </div>}
      </div>
      {(calculate.isError || close.isError) && <ErrorState error={calculate.error ?? close.error} />}
    </Card>

    {mine && <Card title="Ваш результат месяца"><p><strong>{mine.rank} место</strong> · {points(mine.points)} баллов за {mine.weeks} {mine.weeks === 1 ? "неделю" : mine.weeks < 5 ? "недели" : "недель"}{mine.coins_rank_bonus + mine.coins_nomination_bonus > 0 ? <> · приз {coins(mine.coins_rank_bonus + mine.coins_nomination_bonus)} коинов{data.status === "closed" ? "" : " после закрытия месяца"}</> : null}</p></Card>}

    {!data.standings.length ? <Card><EmptyState title="Итогов месяца пока нет" hint="Места появятся после первой закрытой недели месяца." /></Card> : <>
      {top.length > 0 && <Card title="Топ-3 месяца"><ol className="podium">{top.map((row) => <li key={row.user_id} className={`podium__place podium__place--${MEDALS[(row.rank ?? 1) - 1]}`}>
        <span className="podium__rank" aria-hidden="true">{row.rank}</span>
        <span className="podium__medal"><MedalIcon size={14} />{row.rank} место</span>
        <span className="podium__name">{row.name ?? "Оператор"}{row.mine && <span className="tag-me">это вы</span>}</span>
        <span className="podium__group">{points(row.points)} баллов</span>
        <span className="podium__coins">+{coins(row.coins_rank_bonus)} коинов</span>
      </li>)}</ol></Card>}
      {data.nominations.length > 0 && <Card title="Номинации месяца"><ul className="nominations">{data.nominations.map((n) => <li key={n.nomination_id} className="nomination">
        <span className="nomination__icon"><SparkIcon size={17} /></span>
        <div className="nomination__body"><span className="nomination__title">{n.title}</span><span className="nomination__winner">{n.name ?? "Оператор"}</span><span className="nomination__meta">+{coins(n.coins)} коинов</span></div>
      </li>)}</ul></Card>}
      <Card title="Таблица месяца" padded={false}><div className="table-wrap table-wrap--responsive"><table className="table">
        <thead><tr><th className="num">Место</th><th>Оператор</th><th className="num">Баллы</th><th className="num">Недель</th><th className="num">Приз</th></tr></thead>
        <tbody>{data.standings.map((row) => <tr key={row.user_id} className={row.mine ? "is-me" : undefined}>
          <td className="num">{row.rank}</td><td>{row.name ?? "Оператор"}{row.mine && <span className="tag-me">это вы</span>}</td>
          <td className="num">{points(row.points)}</td><td className="num">{row.weeks}</td>
          <td className="num">{row.coins_rank_bonus + row.coins_nomination_bonus ? `+${coins(row.coins_rank_bonus + row.coins_nomination_bonus)}` : "—"}</td>
        </tr>)}</tbody></table></div></Card>
    </>}

    {confirm && <Sheet title={`Закрыть ${data.name}?`} size="s" onClose={() => { if (!close.isPending) setConfirm(false); }} footer={<><Button disabled={close.isPending} onClick={() => setConfirm(false)}>Отмена</Button><Button variant="primary" disabled={close.isPending} onClick={() => close.mutate()}>{close.isPending ? "Начисляем…" : "Закрыть и начислить"}</Button></>}>
      <p>Места и номинации месяца будут начислены один раз. Пересчитать закрытый месяц нельзя. Обычно месяц закрывается сам вместе с его последней неделей.</p>
    </Sheet>}
  </div>;
}
