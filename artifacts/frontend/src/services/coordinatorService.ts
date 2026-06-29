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
  budget_warnings?: BudgetRuleAlert[];
  ai_detected_patterns?: AiDetectedPattern[];
  sessions: DashboardSession[];
};

export type AiDetectedPattern = {
  id: string;
  pattern_type:
    | "low_compliance_pair"
    | "incident_escalation"
    | "refused_activity_no_deescalation";
  severity?: "low" | "medium" | "high";
  title: string;
  message: string;
  worker_id?: string | null;
  participant_id?: string | null;
  metadata?: Record<string, unknown>;
  detected_at?: string;
  dismissed_at?: string | null;
};

export type BudgetRuleAlert = {
  session_id?: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  rule: "budget_exceeded" | "budget_warning";
  status?: string;
  severity?: string;
  message?: string;
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

export function getCoordinatorAiDetectedPatterns() {
  return jsonFetch<{ patterns: AiDetectedPattern[] }>("/api/coordinator/ai-detected-patterns");
}

export function runCoordinatorPatternDetection() {
  return jsonFetch<{ patterns: AiDetectedPattern[]; detected: number; created: number }>(
    "/api/coordinator/ai-detected-patterns/run",
    { method: "POST" },
  );
}

export function dismissCoordinatorPattern(patternId: string) {
  return jsonFetch<{ ok: boolean; pattern: AiDetectedPattern }>(
    `/api/coordinator/ai-detected-patterns/${patternId}/dismiss`,
    { method: "POST" },
  );
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
  return jsonFetch<{ notifications_sent: number; alerts_created?: number; errors: string[] }>(
    "/api/coordinator/bulk-reminders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker_ids: workerIds, message }),
    },
  );
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

export type CredentialStatus = {
  valid: boolean;
  missing_credentials: string[];
  warning?: string | null;
};

export type AssignShiftPayload = {
  worker_id?: string;
  participant_id: string;
  scheduled_start: string;
  scheduled_end?: string;
  duration_minutes?: number;
  shift_type?: string;
  selected_task_ids?: string[];
};

export type AssignShiftResult = {
  shift_id: string;
  shift: Record<string, unknown>;
  credential_status: CredentialStatus;
  message: string;
};

export type WorkerCredentialStatusResponse = {
  worker_id: string;
  shift_type: string;
  credential_status: CredentialStatus;
};

export type CoordinatorShiftRecord = {
  id: string;
  organization_id?: string;
  worker_id?: string;
  participant_id?: string;
  session_id?: string | null;
  shift_type?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  duration_minutes?: number;
  status?: string;
  participant_name?: string;
  worker_name?: string;
  worker_email?: string;
  created_at?: string;
  updated_at?: string;
};

export type ShiftCredentialRequirement = {
  id: string;
  shift_type: string;
  required_credential_type: string;
  minimum_status: "valid";
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ShiftCredentialRequirementPayload = {
  shift_type: string;
  required_credential_type: string;
  minimum_status?: "valid";
};

export function assignShift(payload: AssignShiftPayload) {
  return jsonFetch<AssignShiftResult>("/api/coordinator/shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getCoordinatorWorkerCredentialStatus(workerId: string, shiftType: string) {
  const qs = new URLSearchParams({ shift_type: shiftType || "standard_support" });
  return jsonFetch<WorkerCredentialStatusResponse>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/credential-status?${qs.toString()}`);
}

export function listCoordinatorShifts(params?: {
  start_date?: string;
  end_date?: string;
  worker_id?: string;
  status?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.start_date) qs.set("start_date", params.start_date);
  if (params?.end_date) qs.set("end_date", params.end_date);
  if (params?.worker_id) qs.set("worker_id", params.worker_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const suffix = query ? `?${query}` : "";
  return jsonFetch<CoordinatorShiftRecord[]>(`/api/coordinator/shifts${suffix}`);
}

export function listShiftCredentialRequirements(shiftType?: string) {
  const query = shiftType ? `?shift_type=${encodeURIComponent(shiftType)}` : "";
  return jsonFetch<ShiftCredentialRequirement[]>(`/api/coordinator/shift-credential-requirements${query}`);
}

export function createShiftCredentialRequirement(payload: ShiftCredentialRequirementPayload) {
  return jsonFetch<ShiftCredentialRequirement>("/api/coordinator/shift-credential-requirements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteShiftCredentialRequirement(requirementId: string) {
  return jsonFetch<void>(`/api/coordinator/shift-credential-requirements/${requirementId}`, {
    method: "DELETE",
  });
}

// ── CARECLIQV2-235: Shift Assignment & Scheduling ─────────────────────────────

export type AvailabilityStatus = "available" | "warning" | "unavailable";

export type ConflictItem = {
  type: "shift_overlap" | "blackout" | "max_hours" | "approaching_hours" | "missing_skill";
  severity: "error" | "warning" | "info";
  message: string;
};

export type WorkerConflictsResponse = {
  worker_id: string;
  availability_status: AvailabilityStatus;
  conflicts: ConflictItem[];
  skill_warnings: ConflictItem[];
};

export type AvailableWorker = WorkerStats & {
  availability_status: AvailabilityStatus;
  conflicts: ConflictItem[];
  skill_warnings: ConflictItem[];
};

export type AssignExistingShiftPayload = {
  worker_id: string;
  confirm_conflicts?: boolean;
};

export type AssignExistingShiftResult = {
  shift_id: string;
  shift: CoordinatorShiftRecord;
  conflicts: ConflictItem[];
  skill_warnings: ConflictItem[];
  assigned_at: string;
};

export type BulkShiftPayload = {
  participant_id: string;
  days_of_week: number[];      // 0=Mon … 6=Sun
  start_time: string;          // "HH:MM"
  end_time: string;
  start_date: string;          // "YYYY-MM-DD"
  weeks: number;
  shift_type?: string;
  worker_id?: string;
  confirm_conflicts?: boolean;
};

export type BulkShiftResult = {
  created_count: number;
  skipped_count: number;
  total_requested: number;
  shifts: CoordinatorShiftRecord[];
  skipped: Array<{ date: string; reason: string; conflicts: ConflictItem[] }>;
  conflicts_summary: Array<{ shift_id: string; date: string; conflicts: ConflictItem[] }>;
};

export type WorkerAvailability = {
  user_id: string;
  available_days: number[];
  day_start_time: string;
  day_end_time: string;
  max_hours_per_week: number;
};

export type BlackoutDate = {
  id?: string;
  start_date: string;
  end_date: string;
  reason?: string;
};

export type WorkerAvailabilityResponse = {
  availability: WorkerAvailability;
  blackout_dates: BlackoutDate[];
};

export type WorkerSkill = {
  id?: string;
  skill: string;
  is_certified: boolean;
  certified_at?: string;
  expires_at?: string;
};

export type WorkerNotification = {
  id: string;
  user_id: string;
  type: "shift_assigned" | "shift_unassigned" | "shift_reassigned" | "shift_rescheduled";
  shift_id?: string;
  title: string;
  body: string;
  read_at?: string;
  created_at: string;
};

/** Check a worker's conflicts and availability for a given time window */
export function getWorkerConflicts(
  workerId: string,
  shiftStart: string,
  shiftEnd: string,
  options?: { participantId?: string; excludeShiftId?: string }
) {
  const qs = new URLSearchParams({ shift_start: shiftStart, shift_end: shiftEnd });
  if (options?.participantId) qs.set("participant_id", options.participantId);
  if (options?.excludeShiftId) qs.set("exclude_shift_id", options.excludeShiftId);
  return jsonFetch<WorkerConflictsResponse>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/conflicts?${qs}`
  );
}

/** List all workers with availability indicators for a given shift window */
export function getAvailableWorkers(params: {
  shiftStart: string;
  shiftEnd: string;
  participantId?: string;
}) {
  const qs = new URLSearchParams({ shift_start: params.shiftStart, shift_end: params.shiftEnd });
  if (params.participantId) qs.set("participant_id", params.participantId);
  return jsonFetch<AvailableWorker[]>(`/api/coordinator/available-workers?${qs}`);
}

/** Assign a worker to an EXISTING shift (not create new) */
export function assignExistingShift(shiftId: string, payload: AssignExistingShiftPayload) {
  return jsonFetch<AssignExistingShiftResult>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/assign`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

/** Remove the worker from a shift (return to unassigned) */
export function unassignShift(shiftId: string) {
  return jsonFetch<{ shift_id: string; shift: CoordinatorShiftRecord; warning?: string }>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/unassign`,
    { method: "PUT" }
  );
}

/** Reassign a shift to a different worker */
export function reassignShift(shiftId: string, newWorkerId: string, confirmConflicts = false) {
  return jsonFetch<AssignExistingShiftResult>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/reassign`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_worker_id: newWorkerId, confirm_conflicts: confirmConflicts }),
    }
  );
}

/** Create recurring/bulk shifts */
export function bulkCreateShifts(payload: BulkShiftPayload) {
  return jsonFetch<BulkShiftResult>("/api/coordinator/shifts/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Create a single unassigned shift (no worker yet) */
export function createUnassignedShift(payload: {
  participant_id: string;
  scheduled_start: string;
  scheduled_end?: string;
  shift_type?: string;
}) {
  return jsonFetch<{ shift_id: string; shift: CoordinatorShiftRecord }>(
    "/api/coordinator/shifts/unassigned",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

/** Get in-app notifications for a worker */
export function getWorkerNotifications(workerId: string, unreadOnly = false) {
  const qs = unreadOnly ? "?unread_only=true" : "";
  return jsonFetch<WorkerNotification[]>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/notifications${qs}`
  );
}

