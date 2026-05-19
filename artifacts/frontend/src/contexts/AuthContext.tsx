import React, { createContext, useContext, useState, useCallback } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export type UserRole = "admin" | "support_worker" | "allied_health" | "support_coordinator";
export type AccountType = "independent_worker" | "allied_health" | "small_provider";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  account_type: AccountType;
  onboarding_complete: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  updateToken: (newToken: string) => Promise<void>;
}

const TOKEN_KEY = "carescribe_token";
const USER_KEY = "carescribe_user";

// Wire the token getter immediately on module load so API calls always have the latest token
let _currentToken: string | null = null;
setAuthTokenGetter(() => _currentToken);

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    _currentToken = t;
    return t;
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    try { return stored ? JSON.parse(stored) : null; } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(false);

  const persistSession = useCallback((newToken: string, newUser: AuthUser) => {
    _currentToken = newToken;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const clearSession = useCallback(() => {
    _currentToken = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Login failed" }));
        throw new Error(err.detail || "Login failed");
      }
      const data = await res.json();
      const authUser: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.full_name || "",
        role: data.user.role || "support_worker",
        account_type: data.user.account_type || "independent_worker",
        onboarding_complete: data.user.onboarding_complete ?? true,
      };
      persistSession(data.access_token, authUser);
      return authUser;
    } finally {
      setIsLoading(false);
    }
  }, [persistSession]);

  const logout = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
  }, [clearSession]);

  const updateUser = useCallback((updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateToken = useCallback(async (newToken: string): Promise<void> => {
    _currentToken = newToken;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const fresh: AuthUser = {
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.full_name || "",
          role: data.user.role || "support_worker",
          account_type: data.user.account_type || "independent_worker",
          onboarding_complete: data.user.onboarding_complete ?? true,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setUser(fresh);
      }
    } catch {
      // Non-critical: token stored, user profile refresh failed
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        login,
        logout,
        updateUser,
        updateToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
