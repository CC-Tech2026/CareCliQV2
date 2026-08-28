import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";
import type { DashboardSession } from "@/services/dashboardService";
import type { Credential } from "@/services/credentialsService";
import type { ShiftHistoryRow, PerformanceDashboard } from "@/services/workerPerformanceService";

export type TeamMember = {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  joined_at?: string;
  last_login?: string;
  employee_id?: string | null;
  phone?: string | null;
  preferred_contact_method?: string | null;
  onboarding_completed?: boolean | null;
  profile_summary?: string | null;
  profile_experience_years?: string | null;
  training_overdue?: boolean;
  induction_overdue?: boolean;
  coordinator_id?: string | null;
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
    | "refused_activity_no_deescalation"
    | "incident_type_pattern_90d";
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

export type PipelinePerson = {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  flag?: "new" | "ok" | "warn" | "complete";
  // Applicant fields
  stage?: string;
  stage_entered_at?: string;
  // Hire fields
  status?: string;
  employer_signed_at?: string | null;
  // Worker fields
  joined_at?: string | null;
  is_active?: boolean;
};

export type WorkerPipelineOverview = {
  kpis: {
    in_pipeline: number;
    credentials_overdue: number;
    starting_this_week: number;
    auto_deactivated_month: number;
  };
  columns: {
    interview: PipelinePerson[];
    offer_letter: PipelinePerson[];
    credentials: PipelinePerson[];
    training: PipelinePerson[];
    active: PipelinePerson[];
  };
  not_proceeding: {
    rejected_applicants: PipelinePerson[];
    expired_offers: PipelinePerson[];
    auto_deactivated_workers: PipelinePerson[];
  };
};

export function getWorkerPipelineOverview() {
  return jsonFetch<WorkerPipelineOverview>("/api/coordinator/workers/pipeline");
}

export function getCoordinatorWorkerStats() {
  return jsonFetch<WorkerStats[]>("/api/coordinator/worker-stats");
}

export function assignWorkerCoordinator(workerId: string, coordinatorId: string | null) {
  return jsonFetch<{ worker_id: string; coordinator_id: string | null }>(
    `/api/coordinator/team/${encodeURIComponent(workerId)}/assign-coordinator`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinator_id: coordinatorId }),
    },
  );
}

