import { useState } from 'react';
import { Check, Ticket, Timer } from 'lucide-react';
import { useStore } from '../../store';
import { pluralize } from '../../lib/format';
import { Badge, Button, PageHeader, Panel, cx } from '../ui/primitives';
import { TestRunner } from '../modals/TestRunner';
import type { KnowledgeTest } from '../../types';

export function TestsView(): JSX.Element {
  const { state } = useStore();
  const [running, setRunning] = useState<KnowledgeTest | null>(null);

  const passed = state.tests.filter((t) => t.lastScore !== null && t.lastScore >= t.passPercent).length;

  return (
    <>
      <PageHeader
        title="Тесты знаний"
        hint="Скрипты, регламенты и безопасность. Сданный тест начисляет коины и билет WOW сразу."
        action={<Badge tone={passed === state.tests.length ? 'affirm' : 'neutral'}>{passed} из {state.tests.length} сдано</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.tests.map((test) => {
          const done = test.lastScore !== null && test.lastScore >= test.passPercent;
          const attempted = test.lastScore !== null;
          return (
            <Panel key={test.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11.5px] text-zinc-400 dark:text-zinc-600">{test.topic}</p>
                  <h3 className="mt-0.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{test.title}</h3>
                </div>
                {done ? <Check size={16} className="mt-1 shrink-0 text-affirm-dim dark:text-affirm" /> : null}
              </div>

              <dl className="mt-4 flex-1 space-y-2 text-[13px]">
                <Row label="Вопросов" value={String(test.questions.length)} />
                <Row
                  label="Время"
                  value={`${test.minutes} ${pluralize(test.minutes, 'минута', 'минуты', 'минут')}`}
                  icon={<Timer size={12} />}
                />
                <Row label="Проходной балл" value={`${test.passPercent}%`} />
                <Row
                  label="Последняя попытка"
                  value={attempted ? `${test.lastScore}%` : '—'}
                  tone={attempted ? (done ? 'affirm' : 'caution') : 'muted'}
                />
              </dl>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <div className="flex items-center gap-3 font-mono tnum text-[13px]">
                  <span className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100">
                    <span aria-hidden="true" className="text-coin">●</span>
                    {test.rewardCoins}
                  </span>
                  {test.rewardTickets > 0 ? (
                    <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                      <Ticket size={13} />
                      {test.rewardTickets}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant={done ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => setRunning(test)}
                >
                  {done ? 'Пройти заново' : attempted ? 'Повторить' : 'Начать'}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <TestRunner test={running} onClose={() => setRunning(null)} />
    </>
  );
}

function Row({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'affirm' | 'caution' | 'muted';
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={cx(
          'flex items-center gap-1.5 font-mono tnum',
          tone === 'affirm' && 'text-affirm-dim dark:text-affirm',
          tone === 'caution' && 'text-caution',
          tone === 'muted' && 'text-zinc-400 dark:text-zinc-600',
          tone === 'default' && 'text-zinc-800 dark:text-zinc-200',
        )}
      >
        {icon}
        {value}
      </dd>
    </div>
  );
}
