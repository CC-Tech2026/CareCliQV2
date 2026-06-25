import { jsonFetch } from "@/services/http";

export type EvidenceMetadata = {
  evidence_id: string;
  session_id: string;
  shift_id?: string | null;
  uploaded_by: string;
  uploaded_at: string;
  uploaded_at_utc?: string;
  uploaded_at_local?: string;
  uploader_name?: string;
  device_type?: string;
  file_hash?: string;
  file_size_bytes?: number;
  mime_type?: string;
  evidence_type?: string;
  retention_until?: string | null;
  is_deleted?: boolean;
  is_quarantined?: boolean;
};

export type ShiftSignature = {
  shift_id: string;
  worker_id: string;
  signed_at: string;
  signer_name?: string;
  signature_png_url?: string;
  signature_svg?: string;
  confirm_tasks_accurate: boolean;
  confirm_safety_followed: boolean;
  confirm_no_unreported_incidents: boolean;
};

export type PrivacyOverview = {
  data_categories: Array<{
    id: string;
    title: string;
    description: string;
    retention: string;
  }>;
  analytics_opt_out: boolean;
  privacy_policy: {
    version: string;
    summary_text: string;
    full_pdf_path?: string | null;
    published_at?: string | null;
  };
};

export function getSessionEvidenceMetadata(sessionId: string, asCoordinator = false) {
  const base = asCoordinator ? "/api/coordinator" : "/api/worker";
  return jsonFetch<{ evidence: EvidenceMetadata[] }>(`${base}/sessions/${sessionId}/evidence-metadata`);
}

export function submitShiftSignature(
  shiftId: string,
  body: {
    confirm_tasks_accurate: boolean;
    confirm_safety_followed: boolean;
    confirm_no_unreported_incidents: boolean;
    signature_svg: string;
    signature_png_data_url: string;
  },
) {
  return jsonFetch<ShiftSignature>(`/api/worker/shifts/${shiftId}/sign`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getCoordinatorShiftSignature(shiftId: string) {
  return jsonFetch<ShiftSignature>(`/api/coordinator/shifts/${shiftId}/signature`);
}

export function deleteCoordinatorEvidence(evidenceId: string, reason: string) {
  return jsonFetch<{ success: boolean }>(`/api/coordinator/evidence/${evidenceId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function getPrivacyOverview() {
  return jsonFetch<PrivacyOverview>("/api/worker/privacy");
}

export function setAnalyticsOptOut(optOut: boolean) {
  return jsonFetch<{ analytics_opt_out: boolean }>("/api/worker/privacy/analytics-opt-out", {
    method: "PATCH",
    body: JSON.stringify({ analytics_opt_out: optOut }),
  });
}

export function requestDataExport() {
  return jsonFetch<{ message: string; download_path?: string; expires_at?: string }>(
    "/api/worker/privacy/export",
    { method: "POST" },
  );
}

export function requestAccountDeletion(confirmationText: string) {
  return jsonFetch<{ success: boolean; message: string }>("/api/worker/privacy/deletion-request", {
    method: "POST",
    body: JSON.stringify({ confirmation_text: confirmationText }),
  });
}

export function listPrivacyPolicyVersions() {
  return jsonFetch<{ versions: Array<{ version: string; summary_text: string; published_at: string; is_current?: boolean }> }>(
    "/api/worker/privacy/policy/versions",
  );
}
