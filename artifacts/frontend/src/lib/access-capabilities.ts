/**
 * Plain-language names for the delegated-access capabilities, shared by the
 * director's Delegated Access screen, the coordinator's own view and the
 * "temporary access" banners. The backend catalog
 * (access_grant_service.CAPABILITIES) stays the source of which keys exist;
 * anything it adds that isn't listed here falls back to its backend label.
 */
export type CapabilityGroup = "Staff and hiring" | "Training" | "Money" | "Oversight" | "Organisation";

export type CapabilityInfo = {
  name: string;
  /** What the coordinator will be able to do, in one sentence. */
  does: string;
  /** Where they will find it. */
  where: { label: string; href: string };
  group: CapabilityGroup;
  /** Hard to undo or affects money; the grant form says so. */
  highImpact?: boolean;
};

export const CAPABILITY_GROUPS: CapabilityGroup[] = ["Staff and hiring", "Money", "Training", "Oversight", "Organisation"];

export const CAPABILITY_INFO: Record<string, CapabilityInfo> = {
  staff_invitations: {
    name: "Invite new staff",
    does: "Send invitations so new workers and coordinators can join.",
    where: { label: "Team", href: "/team" },
    group: "Staff and hiring",
  },
  applicant_offer_reject: {
    name: "Make offers to applicants",
    does: "Offer a job to an applicant, or turn them down.",
    where: { label: "Staff onboarding", href: "/md/staff-onboarding" },
    group: "Staff and hiring",
  },
  hire_paperwork: {
    name: "Prepare hiring paperwork",
    does: "Create and send offer letters and employment agreements for new hires.",
    where: { label: "Staff onboarding", href: "/md/staff-onboarding" },
    group: "Staff and hiring",
  },
  reassign_coordinator: {
    name: "Change a worker's coordinator",
    does: "Move a support worker to a different coordinator.",
    where: { label: "Team", href: "/team" },
    group: "Staff and hiring",
  },
  delete_staff_account: {
    name: "Delete staff accounts",
    does: "Permanently remove a staff member's account. This can't be undone.",
    where: { label: "Team", href: "/team" },
    group: "Staff and hiring",
    highImpact: true,
  },
  onboarding_program_design: {
    name: "Build onboarding training",
    does: "Write onboarding courses and approve workers moving through onboarding stages.",
    where: { label: "Competency & Training", href: "/md/onboarding/training" },
    group: "Training",
  },
  lock_training_module: {
    name: "Lock and unlock training modules",
    does: "Stop changes to a training module, or open it up again.",
    where: { label: "Competency & Training", href: "/md/onboarding/training" },
    group: "Training",
  },
  financial_overview: {
    name: "Finances and wages",
    does: "See revenue, costs, wages, net profit and cash runway, update cash and overheads, and see the revenue report on Invoices.",
    where: { label: "Finances", href: "/md/financial" },
    group: "Money",
  },
  governance_vault: {
    name: "Documents and audit",
    does: "Open the policy and governance vault, Audit & Compliance and audit readiness.",
    where: { label: "Documents & Audit Vault", href: "/md/vault" },
    group: "Oversight",
  },
  executive_dashboard: {
    name: "Performance review",
    does: "See the organisation-wide performance review.",
    where: { label: "Performance review", href: "/md/executive" },
    group: "Oversight",
  },
  org_branding: {
    name: "Change branding",
    does: "Update the organisation's logo and colours.",
    where: { label: "Settings, Branding", href: "/settings?section=branding" },
    group: "Organisation",
  },
  platform_billing: {
    name: "Manage the CareCliQ subscription",
    does: "Change the plan and payment details for your CareCliQ subscription.",
    where: { label: "Settings, Billing", href: "/settings?section=billing" },
    group: "Money",
    highImpact: true,
  },
};

export function capabilityName(capability: string, fallback?: string): string {
  return CAPABILITY_INFO[capability]?.name ?? fallback ?? capability;
}

/** "Tue 18 Nov, 5:00 pm" (year added when it isn't this year). */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** "in 3 hours", "in 2 days", "in 5 weeks". */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "ended";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "in under an hour";
  if (hours < 48) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}
