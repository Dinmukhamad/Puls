import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { onUnauthorized, tokenStore } from "../api/client";
import { auth as authApi } from "../api/endpoints";
import type { Role, UserOut } from "../api/types";

interface AuthState {
  user: UserOut | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
  /** Роль не ниже указанной: operator < supervisor < head < admin. */
  atLeast: (role: Role) => boolean;
}

const ROLE_LEVEL: Record<Role, number> = {
  operator: 0,
  supervisor: 1,
  head: 2,
  admin: 3,
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Токен мог протухнуть в фоне - тогда клиент сообщает об этом сюда.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  // Восстановление сессии при перезагрузке страницы.
  useEffect(() => {
    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    authApi
      .me()
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        if (!cancelled) tokenStore.clear();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginName: string, password: string) => {
    const token = await authApi.login(loginName, password);
    tokenStore.save(token);
    setUser(await authApi.me());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      atLeast: (role) => (user ? ROLE_LEVEL[user.role] >= ROLE_LEVEL[role] : false),
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth вызван вне AuthProvider");
  return context;
}
