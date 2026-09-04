import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Одна сущность на два представления: снизу вверх на телефоне, окно по центру
 * на десктопе. Разделять их в код не нужно - отличается только раскладка.
 *
 * Закрывается по Esc, по клику вне, по свайпу вниз и по кнопке. Жест всегда
 * дублируется кнопкой: только на свайп полагаться нельзя.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "m",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "s" | "m" | "l";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  function onPointerDown(event: React.PointerEvent) {
    // Тянуть можно только за шапку: иначе жест конфликтует с прокруткой тела.
    dragStart.current = event.clientY;
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return;
    const delta = event.clientY - dragStart.current;
    if (delta > 0) setDragOffset(delta);
  }

  function onPointerUp() {
    if (dragOffset > 120) onClose();
    dragStart.current = null;
    setDragOffset(0);
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`sheet sheet--${size} glass glass--prominent`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        style={dragOffset ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        <header
          className="sheet__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__titles">
            <h2 className="sheet__title">{title}</h2>
            {subtitle && <p className="sheet__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>

        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
