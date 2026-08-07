import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";

export type MedicationRoute = "oral" | "topical" | "injection" | "inhaled" | "sublingual" | "rectal" | "other";
export type MedicationFrequencyType = "scheduled" | "prn";
export type MedicationStatus = "active" | "ceased" | "on_hold";

export type Medication = {
  id: string;
  participant_id: string;
  organization_id: string;
  name: string;
  strength?: string | null;
  route: MedicationRoute;
  dosage?: string | null;
  frequency_type: MedicationFrequencyType;
  scheduled_times: string[];
  prescriber_name?: string | null;
  prescriber_contact?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_prn: boolean;
  prn_max_per_day?: number | null;
  status: MedicationStatus;
  created_at: string;
  updated_at: string;
};

export type MedicationPayload = {
  name: string;
  strength?: string | null;
  route: MedicationRoute;
  dosage?: string | null;
  frequency_type: MedicationFrequencyType;
  scheduled_times?: string[];
  prescriber_name?: string | null;
  prescriber_contact?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_prn?: boolean;
  prn_max_per_day?: number | null;
  source_document_id?: string | null;
};

export function getParticipantMedications(participantId: string, status?: MedicationStatus) {
  const qs = status ? `?status=${status}` : "";
  return jsonFetch<{ medications: Medication[] }>(`/api/participants/${participantId}/medications${qs}`);
}

export function createParticipantMedication(participantId: string, payload: MedicationPayload) {
  return jsonFetch<Medication>(`/api/participants/${participantId}/medications`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMedication(medicationId: string, updates: Partial<MedicationPayload & { status: MedicationStatus }>) {
  return jsonFetch<Medication>(`/api/medications/${medicationId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export type ExtractedMedicationFields = {
  name: string | null;
  strength: string | null;
  dosage: string | null;
  route: MedicationRoute | null;
  frequency_type: MedicationFrequencyType | null;
  scheduled_times: string[];
  prescriber_name: string | null;
  prescriber_contact: string | null;
  start_date: string | null;
  end_date: string | null;
  prn_max_per_day: number | null;
};

export type MedicationDocumentType = "prescription" | "medication_management_plan" | "gp_letter" | "pharmacy_authority" | "other";
export type MedicationDocumentExtractionStatus = "pending" | "complete" | "failed" | "needs_review";

export type MedicationDocument = {
  id: string;
  participant_id: string;
  medication_id: string | null;
  file_path: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  document_type: MedicationDocumentType;
  extracted_data: ExtractedMedicationFields | null;
  extraction_status: MedicationDocumentExtractionStatus;
  uploaded_by: string | null;
  uploaded_at: string;
  effective_from: string;
  superseded_by_document_id: string | null;
  superseded_at: string | null;
};

/**
 * Upload a prescription/script/plan (image or PDF). The file is stored permanently first;
 * extraction then proposes field values for the coordinator to review. Nothing becomes an
 * active medication from this call alone — the document just exists on file.
 */
export async function uploadMedicationDocument(
  participantId: string,
  file: File,
  documentType: MedicationDocumentType = "other",
  replacesDocumentId?: string,
): Promise<{ document: MedicationDocument; extracted_fields: ExtractedMedicationFields | null }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("document_type", documentType);
  if (replacesDocumentId) formData.append("replaces_document_id", replacesDocumentId);
  const response = await apiFetch(`/api/participants/${participantId}/medications/documents`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not upload this document.");
  }
  return response.json();
}

export function getParticipantMedicationDocuments(participantId: string) {
  return jsonFetch<{ documents: MedicationDocument[] }>(`/api/participants/${participantId}/medications/documents`);
}

export function getMedicationDocuments(medicationId: string) {
  return jsonFetch<{ documents: MedicationDocument[] }>(`/api/medications/${medicationId}/documents`);
}

// ── Compliance Centre Medication Register (coordinator, org-wide) ────────────────────────────

export type OrgMedication = Medication & { participant_name?: string | null };

export type MedicationAdministrationRecord = {
  id: string;
  medication_id: string;
  shift_id?: string | null;
  scheduled_time?: string | null;
  administered_time: string;
  status: "given" | "refused" | "missed" | "withheld";
  dose_given?: string | null;
  notes?: string | null;
  prn_reason?: string | null;
  prn_effect_observed?: string | null;
  voice_captured: boolean;
  administered_by_name?: string | null;
};

export type MedicationReviewItems = {
  ending_soon: OrgMedication[];
  prn_at_max: (OrgMedication & { doses_given_today: number })[];
};

export function getCoordinatorMedications(participantId?: string) {
  const qs = participantId ? `?participant_id=${participantId}` : "";
  return jsonFetch<{ medications: OrgMedication[] }>(`/api/coordinator/medications${qs}`);
}

export function getMedicationReviewItems() {
  return jsonFetch<MedicationReviewItems>("/api/coordinator/medications/review-items");
}

export function getMedicationHistory(medicationId: string) {
  return jsonFetch<{ medication: OrgMedication; history: MedicationAdministrationRecord[] }>(
    `/api/medications/${medicationId}/history`,
  );
}
