import { useState } from 'react';
import { Minus, Plus, Ticket, Users } from 'lucide-react';
import { useStore } from '../../store';
import { fmtNumber, fmtPercent, pluralize } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Badge, Button, PageHeader, Panel, Progress, cx } from '../ui/primitives';
import type { Raffle } from '../../types';

/**
 * Розыгрыши. Шанс считается прямо из пула: билеты оператора к общему
 * числу. Показывать его обязательно — иначе непонятно, что даёт второй
 * билет, и внесение превращается в лотерею вслепую.
 */
export function RafflesView(): JSX.Element {
  const { state, me } = useStore();
  const [entering, setEntering] = useState<Raffle | null>(null);

  return (
    <>
      <PageHeader
        title="Розыгрыши"
        hint="Билеты вносятся в пул. Чем больше внесли, тем выше шанс — он пересчитывается сразу."
        action={<Badge mono><Ticket size={12} /> {me.tickets} на руках</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.raffles.map((raffle) => {
          const chance = raffle.totalTickets > 0 ? (raffle.myTickets / raffle.totalTickets) * 100 : 0;
          return (
            <Panel key={raffle.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11.5px] text-zinc-400 dark:text-zinc-600">{raffle.season}</p>
                  <h3 className="mt-0.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{raffle.title}</h3>
                </div>
                <span className="shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400">{raffle.endsIn}</span>
              </div>

              <p className="mt-2 text-[13.5px] text-zinc-600 dark:text-zinc-300">{raffle.prize}</p>

              <dl className="mt-4 flex-1 space-y-2 text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">Всего билетов в пуле</dt>
                  <dd className="font-mono tnum text-zinc-800 dark:text-zinc-200">{fmtNumber(raffle.totalTickets)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <Users size={12} /> Участников
                  </dt>
                  <dd className="font-mono tnum text-zinc-800 dark:text-zinc-200">{raffle.participants}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">Мои билеты</dt>
                  <dd className="font-mono tnum text-zinc-800 dark:text-zinc-200">{raffle.myTickets}</dd>
                </div>
              </dl>

              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Мой шанс</span>
                  <span
                    className={cx(
                      'font-mono tnum text-[15px]',
                      raffle.myTickets > 0 ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-600',
                    )}
                  >
                    {raffle.myTickets > 0 ? fmtPercent(chance, 2) : '—'}
                  </span>
                </div>
                <Progress value={chance} max={100} tone={raffle.myTickets > 0 ? 'affirm' : 'neutral'} />
                {raffle.myTickets === 0 ? (
                  <p className="mt-2 text-[12px] text-zinc-500 dark:text-zinc-500">
                    Билеты не внесены — участия пока нет.
                  </p>
                ) : null}
              </div>

              <Button
                variant="primary"
                className="mt-5"
                disabled={me.tickets === 0}
                onClick={() => setEntering(raffle)}
              >
                {me.tickets === 0 ? 'Нет билетов' : 'Внести билеты'}
              </Button>
            </Panel>
          );
        })}
      </div>

      <EnterRaffleModal raffle={entering} onClose={() => setEntering(null)} />
    </>
  );
}

function EnterRaffleModal({ raffle, onClose }: { raffle: Raffle | null; onClose: () => void }): JSX.Element | null {
  const { dispatch, me, state } = useStore();
  const [count, setCount] = useState(1);

  if (!raffle) return null;
  // Берём актуальную запись: пока окно открыто, пул мог измениться.
  const live = state.raffles.find((r) => r.id === raffle.id) ?? raffle;
  const max = me.tickets;
  const value = Math.min(Math.max(1, count), Math.max(1, max));
  const after = live.totalTickets + value;
  const chanceAfter = after > 0 ? ((live.myTickets + value) / after) * 100 : 0;
  const chanceNow = live.totalTickets > 0 ? (live.myTickets / live.totalTickets) * 100 : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={live.title}
      description={live.prize}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={max === 0}
            onClick={() => {
              dispatch({ type: 'enterRaffle', raffleId: live.id, tickets: value });
              onClose();
            }}
          >
            Внести {value} {pluralize(value, 'билет', 'билета', 'билетов')}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="sm" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Меньше билетов">
          <Minus size={15} />
        </Button>
        <span className="font-mono tnum text-[36px] leading-none text-zinc-900 dark:text-zinc-50">{value}</span>
        <Button variant="outline" size="sm" onClick={() => setCount((c) => Math.min(max, c + 1))} aria-label="Больше билетов">
          <Plus size={15} />
        </Button>
      </div>
      <p className="mt-2 text-center text-[12.5px] text-zinc-500 dark:text-zinc-400">
        доступно {max} {pluralize(max, 'билет', 'билета', 'билетов')}
      </p>

      <dl className="mt-6 space-y-2.5 rounded-lg border border-zinc-200 p-4 text-[13px] dark:border-zinc-800">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">Шанс сейчас</dt>
          <dd className="font-mono tnum text-zinc-700 dark:text-zinc-300">
            {live.myTickets > 0 ? fmtPercent(chanceNow, 2) : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
          <dt className="text-zinc-500 dark:text-zinc-400">Станет после внесения</dt>
          <dd className="font-mono tnum text-[15px] text-zinc-900 dark:text-zinc-50">{fmtPercent(chanceAfter, 2)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        Расчёт учитывает, что внесённые билеты увеличивают и общий пул: показанный
        шанс — тот, что будет на самом деле, а не завышенный.
      </p>
    </Modal>
  );
}
