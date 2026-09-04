import type { ReactNode } from "react";

import { coins, signed } from "../utils/format";

/* --------------------------------------------------------------------------
 * Карточка - базовый контейнер разделов
 * -------------------------------------------------------------------------- */

export function Card({
  title,
  action,
  children,
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {action && <div className="card__action">{action}</div>}
        </header>
      )}
      <div className={padded ? "card__body" : undefined}>{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * Плитка показателя (KPI). Значение крупное, дельта - со знаком и стрелкой,
 * чтобы направление читалось без опоры на цвет.
 * -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  hero = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Положительное - улучшение. Знак и стрелка обязательны. */
  delta?: number | null;
  deltaLabel?: string;
  hero?: boolean;
}) {
  return (
    <div className={hero ? "tile tile--hero" : "tile"}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {delta !== undefined && delta !== null && delta !== 0 && (
        <Delta value={delta} label={deltaLabel} />
      )}
      {hint && <span className="tile__hint">{hint}</span>}
    </div>
  );
}

export function Delta({ value, label }: { value: number; label?: string }) {
  const up = value > 0;
  return (
    <span className={up ? "delta delta--up" : "delta delta--down"}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {signed(value)}
      {label && <span className="delta__label">{label}</span>}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Индикатор выполнения плана. Заливка и дорожка - шаги одной шкалы.
 * -------------------------------------------------------------------------- */

export function Meter({
  completion,
  tone = "accent",
}: {
  completion: number;
  tone?: "accent" | "warning" | "critical";
}) {
  const pct = Math.max(0, Math.min(100, Math.round(completion * 100)));
  return (
    <div
      className={`meter meter--${tone}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="meter__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Значки состояния. Цвет всегда сопровождается текстом.
 * -------------------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "good" | "warning" | "critical";

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function CoinValue({ value, signed: withSign }: { value: number; signed?: boolean }) {
  const text = withSign ? signed(value) : coins(value);
  const tone = withSign ? (value > 0 ? "amount--up" : "amount--down") : "";
  return (
    <span className={`amount ${tone}`}>
      {text}
      <span className="amount__unit" aria-hidden="true">
        ◆
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Состояния загрузки, пустоты и ошибки
 * -------------------------------------------------------------------------- */

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" />
      <span className="spinner__text">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return (
    <div className="notice notice--critical" role="alert">
      <strong className="notice__title">Не удалось загрузить данные</strong>
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          Повторить
        </button>
      )}
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
        {from}-{to} из {total}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Назад
      </button>
      <span className="pagination__page">
        {page} / {pages}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Вперёд
      </button>
    </nav>
  );
}
