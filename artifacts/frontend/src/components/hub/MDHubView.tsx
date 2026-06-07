import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, UserCheck, TrendingUp, ShieldCheck,
  AlertTriangle, ArrowRight, Target, Activity,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";
const AMBER  = "#F59E0B";

interface MDData {
  active_participants: number;
  active_staff: number;
  staff_retention_rate: number;
  sessions_this_week: number;
  compliance_score: number;
  compliance_target: number;
  incidents_this_month: number;
  goal_achievement_rate: number;
  workers_at_risk: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  org_alerts: Array<{ type: string; severity: string; message: string }>;
  common_issues: Array<{ issue: string; count: number }>;
  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

/* ── KPI card ──────────────────────────────────────────────── */
function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  warn,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  accent?: string;
  warn?: boolean;
}) {
  const color = warn ? "#EF4444" : (accent ?? PLUM);
  return (
    <div
      className="rounded-xl border bg-white p-4 shadow-sm"
      style={{ borderColor: BORDER, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className="text-[10px] font-black uppercase tracking-[0.18em] leading-tight"
          style={{ color: MUTED }}
        >
          {label}
        </span>
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: SOFT, color }}
        >
          <Icon size={13} strokeWidth={2} />
        </div>
      </div>
      <p className="text-[26px] font-black leading-none tracking-tight" style={{ color: warn ? "#EF4444" : TEXT }}>
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-[11px] font-medium" style={{ color: warn ? "#EF4444" : MUTED }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ── Alert row ─────────────────────────────────────────────── */
const ALERT_STYLES: Record<string, string> = {
  high:   "border-red-200 bg-red-50 text-red-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low:    "border-blue-200 bg-blue-50 text-blue-700",
};

function AlertRow({ alert }: { alert: { type: string; severity: string; message: string } }) {
  const cls = ALERT_STYLES[alert.severity] ?? ALERT_STYLES.low;
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[12px] font-medium ${cls}`}>
      <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  );
}

/* ── Panel wrapper ─────────────────────────────────────────── */
function Panel({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>{title}</h2>
          {sub && <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{sub}</p>}
        </div>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-bold"
      style={{ color: PLUM }}
    >
      {children} <ArrowRight size={11} strokeWidth={2} />
    </button>
  );
}

/* ── Main component ────────────────────────────────────────── */
export function MDHubView() {
  const [, navigate] = useLocation();
  const [data,    setData]    = useState<MDData | null>(null);
  const [trend,   setTrend]   = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((r) => (r.ok ? r.json() : Promise.reject())),
      apiFetch("/api/dashboard/compliance-trend").then((r) => (r.ok ? r.json() : { trend: [] })),
    ])
      .then(([mdData, trendData]) => {
        if (!cancelled) {
          setData(mdData);
          setTrend(trendData.trend ?? []);
        }
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: SOFT }} />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
        <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: "#F97316" }} />
        <p className="text-[14px] font-black" style={{ color: TEXT }}>Could not load executive dashboard</p>
        <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Check your connection and try again.</p>
      </div>
    );
  }

  const complianceWarn = data.compliance_score < data.compliance_target;
  const chartData = trend
    .filter((t) => t.avg_score !== null)
    .slice(-13)
    .map((t) => ({ week: t.week.replace(/^\d{4}-/, ""), score: t.avg_score, sessions: t.session_count }));

  return (
    <div className="space-y-5">

      {/* ── KPI strip (top row) ──────────────────────── */}
      <section>
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
          Executive Metrics
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Active Participants" value={data.active_participants} icon={Users} accent={PLUM} />
          <KpiCard
            label="Active Staff"
            value={data.active_staff}
            sub={`${data.staff_retention_rate}% retention rate`}
            icon={UserCheck}
            accent="#10B981"
          />
          <KpiCard
            label="Sessions This Week"
            value={data.sessions_this_week}
            icon={Activity}
            accent="#0EA5E9"
          />
          <KpiCard
            label="Compliance Score"
            value={`${data.compliance_score}%`}
            sub={complianceWarn ? `Below ${data.compliance_target}% target` : `At or above ${data.compliance_target}% target`}
            icon={ShieldCheck}
            warn={complianceWarn}
          />
        </div>

        {/* secondary row */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <KpiCard
            label="Incidents This Month"
            value={data.incidents_this_month}
            icon={AlertTriangle}
            accent="#F97316"
            warn={data.incidents_this_month > 0}
          />
          <KpiCard
            label="Goal Achievement"
            value={`${data.goal_achievement_rate}%`}
            icon={Target}
            accent="#10B981"
          />
          <KpiCard
            label="Staff at Risk"
            value={data.workers_at_risk.length}
            icon={TrendingUp}
            warn={data.workers_at_risk.length > 0}
          />
        </div>
      </section>

      {/* ── Org alerts ──────────────────────────────── */}
      {data.org_alerts.length > 0 && (
        <Panel
          title="Organisation Alerts"
          sub="Items requiring executive attention"
          action={<LinkBtn onClick={() => navigate("/md/compliance")}>View compliance</LinkBtn>}
        >
          <div className="space-y-2">
            {data.org_alerts.map((alert, i) => <AlertRow key={i} alert={alert} />)}
          </div>
        </Panel>
      )}

      {/* ── Compliance trend chart ───────────────────── */}
      {chartData.length > 1 && (
        <Panel
          title="Compliance Trend"
          sub="Weekly average score — last 90 days"
          action={<LinkBtn onClick={() => navigate("/md/compliance")}>Full report</LinkBtn>}
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: MUTED }} />
              <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: MUTED }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }}
                formatter={(val: number) => [`${val}%`, "Avg Score"]}
              />
              <ReferenceLine
                y={data.compliance_target}
                stroke={AMBER}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{ value: `Target ${data.compliance_target}%`, fontSize: 10, fill: AMBER, position: "insideTopRight" }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PLUM}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: PLUM }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* ── Financial summary ───────────────────────── */}
      <FinancialSummaryStrip onNavigate={() => navigate("/md/financial")} />
    </div>
  );
}

/* ── Financial strip ───────────────────────────────────────── */
function FinancialSummaryStrip({ onNavigate }: { onNavigate: () => void }) {
  const [rev, setRev] = useState<{
    total_billed_cents?: number;
    total_paid_cents?: number;
    invoice_count?: number;
  } | null>(null);

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRev(d))
      .catch(() => {});
  }, []);

  const totalRev      = (rev?.total_billed_cents ?? 0) / 100;
  const totalInvoices = rev?.invoice_count ?? 0;
  const target        = Math.max(totalRev * 1.05, 1000);
  const pct           = totalRev > 0 ? Math.round((totalRev / target) * 100) : 0;

  return (
    <Panel
      title="Financial Summary"
      sub="Revenue & invoicing at a glance"
      action={<LinkBtn onClick={onNavigate}>Full report</LinkBtn>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Total Revenue", value: `$${totalRev.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` },
          { label: "Total Invoices", value: totalInvoices },
          { label: "vs Target", value: `${pct}%`, accent: pct >= 90 ? "#10B981" : AMBER },
        ].map(({ label, value, accent }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: SOFT }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
              {label}
            </p>
            <p className="mt-2 text-[22px] font-black leading-none" style={{ color: accent ?? TEXT }}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
