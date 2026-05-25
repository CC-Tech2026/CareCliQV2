import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * CareScribe role-based access control (RBAC)
 * Three roles:
 *   - support_coordinator: Business owner/team lead. Full visibility & team management.
 *   - support_worker: Field-based worker. Own clients & sessions only.
 *   - allied_health_pro: Clinical professional (OT, physio, speech). Own caseload + clinical tools.
 */
export type UserRole = "support_coordinator" | "support_worker" | "allied_health_pro";
export type AccountType = "independent_worker" | "allied_health" | "small_provider";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  account_type: AccountType;
  onboarding_complete: boolean;
  organizationId?: string;
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
  // Role helper methods
  isCoordinator: () => boolean;
  isSupportWorker: () => boolean;
  isAlliedHealth: () => boolean;
  hasCapability: (capability: string) => boolean;
}

const TOKEN_KEY = "carescribe_token";
const USER_KEY = "carescribe_user";

// Wire the token getter immediately on module load so API calls always have the latest token
let _currentToken: string | null = null;
setAuthTokenGetter(() => _currentToken);

const AuthContext = createContext<AuthContextType | null>(null);

// Role capability matrix
const ROLE_CAPABILITIES: Record<UserRole, Record<string, boolean>> = {
  support_coordinator: {
    "view_all_clients": true,
    "view_all_sessions": true,
    "view_all_workers": true,
    "view_all_notes": true,
    "view_all_compliance": true,
    "view_all_incidents": true,
    "manage_workers": true,
    "manage_billing": true,
    "manage_invoices": true,
    "create_invoices": true,
    "manage_ndis_plans": true,
    "write_notes": true,
    "manage_credentials": true,
    "create_reports": true,
    "body_map_coding": false,
    "allied_health_reports": false,
    "multilingual_input": true,
    "toolkit_management": true,
  },
  support_worker: {
    "view_all_clients": false,
    "view_all_sessions": false,
    "view_all_workers": false,
    "view_all_notes": false,
    "view_all_compliance": false,
    "view_all_incidents": false,
    "manage_workers": false,
    "manage_billing": false,
    "manage_invoices": false,
    "create_invoices": false,
    "manage_ndis_plans": false,
    "write_notes": true,
    "manage_credentials": true,
    "create_reports": false,
    "body_map_coding": false,
    "allied_health_reports": false,
    "multilingual_input": true,
    "toolkit_management": false,
  },
  allied_health_pro: {
    "view_all_clients": false,
    "view_all_sessions": false,
    "view_all_workers": false,
    "view_all_notes": false,
    "view_all_compliance": false,
    "view_all_incidents": false,
    "manage_workers": false,
    "manage_billing": true,
    "manage_invoices": true,
    "create_invoices": true,
    "manage_ndis_plans": false,
    "write_notes": true,
    "manage_credentials": true,
    "create_reports": true,
    "body_map_coding": true,
    "allied_health_reports": true,
    "multilingual_input": true,
    "toolkit_management": true,
  },
};

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
        role: (data.user.role || "support_worker") as UserRole,
        account_type: (data.user.account_type || "independent_worker") as AccountType,
        onboarding_complete: data.user.onboarding_complete ?? true,
        organizationId: data.user.organization_id ?? undefined,
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
          role: (data.user.role || "support_worker") as UserRole,
          account_type: (data.user.account_type || "independent_worker") as AccountType,
          onboarding_complete: data.user.onboarding_complete ?? true,
          organizationId: data.user.organization_id ?? undefined,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setUser(fresh);
      }
    } catch {
      // Non-critical: token stored, user profile refresh failed
    }
  }, []);

  // Memoized helper methods
  const isCoordinator = useCallback(() => user?.role === "support_coordinator", [user]);
  const isSupportWorker = useCallback(() => user?.role === "support_worker", [user]);
  const isAlliedHealth = useCallback(() => user?.role === "allied_health_pro", [user]);
  
  const hasCapability = useCallback((capability: string) => {
    if (!user) return false;
    const capabilities = ROLE_CAPABILITIES[user.role];
    return capabilities?.[capability] ?? false;
  }, [user]);

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
        isCoordinator,
        isSupportWorker,
        isAlliedHealth,
        hasCapability,
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

/**
 * Hook to check if user has a specific role
 */
export function useIsRole(role: UserRole): boolean {
  const { user } = useAuth();
  return user?.role === role;
}

/**
 * Hook to check if user has a specific capability
 */
export function useHasCapability(capability: string): boolean {
  const { hasCapability } = useAuth();
  return hasCapability(capability);
}

/**
 * Component wrapper for role-based rendering
 */
export function RequireRole({ 
  children, 
  roles,
  fallback = null,
}: {
  children: React.ReactNode;
  roles: UserRole | UserRole[];
  fallback?: React.ReactNode;
}) {
  const { user } = useAuth();
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  if (!user || !allowedRoles.includes(user.role)) {
    return fallback;
  }
  
  return children;
}

/**
 * Component wrapper for capability-based rendering
 */
export function RequireCapability({
  children,
  capability,
  fallback = null,
}: {
  children: React.ReactNode;
  capability: string;
  fallback?: React.ReactNode;
}) {
  const { hasCapability } = useAuth();
  
  if (!hasCapability(capability)) {
    return fallback;
  }
  
  return children;
}
