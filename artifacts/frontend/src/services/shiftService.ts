import { jsonFetch } from "@/services/http";

export type ShiftVisualState = "scheduled" | "clocked_in" | "session_active" | "completed";

export type ShiftHealthAlert = {
  title: string;
  severity: "critical" | "important" | string;
  detail?: string;
};

export type ShiftTask = {
  task_id: string;
  type: "default" | "custom" | string;
  label: string;
  description?: string;
  completed: boolean;
  completed_at?: string | null;
  note?: string;
  order: number;
  mandatory?: boolean;
  goal_id?: string | null;
  goal_title?: string | null;
  outcome_tip?: string | null;
  photo_evidence?: string | null;
  voice_evidence?: string | null;
  photo_thumbnails?: string[];
  voice_duration_seconds?: number | null;
};

export type ShiftSupportInstruction = {
  category: string;
  body: string;
  critical?: string;
};

export type ShiftCompletionSummary = {
  tasks_completed: number;
  tasks_total: number;
  mandatory_completed: number;
  mandatory_total: number;
  session_id?: string | null;
  notes_submitted?: boolean;
};

export type ParticipantProfile = {
  preferred_name?: string;
  date_of_birth?: string;
  ndis_number?: string;
  phone?: string;
  email?: string;
  emergency_contact?: string;
  primary_disability?: string;
};

export type ParticipantPreferences = {
  communication_style?: string;
  behaviour_support?: string;
  restricted_notes?: string;
  routines?: string;
  health_flags?: string;
  likes_dislikes?: string;
};

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
  status: string;
  visual_state: ShiftVisualState;
  coordinator_notes?: string | null;
  entry_instructions?: string | null;
  access_instructions?: string | null;
  health_alerts?: ShiftHealthAlert[];
  allergies?: string | null;
  visit_notes?: string | null;
  health_flags?: string | null;
  support_instructions?: ShiftSupportInstruction[];
  risks_acknowledged?: boolean;
  risks_acknowledged_at?: string | null;
  risks_acknowledged_by?: string | null;
  profile?: ParticipantProfile;
  preferences?: ParticipantPreferences;
  completion_summary?: ShiftCompletionSummary;
  participant_dob?: string;
  participant_gender?: string;
  active_goals?: string[];
  tasks?: ShiftTask[];
  session_id?: string | null;
  session_status?: string | null;
  service_category?: string;
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

export function clockInShift(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/clock-in`, { method: "POST" });
}

export function acknowledgeShiftRisks(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/acknowledge-risks`, { method: "POST" });
}

export function startShiftSession(id: string) {
  return jsonFetch<WorkerShift>(`/api/worker/shifts/${id}/start-session`, { method: "POST" });
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
