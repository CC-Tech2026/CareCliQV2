import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ComplianceScoreRing } from "@/components/worker/compliance/ComplianceScoreRing";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { formatShiftTimeRange } from "@/lib/shift-utils";
import type { ShiftReviewItem as Item, ShiftReviewStatus } from "@/lib/worker-api";

/** The chip for where a finished shift stands with the office. */
export function ReviewStatusChip({ status }: { status: ShiftReviewStatus }) {
  const colors = useColors();
  const t = useT();
  const tone =
    status === "changes_requested"
      ? { fg: colors.warning, bg: colors.warning + "1F", icon: "edit-3" as const, label: t("review.status.changesRequested") }
      : status === "verified"
        ? { fg: colors.success, bg: colors.success + "1F", icon: "check-circle" as const, label: t("review.status.verified") }
        : { fg: colors.mutedForeground, bg: colors.muted, icon: "clock" as const, label: t("review.status.awaiting") };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Feather name={tone.icon} size={11} color={tone.fg} />
      <Text style={[styles.chipText, { color: tone.fg, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
        {tone.label}
      </Text>
    </View>
  );
}

// One finished shift: who, when, where it stands, and anything unread.
export function ShiftReviewItem({ item }: { item: Item }) {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const hasScore = item.compliance_score != null && Number.isFinite(Number(item.compliance_score));
  // The range already starts with the day ("Tue, 3 Nov · 10:02 am - 2:01 pm").
  const times = formatShiftTimeRange(
    item.clocked_in_at ?? item.scheduled_start ?? undefined,
    item.clocked_out_at ?? item.scheduled_end ?? undefined,
    item.timezone,
  );
  const needsYou = item.review_status === "changes_requested";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.participant_name, times].filter(Boolean).join(", ")}
      onPress={() => router.push(`/shift/${item.shift_id}/record` as never)}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: needsYou ? colors.warning + "66" : colors.border,
          backgroundColor: colors.card,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <ComplianceScoreRing score={hasScore ? Math.round(Number(item.compliance_score)) : 0} size={44} empty={!hasScore} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
          {item.participant_name || t("review.participantFallback")}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {times}
        </Text>
        <View style={styles.row}>
          <ReviewStatusChip status={item.review_status} />
          {item.unread_messages > 0 ? (
            <View style={[styles.unread, { backgroundColor: colors.primary }]}>
              <Feather name="message-circle" size={10} color="#FFFFFF" />
              <Text style={[styles.unreadText, { fontFamily: "Inter_700Bold" }]}>{item.unread_messages}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 14 },
  meta: { fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 1,
  },
  chipText: { fontSize: 11 },
  unread: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  unreadText: { color: "#FFFFFF", fontSize: 10 },
});
