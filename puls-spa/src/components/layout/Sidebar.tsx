import {
  Activity, Award, BarChart3, Calculator, ClipboardCheck, Coins, Gift,
  LayoutDashboard, Layers, ShieldCheck, ShoppingBag, Target, Ticket, Trophy, UserRound, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV_GROUPS } from '../../mockData';
import { useStore } from '../../store';
import type { ViewId } from '../../types';
import { cx } from '../ui/primitives';

/**
 * Боковое меню. По требованию дизайн-системы здесь только навигация:
 * профиль и переключатели живут в верхней панели, иначе один и тот же
 * элемент оказывается в двух местах экрана.
 */

const ICONS: Record<ViewId, LucideIcon> = {
  summary: LayoutDashboard,
  cabinet: UserRound,
  rating: Trophy,
  missions: Target,
  tests: ClipboardCheck,
  wheel: Ticket,
  raffles: Gift,
  shop: ShoppingBag,
  staff: Users,
  grades: Layers,
  teams: Award,
  coins: Coins,
  analytics: BarChart3,
  period: Calculator,
  sessions: ShieldCheck,
};

export function Sidebar(): JSX.Element {
  const { state, dispatch, isManager } = useStore();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white lg:flex lg:flex-col dark:border-zinc-800 dark:bg-panel">
      <div className="flex h-14 items-center gap-2 px-5">
        <Activity size={18} className="text-zinc-900 dark:text-zinc-100" strokeWidth={2.4} />
        <span className="text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Puls<span className="text-zinc-400 dark:text-zinc-600">.</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Основная навигация">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.managerOnly || isManager);
          if (items.length === 0) return null;
          return (
            <div key={group.title} className="mb-5">
              <p className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-600">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = ICONS[item.id];
                  const active = state.view === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'navigate', view: item.id })}
                        aria-current={active ? 'page' : undefined}
                        title={item.hint}
                        className={cx(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
                          active
                            ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200',
                        )}
                      >
                        <Icon size={16} strokeWidth={1.9} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
