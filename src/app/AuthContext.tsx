import type { User } from "@/entities/user";
import { fetchMe, toUser } from "@/features/auth/api";
import { getAuthToken, getErrorStatus, setAuthToken } from "@/shared/api/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  const [user, setUser] = useState<User | null>(() =>
    getAuthToken() ? readStoredUser() : null,
  );

  const login = useCallback((nextUser: User, token: string) => {
    setAuthToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Refresh the cached user from the backend; drop the session if the token
  // is no longer valid (expired, or left over from the old demo login).
  useEffect(() => {
    if (!getAuthToken()) return;
    fetchMe()
      .then((me) => {
        const next = toUser(me);
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        setUser(next);
      })
      .catch((err) => {
        if (getErrorStatus(err) === 401) logout();
      });
  }, [logout]);

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
