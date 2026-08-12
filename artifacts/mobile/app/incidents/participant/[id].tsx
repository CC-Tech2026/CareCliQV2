import { Feather } from "@expo/vector-icons";
import { useGetParticipant } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
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

type Severity = "low" | "medium" | "high";

const SEVERITY_OPTIONS: { id: Severity; label: string; color: string; bg: string; description: string }[] = [
  { id: "low", label: "Low", color: "#CA8A04", bg: "#FEF9C3", description: "Minor issue, no immediate risk" },
  { id: "medium", label: "Medium", color: "#EA580C", bg: "#FFF7ED", description: "Requires coordinator follow-up" },
  { id: "high", label: "High", color: "#DC2626", bg: "#FEF2F2", description: "Immediate risk or injury" },
];

export default function ParticipantIncidentReportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: participant } = useGetParticipant(id ?? "");

  const [what, setWhat] = useState("");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const canSubmit = what.trim().length > 10 && severity !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Incident Reported",
        "Your coordinator has been notified and will follow up shortly.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch {
      Alert.alert("Error", "Could not submit the incident report. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: "#FEF2F2",
            borderBottomColor: "#FECACA",
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={22} color="#DC2626" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { fontFamily: "Inter_700Bold" }]}>
            Report Incident
          </Text>
          {participant ? (
            <Text style={[styles.headerSub, { fontFamily: "Inter_400Regular" }]}>
              {participant.full_name}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          <Feather name="alert-triangle" size={22} color="#DC2626" />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.contextBlock, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.contextRow}>
            <Feather name="user" size={14} color={colors.mutedForeground} />
            <Text style={[styles.contextLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Participant
            </Text>
            <Text style={[styles.contextValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {participant?.full_name ?? "Loading..."}
            </Text>
          </View>
          <View style={[styles.contextDivider, { backgroundColor: colors.border }]} />
          <View style={styles.contextRow}>
            <Feather name="clock" size={14} color={colors.mutedForeground} />
            <Text style={[styles.contextLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Time
            </Text>
            <Text style={[styles.contextValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            SEVERITY LEVEL
          </Text>
          <View style={styles.severityGrid}>
            {SEVERITY_OPTIONS.map((opt) => {
              const active = severity === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => { setSeverity(opt.id); Haptics.selectionAsync(); }}
                  style={[
                    styles.severityBtn,
                    {
                      backgroundColor: active ? opt.bg : colors.card,
                      borderColor: active ? opt.color : colors.border,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.severityLabel, { color: opt.color, fontFamily: "Inter_700Bold" }]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.severityDesc, { color: active ? opt.color : colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {opt.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            WHAT HAPPENED
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
            placeholder="Describe the incident in detail — what occurred, where, who was present, any immediate actions taken..."
            placeholderTextColor={colors.mutedForeground}
            value={what}
            onChangeText={setWhat}
            textAlignVertical="top"
            testID="incident-what-input"
          />
          <Text style={[styles.charHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {what.trim().length < 10 ? `${10 - what.trim().length} more characters required` : "✓ Ready to submit"}
          </Text>
        </View>

        <View style={[styles.guidanceBlock, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={[styles.guidanceText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Your coordinator will be notified immediately. For life-threatening emergencies, call 000 first.
          </Text>
        </View>
      </ScrollView>

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
            { backgroundColor: canSubmit ? "#DC2626" : colors.muted },
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Feather name="send" size={16} color={canSubmit ? "#FFFFFF" : colors.mutedForeground} />
              <Text
                style={[
                  styles.submitBtnText,
                  { color: canSubmit ? "#FFFFFF" : colors.mutedForeground, fontFamily: "Inter_700Bold" },
                ]}
              >
                Submit Incident Report
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, color: "#DC2626" },
  headerSub: { fontSize: 13, color: "#7F1D1D", marginTop: 1 },
  headerRight: { padding: 4 },

  scrollView: { flex: 1 },

  contextBlock: {
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  contextLabel: { fontSize: 13, width: 80 },
  contextValue: { flex: 1, fontSize: 14 },
  contextDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  section: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#9CA3AF",
  },

  severityGrid: { gap: 8 },
  severityBtn: {
    padding: 14,
    borderRadius: 10,
    gap: 2,
  },
  severityLabel: { fontSize: 15 },
  severityDesc: { fontSize: 13 },

  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 140,
  },
  charHint: { fontSize: 12 },

  guidanceBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  guidanceText: { flex: 1, fontSize: 13, lineHeight: 19 },

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
