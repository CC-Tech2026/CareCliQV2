import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Variant = "default" | "warning" | "critical";

type Props = {
  label: string;
  value: number | string;
  variant?: Variant;
};

export function WorkerStatCard({ label, value, variant = "default" }: Props) {
  const colors = useColors();

  const valueColor =
    variant === "warning"
      ? colors.warning
      : variant === "critical"
        ? colors.accent
        : colors.primary;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.value, { color: valueColor, fontFamily: "Inter_700Bold" }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: "center",
    flex: 1,
  },
  value: { fontSize: 28, letterSpacing: -0.5 },
  label: { marginTop: 4, fontSize: 11, textAlign: "center", lineHeight: 14 },
});
