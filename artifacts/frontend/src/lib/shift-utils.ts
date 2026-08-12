import { format, formatDistanceToNow, parseISO, differenceInMinutes, subMinutes, addDays } from "date-fns";
import type { ShiftTask, ShiftVisualState } from "@/services/shiftService";
import { CC, CC_STATUS } from "@/lib/brand-tokens";
import { appLocalDateKey, formatAppTime } from "@/lib/datetime";

export const PLUM = CC.plum;
export const PLUM_SUBTLE = CC.plumSubtle;
export const PLUM_SOFT = CC.plumSoft;
export const PLUM_MEDIUM = CC.plumMedium;
export const PLUM_RING = CC.plumRing;
export const CORAL = CC.coral;
export const CORAL_SOFT = CC.coralSoft;
export const TEXT = CC.text;
export const MUTED = CC.muted;
export const BORDER = CC.border;
export const SOFT = CC.bg;

/** Scrollable body for dashboard widgets with long lists */
export const WIDGET_SCROLL = "max-h-72 overflow-y-auto overscroll-y-contain pr-1";

export const STATE_STYLES: Record<
  ShiftVisualState,
  { border: string; badge: string; label: string; avatar: string }
> = {
  scheduled: {
    border: CC_STATUS.info,
    badge: "bg-[var(--cc-status-info-bg)] text-[var(--cc-status-info)] border-[var(--cc-border)]",
    label: "Scheduled",
    avatar: CC.plum,
  },
  clocked_in: {
    border: CC_STATUS.warning,
    badge: "bg-[var(--cc-status-warning-bg)] text-[var(--cc-status-warning)] border-[var(--cc-border)]",
    label: "Clocked In",
    avatar: CC_STATUS.warning,
  },
  session_active: {
    border: CC_STATUS.success,
    badge: "bg-[var(--cc-status-success-bg)] text-[var(--cc-status-success)] border-[var(--cc-border)]",
    label: "Session Active",
    avatar: CC_STATUS.success,
  },
  completed: {
    border: CC.muted,
    badge: "bg-[var(--cc-bg)] text-[var(--cc-muted)] border-[var(--cc-border)]",
    label: "Completed",
    avatar: CC.muted,
  },
};

