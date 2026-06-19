import { getDeviceId } from "@/lib/device-id";
import { jsonFetch } from "@/services/http";

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

export type LoginHistoryEntry = {
  id: string;
  device_name: string;
  os_name: string;
  city: string | null;
  country: string | null;
  is_suspicious: boolean;
  created_at: string;
  location_label: string;
};

function deviceHeaders(): HeadersInit {
  return { "X-Device-Id": getDeviceId() };
}

export function reauthenticate(password: string) {
  return jsonFetch<ReAuthResponse>("/api/security/reauthenticate", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ password }),
  });
}

export function getMfaStatus() {
  return jsonFetch<MfaStatus>("/api/security/mfa/status", {
    headers: deviceHeaders(),
  });
}

export function startTotpEnrollment() {
  return jsonFetch<TotpEnrollStart>("/api/security/mfa/totp/enroll/start", {
    method: "POST",
    headers: deviceHeaders(),
  });
}

export function verifyTotpEnrollment(code: string) {
  return jsonFetch<TotpEnrollVerify>("/api/security/mfa/totp/enroll/verify", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ code }),
  });
}

export function disableMfa(password: string) {
  return jsonFetch<{ enabled: boolean }>("/api/security/mfa/disable", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ password }),
  });
}

export function listTrustedDevices() {
  return jsonFetch<TrustedDevice[]>("/api/security/devices/trusted", {
    headers: deviceHeaders(),
  });
}

export function renameTrustedDevice(deviceRowId: string, customName: string) {
  return jsonFetch<{ updated: boolean }>(`/api/security/devices/trusted/${deviceRowId}`, {
    method: "PATCH",
    headers: deviceHeaders(),
    body: JSON.stringify({ custom_name: customName }),
  });
}

export function revokeTrustedDevice(deviceRowId: string) {
  return jsonFetch<void>(`/api/security/devices/trusted/${deviceRowId}`, {
    method: "DELETE",
    headers: deviceHeaders(),
  });
}

export function listSessions() {
  return jsonFetch<UserSession[]>("/api/security/sessions", {
    headers: deviceHeaders(),
  });
}

export function renameSession(sessionId: string, customName: string) {
  return jsonFetch<{ updated: boolean }>(`/api/security/sessions/${sessionId}`, {
    method: "PATCH",
    headers: deviceHeaders(),
    body: JSON.stringify({ custom_name: customName }),
  });
}

export function logoutOtherSessions(password: string) {
  return jsonFetch<{ revoked_sessions: number }>("/api/security/sessions/logout-others", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ password }),
  });
}

export function getLoginHistory() {
  return jsonFetch<LoginHistoryEntry[]>("/api/security/login-history", {
    headers: deviceHeaders(),
  });
}

export function secureAccount(token: string) {
  return jsonFetch<{ secured: boolean; message: string }>("/api/security/account/secure", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
