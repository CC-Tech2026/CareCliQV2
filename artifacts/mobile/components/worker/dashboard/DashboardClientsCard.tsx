import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { complianceBadgeMeta, safeClientDate } from "@/lib/client-utils";
import type { DashboardClient } from "@/lib/dashboard-api";
import { shiftInitials } from "@/lib/shift-utils";

type Props = {
  clients: DashboardClient[];
};

export function DashboardClientsCard({ clients }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.todaysClients")}
        </Text>
        <Pressable onPress={() => router.push("/(tabs)/participants" as never)}>
          <Text style={[styles.link, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {t("dashboard.myClients")}
          </Text>
        </Pressable>
      </View>

      {clients.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.noClientsToday")}
        </Text>
      ) : (
        <View style={styles.list}>
          {clients.map((client, index) => {
            const badge = complianceBadgeMeta(client.compliance_status);
            return (
              <Pressable
                key={client.id}
                onPress={() => router.push(`/client/${client.id}` as never)}
                style={[
                  styles.row,
                  index < clients.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
                    {shiftInitials(client.full_name)}
                  </Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                    {client.full_name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                    {client.plan_management_type || "NDIS"}
                    {" · "}
                    {client.last_seen
                      ? t("clients.lastSeenOn", { date: safeClientDate(client.last_seen) })
                      : t("clients.notSeenYet")}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.color + "40" }]}>
                  <Text style={[styles.badgeText, { color: badge.color, fontFamily: "Inter_700Bold" }]}>
                    {badge.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15 },
  link: { fontSize: 13 },
  empty: { fontSize: 14, borderRadius: 12, padding: 12, backgroundColor: "rgba(82,113,255,0.06)" },
  list: { gap: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 12 },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: 14 },
  meta: { fontSize: 12 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 10 },
});
