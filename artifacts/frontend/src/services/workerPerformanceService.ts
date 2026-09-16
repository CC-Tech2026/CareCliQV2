import { jsonFetch } from "@/services/http";

export type ComplianceBand = "green" | "amber" | "red" | "unknown";

export type ShiftHistoryRow = {
  id: string;
  shift_date?: string;
  /** IANA zone of the participant's branch (shift_date is that branch's calendar day). */
  timezone?: string | null;
  scheduled_start?: string;
  scheduled_end?: string;
  clocked_in_at?: string;
  clocked_out_at?: string;
  participant_id?: string;
  participant_name?: string;
  participant_first_name?: string;
  worker_id?: string;
  worker_name?: string;
  coordinator_id?: string;
  coordinator_email?: string | null;
  duration_minutes?: number | null;
  compliance_score?: number | null;
  compliance_band: ComplianceBand;
  compliance_explanation?: string;
  has_feedback?: boolean;
  has_unread_feedback?: boolean;
  feedback_count?: number;
  status?: string;
};

export type ShiftHistoryDetail = ShiftHistoryRow & {
  tasks?: Array<Record<string, unknown>>;
  validation?: Record<string, unknown>;
  flagged_tasks?: Array<Record<string, unknown>>;
  notes?: string;
  evidence?: Array<{
    task_id?: string;
    label?: string;
    type: string;
    url?: string;
    thumbnail_url?: string;
    evidence_id?: string | null;
  }>;
  feedback?: Array<{
    id: string;
    strengths: string;
    areas_to_improve: string;
    action_items: string;
    submitted_at: string;
    acknowledged_at?: string | null;
    coordinator_name?: string;
  }>;
  shift_signature?: Record<string, unknown>;
  session_id?: string | null;
};

export type ShiftHistoryTrendPoint = {
  shift_id: string;
  date: string;
  score: number | null;
  compliance_band: ComplianceBand;
};

export type ShiftFeedback = {
  id: string;
  shift_id: string;
  strengths: string;
  areas_to_improve: string;
  action_items: string;
  submitted_at: string;
  acknowledged_at?: string | null;
  coordinator_name?: string;
};

export type PerformanceDashboard = {
  average_score_30d: number | null;
  compliance_band: ComplianceBand;
  trend: {
    direction: "up" | "down" | "stable";
    delta: number;
    sentence: string;
    tooltip: string;
  };
  strengths: Array<{ label: string; count: number }>;
  focus_areas: Array<{ label: string; count: number }>;
  badges: Array<{
    key: string;
    title: string;
    description: string;
    unlocked: boolean;
    unlocked_at?: string | null;
  }>;
  recommended_training?: {
    id: string;
    title: string;
    training_module_id?: string | null;
    recommended_at?: string;
  } | null;
};

export type WorkerCertification = {
  id: string;
  title: string;
  credential_type: string;
  issuer?: string | null;
  expiry_date?: string | null;
  status: string;
  display_status: "valid" | "expiring" | "expired" | "pending_review" | "rejected";
  file_url?: string | null;
};

export type TrainingModule = {
  cover_color?: string | null;
  cover_path?: string | null;
  cover_url?: string | null;
  is_locked?: boolean;
  lock_reason?: string | null;
  id: string;
  title: string;
  description?: string | null;
  linked_credential_type?: string | null;
  requires_certification?: boolean;
  resources?: Array<{
    id: string;
    resource_type: "video" | "pdf" | "external_link";
    title: string;
    access_url?: string | null;
  storage_path?: string | null;
    external_url?: string | null;
  }>;
};

export function getShiftHistory(params?: {
  participant_id?: string[];
  date_from?: string;
  date_to?: string;
  compliance_band?: string;
}) {
  const qs = new URLSearchParams();
  params?.participant_id?.forEach((id) => qs.append("participant_id", id));
  if (params?.date_from) qs.set("date_from", params.date_from);
  if (params?.date_to) qs.set("date_to", params.date_to);
  if (params?.compliance_band && params.compliance_band !== "all") {
    qs.set("compliance_band", params.compliance_band);
  }
  const query = qs.toString();
  return jsonFetch<{
    shifts: ShiftHistoryRow[];
    participants: Array<{ id: string; first_name: string }>;
  }>(`/api/worker/shift-history${query ? `?${query}` : ""}`);
}

export function getShiftHistoryDetail(shiftId: string) {
  return jsonFetch<ShiftHistoryDetail>(`/api/worker/shift-history/${shiftId}`);
}

