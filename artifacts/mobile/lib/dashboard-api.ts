import { workerFetch } from "@/lib/worker-fetch";

export type DashboardSession = {
  id: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  session_type?: string;
  duration_minutes?: number;
  status?: string;
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
  action_items: Array<{
    id: string;
    kind: string;
    title: string;
    detail?: string;
    severity: string;
    action_url?: string;
    reference_id?: string;
  }>;
  compliance_alerts: Array<{
    id: string;
    title: string;
    detail?: string;
    severity: string;
    due_date?: string | null;
    action_label?: string;
    action_url?: string;
    source?: string;
  }>;
  stats: {
    shifts_today: number;
    completed_today: number;
    hours_scheduled_minutes: number;
    shift_counts: Record<string, number>;
  };
  generated_at: string;
};

export function getWorkerDashboard() {
  return workerFetch<WorkerDashboard>("/api/dashboard/worker");
}

export function getWorkerLandingDashboard() {
  return workerFetch<WorkerLandingDashboard>("/api/dashboard/worker-landing");
}
