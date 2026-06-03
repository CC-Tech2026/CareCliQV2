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

export function getCoordinatorCredentialAlerts() {
  return jsonFetch<{ alerts: Array<Record<string, unknown>>; generated_at: string }>("/api/coordinator/credential-alerts");
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
