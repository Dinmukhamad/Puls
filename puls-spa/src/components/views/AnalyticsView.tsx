import { HOURLY_LOAD, WEEKLY_TREND } from '../../mockData';
import { QUALITY_RED_LINE } from '../../lib/calc';
import { fmtNumber, fmtPercent } from '../../lib/format';
import { PageHeader, Panel, PanelHeader, cx } from '../ui/primitives';

/**
 * Аналитика. Графики нарисованы на SVG вручную: две диаграммы не стоят
 * библиотеки на полсотни килобайт, а собственная разметка позволяет
 * держать их в той же строгой палитре, что и остальной интерфейс.
 */
export function AnalyticsView(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Аналитика"
        hint="Тренд качества и плотности по неделям, распределение нагрузки по часам."
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Качество речи" hint={`W31 — W35. Пунктир — порог ${QUALITY_RED_LINE}%`} />
          <QualityChart />
          <ul className="mt-4 grid grid-cols-5 gap-2">
            {WEEKLY_TREND.map((p) => (
              <li key={p.week} className="text-center">
                <p className="font-mono text-[11.5px] text-zinc-400 dark:text-zinc-600">{p.week}</p>
                <p
                  className={cx(
                    'mt-0.5 font-mono tnum text-[13px]',
                    p.quality < QUALITY_RED_LINE ? 'text-caution' : 'text-zinc-800 dark:text-zinc-200',
                  )}
                >
                  {fmtPercent(p.quality)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Плотность и штрафы" hint="КВЗ растёт, штрафные минуты снижаются" />
          <div className="space-y-4">
            {WEEKLY_TREND.map((p) => {
              const maxDensity = Math.max(...WEEKLY_TREND.map((x) => x.density));
              const maxPenalty = Math.max(...WEEKLY_TREND.map((x) => x.penalties));
              return (
                <div key={p.week}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{p.week}</span>
                    <span className="font-mono tnum text-zinc-700 dark:text-zinc-300">
                      {fmtNumber(p.density, 1)} зв/ч · {p.penalties} мин штрафов
                    </span>
                  </div>
                  <div className="flex h-2 gap-1">
                    <div className="flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-zinc-900 dark:bg-zinc-200"
                        style={{ width: `${(p.density / maxDensity) * 100}%` }}
                      />
                    </div>
                    <div className="flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-caution/70"
                        style={{ width: `${(p.penalties / maxPenalty) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-5 border-t border-zinc-100 pt-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-zinc-900 dark:bg-zinc-200" /> КВЗ
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-caution/70" /> штрафные минуты
            </span>
          </div>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader title="Нагрузка по часам" hint="Обращения за сутки. Пик приходится на 11 и 15 часов." />
          <HourlyChart />
        </Panel>
      </div>
    </>
  );
}

function QualityChart(): JSX.Element {
  const W = 520;
  const H = 180;
  const PAD = 8;
  const min = 86;
  const max = 94;

  const x = (i: number): number => PAD + (i * (W - PAD * 2)) / (WEEKLY_TREND.length - 1);
  const y = (v: number): number => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);

  const line = WEEKLY_TREND.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.quality)}`).join(' ');
  const area = `${line} L ${x(WEEKLY_TREND.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-zinc-900 dark:text-zinc-100"
      role="img"
      aria-label={`Качество речи по неделям: ${WEEKLY_TREND.map((p) => `${p.week} ${p.quality}%`).join(', ')}`}
    >
      <defs>
        <linearGradient id="q-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <line
        x1={PAD}
        y1={y(QUALITY_RED_LINE)}
        x2={W - PAD}
        y2={y(QUALITY_RED_LINE)}
        stroke="#d97757"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <path d={area} fill="url(#q-fill)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {WEEKLY_TREND.map((p, i) => (
        <circle
          key={p.week}
          cx={x(i)}
          cy={y(p.quality)}
          r={i === WEEKLY_TREND.length - 1 ? 4 : 2.5}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

function HourlyChart(): JSX.Element {
  const max = Math.max(...HOURLY_LOAD.map((h) => h.calls));
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {HOURLY_LOAD.map((h) => (
          <div key={h.hour} className="flex flex-1 flex-col items-center gap-2">
            <span className="font-mono tnum text-[10.5px] text-zinc-400 dark:text-zinc-600">{h.calls}</span>
            <div
              className={cx(
                'w-full rounded-t transition-[height]',
                h.calls === max ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700',
              )}
              style={{ height: `${(h.calls / max) * 100}%` }}
              title={`${h.hour}:00 — ${h.calls} обращений`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {HOURLY_LOAD.map((h) => (
          <span key={h.hour} className="flex-1 text-center font-mono text-[10.5px] text-zinc-400 dark:text-zinc-600">
            {h.hour}
          </span>
        ))}
      </div>
    </div>
  );
}
