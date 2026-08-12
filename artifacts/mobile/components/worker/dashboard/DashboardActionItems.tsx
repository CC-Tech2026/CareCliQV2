import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { WorkerLandingDashboard } from "@/lib/dashboard-api";
import { mapWebPathToMobile } from "@/lib/route-map";

type Item = WorkerLandingDashboard["action_items"][number];

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#DC2626", bg: "#FEE2E2", border: "#FECACA" },
  high: { color: "#D97706", bg: "#FEF3C7", border: "#FDE68A" },
  medium: { color: "#2563EB", bg: "#DBEAFE", border: "#BFDBFE" },
  low: { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
};

type Props = {
  items: Item[];
};

export function DashboardActionItems({ items }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();

  function handlePress(item: Item) {
    const href = mapWebPathToMobile(item.action_url);
    if (href) router.push(href as never);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="clipboard" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.actionItems.title")}
        </Text>
      </View>

      {items.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.actionItems.empty")}
        </Text>
      ) : (
        <View style={styles.list}>
          {items.map((item, index) => {
            const severity = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.medium;
            return (
              <Pressable
                key={item.id}
                onPress={() => handlePress(item)}
                style={[
                  styles.row,
                  index < items.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <Feather
                  name="alert-triangle"
                  size={16}
                  color={item.severity === "critical" ? "#DC2626" : colors.primary}
                  style={styles.icon}
                />
                <View style={styles.rowBody}>
                  <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.detail ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
                      {item.detail}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.badge, { backgroundColor: severity.bg, borderColor: severity.border }]}>
                  <Text style={[styles.badgeText, { color: severity.color, fontFamily: "Inter_700Bold" }]}>
                    {item.severity.toUpperCase()}
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
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15 },
  empty: { fontSize: 14, borderRadius: 12, padding: 12, backgroundColor: "rgba(82,113,255,0.06)" },
  list: { gap: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10 },
  icon: { marginTop: 2 },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: 14 },
  meta: { fontSize: 12, lineHeight: 17 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 9, letterSpacing: 0.4 },
});
