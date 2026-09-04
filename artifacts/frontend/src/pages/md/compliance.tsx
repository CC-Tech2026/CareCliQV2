import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  ShieldAlert,
  FileCheck2,
  Users,
  ChevronRight,
  CircleAlert,
  Activity,
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
import { SectionInfo } from "@/components/ui/section-info";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";
const RED = "#B3261E";

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

function getScoreColor(score: number) {
  if (score >= 85) return GREEN;
  if (score >= 70) return AMBER;
  return RED;
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

function StatusPill({
  status,
}: {
  status: AuditStatus;
}) {
  const config = {
    ready: {
      label: "Ready",
      color: GREEN,
      background: "#E9F5F0",
      border: "#BFDDD1",
      Icon: CheckCircle2,
    },
    attention: {
      label: "Attention required",
      color: RED,
      background: "#FBEAE9",
      border: "#E4B9B6",
      Icon: CircleAlert,
    },
    pending: {
      label: "Pending",
      color: AMBER,
      background: "#FBF2E6",
      border: "#E3CBA0",
      Icon: Clock3,
    },
  }[status];

  const Icon = config.Icon;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black"
      style={{
        color: config.color,
        background: config.background,
        borderColor: config.border,
      }}
    >
      <Icon size={11} strokeWidth={2.5} />
      {config.label}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <p
            className="mb-1 text-[9px] font-black uppercase tracking-[0.18em]"
            style={{ color: MUTED }}
          >
            {eyebrow}
          </p>
        )}

        <h2
          className="text-[15px] font-black tracking-[-0.01em]"
          style={{ color: TEXT }}
        >
          {title}
        </h2>

        {description && (
          <p
            className="mt-1 max-w-2xl text-[11px] font-medium leading-relaxed"
            style={{ color: MUTED }}
          >
            {description}
          </p>
        )}
      </div>

      {action}
    </div>
  );
}

function ReadinessItem({
  icon: Icon,
  label,
  description,
  status,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  description: string;
  status: AuditStatus;
}) {
  const config = {
    ready: {
      color: GREEN,
      background: "#E9F5F0",
      border: "#BFDDD1",
      label: "Complete",
    },
    attention: {
      color: RED,
      background: "#FBEAE9",
      border: "#E4B9B6",
      label: "Review",
    },
    pending: {
      color: AMBER,
      background: "#FBF2E6",
      border: "#E3CBA0",
      label: "Pending",
    },
  }[status];

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3.5 py-3"
      style={{
        borderColor: BORDER,
        background: "#fff",
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: config.background,
          color: config.color,
        }}
      >
        <Icon size={16} strokeWidth={2.4} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="text-[12px] font-black"
          style={{ color: TEXT }}
        >
          {label}
        </p>

        <p
          className="mt-0.5 text-[10px] font-medium leading-relaxed"
          style={{ color: MUTED }}
        >
          {description}
        </p>
      </div>

      <span
        className="shrink-0 rounded-full px-2 py-1 text-[9px] font-black"
        style={{
          background: config.background,
          color: config.color,
        }}
      >
        {config.label}
      </span>
    </div>
  );
}

