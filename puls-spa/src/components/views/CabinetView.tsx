import { Award, Check, Lock } from 'lucide-react';
import { GRADES, GRADE_ORDER, PERIOD_LABEL, TEAMS } from '../../mockData';
import { useStore } from '../../store';
import { POINTS_PER_COIN, WEIGHTS, coinsFor, scoreOf } from '../../lib/calc';
import { fmtNumber, fmtPercent, pluralize } from '../../lib/format';
import { Badge, PageHeader, Panel, PanelHeader, Progress, cx } from '../ui/primitives';

/**
 * Кабинет оператора. Главное здесь — прозрачность расчёта: человек должен
 * видеть не итог, а как этот итог собран, иначе любая цифра выглядит
 * назначенной сверху.
 */
export function CabinetView(): JSX.Element {
  const { state, me } = useStore();
  const grade = GRADES[me.gradeId];
  const breakdown = scoreOf(me);
  const coins = coinsFor(me, grade);
  const team = TEAMS[me.teamId];

  const parts = [
    { label: 'Качество речи', raw: me.metrics.quality, unit: '%', weight: WEIGHTS.quality, value: breakdown.qualityPart, negative: false },
    { label: 'Норматив КВЗ', raw: me.metrics.density, unit: 'зв/ч', weight: WEIGHTS.density, value: breakdown.densityPart, negative: false },
    { label: 'Часы на линии', raw: me.metrics.hours, unit: 'ч', weight: WEIGHTS.hours, value: breakdown.hoursPart, negative: false },
    { label: 'Штрафные минуты', raw: me.metrics.penaltyMinutes, unit: 'мин', weight: WEIGHTS.penalty, value: breakdown.penaltyPart, negative: true },
  ];

  const maxPart = Math.max(...parts.map((p) => p.value), 1);
  const nextGradeId = GRADE_ORDER[GRADE_ORDER.indexOf(me.gradeId) + 1];
  const nextGrade = nextGradeId ? GRADES[nextGradeId] : null;

  const achievements = [
    { id: 'a1', title: 'Сто обращений', detail: 'Первая сотня закрытых обращений', done: true },
    { id: 'a2', title: 'Чистая неделя', detail: 'Период без штрафных минут', done: me.metrics.penaltyMinutes === 0 },
    { id: 'a3', title: 'Планка 95', detail: 'Качество речи выше 95%', done: me.metrics.quality >= 95 },
    { id: 'a4', title: 'Плотный поток', detail: 'КВЗ выше десяти звонков в час', done: me.metrics.density >= 10 },
    { id: 'a5', title: 'Полная норма', detail: 'Сорок часов на линии за период', done: me.metrics.hours >= 40 },
    { id: 'a6', title: 'Наставник', detail: 'Квалификация «Профи»', done: me.gradeId === 'pro' },
  ];

  return (
    <>
      <PageHeader
        title={me.name}
        hint={`Команда «${team.name}» · ${me.hiredWeeksAgo} ${pluralize(me.hiredWeeksAgo, 'неделя', 'недели', 'недель')} на линии`}
        action={<Badge>{grade.name} · {grade.multiplier}×</Badge>}
      />

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader
            title="Как посчитаны баллы"
            hint={`Период ${PERIOD_LABEL}. Каждая составляющая умножается на свой вес, штрафы вычитаются.`}
          />

          <div className="space-y-3.5">
            {parts.map((p) => (
              <div key={p.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-zinc-700 dark:text-zinc-300">{p.label}</span>
                  <span className="font-mono tnum text-zinc-500 dark:text-zinc-400">
                    {fmtNumber(p.raw, 1)} {p.unit} × {p.weight} ={' '}
                    <span className={cx('font-medium', p.negative ? 'text-caution' : 'text-zinc-900 dark:text-zinc-100')}>
                      {p.negative ? '−' : ''}{fmtNumber(p.value, 2)}
                    </span>
                  </span>
                </div>
                {/* Полоса показывает величину вклада, а не статус, поэтому
                    она нейтральная: зелёный в этой системе означает
                    «выполнено», и тратить его на размер составляющей значит
                    обесценить его там, где он действительно нужен. */}
                <Progress value={p.value} max={maxPart} />
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-raised">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[13px] text-zinc-600 dark:text-zinc-400">Итоговые баллы</span>
              <span className="font-mono tnum text-[24px] leading-none text-zinc-900 dark:text-zinc-50">
                {fmtNumber(breakdown.total, 2)}
              </span>
            </div>
            <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <p className="font-mono text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {fmtNumber(breakdown.total, 2)} ÷ {POINTS_PER_COIN} × {grade.multiplier} = {fmtNumber(coins)}
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span aria-hidden="true" className="text-coin">●</span>
                <span className="font-mono tnum text-[20px] text-zinc-900 dark:text-zinc-50">{fmtNumber(coins)}</span>
                <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
                  {state.periodStatus === 'calculated' ? 'начислено за период' : 'к начислению'}
                </span>
              </div>
            </div>
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-500">
            Множитель квалификации применяется к коинам, а не к баллам: баллы
            сравнивают операторов между собой и должны оставаться сопоставимыми.
          </p>
        </Panel>

        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Квалификация" hint={grade.description} />
            <ul className="space-y-2">
              {GRADE_ORDER.map((id) => {
                const g = GRADES[id];
                const current = id === me.gradeId;
                return (
                  <li
                    key={id}
                    className={cx(
                      'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                      current
                        ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-raised'
                        : 'border-transparent',
                    )}
                  >
                    <span className={cx('text-[13.5px]', current ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400')}>
                      {g.name}
                    </span>
                    <span className="font-mono tnum text-[13px] text-zinc-500 dark:text-zinc-400">{g.multiplier}×</span>
                  </li>
                );
              })}
            </ul>
            {nextGrade ? (
              <p className="mt-3 text-[12.5px] text-zinc-500 dark:text-zinc-400">
                До «{nextGrade.name}»: качество от {nextGrade.minQuality}% и КВЗ от {nextGrade.minDensity}.
                Сейчас {fmtPercent(me.metrics.quality)} и {fmtNumber(me.metrics.density, 1)}.
              </p>
            ) : (
              <p className="mt-3 text-[12.5px] text-affirm-dim dark:text-affirm">Высшая ступень достигнута.</p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Достижения" hint={`${achievements.filter((a) => a.done).length} из ${achievements.length}`} />
            <ul className="space-y-1.5">
              {achievements.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 py-1">
                  <span className={cx('mt-0.5 shrink-0', a.done ? 'text-affirm-dim dark:text-affirm' : 'text-zinc-300 dark:text-zinc-700')}>
                    {a.done ? <Check size={15} /> : <Lock size={14} />}
                  </span>
                  <span>
                    <span className={cx('block text-[13.5px]', a.done ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500')}>
                      {a.title}
                    </span>
                    <span className="block text-[12px] text-zinc-500 dark:text-zinc-500">{a.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Кошелёк" />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono tnum text-[22px] text-zinc-900 dark:text-zinc-50">{fmtNumber(me.coins)}</p>
                <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">коинов доступно</p>
              </div>
              <div className="text-right">
                <p className="font-mono tnum text-[22px] text-zinc-900 dark:text-zinc-50">{me.tickets}</p>
                <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">билетов WOW</p>
              </div>
              <Award size={22} className="shrink-0 text-zinc-300 dark:text-zinc-700" />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
