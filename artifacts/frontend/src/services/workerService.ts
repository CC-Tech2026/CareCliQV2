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
