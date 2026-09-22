import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { WorkerMobileNoteBubble } from "@/components/worker/WorkerMobileNoteBubble";
import { WorkerMobileParticipantStrip } from "@/components/worker/WorkerMobileParticipantStrip";
import { WorkerMobileRiskStrip } from "@/components/worker/WorkerMobileRiskStrip";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { MissedCheckin, SessionNoteRecord, ShiftHealthAlert, ShiftTask } from "@/lib/worker-api";
import { formatTimeWithZone, isMandatoryTask } from "@/lib/shift-utils";
import type { ComplianceEvaluation } from "@workspace/worker-compliance";

type Props = {
  participantName: string;
  healthAlerts?: ShiftHealthAlert[];
  tasks: ShiftTask[];
  notes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
  busy?: boolean;
  missedCheckins?: MissedCheckin[];
  onSubmitMissedCheckinReason: (scheduledCheckinId: string, reason: string) => Promise<void>;
  onSaveNote: (noteId: string, content: string) => void;
  onRemoveNote: (noteId: string) => void;
  onAddMissingNote: (taskId: string, content: string) => void;
  onSubmit: () => void;
  onViewComplianceReport: () => void;
  onOpenIncidentReport?: (noteId?: string, content?: string) => void;
  /** Participant's branch zone. */
  tz?: string | null;
};

function formatMissedTime(iso: string | null, tz?: string | null): string {
  if (!iso) return "";
  return formatTimeWithZone(iso, tz).toLowerCase();
}

function medicationTask(tasks: ShiftTask[]) {
  return tasks.find((t) => !t.marked_na && /medication|medicine|meds/i.test(t.label));
}

function hasMedicationNote(medTask: ShiftTask | undefined, notes: SessionNoteRecord[]) {
  if (!medTask) return true;
  return notes.some(
    (n) =>
      n.task_id === medTask.task_id ||
      /medication|medicine|meds/i.test(n.content ?? ""),
  );
}

