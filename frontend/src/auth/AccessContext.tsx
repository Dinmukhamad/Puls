import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi, type AccessMap, type SectionCode } from "../api/access";
import { onSectionDenied } from "../api/client";
import { useAuth } from "./AuthContext";
import { canVisit, visibleNavigation } from "../navigation";

const AccessContext = createContext<{
  allowed: AccessMap; can: (code: SectionCode) => boolean; canPath: (to: string) => boolean;
  loading: boolean; error: Error | null; refresh: () => void; home: string;
}>({ allowed: {}, can: () => false, canPath: () => false, loading: true, error: null, refresh: () => {}, home: "/profile" });

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user, retryRestore } = useAuth(); const client = useQueryClient();
  const query = useQuery({ queryKey: ["my-access", user?.id], queryFn: ({ signal }) => accessApi.mine(signal), enabled: !!user, refetchInterval: 30_000, refetchOnWindowFocus: true, staleTime: 0 });
  const fingerprint = query.data ? JSON.stringify([user?.id, query.data.role, query.data.group_id, query.data.scope_groups, query.data.allowed]) : "";
  const previous = useRef("");
  useEffect(() => {
    if (user && query.data && (user.role !== query.data.role || (user.group?.id ?? null) !== query.data.group_id)) retryRestore();
  }, [user, query.data, retryRestore]);
  useEffect(() => {
    if (fingerprint && previous.current && fingerprint !== previous.current) {
      // Cancel responses from the previous scope, then discard cached protected views.
      const filters = { predicate: (entry: { queryKey: readonly unknown[] }) => entry.queryKey[0] !== "my-access" };
      void client.cancelQueries(filters).then(() => client.resetQueries(filters));
    }
    previous.current = fingerprint;
  }, [client, fingerprint]);
  useEffect(() => onSectionDenied(() => { void client.invalidateQueries({ queryKey: ["my-access"] }); }), [client]);
  const allowed = query.data?.allowed ?? {};
  const role = query.data?.role ?? user?.role ?? "operator";
  const refresh = () => { void query.refetch(); };
  return <AccessContext.Provider value={{ allowed, can: (code) => allowed[code] === true, canPath: (to) => canVisit(role, to, allowed), home: visibleNavigation(role, allowed)[0]?.to ?? "/profile", loading: !!user && query.isPending, error: query.error, refresh }}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);
