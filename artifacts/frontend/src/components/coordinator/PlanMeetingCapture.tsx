import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Mic, Pause, Play, Loader2, Check, X, Pencil,
  AlertTriangle, FileText, MessageSquare, Download, ChevronRight, Target, ListChecks, ArrowLeft, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/download-file";
import { TranscriptViewer } from "./TranscriptViewer";
import {
  createMeetingSession,
  transcribeAndResolveNames,
  extractGoalsAndTasks,
  applyPlanMeetingSuggestions,
  listPlanMeetings,
  getPlanMeeting,
  type PlanMeeting,
  type PlanMeetingType,
  type Stage1ResolutionResult,
  type Stage2ExtractionResult,
  type ExtractedGoalPayload,
  type ExtractedTaskPayload,
  type ConsentGivenBy,
  type ConsentMethod,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const GREEN  = "#166534";
const GREEN_BG     = "rgba(22,101,52,0.06)";
const GREEN_BORDER = "rgba(22,101,52,0.2)";
const CORAL  = "#BE185D";

const MEETING_TYPE_META: Record<PlanMeetingType, { label: string; abbr: string; color: string; bg: string }> = {
  plan_review:       { label: "Plan Review",        abbr: "PR", color: "#3730A3", bg: "rgba(55,48,163,0.08)"  },
  initial_setup:     { label: "Initial Setup",      abbr: "IS", color: GREEN,     bg: GREEN_BG               },
  check_in:          { label: "Check-In",           abbr: "CI", color: "#0369A1", bg: "rgba(3,105,161,0.08)"  },
  incident_followup: { label: "Incident Follow-Up", abbr: "IF", color: CORAL,     bg: "rgba(190,24,93,0.08)"  },
  goal_review:       { label: "Goal Review",        abbr: "GR", color: "#B45309", bg: "rgba(180,83,9,0.08)"   },
};

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending_review: { label: "Pending review", bg: "#FFFBEB", color: "#92400E" },
  reviewed:       { label: "Reviewed",       bg: "#EFF6FF", color: "#1D4ED8" },
  applied:        { label: "Applied",        bg: "#F0FDF4", color: GREEN     },
};

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function confidenceStyle(confidence: number): { bg: string; color: string; label: string } {
  const pct = Math.round(confidence * 100);
  if (pct >= 85) return { bg: GREEN_BG, color: GREEN, label: `${pct}%` };
  if (pct >= 60) return { bg: "#FFFBEB", color: "#B45309", label: `${pct}%` };
  return { bg: "#FEF2F2", color: CORAL, label: `${pct}%` };
}

// ── Draft item types ────────────────────────────────────────────────────────────

type DraftStatus = "pending" | "accepted" | "rejected";

interface DraftGoal {
  localId: string;
  text: string;
  support_category: string;
  source_segment_ids: string[];
  confidence: number;
  status: DraftStatus;
}

interface DraftTask {
  localId: string;
  text: string;
  requirement_level: "mandatory" | "optional";
  source_segment_ids: string[];
  confidence: number;
  linkedGoalLocalId: string | null;
  status: DraftStatus;
}

function resolveQuote(
  segmentIds: string[],
  cleanTranscript: Stage1ResolutionResult["clean_transcript"],
): { speaker: string; text: string } | null {
  const matches = cleanTranscript.filter((seg) => seg.segment_id && segmentIds.includes(seg.segment_id));
  if (matches.length === 0) return null;
  return {
    speaker: matches[0].speaker_name || "Participant",
    text: matches.map((m) => m.text).join(" "),
  };
}

// ── Draft card ──────────────────────────────────────────────────────────────────

