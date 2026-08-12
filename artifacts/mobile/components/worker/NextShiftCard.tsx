import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { DashboardShiftSummary } from "@/lib/dashboard-api";
import { formatShiftTimeRange, shiftInitials } from "@/lib/shift-utils";

type Props = {
  shift: DashboardShiftSummary | null | undefined;
};

export function NextShiftCard({ shift }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();

  if (!shift) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.nextShift.title").toUpperCase()}
        </Text>
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("dashboard.nextShift.empty")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: colors.soft, borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {t("dashboard.nextShift.title").toUpperCase()}
        </Text>
        <View style={styles.participantRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
              {shiftInitials(shift.participant_name)}
            </Text>
          </View>
          <View style={styles.participantInfo}>
            <Text
              style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
              numberOfLines={1}
            >
              {shift.participant_name}
            </Text>
            <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {shift.participant_address ? (
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={14} color={colors.primary} />
            <Text style={[styles.address, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
              {shift.participant_address}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push(`/shift/${shift.id}` as never)}
          style={[styles.openBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.openBtnText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {t("dashboard.nextShift.openShift")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 12,
  },
  participantRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 14 },
  participantInfo: { flex: 1, gap: 2 },
  name: { fontSize: 20, letterSpacing: -0.3 },
  time: { fontSize: 14 },
  body: { padding: 20, gap: 16 },
  addressRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  address: { flex: 1, fontSize: 14, lineHeight: 20 },
  openBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  openBtnText: { fontSize: 15 },
  empty: {
    marginTop: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
  },
});
