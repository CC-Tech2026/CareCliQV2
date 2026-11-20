import { format, parseISO } from "date-fns";
import { zonedDate } from "@/lib/datetime";

/** Shared formatting/status helpers for participant detail + list views. */

/**
 * Format a date or timestamp from the API. A plain date ("1992-05-14") is
 * that calendar day. A timestamp is shown on the clock of `tz` (a shift's
 * or participant's zone) or else the user's own business location, never
 * the zone the computer happens to be in.
 */
export function safeFormat(dateStr?: string | null, fmt = "d MMM yyyy", tz?: string | null) {
  if (!dateStr) return "N/A";
  try {
    const isTimestamp = /T\d{2}:\d{2}/.test(dateStr);
    return format(isTimestamp ? zonedDate(dateStr, tz) : parseISO(dateStr), fmt);
  } catch {
    return dateStr;
  }
}

export function money(value?: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    review: "bg-sky-50 text-sky-700 border-sky-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    draft: "bg-slate-100 text-slate-600 border-slate-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
  };
  return map[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

export function complianceTone(score?: number | null) {
  if (score == null) return "bg-slate-100 text-slate-600 border-slate-200";
  if (score >= 85) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export function normalizeGoalTitle(goal: Record<string, unknown>, index: number) {
  return String(goal.title || goal.description || goal.name || `Goal ${index + 1}`);
}
