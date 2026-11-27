import type { HubComplianceAlert } from "@/services/hubService";
import type { MdDemandCapacity } from "@/services/dashboardService";

/**
 * The director's briefing as outcomes (where the organisation stands, in
 * words) and actions (what to do about it, most urgent first). Pure: the
 * hub page feeds in what it has already loaded.
 */

export type OutcomeStatus = "on_track" | "attention" | "off_track" | "no_data";

export type Outcome = {
  /** "goals", "quality", "safety", "workforce", "demand" on the hub; any key elsewhere. */
  id: string;
  area: string;
  status: OutcomeStatus;
  headline: string;
  detail: string;
  action: { label: string; href: string };
  /** A small bar on the tile when the outcome is a share: 0-100, with the target marked. */
  meter?: { pct: number; target?: number; label: string };
  /** The ring: a short figure, a one or two word name, a few words of status,
   *  and how full to draw it (0-100; a full ring when there's no share). */
  ring?: { value: string; label: string; caption: string; pct?: number };
};

export type ActionGroup = "now" | "week" | "watch";

/** What a task is about: picks its icon. */
export type ActionKind =
  | "incident" | "credential" | "notes" | "enquiry" | "goal"
  | "invoice" | "claim" | "money" | "evidence" | "people" | "other";

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
  kind?: ActionKind;
};

/** The kind of a task from where it leads, when it doesn't say. */
export function actionKind(item: Pick<ActionItem, "kind" | "href" | "id">): ActionKind {
  if (item.kind) return item.kind;
  const h = item.href;
  if (h.startsWith("/incidents")) return "incident";
  if (h.includes("tab=credentials") || h.includes("credential")) return "credential";
  if (h.includes("tab=shifts") || h.startsWith("/sessions")) return "notes";
  if (h.startsWith("/onboard-participant") && !h.includes("/active")) return "enquiry";
  if (h.includes("/active") || item.id === "goals") return "goal";
  if (h.includes("workspace=claims")) return "claim";
  if (h.includes("workspace=invoices") || h.includes("invoiceId")) return "invoice";
  if (h.startsWith("#")) return "money";
  if (h.includes("view=checklist")) return "evidence";
  if (h.startsWith("/md/staff")) return "people";
  return "other";
}

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
  const action = { label: "Review participant goals", href: "/onboard-participant/active" };
  if (!active) {
    return {
      id: "goals", area: "Participant goals", status: "no_data",
      headline: "No active participant goals recorded",
      detail: "Record each participant's goals from their NDIS plan so supports can be measured against them.",
      action,
    };
  }
  const pct = (supported / active) * 100;
  const missing = active - supported;
  return {
    id: "goals", area: "Participant goals",
    status: pct >= 80 ? "on_track" : pct >= 50 ? "attention" : "off_track",
    headline: `${supported} of ${active} active ${plural(active, "goal")} had supports delivered in the last 30 days`,
    detail: missing
      ? `${missing} ${plural(missing, "goal has", "goals have")} no progress notes recorded in this period.`
      : "Supports were delivered against every active goal.",
    action,
    meter: { pct, target: 80, label: "Goals with supports delivered" },
  };
}

function qualityOutcome(md: OutcomeInputs): Outcome {
  const target = md.compliance_target ?? 90;
  const scored = md.documentation_summary?.scored ?? 0;
  const score = md.compliance_score;
  const behind = md.workers_at_risk?.length ?? 0;
  const action = { label: "Review progress notes", href: "/sessions" };
  if (!scored || score == null) {
    return {
      id: "quality", area: "Documentation quality", status: "no_data",
      headline: "No progress notes have been assessed yet",
      detail: `Progress notes are assessed as each shift is completed. The target is ${target}%.`,
      action,
    };
  }
  const gap = target - score;
  return {
    id: "quality", area: "Documentation quality",
    status: gap <= 0 ? "on_track" : gap <= 10 ? "attention" : "off_track",
    headline: `${Math.round(score)}% of progress notes meet the documentation standard`,
    detail: [
      gap > 0 ? `${Math.round(gap)} percentage points below the ${target}% target` : `At or above the ${target}% target`,
      behind ? `${behind} ${plural(behind, "worker requires", "workers require")} documentation support` : null,
    ].filter(Boolean).join(". ") + ".",
    action,
    meter: { pct: score, target, label: "Progress notes meeting the standard" },
  };
}

