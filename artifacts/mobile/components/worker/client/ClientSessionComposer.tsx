import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { showAlert } from "@/lib/alert";
import { activeGoals } from "@/lib/client-utils";
import { useColors } from "@/hooks/useColors";
import type { GoalDetail, GoalProgressNote, WorkerClient } from "@/lib/worker-api";
import { clinicalRewriteText, createMyClientSession } from "@/lib/worker-api";

type Step = "record" | "goals" | "outcome" | "review";

const STEPS: Array<{ key: Step; label: string }> = [
  { key: "record", label: "Notes" },
  { key: "goals", label: "Goals" },
  { key: "outcome", label: "Details" },
  { key: "review", label: "Review" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimer(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function goalLabel(goal: GoalDetail, index: number) {
  return goal.title || goal.description || `Goal ${index + 1}`;
}

type Props = {
  clientId: string;
  client: WorkerClient;
};

export function ClientSessionComposer({ clientId, client }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("record");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [draft, setDraft] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set());
  const [goalNotes, setGoalNotes] = useState<Record<string, GoalProgressNote>>({});
  const [outcome, setOutcome] = useState("");
  const [choiceControl, setChoiceControl] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState("");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const goals = activeGoals(client.goals);

  useEffect(() => {
    if (isRunning && !sessionEnded) {
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, sessionEnded]);

  const finalNote = generatedNote.trim() || draft.trim();
  const durationMinutes = Math.max(1, Math.floor(elapsedSeconds / 60) || 1);

  const saveSession = useMutation({
    mutationFn: () =>
      createMyClientSession(clientId, {
        status: "draft",
        session_type: "support_work",
        duration_minutes: durationMinutes,
        notes: finalNote,
        outcomes: outcome.trim() || undefined,
        participant_response: choiceControl.trim() || undefined,
        progress_toward_goals: recommendations.trim() || undefined,
        goals_addressed: selectedGoals.size > 0 ? Array.from(selectedGoals) : undefined,
        goal_progress_notes: Object.values(goalNotes).filter((n) => selectedGoals.has(n.goal_id)),
        participant_choice_control: choiceControl.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", "my-clients", clientId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert("Session saved", "Your progress note draft has been saved.", [
        { text: "OK", onPress: () => router.replace(`/client/${clientId}` as never) },
      ]);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to save session");
    },
  });

  const commitInput = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    setDraft((current) => [current.trim(), text].filter(Boolean).join("\n\n"));
    setInputValue("");
  }, [inputValue]);

  const endSession = useCallback(() => {
    commitInput();
    setSessionEnded(true);
    setIsRunning(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep("goals");
  }, [commitInput]);

  const toggleGoal = useCallback((goal: GoalDetail) => {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(goal.id)) {
        next.delete(goal.id);
      } else {
        next.add(goal.id);
        setGoalNotes((notes) => ({
          ...notes,
          [goal.id]: notes[goal.id] ?? {
            goal_id: goal.id,
            goal_title: goalLabel(goal, 0),
          },
        }));
      }
      return next;
    });
  }, []);

  const handleRewrite = useCallback(async () => {
    if (!finalNote || isRewriting) return;
    setError("");
    setIsRewriting(true);
    try {
      const data = await clinicalRewriteText(finalNote);
      const raw = data.clinical || data.note || data.text;
      if (typeof raw === "string" && raw.trim()) {
        setGeneratedNote(raw.trim());
      } else if (raw && typeof raw === "object") {
        setGeneratedNote(
          Object.entries(raw as Record<string, string>)
            .filter(([, v]) => v?.trim())
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n\n"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clinical rewrite unavailable");
    } finally {
      setIsRewriting(false);
    }
  }, [finalNote, isRewriting]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const goToOutcome = useCallback(() => {
    if (!finalNote.trim()) {
      showAlert("Session note required", "Add a session note before continuing.");
      return;
    }
    setStep("outcome");
  }, [finalNote]);

  const goToReview = useCallback(() => {
    if (!outcome.trim()) {
      showAlert("Outcome required", "Describe the session outcome before continuing.");
      return;
    }
    if (!choiceControl.trim()) {
      showAlert("Choice & control required", "Record how the participant exercised choice and control.");
      return;
    }
    setStep("review");
  }, [outcome, choiceControl]);

  const handleSave = useCallback(() => {
    if (!sessionEnded) {
      showAlert("End the session first", "Stop the timer before saving your note.");
      return;
    }
    if (!finalNote.trim()) {
      showAlert("Session note required", "Add a session note before saving.");
      return;
    }
    if (!outcome.trim() || !choiceControl.trim()) {
      showAlert("Missing details", "Complete the outcome and choice & control fields before saving.");
      return;
    }
    saveSession.mutate();
  }, [sessionEnded, finalNote, outcome, choiceControl, saveSession]);

  const safetyAlert = useMemo(() => {
    const parts = [client.allergies, client.primary_disability].filter(Boolean);
    return parts.join(" · ");
  }, [client.allergies, client.primary_disability]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.stepBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {STEPS.map((item, index) => {
          const active = item.key === step;
          const done = index < stepIndex;
          const locked = item.key !== "record" && !sessionEnded;
          return (
            <Pressable
              key={item.key}
              disabled={locked}
              onPress={() => !locked && setStep(item.key)}
              style={styles.stepItem}
            >
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: active || done ? colors.primary : colors.muted,
                    opacity: locked ? 0.35 : 1,
                  },
                ]}
              />
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: active ? colors.primary : colors.mutedForeground,
                    fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                    opacity: locked ? 0.35 : 1,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.statusRow}>
          <View style={[styles.statusPill, { backgroundColor: sessionEnded ? colors.soft : "#ECFDF5" }]}>
            <View style={[styles.liveDot, { backgroundColor: sessionEnded ? colors.mutedForeground : "#10B981" }]} />
            <Text style={[styles.statusText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {sessionEnded ? "Session ended" : isRunning ? "In progress" : "Paused"}
            </Text>
          </View>
          <Text style={[styles.timer, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {formatTimer(elapsedSeconds)}
          </Text>
        </View>

        {safetyAlert ? (
          <View style={styles.alertCard}>
            <Feather name="alert-triangle" size={16} color="#DC2626" />
            <Text style={[styles.alertText, { fontFamily: "Inter_600SemiBold" }]}>{safetyAlert}</Text>
          </View>
        ) : null}

        {step === "record" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
              SESSION NOTES
            </Text>
            <View style={[styles.notesBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
              {draft.trim() ? (
                <Text style={[styles.draftText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                  {draft}
                </Text>
              ) : (
                <Text style={[styles.placeholder, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Record what happened during the session. Add notes below or use the mic on device.
                </Text>
              )}
            </View>

            {!sessionEnded && (
              <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <TextInput
                  value={inputValue}
                  onChangeText={setInputValue}
                  placeholder="Type a note and press add..."
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                  onSubmitEditing={commitInput}
                  returnKeyType="done"
                />
                <Pressable onPress={commitInput} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
                  <Feather name="plus" size={18} color={colors.primaryForeground} />
                </Pressable>
              </View>
            )}

            {!sessionEnded && (
              <View style={styles.recordActions}>
                <Pressable
                  onPress={() => setIsRunning((r) => !r)}
                  style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <Feather name={isRunning ? "pause" : "play"} size={16} color={colors.foreground} />
                  <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    {isRunning ? "Pause" : "Resume"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={endSession}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Feather name="stop-circle" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.primaryBtnText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
                    End session
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {step === "goals" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
              GOALS WORKED ON
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Select the NDIS goals you addressed during this session.
            </Text>
            {goals.length === 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                No active goals recorded for this client.
              </Text>
            ) : (
              goals.map((goal, index) => {
                const selected = selectedGoals.has(goal.id);
                const note = goalNotes[goal.id];
                return (
                  <View
                    key={goal.id}
                    style={[styles.goalCard, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}
                  >
                    <Pressable onPress={() => toggleGoal(goal)} style={styles.goalHeader}>
                      <View style={[styles.checkbox, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" }]}>
                        {selected ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
                      </View>
                      <View style={styles.goalHeaderText}>
                        <Text style={[styles.goalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                          {goalLabel(goal, index)}
                        </Text>
                        {goal.why_it_matters ? (
                          <Text style={[styles.goalSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                            {goal.why_it_matters}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    {selected && (
                      <View style={styles.goalFields}>
                        {(["evidence_provided", "outcome", "observation"] as const).map((field) => (
                          <View key={field}>
                            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                              {field === "evidence_provided" ? "Evidence" : field === "outcome" ? "Outcome" : "Observation"}
                            </Text>
                            <TextInput
                              value={note?.[field] ?? ""}
                              onChangeText={(value) =>
                                setGoalNotes((prev) => ({
                                  ...prev,
                                  [goal.id]: { ...(prev[goal.id] ?? { goal_id: goal.id, goal_title: goalLabel(goal, index) }), [field]: value },
                                }))
                              }
                              multiline
                              style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
                            />
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {step === "outcome" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
              SESSION DETAILS
            </Text>
            <View style={[styles.standardCard, { backgroundColor: colors.activeBg }]}>
              <Text style={[styles.standardTitle, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                NDIS Practice Standard
              </Text>
              <Text style={[styles.standardBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                Participant choice and control
              </Text>
            </View>
            <Field
              label="Session outcome *"
              value={outcome}
              onChangeText={setOutcome}
              placeholder="What was achieved in this session?"
            />
            <Field
              label="Participant choice & control *"
              value={choiceControl}
              onChangeText={setChoiceControl}
              placeholder="How did the participant exercise choice and control?"
            />
            <Field
              label="Recommendations"
              value={recommendations}
              onChangeText={setRecommendations}
              placeholder="Follow-up actions or recommendations (optional)"
            />
          </View>
        )}

        {step === "review" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
              REVIEW & SAVE
            </Text>
            <TextInput
              value={generatedNote || draft}
              onChangeText={(value) => (generatedNote ? setGeneratedNote(value) : setDraft(value))}
              multiline
              style={[styles.reviewInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, fontFamily: "Inter_400Regular" }]}
            />
            <Pressable
              onPress={() => void handleRewrite()}
              disabled={!finalNote || isRewriting}
              style={[styles.rewriteBtn, { borderColor: colors.primary, opacity: !finalNote || isRewriting ? 0.5 : 1 }]}
            >
              {isRewriting ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <>
                  <Feather name="zap" size={16} color={colors.primary} />
                  <Text style={[styles.rewriteText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                    Clinical rewrite
                  </Text>
                </>
              )}
            </Pressable>
            {selectedGoals.size > 0 && (
              <Text style={[styles.summaryLine, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {selectedGoals.size} goal{selectedGoals.size === 1 ? "" : "s"} addressed · {durationMinutes} min
              </Text>
            )}
          </View>
        )}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>{error}</Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
        {step === "record" && sessionEnded ? (
          <Pressable onPress={() => setStep("goals")} style={[styles.footerPrimary, { backgroundColor: colors.primary }]}>
            <Text style={[styles.footerPrimaryText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              Continue to goals
            </Text>
          </Pressable>
        ) : null}
        {step === "goals" ? (
          <Pressable
            onPress={goToOutcome}
            style={[styles.footerPrimary, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.footerPrimaryText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              Continue
            </Text>
          </Pressable>
        ) : null}
        {step === "outcome" ? (
          <Pressable
            onPress={goToReview}
            style={[styles.footerPrimary, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.footerPrimaryText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              Review note
            </Text>
          </Pressable>
        ) : null}
        {step === "review" ? (
          <Pressable
            onPress={handleSave}
            disabled={saveSession.isPending}
            style={[styles.footerPrimary, { backgroundColor: colors.primary, opacity: saveSession.isPending ? 0.6 : 1 }]}
          >
            {saveSession.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.footerPrimaryText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
                Save draft
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, fontFamily: "Inter_400Regular" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: 11 },
  scroll: { padding: 16, gap: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13 },
  timer: { fontSize: 22, letterSpacing: 1 },
  alertCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    padding: 12,
  },
  alertText: { flex: 1, fontSize: 13, lineHeight: 19, color: "#991B1B" },
  section: { gap: 12 },
  sectionTitle: { fontSize: 11, letterSpacing: 0.8 },
  hint: { fontSize: 13, lineHeight: 19 },
  notesBox: { minHeight: 160, borderRadius: 14, borderWidth: 1, padding: 14 },
  draftText: { fontSize: 15, lineHeight: 24 },
  placeholder: { fontSize: 14, lineHeight: 22, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 6,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  recordActions: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 12,
  },
  secondaryBtnText: { fontSize: 14 },
  primaryBtn: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 12,
  },
  primaryBtnText: { fontSize: 14 },
  goalCard: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  goalHeader: { flexDirection: "row", gap: 12, padding: 14, alignItems: "flex-start" },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  goalHeaderText: { flex: 1, gap: 4 },
  goalTitle: { fontSize: 14, lineHeight: 20 },
  goalSub: { fontSize: 12, lineHeight: 18 },
  goalFields: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  fieldInput: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  standardCard: { borderRadius: 12, padding: 14, gap: 4 },
  standardTitle: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  standardBody: { fontSize: 14 },
  reviewInput: {
    minHeight: 200,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    fontSize: 14,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  rewriteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
  },
  rewriteText: { fontSize: 14 },
  summaryLine: { fontSize: 12, textAlign: "center" },
  error: { fontSize: 13, textAlign: "center" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerPrimary: { borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  footerPrimaryText: { fontSize: 15 },
});
