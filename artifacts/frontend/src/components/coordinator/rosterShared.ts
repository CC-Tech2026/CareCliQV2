/** Shared by the roster grid and its tests: who a shift suits, and the
 *  little date helpers that question needs. */
import { getDay, parseISO, startOfWeek, format } from "date-fns";
import { appLocalDateKey, appMinutesOfDay } from "@/lib/datetime";
import type { BlackoutDate, CoordinatorShiftRecord, WorkerAvailability } from "@/services/coordinatorService";

export const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
/** Drop target id for the open shifts row or column (dropping there takes the worker off). */
export const OPEN_ROW_ID = "__open_shifts__";

export type AvailabilityMap = Record<string, WorkerAvailability & { blackout_dates?: BlackoutDate[] }>;

export function isOpenShift(shift: { worker_id?: string | null }) {
  return !shift.worker_id || shift.worker_id === UNASSIGNED_PLACEHOLDER_ID;
}

/** ISO weekday (1 = Monday … 7 = Sunday) — the numbering worker
 * availability is saved in (WorkerAvailabilityPanel, the matching and
 * capacity services). This used to be 0 = Monday, which shifted every
 * worker's availability by a day: Mondays showed as unavailable (no way to
 * add a shift, and any shift already there hidden) and Saturdays as open. */
export function isoWeekday(date: Date): number {
  const d = getDay(date);
  return d === 0 ? 7 : d;
}

export function isBlackout(dayKey: string, blackouts: BlackoutDate[] = []): boolean {
  return blackouts.some((b) => dayKey >= b.start_date.slice(0, 10) && dayKey <= b.end_date.slice(0, 10));
}

/** 6am, 9:30am, 12pm */
export function clock(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

/**
 * A worker's usual day: on leave, not a day they work, or free between their
 * usual hours. "unknown" when they haven't set any availability, which
 * doesn't restrict anything.
 */
export function dayAvailability(
  avail: (WorkerAvailability & { blackout_dates?: BlackoutDate[] | null }) | null | undefined,
  dayKey: string,
): { state: "leave" | "off" | "free" | "unknown"; start?: number; end?: number; text: string } {
  if (!avail) return { state: "unknown", text: "No usual hours set" };
  if (isBlackout(dayKey, avail.blackout_dates ?? [])) return { state: "leave", text: "On leave" };
  const days = Array.isArray(avail.available_days) ? avail.available_days.map(Number) : [];
  if (days.length && !days.includes(isoWeekday(parseISO(dayKey)))) return { state: "off", text: "Not working" };
  const start = toMinutes(avail.day_start_time);
  const end = toMinutes(avail.day_end_time);
  if (start == null || end == null) return { state: "free", text: "Any time" };
  return { state: "free", start, end, text: `${clock(start)}–${clock(end)}` };
}

function span(shift: CoordinatorShiftRecord) {
  const start = new Date(shift.scheduled_start!).getTime();
  const end = shift.scheduled_end ? new Date(shift.scheduled_end).getTime() : start + 3_600_000;
  return { start, end };
}

export type Fit = { tone: "good" | "warn" | "bad"; label: string };

/**
 * How well a worker suits a shift, for the badge shown while it's dragged:
 * on leave or already busy then is a clash; not their usual day, outside
 * their usual hours or over their weekly hours is a caution; otherwise free.
 * The real check still runs when the shift is dropped.
 */
export function workerFit({
  shift,
  avail,
  workerShifts,
}: {
  shift: CoordinatorShiftRecord;
  avail?: (WorkerAvailability & { blackout_dates?: BlackoutDate[] | null }) | null;
  /** The worker's other shifts on screen. */
  workerShifts: CoordinatorShiftRecord[];
}): Fit {
  if (!shift.scheduled_start) return { tone: "good", label: "Free" };
  const tz = shift.timezone;
  const dayKey = appLocalDateKey(shift.scheduled_start, tz);
  const { start, end } = span(shift);

  if (avail && isBlackout(dayKey, avail.blackout_dates ?? [])) return { tone: "bad", label: "On leave" };

  const clash = workerShifts.find((o) => {
    if (o.id === shift.id || !o.scheduled_start || o.status === "cancelled") return false;
    const other = span(o);
    return other.start < end && other.end > start;
  });
  if (clash) {
    const from = appMinutesOfDay(clash.scheduled_start!, clash.timezone);
    const to = clash.scheduled_end ? appMinutesOfDay(clash.scheduled_end, clash.timezone) : from + 60;
    return { tone: "bad", label: `Busy ${clock(from)}–${clock(to)}` };
  }

  if (avail) {
    const days = Array.isArray(avail.available_days) ? avail.available_days.map(Number) : [];
    if (days.length && !days.includes(isoWeekday(parseISO(dayKey)))) return { tone: "warn", label: "Not their day" };
    const usualStart = toMinutes(avail.day_start_time);
    const usualEnd = toMinutes(avail.day_end_time);
    const startMin = appMinutesOfDay(shift.scheduled_start, tz);
    const endMin = startMin + (end - start) / 60_000;
    if (usualStart != null && usualEnd != null && (startMin < usualStart || endMin > usualEnd)) {
      return { tone: "warn", label: `Outside ${clock(usualStart)}–${clock(usualEnd)}` };
    }
    if (avail.max_hours_per_week) {
      // Hours already rostered in the shift's Monday-to-Sunday week.
      const weekStart = format(startOfWeek(parseISO(dayKey), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const weekEnd = format(new Date(parseISO(weekStart).getTime() + 6 * 86_400_000), "yyyy-MM-dd");
      const booked = workerShifts.reduce((sum, o) => {
        if (o.id === shift.id || !o.scheduled_start || o.status === "cancelled") return sum;
        const key = appLocalDateKey(o.scheduled_start, o.timezone);
        if (key < weekStart || key > weekEnd) return sum;
        const s = span(o);
        return sum + (s.end - s.start) / 3_600_000;
      }, 0);
      if (booked + (end - start) / 3_600_000 > avail.max_hours_per_week) {
        return { tone: "warn", label: `Over ${avail.max_hours_per_week}h` };
      }
    }
  }
  return { tone: "good", label: "Free" };
}

export const FIT_COLORS: Record<Fit["tone"], { bg: string; fg: string; border: string }> = {
  good: { bg: "var(--cc-status-success-bg)", fg: "var(--cc-status-success)", border: "#86EFAC" },
  warn: { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)", border: "#FCD34D" },
  bad: { bg: "var(--cc-status-danger-bg)", fg: "var(--cc-danger-text)", border: "#FCA5A5" },
};
