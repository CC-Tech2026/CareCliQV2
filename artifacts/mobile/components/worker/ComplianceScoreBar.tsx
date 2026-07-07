import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { scoreColor } from "@workspace/worker-compliance";

type Props = {
  score: number;
  onPress?: () => void;
};

export function ComplianceScoreBar({ score, onPress }: Props) {
  const colors = useColors();
  const clr = scoreColor(score);

  const content = (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.left}>
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          COMPLIANCE
        </Text>
        <Text style={[styles.score, { color: clr, fontFamily: "Inter_700Bold" }]}>
          {Math.round(score)}%
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.barFill, { width: `${Math.min(score, 100)}%`, backgroundColor: clr }]} />
      </View>
      {onPress && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: {
    gap: 2,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
  score: {
    fontSize: 18,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
});
