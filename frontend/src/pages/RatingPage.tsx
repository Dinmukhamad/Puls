import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { rating } from "../api/endpoints";
import type { NominationOut, PodiumEntry, RatingRowOut } from "../api/types";
import {
  Card,
  Delta,
  EmptyState,
  ErrorState,
  Pagination,
  Pill,
  Spinner,
} from "../components/ui";
import { WEEK_STATUS_LABELS, coins, dateTime, periodLabel, points } from "../utils/format";

const MEDAL_LABEL: Record<string, string> = {
  gold: "1 место",
  silver: "2 место",
  bronze: "3 место",
};

export function RatingPage() {
  const [weekId, setWeekId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const size = 25;

  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks() });
  const board = useQuery({
    queryKey: ["rating", weekId, page, search],
    queryFn: () => rating.leaderboard({ week_id: weekId, page, size, search: search || undefined }),
  });

  if (board.isLoading) return <Spinner label="Загружаем рейтинг" />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => board.refetch()} />;

  const data = board.data!;
  const { header } = data;
  // Оператору чужие балансы не отдаются - колонка из одних прочерков только мешает.
  const showBalances = data.rows.some((row) => !row.is_me && row.balance !== null);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">{header.contest_title}</h1>
          <p className="page-subtitle">
            Неделя {header.week_label} · {periodLabel(header.period_start, header.period_end)} ·{" "}
            {header.participants} участников
            {header.updated_at ? ` · обновлено ${dateTime(header.updated_at)}` : ""}
          </p>
        </div>
        <div className="page-head__controls">
          <Pill tone={header.status === "closed" ? "good" : "accent"}>
            {WEEK_STATUS_LABELS[header.status] ?? header.status}
          </Pill>
          <select
            className="input input--sm"
            aria-label="Неделя конкурса"
            value={weekId ?? header.week_id}
            onChange={(event) => {
              setWeekId(Number(event.target.value));
              setPage(1);
            }}
          >
            {(weeks.data ?? []).map((week) => (
              <option key={week.id} value={week.id}>
                {week.label} · {WEEK_STATUS_LABELS[week.status] ?? week.status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data.podium.length > 0 && <Podium entries={data.podium} />}

      {data.nominations.length > 0 && <Nominations items={data.nominations} />}

      <Card
        title="Общая таблица"
        action={
          <input
            className="input input--sm"
            placeholder="Поиск по ФИО"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        }
        padded={false}
      >
        {data.rows.length === 0 ? (
          <div className="card__body">
            <EmptyState title="Участников не найдено" />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Место</th>
                  <th>ФИО</th>
                  <th>Группа</th>
                  <th className="num">Баллы</th>
                  <th className="num">Коины за неделю</th>
                  {showBalances && <th className="num">Общий баланс</th>}
                  <th className="num">Динамика</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <RatingRow key={row.user_id} row={row} showBalance={showBalances} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card__body card__body--tight">
          <Pagination page={page} size={size} total={data.total} onChange={setPage} />
        </div>
      </Card>
    </div>
  );
}

function RatingRow({ row, showBalance }: { row: RatingRowOut; showBalance: boolean }) {
  return (
    <tr className={row.is_me ? "row--me" : undefined}>
      <td className="num">
        <span className="rank">{row.rank ?? "—"}</span>
      </td>
      <td>
        {row.full_name}
        {/* Своя строка помечена не только фоном: подпись читается и без цвета. */}
        {row.is_me && <span className="tag-me">это вы</span>}
      </td>
      <td className="muted">{row.group_name ?? "—"}</td>
      <td className="num">{points(row.points)}</td>
      <td className="num">{coins(row.coins_week)}</td>
      {showBalance && (
        <td className="num">
          {row.balance === null ? <span className="muted">скрыт</span> : coins(row.balance)}
        </td>
      )}
      <td className="num">
        {row.rank_delta ? <Delta value={row.rank_delta} /> : <span className="muted">без изменений</span>}
      </td>
    </tr>
  );
}

function Podium({ entries }: { entries: PodiumEntry[] }) {
  return (
    <Card title="Топ-3 недели">
      <ol className="podium">
        {entries.map((entry) => (
          <li key={entry.user_id} className={`podium__place podium__place--${entry.medal}`}>
            {/* Номер места дублирует цвет медали. */}
            <div className="podium__rank" aria-hidden="true">
              {entry.rank}
            </div>
            <div className="podium__medal">{MEDAL_LABEL[entry.medal] ?? `${entry.rank} место`}</div>
            <div className="podium__name">
              {entry.full_name}
              {entry.is_me && <span className="tag-me">это вы</span>}
            </div>
            <div className="podium__group">{entry.group_name ?? "—"}</div>
            <div className="podium__coins">
              {coins(entry.coins_week)} <span aria-hidden="true">◆</span>
              <span className="podium__coins-label">за неделю</span>
            </div>
            <div className="podium__points">{points(entry.points)} балла(ов)</div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Nominations({ items }: { items: NominationOut[] }) {
  return (
    <Card title="Номинации недели">
      <ul className="nominations">
        {items.map((nomination) => (
          <li key={nomination.code} className="nomination">
            <span className="nomination__icon" aria-hidden="true">
              ★
            </span>
            <div className="nomination__body">
              <span className="nomination__title">{nomination.title}</span>
              {nomination.winner_name ? (
                <>
                  <span className="nomination__winner">{nomination.winner_name}</span>
                  <span className="nomination__meta">
                    {nomination.winner_group ? `${nomination.winner_group} · ` : ""}
                    {nomination.coins_awarded > 0 ? `+${nomination.coins_awarded} ◆` : ""}
                  </span>
                </>
              ) : (
                <span className="nomination__empty">Победитель не определён</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
