import { useMemo } from "react";
import type { CityEstates } from "../../api/cityEstate";
import { fullCity } from "./fullCity";
import "./cityHistory.css";

/**
 * The city's land built up (fullCity.ts) for «Весь город», made again only when the districts themselves change:
 * the land polled every few seconds keeps the same made-up city, so the map does not rebuild it.
 */
export function useFullCity(state: CityEstates | undefined): CityEstates | undefined {
  const key = state ? JSON.stringify([state.city, state.districts.map(d => [d.id, d.name, d.number, d.mine, d.managed, !!d.land, d.landmark?.name ?? null, d.hq.level])]) : "";
  return useMemo(() => state && fullCity(state), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What the map shows while «Весь город» is on, and the way back to the real city; a phone keeps it to one line. */
export function CityFullBanner({ onLeave }: { onLeave: () => void }) {
  return <div className="city-history-banner city-full-banner glass glass--regular" role="status">
    <span>🏙️ <strong>Весь город застроен</strong><span className="city-full-banner__about"> · так город может выглядеть, когда команды застроят всю землю</span> · только просмотр</span>
    <button type="button" onClick={onLeave}>Выйти</button>
  </div>;
}
