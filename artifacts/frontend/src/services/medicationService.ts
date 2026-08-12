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

/** Upload a prescription/script (image or PDF) and get back suggested field values to review — nothing is saved by this call. */
export async function extractMedicationFromDocument(participantId: string, file: File): Promise<ExtractedMedicationFields> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(`/api/participants/${participantId}/medications/extract`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not read this document.");
  }
  return response.json();
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
