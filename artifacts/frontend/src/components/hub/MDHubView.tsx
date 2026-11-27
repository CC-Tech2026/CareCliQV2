import { useState } from "react";
import { AXIS_PROPS, ChartLegend, GRID_PROPS, SERIES, SegmentedBar, TOOLTIP_PROPS, lineProps, referenceProps } from "@/components/charts/figures";
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
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { appLocalDateKey } from "@/lib/datetime";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { COMPLIANCE_TREND_KEY, MD_DASHBOARD_KEY } from "@/lib/query-keys";
import { getMdDemandCapacity, type MdDemandCapacity } from "@/services/dashboardService";
import { attentionRoute } from "@/components/hub/GovernanceTriage";
import { ActionList, OutcomeStrip } from "@/components/hub/GovernanceOutcomes";
import { briefingLine, buildActions, buildOutcomes } from "@/lib/governance-outcomes";
import { getHubComplianceAlerts } from "@/services/hubService";
import { OrgSetupChecklist } from "@/components/hub/OrgSetupChecklist";
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
  goals_active?: number | null;
  active_goals_supported_30d?: number | null;
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
      <p className="mt-1.5 text-[11px] font-bold" style={{ color: MUTED }}>
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
          <p className="text-[15px] font-semibold" style={{ color: item.color ?? TEXT }}>{formatNumber(item.value)}</p>
          <p className="text-xs font-semibold" style={{ color: MUTED }}>{item.label}</p>
        </div>
      ))}
    </div>
  );
}

/** A section heading inside a tab, with the link to where the full list lives. */
function PanelHeading({ title, link, onClick }: { title: string; link: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-cc-text">{title}</h3>
      <button type="button" onClick={onClick} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-cc-text hover:underline">
        {link}
        <ArrowRight size={13} aria-hidden />
      </button>
    </div>
  );
}

/** Participants and staff side by side: a count, how it splits, and the
 *  plan statuses that need following up. */
