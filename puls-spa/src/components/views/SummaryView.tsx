import { ArrowRight, TriangleAlert } from 'lucide-react';
import { GRADES, PERIOD_LABEL, PERIOD_RANGE, TEAMS } from '../../mockData';
import { useStore } from '../../store';
import { QUALITY_RED_LINE, averageOf, coinsFor, isInRedZone, scoreOf, teamQuality } from '../../lib/calc';
import { fmtNumber, fmtPercent, orDash } from '../../lib/format';
import { Badge, Button, PageHeader, Panel, PanelHeader, Stat, Td, Th, TableShell } from '../ui/primitives';

/**
 * Сводка. Для руководителя — состояние линии одним экраном, для
 * оператора — его собственная смена. Один и тот же маршрут показывает
 * разное, потому что вопрос «как дела» у них разный.
 */
export function SummaryView(): JSX.Element {
  const { state, me, isManager, dispatch } = useStore();
  const calculated = state.periodStatus === 'calculated';

  if (!isManager) {
    const breakdown = scoreOf(me);
    const grade = GRADES[me.gradeId];
    return (
      <>
        <PageHeader
          title="Моя смена"
          hint={`Период ${PERIOD_LABEL}, ${PERIOD_RANGE}. ${
            calculated ? 'Расчёт закрыт, начисления проведены.' : 'Период открыт: показатели ещё уточняются.'
          }`}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Качество речи" value={fmtPercent(me.metrics.quality)} hint={`порог ${QUALITY_RED_LINE}%`} tone={isInRedZone(me) ? 'caution' : 'affirm'} />
          <Stat label="КВЗ" value={fmtNumber(me.metrics.density, 1)} hint="звонков в час" />
          <Stat label="Часы на линии" value={fmtNumber(me.metrics.hours, 1)} hint="за период" />
          <Stat label="Штрафные минуты" value={fmtNumber(me.metrics.penaltyMinutes)} hint={me.metrics.penaltyMinutes === 0 ? 'нарушений нет' : 'вычитаются из баллов'} tone={me.metrics.penaltyMinutes > 10 ? 'caution' : 'neutral'} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Предварительный расчёт" hint={`Квалификация «${grade.name}», множитель ${grade.multiplier}×`} />
            <p className="font-mono tnum text-[32px] leading-none text-zinc-900 dark:text-zinc-50">
              {fmtNumber(breakdown.total, 2)}
            </p>
            <p className="mt-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">итоговых баллов</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-coin" aria-hidden="true">●</span>
              <span className="font-mono tnum text-[20px] text-zinc-900 dark:text-zinc-50">
                {fmtNumber(coinsFor(me, grade))}
              </span>
              <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
                {calculated ? 'начислено' : 'к начислению'}
              </span>
            </div>
            <Button className="mt-5" onClick={() => dispatch({ type: 'navigate', view: 'cabinet' })}>
              Как это посчитано <ArrowRight size={14} />
            </Button>
          </Panel>

          <Panel>
            <PanelHeader title="Что можно сделать сейчас" hint="Действия, которые влияют на баланс" />
            <ul className="space-y-2.5">
              {[
                { view: 'missions' as const, label: 'Забрать награды по миссиям', detail: `${state.missions.filter((m) => m.state === 'ready').length} готово` },
                { view: 'tests' as const, label: 'Пройти тест знаний', detail: `${state.tests.filter((t) => t.lastScore === null).length} не пройдено` },
                { view: 'wheel' as const, label: 'Прокрутить Колесо WOW', detail: `${me.tickets} ${me.tickets === 1 ? 'билет' : 'билета'}` },
                { view: 'shop' as const, label: 'Потратить коины', detail: `${fmtNumber(me.coins)} на балансе` },
              ].map((row) => (
                <li key={row.view}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'navigate', view: row.view })}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3.5 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <span className="text-[13.5px] text-zinc-800 dark:text-zinc-200">{row.label}</span>
                    <span className="shrink-0 font-mono tnum text-[12.5px] text-zinc-500 dark:text-zinc-400">{row.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </>
    );
  }

  /* ── Руководитель ──────────────────────────────────────── */

  const ops = state.operators;
  const redZone = ops.filter(isInRedZone);
  const avgQuality = teamQuality(ops);
  const avgDensity = averageOf(ops.map((o) => o.metrics.density));
  const totalPenalty = ops.reduce((s, o) => s + o.metrics.penaltyMinutes, 0);
  const payroll = ops.reduce((s, o) => s + coinsFor(o, GRADES[o.gradeId]), 0);

  return (
    <>
      <PageHeader
        title="Сводка"
        hint={`Период ${PERIOD_LABEL}, ${PERIOD_RANGE}. ${ops.length} операторов на линии.`}
        action={
          <Badge tone={calculated ? 'affirm' : 'neutral'}>
            {calculated ? 'Период рассчитан' : 'Идёт ввод данных'}
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Качество линии" value={orDash(avgQuality, (v) => fmtPercent(v))} hint="взвешено по числу проверок" tone={avgQuality !== null && avgQuality < QUALITY_RED_LINE ? 'caution' : 'affirm'} />
        <Stat label="Средний КВЗ" value={orDash(avgDensity, (v) => fmtNumber(v, 1))} hint="звонков в час" />
        <Stat label="Штрафные минуты" value={fmtNumber(totalPenalty)} hint="суммарно по линии" tone={totalPenalty > 400 ? 'caution' : 'neutral'} />
        <Stat label="Фонд к выплате" value={fmtNumber(payroll)} hint={calculated ? 'начислено за период' : 'предварительно'} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_1fr]">
        <Panel padded={false}>
          <div className="p-5">
            <PanelHeader
              title="Красная зона"
              hint={`Качество ниже ${QUALITY_RED_LINE}% — риск не пройти порог периода`}
              action={<Badge tone={redZone.length ? 'caution' : 'affirm'}>{redZone.length} из {ops.length}</Badge>}
            />
          </div>
          {redZone.length === 0 ? (
            <p className="px-5 pb-6 text-[13.5px] text-zinc-500 dark:text-zinc-400">
              Ни один оператор не ниже порога. Это хороший знак, а не отсутствие данных.
            </p>
          ) : (
            <div className="px-5 pb-5">
              <TableShell>
                <thead>
                  <tr>
                    <Th>Оператор</Th>
                    <Th>Команда</Th>
                    <Th align="right">Качество</Th>
                    <Th align="right">Проверок</Th>
                  </tr>
                </thead>
                <tbody>
                  {redZone.slice(0, 8).map((o) => (
                    <tr key={o.id}>
                      <Td>{o.name}</Td>
                      <Td>{TEAMS[o.teamId].name}</Td>
                      <Td align="right" mono tone="caution">{fmtPercent(o.metrics.quality)}</Td>
                      <Td align="right" mono>{o.metrics.auditedCalls}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              {redZone.length > 8 ? (
                <p className="mt-3 text-[12.5px] text-zinc-500 dark:text-zinc-400">
                  Показаны первые восемь. Остальные {redZone.length - 8} — в рейтинге с фильтром по красной зоне.
                </p>
              ) : null}
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Команды" hint="Взвешенное качество и плотность" />
          <ul className="space-y-3">
            {Object.values(TEAMS).map((team) => {
              const members = ops.filter((o) => o.teamId === team.id);
              const q = teamQuality(members);
              const d = averageOf(members.map((m) => m.metrics.density));
              const risky = members.filter(isInRedZone).length;
              return (
                <li key={team.id} className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3 last:border-0 last:pb-0 dark:border-zinc-800">
                  <div>
                    <p className="text-[13.5px] text-zinc-900 dark:text-zinc-100">{team.name}</p>
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-500">
                      {members.length} чел. · руководитель {team.lead}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 font-mono tnum text-[13px]">
                    <span className={q !== null && q < QUALITY_RED_LINE ? 'text-caution' : 'text-zinc-700 dark:text-zinc-300'}>
                      {orDash(q, (v) => fmtPercent(v))}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">{orDash(d, (v) => fmtNumber(v, 1))}</span>
                    {risky > 0 ? (
                      <span className="flex items-center gap-1 text-caution" title={`${risky} в красной зоне`}>
                        <TriangleAlert size={13} />
                        {risky}
                      </span>
                    ) : (
                      <span className="text-zinc-300 dark:text-zinc-700">—</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
