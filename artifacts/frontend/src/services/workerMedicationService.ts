import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

export type MedicationAdministrationAction =
  | "given"
  | "refused"
  | "missed"
  | "withheld"
  | "administration_error";
export type MedicationErrorSubtype =
  | "wrong_medication"
  | "wrong_dose"
  | "wrong_participant"
  | "wrong_route"
  | "other";
export const MEDICATION_ERROR_SUBTYPES: MedicationErrorSubtype[] = [
  "wrong_medication",
  "wrong_dose",
  "wrong_participant",
  "wrong_route",
  "other",
];

export type MedicationAdministrationOutcome =
  | "given_on_time"
  | "given_late"
  | "given_early"
  | "refused"
  | "missed"
  | "withheld";
export type MedicationDueStatus =
  | "upcoming"
  | "due_now"
  | "overdue"
  | MedicationAdministrationOutcome;

export const MEDICATION_REASON_CODES: Record<
  Exclude<MedicationAdministrationOutcome, "given_on_time">,
  string[]
> = {
  given_late: ["participant_asleep", "worker_delayed", "participant_off_site", "other"],
  given_early: ["participant_requested", "schedule_conflict", "other"],
  refused: ["verbal", "behavioural", "communication_device", "other"],
  missed: ["participant_asleep", "worker_delayed", "participant_off_site", "other"],
  withheld: ["clinical_direction", "other"],
};

export type MedicationChecklistItem = {
  medication_id: string;
  name: string;
  strength?: string | null;
  dosage?: string | null;
  route: string;
  scheduled_time: string;
  due_status: MedicationDueStatus;
  administration?: { outcome: MedicationAdministrationOutcome; notes?: string | null } | null;
  is_high_risk?: boolean;
  high_risk_category?: string | null;
};

export type PrnMedication = {
  id: string;
  name: string;
  strength?: string | null;
  dosage?: string | null;
  route: string;
  prn_max_per_day?: number | null;
  doses_given_today: number;
  at_or_over_max: boolean;
  is_high_risk?: boolean;
  high_risk_category?: string | null;
};

export type PrnPendingEffect = {
  id: string;
  medication_id: string;
  prn_reason: string;
  administered_time: string;
};

export function getMedicationChecklist(shiftId: string) {
  return jsonFetch<{ checklist: MedicationChecklistItem[] }>(
    `/api/worker/shifts/${shiftId}/medication-checklist`,
  );
}

export function logMedicationAdministration(
  shiftId: string,
  medicationId: string,
  body: {
    scheduled_time?: string;
    administered_time?: string;
    action: MedicationAdministrationAction;
    reason_code?: string;
    directed_by?: string;
    dose_given?: string;
    notes?: string;
    prn_reason?: string;
    voice_captured?: boolean;
    error_subtype?: MedicationErrorSubtype;
    verification_photo_url?: string;
    corrects_administration_id?: string;
    error_discovered_at?: string;
  },
) {
  return jsonFetch<{ id: string; outcome: MedicationAdministrationOutcome }>(
    `/api/worker/shifts/${shiftId}/medications/${medicationId}/administrations`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function uploadMedicationVerificationPhoto(
  shiftId: string,
  medicationId: string,
  file: File,
): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await apiFetch(
    `/api/worker/shifts/${shiftId}/medications/${medicationId}/verification-photo`,
    { method: "POST", body: formData },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || "Could not upload verification photo.");
  }
  return response.json();
}

export function getPrnMedications(shiftId: string) {
  return jsonFetch<{ medications: PrnMedication[]; pending_effects: PrnPendingEffect[] }>(
    `/api/worker/shifts/${shiftId}/prn-medications`,
  );
}

export function attachMedicationReason(
  administrationId: string,
  reasonCode: string | undefined,
  notes: string | undefined,
) {
  return jsonFetch<{ id: string }>(`/api/worker/medication-administrations/${administrationId}/reason`, {
    method: "PATCH",
    body: JSON.stringify({ reason_code: reasonCode, notes }),
  });
}

export function logMedicationEffect(
  administrationId: string,
  effectObserved: string,
  voiceCaptured = false,
) {
  return jsonFetch<{ id: string }>(`/api/worker/medication-administrations/${administrationId}/effect`, {
    method: "PATCH",
    body: JSON.stringify({ effect_observed: effectObserved, voice_captured: voiceCaptured }),
  });
}
