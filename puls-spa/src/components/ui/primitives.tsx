import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Примитивы интерфейса. Всё оформление живёт здесь: как только кнопку
 * можно оформить прямо в экране, через месяц в приложении шесть разных
 * кнопок, и ни одна не похожа на остальные.
 *
 * Цвет по правилам дизайн-системы функционален: серый — обычное действие,
 * белый на чёрном — основное, приглушённый зелёный — подтверждение,
 * тёплый — предупреждение. Никаких градиентов и свечения.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ── Поверхности ─────────────────────────────────────────── */

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}): JSX.Element {
  return (
    <div
      className={cx(
        'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-panel',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {hint ? (
          <p className="mt-1 max-w-2xl text-[14px] text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/* ── Кнопки ──────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-white dark:focus-visible:ring-zinc-500 dark:focus-visible:ring-offset-canvas ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
  outline:
    'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 ' +
    'dark:border-zinc-800 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-900',
  ghost:
    'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  danger:
    'border border-zinc-200 bg-white text-caution hover:bg-zinc-50 ' +
    'dark:border-zinc-800 dark:bg-transparent dark:hover:bg-zinc-900',
};

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[13.5px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Метки ───────────────────────────────────────────────── */

type BadgeTone = 'neutral' | 'affirm' | 'caution' | 'coin';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  affirm: 'bg-affirm/10 text-affirm-dim dark:bg-affirm/10 dark:text-affirm',
  caution: 'bg-caution/10 text-caution',
  coin: 'bg-coin/10 text-coin-dim dark:text-coin',
};

export function Badge({
  children,
  tone = 'neutral',
  mono = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  mono?: boolean;
}): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium',
        mono && 'font-mono tnum',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ── Показатель ──────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'affirm' | 'caution';
}): JSX.Element {
  const valueTone =
    tone === 'affirm'
      ? 'text-affirm-dim dark:text-affirm'
      : tone === 'caution'
        ? 'text-caution'
        : 'text-zinc-900 dark:text-zinc-50';
  return (
    <Panel>
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cx('mt-2 font-mono tnum text-[26px] leading-none font-medium', valueTone)}>
        {value}
      </p>
      {hint ? <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-500">{hint}</p> : null}
    </Panel>
  );
}

/* ── Полоса прогресса ────────────────────────────────────── */

export function Progress({
  value,
  max,
  tone = 'neutral',
}: {
  value: number;
  max: number;
  tone?: 'neutral' | 'affirm';
}): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'affirm' ? 'bg-affirm' : 'bg-zinc-900 dark:bg-zinc-200',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── Пустое состояние ────────────────────────────────────── */

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-zinc-800 dark:text-zinc-200">{title}</p>
      <p className="mt-1.5 max-w-md text-[13.5px] text-zinc-500 dark:text-zinc-400">{detail}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ── Таблица ─────────────────────────────────────────────── */

export function TableShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}): JSX.Element {
  return (
    <th
      scope="col"
      className={cx(
        'sticky top-0 z-10 bg-zinc-50 px-4 py-2.5 text-[12.5px] font-medium text-zinc-500',
        'dark:bg-zinc-900 dark:text-zinc-400',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

/**
 * Цвет ячейки задаётся тоном, а не классом снаружи.
 *
 * Иначе получается ловушка: базовый `dark:text-zinc-300` и переданный
 * `text-caution` имеют одинаковую специфичность, и побеждает тот, что
 * стоит позже в собранной таблице стилей, — порядок в атрибуте класса
 * ничего не решает. Подсветка молча не применялась, и качество ниже
 * порога выглядело обычным числом.
 */
export type CellTone = 'default' | 'strong' | 'muted' | 'caution' | 'affirm';

const CELL_TONES: Record<CellTone, string> = {
  default: 'text-zinc-700 dark:text-zinc-300',
  strong: 'font-medium text-zinc-900 dark:text-zinc-100',
  muted: 'text-zinc-500 dark:text-zinc-400',
  caution: 'text-caution',
  affirm: 'text-affirm-dim dark:text-affirm',
};

export function Td({
  children,
  align = 'left',
  mono = false,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  tone?: CellTone;
  className?: string;
}): JSX.Element {
  return (
    <td
      className={cx(
        'border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800/70',
        CELL_TONES[tone],
        align === 'right' && 'text-right',
        mono && 'font-mono tnum',
        className,
      )}
    >
      {children}
    </td>
  );
}
