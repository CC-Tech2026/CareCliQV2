import { jsonFetch } from "@/services/http";

export type CheckinStatus = "GOING_WELL" | "NEEDS_ATTENTION" | "INCIDENT_REPORTED";

export type ShiftActivityEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  metadata?: Record<string, unknown>;
  is_billable?: boolean;
  gap_before_secs?: number;
};

export type LongShiftCheckin = {
  id: string;
  status: CheckinStatus;
  note?: string | null;
  submitted_at: string;
};

export type ShiftBreak = {
  id: string;
  break_start_at: string;
  break_end_at?: string | null;
  duration_secs?: number | null;
  is_compliant?: boolean | null;
};

export type ActiveBreakStatus = {
  active: boolean;
  id?: string;
  break_start_at?: string;
  break_number?: number;
  elapsed_secs?: number;
  completed_breaks?: number;
  total_break_secs?: number;
  max_breaks_per_shift?: number | null;
  can_start_break?: boolean;
  block_reason?: "break_in_progress" | "break_limit_reached" | null;
};

export type CheckinWindowStatus = {
  applicable?: boolean;
  can_submit_checkin?: boolean;
  block_reason?: "on_break" | "cooldown" | "not_due_yet" | null;
  cooldown_remaining_secs?: number;
  next_checkin_due_secs?: number;
  checkin_overdue?: boolean;
  checkins_completed?: number;
  checkins_required?: number;
  last_checkin_at?: string | null;
  checkin_gap_secs?: number;
  checkin_cooldown_secs?: number;
  checkin_early_window_secs?: number;
};

export function getActiveBreak(sessionId: string) {
  return jsonFetch<ActiveBreakStatus>(`/api/worker/sessions/${sessionId}/breaks/active`);
}

export function getBreakStatusByShift(shiftId: string) {
  return jsonFetch<ActiveBreakStatus>(`/api/worker/shifts/${shiftId}/breaks/status`);
}

export function getCheckinStatus(sessionId: string) {
  return jsonFetch<CheckinWindowStatus>(`/api/worker/sessions/${sessionId}/checkins/status`);
}

export function getCheckinStatusByShift(shiftId: string) {
  return jsonFetch<CheckinWindowStatus>(`/api/worker/shifts/${shiftId}/checkins/status`);
}

export function submitLongShiftCheckin(
  sessionId: string,
  body: {
    status: CheckinStatus;
    note?: string;
    prompt_triggered_at?: string;
    gap_at_prompt_secs?: number;
  },
) {
  return jsonFetch<LongShiftCheckin>(`/api/worker/sessions/${sessionId}/checkins`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startLongShiftBreak(sessionId: string) {
  return jsonFetch<ShiftBreak>(`/api/worker/sessions/${sessionId}/breaks/start`, {
    method: "POST",
  });
}

export function endLongShiftBreak(sessionId: string) {
  return jsonFetch<ShiftBreak>(`/api/worker/sessions/${sessionId}/breaks/end`, {
    method: "POST",
  });
}

export function getSessionActivityTimeline(sessionId: string) {
  return jsonFetch<{ session_id: string; events: ShiftActivityEvent[] }>(
    `/api/worker/sessions/${sessionId}/timeline`,
  );
}

export type LiveLongShift = {
  session_id?: string | null;
  shift_id?: string;
  worker_name?: string;
  participant_name?: string;
  started_at?: string;
  duration_secs?: number;
  current_gap_secs?: number;
  status: "GREEN" | "AMBER" | "RED";
  checkins_completed?: number;
  checkins_required?: number;
  next_checkin_due_secs?: number | null;
  break_logged?: boolean;
  on_break?: boolean;
  break_started_at?: string | null;
  break_elapsed_secs?: number;
  break_compliant?: boolean;
  engagement_score?: number | null;
  coordinator_alerted?: boolean;
  last_activity_type?: string | null;
  last_activity_at?: string | null;
};

export type MonitorLiveResponse = {
  active_long_shifts: LiveLongShift[];
  summary: {
    total_active: number;
    green_count: number;
    amber_count: number;
    red_count: number;
    avg_engagement_score?: number | null;
  };
};

export function getMonitorLive() {
  return jsonFetch<MonitorLiveResponse>("/api/coordinator/monitor/live");
}

export function getEngagementSummary(startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const qs = params.toString();
  return jsonFetch<{
    total_long_shifts: number;
    passed_check16: number;
    pass_rate_pct: number;
    distribution: Record<string, number>;
  }>(`/api/coordinator/monitor/engagement-summary${qs ? `?${qs}` : ""}`);
}

export type WorkerActivitySummary = {
  session_id: string;
  is_long_shift?: boolean;
  last_activity_at?: string | null;
  minutes_since_activity?: number;
  current_gap_secs?: number;
  on_break?: boolean;
  offline?: boolean;
  checkins_completed?: number;
  break_duration_secs?: number;
  billable_duration_secs?: number | null;
  gross_duration_secs?: number;
  timeline_event_count?: number;
};

export function getWorkerActivitySummary(sessionId: string) {
  return jsonFetch<WorkerActivitySummary>(`/api/worker/sessions/${sessionId}/engagement/summary`);
}

export function markSessionOffline(sessionId: string) {
  return jsonFetch<{ session_id: string; offline_since_at?: string }>(
    `/api/worker/sessions/${sessionId}/engagement/offline`,
    { method: "POST" },
  );
}

export function markSessionHeartbeat(sessionId: string) {
  return jsonFetch<WorkerActivitySummary>(
    `/api/worker/sessions/${sessionId}/engagement/heartbeat`,
    { method: "POST" },
  );
}

export type AuditEngagementPack = {
  engagement_compliance_kpi: {
    total_long_shifts: number;
    passed_check16: number;
    pass_rate_pct: number;
    distribution: Record<string, number>;
    label?: string;
    description?: string;
  };
  long_shift_engagement_log: Array<{
    session_id: string;
    session_date?: string;
    participant_name?: string;
    worker_name?: string;
    shift_duration_hours?: number;
    checkins_completed?: number;
    checkins_required?: number;
    max_activity_gap_mins?: number;
    break_duration_mins?: number;
    engagement_score?: number;
    engagement_score_band?: string;
    check16_passed?: boolean;
    coordinator_alerts?: number;
    flags?: unknown[];
  }>;
  check16_compliance_row: {
    rule: string;
    name?: string;
    period_result: string;
    sessions_flagged: number;
    pass_rate_pct?: number;
  };
  billable_reconciliation: Array<{
    session_id: string;
    participant_name?: string;
    billed_hours?: number | null;
    billable_hours?: number | null;
    break_hours?: number;
    discrepancy_hours?: number;
    flagged?: boolean;
  }>;
};

export function getAuditEngagementPack(startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const qs = params.toString();
  return jsonFetch<AuditEngagementPack>(
    `/api/coordinator/audit-pack/engagement${qs ? `?${qs}` : ""}`,
  );
}
