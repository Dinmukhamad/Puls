import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export type CityToolbarSlot = "level" | "cities" | "build" | "missions" | "quests" | "skills" | "tools";
const slots: readonly CityToolbarSlot[] = ["level", "cities", "build", "missions", "quests", "skills", "tools"];

type CityToolbarTarget = {
  target: HTMLDivElement | null;
  attachTarget: (target: HTMLDivElement | null) => void;
};

export const CityToolbarContext = createContext<CityToolbarTarget | null>(null);

/** Keeps one stable destination for panels rendered by both the page and its map. */
export function CityToolbarProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const attachTarget = useCallback((element: HTMLDivElement | null) => setTarget(element), []);
  const value = useMemo(() => ({ target, attachTarget }), [target, attachTarget]);
  return <CityToolbarContext.Provider value={value}>{children}</CityToolbarContext.Provider>;
}

export function CityToolbar() {
  const toolbar = useContext(CityToolbarContext);
  return <div ref={toolbar?.attachTarget} className="city-toolbar" role="toolbar" aria-label="Панели города">
    {slots.map(slot => <div key={slot} className="city-toolbar__slot" data-city-panel={slot} />)}
  </div>;
}

/** A toolbar entry that acts at once instead of opening a popup, drawn like the panels' buttons in its own slot. */
export function CityToolbarButton({ slot, label, compactLabel, icon, onClick }: { slot: CityToolbarSlot; label: string; compactLabel: string; icon: ReactNode; onClick: () => void }) {
  const toolbar = useContext(CityToolbarContext);
  const button = <div className="city-peek city-peek--labelled city-toolbar-button">
    <button type="button" className="city-peek__trigger glass glass--regular" aria-label={label} title={label} onClick={onClick}>
      <span className="city-peek__icon" aria-hidden="true">{icon}</span>
      <span className="city-peek__label" aria-hidden="true">{compactLabel}</span>
    </button>
  </div>;
  const target = toolbar?.target?.querySelector(`[data-city-panel="${slot}"]`) ?? toolbar?.target;
  return target ? createPortal(button, target) : button;
}