export function WorkerMobileReviewScreen({
  participantName,
  healthAlerts = [],
  tasks,
  notes,
  compliance,
  busy,
  missedCheckins = [],
  onSubmitMissedCheckinReason,
  onSaveNote,
  onRemoveNote,
  onAddMissingNote,
  onSubmit,
  onViewComplianceReport,
  onOpenIncidentReport,
  tz,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [medDraft, setMedDraft] = useState("");
  const [addingMed, setAddingMed] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [missedReasons, setMissedReasons] = useState<Record<string, string>>({});
  const [submittingMissedReasons, setSubmittingMissedReasons] = useState(false);

  const medTask = medicationTask(tasks);
  const medMissing = Boolean(medTask && !hasMedicationNote(medTask, notes));
  const incompleteWithoutNote = tasks.filter(
    (t) =>
      isMandatoryTask(t) &&
      !t.marked_na &&
      !t.completed &&
      !notes.some((n) => n.task_id === t.task_id && n.content?.trim()),
  );
  const otherIncomplete = incompleteWithoutNote.filter(
    (t) => !medTask || t.task_id !== medTask.task_id,
  );
  const pendingIncidentReport = compliance.noteFlags.some(
    (f) => f.ruleId === 9 && f.severity === "fail" && Boolean(f.actionLabel),
  );
  const missingCheckinReasons = missedCheckins.some((m) => !(missedReasons[m.id] ?? "").trim());
  const submitBlocked =
    medMissing || otherIncomplete.length > 0 || pendingIncidentReport || missingCheckinReasons;

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    if (submitBlocked || submittingMissedReasons) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (missedCheckins.length > 0) {
      setSubmittingMissedReasons(true);
      try {
        await Promise.all(
          missedCheckins.map((m) => onSubmitMissedCheckinReason(m.id, missedReasons[m.id] ?? "")),
        );
      } catch {
        setSubmittingMissedReasons(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      setSubmittingMissedReasons(false);
    }
    onSubmit();
  };

  const handleAddMedNote = () => {
    if (!medTask || !medDraft.trim()) return;
    onAddMissingNote(medTask.task_id, medDraft.trim());
    setMedDraft("");
    setAddingMed(false);
  };

  const taskLabel = (taskId?: string | null) =>
    tasks.find((t) => t.task_id === taskId)?.label ?? undefined;

  const goalTitle = (taskId?: string | null) =>
    tasks.find((t) => t.task_id === taskId)?.goal_title ?? undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <WorkerMobileParticipantStrip participantName={participantName} />
      <WorkerMobileRiskStrip alerts={healthAlerts} />
      <ComplianceScoreBar score={compliance.score} onPress={onViewComplianceReport} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {pendingIncidentReport && (
          <View style={[styles.alert, { backgroundColor: "#FCEBEB", borderColor: "#EF4444" }]}>
            <Feather name="alert-octagon" size={16} color="#A32D2D" />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { fontFamily: "Inter_700Bold", color: "#A32D2D" }]}>
                {t("review.incidentRequiredTitle")}
              </Text>
              <Text style={[styles.alertBody, { fontFamily: "Inter_400Regular", color: "#7F1D1D" }]}>
                {t("review.incidentRequiredBody")}
              </Text>
            </View>
          </View>
        )}

        {medMissing && (
          <View style={[styles.alert, { backgroundColor: "#FCEBEB", borderColor: "#EF4444" }]}>
            <Feather name="alert-octagon" size={16} color="#A32D2D" />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { fontFamily: "Inter_700Bold", color: "#A32D2D" }]}>
                Medication note required
              </Text>
              <Text style={[styles.alertBody, { fontFamily: "Inter_400Regular", color: "#7F1D1D" }]}>
                Document medication administration before submitting.
              </Text>
            </View>
          </View>
        )}

        {medMissing && (
          <View style={[styles.medSection, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {addingMed ? (
              <>
                <TextInput
                  value={medDraft}
                  onChangeText={setMedDraft}
                  placeholder="Describe medication given…"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[styles.medInput, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
                />
                <Pressable
                  onPress={handleAddMedNote}
                  style={[styles.addBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.addBtnText, { fontFamily: "Inter_600SemiBold" }]}>Add note</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => setAddingMed(true)} style={[styles.addBtn, { backgroundColor: colors.accent }]}>
                <Text style={[styles.addBtnText, { fontFamily: "Inter_600SemiBold" }]}>Add medication note</Text>
              </Pressable>
            )}
          </View>
        )}

        {missedCheckins.length > 0 && (
          <View style={[styles.alert, { backgroundColor: "#FFF3E0", borderColor: colors.warning }]}>
            <Feather name="alert-triangle" size={16} color="#854F0B" />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { fontFamily: "Inter_700Bold", color: "#854F0B" }]}>
                Missed check-in{missedCheckins.length > 1 ? "s" : ""}
              </Text>
              <Text style={[styles.alertBody, { fontFamily: "Inter_400Regular", color: "#854F0B" }]}>
                You did not respond to a system check-in. Please explain what happened before
                submitting this shift.
              </Text>
            </View>
          </View>
        )}

        {missedCheckins.map((m) => (
          <View
            key={m.id}
            style={[styles.medSection, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={[styles.missedCheckinLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Missed check-in{formatMissedTime(m.scheduled_at, tz) ? ` around ${formatMissedTime(m.scheduled_at, tz)}` : ""}
            </Text>
            <TextInput
              value={missedReasons[m.id] ?? ""}
              onChangeText={(text) => setMissedReasons((prev) => ({ ...prev, [m.id]: text }))}
              placeholder="What were you doing? e.g. assisting participant in the bathroom, driving, poor signal…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.medInput,
                { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" },
              ]}
            />
          </View>
        ))}

        {submitAttempted && otherIncomplete.length > 0 && (
          <View style={[styles.alert, { backgroundColor: "#FFF3E0", borderColor: colors.warning }]}>
            <Feather name="alert-triangle" size={16} color="#854F0B" />
            <Text style={[styles.alertBody, { fontFamily: "Inter_500Medium", color: "#854F0B", flex: 1 }]}>
              {otherIncomplete.length} required task(s) still need documentation.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          {t("review.sessionNotes")}
        </Text>
        {notes.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            No notes recorded.
          </Text>
        ) : (
          notes.map((note) => {
            const flag = compliance.noteFlags.find((f) => f.noteId === note.note_id);
            return (
              <WorkerMobileNoteBubble
                key={note.note_id}
                note={note}
                participantName={participantName}
                taskLabel={taskLabel(note.task_id)}
                goalTitle={goalTitle(note.task_id)}
                flag={flag}
                editable
                onSave={onSaveNote}
                onRemove={onRemoveNote}
                onIncidentReport={flag?.severity === "fail" ? onOpenIncidentReport : undefined}
                tz={tz}
              />
            );
          })
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          onPress={handleSubmit}
          disabled={busy || pendingIncidentReport || submittingMissedReasons}
          style={[
            styles.submitBtn,
            {
              backgroundColor: colors.primary,
              opacity: busy || pendingIncidentReport || submittingMissedReasons ? 0.5 : 1,
            },
          ]}
        >
          {busy || submittingMissedReasons ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>{t("review.submitNotes")}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 100, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertText: { flex: 1, gap: 4 },
  alertTitle: { fontSize: 14 },
  alertBody: { fontSize: 13, lineHeight: 18 },
  missedCheckinLabel: { fontSize: 12, lineHeight: 17 },
  medSection: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  medInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 80,
    fontSize: 14,
  },
  addBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: "#FFFFFF", fontSize: 14 },
  empty: { paddingHorizontal: 16, fontSize: 14 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFFFFF", fontSize: 16 },
});
