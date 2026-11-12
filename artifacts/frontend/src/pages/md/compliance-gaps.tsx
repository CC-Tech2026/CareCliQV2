import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Section, StatusText, Surface, outlineClass, toneColor, type Tone } from "@/components/layout/PageKit";
import type { Area, AuditChecklist, AuditItem } from "@/services/auditReadinessService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

/** The parts of /api/dashboard/managing-director the gap analysis reads. */
export interface GapInput {
  compliance_score: number;
  compliance_target: number;
  common_issues: Array<{ issue: string; count: number }>;
  org_alerts: Array<{ type: string; severity: string; message: string }>;
  team_compliance_breakdown: { compliant: number; at_risk: number; non_compliant: number };
  goals_active?: number | null;
  active_goals_supported_30d?: number | null;
}

export interface GapReason {
  text: string;
  detail?: string;
  href?: string;
  critical?: boolean;
}

export interface Gap {
  key: string;
  title: string;
  /** What the figure counts, so it isn't mistaken for another score. */
  measures: string;
  value: string;
  target: string;
  tone: Tone;
  /** The gap in one sentence. */
  summary: string;
  /** Why the figure is low: the causes, most common first. */
  reasons: GapReason[];
  /** What to do about it, in order. */
  fixes: string[];
  action: { href: string; label: string };
  critical: number;
}

export interface GapReport {
  gaps: Gap[];
  onTrack: Array<{ label: string; value: string }>;
  criticalTotal: number;
}

// The shift note rules (compliance_engine.py R1 to R12): what a failed rule
// means in plain words, and how a provider fixes it.
const RULES: Record<string, { label: string; fix: string }> = {
  R1: { label: "Shift times missing or not matching the roster", fix: "Make sure workers clock in and out on the shift, and correct shift times before the note is submitted." },
  R2: { label: "Notes written more than 48 hours after the shift", fix: "Ask staff to finish notes on the day of the shift, and review late notes each week." },
  R3: { label: "Notes too short to evidence the support", fix: "Coach staff to record what support was given, how the participant responded and progress toward goals." },
  R4: { label: "Support type not recorded", fix: "Set the support type on every shift in Rostering so each note carries it." },
  R5: { label: "Notes not linked to an NDIS goal", fix: "Add goal tasks to each participant's plan and roster shifts against them, so notes are written under a goal." },
  R6: { label: "Opinion-based rather than objective language", fix: "Coach staff to describe what they saw and heard, not their opinions." },
  R7: { label: "Language that isn't person-first", fix: "Share person-first wording with staff, for example \"a person with disability\"." },
  R8: { label: "Possible scope-of-practice concerns", fix: "Check the support described is within the worker's role, and follow up with them." },
  R9: { label: "Possible incident not reported", fix: "Check whether an incident report is needed, and lodge it within 24 hours if so." },
  R10: { label: "Restrictive practice not linked to an incident report", fix: "Link or lodge the incident report, and check the practice is authorised in the behaviour support plan." },
  R11: { label: "Notes copied from earlier notes", fix: "Ask staff to write each note fresh for that shift." },
  R12: { label: "Participant's response not recorded", fix: "Prompt staff to record how the participant responded to the support." },
};
const BUDGET = {
  label: "Participant budgets near or over their limit",
  fix: "Review the plan budget with the participant or their plan manager before rostering more support.",
};

/** Groups the backend's issue strings ("R2: Note completed 4 days after...")
 *  by rule, so the same problem worded slightly differently counts once. */
