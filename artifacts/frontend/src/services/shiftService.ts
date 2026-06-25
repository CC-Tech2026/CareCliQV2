import { jsonFetch } from "@/services/http";

export type ShiftVisualState = "scheduled" | "clocked_in" | "session_active" | "completed";

export type ShiftHealthAlert = {
  type?: ParticipantRiskType | string;
  title: string;
  severity: "critical" | "important" | string;
  description?: string;
  instructions?: string;
  detail?: string;
};

export type ParticipantRiskType =
  | "allergy"
  | "legal_blindness"
  | "falls_risk"
  | "seizures"
  | "bsp"
  | "swallowing_risk"
  | "other";

export type ParticipantRiskAlert = ShiftHealthAlert & {
  type: ParticipantRiskType;
  description: string;
  instructions: string;
};

export type ParticipantRisksResponse = {
  shift_id: string;
  participant_id?: string;
  alerts: ParticipantRiskAlert[];
  risks_acknowledged: boolean;
  risks_acknowledged_at?: string | null;
  risks_acknowledged_by?: string | null;
  risks_acknowledged_by_name?: string | null;
};

export type ShiftTask = {
  task_id: string;
  type: "default" | "custom" | string;
  label: string;
  description?: string;
  completed: boolean;
  completed_at?: string | null;
  checked_at?: string | null;
  evidence_status?: "with_evidence" | "without_evidence" | null;
  evidence_added_at?: string | null;
  evidence_ids?: string[];
  has_photo?: boolean;
  has_voice?: boolean;
  has_text_notes?: boolean;
  note?: string;
  context_note?: string;
  order: number;
  mandatory?: boolean;
  goal_id?: string | null;
  goal_title?: string | null;
  outcome_tip?: string | null;
  photo_evidence?: string | null;
  voice_evidence?: string | null;
  photo_thumbnails?: string[];
  voice_duration_seconds?: number | null;
  marked_na?: boolean;
  na_reason?: string | null;
  na_marked_at?: string | null;
};

export type ShiftSupportInstruction = {
  category: string;
  body: string;
  critical?: string | boolean;
  image_url?: string;
};

export type ShiftCompletionSummary = {
  tasks_completed: number;
  tasks_total: number;
  mandatory_completed: number;
  mandatory_total: number;
  session_id?: string | null;
  notes_submitted?: boolean;
  validation?: import("@/lib/shift-validation").ShiftValidationResult & { force_ended?: boolean };
};

export type ParticipantProfile = {
  preferred_name?: string;
  date_of_birth?: string;
  ndis_number?: string;
  phone?: string;
  email?: string;
  emergency_contact?: string | {
    name?: string | null;
    phone?: string | null;
    relationship?: string | null;
    display?: string;
  };
  case_manager?: {
    name?: string | null;
    phone?: string | null;
  };
  primary_disability?: string;
  medications?: string;
};

export type ParticipantPreferences = {
  communication_style?: string;
  likes_dislikes?: string;
  routines?: string;
  sensory_preferences?: string;
  cultural_preferences?: string;
  behaviour_support?: string;
  health_flags?: string;
};

export type ParticipantAllergy = {
  id?: string;
  allergen: string;
  severity: "mild" | "moderate" | "severe" | "anaphylactic" | string;
  notes?: string | null;
};

export type ParticipantBehaviouralNote = {
  title: string;
  body: string;
};

export type ParticipantContext = {
  medical?: {
    allergies?: ParticipantAllergy[];
    conditions?: string | null;
    medications?: string | null;
    alerts?: string | null;
  };
  behavioural_notes?: ParticipantBehaviouralNote[];
  preferred_activities?: string[];
  previous_visit_notes?: string | null;
  previous_visit_notes_updated_at?: string | null;
  communication_guidance?: string | null;
};

/** Legacy string labels or structured goals from NDIS plan (CARECLIQV2-90). */
export type ActiveGoal =
  | string
  | {
      id?: string;
      title?: string;
      description?: string;
      category?: string;
      priority?: number;
      worker_focus?: string[];
    };