export function getUnassignedTeam() {
  return jsonFetch<Array<{ id: string; full_name: string; email: string }>>("/api/coordinator/team/unassigned");
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

/** All credentials across the org's workers (coordinator-only). Filter client-side by user_id. */
export function getTeamCredentials() {
  return jsonFetch<Credential[]>("/api/credentials/team");
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

/** Sends the worker a real Supabase recovery email so they set their own new
 *  password — never sets or reveals a password directly. */
export function sendWorkerPasswordReset(workerId: string) {
  return jsonFetch<{ worker_id: string; email: string; message: string }>(
    `/api/coordinator/workers/${workerId}/send-password-reset`,
    { method: "POST" },
  );
}

/** MD-only - queues a pending account-removal request for a staff member (see coordinator.py). */
export function deleteWorkerAccount(workerId: string) {
  return jsonFetch<{ id: string; status: string }>(
    `/api/coordinator/workers/${workerId}/delete-account`,
    { method: "POST" },
  );
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

export type BillingPeriod = {
  id: string;
  organization_id: string;
  participant_id: string;
  period_start: string;
  period_end: string;
  locked_plan_management_type: "NDIA-managed" | "plan-managed" | "self-managed";
  status: "open" | "closed";
  locked_at: string;
};

export type BillingPeriodCurrent = {
  current_plan_management_type: BillingPeriod["locked_plan_management_type"] | null;
  open_period: BillingPeriod | null;
  type_differs_from_lock: boolean;
  message: string | null;
};

export function getParticipantBillingPeriods(participantId: string) {
  return jsonFetch<{ items: BillingPeriod[] }>(
    `/api/participants/${encodeURIComponent(participantId)}/billing-periods`,
  );
}

export function getParticipantCurrentBillingPeriod(participantId: string) {
  return jsonFetch<BillingPeriodCurrent>(
    `/api/participants/${encodeURIComponent(participantId)}/billing-periods/current`,
  );
}

export function planManagementTypeLabel(
  value: string | null | undefined,
  translate: (key: string) => string,
): string {
  if (!value) return translate("patients.planManagementType.notSet");
  if (value === "NDIA-managed") return translate("patients.planManagementType.ndiaManaged");
  if (value === "plan-managed") return translate("patients.planManagementType.planManaged");
  if (value === "self-managed") return translate("patients.planManagementType.selfManaged");
  return value;
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
      status:
        g.status === "completed"
          ? "achieved"
          : g.status === "archived"
            ? "blocked"
            : (g.status as GoalStatus) ?? (g.is_achieved ? "achieved" : "progressing"),
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
  cannot_attend_reason?: string | null;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
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

export type ShiftDetail = CoordinatorShiftRecord & {
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  confirmation_status?: string;
  visual_state?: string;
  coordinator_notes?: string | null;
  visit_notes?: string | null;
  session_notes?: string | null;
  session_status?: string | null;
  entry_instructions?: string | null;
  access_instructions?: string | null;
  risks_acknowledged?: boolean;
  risks_acknowledged_at?: string | null;
  risks_acknowledged_by?: string | null;
  health_alerts?: unknown[];
  has_risk_alerts?: boolean;
  tasks?: Array<{ id?: string; label?: string; title?: string; completed?: boolean; mandatory?: boolean }>;
  conversation_id?: string;
};

/** Full single-shift drill-down for the Master Schedule page (org-wide, read-only). */
export function getShiftDetail(shiftId: string) {
  return jsonFetch<ShiftDetail>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/detail`);
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
  type: "shift_overlap" | "blackout" | "max_hours" | "approaching_hours" | "missing_skill" | "unavailable_slot";
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
  preferred_availability: boolean;
  /** Phase 2 (ranking) — null when no participant was given to score fit against. */
  match_score: number | null;
  match_reasons: string[];
  /** Phase 4 — a coordinator recorded would_repeat=false for this exact pair.
   * Never hidden, sorted last, still selectable — see WorkerMatchBadge. */
  excluded?: boolean;
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

/** Send a ranked shift offer — the worker must accept before it's assigned.
 * `candidateQueue` is the rest of the ranked suggestion list, tried in order
 * on decline or timeout. */
export function sendShiftOffer(shiftId: string, payload: { workerId: string; candidateQueue: string[] }) {
  return jsonFetch<{ shift_id: string; offer: Record<string, unknown> }>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/offer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker_id: payload.workerId, candidate_queue: payload.candidateQueue }),
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

export type OverdueUnassignedShift = {
  id: string;
  participant_id: string;
  participant_name?: string | null;
  scheduled_start: string;
  scheduled_end?: string | null;
  shift_type?: string | null;
  worker_id?: string | null;
  status?: string | null;
};

/** Unassigned shifts whose start time has already passed - independent of
 * whatever week/month range the roster board happens to be showing, since
 * that view is range-scoped and these otherwise silently fall out of it. */
export function getOverdueUnassignedShifts() {
  return jsonFetch<OverdueUnassignedShift[]>("/api/coordinator/shifts/overdue-unassigned");
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

/** Completed-shift history for a worker (which participants, when, how it went) -
 *  same shape as the worker's own self-service shift history, viewed by a
 *  coordinator or managing director instead. */
export function getWorkerShiftHistory(workerId: string) {
  return jsonFetch<{ shifts: ShiftHistoryRow[]; participants: Array<{ id: string; first_name: string }> }>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/shift-history`
  );
}

/** 30-day performance trend, strengths/focus areas and badges for a worker -
 *  the detailed breakdown behind a single compliance percentage. */
export function getWorkerPerformanceDashboard(workerId: string) {
  return jsonFetch<PerformanceDashboard>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/performance-dashboard`
  );
}

export type WorkerAssignment = {
  id: string;
  patient_id: string;
  user_id: string;
  allocated_role: string;
  is_active: boolean;
  assigned_at?: string;
  participant?: { id: string; full_name: string; ndis_number?: string | null } | null;
};

/** Which participants a specific worker is currently assigned to. */
export function getWorkerAssignments(workerId: string) {
  return jsonFetch<WorkerAssignment[]>(`/api/assignments?worker_id=${encodeURIComponent(workerId)}`);
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

// ── Worker-Participant Matching Enhancement, Phase 1 — tag taxonomy ─────────

export type Tag = { id: string; label: string; is_active: boolean };
/** matching_role (Phase 2): which fit-score component this category feeds.
 * null means descriptive only — doesn't affect ranking. */
export type TagMatchingRole = "interests" | "lived_experience" | null;
export type TagCategory = { id: string; name: string; is_active: boolean; matching_role: TagMatchingRole; tags: Tag[] };
export type AssignedTag = {
  id: string;
  tag_id: string;
  label?: string;
  category_id?: string;
  added_by_user_id?: string | null;
  added_at: string;
  notes?: string | null;
  visible_to_coordinator_only?: boolean;
};

/** Full tag taxonomy (categories + nested tags) for the org. */
export function getTagCatalog() {
  return jsonFetch<TagCategory[]>("/api/coordinator/tags");
}

export function createTagCategory(name: string, matchingRole?: TagMatchingRole) {
  return jsonFetch<TagCategory>("/api/coordinator/tag-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, matching_role: matchingRole ?? null }),
  });
}

export function setTagCategoryMatchingRole(categoryId: string, matchingRole: TagMatchingRole) {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/tag-categories/${encodeURIComponent(categoryId)}/matching-role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matching_role: matchingRole }),
  });
}

export function setTagCategoryActive(categoryId: string, isActive: boolean) {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/tag-categories/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function createTag(categoryId: string, label: string) {
  return jsonFetch<Tag>("/api/coordinator/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId, label }),
  });
}

export function setTagActive(tagId: string, isActive: boolean) {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/tags/${encodeURIComponent(tagId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function getParticipantTags(participantId: string) {
  return jsonFetch<AssignedTag[]>(`/api/coordinator/participants/${encodeURIComponent(participantId)}/tags`);
}

export function addParticipantTag(participantId: string, tagId: string, notes?: string) {
  return jsonFetch<AssignedTag>(`/api/coordinator/participants/${encodeURIComponent(participantId)}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_id: tagId, notes: notes ?? null }),
  });
}

