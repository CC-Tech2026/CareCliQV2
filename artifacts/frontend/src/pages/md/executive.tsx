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
  RowList,
  Section,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ghostClass,
  outlineClass,
  rowClass,
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
        <div className="space-y-8 pb-12">
          <div className="h-24 w-2/3 animate-pulse rounded-2xl bg-cc-surface" />
          <SkeletonBlocks count={3} height="h-56" />
        </div>
      </HubLayout>
    );
  }

  if (overviewQuery.isError || !data) {
    return (
      <HubLayout>
        <div className="space-y-8 pb-12">
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
  const goalTone: Tone = data.goal_achievement_rate >= 50 ? "good" : data.goal_achievement_rate >= 25 ? "warning" : "danger";
  const workersBelow = [...data.workers_at_risk].sort((a, b) => a.compliance_score - b.compliance_score);

  const scorecard: Array<{ label: string; value: string; target: string; tone: Tone; status: string; href: string; action: string }> = [
    {
      label: "Documentation compliance",
      value: percent(data.compliance_score),
      target: `${target}% target`,
      tone: complianceTone,
      status: data.compliance_score >= target ? "On target" : `${Math.round(gap)} pts below target`,
      href: "/md/compliance?view=shifts",
      action: "Review shift notes",
    },
    {
      label: "Workers below the documentation threshold",
      value: String(workersBelow.length),
      target: `scoring under ${WORKER_THRESHOLD}%`,
      tone: workersBelow.length ? "warning" : "good",
      status: workersBelow.length ? "Support needed" : "Everyone on target",
      href: "/md/staff",
      action: "Open staff",
    },
    {
      label: "Participant goal achievement",
      value: percent(data.goal_achievement_rate),
      target: "of active goals achieved",
      tone: goalTone,
      status: data.goal_achievement_rate >= 50 ? "Progressing" : "Few goals achieved",
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
    {
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
      <div className="min-w-0 space-y-8 pb-12">
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

        <SummaryStrip
          items={[
            {
              value: percent(data.compliance_score),
              label: "documentation compliance",
              tone: complianceTone,
              hint: data.compliance_score >= target ? `At or above the ${target}% target` : `${Math.round(gap)} pts below the ${target}% target`,
              onClick: () => navigate("/md/compliance?view=shifts"),
            },
            {
              value: percent(data.goal_achievement_rate),
              label: "goals achieved",
              tone: goalTone,
              hint: `${data.active_participants} active participants`,
              onClick: () => navigate("/onboard-participant/active"),
            },
            {
              value: percent(data.staff_retention_rate),
              label: "staff retention",
              hint: `${data.support_workers} support workers`,
              onClick: () => navigate("/md/staff"),
            },
            {
              value: data.sessions_this_week,
              label: data.sessions_this_week === 1 ? "shift this week" : "shifts this week",
              hint: "Recorded since Monday",
              onClick: () => navigate("/md/schedule"),
            },
          ]}
        />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
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
              <Link href="/md/compliance?view=shifts" className={`${outlineClass} mt-4 w-full`}>
                Review shift notes
                <ArrowRight size={15} />
              </Link>
            </Surface>
          </Section>
        </div>

        <Section title="Scorecard" description="Each measure against its target, with where to act on it.">
          <Surface>
            <div
              className="hidden grid-cols-[minmax(0,1fr)_110px_190px_190px] items-center gap-4 border-b px-5 py-2.5 text-xs font-medium md:grid"
              style={{ borderColor: BORDER, color: MUTED }}
              aria-hidden="true"
            >
              <span>Measure</span>
              <span className="text-right">Now</span>
              <span>Status</span>
              <span className="text-right">Where to act</span>
            </div>
            <RowList>
              {scorecard.map((row) => (
                <li key={row.label}>
                  <Link
                    href={row.href}
                    aria-label={`${row.label}: ${row.value}. ${row.action}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum md:grid-cols-[minmax(0,1fr)_110px_190px_190px]"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold" style={{ color: TEXT }}>{row.label}</span>
                      <span className="block text-xs" style={{ color: MUTED }}>{row.target}</span>
                    </span>
                    <span className="text-right text-lg font-semibold tabular-nums" style={{ color: toneColor(row.tone) }}>{row.value}</span>
                    <span className="col-span-2 md:col-span-1"><StatusText tone={row.tone}>{row.status}</StatusText></span>
                    <span className="hidden items-center justify-end gap-1 text-sm md:flex" style={{ color: MUTED }}>
                      {row.action}
                      <ArrowRight size={14} />
                    </span>
                  </Link>
                </li>
              ))}
            </RowList>
          </Surface>
        </Section>

        {workersBelow.length > 0 && (
          <Section
            title="Workers who need documentation support"
            description={`Scoring under ${WORKER_THRESHOLD}% on their shift notes, lowest first. The mark on each bar is the ${WORKER_THRESHOLD}% threshold.`}
            action={<Link href="/md/staff" className={ghostClass}>Open staff <ArrowRight size={14} /></Link>}
          >
            <Surface>
              <RowList>
                {workersBelow.map((worker) => (
                  <li key={worker.id}>
                    <Link href={`/md/staff?workerId=${encodeURIComponent(worker.id)}`} className={rowClass}>
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cc-soft text-xs font-semibold"
                        style={{ color: toneColor(worker.compliance_score < 60 ? "danger" : "warning") }}
                        aria-hidden="true"
                      >
                        {worker.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>{worker.full_name}</span>
                        <span className="block text-xs" style={{ color: MUTED }}>
                          {worker.sessions} scored {worker.sessions === 1 ? "shift" : "shifts"}
                        </span>
                      </span>
                      <span className="relative hidden h-2 w-48 shrink-0 overflow-hidden rounded-full sm:block" style={{ background: SOFT }} aria-hidden="true">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(2, worker.compliance_score))}%`, background: toneColor(worker.compliance_score < 60 ? "danger" : "warning") }}
                        />
                        <span className="absolute inset-y-0 w-0.5" style={{ left: `${WORKER_THRESHOLD}%`, background: TEXT, opacity: 0.35 }} />
                      </span>
                      <span className="w-12 text-right text-sm font-semibold tabular-nums" style={{ color: toneColor(worker.compliance_score < 60 ? "danger" : "warning") }}>
                        {Math.round(worker.compliance_score)}%
                      </span>
                      <ArrowRight size={14} style={{ color: MUTED }} />
                    </Link>
                  </li>
                ))}
              </RowList>
            </Surface>
          </Section>
        )}
      </div>
    </HubLayout>
  );
}
