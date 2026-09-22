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

export type DashboardShiftSummary = {
  id: string;
  participant_id?: string;
  participant_name: string;
  scheduled_start?: string;
  scheduled_end?: string;
  date_label?: string | null;
  time_label?: string | null;
  status: string;
  visual_state: string;
  participant_address?: string | null;
  duration_minutes?: number;
  has_risk_alerts?: boolean;
  risks_acknowledged?: boolean;
  /** Participant's branch zone — the backend already resolves this. */
  timezone?: string | null;
};

export type DashboardActionItem = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  severity: "critical" | "high" | "medium" | "low" | string;
  action_url?: string;
  reference_id?: string;
};

export type DashboardComplianceAlert = {
  id: string;
  title: string;
  detail?: string;
  severity: "critical" | "high" | "medium" | "info" | string;
  due_date?: string | null;
  action_label?: string;
  action_url?: string;
  source?: string;
};

export type WorkerLandingDashboard = {
  worker: {
    id: string;
    full_name: string;
    first_name: string;
  };
  greeting_context: {
    date_label: string;
    timezone: string;
  };
  today_shifts: DashboardShiftSummary[];
  next_shift: DashboardShiftSummary | null;
  action_items: DashboardActionItem[];
  compliance_alerts: DashboardComplianceAlert[];
  stats: {
    shifts_today: number;
    completed_today: number;
    hours_scheduled_minutes: number;
    shift_counts: Record<string, number>;
  };
  generated_at: string;
};

export type TravelTimeEstimate = {
  shift_id?: string;
  destination_address?: string | null;
  available: boolean;
  reason?: string | null;
  navigation_url?: string | null;
  duration_text?: string | null;
  duration_seconds?: number | null;
  distance_text?: string | null;
};

export function getWorkerLandingDashboard() {
  return jsonFetch<WorkerLandingDashboard>("/api/dashboard/worker-landing");
}

export function getWorkerLandingTravelTime(
  shiftId: string,
  origin?: { lat: number; lng: number },
) {
  const params = new URLSearchParams({ shift_id: shiftId });
  if (origin) {
    params.set("origin_lat", String(origin.lat));
    params.set("origin_lng", String(origin.lng));
  }
  return jsonFetch<TravelTimeEstimate>(`/api/dashboard/worker-landing/travel-time?${params.toString()}`);
}

export function getCoordinatorDashboard() {
  return jsonFetch<CoordinatorDashboard>("/api/dashboard/coordinator");
}
