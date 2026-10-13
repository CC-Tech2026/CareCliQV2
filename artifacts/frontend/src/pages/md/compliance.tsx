import { useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  FileCheck2,
  Users,
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
  LoadError,
  PageHeader,
  RowList,
  Section,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ctaClass,
  ghostClass,
  rowClass,
  toneColor,
  type Tone,
} from "@/components/layout/PageKit";
import { useAccessibility } from "@/contexts/AccessibilityContext";

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
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

type AuditStatus = "ready" | "attention" | "pending";

function scoreTone(score: number): Tone {
  if (score >= 85) return "good";
  if (score >= 70) return "warning";
  return "danger";
}

function getScoreLabel(score: number) {
  if (score >= 90) return "Strong";
  if (score >= 85) return "On track";
  if (score >= 70) return "Needs attention";
  return "Critical";
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
  ready: { tone: "good", overall: "Ready", item: "Complete" },
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

function ReadinessRow({
  icon,
  label,
  description,
  status,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  description: string;
  status: AuditStatus;
}) {
  const config = AUDIT_STATUS[status];
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <IconTile icon={icon} tone={config.tone} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: TEXT }}>{label}</span>
        <span className="block text-xs" style={{ color: MUTED }}>{description}</span>
      </span>
      <StatusText tone={config.tone}>{config.item}</StatusText>
    </li>
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

    const readiness = getAuditStatus(
      data.compliance_score,
      data.compliance_target,
      highAlerts,
      breakdown.non_compliant,
    );

    const strongestWorkers = [...data.worker_rankings]
      .sort((a, b) => b.compliance_score - a.compliance_score)
      .slice(0, 5);

    const attentionWorkers = [...data.worker_rankings]
      .filter((worker) => worker.compliance_score < 85)
      .sort((a, b) => a.compliance_score - b.compliance_score)
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

  return (
    <Layout>
      <div className="space-y-8 pb-12">
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
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SummaryStrip
                items={[
                  { value: `${data.compliance_score}%`, label: `organisation score, target ${data.compliance_target}%`, tone: scoreTone(data.compliance_score) },
                  { value: `${derived.compliantPercent}%`, label: "compliant", tone: "good" },
                  { value: `${derived.atRiskPercent}%`, label: "at risk", tone: derived.atRiskPercent ? "warning" : undefined },
                  {
                    value: data.team_compliance_breakdown.non_compliant,
                    label: "non-compliant",
                    tone: data.team_compliance_breakdown.non_compliant ? "danger" : "good",
                    onClick: () => navigate("/md/staff"),
                  },
                  { value: derived.highAlerts, label: derived.highAlerts === 1 ? "high-priority alert" : "high-priority alerts", tone: derived.highAlerts ? "danger" : "good" },
                ]}
              />
              <button type="button" onClick={() => setRetryKey((key) => key + 1)} className={ghostClass}>
                Refresh
              </button>
            </div>

            {/* Posture: where the score sits against target, and how the team splits */}
            <Surface className="p-5 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-semibold" style={{ color: TEXT }}>
                      {getScoreLabel(data.compliance_score)}
                    </p>
                    <StatusText tone={AUDIT_STATUS[derived.readiness].tone}>
                      {AUDIT_STATUS[derived.readiness].overall}
                    </StatusText>
                  </div>
                  <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                    {data.compliance_score >= data.compliance_target
                      ? "The organisation is at or above its compliance target."
                      : "The organisation is below target. Focus on the highest-impact quality gaps first."}
                  </p>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs" style={{ color: MUTED }}>
                      <span>Progress toward {data.compliance_target}% target</span>
                      <span className="font-semibold tabular-nums" style={{ color: TEXT }}>
                        {Math.max(0, data.compliance_target - data.compliance_score)} pts to go
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
                  <p className="text-base font-semibold" style={{ color: TEXT }}>How the team splits</p>
                  <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                    {derived.total} {derived.total === 1 ? "record" : "records"} scored across the organisation.
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

            <div className="grid gap-8 lg:grid-cols-2">
              <Section
                title="What needs attention"
                description="The signals with the most impact on quality right now."
                action={
                  <button type="button" onClick={() => navigate("/md/staff")} className={ghostClass}>
                    Review staff <ArrowRight size={14} />
                  </button>
                }
              >
                <Surface>
                  {derived.topIssues.length === 0 &&
                  derived.attentionWorkers.length === 0 &&
                  derived.highAlerts === 0 ? (
                    <div className="flex items-center gap-3 px-5 py-6">
                      <CheckCircle2 size={18} style={{ color: GREEN }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: TEXT }}>No immediate quality risks</p>
                        <p className="text-xs" style={{ color: MUTED }}>Compliance signals are within the expected range.</p>
                      </div>
                    </div>
                  ) : (
                    <RowList>
                      {derived.highAlerts > 0 && (
                        <li>
                          <button type="button" onClick={() => navigate("/md/staff")} className={rowClass}>
                            <IconTile icon={ShieldAlert} tone="danger" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold" style={{ color: TEXT }}>High-priority compliance alerts</span>
                              <span className="block text-xs" style={{ color: MUTED }}>
                                {derived.highAlerts} {derived.highAlerts === 1 ? "alert needs" : "alerts need"} review.
                              </span>
                            </span>
                            <ChevronRight size={16} style={{ color: MUTED }} />
                          </button>
                        </li>
                      )}
                      {derived.topIssues.slice(0, 3).map((issue, index) => (
                        <li key={`${issue.issue}-${index}`} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                          <IconTile icon={AlertTriangle} tone={index === 0 ? "danger" : "warning"} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>{issue.issue}</span>
                            <span className="block text-xs" style={{ color: MUTED }}>Appeared {issue.count} times</span>
                          </span>
                          <StatusText tone={index === 0 ? "danger" : "neutral"}>Priority {index + 1}</StatusText>
                        </li>
                      ))}
                      {derived.attentionWorkers.length > 0 && (
                        <li className="px-4 py-3.5 sm:px-5">
                          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
                            <Users size={15} style={{ color: AMBER }} />
                            {derived.attentionWorkers.length} {derived.attentionWorkers.length === 1 ? "worker" : "workers"} below the 85% quality threshold
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {derived.attentionWorkers.map((worker) => (
                              <span key={worker.id} className="rounded-full px-2.5 py-1 text-xs" style={{ background: SOFT, color: TEXT }}>
                                {worker.full_name} · <span className="font-semibold tabular-nums">{worker.compliance_score}%</span>
                              </span>
                            ))}
                          </div>
                        </li>
                      )}
                    </RowList>
                  )}
                </Surface>
              </Section>

              <Section
                title="Audit readiness"
                description="Whether the organisation can evidence compliance today."
                action={<StatusText tone={AUDIT_STATUS[derived.readiness].tone}>{AUDIT_STATUS[derived.readiness].overall}</StatusText>}
              >
                <Surface>
                  <RowList>
                    <ReadinessRow
                      icon={FileCheck2}
                      label="Session evidence"
                      description="Session documentation and compliance outcomes."
                      status={data.team_compliance_breakdown.non_compliant === 0 ? "ready" : "attention"}
                    />
                    <ReadinessRow
                      icon={ShieldCheck}
                      label="Compliance target"
                      description={`Organisation score against the ${data.compliance_target}% target.`}
                      status={data.compliance_score >= data.compliance_target ? "ready" : "attention"}
                    />
                    <ReadinessRow
                      icon={AlertTriangle}
                      label="High-priority alerts"
                      description="Open alerts that need executive review."
                      status={derived.highAlerts === 0 ? "ready" : "attention"}
                    />
                    <ReadinessRow
                      icon={Users}
                      label="Worker credentials"
                      description="Credential and certification currency."
                      status="pending"
                    />
                    <ReadinessRow
                      icon={FileCheck2}
                      label="Training evidence"
                      description="Current staff training records."
                      status="pending"
                    />
                  </RowList>
                </Surface>
              </Section>
            </div>

            {trendError && (
              <p role="status" className="rounded-2xl bg-cc-surface px-5 py-4 text-sm" style={{ color: MUTED }}>
                The compliance trend could not be loaded. Refresh to try again; the other records are still available.
              </p>
            )}
            {chartData.length > 1 && (
              <Section title="Compliance trajectory" description="Weekly average score for the last quarter. The dashed line is your target.">
                <Surface className="p-5">
                  <div className="h-[230px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 15, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                        <XAxis dataKey="week" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                        <YAxis domain={[50, 100]} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
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

            <div className="grid gap-8 lg:grid-cols-2">
              <Section title="Recurring quality issues" description="Where the same compliance failures keep happening.">
                <Surface className="p-5">
                  {derived.topIssues.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                      <CheckCircle2 size={16} style={{ color: GREEN }} />
                      No recurring issues detected.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {derived.topIssues.map((issue, index) => {
                        const max = derived.topIssues[0]?.count || 1;
                        return (
                          <div key={`${issue.issue}-${index}`}>
                            <div className="mb-1.5 flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-semibold" style={{ color: TEXT }}>{issue.issue}</span>
                              <span className="shrink-0 text-xs tabular-nums" style={{ color: MUTED }}>{issue.count} times</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full" style={{ background: SOFT }}>
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(issue.count / max) * 100}%`, background: index === 0 ? RED : index === 1 ? AMBER : MUTED }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Surface>
              </Section>

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

            <Surface className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <IconTile icon={ShieldCheck} tone={AUDIT_STATUS[derived.readiness].tone} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: TEXT }}>Executive quality decision</p>
                  <p className="mt-0.5 max-w-2xl text-sm leading-6" style={{ color: MUTED }}>
                    {derived.readiness === "ready"
                      ? "The organisation is positioned for audit. Keep watching recurring issues and evidence quality."
                      : "Some quality signals need attention before the organisation is fully audit ready."}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => navigate("/md/staff")} className={`${ctaClass} shrink-0`}>
                Review quality team
                <ArrowRight size={15} />
              </button>
            </Surface>
          </>
        )}
      </div>
    </Layout>
  );
}
