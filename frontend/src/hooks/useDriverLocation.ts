import { useEffect, useRef, useState } from "react";
import { trackDriverLocation, type LocationState } from "../utils/driverLocation";

const initial: LocationState = { fix: null, status: "requesting", message: "Определяем местоположение…" };
export function useDriverLocation(enabled: boolean) {
  const [state, setState] = useState(initial);
  const controller = useRef<ReturnType<typeof trackDriverLocation>>();
  useEffect(() => {
    if (!enabled) { setState(initial); return; }
    const tracker = trackDriverLocation(setState, { navigator, document, now: Date.now, interval: (callback, ms) => window.setInterval(callback, ms), clear: id => window.clearInterval(id) });
    controller.current = tracker;
    return () => { tracker.stop(); controller.current = undefined; };
  }, [enabled]);
  return { ...state, retry: () => controller.current?.retry() };
}
