import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { rating } from "../api/endpoints";
import type { NominationOut, PodiumEntry, RatingRowOut } from "../api/types";
import { MedalIcon, SearchIcon, SparkIcon } from "../components/icons";
import {
  Avatar,
  Badge,
  Card,
  CoinAmount,
  Delta,
  EmptyState,
  ErrorState,
  Pagination,
  RowsSkeleton,
  SegmentedControl,
  Skeleton,
} from "../components/ui";
import { GlassSurface } from "../components/GlassSurface";
import { RatingProgressPanel } from "./RatingProgressPanel";
import { WEEK_STATUS_LABELS, coins, dateTime, periodLabel, points } from "../utils/format";

const MEDAL_LABEL: Record<string, string> = {
  gold: "1 место",
  silver: "2 место",
  bronze: "3 место",
};

export function RatingPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "progress" ? "progress" : "board";
  return <div className="stack"><header className="page-head"><div><h1 className="page-title">Рейтинг</h1><p className="page-subtitle">Результаты команды и ваш прогресс по неделям</p></div></header>
    <SegmentedControl label="Раздел рейтинга" value={tab} options={[{ value: "board", label: "Рейтинг команды" }, { value: "progress", label: "Мой прогресс" }]} onChange={(value) => { const next = new URLSearchParams(params); next.set("tab", value); setParams(next); }} />
    {tab === "progress" ? <RatingProgressPanel /> : <Leaderboard />}
  </div>;
}