function safetyOutcome(md: OutcomeInputs, alerts: HubComplianceAlert[]): Outcome {
  const urgent = alerts.filter((a) => a.source === "incidents" && a.severity === "critical");
  const thisMonth = md.incidents_this_month ?? 0;
  const action = { label: "Open incident register", href: "/incidents" };
  if (urgent.length) {
    return {
      id: "safety", area: "Incident management", status: "off_track",
      headline: `${urgent.length} ${plural(urgent.length, "incident is", "incidents are")} overdue for action`,
      detail: urgent[0].title + (urgent.length > 1 ? `, and ${urgent.length - 1} more.` : "."),
      action,
    };
  }
  if (thisMonth) {
    return {
      id: "safety", area: "Incident management", status: "attention",
      headline: `${thisMonth} ${plural(thisMonth, "incident")} reported this month`,
      detail: "No actions are overdue. Confirm follow-up actions are recorded for each incident.",
      action,
    };
  }
  return {
    id: "safety", area: "Incident management", status: "on_track",
    headline: "No incidents reported this month",
    detail: "No reportable incidents are awaiting notification to the NDIS Commission.",
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
  const action = { label: "Open worker records", href: "/md/staff" };
  if (expired) {
    return {
      id: "workforce", area: "Worker compliance", status: "off_track",
      headline: `${expired} worker ${plural(expired, "credential has", "credentials have")} expired`,
      detail: [soon ? `${soon} more ${soon === 1 ? "is" : "are"} due to expire` : null, retentionText].filter(Boolean).join(". ") + ".",
      action,
    };
  }
  if (soon) {
    return {
      id: "workforce", area: "Worker compliance", status: "attention",
      headline: `${soon} worker ${plural(soon, "credential is", "credentials are")} due to expire`,
      detail: [`None has expired`, retentionText].filter(Boolean).join(". ") + ".",
      action,
    };
  }
  return {
    id: "workforce", area: "Worker compliance", status: "on_track",
    headline: "All worker credentials are current",
    detail: [retentionText, `${staff} active ${plural(staff, "staff member")}`].filter(Boolean).join(". ") + ".",
    action,
  };
}

function demandOutcome(demand: MdDemandCapacity | null | undefined): Outcome | null {
  if (!demand) return null;
  const waiting = demand.waitlist.count;
  const wanted = Math.round(demand.waitlist.hours);
  const free = Math.round(demand.capacity.reliable_hours + demand.capacity.casual_hours);
  const action = { label: "Review referrals", href: "/onboard-participant" };
  if (!waiting) {
    return {
      id: "demand", area: "Capacity and referrals", status: "on_track",
      headline: "No referrals awaiting assessment",
      detail: `${free} hours of worker availability this week for new participants.`,
      action,
    };
  }
  const fits = free >= wanted;
  return {
    id: "demand", area: "Capacity and referrals", status: fits ? "attention" : "off_track",
    headline: `${waiting} ${plural(waiting, "referral", "referrals")} awaiting assessment, requesting ${wanted} hours of support a week`,
    detail: fits
      ? `${free} hours of worker availability this week, sufficient to accept ${waiting === 1 ? "it" : "them"}.`
      : `Only ${free} hours of worker availability this week. Recruit or reallocate rostered hours before accepting.`,
    action,
  };
}

export function buildOutcomes(md: OutcomeInputs, alerts: HubComplianceAlert[], demand?: MdDemandCapacity | null): Outcome[] {
  const rings = hubRings(md, alerts, demand);
  return [
    goalsOutcome(md),
    qualityOutcome(md),
    safetyOutcome(md, alerts),
    workforceOutcome(md, alerts),
    demandOutcome(demand),
  ]
    .filter((o): o is Outcome => !!o)
    .map((o) => ({ ...o, ring: rings[o.id] }));
}

/** The hub's rings: a figure, a name and a few words each, from the same
 *  inputs as the outcomes. */
export function hubRings(md: OutcomeInputs, alerts: HubComplianceAlert[], demand?: MdDemandCapacity | null): Record<string, Outcome["ring"]> {
  const active = md.goals_active ?? 0;
  const supported = Math.min(md.active_goals_supported_30d ?? 0, active);
  const scored = md.documentation_summary?.scored ?? 0;
  const score = md.compliance_score;
  const target = md.compliance_target ?? 90;
  const urgent = alerts.filter((a) => a.source === "incidents" && a.severity === "critical").length;
  const thisMonth = md.incidents_this_month ?? 0;
  const creds = alerts.filter((a) => a.source === "credentials");
  const expired = creds.filter((a) => a.severity === "critical").length;
  const soon = creds.length - expired;
  const retention = md.staff_retention_rate;
  const out: Record<string, Outcome["ring"]> = {
    goals: active
      ? { value: `${supported}/${active}`, label: "Participant goals", caption: "supported in 30 days", pct: (supported / active) * 100 }
      : { value: "None", label: "Participant goals", caption: "none recorded", pct: 0 },
    quality: scored && score != null
      ? { value: `${Math.round(score)}%`, label: "Progress notes", caption: score >= target ? "meets target" : `${Math.round(target - score)}% below target`, pct: score }
      : { value: "N/A", label: "Progress notes", caption: "not yet assessed", pct: 0 },
    safety: urgent
      ? { value: String(urgent), label: "Incidents", caption: "overdue for action" }
      : thisMonth
        ? { value: String(thisMonth), label: "Incidents", caption: "reported this month" }
        : { value: "0", label: "Incidents", caption: "none this month" },
    workforce: expired
      ? { value: String(expired), label: "Workforce", caption: "credentials expired" }
      : soon
        ? { value: String(soon), label: "Workforce", caption: "credentials due to expire" }
        : { value: retention != null ? `${Math.round(retention)}%` : "Current", label: "Workforce", caption: "staff retention", pct: retention ?? undefined },
  };
  if (demand) {
    const free = Math.round(demand.capacity.reliable_hours + demand.capacity.casual_hours);
    const waiting = demand.waitlist.count;
    out.demand = { value: `${free}h`, label: "Capacity", caption: waiting ? `${waiting} ${waiting === 1 ? "referral" : "referrals"} pending` : "available this week" };
  }
  return out;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The overview in two short sentences: the outstanding actions, then
 *  which areas are below target. "2 items require immediate action, and 3
 *  are due this week. Action required: Incidents and Workforce." */
export function briefingLine(outcomes: Outcome[], actions: ActionItem[]): { lead: string; rest: string } {
  const now = actions.filter((a) => a.group === "now").length;
  const week = actions.filter((a) => a.group === "week").length;
  let lead: string;
  if (now) lead = `${now} ${now === 1 ? "item requires" : "items require"} immediate action${week ? `, and ${week} ${week === 1 ? "is" : "are"} due this week` : ""}.`;
  else if (week) lead = `No items require immediate action. ${week} ${week === 1 ? "item is" : "items are"} due this week.`;
  else lead = "No actions are outstanding.";

  const name = (o: Outcome) => o.ring?.label ?? o.area;
  const off = outcomes.filter((o) => o.status === "off_track");
  const look = outcomes.filter((o) => o.status === "attention");
  const parts: string[] = [];
  if (off.length) parts.push(`Action required: ${joinNames(off.map(name))}.`);
  if (look.length) parts.push(`Review recommended: ${joinNames(look.map(name))}.`);
  const rest = parts.length
    ? parts.join(" ")
    : outcomes.some((o) => o.status === "on_track") ? "All areas meet their targets." : "";
  return { lead, rest };
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
/** "Tom Walsh: First Aid" as a register entry: "First Aid expired: Tom Walsh". */
export function credentialTitle(title: string, expired: boolean): string {
  const m = title.match(/^([^:]{2,80}):\s*(.+)$/);
  if (!m) return title;
  const [, person, raw] = m;
  // Some credential names arrive as keys ("first_aid"): show them as words.
  const credential = raw.includes("_")
    ? raw.trim().split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : raw;
  return expired ? `${credential.trim()} expired: ${person.trim()}` : `${credential.trim()} due for renewal: ${person.trim()}`;
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
      title: `Progress notes below standard: ${w.full_name}`,
      detail: `Average documentation score ${Math.round(w.compliance_score)}% across ${w.sessions} assessed ${plural(w.sessions, "shift")}, below the 85% threshold.`,
      actionLabel: "Review progress notes",
      href: `/md/staff?workerId=${encodeURIComponent(w.id)}&tab=shifts`,
    });
  }
  const waiting = demand?.waitlist.count ?? 0;
  if (waiting) {
    items.push({
      id: "enquiries",
      group: "week",
      title: `Assess ${waiting} new ${plural(waiting, "referral", "referrals")}`,
      detail: `${Math.round(demand!.waitlist.hours)} hours of support a week requested by people on the waitlist.`,
      actionLabel: "Review referrals",
      href: "/onboard-participant",
    });
  }
  const unsupported = Math.max(0, (md.goals_active ?? 0) - (md.active_goals_supported_30d ?? 0));
  if (unsupported) {
    items.push({
      id: "goals",
      group: "week",
      title: `${unsupported} participant ${plural(unsupported, "goal has", "goals have")} had no supports delivered in 30 days`,
      detail: "Schedule supports against these goals, or review them with the participant if their needs have changed.",
      actionLabel: "Review participant goals",
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
