import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { GRADES, GRADE_ORDER, TEAMS } from '../../mockData';
import { useStore } from '../../store';
import { coinsFor, isInRedZone, scoreOf } from '../../lib/calc';
import { fmtNumber, fmtPercent, pluralize } from '../../lib/format';
import { PageHeader, Panel, TableShell, Td, Th, cx } from '../ui/primitives';
import type { GradeId } from '../../types';

/**
 * Штат. Смена грейда прямо в строке: это самое частое действие
 * руководителя, и уводить его в отдельное окно значит добавить два клика
 * к тому, что делается десятки раз за период.
 *
 * Начисление пересчитывается сразу — видно, во что обошлось решение.
 */
export function StaffView(): JSX.Element {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.operators
      .filter(
        (o) =>
          !needle ||
          o.name.toLowerCase().includes(needle) ||
          TEAMS[o.teamId].name.toLowerCase().includes(needle),
      )
      .map((o) => ({ operator: o, score: scoreOf(o).total, coins: coinsFor(o, GRADES[o.gradeId]) }));
  }, [state.operators, query]);

  const byGrade = GRADE_ORDER.map((id) => ({
    id,
    count: state.operators.filter((o) => o.gradeId === id).length,
  }));

  return (
    <>
      <PageHeader
        title="Штат операторов"
        hint="Грейд меняется здесь же. Начисление за период пересчитывается сразу после изменения."
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        {byGrade.map((g) => (
          <Panel key={g.id}>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{GRADES[g.id].name}</p>
            <p className="mt-1.5 font-mono tnum text-[22px] leading-none text-zinc-900 dark:text-zinc-50">
              {g.count}
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-zinc-400 dark:text-zinc-600">
              множитель {GRADES[g.id].multiplier}×
            </p>
          </Panel>
        ))}
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя или команда"
              aria-label="Поиск по штату"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-transparent pl-9 pr-3 text-[13.5px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-600"
            />
          </label>
          <span className="ml-auto font-mono tnum text-[12.5px] text-zinc-500 dark:text-zinc-400">
            {rows.length} {pluralize(rows.length, 'сотрудник', 'сотрудника', 'сотрудников')}
          </span>
        </div>

        <div className="px-4 pb-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Оператор</Th>
                <Th>Команда</Th>
                <Th align="right">Стаж</Th>
                <Th align="right">Качество</Th>
                <Th align="right">КВЗ</Th>
                <Th align="right">Баллы</Th>
                <Th>Грейд</Th>
                <Th align="right">Коины</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ operator, score, coins }) => (
                <tr key={operator.id} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <Td>{operator.name}</Td>
                  <Td>{TEAMS[operator.teamId].name}</Td>
                  <Td align="right" mono>{operator.hiredWeeksAgo} нед.</Td>
                  <Td align="right" mono tone={isInRedZone(operator) ? 'caution' : 'default'}>
                    {fmtPercent(operator.metrics.quality)}
                  </Td>
                  <Td align="right" mono>{fmtNumber(operator.metrics.density, 1)}</Td>
                  <Td align="right" mono>{fmtNumber(score, 2)}</Td>
                  <Td>
                    <select
                      value={operator.gradeId}
                      onChange={(e) =>
                        dispatch({
                          type: 'changeGrade',
                          operatorId: operator.id,
                          gradeId: e.target.value as GradeId,
                        })
                      }
                      aria-label={`Грейд оператора ${operator.name}`}
                      className={cx(
                        'h-8 w-full min-w-[120px] appearance-none rounded-lg border border-zinc-200 bg-transparent px-2.5 text-[13px]',
                        'text-zinc-800 outline-none focus:border-zinc-400',
                        'dark:border-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-600',
                      )}
                    >
                      {GRADE_ORDER.map((id) => (
                        <option key={id} value={id}>
                          {GRADES[id].name} · {GRADES[id].multiplier}×
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td align="right" mono tone="strong">
                    {fmtNumber(coins)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      </Panel>
    </>
  );
}
