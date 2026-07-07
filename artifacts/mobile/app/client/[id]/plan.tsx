import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useWorkerClientNdisPlan } from "@/hooks/worker/useWorkerClientNdisPlan";
import { useColors } from "@/hooks/useColors";

export default function ClientPlanScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detailQuery = useWorkerClientDetail(id);
  const planQuery = useWorkerClientNdisPlan(id);

  if (detailQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const client = detailQuery.data?.participant;
  if (detailQuery.error || !client) {
    return (
      <ClientScreenShell title="Plan & goals" backHref={`/client/${id}`}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(detailQuery.error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  const goals = planQuery.data?.goals?.length
    ? planQuery.data.goals
    : client.goals ?? [];

  return (
    <ClientScreenShell title="Plan & goals" subtitle={client.full_name} backHref={`/client/${id}`}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {planQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : goals.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            No NDIS goals recorded yet
          </Text>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                {goals.length} NDIS GOAL{goals.length === 1 ? "" : "S"}
              </Text>
            </View>
            {goals.map((goal, index) => {
              const status = String(goal.status || "active").toLowerCase();
              const isActive = !["completed", "achieved", "archived"].includes(status);
              const title = goal.title || goal.description || `Goal ${index + 1}`;
              const description =
                goal.description && goal.title ? goal.description : goal.description || "";

              return (
                <View
                  key={goal.id || String(index)}
                  style={[
                    styles.goalRow,
                    index < goals.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: isActive ? "#34D399" : colors.muted }]} />
                  <View style={styles.goalContent}>
                    <View style={styles.goalTop}>
                      <Text style={[styles.goalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                        {title}
                      </Text>
                      {goal.category ? (
                        <View style={[styles.category, { backgroundColor: colors.activeBg }]}>
                          <Text style={[styles.categoryText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                            {goal.category}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {description ? (
                      <Text style={[styles.goalDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {description}
                      </Text>
                    ) : null}
                    {!isActive ? (
                      <Text style={[styles.status, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                        {status}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: 16 },
  empty: { fontSize: 14, paddingTop: 8 },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  cardHeader: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  cardTitle: { fontSize: 11, letterSpacing: 0.8 },
  goalRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  goalContent: { flex: 1, gap: 6 },
  goalTop: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start" },
  goalTitle: { fontSize: 14, lineHeight: 20, flex: 1 },
  category: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  categoryText: { fontSize: 10, textTransform: "uppercase" },
  goalDesc: { fontSize: 13, lineHeight: 20 },
  status: { fontSize: 12, textTransform: "capitalize" },
  errorText: { fontSize: 15, textAlign: "center" },
});
