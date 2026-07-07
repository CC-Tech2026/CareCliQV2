import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  participantName: string;
  planLabel?: string;
};

export function WorkerMobileParticipantStrip({ participantName, planLabel = "Plan · review" }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: colors.activeBg }]}>
        <Feather name="user" size={16} color={colors.primary} />
      </View>
      <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
        {participantName}
      </Text>
      <View style={[styles.pill, { backgroundColor: colors.activeBg, borderColor: colors.primary + "40" }]}>
        <Text style={[styles.pillText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>{planLabel}</Text>
        <Feather name="chevron-down" size={12} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    flex: 1,
    fontSize: 14,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
  },
});
