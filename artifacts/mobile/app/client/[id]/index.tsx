import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ClientNavRow } from "@/components/worker/client/ClientNavRow";
import { ClientProfileHeader } from "@/components/worker/client/ClientProfileHeader";
import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { activeGoals } from "@/lib/client-utils";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

export default function ClientDetailHubScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error } = useWorkerClientDetail(id);

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
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  const client = data.participant;
  const goals = activeGoals(client.goals);
  const planGoals = goals.length;

  return (
    <ClientScreenShell title={client.full_name} subtitle="Client profile" backHref="/(tabs)/participants">
      <ScrollView contentContainerStyle={styles.scroll}>
        <ClientProfileHeader client={client} />

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push(`/client/${id}/session` as never)}
            style={[styles.startSessionBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="mic" size={16} color={colors.primaryForeground} />
            <Text style={[styles.startSessionText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              Start session
            </Text>
          </Pressable>
          <View style={styles.secondaryActions}>
            <Pressable
              onPress={() => router.push(`/client/${id}/notes` as never)}
              style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="edit-3" size={15} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                Add note
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/incidents" as never)}
              style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: "#FECACA" }]}
            >
              <Feather name="alert-circle" size={15} color="#DC2626" />
              <Text style={[styles.actionText, { color: "#DC2626", fontFamily: "Inter_700Bold" }]}>Incident</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ClientNavRow
            icon="user"
            label="Overview"
            subtitle="Medical alerts, preferences, goals"
            onPress={() => router.push(`/client/${id}/overview` as never)}
          />
          <ClientNavRow
            icon="target"
            label="Plan & goals"
            subtitle={planGoals ? `${planGoals} active goal${planGoals === 1 ? "" : "s"}` : "No goals recorded"}
            onPress={() => router.push(`/client/${id}/plan` as never)}
          />
          <ClientNavRow
            icon="calendar"
            label="Sessions"
            subtitle={`${data.sessions.length} record${data.sessions.length === 1 ? "" : "s"}`}
            onPress={() => router.push(`/client/${id}/sessions` as never)}
          />
          <ClientNavRow
            icon="file-text"
            label="Notes"
            subtitle={`${data.notes.length} note${data.notes.length === 1 ? "" : "s"}`}
            onPress={() => router.push(`/client/${id}/notes` as never)}
          />
          <ClientNavRow
            icon="shield"
            label="Compliance"
            subtitle={`${data.compliance.length} record${data.compliance.length === 1 ? "" : "s"}`}
            onPress={() => router.push(`/client/${id}/compliance` as never)}
          />
        </View>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: 16, gap: 16 },
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
