import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MOOD_OPTIONS,
  type LongShiftCheckInFormData,
  type ParticipantMood,
} from "@workspace/worker-compliance";

import { useColors } from "@/hooks/useColors";
import type { ShiftTask } from "@/lib/worker-api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: LongShiftCheckInFormData) => void;
  busy?: boolean;
  tasks?: ShiftTask[];
};

export function LongShiftCheckInForm({ visible, onClose, onSubmit, busy, tasks = [] }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mood, setMood] = useState<ParticipantMood | null>(null);
  const [hasIncident, setHasIncident] = useState<boolean | null>(null);
  const [incidentDescription, setIncidentDescription] = useState("");

  const incidentDescriptionReady =
    hasIncident === false || (hasIncident === true && incidentDescription.trim().length >= 10);
  const canSubmit = mood !== null && hasIncident !== null && incidentDescriptionReady && !busy;

  const handleClose = () => {
    if (busy) return;
    setMood(null);
    setHasIncident(null);
    setIncidentDescription("");
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit || mood === null || hasIncident === null) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSubmit({
      mood,
      hasIncident,
      incidentDescription: hasIncident ? incidentDescription.trim() : undefined,
    });
    setMood(null);
    setHasIncident(null);
    setIncidentDescription("");
  };

  const selectMood = (id: ParticipantMood) => {
    Haptics.selectionAsync();
    setMood(id);
  };

  const taskRows = useMemo(
    () => tasks.filter((t) => !t.marked_na).map((t) => ({ id: t.task_id, label: t.label, done: Boolean(t.completed) })),
    [tasks],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 12, maxHeight: "92%" },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Check-in form
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Required for shifts longer than 90 minutes
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8} disabled={busy}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {taskRows.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  TASK PROGRESS
                </Text>
                {taskRows.map((task) => (
                  <View key={task.id} style={styles.taskRow}>
                    <View style={[styles.taskDot, { backgroundColor: colors.composerPurple }]} />
                    <Text style={[styles.taskLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                      {task.label}
                    </Text>
                    {task.done && (
                      <Text style={[styles.taskDone, { color: colors.composerPurple, fontFamily: "Inter_700Bold" }]}>
                        Done
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={[styles.questionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Question 1 of 2
              </Text>
              <Text style={[styles.questionHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                What is the current mood of the participant?
              </Text>
              <View style={styles.moodGrid}>
                {MOOD_OPTIONS.map((opt) => {
                  const selected = mood === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => selectMood(opt.id)}
                      disabled={busy}
                      style={[
                        styles.moodCard,
                        {
                          borderColor: selected ? colors.composerPurple : colors.border,
                          backgroundColor: selected ? colors.activeBg : colors.card,
                        },
                      ]}
                    >
                      <Text style={styles.moodEmoji}>{opt.emoji}</Text>
                      <Text style={[styles.moodLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {opt.label}
                      </Text>
                      {selected && <Feather name="check" size={14} color={colors.composerPurple} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.questionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Question 2 of 2
              </Text>
              <Text style={[styles.questionHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Any incidents to report on the participant?
              </Text>
              <View style={styles.incidentRow}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setHasIncident(false);
                    setIncidentDescription("");
                  }}
                  disabled={busy}
                  style={[
                    styles.incidentBtn,
                    {
                      borderColor: hasIncident === false ? colors.composerPurple : colors.border,
                      backgroundColor: hasIncident === false ? colors.activeBg : colors.card,
                    },
                  ]}
                >
                  <Feather name="check" size={16} color={colors.composerPurple} />
                  <Text style={[styles.incidentText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    No incidents
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setHasIncident(true);
                  }}
                  disabled={busy}
                  style={[
                    styles.incidentBtn,
                    {
                      borderColor: hasIncident === true ? colors.destructive : colors.border,
                      backgroundColor: hasIncident === true ? colors.dangerBg : colors.card,
                    },
                  ]}
                >
                  <Text style={styles.moodEmoji}>🚨</Text>
                  <Text style={[styles.incidentText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    Yes — report
                  </Text>
                </Pressable>
              </View>

              {hasIncident === true ? (
                <TextInput
                  style={[
                    styles.incidentInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.destructive,
                      backgroundColor: colors.dangerBg,
                      fontFamily: "Inter_400Regular",
                    },
                  ]}
                  multiline
                  placeholder="Describe what happened — be specific about time, location, and nature of the incident..."
                  placeholderTextColor={colors.mutedForeground}
                  value={incidentDescription}
                  onChangeText={setIncidentDescription}
                  textAlignVertical="top"
                  editable={!busy}
                />
              ) : null}
            </View>

            <View style={[styles.auditBox, { borderColor: colors.border, backgroundColor: colors.soft }]}>
              <Text style={[styles.auditText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Check-ins are logged in the session record for NDIS audit purposes.
              </Text>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[
                styles.submitBtn,
                { backgroundColor: canSubmit ? colors.primary : colors.muted, opacity: busy ? 0.7 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.submitText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
                  Submit check-in
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 18 },
  subtitle: { fontSize: 12, lineHeight: 17 },
  body: { paddingHorizontal: 20, paddingVertical: 16, gap: 20 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 10, letterSpacing: 0.8 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskLabel: { flex: 1, fontSize: 14 },
  taskDone: { fontSize: 12 },
  questionTitle: { fontSize: 14 },
  questionHint: { fontSize: 12, lineHeight: 17 },
  moodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  moodCard: {
    width: "31%",
    minWidth: 96,
    flexGrow: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  moodEmoji: { fontSize: 24 },
  moodLabel: { fontSize: 11 },
  incidentRow: { flexDirection: "row", gap: 8 },
  incidentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  incidentText: { fontSize: 13 },
  incidentInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 110,
  },
  auditBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  auditText: { fontSize: 11, lineHeight: 16 },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 15 },
});