export function shiftInitials(name?: string) {
  return (name || "Client").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function formatShiftSchedule(start?: string, end?: string) {
  if (!start) return "Time not set";
  try {
    const s = formatAppTime(start);
    const e = end ? formatAppTime(end) : null;
    const day = format(parseISO(`${appLocalDateKey(start)}T12:00:00`), "EEE d MMM");
    return e ? `${s} – ${e}, ${day}` : `${s}, ${day}`;
  } catch {
    return start;
  }
}

export function formatShiftTimeRange(start?: string, end?: string) {
  if (!start) return "Time not set";
  try {
    const s = formatAppTime(start);
    const e = end ? formatAppTime(end) : null;
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

/** Human-readable on-site duration for mobile success screens (e.g. "1h 15m"). */
export function formatMobileShiftDuration(
  shift: { clocked_in_at?: string | null; clocked_out_at?: string | null; scheduled_start?: string; scheduled_end?: string; duration_minutes?: number },
  elapsedTimer?: string,
): string {
  if (shift.clocked_in_at && shift.clocked_out_at) {
    try {
      const mins = differenceInMinutes(parseISO(shift.clocked_out_at), parseISO(shift.clocked_in_at));
      const label = formatDurationLabel(mins);
      if (label) return label;
    } catch {
      /* fall through */
    }
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

export function greetingForHour(translate?: (key: string) => string, date = new Date()) {
  const h = date.getHours();
  if (translate) {
    if (h < 12) return translate("common.greeting.morning");
    if (h < 17) return translate("common.greeting.afternoon");
    return translate("common.greeting.evening");
  }
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
    const day = appLocalDateKey(shift.scheduled_start);
    const today = appLocalDateKey(new Date().toISOString());
    return day === today && shift.status !== "cancelled";
  } catch {
    return false;
  }
}

const CLOCK_IN_EARLY_MINUTES = 15;

/** End datetime; rolls to next calendar day when end time is before start (e.g. 9pm–2am). */
export function resolveShiftScheduledEnd(start?: string, end?: string): Date | null {
  if (!start || !end) return null;
  try {
    const startDt = parseISO(start);
    let endDt = parseISO(end);
    if (endDt.getTime() <= startDt.getTime()) {
      endDt = addDays(endDt, 1);
    }
    return endDt;
  } catch {
    return null;
  }
}

type ShiftWindowFields = {
  scheduled_start?: string;
  scheduled_end?: string;
  status?: string;
  visual_state?: ShiftVisualState;
};

/** True when the shift should appear on My Shifts (15 min before start through scheduled end). */
export function isShiftWithinListWindow(shift: ShiftWindowFields, now = new Date()): boolean {
  if (shift.status === "cancelled") return false;
  if (shift.visual_state === "clocked_in" || shift.visual_state === "session_active") return true;
  if (!shift.scheduled_start) return false;
  try {
    const start = parseISO(shift.scheduled_start);
    const end = resolveShiftScheduledEnd(shift.scheduled_start, shift.scheduled_end) ?? start;
    const earliest = subMinutes(start, CLOCK_IN_EARLY_MINUTES);
    return now >= earliest && now <= end;
  } catch {
    return false;
  }
}

/** Completed for today's list — backend status only. */
export function isShiftCompletedForList(shift: ShiftWindowFields): boolean {
  return shift.status === "completed" || shift.visual_state === "completed";
}

function compareScheduledStart(a: ShiftWindowFields, b: ShiftWindowFields): number {
  if (!a.scheduled_start && !b.scheduled_start) return 0;
  if (!a.scheduled_start) return 1;
  if (!b.scheduled_start) return -1;
  try {
    return parseISO(a.scheduled_start).getTime() - parseISO(b.scheduled_start).getTime();
  } catch {
    return 0;
  }
}

/** The one shift that should show Directions / Call / Clock In on My Shifts today. */
export function getPrimaryTodayShiftId(shifts: (ShiftWindowFields & { id: string })[], now = new Date()): string | null {
  const today = shifts.filter((s) => isShiftToday(s) && s.status !== "cancelled");

  const active = today.find(
    (s) => s.visual_state === "session_active" || s.visual_state === "clocked_in",
  );
  if (active?.id) return active.id;

  const incomplete = today
    .filter((s) => !isShiftCompletedForList(s))
    .sort(compareScheduledStart);

  const inWindow = incomplete.find((s) => isShiftWithinListWindow(s, now));
  return inWindow?.id ?? null;
}

/** Today's shifts: primary first, upcoming middle, completed last. */
export function sortTodayShiftsForList<T extends ShiftWindowFields & { id: string }>(
  shifts: T[],
  now = new Date(),
): T[] {
  const primaryId = getPrimaryTodayShiftId(shifts, now);

  return shifts
    .filter((s) => isShiftToday(s) && s.status !== "cancelled")
    .sort((a, b) => {
      const aDone = isShiftCompletedForList(a);
      const bDone = isShiftCompletedForList(b);
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (a.id === primaryId) return -1;
      if (b.id === primaryId) return 1;
      return compareScheduledStart(a, b);
    });
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

export function hasStrongTaskEvidence(task: ShiftTask) {
  return (
    task.has_photo === true ||
    task.has_voice === true ||
    Boolean(task.photo_evidence) ||
    (task.photo_thumbnails?.length ?? 0) > 0 ||
    Boolean(task.voice_evidence) ||
    Boolean(task.voice_duration_seconds)
  );
}

export function taskUpdateCount(task: ShiftTask) {
  let count = 0;
  if (task.note?.trim()) count += 1;
  count += task.photo_thumbnails?.length ?? (task.photo_evidence ? 1 : 0);
  if (task.voice_evidence || task.voice_duration_seconds) count += 1;
  return count;
}

export function groupShiftTasksByGoal(tasks: ShiftTask[]) {
  type GoalGroup = {
    key: string;
    title: string;
    tasks: ShiftTask[];
    category: string;
    accent: { main: string; soft: string; border: string };
  };
  const groups = new Map<string, GoalGroup>();
  tasks.forEach((task) => {
    const raw = (task.goal_title || "").trim();
    const title = raw || "General Support";
    const key = (task.goal_id || title).toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      return;
    }
    const lower = title.toLowerCase();
    let category = "CORE SUPPORT";
    let accent = { main: "#6D4BDA", soft: "#F1EAFF", border: "#D7CCF4" };
    if (lower.includes("community")) {
      category = "COMMUNITY SUPPORT";
      accent = { main: "#2497B7", soft: "#E8F8FC", border: "#BFE6F1" };
    } else if (lower.includes("document") || lower.includes("reporting") || lower.includes("plan")) {
      category = "PLAN MANAGEMENT";
      accent = { main: "#D48A22", soft: "#FFF3E3", border: "#F7D9AF" };
    } else if (lower.includes("health") || lower.includes("wellbeing")) {
      category = "CORE SUPPORT";
      accent = { main: "#2BAE86", soft: "#E9FBF4", border: "#BFEEDA" };
    } else if (
      lower.includes("daily") ||
      lower.includes("living") ||
      lower.includes("independence") ||
      lower.includes("develop")
    ) {
      category = "CORE SUPPORT";
      accent = { main: "#6D4BDA", soft: "#F1EAFF", border: "#D7CCF4" };
    }
    groups.set(key, { key, title, tasks: [task], category, accent });
  });
  return [...groups.values()];
}

export function taskEvidenceScore(tasks: ShiftTask[]) {
  const { score, label } = (() => {
    if (!tasks.length) return { score: 100, label: "High" as const };
    const strongCount = tasks.filter(hasStrongTaskEvidence).length;
    const score = Math.round((strongCount / tasks.length) * 100);
    const label = score >= 80 ? ("High" as const) : score >= 50 ? ("Medium" as const) : ("Low" as const);
    return { score, label };
  })();
  return { score, label };
}

export function taskFeedSummary(tasks: ShiftTask[]) {
  const goalGroups = groupShiftTasksByGoal(tasks);
  const goalsTotal = goalGroups.length;
  const goalsComplete = goalGroups.filter((group) =>
    group.tasks.every((task) => task.completed),
  ).length;
  const strongEvidenceCount = tasks.filter(hasStrongTaskEvidence).length;
  const totalUpdates = tasks.reduce((sum, task) => sum + taskUpdateCount(task), 0);
  const progressPercent =
    tasks.length > 0 ? Math.round((tasks.filter((t) => t.completed).length / tasks.length) * 100) : 0;
  return {
    goalsTotal,
    goalsComplete,
    strongEvidenceCount,
    totalUpdates,
    progressPercent,
  };
}

export function resolveActiveShiftTasks(shiftTasks: ShiftTask[] | undefined, localTasks: ShiftTask[]) {
  return localTasks.length > 0 ? localTasks : (shiftTasks ?? []);
}

export function hasIncompleteMandatoryTasks(tasks: ShiftTask[]) {
  return tasks.some((t) => !t.marked_na && isMandatoryTask(t) && !mandatoryTaskSatisfied(t));
}

export function incompleteMandatoryTasks(tasks: ShiftTask[]) {
  return tasks.filter((t) => !t.marked_na && isMandatoryTask(t) && !mandatoryTaskSatisfied(t));
}

export function mandatoryTaskSatisfied(task: ShiftTask) {
  if (!task.completed) return false;
  if (hasStrongTaskEvidence(task)) return true;
  const note = (task.note || "").trim();
  return note.length >= 20;
}

/** Whether a task may be marked complete (mandatory tasks need evidence first). */
export function canMarkTaskComplete(
  task: ShiftTask,
  draftNote?: string,
  options?: { sessionNoteTexts?: string[] },
) {
  if (!isMandatoryTask(task)) return true;
  const mergedNote = [
    draftNote,
    task.note,
    ...(options?.sessionNoteTexts ?? []),
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n");

  const candidate: ShiftTask = {
    ...task,
    completed: true,
    note: mergedNote || task.note,
  };
  return mandatoryTaskSatisfied(candidate);
}

/** Show "Mark task complete" when note ≥20 chars or strong evidence is present. */
export function isReadyToMarkTaskComplete(
  task: ShiftTask,
  draftNote?: string,
  options?: { hasLocalStrongEvidence?: boolean },
) {
  if (task.completed) return false;
  const note = resolveEffectiveTaskNote(draftNote, task).trim();
  if (hasStrongTaskEvidence(task) || options?.hasLocalStrongEvidence) return true;
  return note.length >= 20;
}

/** Draft input, saved thread notes, or persisted task note — whichever is available. */
export function resolveEffectiveTaskNote(
  draftNote: string | undefined,
  task: ShiftTask,
  savedTextNotes?: string[],
): string {
  const draft = (draftNote ?? "").trim();
  if (draft) return draft;
  if (savedTextNotes?.length) {
    for (let i = savedTextNotes.length - 1; i >= 0; i -= 1) {
      const saved = savedTextNotes[i]?.trim();
      if (saved) return saved;
    }
  }
  return (task.note || task.context_note || "").trim();
}

export function mandatoryTaskState(task: ShiftTask) {
  if (!isMandatoryTask(task)) return "optional" as const;
  if (mandatoryTaskSatisfied(task)) return "satisfied" as const;
  const hasDraft = Boolean(task.note?.trim() || hasStrongTaskEvidence(task));
  if (hasDraft) return "draft" as const;
  return "missing" as const;
}

type ShiftRiskFields = {
  health_alerts?: unknown[] | null;
  has_risk_alerts?: boolean;
  allergies?: string | null;
  health_flags?: string | null;
  risks_acknowledged?: boolean;
};

export function shiftHasRiskAlerts(shift: ShiftRiskFields) {
  return (
    (shift.health_alerts?.length ?? 0) > 0 ||
    !!shift.has_risk_alerts ||
    !!shift.allergies?.trim() ||
    !!shift.health_flags?.trim()
  );
}

export function shiftNeedsRiskAck(shift: ShiftRiskFields) {
  return shiftHasRiskAlerts(shift) && !shift.risks_acknowledged;
}

type ShiftBriefingFields = {
  visual_state?: string;
  briefing_complete?: boolean;
  requires_briefing?: boolean;
};

type ShiftBriefingOptions = {
  /** Tutorial always walks through briefing even if already completed on this shift. */
  tutorial?: boolean;
  /** Open briefing in read-only review mode (no auto-redirect away). */
  review?: boolean;
};

/** Temporarily disabled — re-enable when pre-shift briefing is ready for workers. */
const BRIEFING_GATE_ENABLED = false;

/** Scheduled shifts need the full briefing until explicitly complete (list API may omit flags). */
export function shiftNeedsBriefing(shift: ShiftBriefingFields, options?: ShiftBriefingOptions): boolean {
  if (!BRIEFING_GATE_ENABLED) return Boolean(options?.tutorial);
  if (shift.visual_state !== "scheduled") return false;
  if (options?.tutorial) return true;
  if (options?.review) return true;
  return shift.briefing_complete !== true;
}

export function shiftBriefingHref(
  shiftId: string,
  options?: boolean | ShiftBriefingOptions,
): string {
  const opts: ShiftBriefingOptions =
    typeof options === "boolean" ? { tutorial: options } : (options ?? {});
  const params = new URLSearchParams();
  if (opts.tutorial) {
    params.set("tutorial", "1");
    params.set("step", "pre_shift_briefing_complete");
  }
  if (opts.review) params.set("review", "1");
  const qs = params.toString();
  return `/my-shifts/${shiftId}/briefing${qs ? `?${qs}` : ""}`;
}
