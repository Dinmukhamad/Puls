import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import "./cityPeek.css";

export type CityPeekPanelProps = {
  label: string;
  compactLabel?: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  holdOpen?: boolean;
};

/** Map overlays keep their contents mounted while giving the city most of the screen. */
export function CityPeekPanel({ label, compactLabel, icon, children, className = "", contentClassName = "", triggerClassName = "", open, onOpenChange, holdOpen = false }: CityPeekPanelProps) {
  const contentId = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = holdOpen || (open ?? localOpen);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hovering = useRef(false);
  const keyboardFocus = useRef(false);
  const restoringFocus = useRef(false);
  const deferredClose = useRef(false);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;

  function requestOpen(next: boolean) {
    if (next) deferredClose.current = false;
    if (holdOpen && !next) { deferredClose.current = true; return; }
    if (open === undefined) setLocalOpen(next);
    else notify.current?.(next);
  }

  function close() {
    if (holdOpen) { deferredClose.current = true; return; }
    deferredClose.current = false;
    // A button clicked with the mouse must not remain focused in hidden content.
    if (content.current?.contains(document.activeElement)) {
      restoringFocus.current = true;
      trigger.current?.focus({ preventScroll: true });
      restoringFocus.current = false;
    }
    requestOpen(false);
  }

  const closeCurrent = useRef(close);
  closeCurrent.current = close;

  useEffect(() => {
    if (!holdOpen && deferredClose.current) closeCurrent.current();
  }, [holdOpen]);

  useEffect(() => {
    if (open === undefined) notify.current?.(expanded);
  }, [expanded, open]);

  useEffect(() => {
    if (!expanded) return;
    function outsideTouch(event: PointerEvent) {
      if (event.pointerType === "touch" && !root.current?.contains(event.target as Node)) closeCurrent.current();
    }
    document.addEventListener("pointerdown", outsideTouch);
    return () => document.removeEventListener("pointerdown", outsideTouch);
  }, [expanded]);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    if (restoringFocus.current) return;
    const target = event.target as HTMLElement;
    // Portal dialogs bubble React focus events through their opener's component tree.
    if (!root.current?.contains(target)) return;
    // Text fields also match :focus-visible after mouse clicks; pointer intent wins there.
    const textField = target.matches("input, textarea, [contenteditable='true']");
    if (!textField && target.matches(":focus-visible")) keyboardFocus.current = true;
    if (target !== trigger.current && keyboardFocus.current) requestOpen(true);
  }

  return <div ref={root} className={`city-peek ${compactLabel ? "city-peek--labelled" : ""} ${className}`.trim()} data-open={String(expanded)}
    onPointerEnter={(event) => {
      if (event.pointerType === "touch") return;
      hovering.current = true;
      requestOpen(true);
    }}
    onPointerLeave={(event) => {
      if (event.pointerType === "touch") return;
      hovering.current = false;
      if (keyboardFocus.current && (root.current?.contains(document.activeElement) || document.activeElement?.closest('[role="dialog"]'))) return;
      close();
    }}
    onPointerDownCapture={() => { keyboardFocus.current = false; }}
    onFocus={handleFocus}
    onBlur={(event) => {
      if (root.current?.contains(event.relatedTarget as Node)) return;
      if (keyboardFocus.current && (event.relatedTarget as Element | null)?.closest('[role="dialog"]')) return;
      keyboardFocus.current = false;
      if (!hovering.current) close();
    }}
    onKeyDown={(event) => {
      keyboardFocus.current = true;
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      keyboardFocus.current = false;
      close();
    }}>
    <button ref={trigger} type="button" className={`city-peek__trigger glass glass--regular ${triggerClassName}`.trim()}
      aria-label={label} aria-expanded={expanded} aria-controls={contentId} title={label}
      onClick={() => requestOpen(!expanded)}>
      <span className="city-peek__icon" aria-hidden="true">{icon}</span>
      <span className="city-peek__close" aria-hidden="true">×</span>
      {compactLabel && <span className="city-peek__label" aria-hidden="true">{compactLabel}</span>}
    </button>
    <div ref={content} id={contentId} className={`city-peek__content ${contentClassName}`.trim()}
      hidden={!expanded} aria-hidden={!expanded} {...(!expanded ? { inert: "" } : {})}>
      {children}
    </div>
  </div>;
}
