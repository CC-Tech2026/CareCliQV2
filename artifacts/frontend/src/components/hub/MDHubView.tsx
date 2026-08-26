import { useEffect, useState } from "react";
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
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
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

// Same placeholder caseload assumption used by the Screening capacity check
// in Participant Onboarding — no live staffing-capacity feed exists yet, so
// this estimates total capacity as active staff × a reasonable caseload.
const CASELOAD_PER_WORKER = 6;

interface MDData {
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

function formatNumber(value: number) {
  return value.toLocaleString("en-AU");
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
      <text x="50%" y="50%" textAnchor="middle" dy="0.32em" style={{ fill: TEXT, fontSize: 28, fontWeight: 900 }}>
        {formatNumber(total)}
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

function ParticipantOverviewCard({
  total,
  bySex,
  byPlanStatus,
  capacity,
  onNavigate,
}: {
  total: number;
  bySex: MDData["participants_by_sex"];
  byPlanStatus: MDData["participants_by_plan_status"];
  capacity: { used: number; total: number };
  onNavigate: () => void;
}) {
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
          <CapacityMeter used={capacity.used} total={capacity.total} />
          <div className="mt-4 flex items-center gap-6">
            <ParticipantStat label="Male" value={bySex.male} />
            <ParticipantStat label="Female" value={bySex.female} />
            {bySex.unspecified > 0 && <ParticipantStat label="Others" value={bySex.unspecified} />}
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
            <ParticipantStat label="Pending" value={byPlanStatus.pending} color={byPlanStatus.pending > 0 ? AMBER : undefined} />
            <ParticipantStat label="Review" value={byPlanStatus.review} color={byPlanStatus.review > 0 ? AMBER : undefined} />
            <ParticipantStat label="Expired" value={byPlanStatus.expired} color={byPlanStatus.expired > 0 ? RED : undefined} />
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
/* Revenue trend                                                              */
/* -------------------------------------------------------------------------- */

type RevenuePeriod = "monthly" | "quarterly" | "yearly";

const REVENUE_PERIOD_META: Record<RevenuePeriod, { label: string; window: string }> = {
  monthly: { label: "Monthly", window: "last 12 months" },
  quarterly: { label: "Quarterly", window: "last 8 quarters" },
  yearly: { label: "Yearly", window: "last 5 years" },
};

/** Re-buckets the same monthly report into quarters/years — no new endpoint,
 *  just a different grouping of data already on the page. */
function bucketRevenue(monthly: RevenueMonth[], period: RevenuePeriod): Array<{ key: string; billed: number; paid: number }> {
  if (period === "monthly") {
    return monthly.slice(-12).map((m) => ({
      key: m.month.slice(5), // "2026-08" -> "08"; recent months only, so this stays unambiguous
      billed: Math.round(m.billed / 100),
      paid: Math.round(m.paid / 100),
    }));
  }

  const buckets = new Map<string, { label: string; billed: number; paid: number }>();
  for (const m of monthly) {
    const [yearStr, monthStr] = m.month.split("-");
    const monthNum = Number(monthStr);
    let sortKey: string;
    let label: string;
    if (period === "quarterly") {
      const quarter = Math.floor((monthNum - 1) / 3) + 1;
      sortKey = `${yearStr}-Q${quarter}`;
      label = `Q${quarter} ${yearStr}`;
    } else {
      sortKey = yearStr;
      label = yearStr;
    }
    const existing = buckets.get(sortKey) ?? { label, billed: 0, paid: 0 };
    existing.billed += m.billed;
    existing.paid += m.paid;
    buckets.set(sortKey, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(period === "quarterly" ? -8 : -5)
    .map(([, v]) => ({ key: v.label, billed: Math.round(v.billed / 100), paid: Math.round(v.paid / 100) }));
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

function RevenueChart() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [period, setPeriod] = useState<RevenuePeriod>("monthly");

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setReport(data ?? {}))
      .catch(() => setReport({}));
  }, []);

  const chartData = bucketRevenue(report?.monthly ?? [], period);
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
        ) : chartData.length < 2 ? (
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
  const [rev, setRev] = useState<{
    total_billed_cents?: number;
    total_paid_cents?: number;
    invoice_count?: number;
    monthly?: RevenueMonth[];
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
          detail={
            collectionDelta === null
              ? `${formatNumber(invoices)} invoices`
              : `${collectionDelta >= 0 ? "+" : ""}${collectionDelta} pts vs last month`
          }
          warning={collectionRate < 90}
          trend={collectionDelta}
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
      {/* Revenue (left) + needs action / exposure (right) — a two-column    */}
      {/* row rather than the triage list's usual full width, since it's     */}
      {/* paired with real chart content instead of sitting next to blank   */}
      {/* canvas (see the "sidebar" variant note in GovernanceTriage).       */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_360px]">
        <RevenueChart />
        <GovernanceTriage variant="sidebar" onNavigate={navigate} workersAtRisk={data.workers_at_risk} />
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
            onClick={() => navigate("/schedule")}
            breakdown={[
              { label: "Compliant", value: data.team_compliance_breakdown.compliant, color: GREEN },
              { label: "At risk", value: data.team_compliance_breakdown.at_risk, color: AMBER },
              { label: "Non-compliant", value: data.team_compliance_breakdown.non_compliant, color: RED },
            ]}
          />

          <ExecutiveMetric
            label="Goal achievement"
            value={`${data.goal_achievement_rate}%`}
            detail="Participant goals"
            onClick={() => navigate("/md/service-delivery")}
            achievementPct={data.goal_achievement_rate}
          />
        </div>

        <ParticipantOverviewCard
          total={data.active_participants}
          bySex={data.participants_by_sex}
          byPlanStatus={data.participants_by_plan_status}
          capacity={{ used: data.active_participants, total: data.active_staff * CASELOAD_PER_WORKER }}
          onNavigate={() => navigate("/participants")}
        />

        <ComplianceCard
          score={data.compliance_score}
          target={data.compliance_target}
          onNavigate={navigate}
        />

        <ComplianceTrend
          trend={trend}
          target={data.compliance_target}
        />

        <FinancialSummary
          onNavigate={() => navigate("/md/financial")}
        />
      </div>
    </div>
  );
}
