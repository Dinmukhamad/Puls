import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { orderActive, type DriverState } from "../api/driver";
import { driverNavigation } from "../api/driverNavigation";
import { freshFix, type LocationState } from "../utils/driverLocation";

export function useDriverNavigation(state: DriverState | undefined, location: LocationState) {
  const client = useQueryClient();
  const current = useRef({ state, location }); current.current = { state, location };
  const activeId = orderActive(state?.order) && state?.order?.details?.navigation ? state.order.id : null;
  useEffect(() => {
    if (!activeId) return;
    let stopped = false, pending = false;
    async function send() {
      if (stopped || pending || document.visibilityState !== "visible") return;
      pending = true;
      const { state: latest, location: gps } = current.current;
      try {
        const data = await driverNavigation.position(activeId!, latest?.order?.details?.navigation?.mode === "real" && freshFix(gps.fix) ? gps.fix : undefined);
        if (!stopped) client.setQueryData<DriverState>(["driver-profile"], old => {
          if (old?.order?.id !== activeId || (data.order?.version ?? -1) < (old.order?.version ?? 0)) return old;
          return { ...data, ...(old.shift?.id === data.shift?.id && (old.shift?.version ?? 0) > (data.shift?.version ?? 0) ? { shift: old.shift } : {}) };
        });
      } catch { /* Действия проверят GPS ещё раз; сетевой сбой не меняет этап заказа. */ }
      finally { pending = false; }
    }
    void send();
    const timer = window.setInterval(() => { void send(); }, 10000);
    const show = () => { if (document.visibilityState === "visible") void send(); };
    document.addEventListener("visibilitychange", show);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", show); };
  }, [activeId, client]);
}
