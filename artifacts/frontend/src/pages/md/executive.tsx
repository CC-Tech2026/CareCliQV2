import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useLocation } from "wouter";
import { HubLayout } from "@/components/layout/HubLayout";
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

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const EMPTY_TREND: TrendPoint[] = [];
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
    <div className="rounded-xl border bg-cc-surface px-3 py-2 text-xs" style={{ borderColor: BORDER }}>
      <p className="font-semibold" style={{ color: TEXT }}>Week {point.label}</p>
      <p style={{ color: MUTED }}>
        <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{percent(point.score)}</span> average
        across {point.sessions} scored {point.sessions === 1 ? "shift" : "shifts"}
      </p>
    </div>
  );
}

/** A score as a ring, with the target marked as a tick on the circle. */
function ScoreRing({ pct, target, color, initials }: { pct: number; target?: number; color: string; initials?: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, pct));
  const tickAngle = target != null ? (target / 100) * 2 * Math.PI - Math.PI / 2 : null;
  return (
    <span className="relative inline-flex h-[76px] w-[76px] shrink-0 items-center justify-center" aria-hidden>
      <svg width="76" height="76" viewBox="0 0 76 76" className="absolute inset-0">
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--cc-soft)" strokeWidth="7" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 38 38)"
        />
        {tickAngle != null ? (
          <line
            x1={38 + (r - 6) * Math.cos(tickAngle)} y1={38 + (r - 6) * Math.sin(tickAngle)}
            x2={38 + (r + 6) * Math.cos(tickAngle)} y2={38 + (r + 6) * Math.sin(tickAngle)}
            stroke="var(--cc-text)" strokeWidth="2" strokeLinecap="round" opacity="0.55"
          />
        ) : null}
      </svg>
      <span className="relative text-center leading-none">
        {initials ? (
          <span className="text-sm font-semibold" style={{ color: TEXT }}>{initials}</span>
        ) : (
          <span className="text-lg font-semibold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
        )}
      </span>
    </span>
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

  const scorecard: Array<{ label: string; value: string; target: string; tone: Tone; status: string; href: string; action: string }> = [
    {
      label: "Documentation compliance",
      value: percent(data.compliance_score),
      target: `${target}% target`,
      tone: complianceTone,
      status: data.compliance_score >= target ? "On target" : `${Math.round(gap)} pts below target`,
      href: "/sessions",
      action: "Review shift notes",
    },
    {
      label: "Workers below the documentation threshold",
      value: String(workersBelowCount),
      target: `scoring under ${WORKER_THRESHOLD}%`,
      tone: workersBelowCount ? "warning" : "good",
      status: workersBelowCount ? "Support needed" : "Everyone on target",
      href: "/md/staff",
      action: "Open staff",
    },
    {
      label: "Participant goals achieved",
      value: data.goal_outcome_rate == null ? "N/A" : percent(data.goal_outcome_rate),
      target: data.goals_total ? `${data.goals_achieved} of ${data.goals_total} goals` : "no goals recorded",
      tone: "neutral",
      status: data.goals_total ? "Marked completed by coordinators" : "Add goals to participant plans",
      href: "/onboard-participant/active",
      action: "View participants",
    },
    {
      label: "Active goals supported in the last 30 days",
      value: supportedPct == null ? "N/A" : `${supportedPct}%`,
      target: goalsActive ? `${goalsSupported} of ${goalsActive} goals` : "no active goals",
      tone: supportTone,
      status:
        unsupportedGoals == null
          ? "Not available"
          : unsupportedGoals === 0
            ? "Every goal has support recorded"
            : `${unsupportedGoals} with no shift notes against them`,
      href: "/onboard-participant/active",
      action: "View participants",
    },
    {
      label: "Staff retention",
      value: percent(data.staff_retention_rate),
      target: `${data.active_staff} active staff`,
      tone: data.staff_retention_rate >= 85 ? "good" : data.staff_retention_rate >= 70 ? "warning" : "danger",
      status: data.staff_retention_rate >= 85 ? "Stable" : "Watch turnover",
      href: "/md/staff",
      action: "Staff directory",
    },
    overdueIncidents
      ? {
          label: "Incidents needing action now",
          value: String(overdueIncidents),
          target: `${data.incidents_this_month} recorded this month`,
          tone: "danger",
          status: "Notification or follow-up overdue",
          href: "/incidents",
          action: "Incident register",
        }
      : {
          label: "Incidents this month",
          value: String(data.incidents_this_month),
          target: "recorded since the 1st",
          tone: data.incidents_this_month ? "warning" : "good",
          status: data.incidents_this_month ? "Follow up" : "None recorded",
          href: "/incidents",
          action: "Incident register",
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
          description={
            <>
              How the organisation is tracking against its targets, and which way it's heading.
              <span className="mt-1 block text-xs">Updated {formatTime(data.generated_at)}</span>
            </>
          }
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

        <Section title="Outcomes against targets" description="Where each outcome stands against its target, and where to act on it.">
          <ul className="grid gap-phi-4 sm:grid-cols-2 xl:grid-cols-3">
            {scorecard.map((row) => {
              const pct = /%$/.test(row.value) ? Number.parseFloat(row.value) : null;
              const target = Number.parseFloat((/(\d+)%/.exec(row.target) ?? [])[1] ?? "");
              return (
                <li key={row.label}>
                  <Link
                    href={row.href}
                    aria-label={`${row.label}: ${row.value}. ${row.status}. ${row.action}`}
                    className="flex h-full items-center gap-phi-4 rounded-2xl border border-cc-border bg-cc-surface p-phi-5 transition hover:border-cc-text/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                  >
                    {pct != null ? (
                      <ScoreRing pct={pct} target={Number.isFinite(target) ? target : undefined} color={toneColor(row.tone)} />
                    ) : (
                      <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-cc-soft text-2xl font-semibold tabular-nums" style={{ color: toneColor(row.tone) }}>
                        {row.value}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-snug" style={{ color: TEXT }}>{row.label}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: MUTED }}>{row.target}</span>
                      <span className="mt-phi-2 block"><StatusText tone={row.tone}>{row.status}</StatusText></span>
                      <span className="mt-phi-2 flex items-center gap-1 text-xs font-semibold" style={{ color: TEXT }}>
                        {row.action} <ArrowRight size={13} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>

        {workersBelow.length > 0 && (
          <Section
            title="Who to follow up"
            description={`Workers whose shift notes score under ${WORKER_THRESHOLD}%, lowest first. Open one to see their notes and help them.`}
            action={<Link href="/md/staff" className={ghostClass}>Open staff <ArrowRight size={14} /></Link>}
          >
            <ul className="grid gap-phi-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {workersBelow.map((worker) => {
                const tone = worker.compliance_score < 60 ? "danger" : "warning";
                return (
                  <li key={worker.id}>
                    <Link
                      href={`/md/staff?workerId=${encodeURIComponent(worker.id)}`}
                      className="flex h-full flex-col items-center rounded-2xl border border-cc-border bg-cc-surface p-phi-5 text-center transition hover:border-cc-text/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                    >
                      <ScoreRing pct={worker.compliance_score} target={WORKER_THRESHOLD} color={toneColor(tone)} initials={worker.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()} />
                      <span className="mt-phi-3 block truncate text-sm font-semibold" style={{ color: TEXT }}>{worker.full_name}</span>
                      <span className="block text-xs" style={{ color: MUTED }}>
                        {Math.round(worker.compliance_score)}% across {worker.sessions} scored {worker.sessions === 1 ? "shift" : "shifts"}
                      </span>
                      <span className="mt-phi-3 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: TEXT }}>
                        Review their notes <ArrowRight size={13} />
                      </span>
                    </Link>
                  </li>
                );
              })}
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
            description="Weekly average score of shift notes. Bars show how many shifts each week is based on."
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
                  <div className="mt-4 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `W${v}`} />
                        <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <YAxis yAxisId="shifts" orientation="right" hide domain={[0, (max: number) => Math.max(4, max * 3)]} />
                        <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--cc-soft)" }} />
                        <Bar yAxisId="shifts" dataKey="sessions" fill="var(--cc-border)" radius={[4, 4, 0, 0]} barSize={18} isAnimationActive={false} />
                        <ReferenceLine
                          yAxisId="score"
                          y={target}
                          stroke={toneColor("warning")}
                          strokeDasharray="4 3"
                          label={{ value: `Target ${target}%`, position: "insideBottomLeft", fontSize: 11, fill: toneColor("warning") }}
                        />
                        <Line
                          yAxisId="score"
                          type="linear"
                          dataKey="score"
                          isAnimationActive={false}
                          stroke={PLUM}
                          strokeWidth={2.5}
                          dot={{ r: 3.5, fill: PLUM, strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                      </ComposedChart>
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