export function groupIssues(issues: GapInput["common_issues"]) {
  const groups = new Map<string, { label: string; fix?: string; count: number }>();
  for (const { issue, count } of issues) {
    const code = issue.match(/^(R\d+):/)?.[1];
    const known = code ? RULES[code] : /budget/i.test(issue) ? BUDGET : undefined;
    const key = code ?? (known ? "budget" : issue);
    const label = known?.label ?? issue.replace(/^R\d+:\s*/, "");
    const existing = groups.get(key);
    if (existing) existing.count += count;
    else groups.set(key, { label, fix: known?.fix, count });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function names(list: string[]) {
  const unique = [...new Set(list.filter(Boolean))];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}

const GAP_STATUSES = new Set(["missing", "overdue", "awaiting_review"]);

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** One step per requirement, naming it: the checklist's own next action is
 *  "Add or link evidence. <hint>" for every missing item, which reads the
 *  same over and over in a list. */
function fixFor(group: AuditItem[]): string {
  const first = group.find((i) => i.status === "missing") ?? group[0];
  if (first.status === "overdue") return `${first.title}: replace or re-review the evidence, as it's no longer current.`;
  const hint = first.next_action.replace(/^Add or link evidence\.\s*/, "");
  const prefixed = hint !== first.next_action;
  return `${first.title}: ${prefixed ? "add " : ""}${lowerFirst(hint || "add or link current evidence.")}`;
}

const EVIDENCE_AREAS: Array<{ key: string; areas: Area[]; title: string; measures: string; link: string; actionLabel: string }> = [
  {
    key: "staff",
    areas: ["staff"],
    title: "Staff files",
    measures: "Screening, Working with Children Check, first aid, induction and other staff requirements.",
    link: "/md/compliance?view=checklist&area=staff",
    actionLabel: "Open staff evidence",
  },
  {
    key: "participant",
    areas: ["participant"],
    title: "Participant files",
    measures: "Service agreements, plans, risk assessments and other participant requirements.",
    link: "/md/compliance?view=checklist&area=participant",
    actionLabel: "Open participant evidence",
  },
  {
    key: "organisation",
    areas: ["governance", "quality", "insurance"],
    title: "Organisation evidence",
    measures: "Policies, governance, quality systems and insurance.",
    link: "/md/compliance?view=checklist",
    actionLabel: "Open the evidence checklist",
  },
];

function evidenceGap(
  def: (typeof EVIDENCE_AREAS)[number],
  checklist: AuditChecklist,
): { gap?: Gap; onTrack?: { label: string; value: string } } {
  const totals = checklist.summary.by_area.filter((a) => def.areas.includes(a.area));
  const total = totals.reduce((sum, a) => sum + a.total, 0);
  const ready = totals.reduce((sum, a) => sum + a.ready, 0);
  const listed = totals.reduce((sum, a) => sum + a.gaps, 0);
  if (!total) return {};
  const pct = Math.round((100 * ready) / total);
  const items = checklist.items.filter((i) => def.areas.includes(i.area) && GAP_STATUSES.has(i.status));
  const awaiting = items.filter((i) => i.status === "awaiting_review");
  const open = items.filter((i) => i.status !== "awaiting_review");
  if (!listed && !items.length) return { onTrack: { label: def.title, value: `${pct}%` } };

  // One reason per requirement, the critical and most widespread first.
  const byRequirement = new Map<string, AuditItem[]>();
  for (const item of open) byRequirement.set(item.requirement_code, [...(byRequirement.get(item.requirement_code) ?? []), item]);
  const groups = [...byRequirement.values()].sort(
    (a, b) => Number(b.some((i) => i.critical)) - Number(a.some((i) => i.critical)) || b.length - a.length,
  );
  const critical = open.filter((i) => i.critical).length;
  const area = def.areas.length === 1 ? `&area=${def.areas[0]}` : "";
  const reasons: GapReason[] = groups.slice(0, 4).map((group) => {
    const missing = group.filter((i) => i.status === "missing").length;
    const overdue = group.filter((i) => i.status === "overdue").length;
    const who = group[0].subject_type === "organisation" ? "" : ` · ${names(group.map((i) => i.subject_name))}`;
    return {
      text: group[0].title,
      detail: [missing && `${missing} missing`, overdue && `${overdue} overdue`].filter(Boolean).join(", ") + who,
      href: `/md/compliance?view=checklist${area}&status=gaps&q=${encodeURIComponent(group[0].title)}`,
      critical: group.some((i) => i.critical),
    };
  });
  if (groups.length > 4) reasons.push({ text: `${plural(groups.length - 4, "more requirement")} with gaps` });
  if (awaiting.length) {
    reasons.push({
      text: `${plural(awaiting.length, "document")} uploaded and waiting for approval`,
      detail: "Evidence only counts once someone authorised approves it.",
      href: `/md/compliance?view=checklist${area}&status=awaiting_review`,
    });
  }

  const fixes = groups.slice(0, 3).map(fixFor);
  if (awaiting.length) fixes.push(`Approve the ${plural(awaiting.length, "document")} waiting for review.`);
  if (!fixes.length) fixes.push("Open the checklist, then upload or link current evidence for each requirement marked missing or overdue.");

  const gapCount = open.length || listed;
  return {
    gap: {
      key: def.key,
      title: def.title,
      measures: def.measures,
      value: `${pct}%`,
      target: "Target 100%",
      tone: critical ? "danger" : pct < 60 ? "danger" : "warning",
      summary: `${plural(gapCount, "requirement")} missing or overdue out of ${total}${critical ? `, ${critical} critical` : ""}${
        awaiting.length ? `. ${awaiting.length} more ${awaiting.length === 1 ? "is" : "are"} waiting for approval` : ""
      }.`,
      reasons,
      fixes,
      action: { href: `${def.link}&status=gaps`, label: def.actionLabel },
      critical,
    },
  };
}

/** Everything that stands between the provider and audit ready: what each gap
 *  is, why it's there and how to close it. Most urgent first. */
export function buildGaps({
  data,
  checklist,
  attentionWorkers,
  workersBelow,
}: {
  data: GapInput;
  checklist?: AuditChecklist;
  attentionWorkers: Array<{ id: string; full_name: string; compliance_score: number }>;
  workersBelow: number;
}): GapReport {
  const gaps: Gap[] = [];
  const onTrack: GapReport["onTrack"] = [];
  const { compliant, at_risk: atRisk, non_compliant: nonCompliant } = data.team_compliance_breakdown;
  const scored = compliant + atRisk + nonCompliant;
  const score = data.compliance_score;
  const target = data.compliance_target;

  // Shift note documentation
  if (scored && (score < target || nonCompliant > 0)) {
    const issues = groupIssues(data.common_issues);
    const reasons: GapReason[] = issues.slice(0, 4).map((issue) => ({
      text: issue.label,
      detail: `${plural(issue.count, "note")} flagged`,
      href: "/sessions?band=non_compliant",
    }));
    if (!reasons.length && nonCompliant) reasons.push({ text: `${plural(nonCompliant, "note")} scored under 60%` });
    const fixes = issues.map((i) => i.fix).filter((f): f is string => Boolean(f)).slice(0, 3);
    if (nonCompliant) fixes.push("Open the non-compliant notes, ask each worker to correct theirs, and check the new score.");
    gaps.push({
      key: "documentation",
      title: "Shift note documentation",
      measures: "How well shift notes evidence the support delivered, averaged over the most recent scored notes.",
      value: `${score}%`,
      target: `Target ${target}%`,
      tone: score < 60 ? "danger" : "warning",
      summary:
        score < target
          ? `${Math.round(target - score)} points below target. ${plural(nonCompliant, "note")} non-compliant and ${atRisk} at risk out of ${scored} scored.`
          : `On target overall, but ${plural(nonCompliant, "non-compliant note")} would fail if an auditor sampled them.`,
      reasons,
      fixes,
      action: { href: nonCompliant ? "/sessions?band=non_compliant" : "/sessions", label: nonCompliant ? "Review non-compliant notes" : "Review shift notes" },
      critical: 0,
    });
  } else if (scored) {
    onTrack.push({ label: "Shift note documentation", value: `${score}%` });
  }

  // High-priority alerts
  const high = data.org_alerts.filter((a) => a.severity === "high");
  if (high.length) {
    gaps.push({
      key: "alerts",
      title: "High-priority alerts",
      measures: "Compliance alerts raised from shift notes, incidents and credentials.",
      value: String(high.length),
      target: "Target 0",
      tone: "danger",
      summary: `${plural(high.length, "high-priority alert")} without a recorded response.`,
      reasons: high.slice(0, 4).map((a) => ({ text: a.message })),
      fixes: ["Open each alert, act on it and record what was done, so the record shows follow-up."],
      action: { href: "/md/staff", label: "Review alerts" },
      critical: high.length,
    });
  }

  // Staff whose notes fall short
  if (workersBelow > 0) {
    gaps.push({
      key: "workers",
      title: "Staff documentation",
      measures: "Each worker's average shift note score. It doesn't cover credentials.",
      value: String(workersBelow),
      target: "Target 0 under 85%",
      tone: "warning",
      summary: `${plural(workersBelow, "worker")} whose notes average under 85%.`,
      reasons: attentionWorkers.slice(0, 4).map((w) => ({
        text: w.full_name,
        detail: `${w.compliance_score}% average`,
        href: `/md/staff?workerId=${w.id}`,
      })),
      fixes: [
        "Go through two or three recent notes with each worker, starting with the lowest score.",
        "Focus on the most common documentation issue, then check their next notes.",
      ],
      action: { href: "/md/staff", label: "Open staff" },
      critical: 0,
    });
  } else if (scored) {
    onTrack.push({ label: "Staff documentation", value: "All 85%+" });
  }

  // Evidence checklist areas (skipped if the checklist didn't load properly)
  if (checklist?.summary?.by_area && Array.isArray(checklist.items)) {
    for (const def of EVIDENCE_AREAS) {
      const result = evidenceGap(def, checklist);
      if (result.gap) gaps.push(result.gap);
      if (result.onTrack) onTrack.push(result.onTrack);
    }
  }

  // Participant goals
  if (data.goals_active && data.active_goals_supported_30d != null) {
    const pct = Math.round((data.active_goals_supported_30d / data.goals_active) * 100);
    const unsupported = data.goals_active - data.active_goals_supported_30d;
    if (pct < 85) {
      gaps.push({
        key: "goals",
        title: "Participant goals",
        measures: "Active goals with support recorded against them in the last 30 days.",
        value: `${pct}%`,
        target: "Target 85%",
        tone: pct < 60 ? "danger" : "warning",
        summary: `${plural(unsupported, "active goal")} had no shift note written under it in the last 30 days.`,
        reasons: [{ text: `${data.active_goals_supported_30d} of ${data.goals_active} active goals have recent support recorded` }],
        fixes: [
          "Roster shifts with each goal's tasks, so workers write their notes under the goal.",
          "Close or update goals that are no longer being worked on.",
        ],
        action: { href: "/onboard-participant/active", label: "Open participants" },
        critical: 0,
      });
    } else {
      onTrack.push({ label: "Participant goals", value: `${pct}%` });
    }
  }

  const rank = (g: Gap) => (g.tone === "danger" ? 0 : 1);
  gaps.sort((a, b) => rank(a) - rank(b) || b.critical - a.critical);
  return { gaps, onTrack, criticalTotal: gaps.reduce((sum, g) => sum + g.critical, 0) };
}

function GapCard({ gap }: { gap: Gap }) {
  return (
    <li>
      <Surface className="flex flex-col gap-4 p-5 sm:flex-row sm:gap-6 sm:p-6">
        <div className="shrink-0 sm:w-24">
          <p className="text-2xl font-semibold tabular-nums leading-none" style={{ color: toneColor(gap.tone) }}>{gap.value}</p>
          <p className="mt-1.5 text-xs" style={{ color: MUTED }}>{gap.target}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold" style={{ color: TEXT }}>{gap.title}</h3>
              {gap.critical > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}
                >
                  {gap.critical} critical
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-6" style={{ color: TEXT }}>{gap.summary}</p>
            <p className="text-xs leading-5" style={{ color: MUTED }}>{gap.measures}</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold" style={{ color: MUTED }}>Why it's low</h4>
              {gap.reasons.length ? (
                <ul className="mt-2 space-y-2">
                  {gap.reasons.map((reason, index) => {
                    const body = (
                      <>
                        <span className="block text-sm font-medium" style={{ color: TEXT }}>
                          {reason.text}
                          {reason.critical && <span className="ml-1.5 text-xs font-semibold" style={{ color: "var(--cc-danger-text)" }}>Critical</span>}
                        </span>
                        {reason.detail && <span className="block text-xs leading-5" style={{ color: MUTED }}>{reason.detail}</span>}
                      </>
                    );
                    return (
                      <li key={`${reason.text}-${index}`} className="border-l-2 pl-3" style={{ borderColor: toneColor(gap.tone) }}>
                        {reason.href ? <Link href={reason.href} className="block rounded hover:underline">{body}</Link> : body}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm" style={{ color: MUTED }}>Open the details to see each item.</p>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold" style={{ color: MUTED }}>How to fix it</h4>
              <ol className="mt-2 list-decimal space-y-2 pl-4 text-sm leading-6" style={{ color: TEXT }}>
                {gap.fixes.map((fix) => <li key={fix}>{fix}</li>)}
              </ol>
            </div>
          </div>

          <Link href={gap.action.href} className={outlineClass}>
            {gap.action.label} <ArrowRight size={14} />
          </Link>
        </div>
      </Surface>
    </li>
  );
}

export function GapAnalysis({ report, checklistState }: { report: GapReport; checklistState: "loading" | "error" | "ready" }) {
  const { gaps, onTrack, criticalTotal } = report;
  return (
    <Section
      title="Gap analysis"
      description="What stands between you and audit ready: each gap, why it's there and how to close it. Most urgent first."
      action={
        <StatusText tone={!gaps.length ? "good" : criticalTotal ? "danger" : "warning"}>
          {!gaps.length ? "Audit ready" : `${plural(gaps.length, "gap")} to close${criticalTotal ? ` · ${criticalTotal} critical` : ""}`}
        </StatusText>
      }
    >
      {checklistState !== "ready" && (
        <p role="status" className="text-sm" style={{ color: MUTED }}>
          {checklistState === "loading"
            ? "Checking staff, participant and organisation evidence..."
            : "Evidence figures couldn't be loaded, so the gaps below cover shift notes and staff only."}
        </p>
      )}
      {gaps.length ? (
        <ul className="space-y-3">
          {gaps.map((gap) => <GapCard key={gap.key} gap={gap} />)}
        </ul>
      ) : (
        <Surface className="flex items-center gap-3 p-5">
          <CheckCircle2 size={18} style={{ color: "var(--cc-green)" }} />
          <p className="text-sm" style={{ color: TEXT }}>
            Every measure is on target and every requirement has current evidence. Keep reviewing new notes each week.
          </p>
        </Surface>
      )}
      {onTrack.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" style={{ color: MUTED }}>
          <span className="flex items-center gap-1.5 font-medium" style={{ color: TEXT }}>
            <CheckCircle2 size={15} style={{ color: "var(--cc-green)" }} /> On target
          </span>
          {onTrack.map((item) => (
            <span key={item.label}>
              {item.label} <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{item.value}</span>
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}
