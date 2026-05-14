import { useState, useMemo } from "react";
import { useGetComplianceOverview, useGetComplianceReport } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, FileCheck2, Info, TrendingUp,
  XCircle, CheckCircle2, DollarSign, BarChart3, Filter, Lightbulb,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM  = "#542269";
const CORAL = "#F1738A";
const T1    = "#1C1626";
const T2    = "#4A3D5A";
const T3    = "#7A6A8A";
const BORDER = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

// ── Extended types ────────────────────────────────────────────────────────────
interface ExtendedComplianceOverview {
  average_score: number; total_sessions: number;
  compliant: number; at_risk: number; non_compliant: number;
  sessions?: ExtendedReportItem[];
}
interface ExtendedReportItem {
  session_id: string; participant_name: string;
  session_date: string; session_type: string;
  compliance_score?: number | null; compliance_status?: string;
  goals_linked?: boolean; notes_length?: number; duration_minutes?: number;
  status?: string;
  checks?: { notes_present?: boolean; duration_recorded?: boolean; goals_linked?: boolean; };
}
type ClaimStatus = "all" | "compliant" | "at_risk" | "non_compliant" | "draft";

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(score: number) {
  return score >= 85 ? "#16A34A" : score >= 60 ? "#D97706" : "#DC2626";
}
function scoreBg(score: number) {
  return score >= 85 ? "rgba(22,163,74,0.08)"
    : score >= 60 ? "rgba(245,158,11,0.08)"
    : "rgba(239,68,68,0.08)";
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string; label: string }> = {
    compliant:     { color: "#16A34A", bg: "rgba(22,163,74,0.08)",    label: "Compliant"     },
    at_risk:       { color: "#D97706", bg: "rgba(245,158,11,0.08)",   label: "At Risk"       },
    non_compliant: { color: "#DC2626", bg: "rgba(239,68,68,0.08)",    label: "Non-Compliant" },
    draft:         { color: T3,        bg: `rgba(84,34,105,0.06)`,    label: "Draft"         },
  };
  const c = cfg[status] ?? cfg.draft;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