/** Mark all notifications as read for a worker */
export function markNotificationsRead(workerId: string) {
  return jsonFetch<{ ok: boolean }>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/notifications/read`,
    { method: "POST" }
  );
}

/** Get worker availability settings and blackout dates */
export function getWorkerAvailability(workerId: string) {
  return jsonFetch<WorkerAvailabilityResponse>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/availability`
  );
}

/** Update worker availability settings */
export function updateWorkerAvailability(
  workerId: string,
  data: Partial<WorkerAvailability> & { blackout_dates?: BlackoutDate[] }
) {
  return jsonFetch<{ ok: boolean }>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/availability`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  );
}

/** Get certified skills for a worker */
export function getWorkerSkills(workerId: string) {
  return jsonFetch<WorkerSkill[]>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/skills`
  );
}

/** Add or update a skill for a worker */
export function addWorkerSkill(workerId: string, skill: WorkerSkill) {
  return jsonFetch<WorkerSkill>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/skills`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    }
  );
}

/** Remove a skill from a worker */
export function removeWorkerSkill(workerId: string, skill: string) {
  return jsonFetch<{ ok: boolean }>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/skills/${encodeURIComponent(skill)}`,
    { method: "DELETE" }
  );
}

/** Get required skills for a participant */
export function getParticipantRequiredSkills(participantId: string) {
  return jsonFetch<Array<{ id: string; skill: string; is_mandatory: boolean }>>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/required-skills`
  );
}

/** Add a required skill to a participant */
export function addParticipantRequiredSkill(participantId: string, skill: string, isMandatory = true) {
  return jsonFetch<{ id: string; skill: string; is_mandatory: boolean }>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/required-skills`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill, is_mandatory: isMandatory }),
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CARECLIQV2-236 — Live Monitoring + Notifications
// ─────────────────────────────────────────────────────────────────────────────

