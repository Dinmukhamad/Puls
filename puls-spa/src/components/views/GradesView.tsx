import { useState } from 'react';
import { GRADES, GRADE_ORDER } from '../../mockData';
import { useStore } from '../../store';
import { POINTS_PER_COIN, WEIGHTS, round2 } from '../../lib/calc';
import { fmtNumber } from '../../lib/format';
import { PageHeader, Panel, PanelHeader, cx } from '../ui/primitives';

/**
 * Квалификации и симулятор.
 *
 * Симулятор считает по тому же ядру, что и настоящий расчёт: если бы он
 * повторял формулу у себя, они разошлись бы при первой же правке весов, и
 * руководитель принимал бы решения по неверной прикидке.
 */
export function GradesView(): JSX.Element {
  const { state } = useStore();
  const [quality, setQuality] = useState(92);
  const [density, setDensity] = useState(9);
  const [hours, setHours] = useState(38);
  const [penalty, setPenalty] = useState(6);

  const qualityPart = round2(quality * WEIGHTS.quality);
  const densityPart = round2(density * WEIGHTS.density);
  const hoursPart = round2(hours * WEIGHTS.hours);
  const penaltyPart = round2(penalty * WEIGHTS.penalty);
  const total = round2(qualityPart + densityPart + hoursPart - penaltyPart);

  return (
    <>
      <PageHeader
        title="Квалификации"
        hint="Четыре ступени. Множитель применяется к коинам, а не к баллам: баллы должны оставаться сопоставимыми между людьми."
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Лестница" hint="Условия перехода и множитель начисления" />
          <ol className="space-y-2.5">
            {GRADE_ORDER.map((id, index) => {
              const g = GRADES[id];
              const count = state.operators.filter((o) => o.gradeId === id).length;
              return (
                <li
                  key={id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="flex items-baseline gap-2">
                        <span className="font-mono tnum text-[12px] text-zinc-400 dark:text-zinc-600">
                          {index + 1}
                        </span>
                        <span className="text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{g.name}</span>
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {g.description}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono tnum text-[18px] text-zinc-900 dark:text-zinc-50">
                      {g.multiplier}×
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-zinc-100 pt-3 font-mono tnum text-[12.5px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <span>качество ≥ {g.minQuality}%</span>
                    <span>КВЗ ≥ {g.minDensity}</span>
                    <span className="ml-auto text-zinc-700 dark:text-zinc-300">{count} чел.</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel>
          <PanelHeader
            title="Симулятор начисления"
            hint="Подставьте показатели и посмотрите, что выйдет на каждой ступени"
          />

          <div className="space-y-4">
            <Slider label="Качество речи" value={quality} min={70} max={100} step={0.5} unit="%" onChange={setQuality} />
            <Slider label="КВЗ" value={density} min={4} max={16} step={0.1} unit="зв/ч" onChange={setDensity} />
            <Slider label="Часы на линии" value={hours} min={10} max={45} step={0.5} unit="ч" onChange={setHours} />
            <Slider label="Штрафные минуты" value={penalty} min={0} max={40} step={1} unit="мин" onChange={setPenalty} />
          </div>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-raised">
            <p className="font-mono text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {fmtNumber(qualityPart, 2)} + {fmtNumber(densityPart, 2)} + {fmtNumber(hoursPart, 2)} −{' '}
              {fmtNumber(penaltyPart, 2)}
            </p>
            <p className="mt-2 font-mono tnum text-[26px] leading-none text-zinc-900 dark:text-zinc-50">
              {fmtNumber(total, 2)}
            </p>
            <p className="mt-1 text-[12.5px] text-zinc-500 dark:text-zinc-400">итоговых баллов</p>
          </div>

          <table className="mt-4 w-full text-[13px]">
            <tbody>
              {GRADE_ORDER.map((id) => {
                const g = GRADES[id];
                const coins = total > 0 ? Math.round((total / POINTS_PER_COIN) * g.multiplier) : 0;
                const eligible = quality >= g.minQuality && density >= g.minDensity;
                return (
                  <tr key={id} className="border-t border-zinc-100 first:border-0 dark:border-zinc-800">
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">{g.name}</td>
                    <td className="py-2 text-right font-mono tnum text-zinc-500 dark:text-zinc-500">
                      {g.multiplier}×
                    </td>
                    <td
                      className={cx(
                        'py-2 text-right font-mono tnum',
                        eligible ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-300 dark:text-zinc-700',
                      )}
                    >
                      {fmtNumber(coins)}
                    </td>
                    <td className="py-2 pl-3 text-right text-[12px] text-zinc-400 dark:text-zinc-600">
                      {eligible ? 'условия выполнены' : 'условия не выполнены'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-500">
            Приглушённые строки — ступени, до которых при таких показателях не
            дотягивают. Число всё равно показано: видно, что даст переход.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-mono tnum text-zinc-900 dark:text-zinc-100">
          {fmtNumber(value, step < 1 ? 1 : 0)} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900 dark:bg-zinc-800 dark:accent-zinc-100"
      />
    </label>
  );
}
