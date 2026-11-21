import { useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  FolderLock,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
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
import { HubLayout } from "@/components/layout/HubLayout";
import {
  EmptyState,
  LoadError,
  PageHeader,
  RowList,
  Section,
  SkeletonBlocks,
  StatusText,
  Surface,
  ctaClass,
  ghostClass,
  toneColor,
  type Tone,
} from "@/components/layout/PageKit";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { AUDIT_READINESS_KEY, fetchChecklist } from "@/services/auditReadinessService";
import { GapAnalysis, buildGaps } from "./compliance-gaps";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

// Compliance severity stays traffic-light red/amber/green, never brand colours.
const GREEN = toneColor("good");
const AMBER = toneColor("warning");
const RED = toneColor("danger");

interface MDData {
  compliance_score: number;
  compliance_target: number;

  common_issues: Array<{
    issue: string;
    count: number;
  }>;

  worker_rankings: Array<{
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

  team_compliance_breakdown: {
    compliant: number;
    at_risk: number;
    non_compliant: number;
  };

  workers_at_risk?: Array<{ id: string }>;
  workers_at_risk_count?: number;
  goals_active?: number | null;
  active_goals_supported_30d?: number | null;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

type AuditStatus = "ready" | "attention" | "pending";

// The same bands as a single shift note (sessions.tsx, dashboards.py), so a
// score means the same thing on every page.
function scoreTone(score: number): Tone {
  if (score >= 85) return "good";
  if (score >= 60) return "warning";
  return "danger";
}

function getScoreLabel(score: number) {
  if (score >= 85) return "On target";
  if (score >= 60) return "Needs review";
  return "Priority review";
}

function getAuditStatus(
  score: number,
  target: number,
  highAlerts: number,
  nonCompliant: number,
): AuditStatus {
  if (score >= target && highAlerts === 0 && nonCompliant === 0) {
    return "ready";
  }

  if (highAlerts > 0 || nonCompliant > 0 || score < target) {
    return "attention";
  }

  return "pending";
}

const AUDIT_STATUS: Record<AuditStatus, { tone: Tone; overall: string; item: string }> = {
  ready: { tone: "good", overall: "Quality target met", item: "Complete" },
  attention: { tone: "danger", overall: "Attention required", item: "Review" },
  pending: { tone: "warning", overall: "Pending", item: "Pending" },
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function IconTile({ icon: Icon, tone }: { icon: React.ComponentType<{ size?: number }>; tone: Tone }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
      style={{ background: SOFT, color: tone === "neutral" ? MUTED : toneColor(tone) }}
      aria-hidden="true"
    >
      <Icon size={16} />
    </span>
  );
}

function WorkerRow({ worker, tone }: { worker: MDData["worker_rankings"][number]; tone: Tone }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: SOFT, color: toneColor(tone) }}
        aria-hidden="true"
      >
        {initials(worker.full_name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>{worker.full_name}</span>
        <span className="block text-xs" style={{ color: MUTED }}>{worker.sessions} sessions</span>
      </span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: toneColor(tone) }}>{worker.compliance_score}%</span>
    </li>
  );
}

/** How one shift note gets its score (sessions.py, compliance_engine.py),
 *  folded away so it explains a low documentation score without taking the page. */
