import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useColors } from "@/hooks/useColors";
import { listIncidents, type IncidentSummary } from "@/lib/resource-api";

export default function IncidentsListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: async () => {
      const result = await listIncidents();
      return Array.isArray(result) ? result : (result as { items?: IncidentSummary[] }).items ?? [];
    },
  });

  const navPad = workerBottomNavHeight(insets.bottom, Platform.OS === "web");

  return (
    <WorkerStackScreen headerTitle="Incidents" pageTitle="Incidents" subtitle="Safety reports and follow-ups">
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                No incidents reported yet.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/incidents/${item.id}` as never)}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {item.participant_name ?? "No participant"} · {item.severity}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}

      <Pressable
        onPress={() => router.push("/incidents/new" as never)}
        style={[styles.fab, { backgroundColor: colors.accent, bottom: navPad + 16 }]}
      >
        <Feather name="plus" size={22} color="#FFFFFF" />
      </Pressable>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { fontSize: 14, textAlign: "center" },
  empty: { fontSize: 14, textAlign: "center" },
  list: { paddingTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15 },
  rowMeta: { fontSize: 12 },
  fab: {
    position: "absolute",
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
});