export function removeParticipantTag(participantId: string, tagId: string) {
  return jsonFetch<void>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE" }
  );
}

/** A worker's tags as seen by a coordinator/MD - includes visible_to_coordinator_only entries. */
export function getWorkerTags(workerId: string) {
  return jsonFetch<AssignedTag[]>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/tags`);
}

export function addWorkerTag(workerId: string, tagId: string, notes?: string, visibleToCoordinatorOnly = false) {
  return jsonFetch<AssignedTag>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_id: tagId, notes: notes ?? null, visible_to_coordinator_only: visibleToCoordinatorOnly }),
  });
}

export function removeWorkerTag(workerId: string, tagId: string) {
  return jsonFetch<void>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
}

// ── Worker-Participant Matching Enhancement, Phase 3 — shift outcome feedback

export type ShiftMatchFeedback = {
  id: string;
  shift_id: string;
  participant_id: string;
  worker_id: string;
  recorded_by_user_id?: string | null;
  recorded_at?: string | null;
  participant_response?: string | null;
  outcome_rating?: number | null;
  would_repeat?: boolean | null;
  worker_feedback?: string | null;
  worker_feedback_recorded_at?: string | null;
};

export function getShiftMatchFeedback(shiftId: string) {
  return jsonFetch<ShiftMatchFeedback | null>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/match-feedback`);
}

