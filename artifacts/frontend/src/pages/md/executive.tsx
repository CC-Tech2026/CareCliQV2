import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Activity,
  Target,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "wouter";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { apiFetch } from "@/lib/api-fetch";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
import { SectionInfo } from "@/components/ui/section-info";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";
const RED = "#B3261E";
const BLUE = "#2A5C8A";

const GREEN_SOFT = "#E9F5F0";
const AMBER_SOFT = "#FBF2E6";
const RED_SOFT = "#FBEAE9";
const BLUE_SOFT = "#EAF1F7";

interface MDData {
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

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(value?: string) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getHealthState(score: number, target: number) {
  if (score >= target) {
    return {
      label: "Healthy",
      color: GREEN,
      soft: GREEN_SOFT,
      icon: CheckCircle2,
    };
  }

  if (score >= target * 0.9) {
    return {
      label: "Watch",
      color: AMBER,
      soft: AMBER_SOFT,
      icon: CircleAlert,
    };
  }

  return {
    label: "Requires intervention",
    color: RED,
    soft: RED_SOFT,
    icon: AlertTriangle,
  };
}

function SectionEyebrow({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <span
        className="text-[9px] font-black uppercase tracking-[0.18em]"
        style={{ color: MUTED }}
      >
        {children}
      </span>

      {right}
    </div>
  );
}

function Signal({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string | number;
  detail: string;
  color: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />

        <span
          className="truncate text-[9px] font-black uppercase tracking-[0.12em]"
          style={{ color: MUTED }}
        >
          {label}
        </span>
      </div>

      <p
        className="mt-2 text-2xl font-black tracking-tight"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      <p
        className="mt-1 text-[9px] font-medium"
        style={{ color: MUTED }}
      >
        {detail}
      </p>
    </div>
  );
}

function GovernanceMetric({
  icon: Icon,
  label,
  value,
  detail,
  status,
  statusColor,
}: {
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
  label: string;
  value: string;
  detail: string;
  status: string;
  statusColor: string;
}) {
  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-between">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{
            background: SOFT,
            color: PLUM,
          }}
        >
          <Icon size={14} strokeWidth={2.4} />
        </div>

        <span
          className="text-[9px] font-black uppercase tracking-wide"
          style={{ color: statusColor }}
        >
          {status}
        </span>
      </div>

      <p
        className="text-[9px] font-black uppercase tracking-[0.13em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-1.5 text-2xl font-black tracking-tight"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      <p
        className="mt-1 text-[9px] leading-4"
        style={{ color: MUTED }}
      >
        {detail}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div
          className="h-2.5 w-28 animate-pulse rounded"
          style={{ background: SOFT }}
        />

        <div
          className="h-9 w-72 animate-pulse rounded-lg"
          style={{ background: SOFT }}
        />

        <div
          className="h-3 w-96 max-w-full animate-pulse rounded"
          style={{ background: SOFT }}
        />
      </div>

      <div
        className="h-[390px] animate-pulse rounded-3xl"
        style={{ background: SOFT }}
      />

      <div
        className="h-[340px] animate-pulse rounded-3xl"
        style={{ background: SOFT }}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-48 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
        ))}
      </div>
    </div>
  );
}

