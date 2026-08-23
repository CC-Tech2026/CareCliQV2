import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { setAuthTokenGetter, setOrgIdGetter, customFetch } from "@workspace/api-client-react";
import { getDeviceId } from "@/lib/device-id";
import { apiFetch } from "@/lib/api-fetch";
import { queryClient, setQueryOrgId } from "@/lib/query-client";
import {
  beginVoluntaryLogout,
  captureCurrentRestoreContext,
  clearAuthSessionStorage,
  endVoluntaryLogout,
  getRememberDevicePreference,
  persistAuthSession,
  readStoredSession,
  type StoredSupabaseSession,
  updateStoredUserJson,
} from "@/lib/auth-session";
import { clearPresentedNotifications } from "@/lib/worker-notification-presenter";
import { clearAppliedSupabaseSession, storeAndApplySupabaseSession } from "@/lib/supabase";
import { CCQ_REAUTH_TOKEN_KEY, CCQ_UNAUTHORIZED_EVENT } from "@/lib/storage-keys";
import { clearCachedSettings } from "@/lib/use-settings";
import { clearSignature } from "@/lib/signature-store";
import { clearAllSessionNoteStorage } from "@/lib/session-notes-storage";
import { deleteTaskEvidenceDb } from "@/lib/task-evidence-storage";
import { deleteShiftOfflineDb } from "@/lib/shift-offline-queue";

/** Every on-device cache that isn't already covered by queryClient.clear() or
 * clearAuthSessionStorage() — settings/signature caches keyed by a single fixed
 * localStorage key shared by every user of the device, plus the offline-sync
 * IndexedDB stores and session-note drafts, none of which are namespaced by user
 * or org. Without this, a different account logging in on the same device could
 * still see — and offline-sync could still resubmit under the new session — the
 * previous user's cached data. */
function clearDeviceLocalCaches(): void {
  clearCachedSettings();
  clearSignature();
  clearAllSessionNoteStorage();
  void deleteTaskEvidenceDb();
  void deleteShiftOfflineDb();
}

export type UserRole = "support_coordinator" | "support_worker" | "managing_director";
export type AccountType = "independent_worker" | "small_provider";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  account_type: AccountType;
  onboarding_complete: boolean;
  email_verified?: boolean;
  profile_completed?: boolean;
  onboarding_completed?: boolean;
  role_specific_profile_completed?: boolean;
  profile_photo_url?: string | null;
  organizationId?: string;
}

export type LoginResult =
  | { status: "authenticated"; user: AuthUser }
  | { status: "mfa_required"; challengeToken: string; method: string };

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string, rememberDevice?: boolean) => Promise<LoginResult>;
  completeMfaLogin: (challengeToken: string, code: string, trustDevice?: boolean) => Promise<AuthUser>;
  logout: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  updateToken: (newToken: string) => Promise<void>;
}


let _currentToken: string | null = null;
let _currentOrgId: string | null = null;

function readStoredOrgId(): string | null {
  try {
    const { userJson } = readStoredSession();
    if (!userJson) return null;
    const parsed = JSON.parse(userJson) as AuthUser;
    return parsed.organizationId ?? null;
  } catch {
    return null;
  }
}

setAuthTokenGetter(() => _currentToken ?? readStoredSession().token);
setOrgIdGetter(() => _currentOrgId ?? readStoredOrgId());

const AuthContext = createContext<AuthContextType | null>(null);

function parseStoredUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function mapAuthUser(data: { user: Record<string, unknown> }): AuthUser {
  const user = data.user;
  return {
    id: String(user.id),
    email: String(user.email),
    full_name: String(user.full_name || ""),
    role: (user.role as UserRole) || "support_worker",
    account_type: (user.account_type as AccountType) || "independent_worker",
    onboarding_complete: Boolean(user.onboarding_complete ?? true),
    organizationId: user.organization_id ? String(user.organization_id) : undefined,
    email_verified: Boolean(user.email_verified ?? false),
    profile_completed: Boolean(user.profile_completed ?? user.onboarding_complete ?? false),
    onboarding_completed: Boolean(user.onboarding_completed ?? user.onboarding_complete ?? false),
    role_specific_profile_completed: Boolean(
      user.role_specific_profile_completed ?? user.onboarding_complete ?? false,
    ),
    profile_photo_url: (user.profile_photo_url as string | null | undefined) ?? null,
  };
}

function authRequestHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Device-Id": getDeviceId(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialSession = readStoredSession();
  const initialUser = parseStoredUser(initialSession.userJson);

  const [token, setToken] = useState<string | null>(() => {
    _currentToken = initialSession.token;
    return initialSession.token;
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    _currentOrgId = initialUser?.organizationId ?? null;
    setQueryOrgId(_currentOrgId);
    return initialUser;
  });
  const [isLoading, setIsLoading] = useState(false);

  const persistSession = useCallback((newToken: string, newUser: AuthUser, rememberDevice: boolean) => {
    _currentToken = newToken;
    _currentOrgId = newUser.organizationId ?? null;
    setQueryOrgId(_currentOrgId);
    persistAuthSession(newToken, JSON.stringify(newUser), rememberDevice);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const clearSession = useCallback(() => {
    _currentToken = null;
    _currentOrgId = null;
    setQueryOrgId(null);
    clearAppliedSupabaseSession();
    clearPresentedNotifications();
    clearAuthSessionStorage();
    clearDeviceLocalCaches();
    queryClient.clear();
    setToken(null);
    setUser(null);
  }, []);

  const finalizeLogin = useCallback((
    data: {
      access_token: string;
      user: Record<string, unknown>;
      supabase_session?: StoredSupabaseSession;
    },
    rememberDevice: boolean,
  ): AuthUser => {
    endVoluntaryLogout();
    const authUser = mapAuthUser(data);
    if (!authUser.organizationId) {
      throw new Error("Organisation not found. Contact your administrator.");
    }
    persistSession(data.access_token, authUser, rememberDevice);
    if (data.supabase_session) {
      void storeAndApplySupabaseSession(data.supabase_session, rememberDevice);
    }
    return authUser;
  }, [persistSession]);

  const login = useCallback(async (
    identifier: string,
    password: string,
    rememberDevice = getRememberDevicePreference(),
  ): Promise<LoginResult> => {
    setIsLoading(true);
    try {
      const deviceId = getDeviceId();
      const data = await customFetch<{
        mfa_required?: boolean;
        mfa_challenge_token?: string;
        mfa_method?: string;
        access_token?: string;
        user?: Record<string, unknown>;
        supabase_session?: StoredSupabaseSession;
      }>("/api/auth/login", {
        method: "POST",
        headers: authRequestHeaders(),
        body: JSON.stringify({
          identifier,
          password,
          remember_device: rememberDevice,
          device_id: deviceId,
        }),
      });

      if (data.mfa_required && data.mfa_challenge_token) {
        return {
          status: "mfa_required",
          challengeToken: data.mfa_challenge_token,
          method: data.mfa_method || "totp",
        };
      }

      if (!data.access_token || !data.user) {
        throw new Error("Incorrect email or password");
      }

      const authUser = finalizeLogin(
        {
          access_token: data.access_token,
          user: data.user,
          supabase_session: data.supabase_session,
        },
        rememberDevice,
      );
      return { status: "authenticated", user: authUser };
    } finally {
      setIsLoading(false);
    }
  }, [finalizeLogin]);

  const completeMfaLogin = useCallback(async (
    challengeToken: string,
    code: string,
    trustDevice = false,
  ): Promise<AuthUser> => {
    setIsLoading(true);
    try {
      const rememberDevice = getRememberDevicePreference();
      const deviceId = getDeviceId();
      const data = await customFetch<{
        access_token: string;
        user: Record<string, unknown>;
        supabase_session?: StoredSupabaseSession;
      }>(
        "/api/auth/login/mfa",
        {
          method: "POST",
          headers: authRequestHeaders(),
          body: JSON.stringify({
            mfa_challenge_token: challengeToken,
            code,
            trust_device: trustDevice,
            device_id: deviceId,
          }),
        },
      );
      return finalizeLogin(data, rememberDevice);
    } finally {
      setIsLoading(false);
    }
  }, [finalizeLogin]);

  const logout = useCallback(() => {
    beginVoluntaryLogout();
    customFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
  }, [clearSession]);

  const updateUser = useCallback((updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      updateStoredUserJson(JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateToken = useCallback(async (newToken: string): Promise<void> => {
    _currentToken = newToken;
    const rememberDevice = getRememberDevicePreference();
    if (rememberDevice) {
      persistAuthSession(newToken, JSON.stringify(user), true);
    } else if (user) {
      persistAuthSession(newToken, JSON.stringify(user), false);
    }
    setToken(newToken);
    try {
      const res = await apiFetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${newToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const fresh = mapAuthUser({ user: data.user });
        _currentOrgId = fresh.organizationId ?? null;
        persistAuthSession(newToken, JSON.stringify(fresh), rememberDevice);
        setUser(fresh);
      }
    } catch {
      // Non-critical: token stored, user profile refresh failed
    }
  }, [user]);

  useEffect(() => {
    const handleUnauthorized = () => {
      captureCurrentRestoreContext(user?.id);
      clearSession();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    };
    window.addEventListener(CCQ_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(CCQ_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession, user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        login,
        completeMfaLogin,
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