export function postShiftMatchFeedback(
  shiftId: string,
  payload: { participant_response?: string | null; outcome_rating?: number | null; would_repeat?: boolean | null }
) {
  return jsonFetch<ShiftMatchFeedback>(`/api/coordinator/shifts/${encodeURIComponent(shiftId)}/match-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  worker_phone?: string | null;
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
  engagement?: {
    session_id?: string | null;
    duration_secs?: number;
    current_gap_secs?: number;
    engagement_status?: "GREEN" | "AMBER" | "RED";
    checkins_completed?: number;
    checkins_required?: number;
    next_checkin_due_secs?: number | null;
    break_logged?: boolean;
    on_break?: boolean;
    break_started_at?: string | null;
    break_elapsed_secs?: number;
    break_compliant?: boolean;
    engagement_score?: number | null;
    last_activity_type?: string | null;
    last_activity_at?: string | null;
    is_long_shift?: boolean;
  };
  checklist: Array<{
    task_id: string;
    label: string;
    completed: boolean;
    documented: boolean;
    mandatory: boolean;
    goal_title?: string | null;
  }>;
  medications: Array<{
    medication_id: string;
    name: string;
    scheduled_time: string;
    due_status: string;
    outcome?: string | null;
  }>;
  workflow_stage: "not_clocked_in" | "clocked_in" | "documenting" | "wrapping_up";
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
  support_category?: string | null;
  description?: string | null;
  target_date?: string | null;
  success_criteria?: string | null;
  why_it_matters?: string | null;
  worker_focus?: string[];
  priority?: number;
  plan_id?: string | null;
  status: "active" | "completed" | "archived";
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
  evidence_required: "none" | "photo" | "notes" | "photo_and_notes" | "voice" | "photo_and_voice";
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
  system_tasks: TaskTemplate[];
  custom_tasks: TaskTemplate[];
};

export type GoalProgressResponse = {
  goal: NdisGoal;
  sessions_count: number;
  sessions: Array<{ id: string; session_date: string; status: string; compliance_score?: number; notes?: string }>;
  evidence_count: number;
};

/** List goals needing coordinator review for missing support_category */
export function getGoalsReviewQueue() {
  return jsonFetch<Array<{
    id: string;
    participant_id: string;
    participant_name?: string | null;
    name: string;
    goal_area?: string | null;
    plan_id?: string | null;
    status: string;
    created_at?: string | null;
  }>>("/api/coordinator/goals/review-queue");
}

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
  goal_id?: string | null;
  goal_name?: string | null;
  participant_id: string;
  name: string;
  description?: string | null;
  frequency?: string;
  status: "pending" | "in_progress" | "completed";
  is_mandatory?: boolean;
  support_category?: string | null;
  shift_type?: string | null;  // morning, afternoon, night, anytime
  category?: string | null;  // personal_care, medication, etc.
  priority?: string | null;  // low, medium, high
  // NDIS professional fields
  evidence_required?: string | null;  // none, photo, notes, photo_and_notes
  is_recurring?: boolean;
  frequency_pattern?: string | null;  // every_morning_shift, every_afternoon_shift, etc.
  frequency_metadata?: Record<string, any> | null;  // days_of_week, custom schedule, etc.
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

// ── Shift verification gate (Fix #6 — budget deduction review) ─────────────

export type ShiftVerificationEvidenceCheck = {
  compliance_score: number | null;
  low_compliance: boolean;
  tasks_completed: number | null;
  tasks_total: number | null;
  mandatory_total: number | null;
  mandatory_with_evidence: number | null;
  mandatory_without_evidence: number | null;
  flagged_tasks: Array<Record<string, unknown>>;
  flagged: boolean;
};

export type ShiftVerificationHoursCheck = {
  status: "ok" | "flagged" | "unknown";
  scheduled_minutes: number | null;
  actual_minutes: number | null;
  variance_pct: number | null;
  flagged: boolean;
  reason?: string | null;
};

export type ShiftVerificationForceEndedCheck = {
  force_ended: boolean;
  flagged: boolean;
  reason?: string | null;
};

export type ShiftVerificationChecks = {
  evidence: ShiftVerificationEvidenceCheck;
  hours_sanity: ShiftVerificationHoursCheck;
  force_ended: ShiftVerificationForceEndedCheck;
  any_flagged: boolean;
  computed_at: string;
};

export type ShiftVerificationQueueItem = {
  shift_id: string;
  participant_id?: string | null;
  participant_name?: string | null;
  worker_id?: string | null;
  worker_name?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  duration_minutes?: number | null;
  checks: ShiftVerificationChecks;
};

export type ShiftPriceItemOption = {
  item_code: string;
  name?: string | null;
  description?: string | null;
  unit?: string | null;
  support_purpose?: string | null;
  support_category?: string | null;
  day_type?: string | null;
  time_type?: string | null;
  support_intensity?: string | null;
  price_national?: number | null;
};

export type VerifyShiftResult = {
  verification: Record<string, unknown> | null;
  checks: ShiftVerificationChecks;
  billed_amount: number;
  hourly_rate_applied: number;
  support_category: string;
  new_used_amount: number;
};

export function getShiftVerificationQueue() {
  return jsonFetch<ShiftVerificationQueueItem[]>("/api/coordinator/shifts/verification-queue");
}

export function getShiftPriceItemOptions(shiftId: string) {
  return jsonFetch<ShiftPriceItemOption[]>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/price-items`
  );
}

