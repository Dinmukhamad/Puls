import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { rating } from "../api/endpoints";
import type { NominationOut, PodiumEntry, RatingOut, RatingRowOut } from "../api/types";
import { MedalIcon, SparkIcon } from "../components/icons";
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
import { WeekPicker } from "../components/WeekPicker";
import { coins, dateOnly, plural, points, pointsWord, weekStatusLabel } from "../utils/format";
import { useAuth } from "../auth/AuthContext";
import { MonthContest } from "./MonthContest";
import { OperatorRatingPage } from "./OperatorRating";
import "./rating.css";

const MEDAL_LABEL: Record<string, string> = {
  gold: "1 место",
  silver: "2 место",
  bronze: "3 место",
};

export function RatingPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  if (params.get("tab") === "progress") return <Navigate to="/cabinet" replace />;
  // Operators open on the month's contest and compare themselves with everyone one tap away (docs/RATING_COMPARE.md).
  if (user?.role === "operator") return <OperatorRatingPage />;
  // The contest is monthly (docs/COIN_ECONOMY.md); the weeks stay one tap away.
  const view = params.get("view") === "weeks" || params.has("week") ? "weeks" : "month";
  const toggle = <div data-tour="rating-views"><SegmentedControl label="Период рейтинга" value={view} options={[{ value: "month", label: "Конкурс месяца" }, { value: "weeks", label: "Недели" }]} onChange={(value) => { const next = new URLSearchParams(params); next.delete("week"); next.delete("page"); if (value === "weeks") next.set("view", "weeks"); else next.delete("view"); setParams(next); }} /></div>;
  return view === "month"
    ? <div className="stack"><RatingHeading month />{toggle}<MonthContest /></div>
    : <Leaderboard toggle={toggle} />;
}

function RatingHeading({ personal, month }: { personal?: boolean; month?: boolean }) {
  return <header className="page-head"><div><h1 className="page-title">Рейтинг</h1>
    <p className="page-subtitle">{month ? "Места и номинации месяца — у линии и у чатов свои" : personal ? "Ваш результат по неделям" : "Результаты команды по неделям"}</p>
  </div></header>;
}

function Leaderboard({ toggle }: { toggle?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const selectedWeek = Number(params.get("week"));
  const weekId = Number.isInteger(selectedWeek) && selectedWeek > 0 ? selectedWeek : undefined;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const update = (values: Record<string, string | undefined>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); } setParams(next, { replace: "search" in values }); };
  const setPage = (value: number) => update({ page: String(value) });
  // Places are within a channel (docs/CHANNELS.md): one channel's table at a time.
  const channel = params.get("channel") === "chat" ? "chat" : "line";
  const size = 25;

  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks(104) });
  const board = useQuery({
    queryKey: ["rating", weekId, page, channel],
    queryFn: () => rating.leaderboard({ week_id: weekId, page, size, channel }),
    placeholderData: keepPreviousData,
  });

  if (board.isLoading) {
    return (
      <div className="stack"><RatingHeading /><div className="page-skeleton">
        <Skeleton height={36} width="34%" radius="var(--radius-s)" />
        <Skeleton height={170} radius="var(--radius-xl)" />
        <Skeleton height={300} radius="var(--radius-xl)" />
      </div></div>
    );
  }

  if (board.isError) {
    // На свежей системе недель ещё нет: это не сбой, а пустое состояние.
    if (board.error instanceof ApiError && board.error.status === 404) {
      return (
        <div className="stack">
          <RatingHeading />
          <Card>
            <EmptyState
              title="Конкурс ещё не начался"
              hint="Рейтинг появится, когда супервайзер заведёт неделю и выгрузит показатели"
            />
          </Card>
        </div>
      );
    }
    return <div className="stack"><RatingHeading /><ErrorState error={board.error} onRetry={() => board.refetch()} /></div>;
  }

  const data = board.data!;
  const { header } = data;
  const personal = data.view_mode === "personal";
  // Оператору чужие балансы не отдаются - колонка из одних прочерков только мешает.
  const showBalances = data.rows.some((row) => !row.is_me && row.balance !== null);

  return (
    <div className="stack">
      <RatingHeading personal={personal} />
      {toggle}
      {/* Переключатель недели: единственный фильтр рейтинга. */}
      <GlassSurface variant="regular" className="filterbar rating-filters">
        <WeekPicker label="Период" weeks={weeks.data ?? []} value={weekId}
          resolvedWeekId={header.week_id} loading={weeks.isLoading}
          onChange={(value) => update({ week: value === undefined ? undefined : String(value), page: undefined })} />
        <div className="rating-filter-status"><span className="field__label">Направление</span><div><SegmentedControl label="Направление" value={channel} options={[{ value: "line", label: "Линия" }, { value: "chat", label: "Чаты" }]} onChange={(value) => update({ channel: value === "chat" ? "chat" : undefined, page: undefined })} /></div></div>
        <div className="rating-filter-status"><span className="field__label">Статус итогов</span><div><Badge tone={header.status === "closed" ? "success" : "warning"}>{header.status === "closed" ? "Опубликованы" : header.status === "calculated" ? "Предварительный расчёт" : "Период ещё идёт"}</Badge></div></div>
      </GlassSurface>
      {weeks.isError && <p className="muted micro" role="status">Не удалось загрузить календарь недель. <button type="button" className="btn btn--plain btn--s" onClick={() => void weeks.refetch()}>Повторить</button></p>}

      {personal && <PersonalRatingCard data={data} />}

      {!personal && data.podium.length > 0 && (
        <Card title="Топ-3 недели" subtitle="Места недели для информации: призы разыгрываются раз в месяц">
          <ol className="podium">
            {data.podium.map((entry) => (
              <PodiumPlace key={entry.user_id} entry={entry} />
            ))}
          </ol>
        </Card>
      )}

      {data.nominations.length > 0 && (
        <Card title="Номинации недели">
          {/* Until the week is calculated nobody has won: one line instead of a card per nomination. */}
          {data.nominations.some((nomination) => nomination.winner_name || nomination.winner_hidden)
            ? <ul className="nominations">
              {data.nominations.map((nomination) => (
                <NominationItem key={nomination.code} nomination={nomination} />
              ))}
            </ul>
            : <p className="muted">Победителей пока нет: {data.nominations.length} {plural(data.nominations.length, "номинация определится", "номинации определятся", "номинаций определятся")} после расчёта недели.</p>}
        </Card>
      )}

      {!personal && data.my_row && <PersonalRatingCard data={data} />}
      {!personal && <Card title="Общая таблица" padded={false}>
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
                    <th>Команда</th>
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
                          <span className="cell-person__meta">{row.group_name ?? "Без команды"}</span>
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
      </Card>}

      {board.isFetching && <RowsSkeleton rows={1} />}
    </div>
  );
}

