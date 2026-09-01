import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  completeMfaLogin,
  fetchCurrentUser,
  loginWithPassword,
  logoutApi,
  type AuthUser,
  type LoginResult,
} from "@/lib/auth-api";
import { saveBiometricCredentials } from "@/lib/biometric-auth";
import {
  clearMobileAuthSession,
  persistMobileAuthSession,
  readMobileAuthToken,
  readStoredUserJson,
} from "@/lib/session";
import { setWorkerUnauthorizedHandler } from "@/lib/worker-fetch";
import { clearQueue, clearWorkerQueue } from "@/hooks/useOfflineCache";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string, rememberDevice?: boolean) => Promise<LoginResult>;
  completeMfa: (
    challengeToken: string,
    code: string,
    trustDevice?: boolean,
    credentials?: { identifier: string; password: string },
  ) => Promise<AuthUser>;
  updateSession: (accessToken: string, user: AuthUser) => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const token = await readMobileAuthToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      const storedJson = await readStoredUserJson();
      let cached: AuthUser | null = null;
      if (storedJson) {
        try {
          cached = JSON.parse(storedJson) as AuthUser;
          if (!cancelled) setUser(cached);
        } catch {
          /* fall through to /me */
        }
      }

      const fresh = await fetchCurrentUser();
      if (!cancelled) {
        if (fresh) {
          const merged: AuthUser = {
            ...fresh,
            full_name: fresh.full_name || cached?.full_name,
            profile_photo_url: fresh.profile_photo_url ?? cached?.profile_photo_url ?? null,
          };
          setUser(merged);
          await persistMobileAuthSession(token, JSON.stringify(merged));
        } else {
          await clearMobileAuthSession();
          setUser(null);
        }
        setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setWorkerUnauthorizedHandler(() => {
      void clearMobileAuthSession().then(() => setUser(null));
    });
    return () => setWorkerUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (identifier: string, password: string, rememberDevice = true) => {
    const result = await loginWithPassword(identifier, password, rememberDevice);
    if (result.status === "authenticated") {
      await persistMobileAuthSession(result.accessToken, JSON.stringify(result.user));
      setUser(result.user);
      await saveBiometricCredentials({ identifier: identifier.trim(), password });
    }
    return result;
  }, []);

  const completeMfa = useCallback(
    async (
      challengeToken: string,
      code: string,
      trustDevice = false,
      credentials?: { identifier: string; password: string },
    ) => {
      const { user: authUser, accessToken } = await completeMfaLogin(
        challengeToken,
        code,
        trustDevice,
      );
      await persistMobileAuthSession(accessToken, JSON.stringify(authUser));
      setUser(authUser);
      if (credentials) {
        await saveBiometricCredentials(credentials);
      }
      return authUser;
    },
    [],
  );

  const updateSession = useCallback(async (accessToken: string, authUser: AuthUser) => {
    await persistMobileAuthSession(accessToken, JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const updateUser = useCallback(async (patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void readMobileAuthToken().then((token) => {
        if (token) void persistMobileAuthSession(token, JSON.stringify(next));
      });
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    await clearMobileAuthSession();
    // AsyncStorage's offline queues aren't partitioned per user on a shared
    // device - without this, a different worker logging in on the same
    // phone could have this worker's still-unsynced clock-ins/notes/task
    // updates silently replayed under their session (mirrors the web app's
    // deleteShiftOfflineDb-on-logout for the same reason).
    await Promise.all([clearWorkerQueue(), clearQueue()]);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      completeMfa,
      updateSession,
      updateUser,
      logout,
    }),
    [user, isLoading, login, completeMfa, updateSession, updateUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
