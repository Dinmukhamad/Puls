import { useMemo, useState } from 'react';
import { Check, Download, FileSpreadsheet, Lock } from 'lucide-react';
import { GRADES, PERIOD_LABEL, PERIOD_RANGE, TEAMS } from '../../mockData';
import { useStore } from '../../store';
import { buildPayout, payoutToCsv } from '../../lib/calc';
import { fmtNumber } from '../../lib/format';
import { Badge, Button, PageHeader, Panel, PanelHeader, TableShell, Td, Th, cx } from '../ui/primitives';

interface CheckItem {
  id: string;
  label: string;
  detail: string;
}

const CHECKLIST: CheckItem[] = [
  { id: 'pbx', label: 'Логи АТС', detail: 'Звонки, длительность, время на линии' },
  { id: 'okk', label: 'Чек-листы ОКК', detail: 'Оценки качества речи по проверенным звонкам' },
  { id: 'discipline', label: 'Табель дисциплины', detail: 'Опоздания и превышения перерывов' },
];

/**
 * Расчёт периода. Закрытие необратимо в том смысле, что начисляет коины
 * всем сразу, поэтому оно спрятано за тремя подтверждениями источников
 * данных: пропущенный чек-лист ОКК означает, что у половины линии
 * качество ноль, и это заметят только после начисления.
 */
export function PeriodView(): JSX.Element {
  const { state, dispatch } = useStore();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => buildPayout(state.operators, GRADES, TEAMS).sort((a, b) => b.coins - a.coins),
    [state.operators],
  );

  const ready = CHECKLIST.every((c) => checked[c.id]);
  const closed = state.periodStatus === 'calculated';
  const totalCoins = rows.reduce((s, r) => s + r.coins, 0);
  const totalPoints = rows.reduce((s, r) => s + r.breakdown.total, 0);

  const download = (): void => {
    const csv = payoutToCsv(rows, PERIOD_LABEL);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `puls-vedomost-${PERIOD_LABEL}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Расчёт периода"
        hint={`${PERIOD_LABEL}, ${PERIOD_RANGE}. ${state.operators.length} сотрудников в ведомости.`}
        action={
          <>
            <Badge tone={closed ? 'affirm' : 'neutral'}>{closed ? 'Период закрыт' : 'Открыт'}</Badge>
            <Button onClick={download}>
              <Download size={15} /> Ведомость CSV
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader
              title="Источники данных"
              hint="Отметьте, что выгружено. Без всех трёх закрывать нельзя."
            />
            <ul className="space-y-2">
              {CHECKLIST.map((item) => {
                const on = Boolean(checked[item.id]);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={closed}
                      onClick={() => setChecked((c) => ({ ...c, [item.id]: !on }))}
                      className={cx(
                        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-60',
                        on
                          ? 'border-affirm/40 bg-affirm/5'
                          : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900',
                      )}
                    >
                      <span
                        className={cx(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          on
                            ? 'border-affirm bg-affirm text-white'
                            : 'border-zinc-300 dark:border-zinc-600',
                        )}
                      >
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      <span>
                        <span className="flex items-center gap-1.5 text-[13.5px] text-zinc-900 dark:text-zinc-100">
                          <FileSpreadsheet size={13} className="text-zinc-400" />
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] text-zinc-500 dark:text-zinc-400">
                          {item.detail}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <Button
              variant="primary"
              className="mt-5 w-full"
              disabled={!ready || closed}
              onClick={() => dispatch({ type: 'applyPeriod' })}
            >
              {closed ? (
                <>
                  <Lock size={14} /> Период уже закрыт
                </>
              ) : (
                `Закрыть период и начислить ${fmtNumber(totalCoins)}`
              )}
            </Button>

            {!ready && !closed ? (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Отметьте все три источника. Пропущенный чек-лист ОКК означает,
                что у части линии качество посчитается нулём, а заметят это уже
                после начисления.
              </p>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Итого по ведомости" />
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Сотрудников" value={String(rows.length)} />
              <Row label="Сумма баллов" value={fmtNumber(totalPoints, 2)} />
              <Row label="К начислению" value={fmtNumber(totalCoins)} strong />
              <Row
                label="Средний коэффициент"
                value={`${fmtNumber(rows.reduce((s, r) => s + r.multiplier, 0) / rows.length, 2)}×`}
              />
            </dl>
          </Panel>
        </div>

        <Panel padded={false}>
          <div className="p-5 pb-3">
            <PanelHeader
              title="Ведомость"
              hint="Каждая строка раскрывает, из чего сложился балл и во что он превратился"
            />
          </div>
          <div className="max-h-[560px] overflow-y-auto px-5 pb-5">
            <TableShell>
              <thead>
                <tr>
                  <Th>Оператор</Th>
                  <Th>Грейд</Th>
                  <Th align="right">Кач.×0.4</Th>
                  <Th align="right">КВЗ×0.3</Th>
                  <Th align="right">Часы×0.3</Th>
                  <Th align="right">Штрафы</Th>
                  <Th align="right">Баллы</Th>
                  <Th align="right">Коины</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.operatorId} className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                    <Td>{r.name}</Td>
                    <Td tone="muted" className="whitespace-nowrap">
                      {r.grade} · {r.multiplier}×
                    </Td>
                    <Td align="right" mono>{fmtNumber(r.breakdown.qualityPart, 2)}</Td>
                    <Td align="right" mono>{fmtNumber(r.breakdown.densityPart, 2)}</Td>
                    <Td align="right" mono>{fmtNumber(r.breakdown.hoursPart, 2)}</Td>
                    <Td align="right" mono tone={r.breakdown.penaltyPart > 0 ? 'caution' : 'default'}>
                      {r.breakdown.penaltyPart > 0 ? `−${fmtNumber(r.breakdown.penaltyPart, 2)}` : '0'}
                    </Td>
                    <Td align="right" mono tone="strong">
                      {fmtNumber(r.breakdown.total, 2)}
                    </Td>
                    <Td align="right" mono tone="strong">
                      {fmtNumber(r.coins)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={cx(
          'font-mono tnum',
          strong ? 'text-[16px] text-zinc-900 dark:text-zinc-50' : 'text-zinc-700 dark:text-zinc-300',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