export default function MDCompliancePage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),

      apiFetch("/api/dashboard/compliance-trend").then((r) =>
        r.ok ? r.json() : { trend: [] },
      ),
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
  }, []);

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
      breakdown.compliant +
      breakdown.at_risk +
      breakdown.non_compliant;

    const compliantPercent =
      total > 0
        ? Math.round((breakdown.compliant / total) * 100)
        : 0;

    const atRiskPercent =
      total > 0
        ? Math.round((breakdown.at_risk / total) * 100)
        : 0;

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
      highAlerts,
      readiness,
      strongestWorkers,
      attentionWorkers,
      topIssues,
    };
  }, [data]);

  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        {/* -----------------------------------------------------------
            HEADER
        ------------------------------------------------------------ */}
        <header className="flex items-center gap-4">
          <div>
            <h1
              className="flex items-center gap-2 text-xl font-black tracking-[-0.025em]"
              style={{ color: TEXT }}
            >
              Audit & Compliance
              <SectionInfo text="Quality posture, risk signals, and audit readiness across the organisation." />
            </h1>
          </div>
        </header>

        {loading ? (
          <div className="space-y-4">
            <div
              className="h-[270px] animate-pulse rounded-3xl"
              style={{ background: SOFT }}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <div
                className="h-[280px] animate-pulse rounded-2xl"
                style={{ background: SOFT }}
              />
              <div
                className="h-[280px] animate-pulse rounded-2xl"
                style={{ background: SOFT }}
              />
            </div>
          </div>
        ) : error || !data || !derived ? (
          <div
            className="rounded-2xl border bg-white p-10 text-center"
            style={{ borderColor: BORDER }}
          >
            <AlertTriangle
              size={28}
              className="mx-auto mb-3"
              style={{ color: "#9A5B0A" }}
            />

            <p
              className="font-black"
              style={{ color: TEXT }}
            >
              {translate("md.compliance.loadFailed")}
            </p>

            <p
              className="mt-1 text-[11px]"
              style={{ color: MUTED }}
            >
              We could not load the organisation quality data.
            </p>
          </div>
        ) : (
          <>
            {/* -------------------------------------------------------
                COMMAND CENTRE HERO
            -------------------------------------------------------- */}
            <section
              className="overflow-hidden rounded-3xl border bg-white shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
                {/* Left */}
                <div className="relative p-6 sm:p-8">
                  <div
                    className="absolute right-0 top-0 h-40 w-40 rounded-full opacity-40 blur-3xl"
                    style={{
                      background:
                        derived.readiness === "ready"
                          ? "#BFDDD1"
                          : "#E4B9B6",
                    }}
                  />

                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{
                          background: SOFT,
                          color: PLUM,
                        }}
                      >
                        <ShieldCheck
                          size={18}
                          strokeWidth={2.3}
                        />
                      </div>

                      <div>
                        <p
                          className="text-[9px] font-black uppercase tracking-[0.16em]"
                          style={{ color: MUTED }}
                        >
                          Current quality posture
                        </p>

                        <p
                          className="text-[12px] font-black"
                          style={{ color: TEXT }}
                        >
                          Organisation compliance
                        </p>
                      </div>
                    </div>

                    <div className="mt-8 flex flex-wrap items-end gap-5">
                      <div>
                        <div
                          className="text-[68px] font-black leading-[0.85] tracking-[-0.06em]"
                          style={{
                            color: getScoreColor(
                              data.compliance_score,
                            ),
                          }}
                        >
                          {data.compliance_score}
                          <span className="text-[32px]">%</span>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <StatusPill
                            status={derived.readiness}
                          />

                          <span
                            className="text-[10px] font-bold"
                            style={{ color: MUTED }}
                          >
                            Target {data.compliance_target}%
                          </span>
                        </div>
                      </div>

                      <div className="pb-1">
                        <p
                          className="text-[13px] font-black"
                          style={{ color: TEXT }}
                        >
                          {getScoreLabel(data.compliance_score)}
                        </p>

                        <p
                          className="mt-1 max-w-xs text-[11px] font-medium leading-relaxed"
                          style={{ color: MUTED }}
                        >
                          {data.compliance_score >=
                          data.compliance_target
                            ? "The organisation is currently operating at or above its compliance target."
                            : "The organisation is below target. Focus should remain on the highest-impact quality gaps."}
                        </p>
                      </div>
                    </div>

                    {/* Target progress */}
                    <div className="mt-8 max-w-xl">
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className="text-[9px] font-black uppercase tracking-[0.12em]"
                          style={{ color: MUTED }}
                        >
                          Progress toward target
                        </span>

                        <span
                          className="text-[10px] font-black"
                          style={{ color: TEXT }}
                        >
                          {Math.max(
                            0,
                            data.compliance_target -
                              data.compliance_score,
                          )}
                          pts to target
                        </span>
                      </div>

                      <div
                        className="h-2 overflow-hidden rounded-full"
                        style={{ background: SOFT }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              data.compliance_score,
                              100,
                            )}%`,
                            background: getScoreColor(
                              data.compliance_score,
                            ),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right */}
                <div
                  className="border-t p-6 lg:border-l lg:border-t-0 sm:p-8"
                  style={{
                    borderColor: BORDER,
                    background: "#FCFCFD",
                  }}
                >
                  <p
                    className="text-[9px] font-black uppercase tracking-[0.16em]"
                    style={{ color: MUTED }}
                  >
                    Where attention is going
                  </p>

                  <div className="mt-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ background: GREEN }}
                      />

                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: TEXT }}
                          >
                            Compliant
                          </span>

                          <span
                            className="text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            {derived.compliantPercent}%
                          </span>
                        </div>

                        <div
                          className="mt-1.5 h-1.5 rounded-full"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${derived.compliantPercent}%`,
                              background: GREEN,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ background: AMBER }}
                      />

                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: TEXT }}
                          >
                            At risk
                          </span>

                          <span
                            className="text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            {derived.atRiskPercent}%
                          </span>
                        </div>

                        <div
                          className="mt-1.5 h-1.5 rounded-full"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${derived.atRiskPercent}%`,
                              background: AMBER,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ background: RED }}
                      />

                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: TEXT }}
                          >
                            Non-compliant
                          </span>

                          <span
                            className="text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            {data.team_compliance_breakdown.non_compliant}
                          </span>
                        </div>

                        <div
                          className="mt-1.5 h-1.5 rounded-full"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width:
                                derived.total > 0
                                  ? `${Math.min(
                                      100,
                                      (data.team_compliance_breakdown
                                        .non_compliant /
                                        derived.total) *
                                        100,
                                    )}%`
                                  : "0%",
                              background: RED,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="mt-7 rounded-xl border p-3.5"
                    style={{
                      borderColor: BORDER,
                      background: "#fff",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <Activity
                        size={15}
                        className="mt-0.5 shrink-0"
                        style={{ color: PLUM }}
                      />

                      <div>
                        <p
                          className="text-[10px] font-black uppercase tracking-[0.1em]"
                          style={{ color: MUTED }}
                        >
                          Quality signal
                        </p>

                        <p
                          className="mt-1 text-[11px] font-semibold leading-relaxed"
                          style={{ color: TEXT }}
                        >
                          {derived.highAlerts > 0
                            ? `${derived.highAlerts} high-priority alert${derived.highAlerts > 1 ? "s" : ""} require executive attention.`
                            : "No high-priority compliance alerts are currently active."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* -------------------------------------------------------
                ATTENTION + AUDIT READINESS
            -------------------------------------------------------- */}
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              {/* Attention */}
              <section
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Executive attention"
                  title="What needs attention"
                  description="The highest-impact signals currently affecting organisational quality."
                  action={
                    <button
                      onClick={() => navigate("/md/staff")}
                      className="hidden items-center gap-1 text-[10px] font-black sm:flex"
                      style={{ color: PLUM }}
                    >
                      Review staff
                      <ArrowRight size={11} />
                    </button>
                  }
                />

                {derived.topIssues.length === 0 &&
                derived.attentionWorkers.length === 0 &&
                derived.highAlerts === 0 ? (
                  <div
                    className="flex items-center gap-3 rounded-xl border p-4"
                    style={{
                      borderColor: "#BFDDD1",
                      background: "#E9F5F0",
                    }}
                  >
                    <CheckCircle2
                      size={18}
                      style={{ color: GREEN }}
                    />

                    <div>
                      <p
                        className="text-[12px] font-black"
                        style={{ color: "#0B5F44" }}
                      >
                        No immediate quality risks
                      </p>

                      <p
                        className="mt-0.5 text-[10px] font-medium"
                        style={{ color: "#0F7B57" }}
                      >
                        Current compliance signals are within expected
                        operating range.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {derived.highAlerts > 0 && (
                      <div
                        className="flex items-center gap-3 rounded-xl border px-3.5 py-3"
                        style={{
                          borderColor: "#E4B9B6",
                          background: "#FBEAE9",
                        }}
                      >
                        <ShieldAlert
                          size={16}
                          style={{ color: RED }}
                        />

                        <div className="flex-1">
                          <p
                            className="text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            High-priority compliance alerts
                          </p>

                          <p
                            className="mt-0.5 text-[10px] font-medium"
                            style={{ color: MUTED }}
                          >
                            {derived.highAlerts} alert
                            {derived.highAlerts > 1 ? "s" : ""} currently
                            require review.
                          </p>
                        </div>

                        <ChevronRight
                          size={14}
                          style={{ color: MUTED }}
                        />
                      </div>
                    )}

                    {derived.topIssues.slice(0, 3).map(
                      (issue, index) => (
                        <div
                          key={`${issue.issue}-${index}`}
                          className="flex items-center gap-3 rounded-xl border px-3.5 py-3"
                          style={{ borderColor: BORDER }}
                        >
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{
                              background:
                                index === 0
                                  ? "#FBEAE9"
                                  : SOFT,
                              color:
                                index === 0
                                  ? RED
                                  : PLUM,
                            }}
                          >
                            <AlertTriangle
                              size={14}
                              strokeWidth={2.4}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-[11px] font-black"
                              style={{ color: TEXT }}
                            >
                              {issue.issue}
                            </p>

                            <p
                              className="mt-0.5 text-[9px] font-medium"
                              style={{ color: MUTED }}
                            >
                              Appeared {issue.count} times
                            </p>
                          </div>

                          <span
                            className="rounded-full px-2 py-1 text-[9px] font-black"
                            style={{
                              background:
                                index === 0
                                  ? "#FBEAE9"
                                  : SOFT,
                              color:
                                index === 0
                                  ? RED
                                  : MUTED,
                            }}
                          >
                            Priority {index + 1}
                          </span>
                        </div>
                      ),
                    )}

                    {derived.attentionWorkers.length > 0 && (
                      <div
                        className="rounded-xl border px-3.5 py-3"
                        style={{
                          borderColor: BORDER,
                          background: "#FCFCFD",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Users
                            size={14}
                            style={{ color: AMBER }}
                          />

                          <p
                            className="text-[10px] font-black"
                            style={{ color: TEXT }}
                          >
                            {derived.attentionWorkers.length} workers
                            below the 85% quality threshold
                          </p>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {derived.attentionWorkers.map(
                            (worker) => (
                              <span
                                key={worker.id}
                                className="rounded-full px-2 py-1 text-[9px] font-bold"
                                style={{
                                  background: SOFT,
                                  color: MUTED,
                                }}
                              >
                                {worker.full_name} ·{" "}
                                {worker.compliance_score}%
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Audit readiness */}
              <section
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Governance"
                  title="Audit readiness"
                  description="Executive view of whether the organisation is ready to evidence compliance."
                  action={
                    <StatusPill
                      status={derived.readiness}
                    />
                  }
                />

                <div className="space-y-2">
                  <ReadinessItem
                    icon={FileCheck2}
                    label="Session evidence"
                    description="Session documentation and compliance outcomes."
                    status={
                      data.team_compliance_breakdown.non_compliant === 0
                        ? "ready"
                        : "attention"
                    }
                  />

                  <ReadinessItem
                    icon={ShieldCheck}
                    label="Compliance target"
                    description={`Organisation score against the ${data.compliance_target}% target.`}
                    status={
                      data.compliance_score >=
                      data.compliance_target
                        ? "ready"
                        : "attention"
                    }
                  />

                  <ReadinessItem
                    icon={AlertTriangle}
                    label="High-priority alerts"
                    description="Open alerts requiring executive review."
                    status={
                      derived.highAlerts === 0
                        ? "ready"
                        : "attention"
                    }
                  />

                  <ReadinessItem
                    icon={Users}
                    label="Worker credentials"
                    description="Credential and certification currency."
                    status="pending"
                  />

                  <ReadinessItem
                    icon={FileCheck2}
                    label="Training evidence"
                    description="Current staff training records."
                    status="pending"
                  />
                </div>
              </section>
            </div>

            {/* -------------------------------------------------------
                COMPLIANCE TREND
            -------------------------------------------------------- */}
            {chartData.length > 1 && (
              <section
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Quality trajectory"
                  title="Compliance trajectory"
                  description="Use the trend to understand direction, not as another headline KPI."
                />

                <div className="h-[230px]">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 5,
                        right: 15,
                        bottom: 0,
                        left: -20,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={BORDER}
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
                        domain={[50, 100]}
                        tick={{
                          fontSize: 9,
                          fill: MUTED,
                        }}
                        axisLine={false}
                        tickLine={false}
                      />

                      <ReferenceLine
                        y={data.compliance_target}
                        stroke={AMBER}
                        strokeDasharray="4 3"
                      />

                      <Tooltip
                        contentStyle={{
                          borderRadius: 10,
                          border: `1px solid ${BORDER}`,
                          fontSize: 11,
                        }}
                        formatter={(value: number) => [
                          `${value}%`,
                          "Weekly score",
                        ]}
                      />

                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke={PLUM}
                        strokeWidth={3}
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
            )}

            {/* -------------------------------------------------------
                QUALITY ISSUES + PEOPLE
            -------------------------------------------------------- */}
            <div className="grid gap-5 lg:grid-cols-2">
              {/* Issues */}
              <section
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="Root causes"
                  title="Recurring quality issues"
                  description="Where repeated compliance failures are occurring."
                />

                {derived.topIssues.length === 0 ? (
                  <div
                    className="rounded-xl p-5 text-center"
                    style={{ background: SOFT }}
                  >
                    <CheckCircle2
                      size={22}
                      className="mx-auto mb-2"
                      style={{ color: GREEN }}
                    />

                    <p
                      className="text-[11px] font-black"
                      style={{ color: TEXT }}
                    >
                      No recurring issues detected
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {derived.topIssues.map((issue, index) => {
                      const max =
                        derived.topIssues[0]?.count || 1;

                      const width =
                        (issue.count / max) * 100;

                      return (
                        <div
                          key={`${issue.issue}-${index}`}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <span
                              className="truncate text-[11px] font-bold"
                              style={{ color: TEXT }}
                            >
                              {issue.issue}
                            </span>

                            <span
                              className="shrink-0 text-[10px] font-black"
                              style={{ color: MUTED }}
                            >
                              {issue.count} occurrences
                            </span>
                          </div>

                          <div
                            className="h-2 overflow-hidden rounded-full"
                            style={{ background: SOFT }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${width}%`,
                                background:
                                  index === 0
                                    ? RED
                                    : index === 1
                                      ? AMBER
                                      : PLUM,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* People */}
              <section
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={{ borderColor: BORDER }}
              >
                <SectionHeader
                  eyebrow="People quality"
                  title="Worker quality signals"
                  description="A concise view of strongest performers and workers requiring support."
                  action={
                    <button
                      onClick={() => navigate("/md/staff")}
                      className="flex items-center gap-1 text-[10px] font-black"
                      style={{ color: PLUM }}
                    >
                      View staff
                      <ArrowRight size={11} />
                    </button>
                  }
                />

                <div className="space-y-2">
                  {derived.attentionWorkers
                    .slice(0, 3)
                    .map((worker) => (
                      <div
                        key={`risk-${worker.id}`}
                        className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                        style={{ borderColor: BORDER }}
                      >
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-[9px] font-black"
                          style={{
                            background: "#FBEAE9",
                            color: RED,
                          }}
                        >
                          {worker.full_name
                            .split(" ")
                            .map((name) => name[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            {worker.full_name}
                          </p>

                          <p
                            className="text-[9px] font-medium"
                            style={{ color: MUTED }}
                          >
                            {worker.sessions} sessions
                          </p>
                        </div>

                        <span
                          className="text-[11px] font-black"
                          style={{ color: RED }}
                        >
                          {worker.compliance_score}%
                        </span>
                      </div>
                    ))}

                  {derived.strongestWorkers
                    .slice(0, 2)
                    .map((worker) => (
                      <div
                        key={`strong-${worker.id}`}
                        className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                        style={{ borderColor: BORDER }}
                      >
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-[9px] font-black"
                          style={{
                            background: "#E9F5F0",
                            color: GREEN,
                          }}
                        >
                          {worker.full_name
                            .split(" ")
                            .map((name) => name[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-[11px] font-black"
                            style={{ color: TEXT }}
                          >
                            {worker.full_name}
                          </p>

                          <p
                            className="text-[9px] font-medium"
                            style={{ color: MUTED }}
                          >
                            {worker.sessions} sessions
                          </p>
                        </div>

                        <span
                          className="text-[11px] font-black"
                          style={{ color: GREEN }}
                        >
                          {worker.compliance_score}%
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            </div>

            {/* -------------------------------------------------------
                EXECUTIVE FOOTER
            -------------------------------------------------------- */}
            <section
              className="flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between"
              style={{
                borderColor: BORDER,
                background: SOFT,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: "#fff",
                    color: PLUM,
                  }}
                >
                  <ShieldCheck
                    size={16}
                    strokeWidth={2.4}
                  />
                </div>

                <div>
                  <p
                    className="text-[11px] font-black"
                    style={{ color: TEXT }}
                  >
                    Executive quality decision
                  </p>

                  <p
                    className="mt-0.5 max-w-2xl text-[10px] font-medium leading-relaxed"
                    style={{ color: MUTED }}
                  >
                    {derived.readiness === "ready"
                      ? "The organisation is currently positioned for audit readiness. Continue monitoring recurring issues and evidence quality."
                      : "The organisation has quality signals requiring attention before it can be considered fully audit-ready."}
                  </p>
                </div>
              </div>

              <button
                onClick={() => navigate("/md/staff")}
                className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[10px] font-black text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--cc-cta)" }}
              >
                Review quality team
                <ArrowRight size={12} />
              </button>
            </section>
          </>
        )}
      </div>
    </HubLayout>
  );
}