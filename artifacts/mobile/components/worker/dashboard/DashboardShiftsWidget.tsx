import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { DashboardShiftSummary } from "@/lib/dashboard-api";
import type { ShiftVisualState } from "@/lib/worker-api";
import { shiftInitials } from "@/lib/shift-utils";

type Props = {
  shifts: DashboardShiftSummary[];
};

export function DashboardShiftsWidget({ shifts }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="calendar" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {t("dashboard.todaysShifts")}
          </Text>
        </View>
        <Pressable onPress={() => router.push("/(tabs)/shifts" as never)}>
          <Text style={[styles.link, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {t("dashboard.viewAll")}
          </Text>
        </Pressable>
      </View>

      {shifts.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.noShiftsToday")}
        </Text>
      ) : (
        <View style={styles.list}>
          {shifts.map((shift, index) => (
            <Pressable
              key={shift.id}
              onPress={() => router.push(`/shift/${shift.id}` as never)}
              style={[
                styles.row,
                index < shifts.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
                  {shiftInitials(shift.participant_name)}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                  {shift.participant_name}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                  {shift.time_label || t("shifts.timeNotSet")}
                </Text>
              </View>
              <ShiftStatusBadge visualState={(shift.visual_state || "scheduled") as ShiftVisualState} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
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
});
