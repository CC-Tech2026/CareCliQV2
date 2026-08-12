import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WorkerPageSubheader } from "@/components/worker/WorkerPageSubheader";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerClients } from "@/hooks/worker/useWorkerClients";
import { useColors } from "@/hooks/useColors";
import type { WorkerClient } from "@/lib/worker-api";
import { shiftInitials } from "@/lib/shift-utils";

function complianceMeta(
  status: string | undefined,
  colors: ReturnType<typeof useColors>,
): { label: string; color: string; bg: string } {
  if (status === "compliant") {
    return { label: "Compliant", color: "#15803D", bg: "#DCFCE7" };
  }
  if (status === "non_compliant") {
    return { label: "Non-compliant", color: colors.destructive, bg: "#FCEBEB" };
  }
  return { label: "Needs review", color: "#854F0B", bg: "#FFF3E0" };
}

function ClientRow({ client, onPress }: { client: WorkerClient; onPress: () => void }) {
  const colors = useColors();
  const meta = complianceMeta(client.compliance_status, colors);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
      testID={`client-row-${client.id}`}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
          {shiftInitials(client.full_name)}
        </Text>
      </View>

      <View style={styles.rowContent}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
          {client.full_name}
        </Text>
        {client.ndis_number ? (
          <Text style={[styles.ndis, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            NDIS {client.ndis_number}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {client.plan_management_type ?? "No plan type"}
        </Text>
      </View>

      <View style={styles.rowRight}>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color, fontFamily: "Inter_600SemiBold" }]}>
            {meta.label}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function MyClientsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [search, setSearch] = useState("");
  const { isOnline } = useOffline();

  const { data = [], isLoading, error, refetch, isRefetching } = useWorkerClients();

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data
      .filter((c) => {
        if (!q) return true;
        const ndis = (c.ndis_number ?? "").toLowerCase();
        return c.full_name.toLowerCase().includes(q) || ndis.includes(q);
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [data, search]);

  const compliantCount = data.filter((c) => c.compliance_status === "compliant").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.clients")} showBack />
      <WorkerPageSubheader
        subtitle={t("clients.assignedCompliant", { assigned: data.length, compliant: compliantCount })}
      />

      {data.length > 0 && (
        <View style={[styles.searchWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("clients.searchPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          />
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          style={{ backgroundColor: colors.card }}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={
            isOnline ? (
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ClientRow client={item} onPress={() => router.push(`/client/${item.id}` as never)} />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="users" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {search ? t("clients.noMatch") : t("clients.empty")}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 6 },
  list: { paddingTop: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 72,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 14 },
  rowContent: { flex: 1, gap: 2 },
  name: { fontSize: 15 },
  ndis: { fontSize: 11 },
  meta: { fontSize: 12 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 15 },
  errorText: { fontSize: 14, padding: 24, textAlign: "center" },
});
