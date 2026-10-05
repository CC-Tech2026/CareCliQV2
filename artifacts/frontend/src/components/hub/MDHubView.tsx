import { useState } from "react";
import { useLocation } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Timer,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { appLocalDateKey } from "@/lib/datetime";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { COMPLIANCE_TREND_KEY, MD_DASHBOARD_KEY } from "@/lib/query-keys";
import { getMdDemandCapacity, type MdDemandCapacity } from "@/services/dashboardService";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Aliased — recharts also exports a "Tooltip" (used for the chart tooltips
// below), so both can't share the name in this file.
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";

const AMBER = "#9A5B0A";
const RED = "#B3261E";
const GREEN = "#0F7B57";
const BLUE = "#2A5C8A";
// Categorical pair for the Active staff ring (support workers vs coordinators) —
// validated against the dataviz palette checks: BLUE reads too gray as a
// categorical mark at this saturation, so the ring uses this sky blue instead.
const SKY = "#0EA5E9";

interface MDData {
  documentation_summary?: { sample_size: number; scored: number; unscored: number; on_target: number; needs_review: number; priority_review: number };
  active_participants: number;
  active_staff: number;
  support_workers: number;
  coordinators: number;
  participants_by_sex: { male: number; female: number; unspecified: number };
  participants_by_plan_status: { active: number; pending: number; review: number; expired: number; inactive: number };
  staff_retention_rate: number;
  sessions_this_week: number;
  compliance_score: number;
  compliance_target: number;
  incidents_this_month: number;
  goal_achievement_rate: number;
  team_compliance_breakdown: { compliant: number; at_risk: number; non_compliant: number };

  workers_at_risk: Array<{
    id: string;
    full_name: string;
    compliance_score: number;
    sessions: number;
  }>;

  org_alerts: Array<{
    type: string;
    severity: string;
    message: string;
  }>;

  common_issues: Array<{
    issue: string;
    count: number;
  }>;

  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

interface RevenueMonth {
  month: string;
  billed: number;
  paid: number;
  outstanding: number;
  count: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatNumber(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-AU");
}

/* -------------------------------------------------------------------------- */
/* Executive metric strip                                                     */
/* -------------------------------------------------------------------------- */

// "Active participants used vs. total capacity" is a single ratio against a
// limit — a meter reads that correctly; a 2-slice pie doesn't (it makes the
// reader compare two arbitrary angles instead of just reading one bar).
// Track is a lighter tint of the same hue as the fill, not a neutral gray,
// so severity reads across the whole bar, not just the filled portion.
function CapacityMeter({ used, total }: { used: number; total: number }) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((used / total) * 100));
  const available = Math.max(0, total - used);
  const color = pct >= 90 ? RED : pct >= 70 ? AMBER : GREEN;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: `${color}1F` }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="mt-1.5 text-[10px] font-bold" style={{ color: MUTED }}>
        {available} spot{available === 1 ? "" : "s"} available for new participants
      </p>
    </div>
  );
}

/** Two named sub-counts under a total (e.g. Support workers / Coordinators under Active staff). */
function MetricBreakdown({ items }: { items: Array<{ label: string; value: number; color?: string }> }) {
  return (
    <div className="mt-3 flex items-center gap-4 border-t pt-3" style={{ borderColor: BORDER }}>
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[15px] font-black" style={{ color: item.color ?? TEXT }}>{formatNumber(item.value)}</p>
          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{item.label}</p>
        </div>
      ))}
    </div>
  );
}

/** Ring composition chart — the team's total in the center, made up of two
 *  named categorical parts (support workers / coordinators). Unlike
 *  CapacityMeter, this total has no ceiling to read as a fill level against,
 *  so a ring split — not a linear meter — is the right form here. */
