import { GRADES, TEAMS, TEAM_ORDER } from '../../mockData';
import { useStore } from '../../store';
import { QUALITY_RED_LINE, averageOf, coinsFor, isInRedZone, scoreOf, teamQuality } from '../../lib/calc';
import { fmtNumber, fmtPercent, orDash } from '../../lib/format';
import { Badge, PageHeader, Panel, TableShell, Td, Th, cx } from '../ui/primitives';

/**
 * Сравнение команд. Средняя оценка взвешена по числу проверенных звонков:
 * простое среднее по людям позволило бы одному оператору с тремя
 * проверками перевесить десяток с сотней каждый.
 */
export function TeamsView(): JSX.Element {
  const { state } = useStore();

  const rows = TEAM_ORDER.map((id) => {
    const team = TEAMS[id];
    const members = state.operators.filter((o) => o.teamId === id);
    const quality = teamQuality(members);
    const density = averageOf(members.map((m) => m.metrics.density));
    const hours = members.reduce((s, m) => s + m.metrics.hours, 0);
    const penalties = members.reduce((s, m) => s + m.metrics.penaltyMinutes, 0);
    const score = averageOf(members.map((m) => scoreOf(m).total));
    const payroll = members.reduce((s, m) => s + coinsFor(m, GRADES[m.gradeId]), 0);
    const risky = members.filter(isInRedZone).length;
    return { team, members, quality, density, hours, penalties, score, payroll, risky };
  });

  const bestScore = Math.max(...rows.map((r) => r.score ?? 0));

  return (
    <>
      <PageHeader
        title="Команды"
        hint="Четыре группы линии. Качество взвешено по числу проверенных звонков, остальное — среднее по составу."
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => {
          const leading = r.score !== null && r.score === bestScore;
          return (
            <Panel key={r.team.id} className={cx(leading && 'border-zinc-300 dark:border-zinc-700')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{r.team.name}</h3>
                  <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-500">{r.team.lead}</p>
                </div>
                {leading ? <Badge tone="affirm">лидер</Badge> : null}
              </div>
              <p className="mt-4 font-mono tnum text-[24px] leading-none text-zinc-900 dark:text-zinc-50">
                {orDash(r.score, (v) => fmtNumber(v, 2))}
              </p>
              <p className="mt-1 text-[12.5px] text-zinc-500 dark:text-zinc-400">средний балл</p>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-[12.5px] dark:border-zinc-800">
                <span className="text-zinc-500 dark:text-zinc-400">{r.members.length} чел.</span>
                {r.risky > 0 ? (
                  <span className="font-mono tnum text-caution">{r.risky} в красной зоне</span>
                ) : (
                  <span className="text-affirm-dim dark:text-affirm">без риска</span>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel padded={false}>
        <div className="p-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Команда</Th>
                <Th>Руководитель</Th>
                <Th align="right">Состав</Th>
                <Th align="right">Качество</Th>
                <Th align="right">КВЗ</Th>
                <Th align="right">Часы</Th>
                <Th align="right">Штрафы</Th>
                <Th align="right">Средний балл</Th>
                <Th align="right">Фонд</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team.id} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <Td tone="strong">{r.team.name}</Td>
                  <Td>{r.team.lead}</Td>
                  <Td align="right" mono>{r.members.length}</Td>
                  <Td
                    align="right"
                    mono
                    tone={r.quality !== null && r.quality < QUALITY_RED_LINE ? 'caution' : 'default'}
                  >
                    {orDash(r.quality, (v) => fmtPercent(v))}
                  </Td>
                  <Td align="right" mono>{orDash(r.density, (v) => fmtNumber(v, 1))}</Td>
                  <Td align="right" mono>{fmtNumber(r.hours, 1)}</Td>
                  <Td align="right" mono tone={r.penalties > 120 ? 'caution' : 'default'}>
                    {fmtNumber(r.penalties)}
                  </Td>
                  <Td align="right" mono tone="strong">
                    {orDash(r.score, (v) => fmtNumber(v, 2))}
                  </Td>
                  <Td align="right" mono>{fmtNumber(r.payroll)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      </Panel>
    </>
  );
}
