import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { WorkerLandingDashboard } from "@/lib/dashboard-api";
import { mapWebPathToMobile } from "@/lib/route-map";

type Alert = WorkerLandingDashboard["compliance_alerts"][number];

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#DC2626", bg: "#FEE2E2", border: "#FECACA" },
  high: { color: "#D97706", bg: "#FEF3C7", border: "#FDE68A" },
  medium: { color: "#2563EB", bg: "#DBEAFE", border: "#BFDBFE" },
  info: { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
};

type Props = {
  alerts: Alert[];
};

export function DashboardComplianceAlerts({ alerts }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();

  function handlePress(alert: Alert) {
    const href = mapWebPathToMobile(alert.action_url) ?? "/credentials";
    router.push(href as never);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="shield" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.complianceAlerts.title")}
        </Text>
      </View>

      {alerts.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.complianceAlerts.empty")}
        </Text>
      ) : (
        <View style={styles.list}>
          {alerts.map((alert, index) => {
            const severity = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
            return (
              <Pressable
                key={alert.id}
                onPress={() => handlePress(alert)}
                style={[
                  styles.row,
                  { borderColor: colors.border },
                  index < alerts.length - 1 && styles.rowGap,
                ]}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
                    {alert.title}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: severity.bg, borderColor: severity.border }]}>
                    <Text style={[styles.badgeText, { color: severity.color, fontFamily: "Inter_700Bold" }]}>
                      {alert.severity.toUpperCase()}
                    </Text>
                  </View>
                </View>
                {alert.detail ? (
                  <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
                    {alert.detail}
                  </Text>
                ) : null}
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
  row: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  rowGap: { marginBottom: 10 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  name: { fontSize: 14, flex: 1 },
  meta: { fontSize: 12, lineHeight: 17 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 9, letterSpacing: 0.4 },
});
