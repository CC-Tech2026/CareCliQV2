import type { AdminActivity, AttentionSeverity } from "@/services/adminService";

export function formatDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "today", "yesterday", "5 days ago", "3 months ago". */
export function timeAgo(value?: string | null) {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "never";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export const SEVERITY: Record<AttentionSeverity, { label: string; color: string; bg: string; rank: number }> = {
  urgent: { label: "Urgent", color: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)", rank: 0 },
  soon: { label: "Soon", color: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)", rank: 1 },
  info: { label: "Worth a look", color: "var(--cc-status-info)", bg: "var(--cc-status-info-bg)", rank: 2 },
};

export const PLAN_LABEL: Record<string, string> = { micro: "Micro", small: "Small", medium: "Medium" };

/** Plans that can be chosen now (2026-11-27 pricing). Micro is no longer on
 *  sale; organisations already on it still show as Micro. */
export const PLANS_ON_SALE = [
  { tier: "small", label: "Small" },
  { tier: "medium", label: "Medium" },
] as const;

export function roleLabel(role: string) {
  return (
    {
      managing_director: "Managing director",
      support_coordinator: "Coordinator",
      support_worker: "Support worker",
      participant: "Participant portal",
    }[role] ?? role.replace(/_/g, " ")
  );
}

/** What a CareCliQ staff action on an account was, in plain words. */
export function activityLabel(a: AdminActivity) {
  const after = (a.after_state ?? {}) as Record<string, unknown>;
  const who = typeof after.email === "string" ? ` for ${after.email}` : "";
  switch (a.action_type) {
    case "admin.subscription.updated": {
      const bits: string[] = [];
      if (after.plan_tier) bits.push(`plan set to ${PLAN_LABEL[String(after.plan_tier)] ?? after.plan_tier}`);
      if ("access_override_until" in after) {
        bits.push(after.access_override_until ? `free access until ${formatDate(String(after.access_override_until))}` : "free access ended");
      }
      return bits.length ? `Subscription: ${bits.join(", ")}` : "Subscription changed";
    }
    case "admin.trial.extended":
      return `Trial extended by ${after.days} days, to ${formatDate(String(after.trial_ends_at))}`;
    case "admin.user.deactivated": return `Deactivated an account${who}`;
    case "admin.user.reactivated": return `Reactivated an account${who}`;
    case "admin.user.password_reset_sent": return `Sent a password reset${who}`;
    case "admin.user.role_changed": return `Changed a role${who} to ${roleLabel(String(after.role))}`;
    case "admin.import.participants": return `Imported ${after.imported} participants`;
    case "admin.import.staff": return `Prepared ${after.imported} staff invitations for the managing director`;
    case "admin.held_staff.discarded": return `Removed ${after.discarded} prepared invitations`;
    case "admin.message.sent":
      return `Sent ${after.category === "news" ? "news" : "a service notice"}: "${String(after.subject ?? "")}"`;
    case "platform.banner.created": return `Put up a site banner: "${String(after.message ?? "")}"`;
    case "platform.banner.ended": return "Took down a site banner";
    case "admin.organization.suspended": return "Suspended the organisation";
    case "admin.organization.reactivated": return "Reactivated the organisation";
    default: return a.action_type.replace(/^admin\./, "").replace(/[._]/g, " ");
  }
}