function ScoreExplainer() {
  return (
    <Section
      title="How a shift note is scored"
      description="Every submitted shift note gets a score out of 100. The documentation figures on this page are averages of these."
    >
      <Surface>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold" style={{ color: TEXT }}>
            Show the scoring rules
            <ChevronRight size={16} className="transition-transform group-open:rotate-90" style={{ color: MUTED }} />
          </summary>
          <div className="grid gap-6 border-t px-5 pb-5 pt-4 lg:grid-cols-2" style={{ borderColor: BORDER }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: TEXT }}>70% from CareCliQ's rule checks</p>
              <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                Session time and duration, written within 48 hours, note detail, support type, goals referenced, objective
                language, person-first language, scope of practice, incident triggers, restrictive practice reported, not
                copied from earlier notes, and the participant's response. Budget, shift-length and long-shift checks are
                added when they apply.
              </p>
              <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>
                A pass earns the full share, a warning half, a fail nothing. A note whose times don't match the shift loses
                10 points, and a note too short to evidence the support can't score above 50%.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: TEXT }}>30% from the AI review</p>
              <ul className="mt-1 space-y-0.5 text-sm leading-6" style={{ color: MUTED }}>
                <li>Documentation completeness, 30 points</li>
                <li>Goal alignment, 25 points</li>
                <li>NDIS language, 20 points</li>
                <li>Risk detection, 15 points</li>
                <li>Audit readiness, 10 points</li>
              </ul>
              <p className="mt-3 text-sm font-semibold" style={{ color: TEXT }}>Bands</p>
              <ul className="mt-1 space-y-0.5 text-sm leading-6" style={{ color: MUTED }}>
                <li><span className="font-semibold" style={{ color: GREEN }}>85% and above</span>: compliant</li>
                <li><span className="font-semibold" style={{ color: AMBER }}>60% to 84%</span>: at risk, needs review</li>
                <li><span className="font-semibold" style={{ color: RED }}>Under 60%</span>: non-compliant, priority review</li>
              </ul>
              <p className="mt-2 text-xs leading-5" style={{ color: MUTED }}>
                Notes not yet submitted aren't scored and aren't counted.
              </p>
            </div>
          </div>
        </details>
      </Surface>
    </Section>
  );
}

