import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import { WorkerMobileIncidentSheet } from "@/components/worker/WorkerMobileIncidentSheet";
import { WorkerMobileReviewScreen } from "@/components/worker/WorkerMobileReviewScreen";
import { WorkerMobileSessionScreen } from "@/components/worker/WorkerMobileSessionScreen";
import { WorkerMobileSignatureScreen } from "@/components/worker/WorkerMobileSignatureScreen";
import { WorkerMobileTopbar } from "@/components/worker/WorkerMobileTopbar";
import { DuringShiftActionsSidebar } from "@/components/worker/DuringShiftActionsSidebar";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import {
  acknowledgeShiftRisks,
  clockInShift,
  endShift,
  startShiftSession,
  syncSessionNotes,
  type SessionNoteRecord,
  type ShiftTask,
  type ShiftVisualState,
  type WorkerShift,
} from "@/lib/worker-api";
import {
  formatElapsedTimer,
  formatMobileShiftDuration,
  hasIncompleteMandatoryTasks,
  newClientNoteId,
  resolveActiveShiftTasks,
  shiftHasRiskAlerts,
  shiftNeedsRiskAck,
  timerAnchorIso,
} from "@/lib/shift-utils";
import { evaluateWorkerCompliance } from "@workspace/worker-compliance";
import {
  loadFiledNoteIds,
  markNoteIncidentFiled,
  markNotesIncidentFiled,
} from "@/lib/session-incident-reports";

export type WorkerMobilePhase = "scheduled" | "session" | "review" | "signature" | "submitted" | "completed";

type Props = {
  shift: WorkerShift;
  sessionNotes: SessionNoteRecord[];
  onRefresh: () => void;
  onShiftComplete: () => void;
  onBack?: () => void;
  canCheckin?: boolean;
  onCheckin?: () => void;
};

