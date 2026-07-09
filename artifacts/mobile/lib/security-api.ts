import { getMobileDeviceId, readMobileReauthToken } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type ReAuthResponse = {
  reauthenticated: boolean;
  reauthenticated_until: string;
  reauth_token: string;
};

export type MfaStatus = {
  enabled: boolean;
  method: string | null;
  phone: string | null;
};

export type TotpEnrollStart = {
  secret: string;
  otpauth_url: string;
  issuer: string;
};

export type TotpEnrollVerify = {
  enabled: boolean;
  method: string;
  recovery_codes: string[];
};

export type TrustedDevice = {
  id: string;
  device_id: string;
  device_name: string;
  os_name: string;
  trusted_until: string;
  last_active_at: string;
  is_current: boolean;
};

export type UserSession = {
  id: string;
  session_jti: string;
  device_id: string | null;
  device_name: string;
  os_name: string;
  ip_address: string | null;
  city: string | null;
  country: string | null;
  last_active_at: string;
  is_current: boolean;
};

async function securityFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const deviceId = await getMobileDeviceId();
  const reauthToken = await readMobileReauthToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    "X-Device-Id": deviceId,
  };
  if (reauthToken) {
    headers["X-Reauth-Token"] = reauthToken;
  }
  return workerFetch<T>(path, { ...init, headers });
}

export function reauthenticate(password: string) {
  return securityFetch<ReAuthResponse>("/api/security/reauthenticate", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function getMfaStatus() {
  return securityFetch<MfaStatus>("/api/security/mfa/status");
}

export function startTotpEnrollment() {
  return securityFetch<TotpEnrollStart>("/api/security/mfa/totp/enroll/start", { method: "POST" });
}

export function verifyTotpEnrollment(code: string) {
  return securityFetch<TotpEnrollVerify>("/api/security/mfa/totp/enroll/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disableMfa(password: string) {
  return securityFetch<{ enabled: boolean }>("/api/security/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function listTrustedDevices() {
  return securityFetch<TrustedDevice[]>("/api/security/devices/trusted");
}

export function renameTrustedDevice(deviceRowId: string, customName: string) {
  return securityFetch<{ updated: boolean }>(`/api/security/devices/trusted/${deviceRowId}`, {
    method: "PATCH",
    body: JSON.stringify({ custom_name: customName }),
  });
}

export function revokeTrustedDevice(deviceRowId: string) {
  return securityFetch<void>(`/api/security/devices/trusted/${deviceRowId}`, { method: "DELETE" });
}

export function listSessions() {
  return securityFetch<UserSession[]>("/api/security/sessions");
}

export function renameSession(sessionId: string, customName: string) {
  return securityFetch<{ updated: boolean }>(`/api/security/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ custom_name: customName }),
  });
}

export function logoutOtherSessions(password: string) {
  return securityFetch<{ revoked_sessions: number }>("/api/security/sessions/logout-others", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}
