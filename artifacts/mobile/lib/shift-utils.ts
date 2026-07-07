import type { ShiftTask, ShiftVisualState, WorkerShift } from "@/lib/worker-api";

export const MIN_EVIDENCE_NOTE_CHARS = 20;
export const SESSION_NOTE_MAX = 500;

export const STATE_AVATAR_COLORS: Record<ShiftVisualState, string> = {
  scheduled: "#5271FF",
  clocked_in: "#FB923C",
  session_active: "#22C55E",
  completed: "#9CA3AF",
};

export const STATE_LABELS: Record<ShiftVisualState, string> = {
  scheduled: "Scheduled",
  clocked_in: "Clocked In",
  session_active: "Active",
  completed: "Completed",
};

export function shiftInitials(name?: string): string {
  return (name || "Client")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return iso;
  }
}

export function formatShiftTimeRange(start?: string, end?: string): string {
  if (!start) return "Time not set";
  try {
    const s = formatTime(start);
    const e = end ? formatTime(end) : null;
    return e ? `${s} – ${e}` : s;
  } catch {
    return start;
  }
}

export function shiftDurationMinutes(
  start?: string,
  end?: string,
  fallback?: number,
): number | null {
  if (start && end) {
    try {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      return Math.round(diff / 60_000);
    } catch {
      /* fall through */
    }
  }
  return fallback ?? null;
}

export function formatDurationLabel(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatElapsedTimer(fromIso?: string | null, now = Date.now()): string {
  if (!fromIso) return "00:00:00";
  try {
    const start = new Date(fromIso).getTime();
    const secs = Math.max(0, Math.floor((now - start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(pad2).join(":");
  } catch {
    return "00:00:00";
  }
}

export function timerAnchorIso(
  visualState: ShiftVisualState,
  sessionStartedAt?: string | null,
  clockedInAt?: string | null,
): string | null {
  if (visualState === "session_active" && sessionStartedAt) return sessionStartedAt;
  if (visualState === "clocked_in" || visualState === "session_active") {
    return clockedInAt ?? null;
  }
  return null;
}

export function avatarShouldPulse(visualState: ShiftVisualState): boolean {
  return visualState === "clocked_in" || visualState === "session_active";
}

export function formatActiveGoalLabel(
  goal: string | { id?: string; title?: string; description?: string },
): string {
  if (typeof goal === "string") return goal;
  return goal.title?.trim() || goal.description?.trim() || "Goal";
}

export function emergencyContactDisplay(
  contact:
    | string
    | { name?: string | null; phone?: string | null; relationship?: string | null; display?: string }
    | undefined,
): { name: string | null; phone?: string; text: string; detail: string } | null {
  if (!contact) return null;
  if (typeof contact === "string") {
    return {
      name: null,
      phone: contact.match(/[\d+() -]{8,}/)?.[0],
      text: contact,
      detail: "",
    };
  }
  const name = contact.name?.trim() || null;
  const relationship = contact.relationship?.trim() || null;
  const phone = contact.phone?.trim() || undefined;
  const detail = [relationship, phone].filter(Boolean).join(" · ");
  return {
    name,
    phone,
    detail,
    text: contact.display || [name, detail].filter(Boolean).join(" — ") || phone || name || "",
  };
}

export function isShiftCompletedForList(shift: WorkerShift): boolean {
  return shift.visual_state === "completed" || shift.status === "completed";
}

export function shiftNeedsRiskAck(shift: WorkerShift): boolean {
  return Boolean(shift.has_risk_alerts) && !shift.risks_acknowledged;
}

export function shiftHasRiskAlerts(shift: WorkerShift): boolean {
  return Boolean(shift.has_risk_alerts || (shift.health_alerts && shift.health_alerts.length > 0));
}

export function resolveActiveShiftTasks(
  serverTasks?: ShiftTask[] | null,
  localTasks?: ShiftTask[] | null,
): ShiftTask[] {
  if (localTasks && localTasks.length > 0) return localTasks;
  return serverTasks ?? [];
}

export function hasStrongTaskEvidence(task: ShiftTask): boolean {
  return Boolean(task.has_photo || task.has_voice);
}

export function hasIncompleteMandatoryTasks(tasks: ShiftTask[]): boolean {
  return tasks.some((t) => !t.marked_na && t.mandatory && !t.completed);
}

export function incompleteMandatoryTasks(tasks: ShiftTask[]): ShiftTask[] {
  return tasks.filter((t) => !t.marked_na && t.mandatory && !t.completed);
}

export function sortTodayShiftsForList(shifts: WorkerShift[], now = new Date()): WorkerShift[] {
  const priority = (s: WorkerShift): number => {
    if (s.visual_state === "session_active") return 0;
    if (s.visual_state === "clocked_in") return 1;
    if (s.visual_state === "scheduled") return 2;
    if (s.visual_state === "completed") return 4;
    return 3;
  };

  return [...shifts].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
    const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
    return ta - tb;
  });
}

export function getPrimaryTodayShiftId(shifts: WorkerShift[], now = new Date()): string | null {
  const sorted = sortTodayShiftsForList(shifts, now);
  const active = sorted.find(
    (s) => s.visual_state === "session_active" || s.visual_state === "clocked_in",
  );
  if (active) return active.id;
  const upcoming = sorted.find((s) => s.visual_state === "scheduled");
  return upcoming?.id ?? sorted[0]?.id ?? null;
}

export function newClientNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatMobileShiftDuration(
  shift: {
    clocked_in_at?: string | null;
    clocked_out_at?: string | null;
    scheduled_start?: string;
    scheduled_end?: string;
    duration_minutes?: number;
  },
  elapsedTimer?: string,
): string {
  if (shift.clocked_in_at && shift.clocked_out_at) {
    const mins = shiftDurationMinutes(shift.clocked_in_at, shift.clocked_out_at);
    const label = formatDurationLabel(mins);
    if (label) return label;
  }
  if (elapsedTimer && elapsedTimer !== "00:00:00") {
    const [h = 0, m = 0] = elapsedTimer.split(":").map(Number);
    const label = formatDurationLabel(h * 60 + m);
    if (label) return label;
  }
  return (
    formatDurationLabel(
      shiftDurationMinutes(shift.scheduled_start, shift.scheduled_end, shift.duration_minutes),
    ) ?? "—"
  );
}
