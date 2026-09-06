import type { ButtonHTMLAttributes, ReactNode } from "react";

import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon } from "./icons";
import { coins, signed } from "../utils/format";

/* --------------------------------------------------------------------------
 * Кнопки. Четыре типа, больше не заводим.
 * -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "glass" | "destructive" | "plain";

export function Button({
  variant = "secondary",
  size = "m",
  block,
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "s" | "m" | "l";
  block?: boolean;
  icon?: ReactNode;
}) {
  const classes = [
    "btn",
    `btn--${variant}`,
    `btn--${size}`,
    block ? "btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} {...rest}>
      {icon && <span className="btn__icon">{icon}</span>}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------------
 * Поверхности
 * -------------------------------------------------------------------------- */

export function Card({
  title,
  subtitle,
  action,
  children,
  padded = true,
  variant = "standard",
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  variant?: "standard" | "elevated" | "highlight";
  className?: string;
}) {
  return (
    <section className={`card card--${variant} ${className}`.trim()}>
      {(title || action) && (
        <header className="card__head">
          <div className="card__titles">
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card__action">{action}</div>}
        </header>
      )}
      <div className={padded ? "card__body" : undefined}>{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * KPI. Обычная поверхность, не стекло: при десятке карточек стекло
 * превращает экран в витрину.
 * -------------------------------------------------------------------------- */

export function KPI({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Положительное значение - улучшение. Направление показывается стрелкой. */
  delta?: number | null;
  deltaLabel?: string;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "coin" | "xp";
}) {
  return (
    <div className={`kpi kpi--${tone}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">
        {value}
        {unit && <span className="kpi__unit">{unit}</span>}
      </span>
      {delta !== undefined && delta !== null && <Delta value={delta} label={deltaLabel} />}
      {hint && <span className="kpi__hint">{hint}</span>}
    </div>
  );
}

/** Направление читается по стрелке и знаку числа, не по одному лишь цвету. */
export function Delta({ value, label }: { value: number; label?: string }) {
  if (value === 0) {
    return (
      <span className="delta delta--flat">
        <span aria-hidden="true">→</span> без изменений
        {label && <span className="delta__label">{label}</span>}
      </span>
    );
  }
  const up = value > 0;
  return (
    <span className={up ? "delta delta--up" : "delta delta--down"}>
      {up ? <ArrowUpIcon size={14} /> : <ArrowDownIcon size={14} />}
      {signed(value)}
      {label && <span className="delta__label">{label}</span>}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Прогресс
 * -------------------------------------------------------------------------- */

export function Progress({
  value,
  tone = "accent",
  size = "m",
  label,
}: {
  /** Доля выполнения от 0 до 1. */
  value: number;
  tone?: "accent" | "xp" | "success" | "warning" | "danger";
  size?: "s" | "m" | "l";
  label?: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      className={`progress progress--${tone} progress--${size}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Метки состояний. Цвет всегда сопровождается текстом, часто значком.
 * -------------------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "xp" | "coin";

export function Badge({
  tone = "neutral",
  dot,
  icon,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {icon && <span className="badge__icon">{icon}</span>}
      {children}
    </span>
  );
}

export function StatusIcon({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "status-icon status-icon--ok" : "status-icon status-icon--bad"}>
      {ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
    </span>
  );
}

export function CoinAmount({
  value,
  signed: withSign,
  size = "m",
}: {
  value: number;
  signed?: boolean;
  size?: "s" | "m" | "l";
}) {
  const text = withSign ? signed(value) : coins(value);
  const tone = withSign ? (value > 0 ? " amount--up" : " amount--down") : "";
  return (
    <span className={`amount amount--${size}${tone}`}>
      {text}
      <span className="amount__coin" aria-hidden="true" />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Состояния экрана
 * -------------------------------------------------------------------------- */

export function Skeleton({
  height = 16,
  width,
  radius = "var(--radius-xs)",
}: {
  height?: number | string;
  width?: number | string;
  radius?: string;
}) {
  return (
    <span
      className="skeleton"
      style={{ height, width: width ?? "100%", borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** Скелетон повторяет структуру страницы, а не заливает её серым прямоугольником. */
export function KPISkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="kpi" key={index}>
          <Skeleton height={12} width="55%" />
          <Skeleton height={30} width="70%" />
          <Skeleton height={12} width="45%" />
        </div>
      ))}
    </div>
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rows-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div className="rows-skeleton__row" key={index}>
          <Skeleton height={14} width="28%" />
          <Skeleton height={14} width="42%" />
          <Skeleton height={14} width="14%" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state__glyph" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="state__title">{title}</p>
      {hint && <p className="state__hint">{hint}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  // Пользователю показывается человеческое сообщение, не трассировка стека.
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return (
    <div className="state state--error" role="alert">
      <span className="state__badge">
        <AlertIcon size={18} />
      </span>
      <p className="state__title">Не удалось загрузить данные</p>
      <p className="state__hint">{message}</p>
      {onRetry && (
        <div className="state__action">
          <Button onClick={onRetry}>Повторить</Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Сегментированный контрол и вкладки
 * -------------------------------------------------------------------------- */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  block?: boolean;
}) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      className={block ? "segmented segmented--block" : "segmented"}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={index === selectedIndex ? 0 : -1}
          className={value === option.value ? "segmented__item is-active" : "segmented__item"}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            const controls = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
            controls?.[next]?.focus();
            onChange(options[next].value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Постраничная навигация
 * -------------------------------------------------------------------------- */

export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;

  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <nav className="pagination" aria-label="Навигация по страницам">
      <span className="pagination__info">
        {from}–{to} из {total}
      </span>
      <Button size="s" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Назад
      </Button>
      <span className="pagination__page">
        {page} / {pages}
      </span>
      <Button size="s" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Вперёд
      </Button>
    </nav>
  );
}

/* --------------------------------------------------------------------------
 * Аватар. Цвет градиента стабильно выводится из идентификатора.
 * -------------------------------------------------------------------------- */

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#4f68ff,#7a5cfa)",
  "linear-gradient(135deg,#42a5ff,#4f68ff)",
  "linear-gradient(135deg,#7a5cfa,#c05cfa)",
  "linear-gradient(135deg,#28c798,#42a5ff)",
  "linear-gradient(135deg,#f2b84b,#ff8a5c)",
  "linear-gradient(135deg,#ff5d6c,#7a5cfa)",
];

export function Avatar({
  name,
  id,
  size = 40,
}: {
  name: string;
  id: number;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length],
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden="true"
    >
      <span className="avatar__initials">{initials}</span>
    </span>
  );
}
