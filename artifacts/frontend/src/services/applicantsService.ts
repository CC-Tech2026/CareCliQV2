import { jsonFetch } from "@/services/http";

export type ApplicantStage = "applied" | "interview" | "offer_extended" | "hired" | "rejected";

export type Applicant = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: "support_worker" | "support_coordinator";
  stage: ApplicantStage;
  notes?: string | null;
  stage_entered_at: string;
  rejected_reason?: string | null;
  employee_onboarding_id?: string | null;
  created_at: string;
  resume_summary?: string | null;
  resume_skills?: string[] | null;
  resume_experience_years?: string | null;
  resume_extracted_at?: string | null;
  /** Self-reported only — normalized against the same credential types the
   *  real Credentials system uses, but nothing here is verified. The
   *  candidate/worker still has to upload the actual document later. */
  credentials_claimed?: { type: string; mentioned_as: string }[] | null;
};

export function listApplicants() {
  return jsonFetch<Applicant[]>("/api/applicants");
}

export function createApplicant(payload: {
  full_name: string;
  email: string;
  phone?: string;
  role?: "support_worker" | "support_coordinator";
}) {
  return jsonFetch<Applicant>("/api/applicants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function moveApplicantStage(applicantId: string, stage: ApplicantStage, rejectedReason?: string) {
  return jsonFetch<Applicant>(`/api/applicants/${encodeURIComponent(applicantId)}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, rejected_reason: rejectedReason }),
  });
}

export function updateApplicantNotes(applicantId: string, notes: string) {
  return jsonFetch<Applicant>(`/api/applicants/${encodeURIComponent(applicantId)}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

export type ApplicantDocumentType = "resume" | "cover_letter" | "id_document" | "other";

export type ApplicantDocument = {
  id: string;
  applicant_id: string;
  document_type: ApplicantDocumentType;
  title: string;
  notes?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  created_at: string;
};

export function listApplicantDocuments(applicantId: string) {
  return jsonFetch<ApplicantDocument[]>(`/api/applicants/${encodeURIComponent(applicantId)}/documents`);
}

export function uploadApplicantDocument(
  applicantId: string,
  payload: { document_type: ApplicantDocumentType; title: string; notes?: string; file?: File },
) {
  const formData = new FormData();
  formData.append("document_type", payload.document_type);
  formData.append("title", payload.title);
  if (payload.notes) formData.append("notes", payload.notes);
  if (payload.file) formData.append("file", payload.file);
  return jsonFetch<ApplicantDocument>(`/api/applicants/${encodeURIComponent(applicantId)}/documents`, {
    method: "POST",
    body: formData,
  });
}

export function deleteApplicantDocument(documentId: string) {
  return jsonFetch<void>(`/api/applicants/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}