export type LiveShift = {
  id: string;
  worker_id?: string;
  worker_name?: string;
  worker_email?: string;
  participant_id?: string;
  participant_name?: string;
  shift_type?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  status?: string;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  duration_minutes?: number | null;
  session_id?: string | null;
  visit_notes?: string | null;
  coordinator_notes?: string | null;
  special_instructions?: string | null;
  emergency_flagged?: boolean;
  emergency_flagged_at?: string | null;
  emergency_note?: string | null;
  task_counts: { total: number; completed: number };
  alerts: Array<{ id: string; alert_type: string; message: string; severity: string }>;
  live_status: "green" | "yellow" | "red";
  elapsed_minutes: number;
};

export type CoordinatorAlert = {
  id: string;
  alert_type?: string;
  message?: string;
  severity?: string;
  is_read: boolean;
  shift_id?: string | null;
  patient_id?: string | null;
  created_at?: string;
};

export type ShiftMessage = {
  id: string;
  shift_id: string;
  sender_id: string;
  recipient_id: string;
  message: string;
  message_type: "text" | "request_photo" | "task_suggestion" | "flag_issue" | "emergency";
  is_read: boolean;
  created_at?: string;
};

/** Get all in-progress / clocked-in shifts for real-time monitoring */
export function getLiveShifts() {
  return jsonFetch<LiveShift[]>("/api/coordinator/shifts/live");
}

