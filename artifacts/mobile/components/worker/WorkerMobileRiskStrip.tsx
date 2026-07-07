import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ShiftHealthAlert } from "@/lib/worker-api";

type Props = {
  alerts: ShiftHealthAlert[];
};

export function WorkerMobileRiskStrip({ alerts }: Props) {
  const colors = useColors();

  if (!alerts.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      style={[styles.wrap, { borderBottomColor: colors.border }]}
    >
      {alerts.map((alert, i) => {
        const isCritical = alert.severity === "critical";
        return (
          <View
            key={`${alert.title}-${i}`}
            style={[
              styles.chip,
              {
                backgroundColor: isCritical ? "#FCEBEB" : "#FFF3E0",
                borderColor: isCritical ? "#EF4444" : colors.warning,
              },
            ]}
          >
            <Feather
              name={isCritical ? "alert-octagon" : "alert-triangle"}
              size={12}
              color={isCritical ? "#A32D2D" : "#854F0B"}
            />
            <Text
              style={[
                styles.chipText,
                { color: isCritical ? "#A32D2D" : "#854F0B", fontFamily: "Inter_600SemiBold" },
              ]}
              numberOfLines={1}
            >
              {alert.title}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 200,
  },
  chipText: {
    fontSize: 12,
    flexShrink: 1,
  },
});