function StaffCompositionRing({ supportWorkers, coordinators, size = 136, stroke = 16 }: { supportWorkers: number; coordinators: number; size?: number; stroke?: number }) {
  const total = supportWorkers + coordinators;
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 3 : 0;
  const workerLen = total > 0 ? (supportWorkers / total) * circumference : 0;
  const coordLen = total > 0 ? (coordinators / total) * circumference : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${supportWorkers} support workers, ${coordinators} coordinators`}
    >
      <circle cx={center} cy={center} r={radius} fill="none" stroke={SOFT} strokeWidth={stroke} />
      {supportWorkers > 0 && (
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={PLUM} strokeWidth={stroke}
          strokeDasharray={`${Math.max(0, workerLen - gap)} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      {coordinators > 0 && (
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={SKY} strokeWidth={stroke}
          strokeDasharray={`${Math.max(0, coordLen - gap)} ${circumference}`}
          strokeDashoffset={-workerLen}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text x="50%" y="46%" textAnchor="middle" style={{ fill: TEXT, fontSize: 28, fontWeight: 900 }}>
        {formatNumber(total)}
      </text>
      <text x="50%" y="62%" textAnchor="middle" style={{ fill: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>
        TOTAL STAFF
      </text>
    </svg>
  );
}

/** A colored identity dot beside its own value + label — the ring's legend,
 *  since color alone (a WARN-contrast blue included) is never the only cue. */
function RingLegendItem({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <p className="text-[12px] font-bold" style={{ color: TEXT }}>
        {formatNumber(value)} <span className="font-semibold" style={{ color: MUTED }}>{label}</span>
      </p>
    </div>
  );
}

function ActiveStaffCard({
  total,
  retentionRate,
  supportWorkers,
  coordinators,
  onClick,
}: {
  total: number;
  retentionRate: number;
  supportWorkers: number;
  coordinators: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col justify-start rounded-2xl border overflow-hidden text-left transition-colors hover:bg-cc-soft"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="relative w-full flex-1 px-5 py-5">
        <div className="absolute right-5 top-1/2 -translate-y-1/2">
          <StaffCompositionRing supportWorkers={supportWorkers} coordinators={coordinators} />
        </div>

        <div className="pr-32">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Active staff</p>

          <div className="mt-3 flex flex-col gap-1.5">
            <RingLegendItem color={PLUM} value={supportWorkers} label="Support workers" />
            <RingLegendItem color={SKY} value={coordinators} label="Coordinators" />
          </div>

          <p className="mt-3 text-[11px]" style={{ color: MUTED }}>{retentionRate}% retention · {formatNumber(total)} active in total</p>
        </div>
      </div>
      <span className="flex w-full items-center justify-between border-t border-cc-border px-5 py-3 text-xs font-semibold text-cc-plum">Open staff directory<ArrowRight size={14} /></span>
    </button>
  );
}

/** Same "single ratio" meter language as CapacityMeter, but inverted severity —
 *  here a higher percentage is the good outcome, so the color bands flip. */
function AchievementMeter({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const color = clamped >= 85 ? GREEN : clamped >= 70 ? AMBER : RED;
  return (
    <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: `${color}1F` }}>
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

function ExecutiveMetric({
  label,
  value,
  detail,
  onClick,
  meter,
  breakdown,
  achievementPct,
}: {
  label: string;
  value: string | number;
  detail: string;
  onClick?: () => void;
  meter?: { used: number; total: number };
  breakdown?: Array<{ label: string; value: number; color?: string }>;
  achievementPct?: number;
}) {
  const content = (
    <div className="w-full px-5 py-5">
      <p
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-2 text-[26px] font-black tracking-tight"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      <p
        className="mt-1 text-[11px]"
        style={{ color: MUTED }}
      >
        {detail}
      </p>

      {meter && <CapacityMeter used={meter.used} total={meter.total} />}
      {achievementPct !== undefined && <AchievementMeter pct={achievementPct} />}
      {breakdown && <MetricBreakdown items={breakdown} />}
    </div>
  );

  // Each metric is its own rounded, bordered card — not one shared strip —
  // so the four numbers read as separate facts, not one continuous block.
  if (!onClick) {
    return (
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex flex-col justify-start rounded-2xl border overflow-hidden text-left transition-colors hover:bg-cc-soft"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      {content}
      <span className="flex w-full items-center justify-between gap-2 border-t border-cc-border px-5 py-3 text-xs font-semibold text-cc-plum">{label === "Support visits" ? "Review the schedule" : "Review participant outcomes"}<ArrowRight size={14} /></span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Participant overview                                                      */
/* -------------------------------------------------------------------------- */

/** One named sub-count in the participant overview card (Male/Female, Pending/Review/Expired). */
function ParticipantStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className="text-[17px] font-black" style={{ color: color ?? TEXT }}>{formatNumber(value)}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

/** A single real count, not a comparison or a ratio against a limit — a plain
 *  stat tile is the right form here, not a chart (see dataviz "is it even a
 *  chart?"). Sits above the participant overview it's a stage of. */
export function DemandCapacityPanel({ data, loading, error, onRetry, onNavigate }: {
  data?: MdDemandCapacity; loading: boolean; error: boolean;
  onRetry: () => void; onNavigate: (path: string) => void;
}) {
  if (error) return <div role="alert" className="rounded-xl border border-cc-border bg-cc-surface p-5 text-sm">
    <p>Enquiries and available hours could not be loaded.</p>
    <button type="button" onClick={onRetry} className="mt-3 min-h-11 font-semibold text-cc-plum">Try again</button>
  </div>;
  if (loading || !data) return <div role="status" className="rounded-xl border border-cc-border bg-cc-surface p-5 text-sm text-cc-muted">Loading enquiries and available hours...</div>;
  const reliable = Math.round(data.capacity.reliable_hours);
  const casual = Math.round(data.capacity.casual_hours);
  const cards = [
    { title: "Enquiries to review", value: formatNumber(data.waitlist.count), detail: data.waitlist.count > 0 ? "Awaiting initial screening" : "No enquiries awaiting screening", action: "Review participant intake", path: "/onboard-participant", icon: Clock },
    { title: "Requested support", value: formatNumber(data.waitlist.hours) + " h", detail: "Weekly hours requested by the waiting list", action: "Review support requests", path: "/onboard-participant", icon: Timer },
    { title: "Available this week", value: formatNumber(reliable + casual) + " h", detail: reliable + " h permanent staff / " + casual + " h casual staff", action: "Review staff availability", path: "/md/schedule", icon: Zap },
  ];
  return <section aria-label="Demand and capacity" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold text-cc-text">Plan your next move</h2><span className="text-xs text-cc-muted">Enquiries and this week's capacity</span></div>
    <div className="grid gap-3 md:grid-cols-3">
      {cards.map(({ title, value, detail, action, path, icon: Icon }) => <button key={title} type="button" onClick={() => onNavigate(path)} className="group flex min-w-0 flex-col rounded-xl border border-cc-border bg-cc-surface p-4 text-left transition-colors hover:border-cc-plum focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum">
        <div className="flex w-full items-center justify-between gap-2"><span className="text-sm font-medium text-cc-muted">{title}</span><Icon size={16} className="shrink-0 text-cc-plum" /></div>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-cc-text">{value}</p>
        <p className="mb-4 mt-2 text-xs leading-relaxed text-cc-muted">{detail}</p>
        <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-cc-border pt-3 text-xs font-semibold text-cc-plum">{action}<ArrowRight size={14} className="shrink-0 transition-transform group-hover:translate-x-1" /></span>
      </button>)}
    </div>
    <p className="text-xs leading-relaxed text-cc-muted">Available hours are based on recorded availability and rostered work. Confirm worker suitability and casual availability before offering support.{data.capacity.workers_without_availability > 0 && " " + data.capacity.workers_without_availability + " workers have no availability recorded and are excluded."}</p>
  </section>;
}

function ParticipantOverviewCard({
  total,
  bySex,
  byPlanStatus,
  onNavigate,
}: {
  total: number;
  bySex: MDData["participants_by_sex"] | null | undefined;
  byPlanStatus: MDData["participants_by_plan_status"] | null | undefined;
  onNavigate: () => void;
}) {
  const sex = bySex ?? { male: 0, female: 0, unspecified: 0 };
  const planStatus = byPlanStatus ?? { pending: 0, review: 0, expired: 0 };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: BORDER }}>
        <div>
          <h3 className="text-[13px] font-black" style={{ color: TEXT }}>Participant overview</h3>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>Caseload composition and plan status</p>
        </div>
        <button onClick={onNavigate} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: PLUM }}>
          View participants <ArrowRight size={12} />
        </button>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <p className="text-[40px] font-black leading-none tracking-tight" style={{ color: PLUM }}>{formatNumber(total)}</p>
          <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Total participants</p>
          <div className="mt-4 flex items-center gap-6">
            <ParticipantStat label="Male" value={sex.male} />
            <ParticipantStat label="Female" value={sex.female} />
            {sex.unspecified > 0 && <ParticipantStat label="Others" value={sex.unspecified} />}
          </div>
        </div>

        <span className="hidden h-24 w-px sm:block" style={{ background: BORDER }} />

        <div>
          <div className="mb-3 flex items-center gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Plan status</p>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label="What does plan status mean?" className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:opacity-70" style={{ color: MUTED }}>
                  <Info size={12} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[280px] space-y-2.5 p-3.5 text-[11px] leading-relaxed">
                <p><strong>Pending</strong> — waiting on NDIA or the plan manager to confirm the plan. Services shouldn't be billed against it until it's confirmed.</p>
                <p><strong>Review</strong> — the participant's plan is being reassessed. Budget and goals may change once it's finalized.</p>
                <p><strong>Expired</strong> — the plan's end date has passed with no new plan on file. Services delivered now may not be billable — follow up before continuing support.</p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-6">
            <ParticipantStat label="Pending" value={planStatus.pending} color={planStatus.pending > 0 ? AMBER : undefined} />
            <ParticipantStat label="Review" value={planStatus.review} color={planStatus.review > 0 ? AMBER : undefined} />
            <ParticipantStat label="Expired" value={planStatus.expired} color={planStatus.expired > 0 ? RED : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compliance                                                                 */
/* -------------------------------------------------------------------------- */

function ComplianceCard({
  score,
  target,
  onNavigate,
}: {
  score: number;
  target: number;
  onNavigate: (path: string) => void;
}) {
  const { translate, translateParams } = useAccessibility();

  const percentage = Math.min(Math.max(score, 0), 100);
  const belowTarget = score < target;
  const difference = Math.abs(score - target);

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6"
        style={{ borderColor: BORDER }}
      >
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={16}
              strokeWidth={2}
              style={{ color: PLUM }}
            />

            <h2
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              Compliance health
            </h2>
          </div>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Organisation-wide compliance performance
          </p>
        </div>

        <button
          onClick={() => onNavigate("/md/compliance")}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          View quality
          <ArrowRight size={12} strokeWidth={2} />
        </button>
      </div>

      <div className="grid gap-7 p-5 sm:p-6 lg:grid-cols-[240px_1fr] lg:items-center">
        <div>
          <div className="flex items-end gap-2">
            <span
              className="text-[44px] font-black leading-none tracking-[-0.04em]"
              style={{
                color: belowTarget ? RED : TEXT,
              }}
            >
              {score}%
            </span>

            <span
              className="mb-1.5 text-[11px] font-semibold"
              style={{ color: MUTED }}
            >
              current
            </span>
          </div>

          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{
              background: belowTarget ? "#FBEAE9" : "#E9F5F0",
              color: belowTarget ? RED : GREEN,
            }}
          >
            {belowTarget ? (
              <TrendingDown size={11} />
            ) : (
              <TrendingUp size={11} />
            )}

            {belowTarget
              ? `${difference}% below target`
              : "On target"}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-[10px] font-bold"
              style={{ color: MUTED }}
            >
              Current performance
            </span>

            <span
              className="text-[10px] font-bold"
              style={{ color: TEXT }}
            >
              {target}% target
            </span>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: SOFT }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${percentage}%`,
                background: belowTarget ? RED : PLUM,
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span
              className="text-[10px]"
              style={{ color: MUTED }}
            >
              Organisation compliance score
            </span>

            <span
              className="text-[10px] font-semibold"
              style={{
                color: belowTarget ? RED : GREEN,
              }}
            >
              {belowTarget
                ? translateParams("hub.mdHub.belowTarget", {
                    target: String(target),
                  })
                : translate("hub.mdHub.onTarget")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DocumentationInsights({ data, onNavigate }: { data: Pick<MDData, "documentation_summary" | "compliance_score" | "compliance_target" | "common_issues" | "workers_at_risk">; onNavigate: (path: string) => void }) {
  const summary = data.documentation_summary;
  const gap = Math.max(0, data.compliance_target - data.compliance_score);
  const issues = (data.common_issues ?? []).filter(issue => issue.count > 0).slice(0, 5);
  const maxCount = Math.max(1, ...issues.map(issue => issue.count));
  const bands = summary ? [
    { label: "On target (85% or above)", count: summary.on_target, color: GREEN },
    { label: "Needs review (60% to 84%)", count: summary.needs_review, color: AMBER },
    { label: "Priority review (below 60%)", count: summary.priority_review, color: RED },
    { label: "Not scored", count: summary.unscored, color: MUTED },
  ] : [];
  return <section aria-label="Documentation quality and follow-up" className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
    <header className="border-b border-cc-border p-5"><h2 className="text-base font-semibold text-cc-text">Documentation quality: where to focus</h2><p className="mt-1 text-sm text-cc-muted">Based on the latest available session records, up to 400. Scores describe documentation checks, not overall regulatory compliance.</p></header>
    <div className="grid gap-6 p-5 lg:grid-cols-2">
      <div>
        <p className="text-sm font-semibold text-cc-text">{summary?.scored ? (gap > 0 ? gap + " percentage points below the " + data.compliance_target + "% target" : "Average score meets the " + data.compliance_target + "% target") : "Scored documentation is not yet available"}</p>
        {summary && <>
          <p className="mt-2 text-sm text-cc-muted">{summary.priority_review + summary.needs_review} of {summary.scored} scored sessions are below 85%. {summary.unscored} sessions have no score and are shown separately.</p>
          <div role="img" aria-label={bands.map(band => band.label + ": " + band.count).join("; ")} className="mt-4 flex h-5 overflow-hidden rounded bg-cc-soft">{bands.map(band => <span key={band.label} style={{ background: band.color, width: (summary.sample_size ? band.count / summary.sample_size * 100 : 0) + "%" }} />)}</div>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">{bands.map(band => <div key={band.label} className="flex items-center justify-between gap-2 text-xs"><dt className="flex items-center gap-2 text-cc-muted"><span className="h-2 w-2 rounded-full" style={{ background: band.color }} />{band.label}</dt><dd className="font-semibold text-cc-text">{band.count}</dd></div>)}</dl>
        </>}
        <h3 className="mt-6 text-sm font-semibold text-cc-text">Follow up with staff</h3>
        <div className="mt-2 divide-y divide-cc-border">{(data.workers_at_risk ?? []).slice(0, 4).map(worker => <button type="button" key={worker.id} onClick={() => onNavigate("/md/staff?workerId=" + encodeURIComponent(worker.id) + "&tab=shifts")} className="flex min-h-12 w-full items-center justify-between gap-3 py-3 text-left text-sm"><span><span className="font-semibold text-cc-text">{worker.full_name}</span><span className="mt-1 block text-xs text-cc-muted">{worker.compliance_score}% across {worker.sessions} sessions. Review shift documentation.</span></span><ArrowRight size={16} className="shrink-0 text-cc-plum" /></button>)}</div>
        {!data.workers_at_risk?.length && <p className="mt-2 text-xs text-cc-muted">No staff follow-up items returned in this snapshot.</p>}
      </div>
      <div><h3 className="text-sm font-semibold text-cc-text">Most frequently recorded issues</h3><p className="mt-1 text-xs leading-relaxed text-cc-muted">Mentions in rule flags, recommendations and compliance notes. One session may contribute more than once; these are not confirmed root causes.</p>
        <div className="mt-4 space-y-4">{issues.map(issue => <div key={issue.issue}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="text-cc-text">{issue.issue}</span><span className="shrink-0 font-semibold text-cc-muted">{issue.count} mentions</span></div><div className="h-2 rounded bg-cc-soft"><div className="h-full rounded bg-cc-plum" style={{ width: issue.count / maxCount * 100 + "%" }} /></div></div>)}</div>
        {!issues.length && <p className="mt-4 text-sm text-cc-muted">No recurring issues were returned. Review individual records before drawing conclusions.</p>}
        <button type="button" onClick={() => onNavigate("/md/service-delivery")} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cc-plum">Investigate delivery quality<ArrowRight size={14} /></button>
      </div>
    </div>
  </section>;
}

/* -------------------------------------------------------------------------- */
/* Compliance trend                                                           */
/* -------------------------------------------------------------------------- */

function ComplianceTrend({
  trend,
  target,
}: {
  trend: TrendPoint[];
  target: number;
}) {
  const { translate, translateParams } = useAccessibility();

  const chartData = trend
    .slice(-13)
    .map((item) => ({
      week: item.week.replace(/^\d{4}-/, ""),
      score: item.avg_score,
      sessions: item.session_count,
    }));

  if (chartData.filter(item => item.score !== null).length < 2) {
    return <p className="rounded-xl border border-cc-border p-4 text-sm text-cc-muted">A trend will appear once at least two weeks have scored documentation.</p>;
  }

  return (
    <section
      className="rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6"
        style={{ borderColor: BORDER }}
      >
        <div>
          <h2
            className="text-[14px] font-black"
            style={{ color: TEXT }}
          >
            Documentation quality over time
          </h2>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Weekly average of recorded session documentation scores. Compare with the target; this is not an audit compliance rating.
          </p>
        </div>

        <div
          className="hidden items-center gap-1.5 text-[10px] font-bold sm:flex"
          style={{ color: MUTED }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PLUM }}
          />

          Compliance
        </div>
      </div>

      <details className="mx-5 mt-4 text-xs text-cc-muted"><summary className="cursor-pointer font-semibold">View weekly figures</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">Week</th><th>Average score</th><th>Sessions</th></tr></thead><tbody>{chartData.map(point => <tr key={point.week}><td className="py-1">{point.week}</td><td>{point.score === null ? "Not scored" : point.score + "%"}</td><td>{point.sessions}</td></tr>)}</tbody></table></div></details>
      <div className="px-2 pb-4 pt-4 sm:px-5">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={chartData}
            margin={{
              top: 8,
              right: 12,
              bottom: 0,
              left: -18,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={BORDER}
              vertical={false}
            />

            <XAxis
              dataKey="week"
              tick={{
                fontSize: 9,
                fill: MUTED,
              }}
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              domain={[0, 100]}
              tick={{
                fontSize: 9,
                fill: MUTED,
              }}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                background: SURFACE,
                fontSize: 11,
                boxShadow: "0 6px 20px rgba(0,0,0,0.06)",
              }}
              formatter={(value: number) => [
                `${value}%`,
                translate("hub.mdHub.avgScore"),
              ]}
            />

            <ReferenceLine
              y={target}
              stroke={AMBER}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: translateParams("hub.mdHub.target", {
                  target: String(target),
                }),
                fontSize: 9,
                fill: AMBER,
                position: "insideTopRight",
              }}
            />

            <Line
              type="monotone"
              dataKey="score"
              stroke={PLUM}
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 4,
                fill: PLUM,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Revenue trend                                                              */
/* -------------------------------------------------------------------------- */

type RevenuePeriod = "monthly" | "quarterly" | "yearly";

const REVENUE_PERIOD_META: Record<RevenuePeriod, { label: string; window: string }> = {
  monthly: { label: "Monthly", window: "last 12 months" },
  quarterly: { label: "Quarterly", window: "last 8 quarters" },
  yearly: { label: "Yearly", window: "last 5 years" },
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Months to cover so the chart starts on a whole quarter / year:
 *  12 months, the last 8 quarters, or the last 5 calendar years. */
function periodMonths(period: RevenuePeriod, currentMonth: string): number {
  const monthNum = Number(currentMonth.slice(5, 7));
  if (period === "monthly") return 12;
  if (period === "quarterly") return 7 * 3 + ((monthNum - 1) % 3) + 1;
  return 4 * 12 + monthNum;
}

/** "YYYY-MM" keys for the `count` months ending with `current`, oldest first. */
export function monthKeysEnding(current: string, count: number): string[] {
  let year = Number(current.slice(0, 4));
  let month = Number(current.slice(5, 7));
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys.reverse();
}

/** Re-buckets the monthly report into the chart's months, quarters or years,
 *  ending with the current one, oldest on the left. The report lists months
 *  newest first and skips months with no invoices; both used to show here as
 *  the oldest months, drawn backwards, with gaps closed up. */
export function bucketRevenue(
  monthly: RevenueMonth[],
  period: RevenuePeriod,
  currentMonth: string,
): Array<{ key: string; billed: number; paid: number }> {
  const byMonth = new Map(monthly.map((m) => [m.month.slice(0, 7), m]));
  const buckets = new Map<string, { label: string; billed: number; paid: number }>();
  for (const key of monthKeysEnding(currentMonth, periodMonths(period, currentMonth))) {
    const [yearStr, monthStr] = key.split("-");
    const monthNum = Number(monthStr);
    let bucketKey: string;
    let label: string;
    if (period === "monthly") {
      bucketKey = key;
      label = monthNum === 1 || buckets.size === 0 ? `${MONTH_ABBR[monthNum - 1]} ${yearStr.slice(2)}` : MONTH_ABBR[monthNum - 1];
    } else if (period === "quarterly") {
      const quarter = Math.floor((monthNum - 1) / 3) + 1;
      bucketKey = `${yearStr}-Q${quarter}`;
      label = `Q${quarter} ${yearStr}`;
    } else {
      bucketKey = yearStr;
      label = yearStr;
    }
    const bucket = buckets.get(bucketKey) ?? { label, billed: 0, paid: 0 };
    const m = byMonth.get(key);
    bucket.billed += m?.billed ?? 0;
    bucket.paid += m?.paid ?? 0;
    buckets.set(bucketKey, bucket);
  }
  return Array.from(buckets.values()).map((v) => ({
    key: v.label,
    billed: Math.round(v.billed / 100),
    paid: Math.round(v.paid / 100),
  }));
}

interface RevenueReport {
  monthly?: RevenueMonth[];
  total_billed_cents?: number;
  total_paid_cents?: number;
  total_outstanding_cents?: number;
  invoice_count?: number;
}

/** One figure in the billing summary strip — always the live, current-to-the-day
 *  total from the report, independent of the chart's Monthly/Quarterly/Yearly view. */
function BillingStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[17px] font-black" style={{ color: color ?? TEXT }}>{value}</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

function useRevenueReport() {
  return useOrgQuery<RevenueReport>([...MD_DASHBOARD_KEY, "revenue-report"], {
    queryFn: async () => {
      const response = await apiFetch("/api/billing/revenue-report");
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      return response.json();
    },
  });
}

function RevenueUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 px-5 py-6 text-[12px] sm:px-6" style={{ color: MUTED }}>
      <AlertTriangle size={14} style={{ color: AMBER }} />
      Billing figures couldn't be loaded.
      <button type="button" className="font-bold underline" style={{ color: PLUM }} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

function RevenueChart() {
  const revenue = useRevenueReport();
  const report = revenue.data ?? null;
  const [period, setPeriod] = useState<RevenuePeriod>("monthly");

  const currentMonth = appLocalDateKey(new Date().toISOString()).slice(0, 7);
  const chartData = bucketRevenue(report?.monthly ?? [], period, currentMonth);
  const hasHistory = (report?.monthly ?? []).some((m) => m.billed > 0);
  const totalBilled = (report?.total_billed_cents ?? 0) / 100;
  const totalPaid = (report?.total_paid_cents ?? 0) / 100;
  const totalOutstanding = (report?.total_outstanding_cents ?? 0) / 100;
  const invoiceCount = report?.invoice_count ?? 0;

  return (
    <section className="flex h-full flex-col rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: BORDER }}>
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Revenue</h2>
          <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Billed vs. paid, {REVENUE_PERIOD_META[period].window}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[10px] font-bold sm:flex" style={{ color: MUTED }}>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: BLUE }} /> Billed</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} /> Paid</span>
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as RevenuePeriod)}>
            <SelectTrigger className="h-8 w-[120px] rounded-full border text-[11px] font-bold" style={{ borderColor: BORDER, color: TEXT }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {revenue.isError ? (
        <RevenueUnavailable onRetry={() => void revenue.refetch()} />
      ) : (
      <>
      {/* Current-to-the-day totals — always the live report totals, not
          re-bucketed by the period selector above (that only reshapes the
          chart below). */}
      <div className="grid grid-cols-2 gap-4 border-b px-5 py-4 sm:grid-cols-4 sm:px-6" style={{ borderColor: BORDER }}>
        <BillingStat label="Billed" value={`$${formatNumber(totalBilled)}`} />
        <BillingStat label="Paid" value={`$${formatNumber(totalPaid)}`} color={GREEN} />
        <BillingStat label="Outstanding" value={`$${formatNumber(totalOutstanding)}`} color={totalOutstanding > 0 ? AMBER : undefined} />
        <BillingStat label="Invoices" value={formatNumber(invoiceCount)} />
      </div>

      <div className="flex-1 px-2 pb-4 pt-4 sm:px-5">
        {report === null ? (
          <div className="flex h-[220px] items-center justify-center text-[11px]" style={{ color: MUTED }}>Loading…</div>
        ) : !hasHistory ? (
          <div className="flex h-[220px] items-center justify-center text-[11px]" style={{ color: MUTED }}>Not enough billing history yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${formatNumber(v)}`} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, fontSize: 11, boxShadow: "0 6px 20px rgba(0,0,0,0.06)" }}
                formatter={(value: number, name: string) => [`$${formatNumber(value)}`, name === "billed" ? "Billed" : "Paid"]}
              />
              <Line type="monotone" dataKey="billed" stroke={BLUE} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: BLUE }} />
              <Line type="monotone" dataKey="paid" stroke={GREEN} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: GREEN }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Financial summary                                                         */
