import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ClientOverviewContent } from "@/components/worker/client/ClientOverviewContent";
import { useWorkerShifts } from "@/hooks/worker/useWorkerShifts";
import { ShiftListCard } from "@/components/worker/ShiftListCard";
import { ClientNavRow } from "@/components/worker/client/ClientNavRow";
import { ClientProfileHeader } from "@/components/worker/client/ClientProfileHeader";
import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { activeGoals } from "@/lib/client-utils";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

export default function ClientDetailHubScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"before" | "records">("before");
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error } = useWorkerClientDetail(id);
  const schedule = useWorkerShifts("all");

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !data?.participant) {
    return (
      <ClientScreenShell title="Client" backHref="/(tabs)/participants">
        <View style={styles.center}>
          <Text
            style={[
              styles.errorText,
              {
                color: colors.destructive,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {(error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  const client = data.participant;
  const goals = activeGoals(client.goals);
  const planGoals = goals.length;
  const nextShifts = (schedule.data?.shifts ?? [])
    .filter(
      (shift) =>
        shift.participant_id === id &&
        shift.status !== "cancelled" &&
        (shift.visual_state === "clocked_in" ||
          shift.visual_state === "session_active" ||
          (shift.visual_state === "scheduled" &&
            new Date(
              shift.scheduled_end ?? shift.scheduled_start ?? "",
            ).getTime() >= Date.now())),
    )
    .sort((a, b) =>
      (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
    )
    .slice(0, 2);

  return (
    <ClientScreenShell title={client.full_name} subtitle="Participant profile">
      <ScrollView contentContainerStyle={styles.scroll}>
        <ClientProfileHeader client={client} compact />

        <View
          accessibilityRole="tablist"
          style={[styles.tabs, { backgroundColor: colors.soft }]}
        >
          {(
            [
              ["before", "Before your shift"],
              ["records", "Notes & records"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              aria-selected={tab === key}
              onPress={() => setTab(key)}
              style={[
                styles.tab,
                {
                  backgroundColor: tab === key ? colors.primary : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color:
                    tab === key ? colors.primaryForeground : colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                  textAlign: "center",
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === "before" && (
          <>
            <View
              style={[
                styles.intro,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.foreground,
                  fontFamily: FontFamily.interBold,
                  fontSize: 18,
                }}
              >
                Get to know me
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                  fontSize: 14,
                  lineHeight: 22,
                }}
              >
                Read my support needs, communication preferences and goals
                before your shift.
              </Text>
            </View>
            <ClientOverviewContent client={client} />
            <View style={{ gap: 14 }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.foreground,
                  fontFamily: FontFamily.interBold,
                  fontSize: 18,
                }}
              >
                Your next visits
              </Text>
              {schedule.isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : schedule.error ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void schedule.refetch()}
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Text style={{ color: colors.primary }}>
                    Could not load visits. Tap to retry
                  </Text>
                </Pressable>
              ) : nextShifts.length ? (
                nextShifts.map((shift) => (
                  <ShiftListCard
                    key={shift.id}
                    shift={shift}
                    siblingShifts={schedule.data?.shifts}
                  />
                ))
              ) : (
                <Text style={{ color: colors.mutedForeground }}>
                  No upcoming visits assigned to you.
                </Text>
              )}
            </View>
            <ClientNavRow
              icon="calendar"
              label="Go to my shifts"
              subtitle="Open your scheduled shift to review the briefing and clock in"
              onPress={() => router.push("/(tabs)/shifts" as never)}
            />
          </>
        )}
        {tab === "records" && (
          <>
            <View style={styles.actions}>
              <Pressable
                onPress={() => router.push(`/client/${id}/session` as never)}
                style={[
                  styles.startSessionBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Feather
                  name="mic"
                  size={16}
                  color={colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.startSessionText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: FontFamily.interBold,
                    },
                  ]}
                >
                  Start session
                </Text>
              </Pressable>
              <View style={styles.secondaryActions}>
                <Pressable
                  onPress={() => router.push("/incidents" as never)}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: colors.card, borderColor: "#FECACA" },
                  ]}
                >
                  <Feather name="alert-circle" size={15} color="#DC2626" />
                  <Text
                    style={[
                      styles.actionText,
                      { color: "#DC2626", fontFamily: FontFamily.interBold },
                    ]}
                  >
                    Incident
                  </Text>
                </Pressable>
              </View>
            </View>

            <View
              style={[
                styles.navCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <ClientNavRow
                icon="user"
                label="Overview"
                subtitle="Medical alerts, preferences, goals"
                onPress={() => router.push(`/client/${id}/overview` as never)}
              />
              <ClientNavRow
                icon="target"
                label="Plan & goals"
                subtitle={
                  planGoals
                    ? `${planGoals} active goal${planGoals === 1 ? "" : "s"}`
                    : "No goals recorded"
                }
                onPress={() => router.push(`/client/${id}/plan` as never)}
              />
              <ClientNavRow
                icon="file-text"
                label="Shift Notes"
                subtitle={`${data.sessions.length + data.notes.length} record${data.sessions.length + data.notes.length === 1 ? "" : "s"}`}
                onPress={() =>
                  router.push(`/client/${id}/shift-notes` as never)
                }
              />
              <ClientNavRow
                icon="shield"
                label="Compliance"
                subtitle={`${data.compliance.length} record${data.compliance.length === 1 ? "" : "s"}`}
                onPress={() => router.push(`/client/${id}/compliance` as never)}
              />
            </View>
          </>
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  scroll: {
    padding: 16,
    gap: 16,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
  },
  tabs: { flexDirection: "row", borderRadius: 24, padding: 5, gap: 4 },
  tab: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    padding: 10,
    borderRadius: 20,
  },
  intro: { padding: 20, gap: 8, borderWidth: 1, borderRadius: 22 },
  actions: { gap: 10 },
  startSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  startSessionText: { fontSize: 15 },
  secondaryActions: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  actionText: { fontSize: 13 },
  navCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  errorText: { fontSize: 15, textAlign: "center" },
});
