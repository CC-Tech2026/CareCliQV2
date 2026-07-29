import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";

export type OnboardingDocument = {
  id: string;
  onboarding_id: string;
  document_type: "offer_letter" | "service_agreement" | "other";
  title: string;
  notes?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  created_at: string;
};

export type EmployeeHire = {
  id: string;
  organization_id: string;
  created_by?: string | null;
  full_name: string;
  email: string;
  phone?: string | null;
  role: "support_worker" | "support_coordinator";
  status: "draft" | "awaiting_signatures" | "signed" | "invited" | "completed";
  sign_token?: string | null;
  employer_signed_name?: string | null;
  employer_signed_at?: string | null;
  worker_signed_name?: string | null;
  worker_signed_at?: string | null;
  invitation_id?: string | null;
  created_at: string;
  documents?: OnboardingDocument[];
};

export function listHires() {
  return jsonFetch<EmployeeHire[]>("/api/employee-onboarding/hires");
}

export function getHire(hireId: string) {
  return jsonFetch<EmployeeHire>(`/api/employee-onboarding/hires/${encodeURIComponent(hireId)}`);
}

export function createHire(payload: { full_name: string; email: string; phone?: string; role: string }) {
  return jsonFetch<EmployeeHire>("/api/employee-onboarding/hires", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function addHireDocument(hireId: string, payload: { document_type: string; title: string; notes?: string }) {
  return jsonFetch<OnboardingDocument>(`/api/employee-onboarding/hires/${encodeURIComponent(hireId)}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadHireDocumentFile(documentId: string, file: File): Promise<OnboardingDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`/api/employee-onboarding/documents/${encodeURIComponent(documentId)}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not upload document file.");
  }
  return response.json();
}

export function deleteHireDocument(documentId: string) {
  return jsonFetch<{ ok: boolean }>(`/api/employee-onboarding/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

export function sendForSignature(hireId: string) {
  return jsonFetch<EmployeeHire>(`/api/employee-onboarding/hires/${encodeURIComponent(hireId)}/send-for-signature`, {
    method: "POST",
  });
}

export type SignPreview = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  employer_signed_name?: string | null;
  employer_signed_at?: string | null;
  worker_signed_name?: string | null;
  worker_signed_at?: string | null;
  documents: OnboardingDocument[];
};

export function sendHireInvite(hire: EmployeeHire) {
  return jsonFetch<{ email: string; short_code?: string; invite_url: string; email_delivery?: { status?: string } }>(
    "/api/invitations/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: hire.email, role: hire.role, onboarding_id: hire.id }),
    },
  );
}

export function getHireForSigning(token: string) {
  return jsonFetch<SignPreview>(`/api/employee-onboarding/sign/${encodeURIComponent(token)}`);
}

export function signHire(token: string, fullName: string) {
  return jsonFetch<SignPreview>(`/api/employee-onboarding/sign/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  });
}
