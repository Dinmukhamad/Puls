import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fleet as api, type FleetResponse, type FleetResult } from "../../api/dispatch";
import { FleetContext, FleetLogo, Icon, SearchModal, outsideCoach, type Fleet } from "./FleetUi";
import { RAIL, railFor, type FleetRoute } from "./fleetNav";
import { ContractorsPage } from "./FleetContractors";
import { DriverPage } from "./FleetDriver";
import { GoalsPage, HomePage, MapPage, ProfilePage, RulesPage } from "./FleetOverview";
import { InventoryPage } from "./FleetInventory";
import { SupportPage } from "./FleetSupport";
import { AntifraudPage, OrderPage } from "./FleetAntifraud";
import "./fleet.css";

export const FLEET_QUERY = ["dispatch"] as const;
export const DEFAULT_PARK = "itaxi-krg";

/**
 * Training copy of the fleet cabinet «Диспетчерская» inside the Work Sites browser tab.
 * The route and the park live in the address (`fleet`, `fpark`); every change goes to the
 * server, which answers with the whole cabinet and the mascot's verdict (`onResult`).
 */
export function DispatchSite({ route, parkId, go, onResult }: { route: FleetRoute; parkId: string; go: (path: string, park?: string) => void; onResult: (result: FleetResult & { at: number }) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: FLEET_QUERY, queryFn: api.state });
  const [menu, setMenu] = useState<string | null>(null), [searching, setSearching] = useState(false), [toast, setToast] = useState("");
  const main = useRef<HTMLDivElement>(null), rail = useRef<HTMLElement>(null);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); setMenu(null); }, [route.page, route.id, route.tab, parkId]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!rail.current?.contains(e.target as Node) && !outsideCoach(e)) setMenu(null); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  if (query.isPending) return <div className="fleet fleet-loading" role="status"><FleetLogo /> Открываем Диспетчерскую…</div>;
  if (query.isError) return <div className="fleet fleet-loading" role="alert"><p>{query.error.message}</p><button className="fleet-btn" onClick={() => query.refetch()}>Повторить</button></div>;
  const state = query.data, park = state.parks.find(p => p.id === parkId) ?? state.parks[0];
  const context: Fleet = {
    state, park, route, go, search: () => setSearching(true), notify: setToast,
    run: async (action: () => Promise<FleetResponse>, done?: string) => {
      const response = await action();
      client.setQueryData(FLEET_QUERY, response.state);
      // A solved call is a city mission step: the city picks it up without waiting for its poll.
      client.invalidateQueries({ queryKey: ["city"] });
      onResult({ ...response.result, at: Date.now() });
      if (done) setToast(done);
      return response;
    },
  };
  const active = railFor(route.page), group = RAIL.find(g => g.id === menu);
  const page = route.page === "home" ? <HomePage /> : route.page === "goals" ? <GoalsPage /> : route.page === "profile" ? <ProfilePage />
    : route.page === "map" ? <MapPage /> : route.page === "rules" ? <RulesPage /> : route.page === "inventory" ? <InventoryPage />
    : route.page === "support" ? <SupportPage /> : route.page === "antifraud" ? <AntifraudPage /> : route.page === "order" ? <OrderPage />
    : route.page === "driver" ? <DriverPage key={route.id} /> : <ContractorsPage />;
  return <FleetContext.Provider value={context}>
    <div className="fleet" data-page={route.page}>
      <nav className="fleet-rail" ref={rail} aria-label="Разделы Диспетчерской">
        <button className="fleet-logo" aria-label="Главная" onClick={() => go("home")}><FleetLogo /></button>
        {RAIL.map(g => <button key={g.id} className={`fleet-rail-button${active === g.id ? " is-active" : ""}`} data-coach={`rail-${g.id}`} aria-label={g.title} aria-expanded={menu === g.id} onClick={() => setMenu(m => m === g.id ? null : g.id)}><Icon name={g.icon} /></button>)}
        {group && <div className="fleet-flyout" data-coach="flyout" role="menu" aria-label={group.title} onKeyDown={e => { if (e.key === "Escape") setMenu(null); }}>
          <h2>{group.title}</h2>
          {group.items.map(([label, target]) => <button key={label} role="menuitem" disabled={!target} data-coach={target ? `menu-${target}` : undefined} className={target === route.page ? "is-current" : ""} onClick={() => { if (target) { setMenu(null); go(target); } }}>{label}{!target && <small>нет в обучении</small>}</button>)}
          <footer>Яндекс Про <span>для бизнеса</span> · учебная копия</footer>
        </div>}
      </nav>
      <div className="fleet-main" ref={main}>{page}</div>
      {searching && <SearchModal onClose={() => setSearching(false)} />}
      {toast && <div className="fleet-toast" role="status">{toast}<button aria-label="Закрыть" onClick={() => setToast("")}><Icon name="close" /></button></div>}
    </div>
  </FleetContext.Provider>;
}
