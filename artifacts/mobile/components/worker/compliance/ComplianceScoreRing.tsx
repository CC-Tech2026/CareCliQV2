import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

type Props = {
  score: number;
  size?: number;
  empty?: boolean;
};

function ringStroke(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 85) return colors.success;
  if (score >= 60) return colors.warning;
  return colors.destructive;
}

export function ComplianceScoreRing({ score, size = 52, empty = false }: Props) {
  const colors = useColors();
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = empty ? colors.soft : ringStroke(value, colors);
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const offset = empty ? circumference : circumference * (1 - value / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.soft}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>
        <View style={styles.center}>
          <Text style={[styles.score, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {empty ? "—" : value || "—"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  score: { fontSize: 13 },
});
