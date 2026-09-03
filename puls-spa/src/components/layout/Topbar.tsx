import { useEffect, useState } from 'react';
import { Bell, Check, Moon, Search, Sun, Ticket } from 'lucide-react';
import { PERIOD_LABEL, PERIOD_RANGE } from '../../mockData';
import { useStore } from '../../store';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { Badge, Button, cx } from '../ui/primitives';
import { CommandPalette } from './CommandPalette';

/**
 * Верхняя панель: поиск, роль, состояние периода, кошелёк, уведомления и
 * тема. Всё, что меняет режим работы приложения, собрано здесь — в
 * боковом меню осталась только навигация.
 */
export function Topbar(): JSX.Element {
  const { state, dispatch, me, isManager } = useStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const unread = state.notifications.filter((n) => !n.read).length;
  const calculated = state.periodStatus === 'calculated';

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-panel/85">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-left text-[13px] text-zinc-400 transition-colors hover:border-zinc-300 md:max-w-xs dark:border-zinc-800 dark:hover:border-zinc-700"
        >
          <Search size={15} className="shrink-0" />
          <span className="truncate">Поиск по разделам</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-400 sm:block dark:border-zinc-700">
            ⌘K
          </kbd>
        </button>

        {/* Переключатель роли: меняет права мгновенно, без перезагрузки. */}
        <div
          className="hidden shrink-0 items-center rounded-lg border border-zinc-200 p-0.5 sm:flex dark:border-zinc-800"
          role="group"
          aria-label="Роль"
        >
          {(['operator', 'manager'] as const).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => dispatch({ type: 'setRole', role })}
              aria-pressed={state.role === role}
              className={cx(
                'h-7 rounded-md px-2.5 text-[12.5px] transition-colors',
                state.role === role
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              {role === 'operator' ? 'Оператор' : 'Руководитель'}
            </button>
          ))}
        </div>

        {/* Состояние периода. Тумблер доступен только руководителю: это
            управляющее действие, а не индикатор. */}
        <button
          type="button"
          disabled={!isManager}
          onClick={() =>
            dispatch({ type: 'setPeriodStatus', status: calculated ? 'draft' : 'calculated' })
          }
          title={isManager ? 'Переключить состояние периода' : `${PERIOD_LABEL}: ${PERIOD_RANGE}`}
          className={cx(
            'hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors md:flex',
            'disabled:cursor-default',
            calculated
              ? 'border-affirm/30 text-affirm-dim dark:text-affirm'
              : 'border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400',
          )}
        >
          <span className="font-mono">{PERIOD_LABEL}</span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span>{calculated ? 'рассчитан' : 'ввод данных'}</span>
        </button>

        {/* Кошелёк ведёт в кабинет: баланс без места, где его потратить,
            бесполезен. */}
        <button
          type="button"
          onClick={() => dispatch({ type: 'navigate', view: 'cabinet' })}
          className="flex shrink-0 items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          aria-label={`Кошелёк: ${me.coins} коинов, ${me.tickets} билетов. Открыть кабинет`}
        >
          <span className="flex items-center gap-1 font-mono tnum text-[13px] text-zinc-900 dark:text-zinc-100">
            <span aria-hidden="true" className="text-coin">
              ●
            </span>
            {fmtNumber(me.coins)}
          </span>
          <span className="flex items-center gap-1 font-mono tnum text-[13px] text-zinc-500 dark:text-zinc-400">
            <Ticket size={13} />
            {me.tickets}
          </span>
        </button>

        <div className="relative shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBellOpen((v) => !v);
              if (!bellOpen && unread > 0) dispatch({ type: 'readNotifications' });
            }}
            aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
            aria-expanded={bellOpen}
          >
            <span className="relative">
              <Bell size={16} />
              {unread > 0 ? (
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-caution" />
              ) : null}
            </span>
          </Button>

          {bellOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-panel">
                <p className="border-b border-zinc-100 px-4 py-3 text-[13px] font-medium text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                  Последние события
                </p>
                <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                  {state.notifications.slice(0, 12).map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <p className="text-[13px] text-zinc-900 dark:text-zinc-100">{n.title}</p>
                      <p className="mt-0.5 text-[12.5px] text-zinc-500 dark:text-zinc-400">{n.detail}</p>
                      <p className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
                        {fmtDateTime(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'setTheme', theme: state.theme === 'dark' ? 'light' : 'dark' })}
          aria-label={state.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        >
          {state.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </header>

      {/* Роль на узком экране: в шапку не помещается, но скрывать её нельзя. */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 sm:hidden dark:border-zinc-800">
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">Роль:</span>
        {(['operator', 'manager'] as const).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => dispatch({ type: 'setRole', role })}
            aria-pressed={state.role === role}
            className={cx(
              'rounded-md px-2 py-1 text-[12.5px]',
              state.role === role
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 dark:text-zinc-400',
            )}
          >
            {role === 'operator' ? 'Оператор' : 'Руководитель'}
          </button>
        ))}
        <Badge tone={calculated ? 'affirm' : 'neutral'} mono>
          {calculated ? <Check size={11} /> : null}
          {PERIOD_LABEL}
        </Badge>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
