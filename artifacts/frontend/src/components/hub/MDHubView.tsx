import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, UserCheck, TrendingUp, ShieldCheck,
  AlertTriangle, ArrowRight, Target, Activity,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";
const PLUM = "#5533CC";
const AMBER = "#F59E0B";

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
  const color = warn ? "#EF4444" : accent ?? PLUM;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>
          {label}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: SOFT, color }}>
          <Icon size={15} strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-2xl font-black leading-none" style={{ color: warn ? "#EF4444" : TEXT }}>
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[11px] font-medium" style={{ color: warn ? "#EF4444" : MUTED }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: { type: string; severity: string; message: string } }) {
  const sev = alert.severity;
  const colorMap: Record<string, string> = {
    high: "bg-red-50 border-red-200 text-red-700",
    medium: "bg-amber-50 border-amber-200 text-amber-700",
    low: "bg-blue-50 border-blue-200 text-blue-700",
  };
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-[12px] font-medium ${colorMap[sev] ?? colorMap.low}`}>
      <AlertTriangle size={13} strokeWidth={2.5} className="mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  );
}

export function MDHubView() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: SOFT }} />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
        <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: "#F97316" }} />
        <p className="text-[14px] font-black" style={{ color: TEXT }}>Could not load executive dashboard</p>
        <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Check your connection and try again.</p>
      </div>
    );
  }

  const complianceWarn = data.compliance_score < data.compliance_target;
  const chartData = trend
    .filter((t) => t.avg_score !== null)
    .slice(-13)
    .map((t) => ({ week: t.week.replace(/^\d{4}-/, ""), score: t.avg_score, sessions: t.session_count }));

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <section>
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Executive Metrics
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Active Participants" value={data.active_participants} icon={Users} accent={PLUM} />
          <KpiCard
            label="Active Staff"
            value={data.active_staff}
            sub={`${data.staff_retention_rate}% retention`}
            icon={UserCheck}
            accent="#10B981"
          />
          <KpiCard label="Sessions This Week" value={data.sessions_this_week} icon={Activity} accent="#0EA5E9" />
          <KpiCard
            label="Compliance Score"
            value={`${data.compliance_score}%`}
            sub={complianceWarn ? `Below ${data.compliance_target}% target` : `Target ${data.compliance_target}% ✓`}
            icon={ShieldCheck}
            warn={complianceWarn}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <KpiCard label="Incidents This Month" value={data.incidents_this_month} icon={AlertTriangle} accent="#F97316" />
          <KpiCard
            label="Goal Achievement"
            value={`${data.goal_achievement_rate}%`}
            icon={Target}
            accent="#10B981"
          />
          <KpiCard label="Staff at Risk" value={data.workers_at_risk.length} icon={TrendingUp} warn={data.workers_at_risk.length > 0} />
        </div>
      </section>

      {/* Org Alerts */}
      {data.org_alerts.length > 0 && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Organisation Alerts</h2>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>Items requiring executive attention</p>
            </div>
            <button
              onClick={() => navigate("/md/compliance")}
              className="flex items-center gap-1 text-[11px] font-black"
              style={{ color: PLUM }}
            >
              View compliance <ArrowRight size={11} strokeWidth={2.5} />
            </button>
          </div>
          <div className="space-y-2">
            {data.org_alerts.map((alert, i) => (
              <AlertRow key={i} alert={alert} />
            ))}
          </div>
        </section>
      )}

      {/* Compliance Trend */}
      {chartData.length > 1 && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Compliance Trend (90 days)</h2>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>Weekly average compliance score</p>
            </div>
            <button
              onClick={() => navigate("/md/compliance")}
              className="flex items-center gap-1 text-[11px] font-black"
              style={{ color: PLUM }}
            >
              Full report <ArrowRight size={11} strokeWidth={2.5} />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: MUTED }} />
              <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: MUTED }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }}
                formatter={(val: number) => [`${val}%`, "Avg Score"]}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PLUM}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: PLUM }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-end">
            <span className="text-[10px] font-medium" style={{ color: MUTED }}>
              Target: {data.compliance_target}%
            </span>
          </div>
        </section>
      )}

      {/* Financial Summary */}
      <FinancialSummaryStrip onNavigate={() => navigate("/md/financial")} />
    </div>
  );
}

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

  const totalRev = ((rev?.total_billed_cents ?? 0) / 100);
  const totalInvoices = rev?.invoice_count ?? 0;
  const target = Math.max(totalRev * 1.05, 1000);
  const pct = totalRev > 0 ? Math.round((totalRev / target) * 100) : 0;

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Financial Summary</h2>
          <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>Revenue & invoicing at a glance</p>
        </div>
        <button onClick={onNavigate} className="flex items-center gap-1 text-[11px] font-black" style={{ color: PLUM }}>
          Full report <ArrowRight size={11} strokeWidth={2.5} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl p-3" style={{ background: SOFT }}>
          <p className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Total Revenue</p>
          <p className="mt-1 text-xl font-black" style={{ color: TEXT }}>
            ${totalRev.toLocaleString("en-AU", { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-xl p-3" style={{ background: SOFT }}>
          <p className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Total Invoices</p>
          <p className="mt-1 text-xl font-black" style={{ color: TEXT }}>{totalInvoices}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: SOFT }}>
          <p className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>vs Target</p>
          <p className="mt-1 text-xl font-black" style={{ color: pct >= 90 ? "#10B981" : "#F59E0B" }}>{pct}%</p>
        </div>
      </div>
    </section>
  );
}
