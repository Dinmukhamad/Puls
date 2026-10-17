import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { city } from "../api/city";
import { useAuth } from "../auth/AuthContext";
import type { CoachStep } from "../pages/crm/coachTours";
import { FINISH } from "./siteTour";

const SiteTourCoach = lazy(() => import("./SiteTourCoach"));

interface SiteTour {
  /** Only operators walk the tour: it is their Academy mission. */
  available: boolean;
  running: boolean;
  start: () => void;
}
const SiteTourContext = createContext<SiteTour>({ available: false, running: false, start: () => {} });
/** Pulsar's tour of the site: whether it can run and how to start it. */
export const useSiteTour = () => useContext(SiteTourContext);

/**
 * Holds Pulsar's tour across the site's sections (it lives in the app's layout, so going from page to page keeps it).
 * Reaching the step marked `FINISH` tells the server once; the Academy's mission is then ready to claim in «Навыки».
 */
export function SiteTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const available = user?.role === "operator";
  const [run, setRun] = useState(0), [running, setRunning] = useState(false);
  const told = useRef(false);
  const finish = useMutation({ mutationFn: city.finishTour, onSuccess: () => client.invalidateQueries({ queryKey: ["city"] }) });
  const start = useCallback(() => { told.current = false; setRun(n => n + 1); setRunning(true); }, []);
  const onStep = useCallback((step: CoachStep) => {
    if (step.slot !== FINISH || told.current) return;
    told.current = true; finish.mutate();
  }, [finish]);
  const value = useMemo(() => ({ available, running: running && available, start }), [available, running, start]);
  return <SiteTourContext.Provider value={value}>
    {children}
    {value.running && <Suspense fallback={null}><SiteTourCoach key={run} onClose={() => setRunning(false)} onStep={onStep} /></Suspense>}
  </SiteTourContext.Provider>;
}
