import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatTimeWithZone } from "@/lib/shift-utils";

type Props = {
  clockedInAt: string | null;
  participantName?: string;
  /** Participant's branch zone. */
  tz?: string | null;
};

export function ClockedInBanner({ clockedInAt, tz }: Props) {
  const colors = useColors();
  const timeLabel = clockedInAt ? formatTimeWithZone(clockedInAt, tz) : null;

  return (
    <View style={[styles.banner, { backgroundColor: colors.clockInBg, borderColor: colors.clockInBorder }]}>
      <Feather name="check-circle" size={20} color={colors.clockInIcon} />
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.clockInText, fontFamily: "Inter_600SemiBold" }]}>
          {timeLabel ? `Clocked in at ${timeLabel}` : "Clocked in"}
        </Text>
        <Text style={[styles.hint, { color: colors.clockInText, fontFamily: "Inter_500Medium" }]}>
          Tap any task to begin documenting
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  textWrap: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 13,
  },
  hint: {
    fontSize: 12,
    lineHeight: 16,
  },
});
