import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, onUnauthorized, tokenStore } from "../api/client";
import { auth as authApi } from "../api/endpoints";
import { useQueryClient } from "@tanstack/react-query";
import type { Role, UserOut } from "../api/types";

interface AuthState {
  user: UserOut | null;
  loading: boolean;
  restoreError: unknown;
  retryRestore: () => void;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retryRestore = useCallback(() => {
    setRestoreError(null);
    setLoading(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    await queryClient.cancelQueries();
    try {
      await authApi.logout();
    } catch {
      // При отсутствии сети завершаем локальный сеанс.
    } finally {
      tokenStore.clear();
      queryClient.clear();
      setUser(null);
      setLoading(false);
    }
  }, [queryClient]);

  // Токен мог протухнуть в фоне - тогда клиент сообщает об этом сюда.
  useEffect(() => onUnauthorized(() => { queryClient.clear(); setUser(null); }), [queryClient]);

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
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) setRestoreError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const login = useCallback(async (loginName: string, password: string) => {
    await queryClient.cancelQueries();
    queryClient.clear();
    const token = await authApi.login(loginName, password);
    tokenStore.save(token);
    setUser(await authApi.me());
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      restoreError,
      retryRestore,
      login,
      logout,
      atLeast: (role) => (user ? ROLE_LEVEL[user.role] >= ROLE_LEVEL[role] : false),
    }),
    [user, loading, restoreError, retryRestore, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth вызван вне AuthProvider");
  return context;
}
