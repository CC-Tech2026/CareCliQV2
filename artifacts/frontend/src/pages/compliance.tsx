import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetComplianceOverview, useGetComplianceReport } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  dismissCoordinatorPattern,
  getCoordinatorAiDetectedPatterns,
  type AiDetectedPattern,
} from "@/services/coordinatorService";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, FileCheck2, Info, TrendingUp,
  XCircle, CheckCircle2, DollarSign, BarChart3, Filter, Lightbulb, Sparkles, X,
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
  budget_warnings?: BudgetRuleAlert[];
  sessions?: ExtendedReportItem[];
}
interface BudgetRuleAlert {
  session_id?: string;
  participant_id?: string;
  participant_name?: string;
  session_date?: string;
  rule: string;
  status?: string;
  severity?: string;
  message?: string;
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

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string; label: string }> = {
    compliant:     { color: "#16A34A", bg: "rgba(22,163,74,0.08)",    label: "Compliant"     },
    at_risk:       { color: "#D97706", bg: "rgba(245,158,11,0.08)",   label: "At Risk"       },
    non_compliant: { color: "#DC2626", bg: "rgba(239,68,68,0.08)",    label: "Non-Compliant" },
    draft:         { color: T3,        bg: `rgba(84,34,105,0.06)`,    label: "Draft"         },
  };
  const c = cfg[status] ?? cfg.draft;
  return (
    <span className="inline-flex items-center justify-center text-[11px] font-bold px-2.5 h-5 rounded-full leading-none"
      style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

// Derives which severity tier caused a session's compliance flag.
// non_compliant + incomplete session = hard-blocked by a Block-tier rule.
// at_risk + completed session = worker acknowledged Warn-tier rules.
// at_risk + incomplete = flagged, not yet submitted.
function TierChip({ complianceStatus, sessionStatus }: { complianceStatus: string; sessionStatus?: string }) {
  if (complianceStatus === "non_compliant" && sessionStatus !== "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 h-4 rounded-full leading-none"
        style={{ background: "rgba(239,68,68,0.10)", color: "#DC2626" }}>
        Blocked
      </span>
    );
  }
  if (complianceStatus === "at_risk" && sessionStatus === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 h-4 rounded-full leading-none"
        style={{ background: "rgba(245,158,11,0.10)", color: "#D97706" }}>
        Warned
      </span>
    );
  }
  return null;
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

function Check({ pass, warn = false }: { pass: boolean; warn?: boolean }) {
  if (pass) return <ShieldCheck size={15} style={{ color: "#16A34A" }} className="shrink-0" />;
  if (warn) return <AlertTriangle size={15} style={{ color: "#D97706" }} className="shrink-0" />;
  return <ShieldAlert size={15} style={{ color: "#DC2626" }} className="shrink-0" />;
}