export default function MDExecutivePage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((response) =>
        response.ok ? response.json() : Promise.reject()
      ),
      apiFetch("/api/dashboard/compliance-trend").then((response) =>
        response.ok ? response.json() : { trend: [] }
      ),
    ])
      .then(([md, trendResponse]) => {
        if (cancelled) return;

        setData(md);
        setTrend(trendResponse?.trend ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = useMemo(() => {
    return trend
      .filter((item) => item.avg_score !== null)
      .slice(-13)
      .map((item) => ({
        week: item.week.replace(/^\d{4}-/, ""),
        score: item.avg_score,
        sessions: item.session_count,
      }));
  }, [trend]);

  const trendChange = useMemo(() => {
    if (chartData.length < 2) return null;

    const current = Number(chartData[chartData.length - 1].score ?? 0);
    const previous = Number(chartData[chartData.length - 2].score ?? 0);

    return Math.round((current - previous) * 10) / 10;
  }, [chartData]);

  const compliantPercentage = useMemo(() => {
    if (!data) return 0;

    const {
      compliant,
      at_risk,
      non_compliant,
    } = data.team_compliance_breakdown;

    const total = compliant + at_risk + non_compliant;

    if (!total) return 0;

    return Math.round((compliant / total) * 100);
  }, [data]);

  if (loading) {
    return (
      <HubLayout>
        <LoadingState />
      </HubLayout>
    );
  }

  if (error || !data) {
    return (
      <HubLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-sm text-center">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                background: RED_SOFT,
                color: RED,
              }}
            >
              <AlertTriangle size={20} strokeWidth={2.5} />
            </div>

            <h2
              className="mt-4 text-base font-black"
              style={{ color: TEXT }}
            >
              {translate("md.executive.loadFailed")}
            </h2>

            <p
              className="mt-1 text-[11px] leading-5"
              style={{ color: MUTED }}
            >
              We couldn't load the executive overview.
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl px-4 py-2 text-[10px] font-black text-white"
              style={{ background: PLUM }}
            >
              Try again
            </button>
          </div>
        </div>
      </HubLayout>
    );
  }

  const health = getHealthState(
    data.compliance_score,
    data.compliance_target
  );

  const HealthIcon = health.icon;

  return (
    <HubLayout>
      <main className="pb-14">
        {/* ============================================================
            HEADER
        ============================================================ */}
        <header className="mb-9">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <span
                className="text-[9px] font-bold"
                style={{ color: MUTED }}
              >
                {formatDate(data.generated_at)}
              </span>

              <h1
                className="mt-2 flex items-center gap-2 text-[28px] font-black tracking-[-0.035em] sm:text-[34px]"
                style={{ color: TEXT }}
              >
                Organisation at a glance
                <SectionInfo text="A governance view across compliance, workforce health, and service delivery for the whole organisation." />
              </h1>
            </div>

            <div className="hidden text-right sm:block">
              <p
                className="text-[9px] font-black uppercase tracking-[0.15em]"
                style={{ color: MUTED }}
              >
                Last updated
              </p>

              <p
                className="mt-1 text-[10px] font-bold"
                style={{ color: TEXT }}
              >
                {formatTime(data.generated_at)}
              </p>
            </div>
          </div>
        </header>

        {/* ============================================================
            NEEDS ACTION / EXPOSURE — the triage list
        ============================================================ */}
        <GovernanceTriage onNavigate={navigate} workersAtRisk={data.workers_at_risk} />

        {/* ============================================================
            HOW WE'RE TRACKING — demoted below the triage list
        ============================================================ */}
        <div className="mt-10 mb-5 flex items-center gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: MUTED }}
          >
            How we're tracking
          </span>
          <span className="h-px flex-1" style={{ background: BORDER }} />
        </div>

        <section
          className="overflow-hidden rounded-[28px] border bg-white"
          style={{ borderColor: BORDER }}
        >
          <div>
            {/* Organisation health */}
            <div className="relative min-h-[370px] overflow-hidden p-7 sm:p-9">
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-[340px] w-[340px] rounded-full opacity-50 blur-3xl"
                style={{ background: `${PLUM}16` }}
              />

              <div className="relative">
                <SectionEyebrow
                  right={
                    <div
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                      style={{
                        color: health.color,
                        background: health.soft,
                      }}
                    >
                      <HealthIcon size={11} strokeWidth={2.7} />

                      <span className="text-[9px] font-black">
                        {health.label}
                      </span>
                    </div>
                  }
                >
                  Organisation health
                </SectionEyebrow>

                <div className="mt-8 flex flex-wrap items-end gap-x-5 gap-y-3">
                  <span
                    className="text-[78px] font-black leading-[0.8] tracking-[-0.075em] sm:text-[94px]"
                    style={{ color: TEXT }}
                  >
                    {data.compliance_score}%
                  </span>

                  <div className="mb-1">
                    <div className="flex items-center gap-1.5">
                      {trendChange !== null && (
                        <>
                          {trendChange >= 0 ? (
                            <TrendingUp
                              size={14}
                              strokeWidth={2.8}
                              style={{ color: GREEN }}
                            />
                          ) : (
                            <TrendingDown
                              size={14}
                              strokeWidth={2.8}
                              style={{ color: RED }}
                            />
                          )}

                          <span
                            className="text-[11px] font-black"
                            style={{
                              color:
                                trendChange >= 0 ? GREEN : RED,
                            }}
                          >
                            {trendChange >= 0 ? "+" : ""}
                            {trendChange} pts
                          </span>
                        </>
                      )}
                    </div>

                    <p
                      className="mt-1 text-[9px] font-medium"
                      style={{ color: MUTED }}
                    >
                      versus previous period
                    </p>
                  </div>
                </div>

                <p
                  className="mt-6 max-w-md text-[11px] leading-5"
                  style={{ color: MUTED }}
                >
                  Organisation-wide compliance is currently{" "}
                  <strong style={{ color: TEXT }}>
                    {data.compliance_score >= data.compliance_target
                      ? "above"
                      : "below"}
                  </strong>{" "}
                  the {data.compliance_target}% governance target.
                </p>

                {/* Signal strip */}
                <div
                  className="mt-9 grid max-w-2xl grid-cols-3 border-y py-5"
                  style={{ borderColor: BORDER }}
                >
                  <Signal
                    label="Compliance"
                    value={`${data.compliance_score}%`}
                    detail={`Target ${data.compliance_target}%`}
                    color={health.color}
                  />

                  <Signal
                    label="Goals"
                    value={`${data.goal_achievement_rate}%`}
                    detail="Achievement rate"
                    color={
                      data.goal_achievement_rate >= 85
                        ? GREEN
                        : AMBER
                    }
                  />

                  <Signal
                    label="Retention"
                    value={`${data.staff_retention_rate}%`}
                    detail="Staff retention"
                    color={
                      data.staff_retention_rate >= 90
                        ? GREEN
                        : AMBER
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            TREND
        ============================================================ */}
        <section className="mt-8">
          <SectionEyebrow
            right={
              chartData.length > 0 ? (
                <span
                  className="text-[9px] font-bold"
                  style={{ color: MUTED }}
                >
                  Last 90 days
                </span>
              ) : null
            }
          >
            Compliance performance
          </SectionEyebrow>

          <div
            className="overflow-hidden rounded-[28px] border bg-white"
            style={{ borderColor: BORDER }}
          >
            <div className="flex flex-wrap items-end justify-between gap-5 px-6 pt-7 sm:px-8">
              <div>
                <h2
                  className="text-xl font-black tracking-tight"
                  style={{ color: TEXT }}
                >
                  Is performance moving in the right direction?
                </h2>

                <p
                  className="mt-1 max-w-xl text-[10px] leading-5"
                  style={{ color: MUTED }}
                >
                  Weekly compliance averages provide a high-level
                  indication of organisational performance over time.
                </p>
              </div>

              <div className="flex items-center gap-5">
                <div>
                  <p
                    className="text-[8px] font-black uppercase tracking-[0.14em]"
                    style={{ color: MUTED }}
                  >
                    Current
                  </p>

                  <p
                    className="mt-1 text-lg font-black"
                    style={{ color: TEXT }}
                  >
                    {data.compliance_score}%
                  </p>
                </div>

                <div
                  className="h-8 w-px"
                  style={{ background: BORDER }}
                />

                <div>
                  <p
                    className="text-[8px] font-black uppercase tracking-[0.14em]"
                    style={{ color: MUTED }}
                  >
                    Target
                  </p>

                  <p
                    className="mt-1 text-lg font-black"
                    style={{ color: AMBER }}
                  >
                    {data.compliance_target}%
                  </p>
                </div>
              </div>
            </div>

            {chartData.length > 1 ? (
              <div className="mt-5 h-[350px] w-full px-2 pb-4 sm:px-5">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{
                      top: 20,
                      right: 25,
                      bottom: 5,
                      left: -15,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="2 5"
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
                      strokeDasharray="6 5"
                      label={{
                        value: `TARGET ${data.compliance_target}%`,
                        position: "insideTopRight",
                        fontSize: 8,
                        fontWeight: 800,
                        fill: AMBER,
                      }}
                    />

                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        boxShadow:
                          "0 10px 30px rgba(0,0,0,0.08)",
                        fontSize: 10,
                      }}
                      labelStyle={{
                        color: TEXT,
                        fontWeight: 800,
                      }}
                      formatter={(value: number) => [
                        `${value}%`,
                        "Compliance",
                      ]}
                    />

                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke={PLUM}
                      strokeWidth={3}
                      dot={false}
                      activeDot={{
                        r: 5,
                        fill: PLUM,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div
                className="mx-6 my-6 flex h-[280px] items-center justify-center rounded-2xl sm:mx-8"
                style={{ background: SOFT }}
              >
                <div className="text-center">
                  <Activity
                    size={20}
                    className="mx-auto"
                    style={{ color: MUTED }}
                  />

                  <p
                    className="mt-3 text-[11px] font-black"
                    style={{ color: TEXT }}
                  >
                    Building your performance trend
                  </p>

                  <p
                    className="mt-1 text-[9px]"
                    style={{ color: MUTED }}
                  >
                    More completed sessions will provide historical
                    trend data.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ============================================================
            GOVERNANCE SIGNALS
        ============================================================ */}
        <section className="mt-8">
          <SectionEyebrow>
            Executive signals
          </SectionEyebrow>

          <div
            className="grid overflow-hidden rounded-[28px] border bg-white lg:grid-cols-3"
            style={{ borderColor: BORDER }}
          >
            {/* Workforce */}
            <div className="p-6 sm:p-7 lg:border-r" style={{ borderColor: BORDER }}>
              <GovernanceMetric
                icon={Users}
                label="Workforce"
                value={String(data.active_staff)}
                detail={`${data.support_workers} support workers · ${data.staff_retention_rate}% retention`}
                status={
                  data.workers_at_risk.length === 0
                    ? "Stable"
                    : `${data.workers_at_risk.length} at risk`
                }
                statusColor={
                  data.workers_at_risk.length === 0
                    ? GREEN
                    : AMBER
                }
              />

              <div className="mt-6">
                <div
                  className="h-1.5 overflow-hidden rounded-full"
                  style={{ background: SOFT }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(
                        data.staff_retention_rate,
                        100
                      )}%`,
                      background:
                        data.staff_retention_rate >= 90
                          ? GREEN
                          : AMBER,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Service delivery */}
            <div
              className="border-t p-6 sm:p-7 lg:border-r lg:border-t-0"
              style={{ borderColor: BORDER }}
            >
              <GovernanceMetric
                icon={Activity}
                label="Service delivery"
                value={String(data.sessions_this_week)}
                detail={`${data.active_participants} active participants receiving support`}
                status={`${data.goal_achievement_rate}% goals`}
                statusColor={
                  data.goal_achievement_rate >= 85
                    ? GREEN
                    : AMBER
                }
              />

              <div className="mt-6 flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: BLUE_SOFT,
                    color: BLUE,
                  }}
                >
                  <Target size={14} strokeWidth={2.4} />
                </div>

                <div>
                  <p
                    className="text-[9px] font-black uppercase tracking-wide"
                    style={{ color: MUTED }}
                  >
                    Goal achievement
                  </p>

                  <p
                    className="mt-0.5 text-[11px] font-black"
                    style={{ color: TEXT }}
                  >
                    {data.goal_achievement_rate}%
                  </p>
                </div>
              </div>
            </div>

            {/* Governance */}
            <div className="border-t p-6 sm:p-7 lg:border-t-0">
              <GovernanceMetric
                icon={ShieldCheck}
                label="Governance"
                value={`${compliantPercentage}%`}
                detail="Share of compliant records — full breakdown below"
                status={
                  data.compliance_score >= data.compliance_target
                    ? "On target"
                    : "Below target"
                }
                statusColor={
                  data.compliance_score >= data.compliance_target
                    ? GREEN
                    : RED
                }
              />

              <div className="mt-6 flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background:
                      data.incidents_this_month >= 3
                        ? RED_SOFT
                        : GREEN_SOFT,
                    color:
                      data.incidents_this_month >= 3
                        ? RED
                        : GREEN,
                  }}
                >
                  <AlertTriangle
                    size={14}
                    strokeWidth={2.4}
                  />
                </div>

                <div>
                  <p
                    className="text-[9px] font-black uppercase tracking-wide"
                    style={{ color: MUTED }}
                  >
                    Incidents
                  </p>

                  <p
                    className="mt-0.5 text-[11px] font-black"
                    style={{ color: TEXT }}
                  >
                    {data.incidents_this_month} this month
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            COMPLIANCE DISTRIBUTION
        ============================================================ */}
        <section className="mt-8">
          <SectionEyebrow>
            Compliance composition
          </SectionEyebrow>

          <div
            className="rounded-[28px] border bg-white p-6 sm:p-8"
            style={{ borderColor: BORDER }}
          >
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
              <div className="min-w-[210px]">
                <p
                  className="text-4xl font-black tracking-tight"
                  style={{ color: TEXT }}
                >
                  {data.team_compliance_breakdown.compliant +
                    data.team_compliance_breakdown.at_risk +
                    data.team_compliance_breakdown.non_compliant}
                </p>

                <p
                  className="mt-1 text-[10px] font-medium"
                  style={{ color: MUTED }}
                >
                  monitored compliance records
                </p>
              </div>

              <div className="flex-1">
                <div
                  className="flex h-4 overflow-hidden rounded-full"
                  style={{ background: SOFT }}
                >
                  {(() => {
                    const total =
                      data.team_compliance_breakdown.compliant +
                      data.team_compliance_breakdown.at_risk +
                      data.team_compliance_breakdown.non_compliant;

                    if (!total) return null;

                    return (
                      <>
                        <div
                          style={{
                            width: `${
                              (data.team_compliance_breakdown.compliant /
                                total) *
                              100
                            }%`,
                            background: GREEN,
                          }}
                        />

                        <div
                          style={{
                            width: `${
                              (data.team_compliance_breakdown.at_risk /
                                total) *
                              100
                            }%`,
                            background: AMBER,
                          }}
                        />

                        <div
                          style={{
                            width: `${
                              (data.team_compliance_breakdown
                                .non_compliant /
                                total) *
                              100
                            }%`,
                            background: RED,
                          }}
                        />
                      </>
                    );
                  })()}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <CompositionItem
                    label="Compliant"
                    value={
                      data.team_compliance_breakdown.compliant
                    }
                    color={GREEN}
                  />

                  <CompositionItem
                    label="At risk"
                    value={data.team_compliance_breakdown.at_risk}
                    color={AMBER}
                  />

                  <CompositionItem
                    label="Non-compliant"
                    value={
                      data.team_compliance_breakdown.non_compliant
                    }
                    color={RED}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            COMMON ISSUES
        ============================================================ */}
        {data.common_issues.length > 0 && (
          <section className="mt-8">
            <SectionEyebrow>
              Recurring issues
            </SectionEyebrow>

            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.common_issues.slice(0, 6).map((issue) => (
                <div
                  key={issue.issue}
                  className="flex items-center gap-3 border-b pb-3"
                  style={{ borderColor: BORDER }}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: AMBER_SOFT,
                      color: AMBER,
                    }}
                  >
                    <CircleAlert size={11} strokeWidth={2.5} />
                  </span>

                  <span
                    className="min-w-0 flex-1 text-[10px] font-bold"
                    style={{ color: TEXT }}
                  >
                    {issue.issue}
                  </span>

                  <span
                    className="text-[10px] font-black"
                    style={{ color: MUTED }}
                  >
                    {issue.count}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p
            className="text-[9px] font-medium"
            style={{ color: MUTED }}
          >
            CareCliQ executive governance view
          </p>

          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: health.color }}
            />

            <span
              className="text-[9px] font-bold"
              style={{ color: MUTED }}
            >
              {health.label}
            </span>
          </div>
        </footer>
      </main>
    </HubLayout>
  );
}

function CompositionItem({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />

      <span
        className="text-[10px] font-bold"
        style={{ color: TEXT }}
      >
        {label}
      </span>

      <span
        className="ml-auto text-[10px] font-black"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}