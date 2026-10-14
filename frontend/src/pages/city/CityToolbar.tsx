import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createPortal } from "react-dom";

export type CityToolbarSlot = "level" | "cities" | "build" | "missions" | "quests" | "skills" | "tools" | "history";
const slots: readonly CityToolbarSlot[] = ["level", "cities", "build", "missions", "quests", "skills", "tools", "history"];

/** The toolbar's one open popup, named by its slot; null when every popup is closed. */
export type CityToolbarState = { active: CityToolbarSlot | null; setActive: Dispatch<SetStateAction<CityToolbarSlot | null>> };
type CityToolbarValue = CityToolbarState & {
  target: HTMLDivElement | null;
  attachTarget: (target: HTMLDivElement | null) => void;
};

export const CityToolbarContext = createContext<CityToolbarValue | null>(null);

/** The open popup lives with the page, so a district chosen on the map can open its missions. */
export function useCityToolbarState(initial: CityToolbarSlot | null = null): CityToolbarState {
  const [active, setActive] = useState<CityToolbarSlot | null>(initial);
  return useMemo(() => ({ active, setActive }), [active]);
}

/** The map's own tap (city3d/engine/input.ts): moving the map is a drag, not a tap. */
const TAP_DISTANCE = 6, TAP_TIME = 600;
type Listening = Pick<Document, "addEventListener" | "removeEventListener" | "querySelector">;
const dialogs = ".sheet-overlay, [role=dialog][aria-modal=true]";
/**
 * Closes the open popup on a tap outside the toolbar and its dialogs, and on Escape. Dragging the map leaves it
 * open. The tap closes before its target acts on it, so a district tapped on the map can still open its missions.
 */
export function closeOnTapOutside(close: () => void, doc: Listening = document) {
  let start: { x: number; y: number; at: number } | null = null;
  const outside = (target: EventTarget | null) => !(target && typeof (target as Element).closest === "function" && (target as Element).closest(`.city-toolbar, [role=dialog], ${dialogs}`));
  const down = (event: PointerEvent) => { start = event.isPrimary && outside(event.target) ? { x: event.clientX, y: event.clientY, at: performance.now() } : null; };
  const up = (event: PointerEvent) => {
    if (!start || !event.isPrimary) return;
    const tap = Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_DISTANCE && performance.now() - start.at < TAP_TIME;
    start = null;
    if (tap) close();
  };
  // A sheet over the city takes its own Escape first.
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || doc.querySelector(dialogs)) return;
    event.preventDefault(); close();
  };
  doc.addEventListener("pointerdown", down as EventListener, true);
  doc.addEventListener("pointerup", up as EventListener, true);
  doc.addEventListener("keydown", key as EventListener);
  return () => {
    doc.removeEventListener("pointerdown", down as EventListener, true);
    doc.removeEventListener("pointerup", up as EventListener, true);
    doc.removeEventListener("keydown", key as EventListener);
  };
}

/** Keeps one stable destination for panels rendered by both the page and its map, and their one open popup. */
export function CityToolbarProvider({ children, state }: { children: ReactNode; state?: CityToolbarState }) {
  const own = useCityToolbarState();
  const { active, setActive } = state ?? own;
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const attachTarget = useCallback((element: HTMLDivElement | null) => setTarget(element), []);
  const open = active !== null;
  useEffect(() => open ? closeOnTapOutside(() => setActive(null)) : undefined, [open, setActive]);
  const value = useMemo(() => ({ target, attachTarget, active, setActive }), [target, attachTarget, active, setActive]);
  return <CityToolbarContext.Provider value={value}>{children}</CityToolbarContext.Provider>;
}

export function CityToolbar() {
  const toolbar = useContext(CityToolbarContext);
  return <div ref={toolbar?.attachTarget} className="city-toolbar" role="toolbar" aria-label="Панели города">
    {slots.map(slot => <div key={slot} className="city-toolbar__slot" data-city-panel={slot} />)}
  </div>;
}

/** A toolbar entry that acts at once instead of opening a popup, drawn like the panels' buttons in its own slot. */
export function CityToolbarButton({ slot, label, compactLabel, icon, onClick, tone }: { slot: CityToolbarSlot; label: string; compactLabel: string; icon: ReactNode; onClick: () => void; tone?: "warn" }) {
  const toolbar = useContext(CityToolbarContext);
  const button = <div className="city-peek city-peek--labelled city-toolbar-button" data-tone={tone}>
    <button type="button" className="city-peek__trigger glass glass--regular" aria-label={label} title={label} onClick={() => { toolbar?.setActive(null); onClick(); }}>
      <span className="city-peek__icon" aria-hidden="true">{icon}</span>
      <span className="city-peek__label" aria-hidden="true">{compactLabel}</span>
    </button>
  </div>;
  const target = toolbar?.target?.querySelector(`[data-city-panel="${slot}"]`) ?? toolbar?.target;
  return target ? createPortal(button, target) : button;
}
