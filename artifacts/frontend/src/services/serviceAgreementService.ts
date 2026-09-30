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
