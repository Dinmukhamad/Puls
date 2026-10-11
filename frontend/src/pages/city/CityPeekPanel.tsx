import { useContext, useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { CityToolbarContext } from "./CityToolbar";
import type { CityToolbarSlot } from "./CityToolbar";
import "./cityPeek.css";

export type CityPeekPanelProps = {
  label: string;
  compactLabel?: string;
  toolbarSlot?: CityToolbarSlot;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  triggerClassName?: string;
  /** Hears every opening and closing, e.g. to scroll the content when it shows. */
  onOpenChange?: (open: boolean) => void;
  /** A pending operation keeps the panel open; a close asked for meanwhile happens when it ends. */
  holdOpen?: boolean;
};

/**
 * A toolbar button and its popup; the popup's contents stay mounted while it is closed. It opens and closes on a
 * click or a tap only: hovering opens nothing, so the pointer may cross the toolbar on its way into a popup. In the
 * toolbar one popup is open at a time: another button switches to its own, and a tap on the map or Escape closes it
 * (CityToolbarProvider). Outside a toolbar the panel keeps its own state.
 */
export function CityPeekPanel({ label, compactLabel, toolbarSlot, icon, children, className = "", contentClassName = "", triggerClassName = "", onOpenChange, holdOpen = false }: CityPeekPanelProps) {
  const toolbar = useContext(CityToolbarContext);
  const contentId = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const shared = toolbar && toolbarSlot ? toolbar : null;
  const open = shared ? shared.active === toolbarSlot : localOpen;
  const expanded = holdOpen || open;
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Tab moving focus out of the popup closes it; a pointer elsewhere is the toolbar's to judge.
  const keyboard = useRef(false);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;

  function setOpen(next: boolean) {
    if (shared) shared.setActive(current => next ? toolbarSlot! : current === toolbarSlot ? null : current);
    else setLocalOpen(next);
  }

  useEffect(() => {
    notify.current?.(expanded);
    // A closed popup keeps no focus: it goes back to the button that opened it.
    if (!expanded && content.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
  }, [expanded]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Element | null;
    if (!keyboard.current || !next || root.current?.contains(next) || next.closest?.('[role="dialog"]')) return;
    keyboard.current = false;
    setOpen(false);
  }

  const panel = <div ref={root} className={`city-peek ${compactLabel ? "city-peek--labelled" : ""} ${className}`.trim()} data-open={String(expanded)}
    onPointerDownCapture={() => { keyboard.current = false; }}
    onBlur={handleBlur}
    onKeyDown={(event) => {
      if (event.key === "Tab") keyboard.current = true;
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }}>
    <button ref={trigger} type="button" className={`city-peek__trigger glass glass--regular ${triggerClassName}`.trim()}
      aria-label={label} aria-expanded={expanded} aria-controls={contentId} title={label}
      onClick={() => setOpen(!expanded)}>
      <span className="city-peek__icon" aria-hidden="true">{icon}</span>
      <span className="city-peek__close" aria-hidden="true">×</span>
      {compactLabel && <span className="city-peek__label" aria-hidden="true">{compactLabel}</span>}
    </button>
    <div ref={content} id={contentId} className={`city-peek__content ${contentClassName}`.trim()}
      hidden={!expanded} aria-hidden={!expanded} {...(!expanded ? { inert: "" } : {})}>
      {children}
    </div>
  </div>;
  const portalTarget = toolbarSlot ? toolbar?.target?.querySelector(`[data-city-panel="${toolbarSlot}"]`) ?? toolbar?.target : toolbar?.target;
  return portalTarget ? createPortal(panel, portalTarget) : panel;
}
