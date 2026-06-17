import { format, formatDistanceToNow, parseISO, differenceInMinutes } from "date-fns";
import type { ShiftTask, ShiftVisualState } from "@/services/shiftService";

export const PLUM = "#5533CC";
export const CORAL = "#F03060";
export const TEXT = "#1E1640";
export const MUTED = "#7A6A9E";
export const BORDER = "#E2DEF2";
export const SOFT = "#F5F3FC";

export const STATE_STYLES: Record<
  ShiftVisualState,
  { border: string; badge: string; label: string; avatar: string }
> = {
  scheduled: {
    border: "#3B82F6",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    label: "Scheduled",
    avatar: PLUM,
  },
  clocked_in: {
    border: "#F59E0B",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Clocked In",
    avatar: "#F59E0B",
  },
  session_active: {
    border: "#10B981",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Session Active",
    avatar: "#10B981",
  },
  completed: {
    border: "#9CA3AF",
    badge: "bg-slate-50 text-slate-600 border-slate-200",
    label: "Completed",
    avatar: "#9CA3AF",
  },
};

export function shiftInitials(name?: string) {
  return (name || "Client").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function formatShiftSchedule(start?: string, end?: string) {
  if (!start) return "Time not set";
  try {
    const s = format(parseISO(start), "h:mm a");
    const e = end ? format(parseISO(end), "h:mm a") : null;
    const day = format(parseISO(start), "EEE d MMM");
    return e ? `${s} – ${e}, ${day}` : `${s}, ${day}`;
  } catch {
    return start;
  }
}

export function formatShiftTimeRange(start?: string, end?: string) {
  if (!start) return "Time not set";
  try {
    const s = format(parseISO(start), "h:mm a");
    const e = end ? format(parseISO(end), "h:mm a") : null;
    return e ? `${s} – ${e}` : s;
  } catch {
    return start;
  }
}

export function shiftDurationMinutes(start?: string, end?: string, fallback?: number) {
  if (start && end) {
    try {
      return differenceInMinutes(parseISO(end), parseISO(start));
    } catch {
      /* fall through */
    }
  }
  return fallback ?? null;
}

export function formatDurationLabel(minutes?: number | null) {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function timeUntilStart(start?: string) {
  if (!start) return null;
  try {
    const target = parseISO(start);
    if (target.getTime() <= Date.now()) return null;
    return formatDistanceToNow(target, { addSuffix: true });
  } catch {
    return null;
  }
}

export function maskGateCode(text?: string | null) {
  if (!text) return text;
  return text.replace(/\b(\d{4,})\b/g, (match) => "•".repeat(match.length));
}

export function extractGateCode(text?: string | null) {
  if (!text) return null;
  const match = text.match(/(?:gate\s*code|code)[:\s]*(\d{4,})/i) ?? text.match(/\b(\d{4,})\b/);
  return match?.[1] ?? null;
}

export function greetingForHour(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function stageBannerText(visualState: ShiftVisualState, participantName?: string) {
  const name = participantName || "participant";
  switch (visualState) {
    case "clocked_in":
      return `Arrived — ${name}`;
    case "session_active":
      return `Session Active — ${name}`;
    case "completed":
      return `Shift completed — ${name}`;
    default:
      return null;
  }
}

export function stageBannerShortText(visualState: ShiftVisualState) {
  switch (visualState) {
    case "clocked_in":
      return "Arrived";
    case "session_active":
      return "Active";
    case "completed":
      return "Done";
    default:
      return null;
  }
}

export function timerAnchorIso(
  visualState: ShiftVisualState,
  sessionStartedAt?: string | null,
  clockedInAt?: string | null,
) {
  if (visualState === "session_active" && sessionStartedAt) return sessionStartedAt;
  if (visualState === "clocked_in" || visualState === "session_active") return clockedInAt ?? null;
  return null;
}

export function avatarShouldPulse(visualState: ShiftVisualState) {
  return visualState === "clocked_in" || visualState === "session_active";
}

export function participantAge(dob?: string | null) {
  if (!dob) return null;
  try {
    const birth = parseISO(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
    return age;
  } catch {
    return null;
  }
}

export function formatElapsedTimer(fromIso?: string | null, now = Date.now()) {
  if (!fromIso) return "00:00:00";
  try {
    const start = parseISO(fromIso).getTime();
    const secs = Math.max(0, Math.floor((now - start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  } catch {
    return "00:00:00";
  }
}

export function isShiftToday(shift: { scheduled_start?: string; status?: string }) {
  if (!shift.scheduled_start) return false;
  try {
    const day = format(parseISO(shift.scheduled_start), "yyyy-MM-dd");
    const today = format(new Date(), "yyyy-MM-dd");
    return day === today && shift.status !== "cancelled";
  } catch {
    return false;
  }
}

export function isCustomShiftTask(task: ShiftTask) {
  return task.type === "custom" || task.task_id.startsWith("custom_");
}

export function isMandatoryTask(task: ShiftTask) {
  return (
    task.mandatory === true ||
    (task.type === "default" && task.mandatory !== false && (task.order ?? 0) <= 4)
  );
}

export function taskEvidenceScore(tasks: ShiftTask[]) {
  const mandatory = tasks.filter(isMandatoryTask);
  if (!mandatory.length) return { score: 100, label: "High" as const };
  const withEvidence = mandatory.filter(
    (t) =>
      t.completed ||
      Boolean(t.note?.trim()) ||
      Boolean(t.photo_evidence) ||
      Boolean(t.voice_evidence) ||
      (t.photo_thumbnails?.length ?? 0) > 0 ||
      Boolean(t.voice_duration_seconds),
  ).length;
  const score = Math.round((withEvidence / mandatory.length) * 100);
  const label = score >= 80 ? ("High" as const) : score >= 50 ? ("Medium" as const) : ("Low" as const);
  return { score, label };
}

export function resolveActiveShiftTasks(shiftTasks: ShiftTask[] | undefined, localTasks: ShiftTask[]) {
  return localTasks.length > 0 ? localTasks : (shiftTasks ?? []);
}

export function hasIncompleteMandatoryTasks(tasks: ShiftTask[]) {
  return tasks.some((t) => isMandatoryTask(t) && !t.completed);
}
