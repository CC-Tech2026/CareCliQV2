import { FontFamily } from "@/constants/typography";
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
import { RecentNotesPreview } from "@/components/worker/client/RecentNotesPreview";
import { activeGoals, uniqueClientRecords } from "@/lib/client-utils";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

const RECENT_NOTES_LIMIT = 3;

export default function ClientDetailHubScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"support" | "goals" | "visits" | "records">(
    "support",
  );
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
  const recordCount = uniqueClientRecords([
    ...data.sessions,
    ...data.notes,
  ]).length;
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
  const recentNotes = [...data.notes]
    .sort((a, b) => {
      const aDate = a.session_date ? new Date(a.session_date).getTime() : 0;
      const bDate = b.session_date ? new Date(b.session_date).getTime() : 0;
      return bDate - aDate;
    })
    .slice(0, RECENT_NOTES_LIMIT);

  return (
    <ClientScreenShell title="Participant profile">
      <View style={styles.fixedHeader}>
        <ClientProfileHeader client={client} compact />

        <View
          accessibilityRole="tablist"
          style={[
            styles.tabs,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {(
            [
              ["support", "Support"],
              ["goals", "Goals"],
              ["visits", "Visits"],
              ["records", "Records"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              aria-selected={tab === key}
              onPress={() => setTab(key)}
              style={({ pressed }) => [
                styles.tab,
                { opacity: pressed ? 0.7 : 1 },
                {
                  backgroundColor: "transparent",
                  borderBottomColor:
                    tab === key ? colors.primary : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: tab === key ? colors.primary : colors.mutedForeground,
                  fontFamily: FontFamily.interSemiBold,
                  textAlign: "center",
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView
        key={client.id + ":" + tab}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
      >
        {(tab === "support" || tab === "goals") && (
          <ClientOverviewContent
            key={client.id + tab}
            client={client}
            section={tab}
          />
        )}
        {tab === "visits" && (
          <>
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
              label="Go to my shifts"
              subtitle="Open your scheduled shift to review the briefing and clock in"
              onPress={() => router.push("/(tabs)/shifts" as never)}
            />
          </>
        )}
        {tab === "records" && (
          <>
            {recentNotes.length > 0 && (
              <View style={{ gap: 10 }}>
                <View style={styles.sectionHeaderRow}>
                  <Text
                    accessibilityRole="header"
                    style={{
                      color: colors.foreground,
                      fontFamily: FontFamily.interBold,
                      fontSize: 18,
                    }}
                  >
                    Recent session notes
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View all session notes"
                    style={styles.viewAllAction}
                    onPress={() =>
                      router.push(`/client/${id}/shift-notes` as never)
                    }
                  >
                    <Text
                      style={{
                        color: colors.primary,
                        fontFamily: FontFamily.interSemiBold,
                        fontSize: 13,
                      }}
                    >
                      View all
                    </Text>
                  </Pressable>
                </View>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                    fontSize: 13,
                    lineHeight: 19,
                    marginTop: -4,
                  }}
                >
                  What happened last time, so you know what to follow up on. Tap
                  a note to read it.
                </Text>
                <RecentNotesPreview rows={recentNotes} />
              </View>
            )}

            <View style={styles.actions}>
              <View style={styles.secondaryActions}>
                <Pressable
                  onPress={() => router.push("/incidents" as never)}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.dangerBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.actionText,
                      {
                        color: colors.dangerText,
                        fontFamily: FontFamily.interBold,
                      },
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
                label="Overview"
                subtitle="Medical alerts, preferences, goals"
                onPress={() => router.push(`/client/${id}/overview` as never)}
              />
              <ClientNavRow
                label="Plan & goals"
                subtitle={
                  planGoals
                    ? `${planGoals} active goal${planGoals === 1 ? "" : "s"}`
                    : "No goals recorded"
                }
                onPress={() => router.push(`/client/${id}/plan` as never)}
              />
              <ClientNavRow
                label="Shift Notes"
                subtitle={`${recordCount} record${recordCount === 1 ? "" : "s"}`}
                onPress={() =>
                  router.push(`/client/${id}/shift-notes` as never)
                }
              />
              <ClientNavRow
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
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  fixedHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  scroll: {
    padding: 16,
    paddingTop: 4,
    gap: 16,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  viewAllAction: { minHeight: 44, paddingLeft: 12, justifyContent: "center" },
  actions: { gap: 10 },
  startSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
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
