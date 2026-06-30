import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { useLocation } from "wouter";
import { Loader2, MapPin, Navigation, Phone } from "lucide-react";
import { WM } from "@/lib/worker-mobile-tokens";
import { evaluateWorkerCompliance } from "@/lib/worker-compliance-engine";
import {
  loadFiledNoteIds,
  markNoteIncidentFiled,
  markNotesIncidentFiled,
} from "@/lib/session-incident-reports";
import type { ShiftTask, ShiftVisualState, WorkerShift } from "@/services/shiftService";
import type { SessionNoteRecord } from "@/services/sessionNotesService";
import { syncSessionNotes } from "@/services/sessionNotesService";
import { newClientNoteId } from "@/lib/session-notes-storage";
import { ParticipantRiskAcknowledgementSection } from "@/components/shifts/ParticipantRiskAlerts";
import { ShiftTravelExpenseCard, type MileageDraftState } from "@/components/shifts/ShiftTravelExpenseCard";
import { ShiftTransitExpenseCard } from "@/components/shifts/ShiftTransitExpenseCard";
import { formatMobileSubmittedAt } from "@/lib/datetime";
import { useGoalLinkedTaskComplianceNotes } from "@/hooks/useGoalLinkedTaskComplianceNotes";
import { WorkerMobileIncidentSheet } from "./WorkerMobileIncidentSheet";
import { WorkerMobileComplianceReport, WorkerMobileSubmitSuccess } from "./WorkerMobileComplianceReport";
import { WorkerMobileReviewScreen } from "./WorkerMobileReviewScreen";
import { WorkerMobileSessionScreen } from "./WorkerMobileSessionScreen";
import { WorkerMobileSignatureScreen } from "./WorkerMobileSignatureScreen";
import { WorkerMobileTopbar } from "./WorkerMobileTopbar";
import {
  formatShiftTimeRange,
  shiftDurationMinutes,
  formatDurationLabel,
  formatMobileShiftDuration,
  shiftNeedsRiskAck,
  shiftHasRiskAlerts,
  resolveActiveShiftTasks,
} from "@/lib/shift-utils";
import type { ShiftSignature } from "@/services/complianceService";

export type WorkerMobilePhase = "scheduled" | "session" | "review" | "signature" | "submitted" | "completed";

type Props = {
  shift: WorkerShift;
  visualState: ShiftVisualState;
  tasks: ShiftTask[];
  setTasks: (tasks: ShiftTask[]) => void;
  elapsed: string;
  clockedInAt: string | null;
  sessionId: string | null;
  busy: string | null;
  participantFirstName?: string;
  submissionComplete?: boolean;
  onClockIn: () => void;
  onAutoStartSession: () => Promise<void>;
  onShiftComplete: () => Promise<void>;
  ackChecked: boolean;
  setAckChecked: (v: boolean) => void;
  onRequestAcknowledge: () => void;
  safetyOpen: boolean;
  setSafetyOpen: (v: boolean) => void;
  isTutorialDemo?: boolean;
  mileageDraftRef?: MutableRefObject<MileageDraftState>;
};

