import { Feather } from "@expo/vector-icons";
import {
  useGetSession,
  useGetParticipant,
  useUpdateSession,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type CheckItem = {
  id: string;
  label: string;
  passed: boolean;
  hint: string;
};

function buildChecks(text: string, sessionType: string, participantName: string): CheckItem[] {
  const t = text.toLowerCase();
  const firstName = participantName.split(" ")[0]?.toLowerCase() ?? "";
  return [
    {
      id: "participant_named",
      label: "Participant identified",
      passed: firstName.length > 0 && t.includes(firstName),
      hint: `Include the participant's name (${participantName.split(" ")[0]})`,
    },
    {
      id: "length",
      label: "Sufficient detail (50+ words)",
      passed: text.trim().split(/\s+/).filter(Boolean).length >= 50,
      hint: "NDIS requires detailed documentation",
    },
    {
      id: "support_type",
      label: "Support type referenced",
      passed: t.includes("support") || t.includes(sessionType.toLowerCase()) || t.includes("assist"),
      hint: `Reference the support delivered (${sessionType})`,
    },
    {
      id: "goals",
      label: "Goals addressed",
      passed: t.includes("goal") || t.includes("objective") || t.includes("aim") || t.includes("target"),
      hint: "Mention which participant goals were worked toward",
    },
    {
      id: "response",
      label: "Participant response noted",
      passed:
        t.includes("participant") ||
        t.includes("responded") ||
        t.includes("engaged") ||
        t.includes("declined") ||
        t.includes("expressed"),
      hint: "Note how the participant responded",
    },
  ];
}

export default function ProgressNotesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // id = session_id
  const { data: session, isLoading: sessionLoading } = useGetSession(id);
  const { data: participant, isLoading: participantLoading } = useGetParticipant(
    session?.participant_id ?? ""
  );
  const updateSession = useUpdateSession();

  const [noteText, setNoteText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Pre-fill from any existing session notes
  useEffect(() => {
    if (session?.notes && !noteText) {
      setNoteText(session.notes);
    }
  }, [session]);

  const participantName = participant?.full_name ?? "";
  const sessionType = session?.session_type ?? "Core Support";
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const loading = sessionLoading || participantLoading;

  const checks = useMemo(
    () => buildChecks(noteText, sessionType, participantName),
    [noteText, sessionType, participantName]
  );

  const passCount = checks.filter((c) => c.passed).length;
  const complianceScore = Math.round((passCount / checks.length) * 100);
  const allPassed = passCount === checks.length;
  const canSubmit = noteText.trim().length > 20 && passCount >= 3;

  const handleSubmit = async () => {
    if (!canSubmit || isSaving) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await updateSession.mutateAsync({
        sessionId: id,
        data: {
          notes: noteText,
          status: "completed",
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Notes Saved",
        "Progress note saved. AI analysis will run shortly.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch {
      Alert.alert("Error", "Could not save progress note. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            Progress Note
          </Text>
          {participantName ? (
            <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {participantName} · {sessionType}
            </Text>
          ) : null}
        </View>
        {/* Compliance score pill */}
        <View
          style={[
            styles.scorePill,
            {
              backgroundColor: allPassed ? "#DCFCE7" : complianceScore >= 60 ? "#FEF9C3" : colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.scoreText,
              {
                color: allPassed ? "#16A34A" : complianceScore >= 60 ? "#CA8A04" : colors.mutedForeground,
                fontFamily: "Inter_700Bold",
              },
            ]}
          >
            {complianceScore}%
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Note textarea */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            PROGRESS NOTE
          </Text>
          <TextInput
            style={[
              styles.textArea,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
                fontFamily: "Inter_400Regular",
              },
            ]}
            multiline
            placeholder="Document what occurred during this shift — supports delivered, participant engagement, goals progressed, observations, and any notable events..."
            placeholderTextColor={colors.mutedForeground}
            value={noteText}
            onChangeText={setNoteText}
            textAlignVertical="top"
            testID="progress-note-input"
          />
          <Text style={[styles.wordCount, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {noteText.trim().split(/\s+/).filter(Boolean).length} words
          </Text>
        </View>

        {/* Compliance checklist */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            NDIS COMPLIANCE CHECKS
          </Text>
          <View style={styles.checkList}>
            {checks.map((check) => (
              <View key={check.id} style={styles.checkRow}>
                <View
                  style={[
                    styles.checkIcon,
                    { backgroundColor: check.passed ? "#DCFCE7" : colors.muted },
                  ]}
                >
                  <Feather
                    name={check.passed ? "check" : "minus"}
                    size={13}
                    color={check.passed ? "#16A34A" : colors.mutedForeground}
                  />
                </View>
                <View style={styles.checkContent}>
                  <Text
                    style={[
                      styles.checkLabel,
                      {
                        color: check.passed ? colors.foreground : colors.mutedForeground,
                        fontFamily: check.passed ? "Inter_600SemiBold" : "Inter_400Regular",
                      },
                    ]}
                  >
                    {check.label}
                  </Text>
                  {!check.passed && (
                    <Text style={[styles.checkHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      {check.hint}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* NDIS requirement note */}
        <View style={[styles.infoBlock, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            NDIS Practice Standard 2.3 requires progress notes within 24 hours of support delivery.
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit || isSaving}
          style={[
            styles.submitBtn,
            { backgroundColor: canSubmit ? colors.primary : colors.muted },
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Feather
                name="check-circle"
                size={16}
                color={canSubmit ? "#FFFFFF" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.submitBtnText,
                  {
                    color: canSubmit ? "#FFFFFF" : colors.mutedForeground,
                    fontFamily: "Inter_700Bold",
                  },
                ]}
              >
                Save Progress Note
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17 },
  headerSub: { fontSize: 13, marginTop: 1 },
  scorePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    minWidth: 48,
    alignItems: "center",
  },
  scoreText: { fontSize: 14 },

  scrollView: { flex: 1 },

  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#9CA3AF",
  },

  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 200,
  },
  wordCount: { fontSize: 12 },

  checkList: { gap: 8 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  checkContent: { flex: 1, gap: 2 },
  checkLabel: { fontSize: 14 },
  checkHint: { fontSize: 12 },

  infoBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    margin: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 10,
  },
  submitBtnText: { fontSize: 15 },
});