export function formatActiveGoalLabel(goal: ActiveGoal): string {
  if (typeof goal === "string") return goal;
  return goal.title?.trim() || goal.description?.trim() || "Goal";
}

export type WorkerShift = {
  id: string;
  participant_id?: string;
  participant_name?: string;
  participant_phone?: string;
  participant_address?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  duration_minutes?: number;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  clock_in_method?: "gps" | "qr" | "manual" | null;
  clock_in_location?: { lat: number; lng: number; accuracy?: number } | null;
  clock_in_verified?: boolean;
  status: string;
  visual_state: ShiftVisualState;
  coordinator_notes?: string | null;
  entry_instructions?: string | null;
  access_instructions?: string | null;
  health_alerts?: ShiftHealthAlert[];
  has_risk_alerts?: boolean;
  allergies?: string | null;
  visit_notes?: string | null;
  health_flags?: string | null;
  support_instructions?: ShiftSupportInstruction[];
  risks_acknowledged?: boolean;
  risks_acknowledged_at?: string | null;
  risks_acknowledged_by?: string | null;
  risks_acknowledged_by_name?: string | null;
  requires_safety_ack?: boolean;
  acknowledged_version?: number | null;
  has_safety_content?: boolean;
  content_version?: number;
  safety_protocol?: import("@/services/safetyProtocolService").SafetyProtocol;
  profile?: ParticipantProfile;
  preferences?: ParticipantPreferences;
  context?: ParticipantContext;
  context_synced_at?: string | null;
  completion_summary?: ShiftCompletionSummary;
  participant_dob?: string;
  participant_gender?: string;
  active_goals?: ActiveGoal[];
  tasks?: ShiftTask[];
  session_id?: string | null;
  session_status?: string | null;
  session_started_at?: string | null;
  service_category?: string;
  office_contact_number?: string | null;
};

export type ShiftFilter = "today" | "upcoming" | "completed" | "cancelled" | "past" | "all";

export type WorkerShiftsResponse = {
  shifts: WorkerShift[];
  filter: ShiftFilter;
};

export type WorkerShiftCountsResponse = {
  counts: Record<"today" | "upcoming" | "completed" | "cancelled", number>;
};

export function getWorkerShifts(filter: ShiftFilter = "today") {
  return jsonFetch<WorkerShiftsResponse>(`/api/worker/shifts?filter=${filter}`);
}

export function getWorkerShiftCounts() {
  return jsonFetch<WorkerShiftCountsResponse>("/api/worker/shifts/counts");
}

export function getWorkerShift(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}`);
}

export type ShiftSupportInstructionsResponse = {
  shift_id: string;
  support_instructions: ShiftSupportInstruction[];
};

export function getWorkerShiftSupportInstructions(id: string) {
  return jsonFetch<ShiftSupportInstructionsResponse>(`/api/worker/shifts/${id}/support-instructions`);
}

export type ShiftParticipantProfileResponse = {
  shift_id: string;
  participant_id?: string;
  profile: ParticipantProfile;
  context_synced_at?: string | null;
};

export type ShiftParticipantPreferencesResponse = {
  shift_id: string;
  participant_id?: string;
  preferences: ParticipantPreferences;
  context_synced_at?: string | null;
};

export function getWorkerShiftParticipantProfile(id: string) {
  return jsonFetch<ShiftParticipantProfileResponse>(`/api/worker/shifts/${id}/participant-profile`);
}

export function getWorkerShiftParticipantPreferences(id: string) {
  return jsonFetch<ShiftParticipantPreferencesResponse>(`/api/worker/shifts/${id}/participant-preferences`);
}

export function getWorkerShiftParticipantRisks(id: string) {
  return jsonFetch<ParticipantRisksResponse>(`/api/worker/shifts/${id}/participant-risks`);
}

export type ClockInRequest = {
  method: "gps" | "qr";
  location?: { lat: number; lng: number; accuracy?: number } | null;
  qr_token?: string | null;
  client_timestamp?: string;
};

export function clockInShift(id: string, body: ClockInRequest) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/clock-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function acknowledgeShiftRisks(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/acknowledge-risks`, { method: "POST" });
}

