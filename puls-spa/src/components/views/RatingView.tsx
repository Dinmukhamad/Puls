import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { GRADES, ME_ID, TEAMS, TEAM_ORDER } from '../../mockData';
import { useStore } from '../../store';
import { QUALITY_RED_LINE, coinsFor, isInRedZone, scoreOf } from '../../lib/calc';
import { fmtNumber, fmtPercent } from '../../lib/format';
import { Badge, PageHeader, Panel, TableShell, Td, Th, cx } from '../ui/primitives';
import type { Operator, TeamId } from '../../types';

type SortKey = 'score' | 'quality' | 'density' | 'penalty' | 'coins';

/**
 * Турнирная таблица. Сортировка и фильтры считаются на лету от общего
 * состояния: если руководитель изменит грейд, места пересчитаются сразу,
 * без отдельной кнопки обновления.
 */
export function RatingView(): JSX.Element {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState<TeamId | 'all'>('all');
  const [onlyRed, setOnlyRed] = useState(false);
  const [sort, setSort] = useState<SortKey>('score');
  const [desc, setDesc] = useState(true);

  const ranked = useMemo(() => {
    const withScore = state.operators.map((o) => ({
      operator: o,
      score: scoreOf(o).total,
      coins: coinsFor(o, GRADES[o.gradeId]),
    }));
    withScore.sort((a, b) => b.score - a.score);
    return withScore.map((row, index) => ({ ...row, place: index + 1 }));
  }, [state.operators]);

  const podium = ranked.slice(0, 3);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = ranked.filter(({ operator }) => {
      if (team !== 'all' && operator.teamId !== team) return false;
      if (onlyRed && !isInRedZone(operator)) return false;
      if (!needle) return true;
      return (
        operator.name.toLowerCase().includes(needle) ||
        TEAMS[operator.teamId].name.toLowerCase().includes(needle)
      );
    });

    const value = (row: (typeof ranked)[number]): number => {
      switch (sort) {
        case 'quality': return row.operator.metrics.quality;
        case 'density': return row.operator.metrics.density;
        case 'penalty': return row.operator.metrics.penaltyMinutes;
        case 'coins': return row.coins;
        default: return row.score;
      }
    };
    return [...filtered].sort((a, b) => (desc ? value(b) - value(a) : value(a) - value(b)));
  }, [ranked, query, team, onlyRed, sort, desc]);

  const toggleSort = (key: SortKey): void => {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(true);
    }
  };

  const SortTh = ({ label, keyName }: { label: string; keyName: SortKey }): JSX.Element => (
    <Th align="right">
      <button
        type="button"
        onClick={() => toggleSort(keyName)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        {sort === keyName ? (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />) : null}
      </button>
    </Th>
  );

  return (
    <>
      <PageHeader
        title="Рейтинг"
        hint={`${state.operators.length} операторов. Место определяется итоговыми баллами за период.`}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        {podium.map((row, i) => (
          <PodiumCard key={row.operator.id} place={i + 1} operator={row.operator} score={row.score} coins={row.coins} />
        ))}
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя или команда"
              aria-label="Поиск по имени или команде"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-transparent pl-9 pr-3 text-[13.5px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-600"
            />
          </label>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Фильтр по команде">
            <FilterChip active={team === 'all'} onClick={() => setTeam('all')}>Все</FilterChip>
            {TEAM_ORDER.map((id) => (
              <FilterChip key={id} active={team === id} onClick={() => setTeam(id)}>
                {TEAMS[id].name}
              </FilterChip>
            ))}
          </div>

          <FilterChip active={onlyRed} onClick={() => setOnlyRed((v) => !v)}>
            Красная зона
          </FilterChip>

          <span className="ml-auto font-mono tnum text-[12.5px] text-zinc-500 dark:text-zinc-400">
            {rows.length} из {state.operators.length}
          </span>
        </div>

        <div className="px-4 pb-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Место</Th>
                <Th>Оператор</Th>
                <Th>Команда</Th>
                <Th>Грейд</Th>
                <SortTh label="Баллы" keyName="score" />
                <SortTh label="Качество" keyName="quality" />
                <SortTh label="КВЗ" keyName="density" />
                <SortTh label="Штрафы" keyName="penalty" />
                <SortTh label="Коины" keyName="coins" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const red = isInRedZone(row.operator);
                const mine = row.operator.id === ME_ID;
                return (
                  <tr
                    key={row.operator.id}
                    className={cx(
                      'transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60',
                      mine && 'bg-zinc-50 dark:bg-zinc-900/80',
                    )}
                  >
                    <Td mono tone="muted">{row.place}</Td>
                    <Td>
                      <span className={cx(mine && 'font-medium text-zinc-900 dark:text-zinc-50')}>
                        {row.operator.name}
                      </span>
                      {mine ? <span className="ml-2 text-[11px] text-zinc-400">это вы</span> : null}
                    </Td>
                    <Td>{TEAMS[row.operator.teamId].name}</Td>
                    <Td>{GRADES[row.operator.gradeId].name}</Td>
                    <Td align="right" mono tone="strong">
                      {fmtNumber(row.score, 2)}
                    </Td>
                    <Td align="right" mono tone={red ? 'caution' : 'default'}>
                      {fmtPercent(row.operator.metrics.quality)}
                    </Td>
                    <Td align="right" mono>{fmtNumber(row.operator.metrics.density, 1)}</Td>
                    <Td align="right" mono tone={row.operator.metrics.penaltyMinutes > 15 ? 'caution' : 'default'}>
                      {row.operator.metrics.penaltyMinutes}
                    </Td>
                    <Td align="right" mono>{fmtNumber(row.coins)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-zinc-500 dark:text-zinc-400">
              Под фильтр никто не попал. Снимите ограничение или измените запрос.
            </p>
          ) : null}
        </div>
      </Panel>
    </>
  );
}

function PodiumCard({
  place,
  operator,
  score,
  coins,
}: {
  place: number;
  operator: Operator;
  score: number;
  coins: number;
}): JSX.Element {
  return (
    <Panel className={cx(place === 1 && 'border-zinc-300 dark:border-zinc-700')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono tnum text-[12px] text-zinc-400 dark:text-zinc-600">
            {place === 1 ? 'Первое место' : place === 2 ? 'Второе место' : 'Третье место'}
          </p>
          <p className="mt-1 truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{operator.name}</p>
          <p className="mt-0.5 text-[12.5px] text-zinc-500 dark:text-zinc-400">
            {TEAMS[operator.teamId].name} · {GRADES[operator.gradeId].name}
          </p>
        </div>
        <span className="font-mono tnum text-[26px] leading-none text-zinc-300 dark:text-zinc-700">{place}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="font-mono tnum text-[15px] text-zinc-900 dark:text-zinc-100">{fmtNumber(score, 2)}</span>
        <Badge tone="coin" mono>● {fmtNumber(coins)}</Badge>
      </div>
      {operator.metrics.quality < QUALITY_RED_LINE ? (
        <p className="mt-2 text-[12px] text-caution">Качество ниже порога — место под угрозой</p>
      ) : null}
    </Panel>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'h-8 rounded-lg px-3 text-[12.5px] transition-colors',
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900',
      )}
    >
      {children}
    </button>
  );
}
