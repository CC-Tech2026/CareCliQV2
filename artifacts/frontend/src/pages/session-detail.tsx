import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useGetSession, useUpdateSession, useSaveSessionWithAI, useGetParticipant } from "@workspace/api-client-react";
import type { Session } from "@workspace/api-client-react";
import { exportSingleSessionPDF } from "@/lib/pdf-export";

import { BodyExaminationPanel } from "@/components/BodyExaminationPanel";
import type { BodyMarker } from "@/components/BodyMap";

// Extended session type with extra DB columns not yet in the OpenAPI spec
type ExtendedSession = Session & {
  cost?: number | null;
  support_category?: string | null;
  compliance_status?: string | null;
  body_markers?: BodyMarker[] | null;
  translated_english_note?: string | null;
  compliance_input_text?: string | null;
  original_language_input?: string | null;
  detected_language?: string | null;
  translation_status?: string | null;
  translation_metadata?: Record<string, unknown> | null;
};

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
  RefreshCw, Lightbulb, Shield, TrendingUp, DollarSign, Play, Download, Tags, Target
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";

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

  const participantId = (session as ExtendedSession & { participant_id?: string })?.participant_id ?? "";
  const { data: participant } = useGetParticipant(participantId, {
    query: { enabled: !!participantId, queryKey: ["getParticipant", participantId] },
  });

  const updateSession = useUpdateSession();
  const saveWithAI = useSaveSessionWithAI();

  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showSaveWarning, setShowSaveWarning] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; file_name: string; public_url?: string; file_path?: string; mime_type?: string }>>([]);

  useEffect(() => {
    const extended = session as ExtendedSession | undefined;
    const legalNote = extended?.translated_english_note || extended?.compliance_input_text || session?.notes || "";
    if (session && !isEditing) setNotes(legalNote);
  }, [session, isEditing]);

  useEffect(() => {
    if (!sessionId) return;
    apiFetch(`/api/sessions/${sessionId}/attachments`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load attachments");
        return res.json();
      })
      .then((data) => setAttachments(Array.isArray(data) ? data : []))
      .catch(() => setAttachments([]));
  }, [sessionId]);

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
      const res = await apiFetch("/api/ai/explain-compliance", {
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
      const res = await apiFetch(`/api/compliance/run/${sessionId}`, { method: "POST" });
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
      const res = await apiFetch(`/api/sessions/${sessionId}/audit`);
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
      await exportSingleSessionPDF(sessionId);
      toast({ title: "PDF exported", description: "NDIS audit report downloaded." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "PDF export failed", description: msg, variant: "destructive" });
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(`/api/sessions/${sessionId}/attachments`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setAttachments((prev) => [...prev, data]);
      toast({ title: "Attachment uploaded", description: file.name });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto p-4">
        <Skeleton className="h-12 w-1/3 animate-pulse bg-slate-200" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full bg-slate-200" />
            <Skeleton className="h-48 w-full bg-slate-200" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full bg-slate-200" />
            <Skeleton className="h-48 w-full bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) return <div className="p-8 text-slate-500 text-center font-medium">Session record not found.</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 px-4 pt-4">

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
              className="bg-amber-600 hover:bg-amber-700 text-white"
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
              {session.participants?.full_name || "Session Record"}
            </h1>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCfg.cls}`}>
              <statusCfg.icon className="h-3.5 w-3.5" />
              {statusCfg.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-[13px] flex-wrap" style={{ color: "#4A3D5A" }}>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-slate-400" />
              {session.session_date ? format(parseISO(session.session_date), "MMMM d, yyyy") : "No Date Listed"}
            </span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-slate-400" /> {session.duration_minutes || 0} min</span>
            <span className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-slate-400" /> {session.session_type}</span>
          </div>
        </div>

        {/* Top bar control utilities */}
        <div className="flex gap-2 flex-wrap items-center">
          <Link href="/patients">
            <Button variant="outline" size="sm">View Participant</Button>
          </Link>
          <Link href={`/sessions/${sessionId}/live`}>
            <Button variant="outline" size="sm" className="gap-1.5 rounded-xl"
              style={{ color: "#542269", borderColor: "rgba(84,34,105,0.25)" }}>
              <Play className="h-3.5 w-3.5" style={{ fill: "#542269" }} />
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
            className="gap-1.5 rounded-xl"
            style={{ color: "#542269", borderColor: "rgba(84,34,105,0.20)" }}
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
            className="gap-2 text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #F1738A 0%, #542269 100%)" }}
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

        {/* Left column — notes + transcription + structural outputs */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <div className="px-5 py-4 flex flex-row items-center justify-between border-b" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
              <div className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "#1C1626" }}>
                <FileText className="h-4 w-4" style={{ color: "#7A6A8A" }} /> Clinical Notes
              </div>
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => {
                    const extended = session as ExtendedSession;
                    setIsEditing(false);
                    setNotes(extended.translated_english_note || extended.compliance_input_text || session.notes || "");
                  }}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveNotes} disabled={updateSession.isPending}>
                    {updateSession.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Save
                  </Button>
                </div>
              )}
            </div>
            <div className="p-5">
              {isEditing ? (
                <div className="space-y-3">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[280px] text-[13px] leading-relaxed resize-y rounded-xl"
                    style={{ borderColor: "rgba(232,213,232,0.5)" }}
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
                      <ul className="p-2 space-y-1 bg-slate-50/50">
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
                  {/* Character count metrics */}
                  <div className="flex justify-between text-[11px]" style={{ color: "#7A6A8A" }}>
                    <span>{notes.length} characters</span>
                    <span className={notes.length < 50 ? "text-red-500" : notes.length < 200 ? "text-amber-500" : "text-emerald-500"}>
                      {notes.length < 50 ? "Too brief" : notes.length < 200 ? "Acceptable" : "Good length"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="max-w-none text-[13px] leading-relaxed" style={{ color: "#4A3D5A" }}>
                  {notes ? (
                    <div className="whitespace-pre-wrap">{notes}</div>
                  ) : (
                    <p className="italic" style={{ color: "#7A6A8A" }}>No notes recorded yet. Click Edit to add clinical notes.</p>
                  )}
                </div>
              )}
            </div>
          </div>

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
              <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                  <Shield className="h-4 w-4" style={{ color: "#7A6A8A" }} />
                  <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>Structured Clinical Notes</p>
                </div>
                <div className="p-5 space-y-5">
                  {filledSections.map(({ label, icon: Icon, value, color }) => (
                    <div key={label}>
                      <p className={`text-[11px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1.5 ${color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </p>
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: "#4A3D5A" }}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {session.transcription && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "#F6F4FB", border: "1px solid rgba(232,213,232,0.5)" }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                <p className="text-[13px] font-medium" style={{ color: "#4A3D5A" }}>Audio Transcription</p>
              </div>
              <div className="p-5">
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: "#4A3D5A" }}>{session.transcription}</p>
              </div>
            </div>
          )}

          {/* AI Insights panel */}
          {aiInsights && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(84,34,105,0.03)", border: "1px solid rgba(84,34,105,0.12)" }}>
              <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "rgba(84,34,105,0.10)" }}>
                <Brain className="h-4 w-4" style={{ color: "#542269" }} />
                <p className="text-[14px] font-semibold" style={{ color: "#542269" }}>AI Clinical Insights</p>
              </div>
              <div className="p-5 space-y-4">
                {aiInsights.summary && (
                  <p className="text-[13px] leading-relaxed" style={{ color: "#4A3D5A" }}>{aiInsights.summary}</p>
                )}
                {Array.isArray(aiInsights.key_observations) && aiInsights.key_observations.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "#7A6A8A" }}>Key Observations</p>
                    <ul className="space-y-1">
                      {aiInsights.key_observations.map((obs: string, i: number) => (
                        <li key={i} className="text-[13px] flex gap-2" style={{ color: "#4A3D5A" }}><span style={{ color: "#F1738A" }}>•</span>{obs}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(aiInsights.next_session_recommendations) && aiInsights.next_session_recommendations.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "#7A6A8A" }}>Next Session</p>
                    <ul className="space-y-1">
                      {aiInsights.next_session_recommendations.map((rec: string, i: number) => (
                        <li key={i} className="text-[13px] flex gap-2" style={{ color: "#4A3D5A" }}><span style={{ color: "#542269" }}>→</span>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(aiInsights.concerns) && aiInsights.concerns.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-red-500 font-semibold mb-1.5">Concerns</p>
                    <ul className="space-y-1">
                      {aiInsights.concerns.map((c: string, i: number) => (
                        <li key={i} className="text-[13px] text-red-700 flex gap-2"><span>⚠</span>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(aiInsights.ai_recommendations) && aiInsights.ai_recommendations.length > 0 && (
                  <div className="pt-3 border-t" style={{ borderColor: "rgba(84,34,105,0.10)" }}>
                    <p className="text-[11px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "#542269" }}>AI Recommendations</p>
                    <ul className="space-y-1">
                      {aiInsights.ai_recommendations.map((r: string, i: number) => (
                        <li key={i} className="text-[13px] flex gap-2" style={{ color: "#4A3D5A" }}><span style={{ color: "#542269" }}>→</span>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(aiInsights.ai_flags) && aiInsights.ai_flags.length > 0 && (
                  <div className="pt-3 border-t border-amber-100">
                    <p className="text-[11px] uppercase tracking-widest text-amber-600 font-semibold mb-1.5">Compliance Flags</p>
                    <ul className="space-y-1">
                      {aiInsights.ai_flags.map((f: string, i: number) => (
                        <li key={i} className="text-[12px] text-amber-700 flex gap-2 bg-amber-50 rounded px-2 py-1"><span>⚑</span>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiInsights.progress_trend && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <TrendingUp className="h-3.5 w-3.5" style={{ color: "#542269" }} />
                    <span style={{ color: "#7A6A8A" }}>Progress trend:</span>
                    <span className={`font-semibold capitalize ${
                      aiInsights.progress_trend === "improving" ? "text-emerald-600" :
                      aiInsights.progress_trend === "declining" ? "text-red-600" : ""
                    }`} style={!["improving","declining"].includes(aiInsights.progress_trend) ? { color: "#4A3D5A" } : {}}>
                      {aiInsights.progress_trend}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Physical Examination panel */}
          {(() => {
            const markers = (session as ExtendedSession).body_markers;
            if (!markers || markers.length === 0) return null;
            return (
              <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
                <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                  <Activity className="h-4 w-4" style={{ color: "#7A6A8A" }} />
                  <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>Physical Examination</p>
                </div>
                <div className="p-5">
                  <BodyExaminationPanel
                    markers={markers}
                    readOnly
                    bodyType={participant?.biological_sex ?? "unspecified"}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right column — compliance score breakdowns + linked targets + metadata tools */}
        <div className="space-y-6">

          {/* Compliance Score Card */}
          <div className="rounded-2xl overflow-hidden bg-white" style={{
            boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)",
            ...(session.compliance_score
              ? claimStatus === "compliant"
                ? { borderLeft: "3px solid #10b981" }
                : claimStatus === "at_risk"
                ? { borderLeft: "3px solid #f59e0b" }
                : { borderLeft: "3px solid #ef4444" }
              : {}),
          }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
              <div className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "#1C1626" }}>
                <ShieldAlert className="h-4 w-4 text-slate-500" /> NDIS Audit Audit Score
              </div>
              <Badge variant={claimStatus === "compliant" ? "default" : "secondary"} className="text-xs">
                {session.compliance_score != null ? `${session.compliance_score.toFixed(0)}%` : "N/A"}
              </Badge>
            </div>

            <div className="p-5 space-y-4">
              {session.compliance_score != null && (
                <div className="space-y-1.5">
                  <Progress 
                    value={session.compliance_score} 
                    className={`h-2 ${
                      claimStatus === "compliant" ? "[&>div]:bg-emerald-500" : 
                      claimStatus === "at_risk" ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500"
                    }`}
                  />
                  <p className="text-[11px] text-slate-500 text-right font-medium">
                    Target NDIS Threshold: 85%
                  </p>
                </div>
              )}

              {/* Rules Verification Matrix */}
              {rulesResult && (
                <div className="pt-2 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Rule Parameters Check</p>
                  <div className="space-y-2 text-xs">
                    {Array.isArray(rulesResult.passed_rules) && rulesResult.passed_rules.map((rule: { rule: string } | string) => {
                      const ruleName = typeof rule === "string" ? rule : (rule?.rule ?? String(rule));
                      return (
                        <div key={ruleName} className="flex items-center gap-2 text-slate-600 bg-slate-50 p-1.5 rounded-lg">
                          <RuleIcon status="pass" />
                          <span className="capitalize">{ruleName.replace(/_/g, " ")}</span>
                        </div>
                      );
                    })}
                    {Array.isArray(rulesResult.failed_rules) && rulesResult.failed_rules.map((rule: { rule: string } | string) => {
                      const ruleName = typeof rule === "string" ? rule : (rule?.rule ?? String(rule));
                      return (
                        <div key={ruleName} className="flex items-center gap-2 text-red-800 bg-red-50/60 p-1.5 rounded-lg">
                          <RuleIcon status="fail" />
                          <span className="capitalize font-medium">{ruleName.replace(/_/g, " ")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Explanation Expandable Widget */}
              {rulesResult?.failed_rules?.length > 0 && (
                <div className="pt-2">
                  {!showExplanation ? (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full text-xs gap-1"
                      onClick={() => { setShowExplanation(true); fetchExplanation(); }}
                    >
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Explain Failed Rules
                    </Button>
                  ) : (
                    <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-3.5 space-y-2 text-xs text-amber-900 animate-in fade-in duration-150">
                      <div className="flex justify-between items-center">
                        <p className="font-bold flex items-center gap-1"><Lightbulb className="h-3.5 w-3.5 text-amber-600" /> Remediation Insight</p>
                        <Button variant="ghost" className="h-5 p-1 text-slate-400" onClick={() => setShowExplanation(false)}>Hide</Button>
                      </div>
                      {explanationLoading ? (
                        <div className="flex items-center gap-2 text-slate-500 py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Querying compliance definitions...
                        </div>
                      ) : explanation ? (
                        <div className="space-y-2 leading-relaxed">
                          <p>{explanation.explanation}</p>
                          <div className="bg-white/80 p-2 rounded-lg border border-amber-200/40 font-medium">
                            <span className="text-amber-700 font-bold">Actionable Fix:</span> {explanation.fix_suggestion}
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-500">Failed to pull explanation details.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Linked Goals & Tags */}
          <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
              <Target className="h-4 w-4 text-slate-500" />
              <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>NDIS Core Mapping</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Target className="h-3 w-3" /> Linked Goals</p>
                {Array.isArray(session.goals_addressed) && session.goals_addressed.length > 0 ? (
                  <div className="space-y-1.5">
                    {session.goals_addressed.map((goal: string, index: number) => (
                      <div key={index} className="text-xs bg-indigo-50/50 border border-indigo-100/40 text-indigo-900 px-2.5 py-1.5 rounded-lg font-medium leading-normal">
                        {goal}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-slate-400">No specific NDIS strategic support goals linked.</p>
                )}
              </div>

              <div className="pt-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Tags className="h-3 w-3" /> Categorization Tags</p>
                {Array.isArray(session.tags) && session.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {session.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-slate-100 text-slate-700 border">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-slate-400">No labels attached.</p>
                )}
              </div>
            </div>
          </div>

          {/* Funding Support Category & Billing Metrics */}
          <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
              <DollarSign className="h-4 w-4 text-slate-500" />
              <p className="text-[14px] font-semibold" style={{ color: "#1C1626" }}>Billing Accounts</p>
            </div>
            <div className="p-4 space-y-3 text-xs font-medium">
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="text-slate-500">Support Category:</span>
                <span className="text-slate-800 font-bold">{(session as ExtendedSession).support_category || "Capacity Building"}</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
                <span className="text-slate-500">Calculated Cost:</span>
                <span className="text-slate-900 font-extrabold text-[13px]">
                  {(session as ExtendedSession).cost != null ? `$${(session as ExtendedSession).cost?.toFixed(2)}` : "Uncalculated"}
                </span>
              </div>
            </div>
          </div>

          {/* Media Attachments & Session Evidence */}
          <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
              <div className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "#1C1626" }}>
                <ImageIcon className="h-4 w-4 text-slate-500" /> Evidence Uploads
              </div>
            </div>
            <div className="p-5 space-y-4">
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileUpload}
              />
              <Button 
                variant="outline" 
                className="w-full border-dashed h-20 flex flex-col justify-center items-center gap-1 rounded-xl hover:bg-slate-50/80 transition-colors"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-600">Upload Observation Media</span>
                  </>
                )}
              </Button>
              {attachments.length > 0 && (
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.public_url || attachment.file_path || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <FileText className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{attachment.file_name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
