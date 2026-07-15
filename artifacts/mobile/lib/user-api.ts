import { Platform } from "react-native";

import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { readMobileAuthToken } from "@/lib/session";
import { workerFetch } from "@/lib/worker-fetch";

export type WorkerEmergencyContact = {
  name?: string | null;
  phone?: string | null;
  relationship?: string | null;
};

export type WorkerProfile = {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
  organization_id?: string | null;
  phone?: string | null;
  address?: string | null;
  emergency_contact?: WorkerEmergencyContact | string | null;
  business_name?: string | null;
  profile_photo_url?: string | null;
  employee_id?: string | null;
  membership_role?: string | null;
};

export function getWorkerProfile() {
  return workerFetch<WorkerProfile>("/api/users/me");
}

export function updateWorkerProfile(payload: {
  phone?: string | null;
  address?: string | null;
  emergency_contact?: WorkerEmergencyContact | null;
}): Promise<WorkerProfile> {
  return workerFetch<WorkerProfile>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ProfilePhotoUploadResult = {
  profile_photo_path: string;
  profile_photo_url: string;
};

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter((part): part is string => Boolean(part?.trim()));
    if (parts.length) return parts.join(". ");
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    const msg = String((detail as { msg: unknown }).msg ?? "").trim();
    if (msg) return msg;
  }
  return fallback;
}

async function appendImageFile(
  formData: FormData,
  file: { uri: string; name: string; type: string },
): Promise<void> {
  if (Platform.OS === "web") {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    const type = file.type || blob.type || "image/jpeg";
    formData.append("file", new File([blob], file.name || "avatar.jpg", { type }));
    return;
  }

  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);
}

export async function uploadProfilePhoto(file: {
  uri: string;
  name: string;
  type: string;
}): Promise<ProfilePhotoUploadResult> {
  const base = getMobileApiBaseUrl();
  if (!base) {
    throw new Error("API URL not configured");
  }

  const token = await readMobileAuthToken();
  const formData = new FormData();
  await appendImageFile(formData, file);

  const response = await fetch(`${base}/api/users/me/photo`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    let message = "Could not upload profile photo.";
    try {
      const body = (await response.json()) as { detail?: unknown; message?: string };
      message = formatApiErrorDetail(body.detail, body.message ?? message);
    } catch {
      /* use default */
    }
    throw new Error(message);
  }

  return response.json() as Promise<ProfilePhotoUploadResult>;
}

export async function deleteProfilePhoto(): Promise<void> {
  await workerFetch<void>("/api/users/me/photo", { method: "DELETE" });
}