function aggregateFailingRules(sessions: ExtendedReportItem[]) {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    if ((s.compliance_score ?? 100) < 85) {
      if (!s.goals_linked)                   counts["Goals not linked to NDIS plan"]  = (counts["Goals not linked to NDIS plan"]  || 0) + 1;
      if (!s.notes_length || s.notes_length < 50) counts["Insufficient clinical notes"] = (counts["Insufficient clinical notes"] || 0) + 1;
      if (!s.duration_minutes)               counts["Duration not recorded"]           = (counts["Duration not recorded"]          || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

// ── Check icon helper ─────────────────────────────────────────────────────────
function Check({ pass, warn = false }: { pass: boolean; warn?: boolean }) {
  if (pass) return <ShieldCheck size={15} style={{ color: "#16A34A" }} />;
  if (warn) return <AlertTriangle size={15} style={{ color: "#D97706" }} />;
  return <ShieldAlert size={15} style={{ color: "#DC2626" }} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Compliance() {
  const { data: rawOverview, isLoading: overviewLoading } = useGetComplianceOverview();
  const { data: rawReport,   isLoading: reportLoading   } = useGetComplianceReport();
  const [statusFilter, setStatusFilter] = useState<ClaimStatus>("all");

  const overview    = rawOverview as unknown as ExtendedComplianceOverview | undefined;
  const reportItems = (rawReport  as unknown as ExtendedReportItem[] | undefined) ?? [];

  const filteredSessions = useMemo(
    () => statusFilter === "all" ? reportItems : reportItems.filter(s => s.compliance_status === statusFilter),
    [reportItems, statusFilter],
  );
  const failingRules = useMemo(() => aggregateFailingRules(reportItems), [reportItems]);

  const estimatedLostRevenue = useMemo(() => {
    const mins = reportItems
      .filter(s => s.compliance_status === "non_compliant")
      .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    return ((mins / 60) * 67.56).toFixed(0);
  }, [reportItems]);

  const avg          = overview?.average_score ?? 0;
  const compliant    = overview?.compliant     ?? 0;
  const atRisk       = overview?.at_risk       ?? 0;
  const nonCompliant = overview?.non_compliant ?? 0;

  const arcColor = avg >= 85 ? CORAL : avg >= 60 ? "#D97706" : "#DC2626";
  const circ = 2 * Math.PI * 60;

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-start gap-3">
        <div className="mt-1.5 h-8 w-1 rounded-full shrink-0"
          style={{ background: `linear-gradient(to bottom, ${CORAL}, ${PLUM})` }} />
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
            Compliance Centre
          </h1>
          <p className="text-[14px] mt-1" style={{ color: T2 }}>
            Monitor NDIS documentation compliance, claim readiness, and audit preparedness.
          </p>
        </div>
      </div>

      {/* ── Score + stat cards ── */}
      <div className="grid gap-4 md:grid-cols-4">

        {/* Gauge card */}
        <div className="md:col-span-1 bg-white rounded-2xl p-6 flex flex-col items-center gap-3"
          style={{ boxShadow: CARD_SHADOW }}>
          <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>
            Overall Score
          </p>
          {overviewLoading ? (
            <Skeleton className="h-32 w-32 rounded-full" />
          ) : (
            <div className="relative flex items-center justify-center">
              <svg width="130" height="130" className="-rotate-90" viewBox="0 0 144 144">
                <circle cx="72" cy="72" r="60" stroke="rgba(232,213,232,0.55)" strokeWidth="13" fill="none" />
                <circle
                  cx="72" cy="72" r="60" stroke={arcColor} strokeWidth="13" fill="none"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - avg / 100)}
                  strokeLinecap="round" className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-[32px] font-bold leading-none" style={{ color: T1 }}>{Math.round(avg)}</span>
                <span className="text-[10px] font-medium mt-0.5" style={{ color: T3 }}>/100</span>
              </div>
            </div>
          )}
          <p className="flex items-center gap-1 text-[12px] font-medium" style={{ color: T3 }}>
            <TrendingUp size={13} style={{ color: CORAL }} /> NDIS Audit Score
          </p>
        </div>

        {/* Three stat pills + info banner */}
        <div className="md:col-span-3 grid grid-cols-3 gap-4">
          {/* Compliant */}
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#16A34A" }}>
              <FileCheck2 size={13} /> Compliant
            </p>
            {overviewLoading ? <Skeleton className="h-9 w-12" /> : (
              <>
                <p className="text-[28px] font-bold leading-none" style={{ color: T1 }}>{compliant}</p>
                <p className="text-[11px] mt-1" style={{ color: T3 }}>Score ≥ 85%</p>
              </>
            )}
          </div>

          {/* At Risk */}
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#D97706" }}>
              <AlertTriangle size={13} /> At Risk
            </p>
            {overviewLoading ? <Skeleton className="h-9 w-12" /> : (
              <>
                <p className="text-[28px] font-bold leading-none" style={{ color: T1 }}>{atRisk}</p>
                <p className="text-[11px] mt-1" style={{ color: T3 }}>Score 60–84%</p>
              </>
            )}
          </div>

          {/* Non-Compliant */}
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#DC2626" }}>
              <XCircle size={13} /> Non-Compliant
            </p>
            {overviewLoading ? <Skeleton className="h-9 w-12" /> : (
              <>
                <p className="text-[28px] font-bold leading-none" style={{ color: T1 }}>{nonCompliant}</p>
                <p className="text-[11px] mt-1" style={{ color: T3 }}>Score &lt; 60%</p>
              </>
            )}
          </div>

          {/* Info note */}
          <div className="col-span-3 rounded-2xl px-4 py-3 flex items-start gap-2.5"
            style={{ background: `${PLUM}06`, border: `1px solid ${PLUM}18` }}>
            <Info size={14} className="shrink-0 mt-0.5" style={{ color: PLUM }} />
            <p className="text-[12px] leading-relaxed" style={{ color: T2 }}>
              NDIS audit readiness requires a score of 85%+. Sessions at risk may be rejected during
              claim processing. Ensure all sessions include dated notes, measurable outcomes, and links
              to participant goals.
            </p>
          </div>
        </div>
      </div>

      {/* ── Issues + Budget row ── */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Common issues */}
        <div className="bg-white rounded-2xl p-6" style={{ boxShadow: CARD_SHADOW }}>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={15} style={{ color: T3 }} />
            <h2 className="text-[16px] font-semibold" style={{ color: T1 }}>Most Common Issues</h2>
          </div>
          <p className="text-[12px] mb-4" style={{ color: T3 }}>Top documentation gaps across sessions</p>

          {reportLoading ? (
            <div className="space-y-3">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : failingRules.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3"
              style={{ background: "rgba(22,163,74,0.08)", color: "#16A34A" }}>
              <CheckCircle2 size={15} />
              <span className="text-[13px] font-medium">No common issues — great compliance!</span>
            </div>
          ) : (
            <div className="space-y-4">
              {failingRules.map(([rule, count], i) => {
                const total = reportItems.length || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] font-medium" style={{ color: T2 }}>{rule}</span>
                      <span className="text-[12px] font-semibold" style={{ color: pct >= 50 ? "#DC2626" : "#D97706" }}>
                        {count} session{count > 1 ? "s" : ""}
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      className={`h-1.5 ${pct >= 50 ? "[&>div]:bg-red-400" : "[&>div]:bg-amber-400"}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Budget impact */}
        <div className="bg-white rounded-2xl p-6" style={{ boxShadow: CARD_SHADOW }}>
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={15} style={{ color: T3 }} />
            <h2 className="text-[16px] font-semibold" style={{ color: T1 }}>Budget Impact</h2>
          </div>
          <p className="text-[12px] mb-4" style={{ color: T3 }}>Financial risk from non-compliant sessions</p>

          {overviewLoading ? <Skeleton className="h-20 w-full" /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-4"
                  style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.14)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#DC2626" }}>
                    At-Risk Revenue
                  </p>
                  <p className="text-[22px] font-bold leading-none" style={{ color: T1 }}>
                    ${Number(estimatedLostRevenue).toLocaleString()}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "#DC2626" }}>
                    from {nonCompliant} session{nonCompliant !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="rounded-xl p-4"
                  style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.14)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16A34A" }}>
                    Claim Rate
                  </p>
                  <p className="text-[22px] font-bold leading-none" style={{ color: T1 }}>
                    {(overview?.total_sessions ?? 0) > 0
                      ? Math.round((compliant / (overview?.total_sessions ?? 1)) * 100)
                      : 0}%
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "#16A34A" }}>sessions claim-ready</p>
                </div>
              </div>

              {nonCompliant > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                  style={{ background: `${CORAL}08`, border: `1px solid ${CORAL}25` }}>
                  <Lightbulb size={14} className="shrink-0 mt-0.5" style={{ color: CORAL }} />
                  <p className="text-[12px] leading-relaxed" style={{ color: T2 }}>
                    Fixing {nonCompliant} session{nonCompliant > 1 ? "s" : ""} could recover up to
                    ${Number(estimatedLostRevenue).toLocaleString()} in at-risk claims.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Audit log table ── */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>

        {/* Table header */}
        <div className="flex items-center justify-between gap-4 flex-wrap px-6 py-4 border-b"
          style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div>
            <h2 className="text-[17px] font-semibold" style={{ color: T1 }}>Session Audit Log</h2>
            <p className="text-[12px] mt-0.5" style={{ color: T3 }}>
              {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={13} style={{ color: T3 }} />
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as ClaimStatus)}>
              <SelectTrigger className="h-8 w-44 text-[12px] rounded-xl" style={{ borderColor: BORDER }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="compliant">Compliant</SelectItem>
                <SelectItem value="at_risk">At Risk</SelectItem>
                <SelectItem value="non_compliant">Non-Compliant</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table body */}
        {reportLoading ? (
          <div className="p-6 space-y-3">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2" style={{ color: T3 }}>
            <ShieldCheck size={28} style={{ opacity: 0.25 }} />
            <p className="text-[13px] font-medium">No sessions match this filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ background: "rgba(246,244,251,0.7)", borderBottom: `1px solid rgba(232,213,232,0.4)` }}>
                  {["Date", "Participant", "Session", "Score", "Status", "Checks", ""].map(h => (
                    <th key={h} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-widest"
                      style={{ color: T3 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "rgba(232,213,232,0.3)" }}>
                {filteredSessions.map(item => {
                  const score  = Number(item.compliance_score ?? 0);
                  const status = (item.compliance_status as string) ?? "draft";
                  let dateStr = "—";
                  if (item.session_date) {
                    try { dateStr = format(parseISO(String(item.session_date)), "MMM d, yyyy"); } catch {}
                  }
                  return (
                    <tr key={String(item.session_id)} className="transition-colors duration-150 hover:bg-[#F6F4FB]/50">
                      <td className="px-5 py-3.5 text-[13px] font-medium whitespace-nowrap" style={{ color: T2 }}>{dateStr}</td>
                      <td className="px-5 py-3.5 text-[13px] max-w-[120px] truncate" style={{ color: T2 }}>
                        {String(item.participant_name ?? "—")}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] max-w-[100px] truncate" style={{ color: T3 }}>
                        {String(item.session_type ?? "—")}
                      </td>
                      <td className="px-5 py-3.5">
                        {item.compliance_score != null ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[13px] font-bold" style={{ color: scoreColor(score) }}>
                              {score.toFixed(0)}%
                            </span>
                            <div className="h-1 w-12 rounded-full overflow-hidden" style={{ background: "rgba(232,213,232,0.5)" }}>
                              <div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score) }} />
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: T3 }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={status} /></td>
                      <td className="px-5 py-3.5">
                        <div className="flex gap-1.5">
                          {item.checks ? (
                            <>
                              <Check pass={!!item.checks.notes_present} />
                              <Check pass={!!item.checks.duration_recorded} />
                              <Check pass={!!item.checks.goals_linked} warn />
                            </>
                          ) : (
                            <>
                              <Check pass={(item.notes_length ?? 0) > 50} />
                              <Check pass={!!item.goals_linked} warn />
                              <Check pass={(item.duration_minutes ?? 0) > 0} />
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/sessions/${String(item.session_id)}`}>
                          <button className="text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors duration-150 hover:bg-[#F6F4FB]"
                            style={{ color: CORAL }}>
                            Review →
                          </button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
