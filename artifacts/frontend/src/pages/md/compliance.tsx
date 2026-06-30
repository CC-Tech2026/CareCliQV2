import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, AlertTriangle, ArrowLeft, CheckCircle, XCircle, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#F59E0B";

interface MDData {
  compliance_score: number;
  compliance_target: number;
  common_issues: Array<{ issue: string; count: number }>;
  worker_rankings: Array<{ id: string; full_name: string; compliance_score: number; sessions: number }>;
  org_alerts: Array<{ type: string; severity: string; message: string }>;
  team_compliance_breakdown: { compliant: number; at_risk: number; non_compliant: number };
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

function AuditCheckItem({ label, status, translate }: { label: string; status: "ok" | "warn" | "pending"; translate: (k: string) => string }) {
  const config = {
    ok: { Icon: CheckCircle, color: "#10B981", textKey: "md.compliance.audit.complete" },
    warn: { Icon: AlertTriangle, color: "#F59E0B", textKey: "md.compliance.audit.review" },
    pending: { Icon: Clock, color: MUTED, textKey: "md.compliance.audit.pending" },
  }[status];
  const Icon = config.Icon;
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: SOFT }}>
      <span className="text-[12px] font-semibold" style={{ color: TEXT }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <Icon size={13} strokeWidth={2.5} style={{ color: config.color }} />
        <span className="text-[11px] font-black" style={{ color: config.color }}>{translate(config.textKey)}</span>
      </div>
    </div>
  );
}

export default function MDCompliancePage() {
  const { translate, translateParams } = useAccessibility();
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
    .map((t) => ({ week: t.week.replace(/^\d{4}-/, ""), score: t.avg_score, sessions: t.session_count }));

  const totalSessions = data
    ? data.team_compliance_breakdown.compliant + data.team_compliance_breakdown.at_risk + data.team_compliance_breakdown.non_compliant
    : 0;

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Compliance Dashboard</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>Organisation-wide compliance analysis and audit readiness</p>
          </div>
          <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
            <ShieldCheck size={16} strokeWidth={2.5} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: SOFT }} />)}
          </div>
        ) : error || !data ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: "#F97316" }} />
            <p className="font-black" style={{ color: TEXT }}>{translate("md.compliance.loadFailed")}</p>
          </div>
        ) : (
          <>
            {/* Score overview */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border bg-white p-4 shadow-sm lg:col-span-1" style={{ borderColor: BORDER }}>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>Org Compliance</p>
                <p
                  className="text-4xl font-black"
                  style={{ color: data.compliance_score >= data.compliance_target ? "#10B981" : "#EF4444" }}
                >
                  {data.compliance_score}%
                </p>
                <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                  Target: {data.compliance_target}%
                  {data.compliance_score >= data.compliance_target ? " ✓" : " ⚠"}
                </p>
              </div>
              {[
                { label: "Compliant Sessions", value: data.team_compliance_breakdown.compliant, color: "#10B981" },
                { label: "At Risk", value: data.team_compliance_breakdown.at_risk, color: AMBER },
                { label: "Non-Compliant", value: data.team_compliance_breakdown.non_compliant, color: "#EF4444" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>{label}</p>
                  <p className="text-xl font-black" style={{ color }}>{value}</p>
                  {totalSessions > 0 && (
                    <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                      {Math.round((value / totalSessions) * 100)}% of total
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* 90-day Trend Chart */}
            {chartData.length > 1 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-1 text-[14px] font-black" style={{ color: TEXT }}>90-Day Compliance Trend</h2>
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

            {/* {translate("md.compliance.commonIssues")} (rule breakdown proxy) */}
            {data.common_issues.length > 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-1 text-[14px] font-black" style={{ color: TEXT }}>Most Common Compliance Issues</h2>
                <p className="mb-4 text-[11px] font-medium" style={{ color: MUTED }}>Aggregated failing rules and recommendations across all sessions</p>
                <div className="space-y-2">
                  {data.common_issues.map((issue, i) => {
                    const maxCount = data.common_issues[0]?.count ?? 1;
                    const pct = Math.round((issue.count / maxCount) * 100);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-semibold" style={{ color: TEXT }}>{issue.issue}</span>
                          <span className="text-[11px] font-black" style={{ color: MUTED }}>{issue.count}×</span>
                        </div>
                        <div className="h-1.5 rounded-full" style={{ background: BORDER }}>
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${pct}%`, background: i === 0 ? "#EF4444" : i < 3 ? AMBER : PLUM }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Worker Rankings */}
            {data.worker_rankings.length > 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-3 text-[14px] font-black" style={{ color: TEXT }}>{translate("md.compliance.workerRankings")}</h2>
                <div className="space-y-2">
                  {data.worker_rankings.slice(0, 15).map((w, i) => (
                    <div key={w.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: SOFT }}>
                      <span className="w-6 text-center text-[11px] font-black" style={{ color: i < 3 ? "#10B981" : MUTED }}>
                        {i + 1}
                      </span>
                      <span className="flex-1 text-[12px] font-semibold" style={{ color: TEXT }}>{w.full_name}</span>
                      <span className="text-[11px] font-medium" style={{ color: MUTED }}>{w.sessions} sessions</span>
                      <div className="w-28">
                        <div className="h-1.5 rounded-full" style={{ background: BORDER }}>
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${w.compliance_score}%`,
                              background: w.compliance_score >= 85 ? "#10B981" : w.compliance_score >= 70 ? AMBER : "#EF4444",
                            }}
                          />
                        </div>
                      </div>
                      <span
                        className="w-10 text-right text-[11px] font-black"
                        style={{ color: w.compliance_score >= 85 ? "#10B981" : w.compliance_score >= 70 ? AMBER : "#EF4444" }}
                      >
                        {w.compliance_score}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* {translate("md.compliance.auditReadiness")} */}
            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <h2 className="mb-3 text-[14px] font-black" style={{ color: TEXT }}>{translate("md.compliance.auditReadiness")} Checklist</h2>
              <div className="space-y-2">
                <AuditCheckItem
                  translate={translate}
                  label="Session documentation complete"
                  status={data.team_compliance_breakdown.non_compliant === 0 ? "ok" : "warn"}
                />
                <AuditCheckItem
                  translate={translate}
                  label="Compliance score at target"
                  status={data.compliance_score >= data.compliance_target ? "ok" : "warn"}
                />
                <AuditCheckItem
                  translate={translate}
                  label="Compliance alerts resolved"
                  status={data.org_alerts.filter((a) => a.severity === "high").length === 0 ? "ok" : "warn"}
                />
                <AuditCheckItem translate={translate} label="Worker certifications current" status="pending" />
                <AuditCheckItem translate={translate} label="Training records up to date" status="pending" />
              </div>
              <div className="mt-4 rounded-xl px-4 py-3" style={{ background: SOFT }}>
                <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                  Certification and training readiness data will populate once credential tracking is connected.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </HubLayout>
  );
}
