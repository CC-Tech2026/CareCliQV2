import { jsonFetch } from "@/services/http";
import type { DashboardSession } from "@/services/dashboardService";

export type TeamMember = {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  joined_at?: string;
  last_login?: string;
};

export type WorkerStats = TeamMember & {
  total_sessions: number;
  sessions_this_week: number;
  avg_compliance: number | null;
  draft_count: number;
  flagged_count: number;
};

export type ComplianceOverview = {
  average_score: number;
  total_sessions: number;
  compliant: number;
  at_risk: number;
  non_compliant: number;
  sessions: DashboardSession[];
};

export type RpFlag = {
  session_id?: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  category?: string;
  severity?: string;
  phrase?: string;
  suggestion?: string;
};

export type FlaggedSession = {
  id: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  session_type?: string;
  status?: string;
  compliance_score?: number;
  review_flag: boolean;
  review_note?: string;
  review_requested_by?: string;
  review_requested_at?: string;
};

export type RevenueReport = {
  monthly: Array<{
    month: string;
    billed: number;
    paid: number;
    outstanding: number;
    count: number;
  }>;
  total_billed_cents: number;
  total_paid_cents: number;
  total_outstanding_cents: number;
  invoice_count: number;
};

export type RestrictedClinical = {
  restricted_behavioural_notes?: string | null;
  behaviour_support_plan?: string | null;
  medications?: string | null;
  medical_alerts?: string | null;
};

export type WorkerClient = {
  id: string;
  full_name: string;
  ndis_number?: string;
  plan_status?: string;
};

export function getCoordinatorTeam() {
  return jsonFetch<TeamMember[]>("/api/coordinator/team");
}

export function getCoordinatorWorkerStats() {
  return jsonFetch<WorkerStats[]>("/api/coordinator/worker-stats");
}

export function getCoordinatorSessions() {
  return jsonFetch<DashboardSession[]>("/api/coordinator/all-sessions");
}

export function getCoordinatorComplianceOverview() {
  return jsonFetch<ComplianceOverview>("/api/coordinator/compliance-overview");
}

export function getCoordinatorRpFlags() {
  return jsonFetch<RpFlag[]>("/api/coordinator/rp-flags");
}

export type CredentialAlertsResponse = {
  alerts: CredentialAlert[];
  generated_at: string;
  training_due_count: number;
};

export function getCoordinatorCredentialAlerts() {
  return jsonFetch<CredentialAlertsResponse>("/api/coordinator/credential-alerts");
}

export function getCoordinatorFlaggedSessions() {
  return jsonFetch<FlaggedSession[]>("/api/coordinator/flagged-sessions");
}

export function flagSessionForReview(sessionId: string, flagged: boolean, reviewNote?: string) {
  return jsonFetch<{ session_id: string; flagged: boolean }>(`/api/coordinator/sessions/${sessionId}/flag-review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flagged, review_note: reviewNote ?? null }),
  });
}

export function deactivateWorker(workerId: string) {
  return jsonFetch<{ worker_id: string; is_active: boolean }>(`/api/coordinator/workers/${workerId}/deactivate`, { method: "POST" });
}

export function activateWorker(workerId: string) {
  return jsonFetch<{ worker_id: string; is_active: boolean }>(`/api/coordinator/workers/${workerId}/activate`, { method: "POST" });
}

export function assignWorkerToClient(workerId: string, patientId: string, role = "support_worker") {
  return jsonFetch<{ worker_id: string; patient_id: string }>(`/api/coordinator/workers/${workerId}/assign-client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: patientId, role }),
  });
}

export function unassignWorkerFromClient(workerId: string, patientId: string) {
  return jsonFetch<{ unassigned: boolean }>(`/api/coordinator/workers/${workerId}/assign-client/${patientId}`, { method: "DELETE" });
}

export function getWorkerClients(workerId: string) {
  return jsonFetch<WorkerClient[]>(`/api/coordinator/workers/${workerId}/clients`);
}

export function getRevenueReport() {
  return jsonFetch<RevenueReport>("/api/billing/revenue-report");
}

export function getRestrictedClinical(participantId: string) {
  return jsonFetch<RestrictedClinical>(`/api/participants/${participantId}/restricted-clinical`);
}

