import { jsonFetch } from "@/services/http";
import type { DashboardClient, DashboardSession } from "@/services/dashboardService";

/** Enriched goal returned by the worker API (SCRUM-145, SCRUM-255). No funding data. */
export type GoalDetail = {
  id: string;
  title: string;
  description?: string;
  status: "active" | "archived" | "completed";
  category?: string;
  priority: number;
  why_it_matters?: string | null;
  worker_focus?: string[];
  progress_percentage?: number | null;
  target_date?: string | null;
};

/** Per-goal structured documentation captured during a session (SCRUM-226). */
export type GoalProgressNote = {
  goal_id: string;
  goal_title: string;
  evidence_provided?: string;
  outcome?: string;
  observation?: string;
};

export type WorkerClient = DashboardClient & {
  date_of_birth?: string;
  primary_disability?: string;
  allergies?: string | null;
  communication_preferences?: string | null;
  behaviour_support_plan?: string | null;
  restricted_behavioural_notes?: string | null;
  plan_start_date?: string;
  plan_end_date?: string;
  goals?: GoalDetail[];
  limited_medical_history?: Record<string, unknown>;
};

export type WorkerClientDetail = {
  participant: WorkerClient;
  sessions: DashboardSession[];
  notes: DashboardSession[];
  compliance: DashboardSession[];
};

export type WorkerCompliance = {
  average_score: number;
  status: "compliant" | "at_risk" | "non_compliant";
  total_sessions: number;
  reviewed_sessions: number;
  at_risk: number;
  sessions: DashboardSession[];
};

export type ComplianceRuleResult = {
  rule: string;
  label: string;
  status: "pass" | "fail" | "warning" | "pending" | string;
  message?: string;
  explanation?: string;
  severity?: string;
  enforcement_tier?: string;
};

export type ComplianceTrendPoint = {
  date: string;
  avg_score: number | null;
  session_count: number;
};

export type WorkerComplianceDetail = {
  score: number;
  status: "compliant" | "at_risk" | "non_compliant";
  reviewed_sessions: number;
  rules: ComplianceRuleResult[];
  failed_rules: Array<{
    rule?: string;
    label?: string;
    message?: string;
    explanation?: string;
    severity?: string;
    enforcement_tier?: string;
  }>;
  rules_catalog: ComplianceRuleResult[];
  trend: ComplianceTrendPoint[];
  trend_days: number;
};

export type WorkerNdisPlan = {
  participant_id: string;
  participant_name?: string;
  read_only: boolean;
  goals: GoalDetail[];
  plan: Record<string, unknown>;
};

export type CreateWorkerSessionInput = {
  session_date?: string;
  duration_minutes?: number;
  session_type?: string;
  notes?: string;
  goals_addressed?: string[];
  status?: string;
  outcomes?: string;
  participant_response?: string;
  progress_toward_goals?: string;
};

export type CreateWorkerNoteInput = {
  notes: string;
  session_date?: string;
  session_type?: string;
  duration_minutes?: number;
  goals_addressed?: string[];
};

export function getMyClients() {
  return jsonFetch<WorkerClient[]>("/api/worker/my-clients");
}

export function getMyClientDetail(id: string) {
  return jsonFetch<WorkerClientDetail>(`/api/worker/my-clients/${id}`);
}

export function getMyClientSessions(id: string) {
  return jsonFetch<DashboardSession[]>(`/api/worker/my-clients/${id}/sessions`);
}

export function getMyClientNdisPlan(id: string) {
  return jsonFetch<WorkerNdisPlan>(`/api/worker/my-clients/${id}/ndis-plan`);
}

export function getMyCompliance() {
  return jsonFetch<WorkerCompliance>("/api/worker/my-compliance");
}

export function getWorkerComplianceDetail(days: 7 | 30 = 7) {
  return jsonFetch<WorkerComplianceDetail>(`/api/worker/compliance-detail?days=${days}`);
}

export function createMyClientSession(id: string, body: CreateWorkerSessionInput = {}) {
  return jsonFetch<DashboardSession>(`/api/worker/my-clients/${id}/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createMyClientNote(id: string, body: CreateWorkerNoteInput) {
  return jsonFetch<DashboardSession>(`/api/worker/my-clients/${id}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Worker-Participant Matching Enhancement, Phase 1 — self-service tags ────

export type Tag = { id: string; label: string; is_active: boolean };
export type TagCategory = { id: string; name: string; is_active: boolean; tags: Tag[] };
export type MyTag = {
  id: string;
  tag_id: string;
  label?: string;
  category_id?: string;
  added_at: string;
  notes?: string | null;
  visible_to_coordinator_only: boolean;
};

/** The org's tag catalog, for a worker choosing what to add to their own profile. */
export function getWorkerTagCatalog() {
  return jsonFetch<TagCategory[]>("/api/worker/tag-catalog");
}

export function getMyTags() {
  return jsonFetch<MyTag[]>("/api/worker/tags");
}

export function addMyTag(tagId: string, notes?: string, visibleToCoordinatorOnly = false) {
  return jsonFetch<MyTag>("/api/worker/tags", {
    method: "POST",
    body: JSON.stringify({ tag_id: tagId, notes: notes ?? null, visible_to_coordinator_only: visibleToCoordinatorOnly }),
  });
}

export function removeMyTag(tagId: string) {
  return jsonFetch<void>(`/api/worker/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
}

/** Opt out of interest/lived-experience-based shift ranking entirely, keeping tags on file. */
export function setMatchingOptIn(optIn: boolean) {
  return jsonFetch<{ ok: boolean }>("/api/worker/matching-preferences", {
    method: "PATCH",
    body: JSON.stringify({ matching_opt_in: optIn }),
  });
}
