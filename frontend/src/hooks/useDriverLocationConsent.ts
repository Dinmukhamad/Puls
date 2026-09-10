import { useState } from "react";

export type LocationConsent = "ask" | "enabled" | "off";
export function useDriverLocationConsent(session: string) {
  const key = `pulse.driver-geoconsent:${session}`;
  const read = (): LocationConsent => { try { const value = sessionStorage.getItem(key); return value === "enabled" || value === "off" ? value : "ask"; } catch { return "ask"; } };
  const [stored, update] = useState(() => ({ key, value: read() }));
  const consent = stored.key === key ? stored.value : read();
  const setConsent = (value: LocationConsent) => { update({ key, value }); try { sessionStorage.setItem(key, value); } catch { /* Только текущее окно, если хранилище недоступно. */ } };
  return [consent, setConsent] as const;
}