/* -------------------------------------------------------------------------- */

function FinancialSummary({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const revenue = useRevenueReport();
  const rev = revenue.data ?? null;

  const totalRevenue =
    (rev?.total_billed_cents ?? 0) / 100;

  const totalPaid =
    (rev?.total_paid_cents ?? 0) / 100;

  const invoices = rev?.invoice_count ?? 0;

  const collectionRate =
    totalRevenue > 0
      ? Math.round((totalPaid / totalRevenue) * 100)
      : 0;

  // Baseline comparison: the two most recent months from the same report,
  // so "collection rate" reads against a prior period instead of standing
  // alone as a bare percentage.
  const monthly = rev?.monthly ?? [];
  const thisMonth = monthly[0];
  const lastMonth = monthly[1];
  const lastMonthRate =
    lastMonth && lastMonth.billed > 0
      ? Math.round((lastMonth.paid / lastMonth.billed) * 100)
      : null;
  const thisMonthRate =
    thisMonth && thisMonth.billed > 0
      ? Math.round((thisMonth.paid / thisMonth.billed) * 100)
      : null;
  const collectionDelta =
    thisMonthRate !== null && lastMonthRate !== null
      ? thisMonthRate - lastMonthRate
      : null;

  return (
    <section
      className="rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <div>
          <div className="flex items-center gap-2">
            <DollarSign
              size={15}
              strokeWidth={2}
              style={{ color: BLUE }}
            />

            <h2
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              Financial snapshot
            </h2>
          </div>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Current billing activity
          </p>
        </div>

        <button
          onClick={onNavigate}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          Full report
          <ArrowRight size={12} />
        </button>
      </div>

      {revenue.isError ? (
        <RevenueUnavailable onRetry={() => void revenue.refetch()} />
      ) : (
      <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <FinancialMetric
          label="Billed"
          value={`$${totalRevenue.toLocaleString("en-AU", {
            maximumFractionDigits: 0,
          })}`}
        />

        <FinancialMetric
          label="Paid"
          value={`$${totalPaid.toLocaleString("en-AU", {
            maximumFractionDigits: 0,
          })}`}
        />

        <FinancialMetric
          label="Collection"
          value={totalRevenue > 0 ? `${collectionRate}%` : "—"}
          detail={
            collectionDelta === null
              ? `${formatNumber(invoices)} invoices`
              : `${collectionDelta >= 0 ? "+" : ""}${collectionDelta} pts vs last month`
          }
          warning={totalRevenue > 0 && collectionRate < 90}
          trend={collectionDelta}
        />
      </div>
      )}
    </section>
  );
}

function FinancialMetric({
  label,
  value,
  detail,
  warning,
  trend,
}: {
  label: string;
  value: string;
  detail?: string;
  warning?: boolean;
  trend?: number | null;
}) {
  return (
    <div className="px-5 py-4">
      <p
        className="text-[9px] font-black uppercase tracking-[0.15em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-1 text-[21px] font-black"
        style={{
          color: warning ? RED : TEXT,
        }}
      >
        {value}
      </p>

      {detail && (
        <p
          className="mt-0.5 flex items-center gap-1 text-[10px]"
          style={{ color: trend !== undefined && trend !== null ? (trend >= 0 ? GREEN : RED) : MUTED }}
        >
          {trend !== undefined && trend !== null ? (
            trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />
          ) : null}
          {detail}
        </p>
      )}
    </div>
  );
}

const EMPTY_TREND: TrendPoint[] = [];

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export function MDHubView() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  // Cached queries, shared with the executive page: refetched when the MD
  // returns to the tab and whenever a change invalidates MD_DASHBOARD_KEY.
  const overviewQuery = useOrgQuery<MDData>([...MD_DASHBOARD_KEY, "all"], {
    queryFn: async () => {
      const response = await apiFetch("/api/dashboard/managing-director");
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      return response.json();
    },
  });
  const trendQuery = useOrgQuery<{ trend?: TrendPoint[] }>(COMPLIANCE_TREND_KEY, {
    queryFn: async () => {
      const response = await apiFetch("/api/dashboard/compliance-trend");
      if (!response.ok) throw new Error("Could not load documentation trend");
      return response.json();
    }, retry: false,
  });
  const data = overviewQuery.data ?? null;
  const loading = overviewQuery.isLoading;
  const error = overviewQuery.isError;
  // Real enquiries and this week's spare staff hours (was placeholder numbers).
  const demandQuery = useOrgQuery<MdDemandCapacity>(["md", "demand-capacity"], {
    queryFn: getMdDemandCapacity,
  });


  /* ------------------------------------------------------------------------ */
  /* Loading                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-2">
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
        </div>

        <div
          className="grid overflow-hidden rounded-2xl border sm:grid-cols-2 xl:grid-cols-4"
          style={{ borderColor: BORDER }}
        >
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse"
              style={{ background: SOFT }}
            />
          ))}
        </div>

        <div
          className="h-52 animate-pulse rounded-2xl"
          style={{ background: SOFT }}
        />
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Error                                                                    */
  /* ------------------------------------------------------------------------ */

  if (error || !data) {
    return (
      <div
        className="rounded-2xl border p-10 text-center"
        style={{
          borderColor: BORDER,
          background: SURFACE,
        }}
      >
        <AlertTriangle
          size={26}
          className="mx-auto mb-3"
          style={{ color: "#9A5B0A" }}
        />

        <p
          className="text-[14px] font-black"
          style={{ color: TEXT }}
        >
          {translate("hub.mdHub.loadFailed")}
        </p>

        <p
          className="mt-1 text-[12px]"
          style={{ color: MUTED }}
        >
          {translate("hub.mdHub.retryHint")}
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Dashboard                                                                */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-8">

      {/* ------------------------------------------------------------------ */}
      {/* Waiting list + participant overview (left) + needs action /        */}
      {/* exposure (right) — a two-column row rather than the triage list's  */}
      {/* usual full width, since it's paired with real content instead of   */}
      {/* sitting next to blank canvas (see the "sidebar" variant note in    */}
      {/* GovernanceTriage). Revenue moves below "How we're tracking".       */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 flex min-w-0 flex-col gap-5 xl:order-1">
          <DemandCapacityPanel data={demandQuery.data} loading={demandQuery.isLoading} error={demandQuery.isError} onRetry={() => { void demandQuery.refetch(); }} onNavigate={navigate} />
          <ParticipantOverviewCard
            total={data.active_participants}
            bySex={data.participants_by_sex}
            byPlanStatus={data.participants_by_plan_status}
            onNavigate={() => navigate("/patients")}
          />
        </div>
        <div className="order-1 min-w-0 xl:order-2"><GovernanceTriage variant="sidebar" onNavigate={navigate} workersAtRisk={data.workers_at_risk} /></div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* How we're tracking — demoted below the triage list                 */}
      {/* ------------------------------------------------------------------ */}

      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color: MUTED }}
          >
            How we're tracking
          </span>
          <span className="h-px flex-1" style={{ background: BORDER }} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActiveStaffCard
            total={data.active_staff}
            retentionRate={data.staff_retention_rate}
            supportWorkers={data.support_workers}
            coordinators={data.coordinators}
            onClick={() => navigate("/md/staff")}
          />

          <ExecutiveMetric
            label="Support visits"
            value={formatNumber(data.sessions_this_week)}
            detail="This week"
            onClick={() => navigate("/md/schedule")}

          />

          <ExecutiveMetric
            label="Goal achievement"
            value={`${data.goal_achievement_rate}%`}
            detail="Participant goals"
            onClick={() => navigate("/md/service-delivery")}
            achievementPct={data.goal_achievement_rate}
          />
        </div>

        <DocumentationInsights data={data} onNavigate={navigate} />
        {trendQuery.isError ? <div role="alert" className="rounded-xl border border-cc-border p-4 text-sm">Documentation trend could not be loaded. <button type="button" className="font-semibold text-cc-plum" onClick={() => void trendQuery.refetch()}>Try again</button></div> : trendQuery.isLoading ? <p role="status" className="text-sm text-cc-muted">Loading documentation trend...</p> : <ComplianceTrend trend={trendQuery.data?.trend ?? []} target={data.compliance_target} />}

        <button type="button" onClick={() => navigate("/md/executive")} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-cc-border bg-cc-surface px-5 py-3 text-left text-sm font-semibold text-cc-plum">Review performance and longer-term trends<ArrowRight size={16} /></button>
      </div>


      <FinancialSummary
        onNavigate={() => navigate("/md/financial")}
      />
    </div>
  );
}