function PeoplePanel({ data, onNavigate }: { data: MDData; onNavigate: (path: string) => void }) {
  const sex = data.participants_by_sex ?? { male: 0, female: 0, unspecified: 0 };
  const plan = data.participants_by_plan_status ?? { active: 0, pending: 0, review: 0, expired: 0, inactive: 0 };
  return (
    <div className="grid divide-y divide-cc-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <section aria-label="Participants" className="p-5">
        <PanelHeading title="Participants" link="View participants" onClick={() => onNavigate("/onboard-participant/active")} />
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-cc-text">{formatNumber(data.active_participants)}</span>
          <span className="text-sm text-cc-muted">active</span>
        </p>
        <div className="mt-3">
          <SegmentedBar
            label="Participants by sex"
            unit="participants"
            parts={[
              { key: "female", label: "Female", value: sex.female, color: "var(--viz-1)" },
              { key: "male", label: "Male", value: sex.male, color: "var(--viz-2)" },
              ...(sex.unspecified ? [{ key: "unspecified", label: "Not recorded", value: sex.unspecified, color: "var(--viz-3)" }] : []),
            ]}
            empty="No active participants yet"
          />
        </div>
        <div className="mt-5 border-t border-cc-border pt-4">
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-cc-muted">NDIS plan status</p>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label="What does plan status mean?" className="flex h-4 w-4 items-center justify-center rounded-full text-cc-muted hover:opacity-70">
                  <Info size={12} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[280px] space-y-2.5 p-3.5 text-[11px] leading-relaxed">
                <p><strong>Pending:</strong> waiting on the NDIA or the plan manager to confirm the plan. Don't bill against it until it's confirmed.</p>
                <p><strong>Review:</strong> the plan is being reassessed. Budget and goals may change once it's finalised.</p>
                <p><strong>Expired:</strong> the plan's end date has passed with no new plan on file. Support delivered now may not be billable, so follow up before continuing.</p>
              </PopoverContent>
            </Popover>
          </div>
          <dl className="grid grid-cols-3 gap-4">
            {([
              ["Pending", plan.pending, AMBER],
              ["Review", plan.review, AMBER],
              ["Expired", plan.expired, RED],
            ] as const).map(([label, value, color]) => (
              <div key={label}>
                <dt className="text-xs text-cc-muted">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums" style={{ color: value > 0 ? color : TEXT }}>{formatNumber(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section aria-label="Staff" className="p-5">
        <PanelHeading title="Workforce" link="Open worker records" onClick={() => onNavigate("/md/staff")} />
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-cc-text">{formatNumber(data.active_staff)}</span>
          <span className="text-sm text-cc-muted">active</span>
        </p>
        <div className="mt-3">
          <SegmentedBar
            label="Active staff by role"
            unit="staff"
            parts={[
              { key: "workers", label: "Support workers", value: data.support_workers, color: "var(--viz-1)" },
              { key: "coordinators", label: "Coordinators", value: data.coordinators, color: "var(--viz-2)" },
            ]}
            empty="No active staff yet"
          />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-cc-border pt-4">
          <div>
            <dt className="text-xs text-cc-muted">Staff retention</dt>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">{data.staff_retention_rate}%</dd>
          </div>
          <div>
            <dt className="text-xs text-cc-muted">Shifts delivered this week</dt>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">{formatNumber(data.sessions_this_week)}</dd>
          </div>
          <div>
            <dt className="text-xs text-cc-muted">Incidents reported this month</dt>
            <dd className="text-xl font-semibold tabular-nums text-cc-text">{formatNumber(data.incidents_this_month)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/** Same "single ratio" meter language as CapacityMeter, but inverted severity —
 *  here a higher percentage is the good outcome, so the color bands flip. */
function ParticipantStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums" style={{ color: color ?? TEXT }}>{formatNumber(value)}</p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>{label}</p>
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
  if (error) return <div role="alert" className="p-5 text-sm">
    <p>Enquiries and available hours could not be loaded.</p>
    <button type="button" onClick={onRetry} className="mt-3 min-h-11 font-semibold text-cc-plum">Try again</button>
  </div>;
  if (loading || !data) return <div role="status" className="p-5 text-sm text-cc-muted">Loading enquiries and available hours...</div>;
  const reliable = Math.round(data.capacity.reliable_hours);
  const casual = Math.round(data.capacity.casual_hours);
  const cards = [
    { title: "Referrals awaiting assessment", value: formatNumber(data.waitlist.count), detail: data.waitlist.count > 0 ? "Pending intake assessment" : "No referrals pending intake", action: "Review participant intake", path: "/onboard-participant", icon: Clock },
    { title: "Support hours requested", value: formatNumber(data.waitlist.hours) + " h", detail: "Per week, across the waitlist", action: "Review support requests", path: "/onboard-participant", icon: Timer },
    { title: "Worker availability this week", value: formatNumber(reliable + casual) + " h", detail: reliable + " h permanent staff, " + casual + " h casual staff", action: "Review staff availability", path: "/coordinator/rostering", icon: Zap },
  ];
  return <section aria-label="Demand and capacity">
    <div className="grid divide-y divide-cc-border md:grid-cols-3 md:divide-x md:divide-y-0">
      {cards.map(({ title, value, detail, action, path, icon: Icon }) => <button key={title} type="button" onClick={() => onNavigate(path)} className="group flex min-w-0 flex-col px-5 py-5 text-left transition-colors hover:bg-cc-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum">
        <span className="flex items-center gap-2 text-sm text-cc-muted"><Icon size={15} className="shrink-0" aria-hidden />{title}</span>
        <span className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-cc-text sm:text-3xl">{value}</span>
        <span className="mt-1 hidden text-xs leading-relaxed text-cc-muted sm:block">{detail}</span>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cc-text group-hover:underline">{action}<ArrowRight size={13} className="shrink-0 transition-transform group-hover:translate-x-0.5" /></span>
      </button>)}
    </div>
    <p className="border-t border-cc-border px-5 py-3 text-xs leading-relaxed text-cc-muted">Available hours are based on recorded availability and rostered work. Confirm worker suitability and casual availability before offering support.{data.capacity.workers_without_availability > 0 && " " + data.capacity.workers_without_availability + " workers have no availability recorded and are excluded."}</p>
  </section>;
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
      className="overflow-hidden rounded-2xl bg-cc-surface"
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
              className="text-[14px] font-semibold"
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
              className="text-[44px] font-semibold leading-none tracking-[-0.04em]"
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
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
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
              className="text-[11px] font-bold"
              style={{ color: MUTED }}
            >
              Current performance
            </span>

            <span
              className="text-[11px] font-bold"
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
              className="text-[11px]"
              style={{ color: MUTED }}
            >
              Organisation compliance score
            </span>

            <span
              className="text-[11px] font-semibold"
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
  return <section aria-label="Documentation quality and follow-up" >
    <header className="px-5 pt-5"><h3 className="text-sm font-semibold text-cc-text">Documentation quality</h3><p className="mt-1 text-xs leading-relaxed text-cc-muted">Based on the latest available session records, up to 400. Scores describe documentation checks, not overall regulatory compliance.</p></header>
    <div className="grid gap-6 p-5 lg:grid-cols-2">
      <div>
        <p className="text-sm font-semibold text-cc-text">{summary?.scored ? (gap > 0 ? gap + " percentage points below the " + data.compliance_target + "% target" : "Average score meets the " + data.compliance_target + "% target") : "Scored documentation is not yet available"}</p>
        {summary && <>
          <p className="mt-2 text-sm text-cc-muted">{summary.priority_review + summary.needs_review} of {summary.scored} scored sessions are below 85%. {summary.unscored} sessions have no score and are shown separately.</p>
          <div role="img" aria-label={bands.map(band => band.label + ": " + band.count).join("; ")} className="mt-4 flex h-5 overflow-hidden rounded bg-cc-soft">{bands.map(band => <span key={band.label} style={{ background: band.color, width: (summary.sample_size ? band.count / summary.sample_size * 100 : 0) + "%" }} />)}</div>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">{bands.map(band => <div key={band.label} className="flex items-center justify-between gap-2 text-xs"><dt className="flex items-center gap-2 text-cc-muted"><span className="h-2 w-2 rounded-full" style={{ background: band.color }} />{band.label}</dt><dd className="font-semibold text-cc-text">{band.count}</dd></div>)}</dl>
        </>}
        <h3 className="mt-6 text-sm font-semibold text-cc-text">Workers requiring documentation support</h3>
        <div className="mt-2 divide-y divide-cc-border">{(data.workers_at_risk ?? []).slice(0, 4).map(worker => <button type="button" key={worker.id} onClick={() => onNavigate("/md/staff?workerId=" + encodeURIComponent(worker.id) + "&tab=shifts")} className="flex min-h-12 w-full items-center justify-between gap-3 py-3 text-left text-sm"><span><span className="font-semibold text-cc-text">{worker.full_name}</span><span className="mt-1 block text-xs text-cc-muted">{worker.compliance_score}% across {worker.sessions} sessions. Review progress notes.</span></span><ArrowRight size={16} className="shrink-0 text-cc-muted" /></button>)}</div>
        {!data.workers_at_risk?.length && <p className="mt-2 text-xs text-cc-muted">No workers require documentation support.</p>}
      </div>
      <div><h3 className="text-sm font-semibold text-cc-text">Most frequently recorded issues</h3><p className="mt-1 text-xs leading-relaxed text-cc-muted">Mentions in rule flags, recommendations and compliance notes. One session may contribute more than once; these are not confirmed root causes.</p>
        <div className="mt-4 space-y-4">{issues.map(issue => <div key={issue.issue}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="text-cc-text">{issue.issue}</span><span className="shrink-0 font-semibold text-cc-muted">{issue.count} mentions</span></div><div className="h-2 rounded bg-cc-soft"><div className="h-full rounded bg-cc-plum" style={{ width: issue.count / maxCount * 100 + "%" }} /></div></div>)}</div>
        {!issues.length && <p className="mt-4 text-sm text-cc-muted">No recurring issues were returned. Review individual records before drawing conclusions.</p>}
        <button type="button" onClick={() => onNavigate("/md/service-delivery")} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cc-plum">Open service delivery quality<ArrowRight size={14} /></button>
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
    return <p className="border-t border-cc-border p-5 text-sm text-cc-muted">A trend will appear once at least two weeks have scored documentation.</p>;
  }

  return (
    <section className="border-t border-cc-border">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-cc-text">
            Documentation quality trend
          </h3>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Weekly average of recorded session documentation scores. Compare with the target; this is not an audit compliance rating.
          </p>
        </div>


      </div>

      <details className="mx-5 mt-4 text-xs text-cc-muted"><summary className="cursor-pointer font-semibold">View weekly figures</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">Week</th><th>Average score</th><th>Sessions</th></tr></thead><tbody>{chartData.map(point => <tr key={point.week}><td className="py-1">{point.week}</td><td>{point.score === null ? "Not scored" : point.score + "%"}</td><td>{point.sessions}</td></tr>)}</tbody></table></div></details>
      <div className="px-2 pb-4 pt-4 sm:px-5">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="week" {...AXIS_PROPS} />
            <YAxis domain={[0, 100]} {...AXIS_PROPS} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              {...TOOLTIP_PROPS}
              formatter={(value: number) => [`${value}%`, translate("hub.mdHub.avgScore")]}
            />
            <ReferenceLine y={target} {...referenceProps(translateParams("hub.mdHub.target", { target: String(target) }))} />
            <Line type="monotone" dataKey="score" connectNulls {...lineProps(SERIES[0])} />
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
      <p className="text-[17px] font-semibold" style={{ color: color ?? TEXT }}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold" style={{ color: MUTED }}>{label}</p>
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

function RevenueChart({ onOpenReport }: { onOpenReport: () => void }) {
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
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-cc-text">Invoiced and paid</h3>
          <p className="mt-1 text-xs text-cc-muted">{REVENUE_PERIOD_META[period].window}</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onOpenReport} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-cc-text hover:underline">
            Open financial governance
            <ArrowRight size={13} aria-hidden />
          </button>
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
      <div className="mt-4 grid grid-cols-2 gap-4 border-y border-cc-border px-5 py-4 sm:grid-cols-4">
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
          <>
          <div className="px-3 pb-2 sm:px-1">
            <ChartLegend items={[{ label: "Billed", color: SERIES[0] }, { label: "Paid", color: SERIES[1] }]} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -6 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="key" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${formatNumber(v)}`} />
              <Tooltip
                {...TOOLTIP_PROPS}
                formatter={(value: number, name: string) => [`$${formatNumber(value)}`, name === "billed" ? "Billed" : "Paid"]}
              />
              <Line type="monotone" dataKey="billed" {...lineProps(SERIES[0])} />
              <Line type="monotone" dataKey="paid" {...lineProps(SERIES[1])} />
            </LineChart>
          </ResponsiveContainer>
          </>
        )}
      </div>
      </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page pieces                                                                */
/* -------------------------------------------------------------------------- */

function SectionHeading({ id, title, aside, link }: {
  id: string;
  title: string;
  aside?: string;
  link?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-base font-semibold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>{title}</h2>
      {aside ? <p className="text-xs font-medium text-cc-muted">{aside}</p> : null}
      {link ? (
        <button type="button" onClick={link.onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-cc-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum">
          {link.label}
          <ArrowRight size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

type DetailTab = { id: string; label: string; panel: React.ReactNode };

/** One surface with an underline tab row; only the open tab is drawn. */
function DetailTabs({ tabs }: { tabs: DetailTab[] }) {
  const [open, setOpen] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === open) ?? tabs[0];
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === current.id);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setOpen(next.id);
    document.getElementById(`hub-tab-${next.id}`)?.focus();
  }
  return (
    <div className="overflow-hidden rounded-xl border border-cc-border bg-cc-surface">
      <div role="tablist" aria-label="Supporting data" onKeyDown={onKeyDown} className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-cc-border px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const selected = t.id === current.id;
          return (
            <button
              key={t.id}
              id={`hub-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`hub-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setOpen(t.id)}
              className={`-mb-px shrink-0 border-b-2 py-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum ${selected ? "border-cc-text font-semibold text-cc-text" : "border-transparent font-medium text-cc-muted hover:text-cc-text"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`hub-panel-${current.id}`} aria-labelledby={`hub-tab-${current.id}`}>
        {current.panel}
      </div>
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
  const alertsQuery = useOrgQuery(["hub", "compliance-alerts"], {
    queryFn: getHubComplianceAlerts,
  });


  /* ------------------------------------------------------------------------ */
  /* Loading                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div role="status" aria-label="Loading executive briefing" className="space-y-4 motion-reduce:[&_*]:animate-none">
        <span className="sr-only">Loading executive briefing…</span>
        <div className="grid gap-2 xl:grid-cols-2">
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
          className="grid overflow-hidden rounded-2xl bg-cc-surface sm:grid-cols-2 xl:grid-cols-4"
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

  if (!data) {
    return (
      <div
        role="alert"
        className="rounded-2xl bg-cc-surface p-10 text-center"
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
          className="text-[14px] font-semibold"
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
        <button type="button" disabled={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--cc-cta)] px-4 text-sm font-semibold text-white disabled:opacity-60">
          <RefreshCw size={16} className={overviewQuery.isFetching ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
          {overviewQuery.isFetching ? "Retrying…" : "Try again"}
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Dashboard                                                                */
  /* ------------------------------------------------------------------------ */

  // The briefing: one sentence, then what needs doing beside where each
  // area stands, then the numbers behind them in tabs.
  const alerts = alertsQuery.data ?? [];
  const outcomes = buildOutcomes(data, alerts, demandQuery.data);
  const actions = buildActions(data, alerts, demandQuery.data, (a) => attentionRoute(a));
  const briefing = briefingLine(outcomes, actions);
  const updated = overviewQuery.dataUpdatedAt
    ? new Date(overviewQuery.dataUpdatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
        <p className="max-w-3xl text-[15px] leading-relaxed text-cc-text sm:text-base" aria-live="polite">
          {alertsQuery.isLoading ? (
            <span className="text-cc-muted">Loading the governance overview…</span>
          ) : (
            <>
              <span className="font-semibold">{briefing.lead}</span>{" "}
              <span className="text-cc-muted">{briefing.rest}</span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2 text-xs text-cc-muted">
          <p role="status" style={error ? { color: "var(--cc-danger-text)" } : undefined}>
            {error
              ? "Refresh failed. Showing the last available overview."
              : overviewQuery.isFetching
                ? "Updating overview…"
                : updated
                  ? `Last updated ${updated}`
                  : ""}
          </p>
          <button
            type="button"
            disabled={overviewQuery.isFetching}
            onClick={() => {
              void overviewQuery.refetch();
              void alertsQuery.refetch();
              void demandQuery.refetch();
            }}
            aria-label={overviewQuery.isFetching ? "Refreshing…" : "Refresh overview"}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-medium text-cc-muted hover:bg-cc-soft hover:text-cc-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum disabled:opacity-60"
          >
            <RefreshCw size={13} aria-hidden="true" className={overviewQuery.isFetching ? "animate-spin motion-reduce:animate-none" : ""} />
            {overviewQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <section aria-labelledby="hub-outcomes" className="-mt-3">
        <h2 id="hub-outcomes" className="sr-only">Performance against targets</h2>
        <OutcomeStrip outcomes={outcomes} onNavigate={navigate} />
      </section>

      <OrgSetupChecklist
        staffCount={(data.support_workers ?? 0) + (data.coordinators ?? 0)}
        participantCount={data.active_participants ?? 0}
        onNavigate={navigate}
      />

      {/* Full-width sections under the figures: nothing sits side by side,
          so no column is ever left short. */}
      <div className="space-y-8">
        <section aria-labelledby="hub-actions" className="min-w-0 space-y-3">
          <SectionHeading id="hub-actions" title="Actions required" />
          <ActionList
            actions={actions}
            loading={alertsQuery.isLoading}
            failed={alertsQuery.isError}
            onRetry={() => void alertsQuery.refetch()}
            onNavigate={navigate}
          />
        </section>


        <section aria-labelledby="hub-detail" className="min-w-0 space-y-3">
        <SectionHeading id="hub-detail" title="Supporting data" />
        <DetailTabs
          tabs={[
            {
              id: "capacity",
              label: "Capacity",
              panel: <DemandCapacityPanel data={demandQuery.data} loading={demandQuery.isLoading} error={demandQuery.isError} onRetry={() => { void demandQuery.refetch(); }} onNavigate={navigate} />,
            },
            { id: "people", label: "Participants and workforce", panel: <PeoplePanel data={data} onNavigate={navigate} /> },
            {
              id: "notes",
              label: "Progress notes",
              panel: (
                <>
                  <DocumentationInsights data={data} onNavigate={navigate} />
                  {trendQuery.isError ? (
                    <div role="alert" className="border-t border-cc-border p-5 text-sm">
                      Documentation trend could not be loaded.{" "}
                      <button type="button" className="font-semibold text-cc-plum" onClick={() => void trendQuery.refetch()}>Try again</button>
                    </div>
                  ) : trendQuery.isLoading ? (
                    <p role="status" className="border-t border-cc-border p-5 text-sm text-cc-muted">Loading documentation trend...</p>
                  ) : (
                    <ComplianceTrend trend={trendQuery.data?.trend ?? []} target={data.compliance_target} />
                  )}
                </>
              ),
            },
            { id: "money", label: "Finance", panel: <RevenueChart onOpenReport={() => navigate("/md/financial")} /> },
          ]}
        />
        </section>
      </div>
    </div>
  );
}

