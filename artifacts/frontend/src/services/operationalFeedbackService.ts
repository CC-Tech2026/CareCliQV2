import { jsonFetch } from "@/services/http";

export const FEEDBACK_CATEGORIES = [
  { value: "process", label: "Process" },
  { value: "equipment", label: "Equipment" },
  { value: "scheduling", label: "Scheduling" },
  { value: "communication", label: "Communication" },
  { value: "safety_non_incident", label: "Safety (non-incident)" },
  { value: "other", label: "Other" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["value"];
export type FeedbackStatus = "open" | "in_review" | "resolved";

export interface OperationalFeedback {
  id: string;
  organization_id: string;
  reporter_id: string;
  reporter_name: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  status: FeedbackStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackCreatePayload {
  category: FeedbackCategory;
  title: string;
  description: string;
}

export function createOperationalFeedback(payload: FeedbackCreatePayload) {
  return jsonFetch<OperationalFeedback>("/api/operational-feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listOperationalFeedback(statusFilter?: FeedbackStatus) {
  const query = statusFilter ? `?status_filter=${statusFilter}` : "";
  return jsonFetch<OperationalFeedback[]>(`/api/operational-feedback${query}`);
}

export function updateOperationalFeedbackStatus(
  id: string,
  status: FeedbackStatus,
  resolutionNotes?: string,
) {
  return jsonFetch<OperationalFeedback>(`/api/operational-feedback/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolution_notes: resolutionNotes }),
  });
}
