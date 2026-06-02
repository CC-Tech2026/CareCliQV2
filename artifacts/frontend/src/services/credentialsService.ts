import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

export type Credential = {
  id: string;
  user_id?: string;
  organization_id?: string | null;
  credential_type: string;
  title: string;
  credential_number?: string | null;
  issuer?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  status: "valid" | "expiring" | "expired" | "rejected" | "pending_review";
  file_path?: string | null;
  file_url?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: { id: string; full_name?: string; email?: string; role?: string };
};

export type CredentialPayload = Partial<Credential> & {
  credential_type: string;
  title: string;
};

export async function listMyCredentials(): Promise<Credential[]> {
  return jsonFetch<Credential[]>("/api/credentials/me");
}

export async function createCredential(payload: CredentialPayload): Promise<Credential> {
  return jsonFetch<Credential>("/api/credentials/me", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCredential(id: string, payload: Partial<Credential>): Promise<Credential> {
  return jsonFetch<Credential>(`/api/credentials/me/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteCredential(id: string): Promise<void> {
  await jsonFetch(`/api/credentials/me/${id}`, { method: "DELETE" });
}

export async function uploadCredentialFile(id: string, file: File): Promise<Credential> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`/api/credentials/me/${id}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not upload credential file.");
  }
  return response.json();
}

export async function listTeamCredentials(): Promise<Credential[]> {
  return jsonFetch<Credential[]>("/api/credentials/team");
}

export async function reviewCredential(id: string, payload: { status: string; notes?: string | null }): Promise<Credential> {
  return jsonFetch<Credential>(`/api/credentials/${id}/review`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
