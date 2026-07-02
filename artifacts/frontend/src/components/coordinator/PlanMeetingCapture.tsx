import { Fragment, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, CheckCircle2, X, ChevronRight, Loader2,
  AlertTriangle, Check, FileText, MessageSquare, Mic,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  recordPlanMeeting,
  listPlanMeetings,
  triggerPlanMeetingAiReview,
  applyPlanMeetingSuggestions,
  transcribePlanMeetingAudio,
  type PlanMeeting,
  type PlanMeetingType,
  type SuggestedGoal,
  type SuggestedTask,
  type RecordMeetingPayload,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const GREEN  = "#166534";
const GREEN_BG     = "rgba(22,101,52,0.06)";
const GREEN_BORDER = "rgba(22,101,52,0.2)";

const MEETING_TYPE_META: Record<PlanMeetingType, { label: string; abbr: string; color: string; bg: string }> = {
  plan_review:       { label: "Plan Review",        abbr: "PR", color: "#3730A3", bg: "rgba(55,48,163,0.08)"  },
  initial_setup:     { label: "Initial Setup",      abbr: "IS", color: GREEN,     bg: GREEN_BG               },
  check_in:          { label: "Check-In",           abbr: "CI", color: "#0369A1", bg: "rgba(3,105,161,0.08)"  },
  incident_followup: { label: "Incident Follow-Up", abbr: "IF", color: "#BE185D", bg: "rgba(190,24,93,0.08)"  },
  goal_review:       { label: "Goal Review",        abbr: "GR", color: "#B45309", bg: "rgba(180,83,9,0.08)"   },
};

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending_review: { label: "Pending AI review", bg: "#FFFBEB", color: "#92400E" },
  reviewed:       { label: "AI reviewed",       bg: "#EFF6FF", color: "#1D4ED8" },
  applied:        { label: "Applied",           bg: "#F0FDF4", color: GREEN     },
};

// ── Step progress ──────────────────────────────────────────────────────────────

