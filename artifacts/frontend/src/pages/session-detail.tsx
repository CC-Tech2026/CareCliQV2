import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useGetSession, useUpdateSession, useSaveSessionWithAI } from "@workspace/api-client-react";
import type { Session } from "@workspace/api-client-react";
import jsPDF from "jspdf";

// ---------------------------------------------------------------------------
// Audit payload type (mirrors GET /api/sessions/{id}/audit response shape)
// ---------------------------------------------------------------------------

interface AuditPayload {
  audit_version: string;
  ndis_principle: string;
  generated_at: string;
  session: {
    id: string;
    date: string;
    type: string;
    duration_minutes: number;
    status: string;
  };
  participant: {
    id: string;
    full_name: string;
    ndis_number?: string;
    date_of_birth?: string;
  };
  clinical_notes: string;
  structured_notes: Record<string, string>;
  goals_addressed: string[];
  compliance: {
    score: number;
    blocking: boolean;
    issues: string[];
    status: string;
    ai_blended_score?: number;
    ai_status?: string;
    ai_notes?: string;
  };
  ai_insights?: {
    summary?: string;
    key_observations?: string[];
    next_session_recommendations?: string[];
    progress_trend?: string;
  };
  transcription?: string | null;
  photo_urls?: string[];
  evidence_summary?: {
    photo_count: number;
    has_transcription: boolean;
    has_activity_log: boolean;
  };
}

