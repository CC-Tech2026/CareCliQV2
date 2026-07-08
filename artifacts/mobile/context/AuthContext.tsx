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
import {
  clearMobileAuthSession,
  persistMobileAuthSession,
  readMobileAuthToken,
  readStoredUserJson,
} from "@/lib/session";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string, rememberDevice?: boolean) => Promise<LoginResult>;
  completeMfa: (challengeToken: string, code: string, trustDevice?: boolean) => Promise<AuthUser>;
  updateSession: (accessToken: string, user: AuthUser) => Promise<void>;
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
      if (storedJson) {
        try {
          const parsed = JSON.parse(storedJson) as AuthUser;
          if (!cancelled) setUser(parsed);
        } catch {
          /* fall through to /me */
        }
      }

      const fresh = await fetchCurrentUser();
      if (!cancelled) {
        if (fresh) {
          setUser(fresh);
          await persistMobileAuthSession(token, JSON.stringify(fresh));
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

  const login = useCallback(async (identifier: string, password: string, rememberDevice = true) => {
    const result = await loginWithPassword(identifier, password, rememberDevice);
    if (result.status === "authenticated") {
      await persistMobileAuthSession(result.accessToken, JSON.stringify(result.user));
      setUser(result.user);
    }
    return result;
  }, []);

  const completeMfa = useCallback(
    async (challengeToken: string, code: string, trustDevice = false) => {
      const { user: authUser, accessToken } = await completeMfaLogin(
        challengeToken,
        code,
        trustDevice,
      );
      await persistMobileAuthSession(accessToken, JSON.stringify(authUser));
      setUser(authUser);
      return authUser;
    },
    [],
  );

  const updateSession = useCallback(async (accessToken: string, authUser: AuthUser) => {
    await persistMobileAuthSession(accessToken, JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    await clearMobileAuthSession();
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
      logout,
    }),
    [user, isLoading, login, completeMfa, updateSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
