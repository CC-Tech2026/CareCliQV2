import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  WorkerMobileComplianceReport,
  WorkerMobileSubmitSuccess,
} from "@/components/worker/WorkerMobileComplianceReport";
import { WorkerMobileClockInSheet } from "@/components/worker/WorkerMobileClockInSheet";
import { WorkerMobileSafetyCardSheet } from "@/components/worker/WorkerMobileSafetyCardSheet";
import { WorkerMobileIncidentSheet } from "@/components/worker/WorkerMobileIncidentSheet";
import { WorkerMobileReviewScreen } from "@/components/worker/WorkerMobileReviewScreen";
import { WorkerMobileSessionScreen } from "@/components/worker/WorkerMobileSessionScreen";
import { WorkerMobileSignatureScreen } from "@/components/worker/WorkerMobileSignatureScreen";
import { WorkerMobileTopbar } from "@/components/worker/WorkerMobileTopbar";
import { DuringShiftActionsSidebar } from "@/components/worker/DuringShiftActionsSidebar";
import { useOffline } from "@/context/OfflineContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import {
  checkShiftDocumentationCompliance,
  clockInShift,
  deleteSessionNote,
  endShift,
  startShiftSession,
  submitMissedCheckinReason,
  submitShiftSignature,
  syncSessionNotes,
  updateShiftTasks,
  type ActiveBreakStatus,
  type CheckinWindowStatus,
  type DocumentationComplianceCheck,
  type SessionNoteRecord,
  type ShiftSignaturePayload,
  type ShiftTask,
  type ShiftVisualState,
  type WorkerShift,
} from "@/lib/worker-api";
import {
  formatElapsedTimer,
  formatMobileShiftDuration,
  formatShiftTimeRange,
  hasIncompleteMandatoryTasks,
  MIN_EVIDENCE_NOTE_CHARS,
  newClientNoteId,
  parseIsoMs,
  resolveActiveShiftTasks,
  timerAnchorIso,
} from "@/lib/shift-utils";
import { evaluateWorkerCompliance } from "@workspace/worker-compliance";
import {
  loadFiledNoteIds,
  markNoteIncidentFiled,
  markNotesIncidentFiled,
} from "@/lib/session-incident-reports";

export type WorkerMobilePhase =
  | "scheduled"
  | "session"
  | "review"
  | "compliance"
  | "signature"
  | "submitted"
  | "completed";

function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "just now";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  const time = d
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  return d.toDateString() === new Date().toDateString()
    ? `${time} today`
    : d.toLocaleDateString("en-AU");
}

type Props = {
  shift: WorkerShift;
  sessionNotes: SessionNoteRecord[];
  onRefresh: () => void;
  onNotesRefresh?: () => void;
  onShiftComplete: () => void;
  onBack?: () => void;
  canCheckin?: boolean;
  onCheckin?: () => void;
  checkinStatus?: CheckinWindowStatus;
  breakStatus?: ActiveBreakStatus;
};