// Extended session type with extra DB columns not yet in the OpenAPI spec
type ExtendedSession = Session & {
  cost?: number | null;
  support_category?: string | null;
  compliance_status?: string | null;
};
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, parseISO } from "date-fns";
import {
  Calendar, Clock, Activity, FileText, CheckCircle2, ShieldAlert, Sparkles,
  Loader2, Brain, AlertTriangle, Upload, Image as ImageIcon, XCircle,
  RefreshCw, Lightbulb, Shield, TrendingUp, DollarSign, Play, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Claim readiness helpers
// ---------------------------------------------------------------------------

type ClaimStatus = "draft" | "compliant" | "at_risk" | "non_compliant";

function deriveClaimStatus(score?: number | null, sessionStatus?: string): ClaimStatus {
  if (!score || sessionStatus === "draft") return "draft";
  if (score >= 85) return "compliant";
  if (score >= 60) return "at_risk";
  return "non_compliant";
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; icon: typeof Shield; cls: string }> = {
  draft: { label: "Draft", icon: Shield, cls: "bg-slate-100 text-slate-600 border-slate-300" },
  compliant: { label: "Compliant", icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  at_risk: { label: "At Risk", icon: AlertTriangle, cls: "bg-amber-50 text-amber-700 border-amber-300" },
  non_compliant: { label: "Non-Compliant", icon: XCircle, cls: "bg-red-50 text-red-700 border-red-300" },
};

// ---------------------------------------------------------------------------
// Live compliance check (lightweight local rules, no API call)
// ---------------------------------------------------------------------------

interface LiveIssue {
  type: "error" | "warning";
  msg: string;
  rule: string;
}

function checkLiveCompliance(
  notes: string,
  durationMinutes?: number,
  goalsAddressed?: string[]
): LiveIssue[] {
  const issues: LiveIssue[] = [];
  if (!notes || notes.length === 0) {
    issues.push({ type: "error", rule: "notes_empty", msg: "Clinical notes are required" });
  } else if (notes.length < 50) {
    issues.push({ type: "error", rule: "notes_too_short", msg: `Notes are very brief (${notes.length} chars). Aim for at least 50 characters` });
  } else if (notes.length < 200) {
    issues.push({ type: "warning", rule: "notes_brief", msg: "Notes may be insufficient for NDIS audit. Consider adding more detail" });
  }
  if (!durationMinutes || durationMinutes === 0) {
    issues.push({ type: "error", rule: "no_duration", msg: "Session duration must be recorded" });
  }
  if (!goalsAddressed || goalsAddressed.length === 0) {
    issues.push({ type: "warning", rule: "no_goals", msg: "No NDIS goals are linked to this session" });
  }
  const outcomeKeywords = ["achieved", "improved", "able to", "completed", "progressed", "demonstrated", "engaged", "participated", "outcome", "result", "progress"];
  if (notes.length > 0 && !outcomeKeywords.some(kw => notes.toLowerCase().includes(kw))) {
    issues.push({ type: "warning", rule: "no_outcome", msg: "Notes should describe measurable outcomes (e.g. 'participant achieved...', 'improved...')" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Rule result icon
// ---------------------------------------------------------------------------

function RuleIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SessionDetail({ id }: { id?: string }) {
  const { id: paramId } = useParams();
  const sessionId = id || paramId;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: session, isLoading, refetch } = useGetSession(sessionId as string, {
    query: { enabled: !!sessionId, queryKey: ["getSession", sessionId] },
  });

  const updateSession = useUpdateSession();
  const saveWithAI = useSaveSessionWithAI();

  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showSaveWarning, setShowSaveWarning] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  useEffect(() => {
    if (session && !isEditing) setNotes(session.notes || "");
  }, [session, isEditing]);

  // Parse ai_insights JSON to get rules breakdown
  const aiInsights = useMemo(() => {
    if (!session?.ai_insights) return null;
    try {
      const parsed = typeof session.ai_insights === "string"
        ? JSON.parse(session.ai_insights)
        : session.ai_insights;
      return parsed;
    } catch {
      return null;
    }
  }, [session?.ai_insights]);

  const rulesResult = aiInsights?.rules_result ?? null;

  // Live compliance issues while editing
  const liveIssues = useMemo(() => {
    if (!isEditing) return [];
    return checkLiveCompliance(
      notes,
      session?.duration_minutes,
      session?.goals_addressed as string[] | undefined
    );
  }, [notes, isEditing, session?.duration_minutes, session?.goals_addressed]);

  const criticalLiveIssues = liveIssues.filter(i => i.type === "error");

  // Claim status
  const claimStatus = deriveClaimStatus(
    session?.compliance_score,
    session?.status
  );
  const statusCfg = STATUS_CONFIG[claimStatus];

  // AI explanation query (fetch on demand for failed rules)
  const { data: explanation, isFetching: explanationLoading, refetch: fetchExplanation } = useQuery({
    queryKey: ["explainCompliance", sessionId, rulesResult?.failed_rules?.length],
    queryFn: async () => {
      const failed = rulesResult?.failed_rules ?? [];
      if (!failed.length) return null;
      const res = await fetch("/api/ai/explain-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ failed_rules: failed, session_notes: session?.notes ?? "" }),
      });
      if (!res.ok) throw new Error("Failed to get explanation");
      return res.json() as Promise<{ explanation: string; fix_suggestion: string; priority: string }>;
    },
    enabled: false,
    staleTime: 1000 * 60 * 5,
  });

  // Re-run compliance (POST /compliance/run/:id)
  const reRunCompliance = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/compliance/run/${sessionId}`, { method: "POST" });
      if (!res.ok) throw new Error("Compliance run failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Compliance re-run complete — ${data.score.toFixed(0)}%` });
      refetch();
    },
    onError: () => toast({ title: "Compliance check failed", variant: "destructive" }),
  });

  // Save notes — with blocking modal if critical issues
  const doSaveNotes = () => {
    if (!sessionId) return;
    updateSession.mutate({ sessionId, data: { notes } }, {
      onSuccess: () => {
        toast({ title: "Notes saved" });
        setIsEditing(false);
        refetch();
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    });
  };

  const handleSaveNotes = () => {
    if (criticalLiveIssues.length > 0) {
      setShowSaveWarning(true);
    } else {
      doSaveNotes();
    }
  };

  const handleAIAnalysis = () => {
    if (!sessionId) return;
    saveWithAI.mutate({ sessionId }, {
      onSuccess: () => {
        toast({ title: "AI Analysis complete", description: "Compliance score and insights updated." });
        refetch();
        setShowExplanation(false);
      },
      onError: () => toast({ title: "AI Analysis failed", variant: "destructive" }),
    });
  };

  const handleExportAudit = async () => {
    if (!sessionId) return;
    setIsExporting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/audit`);
      if (!res.ok) throw new Error("Failed to fetch audit record");
      const data = await res.json();
      const participantName = (data.participant?.full_name || "unknown")
        .toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const date = (data.session?.date || new Date().toISOString().slice(0, 10)).replace(/-/g, "_");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_${participantName}_${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Audit record exported", description: "JSON file downloaded." });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!sessionId) return;
    setIsExportingPDF(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/audit`);
      if (!res.ok) throw new Error(`Failed to fetch audit record (${res.status} ${res.statusText})`);
      const data = await res.json() as AuditPayload;

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const contentW = pageW - margin * 2;
      let y = margin;

      const addPage = () => {
        pdf.addPage();
        y = margin;
      };

      const checkPageBreak = (neededH: number) => {
        if (y + neededH > pageH - margin) addPage();
      };

      const drawHRule = (color = "#e2e8f0") => {
        pdf.setDrawColor(color);
        pdf.setLineWidth(0.3);
        pdf.line(margin, y, pageW - margin, y);
        y += 4;
      };

      const writeText = (text: string, opts: {
        size?: number; bold?: boolean; color?: string;
        align?: "left" | "center" | "right"; maxWidth?: number; lineGap?: number;
      } = {}) => {
        const { size = 10, bold = false, color = "#1e293b", align = "left", maxWidth = contentW, lineGap = 1.5 } = opts;
        pdf.setFontSize(size);
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setTextColor(color);
        const lines = pdf.splitTextToSize(text, maxWidth);
        const lineH = size * 0.352778 + lineGap;
        checkPageBreak(lines.length * lineH + 2);
        pdf.text(lines, align === "center" ? pageW / 2 : align === "right" ? pageW - margin : margin, y, { align });
        y += lines.length * lineH + 1;
      };

      const writeLabelValue = (label: string, value: string) => {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor("#64748b");
        pdf.text(label.toUpperCase(), margin, y);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor("#1e293b");
        const labelW = pdf.getTextWidth(label.toUpperCase()) + 3;
        const valLines = pdf.splitTextToSize(value, contentW - labelW);
        pdf.text(valLines, margin + labelW, y);
        y += valLines.length * 5 + 1;
      };

      // ── Header band ──────────────────────────────────────────────────────
      pdf.setFillColor("#1e3a5f");
      pdf.rect(0, 0, pageW, 28, "F");

      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor("#ffffff");
      pdf.text("NDIS Session Audit Report", margin, 13);

      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor("#94a3b8");
      pdf.text("AI Clinical Companion — Confidential", margin, 20);
      const nowStr = new Date().toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
      pdf.text(`Generated: ${nowStr}`, pageW - margin, 20, { align: "right" });

      y = 36;

      // ── Participant Details ───────────────────────────────────────────────
      writeText("Participant Details", { size: 12, bold: true, color: "#1e3a5f" });
      y += 1;
      drawHRule("#bfdbfe");

      const p = data.participant ?? {};
      writeLabelValue("Name:", p.full_name ?? "—");
      if (p.ndis_number) writeLabelValue("NDIS Number:", p.ndis_number);
      if (p.date_of_birth) writeLabelValue("Date of Birth:", p.date_of_birth);
      y += 3;

      // ── Session Information ───────────────────────────────────────────────
      checkPageBreak(40);
      writeText("Session Information", { size: 12, bold: true, color: "#1e3a5f" });
      y += 1;
      drawHRule("#bfdbfe");

      const s = data.session ?? {};
      const sessionDate = s.date
        ? new Date(s.date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
        : "—";
      writeLabelValue("Date:", sessionDate);
      writeLabelValue("Type:", s.type ?? "—");
      writeLabelValue("Duration:", s.duration_minutes ? `${s.duration_minutes} minutes` : "—");
      if (s.status) writeLabelValue("Status:", s.status);
      y += 3;

      // ── Compliance Score ──────────────────────────────────────────────────
      checkPageBreak(30);
      writeText("Compliance Score", { size: 12, bold: true, color: "#1e3a5f" });
      y += 1;
      drawHRule("#bfdbfe");

      const score = data.compliance?.score ?? null;
      const scoreLabel = score == null ? "Not assessed"
        : score >= 85 ? `${score.toFixed(0)}% — Compliant`
        : score >= 60 ? `${score.toFixed(0)}% — At Risk`
        : `${score.toFixed(0)}% — Non-Compliant`;

      const scoreColor = score == null ? "#64748b" : score >= 85 ? "#059669" : score >= 60 ? "#d97706" : "#dc2626";
      writeText(scoreLabel, { size: 13, bold: true, color: scoreColor });

      if (data.compliance?.blocking) {
        y += 1;
        writeText("⚠ Documentation is insufficient to support a claim for this session.", { size: 9, color: "#dc2626" });
      }
      y += 3;

      // ── Clinical Notes ────────────────────────────────────────────────────
      checkPageBreak(20);
      writeText("Clinical Notes", { size: 12, bold: true, color: "#1e3a5f" });
      y += 1;
      drawHRule("#bfdbfe");

      const clinicalNotes: string = data.clinical_notes || "No clinical notes recorded.";
      writeText(clinicalNotes, { size: 10, color: "#1e293b" });
      y += 3;

      // ── Structured Clinical Notes ─────────────────────────────────────────
      const structuredNotes: Record<string, string> = data.structured_notes ?? {};
      const structuredEntries = Object.entries(structuredNotes).filter(([, v]) => v && String(v).trim().length > 0);
      if (structuredEntries.length > 0) {
        checkPageBreak(20);
        writeText("Structured Clinical Notes", { size: 12, bold: true, color: "#1e3a5f" });
        y += 1;
        drawHRule("#bfdbfe");
        structuredEntries.forEach(([key, value]) => {
          checkPageBreak(14);
          const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          writeText(label, { size: 9, bold: true, color: "#475569" });
          writeText(String(value), { size: 10, color: "#1e293b" });
          y += 1;
        });
        y += 2;
      }

      // ── NDIS Goals Addressed ──────────────────────────────────────────────
      const goals: string[] = data.goals_addressed ?? [];
      if (goals.length > 0) {
        checkPageBreak(20);
        writeText("NDIS Goals Addressed", { size: 12, bold: true, color: "#1e3a5f" });
        y += 1;
        drawHRule("#bfdbfe");
        goals.forEach((goal: string) => {
          checkPageBreak(8);
          writeText(`• ${goal}`, { size: 10, color: "#334155" });
        });
        y += 3;
      }

      // ── Compliance Issues ─────────────────────────────────────────────────
      const complianceIssues: string[] = data.compliance?.issues ?? [];
      if (complianceIssues.length > 0) {
        checkPageBreak(20);
        writeText("Compliance Gaps", { size: 12, bold: true, color: "#1e3a5f" });
        y += 1;
        drawHRule("#bfdbfe");
        complianceIssues.forEach((issue: string) => {
          checkPageBreak(8);
          writeText(`• ${issue}`, { size: 10, color: "#dc2626" });
        });
        y += 2;
      }

      // ── AI Assessment ─────────────────────────────────────────────────────
      const aiNotes: string = data.compliance?.ai_notes ?? "";
      if (aiNotes) {
        checkPageBreak(20);
        writeText("AI Assessment", { size: 12, bold: true, color: "#1e3a5f" });
        y += 1;
        drawHRule("#bfdbfe");
        writeText(aiNotes, { size: 10, color: "#334155" });
        y += 3;
      }

      // ── Footer on every page ──────────────────────────────────────────────
      const ndisFooterPrinciple: string = data.ndis_principle ?? "If it cannot be evidenced, it cannot be claimed.";
      const totalPages = (pdf.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        pdf.setPage(pg);
        const footerY = pageH - 13;
        pdf.setDrawColor("#e2e8f0");
        pdf.setLineWidth(0.3);
        pdf.line(margin, footerY - 2, pageW - margin, footerY - 2);
        pdf.setFontSize(7.5);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor("#1e3a5f");
        pdf.text(`NDIS: "${ndisFooterPrinciple}"`, pageW / 2, footerY + 2, { align: "center", maxWidth: contentW });
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor("#94a3b8");
        pdf.text(
          "AI Clinical Companion — Confidential. For NDIS audit and compliance use only.",
          pageW / 2, footerY + 6.5, { align: "center", maxWidth: contentW }
        );
        pdf.text(`Page ${pg} of ${totalPages}`, pageW - margin, footerY + 6.5, { align: "right" });
      }

      // ── Save ──────────────────────────────────────────────────────────────
      const participantName = (p.full_name || "unknown")
        .toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const dateStr = (s.date || new Date().toISOString().slice(0, 10)).replace(/-/g, "_");
      pdf.save(`ndis_audit_${participantName}_${dateStr}.pdf`);
      toast({ title: "PDF exported", description: "NDIS audit report downloaded." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "PDF export failed", description: msg, variant: "destructive" });
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setTimeout(() => {
      toast({ title: "Photo uploaded", description: file.name });
      setIsUploading(false);
    }, 1500);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" /><Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) return <div className="p-8 text-slate-500">Session not found</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">

      {/* Blocking save warning dialog */}
      <AlertDialog open={showSaveWarning} onOpenChange={setShowSaveWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" /> Compliance Issues Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p className="text-slate-600">This session has critical compliance issues that may prevent it from meeting NDIS requirements:</p>
                <ul className="space-y-1.5">
                  {criticalLiveIssues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      {issue.msg}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-slate-500 mt-2">Fix these issues before saving or save a draft and come back.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fix First</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => { setShowSaveWarning(false); doSaveNotes(); }}
            >
              Save Draft Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">
              {session.participants?.full_name || "Session"}
            </h1>
            {/* Claim Readiness Status badge */}
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCfg.cls}`}>
              <statusCfg.icon className="h-3.5 w-3.5" />
              {statusCfg.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {session.session_date ? format(parseISO(session.session_date), "MMMM d, yyyy") : ""}
            </span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {session.duration_minutes} min</span>
            <span className="flex items-center gap-1.5"><Activity className="h-4 w-4" /> {session.session_type}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/patients">
            <Button variant="outline" size="sm">View Participant</Button>
          </Link>
          <Link href={`/sessions/${sessionId}/live`}>
            <Button variant="outline" size="sm" className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50">
              <Play className="h-3.5 w-3.5 fill-indigo-600" />
              Start Live
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportAudit}
            disabled={isExporting}
            title="Export audit record as JSON"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="sr-only sm:not-sr-only sm:ml-1.5 text-xs">
              {isExporting ? "Exporting…" : "Export Audit"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={isExportingPDF}
            title="Export NDIS audit report as PDF"
            className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
          >
            {isExportingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            <span className="sr-only sm:not-sr-only sm:ml-0.5 text-xs">
              {isExportingPDF ? "Generating…" : "Export PDF"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reRunCompliance.mutate()}
            disabled={reRunCompliance.isPending}
          >
            {reRunCompliance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Re-check
          </Button>
          <Button
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={handleAIAnalysis}
            disabled={saveWithAI.isPending}
            data-testid="button-ai-analyze"
          >
            {saveWithAI.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column — notes + transcription */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" /> Clinical Notes
              </CardTitle>
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setNotes(session.notes || ""); }}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveNotes} disabled={updateSession.isPending}>
                    {updateSession.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Save
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              {isEditing ? (
                <div className="space-y-3">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[280px] text-sm leading-relaxed resize-y"
                    placeholder="Enter clinical notes here. Include: what was done, participant response, measurable outcomes linked to NDIS goals..."
                  />
                  {/* Live compliance bar */}
                  {liveIssues.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 ${
                        criticalLiveIssues.length > 0
                          ? "bg-red-50 text-red-700 border-b border-red-100"
                          : "bg-amber-50 text-amber-700 border-b border-amber-100"
                      }`}>
                        {criticalLiveIssues.length > 0 ? (
                          <><XCircle className="h-3.5 w-3.5" /> {criticalLiveIssues.length} critical issue{criticalLiveIssues.length > 1 ? "s" : ""} — review before saving</>
                        ) : (
                          <><AlertTriangle className="h-3.5 w-3.5" /> {liveIssues.length} compliance warning{liveIssues.length > 1 ? "s" : ""}</>
                        )}
                      </div>
                      <ul className="p-2 space-y-1">
                        {liveIssues.map((issue, i) => (
                          <li key={i} className={`text-xs flex items-start gap-2 px-1 py-0.5 ${issue.type === "error" ? "text-red-700" : "text-amber-700"}`}>
                            {issue.type === "error"
                              ? <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                            {issue.msg}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {liveIssues.length === 0 && notes.length > 50 && (
                    <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Notes look good — no compliance issues detected
                    </div>
                  )}
                  {/* Character count */}
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{notes.length} characters</span>
                    <span className={notes.length < 50 ? "text-red-500" : notes.length < 200 ? "text-amber-500" : "text-emerald-500"}>
                      {notes.length < 50 ? "Too brief" : notes.length < 200 ? "Acceptable" : "Good length"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed">
                  {session.notes ? (
                    <div className="whitespace-pre-wrap">{session.notes}</div>
                  ) : (
                    <p className="text-slate-400 italic">No notes recorded yet. Click Edit to add clinical notes.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Structured Clinical Note Fields */}
          {(() => {
            const sections: { label: string; icon: typeof FileText; value: string | null | undefined; color: string }[] = [
              { label: "Activities Performed", icon: Activity, value: session.activities_performed, color: "text-teal-700" },
              { label: "Outcomes", icon: CheckCircle2, value: session.outcomes, color: "text-emerald-700" },
              { label: "Participant Response", icon: Brain, value: session.participant_response, color: "text-indigo-700" },
              { label: "Progress Toward Goals", icon: TrendingUp, value: session.progress_toward_goals, color: "text-blue-700" },
            ];
            const filledSections = sections.filter((sec) => sec.value && sec.value.trim());
            if (filledSections.length === 0) return null;
            return (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-3 flex flex-row items-center border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-slate-500" /> Structured Clinical Notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-5">
                  {filledSections.map(({ label, icon: Icon, value, color }) => (
                    <div key={label}>
                      <p className={`text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {value}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })()}

          {session.transcription && (
            <Card className="border-slate-200 shadow-sm bg-slate-50 dark:bg-slate-900/50">
              <CardHeader className="pb-3 border-b border-slate-200/50">
                <CardTitle className="text-sm font-medium text-slate-600">Audio Transcription</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{session.transcription}</p>
              </CardContent>
            </Card>
          )}

          {/* AI Insights panel */}
          {aiInsights && (
            <Card className="border-indigo-100 shadow-sm bg-indigo-50/30 dark:bg-indigo-900/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-900 dark:text-indigo-300">
                  <Brain className="h-4 w-4" /> AI Clinical Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {aiInsights.summary && (
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{aiInsights.summary}</p>
                )}
                {Array.isArray(aiInsights.key_observations) && aiInsights.key_observations.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Key Observations</p>
                    <ul className="space-y-1">
                      {aiInsights.key_observations.map((obs: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-indigo-400">•</span>{obs}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(aiInsights.next_session_recommendations) && aiInsights.next_session_recommendations.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Next Session</p>
                    <ul className="space-y-1">
                      {aiInsights.next_session_recommendations.map((rec: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-indigo-400">→</span>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiInsights.progress_trend && (
                  <div className="flex items-center gap-2 text-xs">
                    <TrendingUp className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="text-slate-500">Progress trend:</span>
                    <span className={`font-semibold capitalize ${
                      aiInsights.progress_trend === "improving" ? "text-emerald-600" :
                      aiInsights.progress_trend === "declining" ? "text-red-600" : "text-slate-600"
                    }`}>{aiInsights.progress_trend}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — compliance + tags/goals + photos */}
        <div className="space-y-6">

          {/* Compliance Score Card */}
          <Card className={`border-2 shadow-sm ${
            !session.compliance_score ? "border-slate-200 dark:border-slate-800" :
            claimStatus === "compliant" ? "border-emerald-200 bg-emerald-50/20" :
            claimStatus === "at_risk" ? "border-amber-200 bg-amber-50/20" :
            "border-red-200 bg-red-50/20"
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-slate-500" /> Compliance
                </span>
                {session.compliance_score != null && (
                  <span className={`text-lg font-bold ${
                    claimStatus === "compliant" ? "text-emerald-700" :
                    claimStatus === "at_risk" ? "text-amber-700" : "text-red-700"
                  }`}>
                    {Number(session.compliance_score).toFixed(0)}%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!session.compliance_score ? (
                <div className="text-center py-4 text-slate-500">
                  <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Not yet analyzed</p>
                  <Button variant="link" size="sm" onClick={handleAIAnalysis} className="mt-1 h-auto py-0 text-xs">
                    Run AI Analysis
                  </Button>
                </div>
              ) : (
                <>
                  {/* Score bar */}
                  <div>
                    <Progress
                      value={Number(session.compliance_score)}
                      className={`h-2.5 ${
                        claimStatus === "compliant" ? "[&>div]:bg-emerald-500" :
                        claimStatus === "at_risk" ? "[&>div]:bg-amber-500" :
                        "[&>div]:bg-red-500"
                      }`}
                    />
                    <div className="flex justify-between text-xs text-slate-400 mt-1">
                      <span>0</span><span>Target: 85+</span><span>100</span>
                    </div>
                  </div>

                  {/* Rules breakdown from rules engine */}
                  {rulesResult?.rules && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Rule Checks</p>
                      {rulesResult.rules.map((rule: { rule: string; status: string; message: string }, i: number) => (
                        <div key={i} className="flex items-start gap-2">
                          <RuleIcon status={rule.status} />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-snug capitalize">
                              {rule.rule.replace(/_/g, " ")}
                            </p>
                            {rule.status !== "pass" && (
                              <p className="text-[10px] text-slate-500 leading-snug">{rule.message}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Compliance notes from AI */}
                  {session.compliance_notes && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-500 font-medium mb-1">AI Assessment:</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{session.compliance_notes}</p>
                    </div>
                  )}

                  {/* AI Fix Suggestions */}
                  {rulesResult?.failed_rules?.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                      {!showExplanation ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-1.5 text-xs h-8"
                          onClick={() => { setShowExplanation(true); fetchExplanation(); }}
                        >
                          <Lightbulb className="h-3.5 w-3.5" />
                          Get AI Fix Suggestions
                        </Button>
                      ) : explanationLoading ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting suggestions...
                        </div>
                      ) : explanation ? (
                        <div className={`rounded-lg p-3 text-xs space-y-2 ${
                          explanation.priority === "critical"
                            ? "bg-red-50 border border-red-100"
                            : "bg-amber-50 border border-amber-100"
                        }`}>
                          <p className={`font-semibold flex items-center gap-1 ${
                            explanation.priority === "critical" ? "text-red-800" : "text-amber-800"
                          }`}>
                            <Lightbulb className="h-3.5 w-3.5" /> AI Explanation
                          </p>
                          <p className="text-slate-700 leading-relaxed">{explanation.explanation}</p>
                          {explanation.fix_suggestion && (
                            <div className="pt-2 border-t border-current/10">
                              <p className="font-semibold text-slate-700 mb-1">How to fix:</p>
                              <p className="text-slate-600 whitespace-pre-line leading-relaxed">
                                {explanation.fix_suggestion}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Tags & Goals */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tags & Goals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Tags</p>
                {session.tags && session.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {session.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="font-normal text-xs">{tag}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No tags</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">NDIS Goals Addressed</p>
                {session.goals_addressed && session.goals_addressed.length > 0 ? (
                  <ul className="space-y-1">
                    {(session.goals_addressed as string[]).map((goal, i) => (
                      <li key={i} className="text-xs text-slate-700 flex gap-2">
                        <span className="text-primary">•</span> {goal}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">No goals linked — edit session to add goals</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Cost & Category */}
          {((session as ExtendedSession).cost || (session as ExtendedSession).support_category) && (
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-slate-400" /> Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {(session as ExtendedSession).support_category && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Category</span>
                    <span className="font-medium capitalize">{String((session as ExtendedSession).support_category).replace("_", " ")}</span>
                  </div>
                )}
                {(session as ExtendedSession).cost && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Session Cost</span>
                    <span className="font-semibold">${Number((session as ExtendedSession).cost).toFixed(2)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Photos */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Photos
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="sr-only sm:not-sr-only sm:ml-2 text-xs">Upload</span>
              </Button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
            </CardHeader>
            <CardContent>
              {session.photo_urls && session.photo_urls.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {(session.photo_urls as string[]).map((url, i) => (
                    <div key={i} className="aspect-square rounded-md bg-slate-100 overflow-hidden border border-slate-200">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-md border border-dashed border-slate-200">
                  <ImageIcon className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No photos attached</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
