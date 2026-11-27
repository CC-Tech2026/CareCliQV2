import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useLocation } from "wouter";
import { HubLayout } from "@/components/layout/HubLayout";
import { AXIS_PROPS, BAR_PROPS, GRID_PROPS, SERIES, ScoreMeter, TOOLTIP_PROPS, lineProps, referenceProps } from "@/components/charts/figures";
import {
  LoadError,
  PageHeader,
  Section,
  SkeletonBlocks,
  StatusText,
  Surface,
  ghostClass,
  outlineClass,
  toneColor,
  type Tone,
} from "@/components/layout/PageKit";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { apiFetch } from "@/lib/api-fetch";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { COMPLIANCE_TREND_KEY, MD_DASHBOARD_KEY } from "@/lib/query-keys";
import { useBranches } from "@/hooks/useBranches";
import { zoneAbbreviation } from "@/lib/datetime";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
import { getHubComplianceAlerts } from "@/services/hubService";
import { SectionInfo } from "@/components/ui/section-info";
import { OutcomeList } from "@/components/hub/GovernanceOutcomes";
import type { Outcome, OutcomeStatus } from "@/lib/governance-outcomes";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const EMPTY_TREND: TrendPoint[] = [];
const TONE_STATUS: Record<Tone, OutcomeStatus> = { good: "on_track", warning: "attention", danger: "off_track", neutral: "no_data", info: "no_data" };
/** Shift notes scoring at or above this count as on target (matches the server). */
const WORKER_THRESHOLD = 85;

interface MDData {
  timezone?: string;
  branch?: { id: string; name: string; state: string } | null;
  active_participants: number;
  active_staff: number;
  support_workers: number;
  staff_retention_rate: number;
  sessions_this_week: number;
  compliance_score: number;
  compliance_target: number;
  incidents_this_month: number;
  goal_achievement_rate: number;
  /** From the goals themselves (ndis_goals); null when they couldn't be read. */
  goals_total?: number | null;
  goals_achieved?: number | null;
  goals_active?: number | null;
  goal_outcome_rate?: number | null;
  active_goals_supported_30d?: number | null;
  /** workers_at_risk stops at 10; this is the full count. */
  workers_at_risk_count?: number;
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
  team_compliance_breakdown: {
    compliant: number;
    at_risk: number;
    non_compliant: number;
    not_scored?: number;
  };
  worker_rankings: Array<{
    id: string;
    full_name: string;
    compliance_score: number;
    sessions: number;
  }>;
  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function percent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function scoreTone(score: number, target: number): Tone {
  if (score >= target) return "good";
  if (score >= target - 10) return "warning";
  return "danger";
}

/** Average score across a run of weeks, weighted by how many shifts each week scored. */
function weightedAverage(points: Array<{ score: number; sessions: number }>) {
  const shifts = points.reduce((n, p) => n + p.sessions, 0);
  if (!shifts) return null;
  return { score: points.reduce((sum, p) => sum + p.score * p.sessions, 0) / shifts, shifts };
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; score: number; sessions: number } }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border bg-cc-surface px-3 py-2 text-xs shadow-md" style={{ borderColor: BORDER }}>
      <p className="font-semibold" style={{ color: TEXT }}>Week {point.label}</p>
      <p style={{ color: MUTED }}>
        <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{percent(point.score)}</span> average
        across {point.sessions} scored {point.sessions === 1 ? "shift" : "shifts"}
      </p>
    </div>
  );
}


