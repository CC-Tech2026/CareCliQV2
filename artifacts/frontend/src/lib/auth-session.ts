import {
  CCQ_REAUTH_TOKEN_KEY,
  CCQ_REMEMBER_DEVICE_KEY,
  CCQ_SUPABASE_SESSION_KEY,
  CCQ_TOKEN_KEY,
  CCQ_USER_KEY,
  migrateLegacyCareScribeStorageKeys,
} from "@/lib/storage-keys";

migrateLegacyCareScribeStorageKeys();

const TOKEN_KEY = CCQ_TOKEN_KEY;
const USER_KEY = CCQ_USER_KEY;
const SUPABASE_SESSION_KEY = CCQ_SUPABASE_SESSION_KEY;
const REAUTH_TOKEN_KEY = CCQ_REAUTH_TOKEN_KEY;
const REMEMBER_DEVICE_KEY = CCQ_REMEMBER_DEVICE_KEY;
const RESTORE_CONTEXT_KEY = "ccq_auth_restore_context";

export type AuthRestoreContext = {
  path: string;
  userId?: string;
  savedAt: number;
};

export type StoredSupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
};

export function readStoredSupabaseSession(): StoredSupabaseSession | null {
  try {
    const raw =
      localStorage.getItem(SUPABASE_SESSION_KEY) ??
      sessionStorage.getItem(SUPABASE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSupabaseSession;
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistSupabaseSession(
  session: StoredSupabaseSession,
  rememberDevice: boolean,
): void {
  try {
    const raw = JSON.stringify(session);
    if (rememberDevice) {
      localStorage.setItem(SUPABASE_SESSION_KEY, raw);
      sessionStorage.removeItem(SUPABASE_SESSION_KEY);
    } else {
      sessionStorage.setItem(SUPABASE_SESSION_KEY, raw);
      localStorage.removeItem(SUPABASE_SESSION_KEY);
    }
  } catch {
    /* noop */
  }
}

export function clearSupabaseSessionStorage(): void {
  try {
    localStorage.removeItem(SUPABASE_SESSION_KEY);
    sessionStorage.removeItem(SUPABASE_SESSION_KEY);
  } catch {
    /* noop */
  }
}

export function getRememberDevicePreference(): boolean {
  try {
    const stored = localStorage.getItem(REMEMBER_DEVICE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* noop */
  }
  return false;
}

export function setRememberDevicePreference(value: boolean): void {
  try {
    localStorage.setItem(REMEMBER_DEVICE_KEY, String(value));
  } catch {
    /* noop */
  }
}

export function readStoredSession(): { token: string | null; userJson: string | null } {
  try {
    const localToken = localStorage.getItem(TOKEN_KEY);
    const localUser = localStorage.getItem(USER_KEY);
    if (localToken && localUser) {
      return { token: localToken, userJson: localUser };
    }
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    const sessionUser = sessionStorage.getItem(USER_KEY);
    if (sessionToken && sessionUser) {
      return { token: sessionToken, userJson: sessionUser };
    }
  } catch {
    /* noop */
  }
  return { token: null, userJson: null };
}

export function persistAuthSession(token: string, userJson: string, rememberDevice: boolean): void {
  try {
    if (rememberDevice) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, userJson);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, userJson);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    setRememberDevicePreference(rememberDevice);
  } catch {
    /* noop */
  }
}

export function clearAuthSessionStorage(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REAUTH_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    clearSupabaseSessionStorage();
  } catch {
    /* noop */
  }
}

export function updateStoredUserJson(userJson: string): void {
  try {
    if (localStorage.getItem(TOKEN_KEY)) {
      localStorage.setItem(USER_KEY, userJson);
      return;
    }
    if (sessionStorage.getItem(TOKEN_KEY)) {
      sessionStorage.setItem(USER_KEY, userJson);
    }
  } catch {
    /* noop */
  }
}

export function saveAuthRestoreContext(path: string, userId?: string): void {
  try {
    const payload: AuthRestoreContext = {
      path,
      userId,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(RESTORE_CONTEXT_KEY, JSON.stringify(payload));
  } catch {
    /* noop */
  }
}

export function loadAuthRestoreContext(): AuthRestoreContext | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthRestoreContext;
    if (!parsed?.path) return null;
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (Date.now() - (parsed.savedAt || 0) > maxAgeMs) {
      sessionStorage.removeItem(RESTORE_CONTEXT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuthRestoreContext(): void {
  try {
    sessionStorage.removeItem(RESTORE_CONTEXT_KEY);
  } catch {
    /* noop */
  }
}

export function resolvePostLoginPath(userId: string, defaultPath = "/hub"): string {
  const restore = loadAuthRestoreContext();
  clearAuthRestoreContext();
  if (!restore?.path || restore.path.startsWith("/login")) {
    return defaultPath;
  }
  if (restore.userId && restore.userId !== userId) {
    return defaultPath;
  }
  return restore.path;
}

export function captureCurrentRestoreContext(userId?: string): void {
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}`;
  if (path.startsWith("/login")) return;
  saveAuthRestoreContext(path, userId);
}
