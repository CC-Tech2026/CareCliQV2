import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { format, parseISO, differenceInDays, isAfter, subDays } from "date-fns";
import {
  useGetSessions, useGetParticipants, useGetUnreadAlerts,
  useGetComplianceOverview,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiFetch as authenticatedFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";
import { useToast } from "@/hooks/use-toast";
import { TranslationAuditView } from "@/components/TranslationAuditView";
import { useReAuth } from "@/hooks/useReAuth";
import {
  LayoutDashboard, FileText, AlertTriangle, Users, ShieldCheck,
  ShieldAlert, Brain, FileDown, Layout, BookOpen,
  CheckCircle2, XCircle, Clock, ArrowRight, Plus,
  Download, FileBarChart2, Siren, TrendingUp,
  ChevronRight, Sparkles, Target, Search, Filter,
  ClipboardList, Lightbulb, Star,
} from "lucide-react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const PLUM_SUBTLE = "var(--cc-plum-subtle)";
const PLUM_MEDIUM = "var(--cc-plum-medium)";
const T1     = "var(--cc-text)";
const T2     = "var(--cc-muted)";
const T3     = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const CARD   = "0 1px 4px color-mix(in srgb, var(--cc-plum) 6%, transparent), 0 0 0 1px var(--cc-border)";
const BG     = "#F7F5FC";

// ── Helpers ────────────────────────────────────────────────────────────────────
async function apiFetch<T = unknown>(path: string): Promise<T> {
  return jsonFetch<T>(`/api${path}`);
}

function scoreColor(s: number) {
  return s >= 85 ? "#16A34A" : s >= 60 ? "#D97706" : "#DC2626";
}
function scoreBg(s: number) {
  return s >= 85 ? "rgba(22,163,74,0.08)" : s >= 60 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";
}
function scoreLabel(s: number) {
  return s >= 85 ? "Compliant" : s >= 60 ? "At Risk" : "Non-Compliant";
}

function legalNoteText(s: any) {
  return (
    s?.translated_english_note ??
    s?.compliance_input_text ??
    s?.legal_record_text ??
    s?.notes ??
    ""
  );
}

function ComplianceBadge({ score }: { score?: number | null }) {
  if (score == null) return (
    <span className="inline-flex items-center text-[11px] font-bold px-2.5 h-5 rounded-full"
      style={{ background: "rgba(122,106,138,0.08)", color: T3 }}>Draft</span>
  );
  return (
    <span className="inline-flex items-center text-[11px] font-bold px-2.5 h-5 rounded-full"
      style={{ background: scoreBg(score), color: scoreColor(score) }}>{scoreLabel(score)} · {Math.round(score)}%</span>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const map: Record<string, [string, string]> = {
    low:      ["#16A34A", "rgba(22,163,74,0.08)"],
    medium:   ["#D97706", "rgba(245,158,11,0.08)"],
    high:     ["#EA580C", "rgba(234,88,12,0.08)"],
    critical: ["#DC2626", "rgba(239,68,68,0.08)"],
  };
  const [col, bg] = map[sev] ?? map.medium;
  return (
    <span className="inline-flex items-center text-[11px] font-bold px-2.5 h-5 rounded-full capitalize"
      style={{ background: bg, color: col }}>{sev}</span>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-cc-surface rounded-2xl overflow-hidden", className)}
      style={{ boxShadow: CARD }}>{children}</div>
  );
}
function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: BORDER }}>
      <h3 className="text-[14px] font-bold" style={{ color: T1 }}>{title}</h3>
      {action}
    </div>
  );
}
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <div className="p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}14` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[22px] font-black leading-none" style={{ color: T1 }}>{value}</p>
          <p className="text-[12px] font-medium mt-0.5 truncate" style={{ color: T3 }}>{label}</p>
        </div>
      </div>
    </Card>
  );
}
function EmptyState({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: PLUM_SUBTLE }}>
        <Icon size={22} style={{ color: PLUM }} />
      </div>
      <p className="text-[14px] font-bold" style={{ color: T1 }}>{title}</p>
      <p className="text-[12px] max-w-xs" style={{ color: T3 }}>{sub}</p>
    </div>
  );
}

