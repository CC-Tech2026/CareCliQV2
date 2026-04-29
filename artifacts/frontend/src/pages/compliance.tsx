import { useState, useMemo } from "react";
import { useGetComplianceOverview, useGetComplianceReport } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, FileCheck2, Info, TrendingUp,
  XCircle, CheckCircle2, DollarSign, BarChart3, Filter, Lightbulb,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Extended types (backend returns extra fields beyond the OpenAPI spec)
// ---------------------------------------------------------------------------

interface ExtendedComplianceOverview {
  average_score: number;
  total_sessions: number;
  compliant: number;
  at_risk: number;
  non_compliant: number;
  sessions?: ExtendedReportItem[];
}

interface ExtendedReportItem {
  session_id: string;
  participant_name: string;
  session_date: string;
  session_type: string;
  compliance_score?: number | null;
  compliance_status?: string;
  goals_linked?: boolean;
  notes_length?: number;
  duration_minutes?: number;
  status?: string;
  checks?: {
    notes_present?: boolean;
    duration_recorded?: boolean;
    goals_linked?: boolean;
    session_type_set?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type ClaimStatus = "all" | "compliant" | "at_risk" | "non_compliant" | "draft";

const STATUS_CONFIG: Record<string, { label: string; badgeCls: string; icon: typeof ShieldCheck }> = {
  compliant: { label: "Compliant", badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  at_risk: { label: "At Risk", badgeCls: "bg-amber-100 text-amber-800 border-amber-200", icon: AlertTriangle },
  non_compliant: { label: "Non-Compliant", badgeCls: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
  draft: { label: "Draft", badgeCls: "bg-slate-100 text-slate-600 border-slate-200", icon: ShieldAlert },
};

function getScoreColor(score: number) {
  if (score >= 85) return "text-emerald-600";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

function getScoreProgressCls(score: number) {
  if (score >= 85) return "[&>div]:bg-emerald-500";
  if (score >= 60) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-red-500";
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${cfg.badgeCls}`}>
      <cfg.icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// Aggregate the most common failing rules across sessions
function aggregateFailingRules(sessions: ExtendedReportItem[]) {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    const score = s.compliance_score ?? 100;
    if (score < 85) {
      if (!s.goals_linked) counts["Goals not linked to NDIS plan"] = (counts["Goals not linked to NDIS plan"] || 0) + 1;
      if (!s.notes_length || s.notes_length < 50) counts["Insufficient clinical notes"] = (counts["Insufficient clinical notes"] || 0) + 1;
      if (!s.duration_minutes) counts["Duration not recorded"] = (counts["Duration not recorded"] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Compliance page
// ---------------------------------------------------------------------------

export default function Compliance() {
  const { data: rawOverview, isLoading: overviewLoading } = useGetComplianceOverview();
  const { data: rawReport, isLoading: reportLoading } = useGetComplianceReport();
  const [statusFilter, setStatusFilter] = useState<ClaimStatus>("all");

  // Cast to extended types to access the extra fields the backend returns
  const overview = rawOverview as unknown as ExtendedComplianceOverview | undefined;
  const reportItems = (rawReport as unknown as ExtendedReportItem[] | undefined) ?? [];

  const filteredSessions = useMemo(() => {
    if (statusFilter === "all") return reportItems;
    return reportItems.filter(s => s.compliance_status === statusFilter);
  }, [reportItems, statusFilter]);

  const failingRules = useMemo(() => aggregateFailingRules(reportItems), [reportItems]);

  // Estimate budget impact of non-compliant sessions (approx $67.56/hr base rate)
  const estimatedLostRevenue = useMemo(() => {
    const nonCompSessions = reportItems.filter(s => s.compliance_status === "non_compliant");
    const totalMins = nonCompSessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    return ((totalMins / 60) * 67.56).toFixed(0);
  }, [reportItems]);

  const avg = overview?.average_score ?? 0;
  const compliant = overview?.compliant ?? 0;
  const atRisk = overview?.at_risk ?? 0;
  const nonCompliant = overview?.non_compliant ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance Centre</h1>
        <p className="text-slate-500 dark:text-slate-400">
          Monitor NDIS documentation compliance, claim readiness, and audit preparedness.
        </p>
      </div>

      {/* Top stat cards */}
      <div className="grid gap-4 md:grid-cols-4">

        {/* Large gauge */}
        <Card className="md:col-span-1 border-slate-200 shadow-sm flex flex-col items-center py-6">
          <CardHeader className="text-center pb-1 w-full px-4">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overall Score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center pt-0">
            {overviewLoading ? (
              <Skeleton className="h-32 w-32 rounded-full" />
            ) : (
              <div className="relative flex items-center justify-center mt-2 mb-2">
                <svg className="w-36 h-36 transform -rotate-90" viewBox="0 0 144 144">
                  <circle cx="72" cy="72" r="60" stroke="currentColor" strokeWidth="14" fill="transparent" className="text-slate-100 dark:text-slate-800" />
                  <circle
                    cx="72" cy="72" r="60"
                    stroke="currentColor"
                    strokeWidth="14"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 60}
                    strokeDashoffset={2 * Math.PI * 60 * (1 - avg / 100)}
                    className={getScoreColor(avg)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className={`text-4xl font-bold ${getScoreColor(avg)}`}>{Math.round(avg)}</span>
                  <span className="text-[10px] text-slate-400 font-medium">/ 100</span>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> NDIS Audit Score
            </p>
          </CardContent>
        </Card>

        {/* Stat cards grid */}
        <div className="md:col-span-3 grid grid-cols-3 gap-4">
          <Card className="shadow-sm border-emerald-100 bg-emerald-50/30">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                <FileCheck2 className="h-4 w-4" /> Compliant
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {overviewLoading ? <Skeleton className="h-10 w-16" /> : (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold text-emerald-700">{compliant}</span>
                  <span className="text-xs text-slate-400">sessions</span>
                </div>
              )}
              <p className="text-[10px] text-emerald-600 mt-1">Score ≥ 85%</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-amber-100 bg-amber-50/30">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> At Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {overviewLoading ? <Skeleton className="h-10 w-16" /> : (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold text-amber-700">{atRisk}</span>
                  <span className="text-xs text-slate-400">sessions</span>
                </div>
              )}
              <p className="text-[10px] text-amber-600 mt-1">Score 60–84%</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-red-100 bg-red-50/30">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-red-700 flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> Non-Compliant
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {overviewLoading ? <Skeleton className="h-10 w-16" /> : (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold text-red-700">{nonCompliant}</span>
                  <span className="text-xs text-slate-400">sessions</span>
                </div>
              )}
              <p className="text-[10px] text-red-600 mt-1">Score &lt; 60%</p>
            </CardContent>
          </Card>

          {/* NDIS readiness note */}
          <Card className="shadow-sm col-span-3 bg-slate-50 dark:bg-slate-900/50">
            <CardContent className="p-3 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                NDIS audit readiness requires a score of 85%+. Sessions at risk may be rejected during claim processing. 
                Ensure all sessions include dated notes, measurable outcomes, and links to participant goals.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Middle row — Issues + Budget Impact */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Common failing rules */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-500" /> Most Common Issues
            </CardTitle>
            <CardDescription className="text-xs">Top documentation gaps across sessions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportLoading ? (
              Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : failingRules.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                <CheckCircle2 className="h-4 w-4" />
                No common issues detected — great compliance!
              </div>
            ) : (
              failingRules.map(([rule, count], i) => {
                const total = reportItems.length || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-700 font-medium">{rule}</span>
                      <span className={`font-semibold ${pct >= 50 ? "text-red-600" : "text-amber-600"}`}>
                        {count} session{count > 1 ? "s" : ""}
                      </span>
                    </div>
                    <Progress value={pct} className={`h-1.5 ${pct >= 50 ? "[&>div]:bg-red-400" : "[&>div]:bg-amber-400"}`} />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Budget Impact */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-slate-500" /> Budget Impact
            </CardTitle>
            <CardDescription className="text-xs">Financial risk from non-compliant sessions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {overviewLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wide mb-1">At-Risk Revenue</p>
                    <p className="text-xl font-bold text-red-700">${Number(estimatedLostRevenue).toLocaleString()}</p>
                    <p className="text-[10px] text-red-500 mt-0.5">est. from {nonCompliant} session{nonCompliant !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-1">Claim Rate</p>
                    <p className="text-xl font-bold text-emerald-700">
                      {(overview?.total_sessions ?? 0) > 0
                        ? Math.round((compliant / (overview?.total_sessions ?? 1)) * 100)
                        : 0}%
                    </p>
                    <p className="text-[10px] text-emerald-500 mt-0.5">sessions claim-ready</p>
                  </div>
                </div>

                {nonCompliant > 0 && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-800">
                    <Lightbulb className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Review non-compliant sessions and add missing notes or goal links. Fixing {nonCompliant} session{nonCompliant > 1 ? "s" : ""} could recover up to ${Number(estimatedLostRevenue).toLocaleString()} in at-risk claims.
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Session Audit Log */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">Session Audit Log</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Compliance breakdown by session — {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ClaimStatus)}>
                <SelectTrigger className="h-8 w-44 text-sm">
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
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="space-y-3">
              {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-10 text-slate-400 border border-dashed border-slate-200 rounded-lg">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sessions match this filter</p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Participant</TableHead>
                    <TableHead className="text-xs">Session</TableHead>
                    <TableHead className="text-center text-xs">Score</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Checks</TableHead>
                    <TableHead className="text-right text-xs">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.map((item) => {
                    const score = Number(item.compliance_score ?? 0);
                    const status = (item.compliance_status as string) ?? "draft";
                    return (
                      <TableRow key={String(item.session_id)} className="hover:bg-slate-50/50">
                        <TableCell className="text-xs font-medium whitespace-nowrap py-3">
                          {item.session_date
                            ? (() => {
                                try { return format(parseISO(String(item.session_date)), "MMM d, yyyy"); }
                                catch { return String(item.session_date); }
                              })()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-[120px] truncate">
                          {String(item.participant_name ?? "—")}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[100px] truncate">
                          {String(item.session_type ?? "—")}
                        </TableCell>
                        <TableCell className="text-center py-3">
                          {item.compliance_score != null ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className={`text-sm font-bold ${getScoreColor(score)}`}>
                                {score.toFixed(0)}%
                              </span>
                              <Progress
                                value={score}
                                className={`h-1 w-12 ${getScoreProgressCls(score)}`}
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <StatusBadge status={status} />
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex gap-1">
                            {item.checks ? (
                              <>
                                {item.checks.notes_present
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Notes present" />
                                  : <ShieldAlert className="h-4 w-4 text-red-500" aria-label="Missing notes" />}
                                {item.checks.duration_recorded
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Duration recorded" />
                                  : <ShieldAlert className="h-4 w-4 text-red-500" aria-label="Missing duration" />}
                                {item.checks.goals_linked
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Goals linked" />
                                  : <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Missing goals" />}
                              </>
                            ) : (
                              <>
                                {(item.notes_length ?? 0) > 50
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Notes" />
                                  : <ShieldAlert className="h-4 w-4 text-red-500" aria-label="Notes too short" />}
                                {item.goals_linked
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Goals" />
                                  : <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Goals" />}
                                {(item.duration_minutes ?? 0) > 0
                                  ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Duration" />
                                  : <ShieldAlert className="h-4 w-4 text-red-500" aria-label="No duration" />}
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right py-3">
                          <Link href={`/sessions/${String(item.session_id)}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary">
                              Review
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