export function confirmShiftVerification(shiftId: string, priceItemCode: string) {
  return jsonFetch<VerifyShiftResult>(
    `/api/coordinator/shifts/${encodeURIComponent(shiftId)}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price_item_code: priceItemCode }),
    }
  );
}

// ── Plan Meetings ─────────────────────────────────────────────────────────────

export type PlanMeetingType =
  | "plan_review"
  | "initial_setup"
  | "check_in"
  | "incident_followup"
  | "goal_review";

export type PlanMeetingSuggestionsStatus = "pending_review" | "reviewed" | "applied";

export type SuggestedGoal = {
  name: string;
  description: string;
  goal_area: string;
  support_category: string;
  success_criteria: string;
  reasoning: string;
};

export type SuggestedTask = {
  template_id: string | null;
  template_name: string;
  link_to_goal_name: string | null;
  shift_type: string;
  requirement_level: "mandatory" | "optional";
  customised_notes: string;
  reasoning: string;
};

export type PlanMeetingSuggestions = {
  suggested_goals: SuggestedGoal[];
  suggested_tasks: SuggestedTask[];
  flags: string[];
};

export type PlanMeeting = {
  id: string;
  participant_id: string;
  coordinator_id: string;
  meeting_date: string;
  meeting_type: PlanMeetingType;
  attendees: string[];
  conversation_notes?: string | null;
  participant_priorities?: string | null;
  coordinator_observations?: string | null;
  agreed_outcomes?: string | null;
  ai_suggestions_raw?: PlanMeetingSuggestions | null;
  suggestions_accepted?: Record<string, unknown> | null;
  suggestions_status: PlanMeetingSuggestionsStatus;
  ai_generated_at?: string | null;
  created_at: string;
  updated_at?: string;
  /** "legacy" = text-notes meeting, "session" = recorded two-stage-pipeline meeting */
  source?: "legacy" | "session";
};

/** Full detail for a single meeting — includes transcript + extracted goals/tasks for recorded (session-based) meetings. */
export type PlanMeetingDetail = PlanMeeting & {
  raw_transcript?: Array<{ segment_id?: string; speaker_label?: string; text: string; start?: string }>;
  clean_transcript?: Array<{ segment_id?: string; speaker_name?: string; text: string; start?: string }>;
  extracted_goals?: ExtractedGoal[];
  extracted_tasks?: ExtractedTask[];
  consent_given_by?: ConsentGivenBy | null;
  consent_method?: ConsentMethod | null;
  consent_confirmed_at?: string | null;
};

export type RecordMeetingPayload = {
  participant_id: string;
  meeting_date: string;
  meeting_type: PlanMeetingType;
  attendees: string[];
  conversation_notes?: string;
  participant_priorities?: string;
  coordinator_observations?: string;
  agreed_outcomes?: string;
};

export function recordPlanMeeting(payload: RecordMeetingPayload) {
  return jsonFetch<{ meeting: PlanMeeting }>("/api/coordinator/plan-meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listPlanMeetings(participantId: string, filters?: { dateFrom?: string; dateTo?: string }) {
  const params = new URLSearchParams();
  if (filters?.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters?.dateTo) params.set("date_to", filters.dateTo);
  const qs = params.toString();
  return jsonFetch<{ meetings: PlanMeeting[] }>(
    `/api/coordinator/participants/${encodeURIComponent(participantId)}/plan-meetings${qs ? `?${qs}` : ""}`,
  );
}

export function getPlanMeeting(meetingId: string) {
  return jsonFetch<{ meeting: PlanMeetingDetail }>(
    `/api/coordinator/plan-meetings/${encodeURIComponent(meetingId)}`,
  );
}

export function triggerPlanMeetingAiReview(meetingId: string) {
  return jsonFetch<{ meeting_id: string; suggestions: PlanMeetingSuggestions }>(
    `/api/coordinator/plan-meetings/${encodeURIComponent(meetingId)}/ai-review`,
    { method: "POST" },
  );
}

/** Goal payload accepted by the apply endpoint when applying two-stage-pipeline drafts (session-based). */
export type ExtractedGoalPayload = {
  goal_text: string;
  support_category?: string | null;
};

/** Task payload accepted by the apply endpoint when applying two-stage-pipeline drafts (session-based). */
export type ExtractedTaskPayload = {
  task_text: string;
  requirement_level: "mandatory" | "optional";
  linked_goal_text?: string | null;
};

/**
 * `meetingId` may be a legacy `participant_plan_meetings` id or a
 * `plan_meeting_sessions` id — the backend resolves either transparently.
 */
export function applyPlanMeetingSuggestions(
  meetingId: string,
  acceptedGoals: (SuggestedGoal | ExtractedGoalPayload)[],
  acceptedTasks: (SuggestedTask | ExtractedTaskPayload)[],
) {
  return jsonFetch<{ goals_created: number; tasks_created: number; meeting_id: string }>(
    `/api/coordinator/plan-meetings/${encodeURIComponent(meetingId)}/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted_goals: acceptedGoals, accepted_tasks: acceptedTasks }),
    },
  );
}

