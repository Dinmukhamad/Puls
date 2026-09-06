import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const sheetStack: HTMLElement[] = [];
const backgroundStates = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
let previousBodyOverflow = "";
let backgroundObserver: MutationObserver | undefined;

function syncBackground() {
  const top = sheetStack.at(-1);
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || /^(SCRIPT|STYLE|LINK)$/.test(child.tagName)) continue;
    if (!backgroundStates.has(child)) {
      backgroundStates.set(child, { inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
    }
    child.inert = child !== top;
    if (child === top) child.removeAttribute("aria-hidden");
    else child.setAttribute("aria-hidden", "true");
  }
}

function registerSheet(overlay: HTMLElement) {
  if (sheetStack.length === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    backgroundObserver = new MutationObserver(syncBackground);
    backgroundObserver.observe(document.body, { childList: true });
  }
  sheetStack.push(overlay);
  syncBackground();

  return () => {
    const index = sheetStack.indexOf(overlay);
    if (index !== -1) sheetStack.splice(index, 1);
    if (sheetStack.length > 0) {
      syncBackground();
      return;
    }
    backgroundObserver?.disconnect();
    backgroundObserver = undefined;
    for (const [element, previous] of backgroundStates) {
      element.inert = previous.inert;
      if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", previous.ariaHidden);
    }
    backgroundStates.clear();
    document.body.style.overflow = previousBodyOverflow;
  };
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(
    'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]',
  )).filter((element) =>
    element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  );
}

/**
 * Одна сущность на два представления: снизу вверх на телефоне, окно по центру
 * на десктопе. Разделять их в код не нужно - отличается только раскладка.
 *
 * Закрывается по Esc, по клику вне, по свайпу вниз и по кнопке. Жест всегда
 * дублируется кнопкой: только на свайп полагаться нельзя.
 */
export function Sheet({
  id,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "m",
}: {
  id?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "s" | "m" | "l";
}) {
  const titleId = useId();
  const subtitleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [dragOffset, setDragOffset] = useState(0);
  const dragStart = useRef<number | null>(null);
  const dragDistance = useRef(0);

  useLayoutEffect(() => {
    const dialog = panel.current;
    const layer = overlay.current;
    if (!dialog || !layer) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    const unregister = registerSheet(layer);
    const onKey = (event: KeyboardEvent) => {
      if (sheetStack.at(-1) !== layer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusableElements(dialog);
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (sheetStack.at(-1) === layer && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      unregister();
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]") && previousFocus.getClientRects().length > 0) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    // Тянуть можно только за шапку: иначе жест конфликтует с прокруткой тела.
    if (!event.isPrimary || event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button, a, input, select, textarea"))) return;
    dragStart.current = event.clientY;
    dragDistance.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return;
    const delta = event.clientY - dragStart.current;
    dragDistance.current = Math.max(0, delta);
    setDragOffset(dragDistance.current);
  }

  function onPointerUp() {
    if (dragDistance.current > 120) closeRef.current();
    dragStart.current = null;
    dragDistance.current = 0;
    setDragOffset(0);
  }

  function cancelDrag() {
    dragStart.current = null;
    dragDistance.current = 0;
    setDragOffset(0);
  }

  return createPortal(
    <div
      className="overlay"
      ref={overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id={id}
        className={`sheet sheet--${size} glass glass--prominent`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        ref={panel}
        style={dragOffset ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        <header
          className="sheet__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
        >
          <span className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__titles">
            <h2 className="sheet__title" id={titleId}>{title}</h2>
            {subtitle && <p className="sheet__subtitle" id={subtitleId}>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>

        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
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