/** Get coordinator notifications / alerts */
export function getCoordinatorNotifications(params?: { limit?: number; unread_only?: boolean }) {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.unread_only) q.set("unread_only", "true");
  return jsonFetch<CoordinatorAlert[]>(`/api/coordinator/notifications?${q}`);
}

/** Mark a single notification as read */
export function markNotificationRead(alertId: string) {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/notifications/${encodeURIComponent(alertId)}/read`, {
    method: "POST",
  });
}

/** Mark all notifications as read */
export function markAllNotificationsRead() {
  return jsonFetch<{ ok: boolean }>("/api/coordinator/notifications/read-all", { method: "POST" });
}

/** Send a message from coordinator to worker for a shift */
export function sendShiftMessage(
  shiftId: string,
  recipientId: string,
  message: string,
  messageType: ShiftMessage["message_type"] = "text"
) {
  return jsonFetch<ShiftMessage>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: recipientId, message, message_type: messageType }),
  });
}

/** Get messages for a shift */
export function getShiftMessages(shiftId: string) {
  return jsonFetch<ShiftMessage[]>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/messages`);
}

/** Flag a shift with an alert */
export function flagShift(shiftId: string, message: string, severity = "warning") {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, severity }),
  });
}

/** Emergency stop a shift */
export function emergencyStopShift(shiftId: string, note?: string) {
  return jsonFetch<{ ok: boolean; shift: Record<string, unknown> }>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/emergency-stop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note ?? "Emergency stop triggered by coordinator" }),
    }
  );
}

