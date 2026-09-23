import { jsonFetch } from "@/services/http";

export type IntakeStatus =
  | "enquiry" | "screening" | "declined" | "withdrawn" | "meet_greet"
  | "awaiting_signatures" | "signed" | "active" | "inactive";

export type EnquirySource = "online_form" | "email" | "phone_call" | "coordinator_referral";

export type ServiceCategory = "aged_care" | "disability";

export type FundingType = "ndia_managed" | "plan_managed" | "self_managed";

export type NextOfKinEntry = {
  name: string;
  relationship?: string;
  phone?: string;
  email?: string;
};

export type WebIntakeForm = {
  submitted_at: string;
  submitted_by?: string;
  given_name?: string;
  surname?: string;
  preferred_name?: string;
  pronouns?: string;
  gender?: string;
  date_of_birth?: string;
  preferred_language?: string;
  street_address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  funding_type?: FundingType;
  plan_status?: string;
  plan_start?: string;
  plan_end?: string;
  plan_manager_name?: string;
  plan_manager_org?: string;
  plan_manager_phone?: string;
  plan_manager_email?: string;
  next_of_kin?: NextOfKinEntry[];
  referral_source?: string;
  referral_date?: string;
  presenting_needs?: string[];
  notes?: string;
};

export type ScreeningManualChecks = {
  language_support_ok?: boolean;
  waitlist_open?: boolean;
  resource_match_ok?: boolean;
  environment_safe?: boolean;
  /** true = no red flags found (i.e. safe to proceed) */
  no_red_flags?: boolean;
  red_flag_notes?: string;
};

export type ParticipantIntake = {
  id: string;
  organization_id: string;
  full_name: string;
  service_category?: ServiceCategory;
  service_hours_required?: number;
  ndis_number: string;
  email: string;
  phone: string;
  source: EnquirySource;
  status: IntakeStatus;
  decline_reason?: string;
  withdrawn_reason?: string;
  meet_greet_recording_url?: string;
  meet_greet_notes?: string;
  signed_document_url?: string;
  signed_document_name?: string;
  plan_start_date?: string;
  plan_end_date?: string;
  total_budget?: string;
  provider_signed_name?: string;
  provider_signed_at?: string;
  provider_signature_png?: string;
  family_signed_name?: string;
  family_signed_at?: string;
  family_signature_png?: string;
  board_subtitle?: string;
  activated_at?: string;
  suspended_reason?: string;
  suspended_at?: string;
  reactivated_at?: string;
  participant_id?: string;
  created_at: string;
  web_intake?: WebIntakeForm;
  screening_checks?: ScreeningManualChecks;
};

export function listParticipantIntakes() {
  return jsonFetch<ParticipantIntake[]>("/api/participant-intakes");
}

export function createParticipantIntake(payload: {
  full_name: string;
  ndis_number?: string;
  email?: string;
  phone?: string;
  source: EnquirySource;
  service_category?: ServiceCategory;
  service_hours_required?: number;
  web_intake: WebIntakeForm;
}) {
  return jsonFetch<ParticipantIntake>("/api/participant-intakes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateParticipantIntake(intakeId: string, patch: Partial<ParticipantIntake>) {
  return jsonFetch<ParticipantIntake>(`/api/participant-intakes/${encodeURIComponent(intakeId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function uploadSignedServiceAgreement(intakeId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return jsonFetch<ParticipantIntake>(`/api/participant-intakes/${encodeURIComponent(intakeId)}/signed-document`, {
    method: "POST",
    body: formData,
  });
}