export function WorkerMobileShiftView({
  shift,
  sessionNotes,
  onRefresh,
  onShiftComplete,
  onBack,
  canCheckin,
  onCheckin,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [phase, setPhase] = useState<WorkerMobilePhase>(() => {
    if (shift.visual_state === "completed") return "completed";
    return shift.visual_state === "scheduled" ? "scheduled" : "session";
  });
  const [tasks, setTasks] = useState<ShiftTask[]>(() => shift.tasks ?? []);
  const [localNotes, setLocalNotes] = useState(sessionNotes);
  const [busy, setBusy] = useState<string | null>(null);
  const [complianceOpen, setComplianceOpen] = useState(false);
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
        current === "review" || current === "signature" || current === "submitted" ? current : "session",
      );
    }
  }, [shift.visual_state]);

  const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
  const participantName = shift.participant_name ?? "Participant";
  const participantFirstName = participantName.split(" ")[0];
  const sessionId = shift.session_id ?? null;
  const visualState = shift.visual_state;
  const anchor = timerAnchorIso(visualState, shift.session_started_at, shift.clocked_in_at);
  void nowTick;
  const elapsed = formatElapsedTimer(anchor);
  const needsRiskAck = shiftNeedsRiskAck(shift);
  const hasAlerts = shiftHasRiskAlerts(shift);

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

  const handleClockIn = useCallback(async () => {
    setBusy("clock-in");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
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

      const clientTimestamp = new Date().toISOString();

      if (!isOnline) {
        await queueWorkerUpdate({
          type: "clock_in",
          id: `clock_in-${shift.id}`,
          shiftId: shift.id,
          method: "gps",
          location,
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
        return;
      }

      await clockInShift(shift.id, {
        method: "gps",
        location,
        client_timestamp: clientTimestamp,
      });
      await startShiftSession(shift.id);
      onRefresh();
      setPhase("session");
    } catch (err) {
      Alert.alert("Clock-in failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }, [shift.id, onRefresh, isOnline, queueWorkerUpdate]);

  const handleAckRisks = useCallback(async () => {
    setBusy("ack");
    try {
      await acknowledgeShiftRisks(shift.id);
      onRefresh();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }, [shift.id, onRefresh]);

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

  const handleSaveNote = async (noteId: string, content: string) => {
    if (!sessionId) return;
    const updated = localNotes.map((n) =>
      n.note_id === noteId ? { ...n, content, auto_saved_at: new Date().toISOString() } : n,
    );
    setLocalNotes(updated);
    try {
      await syncSessionNotes(sessionId, updated);
    } catch {
      /* optimistic */
    }
    onRefresh();
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
    await syncSessionNotes(sessionId, updated);
    onRefresh();
  };

  const handleSubmitReview = () => {
    const redFlags = compliance.rules?.filter((rule) => rule.status === "fail") ?? [];
    if (redFlags.length > 0) {
      showAlert(
        "Unresolved compliance flags",
        "You can still submit, but your coordinator will be notified. Submit anyway?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit anyway", style: "destructive", onPress: () => setPhase("signature") },
        ],
      );
      return;
    }
    setPhase("signature");
  };

  const handleSigned = async () => {
    setBusy("end");
    try {
      await endShift(shift.id);
      setSubmittedAt(new Date().toISOString());
      setPhase("submitted");
      onShiftComplete();
      onRefresh();
    } catch (err) {
      Alert.alert("End shift failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (phase === "submitted") {
    return (
      <WorkerMobileSubmitSuccess
        participantName={participantName}
        duration={formatMobileShiftDuration(shift, elapsed)}
        onDone={onShiftComplete}
      />
    );
  }

  if (phase === "signature") {
    return (
      <WorkerMobileSignatureScreen
        shiftId={shift.id}
        participantName={participantName}
        busy={Boolean(busy)}
        onSigned={handleSigned}
        onBack={() => setPhase("review")}
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
          onSaveNote={handleSaveNote}
          onAddMissingNote={handleAddMissingNote}
          onSubmit={handleSubmitReview}
          onViewComplianceReport={() => setComplianceOpen(true)}
          onOpenIncidentReport={openIncidentReport}
        />
        <Modal visible={complianceOpen} animationType="slide" presentationStyle="pageSheet">
          <WorkerMobileComplianceReport
            compliance={compliance}
            onClose={() => setComplianceOpen(false)}
          />
        </Modal>
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
        <DuringShiftActionsSidebar officePhone={shift.office_contact_number} />
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
          healthAlerts={shift.health_alerts}
          clockedInAt={shift.clocked_in_at ?? null}
          sessionId={sessionId}
          tasks={activeTasks}
          onTasksChange={setTasks}
          sessionNotes={localNotes}
          compliance={compliance}
          onNotesRefresh={onRefresh}
          onOpenIncidentReport={openIncidentReport}
          disabled={Boolean(busy)}
          sessionElapsed={elapsed}
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
        <DuringShiftActionsSidebar officePhone={shift.office_contact_number} />
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
            ? new Date(shift.scheduled_start).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
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

        {hasAlerts && needsRiskAck && (
          <View style={[styles.riskBox, { backgroundColor: "#FCEBEB", borderColor: "#EF4444" }]}>
            <Feather name="alert-octagon" size={16} color="#A32D2D" />
            <Text style={[styles.riskText, { color: "#7F1D1D", fontFamily: "Inter_500Medium" }]}>
              Review and acknowledge participant risk alerts before clocking in.
            </Text>
            <Pressable
              onPress={handleAckRisks}
              disabled={Boolean(busy)}
              style={[styles.ackBtn, { backgroundColor: "#EF4444" }]}
            >
              <Text style={[styles.ackBtnText, { fontFamily: "Inter_700Bold" }]}>Acknowledge Risks</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={handleClockIn}
          disabled={Boolean(busy) || needsRiskAck}
          style={[
            styles.clockInBtn,
            { backgroundColor: needsRiskAck ? colors.muted : colors.primary },
          ]}
        >
          {busy === "clock-in" ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.clockInText, { fontFamily: "Inter_700Bold" }]}>Clock In</Text>
          )}
        </Pressable>
      </View>
      </ScrollView>
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
  riskBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  riskText: { fontSize: 13, lineHeight: 18 },
  ackBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ackBtnText: { color: "#FFFFFF", fontSize: 14 },
  clockInBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  clockInText: { color: "#FFFFFF", fontSize: 16 },
});