export function getPendingPlanMeetings() {
  return jsonFetch<{ pending: PlanMeeting[]; count: number }>(
    "/api/coordinator/plan-meetings/pending",
  );
}

export function transcribePlanMeetingAudio(audioBlob: Blob): Promise<{ transcript: string }> {
  const form = new FormData();
  form.append("audio_file", audioBlob, "recording.webm");
  return jsonFetch<{ transcript: string }>("/api/coordinator/plan-meetings/transcribe", {
    method: "POST",
    body: form,
  });
}

// ── Two-Stage Pipeline Functions ───────────────────────────────────────────────

export type MeetingSessionResponse = {
  session_id: string;
  created_at: string;
};

export type ConsentGivenBy = "participant" | "nominee" | "guardian";
export type ConsentMethod = "verbal" | "written";

export function createMeetingSession(
  meetingType: PlanMeetingType = "check_in",
  meetingDate: string | undefined,
  conversationContext: Record<string, any> | undefined,
  participantId: string | undefined,
  consentGivenBy: ConsentGivenBy,
  consentMethod: ConsentMethod,
): Promise<MeetingSessionResponse> {
  return jsonFetch<MeetingSessionResponse>("/api/coordinator/plan-meetings/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meeting_type: meetingType,
      meeting_date: meetingDate,
      conversation_context: conversationContext,
      participant_id: participantId, // Optional: if participant already selected in UI
      consent_given_by: consentGivenBy,
      consent_method: consentMethod,
    }),
  });
}

export type ResolvedSpeaker = {
  speaker_label: string;
  resolved_name: string;
  role: "coordinator" | "participant" | "other";
  confidence: "confirmed" | "likely" | "uncertain";
};

export type Stage1ResolutionResult = {
  session_id: string;
  raw_transcript: Array<{ segment_id?: string; speaker_label?: string; text: string; start?: string }>;
  clean_transcript: Array<{ segment_id?: string; speaker_name?: string; text: string; start?: string }>;
  resolved_names: Record<string, { name: string; confidence: string }>;
  segment_ids: Array<{ segment_id: string; speaker_name: string; text: string }>;
  participant_id: string | null;
  flags: Array<{ flag_type?: string; severity?: string; description: string }>;
  stage_1_status: string;
};

export function transcribeAndResolveNames(
  sessionId: string,
  audioBlob: Blob,
  coordinatorName?: string,
  participantName?: string,
  others?: string[],
): Promise<Stage1ResolutionResult> {
  const form = new FormData();
  form.append("audio_file", audioBlob, "recording.webm");
  if (coordinatorName) form.append("coordinator_name", coordinatorName);
  if (participantName) form.append("participant_name", participantName);
  if (others && others.length > 0) form.append("others", JSON.stringify(others));

  return jsonFetch<Stage1ResolutionResult>(
    `/api/coordinator/plan-meetings/${encodeURIComponent(sessionId)}/transcribe-and-resolve`,
    {
      method: "POST",
      body: form,
    },
  );
}

export type ExtractedGoal = {
  goal_text: string;
  support_category: string;
  source_segment_ids: string[];
  confidence: number;
};

