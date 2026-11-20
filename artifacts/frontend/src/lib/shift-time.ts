import { datetimeLocalValueToUtcIso, utcIsoToDatetimeLocalValue } from "@/lib/datetime";

/** "YYYY-MM-DD" plus n days (calendar days, no time zone involved). */
export function addDaysToKey(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "HH:MM" for minutes since midnight (wraps past midnight). */
export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A shift's day and times on its own clock (its participant's zone). */
export function splitShiftTimes(startIso: string, endIso: string, tz?: string | null) {
  const start = utcIsoToDatetimeLocalValue(startIso, tz);
  const end = utcIsoToDatetimeLocalValue(endIso, tz);
  return { day: start.slice(0, 10), start: start.slice(11, 16), end: end.slice(11, 16) };
}

export type ShiftRange = {
  startIso: string;
  endIso: string;
  /** Length in minutes. */
  minutes: number;
  /** Ends the next day (the end time is at or before the start time). */
  overnight: boolean;
};

/**
 * The new start and end as UTC, from a day and two clock times on the
 * shift's own clock. An end at or before the start finishes the next day,
 * as a night shift does.
 */
export function buildShiftRange(day: string, start: string, end: string, tz?: string | null): ShiftRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const overnight = minutesOf(end) <= minutesOf(start);
  const endDay = overnight ? addDaysToKey(day, 1) : day;
  const startIso = datetimeLocalValueToUtcIso(`${day}T${start}`, tz);
  const endIso = datetimeLocalValueToUtcIso(`${endDay}T${end}`, tz);
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  return { startIso, endIso, minutes, overnight };
}

/** "4 h", "2 h 30 min", "45 min". */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
