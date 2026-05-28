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

export function getCoordinatorTeam() {
  return jsonFetch<TeamMember[]>("/api/coordinator/team");
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
