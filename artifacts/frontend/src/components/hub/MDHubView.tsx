import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  AlertTriangle,
  ArrowRight,
  Users,
  ShieldCheck,
  DollarSign,
  FileWarning,
  TrendingUp,
  TrendingDown,
  ChevronRight,
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
  active_participants: number;
  active_staff: number;
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

  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatNumber(value: number) {
  return value.toLocaleString("en-AU");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function severityLabel(severity: string) {
  if (severity === "high") return "High priority";
  if (severity === "medium") return "Review";
  return "Information";
}

/* -------------------------------------------------------------------------- */
/* Executive metric strip                                                     */
/* -------------------------------------------------------------------------- */

function ExecutiveMetric({
  label,
  value,
  detail,
  onClick,
}: {
  label: string;
  value: string | number;
  detail: string;
  onClick?: () => void;
}) {
  const content = (
    <div className="px-5 py-5">
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
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button
      onClick={onClick}
      className="text-left transition-colors hover:bg-cc-soft"
    >
      {content}
    </button>
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

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

function AlertsPanel({
  alerts,
  onNavigate,
}: {
  alerts: MDData["org_alerts"];
  onNavigate: (path: string) => void;
}) {
  if (!alerts.length) {
    return (
      <section
        className="rounded-2xl border"
        style={{
          borderColor: BORDER,
          background: SURFACE,
        }}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: "#E9F5F0",
              color: GREEN,
            }}
          >
            <ShieldCheck size={15} strokeWidth={2} />
          </div>

          <div>
            <p
              className="text-[12px] font-bold"
              style={{ color: TEXT }}
            >
              No organisation alerts
            </p>

            <p
              className="mt-0.5 text-[10px]"
              style={{ color: MUTED }}
            >
              Nothing currently requires your attention.
            </p>
          </div>
        </div>
      </section>
    );
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
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <div>
          <div className="flex items-center gap-2">
            <FileWarning
              size={15}
              strokeWidth={2}
              style={{ color: AMBER }}
            />

            <h2
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              Attention required
            </h2>
          </div>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Organisation issues that may need action
          </p>
        </div>

        <button
          onClick={() => onNavigate("/md/compliance")}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          View all
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="divide-y" style={{ borderColor: BORDER }}>
        {alerts.slice(0, 4).map((alert, index) => {
          const high = alert.severity === "high";
          const medium = alert.severity === "medium";

          const color = high
            ? RED
            : medium
            ? AMBER
            : BLUE;

          const background = high
            ? "#FBEAE9"
            : medium
            ? "#FBF2E6"
            : "#EAF1F7";

          return (
            <button
              key={`${alert.type}-${index}`}
              onClick={() => onNavigate("/md/compliance")}
              className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-cc-soft"
            >
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background,
                  color,
                }}
              >
                <AlertTriangle size={13} strokeWidth={2} />
              </div>

              <div className="min-w-0 flex-1">
                <span
                  className="text-[9px] font-black uppercase tracking-[0.12em]"
                  style={{ color }}
                >
                  {severityLabel(alert.severity)}
                </span>

                <p
                  className="mt-1 text-[12px] font-semibold leading-relaxed"
                  style={{ color: TEXT }}
                >
                  {alert.message}
                </p>
              </div>

              <ChevronRight
                size={14}
                className="mt-1 shrink-0"
                style={{ color: MUTED }}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Operational health                                                         */
/* -------------------------------------------------------------------------- */

function OperationalHealth({
  data,
  onNavigate,
}: {
  data: MDData;
  onNavigate: (path: string) => void;
}) {
  const complianceWarn =
    data.compliance_score < data.compliance_target;

  return (
    <section
      className="rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <h2
          className="text-[14px] font-black"
          style={{ color: TEXT }}
        >
          Operational health
        </h2>

        <p
          className="mt-1 text-[11px]"
          style={{ color: MUTED }}
        >
          Key organisation signals
        </p>
      </div>

      <div className="p-2">
        <OperationalRow
          icon={ShieldCheck}
          label="Compliance"
          detail={`${data.compliance_score}% organisation score`}
          color={complianceWarn ? RED : GREEN}
          background={complianceWarn ? "#FBEAE9" : "#E9F5F0"}
          onClick={() => onNavigate("/md/compliance")}
        />

        <OperationalRow
          icon={Users}
          label="Staff health"
          detail={
            data.workers_at_risk.length
              ? `${data.workers_at_risk.length} worker${
                  data.workers_at_risk.length === 1 ? "" : "s"
                } need attention`
              : "No workers flagged"
          }
          color={data.workers_at_risk.length ? RED : GREEN}
          background={
            data.workers_at_risk.length
              ? "#FBEAE9"
              : "#E9F5F0"
          }
          onClick={() => onNavigate("/md/staff")}
        />

        <OperationalRow
          icon={FileWarning}
          label="Incidents"
          detail={`${data.incidents_this_month} this month`}
          color={AMBER}
          background="#FBF2E6"
          onClick={() => onNavigate("/quality")}
        />
      </div>
    </section>
  );
}

function OperationalRow({
  icon: Icon,
  label,
  detail,
  color,
  background,
  onClick,
}: {
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
  label: string;
  detail: string;
  color: string;
  background: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-cc-soft"
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background,
          color,
        }}
      >
        <Icon size={14} strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="text-[11px] font-bold"
          style={{ color: TEXT }}
        >
          {label}
        </p>

        <p
          className="mt-0.5 text-[10px]"
          style={{ color: MUTED }}
        >
          {detail}
        </p>
      </div>

      <ChevronRight
        size={13}
        strokeWidth={2}
        style={{ color: MUTED }}
      />
    </button>
  );
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
    .filter((item) => item.avg_score !== null)
    .slice(-13)
    .map((item) => ({
      week: item.week.replace(/^\d{4}-/, ""),
      score: item.avg_score,
      sessions: item.session_count,
    }));

  if (chartData.length < 2) {
    return null;
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
            Compliance trend
          </h2>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Average session compliance over recent weeks
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
              domain={[50, 100]}
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
/* Staff at risk                                                              */
/* -------------------------------------------------------------------------- */

function StaffAtRisk({
  workers,
  onNavigate,
}: {
  workers: MDData["workers_at_risk"];
  onNavigate: (path: string) => void;
}) {
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
          <h2
            className="text-[14px] font-black"
            style={{ color: TEXT }}
          >
            Staff requiring attention
          </h2>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Workers with lower compliance performance
          </p>
        </div>

        <button
          onClick={() => onNavigate("/md/staff")}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          View staff
          <ArrowRight size={12} />
        </button>
      </div>

      {workers.length === 0 ? (
        <div className="px-5 py-7 text-center">
          <p
            className="text-[12px] font-semibold"
            style={{ color: TEXT }}
          >
            No workers currently flagged
          </p>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Staff compliance is currently within expected
            ranges.
          </p>
        </div>
      ) : (
        <div
          className="divide-y"
          style={{ borderColor: BORDER }}
        >
          {workers.slice(0, 4).map((worker) => (
            <button
              key={worker.id}
              onClick={() => onNavigate("/md/staff")}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-cc-soft"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[9px] font-black"
                style={{
                  background: `${PLUM}12`,
                  color: PLUM,
                }}
              >
                {getInitials(worker.full_name)}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[12px] font-bold"
                  style={{ color: TEXT }}
                >
                  {worker.full_name}
                </p>

                <p
                  className="mt-0.5 text-[10px]"
                  style={{ color: MUTED }}
                >
                  {worker.sessions} sessions
                </p>
              </div>

              <div className="text-right">
                <p
                  className="text-[12px] font-black"
                  style={{ color: RED }}
                >
                  {worker.compliance_score}%
                </p>

                <p
                  className="text-[9px]"
                  style={{ color: MUTED }}
                >
                  compliance
                </p>
              </div>

              <ChevronRight
                size={13}
                style={{ color: MUTED }}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Financial summary                                                          */
/* -------------------------------------------------------------------------- */

function FinancialSummary({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const [rev, setRev] = useState<{
    total_billed_cents?: number;
    total_paid_cents?: number;
    invoice_count?: number;
  } | null>(null);

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((response) =>
        response.ok ? response.json() : null
      )
      .then((data) => setRev(data))
      .catch(() => {});
  }, []);

  const totalRevenue =
    (rev?.total_billed_cents ?? 0) / 100;

  const totalPaid =
    (rev?.total_paid_cents ?? 0) / 100;

  const invoices = rev?.invoice_count ?? 0;

  const collectionRate =
    totalRevenue > 0
      ? Math.round((totalPaid / totalRevenue) * 100)
      : 0;

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
          value={`${collectionRate}%`}
          detail={`${formatNumber(invoices)} invoices`}
          warning={collectionRate < 90}
        />
      </div>
    </section>
  );
}

function FinancialMetric({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: string;
  detail?: string;
  warning?: boolean;
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
          className="mt-0.5 text-[10px]"
          style={{ color: MUTED }}
        >
          {detail}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export function MDHubView() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(false);

    Promise.all([
      apiFetch("/api/dashboard/managing-director").then(
        (response) =>
          response.ok
            ? response.json()
            : Promise.reject()
      ),

      apiFetch("/api/dashboard/compliance-trend").then(
        (response) =>
          response.ok
            ? response.json()
            : { trend: [] }
      ),
    ])
      .then(([mdData, trendData]) => {
        if (cancelled) return;

        setData(mdData);
        setTrend(trendData.trend ?? []);
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

  /* ------------------------------------------------------------------------ */
  /* Loading                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="space-y-5">
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

        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
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
          className="h-64 animate-pulse rounded-2xl"
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
    <div className="space-y-5">

      {/* ------------------------------------------------------------------ */}
      {/* Executive metrics                                                  */}
      {/* ------------------------------------------------------------------ */}

      <div
        className="grid overflow-hidden rounded-2xl border sm:grid-cols-2 xl:grid-cols-4"
        style={{
          borderColor: BORDER,
          background: SURFACE,
        }}
      >
        <ExecutiveMetric
          label="Participants"
          value={formatNumber(data.active_participants)}
          detail="Active participants"
          onClick={() => navigate("/participants")}
        />

        <ExecutiveMetric
          label="Active staff"
          value={formatNumber(data.active_staff)}
          detail={`${data.staff_retention_rate}% retention`}
          onClick={() => navigate("/md/staff")}
        />

        <ExecutiveMetric
          label="Support visits"
          value={formatNumber(data.sessions_this_week)}
          detail="This week"
          onClick={() => navigate("/schedule")}
        />

        <ExecutiveMetric
          label="Goal achievement"
          value={`${data.goal_achievement_rate}%`}
          detail="Participant goals"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Compliance                                                         */}
      {/* ------------------------------------------------------------------ */}

      <ComplianceCard
        score={data.compliance_score}
        target={data.compliance_target}
        onNavigate={navigate}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Alerts + operational health                                        */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <AlertsPanel
          alerts={data.org_alerts}
          onNavigate={navigate}
        />

        <OperationalHealth
          data={data}
          onNavigate={navigate}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Compliance trend                                                   */}
      {/* ------------------------------------------------------------------ */}

      <ComplianceTrend
        trend={trend}
        target={data.compliance_target}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Staff + finance                                                    */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid gap-5 xl:grid-cols-2">
        <StaffAtRisk
          workers={data.workers_at_risk}
          onNavigate={navigate}
        />

        <FinancialSummary
          onNavigate={() => navigate("/md/financial")}
        />
      </div>
    </div>
  );
}