function ClinicalReportGenerator() {
  const { data: participants = [] } = useGetParticipants();
  const { data: history = [], refetch } = useOrgQuery<any[]>(["report-history"], {
    queryFn: async () => {
      const response = await authenticatedFetch("/api/reports/history");
      if (!response.ok) throw new Error("Could not load report history");
      return response.json();
    },
  });
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const [participantId, setParticipantId] = useState("");
  const [reportType, setReportType] = useState("therapy_progress_report");
  const [busy, setBusy] = useState(false);

  async function generateReport() {
    if (!participantId) {
      toast({ title: "Select a participant", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const response = await requireReAuth(() => authenticatedFetch(`/api/reports/participant/${participantId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_type: reportType }),
      }));
      if (!response) return;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not generate report");
      toast({ title: "Report generated", description: payload.title });
      refetch();
      if (payload.file_url) window.open(payload.file_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Report generation failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {modal}
      <Card className="mb-6">
        <CardHeader title="Allied Health Report Generator" />
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: T3 }}>Participant</p>
            <select
              value={participantId}
              onChange={(event) => setParticipantId(event.target.value)}
              className="h-10 w-full rounded-xl border bg-cc-surface px-3 text-sm"
              style={{ borderColor: BORDER, color: T1 }}
            >
              <option value="">Select participant</option>
              {(participants as any[]).map((participant) => (
                <option key={participant.id} value={participant.id}>{participant.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: T3 }}>Report type</p>
            <select
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
              className="h-10 w-full rounded-xl border bg-cc-surface px-3 text-sm"
              style={{ borderColor: BORDER, color: T1 }}
            >
              <option value="functional_capacity_assessment">Functional Capacity Assessment</option>
              <option value="therapy_progress_report">Therapy Progress Report</option>
              <option value="assistive_technology_assessment">Assistive Technology Assessment</option>
              <option value="home_modification_report">Home Modification Report</option>
              <option value="goal_review_report">Goal Review Report</option>
              <option value="annual_review_report">Annual Review Report / RAG</option>
            </select>
          </div>
          <Button onClick={generateReport} disabled={busy || !participantId} className="gap-2 rounded-xl">
            {busy ? <Clock className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Generate PDF
          </Button>
        </div>
        <div className="border-t px-5 py-4" style={{ borderColor: BORDER }}>
          <p className="mb-3 text-[12px] font-bold uppercase tracking-wider" style={{ color: T3 }}>Saved report history</p>
          {history.length === 0 ? (
            <p className="text-[12px]" style={{ color: T3 }}>No generated reports yet.</p>
          ) : (
            <div className="grid gap-2">
              {history.slice(0, 5).map((report: any) => (
                <div key={report.id} className="flex items-center gap-3 rounded-xl bg-[#F7F5FC] px-3 py-2">
                  <FileText className="h-4 w-4" style={{ color: PLUM }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold" style={{ color: T1 }}>{report.title || report.report_type}</p>
                    <p className="text-[11px]" style={{ color: T3 }}>{report.created_at ? format(parseISO(report.created_at), "dd MMM yyyy") : "Saved"}</p>
                  </div>
                  {report.file_url && (
                    <a href={report.file_url} target="_blank" rel="noreferrer" className="text-[12px] font-bold" style={{ color: PLUM }}>
                      Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

// ── Tab definitions ────────────────────────────────────────────────────────────
const TABS = [
  { id: "hub",        label: "Documentation Hub",  icon: LayoutDashboard  },
  { id: "sessions",   label: "Session Reports",     icon: FileText         },
  { id: "incidents",  label: "Incident Reports",    icon: AlertTriangle    },
  { id: "notes",      label: "Participant Notes",   icon: BookOpen         },
  { id: "compliance", label: "Compliance Reports",  icon: ShieldCheck      },
  { id: "audit",      label: "Audit Readiness",     icon: ShieldAlert      },
  { id: "ai",         label: "AI Insights & Flags", icon: Brain            },
  { id: "templates",  label: "Templates & Forms",   icon: Layout           },
  { id: "export",     label: "Export Centre",       icon: FileDown         },
] as const;
type TabId = typeof TABS[number]["id"];

// ─────────────────────────────────────────────────────────────────────────────
// 1. DOCUMENTATION HUB
// ─────────────────────────────────────────────────────────────────────────────
function HubSection() {
  const { data: sessions = [] } = useGetSessions({ limit: 100 });
  const { data: alerts = [] }   = useGetUnreadAlerts();
  const { data: rawOv }         = useGetComplianceOverview();
  const { data: incidents = [] } = useOrgQuery<any[]>(["incidents"], { queryFn: () => apiFetch<any[]>("/incidents") });
  const { data: iStats }         = useOrgQuery<any>(["incident-stats"], { queryFn: () => apiFetch<any>("/incidents/stats") });

  const ov = rawOv as any;
  const now = new Date();
  const missingNotes = (sessions as any[]).filter(s =>
    s.status !== "in_progress" && s.status !== "cancelled" &&
    legalNoteText(s).length < 20 &&
    differenceInDays(now, parseISO(s.session_date)) <= 14
  );
  const auditRisks = (sessions as any[]).filter(s => s.compliance_score != null && s.compliance_score < 60);
  const recentActivity = [...(sessions as any[])]
    .sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Sessions needing notes"   value={missingNotes.length}      icon={FileText}      color={CORAL}     />
        <StatCard label="Audit risks detected"      value={auditRisks.length}         icon={ShieldAlert}   color="#DC2626"   />
        <StatCard label="Open incidents"            value={iStats?.open ?? (incidents.filter((i: any) => i.status !== "closed" && i.status !== "resolved").length)} icon={AlertTriangle} color="#D97706" />
        <StatCard label="Compliance score"          value={ov?.average_score != null ? `${Math.round(ov.average_score)}%` : "—"} icon={ShieldCheck} color="#16A34A" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Incomplete session notes */}
        <Card>
          <CardHeader title="Incomplete Session Notes"
            action={<Link href="/sessions"><span className="text-[12px] font-semibold cursor-pointer" style={{ color: PLUM }}>View all →</span></Link>} />
          {missingNotes.length === 0
            ? <EmptyState icon={CheckCircle2} title="All notes complete" sub="No sessions with missing documentation in the last 14 days." />
            : <div className="divide-y" style={{ borderColor: BORDER }}>
                {missingNotes.slice(0, 6).map((s: any) => (
                  <Link key={s.id} href={`/sessions/${s.id}`}>
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-cc-bg cursor-pointer transition-colors">
                      <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${CORAL}12` }}>
                        <FileText size={13} style={{ color: CORAL }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>
                          {s.participant_name ?? "Unknown participant"}
                        </p>
                        <p className="text-[11px]" style={{ color: T3 }}>
                          {format(parseISO(s.session_date), "MMM d")} · {(s.session_type ?? "session").replace(/_/g, " ")}
                        </p>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: "rgba(241,115,138,0.1)", color: CORAL }}>Missing</span>
                    </div>
                  </Link>
                ))}
              </div>
          }
        </Card>

        {/* Compliance alerts feed */}
        <Card>
          <CardHeader title="Compliance Alerts"
            action={<Link href="/compliance"><span className="text-[12px] font-semibold cursor-pointer" style={{ color: PLUM }}>View all →</span></Link>} />
          {(alerts as any[]).length === 0
            ? <EmptyState icon={ShieldCheck} title="No active alerts" sub="Your compliance posture looks good. No unread alerts." />
            : <div className="divide-y" style={{ borderColor: BORDER }}>
                {(alerts as any[]).slice(0, 6).map((a: any) => {
                  const isHigh = a.severity === "high" || a.severity === "critical";
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                      <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: isHigh ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)" }}>
                        <ShieldAlert size={12} style={{ color: isHigh ? "#DC2626" : "#D97706" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold leading-snug" style={{ color: T1 }}>{a.title}</p>
                        <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: T3 }}>{a.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </Card>
      </div>

      {/* Recent activity timeline */}
      <Card>
        <CardHeader title="Recent Session Activity" />
        {recentActivity.length === 0
          ? <EmptyState icon={Clock} title="No recent sessions" sub="Session activity will appear here as sessions are recorded." />
          : <div className="divide-y" style={{ borderColor: BORDER }}>
              {recentActivity.map((s: any) => (
                <Link key={s.id} href={`/sessions/${s.id}`}>
                  <div className="flex items-center gap-4 px-5 py-3 hover:bg-cc-bg cursor-pointer transition-colors group">
                    <div className="shrink-0 text-center w-10">
                      <p className="text-[11px] font-bold uppercase" style={{ color: T3 }}>{format(parseISO(s.session_date), "MMM")}</p>
                      <p className="text-[18px] font-black leading-none" style={{ color: T2 }}>{format(parseISO(s.session_date), "d")}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{s.participant_name ?? "Unknown"}</p>
                      <p className="text-[11px]" style={{ color: T3 }}>{(s.session_type ?? "session").replace(/_/g, " ")} · {s.duration_minutes ?? "—"} min</p>
                    </div>
                    <ComplianceBadge score={s.compliance_score} />
                    <ChevronRight size={14} className="shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: T3 }} />
                  </div>
                </Link>
              ))}
            </div>
        }
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SESSION REPORTS
// ─────────────────────────────────────────────────────────────────────────────
function SessionReportsSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const { data: sessions = [], isLoading } = useGetSessions({ limit: 200 });

  const filtered = useMemo(() => (sessions as any[]).filter(s => {
    if (filter === "compliant"     && scoreLabel(s.compliance_score) !== "Compliant")     return false;
    if (filter === "at_risk"       && scoreLabel(s.compliance_score) !== "At Risk")        return false;
    if (filter === "non_compliant" && scoreLabel(s.compliance_score) !== "Non-Compliant") return false;
    if (filter === "draft"         && s.compliance_score != null)                          return false;
    if (search) {
      const q = search.toLowerCase();
      return (s.participant_name ?? "").toLowerCase().includes(q) ||
        (s.session_type ?? "").toLowerCase().includes(q);
    }
    return true;
  }).sort((a: any, b: any) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime()), [sessions, filter, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3 }} />
          <Input placeholder="Search sessions…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px] rounded-xl border-[rgba(232,213,232,0.8)]" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[["all","All"],["compliant","Compliant"],["at_risk","At Risk"],["non_compliant","Non-Compliant"],["draft","Draft"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className="px-3 h-9 rounded-xl text-[12px] font-semibold border transition-all"
              style={{ background: filter === v ? PLUM : 'var(--cc-surface)', color: filter === v ? "white" : T2, borderColor: filter === v ? PLUM : BORDER }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {isLoading
          ? <div className="p-6 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          : filtered.length === 0
          ? <EmptyState icon={FileText} title="No sessions found" sub="Adjust your filters or search query to find sessions." />
          : <div className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((s: any) => (
                <Link key={s.id} href={`/sessions/${s.id}`}>
                  <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-cc-bg cursor-pointer transition-colors group">
                    <div className="shrink-0 w-20 text-center hidden sm:block">
                      <p className="text-[11px] font-bold" style={{ color: T3 }}>{format(parseISO(s.session_date), "dd MMM yyyy")}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{s.participant_name ?? "Unknown"}</p>
                      <p className="text-[11px]" style={{ color: T3 }}>
                        {(s.session_type ?? "session").replace(/_/g, " ")} · {s.duration_minutes ?? "—"} min
                      </p>
                    </div>
                    <ComplianceBadge score={s.compliance_score} />
                    <ChevronRight size={14} className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" style={{ color: T3 }} />
                  </div>
                </Link>
              ))}
            </div>
        }
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INCIDENT REPORTS
// ─────────────────────────────────────────────────────────────────────────────
function IncidentReportsSection() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const { data: incidents = [], isLoading } = useOrgQuery<any[]>(["incidents"], { queryFn: () => apiFetch<any[]>("/incidents") });
  const { data: stats } = useOrgQuery<any>(["incident-stats"], { queryFn: () => apiFetch<any>("/incidents/stats") });

  const filtered = useMemo(() => (incidents as any[]).filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (i.title ?? "").toLowerCase().includes(q) || (i.participant_name ?? "").toLowerCase().includes(q);
  }), [incidents, search]);

  const open     = (incidents as any[]).filter(i => i.status !== "closed" && i.status !== "resolved").length;
  const critical = (incidents as any[]).filter(i => i.severity === "critical").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total incidents"    value={stats?.total ?? incidents.length} icon={ClipboardList} color={PLUM}      />
        <StatCard label="Open incidents"     value={stats?.open  ?? open}              icon={Clock}         color="#D97706"   />
        <StatCard label="NDIS reportable"    value={stats?.ndis_pending ?? 0}          icon={AlertTriangle} color="#EA580C"   />
        <StatCard label="Critical severity"  value={critical}                           icon={Siren}         color="#DC2626"   />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3 }} />
          <Input placeholder="Search incidents…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px] rounded-xl border-[rgba(232,213,232,0.8)]" />
        </div>
        <Button onClick={() => navigate("/incidents/new")} size="sm" className="shrink-0"
          style={{ background: PLUM, color: 'var(--cc-surface)' }}>
          <Plus size={14} className="mr-1.5" />New Incident
        </Button>
      </div>

      <Card>
        {isLoading
          ? <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          : filtered.length === 0
          ? <EmptyState icon={CheckCircle2} title="No incidents found" sub="No incidents have been reported yet, or none match your search." />
          : <div className="divide-y" style={{ borderColor: BORDER }}>
              {filtered.map((inc: any) => (
                <Link key={inc.id} href={`/incidents/${inc.id}`}>
                  <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-cc-bg cursor-pointer transition-colors group">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{inc.title ?? "Incident Report"}</p>
                      <p className="text-[11px]" style={{ color: T3 }}>
                        {inc.participant_name ?? "—"} · {format(parseISO(inc.incident_date ?? inc.created_at), "MMM d, yyyy")}
                      </p>
                    </div>
                    <SeverityBadge sev={inc.severity ?? "medium"} />
                    <ChevronRight size={14} className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" style={{ color: T3 }} />
                  </div>
                </Link>
              ))}
            </div>
        }
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PARTICIPANT NOTES
// ─────────────────────────────────────────────────────────────────────────────
function ParticipantNotesSection() {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: participants = [] } = useGetParticipants();
  const { data: sessions = [] }     = useGetSessions({ limit: 200 });

  const filteredParts = useMemo(() => (participants as any[]).filter(p =>
    !search || (p.full_name ?? "").toLowerCase().includes(search.toLowerCase())
  ), [participants, search]);

  const partSessions = useMemo(() => selected
    ? (sessions as any[]).filter((s: any) => s.patient_id === selected || s.participant_id === selected)
        .sort((a: any, b: any) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime())
    : [], [sessions, selected]);

  const selectedPart = useMemo(() => (participants as any[]).find((p: any) => p.id === selected), [participants, selected]);

  return (
    <div className="grid lg:grid-cols-5 gap-5 min-h-[60vh]">
      {/* Participant list */}
      <div className="lg:col-span-2">
        <Card className="h-full flex flex-col">
          <CardHeader title="Participants" />
          <div className="p-3 border-b" style={{ borderColor: BORDER }}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3 }} />
              <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-[12px] rounded-lg border-[rgba(232,213,232,0.8)]" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: BORDER }}>
            {filteredParts.map((p: any) => (
              <button key={p.id} onClick={() => setSelected(p.id)} className="w-full text-left px-4 py-3 hover:bg-cc-bg transition-colors"
                style={{ background: selected === p.id ? PLUM_SUBTLE : undefined }}>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-black"
                    style={{ background: selected === p.id ? PLUM : T3 }}>
                    {(p.full_name ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: selected === p.id ? PLUM : T1 }}>{p.full_name}</p>
                    <p className="text-[11px]" style={{ color: T3 }}>{p.ndis_number ?? "—"}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Timeline */}
      <div className="lg:col-span-3">
        {!selected
          ? <Card className="h-full flex items-center justify-center">
              <EmptyState icon={Users} title="Select a participant" sub="Choose a participant on the left to view their notes and session history." />
            </Card>
          : <Card className="h-full flex flex-col">
              <CardHeader title={`${selectedPart?.full_name ?? "Participant"} — Care Notes`}
                action={<Link href={`/patients`}><span className="text-[12px] font-semibold cursor-pointer" style={{ color: PLUM }}>View profile →</span></Link>} />
              {partSessions.length === 0
                ? <EmptyState icon={BookOpen} title="No session notes yet" sub="Session documentation for this participant will appear here." />
                : <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: BORDER }}>
                    {partSessions.map((s: any) => (
                      <Link key={s.id} href={`/sessions/${s.id}`}>
                        <div className="px-5 py-4 hover:bg-cc-bg cursor-pointer transition-colors group">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: T3 }}>
                              {format(parseISO(s.session_date), "EEEE, MMM d, yyyy")}
                            </p>
                            <ComplianceBadge score={s.compliance_score} />
                          </div>
                          <p className="text-[13px] font-semibold" style={{ color: T1 }}>
                            {(s.session_type ?? "session").replace(/_/g, " ")} · {s.duration_minutes ?? "—"} min
                          </p>
                          {legalNoteText(s) && (
                            <p className="text-[12px] mt-1.5 line-clamp-2" style={{ color: T2 }}>
                              {legalNoteText(s).slice(0, 200)}{legalNoteText(s).length > 200 ? "..." : ""}
                            </p>
                          )}
                          {(s.original_language_input || s.translated_english_note) && (
                            <div className="mt-3">
                              <TranslationAuditView
                                originalLanguageInput={s.original_language_input ?? undefined}
                                translatedEnglishNote={s.translated_english_note ?? undefined}
                                translationMetadata={s.translation_metadata as Record<string, unknown> | null}
                                translationStatus={s.translation_status ?? undefined}
                                translationProvider={s.translation_provider ?? undefined}
                              />
                            </div>
                          )}
                          {!legalNoteText(s) && (
                            <p className="text-[12px] mt-1.5 italic" style={{ color: CORAL }}>No notes recorded</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
              }
            </Card>
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPLIANCE REPORTS
// ─────────────────────────────────────────────────────────────────────────────
function ComplianceReportsSection() {
  const { data: rawOv, isLoading } = useGetComplianceOverview();
  const ov = rawOv as any;
  const sessions: any[] = ov?.sessions ?? [];

  const score = ov?.average_score ?? 0;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (score / 100) * circumference;

  const commonIssues = useMemo(() => {
    const counts: Record<string, number> = {};
    sessions.forEach(s => {
      if (s.checks) {
        if (!s.checks.notes_present)     counts["Missing clinical notes"]   = (counts["Missing clinical notes"]   ?? 0) + 1;
        if (!s.checks.goals_linked)      counts["Goals not documented"]      = (counts["Goals not documented"]      ?? 0) + 1;
        if (!s.checks.duration_recorded) counts["Duration not recorded"]     = (counts["Duration not recorded"]     ?? 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  return (
    <div className="space-y-6">
      {isLoading
        ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        : <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total sessions"    value={ov?.total_sessions ?? 0}    icon={FileText}      color={PLUM}      />
            <StatCard label="Compliant"         value={ov?.compliant ?? 0}          icon={CheckCircle2}  color="#16A34A"   />
            <StatCard label="At risk"           value={ov?.at_risk ?? 0}            icon={Clock}         color="#D97706"   />
            <StatCard label="Non-compliant"     value={ov?.non_compliant ?? 0}      icon={XCircle}       color="#DC2626"   />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Organisation Compliance Score" />
              <div className="flex flex-col items-center py-8 gap-4">
                <svg width="140" height="140" className="-rotate-90">
                  <circle cx="70" cy="70" r="52" fill="none" stroke={`${PLUM}14`} strokeWidth="12" />
                  <circle cx="70" cy="70" r="52" fill="none"
                    stroke={scoreColor(score)} strokeWidth="12"
                    strokeDasharray={circumference} strokeDashoffset={offset}
                    strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div className="text-center -mt-20 pb-8">
                  <p className="text-[36px] font-black leading-none" style={{ color: scoreColor(score) }}>{Math.round(score)}</p>
                  <p className="text-[12px] font-bold uppercase tracking-wide mt-0.5" style={{ color: T3 }}>out of 100</p>
                </div>
                <div className="grid grid-cols-3 gap-4 w-full px-6">
                  {[
                    { label: "Compliant", val: ov?.compliant ?? 0, col: "#16A34A" },
                    { label: "At Risk",   val: ov?.at_risk   ?? 0, col: "#D97706" },
                    { label: "Non-comp.", val: ov?.non_compliant ?? 0, col: "#DC2626" },
                  ].map(b => (
                    <div key={b.label} className="text-center">
                      <p className="text-[18px] font-black" style={{ color: b.col }}>{b.val}</p>
                      <p className="text-[11px]" style={{ color: T3 }}>{b.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Most Common Issues" />
              {commonIssues.length === 0
                ? <EmptyState icon={CheckCircle2} title="No recurring issues" sub="All compliance checks are currently passing." />
                : <div className="p-5 space-y-4">
                    {commonIssues.map(([issue, count]) => {
                      const pct = sessions.length > 0 ? (count / sessions.length) * 100 : 0;
                      return (
                        <div key={issue}>
                          <div className="flex justify-between mb-1">
                            <p className="text-[12px] font-semibold" style={{ color: T1 }}>{issue}</p>
                            <p className="text-[12px] font-bold" style={{ color: CORAL }}>{count} sessions</p>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      );
                    })}
                  </div>
              }
            </Card>
          </div>

          <Card>
            <CardHeader title="Session Audit Log"
              action={<Link href="/compliance"><span className="text-[12px] font-semibold cursor-pointer" style={{ color: PLUM }}>Full compliance centre →</span></Link>} />
            {sessions.length === 0
              ? <EmptyState icon={FileBarChart2} title="No session data" sub="Session compliance data will appear here once sessions are reviewed." />
              : <div className="divide-y" style={{ borderColor: BORDER }}>
                  {sessions.slice(0, 8).map((s: any) => (
                    <Link key={s.session_id} href={`/sessions/${s.session_id}`}>
                      <div className="flex items-center gap-4 px-5 py-3 hover:bg-cc-bg cursor-pointer transition-colors group">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{s.participant_name}</p>
                          <p className="text-[11px]" style={{ color: T3 }}>
                            {format(parseISO(s.session_date), "MMM d, yyyy")} · {(s.session_type ?? "session").replace(/_/g, " ")}
                          </p>
                        </div>
                        <ComplianceBadge score={s.compliance_score} />
                        <ChevronRight size={14} className="shrink-0 opacity-0 group-hover:opacity-40" style={{ color: T3 }} />
                      </div>
                    </Link>
                  ))}
                </div>
            }
          </Card>
        </>
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. AUDIT READINESS
// ─────────────────────────────────────────────────────────────────────────────
function AuditReadinessSection() {
  const { data: rawOv } = useGetComplianceOverview();
  const { data: sessions = [] } = useGetSessions({ limit: 200 });
  const ov = rawOv as any;
  const score = ov?.average_score ?? 0;

  const now = new Date();
  const recentSessions = (sessions as any[]).filter(s => isAfter(parseISO(s.session_date), subDays(now, 30)));
  const notedSessions  = recentSessions.filter(s => legalNoteText(s).length >= 20);
  const noteRate       = recentSessions.length > 0 ? (notedSessions.length / recentSessions.length) * 100 : 100;
  const compliantPct   = (ov?.total_sessions ?? 0) > 0 ? ((ov?.compliant ?? 0) / ov.total_sessions) * 100 : 0;

  const checks = [
    { label: "Session notes documented",       pct: noteRate,       pass: noteRate >= 80     },
    { label: "Compliance score ≥ 85%",         pct: score,          pass: score >= 85         },
    { label: "Sessions reviewed (30 days)",    pct: Math.min(recentSessions.length * 10, 100), pass: recentSessions.length >= 5 },
    { label: "Compliant session rate",         pct: compliantPct,   pass: compliantPct >= 80  },
    { label: "NDIS goals documented",          pct: 75,             pass: false,  warn: true  },
    { label: "Incident reports filed",         pct: 100,            pass: true                },
    { label: "Digital signatures configured", pct: 100,            pass: true                },
    { label: "Budget tracking active",        pct: 100,            pass: true                },
  ];
  const passed  = checks.filter(c => c.pass).length;
  const readiness = Math.round((passed / checks.length) * 100);

  return (
    <div className="space-y-6">
      {/* Hero readiness card */}
      <Card>
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest mb-4"
            style={{ background: readiness >= 80 ? "rgba(22,163,74,0.1)" : "rgba(245,158,11,0.1)", color: readiness >= 80 ? "#16A34A" : "#D97706" }}>
            {readiness >= 80 ? <CheckCircle2 size={12} /> : <Clock size={12} />}
            {readiness >= 80 ? "Audit Ready" : "In Progress"}
          </div>
          <p className="text-[56px] font-black leading-none" style={{ color: readiness >= 80 ? "#16A34A" : scoreColor(readiness) }}>
            {readiness}%
          </p>
          <p className="text-[14px] font-semibold mt-2" style={{ color: T2 }}>
            {passed} of {checks.length} audit requirements met
          </p>
          <p className="text-[12px] mt-1" style={{ color: T3 }}>
            {readiness >= 80 ? "You are audit-ready today." : "Complete remaining items to achieve full audit readiness."}
          </p>
          <div className="mt-5 max-w-xs mx-auto">
            <Progress value={readiness} className="h-2" />
          </div>
        </div>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader title="Audit Readiness Checklist" />
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: c.pass ? "rgba(22,163,74,0.1)" : c.warn ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)" }}>
                {c.pass
                  ? <CheckCircle2 size={14} style={{ color: "#16A34A" }} />
                  : c.warn
                  ? <Clock size={14} style={{ color: "#D97706" }} />
                  : <XCircle size={14} style={{ color: "#DC2626" }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: T1 }}>{c.label}</p>
                <div className="mt-1.5">
                  <Progress value={c.pct} className="h-1" />
                </div>
              </div>
              <p className="text-[12px] font-bold shrink-0"
                style={{ color: c.pass ? "#16A34A" : c.warn ? "#D97706" : "#DC2626" }}>
                {Math.round(c.pct)}%
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. AI INSIGHTS & FLAGS
// ─────────────────────────────────────────────────────────────────────────────
function AIInsightsSection() {
  const { data: alerts = [] }   = useGetUnreadAlerts();
  const { data: sessions = [] } = useGetSessions({ limit: 100 });
  const { data: participants = [] } = useGetParticipants();

  const nonCompliant  = (sessions as any[]).filter(s => s.compliance_score != null && s.compliance_score < 60);
  const highRisk      = (participants as any[]).filter((p: any) => p.risk_level === "high" || p.risk_level === "medium");
  const sortedAlerts  = [...(alerts as any[])].sort((a, b) => {
    const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Unread AI alerts"       value={(alerts as any[]).length} icon={Brain}         color={PLUM}    />
        <StatCard label="Non-compliant sessions" value={nonCompliant.length}       icon={ShieldAlert}   color="#DC2626" />
        <StatCard label="Risk-flagged participants" value={highRisk.length}        icon={AlertTriangle} color="#D97706" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Alert feed */}
        <Card>
          <CardHeader title="AI Compliance Alerts" />
          {sortedAlerts.length === 0
            ? <EmptyState icon={Sparkles} title="No active AI flags" sub="All sessions and participants currently clear of AI-detected compliance risks." />
            : <div className="divide-y" style={{ borderColor: BORDER }}>
                {sortedAlerts.map((a: any) => {
                  const isHigh = a.severity === "high" || a.severity === "critical";
                  const isMed  = a.severity === "medium";
                  const col    = isHigh ? "#DC2626" : isMed ? "#D97706" : "#16A34A";
                  const bg     = isHigh ? "rgba(239,68,68,0.08)" : isMed ? "rgba(245,158,11,0.08)" : "rgba(22,163,74,0.08)";
                  return (
                    <div key={a.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: bg }}>
                          <Lightbulb size={12} style={{ color: col }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[13px] font-semibold" style={{ color: T1 }}>{a.title}</p>
                            <SeverityBadge sev={a.severity ?? "medium"} />
                          </div>
                          <p className="text-[12px] mt-1" style={{ color: T2 }}>{a.message}</p>
                          {a.session_id && (
                            <Link href={`/sessions/${a.session_id}`}>
                              <span className="text-[11px] font-semibold mt-1.5 inline-block cursor-pointer" style={{ color: PLUM }}>
                                View session →
                              </span>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </Card>

        {/* Risk participants */}
        <Card>
          <CardHeader title="Risk-Flagged Participants" />
          {highRisk.length === 0
            ? <EmptyState icon={Users} title="No risk flags" sub="No participants are currently flagged as medium or high risk." />
            : <div className="divide-y" style={{ borderColor: BORDER }}>
                {highRisk.map((p: any) => (
                  <Link key={p.id} href="/patients">
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-cc-bg cursor-pointer transition-colors group">
                      <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-black"
                        style={{ background: p.risk_level === "high" ? "#DC2626" : "#D97706" }}>
                        {(p.full_name ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{p.full_name}</p>
                        <p className="text-[11px]" style={{ color: T3 }}>{p.primary_disability ?? "NDIS participant"}</p>
                      </div>
                      <SeverityBadge sev={p.risk_level ?? "medium"} />
                    </div>
                  </Link>
                ))}
              </div>
          }
          {/* Non-compliant sessions */}
          {nonCompliant.length > 0 && (
            <>
              <div className="px-5 py-2.5 border-t" style={{ borderColor: BORDER, background: BG }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: T3 }}>Non-compliant sessions</p>
              </div>
              {nonCompliant.slice(0, 4).map((s: any) => (
                <Link key={s.id} href={`/sessions/${s.id}`}>
                  <div className="flex items-center gap-3 px-5 py-3 hover:bg-cc-bg cursor-pointer transition-colors group border-t" style={{ borderColor: BORDER }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{s.participant_name ?? "—"}</p>
                      <p className="text-[11px]" style={{ color: T3 }}>{format(parseISO(s.session_date), "MMM d")}</p>
                    </div>
                    <ComplianceBadge score={s.compliance_score} />
                  </div>
                </Link>
              ))}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. TEMPLATES & FORMS
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id: "progress_note",    title: "Progress Note",         desc: "Structured NDIS progress note template with goal links, outcomes, and participant response sections.", icon: FileText,      badge: "Core" },
  { id: "incident_report",  title: "Incident Report",       desc: "NDIS-compliant incident report capturing severity, actions taken, and required escalation steps.",    icon: AlertTriangle, badge: "Mandatory" },
  { id: "shift_handover",   title: "Shift Handover",        desc: "Structured handover form ensuring continuity of care between support workers across shifts.",         icon: ClipboardList, badge: "Operational" },
  { id: "care_plan",        title: "Care Plan Summary",     desc: "Participant-centred care plan documenting goals, support strategies, and risk management approach.",  icon: Target,        badge: "Core" },
  { id: "restrictive",      title: "Behaviour Support",     desc: "Behaviour support plan template aligned with NDIS restrictive practice reporting requirements.",     icon: ShieldCheck,   badge: "Compliance" },
  { id: "assessment",       title: "Initial Assessment",    desc: "Comprehensive intake and assessment form for new NDIS participants joining your service.",           icon: Star,          badge: "Onboarding" },
  { id: "monthly_review",   title: "Monthly Review",        desc: "Monthly participant review capturing goal progress, wellbeing indicators, and plan adjustments.",    icon: TrendingUp,    badge: "Review" },
  { id: "session_summary",  title: "Session Summary",       desc: "Quick session summary for supervisor review with key observations and follow-up actions.",          icon: BookOpen,      badge: "Daily" },
];

const BADGE_COLORS: Record<string, [string, string]> = {
  Core:        [PLUM,      `${PLUM}14`],
  Mandatory:   ["#DC2626", "rgba(239,68,68,0.1)"],
  Operational: ["#D97706", "rgba(245,158,11,0.1)"],
  Compliance:  ["#16A34A", "rgba(22,163,74,0.1)"],
  Onboarding:  ["#2563EB", "rgba(37,99,235,0.1)"],
  Review:      ["#7C3AED", "rgba(124,58,237,0.1)"],
  Daily:       [T3,        PLUM_MEDIUM],
};

function TemplatesSection() {
  const [, navigate] = useLocation();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-bold" style={{ color: T1 }}>NDIS-Compliant Templates</h3>
          <p className="text-[12px] mt-0.5" style={{ color: T3 }}>Pre-built templates aligned with NDIS quality and safeguards standards.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {TEMPLATES.map(t => {
          const Icon = t.icon;
          const [col, bg] = BADGE_COLORS[t.badge] ?? [PLUM, `${PLUM}14`];
          return (
            <Card key={t.id} className="flex flex-col hover:shadow-md transition-shadow">
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between mb-3">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: PLUM_SUBTLE }}>
                    <Icon size={17} style={{ color: PLUM }} />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color: col }}>{t.badge}</span>
                </div>
                <p className="text-[13px] font-bold mb-1" style={{ color: T1 }}>{t.title}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: T3 }}>{t.desc}</p>
              </div>
              <div className="px-5 pb-4 flex gap-2">
                <button
                  onClick={() => navigate("/sessions/new")}
                  className="flex-1 h-8 rounded-lg text-[12px] font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: PLUM }}>
                  Use template
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. EXPORT CENTRE
// ─────────────────────────────────────────────────────────────────────────────
function ExportCentreSection() {
  const [exporting, setExporting] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const { data: sessions = [] } = useGetSessions({ limit: 200 });
  const { data: rawOv }         = useGetComplianceOverview();

  const ov = rawOv as any;

  async function handleExport(type: string) {
    setExporting(type);

    if (type === "compliance_bundle") {
      const sessions_list: any[] = ov?.sessions ?? [];
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.text("CareCliQ Compliance Bundle", 14, 22);
      doc.setFontSize(11);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32);
      doc.text(`Overall Score: ${Math.round(ov?.average_score ?? 0)}%`, 14, 40);
      autoTable(doc, {
        startY: 50,
        head: [["Participant", "Date", "Type", "Score", "Status"]],
        body: sessions_list.map((s: any) => [
          s.participant_name ?? "—",
          format(parseISO(s.session_date), "dd/MM/yyyy"),
          (s.session_type ?? "—").replace(/_/g, " "),
          s.compliance_score != null ? `${Math.round(s.compliance_score)}%` : "Draft",
          scoreLabel(s.compliance_score ?? 0),
        ]),
      });
      doc.save("carescribe-compliance-bundle.pdf");
    }

    if (type === "session_csv") {
      const rows = (sessions as any[]).map(s => [
        s.id, s.participant_name ?? "", format(parseISO(s.session_date), "dd/MM/yyyy"),
        (s.session_type ?? "").replace(/_/g, " "), s.duration_minutes ?? "",
        s.compliance_score != null ? `${Math.round(s.compliance_score)}%` : "Draft",
        s.status ?? "",
        legalNoteText(s),
      ]);
      const csv = [
        ["Session ID", "Participant", "Date", "Type", "Duration (min)", "Compliance", "Status", "English Legal Record"],
        ...rows,
      ].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "carescribe-sessions.csv"; a.click();
      URL.revokeObjectURL(url);
    }

    setDone(d => [...d, type]);
    setExporting(null);
  }

  const EXPORT_TYPES = [
    { id: "compliance_bundle", label: "Compliance Bundle",   desc: "Full PDF report of all session compliance scores and audit outcomes.", icon: ShieldCheck,   color: PLUM    },
    { id: "session_csv",       label: "Sessions CSV",         desc: "Spreadsheet export of all sessions with compliance metadata for analysis.", icon: FileBarChart2, color: "#2563EB" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[16px] font-bold" style={{ color: T1 }}>Export Centre</h3>
        <p className="text-[12px] mt-0.5" style={{ color: T3 }}>
          Generate audit-ready, timestamped exports. All exports include NDIS provider metadata.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {EXPORT_TYPES.map(e => {
          const Icon = e.icon;
          const isDone = done.includes(e.id);
          const isExp  = exporting === e.id;
          return (
            <Card key={e.id} className="flex flex-col">
              <div className="p-5 flex gap-4">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${e.color}14` }}>
                  <Icon size={18} style={{ color: e.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold" style={{ color: T1 }}>{e.label}</p>
                  <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: T3 }}>{e.desc}</p>
                </div>
              </div>
              <div className="px-5 pb-5">
                <button
                  disabled={isExp}
                  onClick={() => handleExport(e.id)}
                  className="w-full h-9 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-60 border"
                  style={{
                    background: isDone ? "rgba(22,163,74,0.08)" : `${e.color}0D`,
                    color: isDone ? "#16A34A" : e.color,
                    borderColor: isDone ? "rgba(22,163,74,0.2)" : `${e.color}30`,
                  }}>
                  {isExp
                    ? <><span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />Generating…</>
                    : isDone
                    ? <><CheckCircle2 size={14} />Downloaded</>
                    : <><Download size={14} />Generate & Download</>
                  }
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Export Notes" />
        <div className="p-5 space-y-2">
          {[
            "All exports are timestamped with the generation date and CareCliQ version.",
            "PDF exports include your provider name, credentials, and digital signature if configured in Settings.",
            "CSV exports open in Excel, Google Sheets, or any spreadsheet application.",
            "Compliance bundles include per-session rule-by-rule breakdowns suitable for NDIA quality audits.",
          ].map((note, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 size={13} className="shrink-0 mt-0.5" style={{ color: "#16A34A" }} />
              <p className="text-[12px]" style={{ color: T2 }}>{note}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabId>("hub");

  const SECTION_MAP: Record<TabId, React.ReactNode> = {
    hub:        <HubSection />,
    sessions:   <SessionReportsSection />,
    incidents:  <IncidentReportsSection />,
    notes:      <ParticipantNotesSection />,
    compliance: <ComplianceReportsSection />,
    audit:      <AuditReadinessSection />,
    ai:         <AIInsightsSection />,
    templates:  <TemplatesSection />,
    export:     <ExportCentreSection />,
  };

  const activeTab_ = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="w-full min-h-full" style={{ background: BG }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* Page header */}
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1" style={{ color: CORAL }}>
            Reports &amp; Documentation
          </p>
          <h1 className="text-[26px] sm:text-[30px] font-black tracking-tight" style={{ color: PLUM }}>
            {activeTab_.label}
          </h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Vertical sidebar nav — desktop */}
          <aside className="hidden lg:block w-56 shrink-0">
            <nav className="bg-cc-surface rounded-2xl overflow-hidden sticky top-6" style={{ boxShadow: CARD }}>
              {TABS.map(t => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className={cn("w-full flex items-center gap-3 px-4 py-3 text-left text-[12px] font-semibold transition-all",
                      active ? "bg-violet-50" : "hover:bg-cc-bg"
                    )}
                    style={{ color: active ? PLUM : T2, borderRight: active ? `2px solid ${PLUM}` : "2px solid transparent" }}>
                    <Icon size={15} style={{ color: active ? PLUM : T3 }} />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Horizontal tabs — mobile */}
          <div className="lg:hidden overflow-x-auto pb-1 -mx-4 px-4">
            <div className="flex gap-2 min-w-max">
              {TABS.map(t => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all border"
                    style={{
                      background: active ? PLUM : 'var(--cc-surface)',
                      color: active ? "white" : T2,
                      borderColor: active ? PLUM : BORDER,
                    }}>
                    <Icon size={12} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <main className="flex-1 min-w-0">
            {activeTab === "hub" && <ClinicalReportGenerator />}
            {SECTION_MAP[activeTab]}
          </main>
        </div>
      </div>
    </div>
  );
}
