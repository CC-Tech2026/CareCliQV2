import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

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

export async function uploadProfilePhoto(file: File): Promise<UserProfile> {
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

export async function deleteProfilePhoto(): Promise<UserProfile> {
  const response = await apiFetch("/api/users/me/photo", { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not remove profile photo.");
  }
  return { id: "", email: "", role: "", profile_photo_url: null };
}

export async function resendVerificationEmail(email: string) {
  return jsonFetch<{ message: string }>("/api/auth/verification/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
