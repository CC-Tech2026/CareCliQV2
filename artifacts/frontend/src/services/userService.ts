import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

export type PreferredContactMethod = "phone_call" | "sms" | "in_app_message";

export type NotificationEvent =
  | "shift_reminder"
  | "shift_change"
  | "coordinator_message"
  | "feedback_received"
  | "certification_expiry";

export type NotificationChannel = "push" | "email" | "sms";

export type NotificationPreferences = Record<
  NotificationEvent,
  Record<NotificationChannel, boolean>
>;

export type UserProfile = {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  account_type?: string;
  organization_id?: string | null;
  email_verified?: boolean;
  profile_completed?: boolean;
  onboarding_completed?: boolean;
  role_specific_profile_completed?: boolean;
  phone?: string | null;
  address?: string | null;
  suburb?: string | null;
  emergency_contact?: Record<string, unknown> | null;
  discipline?: string | null;
  ahpra_registration_number?: string | null;
  professional_indemnity_confirmed?: boolean;
  business_name?: string | null;
  profile_photo_url?: string | null;
  employee_id?: string | null;
  membership_role?: string | null;
  preferred_contact_method?: PreferredContactMethod | null;
  pending_email?: string | null;
  joined_at?: string | null;
  profile_summary?: string | null;
  profile_experience_years?: number | null;
};

export async function getMe(): Promise<UserProfile> {
  return jsonFetch<UserProfile>("/api/users/me");
}

export async function updateMe(payload: Partial<UserProfile>): Promise<UserProfile> {
  return jsonFetch<UserProfile>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updateContact(payload: {
  email?: string;
  phone?: string;
  preferred_contact_method?: PreferredContactMethod;
}): Promise<{ profile: UserProfile; message: string }> {
  return jsonFetch("/api/users/me/contact", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function changePassword(payload: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<{ message: string }> {
  return jsonFetch("/api/users/me/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Support workers can't change their own password (org policy) — this notifies
 * their coordinators/MD, who can send a reset link from the worker's staff profile. */
export async function requestPasswordReset(): Promise<{ message: string }> {
  return jsonFetch("/api/worker/account/request-password-reset", {
    method: "POST",
  });
}

export async function getNotificationPreferences(deviceId: string): Promise<{
  device_id: string;
  preferences: NotificationPreferences;
}> {
  return jsonFetch(`/api/users/me/notification-preferences?device_id=${encodeURIComponent(deviceId)}`);
}

export async function saveNotificationPreferences(
  deviceId: string,
  preferences: NotificationPreferences,
): Promise<{ device_id: string; preferences: NotificationPreferences }> {
  return jsonFetch("/api/users/me/notification-preferences", {
    method: "PUT",
    body: JSON.stringify({ device_id: deviceId, preferences }),
  });
}

export async function uploadProfilePhoto(file: File): Promise<{ profile_photo_url?: string | null }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/api/users/me/photo", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not upload profile photo.");
  }
  return response.json();
}

export async function deleteProfilePhoto(): Promise<void> {
  const response = await apiFetch("/api/users/me/photo", { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not remove profile photo.");
  }
}

export async function resendVerificationEmail(email: string) {
  return jsonFetch<{ message: string }>("/api/auth/verification/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  shift_reminder: "Shift reminder",
  shift_change: "Shift change",
  coordinator_message: "Coordinator message",
  feedback_received: "Feedback received",
  certification_expiry: "Certification expiry",
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: "Push",
  email: "Email",
  sms: "SMS",
};

export const PREFERRED_CONTACT_LABELS: Record<PreferredContactMethod, string> = {
  phone_call: "Phone call",
  sms: "SMS",
  in_app_message: "In-app message",
};