function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const selectedWeek = Number(params.get("week"));
  const weekId = Number.isInteger(selectedWeek) && selectedWeek > 0 ? selectedWeek : undefined;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const search = params.get("search") ?? "";
  const update = (values: Record<string, string | undefined>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); } setParams(next, { replace: "search" in values }); };
  const setPage = (value: number) => update({ page: String(value) });
  const size = 25;

  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks() });
  const board = useQuery({
    queryKey: ["rating", weekId, page, search],
    queryFn: () => rating.leaderboard({ week_id: weekId, page, size, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  if (board.isLoading) {
    return (
      <div className="page-skeleton">
        <Skeleton height={36} width="34%" radius="var(--radius-s)" />
        <Skeleton height={170} radius="var(--radius-xl)" />
        <Skeleton height={300} radius="var(--radius-xl)" />
      </div>
    );
  }

  if (board.isError) {
    // На свежей системе недель ещё нет: это не сбой, а пустое состояние.
    if (board.error instanceof ApiError && board.error.status === 404) {
      return (
        <div className="stack">
          <Card>
            <EmptyState
              title="Конкурс ещё не начался"
              hint="Рейтинг появится, когда супервайзер заведёт неделю и выгрузит показатели"
            />
          </Card>
        </div>
      );
    }
    return <ErrorState error={board.error} onRetry={() => board.refetch()} />;
  }

  const data = board.data!;
  const { header } = data;
  // Оператору чужие балансы не отдаются - колонка из одних прочерков только мешает.
  const showBalances = data.rows.some((row) => !row.is_me && row.balance !== null);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h2 className="page-title">{header.contest_title}</h2>
          <p className="page-subtitle">
            Неделя {header.week_label} · {periodLabel(header.period_start, header.period_end)} ·{" "}
            {header.participants} участников
            {header.updated_at ? ` · обновлено ${dateTime(header.updated_at)}` : ""}
          </p>
        </div>
        <div className="page-head__actions">
          <Badge tone={header.status === "closed" ? "success" : "accent"} dot>
            {WEEK_STATUS_LABELS[header.status] ?? header.status}
          </Badge>
        </div>
      </div>

      {/* Плавающая панель фильтров - один из немногих стеклянных элементов. */}
      <GlassSurface variant="regular" className="filterbar">
        <label className="search">
          <span className="search__icon">
            <SearchIcon size={16} />
          </span>
          <input
            className="input input--s"
            style={{ width: 210 }}
            placeholder="Найти оператора"
            value={search}
            aria-label="Поиск по ФИО"
            onChange={(event) => {
              update({ search: event.target.value, page: undefined });
            }}
          />
        </label>
        <span className="filterbar__spacer" />
        <select
          className="input input--s"
          aria-label="Неделя конкурса"
          value={weekId ?? header.week_id}
          onChange={(event) => {
            update({ week: event.target.value, page: undefined });
          }}
        >
          {(weeks.data ?? []).map((week) => (
            <option key={week.id} value={week.id}>
              {week.label} · {WEEK_STATUS_LABELS[week.status] ?? week.status}
            </option>
          ))}
        </select>
      </GlassSurface>

      {data.podium.length > 0 && (
        <Card title="Топ-3 недели">
          <ol className="podium">
            {data.podium.map((entry) => (
              <PodiumPlace key={entry.user_id} entry={entry} />
            ))}
          </ol>
        </Card>
      )}

      {data.nominations.length > 0 && (
        <Card title="Номинации недели">
          <ul className="nominations">
            {data.nominations.map((nomination) => (
              <NominationItem key={nomination.code} nomination={nomination} />
            ))}
          </ul>
        </Card>
      )}

      {data.my_row && <Card title="Моё место" variant="highlight"><div className="row"><strong className="rank-badge">{data.my_row.rank ? `#${data.my_row.rank}` : "—"}</strong><span>{points(data.my_row.points)} баллов</span><CoinAmount value={data.my_row.coins_week} size="s" />{data.my_row.rank_delta != null && <Delta value={data.my_row.rank_delta} />}</div><p className="small secondary">Ваш результат за выбранную неделю отображается независимо от поиска и страницы таблицы.</p></Card>}
      <Card title="Общая таблица" padded={false}>
        {data.rows.length === 0 ? (
          <EmptyState
            title="Ничего не найдено"
            hint="Измените фильтры или поисковый запрос"
          />
        ) : (
          <>
            <div className="table-wrap table-wrap--responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Место</th>
                    <th>Оператор</th>
                    <th>Группа</th>
                    <th className="num">Баллы</th>
                    <th className="num">Коины за неделю</th>
                    {showBalances && <th className="num">Баланс</th>}
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

            <div className="card__body">
              <ul className="card-list">
                {data.rows.map((row) => (
                  <li
                    key={row.user_id}
                    className="list-card"
                    style={
                      row.is_me
                        ? { background: "var(--accent-tint)", boxShadow: "inset 3px 0 0 var(--accent-primary)" }
                        : undefined
                    }
                  >
                    <div className="list-card__head">
                      <span className="cell-person">
                        <span className="rank-badge">{row.rank ?? "—"}</span>
                        <span className="cell-person__text">
                          <span className="cell-person__name">
                            {row.full_name}
                            {row.is_me && <span className="tag-me">это вы</span>}
                          </span>
                          <span className="cell-person__meta">{row.group_name ?? "—"}</span>
                        </span>
                      </span>
                      <CoinAmount value={row.coins_week} size="s" />
                    </div>
                    <div className="list-card__metrics">
                      <span className="list-card__metric">
                        <span>Баллы</span>
                        <span>{points(row.points)}</span>
                      </span>
                      <span className="list-card__metric">
                        <span>Динамика</span>
                        <span>{row.rank_delta ? <Delta value={row.rank_delta} /> : "—"}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card__body--flush">
              <Pagination page={page} size={size} total={data.total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      {board.isFetching && <RowsSkeleton rows={1} />}
    </div>
  );
}

function RatingRow({ row, showBalance }: { row: RatingRowOut; showBalance: boolean }) {
  return (
    <tr className={row.is_me ? "row--me" : undefined}>
      <td className="num">
        <span className="rank-badge">{row.rank ?? "—"}</span>
      </td>
      <td>
        <span className="cell-person">
          <Avatar name={row.full_name} id={row.user_id} size={32} />
          <span className="cell-person__text">
            <span className="cell-person__name">
              {row.full_name}
              {/* Своя строка помечена не только фоном: подпись читается и без цвета. */}
              {row.is_me && <span className="tag-me">это вы</span>}
            </span>
          </span>
        </span>
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
        {row.rank_delta ? <Delta value={row.rank_delta} /> : <span className="muted">—</span>}
      </td>
    </tr>
  );
}

function PodiumPlace({ entry }: { entry: PodiumEntry }) {
  return (
    <li className={`podium__place podium__place--${entry.medal}`}>
      {/* Номер места дублирует цвет медали. */}
      <span className="podium__rank" aria-hidden="true">
        {entry.rank}
      </span>
      <span className="podium__medal">
        <MedalIcon size={14} />
        {MEDAL_LABEL[entry.medal] ?? `${entry.rank} место`}
      </span>
      <span className="podium__name">
        {entry.full_name}
        {entry.is_me && <span className="tag-me">это вы</span>}
      </span>
      <span className="podium__group">{entry.group_name ?? "—"}</span>
      <span className="podium__coins">
        <CoinAmount value={entry.coins_week} size="l" />
        <span className="muted micro">за неделю</span>
      </span>
      <span className="podium__points">{points(entry.points)} балла(ов)</span>
    </li>
  );
}

function NominationItem({ nomination }: { nomination: NominationOut }) {
  return (
    <li className="nomination">
      <span className="nomination__icon">
        <SparkIcon size={17} />
      </span>
      <div className="nomination__body">
        <span className="nomination__title">{nomination.title}</span>
        {nomination.winner_name ? (
          <>
            <span className="nomination__winner">{nomination.winner_name}</span>
            <span className="nomination__meta">
              {nomination.winner_group ? `${nomination.winner_group} · ` : ""}
              {nomination.coins_awarded > 0 ? `+${nomination.coins_awarded} коинов` : ""}
            </span>
          </>
        ) : (
          <span className="nomination__meta">Победитель не определён</span>
        )}
      </div>
    </li>
  );
}
