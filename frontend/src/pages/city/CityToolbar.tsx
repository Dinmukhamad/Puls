import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type CityToolbarSlot = "level" | "cities" | "build" | "missions" | "skills" | "tools";
const slots: readonly CityToolbarSlot[] = ["level", "cities", "build", "missions", "skills", "tools"];

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
