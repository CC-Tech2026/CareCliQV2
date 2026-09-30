import { jsonFetch } from "@/services/http";

// Participants Portal access — MD-managed grants/invites (see
// backend/app/api/participant_portal_access.py) plus the public invite flow.

export type PortalRelationship =
  | "self"
  | "plan_nominee"
  | "correspondence_nominee"
  | "guardian"
  | "power_of_attorney"
  | "registered_supporter"
  | "parent"
  | "consented_family";

export const RELATIONSHIP_OPTIONS: { value: PortalRelationship; label: string; hint: string }[] = [
  { value: "self", label: "Participant (self)", hint: "The participant's own login." },
  { value: "plan_nominee", label: "NDIS plan nominee", hint: "Appointed by the NDIA — note the appointment details." },
  { value: "correspondence_nominee", label: "NDIS correspondence nominee", hint: "Appointed by the NDIA — note the appointment details." },
  { value: "guardian", label: "Guardian", hint: "Tribunal guardianship order — note the order and its scope." },
  { value: "power_of_attorney", label: "Power of attorney", hint: "Enduring power of attorney — note the document." },
  { value: "registered_supporter", label: "Registered supporter (aged care)", hint: "Registered under the Aged Care Act." },
  { value: "parent", label: "Parent of a minor", hint: "Parent or legal guardian of a participant under 18." },
  { value: "consented_family", label: "Family (participant consent)", hint: "No legal authority — the participant has consented." },
];

export type PortalIdentityMethod = "participant_dob" | "ndis_number" | "code";

export const IDENTITY_METHOD_OPTIONS: { value: PortalIdentityMethod; label: string }[] = [
  { value: "participant_dob", label: "Participant's date of birth" },
  { value: "ndis_number", label: "Participant's NDIS number" },
  { value: "code", label: "One-off code I'll give them" },
];

export type NotUsingReason = "declined" | "unable_no_representative" | "no_email_or_device" | "other";

export const NOT_USING_REASON_OPTIONS: { value: NotUsingReason; label: string }[] = [
  { value: "declined", label: "Participant declined" },
  { value: "unable_no_representative", label: "Not able to use it, and no authorised representative" },
  { value: "no_email_or_device", label: "No email or device" },
  { value: "other", label: "Other" },
];

export type PortalAccess = {
  id: string;
  participant_id: string;
  user_id: string | null;
  email: string;
  full_name: string;
  relationship: PortalRelationship;
  relationship_label: string;
  authority_notes: string | null;
  consent_method: "written" | "verbal" | null;
  status: "pending" | "active" | "revoked";
  invite_expires_at: string | null;
  invite_sent_at: string | null;
  invite_expired: boolean;
  identity_method: PortalIdentityMethod | null;
  identity_locked_at: string | null;
  granted_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export type PortalSummary = {
  participant_id: string;
  participant_name: string | null;
  participant_email: string | null;
  status: "active" | "pending" | "not_using" | "not_set";
  not_using: {
    reason: NotUsingReason;
    note: string | null;
    review_date: string | null;
    recorded_at: string | null;
  } | null;
  access: PortalAccess[];
};

export type GrantResult = {
  access: PortalAccess;
  invite_url: string | null;
  identity_code: string | null;
  email_delivery: { status: string; message?: string };
};

export type GrantInput = {
  email: string;
  full_name: string;
  relationship: PortalRelationship;
  identity_method: PortalIdentityMethod;
  authority_notes?: string;
  consent_method?: "written" | "verbal";
};

const BASE = "/api/participant-portal-access";

export function getPortalSummary(participantId: string) {
  return jsonFetch<PortalSummary>(`${BASE}/participants/${encodeURIComponent(participantId)}`);
}

export function grantPortalAccess(participantId: string, input: GrantInput) {
  return jsonFetch<GrantResult>(`${BASE}/participants/${encodeURIComponent(participantId)}/grants`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resendPortalInvite(accessId: string) {
  return jsonFetch<GrantResult>(`${BASE}/grants/${encodeURIComponent(accessId)}/resend`, { method: "POST" });
}

export function revokePortalAccess(accessId: string, reason: string) {
  return jsonFetch<PortalAccess>(`${BASE}/grants/${encodeURIComponent(accessId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function recordNotUsingPortal(
  participantId: string,
  input: { reason: NotUsingReason; note?: string; review_date: string },
) {
  return jsonFetch<PortalSummary>(`${BASE}/participants/${encodeURIComponent(participantId)}/not-using`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ── Public invite flow ───────────────────────────────────────────────────

export type PortalInviteSummary = {
  organization_name: string;
  invitee_first_name: string;
  email: string;
  relationship: PortalRelationship;
  participant_first_name: string;
  identity_method: PortalIdentityMethod;
  identity_verified: boolean;
};

export function getPortalInvite(token: string) {
  return jsonFetch<PortalInviteSummary>(`${BASE}/invites/${encodeURIComponent(token)}`);
}

export function verifyPortalInviteIdentity(token: string, answer: string) {
  return jsonFetch<{ verified: boolean }>(`${BASE}/invites/${encodeURIComponent(token)}/verify`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export function acceptPortalInvite(token: string, password: string) {
  return jsonFetch<{ email: string; linked_existing_login: boolean }>(
    `${BASE}/invites/${encodeURIComponent(token)}/accept`,
    { method: "POST", body: JSON.stringify({ password }) },
  );
}