export function updateShiftBriefing(shiftId: string, specialInstructions: string | null) {
  return jsonFetch<{ shift_id: string; shift: Record<string, unknown> }>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/briefing`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ special_instructions: specialInstructions }),
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CARECLIQV2-237/240 — NDIS Goals + Task Templates
// ─────────────────────────────────────────────────────────────────────────────

export type NdisGoal = {
  id: string;
  participant_id: string;
  organization_id?: string;
  created_by?: string;
  name: string;
  goal_area: "daily_living" | "community" | "health" | "social" | "employment" | "other";
  description?: string | null;
  target_date?: string | null;
  success_criteria?: string | null;
  related_task_ids?: string[];
  status: "active" | "need_attention" | "completed" | "archived";
  need_attention_set_at?: string | null;
  need_attention_reason?: string | null;
  archived_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type NdisGoalPayload = Omit<NdisGoal, "id" | "organization_id" | "created_by" | "created_at" | "updated_at" | "archived_at" | "completed_at">;

export type TaskTemplate = {
  id: string;
  participant_id?: string;
  organization_id?: string;
  name: string;
  description?: string | null;
  linked_goal_ids?: string[];
  evidence_required: "photo" | "voice" | "text" | "photo+voice" | "optional";
  is_mandatory: boolean;
  estimated_duration_minutes?: number | null;
  is_custom?: boolean;
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
  // Shift-based fields
  primary_shift_type?: string | null;
  additional_shift_types?: string[];
  recurrence_type?: string;
  recurrence_frequency?: string | null;
  recurrence_weekdays?: number[];
  due_window_start?: string | null;
  due_window_end?: string | null;
  category?: string | null;
  priority?: string;
  assigned_worker_id?: string | null;
  linked_goal_id?: string | null;
  status?: string;
};

export type TaskTemplatesResponse = {
  default_tasks: TaskTemplate[];
  custom_tasks: TaskTemplate[];
};

export type GoalProgressResponse = {
  goal: NdisGoal;
  sessions_count: number;
  sessions: Array<{ id: string; session_date: string; status: string; compliance_score?: number; notes?: string }>;
  evidence_count: number;
};

/** List NDIS goals (optionally filtered by participant) */
export function getNdisGoals(params?: { participant_id?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.participant_id) q.set("participant_id", params.participant_id);
  if (params?.status) q.set("status", params.status);
  return jsonFetch<NdisGoal[]>(`/api/coordinator/goals?${q}`);
}

/** Create a new NDIS goal */
export function createNdisGoal(payload: NdisGoalPayload) {
  return jsonFetch<NdisGoal>("/api/coordinator/goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Update an NDIS goal */
export function updateNdisGoal(goalId: string, payload: NdisGoalPayload) {
  return jsonFetch<NdisGoal>(`/api/coordinator/goals/${encodeURIComponent(goalId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Archive a goal */
export function archiveNdisGoal(goalId: string) {
  return jsonFetch<NdisGoal>(`/api/coordinator/goals/${encodeURIComponent(goalId)}/archive`, { method: "PUT" });
}

/** Complete a goal */
export function completeNdisGoal(goalId: string) {
  return jsonFetch<NdisGoal>(`/api/coordinator/goals/${encodeURIComponent(goalId)}/complete`, { method: "PUT" });
}

/** Get progress metrics for a goal */
export function getGoalProgress(goalId: string) {
  return jsonFetch<GoalProgressResponse>(`/api/coordinator/goals/${encodeURIComponent(goalId)}/progress`);
}

/** Get task templates for a participant */
export function getTaskTemplates(participantId: string) {
  return jsonFetch<TaskTemplatesResponse>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/task-templates`
  );
}

/** Create a custom task template */
export function createTaskTemplate(
  participantId: string,
  payload: Omit<TaskTemplate, "id" | "participant_id" | "organization_id" | "is_custom" | "is_active" | "created_at">
) {
  return jsonFetch<TaskTemplate>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/task-templates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

/** Update a task template */
export function updateTaskTemplate(
  templateId: string,
  payload: Omit<TaskTemplate, "id" | "participant_id" | "organization_id" | "is_custom" | "is_active" | "created_at">
) {
  return jsonFetch<TaskTemplate>(`/api/coordinator/task-templates/${encodeURIComponent(templateId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Delete (soft) a task template */
export function deleteTaskTemplate(templateId: string) {
  return jsonFetch<void>(`/api/coordinator/task-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

/** Check if a participant has valid goals and tasks for shift creation */
export type GoalsAndTasksValidation = {
  has_valid: boolean;
  active_goals: number;
  tasks_count: number;
  message?: string;
};

export function checkParticipantGoalsAndTasks(participantId: string) {
  return jsonFetch<GoalsAndTasksValidation>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/goals-and-tasks-validation`
  );
}

/** Get all tasks for a participant (across all goals) */
export type ParticipantTask = {
  id: string;
  goal_id: string;
  goal_name: string;
  participant_id: string;
  name: string;
  description?: string | null;
  frequency?: string;
  status: "pending" | "in_progress" | "completed";
  is_mandatory?: boolean;
  created_at?: string;
};

export function getParticipantTasks(participantId: string) {
  return jsonFetch<ParticipantTask[]>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/tasks`
  );
}

/** Create a task under a goal */
export type ParticipantTaskPayload = Omit<ParticipantTask, "id" | "participant_id" | "created_at">;

export function createParticipantTask(participantId: string, payload: ParticipantTaskPayload) {
  return jsonFetch<ParticipantTask>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/tasks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

/** Update a task */
export function updateParticipantTask(taskId: string, payload: Partial<ParticipantTaskPayload>) {
  return jsonFetch<ParticipantTask>(`/api/coordinator/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Delete a task */
export function deleteParticipantTask(taskId: string) {
  return jsonFetch<void>(`/api/coordinator/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

/** AI Shift Suggestions — CARECLIQV2-XXX */

export type ShiftSuggestion = {
  task_id: string;
  task_name: string;
  confidence: number;  // 0.0-1.0
  reason: string;
  goal_id?: string;
  goal_name?: string;
};

export type GoalFocusArea = {
  goal_name: string;
  priority: "high" | "medium" | "low";
  rationale: string;
};

export type ShiftAnalytics = {
  participant_id: string;
  shift_type: string;
  recommended_tasks: ShiftSuggestion[];
  goal_focus_areas: GoalFocusArea[];
  shift_insights: string;
  similar_shifts_count: number;
  risk_flags: string[];
};

/** Get AI suggestions for a shift before creating it */
export function getShiftSuggestions(params: {
  participant_id: string;
  worker_id: string;
  shift_type: string;
  goal_ids?: string[];
}) {
  return jsonFetch<ShiftAnalytics>("/api/coordinator/shifts/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant_id: params.participant_id,
      worker_id: params.worker_id,
      shift_type: params.shift_type,
      goal_ids: params.goal_ids || [],
    }),
  });
}
