import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { NAV_GROUPS } from '../../mockData';
import { useStore } from '../../store';
import type { NavItem } from '../../types';
import { cx } from '../ui/primitives';

/**
 * Быстрый переход по разделам. Открывается по Ctrl/Cmd+K и по щелчку в
 * поле поиска верхней панели.
 *
 * Стрелки двигают выделение, Enter переходит — управление целиком с
 * клавиатуры, потому что смысл окна в том, чтобы не тянуться к мыши.
 * Разделы, закрытые для роли, в выдачу не попадают: показывать то, что
 * нельзя открыть, хуже, чем не показывать вовсе.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { dispatch, isManager } = useStore();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const all: Array<NavItem & { group: string }> = NAV_GROUPS.flatMap((g) =>
      g.items.filter((i) => !i.managerOnly || isManager).map((i) => ({ ...i, group: g.title })),
    );
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) ||
        i.hint.toLowerCase().includes(needle) ||
        i.group.toLowerCase().includes(needle),
    );
  }, [query, isManager]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const go = (index: number): void => {
    const item = results[index];
    if (!item) return;
    dispatch({ type: 'navigate', view: item.id });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Быстрый переход по разделам"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-panel"
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 dark:border-zinc-800">
          <Search size={16} className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => (results.length ? (c + 1) % results.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(cursor);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Найти раздел…"
            aria-label="Поиск по разделам"
            className="h-12 w-full bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto py-2" role="listbox" aria-label="Найденные разделы">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-[13.5px] text-zinc-500 dark:text-zinc-400">
              Ничего не нашлось. Попробуйте другое слово.
            </li>
          ) : (
            results.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === cursor}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(index)}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left',
                    index === cursor ? 'bg-zinc-100 dark:bg-zinc-800' : '',
                  )}
                >
                  <span>
                    <span className="block text-[13.5px] text-zinc-900 dark:text-zinc-100">{item.label}</span>
                    <span className="block text-[12px] text-zinc-500 dark:text-zinc-500">{item.hint}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">{item.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2.5 text-[11.5px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={12} /> перейти
          </span>
          <span>↑ ↓ выбор</span>
          <span>Esc закрыть</span>
        </div>
      </div>
    </div>
  );
}
