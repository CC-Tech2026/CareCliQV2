import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Users, UserCheck, Activity, ShieldCheck, AlertTriangle,
  Target, TrendingUp, TrendingDown, Minus, BarChart2, ArrowLeft,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { HubLayout } from "@/components/layout/HubLayout";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#F59E0B";

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
  workers_at_risk: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  org_alerts: Array<{ type: string; severity: string; message: string }>;
  common_issues: Array<{ issue: string; count: number }>;
  team_compliance_breakdown: { compliant: number; at_risk: number; non_compliant: number };
  worker_rankings: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

function TrendIcon({ value, target }: { value: number; target: number }) {
  if (value >= target) return <TrendingUp size={14} strokeWidth={2.5} className="text-emerald-600" />;
  if (value >= target * 0.9) return <Minus size={14} strokeWidth={2.5} className="text-amber-500" />;
  return <TrendingDown size={14} strokeWidth={2.5} className="text-red-500" />;
}

function KpiCard({
  label, value, sub, icon: Icon, accent, warn,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  accent?: string; warn?: boolean;
}) {
  const color = warn ? "#EF4444" : accent ?? PLUM;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: SOFT, color }}>
          <Icon size={14} strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-2xl font-black leading-none" style={{ color: warn ? "#EF4444" : TEXT }}>{value}</p>
      {sub && <p className="mt-1 text-[11px] font-medium" style={{ color: warn ? "#EF4444" : MUTED }}>{sub}</p>}
    </div>
  );
}

export default function MDExecutivePage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/api/dashboard/managing-director").then((r) => (r.ok ? r.json() : Promise.reject())),
      apiFetch("/api/dashboard/compliance-trend").then((r) => (r.ok ? r.json() : { trend: [] })),
    ])
      .then(([md, tr]) => { if (!cancelled) { setData(md); setTrend(tr.trend ?? []); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const chartData = trend
    .filter((t) => t.avg_score !== null)
    .slice(-13)
    .map((t) => ({ week: t.week.replace(/^\d{4}-/, ""), score: t.avg_score }));

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        {/* Page header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> Hub
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Executive Dashboard</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>Organisation-wide KPIs and strategic overview</p>
          </div>
          <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: SOFT, color: AMBER }}>
            <BarChart2 size={16} strokeWidth={2.5} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: SOFT }} />)}
          </div>
        ) : error || !data ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: "#F97316" }} />
            <p className="font-black" style={{ color: TEXT }}>Could not load executive dashboard</p>
          </div>
        ) : (
          <>
            {/* KPI Grid */}
            <section>
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Key Performance Indicators</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="Active Participants" value={data.active_participants} icon={Users} accent={PLUM} />
                <KpiCard label="Active Staff" value={data.active_staff} sub={`${data.staff_retention_rate}% retention rate`} icon={UserCheck} accent="#10B981" />
                <KpiCard label="Sessions This Week" value={data.sessions_this_week} icon={Activity} accent="#0EA5E9" />
                <KpiCard
                  label="Compliance Score"
                  value={`${data.compliance_score}%`}
                  sub={data.compliance_score < data.compliance_target ? `Below ${data.compliance_target}% target` : `Target ${data.compliance_target}% ✓`}
                  icon={ShieldCheck}
                  warn={data.compliance_score < data.compliance_target}
                />
                <KpiCard label="Incidents This Month" value={data.incidents_this_month} icon={AlertTriangle} accent="#F97316" warn={data.incidents_this_month >= 3} />
                <KpiCard label="Goal Achievement" value={`${data.goal_achievement_rate}%`} icon={Target} accent="#10B981" />
                <KpiCard label="Support Workers" value={data.support_workers} icon={Users} accent={PLUM} />
                <KpiCard label="Workers at Risk" value={data.workers_at_risk.length} icon={TrendingDown} warn={data.workers_at_risk.length > 0} />
              </div>
            </section>

            {/* Trend Indicators */}
            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <h2 className="mb-1 text-[14px] font-black" style={{ color: TEXT }}>Performance Trends</h2>
              <p className="mb-4 text-[11px] font-medium" style={{ color: MUTED }}>Direction indicators vs target thresholds</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Compliance", value: data.compliance_score, target: data.compliance_target },
                  { label: "Goal Achievement", value: data.goal_achievement_rate, target: 85 },
                  { label: "Staff Retention", value: data.staff_retention_rate, target: 90 },
                  { label: "Compliant Sessions", value: data.team_compliance_breakdown.compliant > 0 ? Math.round((data.team_compliance_breakdown.compliant / Math.max(data.team_compliance_breakdown.compliant + data.team_compliance_breakdown.at_risk + data.team_compliance_breakdown.non_compliant, 1)) * 100) : 0, target: 80 },
                ].map(({ label, value, target }) => (
                  <div key={label} className="flex items-center gap-3 rounded-xl p-3" style={{ background: SOFT }}>
                    <TrendIcon value={value} target={target} />
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
                      <p className="text-[14px] font-black" style={{ color: TEXT }}>{value}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 90-day Compliance Chart */}
            {chartData.length > 1 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-1 text-[14px] font-black" style={{ color: TEXT }}>Compliance Trend — Last 90 Days</h2>
                <p className="mb-4 text-[11px] font-medium" style={{ color: MUTED }}>Weekly average compliance score across all sessions</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: MUTED }} />
                    <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: MUTED }} />
                    <ReferenceLine y={data.compliance_target} stroke={AMBER} strokeDasharray="4 2" label={{ value: `Target ${data.compliance_target}%`, position: "right", fontSize: 9, fill: AMBER }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} formatter={(v: number) => [`${v}%`, "Avg Score"]} />
                    <Line type="monotone" dataKey="score" stroke={PLUM} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: PLUM }} />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            )}

            {/* Org Alerts */}
            {data.org_alerts.length > 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-3 text-[14px] font-black" style={{ color: TEXT }}>Organisation Alerts</h2>
                <div className="space-y-2">
                  {data.org_alerts.map((alert, i) => {
                    const sev = alert.severity;
                    const cls = sev === "high" ? "bg-red-50 border-red-200 text-red-700"
                      : sev === "medium" ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-blue-50 border-blue-200 text-blue-700";
                    return (
                      <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${cls}`}>
                        <AlertTriangle size={12} strokeWidth={2.5} className="mt-0.5 shrink-0" />
                        {alert.message}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Worker Rankings */}
            {data.worker_rankings.length > 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-3 text-[14px] font-black" style={{ color: TEXT }}>Top Worker Performance</h2>
                <div className="space-y-2">
                  {data.worker_rankings.slice(0, 8).map((w, i) => (
                    <div key={w.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: i === 0 ? "#F0FDF4" : SOFT }}>
                      <span className="w-5 text-[11px] font-black text-center" style={{ color: i < 3 ? "#10B981" : MUTED }}>
                        {i + 1}
                      </span>
                      <span className="flex-1 text-[12px] font-semibold" style={{ color: TEXT }}>{w.full_name}</span>
                      <span className="text-[11px] font-medium" style={{ color: MUTED }}>{w.sessions} sessions</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-black"
                        style={{
                          background: w.compliance_score >= 85 ? "#D1FAE5" : w.compliance_score >= 70 ? "#FEF3C7" : "#FEE2E2",
                          color: w.compliance_score >= 85 ? "#065F46" : w.compliance_score >= 70 ? "#92400E" : "#991B1B",
                        }}
                      >
                        {w.compliance_score}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </HubLayout>
  );
}
