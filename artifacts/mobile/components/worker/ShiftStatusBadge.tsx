import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ShiftVisualState } from "@/lib/worker-api";
import { STATE_AVATAR_COLORS, STATE_LABELS } from "@/lib/shift-utils";

type Props = {
  visualState: ShiftVisualState;
};

export function ShiftStatusBadge({ visualState }: Props) {
  const colors = useColors();
  const avatarColor = STATE_AVATAR_COLORS[visualState] ?? colors.mutedForeground;
  const label = STATE_LABELS[visualState] ?? visualState;

  return (
    <View style={[styles.badge, { backgroundColor: avatarColor + "20", borderColor: colors.border }]}>
      <View style={[styles.dot, { backgroundColor: avatarColor }]} />
      <Text style={[styles.label, { color: avatarColor, fontFamily: "Inter_700Bold" }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
});