export function WorkerMobileShiftView({
  shift,
  sessionNotes,
  onRefresh,
  onNotesRefresh,
  onShiftComplete,
  onBack,
  canCheckin,
  onCheckin,
  checkinStatus,
  breakStatus,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { isOnline, queueWorkerUpdate, flushNow } = useOffline();
  const [phase, setPhase] = useState<WorkerMobilePhase>(() => {
    if (shift.visual_state === "completed") return "completed";
    return shift.visual_state === "scheduled" ? "scheduled" : "session";
  });
  const [tasks, setTasks] = useState<ShiftTask[]>(() => shift.tasks ?? []);
  const [localNotes, setLocalNotes] = useState(sessionNotes);
  const [busy, setBusy] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ title: string; message: string } | null>(null);
  const [incidentDraft, setIncidentDraft] = useState<{ noteId?: string; content?: string } | null>(null);
  const [filedNoteIds, setFiledNoteIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!validation) return;
    const id = setTimeout(() => setValidation(null), 5000);
    return () => clearTimeout(id);
  }, [validation]);

  useEffect(() => {
    setLocalNotes(sessionNotes);
  }, [sessionNotes]);

  useEffect(() => {
    setTasks(shift.tasks ?? []);
  }, [shift.tasks]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (shift.visual_state === "completed") {
      setPhase((current) => (current === "submitted" ? "submitted" : "completed"));
    } else if (shift.visual_state === "clocked_in" || shift.visual_state === "session_active") {
      setPhase((current) =>
        current === "review" || current === "compliance" || current === "signature" || current === "submitted"
          ? current
          : "session",
      );
    }
  }, [shift.visual_state]);

  const plannedShiftMins = useMemo(() => {
    if (shift.scheduled_start && shift.scheduled_end) {
      const startMs = parseIsoMs(shift.scheduled_start);
      const endMs = parseIsoMs(shift.scheduled_end);
      if (startMs != null && endMs != null && endMs > startMs) {
        return (endMs - startMs) / 60000;
      }
    }
    return shift.duration_minutes ?? 0;
  }, [shift.scheduled_start, shift.scheduled_end, shift.duration_minutes]);

  const notifyCheckinScheduleIfLongShift = useCallback(() => {
    if (plannedShiftMins < 240) return;
    showAlert(
      "System check-ins active",
      "This shift includes periodic system check-ins to confirm you're available. You'll get a notification when one's due — please respond within 5 minutes. If you're not able to, it's logged and you'll be asked to explain it before you submit the shift.",
    );
  }, [plannedShiftMins]);

  const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
  const participantName = shift.participant_name ?? "Participant";
  const participantFirstName = participantName.split(" ")[0];
  const sessionId = shift.session_id ?? null;
  const visualState = shift.visual_state;
  const anchor = timerAnchorIso(visualState, shift.session_started_at, shift.clocked_in_at);
  void nowTick;
  const elapsed = useMemo(() => {
    const now = Date.now();
    const live = formatElapsedTimer(anchor, now);
    if (live !== "00:00:00") return live;

    if (shift.clocked_in_at) {
      const endMs = shift.clocked_out_at ? parseIsoMs(shift.clocked_out_at) ?? now : now;
      const fromClockIn = formatElapsedTimer(shift.clocked_in_at, endMs);
      if (fromClockIn !== "00:00:00") return fromClockIn;
    }

    return "00:00:00";
  }, [anchor, nowTick, shift.clocked_in_at, shift.clocked_out_at]);
  const complianceNotes = useMemo(
    () =>
      localNotes.map((n) => ({
        note_id: n.note_id,
        content: n.content,
        task_id: n.task_id,
        goal_id: n.goal_id,
      })),
    [localNotes],
  );

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

  useEffect(() => {
    if (sessionId) setFiledNoteIds(loadFiledNoteIds(sessionId));
  }, [sessionId, localNotes]);

  const [documentationCompliance, setDocumentationCompliance] = useState<DocumentationComplianceCheck | null>(null);
  // Real backend 12-rule check, debounced after note activity settles rather
  // than run on every keystroke - it's a genuine compliance_engine call
  // (word count, language, goal references, RP/incident handling, etc), not
  // free to run continuously the way the local evaluateWorkerCompliance
  // heuristic above is.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkShiftDocumentationCompliance(shift.id)
        .then((result) => {
          if (!cancelled) setDocumentationCompliance(result);
        })
        .catch(() => {
          /* keep showing the last known result rather than clearing it on a transient failure */
        });
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shift.id, sessionId, localNotes.length]);

  // One immediate (non-debounced) check right as the worker reaches the
  // final review screen, so what they see on the compliance report reflects
  // the actual final state - not a slightly-stale snapshot from the last
  // 3s-debounced poll if they just added one more note before continuing.
  useEffect(() => {
    if (phase !== "review" || !sessionId) return;
    let cancelled = false;
    checkShiftDocumentationCompliance(shift.id)
      .then((result) => {
        if (!cancelled) setDocumentationCompliance(result);
      })
      .catch(() => {
        /* keep showing the last known result rather than clearing it on a transient failure */
      });
    return () => {
      cancelled = true;
    };
  }, [phase, shift.id, sessionId]);

  const openIncidentReport = useCallback((noteId?: string, content?: string) => {
    setIncidentDraft({ noteId, content });
  }, []);

  const handleIncidentFiled = useCallback(
    (noteId?: string) => {
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
    },
    [sessionId, compliance.noteFlags],
  );

  const [clockInSheetOpen, setClockInSheetOpen] = useState(false);
  const [safetyCardOpen, setSafetyCardOpen] = useState(false);

  const submitClockIn = useCallback(
    async (method: "gps" | "qr", location: { lat: number; lng: number; accuracy?: number } | null, qrToken?: string) => {
      setBusy("clock-in");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        const clientTimestamp = new Date().toISOString();

        if (!isOnline) {
          await queueWorkerUpdate({
            type: "clock_in",
            id: `clock_in-${shift.id}`,
            shiftId: shift.id,
            method,
            location,
            qrToken,
            clientTimestamp,
            startSession: true,
            timestamp: Date.now(),
          });
          onRefresh();
          setPhase("session");
          showAlert(
            "Clocked in offline",
            "Your clock-in is saved and will sync automatically when you're back online. You can keep working.",
          );
          notifyCheckinScheduleIfLongShift();
          return;
        }

        await clockInShift(shift.id, {
          method,
          location,
          qr_token: qrToken,
          client_timestamp: clientTimestamp,
        });
        await startShiftSession(shift.id);
        onRefresh();
        setPhase("session");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(`Clocked in for ${participantName}`, "success");
        notifyCheckinScheduleIfLongShift();
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.toLowerCase().includes("acknowledge the participant safety card")) {
          // Backend still blocked us - shift.requires_safety_ack was stale
          // (e.g. content changed since the shift list was last fetched).
          // Show the safety card instead of a dead-end error.
          setSafetyCardOpen(true);
        } else {
          Alert.alert("Clock-in failed", message || "Please try again.");
        }
      } finally {
        setBusy(null);
      }
    },
    [shift.id, onRefresh, isOnline, queueWorkerUpdate, notifyCheckinScheduleIfLongShift],
  );

  const handleGpsClockIn = useCallback(async () => {
    setClockInSheetOpen(false);
    let location: { lat: number; lng: number; accuracy?: number } | null = null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
        };
      }
    } catch {
      /* GPS unavailable (e.g. airplane mode) — clock in without location */
    }
    await submitClockIn("gps", location);
  }, [submitClockIn]);

  const handleQrClockIn = useCallback(
    async (token: string) => {
      setClockInSheetOpen(false);
      await submitClockIn("qr", null, token);
    },
    [submitClockIn],
  );

  const handleClockIn = useCallback(() => {
    if (shift.requires_safety_ack) {
      setSafetyCardOpen(true);
      return;
    }
    setClockInSheetOpen(true);
  }, [shift.requires_safety_ack]);

  const handleAttemptEnd = useCallback(() => {
    if (busy) return;
    const active = resolveActiveShiftTasks(shift.tasks, tasks);
    if (hasIncompleteMandatoryTasks(active)) {
      setValidation({
        title: "Mandatory Tasks Incomplete",
        message: "Review task completion and evidence before ending your shift.",
      });
      return;
    }
    setValidation(null);
    setPhase("review");
  }, [busy, shift.tasks, tasks]);

  const refreshNotes = onNotesRefresh ?? onRefresh;

  // Every path below used to swallow a failed server call once the device
  // was nominally "online" - the local state (already updated optimistically
  // above each call) kept looking saved with no error shown and nothing
  // queued for retry, so the change silently never reached the server. Now
  // any failure falls back to the same offline queue used for the
  // genuinely-offline case, so it's retried automatically instead of lost.
  const handleSaveNote = async (noteId: string, content: string) => {
    if (!sessionId) return;
    const updated = localNotes.map((n) =>
      n.note_id === noteId ? { ...n, content, auto_saved_at: new Date().toISOString() } : n,
    );
    setLocalNotes(updated);
    const edited = updated.find((n) => n.note_id === noteId);
    try {
      await syncSessionNotes(sessionId, updated);
    } catch {
      if (edited) {
        await queueWorkerUpdate({ type: "sync_notes", id: noteId, sessionId, notes: [edited], timestamp: Date.now() });
      }
    }
    refreshNotes();
  };

  const handleRemoveNote = async (noteId: string) => {
    if (!sessionId) return;
    const note = localNotes.find((n) => n.note_id === noteId);
    if (!note) return;

    const updated = localNotes.filter((n) => n.note_id !== noteId);
    setLocalNotes(updated);

    const taskId = note.task_id;
    if (taskId) {
      const remainingForTask = updated.filter((n) => n.task_id === taskId && n.content?.trim());
      const combined = remainingForTask.map((n) => n.content.trim()).join("\n");
      const stillDocumented =
        combined.length >= MIN_EVIDENCE_NOTE_CHARS ||
        remainingForTask.some(
          (n) => n.note_type === "photo" || n.note_type === "file" || n.note_type === "voice",
        );

      if (!stillDocumented) {
        const nextTasks = tasks.map((task) => {
          if (task.task_id !== taskId) return task;
          return {
            ...task,
            completed: false,
            completed_at: null,
            has_photo: remainingForTask.some((n) => n.note_type === "photo"),
            has_voice: remainingForTask.some((n) => n.note_type === "voice"),
            has_text_notes: remainingForTask.some(
              (n) => n.note_type === "text" || n.note_type === "file" || !n.note_type,
            ),
          };
        });
        setTasks(nextTasks);
        try {
          await updateShiftTasks(shift.id, nextTasks);
        } catch {
          await queueWorkerUpdate({ type: "update_tasks", id: `${shift.id}-${Date.now()}`, shiftId: shift.id, tasks: nextTasks, timestamp: Date.now() });
        }
      }
    }

    try {
      await deleteSessionNote(sessionId, noteId);
    } catch {
      await queueWorkerUpdate({ type: "delete_note", id: `del-${noteId}`, sessionId, noteId, timestamp: Date.now() });
    }
    refreshNotes();
  };

  const handleAddMissingNote = async (taskId: string, content: string) => {
    if (!sessionId) return;
    const note: SessionNoteRecord = {
      note_id: newClientNoteId(),
      session_id: sessionId,
      task_id: taskId,
      content,
      created_at: new Date().toISOString(),
      auto_saved_at: new Date().toISOString(),
      note_type: "text",
    };
    const updated = [...localNotes, note];
    setLocalNotes(updated);
    try {
      await syncSessionNotes(sessionId, updated);
    } catch {
      await queueWorkerUpdate({ type: "sync_notes", id: note.note_id, sessionId, notes: [note], timestamp: Date.now() });
    }
    refreshNotes();
  };

  const handleSubmitReview = () => {
    setPhase("compliance");
  };

  const handleContinueFromCompliance = () => {
    const redFlags = compliance.rules?.filter((rule) => rule.status === "fail") ?? [];
    if (redFlags.length > 0) {
      showAlert(
        "Unresolved compliance flags",
        "You can still submit, but your coordinator will be notified. Submit anyway?",
        [
          { text: "Revise notes", style: "cancel", onPress: () => setPhase("review") },
          { text: "Continue", style: "destructive", onPress: () => setPhase("signature") },
        ],
      );
      return;
    }
    setPhase("signature");
  };

  // Signature submission and ending the shift are one transaction now, not
  // two independent calls split across this component and ShiftSignatureForm
  // - that split was the actual bug behind shifts silently never completing:
  // ShiftSignatureForm swallowed a failed signature submit with nothing but
  // a haptic buzz and no queue fallback, and endShift() itself had no offline
  // handling at all. A worker signing off with a weak connection (extremely
  // common leaving a client's home) would see nothing happen, and the shift
  // would stay stuck in "today" forever - never completed, so never showing
  // up in shift history either.
  const queueEndShift = useCallback(
    async (signature: ShiftSignaturePayload) => {
      const queued = await queueWorkerUpdate({
        type: "end_shift",
        id: `end_shift-${shift.id}`,
        shiftId: shift.id,
        signature,
        timestamp: Date.now(),
      });
      return queued;
    },
    [shift.id, queueWorkerUpdate],
  );

  const handleSigned = async (signature: ShiftSignaturePayload) => {
    setBusy("end");
    try {
      if (!isOnline) {
        const queued = await queueEndShift(signature);
        if (queued) {
          setSubmittedAt(new Date().toISOString());
          setPhase("submitted");
          onRefresh();
          showAlert(
            "Saved offline",
            "Your signature and shift completion are saved and will submit automatically once you're back online.",
          );
        } else {
          Alert.alert("Not saved yet", "Couldn't save your sign-off. Please try again before leaving this screen.");
        }
        return;
      }

      try {
        await submitShiftSignature(shift.id, signature);
      } catch (sigErr) {
        const message = sigErr instanceof Error ? sigErr.message : "";
        if (!/already signed/i.test(message)) throw sigErr;
      }

      // Flush any queued notes/tasks/attachments/incidents before finalizing
      // so the shift isn't marked complete while documentation is still
      // sitting unsynced on the device.
      const remaining = await flushNow();

      try {
        await endShift(shift.id);
      } catch (endErr) {
        const message = endErr instanceof Error ? endErr.message : "";
        if (!/already completed/i.test(message)) throw endErr;
      }

      setSubmittedAt(new Date().toISOString());
      setPhase("submitted");
      onRefresh();
      if (remaining > 0) {
        Alert.alert(
          "Shift submitted",
          `${remaining} item${remaining === 1 ? "" : "s"} (notes, photos, or updates) couldn't reach the server yet and will sync automatically once you're back online. Don't uninstall the app or clear its data until they've synced.`,
        );
      }
    } catch (err) {
      // A genuine live failure (nominally online, but the signature or
      // end-shift call itself failed for a real reason - e.g. a dropped
      // connection mid-request) used to just show an error and strand the
      // attempt. Fall back to the same offline queue instead of losing it.
      const queued = await queueEndShift(signature);
      if (queued) {
        setSubmittedAt(new Date().toISOString());
        setPhase("submitted");
        onRefresh();
        showAlert(
          "Saved",
          "Couldn't reach the server just now - your sign-off will submit automatically once you're back online.",
        );
      } else {
        Alert.alert("End shift failed", err instanceof Error ? err.message : "Please try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  const summaryTasks = activeTasks.filter((t) => !t.marked_na);
  const summaryTasksDone = summaryTasks.filter((t) => t.completed).length;

  if (phase === "submitted") {
    return (
      <WorkerMobileSubmitSuccess
        participantName={participantName}
        duration={formatMobileShiftDuration(shift, elapsed)}
        tasksCompleted={summaryTasksDone}
        tasksTotal={summaryTasks.length}
        score={compliance.score}
        submittedAt={formatSubmittedAt(submittedAt)}
        onDone={onShiftComplete}
      />
    );
  }

  if (phase === "completed") {
    return (
      <WorkerMobileSubmitSuccess
        participantName={participantName}
        duration={formatMobileShiftDuration(shift, elapsed)}
        tasksCompleted={summaryTasksDone}
        tasksTotal={summaryTasks.length}
        score={compliance.score}
        submittedAt={formatSubmittedAt(submittedAt ?? shift.clocked_out_at ?? null)}
        onDone={onBack ?? onShiftComplete}
      />
    );
  }

  if (phase === "signature") {
    return (
      <WorkerMobileSignatureScreen
        participantName={participantName}
        busy={Boolean(busy)}
        onSigned={handleSigned}
        onBack={() => setPhase("compliance")}
      />
    );
  }

  if (phase === "compliance") {
    return (
      <WorkerMobileComplianceReport
        compliance={compliance}
        documentationCompliance={documentationCompliance}
        onClose={() => setPhase("review")}
        onContinue={handleContinueFromCompliance}
        onReviseNotes={() => setPhase("review")}
        onOpenIncidentReport={() => openIncidentReport()}
      />
    );
  }

  if (phase === "review") {
    return (
      <View style={[styles.sessionWrap, { backgroundColor: colors.background }]}>
        <WorkerMobileTopbar
          participantName={participantName}
          visualState="session_active"
          phase="review"
          elapsed={elapsed}
          onBack={() => setPhase("session")}
        />
        <WorkerMobileReviewScreen
          participantName={participantName}
          healthAlerts={shift.health_alerts}
          tasks={activeTasks}
          notes={localNotes}
          compliance={compliance}
          busy={Boolean(busy)}
          missedCheckins={(checkinStatus ?? shift.checkin_status)?.missed_checkins_needing_reason}
          onSubmitMissedCheckinReason={async (scheduledCheckinId, reason) => {
            if (!sessionId) return;
            await submitMissedCheckinReason(sessionId, scheduledCheckinId, reason);
          }}
          onSaveNote={handleSaveNote}
          onRemoveNote={handleRemoveNote}
          onAddMissingNote={handleAddMissingNote}
          onSubmit={handleSubmitReview}
          onViewComplianceReport={() => setPhase("compliance")}
          onOpenIncidentReport={openIncidentReport}
        />
        <Modal
          visible={incidentDraft !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setIncidentDraft(null)}
        >
          {incidentDraft && (
            <WorkerMobileIncidentSheet
              shiftId={shift.id}
              participantId={shift.participant_id}
              participantName={participantName}
              sessionId={sessionId}
              shiftAddress={shift.participant_address}
              sourceNoteId={incidentDraft.noteId}
              sourceNoteContent={incidentDraft.content}
              onFiled={handleIncidentFiled}
              onClose={() => setIncidentDraft(null)}
            />
          )}
        </Modal>
        <DuringShiftActionsSidebar
          shiftId={shift.id}
          officePhone={shift.office_contact_number}
          onReportIncident={() => openIncidentReport()}
        />
      </View>
    );
  }

  if (phase === "session" || visualState === "session_active" || visualState === "clocked_in") {
    return (
      <View style={[styles.sessionWrap, { backgroundColor: colors.background }]}>
        <WorkerMobileTopbar
          participantName={participantName}
          visualState={visualState}
          phase="session"
          elapsed={elapsed}
          showEnd={visualState === "session_active"}
          onEnd={handleAttemptEnd}
          endBusy={busy === "end"}
          onBack={onBack}
          canCheckin={canCheckin}
          onCheckin={onCheckin}
        />
        {validation && (
          <View style={styles.validationBanner}>
            <View style={styles.validationText}>
              <Text style={[styles.validationTitle, { fontFamily: "Inter_700Bold" }]}>{validation.title}</Text>
              <Text style={[styles.validationMessage, { fontFamily: "Inter_500Medium" }]}>{validation.message}</Text>
            </View>
            <Pressable onPress={() => setValidation(null)} hitSlop={8}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
        <WorkerMobileSessionScreen
          shiftId={shift.id}
          participantName={participantName}
          participantFirstName={participantFirstName}
          participantId={shift.participant_id}
          healthAlerts={shift.health_alerts}
          clockedInAt={shift.clocked_in_at ?? null}
          sessionId={sessionId}
          tasks={activeTasks}
          onTasksChange={setTasks}
          sessionNotes={localNotes}
          compliance={compliance}
          documentationCompliance={documentationCompliance}
          onNotesRefresh={refreshNotes}
          onOpenIncidentReport={openIncidentReport}
          disabled={Boolean(busy)}
          sessionElapsed={elapsed}
          checkinStatus={checkinStatus ?? shift.checkin_status}
          breakStatus={breakStatus ?? shift.break_status}
          onCheckin={onCheckin}
        />
        <Modal
          visible={incidentDraft !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setIncidentDraft(null)}
        >
          {incidentDraft && (
            <WorkerMobileIncidentSheet
              shiftId={shift.id}
              participantId={shift.participant_id}
              participantName={participantName}
              sessionId={sessionId}
              shiftAddress={shift.participant_address}
              sourceNoteId={incidentDraft.noteId}
              sourceNoteContent={incidentDraft.content}
              onFiled={handleIncidentFiled}
              onClose={() => setIncidentDraft(null)}
            />
          )}
        </Modal>
        <DuringShiftActionsSidebar
          shiftId={shift.id}
          officePhone={shift.office_contact_number}
          onReportIncident={() => openIncidentReport()}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WorkerMobileTopbar
        participantName={participantName}
        visualState={visualState}
        phase="scheduled"
        onBack={onBack}
      />
      <ScrollView
        style={styles.scheduled}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 12 }}
      >
      <View style={[styles.scheduledCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.scheduledName, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {participantName}
        </Text>
        <Text style={[styles.scheduledTime, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {shift.scheduled_start
            ? formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)
            : "Time TBC"}
        </Text>

        {shift.participant_address && (
          <Pressable
            onPress={() => {
              const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address!)}`;
              Linking.openURL(url);
            }}
            style={styles.mapLink}
          >
            <Feather name="map-pin" size={14} color={colors.primary} />
            <Text style={[styles.address, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {shift.participant_address}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleClockIn}
          disabled={Boolean(busy)}
          style={[styles.clockInBtn, { backgroundColor: colors.primary }]}
        >
          {busy === "clock-in" ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.clockInText, { fontFamily: "Inter_700Bold" }]}>Clock In</Text>
          )}
        </Pressable>
      </View>
      </ScrollView>
      <Modal
        visible={clockInSheetOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setClockInSheetOpen(false)}
      >
        <WorkerMobileClockInSheet
          onClose={() => setClockInSheetOpen(false)}
          onChooseGps={() => void handleGpsClockIn()}
          onQrScanned={(token) => void handleQrClockIn(token)}
        />
      </Modal>
      <Modal
        visible={safetyCardOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSafetyCardOpen(false)}
      >
        {shift.participant_id && (
          <WorkerMobileSafetyCardSheet
            participantId={shift.participant_id}
            participantName={shift.participant_name}
            shiftId={shift.id}
            mandatory
            onClose={() => setSafetyCardOpen(false)}
            onAcknowledged={() => {
              setSafetyCardOpen(false);
              setClockInSheetOpen(true);
            }}
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sessionWrap: { flex: 1 },
  validationBanner: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  validationText: { flex: 1, gap: 4 },
  validationTitle: { color: "#FFFFFF", fontSize: 15 },
  validationMessage: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, opacity: 0.95 },
  scheduled: { flex: 1, paddingHorizontal: 16 },
  scheduledCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  scheduledName: { fontSize: 22 },
  scheduledTime: { fontSize: 15 },
  mapLink: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  address: { fontSize: 13, flex: 1 },
  clockInBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  clockInText: { color: "#FFFFFF", fontSize: 16 },
});