function DraftCard({
  kind, text, badgeLabel, confidence, quote, editing, editValue,
  onToggleAccept, onStartEdit, onChangeEdit, onSaveEdit, onCancelEdit, onReject, accepted,
}: {
  kind: "goal" | "task";
  text: string;
  badgeLabel: string;
  confidence: number;
  quote: { speaker: string; text: string } | null;
  editing: boolean;
  editValue: string;
  accepted: boolean;
  onToggleAccept: () => void;
  onStartEdit: () => void;
  onChangeEdit: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReject: () => void;
}) {
  const conf = confidenceStyle(confidence);
  return (
    <div className="rounded-xl p-3" style={{ border: `2px solid ${accepted ? GREEN : BORDER}`, background: accepted ? GREEN_BG : "#fff" }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>
          {kind === "goal" ? "Goal" : "Task"} · {badgeLabel}
        </span>
        <span className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0" style={{ background: conf.bg, color: conf.color }}>
          {conf.label}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editValue}
            onChange={(e) => onChangeEdit(e.target.value)}
            rows={3}
            aria-label={kind === "goal" ? "Edit goal text" : "Edit task text"}
            placeholder={kind === "goal" ? "Goal description" : "Task description"}
            className="w-full text-[12px] rounded-lg p-2 outline-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
          />
          <div className="flex gap-2">
            <Button size="sm" className="rounded-lg" style={{ background: PLUM, color: "#fff" }} onClick={onSaveEdit}>
              Save
            </Button>
            <Button size="sm" variant="outline" className="rounded-lg" style={{ borderColor: BORDER }} onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[13px] font-semibold mb-1.5" style={{ color: TEXT }}>{text}</p>
          {quote && (
            <p className="text-[11px] italic px-2.5 py-1.5 rounded-lg mb-2 leading-relaxed" style={{ background: SOFT, color: MUTED }}>
              "{quote.text}" <span className="not-italic font-semibold">— {quote.speaker}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleAccept}
              className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-black rounded-lg py-1.5 hover:opacity-90 transition-opacity"
              style={{ background: accepted ? GREEN : PLUM, color: "#fff" }}
            >
              <Check size={13} /> {accepted ? "Accepted" : "Accept"}
            </button>
            <button
              type="button"
              onClick={onStartEdit}
              aria-label="Edit"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <Pencil size={13} style={{ color: MUTED }} />
            </button>
            <button
              type="button"
              onClick={onReject}
              aria-label="Reject"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <X size={13} style={{ color: CORAL }} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Record + review flow ─────────────────────────────────────────────────────────

function ConsentPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 h-10 rounded-full text-[13px] font-bold transition-all"
      style={active ? { background: PLUM, color: "#fff" } : { background: "#fff", color: TEXT, border: `1px solid ${BORDER}` }}
    >
      {label}
    </button>
  );
}

type Phase = "idle" | "recording" | "processing" | "review";

interface RecordMeetingFlowProps {
  participantId: string;
  participantName: string;
  onDone: () => void;
  onCancel: () => void;
}

function RecordMeetingFlow({ participantId, participantName, onDone, onCancel }: RecordMeetingFlowProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [meetingType, setMeetingType] = useState<PlanMeetingType>("check_in");
  const [phase, setPhase] = useState<Phase>("idle");
  const [voiceNotSupported, setVoiceNotSupported] = useState(false);
  const [startingSession, setStartingSession] = useState(false);

  const [consentGivenBy, setConsentGivenBy] = useState<ConsentGivenBy>("participant");
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("verbal");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const [processingMessage, setProcessingMessage] = useState("Transcribing audio…");
  const [stage1Results, setStage1Results] = useState<Stage1ResolutionResult | null>(null);
  const [attentionFlags, setAttentionFlags] = useState<Stage2ExtractionResult["attention_flags"]>([]);
  const [draftGoals, setDraftGoals] = useState<DraftGoal[]>([]);
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [activeTab, setActiveTab] = useState<"drafts" | "transcript">("drafts");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceNotSupported(true);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (phase === "recording" && !isPaused) {
      interval = setInterval(() => setElapsedTime((t) => t + 1), 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [phase, isPaused]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const canPause = !!mediaRecorder && typeof mediaRecorder.pause === "function";

  // ── Start: mic permission → create session → begin recording ──────────────────

  const beginRecording = (stream: MediaStream, sid: string) => {
    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "audio/mp4";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const audioBlob = new Blob(chunks, { type: mimeType });
      // `sid` is captured directly (not read from `sessionId` state) because this
      // handler is wired up once, synchronously, before the setSessionId() state
      // update above has taken effect — reading state here would see a stale null.
      await processRecording(audioBlob, sid);
    };
    recorder.start();
    setMediaRecorder(recorder);
    setElapsedTime(0);
    setIsPaused(false);
    setPhase("recording");
  };

  const handleMicTap = async () => {
    if (!consentConfirmed) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceNotSupported(true);
      toast({ variant: "destructive", title: "Voice recording not supported", description: "Please use a different browser or device." });
      return;
    }
    setStartingSession(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let sid: string;
      try {
        const session = await createMeetingSession(
          meetingType,
          new Date().toISOString().slice(0, 10),
          undefined,
          participantId,
          consentGivenBy,
          consentMethod,
        );
        sid = session.session_id;
        setSessionId(sid);
      } catch (err: any) {
        stream.getTracks().forEach((t) => t.stop());
        toast({ variant: "destructive", title: "Failed to create session", description: err?.message ?? "" });
        return;
      }
      beginRecording(stream, sid);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        toast({ variant: "destructive", title: "Microphone access denied", description: "Allow microphone access to record." });
      } else if (err.name === "NotFoundError") {
        setVoiceNotSupported(true);
        toast({ variant: "destructive", title: "No microphone found", description: "Connect a microphone to record." });
      } else if (err.name === "SecurityError") {
        setVoiceNotSupported(true);
        toast({ variant: "destructive", title: "Security error", description: "Voice recording requires HTTPS." });
      } else {
        toast({ variant: "destructive", title: "Failed to start recording", description: err?.message ?? "" });
      }
    } finally {
      setStartingSession(false);
    }
  };

  const togglePause = () => {
    if (!mediaRecorder) return;
    try {
      if (isPaused) { mediaRecorder.resume(); setIsPaused(false); }
      else { mediaRecorder.pause(); setIsPaused(true); }
    } catch {
      // pause/resume unsupported on this browser mid-stream — ignore
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && phase === "recording") {
      setProcessingMessage("Finishing recording…");
      setPhase("processing");
      mediaRecorder.stop();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.onstop = null;
      if (phase === "recording") mediaRecorder.stop();
      if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
    setMediaRecorder(null);
    setElapsedTime(0);
    setIsPaused(false);
    setConsentConfirmed(false);
    setPhase("idle");
  };

  // ── Processing: Stage 1 → Stage 2, auto-chained ────────────────────────────────

  const processRecording = async (audioBlob: Blob, sid: string) => {
    try {
      setProcessingMessage("Transcribing audio…");
      const stage1 = await transcribeAndResolveNames(sid, audioBlob, "", "", []);
      setStage1Results(stage1);

      setProcessingMessage("Drafting goals & tasks…");
      const stage2 = await extractGoalsAndTasks(sid);

      setDraftGoals(stage2.goals.map((g, i) => ({
        localId: `g-${i}`,
        text: g.goal_text,
        support_category: g.support_category,
        source_segment_ids: g.source_segment_ids,
        confidence: g.confidence,
        status: "pending",
      })));
      setDraftTasks(stage2.tasks.map((t, i) => ({
        localId: `t-${i}`,
        text: t.task_text,
        requirement_level: t.requirement_level,
        source_segment_ids: t.source_segment_ids,
        confidence: t.confidence,
        linkedGoalLocalId: t.linked_goal_index != null ? `g-${t.linked_goal_index}` : null,
        status: "pending",
      })));
      setAttentionFlags(stage2.attention_flags);
      setActiveTab("drafts");
      setPhase("review");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Processing failed", description: err?.message ?? "Transcription or goal extraction failed." });
      setPhase("idle");
    }
  };

  const reRecord = () => {
    setSessionId(null);
    setStage1Results(null);
    setAttentionFlags([]);
    setDraftGoals([]);
    setDraftTasks([]);
    setEditingId(null);
    setElapsedTime(0);
    // Each new recording attempt needs its own consent confirmation.
    setConsentConfirmed(false);
    setPhase("idle");
  };

  // ── Review: accept / edit / reject ─────────────────────────────────────────────

  const toggleAcceptGoal = (localId: string) =>
    setDraftGoals((prev) => prev.map((g) => g.localId === localId ? { ...g, status: g.status === "accepted" ? "pending" : "accepted" } : g));
  const toggleAcceptTask = (localId: string) =>
    setDraftTasks((prev) => prev.map((t) => t.localId === localId ? { ...t, status: t.status === "accepted" ? "pending" : "accepted" } : t));

  const rejectGoal = (localId: string) => setDraftGoals((prev) => prev.map((g) => g.localId === localId ? { ...g, status: "rejected" } : g));
  const rejectTask = (localId: string) => setDraftTasks((prev) => prev.map((t) => t.localId === localId ? { ...t, status: "rejected" } : t));

  const startEdit = (localId: string, currentText: string) => { setEditingId(localId); setEditValue(currentText); };
  const cancelEdit = () => { setEditingId(null); setEditValue(""); };
  const saveEdit = (kind: "goal" | "task", localId: string) => {
    if (kind === "goal") setDraftGoals((prev) => prev.map((g) => g.localId === localId ? { ...g, text: editValue } : g));
    else setDraftTasks((prev) => prev.map((t) => t.localId === localId ? { ...t, text: editValue } : t));
    setEditingId(null);
    setEditValue("");
  };

  const visibleGoals = draftGoals.filter((g) => g.status !== "rejected");
  const visibleTasks = draftTasks.filter((t) => t.status !== "rejected");
  const acceptedGoals = draftGoals.filter((g) => g.status === "accepted");
  const acceptedTasks = draftTasks.filter((t) => t.status === "accepted");
  const totalAccepted = acceptedGoals.length + acceptedTasks.length;

  const cleanTranscript = stage1Results?.clean_transcript ?? [];

  // ── Export ──────────────────────────────────────────────────────────────────

  const exportRows = () => [
    ...visibleGoals.map((g) => ({ type: "Goal", text: g.text, category: formatLabel(g.support_category), confidence: g.confidence, quote: resolveQuote(g.source_segment_ids, cleanTranscript) })),
    ...visibleTasks.map((t) => ({ type: "Task", text: t.text, category: formatLabel(t.requirement_level), confidence: t.confidence, quote: resolveQuote(t.source_segment_ids, cleanTranscript) })),
  ];

  const exportCsv = () => {
    const rows = exportRows();
    const csv = [
      ["Type", "Item", "Category", "Confidence", "Quote"],
      ...rows.map((r) => [r.type, r.text, r.category, `${Math.round(r.confidence * 100)}%`, r.quote ? `${r.quote.speaker}: ${r.quote.text}` : ""]),
    ].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), "plan-meeting-drafts.csv");
  };

  const exportPdf = async () => {
    const rows = exportRows();
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Plan Meeting Drafts", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, 25);
    autoTable(doc, {
      startY: 32,
      head: [["Type", "Item", "Category", "Confidence", "Quote"]],
      body: rows.map((r) => [r.type, r.text, r.category, `${Math.round(r.confidence * 100)}%`, r.quote ? `${r.quote.speaker}: ${r.quote.text}` : "—"]),
      styles: { fontSize: 8 },
      columnStyles: { 1: { cellWidth: 55 }, 4: { cellWidth: 55 } },
    });
    doc.save("plan-meeting-drafts.pdf");
  };

  // ── Apply ───────────────────────────────────────────────────────────────────

  const applyMut = useMutation({
    mutationFn: () => {
      const goalPayload: ExtractedGoalPayload[] = acceptedGoals.map((g) => ({
        goal_text: g.text,
        support_category: g.support_category,
      }));
      const taskPayload: ExtractedTaskPayload[] = acceptedTasks.map((t) => {
        const linkedGoal = t.linkedGoalLocalId ? acceptedGoals.find((g) => g.localId === t.linkedGoalLocalId) : undefined;
        return {
          task_text: t.text,
          requirement_level: t.requirement_level,
          linked_goal_text: linkedGoal?.text ?? null,
        };
      });
      return applyPlanMeetingSuggestions(sessionId as string, goalPayload, taskPayload);
    },
    onSuccess: (result) => {
      const goalsShort = result.goals_created < acceptedGoals.length;
      const tasksShort = result.tasks_created < acceptedTasks.length;
      toast({
        title: `Applied: ${result.goals_created} goal(s) and ${result.tasks_created} task(s) created.`,
        variant: goalsShort || tasksShort ? "destructive" : undefined,
        description: goalsShort || tasksShort ? "Some accepted items failed to save — check Goals & Tasks and try again." : undefined,
      });
      qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
      // Goals/tasks queries are org-scoped via useOrgQuery, which prepends orgId to
      // the real query key — match by key membership instead of a fixed prefix.
      qc.invalidateQueries({ predicate: (query) => query.queryKey.includes("ndis-goals") });
      qc.invalidateQueries({ predicate: (query) => query.queryKey.includes("participant-tasks") });
      onDone();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Failed to apply", description: err?.message ?? "" }),
  });

  // ── Render: idle ────────────────────────────────────────────────────────────

  if (phase === "idle") {
    const consentGivenByLabel = consentGivenBy === "participant" ? participantName : `${participantName}'s ${consentGivenBy}`;
    const nowLabel = new Date().toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}>Meeting type</span>
          <select
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as PlanMeetingType)}
            aria-label="Meeting type"
            className="text-[12px] font-semibold rounded-full px-3 py-1 outline-none"
            style={{ border: `1px solid ${BORDER}`, color: PLUM, background: "#fff" }}
          >
            {(Object.entries(MEETING_TYPE_META) as [PlanMeetingType, typeof MEETING_TYPE_META[PlanMeetingType]][]).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl p-5 flex items-start gap-3" style={{ background: CORAL }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="font-black text-[15px] text-white">Consent required</p>
            <p className="text-[13px] text-white mt-0.5" style={{ opacity: 0.9 }}>
              Recording cannot start without explicit consent.
            </p>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>Consent given by</p>
          <div className="flex gap-2">
            <ConsentPill label="Participant" active={consentGivenBy === "participant"} onClick={() => setConsentGivenBy("participant")} />
            <ConsentPill label="Nominee" active={consentGivenBy === "nominee"} onClick={() => setConsentGivenBy("nominee")} />
            <ConsentPill label="Guardian" active={consentGivenBy === "guardian"} onClick={() => setConsentGivenBy("guardian")} />
          </div>
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-wider mb-2" style={{ color: MUTED }}>Method</p>
          <div className="flex gap-2">
            <ConsentPill label="Verbal" active={consentMethod === "verbal"} onClick={() => setConsentMethod("verbal")} />
            <ConsentPill label="Written" active={consentMethod === "written"} onClick={() => setConsentMethod("written")} />
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-2xl p-4 cursor-pointer" style={{ border: `1px solid ${BORDER}` }}>
          <input
            type="checkbox"
            checked={consentConfirmed}
            onChange={(e) => setConsentConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded shrink-0"
          />
          <span className="text-[13px]" style={{ color: TEXT }}>
            I confirm <strong>{consentGivenByLabel}</strong> has been informed the conversation will be recorded and has given {consentMethod} consent.
          </span>
        </label>

        <p className="text-center text-[11px]" style={{ color: MUTED }}>Recorded {nowLabel}</p>

        <button
          type="button"
          onClick={handleMicTap}
          disabled={!consentConfirmed || startingSession || voiceNotSupported}
          aria-label="Confirm consent and start recording"
          className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-black text-[14px] text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          style={{ background: CORAL }}
        >
          {startingSession ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
          Confirm consent &amp; record
        </button>

        <div className="flex gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
          <Button variant="outline" className="rounded-xl flex-1" style={{ borderColor: BORDER }} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── Render: recording ───────────────────────────────────────────────────────

  if (phase === "recording") {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: "#FEF2F2", border: "2px solid #EF4444" }}>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-full mb-4"
          style={{ background: "#fff", color: "#DC2626" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" /> {isPaused ? "Paused" : "Recording"}
        </span>
        <p className="font-black text-[36px] tabular-nums mb-1" style={{ color: "#DC2626" }}>{formatTime(elapsedTime)}</p>
        <p className="text-[12px] mb-5" style={{ color: MUTED }}>
          Stay present with the participant — just a timer and a stop button.
        </p>
        <div className="flex items-center justify-center gap-4">
          {canPause && (
            <button
              type="button"
              onClick={togglePause}
              aria-label={isPaused ? "Resume recording" : "Pause recording"}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-white hover:opacity-90 transition-opacity"
              style={{ border: `1px solid ${BORDER}` }}
            >
              {isPaused ? <Play size={18} style={{ color: TEXT }} /> : <Pause size={18} style={{ color: TEXT }} />}
            </button>
          )}
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="w-16 h-16 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity"
            style={{ background: "#EF4444" }}
          >
            <div className="w-5 h-5 rounded-sm bg-white" />
          </button>
        </div>
        <button type="button" className="mt-4 text-[12px] font-semibold hover:opacity-70 transition-opacity" style={{ color: MUTED }} onClick={cancelRecording}>
          Cancel recording
        </button>
      </div>
    );
  }

  // ── Render: processing ──────────────────────────────────────────────────────

  if (phase === "processing") {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
        <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(55,48,163,0.08)" }}>
          <Loader2 size={20} className="animate-spin" style={{ color: PLUM }} />
        </div>
        <p className="font-black text-[13px] mb-0.5" style={{ color: TEXT }}>{processingMessage}</p>
        <p className="text-[12px]" style={{ color: MUTED }}>This can take up to a minute for longer recordings.</p>
      </div>
    );
  }

  // ── Render: review (Drafts / Transcript) ────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("drafts")}
            className="px-3 py-1.5 rounded-full text-[12px] font-black transition-colors"
            style={{ background: activeTab === "drafts" ? PLUM : "#fff", color: activeTab === "drafts" ? "#fff" : TEXT, border: `1px solid ${activeTab === "drafts" ? PLUM : BORDER}` }}
          >
            Drafts ({visibleGoals.length + visibleTasks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("transcript")}
            className="px-3 py-1.5 rounded-full text-[12px] font-black transition-colors"
            style={{ background: activeTab === "transcript" ? PLUM : "#fff", color: activeTab === "transcript" ? "#fff" : TEXT, border: `1px solid ${activeTab === "transcript" ? PLUM : BORDER}` }}
          >
            Transcript
          </button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="rounded-xl text-[12px]" style={{ color: MUTED }} onClick={reRecord}>
            Record again
          </Button>
          <Button size="sm" variant="ghost" className="rounded-xl text-[12px]" style={{ color: MUTED }} onClick={onCancel}>
            Discard
          </Button>
        </div>
      </div>

      {activeTab === "drafts" ? (
        <div className="space-y-3 pb-16">
          <div className="rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
            <p className="text-[11px] leading-relaxed" style={{ color: MUTED }}>
              Nothing here is saved yet — accept the items you want, then Apply to create them for this participant.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" style={{ borderColor: BORDER }} onClick={exportCsv}>
                <Download size={11} /> CSV
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg gap-1 text-[11px]" style={{ borderColor: BORDER }} onClick={exportPdf}>
                <Download size={11} /> PDF
              </Button>
            </div>
          </div>

          {(attentionFlags.length > 0 || (stage1Results?.flags.length ?? 0) > 0) && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <p className="text-[11px] font-black uppercase tracking-wide text-amber-700 flex items-center gap-1">
                <AlertTriangle size={11} /> Review notes
              </p>
              {attentionFlags.map((f, i) => (
                <p key={`af-${i}`} className="text-[12px] text-amber-800 leading-relaxed">{f.description}</p>
              ))}
              {stage1Results?.flags.map((f, i) => (
                <p key={`sf-${i}`} className="text-[12px] text-amber-800 leading-relaxed">{f.description}</p>
              ))}
            </div>
          )}

          {visibleGoals.length === 0 && visibleTasks.length === 0 && (
            <div className="rounded-xl p-6 text-center" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
              <p className="font-semibold text-[13px] mb-1" style={{ color: TEXT }}>No drafts left</p>
              <p className="text-[12px]" style={{ color: MUTED }}>Everything was rejected, or nothing was found in this recording.</p>
            </div>
          )}

          {visibleGoals.map((g) => (
            <DraftCard
              key={g.localId}
              kind="goal"
              text={g.text}
              badgeLabel={formatLabel(g.support_category)}
              confidence={g.confidence}
              quote={resolveQuote(g.source_segment_ids, cleanTranscript)}
              accepted={g.status === "accepted"}
              editing={editingId === g.localId}
              editValue={editValue}
              onToggleAccept={() => toggleAcceptGoal(g.localId)}
              onStartEdit={() => startEdit(g.localId, g.text)}
              onChangeEdit={setEditValue}
              onSaveEdit={() => saveEdit("goal", g.localId)}
              onCancelEdit={cancelEdit}
              onReject={() => rejectGoal(g.localId)}
            />
          ))}

          {visibleTasks.map((t) => (
            <DraftCard
              key={t.localId}
              kind="task"
              text={t.text}
              badgeLabel={formatLabel(t.requirement_level)}
              confidence={t.confidence}
              quote={resolveQuote(t.source_segment_ids, cleanTranscript)}
              accepted={t.status === "accepted"}
              editing={editingId === t.localId}
              editValue={editValue}
              onToggleAccept={() => toggleAcceptTask(t.localId)}
              onStartEdit={() => startEdit(t.localId, t.text)}
              onChangeEdit={setEditValue}
              onSaveEdit={() => saveEdit("task", t.localId)}
              onCancelEdit={cancelEdit}
              onReject={() => rejectTask(t.localId)}
            />
          ))}
        </div>
      ) : (
        <TranscriptViewer
          rawTranscript={stage1Results?.raw_transcript ?? []}
          cleanTranscript={cleanTranscript}
          defaultExpanded
        />
      )}

      {totalAccepted > 0 && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t flex items-center justify-between gap-3" style={{ background: "#fff", borderColor: BORDER }}>
          <p className="text-[12px] font-semibold" style={{ color: TEXT }}>{totalAccepted} item{totalAccepted !== 1 ? "s" : ""} accepted</p>
          <Button
            className="rounded-xl gap-1.5"
            style={{ background: GREEN, color: "#fff" }}
            disabled={applyMut.isPending}
            onClick={() => applyMut.mutate()}
          >
            {applyMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply {totalAccepted} item{totalAccepted !== 1 ? "s" : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Meeting history row ────────────────────────────────────────────────────────

const REQUIREMENT_META: Record<string, { label: string; bg: string; color: string }> = {
  mandatory: { label: "Mandatory", bg: "#FEF2F2", color: CORAL },
  optional:  { label: "Optional",  bg: SOFT,      color: MUTED },
};

function MeetingDetailView({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const detailQuery = useQuery({
    queryKey: ["plan-meeting-detail", meetingId],
    queryFn: () => getPlanMeeting(meetingId),
    select: (d) => d.meeting,
  });

  const meeting = detailQuery.data;
  const meta = meeting ? MEETING_TYPE_META[meeting.meeting_type] ?? MEETING_TYPE_META.check_in : null;
  const status = meeting ? STATUS_META[meeting.suggestions_status] ?? STATUS_META.pending_review : null;
  const dateLabel = useMemo(() => {
    if (!meeting) return "";
    try {
      const hasTime = /T\d{2}:\d{2}/.test(meeting.meeting_date);
      const d = new Date(meeting.meeting_date);
      const datePart = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
      if (!hasTime) return datePart;
      const timePart = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
      return `${datePart} · ${timePart}`;
    } catch {
      return meeting.meeting_date;
    }
  }, [meeting]);

  const goals = meeting?.extracted_goals ?? [];
  const tasks = meeting?.extracted_tasks ?? [];
  const legacyNotes: Array<[string, string]> = meeting
    ? ([
        ["Participant priorities", meeting.participant_priorities],
        ["Coordinator observations", meeting.coordinator_observations],
        ["Agreed outcomes", meeting.agreed_outcomes],
        ["Notes", meeting.conversation_notes],
      ].filter(([, v]) => !!v) as Array<[string, string]>)
    : [];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12px] font-semibold hover:opacity-70 transition-opacity"
        style={{ color: PLUM }}
      >
        <ArrowLeft size={14} /> Back to meetings
      </button>

      {meeting && meta && status && (
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black"
            style={{ background: meta.bg, color: meta.color }}
          >
            {meta.abbr}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black text-[13px]" style={{ color: TEXT }}>{meta.label}</p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: status.bg, color: status.color }}>
                {status.label}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{dateLabel}</p>
          </div>
        </div>
      )}

      {detailQuery.isLoading && (
        <div className="text-center py-8">
          <Loader2 size={20} className="animate-spin mx-auto" style={{ color: MUTED }} />
        </div>
      )}

      {!detailQuery.isLoading && (detailQuery.isError || !meeting) && (
        <p className="text-[12px] py-2" style={{ color: MUTED }}>Couldn't load this meeting's details.</p>
      )}

      {meeting && meeting.source === "legacy" && (
        legacyNotes.length === 0 ? (
          <p className="text-[12px] py-2" style={{ color: MUTED }}>No notes recorded for this meeting.</p>
        ) : (
          <div className="space-y-3">
            {legacyNotes.map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>{label}</p>
                <p className="text-[12px] mt-0.5" style={{ color: TEXT }}>{value}</p>
              </div>
            ))}
          </div>
        )
      )}

      {meeting && meeting.source !== "legacy" && (
        <div className="space-y-3">
          <TranscriptViewer
            rawTranscript={meeting.raw_transcript ?? []}
            cleanTranscript={meeting.clean_transcript ?? []}
          />

          {(goals.length > 0 || tasks.length > 0) && (
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: BORDER }}>
              <div className="p-3" style={{ background: SOFT }}>
                <p className="font-semibold text-[13px]" style={{ color: TEXT }}>Goals &amp; tasks from this meeting</p>
                <p className="text-[11px]" style={{ color: MUTED }}>What the AI extracted from the conversation</p>
              </div>
              <div className="border-t p-3 space-y-2" style={{ borderColor: BORDER }}>
                {goals.map((g, i) => (
                  <div key={i} className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
                    <Target size={13} className="shrink-0 mt-0.5" style={{ color: PLUM }} />
                    <div className="min-w-0">
                      <p className="text-[12px]" style={{ color: TEXT }}>{g.goal_text}</p>
                      {g.support_category && (
                        <span className="text-[10px] font-semibold" style={{ color: MUTED }}>{g.support_category}</span>
                      )}
                    </div>
                  </div>
                ))}
                {tasks.map((t, i) => {
                  const req = REQUIREMENT_META[t.requirement_level] ?? REQUIREMENT_META.optional;
                  return (
                    <div key={i} className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
                      <ListChecks size={13} className="shrink-0 mt-0.5" style={{ color: GREEN }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px]" style={{ color: TEXT }}>{t.task_text}</p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: req.bg, color: req.color }}>
                        {req.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {goals.length === 0 && tasks.length === 0 && (
            <p className="text-[12px]" style={{ color: MUTED }}>No goals or tasks were extracted from this meeting.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MeetingRow({ meeting, onSelect }: { meeting: PlanMeeting; onSelect: (id: string) => void }) {
  const meta = MEETING_TYPE_META[meeting.meeting_type] ?? MEETING_TYPE_META.check_in;
  const status = STATUS_META[meeting.suggestions_status] ?? STATUS_META.pending_review;
  const dateLabel = useMemo(() => {
    try {
      const hasTime = /T\d{2}:\d{2}/.test(meeting.meeting_date);
      const d = new Date(meeting.meeting_date);
      const datePart = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
      if (!hasTime) return datePart;
      const timePart = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
      return `${datePart} · ${timePart}`;
    } catch {
      return meeting.meeting_date;
    }
  }, [meeting.meeting_date]);

  return (
    <button
      type="button"
      onClick={() => onSelect(meeting.id)}
      className="w-full rounded-xl flex items-center gap-3 p-3 text-left hover:opacity-80 transition-opacity"
      style={{ border: `1px solid ${BORDER}` }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-black"
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.abbr}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-black text-[12px]" style={{ color: TEXT }}>{meta.label}</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: status.bg, color: status.color }}>
            {status.label}
          </span>
        </div>
        <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{dateLabel}</p>
      </div>
      <ChevronRight size={14} className="shrink-0" style={{ color: MUTED }} />
    </button>
  );
}

// ── Main exported component ────────────────────────────────────────────────────

interface PlanMeetingCaptureProps {
  participantId: string;
  participantName: string;
}

export function PlanMeetingCapture({ participantId, participantName }: PlanMeetingCaptureProps) {
  const [recording, setRecording] = useState(false);
  const [viewingMeetingId, setViewingMeetingId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const qc = useQueryClient();

  const meetingsQuery = useQuery({
    queryKey: ["plan-meetings", participantId, dateFrom, dateTo],
    queryFn: () => listPlanMeetings(participantId, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    select: (d) => d.meetings,
  });

  const handleDone = () => {
    setRecording(false);
    qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
  };

  if (recording) {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <RecordMeetingFlow participantId={participantId} participantName={participantName} onDone={handleDone} onCancel={() => setRecording(false)} />
      </div>
    );
  }

  if (viewingMeetingId) {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <MeetingDetailView meetingId={viewingMeetingId} onBack={() => setViewingMeetingId(null)} />
      </div>
    );
  }

  const meetings = meetingsQuery.data ?? [];
  const hasFilter = !!(dateFrom || dateTo);
  const clearFilter = () => { setDateFrom(""); setDateTo(""); };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare size={14} style={{ color: PLUM }} />
            <p className="font-black text-[13px]" style={{ color: TEXT }}>Plan Meetings</p>
          </div>
          {meetings.length > 0 && (
            <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
              <span className="font-black" style={{ color: TEXT }}>{meetings.length}</span> recorded
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="rounded-xl gap-1 px-3 shrink-0"
          style={{ background: PLUM, color: "#fff" }}
          onClick={() => setRecording(true)}
        >
          <FileText size={12} /> Record meeting
        </Button>
      </div>

      {/* Date filter */}
      {(meetings.length > 0 || hasFilter) && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="ml-1.5 rounded-lg border px-2 py-1 text-[11px]"
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </label>
          <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="ml-1.5 rounded-lg border px-2 py-1 text-[11px]"
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </label>
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilter}
              className="text-[11px] font-semibold hover:opacity-70 transition-opacity"
              style={{ color: PLUM }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {meetingsQuery.isLoading && (
        <div className="text-center py-6">
          <Loader2 size={20} className="animate-spin mx-auto" style={{ color: MUTED }} />
        </div>
      )}

      {/* Empty state — filtered to zero results */}
      {!meetingsQuery.isLoading && meetings.length === 0 && hasFilter && (
        <div className="rounded-xl p-6 text-center" style={{ background: SOFT, border: `1px dashed ${BORDER}` }}>
          <p className="font-black text-[13px] mb-1" style={{ color: TEXT }}>No meetings in this date range</p>
          <p className="text-[12px]" style={{ color: MUTED }}>Try a different range, or clear the filter to see all meetings.</p>
          <button
            type="button"
            onClick={clearFilter}
            className="mt-3 text-[12px] font-semibold hover:opacity-70 transition-opacity"
            style={{ color: PLUM }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Empty state — no meetings recorded at all */}
      {!meetingsQuery.isLoading && meetings.length === 0 && !hasFilter && (
        <div className="rounded-xl p-6 text-center" style={{ background: SOFT, border: `1px dashed ${BORDER}` }}>
          <div
            className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ background: "rgba(55,48,163,0.08)" }}
          >
            <MessageSquare size={18} style={{ color: PLUM }} />
          </div>
          <p className="font-black text-[13px] mb-1" style={{ color: TEXT }}>No plan meetings recorded yet</p>
          <p className="text-[12px]" style={{ color: MUTED }}>
            Record a meeting to capture participant priorities and get AI-suggested goals and task templates.
          </p>
          <Button
            size="sm"
            className="mt-4 rounded-xl gap-1 px-4"
            style={{ background: PLUM, color: "#fff" }}
            onClick={() => setRecording(true)}
          >
            <FileText size={12} /> Record first meeting
          </Button>
        </div>
      )}

      {/* Meeting list */}
      {meetings.length > 0 && (
        <div className="space-y-2">
          {meetings.map((m) => <MeetingRow key={m.id} meeting={m} onSelect={setViewingMeetingId} />)}
        </div>
      )}
    </div>
  );
}
