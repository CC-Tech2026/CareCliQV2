/**
 * At-a-glance facts for the Managing Director's staff and participant
 * directories. Kept free of React so the wording and thresholds are tested
 * on their own (directory-insights.test.ts).
 */
import type { Credential } from "@/services/credentialsService";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Credentials expiring within this many days count as "expiring soon". */
export const CREDENTIAL_WARNING_DAYS = 30;
/** Plans ending within this many days need a review booked. */
export const PLAN_REVIEW_DAYS = 60;

export type Tone = "good" | "info" | "warning" | "danger" | "neutral";

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseDate(value?: string | null): number | null {
  if (!value) return null;
  // Date-only strings are local calendar dates, not UTC midnights.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function daysUntil(value: string | null | undefined, today: Date): number | null {
  const time = parseDate(value);
  return time === null ? null : Math.round((time - startOfDay(today)) / DAY_MS);
}

// ── Staff ────────────────────────────────────────────────────────────────

export interface CredentialSummary {
  total: number;
  expired: number;
  expiring: number;
  awaitingReview: number;
  /** Short label for the directory cell, e.g. "1 expired". */
  label: string;
  tone: Tone;
}

/** Groups the org's credentials by worker and says what needs doing first. */
export function summariseCredentials(
  credentials: Credential[],
  today: Date = new Date(),
): Map<string, CredentialSummary> {
  const byUser = new Map<string, Credential[]>();
  for (const credential of credentials) {
    const userId = credential.user_id ?? credential.user?.id;
    if (!userId || credential.status === "rejected") continue;
    byUser.set(userId, [...(byUser.get(userId) ?? []), credential]);
  }

  const out = new Map<string, CredentialSummary>();
  for (const [userId, list] of byUser) {
    let expired = 0;
    let expiring = 0;
    let awaitingReview = 0;
    for (const credential of list) {
      const days = daysUntil(credential.expiry_date, today);
      if (credential.status === "expired" || (days !== null && days < 0)) expired += 1;
      else if (credential.status === "expiring" || (days !== null && days <= CREDENTIAL_WARNING_DAYS)) expiring += 1;
      else if (credential.status === "pending_review") awaitingReview += 1;
    }
    const total = list.length;
    let label = `All ${total} current`;
    let tone: Tone = "good";
    if (expired > 0) {
      label = `${expired} expired`;
      tone = "danger";
    } else if (expiring > 0) {
      label = `${expiring} expiring soon`;
      tone = "warning";
    } else if (awaitingReview > 0) {
      label = `${awaitingReview} awaiting review`;
      tone = "info";
    }
    out.set(userId, { total, expired, expiring, awaitingReview, label, tone });
  }
  return out;
}

/** Unsubmitted and flagged shift notes, worst first. */
export function notesStatus(drafts: number, flagged: number): { label: string; tone: Tone } {
  if (flagged > 0) {
    const draftText = drafts > 0 ? ` · ${drafts} draft${drafts === 1 ? "" : "s"}` : "";
    return { label: `${flagged} flagged${draftText}`, tone: "danger" };
  }
  if (drafts > 0) return { label: `${drafts} to finish`, tone: "warning" };
  return { label: "Up to date", tone: "neutral" };
}

export function employmentLabel(type?: string | null): string | null {
  if (type === "full_time") return "Full time";
  if (type === "part_time") return "Part time";
  if (type === "casual") return "Casual";
  return null;
}

// ── Participants ─────────────────────────────────────────────────────────

/** When the NDIS plan ends, phrased for a quick scan. */
export function planEndStatus(
  planEnd?: string | null,
  today: Date = new Date(),
): { label: string; detail: string; tone: Tone; days: number | null } {
  const days = daysUntil(planEnd, today);
  if (days === null || !planEnd) {
    return { label: "No plan dates", detail: "Add them in the plan", tone: "neutral", days: null };
  }
  const date = new Date(parseDate(planEnd)!).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (days < 0) {
    const ago = -days;
    return { label: date, detail: `Ended ${ago} day${ago === 1 ? "" : "s"} ago`, tone: "danger", days };
  }
  if (days === 0) return { label: date, detail: "Ends today", tone: "danger", days };
  if (days <= PLAN_REVIEW_DAYS) {
    return { label: date, detail: `Ends in ${days} day${days === 1 ? "" : "s"}`, tone: "warning", days };
  }
  const months = Math.round(days / 30);
  return { label: date, detail: `In ${months} month${months === 1 ? "" : "s"}`, tone: "neutral", days };
}

function compactDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(value)}`;
}

/**
 * How much of the plan budget has been used. With plan dates, spending is
 * judged against how far through the plan we are (50% spent halfway through
 * is fine; 80% spent halfway through is not). Without them, fixed thresholds.
 */
export function budgetUsage(
  total?: number | string | null,
  used?: number | string | null,
  plan?: { start?: string | null; end?: string | null; today?: Date },
): { percent: number | null; label: string; detail: string; tone: Tone } {
  const totalValue = Number(total ?? 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return { percent: null, label: "No budget set", detail: "", tone: "neutral" };
  }
  const usedValue = Math.max(0, Number(used ?? 0) || 0);
  const percent = Math.round((usedValue / totalValue) * 100);
  let detail = `${compactDollars(usedValue)} of ${compactDollars(totalValue)}`;

  const start = parseDate(plan?.start);
  const end = parseDate(plan?.end);
  const now = startOfDay(plan?.today ?? new Date());
  let tone: Tone;
  if (percent >= 100) {
    tone = "danger";
  } else if (start !== null && end !== null && end > start) {
    const elapsed = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    const ahead = percent - elapsed;
    tone = ahead >= 25 ? "danger" : ahead >= 10 ? "warning" : "good";
    if (ahead >= 10) detail += " · ahead of plan";
  } else {
    tone = percent >= 90 ? "danger" : percent >= 75 ? "warning" : "good";
  }
  return { percent, label: `${percent}% used`, detail, tone };
}

export function planManagementLabel(type?: string | null): string | null {
  if (type === "NDIA-managed") return "NDIA managed";
  if (type === "plan-managed") return "Plan managed";
  if (type === "self-managed") return "Self managed";
  return null;
}
