import { getMobileDeviceId } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type AuthUser = {
  id: string;
  email?: string;
  full_name?: string;
  role?: string;
  organizationId?: string;
  profile_photo_url?: string | null;
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
    profile_photo_url:
      raw.profile_photo_url != null && String(raw.profile_photo_url).trim()
        ? String(raw.profile_photo_url)
        : null,
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

export async function requestPasswordReset(email: string): Promise<void> {
  await workerFetch<void>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: email.trim() }),
  });
}

export async function changePassword(payload: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<{ message: string }> {
  return workerFetch<{ message: string }>("/api/users/me/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type RegisterPayload = {
  email: string;
  password: string;
  full_name: string;
  account_type: string;
};

export async function registerAccount(payload: RegisterPayload): Promise<void> {
  await workerFetch<void>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type OnboardingPayload = {
  account_type: string;
  organization_name?: string;
  provider_type?: string;
  registration_status?: string;
  team_size?: string;
  participant_volume?: string;
  contact_number?: string;
};

export async function completeOnboarding(
  payload: OnboardingPayload,
): Promise<{ access_token?: string; org_created?: boolean }> {
  return workerFetch<{ access_token?: string; org_created?: boolean }>(
    "/api/auth/complete-onboarding",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
