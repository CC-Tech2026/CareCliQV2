import { Feather } from "@expo/vector-icons";
import {
  useCreateSession,
  useGetParticipant,
  useGetParticipantSessions,
  type Session,
} from "@workspace/api-client-react";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sessionStatusColor(
  status: string,
  colors: ReturnType<typeof useColors>
): string {
  switch (status) {
    case "in_progress":
      return colors.accent;
    case "completed":
      return "#22C55E";
    default:
      return colors.mutedForeground;
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text
        style={[
          styles.infoLabel,
          { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.infoValue,
          { color: colors.foreground, fontFamily: "Inter_400Regular" },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function SessionRow({ session }: { session: Session }) {
  const colors = useColors();
  const router = useRouter();
  const statusColor = sessionStatusColor(session.status, colors);

  return (
    <Pressable
      onPress={() => router.push(`/session/${session.id}`)}
      style={({ pressed }) => [
        styles.sessionRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.sessionRowLeft}>
        <Text
          style={[
            styles.sessionRowDate,
            { color: colors.foreground, fontFamily: "Inter_500Medium" },
          ]}
        >
          {formatDate(session.session_date)}
        </Text>
        <Text
          style={[
            styles.sessionRowType,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
        >
          {session.session_type} · {session.duration_minutes}m
        </Text>
      </View>
      <View style={styles.sessionRowRight}>
        {session.compliance_score != null && (
          <Text
            style={[
              styles.complianceText,
              {
                color:
                  session.compliance_score >= 85
                    ? "#22C55E"
                    : session.compliance_score >= 60
                    ? colors.warning
                    : colors.destructive,
                fontFamily: "Inter_600SemiBold",
              },
            ]}
          >
            {Math.round(session.compliance_score)}%
          </Text>
        )}
        <View
          style={[
            styles.sessionStatusDot,
            { backgroundColor: statusColor },
          ]}
        />
      </View>
    </Pressable>
  );
}

export default function ParticipantDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isStarting, setIsStarting] = useState(false);

  const { data: participant, isLoading: pLoading } = useGetParticipant(id);
  const { data: sessions, isLoading: sLoading } = useGetParticipantSessions(id);
  const createSession = useCreateSession();

  const handleStartSession = async () => {
    if (!participant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsStarting(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const newSession = await createSession.mutateAsync({
        data: {
          participant_id: participant.id,
          session_date: today,
          duration_minutes: 60,
          session_type: "Support Session",
          status: "in_progress",
        },
      });
      router.push(`/session/${newSession.id}`);
    } catch {
      Alert.alert("Error", "Could not start session. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const goals = (participant?.goals ?? []).slice(0, 5);
  const recentSessions = (sessions ?? []).slice(0, 8);

  if (pLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!participant) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Participant not found
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.backTextBtn, { backgroundColor: colors.muted }]}>
          <Text style={[styles.backTextLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
            Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  const initials = participant.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const budgetPct =
    participant.total_budget && participant.total_budget > 0
      ? Math.min(
          ((participant.used_budget ?? 0) / participant.total_budget) * 100,
          100
        )
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.navHeader,
          { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="participant-back">
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={[
            styles.navTitle,
            { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
          ]}
          numberOfLines={1}
        >
          {participant.full_name}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
      >
        <View
          style={[
            styles.heroSection,
            { backgroundColor: colors.navy },
          ]}
        >
          <View
            style={[styles.heroAvatar, { backgroundColor: colors.primary + "40" }]}
          >
            <Text
              style={[styles.heroInitials, { fontFamily: "Inter_700Bold" }]}
            >
              {initials}
            </Text>
          </View>
          <Text
            style={[styles.heroName, { fontFamily: "Inter_700Bold" }]}
          >
            {participant.full_name}
          </Text>
          <Text style={[styles.heroNdis, { fontFamily: "Inter_400Regular" }]}>
            NDIS {participant.ndis_number}
          </Text>
          <View
            style={[
              styles.planStatusBadge,
              {
                backgroundColor:
                  participant.plan_status === "active"
                    ? "#22C55E30"
                    : colors.destructive + "30",
              },
            ]}
          >
            <Text
              style={[
                styles.planStatusText,
                {
                  color:
                    participant.plan_status === "active"
                      ? "#22C55E"
                      : colors.destructive,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {participant.plan_status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text
            style={[
              styles.cardTitle,
              { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            Plan Overview
          </Text>
          <InfoRow label="Plan Start" value={formatDate(participant.plan_start_date)} />
          <InfoRow label="Plan End" value={formatDate(participant.plan_end_date)} />
          {participant.primary_disability && (
            <InfoRow label="Primary Disability" value={participant.primary_disability} />
          )}
          {participant.email && <InfoRow label="Email" value={participant.email} />}
          {participant.phone && <InfoRow label="Phone" value={participant.phone} />}
        </View>

        {budgetPct !== null && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text
              style={[
                styles.cardTitle,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              NDIS Budget
            </Text>
            <View style={styles.budgetNumbers}>
              <View>
                <Text
                  style={[
                    styles.budgetAmount,
                    { color: colors.foreground, fontFamily: "Inter_700Bold" },
                  ]}
                >
                  ${(participant.used_budget ?? 0).toLocaleString("en-AU")}
                </Text>
                <Text
                  style={[
                    styles.budgetLabel,
                    { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Used
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text
                  style={[
                    styles.budgetAmount,
                    { color: colors.foreground, fontFamily: "Inter_700Bold" },
                  ]}
                >
                  ${(participant.total_budget ?? 0).toLocaleString("en-AU")}
                </Text>
                <Text
                  style={[
                    styles.budgetLabel,
                    { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Total
                </Text>
              </View>
            </View>
            <View style={[styles.budgetBarBg, { backgroundColor: colors.muted }]}>
              <View
                style={[
                  styles.budgetBarFill,
                  {
                    width: `${budgetPct}%`,
                    backgroundColor:
                      budgetPct > 90
                        ? colors.destructive
                        : budgetPct > 70
                        ? colors.warning
                        : "#22C55E",
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.budgetPct,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              {Math.round(budgetPct)}% of annual plan used
            </Text>
          </View>
        )}

        {goals.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text
              style={[
                styles.cardTitle,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              NDIS Goals
            </Text>
            <View style={styles.goalsList}>
              {goals.map((goal, i) => {
                const goalText = "text" in goal ? goal.text : ("title" in goal ? goal.title : "Goal");
                const goalProgress = "progress" in goal ? goal.progress : ("progress_percentage" in goal ? (goal.progress_percentage ?? 0) : 0);
                return (
                  <View key={i} style={styles.goalItem}>
                    <View style={styles.goalHeader}>
                      <Text
                        style={[
                          styles.goalText,
                          { color: colors.foreground, fontFamily: "Inter_400Regular" },
                        ]}
                        numberOfLines={2}
                      >
                        {goalText}
                      </Text>
                      <Text
                        style={[
                          styles.goalProgress,
                          { color: colors.primary, fontFamily: "Inter_600SemiBold" },
                        ]}
                      >
                        {goalProgress}%
                      </Text>
                    </View>
                    <View style={[styles.goalBar, { backgroundColor: colors.muted }]}>
                      <View
                        style={[
                          styles.goalFill,
                          {
                            width: `${goalProgress}%`,
                            backgroundColor: colors.primary,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text
            style={[
              styles.cardTitle,
              { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            Recent Sessions
          </Text>
          {sLoading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : recentSessions.length === 0 ? (
            <Text
              style={[
                styles.emptyText,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              No sessions yet
            </Text>
          ) : (
            <View style={styles.sessionList}>
              {recentSessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View
        style={[
          styles.startSessionBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <Pressable
          onPress={handleStartSession}
          disabled={isStarting}
          style={[
            styles.startSessionBtn,
            { backgroundColor: colors.primary, opacity: isStarting ? 0.7 : 1 },
          ]}
          testID="start-session-btn"
        >
          {isStarting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Feather name="play" size={20} color="#FFFFFF" />
              <Text
                style={[
                  styles.startSessionText,
                  { fontFamily: "Inter_700Bold" },
                ]}
              >
                Start Session
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 16 },
  backTextBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  backTextLabel: { fontSize: 15 },
  container: { flex: 1 },
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 32, padding: 4 },
  navTitle: { flex: 1, fontSize: 17, textAlign: "center" },
  scrollContent: { gap: 0 },
  heroSection: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroInitials: { fontSize: 26, color: "#FFFFFF" },
  heroName: { fontSize: 22, color: "#FFFFFF" },
  heroNdis: { fontSize: 14, color: "rgba(255,255,255,0.65)" },
  planStatusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 4,
  },
  planStatusText: { fontSize: 12, letterSpacing: 0.5 },
  card: {
    margin: 16,
    marginBottom: 0,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardTitle: { fontSize: 15, marginBottom: 2 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13 },
  budgetNumbers: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  budgetAmount: { fontSize: 20 },
  budgetLabel: { fontSize: 12, marginTop: 2 },
  budgetBarBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  budgetBarFill: { height: "100%", borderRadius: 4 },
  budgetPct: { fontSize: 12 },
  goalsList: { gap: 12 },
  goalItem: { gap: 6 },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  goalText: { flex: 1, fontSize: 13, lineHeight: 18 },
  goalProgress: { fontSize: 13 },
  goalBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  goalFill: { height: "100%", borderRadius: 2 },
  sessionList: { gap: 6 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  sessionRowLeft: { gap: 2 },
  sessionRowDate: { fontSize: 14 },
  sessionRowType: { fontSize: 12 },
  sessionRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  complianceText: { fontSize: 13 },
  sessionStatusDot: { width: 8, height: 8, borderRadius: 4 },
  emptyText: { fontSize: 14, textAlign: "center", paddingVertical: 8 },
  startSessionBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  startSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  startSessionText: { fontSize: 17, color: "#FFFFFF" },
});
