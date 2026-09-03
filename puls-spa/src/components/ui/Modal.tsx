import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './primitives';

/**
 * Модальное окно с клавиатурой: Escape закрывает, фокус уходит внутрь при
 * открытии и возвращается на вызвавший элемент при закрытии, Tab не
 * убегает на страницу под затемнением.
 *
 * Ловушка фокуса написана руками, а не взята библиотекой: здесь она
 * занимает двадцать строк, а зависимость пришлось бы тащить в сборку
 * целиком.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    };

    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          'relative w-full rounded-t-2xl border border-zinc-200 bg-white shadow-2xl',
          'dark:border-zinc-800 dark:bg-panel sm:rounded-2xl',
          width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть окно">
            <X size={16} />
          </Button>
        </div>

        <div className="max-h-[64vh] overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
