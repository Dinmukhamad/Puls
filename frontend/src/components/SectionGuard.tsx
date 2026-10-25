import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAccess } from "../auth/AccessContext";
import { AccessPage } from "../pages/AccessPage";
import { routeSection } from "../navigation";

/** `standalone`: the route has no AppLayout around it, so the refusal brings its own <main>. */
export function SectionGuard({ children, standalone = false }: { children: ReactNode; standalone?: boolean }) {
  const { canPath } = useAccess(); const location = useLocation();
  const refuse = (page: ReactNode) => standalone ? <main>{page}</main> : page;
  if (location.pathname !== "/" && !routeSection(location.pathname, location.search)) return refuse(<AccessPage missing />);
  return canPath(`${location.pathname}${location.search}`) ? children : refuse(<AccessPage />);
}