export function startShiftSession(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/start-session`, { method: "POST" });
}

export type StartSessionResponse = {
  success: boolean;
  session: {
    sessionId: string;
    status: string;
    startedAt: string;
    participantId?: string;
    shiftId?: string;
  };
  shift?: WorkerShift;
};

export function startSessionById(
  sessionId: string,
  body?: { startedAt?: string; workerLocation?: { lat: number; lng: number } },
) {
  return jsonFetch<StartSessionResponse>(`/api/sessions/${sessionId}/start`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function clockOutShift(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/clock-out`, { method: "POST" });
}

export function endShift(id: string, options?: { force?: boolean }) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/end-shift`, {
    method: "POST",
    body: JSON.stringify({ force: options?.force ?? false }),
  });
}

export function updateShiftTasks(id: string, tasks: ShiftTask[]) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ tasks }),
  });
}

export function addCustomShiftTask(id: string, label: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/tasks/custom`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function deleteCustomShiftTask(shiftId: string, taskId: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${shiftId}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

export function tasksStorageKey(shiftId: string) {
  return `ccq_shift_tasks_${shiftId}`;
}

export function saveTasksLocally(shiftId: string, tasks: ShiftTask[]) {
  try {
    localStorage.setItem(tasksStorageKey(shiftId), JSON.stringify(tasks));
  } catch {
    /* noop */
  }
}

export function loadTasksLocally(shiftId: string): ShiftTask[] | null {
  try {
    const raw = localStorage.getItem(tasksStorageKey(shiftId));
    if (!raw) return null;
    return JSON.parse(raw) as ShiftTask[];
  } catch {
    return null;
  }
}

export type PendingStartSession = {
  shiftId: string;
  startedAt: string;
};

function pendingStartSessionKey(shiftId: string) {
  return `ccq_pending_start_session_${shiftId}`;
}

export function savePendingStartSession(shiftId: string, startedAt: string) {
  try {
    const payload: PendingStartSession = { shiftId, startedAt };
    localStorage.setItem(pendingStartSessionKey(shiftId), JSON.stringify(payload));
  } catch {
    /* noop */
  }
}

export function loadPendingStartSession(shiftId: string): PendingStartSession | null {
  try {
    const raw = localStorage.getItem(pendingStartSessionKey(shiftId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingStartSession;
  } catch {
    return null;
  }
}

export function clearPendingStartSession(shiftId: string) {
  try {
    localStorage.removeItem(pendingStartSessionKey(shiftId));
  } catch {
    /* noop */
  }
}

export type ShiftVisitNote = {
  id: string;
  shift_id: string;
  session_id?: string | null;
  task_id?: string | null;
  goal_id?: string | null;
  content: string;
  category?: string | null;
  created_at: string;
  auto_saved_at?: string | null;
};

export type ShiftOfficeMessage = {
  id: string;
  shift_id: string;
  message: string;
  priority: "normal" | "urgent" | "emergency";
  created_at: string;
};

export type ShiftLocationDetails = {
  shift_id: string;
  participant_name?: string;
  address?: string | null;
  access_instructions?: string | null;
  entry_instructions?: string | null;
  visit_notes?: string | null;
  coordinator_notes?: string | null;
};

export function listShiftNotes(shiftId: string) {
  return jsonFetch<ShiftVisitNote[]>(`/api/worker/shifts/${shiftId}/notes`);
}

export function createShiftNote(
  shiftId: string,
  body: { content: string; category?: string; session_id?: string },
) {
  return jsonFetch<ShiftVisitNote>(`/api/worker/shifts/${shiftId}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listShiftMessages(shiftId: string) {
  return jsonFetch<ShiftOfficeMessage[]>(`/api/worker/shifts/${shiftId}/messages`);
}

export function sendShiftOfficeMessage(
  shiftId: string,
  body: {
    message: string;
    priority?: "normal" | "urgent" | "emergency";
    attachment_data?: string[];
  },
) {
  return jsonFetch<ShiftOfficeMessage>(`/api/worker/shifts/${shiftId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getShiftLocation(shiftId: string) {
  return jsonFetch<ShiftLocationDetails>(`/api/worker/shifts/${shiftId}/location`);
}
