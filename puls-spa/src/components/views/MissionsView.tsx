import { Check, Clock, Lock, Ticket } from 'lucide-react';
import { CHAPTERS } from '../../mockData';
import { useStore } from '../../store';
import { fmtNumber, pluralize } from '../../lib/format';
import { Badge, Button, EmptyState, PageHeader, Panel, Progress, cx } from '../ui/primitives';
import type { Mission, MissionStep } from '../../types';

/**
 * Миссии по главам. Прогресс шага считается отношением текущего значения
 * к цели, а не хранится отдельным полем: иначе он рано или поздно
 * разъезжается с самими значениями.
 */
export function MissionsView(): JSX.Element {
  const { state } = useStore();

  const ready = state.missions.filter((m) => m.state === 'ready').length;
  const claimed = state.missions.filter((m) => m.state === 'claimed').length;

  return (
    <>
      <PageHeader
        title="Миссии"
        hint="Кампании по главам. Награда начисляется на баланс сразу после нажатия «Забрать»."
        action={
          <>
            {ready > 0 ? <Badge tone="affirm">{ready} готово к получению</Badge> : null}
            <Badge>{claimed} из {state.missions.length} закрыто</Badge>
          </>
        }
      />

      <div className="space-y-8">
        {CHAPTERS.map((chapter) => {
          const missions = state.missions.filter((m) => m.chapterId === chapter.id);
          if (missions.length === 0) return null;
          return (
            <section key={chapter.id}>
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{chapter.title}</h2>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{chapter.subtitle}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {missions.map((mission) => (
                  <MissionCard key={mission.id} mission={mission} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function stepProgress(step: MissionStep): number {
  // Цель «ноль» означает «не допустить»: выполнено, пока значение не выросло.
  if (step.target === 0) return step.current === 0 ? 1 : 0;
  return Math.min(1, step.current / step.target);
}

function MissionCard({ mission }: { mission: Mission }): JSX.Element {
  const { dispatch } = useStore();
  const done = mission.steps.filter((s) => stepProgress(s) >= 1).length;
  const locked = mission.state === 'locked';
  const claimed = mission.state === 'claimed';
  const ready = mission.state === 'ready';

  return (
    <Panel className={cx('flex flex-col', locked && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] text-zinc-400 dark:text-zinc-600">{mission.category}</p>
          <h3 className="mt-0.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{mission.title}</h3>
        </div>
        {locked ? (
          <Lock size={15} className="mt-1 shrink-0 text-zinc-400" />
        ) : claimed ? (
          <Check size={16} className="mt-1 shrink-0 text-affirm-dim dark:text-affirm" />
        ) : null}
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{mission.summary}</p>

      {mission.deadlineHours !== null && !claimed ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
          <Clock size={12} />
          осталось {mission.deadlineHours} {pluralize(mission.deadlineHours, 'час', 'часа', 'часов')}
        </p>
      ) : null}

      <ul className="mt-4 flex-1 space-y-3">
        {mission.steps.map((step) => {
          const p = stepProgress(step);
          return (
            <li key={step.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="text-zinc-600 dark:text-zinc-400">{step.label}</span>
                <span className="shrink-0 font-mono tnum text-zinc-500 dark:text-zinc-500">
                  {step.target === 0
                    ? `${step.current} ${step.unit}`
                    : `${fmtNumber(step.current, step.current % 1 ? 1 : 0)} / ${fmtNumber(step.target, step.target % 1 ? 1 : 0)} ${step.unit}`}
                </span>
              </div>
              <Progress value={p * 100} max={100} tone={p >= 1 ? 'affirm' : 'neutral'} />
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex items-center gap-3 font-mono tnum text-[13px]">
          <span className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100">
            <span aria-hidden="true" className="text-coin">●</span>
            {mission.rewardCoins}
          </span>
          {mission.rewardTickets > 0 ? (
            <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
              <Ticket size={13} />
              {mission.rewardTickets}
            </span>
          ) : null}
        </div>

        {claimed ? (
          <span className="text-[12.5px] text-affirm-dim dark:text-affirm">Награда получена</span>
        ) : ready ? (
          <Button variant="primary" size="sm" onClick={() => dispatch({ type: 'claimMission', missionId: mission.id })}>
            Забрать награду
          </Button>
        ) : locked ? (
          <span className="text-[12.5px] text-zinc-400 dark:text-zinc-600">Откроется позже</span>
        ) : (
          <span className="font-mono text-[12.5px] text-zinc-500 dark:text-zinc-400">
            {done} из {mission.steps.length}
          </span>
        )}
      </div>
    </Panel>
  );
}

export function MissionsEmpty(): JSX.Element {
  return <EmptyState title="Миссий пока нет" detail="Новые кампании появятся с началом следующей главы." />;
}