export function updateRestrictedClinical(participantId: string, data: RestrictedClinical) {
  return jsonFetch<RestrictedClinical>(`/api/participants/${participantId}/restricted-clinical`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export type GoalStatus = "progressing" | "stalled" | "blocked" | "achieved" | "general";

export type ParticipantGoal = {
  id: string;
  description: string;
  category: string;
  is_achieved: boolean;
  target_date?: string;
  goal_code?: string;
  status?: GoalStatus;
};

export type ParticipantGoalGroup = {
  participant_id: string;
  participant_name: string;
  assigned_worker?: string;
  ndis_number?: string;
  last_session_date?: string;
  upcoming_review_date?: string;
  goals: ParticipantGoal[];
};

export type CredentialAlert = {
  credential_id?: string;
  user_id?: string;
  full_name?: string;
  role?: string;
  credential_type?: string;
  title?: string;
  expiry_date?: string;
  status?: string;
};

export async function getCoordinatorGoals(): Promise<ParticipantGoalGroup[]> {
  const [participants, team, sessions] = await Promise.all([
    jsonFetch<Array<Record<string, unknown>>>("/api/participants"),
    jsonFetch<Array<Record<string, unknown>>>("/api/coordinator/team").catch(() => [] as Array<Record<string, unknown>>),
    jsonFetch<Array<Record<string, unknown>>>("/api/coordinator/all-sessions").catch(() => [] as Array<Record<string, unknown>>),
  ]);

  const workerById = new Map<string, string>();
  for (const m of team) {
    if (m.id) workerById.set(String(m.id), String(m.full_name ?? m.email ?? "Team member"));
  }

  const lastSessionByParticipant = new Map<string, string>();
  for (const s of sessions) {
    const pid = String(s.participant_id ?? "");
    const d = String(s.session_date ?? "");
    if (pid && d) {
      const existing = lastSessionByParticipant.get(pid);
      if (!existing || d > existing) lastSessionByParticipant.set(pid, d);
    }
  }

  return (participants as Array<Record<string, unknown>>).map((p) => {
    const rawGoals = (p.goals as Array<Record<string, unknown>> | null) ?? [];
    const goals: ParticipantGoal[] = rawGoals.map((g) => ({
      id: String(g.id ?? ""),
      description: String(g.description ?? g.goal_text ?? ""),
      category: String(g.category ?? g.ndis_category ?? "general"),
      is_achieved: Boolean(g.is_achieved ?? false),
      target_date: g.target_date ? String(g.target_date) : undefined,
      goal_code: g.goal_code ? String(g.goal_code) : undefined,
      status: (g.status as GoalStatus) ?? (g.is_achieved ? "achieved" : "progressing"),
    }));

    const pid = String(p.id ?? "");
    const workerIdRaw = p.assigned_worker_id ?? p.owner_user_id ?? p.created_by;
    const assignedWorkerId = workerIdRaw ? String(workerIdRaw) : undefined;

    return {
      participant_id: pid,
      participant_name: String(p.full_name ?? "Unknown"),
      ndis_number: p.ndis_number ? String(p.ndis_number) : undefined,
      assigned_worker: assignedWorkerId ? (workerById.get(assignedWorkerId) ?? assignedWorkerId) : undefined,
      last_session_date: lastSessionByParticipant.get(pid),
      upcoming_review_date: p.upcoming_review_date ? String(p.upcoming_review_date) : undefined,
      goals,
    };
  });
}

export function sendBulkReminders(workerIds: string[], message: string) {
  return jsonFetch<{ alerts_created: number; errors: string[] }>("/api/coordinator/bulk-reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_ids: workerIds, message }),
  });
}

export type ApproveResult = {
  id?: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  session_type?: string;
  status?: string;
  compliance_score?: number;
  compliance_status?: string;
  review_flag: boolean;
  review_note?: string;
  approved_by: string;
  approved_at: string;
};

export function approveSession(sessionId: string) {
  return jsonFetch<ApproveResult>(`/api/coordinator/sessions/${sessionId}/approve`, {
    method: "POST",
  });
}
