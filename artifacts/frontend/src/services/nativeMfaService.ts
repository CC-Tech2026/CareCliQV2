/**
 * NEW, Supabase-native MFA (TOTP) API client.
 *
 * Deliberately separate from `securityService.ts`, which talks to the OLD
 * custom pyotp-based `/security/mfa/*` endpoints. These call the NEW
 * `/auth/mfa/*` and `/auth/login/mfa-native` endpoints backed by Supabase's
 * own `auth.mfa` API.
 *
 * Every call here needs the user's *live* Supabase access/refresh tokens
 * (not our own app JWT) — see `lib/auth-session.ts` / `lib/supabase.ts`.
 * `restoreSupabaseSession()` is called first so an about-to-expire token is
 * refreshed before use, then the current pair is read back out of storage.
 */
import { getDeviceId } from "@/lib/device-id";
import { jsonFetch } from "@/services/http";
import { readStoredSupabaseSession } from "@/lib/auth-session";
import { restoreSupabaseSession } from "@/lib/supabase";

export type NativeEnrollStart = {
  factor_id: string;
  qr_code: string | null;
  secret: string | null;
  uri: string | null;
};

export type NativeSupabaseSessionPatch = {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
};

export type NativeEnrollVerify = {
  enabled: boolean;
  method: string;
  supabase_session: NativeSupabaseSessionPatch;
};

export type NativeMfaStatus = {
  enabled: boolean;
  factor_id: string | null;
  current_level: string | null;
  next_level: string | null;
};

function deviceHeaders(): HeadersInit {
  return { "X-Device-Id": getDeviceId() };
}

async function supabaseSessionFields(): Promise<{ supabase_access_token: string; supabase_refresh_token: string }> {
  await restoreSupabaseSession();
  const session = readStoredSupabaseSession();
  if (!session) {
    throw new Error(
      "Your secure session has expired. Please sign out and sign back in before setting up two-factor authentication.",
    );
  }
  return {
    supabase_access_token: session.access_token,
    supabase_refresh_token: session.refresh_token,
  };
}

export async function startNativeTotpEnrollment(friendlyName = "Authenticator app") {
  const sessionFields = await supabaseSessionFields();
  return jsonFetch<NativeEnrollStart>("/api/auth/mfa/enroll/start", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ ...sessionFields, friendly_name: friendlyName }),
  });
}

export async function verifyNativeTotpEnrollment(factorId: string, code: string) {
  const sessionFields = await supabaseSessionFields();
  return jsonFetch<NativeEnrollVerify>("/api/auth/mfa/enroll/verify", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ ...sessionFields, factor_id: factorId, code }),
  });
}

export async function getNativeMfaStatus() {
  const sessionFields = await supabaseSessionFields();
  return jsonFetch<NativeMfaStatus>("/api/auth/mfa/status", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify(sessionFields),
  });
}

export async function unenrollNativeTotp(factorId: string, password: string) {
  const sessionFields = await supabaseSessionFields();
  return jsonFetch<{ enabled: boolean }>("/api/auth/mfa/unenroll", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ ...sessionFields, factor_id: factorId, password }),
  });
}
