import { jsonFetch } from "@/services/http";

export type DashboardSession = {
  id: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  session_type?: string;
  duration_minutes?: number;
  status?: string;
  legal_record_text?: string | null;
  notes?: string | null;
  compliance_score?: number | null;
  compliance_status?: "compliant" | "at_risk" | "non_compliant" | "draft";
};

export type DashboardClient = {
  id: string;
  full_name: string;
  ndis_number?: string;
  plan_status?: string;
  plan_management_type?: string;
  last_seen?: string | null;
  compliance_status?: "compliant" | "at_risk" | "non_compliant";
  compliance_score?: number | null;
};

export type WorkerDashboard = {
  sessions_today: number;
  notes_due: number;
  compliance_score: number;
  compliance_status: "compliant" | "at_risk" | "non_compliant";
  assigned_clients: DashboardClient[];
  today_clients: DashboardClient[];
  credential_alerts: Array<Record<string, unknown>>;
  pending_compliance_fixes: DashboardSession[];
  incomplete_sessions: DashboardSession[];
};

export type CoordinatorDashboard = {
  active_workers: number;
  compliant_today: number;
  notes_at_risk: number;
  rp_flags: number;
  team_participants?: number;
  sessions_this_week?: number;
  incidents_this_month?: number;
  workers_needing_support?: number;
  team_compliance_score: number;
  team_compliance_breakdown?: {
    compliant: number;
    at_risk: number;
    non_compliant: number;
  };
  workers_needing_attention: Array<{
    id: string;
    full_name: string;
    email?: string;
    compliance_score?: number;
    sessions?: number;
    reason?: string;
  }>;
  todays_sessions: DashboardSession[];
  common_issues: Array<{ issue: string; count: number }>;
  credential_alerts: Array<Record<string, unknown>>;
  incident_alerts: Array<Record<string, unknown>>;
  participants?: number;
};

export function getWorkerDashboard() {
  return jsonFetch<WorkerDashboard>("/api/dashboard/worker");
}

export function getCoordinatorDashboard() {
  return jsonFetch<CoordinatorDashboard>("/api/dashboard/coordinator");
}
