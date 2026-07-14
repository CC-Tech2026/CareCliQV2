import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { DashboardShiftSummary } from "@/lib/dashboard-api";
import type { ShiftVisualState } from "@/lib/worker-api";
import { shiftInitials, findInProgressShift, isBlockedByInProgressShift } from "@/lib/shift-utils";
import { showBlockedByInProgressAlert } from "@/lib/shift-block-alert";

type Props = {
  shifts: DashboardShiftSummary[];
  nextShiftId?: string | null;
};

function parseStart(value?: string) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function DayShiftTimeline({ shifts, nextShiftId }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const inProgressShift = useMemo(() => findInProgressShift(shifts), [shifts]);

  const ordered = useMemo(
    () => [...shifts].sort((a, b) => parseStart(a.scheduled_start) - parseStart(b.scheduled_start)),
    [shifts],
  );

  const openShift = (shift: DashboardShiftSummary) => {
    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedByInProgressAlert(t, inProgressShift, (id) => router.push(`/shift/${id}` as never));
      return;
    }
    router.push(`/shift/${shift.id}` as never);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="clock" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.todaysTimeline")}
        </Text>
      </View>

      {ordered.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.timelineEmpty")}
        </Text>
      ) : (
        <View style={styles.list}>
          {ordered.map((shift, index) => {
            const isNext = shift.id === nextShiftId;
            return (
              <Pressable
                key={shift.id}
                onPress={() => openShift(shift)}
                style={[
                  styles.row,
                  {
                    borderColor: isNext ? colors.primary : colors.border,
                    backgroundColor: isNext ? colors.activeBg : colors.background,
                  },
                  index < ordered.length - 1 && styles.rowGap,
                ]}
              >
                <View style={styles.timelineCol}>
                  <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
                      {shiftInitials(shift.participant_name)}
                    </Text>
                  </View>
                  {index < ordered.length - 1 ? (
                    <View style={[styles.connector, { backgroundColor: colors.border }]} />
                  ) : null}
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
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  rowGap: { marginBottom: 10 },
  timelineCol: { alignItems: "center", width: 36 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 11 },
  connector: { width: 2, flex: 1, minHeight: 12, marginTop: 4 },
  rowBody: { flex: 1, gap: 2, paddingTop: 2 },
  name: { fontSize: 14 },
  meta: { fontSize: 12 },
});
