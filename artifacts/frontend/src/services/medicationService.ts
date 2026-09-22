import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";

export type MedicationRoute = "oral" | "topical" | "injection" | "inhaled" | "sublingual" | "rectal" | "other";
export type MedicationFrequencyType = "scheduled" | "prn";
export type MedicationStatus = "draft" | "pending_verification" | "active" | "rejected" | "ceased" | "on_hold";
// APINCH high-alert medicine categories (Medication Safety Standard).
export type MedicationHighRiskCategory =
  | "anti_infective" | "potassium_electrolyte" | "insulin"
  | "narcotic_opioid" | "chemotherapy" | "anticoagulant" | "other";

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
  is_high_risk?: boolean;
  high_risk_category?: MedicationHighRiskCategory | null;
  source_document_id?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  verification_notes?: string | null;
  rejection_reason?: string | null;
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
  status?: Extract<MedicationStatus, "draft" | "pending_verification">;
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

export function updateMedication(medicationId: string, updates: Partial<Omit<MedicationPayload, "status"> & { status: MedicationStatus }>) {
  return jsonFetch<Medication>(`/api/medications/${medicationId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export type MedicationCorrections = {
  name?: string | null;
  strength?: string | null;
  route?: MedicationRoute | null;
  dosage?: string | null;
  frequency_type?: MedicationFrequencyType | null;
  scheduled_times?: string[] | null;
  prescriber_name?: string | null;
  prescriber_contact?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  prn_max_per_day?: number | null;
  is_high_risk?: boolean;
  high_risk_category?: MedicationHighRiskCategory | null;
  verification_notes?: string | null;
};

/** The named, timestamped confirmation step — moves a medication from pending_verification to active. */
export function verifyMedication(medicationId: string, corrections: MedicationCorrections = {}) {
  return jsonFetch<Medication>(`/api/medications/${medicationId}/verify`, {
    method: "POST",
    body: JSON.stringify(corrections),
  });
}

/** Late-discovered correction — filed by whoever found the error, not the administering
 * worker. Never edits the original entry; inserts a new linked row. */
export function fileMedicationCorrection(
  medicationId: string,
  administrationId: string,
  body: { error_subtype: MedicationErrorSubtype; notes?: string },
) {
  return jsonFetch<MedicationAdministrationRecord>(
    `/api/medications/${medicationId}/administrations/${administrationId}/correct`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function rejectMedication(medicationId: string, reason: string) {
  return jsonFetch<Medication>(`/api/medications/${medicationId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export type MedicationStatusHistoryEntry = {
  id: string;
  medication_id: string;
  from_status: MedicationStatus | null;
  to_status: MedicationStatus;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
  users?: { full_name?: string | null } | null;
};

export function getMedicationStatusHistory(medicationId: string) {
  return jsonFetch<{ history: MedicationStatusHistoryEntry[] }>(`/api/medications/${medicationId}/status-history`);
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

export type MedicationDocumentType = "prescription" | "medication_management_plan" | "gp_letter" | "pharmacy_authority" | "verification_photo" | "other";
export type MedicationDocumentExtractionStatus = "pending" | "complete" | "failed" | "needs_review" | "not_applicable";

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

export type OrgMedication = Medication & { participant_name?: string | null; timezone?: string | null };

export type MedicationAdministrationOutcome = "given_on_time" | "given_late" | "given_early" | "refused" | "missed" | "withheld" | "administration_error";
export type MedicationErrorSubtype = "wrong_medication" | "wrong_dose" | "wrong_participant" | "wrong_route" | "other";

export type MedicationAdministrationRecord = {
  id: string;
  medication_id: string;
  shift_id?: string | null;
  scheduled_time?: string | null;
  administered_time: string;
  outcome: MedicationAdministrationOutcome;
  variance_minutes?: number | null;
  reason_code?: string | null;
  directed_by?: string | null;
  dose_given?: string | null;
  notes?: string | null;
  prn_reason?: string | null;
  prn_effect_observed?: string | null;
  voice_captured: boolean;
  administered_by_name?: string | null;
  error_subtype?: MedicationErrorSubtype | null;
  corrects_administration_id?: string | null;
  error_discovered_at?: string | null;
  error_discovered_by?: string | null;
  verification_photo_url?: string | null;
  verification_photo_taken_at?: string | null;
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

export type MedicationTimelineEvent =
  | { event_type: "document_uploaded"; timestamp: string; document: MedicationDocument }
  | { event_type: "status_change"; timestamp: string; status_change: MedicationStatusHistoryEntry }
  | { event_type: "administration"; timestamp: string; administration: MedicationAdministrationRecord };

/** Everything that's ever happened to this medication, in one chronological view — the
 * document trail, verification/status changes, and every administration with its outcome. */
export function getMedicationAuditTimeline(medicationId: string) {
  return jsonFetch<{
    medication: OrgMedication;
    documents: MedicationDocument[];
    timeline: MedicationTimelineEvent[];
    /** The medication's participant's branch zone — every event in the timeline is theirs. */
    timezone: string;
  }>(`/api/medications/${medicationId}/audit-timeline`);
}

// ── Pattern detection (build order step 7) ────────────────────────────────────────────────
// Two deliberately separate signals: participant_reliability is compliance-facing and
// audit-exportable; worker_coaching is coaching-facing only and never appears in the
// Compliance Centre. Keep their UI surfaces separate the same way the API does.

export type MedicationPatternSignal = {
  id: string;
  signal_type: "participant_reliability" | "worker_coaching";
  scope_id: string;
  organization_id: string;
  window_start: string;
  window_end: string;
  rate_calculated: number;
  comparison_rate?: number | null;
  deviation?: number | null;
  sample_size: number;
  triggered: boolean;
  trigger_reason?: string | null;
  calculated_at: string;
};

export function getParticipantReliabilityFlags(participantId?: string) {
  const qs = participantId ? `?participant_id=${participantId}` : "";
  return jsonFetch<{ flags: MedicationPatternSignal[] }>(`/api/coordinator/medications/pattern-signals${qs}`);
}

export function runPatternDetection() {
  return jsonFetch<{ participant_signals: number; worker_signals: number }>(
    "/api/coordinator/medications/pattern-signals/run",
    { method: "POST" },
  );
}

export function getWorkerCoachingSignal(workerId: string) {
  return jsonFetch<{ signal: MedicationPatternSignal | null }>(`/api/coordinator/workers/${workerId}/medication-coaching-signal`);
}