function StepProgress({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Notes" },
    { n: 2, label: "AI analysis" },
    { n: 3, label: "Apply" },
  ] as const;

  return (
    <div className="flex items-center mb-5">
      {steps.map((s, i) => (
        <Fragment key={s.n}>
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black"
              style={{
                background: current > s.n ? GREEN : current === s.n ? PLUM : BORDER,
                color: current >= s.n ? "#fff" : MUTED,
              }}
            >
              {current > s.n ? <Check size={10} /> : s.n}
            </div>
            <p className="text-[10px] font-semibold whitespace-nowrap" style={{ color: current === s.n ? TEXT : MUTED }}>
              {s.label}
            </p>
          </div>
          {i < 2 && (
            <div className="flex-1 h-px mx-2 mb-4" style={{ background: current > i + 1 ? GREEN : BORDER }} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ── Section divider ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] shrink-0" style={{ color: MUTED }}>
        {label}
      </p>
      <div className="flex-1 h-px" style={{ background: BORDER }} />
    </div>
  );
}

// ── Step 1: Record meeting ─────────────────────────────────────────────────────

interface Step1Props {
  participantId: string;
  onRecorded: (meeting: PlanMeeting) => void;
  onCancel: () => void;
}

function Step1RecordMeeting({ participantId, onRecorded, onCancel }: Step1Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<RecordMeetingPayload>({
    participant_id: participantId,
    meeting_date: format(new Date(), "yyyy-MM-dd"),
    meeting_type: "check_in",
    attendees: [],
    conversation_notes: "",
    participant_priorities: "",
    coordinator_observations: "",
    agreed_outcomes: "",
  });
  const [attendeeInput, setAttendeeInput] = useState("");
  const [useVoiceDictation, setUseVoiceDictation] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [voiceNotSupported, setVoiceNotSupported] = useState(false);

  const mut = useMutation({
    mutationFn: () => recordPlanMeeting(form),
    onSuccess: ({ meeting }) => onRecorded(meeting),
    onError: (err: any) => toast({ variant: "destructive", title: "Failed to save meeting", description: err?.message ?? "" }),
  });

  const addAttendee = () => {
    const v = attendeeInput.trim();
    if (v && !form.attendees.includes(v)) {
      setForm((f) => ({ ...f, attendees: [...f.attendees, v] }));
    }
    setAttendeeInput("");
  };

  const removeAttendee = (name: string) => {
    setForm((f) => ({ ...f, attendees: f.attendees.filter((a) => a !== name) }));
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setVoiceNotSupported(true);
        toast({ variant: "destructive", title: "Voice recording not supported", description: "Your browser doesn't support voice recording. Please use manual text entry." });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/mp4";
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunks, { type: mimeType });
        setTranscriptLoading(true);
        try {
          const result = await transcribePlanMeetingAudio(audioBlob);
          setForm((f) => ({ ...f, conversation_notes: result.transcript }));
          toast({ title: "Transcription complete", description: "Review and edit the transcript before continuing." });
          setUseVoiceDictation(false);
        } catch (err: any) {
          toast({ variant: "destructive", title: "Transcription failed", description: err?.message ?? "Please try again." });
        } finally {
          setTranscriptLoading(false);
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setElapsedTime(0);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        toast({ variant: "destructive", title: "Microphone access denied", description: "Allow microphone access to use voice dictation." });
      } else if (err.name === "NotFoundError") {
        setVoiceNotSupported(true);
        toast({ variant: "destructive", title: "No microphone found", description: "Connect a microphone or use manual entry." });
      } else if (err.name === "SecurityError") {
        setVoiceNotSupported(true);
        toast({ variant: "destructive", title: "Security error", description: "Voice recording requires HTTPS. Please use manual text entry." });
      } else {
        toast({ variant: "destructive", title: "Failed to start recording", description: err?.message ?? "Unknown error." });
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    setElapsedTime(0);
  };

  const reRecord = () => {
    setForm((f) => ({ ...f, conversation_notes: "" }));
    setElapsedTime(0);
    setUseVoiceDictation(true);
  };

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) setVoiceNotSupported(true);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => setElapsedTime((t) => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const canSubmit = form.meeting_date && (form.conversation_notes?.trim() || form.participant_priorities?.trim());
  const transcriptLength = form.conversation_notes?.length ?? 0;

  return (
    <div className="space-y-5">
      <StepProgress current={1} />

      {/* ── Meeting details ── */}
      <div>
        <SectionLabel label="Meeting details" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold" style={{ color: MUTED }}>Date</Label>
            <Input
              type="date"
              value={form.meeting_date}
              onChange={(e) => setForm((f) => ({ ...f, meeting_date: e.target.value }))}
              className="rounded-xl h-9 text-[13px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold" style={{ color: MUTED }}>Meeting type</Label>
            <select
              value={form.meeting_type}
              onChange={(e) => setForm((f) => ({ ...f, meeting_type: e.target.value as PlanMeetingType }))}
              className="w-full h-9 rounded-xl px-3 text-[13px] outline-none"
              style={{ border: `1px solid ${BORDER}`, color: TEXT, background: "#fff" }}
            >
              {(Object.entries(MEETING_TYPE_META) as [PlanMeetingType, typeof MEETING_TYPE_META[PlanMeetingType]][]).map(([v, m]) => (
                <option key={v} value={v}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Attendees ── */}
      <div>
        <SectionLabel label="Attendees" />
        <div className="flex gap-2">
          <Input
            value={attendeeInput}
            onChange={(e) => setAttendeeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttendee(); } }}
            placeholder="Name and role, e.g. John Smith (nominee)"
            className="rounded-xl h-9 text-[13px] flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl px-3 shrink-0 h-9"
            onClick={addAttendee}
            style={{ borderColor: BORDER }}
          >
            Add
          </Button>
        </div>
        {form.attendees.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {form.attendees.map((a) => (
              <span
                key={a}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: SOFT, color: TEXT, border: `1px solid ${BORDER}` }}
              >
                {a}
                <button onClick={() => removeAttendee(a)} className="ml-0.5 hover:opacity-70 flex items-center">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Conversation notes ── */}
      <div>
        <SectionLabel label="Conversation notes" />

        {voiceNotSupported ? (
          /* Browser/device doesn't support MediaRecorder */
          <div className="space-y-2">
            <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[12px] text-amber-800">
                Voice dictation is not available on this device. Type the meeting notes below.
              </p>
            </div>
            <textarea
              value={form.conversation_notes}
              onChange={(e) => setForm((f) => ({ ...f, conversation_notes: e.target.value }))}
              rows={5}
              placeholder="Document the full discussion, key points raised, and any relevant context…"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none leading-relaxed"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            />
            <p className="text-[11px] text-right" style={{ color: MUTED }}>{transcriptLength} characters</p>
          </div>

        ) : !useVoiceDictation ? (
          /* Manual text mode — also shown after transcript lands */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              {form.conversation_notes ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: GREEN }}>
                    <Check size={9} className="text-white" />
                  </div>
                  <span className="text-[12px] font-semibold" style={{ color: GREEN }}>
                    Transcript ready — review and edit below
                  </span>
                </div>
              ) : (
                <span className="text-[12px]" style={{ color: MUTED }}>Type the meeting conversation below</span>
              )}
              <div className="flex items-center gap-1 shrink-0">
                {form.conversation_notes && (
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1" onClick={reRecord} style={{ color: PLUM }}>
                    <Mic size={10} /> Re-record
                  </Button>
                )}
                {!form.conversation_notes && (
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1" onClick={() => setUseVoiceDictation(true)} style={{ color: PLUM }}>
                    <Mic size={10} /> Use voice
                  </Button>
                )}
              </div>
            </div>
            <textarea
              value={form.conversation_notes}
              onChange={(e) => setForm((f) => ({ ...f, conversation_notes: e.target.value }))}
              rows={5}
              placeholder="Document the full discussion, key points raised, and any relevant context…"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none leading-relaxed"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            />
            <p className="text-[11px] text-right" style={{ color: MUTED }}>{transcriptLength} characters</p>
          </div>

        ) : transcriptLoading ? (
          /* Whisper is processing */
          <div className="rounded-2xl p-8 text-center" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
            <div
              className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ background: "rgba(55,48,163,0.08)" }}
            >
              <Loader2 size={20} className="animate-spin" style={{ color: PLUM }} />
            </div>
            <p className="font-black text-[13px] mb-0.5" style={{ color: TEXT }}>Transcribing your recording</p>
            <p className="text-[12px]" style={{ color: MUTED }}>Whisper AI is processing the audio…</p>
          </div>

        ) : isRecording ? (
          /* Active recording */
          <div className="rounded-2xl p-6 text-center" style={{ background: "#FEF2F2", border: `2px solid #EF4444` }}>
            <div className="relative flex items-center justify-center h-20 mb-3">
              <div className="absolute w-20 h-20 rounded-full bg-red-400 opacity-25 animate-ping" />
              <div
                className="absolute w-24 h-24 rounded-full bg-red-300 opacity-15 animate-ping"
                style={{ animationDelay: "300ms" }}
              />
              <button
                onClick={stopRecording}
                className="relative w-16 h-16 rounded-full flex items-center justify-center hover:opacity-90 transition-opacity"
                style={{ background: "#EF4444" }}
              >
                <div className="w-5 h-5 rounded-sm bg-white" />
              </button>
            </div>
            <p className="font-black text-[22px] tabular-nums mb-0.5" style={{ color: "#DC2626" }}>
              {formatTime(elapsedTime)}
            </p>
            <p className="text-[12px] mb-4" style={{ color: MUTED }}>Recording in progress · tap to stop</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-[12px] rounded-xl"
              style={{ color: MUTED }}
              onClick={cancelRecording}
            >
              Cancel recording
            </Button>
          </div>

        ) : (
          /* Idle — ready to dictate */
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: SOFT, border: `1px dashed ${BORDER}` }}
          >
            <button
              onClick={startRecording}
              className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
              style={{ background: PLUM, boxShadow: "0 4px 16px rgba(55,48,163,0.28)" }}
            >
              <Mic size={24} className="text-white" />
            </button>
            <p className="font-black text-[13px] mb-1" style={{ color: TEXT }}>
              Dictate the meeting conversation
            </p>
            <p className="text-[12px]" style={{ color: MUTED }}>
              Speak naturally — Whisper AI transcribes the meeting automatically
            </p>
            <button
              className="mt-3 text-[12px] underline underline-offset-2 hover:opacity-70 transition-opacity"
              style={{ color: MUTED }}
              onClick={() => setUseVoiceDictation(false)}
            >
              Type manually instead
            </button>
          </div>
        )}
      </div>

      {/* ── Additional context ── */}
      <div>
        <SectionLabel label="Additional context" />
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold" style={{ color: MUTED }}>
              What did the participant say they want support with?
            </Label>
            <textarea
              value={form.participant_priorities}
              onChange={(e) => setForm((f) => ({ ...f, participant_priorities: e.target.value }))}
              rows={3}
              placeholder="In the participant's own words…"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none leading-relaxed"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold" style={{ color: MUTED }}>Coordinator observations</Label>
            <textarea
              value={form.coordinator_observations}
              onChange={(e) => setForm((f) => ({ ...f, coordinator_observations: e.target.value }))}
              rows={2}
              placeholder="Clinical or practical observations not captured by the participant…"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none leading-relaxed"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold" style={{ color: MUTED }}>Agreed outcomes / action items</Label>
            <textarea
              value={form.agreed_outcomes}
              onChange={(e) => setForm((f) => ({ ...f, agreed_outcomes: e.target.value }))}
              rows={2}
              placeholder="What was agreed at the end of the meeting?"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none leading-relaxed"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}
            />
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
        <Button variant="outline" className="rounded-xl flex-1" style={{ borderColor: BORDER }} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="rounded-xl flex-1 gap-1.5"
          style={{ background: PLUM, color: "#fff" }}
          disabled={!canSubmit || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
          Save & analyse
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: AI review ─────────────────────────────────────────────────────────

interface Step2Props {
  meeting: PlanMeeting;
  onReviewed: (goals: SuggestedGoal[], tasks: SuggestedTask[]) => void;
  onBack: () => void;
}

function Step2AiReview({ meeting, onReviewed, onBack }: Step2Props) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState(meeting.ai_suggestions_raw ?? null);
  const [accepted, setAccepted] = useState<{ goals: Set<number>; tasks: Set<number> }>({
    goals: new Set(),
    tasks: new Set(),
  });

  const reviewMut = useMutation({
    mutationFn: () => triggerPlanMeetingAiReview(meeting.id),
    onSuccess: ({ suggestions: s }) => setSuggestions(s),
    onError: (err: any) => toast({ variant: "destructive", title: "AI analysis failed", description: err?.message ?? "" }),
  });

  const toggleGoal = (i: number) =>
    setAccepted((a) => { const g = new Set(a.goals); g.has(i) ? g.delete(i) : g.add(i); return { ...a, goals: g }; });

  const toggleTask = (i: number) =>
    setAccepted((a) => { const t = new Set(a.tasks); t.has(i) ? t.delete(i) : t.add(i); return { ...a, tasks: t }; });

  const toggleAllGoals = () => {
    if (!suggestions) return;
    const all = suggestions.suggested_goals.map((_, i) => i);
    const allOn = all.every(i => accepted.goals.has(i));
    setAccepted(a => ({ ...a, goals: allOn ? new Set() : new Set(all) }));
  };

  const toggleAllTasks = () => {
    if (!suggestions) return;
    const all = suggestions.suggested_tasks.map((_, i) => i);
    const allOn = all.every(i => accepted.tasks.has(i));
    setAccepted(a => ({ ...a, tasks: allOn ? new Set() : new Set(all) }));
  };

  const proceed = () => {
    const goals = (suggestions?.suggested_goals ?? []).filter((_, i) => accepted.goals.has(i));
    const tasks = (suggestions?.suggested_tasks ?? []).filter((_, i) => accepted.tasks.has(i));
    onReviewed(goals, tasks);
  };

  const meta = MEETING_TYPE_META[meeting.meeting_type];
  const totalSelected = accepted.goals.size + accepted.tasks.size;

  return (
    <div className="space-y-5">
      <StepProgress current={2} />

      {/* Meeting context card */}
      <div className="rounded-xl p-3 flex items-start gap-3" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-black"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.abbr}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-[12px]" style={{ color: TEXT }}>{meta.label}</p>
          <p className="text-[11px]" style={{ color: MUTED }}>{meeting.meeting_date}</p>
          {meeting.participant_priorities && (
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: MUTED }}>
              <span className="font-semibold" style={{ color: TEXT }}>Participant: </span>
              {meeting.participant_priorities.slice(0, 180)}
              {meeting.participant_priorities.length > 180 ? "…" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Run AI CTA */}
      {!suggestions && !reviewMut.isPending && (
        <div className="rounded-2xl p-6 text-center" style={{ background: SOFT, border: `1px dashed ${BORDER}` }}>
          <div
            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ background: "rgba(55,48,163,0.08)" }}
          >
            <Sparkles size={20} style={{ color: PLUM }} />
          </div>
          <p
            className="font-black text-[14px] mb-1"
            style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
          >
            Ready to analyse this meeting
          </p>
          <p className="text-[12px] mb-4 mx-auto" style={{ color: MUTED, maxWidth: "26rem" }}>
            CareCliQ AI will extract NDIS goals and task templates from the conversation notes.
            Capacity Building supports are automatically excluded.
          </p>
          <Button
            className="rounded-xl gap-2 px-6"
            style={{ background: PLUM, color: "#fff" }}
            onClick={() => reviewMut.mutate()}
          >
            <Sparkles size={14} />
            Run AI analysis
          </Button>
        </div>
      )}

      {/* AI processing */}
      {reviewMut.isPending && (
        <div className="rounded-2xl p-8 text-center" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
          <div
            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ background: "rgba(55,48,163,0.08)" }}
          >
            <Loader2 size={20} className="animate-spin" style={{ color: PLUM }} />
          </div>
          <p className="font-black text-[13px] mb-0.5" style={{ color: TEXT }}>Analysing meeting notes</p>
          <p className="text-[12px]" style={{ color: MUTED }}>Extracting NDIS goals and task recommendations…</p>
        </div>
      )}

      {/* Results */}
      {suggestions && (
        <div className="space-y-5">
          {/* Summary strip */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-black" style={{ color: TEXT }}>
              {suggestions.suggested_goals.length} goal{suggestions.suggested_goals.length !== 1 ? "s" : ""} · {suggestions.suggested_tasks.length} task{suggestions.suggested_tasks.length !== 1 ? "s" : ""} suggested
            </span>
            {totalSelected > 0 && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(55,48,163,0.08)", color: PLUM }}
              >
                {totalSelected} selected
              </span>
            )}
          </div>

          {/* AI flags */}
          {suggestions.flags.length > 0 && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <p className="text-[11px] font-black uppercase tracking-wide text-amber-700 flex items-center gap-1">
                <AlertTriangle size={11} /> AI notes
              </p>
              {suggestions.flags.map((f, i) => (
                <p key={i} className="text-[12px] text-amber-800 leading-relaxed">{f}</p>
              ))}
            </div>
          )}

          {/* Suggested goals */}
          {suggestions.suggested_goals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>
                  NDIS goals ({suggestions.suggested_goals.length})
                </p>
                <button
                  className="text-[11px] font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: PLUM }}
                  onClick={toggleAllGoals}
                >
                  {suggestions.suggested_goals.every((_, i) => accepted.goals.has(i)) ? "Deselect all" : "Select all"}
                </button>
              </div>
              {suggestions.suggested_goals.map((g, i) => {
                const on = accepted.goals.has(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleGoal(i)}
                    className="w-full text-left rounded-xl p-3 transition-colors"
                    style={{
                      border: `2px solid ${on ? PLUM : BORDER}`,
                      background: on ? "rgba(55,48,163,0.04)" : "#fff",
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className="mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                        style={{ borderColor: on ? PLUM : BORDER, background: on ? PLUM : "transparent" }}
                      >
                        {on && <Check size={9} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-[12px]" style={{ color: TEXT }}>{g.name}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{g.support_category}</p>
                        {g.description && (
                          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: TEXT }}>{g.description}</p>
                        )}
                        {g.reasoning && (
                          <p className="text-[10px] mt-1.5 italic px-2 py-1 rounded-lg" style={{ background: SOFT, color: MUTED }}>
                            "{g.reasoning}"
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Suggested tasks */}
          {suggestions.suggested_tasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>
                  Task templates ({suggestions.suggested_tasks.length})
                </p>
                <button
                  className="text-[11px] font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: PLUM }}
                  onClick={toggleAllTasks}
                >
                  {suggestions.suggested_tasks.every((_, i) => accepted.tasks.has(i)) ? "Deselect all" : "Select all"}
                </button>
              </div>
              {suggestions.suggested_tasks.map((t, i) => {
                const on = accepted.tasks.has(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleTask(i)}
                    className="w-full text-left rounded-xl p-3 transition-colors"
                    style={{
                      border: `2px solid ${on ? PLUM : BORDER}`,
                      background: on ? "rgba(55,48,163,0.04)" : "#fff",
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className="mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                        style={{ borderColor: on ? PLUM : BORDER, background: on ? PLUM : "transparent" }}
                      >
                        {on && <Check size={9} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-[12px]" style={{ color: TEXT }}>{t.template_name}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                          {t.shift_type} shift · {t.requirement_level}
                          {t.link_to_goal_name && <> · Goal: {t.link_to_goal_name}</>}
                        </p>
                        {t.customised_notes && (
                          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: TEXT }}>{t.customised_notes}</p>
                        )}
                        {t.reasoning && (
                          <p className="text-[10px] mt-1.5 italic px-2 py-1 rounded-lg" style={{ background: SOFT, color: MUTED }}>
                            "{t.reasoning}"
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {suggestions.suggested_goals.length === 0 && suggestions.suggested_tasks.length === 0 && (
            <div className="rounded-xl p-5 text-center" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
              <p className="font-semibold text-[13px] mb-1" style={{ color: TEXT }}>No suggestions generated</p>
              <p className="text-[12px]" style={{ color: MUTED }}>
                The AI did not find sufficient detail to suggest NDIS goals or tasks.
                Add more context to the meeting notes and try again.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
        <Button variant="outline" className="rounded-xl" style={{ borderColor: BORDER }} onClick={onBack}>
          Back
        </Button>
        {suggestions && (
          <Button
            className="rounded-xl flex-1 gap-1.5"
            style={{ background: PLUM, color: "#fff" }}
            disabled={totalSelected === 0}
            onClick={proceed}
          >
            <ChevronRight size={14} />
            Review {totalSelected} selected item{totalSelected !== 1 ? "s" : ""}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step 3: Apply ─────────────────────────────────────────────────────────────

interface Step3Props {
  meeting: PlanMeeting;
  acceptedGoals: SuggestedGoal[];
  acceptedTasks: SuggestedTask[];
  onApplied: () => void;
  onBack: () => void;
}

function Step3Apply({ meeting, acceptedGoals, acceptedTasks, onApplied, onBack }: Step3Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => applyPlanMeetingSuggestions(meeting.id, acceptedGoals, acceptedTasks),
    onSuccess: (result) => {
      toast({ title: `Applied: ${result.goals_created} goal(s) and ${result.tasks_created} task(s) created.` });
      qc.invalidateQueries({ queryKey: ["plan-meetings", meeting.participant_id] });
      qc.invalidateQueries({ queryKey: ["ndis-goals"] });
      qc.invalidateQueries({ queryKey: ["participant-tasks"] });
      onApplied();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Failed to apply", description: err?.message ?? "" }),
  });

  const goalCount  = acceptedGoals.length;
  const taskCount  = acceptedTasks.length;
  const summaryParts: string[] = [];
  if (goalCount > 0) summaryParts.push(`${goalCount} NDIS goal${goalCount !== 1 ? "s" : ""}`);
  if (taskCount > 0) summaryParts.push(`${taskCount} task template${taskCount !== 1 ? "s" : ""}`);

  return (
    <div className="space-y-5">
      <StepProgress current={3} />

      {/* Impact banner */}
      <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: GREEN_BG, border: `1px solid ${GREEN_BORDER}` }}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: GREEN }}
        >
          <CheckCircle2 size={16} className="text-white" />
        </div>
        <div>
          <p className="font-black text-[13px]" style={{ color: GREEN }}>Ready to apply</p>
          <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
            {summaryParts.join(" and ")} will be created for this participant.
          </p>
        </div>
      </div>

      {/* Goals */}
      {acceptedGoals.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>
            Goals ({acceptedGoals.length})
          </p>
          {acceptedGoals.map((g, i) => (
            <div
              key={i}
              className="rounded-xl p-3 flex gap-2.5"
              style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: GREEN }} />
              <div className="flex-1 min-w-0">
                <p className="font-black text-[12px]" style={{ color: TEXT }}>{g.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{g.support_category} · {g.goal_area}</p>
                {g.success_criteria && (
                  <p className="text-[11px] mt-1 leading-relaxed" style={{ color: TEXT }}>Success: {g.success_criteria}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tasks */}
      {acceptedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>
            Task templates ({acceptedTasks.length})
          </p>
          {acceptedTasks.map((t, i) => (
            <div
              key={i}
              className="rounded-xl p-3 flex gap-2.5"
              style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: GREEN }} />
              <div className="flex-1 min-w-0">
                <p className="font-black text-[12px]" style={{ color: TEXT }}>{t.template_name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{t.shift_type} · {t.requirement_level}</p>
                {t.customised_notes && (
                  <p className="text-[11px] mt-1 leading-relaxed" style={{ color: TEXT }}>{t.customised_notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
        <Button
          variant="outline"
          className="rounded-xl"
          style={{ borderColor: BORDER }}
          onClick={onBack}
          disabled={mut.isPending}
        >
          Back
        </Button>
        <Button
          className="rounded-xl flex-1 gap-1.5"
          style={{ background: GREEN, color: "#fff" }}
          disabled={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Apply changes
        </Button>
      </div>
    </div>
  );
}

// ── Meeting history row ────────────────────────────────────────────────────────

function MeetingHistoryRow({
  meeting,
  onContinueReview,
}: {
  meeting: PlanMeeting;
  onContinueReview: (m: PlanMeeting) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta   = MEETING_TYPE_META[meeting.meeting_type];
  const status = STATUS_META[meeting.suggestions_status] ?? STATUS_META.pending_review;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
      {/* Row header */}
      <button
        type="button"
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
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
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: status.bg, color: status.color }}
            >
              {status.label}
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
            {meeting.meeting_date}
            {meeting.attendees?.length > 0 && ` · ${meeting.attendees.join(", ")}`}
          </p>
        </div>
        {expanded
          ? <ChevronUp size={14} className="shrink-0" style={{ color: MUTED }} />
          : <ChevronDown size={14} className="shrink-0" style={{ color: MUTED }} />
        }
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{ borderColor: BORDER }}>
          {meeting.participant_priorities && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                Participant priorities
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: TEXT }}>{meeting.participant_priorities}</p>
            </div>
          )}
          {meeting.coordinator_observations && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1" style={{ color: MUTED }}>Observations</p>
              <p className="text-[12px] leading-relaxed" style={{ color: TEXT }}>{meeting.coordinator_observations}</p>
            </div>
          )}
          {meeting.agreed_outcomes && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1" style={{ color: MUTED }}>Agreed outcomes</p>
              <p className="text-[12px] leading-relaxed" style={{ color: TEXT }}>{meeting.agreed_outcomes}</p>
            </div>
          )}
          {meeting.ai_suggestions_raw?.flags?.length ? (
            <div className="rounded-lg p-2.5" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <p className="text-[10px] font-black text-amber-700 uppercase mb-1">AI flags</p>
              {meeting.ai_suggestions_raw.flags.map((f, i) => (
                <p key={i} className="text-[11px] text-amber-800">{f}</p>
              ))}
            </div>
          ) : null}
          {meeting.suggestions_status === "pending_review" && meeting.ai_suggestions_raw && (
            <Button
              size="sm"
              className="rounded-xl gap-1"
              style={{ background: PLUM, color: "#fff" }}
              onClick={() => onContinueReview(meeting)}
            >
              <Sparkles size={12} /> Continue AI review
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main exported component ────────────────────────────────────────────────────

type Step = "list" | "step1" | "step2" | "step3";

interface PlanMeetingCaptureProps {
  participantId: string;
}

export function PlanMeetingCapture({ participantId }: PlanMeetingCaptureProps) {
  const [step, setStep]               = useState<Step>("list");
  const [activeMeeting, setActiveMeeting] = useState<PlanMeeting | null>(null);
  const [acceptedGoals, setAcceptedGoals] = useState<SuggestedGoal[]>([]);
  const [acceptedTasks, setAcceptedTasks] = useState<SuggestedTask[]>([]);
  const qc = useQueryClient();

  const meetingsQuery = useQuery({
    queryKey: ["plan-meetings", participantId],
    queryFn: () => listPlanMeetings(participantId),
    select: (d) => d.meetings,
  });

  const reset = () => {
    setStep("list");
    setActiveMeeting(null);
    setAcceptedGoals([]);
    setAcceptedTasks([]);
    qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
  };

  if (step === "step1") {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <Step1RecordMeeting
          participantId={participantId}
          onRecorded={(m) => { setActiveMeeting(m); setStep("step2"); }}
          onCancel={reset}
        />
      </div>
    );
  }

  if (step === "step2" && activeMeeting) {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <Step2AiReview
          meeting={activeMeeting}
          onReviewed={(goals, tasks) => { setAcceptedGoals(goals); setAcceptedTasks(tasks); setStep("step3"); }}
          onBack={() => setStep("step1")}
        />
      </div>
    );
  }

  if (step === "step3" && activeMeeting) {
    return (
      <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <Step3Apply
          meeting={activeMeeting}
          acceptedGoals={acceptedGoals}
          acceptedTasks={acceptedTasks}
          onApplied={reset}
          onBack={() => setStep("step2")}
        />
      </div>
    );
  }

  // ── List view ──
  const meetings    = meetingsQuery.data ?? [];
  const pendingCount = meetings.filter(m => m.suggestions_status === "pending_review" && m.ai_suggestions_raw).length;

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
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-[12px]" style={{ color: MUTED }}>
                <span className="font-black" style={{ color: TEXT }}>{meetings.length}</span> recorded
              </span>
              {pendingCount > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#FFFBEB", color: "#92400E" }}>
                  {pendingCount} pending AI review
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          size="sm"
          className="rounded-xl gap-1 px-3 shrink-0"
          style={{ background: PLUM, color: "#fff" }}
          onClick={() => setStep("step1")}
        >
          <FileText size={12} /> Record meeting
        </Button>
      </div>

      {/* Loading */}
      {meetingsQuery.isLoading && (
        <div className="text-center py-6">
          <Loader2 size={20} className="animate-spin mx-auto" style={{ color: MUTED }} />
        </div>
      )}

      {/* Empty state */}
      {!meetingsQuery.isLoading && meetings.length === 0 && (
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
            onClick={() => setStep("step1")}
          >
            <FileText size={12} /> Record first meeting
          </Button>
        </div>
      )}

      {/* Meeting list */}
      {meetings.length > 0 && (
        <div className="space-y-2">
          {meetings.map((m) => (
            <MeetingHistoryRow
              key={m.id}
              meeting={m}
              onContinueReview={(m) => { setActiveMeeting(m); setStep("step2"); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
