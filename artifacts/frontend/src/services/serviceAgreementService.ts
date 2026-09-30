import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

export type PlanManagementType = "NDIA-managed" | "plan-managed" | "self-managed";
export type SupportLocation = "home" | "school" | "preschool" | "clinic" | "other";
export type SupportFrequency = "weekly" | "fortnightly" | "monthly" | "as_scheduled";

export type AgreementLineInput = {
  support_item_code: string;
  quantity: number;
  /** Omit to use the catalogue price limit. */
  rate?: number | null;
  location?: SupportLocation | null;
  frequency?: SupportFrequency | null;
};

export type AgreementDraftInput = {
  plan_management_type: PlanManagementType;
  plan_manager_name?: string | null;
  plan_manager_email?: string | null;
  start_date: string;
  end_date: string;
  includes_price_adjustment_clause: boolean;
  gst_treatment_basis?: string | null;
  cancellation_notice_hours?: number | null;
  cancellation_fee_percentage?: number | null;
  supports: AgreementLineInput[];
};

export function createAgreementDraft(participantId: string, draft: AgreementDraftInput) {
  return jsonFetch<{ id: string }>(
    `/api/participants/${encodeURIComponent(participantId)}/service-agreements/drafts`,
    { method: "POST", body: JSON.stringify(draft) },
  );
}

export function updateAgreementDraft(agreementId: string, draft: AgreementDraftInput) {
  return jsonFetch<{ id: string }>(`/api/service-agreements/${encodeURIComponent(agreementId)}`, {
    method: "PUT",
    body: JSON.stringify(draft),
  });
}

export function deleteAgreementDraft(agreementId: string) {
  return jsonFetch<void>(`/api/service-agreements/${encodeURIComponent(agreementId)}`, { method: "DELETE" });
}

export function sendAgreementForSignature(agreementId: string) {
  return jsonFetch<{ id: string }>(`/api/service-agreements/${encodeURIComponent(agreementId)}/send`, {
    method: "POST",
  });
}

export function signAgreement(
  agreementId: string,
  body: {
    provider_name: string;
    provider_signature_png: string;
    participant_name: string;
    participant_signature_png: string;
  },
) {
  return jsonFetch<{ id: string }>(`/api/service-agreements/${encodeURIComponent(agreementId)}/sign`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Opens the agreement PDF (signed copy, or the current draft) in a new tab.
 * Fetched with the session's auth, then shown from a local blob URL. */
export async function openAgreementDocument(agreementId: string): Promise<void> {
  // Open synchronously so pop-up blockers treat it as user-initiated.
  const win = window.open("", "_blank");
  const res = await apiFetch(`/api/service-agreements/${encodeURIComponent(agreementId)}/document`);
  if (!res.ok) {
    win?.close();
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't open the agreement.");
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Remote e-signing ────────────────────────────────────────────────────────

export type SignerRelationship = "participant" | "nominee" | "guardian" | "other";

export type AgreementEsignStatus = {
  signer_name: string | null;
  signer_email: string;
  relationship: SignerRelationship | null;
  expires_at: string | null;
  expired: boolean;
  email_verified: boolean;
};

export function sendAgreementForEsign(
  agreementId: string,
  body: {
    provider_name: string;
    provider_signature_png: string;
    signer_name: string;
    signer_email: string;
    relationship: SignerRelationship;
  },
) {
  return jsonFetch<{
    email_delivery: { status: string; message?: string };
    sent_to: string;
    expires_at: string;
    /** Only when the email couldn't be queued, so it can be shared another way. */
    sign_url?: string;
  }>(
    `/api/service-agreements/${encodeURIComponent(agreementId)}/esign`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function cancelAgreementEsign(agreementId: string) {
  return jsonFetch<void>(`/api/service-agreements/${encodeURIComponent(agreementId)}/esign`, { method: "DELETE" });
}

/** What the signer sees. `agreement` is null until they've confirmed the
 * emailed code. */
export type PublicAgreementView = {
  organization_name: string | null;
  logo_url: string | null;
  participant_first_name: string;
  signer_name: string | null;
  relationship: SignerRelationship | null;
  email_hint: string;
  status: "awaiting_signature" | "signed";
  email_verified: boolean;
  provider_signed_name: string | null;
  provider_signed_at: string | null;
  participant_signed_name: string | null;
  participant_signed_at: string | null;
  agreement: {
    agreement_number: string | null;
    period: string;
    plan_management: string;
    plan_manager: string | null;
    supports: Array<{ name: string; detail: string; quantity: string; rate: string; total: string }>;
    total: string;
    price_changes: string;
    cancellations: string;
    gst: string | null;
  } | null;
};

const publicPath = (token: string, suffix = "") => `/api/agreement-sign/${encodeURIComponent(token)}${suffix}`;

export function getAgreementForSigning(token: string) {
  return jsonFetch<PublicAgreementView>(publicPath(token));
}

export function sendAgreementSigningCode(token: string) {
  return jsonFetch<{ ok: boolean; message?: string }>(publicPath(token, "/send-code"), { method: "POST" });
}

export function verifyAgreementSigningCode(token: string, code: string) {
  return jsonFetch<{ ok: boolean }>(publicPath(token, "/verify-code"), {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function signAgreementByLink(token: string, body: { full_name: string; signature_png: string; understood: boolean }) {
  return jsonFetch<{ ok: boolean; document_sha256: string }>(publicPath(token), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The PDF for the signer, opened in a new tab. */
export async function openSigningDocument(token: string): Promise<void> {
  const win = window.open("", "_blank");
  const res = await apiFetch(publicPath(token, "/document"));
  if (!res.ok) {
    win?.close();
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't open the agreement.");
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
