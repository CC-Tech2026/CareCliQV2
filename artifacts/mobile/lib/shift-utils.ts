import { Brand } from "@/constants/brand";
import type { ShiftTask, ShiftVisualState, WorkerShift } from "@/lib/worker-api";

export const MIN_EVIDENCE_NOTE_CHARS = 20;
export const SESSION_NOTE_MAX = 500;

/**
 * Timezone comes from the worker's branch (office) via /auth/me; shift
 * rows carry their participant's branch zone as `timezone`. This constant
 * is only the fallback before sign-in.
 */
export const APP_TIMEZONE =
  process.env.EXPO_PUBLIC_APP_TIMEZONE || "Australia/Adelaide";

let userZone: string | null = null;

export function isValidTimezone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Set from the signed-in user's branch (AuthContext). */
export function setAppTimezone(zone: string | null | undefined): void {
  userZone = isValidTimezone(zone) ? zone : null;
}

/** The signed-in worker's branch zone, else the deployment default. */
export function getAppTimezone(): string {
  return userZone ?? APP_TIMEZONE;
}

function resolveZone(tz?: string | null): string {
  return isValidTimezone(tz) ? tz : getAppTimezone();
}

/** Short zone name at that instant, e.g. "AEST" / "ACDT". */
export function zoneAbbreviation(iso: string | Date, tz?: string | null): string {
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    const part = new Intl.DateTimeFormat("en-AU", { timeZone: resolveZone(tz), timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

/** A record from another office — show its zone next to the time. */
export function isOtherBranchZone(tz?: string | null): boolean {
  return isValidTimezone(tz) && tz !== getAppTimezone();
}

/** " AEST" when the shift's branch differs from the worker's, else "". */
export function zoneSuffix(iso?: string | null, tz?: string | null): string {
  if (!iso || !isOtherBranchZone(tz)) return "";
  const abbr = zoneAbbreviation(iso, tz);
  return abbr ? ` ${abbr}` : "";
}

export const STATE_AVATAR_COLORS: Record<ShiftVisualState, string> = {
  scheduled: Brand.purple,
  clocked_in: Brand.warning,
  session_active: Brand.warning,
  completed: Brand.success,
};

export const STATE_LABELS: Record<ShiftVisualState, string> = {
  scheduled: "Upcoming",
  clocked_in: "In progress",
  session_active: "In progress",
  completed: "Documented",
};

export function greetingForHour(now = new Date()): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export function shortLocationLabel(address?: string | null): string | null {
  if (!address?.trim()) return null;
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2] ?? parts[0] ?? null;
  return parts[0] ?? null;
}

export function formatHomeDateLabel(now = new Date()): string {
  return now.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function shiftInitials(name?: string): string {
  return (name || "Client")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function pad2(n: number): string {
  if (!Number.isFinite(n)) return "00";
  return String(Math.floor(n)).padStart(2, "0");
}

export function parseIsoMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatTime(iso: string, tz?: string | null): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-AU", {
      timeZone: resolveZone(tz),
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/**
 * e.g. "9:00 am AEST" — a time paired with its zone abbreviation, always
 * shown (not just when it differs from the viewer's own branch). Records
 * that matter for audit — shift times, medication administrations,
 * progress notes, incidents — must never be ambiguous about which
 * branch's clock they're on, regardless of who's looking.
 */
export function formatTimeWithZone(iso?: string | null, tz?: string | null): string {
  if (!iso) return "";
  return `${formatTime(iso, tz)} ${zoneAbbreviation(iso, tz)}`;
}

/** e.g. "12 Sep 2026" — the calendar date in the branch zone. */
export function formatDateInZone(
  iso?: string | null,
  tz?: string | null,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { ...opts, timeZone: resolveZone(tz) }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatShiftDate(iso?: string, tz?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      timeZone: resolveZone(tz),
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return null;
  }
}

export function formatShiftTimeRange(start?: string, end?: string, tz?: string | null): string {
  if (!start) return "Time not set";
  try {
    const date = formatShiftDate(start, tz);
    const s = formatTime(start, tz);
    const e = end ? formatTime(end, tz) : null;
    // Always show the zone when the caller has one — an ambiguous time is
    // exactly what caused the branch-timezone bug in the first place.
    const zone = tz ? ` ${zoneAbbreviation(start, tz)}` : "";
    const time = (e ? `${s} – ${e}` : s) + zone;
    return date ? `${date} · ${time}` : time;
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
    const startMs = parseIsoMs(start);
    const endMs = parseIsoMs(end);
    if (startMs !== null && endMs !== null) {
      return Math.max(0, Math.round((endMs - startMs) / 60_000));
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
  const start = parseIsoMs(fromIso);
  if (start === null) return "00:00:00";

  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (!Number.isFinite(secs)) return "00:00:00";

  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(pad2).join(":");
}

export function timerAnchorIso(
  visualState: ShiftVisualState,
  sessionStartedAt?: string | null,
  clockedInAt?: string | null,
): string | null {
  const session = parseIsoMs(sessionStartedAt) !== null ? sessionStartedAt! : null;
  const clocked = parseIsoMs(clockedInAt) !== null ? clockedInAt! : null;

  if (visualState === "session_active" && session) return session;
  if (visualState === "clocked_in" || visualState === "session_active") {
    return clocked ?? session ?? null;
  }
  return clocked ?? session ?? null;
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

/** Match web/backend: explicit mandatory, or default tasks in the first 4 slots. */
export function isMandatoryTask(task: ShiftTask): boolean {
  return (
    task.mandatory === true ||
    (task.type === "default" && task.mandatory !== false && (task.order ?? 0) <= 4)
  );
}

export function hasIncompleteMandatoryTasks(tasks: ShiftTask[]): boolean {
  return tasks.some((t) => !t.marked_na && isMandatoryTask(t) && !t.completed);
}

export function incompleteMandatoryTasks(tasks: ShiftTask[]): ShiftTask[] {
  return tasks.filter((t) => !t.marked_na && isMandatoryTask(t) && !t.completed);
}

export function isShiftInProgress(shift: {
  visual_state?: string | null;
  status?: string | null;
}): boolean {
  const state = shift.visual_state ?? "";
  if (state === "session_active" || state === "clocked_in") return true;
  return (shift.status ?? "").toLowerCase() === "in_progress";
}

export function findInProgressShift<T extends { id: string; visual_state?: string | null; status?: string | null }>(
  shifts: T[],
): T | null {
  return shifts.find((s) => isShiftInProgress(s)) ?? null;
}

/**
 * True when opening `target` should be blocked because another shift is still in progress.
 * The in-progress shift itself (and completed/cancelled) can always be opened.
 */
export function isBlockedByInProgressShift<
  T extends { id: string; visual_state?: string | null; status?: string | null },
>(target: T, inProgress: T | null): boolean {
  if (!inProgress || inProgress.id === target.id) return false;
  if (isShiftCompletedForList(target as WorkerShift)) return false;
  if ((target.status ?? "").toLowerCase() === "cancelled") return false;
  if (isShiftInProgress(target)) return false;
  return true;
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

export function formatTodayHeading(now = new Date()): string {
  return now.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
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

function slugFilePart(value: string, fallback = "unknown"): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function extensionFromName(originalName?: string | null, fallback = "jpg"): string {
  const match = originalName?.trim().match(/\.([a-zA-Z0-9]+)$/);
  return (match?.[1] ?? fallback).toLowerCase();
}

/** Builds attachment filenames as patientname_tasktitle_datetime.ext */
export function buildAttachmentFileName(options: {
  participantName?: string | null;
  taskTitle?: string | null;
  date?: Date | string | null;
  originalName?: string | null;
}): string {
  const patient = slugFilePart(options.participantName ?? "", "participant");
  const task = slugFilePart(options.taskTitle ?? "", "task");
  const d = options.date ? new Date(options.date) : new Date();
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  const datetime = `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
  const ext = extensionFromName(options.originalName);
  return `${patient}_${task}_${datetime}.${ext}`;
}