export default function MDExecutivePage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  // Branch filter: "" = whole organisation on the MD's own branch clock;
  // a branch id = that office's people, counted on that office's clock.
  const [branchId, setBranchId] = useState("");
  const { branches, multiBranch } = useBranches();

  // Cached queries: refetched when the MD returns to the tab and whenever a
  // change elsewhere invalidates MD_DASHBOARD_KEY.
  const overviewQuery = useOrgQuery<MDData>([...MD_DASHBOARD_KEY, branchId || "all"], {
    queryFn: async () => {
      const response = await apiFetch(
        `/api/dashboard/managing-director${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ""}`,
      );
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      return response.json();
    },
  });
  const trendQuery = useOrgQuery<{ trend?: TrendPoint[] }>(COMPLIANCE_TREND_KEY, {
    queryFn: async () => {
      const response = await apiFetch("/api/dashboard/compliance-trend");
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      return response.json();
    },
    retry: false,
  });
  // The same attention items as the Executive Hub (cached under one key),
  // so an overdue incident shows here whichever month it happened in.
  const alertsQuery = useOrgQuery(["hub", "compliance-alerts"], { queryFn: getHubComplianceAlerts });
  const overdueIncidents = (alertsQuery.data ?? []).filter((a) => a.source === "incidents" && a.severity === "critical").length;
  const data = overviewQuery.data ?? null;
  const trend = trendQuery.data?.trend ?? EMPTY_TREND;
  const retry = () => {
    void overviewQuery.refetch();
    void trendQuery.refetch();
  };

  const chartData = useMemo(
    () =>
      trend
        .filter((item) => item.avg_score !== null)
        .slice(-13)
        .map((item) => ({
          label: item.week.replace(/^\d{4}-W?/, ""),
          score: Number(item.avg_score),
          sessions: item.session_count,
        })),
    [trend],
  );

  // Compare four-week blocks, weighted by shifts: a single shift scoring 0
  // or 100 shouldn't read as the organisation falling or recovering.
  const comparison = useMemo(() => {
    const recent = weightedAverage(chartData.slice(-4));
    const before = weightedAverage(chartData.slice(-8, -4));
    if (!recent) return null;
    return { recent, change: before ? recent.score - before.score : null };
  }, [chartData]);
  const thinWeeks = chartData.filter((p) => p.sessions < 3).length;

  if (overviewQuery.isLoading) {
    return (
      <HubLayout>
        <div className="space-y-5 pb-12">
          <div className="h-24 w-2/3 animate-pulse rounded-2xl bg-cc-surface" />
          <SkeletonBlocks count={3} height="h-56" />
        </div>
      </HubLayout>
    );
  }

  if (overviewQuery.isError || !data) {
    return (
      <HubLayout>
        <div className="space-y-5 pb-12">
          <PageHeader eyebrow="Governance & Strategy" title="Performance review" />
          <LoadError onRetry={retry}>
            <AlertTriangle size={16} style={{ color: toneColor("danger") }} />
            <span>
              <span className="font-semibold">{translate("md.executive.loadFailed")}.</span>{" "}
              <span style={{ color: MUTED }}>We couldn't load the executive overview.</span>
            </span>
          </LoadError>
        </div>
      </HubLayout>
    );
  }

  const target = data.compliance_target;
  const gap = Math.max(0, target - data.compliance_score);
  const complianceTone = scoreTone(data.compliance_score, target);
  const breakdown = data.team_compliance_breakdown;
  const notScored = breakdown.not_scored ?? 0;
  const scoredTotal = breakdown.compliant + breakdown.at_risk + breakdown.non_compliant;
  const allNotes = scoredTotal + notScored;
  const parts = [
    { key: "compliant", label: "Compliant", value: breakdown.compliant, tone: "good" as Tone },
    { key: "at_risk", label: "At risk", value: breakdown.at_risk, tone: "warning" as Tone },
    { key: "non_compliant", label: "Non-compliant", value: breakdown.non_compliant, tone: "danger" as Tone },
  ];
  // Goals supported: active goals with at least one shift note recorded
  // against them in the last 30 days, through the task the note was for.
  const goalsActive = data.goals_active ?? null;
  const goalsSupported = data.active_goals_supported_30d ?? null;
  const supportedPct = goalsActive && goalsSupported != null ? Math.round((goalsSupported / goalsActive) * 100) : null;
  const supportTone: Tone = supportedPct == null ? "neutral" : supportedPct >= 80 ? "good" : supportedPct >= 50 ? "warning" : "danger";
  const unsupportedGoals = goalsActive != null && goalsSupported != null ? goalsActive - goalsSupported : null;
  const workersBelow = [...data.workers_at_risk].sort((a, b) => a.compliance_score - b.compliance_score);
  const workersBelowCount = data.workers_at_risk_count ?? workersBelow.length;

  const supportCaption =
    unsupportedGoals == null ? "not available" : unsupportedGoals === 0 ? "all supported" : `${unsupportedGoals} not supported`;
  const scorecard: Outcome[] = [
    {
      id: "notes",
      area: "Documentation compliance",
      status: TONE_STATUS[complianceTone],
      headline: data.compliance_score >= target ? "Progress notes meet the target" : `${Math.round(gap)} percentage points below target`,
      detail: `Progress notes average ${percent(data.compliance_score)} against a ${target}% target.`,
      action: { label: "Review progress notes", href: "/sessions" },
      meter: { pct: data.compliance_score, target, label: "Average progress note score" },
      ring: {
        value: `${Math.round(data.compliance_score)}%`,
        label: "Progress notes",
        caption: data.compliance_score >= target ? "meets target" : `${Math.round(gap)}% below target`,
        pct: data.compliance_score,
      },
    },
    {
      id: "coaching",
      area: "Workers below the documentation threshold",
      status: workersBelowCount ? "attention" : "on_track",
      headline: workersBelowCount ? `${workersBelowCount} ${workersBelowCount === 1 ? "worker requires" : "workers require"} documentation support` : "All workers meet the threshold",
      detail: `Workers whose progress notes average under ${WORKER_THRESHOLD}%.`,
      action: { label: "Open worker records", href: "/md/staff" },
      ring: { value: String(workersBelowCount), label: "Workers below threshold", caption: `under ${WORKER_THRESHOLD}%` },
    },
    {
      id: "goals-met",
      area: "Participant goals achieved",
      status: !data.goals_total ? "no_data" : (data.goal_outcome_rate ?? 0) >= 25 ? "on_track" : "attention",
      headline: data.goals_total ? `${data.goals_achieved} of ${data.goals_total} goals` : "No goals recorded",
      detail: data.goals_total ? "Goals marked as achieved by support coordinators." : "Record goals from each participant's NDIS plan.",
      action: { label: "View participants", href: "/onboard-participant/active" },
      ring: {
        value: data.goal_outcome_rate == null ? "N/A" : `${Math.round(data.goal_outcome_rate)}%`,
        label: "Goals achieved",
        caption: data.goals_total ? `${data.goals_achieved} of ${data.goals_total}` : "none recorded",
        pct: data.goal_outcome_rate ?? 0,
      },
    },
    {
      id: "goals-supported",
      area: "Active goals supported in the last 30 days",
      status: TONE_STATUS[supportTone],
      headline: goalsActive ? `${goalsSupported} of ${goalsActive} goals` : "No active goals",
      detail:
        unsupportedGoals == null
          ? "Not available."
          : unsupportedGoals === 0
            ? "Every goal has support recorded."
            : `${unsupportedGoals} with no shift notes against them`,
      action: { label: "View participants", href: "/onboard-participant/active" },
      meter: supportedPct == null ? undefined : { pct: supportedPct, target: 80, label: "Goals with supports delivered in 30 days" },
      ring: { value: supportedPct == null ? "N/A" : `${supportedPct}%`, label: "Goals supported", caption: supportCaption, pct: supportedPct ?? 0 },
    },
    {
      id: "retention",
      area: "Staff retention",
      status: data.staff_retention_rate >= 85 ? "on_track" : data.staff_retention_rate >= 70 ? "attention" : "off_track",
      headline: data.staff_retention_rate >= 85 ? "Workforce is stable" : "Staff turnover requires review",
      detail: `${percent(data.staff_retention_rate)} retention across ${data.active_staff} active staff.`,
      action: { label: "Open worker records", href: "/md/staff" },
      ring: {
        value: `${Math.round(data.staff_retention_rate)}%`,
        label: "Retention",
        caption: data.staff_retention_rate >= 85 ? "stable" : "review turnover",
        pct: data.staff_retention_rate,
      },
    },
    overdueIncidents
      ? {
          id: "incidents",
          area: "Incidents needing action now",
          status: "off_track",
          headline: "Notification or follow-up overdue",
          detail: `${overdueIncidents} overdue. ${data.incidents_this_month} reported this month.`,
          action: { label: "Incident register", href: "/incidents" },
          ring: { value: String(overdueIncidents), label: "Incidents", caption: "overdue" },
        }
      : {
          id: "incidents",
          area: "Incidents this month",
          status: data.incidents_this_month ? "attention" : "on_track",
          headline: data.incidents_this_month ? "Follow-up required" : "None reported",
          detail: `${data.incidents_this_month} reported since the 1st of the month.`,
          action: { label: "Incident register", href: "/incidents" },
          ring: { value: String(data.incidents_this_month), label: "Incidents", caption: "this month" },
        },
  ];

  return (
    <HubLayout>
      <div className="min-w-0 space-y-phi-6 pb-phi-7">
        <PageHeader
          eyebrow={`Governance & Strategy · ${formatDate(data.generated_at)}`}
          title={
            <span className="inline-flex items-center gap-2">
              {data.branch ? `${data.branch.name}: performance review` : "Performance review"}
              <SectionInfo text="How the organisation is tracking against its targets over time. Today's to-do list lives on the Executive Hub." />
            </span>
          }
          description={<span className="text-xs">Updated {formatTime(data.generated_at)}</span>}
          actions={
            <>
              <GovernanceTriage
                variant="floating"
                onNavigate={navigate}
                workersAtRisk={data.workers_at_risk}
                viewAllHref="/hub"
                viewAllLabel="Executive Hub"
              />
              <button type="button" onClick={retry} className={ghostClass}>
                <RefreshCw size={15} />
                Refresh
              </button>
            </>
          }
        />

        {multiBranch && (
          <label className="flex flex-wrap items-center gap-2 text-sm" style={{ color: MUTED }}>
            <span className="sr-only">Branch</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="min-h-10 rounded-full border border-cc-border bg-cc-surface px-4 text-sm"
              style={{ color: TEXT }}
              aria-label="Filter by branch"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({zoneAbbreviation(new Date(), b.timezone)})
                </option>
              ))}
            </select>
            {data.timezone && <span>Times in {zoneAbbreviation(new Date(), data.timezone)}</span>}
          </label>
        )}

        <Section title="Outcomes against targets" description="Each area measured against its target, with the action to take.">
          <OutcomeList outcomes={scorecard} onNavigate={navigate} />
        </Section>

        {workersBelow.length > 0 && (
          <Section
            title="Workers requiring documentation support"
            description={`Workers whose progress notes average under ${WORKER_THRESHOLD}%, lowest first. Open a worker to review their progress notes.`}
            action={<Link href="/md/staff" className={ghostClass}>Open worker records <ArrowRight size={14} /></Link>}
          >
            {/* One ruled list, lowest score first: name, score against the
                threshold, and where to help. */}
            <ul className="divide-y divide-cc-border overflow-hidden rounded-xl border border-cc-border bg-cc-surface">
              {workersBelow.map((worker) => (
                <li key={worker.id}>
                  <Link
                    href={`/md/staff?workerId=${encodeURIComponent(worker.id)}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-3.5 transition-colors hover:bg-cc-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum md:grid-cols-[minmax(12rem,16rem)_minmax(10rem,1fr)_auto]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cc-soft text-xs font-semibold" style={{ color: TEXT }} aria-hidden>
                        {worker.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold group-hover:underline" style={{ color: TEXT }}>{worker.full_name}</span>
                        <span className="block text-xs" style={{ color: MUTED }}>{worker.sessions} scored {worker.sessions === 1 ? "shift" : "shifts"}</span>
                      </span>
                    </span>
                    <ScoreMeter className="col-span-2 md:col-span-1 md:max-w-md" size="sm" value={worker.compliance_score} good={WORKER_THRESHOLD} ariaLabel={`${worker.full_name}'s shift note score`} />
                    <span className="hidden items-center gap-1 whitespace-nowrap text-xs font-semibold md:inline-flex" style={{ color: TEXT }}>
                      Review progress notes <ArrowRight size={13} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* The trend charts explain the outcomes above; they're here when
            wanted, not in the way of what to do. */}
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-cc-border bg-cc-surface px-5 py-3 text-sm font-semibold text-cc-text hover:bg-cc-soft [&::-webkit-details-marker]:hidden">
            Trends
            <span className="text-xs font-normal text-cc-muted">Documentation compliance over time, and where shift notes stand</span>
          </summary>
          <div className="pt-6">
        <div className="grid gap-8 xl:grid-golden">
          <Section
            title="Documentation compliance over time"
            description="Weekly average progress note score. Bars show the number of shifts assessed each week."
            className="flex flex-col"
          >
            <Surface className="flex-1 p-5">
              {trendQuery.isError ? (
                <div role="status" className="py-10 text-center">
                  <p className="text-base font-semibold" style={{ color: TEXT }}>Compliance trend unavailable</p>
                  <p className="mt-1 text-sm" style={{ color: MUTED }}>The other figures on this page are still current. Refresh to try again.</p>
                </div>
              ) : trendQuery.isLoading ? (
                <div className="h-[260px] animate-pulse rounded-xl" style={{ background: SOFT }} />
              ) : chartData.length < 2 ? (
                <div className="py-10 text-center">
                  <p className="text-base font-semibold" style={{ color: TEXT }}>Building your performance trend</p>
                  <p className="mt-1 text-sm" style={{ color: MUTED }}>A trend appears once two weeks have scored shift notes.</p>
                </div>
              ) : (
                <>
                  {comparison && (
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: toneColor(scoreTone(comparison.recent.score, target)) }}>
                        {percent(comparison.recent.score)}
                      </span>
                      <span className="text-sm" style={{ color: MUTED }}>
                        over the last four weeks, across {comparison.recent.shifts} scored {comparison.recent.shifts === 1 ? "shift" : "shifts"}
                      </span>
                      {comparison.change !== null && (
                        <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: toneColor(comparison.change >= 0 ? "good" : "danger") }}>
                          {comparison.change >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                          {comparison.change >= 0 ? "+" : ""}
                          {Math.round(comparison.change * 10) / 10} pts on the four weeks before
                        </span>
                      )}
                    </p>
                  )}
                  {/* Two charts on the same weeks rather than one chart with two
                      scales: the score, then how many shifts each week's score
                      rests on. */}
                  <div className="mt-4 h-[220px]" role="img" aria-label="Weekly average note score">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} syncId="exec-quality" margin={{ top: 16, right: 8, bottom: 0, left: -12 }}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="label" {...AXIS_PROPS} tickFormatter={(v) => `W${v}`} hide />
                        <YAxis domain={[0, 100]} {...AXIS_PROPS} tickFormatter={(v) => `${v}%`} />
                        <Tooltip content={<TrendTooltip />} cursor={TOOLTIP_PROPS.cursor} />
                        <ReferenceLine y={target} {...referenceProps(`Target ${target}%`)} />
                        <Line type="linear" dataKey="score" isAnimationActive={false} {...lineProps(SERIES[0])} dot={{ r: 3, fill: SERIES[0], strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>Scored shifts each week</p>
                  <div className="h-[72px]" role="img" aria-label="Scored shifts each week">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} syncId="exec-quality" margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                        <XAxis dataKey="label" {...AXIS_PROPS} tickFormatter={(v) => `W${v}`} />
                        <YAxis {...AXIS_PROPS} allowDecimals={false} tickCount={2} />
                        <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--cc-soft)" }} />
                        <Bar dataKey="sessions" fill="var(--cc-muted)" fillOpacity={0.45} {...BAR_PROPS} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {thinWeeks > 0 && (
                    <p className="mt-3 text-xs" style={{ color: MUTED }}>
                      {thinWeeks} of these weeks scored fewer than three shifts, so one note moves the whole week. Read the four-week figure above for the direction.
                    </p>
                  )}
                </>
              )}
            </Surface>
          </Section>

          <Section title="Where the shift notes stand" description={`${allNotes} shift notes in the current review window.`} className="flex flex-col">
            <Surface className="flex flex-1 flex-col p-5">
              <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: SOFT }} aria-hidden="true">
                {parts.map((p) => (
                  <div key={p.key} style={{ width: `${allNotes ? (p.value / allNotes) * 100 : 0}%`, background: toneColor(p.tone) }} />
                ))}
              </div>
              <ul className="mt-5 flex-1 divide-y" style={{ borderColor: BORDER }}>
                {[...parts, { key: "not_scored", label: "Not scored yet", value: notScored, tone: "neutral" as Tone }].map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3 py-3.5 text-sm">
                    <span className="flex items-center gap-2" style={{ color: TEXT }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: p.tone === "neutral" ? BORDER : toneColor(p.tone) }} />
                      {p.label}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{p.value}</span>
                      <span className="w-10 text-right text-xs tabular-nums" style={{ color: MUTED }}>
                        {allNotes ? `${Math.round((p.value / allNotes) * 100)}%` : "0%"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/sessions" className={`${outlineClass} mt-4 w-full`}>
                Review shift notes
                <ArrowRight size={15} />
              </Link>
            </Surface>
          </Section>
        </div>

          </div>
        </details>
      </div>
    </HubLayout>
  );
}
