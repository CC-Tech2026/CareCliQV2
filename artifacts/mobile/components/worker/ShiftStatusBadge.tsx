import { FontFamily } from "@/constants/typography";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ShiftVisualState } from "@/lib/worker-api";
import { STATE_LABELS } from "@/lib/shift-utils";

type Props = {
  visualState: ShiftVisualState;
};

export function ShiftStatusBadge({ visualState }: Props) {
  const colors = useColors();
  const label = STATE_LABELS[visualState] ?? visualState;

  const tone =
    visualState === "completed"
      ? { color: colors.success, bg: colors.statusDocumentedBg }
      : visualState === "scheduled"
        ? { color: colors.primary, bg: colors.statusUpcomingBg }
        : { color: colors.warning, bg: colors.statusProgressBg };

  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text
        style={[
          styles.label,
          { color: tone.color, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  label: {
    fontSize: 12,
    lineHeight: 18,
  },
});