export type ExtractedTask = {
  task_text: string;
  linked_goal_index?: number;
  requirement_level: "mandatory" | "optional";
  source_segment_ids: string[];
  confidence: number;
};

export type Stage2ExtractionResult = {
  session_id: string;
  goals: ExtractedGoal[];
  tasks: ExtractedTask[];
  attention_flags: Array<{ flag_type: string; severity: string; description: string }>;
  extraction_metadata: { completed_at: string };
  stage_2_status: string;
};

export function extractGoalsAndTasks(sessionId: string): Promise<Stage2ExtractionResult> {
  return jsonFetch<Stage2ExtractionResult>(
    `/api/coordinator/plan-meetings/${encodeURIComponent(sessionId)}/extract-goals-tasks`,
    { method: "POST" },
  );
}

// ── Compliance centre ─────────────────────────────────────────────────────────

export type ComplianceUrgentAction = {
  severity: "critical" | "high";
  type: "incident" | "credential" | "agreement";
  label: string;
  detail: string;
  link: string;
};

export type ComplianceStaffSnapshotRow = {
  user_id: string;
  full_name: string;
  expiry_date: string | null;
  avg_score: number | null;
  rp_flag: boolean;
};

export type ComplianceParticipantSnapshotRow = {
  participant_id: string;
  full_name: string;
  agreement_unsigned: boolean;
  has_flag: boolean;
  note_quality: number | null;
};

export type ComplianceCentreOverview = {
  kpis: {
    overall_score: number;
    compliant_sessions: number;
    at_risk_sessions: number;
    open_incidents: number;
  };
  urgent_actions: ComplianceUrgentAction[];
  bands: { compliant: number; at_risk: number; non_compliant: number };
  common_issues: Array<{ rule_code: string; label: string; count: number; pct: number }>;
  staff_snapshot: ComplianceStaffSnapshotRow[];
  participant_snapshot: ComplianceParticipantSnapshotRow[];
};

export function getComplianceCentreOverview() {
  return jsonFetch<ComplianceCentreOverview>("/api/compliance/centre/overview");
}

export type ComplianceCredentialCell = { status: string; expiry_date: string | null };

export type ComplianceStaffRow = {
  user_id: string;
  full_name: string;
  credentials: Record<string, ComplianceCredentialCell>;
  avg_score: number | null;
  rp_flag: boolean;
  groups: string[];
};

export type ComplianceCentreStaff = {
  kpis: {
    total_workers: number;
    fully_compliant: number;
    expiring_credentials: number;
    action_required: number;
  };
  fixed_credential_types: string[];
  workers: ComplianceStaffRow[];
  generated_at: string;
};

export function getComplianceCentreStaff() {
  return jsonFetch<ComplianceCentreStaff>("/api/compliance/centre/staff");
}

export type ComplianceParticipantRow = {
  participant_id: string;
  full_name: string;
  ndis_number: string | null;
  plan_status: string;
  agreement_status: "unsigned" | "signed" | "expired";
  agreement_signed_at: string | null;
  sessions_count: number;
  avg_note_quality: number | null;
  flags: string[];
  worker_name: string;
  groups: string[];
};

export type ComplianceCentreParticipants = {
  kpis: {
    total_participants: number;
    agreements_signed: number;
    avg_note_quality: number;
    open_flags: number;
  };
  participants: ComplianceParticipantRow[];
  date_from: string;
  date_to: string;
};

export function getComplianceCentreParticipants(dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams();
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const qs = params.toString();
  return jsonFetch<ComplianceCentreParticipants>(`/api/compliance/centre/participants${qs ? `?${qs}` : ""}`);
}

export type ComplianceIncidentRow = {
  id: string;
  incident_date: string;
  worker_name: string;
  participant_name: string;
  incident_type: string;
  description: string;
  status: string;
  ndis_reportable: boolean;
  notification_due_at?: string | null;
  overdue?: boolean;
};

export type ComplianceCentreIncidents = {
  kpis: { open_incidents: number; rp_flags: number; resolved_this_month: number };
  incidents: ComplianceIncidentRow[];
};

export function getComplianceCentreIncidents() {
  return jsonFetch<ComplianceCentreIncidents>("/api/compliance/centre/incidents");
}

// ─────────────────────────────────────────────────────────────────────────────
// Training & Induction (coordinator surface)
// ─────────────────────────────────────────────────────────────────────────────