export function WorkerMobileShiftView({
  shift,
  visualState,
  tasks,
  setTasks,
  elapsed,
  clockedInAt,
  sessionId,
  busy,
  participantFirstName,
  onClockIn,
  onAutoStartSession,
  onShiftComplete,
  ackChecked,
  setAckChecked,
  onRequestAcknowledge,
  safetyOpen,
  setSafetyOpen,
  isTutorialDemo,
  submissionComplete,
  mileageDraftRef,
}: Props) {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<WorkerMobilePhase>(() => {
    if (visualState === "completed") return "completed";
    return visualState === "scheduled" ? "scheduled" : "session";
  });
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<Set<string>>(new Set());
  const [filedNoteIds, setFiledNoteIds] = useState<Set<string>>(() => new Set());
  const [incidentDraft, setIncidentDraft] = useState<{ noteId?: string; content?: string } | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
  const isSessionLike = visualState === "clocked_in" || visualState === "session_active";
  const hasAlerts = shiftHasRiskAlerts(shift);
  const risksAcked = shift.risks_acknowledged ?? false;
  const needsRiskAck = shiftNeedsRiskAck(shift);
  const effectiveRiskAcked = risksAcked || (Boolean(isTutorialDemo) && ackChecked);
  const showRiskAckPending = visualState === "scheduled" && !effectiveRiskAcked && needsRiskAck;
  const showRiskAcknowledged = visualState === "scheduled" && effectiveRiskAcked && hasAlerts;
  const riskAckAlerts = shift.health_alerts ?? [];
  const showEnd = visualState === "session_active" && phase === "session";
  const isFullImmersive = phase !== "scheduled";

  const { notes: complianceNotes, sessionNotes, refresh: refreshComplianceNotes } =
    useGoalLinkedTaskComplianceNotes(sessionId, activeTasks);

  useEffect(() => {
    if (sessionId) setFiledNoteIds(loadFiledNoteIds(sessionId));
  }, [sessionId]);

  const compliance = useMemo(
    () =>
      evaluateWorkerCompliance({
        notes: complianceNotes,
        tasks: activeTasks,
        participantFirstName,
        shiftEndIso: shift.clocked_out_at ?? null,
        incidentReportFiledNoteIds: filedNoteIds,
        includeSubmitWarnings: phase === "review",
      }),
    [complianceNotes, activeTasks, participantFirstName, shift.clocked_out_at, filedNoteIds, phase],
  );

  const visibleNotifications = compliance.notifications.filter(
    (n) => !dismissedNotificationIds.has(n.id),
  );

  useEffect(() => {
    if (!isFullImmersive) return;
    document.body.classList.add("worker-mobile-immersive");
    return () => document.body.classList.remove("worker-mobile-immersive");
  }, [isFullImmersive]);

  useEffect(() => {
    if (submissionComplete) {
      setSubmittedAt(formatMobileSubmittedAt(new Date().toISOString()));
      setPhase("submitted");
    }
  }, [submissionComplete]);

  useEffect(() => {
    if (visualState === "completed") {
      setPhase((current) => (current === "submitted" ? "submitted" : "completed"));
    } else if (visualState === "clocked_in" || visualState === "session_active") {
      setPhase((current) =>
        current === "review" || current === "signature" || current === "submitted" ? current : "session",
      );
    }
  }, [visualState]);

  useEffect(() => {
    if (!isSessionLike || autoStarted || isTutorialDemo) return;
    if (visualState === "clocked_in") {
      setAutoStarted(true);
      void onAutoStartSession();
    }
  }, [visualState, isSessionLike, autoStarted, onAutoStartSession, isTutorialDemo]);

  const handleSaveNote = async (noteId: string, content: string) => {
    if (!sessionId) return;
    const existing = sessionNotes.find((note) => note.note_id === noteId);
    if (!existing) return;
    const updated = { ...existing, content, auto_saved_at: new Date().toISOString() };
    try {
      await syncSessionNotes(sessionId, [updated]);
    } catch {
      /* optimistic */
    }
    void refreshComplianceNotes();
  };

  const handleAddMissingNote = async (taskId: string, content: string) => {
    if (!sessionId) return;
    const now = new Date().toISOString();
    const note: SessionNoteRecord = {
      note_id: newClientNoteId(),
      session_id: sessionId,
      task_id: taskId,
      content,
      created_at: now,
      auto_saved_at: now,
      note_type: "text",
      synced: false,
    };
    try {
      await syncSessionNotes(sessionId, [note]);
    } catch {
      /* queued offline */
    }
    void refreshComplianceNotes();
  };

  const handleEnd = () => {
    void refreshComplianceNotes();
    setPhase("review");
  };

  const openIncidentReport = (noteId?: string, content?: string) => {
    setIncidentDraft({ noteId, content });
  };

  const handleIncidentFiled = (noteId?: string) => {
    if (!sessionId) {
      setIncidentDraft(null);
      return;
    }
    if (noteId) {
      markNoteIncidentFiled(sessionId, noteId);
    } else {
      const pending = compliance.noteFlags
        .filter((f) => f.ruleId === 9 && f.severity === "fail")
        .map((f) => f.noteId);
      if (pending.length) markNotesIncidentFiled(sessionId, pending);
    }
    setFiledNoteIds(loadFiledNoteIds(sessionId));
    setIncidentDraft(null);
  };

  const handleSubmit = () => {
    const redFlags = compliance.rules.filter((rule) => rule.status === "fail");
    if (redFlags.length > 0) {
      const proceed = window.confirm(
        "You have unresolved compliance flags. You can still submit, but your coordinator will be notified. Submit anyway?",
      );
      if (!proceed) return;
    }
    setPhase("signature");
  };

  const handleSignatureComplete = async () => {
    await onShiftComplete();
  };

  const directionsUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;

  const duration = formatDurationLabel(
    shiftDurationMinutes(shift.scheduled_start, shift.scheduled_end, shift.duration_minutes),
  );

  const mobileSuccessProps = () => {
    const summary = shift.completion_summary;
    const tasksCompleted =
      summary?.tasks_completed ?? activeTasks.filter((task) => task.completed).length;
    const tasksTotal = summary?.tasks_total ?? activeTasks.length;
    const signature = shift.shift_signature as ShiftSignature | undefined;
    const submittedIso =
      shift.clocked_out_at ?? signature?.signed_at ?? shift.risks_acknowledged_at ?? null;
    const submittedLabel = submittedAt ?? (submittedIso ? formatMobileSubmittedAt(submittedIso) : "Just now");

    return {
      participantName: shift.participant_name ?? "Participant",
      duration: formatMobileShiftDuration(shift, elapsed || undefined) || duration || "—",
      tasksCompleted,
      tasksTotal,
      score: compliance.score,
      submittedAt: submittedLabel,
    };
  };

  if (phase === "completed" || phase === "submitted") {
    const success = mobileSuccessProps();
    return (
      <div className="fixed inset-0 z-40 flex flex-col overflow-hidden" style={{ background: WM.bg }}>
        <WorkerMobileSubmitSuccess
          {...success}
          onBack={() => {
            window.location.href = "/my-shifts";
          }}
        />
      </div>
    );
  }

  if (phase === "signature") {
    return (
      <WorkerMobileSignatureScreen
        shiftId={shift.id}
        participantName={shift.participant_name ?? "Participant"}
        busy={busy === "end"}
        tutorialDemo={isTutorialDemo}
        onSigned={handleSignatureComplete}
        onBack={() => setPhase("review")}
      />
    );
  }

  if (phase === "review") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col overflow-hidden" style={{ background: WM.bg }}>
        <WorkerMobileTopbar
          participantName={shift.participant_name ?? "Participant"}
          visualState="session_active"
          phase="review"
          elapsed={elapsed}
          onBack={() => setPhase("session")}
        />
        <WorkerMobileReviewScreen
          participantName={shift.participant_name ?? "Participant"}
          healthAlerts={shift.health_alerts ?? []}
          tasks={activeTasks}
          notes={sessionNotes}
          compliance={compliance}
          busy={busy === "end"}
          onSaveNote={(id, content) => void handleSaveNote(id, content)}
          onAddMissingNote={(taskId, content) => void handleAddMissingNote(taskId, content)}
          onSubmit={handleSubmit}
          onViewComplianceReport={() => setComplianceOpen(true)}
          onOpenIncidentReport={(noteId, content) => openIncidentReport(noteId, content)}
        />
        {incidentDraft && (
          <WorkerMobileIncidentSheet
            shiftId={shift.id}
            participantId={shift.participant_id}
            participantName={shift.participant_name}
            sessionId={sessionId}
            shiftAddress={shift.participant_address}
            sourceNoteId={incidentDraft.noteId}
            sourceNoteContent={incidentDraft.content}
            onFiled={handleIncidentFiled}
            onClose={() => setIncidentDraft(null)}
          />
        )}
        {complianceOpen && (
          <WorkerMobileComplianceReport
            score={compliance.score}
            rules={compliance.rules}
            onClose={() => setComplianceOpen(false)}
            onOpenIncidentReport={() => openIncidentReport()}
          />
        )}
      </div>
    );
  }

  if (phase === "scheduled" || visualState === "scheduled") {
    return (
      <div className="space-y-4 px-4 pb-8">
        <div
          className="overflow-hidden rounded-2xl border"
          style={{ borderColor: WM.border, borderLeftWidth: 3, borderLeftColor: WM.purple, background: WM.surface }}
        >
          <div className="p-4">
            <p className="text-[15px] font-semibold" style={{ color: WM.text }}>
              {shift.participant_name}
            </p>
            <p className="mt-1 text-[13px]" style={{ color: WM.muted }}>
              {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)} · {duration}
            </p>
            {shift.participant_address && (
              <p className="mt-1 flex items-center gap-1 text-[12px]" style={{ color: WM.muted }}>
                <MapPin size={12} /> {shift.participant_address}
              </p>
            )}
          </div>

          <div className="flex gap-2 border-t px-4 py-3" style={{ borderColor: WM.border }}>
            {directionsUrl && (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border"
                style={{ borderColor: WM.border }}
                aria-label="Directions"
              >
                <Navigation size={18} style={{ color: WM.purple }} />
              </a>
            )}
            {shift.participant_phone && (
              <a
                href={`tel:${shift.participant_phone}`}
                className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border"
                style={{ borderColor: WM.border }}
                aria-label="Call"
              >
                <Phone size={18} style={{ color: WM.purple }} />
              </a>
            )}
          </div>
        </div>

        {showRiskAckPending && (
          <ParticipantRiskAcknowledgementSection
            alerts={riskAckAlerts}
            open={safetyOpen}
            onToggle={() => setSafetyOpen(!safetyOpen)}
            ackChecked={ackChecked}
            busy={busy === "ack"}
            onRequestAcknowledge={onRequestAcknowledge}
            onUncheck={() => setAckChecked(false)}
            onViewSupportInstructions={() => setSafetyOpen(true)}
          />
        )}

        {showRiskAcknowledged && (
          <ParticipantRiskAcknowledgementSection
            alerts={riskAckAlerts}
            open={safetyOpen}
            onToggle={() => setSafetyOpen(!safetyOpen)}
            acknowledged
            acknowledgedAt={shift.risks_acknowledged_at}
            acknowledgedByName={shift.risks_acknowledged_by_name}
            ackChecked
            busy={false}
            onRequestAcknowledge={onRequestAcknowledge}
            onUncheck={() => setAckChecked(false)}
          />
        )}

        <ShiftTravelExpenseCard
          shiftId={shift.id}
          shiftStatus={shift.status}
          clockedInAt={clockedInAt}
          mileageDraftRef={mileageDraftRef}
        />

        <ShiftTransitExpenseCard shiftId={shift.id} shiftStatus={shift.status} />

        <button
          type="button"
          onClick={onClockIn}
          disabled={busy !== null || (needsRiskAck && !effectiveRiskAcked)}
          className="flex h-[42px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: WM.amber }}
          data-tutorial="clock-in"
        >
          {busy === "clock" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <MapPin size={16} /> Clock In
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden" style={{ background: WM.bg }}>
      <WorkerMobileTopbar
        participantName={shift.participant_name ?? "Participant"}
        visualState={visualState}
        phase="session"
        elapsed={elapsed}
        showEnd={showEnd}
        onEnd={handleEnd}
        endBusy={busy === "end"}
        onBack={() => navigate("/my-shifts")}
      />

      <WorkerMobileSessionScreen
        shiftId={shift.id}
        participantName={shift.participant_name ?? "Participant"}
        participantFirstName={participantFirstName}
        healthAlerts={shift.health_alerts ?? []}
        clockedInAt={clockedInAt}
        sessionId={sessionId}
        tasks={activeTasks}
        onTasksChange={setTasks}
        sessionNotes={sessionNotes}
        compliance={compliance}
        visibleNotifications={visibleNotifications}
        onDismissNotification={(id) =>
          setDismissedNotificationIds((prev) => new Set(prev).add(id))
        }
        onOpenIncidentReport={openIncidentReport}
        onNotesRefresh={refreshComplianceNotes}
        tutorialDemo={isTutorialDemo}
        disabled={busy !== null}
      />

      {incidentDraft && (
        <WorkerMobileIncidentSheet
          shiftId={shift.id}
          participantId={shift.participant_id}
          participantName={shift.participant_name}
          sessionId={sessionId}
          shiftAddress={shift.participant_address}
          sourceNoteId={incidentDraft.noteId}
          sourceNoteContent={incidentDraft.content}
          onFiled={handleIncidentFiled}
          onClose={() => setIncidentDraft(null)}
        />
      )}

      {complianceOpen && (
        <WorkerMobileComplianceReport
          score={compliance.score}
          rules={compliance.rules}
          onClose={() => setComplianceOpen(false)}
          onOpenIncidentReport={() => openIncidentReport()}
        />
      )}
    </div>
  );
}
