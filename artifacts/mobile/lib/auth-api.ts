import { getMobileDeviceId } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type AuthUser = {
  id: string;
  email?: string;
  full_name?: string;
  role?: string;
  organizationId?: string;
};

export type LoginResult =
  | { status: "authenticated"; user: AuthUser; accessToken: string }
  | { status: "mfa_required"; challengeToken: string; method: string };

function mapUser(raw: Record<string, unknown>): AuthUser {
  return {
    id: String(raw.id ?? ""),
    email: raw.email ? String(raw.email) : undefined,
    full_name: raw.full_name ? String(raw.full_name) : undefined,
    role: raw.role ? String(raw.role) : undefined,
    organizationId: raw.organization_id
      ? String(raw.organization_id)
      : raw.organizationId
        ? String(raw.organizationId)
        : undefined,
  };
}

export async function loginWithPassword(
  identifier: string,
  password: string,
  rememberDevice = true,
): Promise<LoginResult> {
  const deviceId = await getMobileDeviceId();
  const data = await workerFetch<{
    mfa_required?: boolean;
    mfa_challenge_token?: string;
    mfa_method?: string;
    access_token?: string;
    user?: Record<string, unknown>;
  }>("/api/auth/login", {
    method: "POST",
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
      method: data.mfa_method ?? "totp",
    };
  }

  if (!data.access_token || !data.user) {
    throw new Error("Incorrect email or password");
  }

  return {
    status: "authenticated",
    user: mapUser(data.user),
    accessToken: data.access_token,
  };
}

export async function completeMfaLogin(
  challengeToken: string,
  code: string,
  trustDevice = false,
): Promise<{ user: AuthUser; accessToken: string }> {
  const deviceId = await getMobileDeviceId();
  const data = await workerFetch<{
    access_token: string;
    user: Record<string, unknown>;
  }>("/api/auth/login/mfa", {
    method: "POST",
    body: JSON.stringify({
      mfa_challenge_token: challengeToken,
      code,
      trust_device: trustDevice,
      device_id: deviceId,
    }),
  });

  return {
    user: mapUser(data.user),
    accessToken: data.access_token,
  };
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const data = await workerFetch<{ user: Record<string, unknown> }>("/api/auth/me");
    return mapUser(data.user);
  } catch {
    return null;
  }
}

export async function logoutApi(): Promise<void> {
  try {
    await workerFetch<void>("/api/auth/logout", { method: "POST" });
  } catch {
    /* noop */
  }
}