export type TrainingResource = {
  id: string;
  resource_type: "video" | "pdf" | "external_link";
  title: string;
  storage_path?: string | null;
  external_url?: string | null;
};

export type TrainingModule = {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  linked_credential_type?: string | null;
  requires_certification: boolean;
  auto_assign_on_hire: boolean;
  is_active: boolean;
  resources?: TrainingResource[];
};

export type TrainingRecommendation = {
  id: string;
  worker_id: string;
  coordinator_id: string;
  training_module_id: string;
  title: string;
  recommended_at: string;
  due_at?: string | null;
  dismissed_at?: string | null;
};

export type TrainingCompletion = {
  id: string;
  worker_id: string;
  module_id: string;
  completed_at: string;
  note?: string | null;
  status: "awaiting_confirmation" | "confirmed" | "rejected";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  training_modules?: { title: string };
  users?: { full_name: string };
};


export function getTrainingModules() {
  return jsonFetch<TrainingModule[]>("/api/coordinator/training-modules");
}

export function createTrainingModule(payload: {
  title: string;
  description?: string;
  linked_credential_type?: string;
  requires_certification?: boolean;
  auto_assign_on_hire?: boolean;
}) {
  return jsonFetch<TrainingModule>("/api/coordinator/training-modules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateTrainingModule(
  moduleId: string,
  payload: Partial<{
    title: string;
    description: string | null;
    linked_credential_type: string | null;
    requires_certification: boolean;
    auto_assign_on_hire: boolean;
    is_active: boolean;
  }>,
) {
  return jsonFetch<TrainingModule>(`/api/coordinator/training-modules/${moduleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getPendingTrainingCompletions() {
  return jsonFetch<TrainingCompletion[]>("/api/coordinator/training-completions/pending");
}

export function reviewTrainingCompletion(completionId: string, approved: boolean, rejectionReason?: string) {
  return jsonFetch<TrainingCompletion>(`/api/coordinator/training-completions/${encodeURIComponent(completionId)}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, rejection_reason: rejectionReason }),
  });
}

export function getWorkerTrainingAssignments(workerId: string) {
  return jsonFetch<{ recommendations: TrainingRecommendation[]; history: TrainingCompletion[] }>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/training-assignments`
  );
}

export function assignTraining(workerId: string, trainingModuleId: string, title: string, relatedIncidentId?: string) {
  return jsonFetch<TrainingRecommendation>(`/api/coordinator/workers/${encodeURIComponent(workerId)}/training-assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ training_module_id: trainingModuleId, title, related_incident_id: relatedIncidentId }),
  });
}

export function dismissTrainingAssignment(recommendationId: string) {
  return jsonFetch<{ ok: boolean }>(`/api/coordinator/training-assignments/${encodeURIComponent(recommendationId)}`, {
    method: "DELETE",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker onboarding documents (offer letter, service agreement, other)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkerOnboardingDocumentType = "offer_letter" | "service_agreement" | "other";

export type WorkerOnboardingDocument = {
  id: string;
  worker_id: string;
  organization_id: string;
  document_type: WorkerOnboardingDocumentType;
  title: string;
  notes?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  uploaded_by?: string | null;
  created_at: string;
  updated_at: string;
};

export function getWorkerOnboardingDocuments(workerId: string) {
  return jsonFetch<WorkerOnboardingDocument[]>(
    `/api/coordinator/workers/${encodeURIComponent(workerId)}/onboarding-documents`
  );
}

export async function uploadWorkerOnboardingDocument(
  workerId: string,
  payload: { document_type: WorkerOnboardingDocumentType; title: string; notes?: string; file?: File }
): Promise<WorkerOnboardingDocument> {
  const formData = new FormData();
  formData.append("document_type", payload.document_type);
  formData.append("title", payload.title);
  if (payload.notes) formData.append("notes", payload.notes);
  if (payload.file) formData.append("file", payload.file);
  const response = await apiFetch(`/api/coordinator/workers/${encodeURIComponent(workerId)}/onboarding-documents`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Could not save onboarding document.");
  }
  return response.json();
}

export function deleteWorkerOnboardingDocument(documentId: string) {
  return jsonFetch(`/api/coordinator/onboarding-documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}
