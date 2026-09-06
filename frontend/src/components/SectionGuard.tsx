import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAccess } from "../auth/AccessContext";
import { AccessPage } from "../pages/AccessPage";
import { routeSection } from "../navigation";

export function SectionGuard({ children }: { children: ReactNode }) {
  const { canPath } = useAccess(); const location = useLocation();
  if (location.pathname !== "/" && !routeSection(location.pathname, location.search)) return <AccessPage missing />;
  return canPath(`${location.pathname}${location.search}`) ? children : <AccessPage />;
}
