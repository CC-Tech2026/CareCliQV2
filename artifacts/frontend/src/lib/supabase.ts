import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { jsonFetch } from "@/services/http";
import {
  persistSupabaseSession,
  readStoredSupabaseSession,
  type StoredSupabaseSession,
} from "@/lib/auth-session";
import { getRememberDevicePreference } from "@/lib/auth-session";

let client: SupabaseClient | null = null;
let appliedSessionFingerprint: string | null = null;

function sessionFingerprint(session: StoredSupabaseSession): string {
  return `${session.access_token}:${session.refresh_token}`;
}

export function clearAppliedSupabaseSession(): void {
  appliedSessionFingerprint = null;
}

function supabaseUrl(): string | undefined {
  const value = import.meta.env.SUPABASE_URL;
  return value?.trim() || undefined;
}

function supabaseAnonKey(): string | undefined {
  const value = import.meta.env.SUPABASE_ANON_KEY;
  return value?.trim() || undefined;
}

export function isSupabaseRealtimeConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export function getSupabaseClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
  }
  return client;
}

export async function applySupabaseSession(session: StoredSupabaseSession): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;
  const fingerprint = sessionFingerprint(session);
  if (appliedSessionFingerprint === fingerprint) return true;
  const { error } = await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (!error) appliedSessionFingerprint = fingerprint;
  return !error;
}

async function refreshSupabaseSessionViaApi(refreshToken: string): Promise<boolean> {
  try {
    const data = await jsonFetch<{ supabase_session?: StoredSupabaseSession }>("/api/auth/supabase-refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!data.supabase_session) return false;
    persistSupabaseSession(data.supabase_session, getRememberDevicePreference());
    return applySupabaseSession(data.supabase_session);
  } catch {
    return false;
  }
}

export async function restoreSupabaseSession(): Promise<boolean> {
  const stored = readStoredSupabaseSession();
  if (!stored) return false;

  const expiresMs = stored.expires_at ? stored.expires_at * 1000 : null;
  if (expiresMs && expiresMs < Date.now() + 60_000) {
    return refreshSupabaseSessionViaApi(stored.refresh_token);
  }
  return applySupabaseSession(stored);
}

export async function storeAndApplySupabaseSession(
  session: StoredSupabaseSession,
  rememberDevice: boolean,
): Promise<boolean> {
  persistSupabaseSession(session, rememberDevice);
  return applySupabaseSession(session);
}
