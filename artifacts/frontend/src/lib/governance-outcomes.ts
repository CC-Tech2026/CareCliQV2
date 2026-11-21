import type { HubComplianceAlert } from "@/services/hubService";
import type { MdDemandCapacity } from "@/services/dashboardService";

/**
 * The director's briefing as outcomes (where the organisation stands, in
 * words) and actions (what to do about it, most urgent first). Pure: the
 * hub page feeds in what it has already loaded.
 */

export type OutcomeStatus = "on_track" | "attention" | "off_track" | "no_data";

export type Outcome = {
  id: "goals" | "quality" | "safety" | "workforce" | "demand";
  area: string;
  status: OutcomeStatus;
  headline: string;
  detail: string;
  action: { label: string; href: string };
};

export type ActionGroup = "now" | "week" | "watch";

export type ActionItem = {
  id: string;
  group: ActionGroup;
  /** Lower comes first within a group: safety before paperwork. */
  rank?: number;
  title: string;
  detail: string;
  due?: string | null;
  actionLabel: string;
  href: string;
};

/** What the director dashboard endpoint returns that these need. */
export type OutcomeInputs = {
  goals_active?: number | null;
  active_goals_supported_30d?: number | null;
  compliance_score?: number | null;
  compliance_target?: number | null;
  documentation_summary?: { scored: number } | null;
  incidents_this_month?: number | null;
  staff_retention_rate?: number | null;
  active_staff?: number | null;
  workers_at_risk?: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function goalsOutcome(md: OutcomeInputs): Outcome {
  const active = md.goals_active ?? 0;
  const supported = Math.min(md.active_goals_supported_30d ?? 0, active);
  const action = { label: "Review participants", href: "/onboard-participant/active" };
  if (!active) {
    return {
      id: "goals", area: "Participants' goals", status: "no_data",
      headline: "No active participant goals are recorded yet",
      detail: "Goals are what support is measured against. Add them in each participant's NDIS plan.",
      action,
    };
  }
  const pct = (supported / active) * 100;
  const missing = active - supported;
  return {
    id: "goals", area: "Participants' goals",
    status: pct >= 80 ? "on_track" : pct >= 50 ? "attention" : "off_track",
    headline: `${supported} of ${active} active ${plural(active, "goal")} ${active === 1 ? "was" : "were"} worked on in the last 30 days`,
    detail: missing
      ? `${missing} ${plural(missing, "goal has", "goals have")} no shift notes against ${missing === 1 ? "it" : "them"}.`
      : "Every active goal had support recorded against it.",
    action,
  };
}

function qualityOutcome(md: OutcomeInputs): Outcome {
  const target = md.compliance_target ?? 90;
  const scored = md.documentation_summary?.scored ?? 0;
  const score = md.compliance_score;
  const behind = md.workers_at_risk?.length ?? 0;
  const action = { label: "Review shift notes", href: "/sessions" };
  if (!scored || score == null) {
    return {
      id: "quality", area: "Quality of support", status: "no_data",
      headline: "No shift notes have been scored yet",
      detail: `Notes are checked as workers finish shifts. The target is ${target}%.`,
      action,
    };
  }
  const gap = target - score;
  return {
    id: "quality", area: "Quality of support",
    status: gap <= 0 ? "on_track" : gap <= 10 ? "attention" : "off_track",
    headline: `${Math.round(score)}% of shift notes meet the documentation standard`,
    detail: [
      gap > 0 ? `${Math.round(gap)} points below the ${target}% target` : `At or above the ${target}% target`,
      behind ? `${behind} ${plural(behind, "worker needs", "workers need")} support` : null,
    ].filter(Boolean).join(". ") + ".",
    action,
  };
}

function safetyOutcome(md: OutcomeInputs, alerts: HubComplianceAlert[]): Outcome {
  const urgent = alerts.filter((a) => a.source === "incidents" && a.severity === "critical");
  const thisMonth = md.incidents_this_month ?? 0;
  const action = { label: "Open the incident register", href: "/incidents" };
  if (urgent.length) {
    return {
      id: "safety", area: "Safety", status: "off_track",
      headline: `${urgent.length} ${plural(urgent.length, "incident needs", "incidents need")} action now`,
      detail: urgent[0].title + (urgent.length > 1 ? `, and ${urgent.length - 1} more.` : "."),
      action,
    };
  }
  if (thisMonth) {
    return {
      id: "safety", area: "Safety", status: "attention",
      headline: `${thisMonth} ${plural(thisMonth, "incident")} recorded this month`,
      detail: "None is overdue. Check each one has its follow-up done.",
      action,
    };
  }
  return {
    id: "safety", area: "Safety", status: "on_track",
    headline: "No incidents recorded this month",
    detail: "Nothing is waiting on an NDIS notification.",
    action,
  };
}

function workforceOutcome(md: OutcomeInputs, alerts: HubComplianceAlert[]): Outcome {
  const creds = alerts.filter((a) => a.source === "credentials");
  const expired = creds.filter((a) => a.severity === "critical").length;
  const soon = creds.length - expired;
  const retention = md.staff_retention_rate;
  const staff = md.active_staff ?? 0;
  const retentionText = retention != null ? `Staff retention ${Math.round(retention)}%` : null;
  const action = { label: "Open staff", href: "/md/staff" };
  if (expired) {
    return {
      id: "workforce", area: "Workforce", status: "off_track",
      headline: `${expired} staff ${plural(expired, "credential has", "credentials have")} expired`,
      detail: [soon ? `${soon} more ${soon === 1 ? "expires" : "expire"} soon` : null, retentionText].filter(Boolean).join(". ") + ".",
      action,
    };
  }
  if (soon) {
    return {
      id: "workforce", area: "Workforce", status: "attention",
      headline: `${soon} staff ${plural(soon, "credential expires", "credentials expire")} soon`,
      detail: [`None has expired yet`, retentionText].filter(Boolean).join(". ") + ".",
      action,
    };
  }
  return {
    id: "workforce", area: "Workforce", status: "on_track",
    headline: "Every staff credential is current",
    detail: [retentionText, `${staff} active ${plural(staff, "staff member", "staff")}`].filter(Boolean).join(". ") + ".",
    action,
  };
}

function demandOutcome(demand: MdDemandCapacity | null | undefined): Outcome | null {
  if (!demand) return null;
  const waiting = demand.waitlist.count;
  const wanted = Math.round(demand.waitlist.hours);
  const free = Math.round(demand.capacity.reliable_hours + demand.capacity.casual_hours);
  const action = { label: "Review enquiries", href: "/onboard-participant" };
  if (!waiting) {
    return {
      id: "demand", area: "Growth", status: "on_track",
      headline: "No enquiries are waiting",
      detail: `${free} hours of staff time are free this week for new participants.`,
      action,
    };
  }
  const fits = free >= wanted;
  return {
    id: "demand", area: "Growth", status: fits ? "attention" : "off_track",
    headline: `${waiting} ${plural(waiting, "enquiry is", "enquiries are")} waiting, asking for ${wanted} hours a week`,
    detail: fits
      ? `${free} hours of staff time are free this week, enough to take ${waiting === 1 ? "it" : "them"} on.`
      : `Only ${free} hours of staff time are free this week. Recruit or rebalance before accepting.`,
    action,
  };
}

export function buildOutcomes(md: OutcomeInputs, alerts: HubComplianceAlert[], demand?: MdDemandCapacity | null): Outcome[] {
  return [
    goalsOutcome(md),
    qualityOutcome(md),
    safetyOutcome(md, alerts),
    workforceOutcome(md, alerts),
    demandOutcome(demand),
  ].filter((o): o is Outcome => !!o);
}

const GROUP_BY_SEVERITY: Record<string, ActionGroup | null> = {
  critical: "now",
  high: "week",
  medium: "watch",
  info: "watch",
  positive: null,
};

/**
 * One list of what to do: the attention items, workers who need help with
 * their notes, enquiries to screen and goals nobody is working on, grouped
 * by when they need doing. `routeFor` gives each attention item its page.
 */
/** "Tom Walsh: First Aid" as something to do: "Renew Tom Walsh's First Aid". */
export function credentialTitle(title: string, expired: boolean): string {
  const m = title.match(/^([^:]{2,80}):\s*(.+)$/);
  if (!m) return title;
  const [, person, credential] = m;
  const owner = person.trim().endsWith("s") ? `${person.trim()}'` : `${person.trim()}'s`;
  return expired ? `Renew ${owner} ${credential.trim()}` : `Follow up ${owner} ${credential.trim()} renewal`;
}

export function buildActions(
  md: OutcomeInputs,
  alerts: HubComplianceAlert[],
  demand: MdDemandCapacity | null | undefined,
  routeFor: (alert: HubComplianceAlert) => string,
): ActionItem[] {
  const items: ActionItem[] = [];
  for (const a of alerts) {
    // "positive" items say all is well: nothing to do, so not listed.
    const group = a.severity in GROUP_BY_SEVERITY ? GROUP_BY_SEVERITY[a.severity] : "watch";
    if (!group) continue;
    items.push({
      id: `alert-${a.id}`,
      group: a.category === "urgent" && group === "week" ? "now" : group,
      rank: a.source === "incidents" ? 0 : a.source === "credentials" ? 1 : 2,
      title: a.source === "credentials" ? credentialTitle(a.title, group === "now") : a.title,
      detail: a.detail,
      due: a.due_date ?? null,
      actionLabel: a.action_label || "Open",
      href: routeFor(a),
    });
  }
  for (const w of md.workers_at_risk ?? []) {
    items.push({
      id: `worker-${w.id}`,
      group: w.compliance_score < 70 ? "now" : "week",
      title: `Help ${w.full_name} with their shift notes`,
      detail: `${Math.round(w.compliance_score)}% across ${w.sessions} scored ${plural(w.sessions, "shift")}, below the 85% threshold.`,
      actionLabel: "Review their notes",
      href: `/md/staff?workerId=${encodeURIComponent(w.id)}&tab=shifts`,
    });
  }
  const waiting = demand?.waitlist.count ?? 0;
  if (waiting) {
    items.push({
      id: "enquiries",
      group: "week",
      title: `Screen ${waiting} new ${plural(waiting, "enquiry", "enquiries")}`,
      detail: `${Math.round(demand!.waitlist.hours)} hours a week requested by people waiting for support.`,
      actionLabel: "Review enquiries",
      href: "/onboard-participant",
    });
  }
  const unsupported = Math.max(0, (md.goals_active ?? 0) - (md.active_goals_supported_30d ?? 0));
  if (unsupported) {
    items.push({
      id: "goals",
      group: "week",
      title: `${unsupported} participant ${plural(unsupported, "goal has", "goals have")} had no support in 30 days`,
      detail: "Plan shifts around them, or update the goals if they've changed.",
      actionLabel: "Review participants",
      href: "/onboard-participant/active",
    });
  }
  const order: Record<ActionGroup, number> = { now: 0, week: 1, watch: 2 };
  return items.sort(
    (a, b) =>
      order[a.group] - order[b.group] ||
      (a.rank ?? 2) - (b.rank ?? 2) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999"),
  );
}