// ── Page Component ────────────────────────────────────────────────────────────
export default function Compliance() {
  const queryClient = useQueryClient();
  const { data: rawOverview, isLoading: overviewLoading } = useGetComplianceOverview();
  const { data: rawReport,   isLoading: reportLoading   } = useGetComplianceReport();
  const { data: patternsData, isLoading: patternsLoading } = useOrgQuery(
    ["coordinator", "ai-detected-patterns"],
    { queryFn: getCoordinatorAiDetectedPatterns },
  );
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClaimStatus>("all");

  const aiPatterns = patternsData?.patterns ?? [];

  const handleDismissPattern = async (patternId: string) => {
    setDismissingId(patternId);
    try {
      await dismissCoordinatorPattern(patternId);
      await queryClient.invalidateQueries({ queryKey: ["coordinator", "ai-detected-patterns"] });
      await queryClient.invalidateQueries({ queryKey: ["coordinator", "compliance-overview"] });
    } finally {
      setDismissingId(null);
    }
  };

  const patternTypeLabel = (type: AiDetectedPattern["pattern_type"]) => {
    if (type === "low_compliance_pair") return "Coaching need";
    if (type === "incident_escalation") return "Incident escalation";
    return "Behaviour support";
  };

  const overview    = rawOverview as unknown as ExtendedComplianceOverview | undefined;
  const reportItems = (rawReport  as unknown as ExtendedReportItem[] | undefined) ?? [];

  const filteredSessions = useMemo(
    () => statusFilter === "all" ? reportItems : reportItems.filter(s => s.compliance_status === statusFilter),
    [reportItems, statusFilter],
  );
  const failingRules = useMemo(() => aggregateFailingRules(reportItems), [reportItems]);
  const budgetWarnings = useMemo(
    () => (overview?.budget_warnings ?? []).filter(w => w.rule === "budget_warning" || w.rule === "budget_exceeded"),
    [overview?.budget_warnings],
  );

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
    <div className="flex flex-col gap-6 max-w-5xl mx-auto p-4 md:p-8 selection:bg-[#542269]/10 h-full">

      {/* ── Header Area ── */}
      <div className="flex items-start gap-3.5 border-b border-purple-100 pb-4">
        <div className="mt-1 h-7 w-1 rounded-full shrink-0" style={{ background: PLUM }} />
        <div className="flex flex-col justify-center">
          <h1 className="text-[24px] font-black tracking-tight leading-none" style={{ color: T1 }}>
            Compliance Centre
          </h1>
          <p className="text-[13px] mt-2 font-medium tracking-wide leading-none" style={{ color: T2 }}>
            Monitor NDIS documentation compliance, claim readiness, and audit preparedness.
          </p>
        </div>
      </div>

      {/* ── Analytical Gauge & Performance Cards ── */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 shrink-0">

        {/* Gauge Card Metrics */}
        <div className="bg-white rounded-2xl p-5 flex flex-col items-center justify-between min-h-[196px] text-center"
          style={{ boxShadow: CARD_SHADOW }}>
          <p className="text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: T3 }}>
            Overall Score
          </p>
          {overviewLoading ? (
            <Skeleton className="h-[114px] w-[114px] rounded-full my-1" />
          ) : (
            <div className="relative flex items-center justify-center my-1">
              <svg width="114" height="114" className="-rotate-90" viewBox="0 0 144 144">
                <circle cx="72" cy="72" r="60" stroke="rgba(232,213,232,0.4)" strokeWidth="12" fill="none" />
                <circle
                  cx="72" cy="72" r="60" stroke={arcColor} strokeWidth="12" fill="none"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - avg / 100)}
                  strokeLinecap="round" className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center balance-text">
                <span className="text-[28px] font-black tracking-tight leading-none" style={{ color: T1 }}>
                  {Math.round(avg)}
                </span>
                <span className="text-[10px] font-bold mt-1 opacity-60 leading-none" style={{ color: T3 }}>
                  / 100
                </span>
              </div>
            </div>
          )}
          <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: T3 }}>
            <TrendingUp size={13} style={{ color: CORAL }} /> NDIS Audit Score
          </p>
        </div>

        {/* Three Stat Cards & Dynamic Compliance Warning Bar */}
        <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 flex flex-col justify-between" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: "#16A34A" }}>
              <FileCheck2 size={13} /> Compliant
            </p>
            <div className="mt-4">
              {overviewLoading ? <Skeleton className="h-8 w-16" /> : (
                <p className="text-[32px] font-black tracking-tight leading-none" style={{ color: T1 }}>{compliant}</p>
              )}
              <p className="text-[11px] font-semibold mt-2 leading-none" style={{ color: T3 }}>Score &ge; 85%</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 flex flex-col justify-between" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: "#D97706" }}>
              <AlertTriangle size={13} /> At Risk
            </p>
            <div className="mt-4">
              {overviewLoading ? <Skeleton className="h-8 w-16" /> : (
                <p className="text-[32px] font-black tracking-tight leading-none" style={{ color: T1 }}>{atRisk}</p>
              )}
              <p className="text-[11px] font-semibold mt-2 leading-none" style={{ color: T3 }}>Score 60&ndash;84%</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 flex flex-col justify-between" style={{ boxShadow: CARD_SHADOW }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: "#DC2626" }}>
              <XCircle size={13} /> Non-Compliant
            </p>
            <div className="mt-4">
              {overviewLoading ? <Skeleton className="h-8 w-16" /> : (
                <p className="text-[32px] font-black tracking-tight leading-none" style={{ color: T1 }}>{nonCompliant}</p>
              )}
              <p className="text-[11px] font-semibold mt-2 leading-none" style={{ color: T3 }}>Score &lt; 60%</p>
            </div>
          </div>

          {/* Guidelines info text footer bar */}
          <div className="sm:col-span-3 rounded-2xl px-4 py-3.5 flex items-start gap-3"
            style={{ background: `${PLUM}05`, border: `1px solid rgba(84,34,105,0.08)` }}>
            <Info size={15} className="shrink-0 mt-0.5" style={{ color: PLUM }} />
            <p className="text-[12px] leading-relaxed font-medium" style={{ color: T2 }}>
              NDIS audit readiness requires an operational threshold score of 85%+. Sessions designated as at-risk are subject to external system rejections during regular automated processing routines.
            </p>
          </div>
        </div>
      </div>

      {/* ── Issue Tracking and Revenue Insights Row ── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 shrink-0">

        {/* Documentation Failures & Progress Tracks */}
        <div className="bg-white rounded-2xl p-5 flex flex-col" style={{ boxShadow: CARD_SHADOW }}>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={15} style={{ color: T3 }} />
            <h2 className="text-[15px] font-bold tracking-tight" style={{ color: T1 }}>Most Common Issues</h2>
          </div>
          <p className="text-[12px] font-medium mb-4" style={{ color: T3 }}>Top documentation gaps across current sessions</p>

          <div className="flex-1 flex flex-col justify-center">
            {reportLoading ? (
              <div className="space-y-3.5">
                {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-xl" />)}
              </div>
            ) : failingRules.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl px-4 py-3 bg-green-50/50 border border-green-100 text-[#16A34A]">
                <CheckCircle2 size={15} />
                <span className="text-[13px] font-bold">Excellent documentation compliance!</span>
              </div>
            ) : (
              <div className="space-y-3.5">
                {failingRules.map(([rule, count], i) => {
                  const total = reportItems.length || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between items-center text-[13px]">
                        <span className="font-semibold truncate max-w-[70%]" style={{ color: T2 }}>{rule}</span>
                        <span className="font-bold shrink-0" style={{ color: pct >= 50 ? "#DC2626" : "#D97706" }}>
                          {count} session{count > 1 ? "s" : ""}
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        className={`h-1.5 rounded-full ${pct >= 50 ? "[&>div]:bg-red-500" : "[&>div]:bg-amber-500"}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Financial Risk Auditing */}
        <div className="bg-white rounded-2xl p-5 flex flex-col justify-between" style={{ boxShadow: CARD_SHADOW }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={15} style={{ color: T3 }} />
              <h2 className="text-[15px] font-bold tracking-tight" style={{ color: T1 }}>Budget Impact</h2>
            </div>
            <p className="text-[12px] font-medium mb-4" style={{ color: T3 }}>Financial exposures resulting from non-compliant logs</p>
          </div>

          {overviewLoading ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3.5 bg-red-50/40 border border-red-100/70">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#DC2626" }}>
                    At-Risk Revenue
                  </p>
                  <p className="text-[20px] font-black tracking-tight leading-none" style={{ color: T1 }}>
                    ${Number(estimatedLostRevenue).toLocaleString()}
                  </p>
                  <p className="text-[11px] font-semibold mt-1.5 leading-none" style={{ color: "#DC2626" }}>
                    from {nonCompliant} log{nonCompliant !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="rounded-xl p-3.5 bg-green-50/40 border border-green-100/70">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#16A34A" }}>
                    Claim Readiness
                  </p>
                  <p className="text-[20px] font-black tracking-tight leading-none" style={{ color: T1 }}>
                    {(overview?.total_sessions ?? 0) > 0
                      ? Math.round((compliant / (overview?.total_sessions ?? 1)) * 100)
                      : 0}%
                  </p>
                  <p className="text-[11px] font-semibold mt-1.5 leading-none" style={{ color: "#16A34A" }}>
                    sessions secure
                  </p>
                </div>
              </div>

              {budgetWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-100/80 bg-amber-50/30 p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#D97706" }}>
                    NDIS Plan Budget Advisories
                  </p>
                  {budgetWarnings.slice(0, 4).map((w, i) => (
                    <div key={`${w.session_id}-${w.rule}-${i}`} className="text-[12px] leading-snug" style={{ color: T2 }}>
                      <span className="font-bold">{w.participant_name ?? "Participant"}</span>
                      {w.session_date ? (() => {
                        try { return ` · ${format(parseISO(String(w.session_date)), "MMM d, yyyy")}`; }
                        catch { return ` · ${w.session_date}`; }
                      })() : ""}
                      <p className="mt-0.5 font-medium" style={{ color: w.rule === "budget_exceeded" ? "#DC2626" : "#D97706" }}>
                        {w.message}
                      </p>
                    </div>
                  ))}
                  {budgetWarnings.length > 4 && (
                    <p className="text-[11px] font-semibold" style={{ color: T3 }}>
                      +{budgetWarnings.length - 4} more budget advisory{budgetWarnings.length - 4 !== 1 ? "ies" : ""}
                    </p>
                  )}
                </div>
              )}

              {nonCompliant > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 bg-amber-50/40 border border-amber-100/70">
                  <Lightbulb size={14} className="shrink-0 mt-0.5" style={{ color: CORAL }} />
                  <p className="text-[12px] font-medium leading-normal" style={{ color: T2 }}>
                    Amending the <span className="font-bold">{nonCompliant} non-compliant</span> files listed below can re-stabilize up to ${Number(estimatedLostRevenue).toLocaleString()} in pending claims.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Detected Patterns — CARECLIQV2-34 */}
      <div className="bg-white rounded-2xl p-5 shrink-0" style={{ boxShadow: CARD_SHADOW }}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={15} style={{ color: PLUM }} />
          <h2 className="text-[15px] font-bold tracking-tight" style={{ color: T1 }}>AI Detected Patterns</h2>
        </div>
        <p className="text-[12px] font-medium mb-4" style={{ color: T3 }}>
          Cross-session risk patterns from weekly org analysis — dismiss when reviewed
        </p>

        {patternsLoading ? (
          <div className="space-y-2">
            {Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : aiPatterns.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl px-4 py-3 bg-slate-50/80 border border-slate-100 text-[13px]" style={{ color: T3 }}>
            <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
            <span className="font-medium">No active patterns detected for your organisation.</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {aiPatterns.map((pattern) => {
              const isHigh = pattern.severity === "high";
              return (
                <div
                  key={pattern.id}
                  className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3"
                  style={{
                    borderColor: isHigh ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)",
                    background: isHigh ? "rgba(254,242,242,0.5)" : "rgba(255,251,235,0.5)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{
                          color: isHigh ? "#DC2626" : "#D97706",
                          background: isHigh ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                        }}
                      >
                        {patternTypeLabel(pattern.pattern_type)}
                      </span>
                      <span className="text-[13px] font-bold truncate" style={{ color: T1 }}>
                        {pattern.title}
                      </span>
                    </div>
                    <p className="text-[12px] font-medium leading-snug" style={{ color: T2 }}>
                      {pattern.message}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-8 px-2 text-[11px] font-bold"
                    disabled={dismissingId === pattern.id}
                    onClick={() => handleDismissPattern(pattern.id)}
                  >
                    {dismissingId === pattern.id ? "…" : (
                      <>
                        <X size={12} className="mr-1" />
                        Dismiss
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Audit Table Records Panel ── */}
      <div className="bg-white rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0 border" style={{ boxShadow: CARD_SHADOW, borderColor: BORDER }}>

        {/* Structured Header Controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-3.5 border-b shrink-0 bg-slate-50/40"
          style={{ borderColor: "rgba(232,213,232,0.4)" }}>
          <div className="flex flex-col justify-center">
            <h2 className="text-[16px] font-bold tracking-tight" style={{ color: T1 }}>Session Audit Log</h2>
            <p className="text-[12px] font-semibold mt-1 leading-none" style={{ color: T3 }}>
              {filteredSessions.length} total file entry{filteredSessions.length !== 1 ? "s" : ""} identified
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={13} style={{ color: T3 }} />
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as ClaimStatus)}>
              <SelectTrigger className="h-9 w-44 text-[13px] rounded-xl font-medium shadow-sm bg-white" style={{ borderColor: BORDER, color: T2 }}>
                <SelectValue placeholder="Filter profile type" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-[13px]">All Sessions</SelectItem>
                <SelectItem value="compliant" className="text-[13px]">Compliant Only</SelectItem>
                <SelectItem value="at_risk" className="text-[13px]">At Risk Profile</SelectItem>
                <SelectItem value="non_compliant" className="text-[13px]">Non-Compliant Logs</SelectItem>
                <SelectItem value="draft" className="text-[13px]">Draft Records</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Main Database Table Container */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {reportLoading ? (
            <div className="p-5 space-y-3">
              {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-center" style={{ color: T3 }}>
              <ShieldCheck size={28} className="opacity-30 mb-1" />
              <p className="text-[14px] font-bold" style={{ color: T1 }}>No corresponding logs matching</p>
              <p className="text-[12px] max-w-xs -mt-1 leading-normal">Modify the filtering configuration or add an authorization record tracking script.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50/70" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                      {["Date", "Participant", "Session Type", "Compliance Score", "Status", "Checks Checkbox", ""].map((h, i) => (
                        <th key={i} className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: T3 }}>
                          {h.split(" ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "rgba(232,213,232,0.2)" }}>
                    {filteredSessions.map(item => {
                    const score  = Number(item.compliance_score ?? 0);
                    const status = (item.compliance_status as string) ?? "draft";
                    let dateStr = "—";
                    if (item.session_date) {
                      try { dateStr = format(parseISO(String(item.session_date)), "MMM d, yyyy"); } catch {}
                    }
                    return (
                      <tr key={String(item.session_id)} className="transition-colors duration-150 hover:bg-[#F6F4FB]/30 group">
                        <td className="px-5 py-3.5 text-[13px] font-semibold whitespace-nowrap" style={{ color: T2 }}>{dateStr}</td>
                        <td className="px-5 py-3.5 text-[13px] font-medium max-w-[140px] truncate" style={{ color: T1 }}>
                          {String(item.participant_name ?? "Unassigned Case")}
                        </td>
                        <td className="px-5 py-3.5 text-[12px] font-medium max-w-[120px] truncate" style={{ color: T3 }}>
                          {String(item.session_type ?? "—")}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {item.compliance_score != null ? (
                            <div className="flex flex-col gap-1.5 justify-center">
                              <span className="text-[13px] font-black leading-none" style={{ color: scoreColor(score) }}>
                                {score.toFixed(0)}%
                              </span>
                              <div className="h-1 w-14 rounded-full overflow-hidden bg-slate-100">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: scoreColor(score) }} />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[13px] font-medium" style={{ color: T3 }}>—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge status={status} />
                            <TierChip complianceStatus={status} sessionStatus={item.status} />
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2 h-5">
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
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <Link href={`/sessions/${String(item.session_id)}`}>
                            <button className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-transparent transition-all hover:bg-purple-50 hover:text-[#542269] active:scale-[0.97]"
                              style={{ color: CORAL }}>
                              Review &rarr;
                            </button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* Mobile Card View (sm, md only) */}
              <div className="md:hidden space-y-3">
                {filteredSessions.map(item => {
                  const score  = Number(item.compliance_score ?? 0);
                  const status = (item.compliance_status as string) ?? "draft";
                  let dateStr = "—";
                  if (item.session_date) {
                    try { dateStr = format(parseISO(String(item.session_date)), "MMM d, yyyy"); } catch {}
                  }
                  return (
                    <div key={String(item.session_id)} className="rounded-xl p-4 border transition-colors hover:bg-[#F6F4FB]" style={{ borderColor: "rgba(232,213,232,0.5)", background: "#fff" }}>
                      {/* Header: Date + Status */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: T3 }}>Date</p>
                          <p className="text-[13px] font-semibold mt-0.5" style={{ color: T2 }}>{dateStr}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <StatusBadge status={status} />
                          <TierChip complianceStatus={status} sessionStatus={item.status} />
                        </div>
                      </div>

                      {/* Participant */}
                      <div className="mb-3">
                        <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: T3 }}>Participant</p>
                        <p className="text-[13px] font-medium mt-0.5 line-clamp-2" style={{ color: T1 }}>
                          {String(item.participant_name ?? "Unassigned Case")}
                        </p>
                      </div>

                      {/* Session Type */}
                      <div className="mb-3">
                        <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: T3 }}>Session Type</p>
                        <p className="text-[12px] font-medium mt-0.5" style={{ color: T3 }}>
                          {String(item.session_type ?? "—")}
                        </p>
                      </div>

                      {/* Compliance Score */}
                      <div className="mb-3 pb-3 border-b" style={{ borderColor: "rgba(232,213,232,0.3)" }}>
                        <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: T3 }}>Compliance Score</p>
                        <div className="mt-1.5 flex items-baseline gap-3">
                          {item.compliance_score != null ? (
                            <>
                              <span className="text-[24px] font-black leading-none" style={{ color: scoreColor(score) }}>
                                {score.toFixed(0)}%
                              </span>
                              <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-100">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: scoreColor(score) }} />
                              </div>
                            </>
                          ) : (
                            <span className="text-[13px] font-medium" style={{ color: T3 }}>—</span>
                          )}
                        </div>
                      </div>

                      {/* Checks */}
                      <div className="mb-3">
                        <p className="text-[11px] font-black uppercase tracking-wider mb-1.5" style={{ color: T3 }}>Compliance Checks</p>
                        <div className="flex items-center gap-3">
                          {item.checks ? (
                            <>
                              <div className="flex items-center gap-1"><Check pass={!!item.checks.notes_present} /><span className="text-[11px]" style={{ color: T3 }}>Notes</span></div>
                              <div className="flex items-center gap-1"><Check pass={!!item.checks.duration_recorded} /><span className="text-[11px]" style={{ color: T3 }}>Duration</span></div>
                              <div className="flex items-center gap-1"><Check pass={!!item.checks.goals_linked} warn /><span className="text-[11px]" style={{ color: T3 }}>Goals</span></div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-1"><Check pass={(item.notes_length ?? 0) > 50} /><span className="text-[11px]" style={{ color: T3 }}>Notes</span></div>
                              <div className="flex items-center gap-1"><Check pass={!!item.goals_linked} warn /><span className="text-[11px]" style={{ color: T3 }}>Goals</span></div>
                              <div className="flex items-center gap-1"><Check pass={(item.duration_minutes ?? 0) > 0} /><span className="text-[11px]" style={{ color: T3 }}>Duration</span></div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Button */}
                      <Link href={`/sessions/${String(item.session_id)}`}>
                        <button className="w-full text-[13px] font-bold py-2 rounded-lg border transition-all hover:bg-purple-50" style={{ color: CORAL, borderColor: CORAL }}>
                          Review Session &rarr;
                        </button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}