export default function MDCompliancePage({ embedded = false }: { embedded?: boolean }) {
  const Layout = embedded ? Fragment : HubLayout;
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [trendError, setTrendError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setTrendError(false);

    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),

      apiFetch("/api/dashboard/compliance-trend")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .catch(() => {
          if (!cancelled) setTrendError(true);
          return { trend: [] };
        }),
    ])
      .then(([md, tr]) => {
        if (cancelled) return;

        setData(md);
        setTrend(tr.trend ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const checklist = useOrgQuery([...AUDIT_READINESS_KEY, "checklist"], { queryFn: fetchChecklist, retry: false });

  const chartData = trend
    .filter((point) => point.avg_score !== null)
    .slice(-13)
    .map((point) => ({
      week: point.week.replace(/^\d{4}-/, ""),
      score: point.avg_score,
      sessions: point.session_count,
    }));

  const derived = useMemo(() => {
    if (!data) return null;

    const breakdown = data.team_compliance_breakdown;

    const total =
      breakdown.compliant + breakdown.at_risk + breakdown.non_compliant;

    const compliantPercent =
      total > 0 ? Math.round((breakdown.compliant / total) * 100) : 0;

    const atRiskPercent =
      total > 0 ? Math.round((breakdown.at_risk / total) * 100) : 0;

    const nonCompliantPercent =
      total > 0 ? Math.max(0, 100 - compliantPercent - atRiskPercent) : 0;

    const highAlerts = data.org_alerts.filter(
      (alert) => alert.severity === "high",
    ).length;

    const readiness = total === 0 ? "pending" : getAuditStatus(
      data.compliance_score,
      data.compliance_target,
      highAlerts,
      breakdown.non_compliant,
    );

    const attentionWorkers = [...data.worker_rankings]
      .filter((worker) => worker.compliance_score < 85)
      .sort((a, b) => a.compliance_score - b.compliance_score)
      .slice(0, 5);

    // Strongest performers only from those on target, so a small team doesn't
    // show the same worker as both needing support and strongest.
    const strongestWorkers = [...data.worker_rankings]
      .filter((worker) => worker.compliance_score >= 85)
      .sort((a, b) => b.compliance_score - a.compliance_score)
      .slice(0, 5);

    const topIssues = [...data.common_issues]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total,
      compliantPercent,
      atRiskPercent,
      nonCompliantPercent,
      highAlerts,
      readiness,
      strongestWorkers,
      attentionWorkers,
      topIssues,
    };
  }, [data]);

  const gapReport = useMemo(
    () =>
      data && derived
        ? buildGaps({
            data,
            checklist: checklist.data,
            attentionWorkers: derived.attentionWorkers,
            workersBelow: data.workers_at_risk_count ?? data.workers_at_risk?.length ?? derived.attentionWorkers.length,
          })
        : null,
    [data, derived, checklist.data],
  );

  return (
    <Layout>
      <div className="space-y-5 pb-12">
        {!embedded && (
          <PageHeader
            eyebrow="Oversight & Risk"
            title="Audit & Compliance"
            description="Review compliance risks, evidence readiness and staff follow-up in one place."
            actions={
              <>
                <Link href="/md/compliance?view=overview" className={ghostClass}>Audit readiness</Link>
                <Link href="/md/vault" className={ghostClass}><FolderLock size={16} />Document vault</Link>
                <Link href="/md/onboarding/training" className={ghostClass}>Competency & training</Link>
              </>
            }
          />
        )}

        {loading ? (
          <div className="space-y-6">
            <div className="h-11 w-2/3 animate-pulse rounded-full bg-cc-surface" />
            <SkeletonBlocks count={2} height="h-56" />
          </div>
        ) : error || !data || !derived ? (
          <LoadError onRetry={() => setRetryKey((key) => key + 1)}>
            <AlertTriangle size={16} style={{ color: AMBER }} />
            <span>
              <span className="font-semibold">{translate("md.compliance.loadFailed")}.</span>{" "}
              <span style={{ color: MUTED }}>We could not load the organisation quality data.</span>
            </span>
          </LoadError>
        ) : derived.total === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No scored shift notes yet"
            body="Documentation quality will appear when submitted shift notes have been scored. You can review audit evidence separately."
            action={<Link href="/md/compliance?view=overview" className={ctaClass}>Review audit evidence <ArrowRight size={15} /></Link>}
          />
        ) : (
          <>
            <div className="flex justify-end">
              <button type="button" onClick={() => setRetryKey((key) => key + 1)} className={ghostClass}>
                Refresh
              </button>
            </div>

            {gapReport && (
              <GapAnalysis
                report={gapReport}
                checklistState={checklist.isLoading ? "loading" : checklist.isError ? "error" : "ready"}
              />
            )}

            {/* The shift note figures behind the documentation gap, when wanted. */}
            <details className="group rounded-2xl border border-cc-border bg-cc-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold hover:bg-cc-soft [&::-webkit-details-marker]:hidden" style={{ color: TEXT }}>
                Shift note documentation
                <span className="text-xs font-normal group-open:hidden" style={{ color: MUTED }}>Score against target, and how notes split</span>
              </summary>
              <div className="border-t border-cc-border">
            <Surface className="p-5 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-semibold" style={{ color: TEXT }}>
                      {getScoreLabel(data.compliance_score)}
                    </p>
                    <StatusText tone={AUDIT_STATUS[derived.readiness].tone}>
                      {/* On target but not audit-ready: say what's holding it
                          back, so it doesn't read as a contradiction. */}
                      {derived.readiness === "attention" && data.compliance_score >= data.compliance_target
                        ? `${[
                            data.team_compliance_breakdown.non_compliant
                              ? `${data.team_compliance_breakdown.non_compliant} non-compliant ${data.team_compliance_breakdown.non_compliant === 1 ? "note" : "notes"}`
                              : null,
                            derived.highAlerts
                              ? `${derived.highAlerts} high-priority ${derived.highAlerts === 1 ? "alert" : "alerts"}`
                              : null,
                          ].filter(Boolean).join(" and ")} to review`
                        : AUDIT_STATUS[derived.readiness].overall}
                    </StatusText>
                  </div>
                  <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                    {data.compliance_score >= data.compliance_target
                      ? "Shift notes are at or above the documentation target."
                      : "Shift notes are below the documentation target. Start with the issues that recur most."}
                  </p>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs" style={{ color: MUTED }}>
                      <span>Progress toward {data.compliance_target}% target</span>
                      <span className="font-semibold tabular-nums" style={{ color: TEXT }}>
                        {data.compliance_score >= data.compliance_target
                          ? "Target met"
                          : `${Math.round(data.compliance_target - data.compliance_score)} pts to go`}
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full" style={{ background: SOFT }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(data.compliance_score, 100)}%`, background: toneColor(scoreTone(data.compliance_score)) }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-base font-semibold" style={{ color: TEXT }}>How shift notes split</p>
                  <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                    {derived.total} scored {derived.total === 1 ? "shift note" : "shift notes"}, the most recent up to 400.
                  </p>
                  <div className="mt-4 flex h-2 overflow-hidden rounded-full" style={{ background: SOFT }} aria-hidden="true">
                    <div style={{ width: `${derived.compliantPercent}%`, background: GREEN }} />
                    <div style={{ width: `${derived.atRiskPercent}%`, background: AMBER }} />
                    <div style={{ width: `${derived.nonCompliantPercent}%`, background: RED }} />
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: MUTED }}>
                    {[
                      { label: "Compliant", pct: derived.compliantPercent, color: GREEN },
                      { label: "At risk", pct: derived.atRiskPercent, color: AMBER },
                      { label: "Non-compliant", pct: derived.nonCompliantPercent, color: RED },
                    ].map((part) => (
                      <li key={part.label} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: part.color }} />
                        {part.label}
                        <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{part.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Surface>

              </div>
            </details>

            {trendError && (
              <p role="status" className="rounded-2xl bg-cc-surface px-5 py-4 text-sm" style={{ color: MUTED }}>
                The compliance trend could not be loaded. Refresh to try again; the other records are still available.
              </p>
            )}
            <div className={`grid gap-8 ${chartData.length > 1 ? "lg:grid-cols-3" : ""}`}>
              {chartData.length > 1 && (
                <Section
                  className="lg:col-span-2"
                  title="Compliance trajectory"
                  description="Weekly average score for the last quarter. The dashed line is your target."
                >
                  <Surface className="p-5">
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 5, right: 15, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                          <XAxis dataKey="week" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                          <ReferenceLine y={data.compliance_target} stroke={AMBER} strokeDasharray="4 3" />
                          <Tooltip
                            contentStyle={{ borderRadius: 12, border: `1px solid ${BORDER}`, fontSize: 12 }}
                            formatter={(value: number) => [`${value}%`, "Weekly score"]}
                          />
                          <Line type="monotone" dataKey="score" stroke={PLUM} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: PLUM }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Surface>
                </Section>
              )}

              <Section
                title="Worker quality signals"
                description="Workers who need support, and the strongest performers."
                action={
                  <button type="button" onClick={() => navigate("/md/staff")} className={ghostClass}>
                    View staff <ArrowRight size={14} />
                  </button>
                }
              >
                <Surface>
                  {derived.attentionWorkers.length === 0 && derived.strongestWorkers.length === 0 ? (
                    <p className="px-5 py-6 text-sm" style={{ color: MUTED }}>No worker scores yet.</p>
                  ) : (
                    <RowList>
                      {derived.attentionWorkers.slice(0, 3).map((worker) => (
                        <WorkerRow key={`risk-${worker.id}`} worker={worker} tone="danger" />
                      ))}
                      {derived.strongestWorkers.slice(0, 2).map((worker) => (
                        <WorkerRow key={`strong-${worker.id}`} worker={worker} tone="good" />
                      ))}
                    </RowList>
                  )}
                </Surface>
              </Section>
            </div>

            <ScoreExplainer />

            <Surface className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <IconTile icon={ShieldCheck} tone={gapReport?.gaps.length ? (gapReport.criticalTotal ? "danger" : "warning") : "good"} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>Executive quality decision</p>
                  <p className="mt-0.5 max-w-2xl text-sm leading-6" style={{ color: MUTED }}>
                    {!gapReport?.gaps.length
                      ? "Audit ready. Every measure is on target and every requirement has current evidence."
                      : `${gapReport.gaps.length} ${gapReport.gaps.length === 1 ? "gap" : "gaps"} to close before an audit${
                          gapReport.criticalTotal ? `, ${gapReport.criticalTotal} of them critical` : ""
                        }. Start with ${gapReport.gaps[0].title.toLowerCase()}.`}
                  </p>
                </div>
              </div>
              {gapReport?.gaps.length ? (
                <Link href={gapReport.gaps[0].action.href} className={`${ctaClass} shrink-0`}>
                  {gapReport.gaps[0].action.label}
                  <ArrowRight size={15} />
                </Link>
              ) : (
                <button type="button" onClick={() => navigate("/md/staff")} className={`${ctaClass} shrink-0`}>
                  Review quality team
                  <ArrowRight size={15} />
                </button>
              )}
            </Surface>
          </>
        )}
      </div>
    </Layout>
  );
}