export function PersonalRatingCard({ data }: { data: RatingOut }) {
  const { header, my_row: row, my_podium_state: state } = data;
  const calculated = header.status !== "open" && state !== "uncalculated";
  return <Card title="Моё место" variant="highlight"
    subtitle={`${dateOnly(header.period_start)} — ${dateOnly(header.period_end)} · ${weekStatusLabel({ status: header.status, ends_on: header.period_end })}`}>
    <div className="rating-personal">
      {calculated && row?.rank != null ? <>
        <p className="rating-personal__place">Место <strong>{row.rank}</strong> из {header.participants}</p>
        <dl className="rating-personal__metrics">
          <div><dt>Баллы</dt><dd>{points(row.points)}</dd></div>
          <div><dt>{header.status === "closed" ? "Коины за неделю" : "Коины по расчёту"}</dt><dd><CoinAmount value={row.coins_week} size="s" /></dd></div>
          {row.rank_delta != null && <div><dt>Динамика места</dt><dd><Delta value={row.rank_delta} /></dd></div>}
        </dl>
      </> : <>
        <p className="rating-personal__place">{calculated ? "За эту неделю нет вашего результата" : "Место пока не рассчитано"}</p>
        <p className="secondary small">Участников: {header.participants}. {calculated ? "Уточните у супервайзера, загружены ли ваши показатели за выбранную неделю." : "Результат появится после загрузки показателей и расчёта недели."}</p>
      </>}
      {calculated && state === "on_podium" && <p className="rating-personal__podium"><MedalIcon size={16} />Вы на призовом месте</p>}
      {calculated && state === "outside_podium" && data.my_gap_to_podium != null && <div className="rating-personal__gap">
        <p>До призового результата — <strong>{points(data.my_gap_to_podium)} {pointsWord(data.my_gap_to_podium)}</strong></p>
        <p className="secondary small">При равном количестве баллов операторы делят место. Разница рассчитана по выбранной неделе.</p>
      </div>}
      {data.view_mode === "personal" && <p className="rating-personal__race"><Link to={`/race?week=${header.week_id}`}>Кого догнать и что подтянуть — в «Гонке недели» →</Link></p>}
    </div>
  </Card>;
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
      <td className="muted">{row.group_name ?? "Без команды"}</td>
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
      <span className="podium__points">{points(entry.points)} {pointsWord(entry.points)}</span>
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
          <span className="nomination__meta">{nomination.winner_hidden ? "Победитель определён · личные данные скрыты" : "Победитель не определён"}</span>
        )}
      </div>
    </li>
  );
}
