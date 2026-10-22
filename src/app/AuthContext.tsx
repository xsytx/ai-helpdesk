import type { User } from "@/entities/user";
import { fetchMe, toUser } from "@/features/auth/api";
import { getAuthToken, getErrorStatus, setAuthToken, TOKEN_KEY } from "@/shared/api/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const USER_KEY = "ai_helpdesk_user";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(() =>
    getAuthToken() ? readStoredUser() : null,
  );

  // Cached data (chat history, likes, moderation queue...) belongs to one
  // account: drop it whenever the account changes.
  const login = useCallback((nextUser: User, token: string) => {
    setAuthToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    queryClient.clear();
    setUser(nextUser);
  }, [queryClient]);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem(USER_KEY);
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  // The login is shared by every tab of this site. When another tab logs in
  // as someone else or logs out, follow it at once — otherwise this tab
  // would keep showing the old account while its requests use the new login.
  const userRef = useRef(user);
  userRef.current = user;

  // Ask the backend who the current login belongs to. Drop the session if the
  // token is no longer valid (expired, or left over from the old demo login)
  // or the account no longer exists. An answer about a login that has since
  // changed (e.g. another tab logged in as someone else) is ignored, so it
  // can never pair the new login with the old account's name.
  const refreshMe = useCallback(() => {
    const token = getAuthToken();
    if (!token) return;
    fetchMe()
      .then((me) => {
        if (getAuthToken() !== token) return;
        const next = toUser(me);
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        if (next.id !== userRef.current?.id) queryClient.clear();
        setUser(next);
      })
      .catch((err) => {
        if (getAuthToken() !== token) return;
        const status = getErrorStatus(err);
        if (status === 401 || status === 404) logout();
      });
  }, [logout, queryClient]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TOKEN_KEY && e.key !== USER_KEY) return;
      const next = getAuthToken() ? readStoredUser() : null;
      if (next?.id !== userRef.current?.id) queryClient.clear();
      setUser(next);
      // The login itself changed: confirm the account with the server.
      if (e.key === TOKEN_KEY || e.key === null) refreshMe();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queryClient, refreshMe]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login,
      logout,
    }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