export function getShiftHistoryTrend(limit = 30) {
  return jsonFetch<{ trend: ShiftHistoryTrendPoint[]; limit: number }>(
    `/api/worker/shift-history/trend?limit=${limit}`,
  );
}

export function exportShiftPdf(shiftId: string) {
  return jsonFetch<{
    export_id: string;
    status: string;
    file_url?: string;
    download_url?: string;
    expires_at?: string | null;
    auto_generated?: boolean;
  }>(`/api/worker/shift-history/${shiftId}/export`, { method: "POST" });
}

export function shareShiftSummary(
  shiftId: string,
  payload: {
    email_self?: boolean;
    email_coordinator?: boolean;
    additional_recipients?: string[];
  },
) {
  return jsonFetch<{
    export_id: string;
    recipients: string[];
    subject: string;
    coordinator_emails?: string[];
  }>(
    `/api/worker/shift-history/${shiftId}/share`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function downloadShiftExportFile(exportId: string, filename = "shift-export.pdf") {
  const { apiFetch } = await import("@/lib/api-fetch");
  const response = await apiFetch(`/api/worker/shift-history/exports/${exportId}/file`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || payload.message || `Download failed with ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function getFeedbackUnreadCount() {
  return jsonFetch<{ unread_count: number }>("/api/worker/feedback/unread-count");
}

export function getFeedbackDetail(feedbackId: string) {
  return jsonFetch<ShiftFeedback>(`/api/worker/feedback/${feedbackId}`);
}

export function acknowledgeFeedback(feedbackId: string) {
  return jsonFetch<ShiftFeedback>(`/api/worker/feedback/${feedbackId}/acknowledge`, {
    method: "POST",
  });
}

export function getPerformanceDashboard() {
  return jsonFetch<PerformanceDashboard>("/api/worker/performance-dashboard");
}

export function getWorkerCertifications() {
  return jsonFetch<{ certifications: WorkerCertification[] }>("/api/worker/training/certifications");
}

export function getTrainingModules() {
  return jsonFetch<{ modules: TrainingModule[] }>("/api/worker/training/modules");
}

export type SharedTrainingResource = {
  id: string; name: string; category?: string | null;
  resource_type: string; file_size_bytes?: number | null;
};

export function getSharedTrainingResources() {
  return jsonFetch<{ resources: SharedTrainingResource[] }>("/api/worker/training/resources");
}

export function getSharedTrainingResourceUrl(id: string) {
  return jsonFetch<{ url: string }>(`/api/worker/training/resources/${encodeURIComponent(id)}/access`);
}

export function markTrainingComplete(payload: {
  module_id: string;
  completed_at: string;
  note?: string;
  acknowledged: boolean;
}) {
  return jsonFetch("/api/worker/training/complete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startTrainingModule(moduleId: string) {
  return jsonFetch<{ started_at: string | null }>(`/api/worker/training/${moduleId}/start`, {
    method: "POST",
  });
}

export function createTrainingRequest(payload: {
  request_text: string;
  reason: string;
  urgent?: boolean;
}) {
  return jsonFetch("/api/worker/training/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTrainingRequests() {
  return jsonFetch<{ requests: Array<Record<string, unknown>> }>("/api/worker/training/requests");
}

export function getTrainingHistory() {
  return jsonFetch<{ history: Array<Record<string, unknown>> }>("/api/worker/training/history");
}

export type TrainingRecommendation = {
  id: string;
  training_module_id: string;
  title: string;
  recommended_at: string;
  due_at?: string | null;
  started_at?: string | null;
};

export function getTrainingRecommendations() {
  return jsonFetch<{ recommendations: TrainingRecommendation[] }>("/api/worker/training/recommendations");
}

export function submitCoordinatorShiftFeedback(
  shiftId: string,
  payload: {
    strengths: string;
    areas_to_improve: string;
    action_items: string;
    tag_ids?: string[];
  },
) {
  return jsonFetch(`/api/coordinator/shifts/${shiftId}/feedback`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCoordinatorFeedbackTags(category?: string) {
  const qs = category ? `?category=${category}` : "";
  return jsonFetch<{ tags: Array<{ id: string; label: string; category: string }> }>(
    `/api/coordinator/feedback/tags${qs}`,
  );
}

export function getCoordinatorAckRate() {
  return jsonFetch<{ total: number; acknowledged: number; rate_percent: number | null }>(
    "/api/coordinator/feedback/acknowledgement-rate",
  );
}
